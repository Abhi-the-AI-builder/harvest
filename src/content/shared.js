// Shared namespace + small helpers used by every content-script file.
// Plain scripts (no bundler) sharing one global on purpose — see PLAN.md
// assumption #1. Everything hangs off window.Acopio to avoid polluting
// the host page's global scope with generic names.
(function () {
  if (window.Acopio) return; // guard against double-injection

  const Acopio = {};

  Acopio.uuid = function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // Fallback for older Chromium contexts.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  Acopio.debounce = function debounce(fn, ms) {
    let t = null;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  Acopio.throttle = function throttle(fn, ms) {
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
  Acopio.hostname = function hostname() {
    return window.location.hostname;
  };

  // Pattern 3 (design-tokens.md v2) — one pastel badge per capture type,
  // used identically everywhere a type appears: tooltip icon, tile/card
  // type chip, folder-cover fallback. The one deliberate, documented
  // exception to the single-accent rule, mandated by the reference images
  // rather than an ad hoc addition.
  Acopio.TYPE_BADGE = {
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
  Acopio.folderTint = function folderTint(hostname) {
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
  Acopio.videoSrcFor = function videoSrcFor(el) {
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
  Acopio.resolveSvgImageHref = function resolveSvgImageHref(el) {
    return el.getAttribute("href") || el.getAttribute("xlink:href") || null;
  };

  // videoSrcFor above can legitimately return a blob: URL (Pinterest's
  // "GIF" videos are MSE/HLS-streamed — data-test-id="duplo-hls-video" —
  // and .currentSrc is a MediaSource handle, not a static file). That
  // handle belongs to the ONE <video> element the page's own player bound
  // it to; copying the same string onto a second, independent <video>
  // (Acopio's own preview, or worse, a permanently saved item) never
  // loads anything — not a lazy-load or permission gap, a one-time-use
  // handle by design. A real, stable frame is usually sitting right there
  // anyway as the video's own poster attribute, so this returns THAT
  // instead when the real src turns out to be unusable outside its
  // originating element — as a plain static image, honestly reflecting
  // what can actually be captured, rather than a video reference that's
  // guaranteed to be dead the moment this tab closes.
  Acopio.resolveVideoOrPoster = function resolveVideoOrPoster(el) {
    const src = Acopio.videoSrcFor(el);
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
  Acopio.upgradeImageUrl = function upgradeImageUrl(url) {
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
  Acopio.pinterestFallbackUrl = function pinterestFallbackUrl(url) {
    if (!url) return null;
    const match = url.match(/^(https?:\/\/i\.pinimg\.com\/)originals(\/.*)$/);
    if (!match) return null;
    return match[1] + "736x" + match[2];
  };

  // Wires the one-shot originals->736x recovery onto an <img> that was
  // given an upgradeImageUrl()'d src. Safe to call on any <img> regardless
  // of source — a no-op unless it's actually a Pinterest /originals/ URL,
  // and self-removing so a genuinely broken pin doesn't retry forever.
  Acopio.withPinterestFallback = function withPinterestFallback(imgEl, src) {
    const fallback = Acopio.pinterestFallbackUrl(src);
    if (!fallback) return;
    imgEl.addEventListener(
      "error",
      () => {
        imgEl.src = fallback;
      },
      { once: true }
    );
  };

  Acopio.resolveImgSrc = function resolveImgSrc(img) {
    const real = img.currentSrc || img.src;
    if (real) return Acopio.upgradeImageUrl(real);
    const lazyAttrs = ["data-src", "data-lazy-src", "data-original", "data-lazy", "data-srcset", "srcset"];
    for (const attr of lazyAttrs) {
      const val = img.getAttribute(attr);
      if (val) return Acopio.upgradeImageUrl(val.split(",")[0].trim().split(/\s+/)[0]);
    }
    return null;
  };

  // Snapshot an already-decoded <img> into a PNG data URL for Figma (plugin
  // has no network). Same-origin / CORS-enabled images work; tainted canvases
  // return null and export falls back to fetch or Collect screenshot.
  Acopio.rasterizeImgElement = function rasterizeImgElement(img) {
    try {
      if (!img || img.tagName.toLowerCase() !== "img") return null;
      if (!img.complete || img.naturalWidth < 1 || img.naturalHeight < 1) return null;
      const c = document.createElement("canvas");
      const maxEdge = 1024;
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/png");
    } catch (_) {
      return null;
    }
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
  Acopio.findRealMediaChild = function findRealMediaChild(el) {
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
      if (Acopio.isOwnNode(node)) break; // hit our own tooltip/toolbar — nothing real page content below is relevant
      if (/^(img|video)$/i.test(node.tagName)) return node;
    }
    return null;
  };

  Acopio.componentIconFor = function componentIconFor(outerHTML) {
    const html = outerHTML || "";
    // <text> — SVG's own text element, not related to HTML's <textarea> —
    // is genuine readable content the same way <p>/<span> are; some sites
    // build whole animated scenes (a live workflow demo, a data-viz
    // illustration) as one big SVG with all its labels rendered this way
    // rather than as real HTML tags. Without checking for it, a component
    // that's substantially TEXT (just SVG-native text) fell through to the
    // generic "any SVG present = image" rule below — the same bucket as a
    // small decorative icon, wrong for something that's mostly words.
    const hasTextTag = /<h[1-6][\s>]|<p[\s>]|<span[\s>]|<button[\s>]|<a[\s>]|<li[\s>]|<label[\s>]|<figcaption[\s>]|<text[\s>]/i.test(html);
    // Designer cards often put copy in plain <div>s — tag regex alone misses
    // them and collapses mixed photo+name cards to "image".
    const textOnly = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const hasText = hasTextTag || textOnly.length >= 3;
    const hasRaster = /<img[\s>]|<picture[\s>]|<video[\s>]/i.test(html);
    // Mixed media + readable copy must NOT collapse to "image" — that is
    // exactly the trust-breaking "Contains: Image" on designer cards that
    // clearly show name/title/years. Prefer the generic component bucket
    // so callers can inventory Image + Text honestly.
    if (hasRaster && hasText) return "component";
    if (hasRaster) return "image";
    // Text signals win over a bare SVG; only an SVG with no accompanying
    // text still reads as "image" (a real icon tile).
    if (hasText) return "font";
    if (/<svg[\s>]/i.test(html)) return "image";
    return "component";
  };

  /**
   * Honest content inventory for "Contains:" chips. Direct-child-only
   * labeling + componentIconFor(img-first) produced "Contains: Image" on
   * mixed cards (photo + name + years). Walk visible subtree signals.
   */
  Acopio.inventoryContainsLabels = function inventoryContainsLabels(root) {
    const labels = [];
    const seen = new Set();
    const push = (label) => {
      if (!label || seen.has(label)) return;
      seen.add(label);
      labels.push(label);
    };
    if (!root || root.nodeType !== 1) return labels;

    try {
      // Order matches what designers scan first: structure → copy → media → chrome.
      if (root.querySelector("h1, h2, h3, h4, h5, h6")) push("Heading");
      // Visible prose — prefer before Image so mixed designer cards don't
      // read as photo-only ("Contains: Image") when name/title are obvious.
      const text = (root.innerText || "").replace(/\s+/g, " ").trim();
      if (text.length >= 3) {
        const onlyMediaAlt =
          !root.querySelector(
            "h1, h2, h3, h4, h5, h6, p, span, li, label, figcaption, div"
          ) && text.length < 8;
        // div-only cards (name/role in plain divs) still count as Text when
        // there's a meaningful string beyond a tiny alt/badge.
        if (!onlyMediaAlt || text.length >= 12) push("Text");
      }
      const media = root.querySelector(
        "img, picture, video, svg image, [style*='background-image']"
      );
      if (media || (() => {
        try {
          const bg = window.getComputedStyle(root).backgroundImage || "";
          return /url\(/i.test(bg);
        } catch (_) {
          return false;
        }
      })()) {
        push("Image");
      }
      if (root.querySelector("svg") && !seen.has("Image")) push("Icon");
      if (root.querySelector("a[href]")) push("Link");
      if (root.querySelector("button, [role='button'], input, textarea, select")) {
        push("Button");
      }
    } catch (_) {}
    return labels;
  };

  /**
   * Union of border-box + descendant / text ink rects. getBoundingClientRect
   * alone misses overflow:visible captions/descenders painted outside the
   * border box — selection outline + screenshot then crop footers.
   * Clipped overflow (hidden/auto/scroll) is NOT expanded — marquee
   * duplicates outside a carousel must not inflate the hero frame to 2× width.
   */
  Acopio.measurePaintedBounds = function measurePaintedBounds(el) {
    if (!el || el.nodeType !== 1) {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    function clipChainFor(node) {
      const clips = [];
      let cur = node;
      while (cur && cur !== el) {
        try {
          if (cur.nodeType === 1) {
            const st = window.getComputedStyle(cur);
            const ox = st.overflowX || st.overflow;
            const oy = st.overflowY || st.overflow;
            const clipsX = ox === "hidden" || ox === "clip" || ox === "auto" || ox === "scroll";
            const clipsY = oy === "hidden" || oy === "clip" || oy === "auto" || oy === "scroll";
            if (clipsX || clipsY) {
              const r = cur.getBoundingClientRect();
              clips.push({ r, clipsX, clipsY });
            }
          }
        } catch (_) {}
        cur = cur.parentElement;
      }
      // Root itself may clip.
      try {
        const st = window.getComputedStyle(el);
        const ox = st.overflowX || st.overflow;
        const oy = st.overflowY || st.overflow;
        const clipsX = ox === "hidden" || ox === "clip" || ox === "auto" || ox === "scroll";
        const clipsY = oy === "hidden" || oy === "clip" || oy === "auto" || oy === "scroll";
        if (clipsX || clipsY) {
          clips.push({ r: el.getBoundingClientRect(), clipsX, clipsY });
        }
      } catch (_) {}
      return clips;
    }

    function intersectVisible(r, clips) {
      if (!r || r.width < 0.5 || r.height < 0.5) return null;
      let L = r.left;
      let T = r.top;
      let R = r.right;
      let B = r.bottom;
      for (const c of clips) {
        if (c.clipsX) {
          L = Math.max(L, c.r.left);
          R = Math.min(R, c.r.right);
        }
        if (c.clipsY) {
          T = Math.max(T, c.r.top);
          B = Math.min(B, c.r.bottom);
        }
      }
      if (R - L < 0.5 || B - T < 0.5) return null;
      return { left: L, top: T, right: R, bottom: B, width: R - L, height: B - T };
    }

    const include = (r, clips) => {
      const vis = intersectVisible(r, clips || []);
      if (!vis) return;
      left = Math.min(left, vis.left);
      top = Math.min(top, vis.top);
      right = Math.max(right, vis.right);
      bottom = Math.max(bottom, vis.bottom);
    };
    try {
      include(el.getBoundingClientRect(), []);
    } catch (_) {}

    const visit = (node) => {
      if (!node || node.nodeType !== 1) return;
      if (Acopio.isOwnNode && Acopio.isOwnNode(node)) return;
      try {
        const st = window.getComputedStyle(node);
        if (st.display === "none" || st.visibility === "hidden") return;
        if (parseFloat(st.opacity) === 0) return;
      } catch (_) {}
      const clips = clipChainFor(node);
      try {
        include(node.getBoundingClientRect(), clips);
      } catch (_) {}
      // Text ink (ascenders/descenders) often exceeds the CSS line box —
      // only expand when the text is not clipped away.
      try {
        for (const child of node.childNodes) {
          if (child.nodeType !== Node.TEXT_NODE) continue;
          if (!String(child.nodeValue || "").trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(child);
          const rects = Array.from(range.getClientRects());
          if (range.detach) range.detach();
          for (const r of rects) include(r, clips);
        }
      } catch (_) {}
      const kids =
        typeof Acopio.fidelityChildElements === "function"
          ? Acopio.fidelityChildElements(node)
          : Array.from(node.children || []);
      for (const kid of kids) visit(kid);
    };
    visit(el);

    if (!Number.isFinite(left)) {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    }
    // Pad so descenders/captions/shadows aren't flush with crop/outline edge.
    // 4px (scale) — 2px still clipped card-row captions in Figma paste.
    const PAD = 4;
    left -= PAD;
    top -= PAD;
    right += PAD;
    bottom += PAD;
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  };

  Acopio.escapeHtml = function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  Acopio.rgbToHex = function rgbToHex(rgbString) {
    if (!rgbString || typeof rgbString !== "string") return null;
    const trimmed = rgbString.trim();
    // Hex (#rgb / #rrggbb / #rrggbbaa)
    const hexMatch = trimmed.match(/^#([0-9a-f]{3,8})$/i);
    if (hexMatch) {
      let h = hexMatch[1];
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      if (h.length === 4) h = h.split("").map((c) => c + c).join("");
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return { hex: `#${h.slice(0, 6)}`.toUpperCase(), r, g, b, a };
    }
    const m = trimmed.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
    // Modern "r g b / a" space-separated form
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) {
      const sp = m[1].split(/[\s/]+/).map((s) => parseFloat(s)).filter((n) => !Number.isNaN(n));
      if (sp.length < 3) return null;
      const [r, g, b, a = 1] = sp;
      const hex = (n) => Math.round(n).toString(16).padStart(2, "0");
      return { hex: `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase(), r, g, b, a };
    }
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
  Acopio.parseGradientStops = function parseGradientStops(bgImage) {
    if (!bgImage || !bgImage.includes("gradient")) return [];
    const matches = bgImage.match(/rgba?\([^)]+\)|#(?:[0-9a-f]{3,8})\b/gi) || [];
    return matches.map((m) => Acopio.rgbToHex(m)).filter(Boolean).map((p) => p.hex);
  };

  // Same extraction as parseGradientStops above, but keeps each stop's
  // alpha instead of throwing it away — a real, confirmed bug (not the
  // hypothetical kind): a fade-to-transparent scrim over a photo (e.g.
  // linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.85)), an extremely
  // common "darken the bottom of an image for text legibility" pattern)
  // lost its transparent stop's alpha entirely, so the Figma plugin's
  // hexStopsToGradientPaint rendered BOTH ends fully opaque — a
  // transparent→black fade became a flat, solid black rectangle. This is
  // exactly what "gradient coming out black" and the black band under a
  // component's photo turned out to be. parseGradientStops (bare hex
  // strings) is left untouched — it only ever feeds the tooltip's own
  // color-swatch preview, where this doesn't matter — this is the version
  // the real Figma-bound component tree (walk(), content.js) uses.
  Acopio.parseGradientStopsWithAlpha = function parseGradientStopsWithAlpha(bgImage) {
    if (!bgImage || !bgImage.includes("gradient")) return [];
    const matches = bgImage.match(/rgba?\([^)]+\)|#(?:[0-9a-f]{3,8})\b/gi) || [];
    return matches
      .map((m) => Acopio.rgbToHex(m))
      .filter(Boolean)
      .map((p) => ({ hex: p.hex, a: p.a }));
  };

  /**
   * Full gradient descriptor for layoutTree / plugin:
   * type linear|radial|angular, direction, stops with optional positions.
   */
  Acopio.parseGradientDescriptor = function parseGradientDescriptor(bgImage) {
    if (!bgImage || !bgImage.includes("gradient")) return null;
    const raw = String(bgImage);
    let type = "linear";
    if (/repeating-radial-gradient|radial-gradient/i.test(raw)) type = "radial";
    else if (/repeating-conic-gradient|conic-gradient/i.test(raw)) type = "angular";

    const direction = type === "linear" ? Acopio.parseGradientDirection(raw) : "down";

    // Stop colors + optional % positions: "rgb(...) 40%" or "#fff 0%"
    const stopRe =
      /(rgba?\([^)]+\)|#(?:[0-9a-f]{3,8})\b)\s*(-?[\d.]+%)?/gi;
    const stops = [];
    let m;
    while ((m = stopRe.exec(raw)) !== null) {
      const parsed = Acopio.rgbToHex(m[1]);
      if (!parsed) continue;
      const pos =
        m[2] != null && m[2] !== ""
          ? Math.max(0, Math.min(1, parseFloat(m[2]) / 100))
          : null;
      stops.push({ hex: parsed.hex, a: parsed.a, position: pos });
    }
    if (stops.length < 2) {
      const fallback = Acopio.parseGradientStopsWithAlpha(raw);
      if (fallback.length < 2) return null;
      return {
        type,
        direction,
        stops: fallback.map((s, i) => ({
          hex: s.hex,
          a: s.a,
          position: i / (fallback.length - 1),
        })),
        css: raw.slice(0, 2000),
      };
    }
    // Fill missing positions evenly
    const withPos = stops.map((s, i) => ({
      hex: s.hex,
      a: s.a,
      position:
        s.position != null
          ? s.position
          : i / Math.max(1, stops.length - 1),
    }));
    return { type, direction, stops: withPos, css: raw.slice(0, 2000) };
  };

  /**
   * CSS transform → matrix + decomposed rotation/scale for Figma.
   */
  Acopio.parseCssTransform = function parseCssTransform(style, el) {
    const value = (style && style.transform) || (el && el.style && el.style.transform) || "";
    if (!value || value === "none") return null;
    let m;
    try {
      if (typeof DOMMatrixReadOnly === "function") m = new DOMMatrixReadOnly(value);
      else if (typeof DOMMatrix === "function") m = new DOMMatrix(value);
      else return null;
    } catch (_) {
      return null;
    }
    if (!m || (typeof m.isIdentity === "boolean" && m.isIdentity)) return null;
    const a = m.a;
    const b = m.b;
    const c = m.c;
    const d = m.d;
    const e = m.e;
    const f = m.f;
    if ([a, b, c, d, e, f].every((n) => Math.abs(n - (n === a || n === d ? 1 : 0)) < 1e-6)) {
      // identity-ish
      if (Math.abs(a - 1) < 1e-6 && Math.abs(d - 1) < 1e-6 && Math.abs(b) < 1e-6 && Math.abs(c) < 1e-6 && Math.abs(e) < 1e-6 && Math.abs(f) < 1e-6) {
        return null;
      }
    }
    const rotationDeg = (Math.atan2(b, a) * 180) / Math.PI;
    const scaleX = Math.hypot(a, b) || 1;
    const scaleY = Math.hypot(c, d) || 1;
    const out = {
      matrix: { a, b, c, d, e, f },
      rotationDeg: Number.isFinite(rotationDeg) ? rotationDeg : 0,
      scaleX,
      scaleY,
    };
    if (el && el.offsetWidth > 0) out.layoutWidth = el.offsetWidth;
    if (el && el.offsetHeight > 0) out.layoutHeight = el.offsetHeight;
    return out;
  };

  /**
   * Light DOM children + open shadow roots (web components).
   * Closed shadow stays invisible — same limit as the rest of the web.
   */
  Acopio.fidelityChildElements = function fidelityChildElements(el) {
    const out = [];
    if (!el || el.nodeType !== 1) return out;
    try {
      for (const child of Array.from(el.children || [])) out.push(child);
    } catch (_) {}
    try {
      if (el.shadowRoot) {
        for (const child of Array.from(el.shadowRoot.children || [])) out.push(child);
      }
    } catch (_) {}
    return out;
  };

  /**
   * Deep clone that inlines open shadow trees into the light DOM so
   * @figit/dom-to-figma (and freeze) can see them — html.to.design-style.
   */
  Acopio.cloneWithOpenShadows = function cloneWithOpenShadows(liveEl) {
    if (!liveEl || liveEl.nodeType !== 1) return null;
    const clone = liveEl.cloneNode(false);
    try {
      for (const node of Array.from(liveEl.childNodes || [])) {
        if (node.nodeType === 3 || node.nodeType === 8) {
          clone.appendChild(node.cloneNode(true));
        }
      }
    } catch (_) {}
    try {
      for (const child of Array.from(liveEl.children || [])) {
        const c = Acopio.cloneWithOpenShadows(child);
        if (c) clone.appendChild(c);
      }
    } catch (_) {}
    try {
      if (liveEl.shadowRoot) {
        for (const child of Array.from(liveEl.shadowRoot.children || [])) {
          const c = Acopio.cloneWithOpenShadows(child);
          if (!c) continue;
          c.setAttribute("data-acopio-shadow", "1");
          clone.appendChild(c);
        }
      }
    } catch (_) {}
    return clone;
  };

  function parseUnicodeRange(blockOrValue) {
    const m = String(blockOrValue || "").match(/unicode-range\s*:\s*([^;]+)/i);
    return (m && m[1].trim()) || "";
  }

  /** True when @font-face can paint basic Latin (A–z / space). Empty range = full face. */
  Acopio.unicodeRangeCoversBasicLatin = function unicodeRangeCoversBasicLatin(range) {
    const s = String(range || "").trim();
    if (!s) return true;
    const upper = s.toUpperCase();
    const re = /U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?/g;
    let m;
    while ((m = re.exec(upper)) !== null) {
      const start = parseInt(m[1], 16);
      const end = m[2] ? parseInt(m[2], 16) : start;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      // Space, digits, and A–z — marketing UI always needs these.
      if (start <= 0x20 && end >= 0x20) return true;
      if (start <= 0x30 && end >= 0x39) return true;
      if (start <= 0x41 && end >= 0x41) return true;
      if (start <= 0x61 && end >= 0x61) return true;
    }
    return false;
  };

  function latinHintFromUrls(urls) {
    const joined = (urls || []).join(" ").toLowerCase();
    if (/[\/=_-]latin(?:-ext)?[\/=_-]/.test(joined) || /latin\.woff/.test(joined)) return 2;
    if (/cyrillic|greek|vietnamese|devanagari|arabic|hebrew|thai|khmer|myanmar/.test(joined)) {
      return -4;
    }
    return 0;
  }

  function parseFontFacesFromCssText(cssText, baseHref) {
    const faces = [];
    if (!cssText) return faces;
    const faceRe = /@font-face\s*\{([\s\S]*?)\}/gi;
    let m;
    while ((m = faceRe.exec(cssText)) !== null) {
      const block = m[1];
      const familyMatch = block.match(/font-family\s*:\s*([^;]+)/i);
      if (!familyMatch) continue;
      const family = familyMatch[1].replace(/['"]/g, "").trim();
      if (!family) continue;
      const weightMatch = block.match(/font-weight\s*:\s*([^;]+)/i);
      const styleMatch = block.match(/font-style\s*:\s*([^;]+)/i);
      const srcMatch = block.match(/src\s*:\s*([^;]+)/i);
      const weight = (weightMatch && weightMatch[1].trim()) || "400";
      const fontStyle = (styleMatch && styleMatch[1].trim()) || "normal";
      const unicodeRange = parseUnicodeRange(block);
      const src = (srcMatch && srcMatch[1]) || "";
      const urls = [];
      const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
      let um;
      while ((um = urlRe.exec(src)) !== null) {
        try {
          urls.push(new URL(um[1], baseHref || location.href).href);
        } catch (_) {
          urls.push(um[1]);
        }
      }
      if (!urls.length) continue;
      const coversLatin = Acopio.unicodeRangeCoversBasicLatin(unicodeRange);
      faces.push({
        family,
        weight,
        style: fontStyle,
        urls,
        unicodeRange,
        coversLatin,
        latinScore: (coversLatin ? 10 : -20) + latinHintFromUrls(urls),
      });
    }
    return faces;
  }

  function fetchBytesViaExtension(url) {
    return new Promise((resolve) => {
      try {
        if (!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage)) {
          resolve(null);
          return;
        }
        chrome.runtime.sendMessage(
          { type: "FETCH_IMAGE_BYTES", payload: { url } },
          (response) => {
            if (chrome.runtime.lastError || !response || !response.ok || !response.bytes) {
              resolve(null);
              return;
            }
            resolve({
              bytes: new Uint8Array(response.bytes),
              contentType: response.contentType || "",
            });
          }
        );
      } catch (_) {
        resolve(null);
      }
    });
  }

  /**
   * Collect @font-face rules, including cross-origin sheets that block cssRules
   * (Google Fonts / CDN) — fetch stylesheet text via the extension.
   */
  Acopio.collectFontFaceRules = function collectFontFaceRules() {
    const faces = [];
    try {
      for (const sheet of Array.from(document.styleSheets || [])) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch (_) {
          continue;
        }
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
          const isFace =
            rule.type === 5 ||
            (rule.constructor && rule.constructor.name === "CSSFontFaceRule");
          if (!isFace || !rule.style) continue;
          const family = (rule.style.getPropertyValue("font-family") || "")
            .replace(/['"]/g, "")
            .trim();
          if (!family) continue;
          const src = rule.style.getPropertyValue("src") || "";
          const weight = rule.style.getPropertyValue("font-weight") || "400";
          const fontStyle = rule.style.getPropertyValue("font-style") || "normal";
          const unicodeRange = rule.style.getPropertyValue("unicode-range") || "";
          const urls = [];
          const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
          let um;
          while ((um = urlRe.exec(src)) !== null) {
            try {
              urls.push(new URL(um[1], sheet.href || location.href).href);
            } catch (_) {
              urls.push(um[1]);
            }
          }
          if (!urls.length) continue;
          const coversLatin = Acopio.unicodeRangeCoversBasicLatin(unicodeRange);
          faces.push({
            family,
            weight,
            style: fontStyle,
            urls,
            unicodeRange,
            coversLatin,
            latinScore: (coversLatin ? 10 : -20) + latinHintFromUrls(urls),
          });
        }
      }
    } catch (_) {}
    return faces;
  };

  Acopio.collectFontFaceRulesAsync = async function collectFontFaceRulesAsync() {
    const faces = Acopio.collectFontFaceRules().slice();
    const seenHref = new Set();
    const blockedHrefs = [];
    try {
      for (const sheet of Array.from(document.styleSheets || [])) {
        if (!sheet.href) continue;
        try {
          // Access throws for cross-origin sheets.
          void sheet.cssRules;
        } catch (_) {
          if (!seenHref.has(sheet.href)) {
            seenHref.add(sheet.href);
            blockedHrefs.push(sheet.href);
          }
        }
      }
    } catch (_) {}
    try {
      for (const link of Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))) {
        try {
          const href = new URL(link.href, location.href).href;
          if (!seenHref.has(href)) {
            // Prefer fetching all linked sheets that aren't already parsed —
            // cheap when already in faces via cssRules; blocked ones need this.
            let accessible = false;
            for (const sheet of Array.from(document.styleSheets || [])) {
              if (sheet.href === href) {
                try {
                  void sheet.cssRules;
                  accessible = true;
                } catch (_) {}
                break;
              }
            }
            if (!accessible) {
              seenHref.add(href);
              blockedHrefs.push(href);
            }
          }
        } catch (_) {}
      }
    } catch (_) {}

    for (const href of blockedHrefs.slice(0, 12)) {
      const got = await fetchBytesViaExtension(href);
      if (!got || !got.bytes || !got.bytes.length) continue;
      let text = "";
      try {
        text = new TextDecoder("utf-8").decode(got.bytes);
      } catch (_) {
        continue;
      }
      for (const face of parseFontFacesFromCssText(text, href)) {
        faces.push(face);
      }
    }
    return faces;
  };

  Acopio.familiesUsedUnder = function familiesUsedUnder(root) {
    const set = new Set();
    if (!root || root.nodeType !== 1) return set;
    const add = (el) => {
      try {
        const ff = window.getComputedStyle(el).fontFamily || "";
        const first = ff.split(",")[0].replace(/['"]/g, "").trim();
        if (first) set.add(first.toLowerCase());
      } catch (_) {}
    };
    const walk = (el) => {
      if (!el || el.nodeType !== 1) return;
      add(el);
      for (const child of Acopio.fidelityChildElements(el)) walk(child);
    };
    walk(root);
    return set;
  };

  /**
   * Fetch font bytes for families used under root (via extension for CORS).
   * Returns [{ family, weight, style, mimeType, dataUrl, coversLatin }].
   * Prefer latin-covering Google Fonts faces — subset files (cyrillic-ext etc.)
   * load "successfully" but paint invisible ASCII in Figma.
   */
  Acopio.harvestFontBytesForElement = async function harvestFontBytesForElement(root) {
    const used = Acopio.familiesUsedUnder(root);
    if (!used.size) return [];
    let rules = [];
    try {
      rules = await Acopio.collectFontFaceRulesAsync();
    } catch (_) {
      rules = Acopio.collectFontFaceRules();
    }
    rules = rules.filter((f) => used.has(String(f.family || "").toLowerCase()));
    // Best face per family+weight+style — never keep a non-latin subset when
    // a latin-covering URL exists for the same slot.
    const bestBySlot = new Map();
    for (const face of rules) {
      const slot = `${String(face.family).toLowerCase()}|${face.weight}|${String(face.style || "normal").toLowerCase()}`;
      const prev = bestBySlot.get(slot);
      const score = typeof face.latinScore === "number" ? face.latinScore : face.coversLatin === false ? -20 : 10;
      if (!prev || score > prev._score) {
        bestBySlot.set(slot, { ...face, _score: score });
      }
    }
    const ranked = Array.from(bestBySlot.values()).sort((a, b) => (b._score || 0) - (a._score || 0));
    const out = [];
    const seen = new Set();
    for (const face of ranked) {
      // Skip known non-latin subsets unless we have nothing else for the family.
      if (face.coversLatin === false) {
        const hasLatinForFamily = ranked.some(
          (f) =>
            String(f.family).toLowerCase() === String(face.family).toLowerCase() &&
            f.coversLatin !== false
        );
        if (hasLatinForFamily) continue;
      }
      for (const url of face.urls.slice(0, 2)) {
        const key = `${face.family}|${face.weight}|${face.style}|${url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          let bytes = null;
          let mime = "font/woff2";
          if (url.startsWith("data:")) {
            const res = await fetch(url);
            const buf = await res.arrayBuffer();
            bytes = new Uint8Array(buf);
            mime = (url.split(";")[0] || "").replace(/^data:/, "") || mime;
          } else {
            const got = await fetchBytesViaExtension(url);
            if (got && got.bytes && got.bytes.length) {
              bytes = got.bytes;
              mime = got.contentType || mime;
            }
          }
          if (!bytes || !bytes.length) continue;
          if (bytes.length > 1.5 * 1024 * 1024) continue;
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          }
          out.push({
            family: face.family,
            weight: face.weight,
            style: face.style,
            mimeType: mime,
            dataUrl: `data:${mime};base64,${btoa(binary)}`,
            coversLatin: face.coversLatin !== false,
          });
          break;
        } catch (_) {}
      }
      if (out.length >= 24) break;
    }
    return out;
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
  Acopio.parseGradientDirection = function parseGradientDirection(bgImage) {
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

  Acopio.PII_PATTERN =
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\b\d{6,}\b/;

  // A component's data.layoutTree (content.js's extractComponentLayers)
  // is a nested tree of frame/text/rect/image/icon-placeholder nodes, not
  // a flat list — anything that only needs "what kinds of content are in
  // here" (the sidepanel's copy-description, previously read the old flat
  // data.layers directly) needs a flattened leaf list instead of the
  // tree shape. Shared here (not just in content.js) since both the
  // content-script world and the sidepanel load shared.js and both need
  // this same flattening.
  Acopio.flattenComponentTree = function flattenComponentTree(node, out) {
    out = out || [];
    if (!node) return out;
    if (node.kind !== "frame") {
      out.push(node);
      return out;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) Acopio.flattenComponentTree(child, out);
    }
    return out;
  };

  Acopio.cssSelectorFor = function cssSelectorFor(el) {
    if (!el || el.nodeType !== 1) return "";
    const parts = [el.tagName.toLowerCase()];
    if (el.id) parts.push(`#${el.id}`);
    else if (el.className && typeof el.className === "string" && el.className.trim()) {
      parts.push("." + el.className.trim().split(/\s+/).slice(0, 2).join("."));
    }
    return parts.join("");
  };

  // Shared registry of Acopio's own injected shadow-host roots (the
  // tooltip overlay, the floating toggle pill). Both need to be excluded
  // from hover-target detection in content.js — a single shared registry
  // means each module just registers its own host once, instead of
  // content.js needing to know about every UI piece individually.
  Acopio.ownRoots = [];
  Acopio.registerOwnRoot = function registerOwnRoot(node) {
    Acopio.ownRoots.push(node);
  };
  Acopio.isOwnNode = function isOwnNode(node) {
    return Acopio.ownRoots.some((root) => root && (node === root || root.contains(node)));
  };

  // One icon set, shared by every Acopio-owned surface (the floating
  // on-page toolbar AND the side panel) so "collapsed" and "expanded"
  // are genuinely the same design system at two sizes, not two different
  // UIs that happen to sit next to each other. Standard, generic UI
  // iconography (cursor/select tool, sidebar panel, grid/list density,
  // close) — not any product's brand mark.
  Acopio.ICONS = {
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
    folder: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"><path d="M2 4.4c0-.77.63-1.4 1.4-1.4h2.7l1.35 1.55h5.15c.77 0 1.4.63 1.4 1.4v5.65c0 .77-.63 1.4-1.4 1.4H3.4c-.77 0-1.4-.63-1.4-1.4V4.4Z"/></svg>`,
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

  // GitHub-style folder-menu portal CSS — shared by Sites tooltip (overlay.js)
  // and Notes capture (notes.js) so both pickers stay visually identical.
  Acopio.ensureFolderMenuPortalStyles = function ensureFolderMenuPortalStyles() {
    const existing = document.getElementById("acopio-folder-menu-styles");
    if (existing) existing.remove();
    const el = document.createElement("style");
    el.id = "acopio-folder-menu-styles";
    el.textContent = `
      .acopio-folder-menu {
        position: fixed; z-index: 2147483647; width: 280px; max-height: 320px;
        overflow-y: auto; background: #ffffff; border: 1px solid #d0d7de;
        border-radius: 12px; box-shadow: 0 1px 3px rgba(140,149,159,0.15), 0 8px 24px rgba(140,149,159,0.2);
        padding: 8px; display: flex; flex-direction: column; gap: 0; pointer-events: auto;
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
        color: #1f2328; font-size: 14px; line-height: 20px;
      }
      .acopio-folder-menu .folder-menu-heading {
        padding: 6px 8px 4px; font-size: 12px; font-weight: 600; line-height: 16px; color: #656d76;
      }
      .acopio-folder-menu .folder-menu-empty {
        padding: 6px 8px 8px; font-size: 12px; line-height: 16px; color: #656d76;
      }
      .acopio-folder-menu .folder-menu-item {
        display: flex; align-items: center; gap: 8px; width: 100%;
        border: none; background: transparent; text-align: left; cursor: pointer;
        padding: 6px 8px; border-radius: 6px; font: inherit; font-size: 14px; line-height: 20px;
        color: #1f2328; box-sizing: border-box;
      }
      .acopio-folder-menu .folder-menu-item:hover { background: #f3f4f6; }
      .acopio-folder-menu .folder-menu-item[aria-checked="true"] {
        background: #ddf4ff; color: #0969da; font-weight: 600;
      }
      .acopio-folder-menu .folder-menu-item-label {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1;
      }
      .acopio-folder-menu .folder-menu-item-icon {
        width: 16px; height: 16px; flex: none; display: flex; align-items: center; justify-content: center;
        color: #656d76; overflow: hidden; border-radius: 3px;
      }
      .acopio-folder-menu .folder-menu-item[aria-checked="true"] .folder-menu-item-icon { color: #0969da; }
      .acopio-folder-menu .folder-menu-item-icon svg { width: 14px; height: 14px; }
      .acopio-folder-menu .folder-menu-item-icon img { width: 14px; height: 14px; object-fit: contain; display: block; }
      .acopio-folder-menu .folder-menu-item-check { margin-left: auto; flex: none; display: none; color: #0969da; }
      .acopio-folder-menu .folder-menu-item[aria-checked="true"] .folder-menu-item-check { display: flex; }
      .acopio-folder-menu .folder-menu-item-check svg { width: 12px; height: 12px; }
      .acopio-folder-menu .folder-menu-divider { height: 1px; background: #d0d7de; margin: 8px 0; border: 0; }
      .acopio-folder-menu .folder-menu-new-form {
        display: flex; gap: 8px; padding: 4px 0 0; align-items: stretch;
      }
      .acopio-folder-menu .folder-menu-new-input {
        flex: 1; min-width: 0; height: 32px; box-sizing: border-box;
        border: 1px solid #d0d7de; border-radius: 6px;
        padding: 5px 12px; font: inherit; font-size: 14px; line-height: 20px;
        color: #1f2328; background: #ffffff; outline: none;
        box-shadow: inset 0 1px 0 rgba(208,215,222,0.2);
      }
      .acopio-folder-menu .folder-menu-new-input::placeholder { color: #656d76; }
      .acopio-folder-menu .folder-menu-new-input:focus {
        border-color: #0969da; outline: none;
        box-shadow: inset 0 1px 0 rgba(208,215,222,0.2), 0 0 0 3px rgba(9,105,218,0.3);
      }
      .acopio-folder-menu .folder-menu-new-confirm {
        width: 32px; height: 32px; box-sizing: border-box; border: 1px solid rgba(27,31,36,0.15);
        border-radius: 6px; flex: none; background: #1f2328; color: #ffffff;
        display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
      }
      .acopio-folder-menu .folder-menu-new-confirm:hover { background: #2f363d; }
      .acopio-folder-menu .folder-menu-new-confirm svg { width: 12px; height: 12px; }
      .acopio-folder-menu .folder-menu-new-confirm:disabled { opacity: 0.5; cursor: default; }
    `;
    document.documentElement.appendChild(el);
  };

  // Host → favicon data URL from background (_favicon → data URL). Data URLs
  // are CSP-safe in content-script UI; chrome-extension://_favicon/ imgs are not.
  const siteFaviconByHost = new Map();

  Acopio.rememberSiteFavicons = function rememberSiteFavicons(folders) {
    (folders || []).forEach((f) => {
      if (f && f.hostname && f.faviconDataUrl) {
        siteFaviconByHost.set(f.hostname, f.faviconDataUrl);
      }
    });
  };

  Acopio.pageFaviconHref = function pageFaviconHref() {
    try {
      const selectors = [
        'link[rel="icon"]',
        'link[rel="shortcut icon"]',
        'link[rel="apple-touch-icon"]',
        'link[rel="apple-touch-icon-precomposed"]',
        'link[rel*="icon"]',
      ];
      for (const sel of selectors) {
        const link = document.querySelector(sel);
        if (link && link.href) return link.href;
      }
      return new URL("/favicon.ico", location.origin).href;
    } catch (_) {
      return "";
    }
  };

  Acopio.requestSiteFavicon = function requestSiteFavicon(hostname) {
    return new Promise((resolve) => {
      if (!hostname) {
        resolve("");
        return;
      }
      const cached = siteFaviconByHost.get(hostname);
      if (cached) {
        resolve(cached);
        return;
      }
      try {
        chrome.runtime.sendMessage(
          { type: "GET_SITE_FAVICON", payload: { hostname } },
          (response) => {
            if (chrome.runtime.lastError || !response || !response.ok || !response.faviconDataUrl) {
              resolve("");
              return;
            }
            siteFaviconByHost.set(hostname, response.faviconDataUrl);
            resolve(response.faviconDataUrl);
          }
        );
      } catch (_) {
        resolve("");
      }
    });
  };

  Acopio.fillSiteFavicon = function fillSiteFavicon(containerEl, hostname) {
    if (!containerEl) return;
    if (typeof containerEl._acopioFaviconCancel === "function") {
      containerEl._acopioFaviconCancel();
    }
    containerEl.classList.add("is-site");
    containerEl.innerHTML = Acopio.ICONS.globe || Acopio.ICONS.folder;

    const host = hostname || Acopio.hostname();
    const candidates = [];
    const cached = siteFaviconByHost.get(host);
    if (cached) candidates.push(cached);
    // Live page icon only matches the current tab's host.
    if (!hostname || host === Acopio.hostname()) {
      const pageIcon = Acopio.pageFaviconHref();
      if (pageIcon && !candidates.includes(pageIcon)) candidates.push(pageIcon);
    }

    let attempt = 0;
    let cancelled = false;
    let askedBackground = false;
    const applySrc = (src) => {
      if (cancelled || !src) return;
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.addEventListener("error", () => tryNext());
      img.addEventListener("load", () => {
        if (cancelled) return;
        containerEl.innerHTML = "";
        containerEl.appendChild(img);
      });
      img.src = src;
    };
    const tryNext = () => {
      if (cancelled) return;
      if (attempt < candidates.length) {
        applySrc(candidates[attempt++]);
        return;
      }
      if (!askedBackground && host) {
        askedBackground = true;
        Acopio.requestSiteFavicon(host).then((dataUrl) => {
          if (dataUrl && dataUrl !== cached) applySrc(dataUrl);
        });
      }
    };
    containerEl._acopioFaviconCancel = () => {
      cancelled = true;
    };
    tryNext();
  };

  // After chrome://extensions Reload, an extension update, or a very long-lived
  // tab whose injected scripts went stale, chrome.runtime.id is gone and every
  // chrome.* call throws "Extension context invalidated". Asking the user to
  // refresh manually is easy to miss — auto-reload THIS tab once so content
  // scripts reinject. Guarded so a broken page can't loop forever.
  Acopio.isRuntimeAlive = function isRuntimeAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  };

  Acopio.isContextInvalidatedError = function isContextInvalidatedError(err) {
    const msg = String((err && err.message) || err || "");
    return /extension context invalidated/i.test(msg);
  };

  Acopio.reloadPageForStaleExtension = function reloadPageForStaleExtension() {
    if (Acopio.isRuntimeAlive()) return false;
    const KEY = "acopioStaleReloadAt";
    try {
      const last = Number(sessionStorage.getItem(KEY) || 0);
      if (Number.isFinite(last) && Date.now() - last < 20000) return false;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch (_) {
      // sessionStorage blocked — still attempt one reload
    }
    try {
      console.info("[Acopio] Extension context lost — refreshing this page to reconnect.");
    } catch (_) {}
    setTimeout(() => {
      try {
        location.reload();
      } catch (_) {}
    }, 350);
    return true;
  };

  // Type metrics only — color sits on its own line (Figma paste + plain text).
  Acopio.fontMetricsLine = function fontMetricsLine(data) {
    if (!data || typeof data !== "object") return "";
    const parts = [];
    if (data.family) parts.push(data.family);
    if (data.weight) parts.push(String(data.weight));
    if (data.sizePx) parts.push(`${Math.round(data.sizePx)}px`);
    if (data.lineHeightPx) parts.push(`${Math.round(data.lineHeightPx)}px line-height`);
    if (data.letterSpacingPx != null && Number(data.letterSpacingPx) !== 0) {
      parts.push(`${data.letterSpacingPx}px tracking`);
    }
    return parts.join(", ");
  };

  Acopio.fontColorHex = function fontColorHex(data) {
    if (!data || !data.colorHex) return "";
    return String(data.colorHex).toUpperCase();
  };

  // Figma's own paste rendering silently substitutes any font it doesn't
  // have installed — that happens entirely inside Figma after the paste
  // completes, with no hook this extension (or any clipboard-based tool)
  // can reach to stop it. The only thing achievable from here is warning
  // BEFORE that happens: a family declared via a real @font-face rule
  // (the site bundled its own font file, e.g. a Framer/Webflow custom
  // brand typeface) is a font almost certainly absent anywhere else,
  // unlike a plain system-stack name (Arial, Georgia, "Segoe UI"...)
  // that's near-universally available. Checked by scanning actual
  // stylesheet rules rather than guessing from the name — cross-origin
  // stylesheets throw reading .cssRules without CORS, so those are
  // silently skipped rather than treated as a false "not custom".
  Acopio.isCustomWebFont = function isCustomWebFont(family) {
    const target = String(family || "").trim().toLowerCase().replace(/^["']|["']$/g, "");
    if (!target) return false;
    try {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch (_) {
          continue; // cross-origin stylesheet — can't inspect, don't guess
        }
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
          if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
          const declared = (rule.style.getPropertyValue("font-family") || "")
            .trim()
            .toLowerCase()
            .replace(/^["']|["']$/g, "");
          if (declared === target) return true;
        }
      }
    } catch (_) {}
    return false;
  };

  Acopio.fontSamplePlainText = function fontSamplePlainText(data) {
    const sample = (data && data.sampleText && String(data.sampleText).trim()) || (data && data.family) || "Aa";
    const metrics = Acopio.fontMetricsLine(data);
    const color = Acopio.fontColorHex(data);
    const lines = [sample];
    if (metrics) lines.push(metrics);
    if (color) lines.push(color);
    return lines.join("\n");
  };

  // Approximate glyph width for SVG layout (canvas when available).
  Acopio.measureTextWidthPx = function measureTextWidthPx(text, fontCss) {
    const str = String(text || "");
    if (!str) return 0;
    try {
      if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.font = fontCss;
          return ctx.measureText(str).width;
        }
      }
    } catch (_) {
      // fall through
    }
    const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(fontCss || "");
    const size = sizeMatch ? Number(sizeMatch[1]) : 16;
    return str.length * size * 0.56;
  };

  Acopio.wrapTextToWidth = function wrapTextToWidth(text, maxWidth, fontCss) {
    const raw = String(text || "").trim() || "Aa";
    const words = raw.split(/\s+/);
    if (words.length === 0) return [raw];
    const lines = [];
    let current = "";
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (Acopio.measureTextWidthPx(next, fontCss) <= maxWidth || !current) {
        current = next;
      } else {
        lines.push(current);
        current = word;
      }
    });
    if (current) lines.push(current);
    // Hard-break a single overlong token so the frame never clips mid-glyph run.
    const out = [];
    lines.forEach((line) => {
      if (Acopio.measureTextWidthPx(line, fontCss) <= maxWidth) {
        out.push(line);
        return;
      }
      let chunk = "";
      for (const ch of line) {
        const trial = chunk + ch;
        if (Acopio.measureTextWidthPx(trial, fontCss) <= maxWidth || !chunk) {
          chunk = trial;
        } else {
          out.push(chunk);
          chunk = ch;
        }
      }
      if (chunk) out.push(chunk);
    });
    return out.length ? out : [raw];
  };

  Acopio.fontInlineStyle = function fontInlineStyle(data) {
    const d = data || {};
    const parts = [];
    if (d.fallbackStack || d.family) parts.push(`font-family:${d.fallbackStack || d.family}`);
    if (d.weight) parts.push(`font-weight:${d.weight}`);
    if (d.sizePx) parts.push(`font-size:${Math.round(d.sizePx)}px`);
    if (d.lineHeightPx) parts.push(`line-height:${Math.round(d.lineHeightPx)}px`);
    if (d.letterSpacingPx != null && !Number.isNaN(Number(d.letterSpacingPx))) {
      parts.push(`letter-spacing:${d.letterSpacingPx}px`);
    }
    if (d.colorHex) parts.push(`color:${d.colorHex}`);
    return parts.join(";");
  };

  Acopio.fontStyledHtmlFragment = function fontStyledHtmlFragment(data, opts) {
    const sample =
      (data && data.sampleText && String(data.sampleText).trim()) || (data && data.family) || "Aa";
    const style = Acopio.fontInlineStyle(data);
    // 16px between stacked heading+body blocks (spacing scale); last block
    // can pass { marginBottom: 0 } via fontsStackedHtmlDocument.
    const mb =
      opts && opts.marginBottom != null ? Number(opts.marginBottom) : 16;
    const ranges = data && Array.isArray(data.ranges) ? data.ranges : null;
    if (!ranges || ranges.length < 2) {
      return `<div style="${style};margin:0 0 ${mb}px 0;white-space:pre-wrap;">${Acopio.escapeHtml(sample)}</div>`;
    }
    const parts = [];
    let at = 0;
    const sorted = ranges.slice().sort((a, b) => a.start - b.start);
    const push = (start, end, weight, color, family, sizePx) => {
      if (end <= start) return;
      const css = [
        `font-family:${family || data.fallbackStack || data.family || "sans-serif"}`,
        `font-weight:${weight || data.weight || 400}`,
        `font-size:${Math.round(sizePx || data.sizePx || 16)}px`,
        color ? `color:${color}` : data.colorHex ? `color:${data.colorHex}` : null,
      ]
        .filter(Boolean)
        .join(";");
      parts.push(`<span style="${css}">${Acopio.escapeHtml(sample.slice(start, end))}</span>`);
    };
    sorted.forEach((r) => {
      if (r.start > at) push(at, r.start, data.weight, data.colorHex, data.fallbackStack || data.family, data.sizePx);
      push(r.start, r.end, r.fontWeight, r.color, r.fontFamily, r.fontSizePx);
      at = Math.max(at, r.end);
    });
    if (at < sample.length) push(at, sample.length, data.weight, data.colorHex, data.fallbackStack || data.family, data.sizePx);
    return `<div style="margin:0 0 ${mb}px 0;white-space:pre-wrap;line-height:${data.lineHeightPx ? Math.round(data.lineHeightPx) + "px" : "1.25"}">${parts.join("")}</div>`;
  };

  Acopio.fontsStackedHtmlDocument = function fontsStackedHtmlDocument(fontDatas) {
    const list = Array.isArray(fontDatas) ? fontDatas.filter(Boolean) : [];
    // Heading block then body block with 16px gap — Figma HTML paste keeps
    // each as editable styled text, not one flat screenshot.
    const body = list
      .map((d, i) =>
        Acopio.fontStyledHtmlFragment(d, {
          marginBottom: i < list.length - 1 ? 16 : 0,
        })
      )
      .join("");
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
  };

  Acopio.fontsStackedHtmlBody = function fontsStackedHtmlBody(fontDatas) {
    const list = Array.isArray(fontDatas) ? fontDatas.filter(Boolean) : [];
    return list
      .map((d, i) =>
        Acopio.fontStyledHtmlFragment(d, {
          marginBottom: i < list.length - 1 ? 16 : 0,
        })
      )
      .join("");
  };

  Acopio.colorSwatchSvgMarkup = function colorSwatchSvgMarkup(data, opts) {
    const d = data || {};
    const w = (opts && opts.width) || 240;
    const h = (opts && opts.height) || 160;
    const css = d.isGradient && typeof d.gradientStops === "string" ? d.gradientStops : "";
    const stops = css ? Acopio.parseGradientStops(css) : [];
    if (stops.length >= 2) {
      const dir = Acopio.parseGradientDirection(css);
      let x1 = "0%", y1 = "0%", x2 = "100%", y2 = "0%";
      if (dir === "down") {
        x2 = "0%";
        y2 = "100%";
      } else if (dir === "up") {
        y1 = "100%";
        x2 = "0%";
        y2 = "0%";
      } else if (dir === "left") {
        x1 = "100%";
        x2 = "0%";
      }
      const stopEls = stops
        .map((hex, i) => {
          const offset = Math.round((i / (stops.length - 1)) * 100);
          return `<stop offset="${offset}%" stop-color="${Acopio.escapeHtml(hex)}"/>`;
        })
        .join("");
      const label = Acopio.escapeHtml(`Gradient · ${stops.length} stops`);
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
        `<defs><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stopEls}</linearGradient></defs>` +
        `<rect x="0" y="0" width="${w}" height="${h}" rx="8" fill="url(#g)"/>` +
        `<text x="16" y="${h - 16}" font-family="Inter,Helvetica,Arial,sans-serif" font-size="14" font-weight="600" fill="#17181A">${label}</text>` +
        `</svg>`
      );
    }
    const hex = (d.hex || "#CCCCCC").toUpperCase();
    const label = Acopio.escapeHtml(hex);
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect x="0" y="0" width="${w}" height="${h}" rx="8" fill="${hex}"/>` +
      `<text x="16" y="${h - 16}" font-family="Inter,Helvetica,Arial,sans-serif" font-size="14" font-weight="600" fill="#17181A">${label}</text>` +
      `</svg>`
    );
  };

  Acopio.colorsSwatchSvgMarkup = function colorsSwatchSvgMarkup(colorDatas) {
    const list = Array.isArray(colorDatas) ? colorDatas.filter(Boolean) : [];
    if (list.length === 0) return Acopio.colorSwatchSvgMarkup({});
    if (list.length === 1) return Acopio.colorSwatchSvgMarkup(list[0]);
    const cellW = 240;
    const cellH = 100;
    const gap = 8;
    const totalH = list.length * cellH + (list.length - 1) * gap;
    const rows = list
      .map((d, i) => {
        const hex = ((d && d.hex) || "#CCCCCC").toUpperCase();
        const y = i * (cellH + gap);
        return (
          `<g transform="translate(0 ${y})">` +
          `<rect width="${cellW}" height="${cellH}" rx="8" fill="${hex}"/>` +
          `<text x="16" y="${cellH - 16}" font-family="Inter,Helvetica,Arial,sans-serif" font-size="13" font-weight="600" fill="#17181A">${Acopio.escapeHtml(hex)}</text>` +
          `</g>`
        );
      })
      .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${cellW}" height="${totalH}" viewBox="0 0 ${cellW} ${totalH}">${rows}</svg>`;
  };

  // Typography board for Figma paste: <text> nodes stay editable text
  // (proven path — same technique as copy-to-figma / raw SVG clipboard).
  // Frame width grows with the sample (no manual resize). Color hex is a
  // separate row with a swatch — not appended to the metrics line.
  // Mixed bold/regular runs (`data.ranges`) become <tspan>s so Figma paste
  // keeps weight instead of flattening to the root font-weight.
  Acopio.fontBoardSvgMarkup = function fontBoardSvgMarkup(fontDatas) {
    const list = (Array.isArray(fontDatas) ? fontDatas : [fontDatas]).filter(Boolean);
    const PAD_X = 24;
    const MIN_W = 480;
    const MAX_W = 1600;
    const META_SIZE = 12;
    const metaFont = `500 ${META_SIZE}px Inter, Helvetica, Arial, sans-serif`;

    function measureRunsWidth(text, ranges, familyCss, size, weight) {
      if (!ranges || ranges.length < 2) {
        return Acopio.measureTextWidthPx(text, `${weight} ${size}px ${familyCss}`);
      }
      let w = 0;
      let at = 0;
      const sorted = ranges.slice().sort((a, b) => a.start - b.start);
      const measureSlice = (start, end, runWeight, runFamily, runSize) => {
        if (end <= start) return;
        w += Acopio.measureTextWidthPx(
          text.slice(start, end),
          `${runWeight || weight} ${runSize || size}px ${runFamily || familyCss}`
        );
      };
      sorted.forEach((r) => {
        if (r.start > at) measureSlice(at, r.start, weight, familyCss, size);
        measureSlice(r.start, r.end, r.fontWeight, r.fontFamily, r.fontSizePx ? Math.round(r.fontSizePx) : size);
        at = Math.max(at, r.end);
      });
      if (at < text.length) measureSlice(at, text.length, weight, familyCss, size);
      return w;
    }

    function tspansMarkup(text, ranges, defaults) {
      const sorted = ranges.slice().sort((a, b) => a.start - b.start);
      const parts = [];
      let at = 0;
      const push = (start, end, run) => {
        if (end <= start) return;
        const fam = Acopio.escapeHtml(run.family || defaults.family);
        const wt = Acopio.escapeHtml(String(run.weight || defaults.weight));
        const fill = Acopio.escapeHtml(run.fill || defaults.fill);
        const sz = Math.round(run.size || defaults.size);
        parts.push(
          `<tspan font-family="${fam}" font-size="${sz}" font-weight="${wt}" fill="${fill}">${Acopio.escapeHtml(text.slice(start, end))}</tspan>`
        );
      };
      sorted.forEach((r) => {
        if (r.start > at) {
          push(at, r.start, {
            family: defaults.family,
            weight: defaults.weight,
            fill: defaults.fill,
            size: defaults.size,
          });
        }
        push(r.start, r.end, {
          family: r.fontFamily || defaults.family,
          weight: r.fontWeight || defaults.weight,
          fill: r.color || defaults.fill,
          size: r.fontSizePx || defaults.size,
        });
        at = Math.max(at, r.end);
      });
      if (at < text.length) {
        push(at, text.length, {
          family: defaults.family,
          weight: defaults.weight,
          fill: defaults.fill,
          size: defaults.size,
        });
      }
      return parts.join("");
    }

    let neededW = MIN_W;
    const prepared = list.map((d) => {
      const sampleRaw = (d.sampleText && String(d.sampleText).trim()) || d.family || "Aa";
      const familyCss = d.fallbackStack || d.family || "Inter, sans-serif";
      const size = Math.min(Math.max(Math.round(d.sizePx || 24), 12), 64);
      const weight = String(d.weight || 400);
      const ranges = Array.isArray(d.ranges) && d.ranges.length >= 2 ? d.ranges : null;
      const sampleFont = `${weight} ${size}px ${familyCss}`;
      const naturalW = measureRunsWidth(sampleRaw, ranges, familyCss, size, weight);
      // Mixed-weight runs: keep one line and grow the frame (wrapping would
      // scramble range offsets). Uniform text can still wrap past MAX_W.
      let sampleLines;
      if (ranges) {
        sampleLines = [sampleRaw];
        neededW = Math.max(neededW, Math.ceil(Math.min(Math.max(naturalW + PAD_X * 2, MIN_W), MAX_W)));
      } else {
        const targetContentW = Math.min(Math.max(naturalW, MIN_W - PAD_X * 2), MAX_W - PAD_X * 2);
        sampleLines = Acopio.wrapTextToWidth(sampleRaw, targetContentW, sampleFont);
        const lineWidths = sampleLines.map((line) => Acopio.measureTextWidthPx(line, sampleFont));
        neededW = Math.max(neededW, Math.ceil(Math.max(...lineWidths, 0) + PAD_X * 2));
      }
      const meta = Acopio.fontMetricsLine(d);
      const color = Acopio.fontColorHex(d);
      if (meta) neededW = Math.max(neededW, Math.ceil(Acopio.measureTextWidthPx(meta, metaFont) + PAD_X * 2));
      if (color) neededW = Math.max(neededW, Math.ceil(Acopio.measureTextWidthPx(color, metaFont) + 20 + PAD_X * 2));
      return {
        d,
        sampleRaw,
        sampleLines,
        familyCss,
        size,
        weight,
        ranges,
        meta,
        color,
        lineHeight: d.lineHeightPx ? Math.round(d.lineHeightPx) : Math.round(size * 1.25),
      };
    });
    const width = Math.min(Math.max(MIN_W, neededW), MAX_W);

    let y = 40;
    const chunks = [];
    prepared.forEach((block, i) => {
      if (i > 0) y += 28;
      const family = Acopio.escapeHtml(block.familyCss);
      const weight = Acopio.escapeHtml(block.weight);
      const fill = Acopio.escapeHtml(block.d.colorHex || "#17181A");
      const letterSpacing =
        block.d.letterSpacingPx != null && !Number.isNaN(Number(block.d.letterSpacingPx))
          ? ` letter-spacing="${Number(block.d.letterSpacingPx)}"`
          : "";
      const lh = Math.max(block.size, block.lineHeight);
      const defaults = {
        family: block.familyCss,
        weight: block.weight,
        fill: block.d.colorHex || "#17181A",
        size: block.size,
      };

      if (block.ranges) {
        chunks.push(
          `<text x="${PAD_X}" y="${y}" xml:space="preserve"${letterSpacing}>${tspansMarkup(block.sampleRaw, block.ranges, defaults)}</text>`
        );
        y += lh + 10;
      } else {
        block.sampleLines.forEach((line, li) => {
          const yy = y + li * lh;
          chunks.push(
            `<text x="${PAD_X}" y="${yy}" font-family="${family}" font-size="${block.size}" font-weight="${weight}" fill="${fill}"${letterSpacing}>${Acopio.escapeHtml(line)}</text>`
          );
        });
        y += block.sampleLines.length * lh + 10;
      }

      if (block.meta) {
        chunks.push(
          `<text x="${PAD_X}" y="${y}" font-family="Inter,Helvetica,Arial,sans-serif" font-size="${META_SIZE}" font-weight="500" fill="#6B6E76">${Acopio.escapeHtml(block.meta)}</text>`
        );
        y += 18;
      }

      if (block.color) {
        const sw = 12;
        const swY = y - sw + 2;
        chunks.push(
          `<rect x="${PAD_X}" y="${swY}" width="${sw}" height="${sw}" rx="2" fill="${Acopio.escapeHtml(block.color)}"/>` +
            `<text x="${PAD_X + sw + 8}" y="${y}" font-family="Inter,Helvetica,Arial,sans-serif" font-size="${META_SIZE}" font-weight="650" fill="#17181A">${Acopio.escapeHtml(block.color)}</text>`
        );
        y += 22;
      }
    });
    const height = Math.max(80, y + 24);
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<rect width="${width}" height="${height}" fill="#FFFFFF"/>` +
      chunks.join("") +
      `</svg>`
    );
  };

  Acopio.clipboardSupportsType = function clipboardSupportsType(type) {
    try {
      return Boolean(
        typeof ClipboardItem !== "undefined" &&
          ClipboardItem.supports &&
          ClipboardItem.supports(type)
      );
    } catch (_) {
      return false;
    }
  };

  /**
   * Write design clipboard for Figma-first paste without breaking the flow.
   *
   * Proven in the wild: Figma pastes raw SVG from text/plain as editable
   * vectors + <text> nodes. image/svg+xml is optional (Chrome-only) and
   * must never be required — it throws on older Chromium and breaks Copy.
   *
   * Fallbacks: ClipboardItem → writeText(svg) → writeText(humanPlain).
   */
  Acopio.writeDesignClipboard = async function writeDesignClipboard(opts) {
    const svg = opts && opts.svg ? String(opts.svg) : "";
    const humanPlain = opts && opts.humanPlain != null ? String(opts.humanPlain) : "";
    const html =
      opts && opts.html
        ? String(opts.html)
        : svg
          ? `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${svg}</body></html>`
          : "";

    if (!svg && !humanPlain) throw new Error("Nothing to copy.");

    // Figma-critical: text/plain MUST be the SVG when we have one.
    // Do not put hex/metrics alone in text/plain or Figma won't get vectors.
    const plainForFigma = svg || humanPlain;

    const tryWriteItem = async (types) => {
      await navigator.clipboard.write([new ClipboardItem(types)]);
    };

    // Attempt 1: always-safe MIME types only (plain + html).
    if (typeof ClipboardItem !== "undefined") {
      try {
        const types = {
          "text/plain": new Blob([plainForFigma], { type: "text/plain" }),
        };
        if (html) types["text/html"] = new Blob([html], { type: "text/html" });
        // Optional bonus — never required for success.
        if (svg && Acopio.clipboardSupportsType("image/svg+xml")) {
          types["image/svg+xml"] = new Blob([svg], { type: "image/svg+xml" });
        }
        await tryWriteItem(types);
        return { mode: svg ? "svg" : "text" };
      } catch (_) {
        // fall through
      }

      // Attempt 2: plain + html without optional svg mime (some Chromes reject mixed).
      try {
        const types = {
          "text/plain": new Blob([plainForFigma], { type: "text/plain" }),
        };
        if (html) types["text/html"] = new Blob([html], { type: "text/html" });
        await tryWriteItem(types);
        return { mode: svg ? "svg" : "text" };
      } catch (_) {
        // fall through
      }
    }

    // Attempt 3: writeText(svg) — the copy-to-figma proven path.
    if (svg) {
      try {
        await navigator.clipboard.writeText(svg);
        return { mode: "svg-text" };
      } catch (_) {
        // fall through
      }
    }

    // Attempt 4: human-readable plain (hex / sample) — never leave Copy broken.
    if (humanPlain) {
      await navigator.clipboard.writeText(humanPlain);
      return { mode: "text-fallback" };
    }

    throw new Error("Couldn't copy to clipboard.");
  };

  Acopio.ensureRuntimeOrReload = function ensureRuntimeOrReload(err) {
    if (Acopio.isRuntimeAlive() && !Acopio.isContextInvalidatedError(err)) return true;
    Acopio.reloadPageForStaleExtension();
    return false;
  };

  // Pseudo-elements (::before / ::after) are not in the DOM tree — cloneNode
  // and DOM walkers (including @figit/dom-to-figma) never see them. Icons,
  // chevrons, and badge dots vanish on Copy→Figma. Materialize them as real
  // <span data-acopio-pseudo> children with computed pseudo styles inlined,
  // convert, then cleanup(). Call on a live connected subtree only.
  const PSEUDO_STYLE_PROPS = [
    "display", "position", "box-sizing", "top", "right", "bottom", "left", "inset",
    "width", "height", "min-width", "min-height", "max-width", "max-height",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-top-left-radius", "border-top-right-radius",
    "border-bottom-right-radius", "border-bottom-left-radius",
    "background-color", "background-image", "background-size", "background-position",
    "background-repeat", "background-clip",
    "color", "opacity", "visibility", "z-index",
    "font-family", "font-size", "font-weight", "font-style", "line-height",
    "letter-spacing", "text-align", "text-transform", "white-space",
    "box-shadow", "filter", "transform", "transform-origin",
    "overflow", "pointer-events", "flex-shrink", "align-self",
    // Mask / clip — figit often can't model these; freeze onto materialized
    // spans so raster fallback still sees the painted intent.
    "mask-image", "mask-size", "mask-position", "mask-repeat", "mask-mode",
    "mask-composite", "mask-clip", "mask-origin", "mask-type",
    "-webkit-mask-image", "-webkit-mask-size", "-webkit-mask-position",
    "-webkit-mask-repeat", "-webkit-mask-composite", "-webkit-mask-clip",
    "-webkit-mask-origin",
    "clip-path", "-webkit-clip-path",
  ];

  /**
   * Replace <video> with a still <img> (current frame or poster) so Copy→Figma
   * gets the hero media html.to.design would show — figit cannot paint <video>.
   * Returns cleanup() that restores the original video nodes.
   */
  Acopio.materializeVideosForCapture = function materializeVideosForCapture(root) {
    const restores = [];
    if (!root || root.nodeType !== 1) {
      return function cleanup() {};
    }

    const videos = [];
    const collect = (el) => {
      if (!el || el.nodeType !== 1) return;
      if (el.tagName === "VIDEO") videos.push(el);
      try {
        for (const child of Array.from(el.children || [])) collect(child);
      } catch (_) {}
      try {
        if (el.shadowRoot) {
          for (const child of Array.from(el.shadowRoot.children || [])) collect(child);
        }
      } catch (_) {}
    };
    collect(root);

    for (const video of videos) {
      try {
        const parent = video.parentNode;
        if (!parent) continue;
        const rect = video.getBoundingClientRect();
        let src = null;
        try {
          if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
            const c = document.createElement("canvas");
            c.width = video.videoWidth;
            c.height = video.videoHeight;
            c.getContext("2d").drawImage(video, 0, 0);
            src = c.toDataURL("image/jpeg", 0.92);
          }
        } catch (_) {
          src = null;
        }
        if (!src) {
          const poster = video.getAttribute("poster") || video.poster || "";
          if (poster) {
            try {
              src = new URL(poster, location.href).href;
            } catch (_) {
              src = poster;
            }
          }
        }
        if (!src && typeof Acopio.resolveVideoOrPoster === "function") {
          try {
            const resolved = Acopio.resolveVideoOrPoster(video);
            // Only ever use this as an <img> source when it's genuinely a
            // static image (a poster/thumbnail) — resolveVideoOrPoster's
            // own fallback branch can return the raw video FILE url as a
            // last resort (see its comment: "better than a dead blob:
            // reference"), which was a reasonable answer for its original
            // caller but is never a valid <img src> — a browser can't
            // decode a video container as a still image. Worse, handing a
            // multi-MB video file through this same fetch-and-embed-as-
            // image pipeline can stall on that one doomed fetch long
            // enough to block every sibling card's own conversion behind
            // it (confirmed live: a row of cards each with an unloaded,
            // poster-less video went from "one image missing" to "nothing
            // after the first card ever finishes converting" once this
            // path was hit for real). No usable static image here just
            // means this video stays a video — see below — not a reason
            // to fetch the whole file and pretend it's a photo.
            if (resolved && resolved.url && !resolved.isVideo) src = resolved.url;
          } catch (_) {}
        }
        if (!src) continue;

        const img = document.createElement("img");
        img.setAttribute("data-acopio-video-still", "1");
        img.alt = video.getAttribute("aria-label") || video.getAttribute("title") || "";
        img.src = src;
        const cs = window.getComputedStyle(video);
        img.style.cssText = [
          "display:block",
          "object-fit:" + (cs.objectFit || "cover"),
          "object-position:" + (cs.objectPosition || "center"),
          "width:" + (rect.width > 0 ? rect.width + "px" : cs.width || "100%"),
          "height:" + (rect.height > 0 ? rect.height + "px" : cs.height || "auto"),
          "max-width:100%",
          "border-radius:" + (cs.borderRadius || "0"),
        ].join(";");
        parent.insertBefore(img, video);
        video.style.setProperty("display", "none", "important");
        restores.push({ video, img, prevDisplay: video.style.display });
      } catch (_) {}
    }

    return function cleanup() {
      for (let i = restores.length - 1; i >= 0; i--) {
        const { video, img } = restores[i];
        try {
          if (img && img.parentNode) img.remove();
        } catch (_) {}
        try {
          if (video) video.style.removeProperty("display");
        } catch (_) {}
      }
      restores.length = 0;
    };
  };

  /**
   * Walk light + open-shadow element trees for capture materializers.
   */
  function walkFidelityElements(root, visit) {
    if (!root || root.nodeType !== 1) return;
    const stack = [root];
    while (stack.length) {
      const el = stack.pop();
      if (!el || el.nodeType !== 1) continue;
      if (Acopio.isOwnNode && Acopio.isOwnNode(el)) continue;
      visit(el);
      try {
        const kids =
          typeof Acopio.fidelityChildElements === "function"
            ? Acopio.fidelityChildElements(el)
            : Array.from(el.children || []);
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      } catch (_) {}
    }
  }

  function rectsIntersect(a, b, pad) {
    const p = pad || 0;
    return (
      a.left < b.right + p &&
      a.right > b.left - p &&
      a.top < b.bottom + p &&
      a.bottom > b.top - p
    );
  }

  /**
   * Replace visible <canvas> with a still <img> (toDataURL) so Copy→Figma
   * keeps chart/logo pixels — figit cannot paint canvas bitmaps.
   * Returns cleanup() that restores the original canvas nodes.
   */
  Acopio.materializeCanvasesForCapture = function materializeCanvasesForCapture(root) {
    const restores = [];
    if (!root || root.nodeType !== 1) {
      return function cleanup() {};
    }

    const canvases = [];
    walkFidelityElements(root, (el) => {
      if (el.tagName === "CANVAS") canvases.push(el);
    });

    for (const canvas of canvases) {
      try {
        const parent = canvas.parentNode;
        if (!parent) continue;
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        let src = null;
        try {
          if (canvas.width > 0 && canvas.height > 0) {
            src = canvas.toDataURL("image/png");
          }
        } catch (_) {
          src = null;
        }
        if (!src || src === "data:," || src.length < 32) continue;

        const img = document.createElement("img");
        img.setAttribute("data-acopio-canvas-still", "1");
        img.alt = canvas.getAttribute("aria-label") || canvas.getAttribute("title") || "";
        img.src = src;
        const cs = window.getComputedStyle(canvas);
        img.style.cssText = [
          "display:block",
          "object-fit:" + (cs.objectFit || "contain"),
          "object-position:" + (cs.objectPosition || "center"),
          "width:" + (rect.width > 0 ? rect.width + "px" : cs.width || "100%"),
          "height:" + (rect.height > 0 ? rect.height + "px" : cs.height || "auto"),
          "max-width:100%",
          "border-radius:" + (cs.borderRadius || "0"),
        ].join(";");
        parent.insertBefore(img, canvas);
        canvas.style.setProperty("display", "none", "important");
        restores.push({ canvas, img });
      } catch (_) {}
    }

    return function cleanup() {
      for (let i = restores.length - 1; i >= 0; i--) {
        const { canvas, img } = restores[i];
        try {
          if (img && img.parentNode) img.remove();
        } catch (_) {}
        try {
          if (canvas) canvas.style.removeProperty("display");
        } catch (_) {}
      }
      restores.length = 0;
    };
  };

  /**
   * Same-origin iframes: inline a fidelity clone of body sized to the iframe
   * box. Cross-origin: honest sized placeholder (never silent empty).
   * Returns cleanup().
   */
  Acopio.materializeIframesForCapture = function materializeIframesForCapture(root) {
    const restores = [];
    if (!root || root.nodeType !== 1) {
      return function cleanup() {};
    }

    const iframes = [];
    walkFidelityElements(root, (el) => {
      if (el.tagName === "IFRAME") iframes.push(el);
    });

    for (const iframe of iframes) {
      try {
        const parent = iframe.parentNode;
        if (!parent) continue;
        const rect = iframe.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        const cs = window.getComputedStyle(iframe);

        let doc = null;
        try {
          doc = iframe.contentDocument;
        } catch (_) {
          doc = null;
        }
        // contentDocument exists but is empty/opaque for sandboxed frames.
        let body = null;
        try {
          body = doc && doc.body;
        } catch (_) {
          body = null;
        }

        const wrapper = document.createElement("div");
        wrapper.setAttribute(
          "data-acopio-iframe",
          body ? "inline" : "placeholder"
        );
        wrapper.setAttribute("aria-hidden", body ? "false" : "true");
        wrapper.style.cssText = [
          "box-sizing:border-box",
          "position:relative",
          "display:block",
          "width:" + w + "px",
          "height:" + h + "px",
          "overflow:hidden",
          "margin:0",
          "padding:0",
          "border:" + (cs.borderWidth && cs.borderWidth !== "0px"
            ? cs.borderTopWidth + " " + cs.borderTopStyle + " " + cs.borderTopColor
            : "1px solid rgba(12,19,32,0.12)"),
          "border-radius:" + (cs.borderRadius || "0"),
          "background:" + (body ? (cs.backgroundColor || "#fff") : "#F0F1F3"),
        ].join(";");

        if (body) {
          try {
            const clone =
              typeof Acopio.cloneWithOpenShadows === "function"
                ? Acopio.cloneWithOpenShadows(body)
                : body.cloneNode(true);
            if (clone) {
              clone.style.margin = "0";
              clone.style.width = "100%";
              clone.style.minHeight = "100%";
              wrapper.appendChild(clone);
            }
          } catch (_) {
            wrapper.textContent = "";
            const label = document.createElement("div");
            label.textContent = "iframe";
            label.style.cssText =
              "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
              "font:12px/1.2 system-ui,sans-serif;color:#6b6e76;";
            wrapper.appendChild(label);
          }
        } else {
          const label = document.createElement("div");
          label.textContent = "iframe";
          label.style.cssText =
            "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
            "font:12px/1.2 system-ui,sans-serif;color:#6b6e76;";
          wrapper.appendChild(label);
        }

        parent.insertBefore(wrapper, iframe);
        iframe.style.setProperty("display", "none", "important");
        restores.push({ iframe, wrapper });
      } catch (_) {}
    }

    return function cleanup() {
      for (let i = restores.length - 1; i >= 0; i--) {
        const { iframe, wrapper } = restores[i];
        try {
          if (wrapper && wrapper.parentNode) wrapper.remove();
        } catch (_) {}
        try {
          if (iframe) iframe.style.removeProperty("display");
        } catch (_) {}
      }
      restores.length = 0;
    };
  };

  /**
   * Bake position:fixed|sticky descendants that paint inside the selection
   * into absolute coords relative to their containing block within the
   * selection (html.to.design selection-relative geometry).
   * Page chrome outside the selection is never touched (we only walk root).
   * Returns cleanup().
   */
  Acopio.bakeStickyFixedForCapture = function bakeStickyFixedForCapture(root) {
    const restores = [];
    if (!root || root.nodeType !== 1) {
      return function cleanup() {};
    }

    const rootRect = root.getBoundingClientRect();

    function containingBlockWithinRoot(el) {
      let cb = el.parentElement;
      while (cb && cb !== root) {
        try {
          const p = (window.getComputedStyle(cb).position || "").toLowerCase();
          if (p && p !== "static") return cb;
        } catch (_) {}
        cb = cb.parentElement;
      }
      return root;
    }

    const targets = [];
    walkFidelityElements(root, (el) => {
      if (el === root) return;
      try {
        const cs = window.getComputedStyle(el);
        const pos = (cs.position || "").toLowerCase();
        if (pos !== "fixed" && pos !== "sticky") return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        // Must visually intersect the selection — skip fixed overlays that
        // happen to be DOM-descendants but paint outside the box.
        if (!rectsIntersect(r, rootRect, 1)) return;
        targets.push({ el, pos, r, cs });
      } catch (_) {}
    });

    // Ensure selection root can contain absolute children that used fixed.
    try {
      const rootPos = (window.getComputedStyle(root).position || "").toLowerCase();
      if (!rootPos || rootPos === "static") {
        restores.push({
          el: root,
          position: root.style.position,
          left: root.style.left,
          top: root.style.top,
          right: root.style.right,
          bottom: root.style.bottom,
          width: root.style.width,
          height: root.style.height,
          margin: root.style.margin,
          transform: root.style.transform,
          _rootPosOnly: true,
        });
        root.style.setProperty("position", "relative", "important");
      }
    } catch (_) {}

    for (const { el, r } of targets) {
      try {
        const prev = {
          el,
          position: el.style.position,
          left: el.style.left,
          top: el.style.top,
          right: el.style.right,
          bottom: el.style.bottom,
          width: el.style.width,
          height: el.style.height,
          margin: el.style.margin,
          transform: el.style.transform,
        };
        const cb = containingBlockWithinRoot(el);
        const cbr = cb.getBoundingClientRect();
        const left = r.left - cbr.left;
        const top = r.top - cbr.top;
        el.style.setProperty("position", "absolute", "important");
        el.style.setProperty("left", left.toFixed(2) + "px", "important");
        el.style.setProperty("top", top.toFixed(2) + "px", "important");
        el.style.setProperty("right", "auto", "important");
        el.style.setProperty("bottom", "auto", "important");
        el.style.setProperty("width", r.width.toFixed(2) + "px", "important");
        el.style.setProperty("height", r.height.toFixed(2) + "px", "important");
        el.style.setProperty("margin", "0", "important");
        // Keep intentional static transforms (rotate on cards). Sticky offset
        // is encoded in left/top above — do not wipe rotate/scale.
        restores.push(prev);
      } catch (_) {}
    }

    return function cleanup() {
      for (let i = restores.length - 1; i >= 0; i--) {
        const r = restores[i];
        try {
          if (r._rootPosOnly) {
            r.el.style.position = r.position || "";
            continue;
          }
          r.el.style.position = r.position || "";
          r.el.style.left = r.left || "";
          r.el.style.top = r.top || "";
          r.el.style.right = r.right || "";
          r.el.style.bottom = r.bottom || "";
          r.el.style.width = r.width || "";
          r.el.style.height = r.height || "";
          r.el.style.margin = r.margin || "";
          if ("transform" in r) r.el.style.transform = r.transform || "";
        } catch (_) {}
      }
      restores.length = 0;
    };
  };

  /**
   * Lock line-clamp / ellipsis hosts to painted height so Figma TEXT cannot
   * reflow to the full unclamped string. Returns cleanup().
   */
  Acopio.freezeLineClampForCapture = function freezeLineClampForCapture(root) {
    const restores = [];
    if (!root || root.nodeType !== 1) {
      return function cleanup() {};
    }

    walkFidelityElements(root, (el) => {
      try {
        const cs = window.getComputedStyle(el);
        const clampRaw = cs.getPropertyValue("-webkit-line-clamp") || "";
        const clampN = parseInt(clampRaw, 10);
        const hasClamp = Number.isFinite(clampN) && clampN > 0 && clampRaw !== "none";
        const ellipsis = (cs.textOverflow || "").toLowerCase() === "ellipsis";
        const ox = (cs.overflowX || cs.overflow || "").toLowerCase();
        const oy = (cs.overflowY || cs.overflow || "").toLowerCase();
        const clips =
          ox === "hidden" ||
          ox === "clip" ||
          oy === "hidden" ||
          oy === "clip" ||
          (cs.overflow || "").toLowerCase() === "hidden";
        if (!hasClamp && !(ellipsis && clips)) return;

        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;

        restores.push({
          el,
          height: el.style.height,
          maxHeight: el.style.maxHeight,
          overflow: el.style.overflow,
          overflowX: el.style.overflowX,
          overflowY: el.style.overflowY,
          webkitLineClamp: el.style.webkitLineClamp,
          display: el.style.display,
          webkitBoxOrient: el.style.webkitBoxOrient,
          textOverflow: el.style.textOverflow,
          whiteSpace: el.style.whiteSpace,
        });

        el.style.setProperty("height", rect.height.toFixed(2) + "px", "important");
        el.style.setProperty("max-height", rect.height.toFixed(2) + "px", "important");
        el.style.setProperty("overflow", "hidden", "important");
        el.style.setProperty("overflow-x", "hidden", "important");
        el.style.setProperty("overflow-y", "hidden", "important");
        if (hasClamp) {
          el.style.setProperty("display", "-webkit-box", "important");
          el.style.setProperty("-webkit-box-orient", "vertical", "important");
          el.style.setProperty("-webkit-line-clamp", String(clampN), "important");
        } else if (ellipsis) {
          el.style.setProperty("text-overflow", "ellipsis", "important");
          if ((cs.whiteSpace || "").toLowerCase() === "nowrap") {
            el.style.setProperty("white-space", "nowrap", "important");
          }
        }
      } catch (_) {}
    });

    return function cleanup() {
      for (let i = restores.length - 1; i >= 0; i--) {
        const r = restores[i];
        try {
          r.el.style.height = r.height || "";
          r.el.style.maxHeight = r.maxHeight || "";
          r.el.style.overflow = r.overflow || "";
          r.el.style.overflowX = r.overflowX || "";
          r.el.style.overflowY = r.overflowY || "";
          r.el.style.webkitLineClamp = r.webkitLineClamp || "";
          r.el.style.display = r.display || "";
          r.el.style.webkitBoxOrient = r.webkitBoxOrient || "";
          r.el.style.textOverflow = r.textOverflow || "";
          r.el.style.whiteSpace = r.whiteSpace || "";
        } catch (_) {}
      }
      restores.length = 0;
    };
  };

  /**
   * Where figit cannot model CSS mask / clip-path, rasterize the painted
   * region to a PNG <img> (partial but correct paste). Only replaces when a
   * real bitmap is produced — never foreignObject SVG data URLs (figit drops
   * those as empty). Returns cleanup().
   */
  Acopio.materializeMaskedClippedForCapture = function materializeMaskedClippedForCapture(root) {
    const restores = [];
    if (!root || root.nodeType !== 1) {
      return function cleanup() {};
    }

    function needsMaskRaster(cs) {
      const mask =
        cs.maskImage ||
        cs.getPropertyValue("mask-image") ||
        cs.webkitMaskImage ||
        cs.getPropertyValue("-webkit-mask-image") ||
        "";
      const clip =
        cs.clipPath ||
        cs.getPropertyValue("clip-path") ||
        cs.getPropertyValue("-webkit-clip-path") ||
        "";
      const maskActive =
        mask &&
        mask !== "none" &&
        !/^none\b/i.test(mask) &&
        /url\(|linear-gradient|radial-gradient|conic-gradient/i.test(mask);
      const clipActive =
        clip &&
        clip !== "none" &&
        !/^none\b/i.test(clip) &&
        /(circle|ellipse|path|polygon)\s*\(/i.test(clip);
      return Boolean(maskActive || clipActive);
    }

    function rasterizeImgWithClip(img, hostCs, w, h) {
      try {
        if (!img || !img.complete || img.naturalWidth < 1) return null;
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w));
        c.height = Math.max(1, Math.round(h));
        const ctx = c.getContext("2d");
        if (!ctx) return null;
        const clip =
          hostCs.clipPath ||
          hostCs.getPropertyValue("clip-path") ||
          "";
        ctx.save();
        if (/(circle|ellipse)\s*\(/i.test(clip)) {
          ctx.beginPath();
          ctx.ellipse(
            c.width / 2,
            c.height / 2,
            c.width / 2,
            c.height / 2,
            0,
            0,
            Math.PI * 2
          );
          ctx.closePath();
          ctx.clip();
        }
        ctx.drawImage(img, 0, 0, c.width, c.height);

        // Apply CSS mask-image when it is a same-origin / data URL bitmap.
        const mask =
          hostCs.maskImage ||
          hostCs.getPropertyValue("mask-image") ||
          hostCs.webkitMaskImage ||
          hostCs.getPropertyValue("-webkit-mask-image") ||
          "";
        const maskUrlMatch = mask.match(/url\(\s*["']?([^"')]+)["']?\s*\)/i);
        if (maskUrlMatch && maskUrlMatch[1]) {
          // Luminance/alpha mask requires an async image load — skip sync path.
          // Circle/ellipse clip above already covers the common avatar case.
        }
        ctx.restore();
        const out = c.toDataURL("image/png");
        if (!out || out.length < 32) return null;
        return out;
      } catch (_) {
        return null;
      }
    }

    const targets = [];
    walkFidelityElements(root, (el) => {
      if (el === root) return;
      if (el.hasAttribute && el.hasAttribute("data-acopio-mask-still")) return;
      // Never swallow brand <img> logos unless they truly need mask raster.
      try {
        const cs = window.getComputedStyle(el);
        if (!needsMaskRaster(cs)) return;
        if (cs.display === "none" || cs.visibility === "hidden") return;
        if (parseFloat(cs.opacity) === 0) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        targets.push({ el, cs, r });
      } catch (_) {}
    });

    for (const { el, cs, r } of targets) {
      try {
        const parent = el.parentNode;
        if (!parent) continue;
        const w = r.width;
        const h = r.height;
        const imgSelf = el.tagName === "IMG" ? el : null;
        const imgChild =
          imgSelf ||
          (el.querySelector && el.querySelector("img"));
        const src = imgChild ? rasterizeImgWithClip(imgChild, cs, w, h) : null;
        // No reliable sync PNG → leave structural DOM for figit (better than
        // empty foreignObject placeholders that wipe logo IMAGE fills).
        if (!src) continue;

        const img = document.createElement("img");
        img.setAttribute("data-acopio-mask-still", "1");
        img.alt = el.getAttribute("aria-label") || el.getAttribute("alt") || "";
        img.src = src;
        img.style.cssText = [
          "display:block",
          "width:" + w.toFixed(2) + "px",
          "height:" + h.toFixed(2) + "px",
          "object-fit:fill",
          "margin:0",
          "padding:0",
          "border:none",
        ].join(";");
        parent.insertBefore(img, el);
        el.style.setProperty("display", "none", "important");
        restores.push({ el, img });
      } catch (_) {}
    }

    return function cleanup() {
      for (let i = restores.length - 1; i >= 0; i--) {
        const { el, img } = restores[i];
        try {
          if (img && img.parentNode) img.remove();
        } catch (_) {}
        try {
          if (el) el.style.removeProperty("display");
        } catch (_) {}
      }
      restores.length = 0;
    };
  };

  /**
   * Remove invisible / zero-size decoy nodes from a frozen clone so figit
   * never emits visible layers for display:none / opacity:0 / hidden, and
   * so MAX node caps count only paint-relevant DOM.
   * Mutates clone in place. Returns { removed }.
   */
  Acopio.pruneInvisibleInClone = function pruneInvisibleInClone(root) {
    let removed = 0;
    if (!root || root.nodeType !== 1) return { removed: 0 };

    function isInvisible(el) {
      try {
        // Prefer inline frozen styles (clone is off-DOM).
        const st = el.style;
        const display = (st.display || "").toLowerCase();
        if (display === "none") return true;
        const vis = (st.visibility || "").toLowerCase();
        if (vis === "hidden" || vis === "collapse") return true;
        const op = st.opacity;
        if (op !== "" && op != null && parseFloat(op) === 0) return true;
        const w = parseFloat(st.width);
        const h = parseFloat(st.height);
        if (Number.isFinite(w) && Number.isFinite(h) && w === 0 && h === 0) {
          return true;
        }
        // Offscreen decoys often parked at left:-9999 / huge negative inset.
        const left = parseFloat(st.left);
        const top = parseFloat(st.top);
        if (
          (Number.isFinite(left) && left < -8000) ||
          (Number.isFinite(top) && top < -8000)
        ) {
          return true;
        }
      } catch (_) {}
      return false;
    }

    const doomed = [];
    const walk = (el) => {
      if (!el || el.nodeType !== 1) return;
      if (el !== root && isInvisible(el)) {
        doomed.push(el);
        return;
      }
      for (const child of Array.from(el.children || [])) walk(child);
    };
    walk(root);
    for (const el of doomed) {
      try {
        el.remove();
        removed += 1;
      } catch (_) {}
    }
    return { removed };
  };

  /**
   * Collapse source-indentation whitespace in text nodes the way CSS
   * `white-space: normal|nowrap` paints it. Without this, figit keeps
   * newlines from pretty-printed HTML and Figma text can wrap early /
   * fight the measured frame width on paste.
   * Returns cleanup() that restores original node values.
   */
  Acopio.normalizeDisplayWhitespaceForCapture = function normalizeDisplayWhitespaceForCapture(root) {
    const restores = [];
    if (!root || root.nodeType !== 1) {
      return function cleanup() {};
    }

    const visitRoot = (start) => {
      const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT, null);
      let node = walker.nextNode();
      while (node) {
        const parent = node.parentElement;
        const raw = node.nodeValue;
        if (!parent || raw == null || !/\s/.test(raw)) {
          node = walker.nextNode();
          continue;
        }
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "PRE" || tag === "CODE") {
          node = walker.nextNode();
          continue;
        }
        let ws = "normal";
        try {
          ws = window.getComputedStyle(parent).whiteSpace || "normal";
        } catch (_) {}
        let next = raw;
        if (ws === "pre" || ws === "pre-wrap") {
          node = walker.nextNode();
          continue;
        }
        if (ws === "pre-line") {
          next = raw.replace(/[^\S\n]+/g, " ");
        } else {
          next = raw.replace(/\s+/g, " ");
        }
        if (next !== raw) {
          restores.push({ node, value: raw });
          node.nodeValue = next;
        }
        node = walker.nextNode();
      }
    };

    const walkElements = (el) => {
      if (!el || el.nodeType !== 1) return;
      visitRoot(el);
      try {
        if (el.shadowRoot) visitRoot(el.shadowRoot);
      } catch (_) {}
      for (const child of Array.from(el.children || [])) walkElements(child);
      try {
        if (el.shadowRoot) {
          for (const child of Array.from(el.shadowRoot.children || [])) {
            walkElements(child);
          }
        }
      } catch (_) {}
    };
    walkElements(root);

    return function cleanup() {
      for (let i = restores.length - 1; i >= 0; i--) {
        try {
          restores[i].node.nodeValue = restores[i].value;
        } catch (_) {}
      }
      restores.length = 0;
    };
  };

  Acopio.materializePseudosForCapture = function materializePseudosForCapture(root) {
    const inserted = [];
    if (!root || root.nodeType !== 1) {
      return function cleanup() {};
    }

    function stylePseudoOnto(span, ps) {
      const parts = [];
      for (const prop of PSEUDO_STYLE_PROPS) {
        try {
          const val = ps.getPropertyValue(prop);
          if (val != null && val !== "") parts.push(`${prop}:${val}`);
        } catch (_) {}
      }
      // Pseudos often use content-box quirks — lock border-box from measured intent.
      parts.push("box-sizing:border-box");
      parts.push("pointer-events:none");
      span.setAttribute("style", parts.join(";"));
    }

    function materializeOne(el, which) {
      let ps;
      try {
        ps = window.getComputedStyle(el, which);
      } catch (_) {
        return;
      }
      const content = (ps.content || "").trim();
      if (!content || content === "none" || content === "normal") return;
      if (ps.display === "none" || ps.visibility === "hidden") return;
      if (parseFloat(ps.opacity) === 0) return;

      const span = document.createElement("span");
      span.setAttribute("data-acopio-pseudo", which === "::before" ? "before" : "after");
      span.setAttribute("aria-hidden", "true");
      stylePseudoOnto(span, ps);

      const urlMatch = content.match(/^url\(\s*["']?([^"')]+)["']?\s*\)$/i);
      const quoted = content.match(/^["']([\s\S]*)["']$/);
      if (urlMatch) {
        const img = document.createElement("img");
        img.src = urlMatch[1];
        img.alt = "";
        img.style.cssText = "display:block;width:100%;height:100%;object-fit:contain;";
        span.appendChild(img);
      } else if (quoted && quoted[1]) {
        // CSS escapes like \A → newline; keep visible text for Figma TEXT nodes.
        span.textContent = quoted[1].replace(/\\A/gi, "\n").replace(/\\/g, "");
      }

      if (which === "::before") el.insertBefore(span, el.firstChild);
      else el.appendChild(span);
      inserted.push(span);
    }

    // Snapshot list first — inserting children must not re-walk our spans.
    // Include open shadow roots so web-component chrome (::before on host
    // children inside shadow) materializes for Copy→Figma.
    const hosts = [];
    const collect = (el) => {
      if (!el || el.nodeType !== 1) return;
      if (el.hasAttribute && el.hasAttribute("data-acopio-pseudo")) return;
      if (Acopio.isOwnNode && Acopio.isOwnNode(el)) return;
      hosts.push(el);
      const kids =
        typeof Acopio.fidelityChildElements === "function"
          ? Acopio.fidelityChildElements(el)
          : Array.from(el.children || []);
      for (const child of kids) collect(child);
    };
    collect(root);
    for (const el of hosts) {
      materializeOne(el, "::before");
      materializeOne(el, "::after");
    }

    return function cleanup() {
      for (const node of inserted) {
        try {
          node.remove();
        } catch (_) {}
      }
      inserted.length = 0;
    };
  };

  if (!self.__acopioStaleWatchdog) {
    self.__acopioStaleWatchdog = setInterval(() => {
      Acopio.ensureRuntimeOrReload();
    }, 45000);
    setTimeout(() => Acopio.ensureRuntimeOrReload(), 2500);
  }

  window.Acopio = Acopio;
})();
