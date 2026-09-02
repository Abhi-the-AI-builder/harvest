// Supabase client for extension-origin contexts (service worker, later
// the side panel). Credentials come from config.local.js (gitignored).
// IndexedDB remains the local source of truth until a sync path is built.
(function (global) {
  let client = null;

  const chromeStorageAdapter = {
    getItem(key) {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
          resolve(result[key] == null ? null : result[key]);
        });
      });
    },
    setItem(key, value) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, resolve);
      });
    },
    removeItem(key) {
      return new Promise((resolve) => {
        chrome.storage.local.remove(key, resolve);
      });
    },
  };

  function getClient() {
    const url = global.ACOPIO_SUPABASE_URL;
    const key = global.ACOPIO_SUPABASE_ANON_KEY;
    const createClient = global.supabase && global.supabase.createClient;
    if (!url || !key || !createClient) return null;
    if (!client) {
      client = createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storage: chromeStorageAdapter,
        },
      });
    }
    return client;
  }

  function getExtensionRedirectUrl() {
    try {
      return chrome.identity.getRedirectURL();
    } catch (_err) {
      return null;
    }
  }

  function supabaseCallbackUrl() {
    const base = global.ACOPIO_SUPABASE_URL;
    return base ? `${String(base).replace(/\/$/, "")}/auth/v1/callback` : null;
  }

  // Chrome reports a generic message when the OAuth window can't finish —
  // usually a dashboard setup gap, not a code bug. Point at the exact URLs.
  function formatGoogleSignInError(rawMessage, redirectUrl) {
    const msg = String(rawMessage || "");
    const callback = supabaseCallbackUrl();
    if (/Authorization page could not be loaded/i.test(msg)) {
      return [
        "Google sign-in couldn't open — this is almost always a setup step still missing.",
        redirectUrl
          ? `In Supabase → Authentication → URL Configuration → Redirect URLs, add exactly: ${redirectUrl}`
          : "In Supabase → Authentication → URL Configuration → Redirect URLs, add your extension redirect URI (see LAUNCH-PATH-B.md §1.2).",
        callback
          ? `In Google Cloud Console → your OAuth client → Authorized redirect URIs, add only: ${callback} (do not put the chromiumapp.org URL here).`
          : "In Google Cloud Console → your OAuth client → Authorized redirect URIs, add your Supabase /auth/v1/callback URL only.",
        "In Google Cloud Console → OAuth consent screen: if status is Testing, add your Gmail under Test users.",
        "Reload the extension after saving, then try Export again.",
      ].join(" ");
    }
    if (/Sign-in was closed|user did not approve/i.test(msg)) {
      return "Google sign-in was cancelled. Try Export again when you're ready.";
    }
    if (/redirect_uri_mismatch/i.test(msg)) {
      return callback
        ? `Google redirect URI mismatch. In Google Cloud Console, the only redirect URI should be: ${callback}`
        : "Google redirect URI mismatch — see LAUNCH-PATH-B.md §2.1.";
    }
    return msg;
  }

  // launchWebAuthFlow is more reliable opening Google's URL directly than
  // the Supabase /authorize hop (which returns an HTML redirect link).
  async function resolveOAuthLaunchUrl(authorizeUrl) {
    try {
      const resp = await fetch(authorizeUrl, { method: "GET", redirect: "manual" });
      const location = resp.headers.get("Location");
      if (location && /^https?:\/\//i.test(location)) {
        return location.replace(/&amp;/g, "&");
      }
      if (resp.status === 200) {
        const text = await resp.text();
        const match = text.match(/href="([^"]+)"/i);
        if (match && match[1]) return match[1].replace(/&amp;/g, "&");
      }
    } catch (err) {
      console.warn("[Acopio] Couldn't resolve OAuth provider URL, using Supabase authorize URL", err);
    }
    return authorizeUrl;
  }

  function launchWebAuthFlow(url) {
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url, interactive: true }, (result) => {
        if (chrome.runtime.lastError || !result) {
          reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || "Sign-in was closed before finishing."));
          return;
        }
        resolve(result);
      });
    });
  }

  async function sessionFromRedirect(c, redirected) {
    const parsed = new URL(redirected);
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const queryParams = parsed.searchParams;
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (accessToken && refreshToken) {
      const { data: sessionData, error: sessionError } = await c.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) return { ok: false, error: sessionError.message };
      return { ok: true, email: sessionData && sessionData.user ? sessionData.user.email : null };
    }
    const code = queryParams.get("code");
    if (code) {
      const { data: sessionData, error: sessionError } = await c.auth.exchangeCodeForSession(code);
      if (sessionError) return { ok: false, error: sessionError.message };
      return { ok: true, email: sessionData && sessionData.user ? sessionData.user.email : null };
    }
    const oauthError =
      hashParams.get("error_description") ||
      queryParams.get("error_description") ||
      hashParams.get("error") ||
      queryParams.get("error");
    if (oauthError && /redirect/i.test(oauthError)) {
      const redirectUrl = getExtensionRedirectUrl();
      return {
        ok: false,
        error: redirectUrl
          ? `Supabase rejected the redirect URL. Add exactly ${redirectUrl} under Authentication → URL Configuration → Redirect URLs.`
          : "Supabase rejected the redirect URL — see LAUNCH-PATH-B.md §2.1.",
      };
    }
    return { ok: false, error: oauthError || "Google didn't return a session." };
  }

  async function ping() {
    const c = getClient();
    if (!c) {
      return { ok: false, configured: false, error: "Supabase is not configured." };
    }
    const { data, error } = await c.auth.getSession();
    if (error) {
      return { ok: false, configured: true, error: error.message };
    }
    return {
      ok: true,
      configured: true,
      signedIn: !!(data && data.session),
      email: data && data.session && data.session.user ? data.session.user.email : null,
    };
  }

  // "Login via Google" gate in front of Export to Figma/Notion — a Google
  // sign-in only proves who's using Acopio itself (via Supabase Auth); it
  // is NOT the same token as, and doesn't substitute for, actually
  // connecting a Figma or Notion account (those are separate OAuth apps,
  // see cloud-oauth.js). No custom redirect page exists for this
  // extension, so this uses the standard Chrome-extension pattern for
  // Supabase Auth: build the provider URL with skipBrowserRedirect (so
  // Supabase hands back a URL instead of navigating the current page),
  // open it in chrome.identity's own auth window, then hand the
  // access/refresh tokens Supabase appends to the redirect back to
  // supabase-js via setSession() — that's what actually persists the
  // session (through the chromeStorageAdapter above), not the redirect
  // itself.
  async function signInWithGoogle() {
    const c = getClient();
    if (!c) return { ok: false, error: "Supabase is not configured." };
    const redirectTo = getExtensionRedirectUrl();
    if (!redirectTo) {
      return { ok: false, error: "Chrome identity permission is missing — reload the extension from chrome://extensions." };
    }
    const { data, error } = await c.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data || !data.url) {
      return { ok: false, error: (error && error.message) || "Couldn't start Google sign-in." };
    }
    const launchUrl = await resolveOAuthLaunchUrl(data.url);
    let redirected;
    try {
      redirected = await launchWebAuthFlow(launchUrl);
    } catch (err) {
      return { ok: false, error: formatGoogleSignInError((err && err.message) || err, redirectTo) };
    }
    const sessionResult = await sessionFromRedirect(c, redirected);
    if (!sessionResult.ok) {
      return { ok: false, error: formatGoogleSignInError(sessionResult.error, redirectTo) };
    }
    return sessionResult;
  }

  async function signOut() {
    const c = getClient();
    if (!c) return { ok: false, error: "Supabase is not configured." };
    const { error } = await c.auth.signOut();
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  try {
    const redirectUrl = getExtensionRedirectUrl();
    if (redirectUrl) {
      console.info("[Acopio] Google sign-in redirect URI (add to Supabase → Authentication → Redirect URLs):", redirectUrl);
    }
  } catch (_) {
    // identity permission not yet granted on first install — non-fatal
  }

  global.AcopioSupabase = { getClient, ping, signInWithGoogle, signOut };
})(typeof self !== "undefined" ? self : window);
