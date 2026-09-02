// OAuth connections to Figma and Notion, used by the side panel's "Export
// to Figma" / "Export to Notion" destinations (sidepanel.js's export menu).
// Lives in the service worker (background.js importScripts's this) because
// chrome.identity.launchWebAuthFlow and the token-bearing fetches both need
// a background/extension-page context, same reason OPEN_SIDE_PANEL has to
// be a message instead of a direct call from a content script.
//
// Two different trust models, because the two APIs are shaped differently:
//   - Figma's OAuth app is a genuine PUBLIC client — it supports PKCE, so
//     the whole exchange (including the code_verifier) can happen safely
//     right here in the extension. No secret ever exists.
//   - Notion's OAuth app is a CONFIDENTIAL client — its token exchange is
//     Basic-Auth'd with client_id:client_secret. A secret shipped inside an
//     extension bundle is extractable by anyone who unpacks it, so that
//     exchange is proxied through a small Supabase Edge Function
//     (supabase/functions/notion-oauth-exchange) instead — the secret lives
//     in that function's server-side env, never in this file. Reuses the
//     Supabase project already wired up in supabase-client.js rather than
//     standing up a second backend.
//
// IMPORTANT — what "Export to Figma" can and can't actually do: Figma's
// public REST API has no endpoint to create design nodes (frames,
// rectangles, text layers) in a file — that capability only exists inside
// the Figma app itself, via the Plugin API. This OAuth connection verifies
// the user's Figma account and is what a future "pick a target file"
// picker would use, but pushing captured items in as real layers still
// goes through the existing companion plugin (harvest-figma-plugin) and
// its JSON import — same as before this feature existed. Don't build a
// "direct push to Figma" promise on top of this without re-checking that
// constraint; it hasn't changed.
(function (global) {
  const FIGMA_AUTHORIZE_URL = "https://www.figma.com/oauth";
  const FIGMA_TOKEN_URL = "https://api.figma.com/v1/oauth/token";
  const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
  // Server-side proxy for the one step that needs a confidential secret —
  // see the file header. Deploy target for supabase/functions/notion-oauth-exchange.
  const NOTION_EXCHANGE_FUNCTION_URL = () => {
    const base = global.HARVEST_SUPABASE_URL;
    return base ? `${base}/functions/v1/notion-oauth-exchange` : null;
  };

  function randomString(len) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
  }

  async function sha256Base64Url(input) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", data);
    let str = "";
    new Uint8Array(digest).forEach((b) => { str += String.fromCharCode(b); });
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function getExtensionRedirectUrl() {
    try {
      return chrome.identity.getRedirectURL();
    } catch (_err) {
      return null;
    }
  }

  function launchWebAuthFlow(url) {
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || "Sign-in was closed before finishing."));
          return;
        }
        resolve(redirectUrl);
      });
    });
  }

  // Chrome reports a generic message when the OAuth window can't finish —
  // usually a redirect URI not registered in the Figma app dashboard.
  function formatFigmaAuthError(rawMessage, redirectUrl, clientId) {
    const msg = String(rawMessage || "");
    if (/Authorization page could not be loaded/i.test(msg)) {
      const parts = [
        "Figma sign-in couldn't open — this is almost always a redirect URI mismatch.",
      ];
      if (redirectUrl) {
        parts.push(
          `In Figma → My Apps → your app → OAuth settings → Redirect URIs, add exactly: ${redirectUrl}`
        );
      } else {
        parts.push(
          "In Figma → My Apps → your app → OAuth settings → Redirect URIs, add your extension redirect URI (see LAUNCH-PATH-B.md §1.2)."
        );
      }
      if (!clientId) {
        parts.push("Set HARVEST_FIGMA_CLIENT_ID in src/config.js (from your Figma app's Client ID).");
      }
      parts.push("Reload the extension after saving, then try again.");
      parts.push(
        "Tip: Export to Figma and Copy for Figma plugin work without OAuth — use the Harvest Figma plugin to import the JSON."
      );
      return parts.join(" ");
    }
    if (/Sign-in was closed|user did not approve/i.test(msg)) {
      return "Figma sign-in was cancelled. Try again when you're ready.";
    }
    if (/redirect_uri/i.test(msg)) {
      return redirectUrl
        ? `Figma redirect URI mismatch. In your Figma app settings, add exactly: ${redirectUrl}`
        : "Figma redirect URI mismatch — see LAUNCH-PATH-B.md §Figma OAuth.";
    }
    return msg;
  }

  function storeToken(key, value) {
    return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
  }
  function readToken(key) {
    return new Promise((resolve) => chrome.storage.local.get([key], (r) => resolve(r[key] || null)));
  }
  function clearToken(key) {
    return new Promise((resolve) => chrome.storage.local.remove(key, resolve));
  }

  // --- Figma (PKCE, no secret) -----------------------------------------
  async function connectFigma() {
    const clientId = global.HARVEST_FIGMA_CLIENT_ID;
    const redirectUri = getExtensionRedirectUrl();
    if (!clientId) {
      return {
        ok: false,
        error:
          "Figma OAuth isn't configured — add HARVEST_FIGMA_CLIENT_ID to src/config.js (see LAUNCH-PATH-B.md). Export to Figma works without OAuth via the Harvest Figma plugin.",
      };
    }
    if (!redirectUri) {
      return { ok: false, error: "Chrome identity permission is missing — reload the extension from chrome://extensions." };
    }
    const state = randomString(16);
    const verifier = randomString(64);
    const challenge = await sha256Base64Url(verifier);
    const authUrl = `${FIGMA_AUTHORIZE_URL}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=file_read&state=${state}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`;
    try {
      const redirected = await launchWebAuthFlow(authUrl);
      const u = new URL(redirected);
      if (u.searchParams.get("state") !== state) return { ok: false, error: "Sign-in state mismatch — try again." };
      const code = u.searchParams.get("code");
      if (!code) {
        const oauthErr = u.searchParams.get("error_description") || u.searchParams.get("error");
        return {
          ok: false,
          error: formatFigmaAuthError(oauthErr || "Figma didn't return an authorization code.", redirectUri, clientId),
        };
      }
      const tokenResp = await fetch(FIGMA_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          code,
          grant_type: "authorization_code",
          code_verifier: verifier,
        }),
      });
      const json = await tokenResp.json();
      if (!tokenResp.ok || !json.access_token) {
        return {
          ok: false,
          error: formatFigmaAuthError(json.message || json.error_description || "Figma token exchange failed.", redirectUri, clientId),
        };
      }
      await storeToken("harvestFigmaToken", { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + (json.expires_in || 0) * 1000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: formatFigmaAuthError((err && err.message) || err, redirectUri, clientId) };
    }
  }
  async function figmaStatus() {
    const token = await readToken("harvestFigmaToken");
    return { connected: !!token };
  }
  function disconnectFigma() {
    return clearToken("harvestFigmaToken").then(() => ({ ok: true }));
  }

  // --- Notion (confidential client, exchange proxied via Edge Function) -
  async function connectNotion() {
    const clientId = global.HARVEST_NOTION_CLIENT_ID;
    if (!clientId) return { ok: false, error: "Notion isn't configured yet — add HARVEST_NOTION_CLIENT_ID to src/config.js." };
    const functionUrl = NOTION_EXCHANGE_FUNCTION_URL();
    if (!functionUrl) return { ok: false, error: "Supabase isn't configured — Notion's token exchange needs it (see src/config.local.js)." };
    const redirectUri = chrome.identity.getRedirectURL();
    const state = randomString(16);
    const authUrl = `${NOTION_AUTHORIZE_URL}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&owner=user&state=${state}`;
    try {
      const redirected = await launchWebAuthFlow(authUrl);
      const u = new URL(redirected);
      if (u.searchParams.get("state") !== state) return { ok: false, error: "Sign-in state mismatch — try again." };
      const code = u.searchParams.get("code");
      if (!code) return { ok: false, error: u.searchParams.get("error_description") || "Notion didn't return an authorization code." };
      // The confidential exchange itself happens server-side — this call
      // only ever carries the one-time authorization code, never a secret.
      const resp = await fetch(functionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": global.HARVEST_SUPABASE_ANON_KEY || "" },
        body: JSON.stringify({ code, redirect_uri: redirectUri }),
      });
      const json = await resp.json();
      if (!resp.ok || !json.access_token) return { ok: false, error: json.error || "Notion token exchange failed." };
      await storeToken("harvestNotionToken", { accessToken: json.access_token, workspaceName: json.workspace_name || "", workspaceIcon: json.workspace_icon || "" });
      return { ok: true, workspaceName: json.workspace_name || "" };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }
  async function notionStatus() {
    const token = await readToken("harvestNotionToken");
    return { connected: !!token, workspaceName: token ? token.workspaceName : "" };
  }
  function disconnectNotion() {
    return clearToken("harvestNotionToken").then(() => ({ ok: true }));
  }

  // Real, working push — Notion's REST API (unlike Figma's) genuinely
  // supports creating pages/blocks, so this isn't a stand-in for anything.
  async function notionSearchPages() {
    const token = await readToken("harvestNotionToken");
    if (!token) return { ok: false, error: "Not connected to Notion." };
    const resp = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filter: { property: "object", value: "page" }, page_size: 20 }),
    });
    const json = await resp.json();
    if (!resp.ok) return { ok: false, error: json.message || "Couldn't list Notion pages." };
    const pages = (json.results || []).map((p) => ({
      id: p.id,
      title:
        (p.properties && p.properties.title && p.properties.title.title && p.properties.title.title.map((t) => t.plain_text).join("")) ||
        (p.properties && Object.values(p.properties).find((prop) => prop.type === "title") &&
          Object.values(p.properties).find((prop) => prop.type === "title").title.map((t) => t.plain_text).join("")) ||
        "Untitled",
    }));
    return { ok: true, pages };
  }

  // Notion's file-upload API needs a newer API version than page/block
  // creation used to — component screenshots are data: URLs locally, so this
  // is how they become real image blocks in an exported page.
  const NOTION_API_VERSION = "2025-09-03";

  async function notionWaitForFileUpload(fileUploadId, maxAttempts = 30) {
    const token = await readToken("harvestNotionToken");
    if (!token) return { ok: false, error: "Not connected to Notion." };
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const resp = await fetch(`https://api.notion.com/v1/file_uploads/${fileUploadId}`, {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Notion-Version": NOTION_API_VERSION,
        },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) return { ok: false, error: json.message || "Couldn't verify Notion file upload." };
      if (json.status === "uploaded") return { ok: true };
      if (json.status === "failed") return { ok: false, error: "Notion rejected the image upload." };
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return { ok: false, error: "Timed out waiting for Notion to finish processing the image." };
  }

  async function notionUploadFileBlob(blob, filename) {
    const token = await readToken("harvestNotionToken");
    if (!token) return { ok: false, error: "Not connected to Notion." };
    const safeName = String(filename || "capture.png").slice(0, 200);
    const createResp = await fetch("https://api.notion.com/v1/file_uploads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: safeName,
        content_type: blob.type || "image/png",
      }),
    });
    const createJson = await createResp.json();
    if (!createResp.ok) return { ok: false, error: createJson.message || "Couldn't start Notion file upload." };
    const form = new FormData();
    form.append("file", blob, safeName);
    const sendResp = await fetch(`https://api.notion.com/v1/file_uploads/${createJson.id}/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Notion-Version": NOTION_API_VERSION,
      },
      body: form,
    });
    if (!sendResp.ok) {
      const sendJson = await sendResp.json().catch(() => ({}));
      return { ok: false, error: sendJson.message || "Couldn't send file to Notion." };
    }
    const ready = await notionWaitForFileUpload(createJson.id);
    if (!ready.ok) return ready;
    return { ok: true, fileUploadId: createJson.id };
  }

  async function notionCreatePage(parentPageId, title, blocks) {
    const token = await readToken("harvestNotionToken");
    if (!token) return { ok: false, error: "Not connected to Notion." };
    // Notion caps children at 100 blocks per create call — chunk the rest
    // into follow-up appends rather than silently dropping overflow.
    const firstBatch = blocks.slice(0, 100);
    const resp = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { page_id: parentPageId },
        properties: { title: { title: [{ text: { content: title } }] } },
        children: firstBatch,
      }),
    });
    const json = await resp.json();
    if (!resp.ok) return { ok: false, error: json.message || "Couldn't create the Notion page." };
    for (let i = 100; i < blocks.length; i += 100) {
      const chunk = blocks.slice(i, i + 100);
      await fetch(`https://api.notion.com/v1/blocks/${json.id}/children`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Notion-Version": NOTION_API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ children: chunk }),
      }).catch(() => {});
    }
    return { ok: true, url: json.url };
  }

  // Printed unconditionally (not just once a client ID exists) — this is
  // the exact value that has to be registered as the redirect URI in both
  // the Figma app and Notion integration's dashboards, and it's specific
  // to this unpacked extension's ID, so there's no way to know it ahead of
  // time without asking Chrome for it.
  try {
    console.info("[Harvest] OAuth redirect URI for Figma/Notion app setup:", chrome.identity.getRedirectURL());
  } catch (_) {
    // identity permission not yet granted (fresh install before first reload) — non-fatal
  }

  global.HarvestCloudOAuth = {
    connectFigma,
    figmaStatus,
    disconnectFigma,
    connectNotion,
    notionStatus,
    disconnectNotion,
    notionSearchPages,
    notionCreatePage,
    notionUploadFileBlob,
  };
})(typeof self !== "undefined" ? self : window);
