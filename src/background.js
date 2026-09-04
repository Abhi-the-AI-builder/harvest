// Service worker: owns IndexedDB writes (see PLAN.md assumption #2),
// registers the context-menu entry point (Section 2.8), routes messages
// from content scripts.
importScripts("db/db.js");
importScripts("../vendor/supabase.js");
importScripts("config.js");
try {
  importScripts("config.local.js");
} catch (_err) {
  // Optional dev overrides — production values come from config.js.
}
importScripts("db/supabase-client.js");
importScripts("db/cloud-oauth.js");

AcopioSupabase.ping()
  .then((result) => {
    if (result.ok) {
      console.info("[Acopio] Supabase reachable", { signedIn: result.signedIn });
    } else {
      console.warn("[Acopio] Supabase ping failed", result.error);
    }
  })
  .catch((err) => console.warn("[Acopio] Supabase ping threw", err));

const CONTEXT_MENU_ID = "acopio-collect-element";
// Declared up here (not down with the rest of the restricted-tab tracking
// below) specifically so updateBadge() can reference it safely on its very
// first call at module load — that call happens before the restricted-tab
// block further down would otherwise have run, and a `const` referenced
// before its own declaration throws, not just reads undefined.
const restrictedTabs = new Set();

// Shared by updateBadge()'s per-tab sync and setTabRestricted's own
// first-stamp — one place that knows what the icon should say for a given
// active/paused state, instead of two copies of the same three calls that
// can drift apart.
//
// No persistent badge text for the paused state anymore (explicit
// feedback: an "OFF" badge sitting on the icon by default, before you've
// ever opened the panel or touched the toggle, read as something wrong
// rather than the ordinary starting state — and Chrome badges are per-tab
// overrides once set, so keeping it in sync as you toggled across tabs was
// its own persistent source of bugs). Paused vs. active is still fully
// explained in the hover title below, just not stamped onto the icon
// unconditionally.
function applyActiveBadgeTo(tabId, active) {
  chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  chrome.action.setTitle({
    tabId,
    title: active
      ? "Acopio — open the collected-items panel"
      : "Acopio — hover-capture is paused. Click to open the panel (resume from there).",
  }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Collect this element with Acopio",
    contexts: ["all"],
  });
  chrome.storage.local.get(["acopioActive"], (res) => {
    if (res.acopioActive === undefined) chrome.storage.local.set({ acopioActive: false });
  });
  updateBadge();
});

// Global on/off switch for hover-capture (toggled from the floating
// toolbar or the side panel). No persistent badge on the toolbar icon for
// this anymore — an "OFF" badge sitting there by default, before the panel
// had even been opened once, read as an error state rather than the
// ordinary starting point (explicit feedback: paused-by-default shouldn't
// look alarming). The click behavior is also fixed to "open the side
// panel" regardless (chrome.sidePanel's openPanelOnActionClick) — it does
// NOT toggle hover-capture itself — so a badge implying otherwise was
// doubly misleading. State is still fully explained via the icon's hover
// title and the context-menu label below, both updated live; the actual
// toggle lives in the panel/floating-toolbar buttons.
function updateBadge() {
  chrome.storage.local.get(["acopioActive"], (res) => {
    const active = res.acopioActive === true;
    // Global default — covers the icon before any tab exists yet (e.g.
    // browser/extension startup) and any brand-new tab that hasn't loaded
    // far enough for setTabRestricted to have stamped its own title yet.
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({
      title: active
        ? "Acopio — open the collected-items panel"
        : "Acopio — hover-capture is paused. Click to open the panel (resume from there).",
    });

    // Same inconsistency, different surface: the right-click menu item gave
    // zero feedback when paused — clicking it silently did nothing (the
    // content-script message just gets dropped by the isBusy/acopioActive
    // gate). Relabeling it when paused means the *reason* nothing happens
    // is visible right there in the menu, not a silent dead end.
    chrome.contextMenus.update(
      CONTEXT_MENU_ID,
      {
        title: active
          ? "Collect this element with Acopio"
          : "Collect this element with Acopio (paused — resume in the panel)",
      },
      () => void chrome.runtime.lastError // menu item may not exist yet on first-ever install race; harmless to ignore
    );

    // Per-tab title/menu sync: setTabRestricted stamps a tab-specific title
    // on every tab as soon as it's confirmed non-restricted (Chrome titles,
    // like badges, are per-tab overrides once set — the tabId-less call
    // above only reaches a tab that hasn't finished loading yet). Pushing
    // the current state to every already-open, non-restricted tab here
    // keeps the hover title accurate everywhere immediately on toggle,
    // not just on that tab's next navigation.
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError) return;
      for (const tab of tabs || []) {
        if (tab.id === undefined || restrictedTabs.has(tab.id)) continue;
        applyActiveBadgeTo(tab.id, active);
      }
    });
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.acopioActive) updateBadge();
});
updateBadge();

