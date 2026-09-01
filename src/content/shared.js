// Shared namespace + small helpers used by every content-script file.
// Plain scripts (no bundler) sharing one global on purpose — see PLAN.md
// assumption #1. Everything hangs off window.Harvest to avoid polluting
// the host page's global scope with generic names.
(function () {
  if (window.Harvest) return; // guard against double-injection

  const Harvest = {};

  Harvest.uuid = function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // Fallback for older Chromium contexts.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  Harvest.debounce = function debounce(fn, ms) {
    let t = null;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  Harvest.throttle = function throttle(fn, ms) {
    let last = 0;
    let pendingArgs = null;
    let timer = null;
    return function throttled(...args) {
      const now = Date.now();
      const remaining = ms - (now - last);
      if (remaining <= 0) {
        last = now;
        fn.apply(this, args);
      } else {
        pendingArgs = args;
        if (!timer) {
          timer = setTimeout(() => {
            last = Date.now();
            timer = null;
            fn.apply(this, pendingArgs);
          }, remaining);
        }
      }
    };
  };

  // Exact hostname, not eTLD+1 — www.x.com / x.com / accounts.x.com stay
  // separate folders by design (SPEC.md Section 8, confirmed by the
  // razorpay.com / accounts.razorpay.com example in the reference screenshot).
  Harvest.hostname = function hostname() {
    return window.location.hostname;
  };

  // Pattern 3 (design-tokens.md v2) — one pastel badge per capture type,
  // used identically everywhere a type appears: tooltip icon, tile/card
  // type chip, folder-cover fallback. The one deliberate, documented
  // exception to the single-accent rule, mandated by the reference images
  // rather than an ad hoc addition.
  Harvest.TYPE_BADGE = {
    color: { bg: "#FDE8E1", fg: "#C1552F" },
    font: { bg: "#EDEAFB", fg: "#5B4FC4" },
    image: { bg: "#DFF3EC", fg: "#1E8F72" },
    component: { bg: "#FBF0DC", fg: "#B07D1F" },
    // The 5th type (text-selection capture, notes.js) — a soft pastel
    // blue, the one hue not already used by the 4 above, same
    // lightness/saturation character as the rest of this set.
    note: { bg: "#E3EEFB", fg: "#2A6CA8" },
  };

  // Reference-02's folder grid: every card is a solid pastel tint, not
  // white, one tint per site. Deterministic per-hostname (same site always
  // lands on the same tone) rather than random-per-render or content-
  // derived (which would need real color-extraction work for a cosmetic
  // payoff). A simple string hash into a fixed 6-tone palette.
  // More saturated than the first pass — the original pastels were
  // reading as washed-out/vague rather than confidently colored once seen
  // at actual card size next to the white flap.
  const FOLDER_TINTS = [
    { bg: "#CFE0B8", ink: "#3E4A2E" },
    { bg: "#EFC3C3", ink: "#5C3636" },
    { bg: "#BFD0EB", ink: "#33445E" },
    { bg: "#D8C6F0", ink: "#4A3C6B" },
    { bg: "#F0C2D8", ink: "#6B3550" },
    { bg: "#BEE0DA", ink: "#2E4F49" },
  ];
  Harvest.folderTint = function folderTint(hostname) {
    let hash = 0;
    for (let i = 0; i < hostname.length; i++) {
      hash = (hash * 31 + hostname.charCodeAt(i)) | 0;
    }
    return FOLDER_TINTS[Math.abs(hash) % FOLDER_TINTS.length];
  };

  // The plain "two overlapping squares" component icon looks identical for
  // every single captured component, everywhere it's used as a thumbnail
  // (the tooltip's session stack, folder covers, library tiles) — with a
  // handful of components collected, there's no way to tell them apart at
  // a glance. A quick peek at the component's own stored outerHTML picks a
  // more specific icon (its actual dominant content) instead, without
  // needing a real rendered screenshot.
  // The "animated GIF served as an autoplay <video>" URL can live on the
  // element itself OR on a nested <source> with no src on the <video> tag
  // — content.js's actual capture path already checked both; the tooltip
  // preview only checked the element itself, so a <source>-only video
  // showed no thumbnail at all even though clicking Collect on it worked.
  Harvest.videoSrcFor = function videoSrcFor(el) {
    const sourceEl = el.querySelector("source");
    const direct = el.currentSrc || el.src || (sourceEl && sourceEl.src);
    if (direct) return direct;
    // Same lazy-load gap resolveImgSrc exists for, on the video side: sites
    // that defer heavy autoplay video ("GIF") sources until the tile is
    // about to be visible leave both the <video> and any <source> with no
    // src attribute at all until then, parking the real URL in a data-*
    // attribute instead — correctly classified as "Image (GIF)" with real
    // dimensions (readable from the tag regardless of load state), but a
    // completely empty preview box, since there was nothing here to fall
    // back to.
    const lazyAttrs = ["data-src", "data-lazy-src", "data-original", "data-lazy"];
    for (const attr of lazyAttrs) {
      const val = el.getAttribute(attr) || (sourceEl && sourceEl.getAttribute(attr));
      if (val) return val;
    }
    return null;
  };

  // SVG's own <image> leaf element (isImageish, tagger.js) has no .src IDL
  // property the way HTML's <img> does — its picture comes from an href
  // attribute instead (the modern SVG2 spec dropped the xlink: namespace
  // prefix, but xlink:href is still what many real-world SVGs, and older
  // export tools, actually emit — checked as a fallback, not a first
  // choice, since bare href wins when both happen to be present).
  Harvest.resolveSvgImageHref = function resolveSvgImageHref(el) {
    return el.getAttribute("href") || el.getAttribute("xlink:href") || null;
  };

  // videoSrcFor above can legitimately return a blob: URL (Pinterest's
  // "GIF" videos are MSE/HLS-streamed — data-test-id="duplo-hls-video" —
  // and .currentSrc is a MediaSource handle, not a static file). That
  // handle belongs to the ONE <video> element the page's own player bound
  // it to; copying the same string onto a second, independent <video>
  // (Harvest's own preview, or worse, a permanently saved item) never
  // loads anything — not a lazy-load or permission gap, a one-time-use
  // handle by design. A real, stable frame is usually sitting right there
  // anyway as the video's own `poster` attribute, so this returns THAT
  // instead when the real src turns out to be unusable outside its
  // originating element — as a plain static image, honestly reflecting
  // what can actually be captured, rather than a video reference that's
  // guaranteed to be dead the moment this tab closes.
  Harvest.resolveVideoOrPoster = function resolveVideoOrPoster(el) {
    const src = Harvest.videoSrcFor(el);
    if (src && !src.startsWith("blob:")) return { url: src, isVideo: true };
    const poster = el.getAttribute("poster");
    if (poster) return { url: poster, isVideo: false };
    return { url: src || null, isVideo: true };
  };

  // Many sites lazy-load images with a JS library (lazysizes and similar)
  // that leaves a real <img> tag's own src/currentSrc empty — or a tiny
  // inline placeholder — until it scrolls into view, parking the actual
  // URL in one of a handful of widely-used data-* attributes instead. A
  // tag-presence check (isImageish, componentIconFor) correctly says
  // "there's a photo here," but reading only .src/.currentSrc for the
  // actual URL then finds nothing — exactly the gap between "Contains:
  // Image" correctly showing and the preview underneath it staying
  // blank. Checked in the order a lazy-load library would realistically
  // populate them; the first one with content wins.
  // Grid/thumbnail views on some sites load a deliberately downsized image
  // (smaller payload for a small on-page tile) even though the site's own
  // CDN also serves the original at a predictable URL — capturing the
  // rendered <img> src as-is means "collect this photo" silently saves the
  // low-res thumbnail instead of the actual photo the user is researching.
  // Pinterest is the clearest, most common case a design-research tool
  // hits constantly: i.pinimg.com/{size}x/... where {size} is a fixed
  // thumbnail bucket (60x60, 236x, 474x, 736x...) and swapping that
  // segment for /originals/ is a stable, public convention for the
  // full-resolution upload — not a hack, just the CDN's own URL scheme.
  // Only rewrites URLs matching this exact known pattern; every other
  // site's src passes through unchanged.
  Harvest.upgradeImageUrl = function upgradeImageUrl(url) {
    if (!url) return url;
    const pinMatch = url.match(/^(https?:\/\/i\.pinimg\.com\/)\d+x\d*(\/.*)$/);
    if (pinMatch) return pinMatch[1] + "originals" + pinMatch[2];
    return url;
  };

  // The upgrade above is optimistic — not every pin actually has an
  // /originals/ file (older pins, or ones originally sourced from outside
  // Pinterest, may only ever have had a derivative size cached), so it can
  // point at a 404 where the plain thumbnail URL would have loaded fine.
  // One step back to /736x/ — a large-but-derivative size Pinterest keeps
  // for virtually every pin, originals or not — recovers almost every case
  // an <img>'s onerror hits after trying the upgraded URL first.
  Harvest.pinterestFallbackUrl = function pinterestFallbackUrl(url) {
    if (!url) return null;
    const match = url.match(/^(https?:\/\/i\.pinimg\.com\/)originals(\/.*)$/);
    if (!match) return null;
    return match[1] + "736x" + match[2];
  };

  // Wires the one-shot originals->736x recovery onto an <img> that was
  // given an upgradeImageUrl()'d src. Safe to call on any <img> regardless
  // of source — a no-op unless it's actually a Pinterest /originals/ URL,
  // and self-removing so a genuinely broken pin doesn't retry forever.
  Harvest.withPinterestFallback = function withPinterestFallback(imgEl, src) {
    const fallback = Harvest.pinterestFallbackUrl(src);
    if (!fallback) return;
    imgEl.addEventListener(
      "error",
      () => {
        imgEl.src = fallback;
      },
      { once: true }
    );
  };

  Harvest.resolveImgSrc = function resolveImgSrc(img) {
    const real = img.currentSrc || img.src;
    if (real) return Harvest.upgradeImageUrl(real);
    const lazyAttrs = ["data-src", "data-lazy-src", "data-original", "data-lazy", "data-srcset", "srcset"];
    for (const attr of lazyAttrs) {
      const val = img.getAttribute(attr);
      if (val) return Harvest.upgradeImageUrl(val.split(",")[0].trim().split(/\s+/)[0]);
    }
    return null;
  };

  // A real <img>/<video> is much stronger evidence of "this is a photo"
  // than any CSS background — image-grid sites very commonly wrap the
  // actual photo in a div that also carries its own gradient or tint
  // background (a lazy-load skeleton, a hover-darkening scrim for a Save
  // button, a decorative overlay), which used to get captured/previewed as
  // if that gradient itself were the content — a meaningless hex "color"
  // instead of the real photo sitting right there, requiring a click into
  // a detail view (where the real <img> renders on its own, uncovered)
  // before the real photo was reachable at all. Only matches when there's
  // exactly one real media element and no meaningful text of its own, so
  // this doesn't misfire on a card that merely happens to contain a small
  // thumbnail among a lot of unrelated text/UI.
  Harvest.findRealMediaChild = function findRealMediaChild(el) {
    const media = el.querySelectorAll("img, video");
    if (media.length === 1 && (el.textContent || "").trim().length === 0) {
      return media[0];
    }
    // The wrapper-contains-photo case above assumes the tint/gradient sits
    // on an ANCESTOR of the real photo. Grid sites (Pinterest's hover
    // save-button scrim is the clearest real-world example) instead stack a
    // separate, empty decorative div directly ON TOP of the photo as a
    // SIBLING — same parent, positioned/absolute so it's the topmost thing
    // at that point on screen — so a pure descendant search finds nothing
    // and the scrim's own gradient wins classification, even though a real
    // photo is sitting right there, one layer down. elementsFromPoint at
    // el's own center walks the actual paint stack at that point instead of
    // the DOM tree, so it finds a sibling/cousin photo the same way a
    // person looking at the screen would — "what's directly behind this."
    if ((el.textContent || "").trim().length > 0) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const stack = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    for (const node of stack) {
      if (node === el || el.contains(node)) continue;
      if (Harvest.isOwnNode(node)) break; // hit our own tooltip/toolbar — nothing real page content below is relevant
      if (/^(img|video)$/i.test(node.tagName)) return node;
    }
    return null;
  };

  Harvest.componentIconFor = function componentIconFor(outerHTML) {
    const html = outerHTML || "";
    // A real photo (img/picture/video) is an unambiguous "this is an
    // image" signal regardless of what else is nearby. An <svg>, on the
    // other hand, is very often just a small decorative icon sitting next
    // to real content (a chevron before a nav label, a checkmark before a
    // list item) — checking it before text presence meant a plain "icon +
    // label" row got classified as "image" purely because an SVG existed
    // anywhere in its markup, before the text (its actual content) was
    // ever considered. Text signals now win over a bare SVG; only an SVG
    // with no accompanying text still reads as "image" (a real icon tile).
    if (/<img[\s>]|<picture[\s>]|<video[\s>]/i.test(html)) return "image";
    // <text> — SVG's own text element, not related to HTML's <textarea> —
    // is genuine readable content the same way <p>/<span> are; some sites
    // build whole animated scenes (a live workflow demo, a data-viz
    // illustration) as one big SVG with all its labels rendered this way
    // rather than as real HTML tags. Without checking for it, a component
    // that's substantially TEXT (just SVG-native text) fell through to the
    // generic "any SVG present = image" rule below — the same bucket as a
    // small decorative icon, wrong for something that's mostly words.
    const hasText = /<h[1-6][\s>]|<p[\s>]|<span[\s>]|<button[\s>]|<a[\s>]|<text[\s>]/i.test(html);
    if (hasText) return "font";
    if (/<svg[\s>]/i.test(html)) return "image";
    return "component";
  };

  Harvest.escapeHtml = function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  Harvest.rgbToHex = function rgbToHex(rgbString) {
    const m = rgbString.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
    const [r, g, b, a = 1] = parts;
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    const hex = (n) => Math.round(n).toString(16).padStart(2, "0");
    return { hex: `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase(), r, g, b, a };
  };

  // A gradient background carries real, distinct design info (each stop's
  // own color) that a single flat "background color" reading silently
  // collapsed to just whichever value getComputedStyle(el).backgroundColor
  // happened to report (often just a fallback, not any stop at all). Pulls
  // every rgb()/rgba() color literal out of the raw backgroundImage string
  // in the order they appear, which is the order the stops are declared.
  Harvest.parseGradientStops = function parseGradientStops(bgImage) {
    if (!bgImage || !bgImage.includes("gradient")) return [];
    const matches = bgImage.match(/rgba?\([^)]+\)/g) || [];
    return matches.map((m) => Harvest.rgbToHex(m)).filter(Boolean).map((p) => p.hex);
  };

  // Same extraction as parseGradientStops above, but keeps each stop's
  // alpha instead of throwing it away — a real, confirmed bug (not the
  // hypothetical kind): a fade-to-transparent scrim over a photo (e.g.
  // `linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.85))`, an extremely
  // common "darken the bottom of an image for text legibility" pattern)
  // lost its transparent stop's alpha entirely, so the Figma plugin's
  // hexStopsToGradientPaint rendered BOTH ends fully opaque — a
  // transparent→black fade became a flat, solid black rectangle. This is
  // exactly what "gradient coming out black" and the black band under a
  // component's photo turned out to be. parseGradientStops (bare hex
  // strings) is left untouched — it only ever feeds the tooltip's own
  // color-swatch preview, where this doesn't matter — this is the version
  // the real Figma-bound component tree (walk(), content.js) uses.
  Harvest.parseGradientStopsWithAlpha = function parseGradientStopsWithAlpha(bgImage) {
    if (!bgImage || !bgImage.includes("gradient")) return [];
    const matches = bgImage.match(/rgba?\([^)]+\)/g) || [];
    return matches
      .map((m) => Harvest.rgbToHex(m))
      .filter(Boolean)
      .map((p) => ({ hex: p.hex, a: p.a }));
  };

  // The gradient's DIRECTION — separate from its stop colors above, and
  // previously never captured at all, which was a real, confirmed bug:
  // the plugin side always rendered every gradient as a flat horizontal
  // left-to-right band regardless of what the real CSS direction was, so
  // a common "dark fade at the bottom of a photo" vignette (a VERTICAL
  // gradient) rendered as a nonsensical horizontal black-to-white stripe
  // instead. Only resolves to the two cardinal axes actually handled on
  // the plugin side (see code.js's VERTICAL/HORIZONTAL transforms) — an
  // arbitrary diagonal angle falls back to "right", the same default this
  // always used before this fix existed, matching how CSS Grid and other
  // out-of-scope layout cases already fall back safely elsewhere in this
  // project rather than risk a wrong guess.
  Harvest.parseGradientDirection = function parseGradientDirection(bgImage) {
    if (!bgImage || !bgImage.includes("gradient")) return "down";
    const m = bgImage.match(/linear-gradient\(\s*(to\s+[a-z\s]+|-?[\d.]+deg)/i);
    if (!m) return "down"; // CSS default direction when none is specified is "to bottom"
    const token = m[1].trim().toLowerCase();
    if (token.startsWith("to")) {
      if (token.includes("top")) return "up";
      if (token.includes("bottom")) return "down";
      if (token.includes("left")) return "left";
      if (token.includes("right")) return "right";
      return "down";
    }
    const deg = ((parseFloat(token) % 360) + 360) % 360; // normalize to 0-360
    if (deg >= 45 && deg < 135) return "right";
    if (deg >= 135 && deg < 225) return "down";
    if (deg >= 225 && deg < 315) return "left";
    return "up";
  };

  Harvest.PII_PATTERN =
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\b\d{6,}\b/;

  // A component's `data.layoutTree` (content.js's extractComponentLayers)
  // is a nested tree of frame/text/rect/image/icon-placeholder nodes, not
  // a flat list — anything that only needs "what kinds of content are in
  // here" (the sidepanel's copy-description, previously read the old flat
  // `data.layers` directly) needs a flattened leaf list instead of the
  // tree shape. Shared here (not just in content.js) since both the
  // content-script world and the sidepanel load shared.js and both need
  // this same flattening.
  Harvest.flattenComponentTree = function flattenComponentTree(node, out) {
    out = out || [];
    if (!node) return out;
    if (node.kind !== "frame") {
      out.push(node);
      return out;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) Harvest.flattenComponentTree(child, out);
    }
    return out;
  };

  Harvest.cssSelectorFor = function cssSelectorFor(el) {
    if (!el || el.nodeType !== 1) return "";
    const parts = [el.tagName.toLowerCase()];
    if (el.id) parts.push(`#${el.id}`);
    else if (el.className && typeof el.className === "string" && el.className.trim()) {
      parts.push("." + el.className.trim().split(/\s+/).slice(0, 2).join("."));
    }
    return parts.join("");
  };

  // Shared registry of Harvest's own injected shadow-host roots (the
  // tooltip overlay, the floating toggle pill). Both need to be excluded
  // from hover-target detection in content.js — a single shared registry
  // means each module just registers its own host once, instead of
  // content.js needing to know about every UI piece individually.
  Harvest.ownRoots = [];
  Harvest.registerOwnRoot = function registerOwnRoot(node) {
    Harvest.ownRoots.push(node);
  };
  Harvest.isOwnNode = function isOwnNode(node) {
    return Harvest.ownRoots.some((root) => root && (node === root || root.contains(node)));
  };

  // One icon set, shared by every Harvest-owned surface (the floating
  // on-page toolbar AND the side panel) so "collapsed" and "expanded"
  // are genuinely the same design system at two sizes, not two different
  // UIs that happen to sit next to each other. Standard, generic UI
  // iconography (cursor/select tool, sidebar panel, grid/list density,
  // close) — not any product's brand mark.
  Harvest.ICONS = {
    cursor: `<svg viewBox="0 0 16 16" width="15" height="15"><path d="M2 1.3 13 6.3 7.6 7.9 6.1 13.4 2 1.3Z" fill="currentColor"/></svg>`,
    panel: `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2"/><line x1="10.4" y1="2.6" x2="10.4" y2="13.4"/></svg>`,
    // Nav-arrow glyphs for the tooltip's parent/child DOM-tree-walk
    // buttons. These used to be unicode ↑/↓ characters rendered via
    // textContent — reported as garbled ("â†'") in real testing. Real SVG
    // sidesteps the whole question of character encoding/font rendering
    // entirely, same reasoning as the other icons here.
    chevronUp: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10.5 8 5.5l4.5 5"/></svg>`,
    chevronDown: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5.5 8 10.5l4.5-5"/></svg>`,
    // "All sites" library view toggle, in the side panel's topbar.
    folder: `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2 4.2c0-.66.54-1.2 1.2-1.2h3l1.3 1.6h5.3c.66 0 1.2.54 1.2 1.2v6c0 .66-.54 1.2-1.2 1.2H3.2c-.66 0-1.2-.54-1.2-1.2V4.2Z"/></svg>`,
    plus: `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><line x1="8" y1="2.5" x2="8" y2="13.5"/><line x1="2.5" y1="8" x2="13.5" y2="8"/></svg>`,
    close: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>`,
    // Compare/Pairing view toggle — two stacked type samples.
    compare: `<svg viewBox="0 0 16 16" width="15" height="15"><text x="1.5" y="7.5" font-size="7" font-weight="700" fill="currentColor" font-family="Inter, sans-serif">Aa</text><text x="1.5" y="14.5" font-size="6" fill="currentColor" font-family="Inter, sans-serif">Aa</text></svg>`,
    // Export view toggle.
    download: `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8m0 0 3-3m-3 3-3-3"/><path d="M3 12.5v.8c0 .66.54 1.2 1.2 1.2h7.6c.66 0 1.2-.54 1.2-1.2v-.8"/></svg>`,
    chevronRight: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5 10.5 8l-5 4.5"/></svg>`,
    // Export view row icons — a leading icon-in-a-swatch per option
    // (matching the collection-picker-row pattern) instead of bare text,
    // so the export list reads as a set of distinct actions rather than a
    // flat stack of identical bordered rows.
    archive: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="3" rx="0.8"/><path d="M2.9 5.5v6.8c0 .66.54 1.2 1.2 1.2h7.8c.66 0 1.2-.54 1.2-1.2V5.5"/><line x1="6.3" y1="8.1" x2="9.7" y2="8.1" stroke-linecap="round"/></svg>`,
    image: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"><rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.6"/><circle cx="5.4" cy="6" r="1.15"/><path d="M2.4 11.4l3.4-3.4c.4-.4 1-.4 1.4 0l1.5 1.5m2.9-1.5l-1-1c-.4-.4-1-.4-1.4 0l-1 1"/></svg>`,
    // A real "T" glyph, not the literal letter T rendered as text — same
    // stroke language as design-extractor's own font-type badge (picker.js
    // ICON_FONT_D), adapted to this icon set's proportions.
    font: `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4.5 4.5h7M8 4.5v7"/></svg>`,
    // Two overlapping rounded squares — the exact same shape as this
    // tooltip's own "elements inside" metric icon (METRIC_ICONS.layers) two
    // rows down, reused here so "Component" reads as one consistent visual
    // idea (a nested structure) everywhere it shows up, not two different
    // glyphs claiming to mean the same thing.
    component: `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2" y="2" width="7.5" height="7.5" rx="1.3"/><rect x="6.5" y="6.5" width="7.5" height="7.5" rx="1.3"/></svg>`,
    // Same plain ring glyph the tooltip's color type-icon already uses
    // (overlay.js's METRIC_ICONS.ring) — shared here so the Library's tile
    // badges use the identical icon, not a re-invented one.
    ring: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6"/></svg>`,
    swatch: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2" y="6.4" width="8.4" height="7.2" rx="1.4"/><path d="M5.2 6.4V3.6c0-.66.54-1.2 1.2-1.2h6c.66 0 1.2.54 1.2 1.2v6c0 .66-.54 1.2-1.2 1.2h-2.8"/></svg>`,
    // Pattern 11 (design-tokens.md v2) — the one small personality touch on
    // Collection cards specifically (they're user-curated, unlike the
    // automatic per-site folders), a small pin badge in place of the
    // favicon a folder card shows there.
    pin: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.6 8 5.4M4.6 8.6h6.8L11 6.8a2 2 0 0 0-1.7-1H6.7a2 2 0 0 0-1.7 1L4.6 8.6Z"/><line x1="8" y1="8.6" x2="8" y2="14.4"/></svg>`,
    // sidePanel.open() is a known-flaky Chrome API (see background.js) —
    // shown briefly in place of the panel icon when a reopen attempt
    // fails, so the click visibly did something instead of looking dead.
    warning: `<svg viewBox="0 0 20 20" width="15" height="15" fill="none"><path d="M10 2.5 18 16.5H2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="14.5" r="0.9" fill="currentColor"/></svg>`,
    // Fallback for a folder card's favicon badge when the real favicon
    // fails to load — previously the badge just vanished on error, leaving
    // an empty gap in the corner instead of a designed failure state.
    globe: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="2.6" ry="6"/><line x1="2" y1="8" x2="14" y2="8"/></svg>`,
    // Small note/document glyph — indicates a tile has a note attached
    // (Library compact view), since the note text itself is too long to
    // show inline on a small square tile.
    note: `<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 1.8h6.2L12.5 5v9.2a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1Z"/><path d="M9.5 1.8V5h3"/><line x1="4.8" y1="8" x2="10.2" y2="8"/><line x1="4.8" y1="10.6" x2="8.6" y2="10.6"/></svg>`,
    // Collect-success checkmark — the one signature micro-interaction
    // moment (design-tokens.md), shown briefly on the Collect button/fab
    // right after a save succeeds, before the note field takes over.
    check: `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.3 12 13 4"/></svg>`,
    copy: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M3.5 10.5V3.7A1.2 1.2 0 0 1 4.7 2.5h6.8"/></svg>`,
    // "Copy as SVG" — code brackets, distinct from the generic clipboard
    // glyph above (used for "Copy as image"), so the two actions read as
    // different formats at a glance, not the same action twice.
    codeBrackets: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5 2 8l3.5 4.5M10.5 3.5 14 8l-3.5 4.5"/></svg>`,
    // Pencil — the sidepanel's edit-note affordance (add/edit an item's
    // note after it's already been captured, since the tooltip's own note
    // field only ever runs once, at capture time).
    edit: `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.4 2.6a1.4 1.4 0 0 1 2 2L5.4 11.6l-2.8.8.8-2.8 7-7Z"/></svg>`,
    // Trash can — the note editor's "Remove note" action (an icon-only
    // tertiary control now, not a text label competing with Cancel/Save).
    trash: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10"/><path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"/><path d="M4.5 4.5l.6 8.4a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.4"/><line x1="6.5" y1="7" x2="6.5" y2="11"/><line x1="9.5" y1="7" x2="9.5" y2="11"/></svg>`,
    // Small "external link" glyph — marks a captured note's source site so
    // a mixed multi-site list (the Notes tab, or a Collection spanning
    // several hosts) still shows at a glance where each one came from,
    // with a click straight back to it.
    externalLink: `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 3H3.6A1.1 1.1 0 0 0 2.5 4.1v8.3a1.1 1.1 0 0 0 1.1 1.1h8.3a1.1 1.1 0 0 0 1.1-1.1V9.4"/><path d="M9 2.5h4.5V7"/><line x1="13.2" y1="2.8" x2="7.3" y2="8.7"/></svg>`,
  };

  window.Harvest = Harvest;
})();
