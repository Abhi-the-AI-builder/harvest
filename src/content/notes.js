// Text-selection notes capture — a second, independent capture mode from
// the hover tooltip (overlay.js). Highlighting text on the page (instead
// of hovering an element) shows a small tooltip offering to collect that
// text — plus any images/links the selection happens to cross — as a
// "note" item, optionally filed straight into a chosen Collection.
//
// Deliberately isolated from overlay.js: own shadow-DOM host, own local
// state, own listeners, own storage key (acopioNotesActive, independent
// of acopioActive). Nothing in overlay.js's render/generation/concurrency
// logic is touched or depended on — this file could be deleted entirely
// and the hover tooltip would be completely unaffected.
(function () {
  const Acopio = window.Acopio;
  const ACCENT = "#1D3461";
  const INTER_URL = chrome.runtime.getURL("fonts/Inter-var.woff2");

  // Same token *values* as overlay.js/toolbar.js/sidepanel.css — see
  // design-tokens.md. Duplicated, not imported/shared, because each is an
  // isolated Shadow DOM (this is the exact same tradeoff toolbar.js's own
  // SHEET already documents), but must stay numerically identical so this
  // reads as the same product, not a bolted-on second UI.
  const SHEET = `
    :host {
      all: initial;
      --color-bg: #FAFAFA;
      --color-surface: #FFFFFF;
      --color-text: #17181A;
      --color-text-muted: #6B6E76;
      --color-accent: ${ACCENT};
      --color-accent-wash: rgba(29,52,97,0.10);
      --color-danger: #C33D2E;
      --color-border: rgba(23,24,26,0.09);
      --color-border-strong: rgba(23,24,26,0.18);
      --color-warning-bg: #FFF4E5;
      --color-warning-text: #8A5A10;
      --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px;
      --text-caption: 12px; --text-body: 14px; --text-subheading: 16px;
      --radius-xs: 4px; --radius-sm: 8px; --radius-full: 999px;
      --type-note-bg: #E3EEFB; --type-note-fg: #2A6CA8;
      --shadow-raised: 0 2px 6px rgba(23,24,26,0.08), 0 8px 20px rgba(23,24,26,0.10);
      --shadow-overlay: 0 8px 24px rgba(23,24,26,0.14), 0 24px 48px rgba(23,24,26,0.16);
      --ease-fast: 120ms ease-out;
      --ease-base: 180ms cubic-bezier(.2,.7,.3,1);
    }
    @font-face {
      font-family: "Inter";
      src: url("${INTER_URL}") format("woff2");
      font-weight: 100 900;
      font-display: swap;
    }
    * { box-sizing: border-box; font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    :focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; border-radius: var(--radius-full); }
    /* A compact capsule of icon-circles, not a card — reference: a floating
       text-selection toolbar (Style/Bold/Italic/Align + a standout circular
       action at the end). Three controls only: what this is (note),
       where it's going (folder), and the action (add) — nothing else
       competes for space, matching the reference's restraint. */
    .pill {
      position: fixed; z-index: 2147483647; pointer-events: auto;
      display: flex; align-items: center; gap: var(--space-2);
      background: var(--color-bg); border: 1px solid var(--color-border);
      border-radius: var(--radius-full); box-shadow: var(--shadow-overlay);
      padding: 5px; animation: acopio-notes-in var(--ease-base);
    }
    @keyframes acopio-notes-in { from { opacity: 0; transform: translateY(2px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .type-badge {
      width: 36px; height: 36px; border-radius: var(--radius-full); flex: none;
      background: var(--type-note-bg); color: var(--type-note-fg);
      display: flex; align-items: center; justify-content: center;
      position: relative; border: none; padding: 0; cursor: pointer; font-family: inherit;
      transition: filter var(--ease-fast);
    }
    .type-badge:hover { filter: brightness(0.97); }
    .type-badge svg { width: 16px; height: 16px; }
    /* Same proactive-duplicate signal the hover tooltip shows (quiet,
       informational — collecting again is still allowed on purpose), just
       shrunk to a corner dot to fit the compact pill instead of a full
       "Already in your collection" text line. */
    .dup-dot {
      position: absolute; top: -2px; right: -2px; width: 14px; height: 14px; border-radius: var(--radius-full);
      background: var(--color-accent); color: var(--color-surface); border: 2px solid var(--color-bg);
      display: flex; align-items: center; justify-content: center;
    }
    .dup-dot svg { width: 7px; height: 7px; }
    .folder-btn {
      height: 36px; border-radius: var(--radius-full); border: 1px solid var(--color-border); flex: none;
      background: var(--color-surface); color: var(--color-text); cursor: pointer;
      display: flex; align-items: center; gap: 6px; padding: 0 var(--space-3) 0 var(--space-2);
      font-size: var(--text-caption); font-weight: 600; font-family: inherit;
      max-width: 150px; transition: background var(--ease-fast), border-color var(--ease-fast);
      /* .pill's own flex gap (var(--space-2), 8px) already separates every
         child evenly — this adds 12px on top of that, specifically between
         the note-color badge and this button (not between this button and
         add-btn, which stays at the plain 8px), landing the badge→folder
         gap at a full 20px as requested without touching the other pair. */
      margin-left: 12px;
    }
    .folder-btn:hover, .folder-btn[aria-expanded="true"] { background: var(--color-accent-wash); color: var(--color-accent); border-color: var(--color-accent); }
    .folder-btn-icon { flex: none; display: flex; color: var(--color-text-muted); }
    .folder-btn:hover .folder-btn-icon, .folder-btn[aria-expanded="true"] .folder-btn-icon { color: var(--color-accent); }
    .folder-btn-icon svg { width: 13px; height: 13px; }
    .folder-btn-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    /* Own real chevron, not a native <select> arrow — the actual bug being
       fixed: a native select's built-in arrow renders with inconsistent,
       too-tight spacing against the text depending on platform, which
       nothing in this codebase's own CSS can reliably control. A real SVG
       here is sized and spaced deliberately instead. */
    .folder-btn svg { width: 10px; height: 10px; flex: none; transition: transform var(--ease-fast); }
    .folder-btn[aria-expanded="true"] svg { transform: rotate(180deg); }
    .add-btn {
      width: 36px; height: 36px; border-radius: var(--radius-full); border: none; flex: none;
      background: var(--color-accent); color: var(--color-surface); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 3px 10px rgba(29,52,97,0.35);
      transition: filter var(--ease-fast);
    }
    .add-btn:hover { filter: brightness(1.08); }
    .add-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .add-btn svg { width: 15px; height: 15px; }
    /* Floating dropdown menu — same shape language as sidepanel.css's own
       .export-menu (this codebase's established pattern for a small
       floating option list), reimplemented locally since this shadow root
       can't share that stylesheet. */
    .folder-menu {
      position: fixed; z-index: 2147483647; min-width: 150px; max-width: 200px;
      background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm);
      box-shadow: var(--shadow-overlay); padding: var(--space-1); display: flex; flex-direction: column; gap: 1px;
    }
    /* Every option the same normal weight, sized down from the pill's own
       36px-tall controls (a dropdown floating off a compact pill shouldn't
       out-weigh the pill itself) — only the checked item and the accent
       "New folder" row pick up any emphasis, so the eye has one clear
       place to land instead of every row shouting at once. */
    .folder-menu-item {
      border: none; background: none; text-align: left; padding: 6px var(--space-2);
      border-radius: var(--radius-xs); font-size: 12px; font-weight: 500; line-height: 1.3; color: var(--color-text);
      cursor: pointer; font-family: inherit;
      display: flex; align-items: center; gap: 6px;
    }
    /* The label is its own span now (a sibling of the checkmark span, not
       the button's only content), so truncation has to target it
       specifically — the button itself no longer has a single text run
       to ellipsize. */
    .folder-menu-item > span:first-child {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* Accent-wash, not a barely-there gray — a hover state that's easy to
       miss reads as "is this even clickable?" in a list that's otherwise
       all plain text rows. Same tint every other hoverable control in
       this pill already uses (folder-btn, add-btn's own :hover), so this
       list matches the rest of the product's own hover language instead
       of inventing a quieter one just for itself. */
    .folder-menu-item:hover { background: var(--color-accent-wash); }
    .folder-menu-item[aria-checked="true"] { color: var(--color-accent); font-weight: 600; }
    /* A real checkmark on the selected row, not just its own color+weight
       — color/weight alone read as "this is styled differently" without
       necessarily saying WHY, which is exactly what made the selected
       item (often "This site", sitting first in the list) look like a
       section heading rather than "the option that's currently picked."
       The icon makes that state legible at a glance instead of requiring
       the reader to notice a font-weight difference. */
    .folder-menu-item-check { margin-left: auto; flex: none; display: none; color: var(--color-accent); }
    .folder-menu-item[aria-checked="true"] .folder-menu-item-check { display: flex; }
    .folder-menu-item-check svg { width: 11px; height: 11px; }
    .folder-menu-item svg { width: 11px; height: 11px; flex: none; }
    .folder-menu-divider { height: 1px; background: var(--color-border); margin: var(--space-1) 0; }
    .folder-menu-new-form { display: flex; gap: var(--space-1); padding: var(--space-1); }
    /* Explicit height (was padding-derived, ~24px) — a slightly bigger,
       more forgiving click target in a compact floating menu, matched by
       the confirm button below so the whole row reads as one consistent
       control height, not two mismatched ones. */
    .folder-menu-new-input {
      flex: 1; min-width: 0; height: 30px; box-sizing: border-box;
      border: 1px solid var(--color-border-strong); border-radius: var(--radius-xs);
      padding: 0 var(--space-2); font-size: var(--text-caption); font-family: inherit; outline: none; color: var(--color-text);
    }
    .folder-menu-new-input:focus { border-color: var(--color-accent); }
    .folder-menu-new-confirm, .folder-menu-new-cancel {
      width: 30px; height: 30px; border-radius: var(--radius-xs); border: none; cursor: pointer; flex: none;
      display: flex; align-items: center; justify-content: center;
    }
    .folder-menu-new-confirm { background: var(--color-accent); color: var(--color-surface); }
    .folder-menu-new-confirm svg, .folder-menu-new-cancel svg { width: 11px; height: 11px; }
    .folder-menu-new-cancel { background: var(--color-bg); color: var(--color-text-muted); }
    /* Color picker — opened from the type-badge itself (see openColorMenu),
       reuses the exact same floating-menu mechanics as .folder-menu
       (closeMenu/isInteracting/positionRect/escape/outside-click), just a
       row of swatches instead of a list. */
    .color-menu {
      position: fixed; z-index: 2147483647; display: flex; align-items: center; gap: var(--space-2);
      background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-full);
      box-shadow: var(--shadow-overlay); padding: var(--space-2) var(--space-3);
    }
    .color-swatch {
      width: 20px; height: 20px; border-radius: var(--radius-full); border: none; cursor: pointer; flex: none;
      padding: 0; position: relative; transition: transform var(--ease-fast);
    }
    .color-swatch:hover { transform: scale(1.12); }
    .color-swatch.is-selected::after {
      content: ""; position: absolute; inset: -3px; border-radius: var(--radius-full);
      border: 2px solid var(--color-accent);
    }
    /* PII soft-warn (GROUND_RULES.md — never silently save something that
       looks like it contains personal info) — only rendered when actually
       flagged, so the common case stays exactly the compact 3-circle pill
       above; this doesn't cost the minimal design anything most of the
       time, but the safeguard itself is never dropped. */
    .warning-banner {
      position: fixed; z-index: 2147483647; max-width: 280px;
      background: var(--color-warning-bg); color: var(--color-warning-text);
      border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3);
      font-size: var(--text-caption); line-height: 1.4; box-shadow: var(--shadow-raised);
    }
    .inline-error {
      position: fixed; z-index: 2147483647; max-width: 240px;
      background: var(--color-surface); border: 1px solid var(--color-border-strong);
      color: var(--color-danger); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3);
      font-size: var(--text-caption); box-shadow: var(--shadow-raised);
    }
  `;

  let host, shadow, cardEl;
  let menuEl = null; // the floating folder OR color dropdown — only one open at a time, see closeMenu/toggleMenu
  let notesActive = false;
  let currentRange = null;
  let currentExtraction = null;
  let selectedCollectionId = null; // null = "This site" (the auto per-hostname folder)
  let isSaving = false;

  // Weava's paid tier gates highlight color behind a subscription — this is
  // the one piece of that worth adopting free: a lightweight second
  // categorization axis at capture time, faster than filing into a folder.
  // 4 colors, not Weava's full custom picker — same restraint as the rest
  // of this tooltip. "blue" is deliberately identical to the existing
  // --type-note-bg/fg values so the badge's un-resolved default state
  // (before getLastColor() below resolves) needs no separate placeholder —
  // it's already painted correctly.
  const NOTE_COLORS = [
    { key: "blue", name: "Blue", bg: "#E3EEFB", fg: "#2A6CA8" },
    { key: "green", name: "Green", bg: "#E1F3E5", fg: "#2F7D4F" },
    { key: "yellow", name: "Yellow", bg: "#FCF1CF", fg: "#9C7A0A" },
    { key: "pink", name: "Pink", bg: "#FBE7EE", fg: "#B23E68" },
  ];
  const DEFAULT_COLOR_KEY = "blue";
  let selectedColorKey = DEFAULT_COLOR_KEY;

  function colorFor(key) {
    return NOTE_COLORS.find((c) => c.key === key) || NOTE_COLORS[0];
  }

  function ensureHost() {
    if (host) return;
    host = document.createElement("div");
    host.style.cssText = "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;";
    // Distinct from overlay.js's [data-acopio-root] host — two separate
    // UIs, two separate markers, so either can be identified independently
    // (debugging, or a future check that needs to tell them apart).
    host.setAttribute("data-acopio-notes-root", "true");
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = SHEET;
    shadow.appendChild(style);
    document.documentElement.appendChild(host);
    // Same shared registry overlay.js's and toolbar.js's hosts already use
    // — content.js's hover-target detection excludes every registered
    // root, and Acopio.isOwnNode (used below, selection guard) checks
    // against this same list.
    Acopio.registerOwnRoot(host);
  }

  function isVisible() {
    return Boolean(cardEl && cardEl.isConnected);
  }

  // Shared by both the folder dropdown and the color picker — only one can
  // ever be open at once (see toggleMenu below), so resetting "whichever
  // button currently claims aria-expanded" (rather than hardcoding
  // .folder-btn) correctly closes either one without each needing its own
  // close function that has to know about the other's existence.
  function closeMenu() {
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
    const expandedBtn = cardEl && cardEl.querySelector('[aria-expanded="true"]');
    if (expandedBtn) expandedBtn.setAttribute("aria-expanded", "false");
  }

  // Open-or-close for a single menu-owning button: closes whatever's
  // currently open (any button's menu, including this one's own) first,
  // then opens this button's menu UNLESS its own menu was the thing that
  // was just open — that case is a plain toggle-off. Without this, clicking
  // the folder button while the color menu was open would only ever close
  // the color menu and require a second click to actually open the folder
  // menu — a real "did my click even register" moment.
  function toggleMenu(anchorBtn, opener) {
    const wasOpenForThisBtn = Boolean(menuEl) && anchorBtn.getAttribute("aria-expanded") === "true";
    closeMenu();
    if (wasOpenForThisBtn) return;
    opener();
  }

  function hide() {
    closeMenu();
    if (cardEl) {
      cardEl.remove();
      cardEl = null;
    }
    // warning-banner/inline-error are appended to `shadow` directly, not
    // inside cardEl (so their own position math stays simple) — which
    // means removing cardEl alone left them behind, floating on screen
    // with no tooltip attached to them, until their own 4s timeout
    // happened to catch up. Cleared explicitly here so dismissing the
    // tooltip always dismisses everything that belongs to it.
    if (shadow) {
      const warn = shadow.querySelector(".warning-banner");
      if (warn) warn.remove();
      const err = shadow.querySelector(".inline-error");
      if (err) err.remove();
    }
    currentRange = null;
    currentExtraction = null;
  }

  // Same rect-in/rect-out technique as overlay.js's positionCard, not
  // imported — kept fully local so this file has zero dependency on
  // overlay.js's internals. Anchors below the selection by default (a
  // selection tooltip reads naturally as "attached below what you just
  // highlighted"), flips above if it wouldn't fit.
  //
  // Unlike overlay.js's tooltip (a fixed 280px card), this pill's width is
  // content-dependent (the folder name can be short or run up to its
  // max-width) — offsetWidth is read AFTER the element is already
  // attached to the shadow root by every call site below, so the real
  // rendered width is always available; fallbackW only covers the
  // theoretical case of measuring before attachment.
  function positionRect(targetEl, anchorRect, fallbackW, fallbackH) {
    const margin = 10;
    const targetW = targetEl.offsetWidth || fallbackW;
    const targetH = targetEl.offsetHeight || fallbackH;
    let left = Math.min(Math.max(anchorRect.left, margin), window.innerWidth - targetW - margin);
    let top = anchorRect.bottom + margin;
    if (top + targetH > window.innerHeight) {
      top = anchorRect.top - targetH - margin;
    }
    top = Math.min(Math.max(top, margin), window.innerHeight - targetH - margin);
    targetEl.style.left = `${left}px`;
    targetEl.style.top = `${top}px`;
  }

  // Acopio.isJavascriptUri only catches `javascript:` — not enough here,
  // because the side panel wraps every captured image/link in a real,
  // clickable <a href target="_blank">, and a data:text/html URI executes
  // any script inside it when actually navigated to by a real click, the
  // same as javascript: does. data:image/* stays allowed (a legitimate
  // inline image is completely inert to open); every other data: scheme
  // is rejected outright rather than trying to enumerate which ones are
  // "probably fine."
  function isUnsafeHref(value) {
    if (!value) return true;
    const v = String(value).trim();
    if (Acopio.isJavascriptUri(v)) return true;
    // Same underlying bypass Acopio.isJavascriptUri now guards against
    // (browsers strip embedded tab/newline/CR anywhere in a URL before
    // parsing its scheme) — this file's own separate data: check needs the
    // identical stripping, since "da\tta:text/html,<script>..." would
    // otherwise fail both regexes below (doesn't match /^data:/ literally)
    // and fall through as "safe" while a real browser still opens it as a
    // script-executing data:text/html document.
    const stripped = v.replace(/[\t\n\r]/g, "");
    if (/^data:/i.test(stripped) && !/^data:image\//i.test(stripped)) return true;
    return false;
  }

  // Real <img>/<a> elements the selection's Range actually crosses — not a
  // second gesture, just inspecting what a normal drag-selection already
  // spans. Capped so a huge/pathological selection can't blow up the
  // payload; wrapped in try/catch since intersectsNode can throw on nodes
  // in an unusual state (mid-mutation, cross-document, etc.) and this is a
  // best-effort enrichment, not a required part of the capture.
  function extractMediaFromRange(range) {
    const images = [];
    const links = [];
    let container = range.commonAncestorContainer;
    if (container && container.nodeType !== 1) container = container.parentElement;
    if (!container) return { images, links };
    try {
      container.querySelectorAll("img").forEach((img) => {
        if (images.length >= 5) return;
        try {
          if (range.intersectsNode(img) && img.src && !isUnsafeHref(img.src)) images.push(img.src);
        } catch (_) {
          // skip this one, keep going
        }
      });
      container.querySelectorAll("a[href]").forEach((a) => {
        if (links.length >= 5) return;
        try {
          const href = a.getAttribute("href");
          if (range.intersectsNode(a) && href && !isUnsafeHref(a.href)) {
            links.push({ href: a.href, text: (a.textContent || "").trim().slice(0, 80) });
          }
        } catch (_) {
          // skip this one, keep going
        }
      });
    } catch (_) {
      // container.querySelectorAll itself failed (extremely unlikely) —
      // fall through with whatever was collected so far, never let a
      // best-effort enrichment step break the whole capture.
    }
    return { images, links };
  }

  const MAX_TEXT_LEN = 4000;

  // Plain `text.slice(0, MAX_TEXT_LEN)` operates on UTF-16 code units, not
  // characters — most emoji (and other astral-plane characters) are two
  // code units (a surrogate pair). If the cut point happens to land exactly
  // between them, the kept string ends with a lone, unpaired high
  // surrogate: not a crash, but real corruption — it can render as a
  // replacement-character glyph, and encoding it to UTF-8 later (the ZIP
  // export's .md file, the plain-text clipboard write) produces invalid
  // UTF-8 that different encoders handle inconsistently. Trimming one more
  // code unit off when the cut lands mid-pair keeps the boundary
  // code-point-safe regardless of what's at position MAX_TEXT_LEN.
  function safeTruncate(text, maxLen) {
    if (text.length <= maxLen) return text;
    let cut = maxLen;
    const lastCode = text.charCodeAt(cut - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) cut -= 1;
    return text.slice(0, cut);
  }

  // Which character spans of `text` came from inside an h1-h6 on the
  // source page — so a captured "heading + body" selection can render the
  // heading's own words bold later, matching how it actually looked,
  // instead of the whole capture flattening into one uniform weight.
  // Doesn't touch how `text` itself is built (selection.toString() stays
  // the single source of truth for that, already proven correct) — walks
  // the range's heading text nodes separately and locates each one inside
  // the already-built string via a forward-only indexOf search, so a
  // fragment that can't be found just gets skipped rather than risking a
  // misaligned offset landing bold text on the wrong words.
  function findHeadingRanges(range, text) {
    const ranges = [];
    try {
      let container = range.commonAncestorContainer;
      if (container && container.nodeType !== 1) container = container.parentElement;
      if (!container) return ranges;
      // querySelectorAll("h1..h6") first, THEN walk text nodes only inside
      // each matching heading — not a TreeWalker over every text node in
      // the whole common-ancestor subtree. A selection spanning two
      // visually distant sections of a real page (a hero heading, a stats
      // panel elsewhere) can have a commonAncestorContainer close to
      // <body>, and walking every text node under that synchronously
      // blocked the tooltip's render long enough to look like it was
      // blinking/disappearing — same targeted-query shape
      // extractMediaFromRange already uses for images/links, just applied
      // here too.
      const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");
      let searchStart = 0;
      for (const heading of headings) {
        if (!range.intersectsNode(heading)) continue;
        const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
        let node;
        // One range per HEADING ELEMENT, not one per text node inside it —
        // a heading with a manual <br> in the middle (a real, common
        // pattern: "Deploy custom<br>integrations in days", one <h3>,
        // author-controlled line break) has multiple separate text nodes.
        // Pushing a separate range per fragment left the character(s)
        // between two fragments of the SAME heading (the \n the <br>
        // serializes to, via Selection.toString()) sitting in the GAP
        // between two adjacent ranges — which the renderer (sidepanel.js)
        // treats as plain body text between two headings, not as part of
        // one, so it never got the same "this is cosmetic, not a
        // meaningful break" treatment as the rest of the heading's own
        // text. Accumulating one min(start)/max(end) span per heading
        // element instead means the whole heading — <br> and all — renders
        // as one continuous bold span, and the renderer's own within-a-
        // heading newline collapsing correctly covers the entire thing.
        let headingStart = null;
        let headingEnd = null;
        while ((node = walker.nextNode())) {
          if (!range.intersectsNode(node)) continue;
          const nodeText = node.textContent || "";
          let s = 0;
          let e = nodeText.length;
          if (node === range.startContainer) s = range.startOffset;
          if (node === range.endContainer) e = range.endOffset;
          const fragment = nodeText.slice(s, e).trim();
          if (!fragment) continue;
          const idx = text.indexOf(fragment, searchStart);
          if (idx === -1) continue;
          if (headingStart === null) headingStart = idx;
          headingEnd = idx + fragment.length;
          searchStart = idx + fragment.length;
        }
        if (headingStart !== null) ranges.push({ start: headingStart, end: headingEnd });
      }
    } catch (_) {
      // best-effort — heading bolding is a nice-to-have, never worth a
      // broken capture over
    }
    return ranges;
  }

  function extractFromSelection(selection) {
    let text = selection.toString().trim();
    const truncated = text.length > MAX_TEXT_LEN;
    if (truncated) text = safeTruncate(text, MAX_TEXT_LEN);
    const range = selection.getRangeAt(0);
    const { images, links } = extractMediaFromRange(range);
    const headingRanges = findHeadingRanges(range, text);
    return { text, truncated, images, links, range, headingRanges };
  }

  function getCollections() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "GET_COLLECTIONS" }, (response) => {
          if (chrome.runtime.lastError || !response || !response.ok) {
            resolve([]);
            return;
          }
          resolve(response.collections || []);
        });
      } catch (_) {
        resolve([]); // extension context invalidated — folder picker just shows "This site"
      }
    });
  }

  // Same proactive duplicate flag the hover tooltip already shows (Pattern:
  // "quiet, informational, not a warning — you can still collect it again
  // on purpose") — reuses the exact same CHECK_DUPLICATE message and
  // AcopioDB.findSimilarItem's "note" branch (exact-text match within
  // this hostname) already wired up for this type.
  function checkDuplicate(text) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: "CHECK_DUPLICATE", payload: { hostname: Acopio.hostname(), type: "note", data: { text }, selector: null } },
          (response) => {
            if (chrome.runtime.lastError || !response || !response.ok) {
              resolve(null);
              return;
            }
            resolve(response.similar || null);
          }
        );
      } catch (_) {
        resolve(null);
      }
    });
  }

  // Remembers the last folder/Collection you filed a note into, per
  // hostname, so collecting several notes on the same site in one session
  // doesn't mean re-picking the folder every single time — it stays put
  // until you deliberately change it. Separate storage key from every
  // toggle flag; this is data, not a mode switch.
  const LAST_FOLDER_KEY = "acopioLastFolderByHost";
  function getLastFolder(hostname) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([LAST_FOLDER_KEY], (res) => {
          const map = (res && res[LAST_FOLDER_KEY]) || {};
          resolve(map[hostname] || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }
  function setLastFolder(hostname, collectionId) {
    try {
      chrome.storage.local.get([LAST_FOLDER_KEY], (res) => {
        const map = (res && res[LAST_FOLDER_KEY]) || {};
        map[hostname] = collectionId;
        chrome.storage.local.set({ [LAST_FOLDER_KEY]: map });
      });
    } catch (_) {
      // best-effort — worst case the next capture just re-defaults to "This site"
    }
  }

  // Global, not per-hostname like the folder memory above — a color choice
  // reads as "how I categorize things" (I always use yellow for
  // important), not "what this specific site's notes go into," so it
  // shouldn't reset just because you moved to a different tab. Shared
  // storage key means a pick on one tab is reflected the next time the
  // tooltip renders on any tab, including this same one later.
  const LAST_COLOR_KEY = "acopioLastNoteColor";
  function getLastColor() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([LAST_COLOR_KEY], (res) => {
          resolve((res && res[LAST_COLOR_KEY]) || DEFAULT_COLOR_KEY);
        });
      } catch (_) {
        resolve(DEFAULT_COLOR_KEY);
      }
    });
  }
  function setLastColor(colorKey) {
    try {
      chrome.storage.local.set({ [LAST_COLOR_KEY]: colorKey });
    } catch (_) {
      // best-effort — worst case the next capture just re-defaults to blue
    }
  }

  function collectionNameFor(id, collections) {
    if (!id) return "This site";
    const found = collections.find((c) => c.id === id);
    return found ? found.name : "This site";
  }

  // The folder-choose control itself — a compact pill button (name +
  // chevron), not a native <select>. Opening it shows .folder-menu, a
  // separate floating element (own positioning, own outside-click/Escape
  // handling) so it can appear above the tooltip pill without fighting
  // cardEl's own fixed size.
  // onPick(collectionId, collectionName) — name is passed explicitly,
  // never re-looked-up from a cached list after the fact. An earlier
  // version had the newly-created folder's picker callback re-derive the
  // name from render()'s own collectionsCache, which the new folder
  // hadn't been added to yet — the label silently stayed "This site" even
  // though the folder really was created. Passing the name straight
  // through removes that whole class of stale-cache bug.
  function openFolderMenu(folderBtn, collections, onPick) {
    closeMenu();
    folderBtn.setAttribute("aria-expanded", "true");
    menuEl = document.createElement("div");
    menuEl.className = "folder-menu";

    // Builds one menu row with a text label AND a checkmark slot (shown
    // only when aria-checked="true", via CSS) — a plain textContent
    // assignment couldn't also carry the checkmark, and the checkmark is
    // exactly what makes a selected row read as "the current pick" rather
    // than a differently-styled heading.
    function buildFolderMenuItem(label, checked, onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "folder-menu-item";
      btn.setAttribute("role", "menuitemradio");
      btn.setAttribute("aria-checked", String(checked));
      const labelSpan = document.createElement("span");
      labelSpan.textContent = label;
      btn.appendChild(labelSpan);
      const check = document.createElement("span");
      check.className = "folder-menu-item-check";
      check.innerHTML = Acopio.ICONS.check;
      btn.appendChild(check);
      btn.addEventListener("click", onClick);
      return btn;
    }

    menuEl.appendChild(
      buildFolderMenuItem("This site", !selectedCollectionId, () => { onPick(null, "This site"); closeMenu(); })
    );
    collections.forEach((c) => {
      menuEl.appendChild(
        buildFolderMenuItem(c.name, selectedCollectionId === c.id, () => { onPick(c.id, c.name); closeMenu(); })
      );
    });

    const divider = document.createElement("div");
    divider.className = "folder-menu-divider";
    menuEl.appendChild(divider);

    // Always-visible create row, not a second click-through step — a
    // "New folder" button that swaps the whole menu to a separate form
    // view used to sit here instead; collapsing that into one persistent
    // row removes an entire extra render/interaction cycle (and the extra
    // opportunity for a real click to land wrong along the way), and
    // matches "type a name, hit the button at the end of the field" being
    // available the instant the menu opens.
    const form = document.createElement("div");
    form.className = "folder-menu-new-form";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "folder-menu-new-input";
    input.placeholder = "New folder name";
    input.maxLength = 60;
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); confirm(); }
    });
    form.appendChild(input);
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "folder-menu-new-confirm";
    confirmBtn.innerHTML = Acopio.ICONS.plus;
    confirmBtn.title = "Add folder";
    confirmBtn.setAttribute("aria-label", "Create folder");
    const confirm = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      confirmBtn.disabled = true;
      // Same guaranteed-settle pattern as onCollectClick's own message —
      // a suspended MV3 service worker can drop the callback entirely
      // with no error, no response, ever. Without this, "Add folder"
      // just silently re-enabled nothing and never told you why —
      // indistinguishable from the button being broken.
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        confirmBtn.disabled = false;
        showInlineError("Acopio didn't hear back — try again in a moment.");
      }, 8000);
      try {
        chrome.runtime.sendMessage({ type: "CREATE_COLLECTION", payload: { name } }, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          if (chrome.runtime.lastError || !response || !response.ok) {
            confirmBtn.disabled = false;
            showInlineError((response && response.error) || "Couldn't create that folder — try again.");
            return;
          }
          onPick(response.collection.id, response.collection.name);
          closeMenu();
        });
      } catch (_) {
        // Extension context invalidated (reloaded while this page was
        // already open) — sendMessage throws synchronously, so the
        // response callback above never runs at all.
        settled = true;
        clearTimeout(timeoutId);
        confirmBtn.disabled = false;
        showInlineError("Acopio was reloaded — refresh this page to keep collecting.");
      }
    };
    confirmBtn.addEventListener("click", confirm);
    form.appendChild(confirmBtn);
    menuEl.appendChild(form);

    shadow.appendChild(menuEl);
    positionRect(menuEl, folderBtn.getBoundingClientRect(), 200, 96);
  }

  // The color picker — opened from the type-badge itself. Same floating-
  // element shape as openFolderMenu (own positioning, closed via the same
  // shared closeMenu/isInteracting machinery) but a row of swatches
  // instead of a list, since there are only 4 fixed options, not an
  // open-ended/creatable list like folders.
  function openColorMenu(typeBadge, currentColorKey, onPick) {
    closeMenu();
    typeBadge.setAttribute("aria-expanded", "true");
    menuEl = document.createElement("div");
    menuEl.className = "color-menu";
    NOTE_COLORS.forEach((c) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "color-swatch";
      if (c.key === currentColorKey) swatch.classList.add("is-selected");
      swatch.style.background = c.fg;
      swatch.setAttribute("role", "menuitemradio");
      swatch.setAttribute("aria-checked", String(c.key === currentColorKey));
      swatch.setAttribute("aria-label", c.name);
      swatch.title = c.name;
      swatch.addEventListener("click", () => { onPick(c.key); closeMenu(); });
      menuEl.appendChild(swatch);
    });
    shadow.appendChild(menuEl);
    positionRect(menuEl, typeBadge.getBoundingClientRect(), 150, 44);
  }

  function render(extraction) {
    ensureHost();
    if (cardEl) cardEl.remove();
    closeMenu();

    cardEl = document.createElement("div");
    cardEl.className = "pill";

    // A <button>, not a <div> — it's the color-picker's own trigger now
    // (see openColorMenu below), same "plain button click, isInteracting()
    // handles it regardless of macOS's no-focus-on-click quirk" pattern
    // already proven out for folderBtn.
    const typeBadge = document.createElement("button");
    typeBadge.type = "button";
    typeBadge.className = "type-badge";
    typeBadge.setAttribute("aria-haspopup", "true");
    typeBadge.setAttribute("aria-expanded", "false");
    typeBadge.innerHTML = Acopio.ICONS.note;
    cardEl.appendChild(typeBadge);

    // The duplicate flag and the color name both want to describe this
    // same badge's title — composed together here instead of two separate
    // assignments that would silently overwrite each other (the duplicate
    // check resolves asynchronously, same as the color memory below, so
    // whichever finishes last must not erase what the other one said).
    let isDuplicate = false;
    function refreshTypeBadgeTitle() {
      const colorName = colorFor(selectedColorKey).name;
      typeBadge.title = isDuplicate
        ? `${colorName} note — already collected, collecting again adds a duplicate`
        : `${colorName} note — click to change color`;
    }
    refreshTypeBadgeTitle();

    checkDuplicate(extraction.text).then((similar) => {
      if (!similar || !isVisible() || !cardEl.contains(typeBadge)) return;
      isDuplicate = true;
      refreshTypeBadgeTitle();
      const dot = document.createElement("div");
      dot.className = "dup-dot";
      dot.innerHTML = Acopio.ICONS.check;
      typeBadge.appendChild(dot);
    });

    const folderBtn = document.createElement("button");
    folderBtn.type = "button";
    folderBtn.className = "folder-btn";
    folderBtn.setAttribute("aria-haspopup", "true");
    folderBtn.setAttribute("aria-expanded", "false");
    const folderIcon = document.createElement("span");
    folderIcon.className = "folder-btn-icon";
    folderIcon.innerHTML = Acopio.ICONS.folder;
    folderBtn.appendChild(folderIcon);
    const folderLabel = document.createElement("span");
    folderLabel.className = "folder-btn-label";
    folderLabel.textContent = "This site";
    folderBtn.appendChild(folderLabel);
    const chevron = document.createElement("span");
    chevron.innerHTML = `<svg viewBox="0 0 12 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1.5 6 6.5 11 1.5"/></svg>`;
    folderBtn.appendChild(chevron);
    cardEl.appendChild(folderBtn);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "add-btn";
    addBtn.innerHTML = Acopio.ICONS.plus;
    addBtn.setAttribute("aria-label", "Collect this note");
    addBtn.title = "Collect";
    addBtn.addEventListener("click", () => onCollectClick(extraction, selectedCollectionId, selectedColorKey, addBtn));
    cardEl.appendChild(addBtn);

    shadow.appendChild(cardEl);
    positionRect(cardEl, extraction.range.getBoundingClientRect(), 130, 44);

    function applyColor(colorKey) {
      selectedColorKey = colorKey;
      const c = colorFor(colorKey);
      typeBadge.style.background = c.bg;
      typeBadge.style.color = c.fg;
      refreshTypeBadgeTitle();
    }

    // Resolve collections + this site's remembered folder + the globally
    // remembered color in parallel, then apply all three once known —
    // avoids a flash of defaults immediately swapping to remembered values
    // a beat later.
    let collectionsCache = [];
    Promise.all([getCollections(), getLastFolder(Acopio.hostname()), getLastColor()]).then(
      ([collections, lastFolderId, lastColorKey]) => {
        if (!isVisible()) return; // dismissed before this resolved
        collectionsCache = collections;
        // A remembered id whose Collection was since deleted falls back to
        // "This site" rather than silently pointing at nothing.
        selectedCollectionId = lastFolderId && collections.some((c) => c.id === lastFolderId) ? lastFolderId : null;
        folderLabel.textContent = collectionNameFor(selectedCollectionId, collections);
        applyColor(lastColorKey);
      }
    );

    folderBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu(folderBtn, () =>
        // collectionName comes straight from openFolderMenu now (the id
        // it was just created with, or the id+name of an existing pick) —
        // no re-lookup against collectionsCache, which is exactly the
        // stale-cache bug this used to have: a folder created THIS click
        // isn't in collectionsCache yet, so collectionNameFor(id,
        // collectionsCache) couldn't find it and silently fell back to
        // "This site" even though the folder really was created.
        openFolderMenu(folderBtn, collectionsCache, (collectionId, collectionName) => {
          selectedCollectionId = collectionId;
          folderLabel.textContent = collectionName;
          setLastFolder(Acopio.hostname(), collectionId);
          if (collectionId && !collectionsCache.some((c) => c.id === collectionId)) {
            collectionsCache = collectionsCache.concat([{ id: collectionId, name: collectionName }]);
          }
        })
      );
    });

    typeBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu(typeBadge, () =>
        openColorMenu(typeBadge, selectedColorKey, (colorKey) => {
          applyColor(colorKey);
          setLastColor(colorKey);
        })
      );
    });

    // extraction.truncated was computed (extractFromSelection slices at
    // MAX_TEXT_LEN) but never surfaced anywhere — a selection over ~4000
    // characters (not an exotic edge case; one real page's hero section
    // plus a couple of paragraphs clears it easily) got silently cut with
    // zero indication, so the person collecting it would have no reason to
    // think anything was missing until they noticed later. Same
    // warning-banner treatment as the PII notice below, stacked beneath it
    // when both fire at once rather than overlapping.
    const banners = [];
    if (extraction.truncated) {
      banners.push(`Only the first ${MAX_TEXT_LEN.toLocaleString()} characters were kept — this selection was longer.`);
    }
    if (Acopio.PII_PATTERN.test(extraction.text)) {
      banners.push("This might contain personal info.");
    }
    if (banners.length) {
      const cardRect = cardEl.getBoundingClientRect();
      banners.forEach((message, i) => {
        const warn = document.createElement("div");
        warn.className = "warning-banner";
        warn.textContent = message;
        shadow.appendChild(warn);
        warn.style.left = `${cardRect.left}px`;
        warn.style.top = `${cardRect.bottom + 8 + i * (warn.offsetHeight + 6)}px`;
        setTimeout(() => warn.remove(), 4000);
      });
    }
  }

  function showInlineError(message) {
    if (!cardEl) return;
    const existing = shadow.querySelector(".inline-error");
    if (existing) existing.remove();
    const err = document.createElement("div");
    err.className = "inline-error";
    err.textContent = message;
    shadow.appendChild(err);
    const cardRect = cardEl.getBoundingClientRect();
    err.style.left = `${cardRect.left}px`;
    err.style.top = `${cardRect.bottom + 8}px`;
    setTimeout(() => err.remove(), 4000);
  }

  function onCollectClick(extraction, collectionId, colorKey, btn) {
    if (isSaving) return;
    isSaving = true;
    btn.disabled = true;
    const btnIdleHTML = btn.innerHTML;

    const item = {
      id: Acopio.uuid(),
      type: "note",
      family: "note",
      hostname: Acopio.hostname(),
      capturedAt: new Date().toISOString(),
      sourceUrl: window.location.href,
      sourcePageTitle: document.title,
      selector: null,
      // No annotation field in this compact tooltip — same as every other
      // capture type, a note is addable/editable afterward from the side
      // panel (buildEditBtn/buildNoteControl), not required at capture time.
      note: "",
      data: {
        text: extraction.text,
        images: extraction.images,
        links: extraction.links,
        charCount: extraction.text.length,
        // Was computed at extraction time and only ever shown as a 4-second
        // banner that's easy to miss — persisting it means the record
        // itself still says "this was cut off" whenever it's looked at
        // later (Library tile, export, copy), not just in the moment of
        // capture.
        truncated: Boolean(extraction.truncated),
        headingRanges: extraction.headingRanges || [],
        // Stored as the palette KEY, not a hex value — survives a future
        // palette redesign, and the side panel (sidepanel.js) keeps its own
        // copy of the same small NOTE_COLORS table to render it (same
        // duplicated-values-not-code convention as the design tokens above).
        color: colorKey,
      },
    };

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      isSaving = false;
      if (!result.ok) {
        btn.disabled = false;
        btn.innerHTML = btnIdleHTML;
        showInlineError(result.error || "Couldn't save this note.");
        return;
      }
      btn.innerHTML = Acopio.ICONS.check;
      const linkToCollection = collectionId
        ? new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage(
                {
                  type: "ADD_ITEMS_TO_COLLECTION",
                  payload: { collectionId, itemRefs: [{ folderHostname: item.hostname, itemId: item.id }] },
                },
                () => resolve()
              );
            } catch (_) {
              resolve(); // best-effort — the item itself is already saved either way
            }
          })
        : Promise.resolve();
      linkToCollection.then(() => {
        setTimeout(() => {
          if (isVisible() && cardEl && cardEl.contains(btn)) hide();
        }, 700);
      });
    };
    // Same guaranteed-settle timeout pattern as content.js's
    // finalizeCapture — a suspended MV3 service worker never calls
    // sendResponse at all under real load, no error, callback just never
    // fires; without this the button would stay disabled forever.
    const timeoutId = setTimeout(() => {
      finish({ ok: false, error: "Acopio didn't hear back — try again in a moment." });
    }, 8000);
    try {
      chrome.runtime.sendMessage({ type: "CAPTURE_ITEM", payload: item }, (response) => {
        if (chrome.runtime.lastError) {
          finish({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        if (!response || !response.ok) {
          finish({ ok: false, error: (response && response.error) || "Unknown error." });
          return;
        }
        finish({ ok: true });
      });
    } catch (_) {
      finish({ ok: false, error: "Acopio was reloaded — refresh this page to keep collecting." });
    }
  }

  function selectionQualifies(selection) {
    if (!notesActive) return false;
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    const text = selection.toString().trim();
    if (!text) return false;
    // Selecting text inside our own tooltip (e.g. the read-only preview)
    // must never trigger a new capture attempt on top of itself.
    if (Acopio.isOwnNode(selection.anchorNode) || Acopio.isOwnNode(selection.focusNode)) return false;
    return true;
  }

  // True when two ranges cover the exact same span — used to recognize
  // "this is the same selection I already rendered a tooltip for," not a
  // genuinely new one. Needed because mouseup (fast path, fires once) and
  // the debounced selectionchange listener (keyboard-selection path, but
  // also fires for a mouse drag) both call handleSelectionSettled() for
  // the very same gesture — without this, the debounced one would replay
  // ~350ms after the tooltip already appeared and looked like an
  // unexplained flicker.
  function rangesEqual(a, b) {
    if (!a || !b) return false;
    try {
      return a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0;
    } catch (_) {
      return false;
    }
  }

  // Real, reproduced bug this fixes: document.activeElement does NOT see
  // into a shadow tree — when focus is on an element inside a shadow root,
  // the outer document's activeElement getter returns the shadow HOST
  // (an ancestor of cardEl, not a descendant), so `cardEl.contains(
  // document.activeElement)` is always false even while genuinely typing
  // inside the note field. That made every "don't clobber an in-progress
  // interaction" guard below a no-op — confirmed live: clicking into the
  // note field to type an annotation collapses the page's own text
  // selection as an ordinary side effect of the click, which used to
  // immediately hide() the tooltip out from under the user mid-sentence.
  // Checking the shadow root's OWN activeElement (which does resolve to
  // the true deeply-focused element inside it, unlike document's) fixed
  // that for the note-field / new-folder-input case — but NOT for a plain
  // <button> click (the folder button itself, or a folder-menu item):
  // confirmed live that on macOS, clicking a <button> does not move
  // keyboard focus to it by default (a real, documented cross-platform
  // difference — Windows/Linux Chrome do focus a clicked button; macOS
  // Chrome doesn't, unless "Full Keyboard Access" is on). That meant
  // opening the folder menu — a pure button click, no text field involved
  // — never registered as "the tooltip has focus" either, so the exact
  // same selection-collapse-triggers-hide() bug still fired on the very
  // first click needed to reach the new-folder flow at all.
  //
  // The robust fix doesn't lean on :focus for this: isInteracting() below
  // treats "the folder menu is open" as its own independent signal,
  // regardless of what has keyboard focus — a menu being open at all only
  // ever happens because the user is mid-interaction with it.
  function tooltipHasFocus() {
    if (!shadow || !shadow.activeElement) return false;
    if (cardEl && cardEl.contains(shadow.activeElement)) return true;
    if (menuEl && menuEl.contains(shadow.activeElement)) return true;
    return false;
  }
  // Most robust of the three signals combined in isInteracting() below —
  // set on mousedown (the point at which a click actually collapses the
  // page's underlying selection, before any focus change or menu-state
  // update has even happened yet), so it's available the instant
  // handleSelectionSettled() needs it, regardless of whether the click
  // target was a <button> that macOS never focuses or a menu that hasn't
  // finished rendering. Read once per selectionchange cycle then reset,
  // so it only ever describes the interaction that most recently
  // happened, never a stale one from several clicks ago.
  let lastPointerDownWasOwnUI = false;
  // Real, reproduced bug: on a slow/paused drag (pausing mid-drag while
  // still holding the mouse button down is completely normal human
  // behavior over a large multi-paragraph selection), the debounced
  // selectionchange listener below could fire and show the tooltip WHILE
  // the drag was still in progress. If the still-moving cursor's path then
  // crossed over the now-visible tooltip, the browser's native selection
  // extended into Acopio's own shadow DOM — which selectionQualifies()
  // correctly treats as invalid (its own guard against selecting our own
  // UI as page content) — hiding the tooltip, which then reappeared once
  // the cursor cleared it and the selection returned to real page content.
  // Net effect: exactly the reported "blinking and disappearing, then
  // reappearing" during a large selection. Every real text-selection
  // popup (Medium, Notion, Google Docs) only ever appears after the drag
  // actually ends, for this same reason — tracked here so the debounced
  // handler can defer to mouseup instead of firing mid-drag.
  let mouseIsDown = false;
  document.addEventListener("mousedown", (e) => { lastPointerDownWasOwnUI = Acopio.isOwnNode(e.target); mouseIsDown = true; }, true);

  function isInteracting() {
    return tooltipHasFocus() || Boolean(menuEl) || lastPointerDownWasOwnUI;
  }

  function handleSelectionSettled() {
    const selection = window.getSelection();
    if (!selectionQualifies(selection)) {
      // A collapsed/cleared selection while the tooltip is showing means
      // the user deselected — matches "only appears while something is
      // selected." Interacting with our own UI (typing a note, opening/
      // using the folder menu) collapses the PAGE selection too as an
      // ordinary side effect, so this only hides when nothing qualifies
      // AND nothing in our own tooltip is currently being interacted with.
      if (isVisible() && !isInteracting()) hide();
      return;
    }
    const newRange = selection.getRangeAt(0);
    // Redundant fire for the exact selection already showing (see
    // rangesEqual above) — nothing to do.
    if (isVisible() && rangesEqual(currentRange, newRange)) return;
    // Tooltip open and mid-interaction (typing a note, folder menu open)
    // — a re-render here would wipe out that in-progress interaction and
    // replay the entrance animation for no reason, even if the underlying
    // page selection technically changed underneath.
    if (isVisible() && isInteracting()) return;
    currentExtraction = extractFromSelection(selection);
    currentRange = currentExtraction.range;
    render(currentExtraction);
  }

  document.addEventListener("mouseup", (e) => {
    mouseIsDown = false;
    if (Acopio.isOwnNode(e.target)) return; // a mouseup inside our own tooltip (e.g. clicking Collect) isn't a new selection event
    handleSelectionSettled();
  });
  // Keyboard-driven selection (Shift+Arrow, Ctrl/Cmd+A) doesn't fire
  // mouseup at all — this is its actual trigger path. Debounced so a long
  // Shift+Arrow hold doesn't re-render on every single keystroke; also
  // fires (harmlessly — see rangesEqual above) for the tail end of a mouse
  // drag, which is fine since it's idempotent against what mouseup already
  // rendered.
  //
  // Gated on mouseIsDown (see its own comment above) — a mouse drag still
  // in progress defers entirely to the eventual mouseup instead of firing
  // here, which is what actually fixes the blink/reappear bug: the
  // tooltip now never has a chance to render mid-drag and get crossed by
  // the still-moving cursor in the first place. Keyboard-driven selection
  // is unaffected (mouseIsDown is never true for that path), so it still
  // renders through this debounced handler exactly as before.
  document.addEventListener(
    "selectionchange",
    Acopio.debounce(() => {
      if (mouseIsDown) return;
      handleSelectionSettled();
    }, 350),
    { passive: true }
  );

  // Own local Escape listener — hides this tooltip only, never touches
  // acopioActive or acopioNotesActive. That pause-on-Escape behavior is
  // specific to the hover tooltip (overlay.js) and shouldn't be conflated
  // with "dismiss the notes tooltip" here — two different concerns that
  // happen to share a key.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      // Menu open (folder OR color) → Escape closes just the menu first
      // (you're still mid-capture) — a second Escape then dismisses the
      // whole tooltip, same two-step feel as any nested popover.
      if (menuEl) { closeMenu(); return; }
      if (!isVisible()) return;
      hide();
    },
    true
  );

  // Outside-click dismissal — same composedPath()[0] technique overlay.js
  // uses (see its own detailed comment on why e.target can't be trusted
  // across a shadow-DOM boundary). menuEl is a separate top-level element
  // from cardEl (not nested inside it), so it needs its own contains()
  // check — otherwise clicking a folder in the open menu would count as
  // "outside" and dismiss the whole tooltip before the click handler on
  // the menu item itself even runs.
  window.addEventListener(
    "click",
    (e) => {
      if (!isVisible()) return;
      const realTarget = e.composedPath()[0];
      if (cardEl.contains(realTarget)) return;
      if (menuEl && menuEl.contains(realTarget)) return;
      if (menuEl) { closeMenu(); return; } // click was outside the menu but still meant to close it, not the whole tooltip
      hide();
    },
    true
  );

  chrome.storage.local.get(["acopioNotesActive"], (res) => {
    notesActive = res.acopioNotesActive === true;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.acopioNotesActive) {
      notesActive = changes.acopioNotesActive.newValue === true;
      if (!notesActive) hide(); // turned off mid-selection — don't leave the tooltip stranded open
    }
  });
})();