// --- CSP/restricted-page disabled state (Section 8) ---------------------
// "Page has a strict CSP or is a restricted URL → extension can't inject
// at all; detect and show a clear disabled state via the toolbar icon
// rather than doing nothing with no explanation." The hard part: a
// content-script injection failure produces no error background.js can
// observe directly — Chrome just silently doesn't run the script. The
// only reliable signal is a *positive* one: does the content script ever
// check in? So content.js sends a READY heartbeat on successful init, and
// this waits a bounded time for it after each navigation; no heartbeat by
// the deadline means injection didn't happen. Known-restricted URL
// schemes (chrome://, the Web Store, etc.) are still detected instantly
// without waiting, since content scripts can never run there regardless.
const RESTRICTED_URL_RE = /^(chrome|chrome-extension|edge|about|devtools|view-source):|^https:\/\/chrome\.google\.com\/webstore/i;
const pendingReadyChecks = new Map(); // tabId -> timeout id
// restrictedTabs itself is declared up top, next to applyActiveBadgeTo —
// needed there before this point in the file ever runs.

function setTabRestricted(tabId, restricted) {
  if (restricted) restrictedTabs.add(tabId);
  else restrictedTabs.delete(tabId);

  if (restricted) {
    chrome.action.setBadgeText({ tabId, text: "—" }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#C33D2E" }).catch(() => {}); // --color-danger
    chrome.action.setTitle({
      tabId,
      title: "Acopio can't run on this page (restricted or blocked by the site's security policy).",
    }).catch(() => {});
  } else {
    // First stamp for this tab — the extension-wide paused/active badge,
    // via the same helper updateBadge() uses to keep every other tab in
    // sync afterward, so there's exactly one place that knows what the
    // icon should say for a given state.
    chrome.storage.local.get(["acopioActive"], (res) => {
      applyActiveBadgeTo(tabId, res.acopioActive === true);
    });
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading" || !tab.url) return;
  const existing = pendingReadyChecks.get(tabId);
  if (existing) clearTimeout(existing);
  pendingReadyChecks.delete(tabId);

  if (RESTRICTED_URL_RE.test(tab.url)) {
    setTabRestricted(tabId, true);
    return;
  }
  if (!/^https?:\/\//.test(tab.url)) {
    // Neither a known-restricted scheme nor http(s) (e.g. a local file://
    // without file-access granted, or ftp:) — content_scripts only match
    // http(s) anyway, so this can never run here either.
    setTabRestricted(tabId, true);
    return;
  }
  setTabRestricted(tabId, false); // optimistic — corrected below if no heartbeat arrives
  const timeoutId = setTimeout(() => {
    pendingReadyChecks.delete(tabId);
    setTabRestricted(tabId, true); // no READY heartbeat arrived in time — injection likely blocked
  }, 2500);
  pendingReadyChecks.set(tabId, timeoutId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const existing = pendingReadyChecks.get(tabId);
  if (existing) clearTimeout(existing);
  pendingReadyChecks.delete(tabId);
  restrictedTabs.delete(tabId);
});

// Clicking the toolbar icon opens the side panel directly (no popup) —
// this is the one-click "where do I find what I collected" entry point.
// Chrome's own built-in open-on-click behavior handles this; no custom
// chrome.action.onClicked handler needed. (An earlier version of this file
// disabled this and wrote a custom handler with its own retry/re-enable
// logic, reasoning that this built-in path bypassed a fix for a different
// bug below — that reasoning doesn't apply once the panel is never
// disabled in the first place. See collapseBtn in sidepanel.js.)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) =>
  console.error("[Acopio] failed to set side panel behavior", err)
);

// Dismissing the floating on-page toolbar used to be a side effect the
// CALLER had to remember (toolbar.js's own panel button did it, right
// before sending OPEN_SIDE_PANEL) — nothing did it for Chrome's own
// built-in open-on-icon-click path, so opening the panel that way while the
// floating pill was already showing on the page left both visible at once
// side by side. sidePanel.onOpened doesn't exist, so this can't run
// centrally in response to every open the way it'd ideally like to —
// OPEN_SIDE_PANEL below (the only other open path) still does it directly.

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "OPEN_TOOLTIP_AT_CONTEXT_TARGET" });
});

// --- Service-worker-safe second sanitization pass (Section 9 layer 2) ---
// No DOM/DOMParser is available in a service worker, so this is a
// string-level defense-in-depth check, not a full re-parse. It exists to
// catch a buggy or bypassed content-script sanitizer, not to replace it —
// the content script's DOM-based sanitize.js (which runs first, and has
// real DOM access) is the primary line of defense.
const DANGEROUS_TAG_RE = /<\/?\s*(script|iframe|object|embed)\b/gi;
const EVENT_HANDLER_ATTR_RE = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URI_RE = /(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi;

function reSanitizeHtml(html) {
  if (typeof html !== "string") return { html: "", flagged: false };
  let flagged = false;
  let out = html;
  if (DANGEROUS_TAG_RE.test(out)) flagged = true;
  out = out.replace(DANGEROUS_TAG_RE, "<removed");
  if (EVENT_HANDLER_ATTR_RE.test(out)) flagged = true;
  out = out.replace(EVENT_HANDLER_ATTR_RE, "");
  if (JS_URI_RE.test(out)) flagged = true;
  out = out.replace(JS_URI_RE, "$1=$2#$2");
  return { html: out, flagged };
}

// --- CAPTURE_VISIBLE_TAB: serialized + retried, not fire-and-hope -------
// Chrome hard-throttles captureVisibleTab to ~2 calls/sec PER WINDOW,
// enforced by Chrome itself independently of anything this extension
// does — confirmed live, from a real user's own console during ordinary
// hover browsing: "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_
// CALLS_PER_SECOND quota." Moving across even a handful of elements in
// under a second easily bursts past 2 calls (the passive hover-preview
// capture fires on every settled hover). Every call site previously just
// fired one request and gave up completely on any error, silently —
// this is the actual, confirmed root cause of a real reported bug:
// copying a component from the tooltip and pasting it elsewhere produced
// plain text instead of an image, because the screenshot this depends on
// (both the passive hover-preview capture AND the last-resort capture at
// copy-click time) had already failed to Chrome's own rate limit with no
// retry, leaving nothing to attach as the image half of the clipboard
// write. A single global FIFO queue with a minimum spacing between
// dispatches — not just a per-call retry, which can still collide with a
// DIFFERENT concurrent request from another hover or tab — is what
// actually keeps every request under Chrome's limit instead of hoping to
// slip through it, and retries specifically on the rate-limit error
// (never on a different, real failure) before giving up.
let captureQueueTail = Promise.resolve();
let lastCaptureDispatchAt = 0;
const CAPTURE_MIN_INTERVAL_MS = 550; // just over Chrome's own ~2/sec quota window
const CAPTURE_MAX_ATTEMPTS = 5;

// Retrying and spacing out requests (above) fixes collisions between
// requests that all still need to happen. It does NOT fix a real,
// confirmed second-order problem: ordinary exploratory hovering fires one
// PASSIVE preview capture per settled hover (captureElementPreview,
// overlay.js), and every one of those queues up and consumes a real
// dispatch slot even after the user has already moved on to a different
// element — a queue backed up with 6-7 stale, nobody-cares-anymore
// requests can easily push the one request that DOES matter (the
// passive capture for whatever's hovered RIGHT NOW, or the last-resort
// capture fired by an explicit Copy click) past its own 4s caller-side
// timeout, watching it give up before ever reaching the front of the
// queue. Confirmed live: a real 1248×481 refold.ai component, copied
// after a normal few seconds of hovering around the page first, still
// pasted as plain text with no image — this is why. Only PASSIVE preview
// requests are cancellable this way; a request from an explicit Copy
// click always runs for real, since the user is actively waiting on it.
// Tracked per-tab (not globally) — hovering in one tab must never cancel
// a pending request from a different one.
const latestPreviewTokenByTab = new Map();
let previewTokenCounter = 0;
function nextPreviewToken(tabId) {
  previewTokenCounter += 1;
  latestPreviewTokenByTab.set(tabId, previewTokenCounter);
  return previewTokenCounter;
}

function queueCaptureVisibleTab(windowId, tabId, previewToken) {
  const run = async () => {
    // Still queued (never reached the front) by the time its turn comes
    // up, and a NEWER passive preview request has since superseded it —
    // skip the real, rate-limited API call entirely rather than spend a
    // dispatch slot on a result nobody will use. `undefined` (not an
    // error) — this is an intentional skip, not a failure.
    if (previewToken !== undefined && latestPreviewTokenByTab.get(tabId) !== previewToken) {
      return undefined;
    }
    const wait = Math.max(0, lastCaptureDispatchAt + CAPTURE_MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    for (let attempt = 1; attempt <= CAPTURE_MAX_ATTEMPTS; attempt++) {
      lastCaptureDispatchAt = Date.now();
      try {
        return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      } catch (err) {
        const errMessage = String((err && err.message) || err);
        const isRateLimited = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(errMessage);
        if (!isRateLimited || attempt === CAPTURE_MAX_ATTEMPTS) throw err;
        await new Promise((resolve) => setTimeout(resolve, CAPTURE_MIN_INTERVAL_MS));
      }
    }
  };
  // Chained onto the shared queue regardless of the previous entry's own
  // outcome — one failed capture must never permanently jam every capture
  // queued after it.
  const result = captureQueueTail.then(run, run);
  captureQueueTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return undefined;

  if (message.type === "GET_SUPABASE_STATUS") {
    AcopioSupabase.ping()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  // "Login via Google" gate for the export destination picker, plus the
  // two per-destination account connections. Handlers are thin — all the
  // actual OAuth/token logic lives in supabase-client.js (Google) and
  // cloud-oauth.js (Figma/Notion), same split as everywhere else in this
  // file (background.js routes messages, doesn't contain business logic).
  if (message.type === "SIGN_IN_WITH_GOOGLE") {
    AcopioSupabase.signInWithGoogle()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  if (message.type === "SIGN_OUT_GOOGLE") {
    AcopioSupabase.signOut()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  if (message.type === "CONNECT_FIGMA") {
    AcopioCloudOAuth.connectFigma()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  if (message.type === "GET_FIGMA_STATUS") {
    AcopioCloudOAuth.figmaStatus().then((result) => sendResponse(result));
    return true;
  }
  if (message.type === "DISCONNECT_FIGMA") {
    AcopioCloudOAuth.disconnectFigma().then((result) => sendResponse(result));
    return true;
  }
  if (message.type === "CONNECT_NOTION") {
    AcopioCloudOAuth.connectNotion()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  if (message.type === "GET_NOTION_STATUS") {
    AcopioCloudOAuth.notionStatus().then((result) => sendResponse(result));
    return true;
  }
  if (message.type === "DISCONNECT_NOTION") {
    AcopioCloudOAuth.disconnectNotion().then((result) => sendResponse(result));
    return true;
  }
  if (message.type === "NOTION_SEARCH_PAGES") {
    AcopioCloudOAuth.notionSearchPages()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  if (message.type === "NOTION_CREATE_PAGE") {
    AcopioCloudOAuth.notionCreatePage(message.payload.parentPageId, message.payload.title, message.payload.blocks)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  if (message.type === "NOTION_UPLOAD_FILE") {
    const { base64, dataUrl, filename, mime } = message.payload || {};
    (async () => {
      try {
        let blob;
        if (dataUrl && String(dataUrl).startsWith("data:")) {
          const comma = String(dataUrl).indexOf(",");
          const b64 = comma >= 0 ? String(dataUrl).slice(comma + 1) : "";
          if (!b64) {
            sendResponse({ ok: false, error: "Image data URL was empty." });
            return;
          }
          const mimeMatch = /^data:([^;,]+)/.exec(String(dataUrl));
          const dataMime = mimeMatch ? mimeMatch[1] : mime || "image/png";
          const bin = atob(b64.replace(/\s/g, ""));
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          blob = new Blob([bytes], { type: dataMime });
        } else {
          const bin = atob(base64 || "");
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          blob = new Blob([bytes], { type: mime || "image/png" });
        }
        if (!blob || !blob.size) {
          sendResponse({ ok: false, error: "Image data was empty." });
          return;
        }
        // Notion and clipboard consumers expect PNG — re-encode JPEG/WebP data URLs.
        if (blob.type && blob.type !== "image/png") {
          try {
            const bitmap = await createImageBitmap(blob);
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            canvas.getContext("2d").drawImage(bitmap, 0, 0);
            bitmap.close();
            const pngBlob = await canvas.convertToBlob({ type: "image/png" });
            if (pngBlob && pngBlob.size) blob = pngBlob;
          } catch (_) {
            // keep original blob if conversion fails
          }
        }
        const result = await AcopioCloudOAuth.notionUploadFileBlob(blob, filename);
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  if (message.type === "CONTENT_SCRIPT_READY") {
    const tabId = sender.tab && sender.tab.id;
    if (tabId !== undefined) {
      const pending = pendingReadyChecks.get(tabId);
      if (pending) clearTimeout(pending);
      pendingReadyChecks.delete(tabId);
      setTabRestricted(tabId, false);
    }
    return undefined;
  }

  if (message.type === "OPEN_SIDE_PANEL") {
    // sidePanel.open() is only callable from background/extension-page
    // contexts, not content scripts — this is the whole reason the
    // floating toolbar's panel button has to go through a message instead
    // of calling the API directly. It also needs to run while Chrome still
    // considers this a user-gesture-triggered call; sender.tab is the tab
    // the click happened in, which is what carries that gesture context —
    // must be the first thing touched here, before any other await, or the
    // one-shot gesture is spent on something else first. Mirrors the
    // sibling Design System Extractor project's own PRISM_REOPEN_PANEL
    // handler — no enable/retry dance, because nothing here ever disables
    // the panel (see collapseBtn in sidepanel.js: it closes via
    // window.close(), not by disabling itself for this tab).
    //
    // sidePanel.open() can genuinely fail even when called correctly —
    // it's a known-flaky Chrome API (crbug 355266358/415694848) — so this
    // reports the real outcome back instead of assuming success.
    if (!sender.tab || sender.tab.windowId === undefined) {
      sendResponse({ ok: false, error: "No active tab to open the panel in." });
      return undefined;
    }
    chrome.sidePanel
      .open({ windowId: sender.tab.windowId })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[Acopio] failed to open side panel", err);
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      });
    return true; // async sendResponse — keep the message channel open
  }

  if (message.type === "FETCH_IMAGE_BYTES") {
    const url = message.payload && message.payload.url;
    if (!url) {
      sendResponse({ ok: false, error: "No URL provided." });
      return undefined;
    }
    fetch(url)
      .then(async (resp) => {
        if (!resp.ok) {
          sendResponse({ ok: false, error: `HTTP ${resp.status}` });
          return;
        }
        const buf = await resp.arrayBuffer();
        sendResponse({
          ok: true,
          bytes: Array.from(new Uint8Array(buf)),
          contentType: resp.headers.get("content-type") || "",
        });
      })
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (message.type === "CAPTURE_VISIBLE_TAB") {
    // Full-viewport screenshot for a component's real preview (overlay.js
    // crops this down to just the hovered/collected element). Needs
    // host_permissions (manifest.json) rather than relying on activeTab —
    // activeTab only grants access from a qualifying user gesture (the
    // extension icon, a keyboard command, a context-menu item), and the
    // trigger here is a hover settling or a click on a button inside the
    // tooltip's own injected UI, neither of which counts as one of those.
    if (!sender.tab || sender.tab.windowId === undefined || sender.tab.id === undefined) {
      sendResponse({ ok: false, error: "No tab to capture." });
      return undefined;
    }
    // Only a passive hover-preview capture is cancellable — see
    // queueCaptureVisibleTab above. An explicit Copy click (or anything
    // else that isn't "preview") always gets a real dispatch; the user is
    // actively waiting on that one.
    const previewToken = message.purpose === "preview" ? nextPreviewToken(sender.tab.id) : undefined;
    queueCaptureVisibleTab(sender.tab.windowId, sender.tab.id, previewToken)
      .then((dataUrl) => {
        if (dataUrl === undefined) {
          sendResponse({ ok: false, error: "superseded by a newer hover — not captured" });
        } else {
          sendResponse({ ok: true, dataUrl });
        }
      })
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (message.type === "CHECK_DUPLICATE") {
    // Content scripts can't touch IndexedDB directly (PLAN.md assumption
    // #2) — this is the one other capture-time DB read they need, so it
    // goes through background like everything else.
    AcopioDB.findSimilarItem(message.payload.hostname, message.payload.type, message.payload.data, message.payload.selector)
      .then((similar) => sendResponse({ ok: true, similar }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (message.type === "GET_RECENT_ITEMS") {
    // Powers the tooltip's "already collected N things here" stack on a
    // return visit (Section 8) — without this, sessionCaptures only ever
    // grows from captures made during the CURRENT page load, so revisiting
    // a site you already have a folder for still showed the plain
    // first-time "+ Collect" button as if nothing had ever been saved here.
    AcopioDB.getItemsByHostname(message.payload.hostname)
      .then((items) => {
        // The hover-capture tooltip (this stack) and the text-selection
        // notes flow are two fully separate systems — a note must never
        // count toward, or appear inside, this "already collected N things
        // here" preview, the same exclusion sidepanel.js already applies
        // everywhere else a site's item count is shown. Without this, a
        // site with 3 real hover-captures and 2 notes showed "5" here and
        // could render a note as a generic component icon in the stack —
        // both a wrong count and a mislabeled thumbnail.
        const nonNoteItems = items.filter((item) => item.type !== "note");
        const recent = nonNoteItems
          .slice()
          .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))
          .slice(0, message.payload.limit || 4);
        // The tooltip's stack preview only ever has room for a handful of
        // thumbnails, but it still needs the REAL total for this site to
        // show an honest "+N more" overflow badge instead of silently
        // capping at 4 with no indication anything was left out.
        sendResponse({ ok: true, items: recent, total: nonNoteItems.length });
      })
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (message.type === "GET_COLLECTION_RECENT_ITEMS") {
    // Same stack preview as GET_RECENT_ITEMS, but for a user Collection —
    // used when the hover tooltip's folder picker targets a Collection
    // instead of "this site."
    const collectionId = message.payload && message.payload.collectionId;
    const limit = (message.payload && message.payload.limit) || 4;
    if (!collectionId) {
      sendResponse({ ok: false, error: "No collection id." });
      return true;
    }
    AcopioDB.getCollection(collectionId)
      .then(async (col) => {
        if (!col) {
          sendResponse({ ok: false, error: "Collection not found." });
          return;
        }
        const items = await AcopioDB.resolveCollectionItems(col);
        const nonNoteItems = items.filter((item) => item.type !== "note");
        const recent = nonNoteItems
          .slice()
          .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))
          .slice(0, limit);
        sendResponse({ ok: true, items: recent, total: nonNoteItems.length, name: col.name });
      })
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (message.type === "UPDATE_NOTE") {
    AcopioDB.updateItemNote(message.payload.id, message.payload.note)
      .then((item) => {
        if (item) {
          chrome.runtime.sendMessage({ type: "ITEMS_UPDATED", hostname: item.hostname }).catch(() => {});
        }
      })
      .catch((err) => console.error("[Acopio] failed to save note", err));
    return undefined; // fire-and-forget, no response expected
  }

  if (message.type === "GET_COLLECTIONS") {
    // Populates the "Save to" picker in the text-selection notes tooltip
    // (src/content/notes.js) — content scripts can't reach AcopioDB
    // directly (db/db.js isn't a content script), so this is the same
    // message-relay pattern every other content-script → storage read in
    // this file already uses. id + name is all the picker needs.
    AcopioDB.getAllCollections()
      .then((collections) => {
        sendResponse({ ok: true, collections: collections.map((c) => ({ id: c.id, name: c.name })) });
      })
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  // Chrome's on-device favicon cache via the "favicon" permission's
  // `_favicon` endpoint — resolved here (extension context) to a data URL
  // so content-script UI can set img.src without host-page CSP blocking
  // chrome-extension:// image loads.
  async function faviconBlobToDataUrl(blob) {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
  }

  async function faviconDataUrlForHostname(hostname) {
    if (!hostname) return null;
    try {
      const url = new URL(chrome.runtime.getURL("/_favicon/"));
      url.searchParams.set("pageUrl", `https://${hostname}`);
      url.searchParams.set("size", "32");
      const resp = await fetch(url.toString());
      if (!resp.ok) return null;
      const blob = await resp.blob();
      if (!blob || blob.size === 0) return null;
      return await faviconBlobToDataUrl(blob);
    } catch (_) {
      return null;
    }
  }

  if (message.type === "GET_SITE_FOLDERS") {
    // Library Sites cards (per-hostname folders) for the hover tooltip's
    // destination menu — so every site folder the panel shows is also
    // selectable when collecting. Enrich each row with a CSP-safe favicon
    // data URL from Chrome's local cache.
    AcopioDB.listSiteFolders()
      .then(async (folders) => {
        const enriched = await Promise.all(
          (folders || []).map(async (f) => {
            const faviconDataUrl = await faviconDataUrlForHostname(f.hostname);
            return faviconDataUrl ? { ...f, faviconDataUrl } : f;
          })
        );
        sendResponse({ ok: true, folders: enriched });
      })
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (message.type === "GET_SITE_FAVICON") {
    const hostname = (message.payload && message.payload.hostname) || message.hostname;
    faviconDataUrlForHostname(hostname)
      .then((faviconDataUrl) => sendResponse({ ok: true, faviconDataUrl: faviconDataUrl || null }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (message.type === "ADD_ITEMS_TO_COLLECTION") {
    // Lets a note be filed straight into a Collection at capture time
    // (notes.js's folder picker) — thin relay onto the existing
    // itemRefs-only linking method (GROUND_RULES.md: a Collection never
    // copies item data, only references it).
    AcopioDB.addItemsToCollection(message.payload.collectionId, message.payload.itemRefs)
      .then(() => {
        sendResponse({ ok: true });
        // Open side panel should refresh Collections so newly linked items
        // appear in the folder card without a manual reload.
        chrome.runtime.sendMessage({ type: "ITEMS_UPDATED" }).catch(() => {});
      })
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (message.type === "CREATE_COLLECTION") {
    // The notes tooltip's inline "+ New folder" — sidepanel.js already
    // calls AcopioDB.createCollection directly (it's an extension page,
    // full privileges); content scripts need this same relay every other
    // storage write here already goes through.
    AcopioDB.createCollection(message.payload.name)
      .then((collection) => {
        sendResponse({ ok: true, collection: { id: collection.id, name: collection.name } });
        chrome.runtime.sendMessage({ type: "ITEMS_UPDATED" }).catch(() => {});
      })
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  if (message.type === "UPDATE_ITEM_DIMENSIONS") {
    AcopioDB.updateItemDimensions(message.payload.id, message.payload.width, message.payload.height)
      .then((item) => {
        if (item) {
          chrome.runtime.sendMessage({ type: "ITEMS_UPDATED", hostname: item.hostname }).catch(() => {});
        }
      })
      .catch(() => {}); // best-effort correction — a failure here just leaves the original (still-correct-URL) dimensions in place
    return undefined; // fire-and-forget, no response expected
  }

  if (message.type !== "CAPTURE_ITEM") return undefined;

  async function blobToDataUrl(blob) {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
  }

  async function inlineImageAtSave(item) {
    const data = item.data || {};
    if (item.type !== "image" || data.inlineDataUrl) return;
    if (data.isVideo || !data.url || String(data.url).startsWith("blob:")) return;
    function upgradePinUrl(url) {
      const pinMatch = String(url).match(/^(https?:\/\/i\.pinimg\.com\/)\d+x\d*(\/.*)$/);
      return pinMatch ? pinMatch[1] + "originals" + pinMatch[2] : url;
    }
    function pinFallbackUrl(url) {
      const match = String(url).match(/^(https?:\/\/i\.pinimg\.com\/)originals(\/.*)$/);
      return match ? match[1] + "736x" + match[2] : null;
    }
    const upgraded = upgradePinUrl(data.url);
    const tryUrls = [upgraded];
    const fb = pinFallbackUrl(upgraded);
    if (fb) tryUrls.push(fb);
    if (!tryUrls.includes(data.url)) tryUrls.push(data.url);
    for (const tryUrl of tryUrls) {
      try {
        const resp = await fetch(tryUrl);
        if (!resp.ok) continue;
        data.inlineDataUrl = await blobToDataUrl(await resp.blob());
        return;
      } catch (_) {
        // try next candidate
      }
    }
  }

  (async () => {
    try {
      const item = message.payload;

      await inlineImageAtSave(item);

      if (item.type === "component" && item.data && item.data.outerHTML) {
        const { html, flagged } = reSanitizeHtml(item.data.outerHTML);
        item.data.outerHTML = html;
        if (flagged) {
          console.warn(
            "[Acopio] background re-sanitizer had to strip content the " +
              "content script should already have removed — capture-time " +
              "sanitize.js may have a gap. Item saved with the cleaned HTML."
          );
        }
      }

      await AcopioDB.addItem(item);
      const count = await AcopioDB.countByHostname(item.hostname);
      sendResponse({ ok: true, count });

      // Best-effort broadcast so an already-open side panel updates live.
      // If nothing is listening (panel closed), sendMessage just rejects
      // quietly — that's expected, not an error worth surfacing.
      chrome.runtime.sendMessage({ type: "ITEMS_UPDATED", hostname: item.hostname }).catch(() => {});
    } catch (err) {
      console.error("[Acopio] failed to save item", err);
      sendResponse({ ok: false, error: String(err && err.message || err) });
    }
  })();

  return true; // keep the message channel open for the async response
});
