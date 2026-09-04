// Entry point: hover detection, context-menu + keyboard trigger handling,
// and the capture pipeline that turns a live element into a Section 5
// item and hands it to the background service worker to store.
(function () {
  const Acopio = window.Acopio;
  let lastContextTarget = null;
  let hintShown = false;

  // Section 8: lets background.js distinguish "this page genuinely has no
  // Acopio activity yet" from "the content script never even managed to
  // inject here" (CSP block, restricted scheme) — the toolbar icon's
  // disabled state depends on this heartbeat actually arriving.
  try {
    chrome.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" });
  } catch (_) {
    // Extension context gone (reloaded mid-session) — nothing meaningful
    // to do here, the same class of edge case documented elsewhere.
  }

  chrome.storage.local.get(["acopioSeenHint"], (res) => {
    hintShown = Boolean(res.acopioSeenHint);
  });

  // Global pause/resume, toggled from the side panel. Defaults to active
  // (unchanged behavior for existing setups) if never explicitly set.
  // Live-updates via storage.onChanged, so toggling it takes effect on
  // already-open tabs immediately — no page refresh needed, unlike a code
  // change to the extension itself.
  let acopioActive = false; // off until explicitly turned on (chrome.storage read below is the real source of truth)
  chrome.storage.local.get(["acopioActive"], (res) => {
    acopioActive = res.acopioActive === true;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.acopioActive) {
      acopioActive = changes.acopioActive.newValue === true;
      if (!acopioActive) Acopio.overlay.hide(); // paused mid-session — don't leave a tooltip stranded open
    }
  });

  function candidateElementAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || el === document.documentElement || el === document.body) return null;
    if (Acopio.isOwnNode(el)) return null;
    return el;
  }

  // Hover IS the trigger (Section 2 — no capture-mode toggle). A short
  // "settle" debounce avoids the tooltip flickering/chasing the cursor
  // while it sweeps across a dense page (Section 10 perf requirement);
  // moving over the tooltip card itself (isOwnNode) never retriggers or
  // closes it. Pure mousemove listening never calls preventDefault or
  // stopPropagation, so real clicks/links/forms underneath are completely
  // untouched (Section 2.7) — only the card's own buttons are clickable,
  // via pointer-events scoping in overlay.js.
  let hoverTarget = null;
  let lastMoveX = 0;
  let lastMoveY = 0;
  const settleOpen = Acopio.debounce((el) => {
    if (hoverTarget !== el) return; // mouse moved on again before settling
    openTooltipFor(el);
  }, 130);

  const onMouseMove = Acopio.throttle((e) => {
    const dx = e.clientX - lastMoveX;
    const dy = e.clientY - lastMoveY;
    lastMoveX = e.clientX;
    lastMoveY = e.clientY;
    if (!acopioActive) return;
    if (Acopio.overlay.isBusy()) return; // don't yank the tooltip away mid-note or mid-size-confirm
    // Cursor is on its way to the open card's own buttons (crossing other
    // page elements to get there) — don't retarget mid-transit just because
    // something else is briefly under the pointer along the way.
    if (Acopio.overlay.isVisible() && Acopio.overlay.isMovingTowardCard(e.clientX, e.clientY, dx, dy)) {
      // A move BEFORE this one (while still crossing intermediate elements,
      // before the "heading toward the card" pattern was even detectable)
      // may already have set hoverTarget to one of those elements and
      // scheduled settleOpen for it. That timer doesn't know anything
      // changed — settleOpen's own staleness check only compares against
      // hoverTarget, so without this it would still fire ~130ms later and
      // yank the tooltip away regardless of every move since. Clearing
      // hoverTarget makes that check correctly see it as stale.
      hoverTarget = null;
      return;
    }
    const el = candidateElementAt(e.clientX, e.clientY);
    if (el === null) return; // over our own overlay, or nothing — leave current state alone
    if (el === hoverTarget) return;
    hoverTarget = el;
    lastContextTarget = el;
    settleOpen(el);
  }, 40);

  document.addEventListener("mousemove", onMouseMove, true);

  // Right-click: remember the real target for the context-menu path
  // (Section 2.8), which arrives later as a message from the background
  // worker once the user picks the menu item.
  document.addEventListener(
    "contextmenu",
    (e) => {
      if (Acopio.isOwnNode(e.target)) return;
      lastContextTarget = e.target;
    },
    true
  );

  // Keyboard accessibility (Section 8): Tab to any element, then a
  // modifier + Enter opens its tooltip. Plain Enter is deliberately NOT
  // used as the trigger — it's already overloaded on the page itself
  // (submits forms, activates focused links/buttons), so binding bare
  // Enter globally would mean every login-form submit also pops a capture
  // tooltip, which is exactly the "interrupts normal browsing" failure
  // Section 2.7 forbids. Alt+Enter can't collide with any native behavior.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.altKey || Acopio.overlay.isVisible()) return;
    const active = document.activeElement;
    if (!active || active === document.body || Acopio.isOwnNode(active)) return;
    e.preventDefault();
    openTooltipFor(active);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "OPEN_TOOLTIP_AT_CONTEXT_TARGET") {
      if (lastContextTarget) openTooltipFor(lastContextTarget);
    }
  });

  function openTooltipFor(el) {
    // Single choke point for all three trigger paths (hover, context-menu,
    // Alt+Enter) — the hover path already avoided retriggering mid-note
    // via its own check before calling this, but the context-menu message
    // listener below had no such guard, so right-clicking a different
    // element while a note was being typed would still hit the same
    // render()-during-note-editing race hover used to have. Guarding here
    // once, instead of at every call site, means a future new trigger path
    // can't reintroduce the same bug by forgetting the check.
    if (!acopioActive) return;
    if (Acopio.overlay.isBusy()) return;
    if (el.tagName.toLowerCase() === "iframe") {
      Acopio.overlay.showFor(el, { type: "component", family: "other" });
      return;
    }
    const tagInfo = Acopio.detectTag(el);
    Acopio.overlay.showFor(el, tagInfo);
    if (!hintShown) {
      hintShown = true;
      chrome.storage.local.set({ acopioSeenHint: true });
    }
  }

  // --- Capture pipeline -----------------------------------------------

  function detectFontSource(family) {
    const clean = family.replace(/['"]/g, "").trim();
    try {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch (_) {
          continue; // cross-origin stylesheet, can't inspect — skip
        }
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
          if (rule.constructor && rule.constructor.name === "CSSFontFaceRule") {
            const fam = rule.style.getPropertyValue("font-family").replace(/['"]/g, "").trim();
            if (fam === clean) {
              const src = rule.style.getPropertyValue("src") || "";
              return src.includes("fonts.gstatic.com") ? "google-fonts" : "custom";
            }
          }
        }
      }
    } catch (_) {
      // best-effort only
    }
    const SYSTEM_FONTS = [
      "arial", "helvetica", "times new roman", "georgia", "courier new",
      "verdana", "tahoma", "trebuchet ms", "segoe ui", "-apple-system",
      "system-ui", "roboto",
    ];
    return SYSTEM_FONTS.includes(clean.toLowerCase()) ? "system" : "custom";
  }

  // Structured, per-element layer extraction for components — captures
  // real text/image/color content at its actual rendered position (relative
  // to the component's own top-left) so the Figma plugin can create real,
  // separately-editable text/rect/image nodes placed where they actually
  // were, instead of only a flattened image + outerHTML. This is a
  // position *snapshot*, not a layout engine: it reads each element's
  // already-computed final rect (getBoundingClientRect) rather than
  // interpreting flexbox/grid rules, so nothing here needs to understand
  // CSS layout — it just records where things already ended up.
  const LAYER_SKIP_TAGS = new Set(["script", "style", "noscript", "iframe", "object", "embed", "template"]);
  const MAX_TREE_NODES = 80;

  function layerIsVisible(style, rect) {
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) === 0) return false;
    if (rect.width < 1 || rect.height < 1) return false;
    return true;
  }

  // el.getBoundingClientRect() for an element's OWN direct text is wrong
  // whenever that element mixes plain text with an inline child that wraps
  // onto its own line — e.g. "Your <span>AI Integration Delivery
  // Layer</span> for Enterprise Systems" wrapped across 3 lines. The
  // element's full rect spans all 3 lines, so positioning "Your for
  // Enterprise Systems" (the parent's own leftover text) at that FULL box
  // stretches/centers it across the whole heading — landing directly on
  // top of the span's own text instead of at its real top-left/bottom
  // fragments (confirmed live: this is exactly what produced overlapping
  // text in a Figma import). A Range around just that one text node
  // reports its own actual on-screen rects, independent of the parent's
  // or any sibling's — the fix, not a parent/child ordering issue.
  // `containerRect` is the viewport rect of whatever this text's own
  // parent frame will be — NOT always the whole component root. In the
  // layout tree, every container becomes its own frame, so its direct
  // text children are positioned relative to THAT frame, the same way a
  // real CSS child is positioned relative to its immediate parent, not
  // the page root.
  function directTextNodeLayers(el, containerRect, style) {
    // white-space: pre/pre-wrap/pre-line (a <pre>/<code> block, the common
    // real case) means internal whitespace and line breaks are the actual
    // content, not incidental formatting — collapsing them the way normal
    // prose text is collapsed below would silently destroy a captured code
    // sample's indentation and line structure.
    const preserveWhitespace = /^pre/.test(style.whiteSpace || "");
    const out = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = preserveWhitespace ? node.textContent : node.textContent.replace(/\s+/g, " ").trim();
      if (!text || !text.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects());
      range.detach && range.detach();
      if (rects.length === 0) continue;
      // Union of this text node's own rects — handles a single run
      // wrapping across lines without exploding into per-line layers
      // (still tight to just this node, never the parent's full box).
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      out.push({
        text,
        rect: {
          x: Math.round(left - containerRect.left),
          y: Math.round(top - containerRect.top),
          width: Math.round(right - left),
          height: Math.round(bottom - top),
        },
      });
    }
    return out;
  }

  // getComputedStyle keeps a percentage border-radius as a literal "50%"
  // string (unlike most other CSS properties, which resolve to px) — a bare
  // parseFloat("50%") silently reads that as 50 *pixels*, wildly wrong on
  // anything but a coincidentally-clamped square. Percentage radius resolves
  // relative to the box's own size, so convert it here instead. Only the
  // first corner token is read (a "8px 8px 0 0" per-corner shorthand
  // collapses to one value) — an approximation, fine for a position
  // snapshot that isn't claiming pixel-perfect reconstruction anyway.
  function resolveRadius(style, rect) {
    const raw = (style.borderRadius || "0").split(" ")[0];
    if (raw.endsWith("%")) {
      const pct = parseFloat(raw) || 0;
      return Math.round((pct / 100) * Math.min(rect.width, rect.height));
    }
    return parseFloat(raw) || 0;
  }

  function relRectOf(el, rootRect) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left - rootRect.left),
      y: Math.round(r.top - rootRect.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  // Real, confirmed gap (not hypothetical): an "overflow:hidden viewport +
  // larger inner wrapper" is an extremely common pattern — a hover-swap
  // icon (two icons stacked inside a clipped 44px window, sliding on
  // hover), a marquee, a "peek" reveal, an avatar-stack overflow clip.
  // walk()/layerIsVisible only ever checked an element's OWN
  // display/visibility/opacity/size, never whether an ANCESTOR clips it
  // away — so the clipped-off, currently-invisible half of a hover-swap
  // icon was captured right alongside the visible half, exported as two
  // overlapping icons where the real page only ever shows one. Confirmed
  // live against a real refold.ai button (a two-icon hover-slide arrow,
  // "REQUEST A DEMO"): one icon's rect sat entirely outside its
  // grandparent's overflow:hidden clip window, yet both measured as a
  // normal, "visible" 44px icon by every other check. Tracking the
  // accumulated clip region through the whole ancestor chain (not just
  // the immediate parent — this exact case is TWO levels down from the
  // actual clipping element) and rejecting anything with zero overlap is
  // what actually catches it, the same way a real browser's own hit-
  // testing does.
  function elementClips(style) {
    return (
      style.overflow === "hidden" ||
      style.overflow === "clip" ||
      style.overflowX === "hidden" ||
      style.overflowX === "clip" ||
      style.overflowY === "hidden" ||
      style.overflowY === "clip"
    );
  }
  function intersectRects(a, b) {
    if (!a) return b;
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return { left, top, right, bottom };
  }
  function rectHasArea(r) {
    return r.right > r.left && r.bottom > r.top;
  }
  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  // Captures a self-contained copy of an SVG icon's markup so it can be
  // rasterized later (at export time, which is already fully async — see
  // sidepanel.js's performPluginJsonExport — rather than making this whole
  // synchronous capture pipeline async just to load an Image()). Two real
  // gaps a bare el.outerHTML would hit when rendered standalone, outside
  // the page's own document:
  // 1. Icon sprite systems (`<svg><use href="#icon-arrow"></use></svg>`,
  //    with the actual path data living in a separate, often-hidden sprite
  //    sheet elsewhere in the page) — the reference can't resolve outside
  //    the original document, so it would rasterize as nothing. Resolve
  //    it here, while the live document is still available, by inlining
  //    the referenced element's own markup in place of <use>.
  // 2. `fill="currentColor"` (very common for icon systems, inheriting
  //    color from CSS) resolves against whatever `color` is in scope at
  //    render time — outside the page, that's black, not the icon's real
  //    color. Recording the resolved color here lets export-time
  //    rasterization substitute it in, rather than rasterizing everything
  //    black.
  function resolveSvgMarkup(svgEl) {
    try {
      const clone = svgEl.cloneNode(true);
      const uses = clone.querySelectorAll("use");
      uses.forEach((useEl) => {
        const href = useEl.getAttribute("href") || useEl.getAttribute("xlink:href");
        if (!href || !href.startsWith("#")) return;
        const target = document.querySelector(href);
        if (!target) return;
        const inlined = document.createElementNS("http://www.w3.org/2000/svg", "g");
        inlined.innerHTML = target.innerHTML;
        if (target.getAttribute("viewBox") && !clone.getAttribute("viewBox")) {
          clone.setAttribute("viewBox", target.getAttribute("viewBox"));
        }
        useEl.replaceWith(inlined);
      });
      if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const markup = clone.outerHTML;
      // Same defensive cap as everything else captured here — an icon's
      // markup is normally tiny; this only guards against a genuinely
      // pathological sprite dump.
      return markup.length <= 20000 ? markup : undefined;
    } catch (_) {
      return undefined;
    }
  }

  // This element's OWN CSS opacity only — never multiplied by any
  // ancestor's. It's tempting to think a child needs its ancestors'
  // opacity folded in too (a plain `getComputedStyle().opacity` read on a
  // child reports 1 even while a parent's opacity:0.3 is visibly fading it
  // on screen — CSS opacity doesn't inherit as a computed value), but
  // `walk()` builds a real NESTED tree, and code.js builds a real nested
  // Figma frame for every one of these nodes in that exact same structure
  // — Figma composites a parent's opacity over its whole rendered subtree
  // as one unit, exactly like a browser does, so the ancestor fade already
  // happens correctly for free once each node only carries its own value.
  // Pre-multiplying ancestors in here was tried and is a real, confirmed
  // bug (not a hypothetical): it double-applies every ancestor's opacity a
  // second time on top of Figma's own compositing, measured live as a
  // wrong color blend at nesting depth ≥2 (real browser math for a
  // 2-deep opaque-child-under-a-0.8-opacity-parent case is (51,51,255);
  // pre-multiplying produced (92,51,214) instead — the parent's own
  // background color visibly bleeding through a child that should have
  // been fully opaque).
  function ownOpacity(style) {
    const v = parseFloat(style.opacity);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  }

  // "HUG" (grow to fit content) vs "FILL" (stretch to the parent's content
  // width) — the same distinction CSS itself makes between an inline run
  // (a label, a link, a button's own text — sized to its content) and a
  // block element (a paragraph, a heading — stretches to its container).
  // Read directly off the element's own `display`, not guessed. Vertical
  // is always HUG for text: a substituted Figma font rendering wider than
  // the original needs room to wrap onto an extra line without colliding
  // with whatever comes after it (confirmed live — this was the exact
  // mechanism behind a reported overlap bug).
  function leafSizing(display) {
    const isInline = display === "inline" || display === "inline-block" || display === "inline-flex";
    return { horizontal: isInline ? "HUG" : "FILL", vertical: "HUG" };
  }

  // Whether ANY text leaf exists anywhere in this already-built subtree —
  // used to decide whether a HORIZONTAL auto-layout frame needs to be
  // allowed to grow (see the primarySizing note below). Recurses through
  // frame children only (text/image/icon-placeholder leaves are the base
  // case), matching the exact shape `walk()` already returns.
  function subtreeHasText(node) {
    if (!node) return false;
    if (node.kind === "text") return true;
    if (node.kind === "frame" && Array.isArray(node.children)) {
      return node.children.some(subtreeHasText);
    }
    return false;
  }

  // A real photo or SVG icon has an actual intrinsic size, not text that
  // needs room to reflow — leafSizing's HUG/FILL split exists specifically
  // to protect TEXT from font-substitution growth, and doesn't apply here.
  // Confirmed live in real Figma: an icon inside a fixed 40×40 centered
  // badge inherited leafSizing's "FILL" for its own inline SVG display and
  // stretched to fill the badge's now-correct 40px width, distorting a
  // 20×20 square icon into a 40×20 smear. Media leaves always keep their
  // own captured size instead.
  const MEDIA_SIZING = { horizontal: "FIXED", vertical: "FIXED" };

  const JUSTIFY_TO_PRIMARY = {
    "flex-start": "MIN", start: "MIN", left: "MIN",
    "flex-end": "MAX", end: "MAX", right: "MAX",
    center: "CENTER",
    "space-between": "SPACE_BETWEEN",
  };
  const ALIGN_TO_COUNTER = {
    "flex-start": "MIN", start: "MIN",
    "flex-end": "MAX", end: "MAX",
    center: "CENTER",
    stretch: "MIN",
    baseline: "MIN",
  };

  // Auto Layout is the ONLY mechanism Figma has for "this container
  // repositions its children when one of them changes size" — writing
  // fixed x/y (the old approach) can never avoid a collision when a
  // substituted font reflows text taller than expected, because nothing
  // downstream of that text is told to move. Detecting eligibility only
  // from computed style actually present on the element (never guessed)
  // keeps this safe: anything that doesn't clearly qualify falls back to
  // the original fixed-position behavior untouched, rather than risking a
  // WRONG auto-layout guess, which would be a worse bug than today's.
  // Gap is measured from the REAL rendered positions of the children, not
  // read off `style.gap`/`rowGap`/`columnGap` — confirmed live this is a
  // real, common gap (no pun intended): a flex column with no CSS `gap`
  // property at all (computed style reports the literal string "normal",
  // which `parseFloat` turns into NaN and this used to silently coerce to
  // 0) can still have real, deliberate spacing between its children via
  // plain `margin-top` on each one instead — exactly what a real hero
  // section on refold.ai does (paragraph margin-top:24px, button row
  // margin-top:40px, gap:normal) — and reading only `style.gap` is blind
  // to that entirely, collapsing every child flush against the next
  // regardless of how much real space separated them on the page. The
  // median empirical gap between consecutive children's own rects is
  // correct either way: it naturally reflects a real CSS `gap` value
  // exactly (nothing else could have produced that spacing) AND correctly
  // captures margin-driven spacing that `gap` can't see at all.
  function medianGapAlongAxis(childRects, isColumn) {
    if (childRects.length < 2) return 0;
    const gaps = [];
    for (let i = 1; i < childRects.length; i++) {
      gaps.push(
        isColumn
          ? childRects[i].y - (childRects[i - 1].y + childRects[i - 1].height)
          : childRects[i].x - (childRects[i - 1].x + childRects[i - 1].width)
      );
    }
    gaps.sort((a, b) => a - b);
    return Math.max(0, Math.round(gaps[Math.floor(gaps.length / 2)]));
  }

  function detectFlexLayout(style, childRects) {
    const display = style.display;
    if (display !== "flex" && display !== "inline-flex") return null;
    if (style.flexWrap && style.flexWrap !== "nowrap") return null; // wrapping flex not modeled — safe fallback
    const direction = style.flexDirection || "row";
    if (direction.endsWith("reverse")) return null; // visual order would differ from DOM order — safe fallback rather than risk reversing content
    const isColumn = direction.startsWith("column");
    return {
      mode: isColumn ? "VERTICAL" : "HORIZONTAL",
      gap: medianGapAlongAxis(childRects, isColumn),
      primaryAlign: JUSTIFY_TO_PRIMARY[style.justifyContent] || "MIN",
      counterAlign: ALIGN_TO_COUNTER[style.alignItems] || "MIN",
      paddingTop: Math.round(parseFloat(style.paddingTop) || 0),
      paddingRight: Math.round(parseFloat(style.paddingRight) || 0),
      paddingBottom: Math.round(parseFloat(style.paddingBottom) || 0),
      paddingLeft: Math.round(parseFloat(style.paddingLeft) || 0),
    };
  }

  // Plain block flow (a card that's just "heading, then paragraph, then
  // button", no flexbox at all — extremely common) reads as a vertical
  // stack when children are genuinely non-overlapping and strictly
  // top-to-bottom; `gap` isn't a real CSS property here, so it's inferred
  // as the median space between consecutive children, which is a safe,
  // representative single number for margin-driven spacing that's usually
  // consistent between siblings in real designs.
  function detectBlockStackLayout(style, childRects) {
    if (style.display === "grid" || style.display === "inline-grid") return null;
    if (childRects.length < 1) return null;
    for (let i = 1; i < childRects.length; i++) {
      if (childRects[i].y < childRects[i - 1].y + childRects[i - 1].height - 1) return null; // overlap or out-of-order — not a simple stack
    }
    return {
      mode: "VERTICAL",
      gap: medianGapAlongAxis(childRects, true),
      primaryAlign: "MIN",
      counterAlign: "MIN",
      paddingTop: Math.round(parseFloat(style.paddingTop) || 0),
      paddingRight: Math.round(parseFloat(style.paddingRight) || 0),
      paddingBottom: Math.round(parseFloat(style.paddingBottom) || 0),
      paddingLeft: Math.round(parseFloat(style.paddingLeft) || 0),
    };
  }

  // Walks the LIVE element (not the sanitized clone — computed styles only
  // resolve on connected elements) and returns a NESTED TREE — every real
  // container becomes its own frame node with the CSS layout Figma should
  // use for its children (or null, meaning "position these children
  // explicitly," the original fallback), rather than a flat list of
  // absolute-positioned layers. This is what actually lets Figma reflow
  // content instead of colliding — see CONTEXT_HANDOFF.md for the full
  // rationale and researched prior art (html.to.design's own approach).
  function extractComponentLayers(rootEl) {
    let totalNodes = 0;
    let truncated = false;

    // `parentRect` is the viewport rect of whatever frame this element
    // will be placed inside — the element's OWN direct parent, not always
    // the component root, mirroring how a real DOM child is positioned
    // relative to its immediate parent, not the page. `clipRect` is the
    // accumulated intersection of every ANCESTOR's own overflow:hidden/
    // clip region encountered so far (absolute viewport coordinates,
    // unbounded/absent at the root) — see elementClips/intersectRects
    // above for why this has to be tracked across the whole chain, not
    // just the immediate parent.
    function walk(el, parentRect, clipRect) {
      if (truncated) return null;
      if (el.nodeType !== Node.ELEMENT_NODE) return null;
      const tag = el.tagName.toLowerCase();
      if (LAYER_SKIP_TAGS.has(tag)) return null;
      if (Acopio.isOwnNode(el)) return null; // defensive — shouldn't ever be a descendant of a page element, but never trust a single check alone
      const style = window.getComputedStyle(el);
      const elRect = el.getBoundingClientRect();
      const rect = {
        x: Math.round(elRect.left - parentRect.left),
        y: Math.round(elRect.top - parentRect.top),
        width: Math.round(elRect.width),
        height: Math.round(elRect.height),
      };
      if (!layerIsVisible(style, rect)) return null;
      // Clipped away by an ancestor (immediate parent or further up) even
      // though this element's own display/visibility/opacity/size all
      // read as perfectly normal — real, common case: the off-screen half
      // of a hover-swap icon, a marquee item currently scrolled past its
      // viewport, an avatar past an avatar-stack's overflow limit.
      if (clipRect && !rectsOverlap(elRect, clipRect)) return null;
      const nextClipRect = elementClips(style) ? intersectRects(clipRect, elRect) : clipRect;
      // This node's OWN opacity only — NOT multiplied by any ancestor's.
      // code.js builds a real Figma frame for every one of these nodes,
      // nested exactly the way they're nested here, and Figma (like any
      // real compositor) already applies a parent's opacity to its whole
      // rendered subtree as a unit — precompounding it into every
      // descendant's own value here would apply it a second time. Verified
      // live: a 3-level-deep nested opacity:0.8 ancestor previously
      // rendered a fully-opaque-on-the-real-page child as a wrong blend of
      // its own color with its parent's, growing darker at every
      // additional nesting level — real browser math for that exact case
      // is (51,51,255); the old cumulative approach produced (92,51,214).
      const opacity = ownOpacity(style);
      totalNodes++;
      if (totalNodes > MAX_TREE_NODES) {
        truncated = true;
        return null;
      }

      if (tag === "img" || tag === "video") {
        const url = tag === "img" ? Acopio.resolveImgSrc(el) : Acopio.resolveVideoOrPoster(el).url;
        if (!url) return null;
        return { kind: "image", x: rect.x, y: rect.y, width: rect.width, height: rect.height, url, opacity, sizing: MEDIA_SIZING };
      }

      // SVGs commonly used here are small decorative icons (or occasionally
      // a larger inline illustration). The markup + resolved color
      // captured here let export time rasterize a real image instead of
      // this being a placeholder forever — kept as "icon-placeholder" kind
      // (not "image") specifically so a rasterization failure (malformed
      // markup, a reference that still didn't resolve) has an honest
      // fallback rect to degrade to, same as before.
      if (tag === "svg") {
        if (rect.width < 4 || rect.height < 4) return null;
        const resolvedColorInfo = Acopio.rgbToHex(style.color);
        return {
          kind: "icon-placeholder",
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          opacity,
          sizing: MEDIA_SIZING,
          svgMarkup: resolveSvgMarkup(el),
          resolvedColor: resolvedColorInfo ? resolvedColorInfo.hex : undefined,
        };
      }

      // This element's own background becomes the FRAME's own fill below
      // (no separate rect layer duplicating the frame's bounds needed —
      // every container is a real frame now, so its background just IS
      // the frame's fill, the same way a CSS background paints directly
      // on the box, not a synthetic child sitting behind it).
      const bg = Acopio.rgbToHex(style.backgroundColor);
      const bgImageRaw = style.backgroundImage;
      const isGradient = Boolean(bgImageRaw && bgImageRaw.includes("gradient"));
      const hasSolidBg = Boolean(bg && bg.a > 0.02);
      const fill = hasSolidBg && !isGradient ? bg.hex : null;
      // WithAlpha, not the plain hex-only version — this is the frame the
      // Figma plugin actually builds from; a transparent fade stop losing
      // its alpha here is what previously turned a legibility scrim into a
      // flat black rectangle (see parseGradientStopsWithAlpha in shared.js).
      const gradientStops = isGradient ? Acopio.parseGradientStopsWithAlpha(bgImageRaw) : undefined;
      const gradientDirection = isGradient ? Acopio.parseGradientDirection(bgImageRaw) : undefined;
      const fillOpacity = hasSolidBg ? bg.a : 1;
      const radius = resolveRadius(style, rect);

      const children = [];

      // A decorative/hero photo set as a CSS background-image on a plain
      // div (extremely common — card thumbnails, hero illustrations)
      // rather than a real <img> tag doesn't fit a Figma frame's single
      // `fill` the way a flat color does when it needs to coexist with
      // this element's OWN backgroundColor — modeled as its own real
      // image leaf, filling the frame, painted first (behind whatever
      // else this element contains).
      if (bgImageRaw && bgImageRaw !== "none" && !isGradient) {
        const match = bgImageRaw.match(/url\(["']?([^"')]+)["']?\)/);
        const bgUrl = match && match[1];
        if (bgUrl && rect.width >= 4 && rect.height >= 4) {
          children.push({
            kind: "image",
            x: 0,
            y: 0,
            width: rect.width,
            height: rect.height,
            url: bgUrl,
            opacity: 1,
            sizing: { horizontal: "FILL", vertical: "FILL" },
          });
        }
      }

      let hasOwnText = false;
      for (const { text, rect: textRect } of directTextNodeLayers(el, elRect, style)) {
        hasOwnText = true;
        const colorInfo = Acopio.rgbToHex(style.color);
        children.push({
          kind: "text",
          x: textRect.x,
          y: textRect.y,
          width: textRect.width,
          height: textRect.height,
          text: text.slice(0, 500),
          fontFamily: style.fontFamily.split(",")[0].replace(/['"]/g, "").trim(),
          fontWeight: style.fontWeight,
          fontSizePx: parseFloat(style.fontSize) || 14,
          lineHeightPx: parseFloat(style.lineHeight) || null,
          color: colorInfo ? colorInfo.hex : "#000000",
          textAlign: style.textAlign,
          opacity,
          sizing: leafSizing(style.display),
        });
      }

      // Probe direct element children once (cheap relative to the rest of
      // this walk, which already calls getComputedStyle per element)
      // purely to decide the layout mode BEFORE recursing for real —
      // detection needs every child's rect/position/float up front, not
      // discovered one at a time mid-recursion.
      const childProbe = [];
      for (const child of Array.from(el.children)) {
        if (LAYER_SKIP_TAGS.has(child.tagName.toLowerCase())) continue;
        if (Acopio.isOwnNode(child)) continue;
        const cStyle = window.getComputedStyle(child);
        const cRect = relRectOf(child, elRect);
        if (!layerIsVisible(cStyle, cRect)) continue;
        // Same ancestor-clip rejection walk() itself applies — needed HERE
        // too, not just inside the recursive walk() call for this same
        // child, because a clipped-away child left in childProbe would
        // still corrupt flex/block-stack layout detection below (wrong
        // gap, wrong overlap check) even though walk() would go on to
        // correctly drop it as a rendered node a moment later.
        if (nextClipRect && !rectsOverlap(child.getBoundingClientRect(), nextClipRect)) continue;
        childProbe.push({ el: child, style: cStyle, rect: cRect });
      }
      const hasPositionedChild = childProbe.some((p) => p.style.position === "absolute" || p.style.position === "fixed");
      const hasFloatedChild = childProbe.some((p) => p.style.float && p.style.float !== "none");

      // A run of inline text-flow content — either literal mixed text+span
      // content (hasOwnText + element children both present) OR several
      // small inline wrapper elements that exist purely to carry per-word
      // styling (a real site's own scroll-reveal heading splits every WORD
      // into its own `display:inline-block` wrapper div — verified live:
      // 19 one-word wrapper divs inside a single <h2>) — can't be
      // decomposed into independently-positioned rectangles, no matter how
      // accurately each one's own rect is measured. Two failure modes,
      // both confirmed live against real captured rects: (1) a text run's
      // OWN client rects can span multiple lines with DIFFERENT left edges
      // when it shares its first line with a preceding sibling (e.g. a
      // "Stop rebuilding." span, then " Start compounding." continuing on
      // that same line before wrapping to its own line below) — the Range
      // union in directTextNodeLayers has no choice but to take the
      // leftmost edge across ALL of a run's lines, which is only correct
      // when every line of that run starts at that same edge, so it
      // overshoots left on the wrapped line and lands directly on top of
      // the sibling; (2) even same-line siblings that each measure
      // correctly on the real page collide the instant Figma substitutes a
      // different (near-certainly-uninstalled) font at import time — an
      // edge-to-edge fixed-width word box has nowhere to grow, so a wider
      // substituted glyph run spills straight into the next word's box.
      // Flattening the whole run into ONE real text node (this element's
      // own textContent, in its own single box) sidesteps both: Figma
      // hugs/wraps it with its own substituted font, the same safe pattern
      // every plain <h3>/<p> text leaf elsewhere in this file already
      // uses. This costs per-run styling (the grey/dark two-tone on
      // "Stop rebuilding."/"Start compounding." is lost) — a deliberate
      // trade for never producing overlapping text, the same trade this
      // project already made for CSS Grid and wrapping flexbox.
      // A confirmed, real regression this same flatten fix introduced:
      // `node.children` only ever sees LIGHT DOM — a web component with
      // real content living in its shadow root (or simply not yet
      // upgraded) reports ZERO children here even while genuinely
      // containing a whole interactive form. `.every()` on an empty array
      // is vacuously true, so a <gws-newsletter-intake-form> (a real
      // country-picker + text input + submit button on this exact site)
      // silently passed as "pure text" and got flattened via its own
      // `.textContent` — which, unlike `.children`, DOES pierce shadow
      // DOM — dumping an entire ~200-country dropdown's option list as one
      // 46,000-character text node. Custom elements are guaranteed by the
      // Web Components spec to have a hyphen in their tag name, which is
      // the one reliable signal available here that a "no children" read
      // might be lying about what's actually inside — excluded outright
      // rather than trusted. Form controls get the same treatment: never
      // semantically "just text" even when genuinely childless.
      const OPAQUE_OR_INTERACTIVE_TAGS = new Set(["select", "textarea", "input", "button", "iframe", "canvas", "video", "audio"]);
      const isPureTextSubtree = (node) => {
        const t = node.tagName.toLowerCase();
        if (t === "img" || t === "video" || t === "svg") return false;
        if (t.includes("-") || OPAQUE_OR_INTERACTIVE_TAGS.has(t) || node.shadowRoot) return false;
        return Array.from(node.children).every(isPureTextSubtree);
      };
      const allChildrenInline =
        childProbe.length > 0 &&
        childProbe.every(
          (p) => p.style.display === "inline" || p.style.display === "inline-block" || p.style.display === "inline-flex"
        );
      const isInlineTextRun = allChildrenInline && childProbe.every((p) => isPureTextSubtree(p.el));
      if ((hasOwnText || isInlineTextRun) && childProbe.length > 0 && rect.width >= 1 && rect.height >= 1) {
        // <br> carries real, intentional line-break meaning here (Glean's
        // own word-split heading uses one between each sentence) — a plain
        // el.textContent silently drops it entirely, running two sentences
        // together with no space at all ("faster.Glean"). Swapping every
        // <br> for a real newline on a clone (never mutate the live page)
        // before reading textContent keeps that break; the collapse below
        // still normalizes runs of spaces/tabs same as everywhere else, it
        // just no longer erases intentional newlines along with them.
        const textClone = el.cloneNode(true);
        textClone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
        const flatText = (textClone.textContent || "").replace(/[ \t]+/g, " ").replace(/ *\n+ */g, "\n").trim();
        if (flatText) {
          const colorInfo = Acopio.rgbToHex(style.color);
          return {
            kind: "text",
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            text: flatText.slice(0, 500),
            fontFamily: style.fontFamily.split(",")[0].replace(/['"]/g, "").trim(),
            fontWeight: style.fontWeight,
            fontSizePx: parseFloat(style.fontSize) || 14,
            lineHeightPx: parseFloat(style.lineHeight) || null,
            color: colorInfo ? colorInfo.hex : "#000000",
            textAlign: style.textAlign,
            opacity,
            sizing: leafSizing(style.display),
          };
        }
      }

      // Mixed content — this element has BOTH its own direct text AND
      // element children (e.g. "Your <span>AI Integration Delivery
      // Layer</span> for Enterprise Systems" — text, then an inline span,
      // then more text) — is deliberately excluded from auto-layout
      // detection entirely, not just from the block-stack path. Two
      // compounding problems, confirmed together in a REAL Figma file:
      // (1) text leaves are pushed into `children` before element
      // children are recursed into, so the array order doesn't match true
      // DOM/reading order for interleaved content — Auto Layout stacks
      // strictly in array order, so it rendered "Your", then "for
      // Enterprise Systems", then the span, instead of the real
      // interleaved reading order; (2) detectBlockStackLayout only checks
      // ELEMENT children for overlap, never text leaves, so a single
      // element child (the span) trivially "passed" as non-overlapping
      // and wrongly earned auto-layout it shouldn't have. Reconstructing
      // true interleaved inline flow is a much harder problem than either
      // fix alone — falling back to absolute positioning here is safe
      // instead: every child (text leaf via Range-measurement, element
      // child via getBoundingClientRect) already carries its own accurate
      // real position, which is exactly what absolute mode uses directly,
      // regardless of array order.
      const hasMixedTextAndElements = hasOwnText && childProbe.length > 0;
      let layout = null;
      if (!hasPositionedChild && !hasMixedTextAndElements) {
        layout = detectFlexLayout(style, childProbe.map((p) => p.rect));
        if (!layout && !hasFloatedChild) {
          layout = detectBlockStackLayout(style, childProbe.map((p) => p.rect));
        }
      }
      // A text-only leaf (<h3>, <p> — no element children at all, just its
      // own text) has nothing to "stack," so detectBlockStackLayout never
      // fires for it (it needs ≥1 element child) and it fell through to
      // layout:null. That silently broke the whole point of Auto Layout:
      // the text node itself still hugs its own content height, but a
      // layout:null wrapper never resizes to match, so growth from a
      // substituted font stopped at the text node and never reached the
      // real auto-layout ancestor around it — confirmed in a REAL Figma
      // file (not a mock): the exact reported collision reproduced even
      // with the surrounding card correctly set to VERTICAL auto-layout.
      // A trivial pass-through auto-layout (nothing to align, zero gap)
      // is all this needs — it just has to hug ITS OWN single text child
      // so the growth keeps propagating upward.
      // Whether THIS wrapper frame, in turn, should hug or fill inside
      // *its own* parent — only set for the trivial pass-through case just
      // below. A generic nested card/section has no opinion here (stays
      // undefined, and the plugin defaults it to FIXED — keep the
      // captured size, don't stretch a sub-card that was genuinely
      // narrower than its container on the real page).
      let ownSizing;
      if (!layout && !hasPositionedChild && childProbe.length === 0 && hasOwnText) {
        layout = {
          mode: "VERTICAL",
          gap: 0,
          primaryAlign: "MIN",
          counterAlign: "MIN",
          paddingTop: Math.round(parseFloat(style.paddingTop) || 0),
          paddingRight: Math.round(parseFloat(style.paddingRight) || 0),
          paddingBottom: Math.round(parseFloat(style.paddingBottom) || 0),
          paddingLeft: Math.round(parseFloat(style.paddingLeft) || 0),
        };
        // Same inline-vs-block distinction real CSS makes, applied to this
        // wrapper itself now that it's a real frame: a <button>/<a> label
        // (commonly inline/inline-block) should HUG so a wider substituted
        // font can grow the whole pill horizontally instead of wrapping
        // the label onto an extra line inside a width frozen at what the
        // ORIGINAL font measured (confirmed live: exactly what happened to
        // a real Glean button — "Register for Glean:GO replays" wrapped to
        // 2 lines because its wrapper was FIXED-width instead of able to
        // grow). A <h3>/<p> (block by default) keeps FILL — it should
        // still stretch to match sibling width and wrap naturally, which
        // was already correct.
        ownSizing = leafSizing(style.display);
      }

      // z-index reordering, absolute mode only. `children`'s array order is
      // also PAINT order downstream (code.js's buildTreeNode appends each
      // child to its Figma frame in array sequence, and Figma — like a
      // browser — paints a later-appended child on top) — that's the right
      // behavior when array order came from real top-to-bottom DOM flow,
      // but plain DOM order is NOT the same thing as visual stacking once
      // real CSS `z-index` is involved, which absolutely-positioned
      // overlay content (a photo + its caption, a badge on a card, a play
      // button on a thumbnail) uses constantly, specifically to override
      // DOM order. Confirmed live: a real Google Cloud feature card has
      // its caption BEFORE its background photo in DOM order but gives
      // the caption the higher z-index — walking in raw DOM order put the
      // photo on top in Figma, completely hiding the caption underneath
      // it. Only reordering `childProbe` here (never in Auto Layout mode,
      // where array order is simultaneously position AND paint order
      // together — reordering there would silently move content, not
      // just repaint it) fixes this without touching anything else.
      if (!layout && hasPositionedChild) {
        childProbe.sort((a, b) => {
          const az = parseInt(a.style.zIndex, 10);
          const bz = parseInt(b.style.zIndex, 10);
          const azSafe = Number.isFinite(az) ? az : 0;
          const bzSafe = Number.isFinite(bz) ? bz : 0;
          return azSafe - bzSafe; // stable sort: equal z-index keeps original DOM order as the tiebreaker
        });
      }

      for (const p of childProbe) {
        if (truncated) break;
        const childNode = walk(p.el, elRect, nextClipRect);
        if (childNode) children.push(childNode);
      }

      // Whether this frame's own primary (stacking) axis should hug its
      // children or keep its captured size. VERTICAL always hugs (the
      // original overlap fix — a substituted font wrapping onto an extra
      // line needs the card to grow taller). HORIZONTAL is genuinely two
      // different real-world shapes that look identical in computed
      // style — a small fixed-size icon-centering badge (justify/align:
      // center, no padding, sized by an explicit width/height, never
      // meant to grow) and a button/label row whose text needs room to
      // widen for a substituted font — and CSS gives no clean way to
      // tell them apart from computed style alone. Confirmed live,
      // TWICE, choosing either answer unconditionally breaks the other
      // shape: always-FIXED collapses nothing, but a "Learn How" button
      // label with no room to grow overflowed straight into its own
      // icon instead of widening the button (real substituted-font
      // text hugged to its true width, unable to push the row wider);
      // always-AUTO (the original behavior) is what let a 40×40
      // icon-centering badge collapse to exactly its 20px icon's width
      // in the first place. The one signal that's actually reliable:
      // whether real text lives anywhere in this subtree at all — an
      // icon badge never contains text (nothing can grow, safe to stay
      // fixed), a button/label row always does (something might
      // genuinely need the extra room).
      if (layout) {
        layout.primarySizing = layout.mode === "VERTICAL" || children.some(subtreeHasText) ? "AUTO" : "FIXED";
      }

      return {
        kind: "frame",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        fill,
        // Kept separate on purpose, not multiplied together: fillOpacity is
        // the background COLOR's own alpha (rgba(0,0,0,0.5) — a
        // translucent overlay) and only ever paints the fill itself in
        // real CSS. opacity is the element's own whole-box CSS opacity,
        // which fades the element AND everything inside it. A frame now
        // genuinely has children nested inside it (unlike the old flat
        // layer list), so collapsing these into one number would
        // incorrectly fade a frame's children by its background's alpha
        // too — e.g. a solid black rgba(0,0,0,0.9) card background would
        // wrongly wash out the text sitting on top of it.
        fillOpacity,
        gradientStops,
        gradientDirection,
        opacity,
        radius,
        layout,
        sizing: ownSizing,
        children,
      };
    }

    const rootRect = rootEl.getBoundingClientRect();
    const tree = walk(rootEl, rootRect, null); // null: no ancestor clip above the capture root itself
    return { tree, truncated };
  }

  function buildTypeData(el, tagInfo, style) {
    if (tagInfo.type === "color") {
      const parsed = Acopio.rgbToHex(style.backgroundColor) || { hex: null, r: 0, g: 0, b: 0, a: 1 };
      const bgImage = style.backgroundImage;
      const isGradient = Boolean(bgImage && bgImage.includes("gradient"));
      return {
        hex: parsed.hex,
        rgb: { r: parsed.r, g: parsed.g, b: parsed.b },
        alpha: parsed.a,
        isGradient,
        gradientStops: isGradient ? bgImage : undefined,
      };
    }
    if (tagInfo.type === "font") {
      const family = style.fontFamily.split(",")[0].replace(/['"]/g, "").trim();
      const fontsReady = !window.document.fonts || document.fonts.status === "ready";
      // A "Button" classification is a real on-page shape, not just text —
      // the tooltip already computes background/border for its own display
      // (overlay.js's buildTypeBody font branch) but was never SAVING any
      // of it, so an exported button always arrived with typography only,
      // no fill/border/radius to reconstruct the actual box with. Captured
      // for every font item (cheap — resolves to null when there's nothing
      // there, same as a plain heading/body run over transparent
      // background), not gated to family === "button" specifically, since
      // family can be corrected after the fact (see the family pills) and
      // shouldn't require re-hovering to pick this up.
      const rect = el.getBoundingClientRect();
      const bgParsed = Acopio.rgbToHex(style.backgroundColor);
      const hasSolidBg = Boolean(bgParsed && bgParsed.a > 0.02);
      const bgGradientStops = Acopio.parseGradientStops(style.backgroundImage);
      const borderWidthPx = parseFloat(style.borderTopWidth) || 0;
      const borderParsed = Acopio.rgbToHex(style.borderTopColor);
      const hasVisibleBorder = Boolean(
        borderWidthPx > 0 && style.borderTopStyle !== "none" && borderParsed && borderParsed.a > 0.02
      );
      return {
        family,
        fallbackStack: style.fontFamily,
        weight: style.fontWeight,
        sizePx: parseFloat(style.fontSize),
        lineHeightPx: parseFloat(style.lineHeight) || null,
        letterSpacingPx: style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing),
        source: detectFontSource(family),
        sampleText: (el.textContent || "").trim().slice(0, 80),
        fontMayStillBeLoading: !fontsReady,
        boundingBoxWidth: Math.round(rect.width),
        boundingBoxHeight: Math.round(rect.height),
        backgroundHex: hasSolidBg ? bgParsed.hex : null,
        backgroundAlpha: hasSolidBg ? bgParsed.a : 1,
        backgroundGradientStops: bgGradientStops.length >= 2 ? bgGradientStops : undefined,
        borderRadius: resolveRadius(style, rect),
        borderColorHex: hasVisibleBorder ? borderParsed.hex : null,
        borderWidthPx: hasVisibleBorder ? borderWidthPx : 0,
      };
    }
    if (tagInfo.type === "image") {
      // el itself might be a decorated wrapper (gradient tint, hover scrim)
      // around the real photo rather than the photo itself — the same
      // resolution isImageish already used to classify it this way in the
      // first place (Acopio.findRealMediaChild). Everything below reads
      // from the actual media element so src/dimensions/format come from
      // the real photo, not the wrapper's own empty background.
      const mediaEl = /^(img|video)$/.test(el.tagName.toLowerCase()) ? el : Acopio.findRealMediaChild(el) || el;
      const tagName = mediaEl.tagName.toLowerCase();
      const isImgTag = tagName === "img";
      const isVideoTag = tagName === "video";
      const isSvgImageTag = tagName === "image"; // SVG's own leaf <image> — see overlay.js's identical branch

      if (isSvgImageTag) {
        const href = Acopio.resolveSvgImageHref(mediaEl);
        const rect = mediaEl.getBoundingClientRect();
        return {
          url: href,
          width: rect.width,
          height: rect.height,
          altText: mediaEl.getAttribute("aria-label") || "",
          format: href ? href.split(".").pop().split("?")[0] : null,
          isVideo: false,
          blobIfFetched: undefined,
        };
      }
      if (isVideoTag) {
        // GIF-replacement pattern: many sites serve "animated GIFs" as an
        // autoplay/muted/loop <video> instead of an actual .gif file. Some
        // of those (MSE/HLS-streamed players, Pinterest's own being the
        // common real case) only ever expose a blob: URL — a one-time
        // handle tied to that page's own <video> element, which would
        // permanently save as a dead reference the moment this tab closes.
        // resolveVideoOrPoster falls back to the video's own poster frame
        // (a real, stable image) when that happens, and reports isVideo
        // accordingly so it's saved and rendered as what it actually is.
        const { url, isVideo } = Acopio.resolveVideoOrPoster(mediaEl);
        return {
          url,
          width: mediaEl.videoWidth || mediaEl.offsetWidth,
          height: mediaEl.videoHeight || mediaEl.offsetHeight,
          altText: mediaEl.getAttribute("aria-label") || mediaEl.title || "",
          format: url ? url.split(".").pop().split("?")[0] : null,
          isVideo, // side panel/tooltip render this as <video>, not <img> — a video file in an <img> tag just shows a broken icon
          blobIfFetched: undefined, // best-effort fetch deferred to export — see PLAN.md
        };
      }
      const imgSrc = isImgTag ? Acopio.resolveImgSrc(mediaEl) : null;
      return {
        url: isImgTag ? imgSrc : (style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/) || [])[1] || null,
        width: isImgTag ? mediaEl.naturalWidth : mediaEl.offsetWidth,
        height: isImgTag ? mediaEl.naturalHeight : mediaEl.offsetHeight,
        altText: mediaEl.getAttribute("alt") || "",
        format: isImgTag ? (imgSrc || "").split(".").pop().split("?")[0] : null,
        isVideo: false,
        blobIfFetched: undefined, // best-effort fetch deferred to export (Phase 5) — see PLAN.md
      };
    }
    // component
    const sanitized = Acopio.sanitizeCaptureElement(el);
    const rect = el.getBoundingClientRect();
    // Tree extraction reads the LIVE element's computed styles/rects —
    // must run before sanitizeCaptureElement's clone is the only copy left,
    // and independent of it: sanitized.html stays the "paste as HTML"
    // representation, layoutTree is the "real editable Figma nodes,
    // reflow-safe" one.
    const { tree, truncated: layersTruncated } = extractComponentLayers(el);
    return {
      __sanitizeResult: sanitized, // consumed by buildCaptureData's caller, stripped before storage
      outerHTML: sanitized.html,
      scopedCss: "", // full computed-style scoping lands in Phase 2 when the Library renders components
      boundingBoxWidth: Math.round(rect.width),
      boundingBoxHeight: Math.round(rect.height),
      layoutTree: tree,
      layersTruncated,
    };
  }

  // Split into two steps so overlay.js can show its own inline "capture
  // anyway?" confirmation for oversized components, instead of a native
  // window.confirm() — a blocking native browser dialog is exactly the
  // "generic dev-tools clone" look the spec explicitly asked NOT to ship,
  // and it freezes the whole tab's main thread until dismissed.
  //
  // Step 1 (pure, synchronous): compute the type-specific data and flag
  // whether it needs confirmation. No network/storage side effects.
  Acopio.buildCaptureData = function buildCaptureData(el, tagInfo) {
    const style = window.getComputedStyle(el);
    const data = buildTypeData(el, tagInfo, style);
    let oversizeInfo = null;
    if (data.__sanitizeResult) {
      oversizeInfo = data.__sanitizeResult;
      delete data.__sanitizeResult;
    }
    return { data, oversizeInfo };
  };

  // Step 2: actually build the item and send it to the background worker.
  // Called either immediately (no confirmation needed) or after the user
  // clicks "capture anyway" in overlay.js's inline confirm.
  Acopio.finalizeCapture = function finalizeCapture(el, tagInfo, data, note, callback, options) {
    // No isConnected gate here — onCollectClick is the one place that
    // decides whether `data` came from a still-live element or a cached
    // pre-disconnect snapshot (overlay.js's lastKnownCapture), and either
    // way `data` is already fully and validly extracted by the time it
    // reaches this function. cssSelectorFor below only reads el's own
    // tag/id/class (no ancestor walk), so it works fine even on a node
    // that's since been removed from the page.
    const item = {
      id: Acopio.uuid(),
      type: tagInfo.type,
      family: tagInfo.family,
      hostname: (options && options.hostname) || Acopio.hostname(),
      capturedAt: new Date().toISOString(),
      sourceUrl: window.location.href,
      sourcePageTitle: document.title,
      selector: Acopio.cssSelectorFor(el),
      note: note || "",
      familyOverridden: Boolean(tagInfo.familyOverridden),
      contextThumbnail: null, // deferred — see PLAN.md (activeTab isn't granted on a plain in-page click)
      data,
    };

    // If the extension was reloaded (chrome://extensions refresh, or an
    // update) while this tab's content script is still the OLD injected
    // copy, chrome.runtime.sendMessage throws synchronously ("Extension
    // context invalidated") instead of just erroring in the callback —
    // very easy to hit while actively developing, since that's exactly
    // what reloading the extension mid-session does to every open tab.
    //
    // callback is guaranteed to fire exactly once, even if the response
    // never arrives at all — a real, confirmed failure mode under Manifest
    // V3: the background service worker can be suspended by Chrome mid-
    // request (most likely exactly when captures are happening back to
    // back, which is also when this is most likely to be hit), and a
    // suspended worker never calls sendResponse — no error, no
    // chrome.runtime.lastError, the callback here just never fires.
    // overlay.js's onCollectClick sets isSaving = true before calling this
    // and only ever clears it inside this callback — without a timeout,
    // that flag stays stuck true forever, and isBusy() (noteFieldHasFocus
    // || isSaving) then permanently blocks onMouseMove from opening the
    // tooltip for anything else on the page — exactly the reported "tooltip
    // stops working after several collects, needs a refresh" bug. A
    // generous 8s cutoff means a real response almost always wins the race
    // (finish() below is a no-op the second time either way), while a truly
    // hung request still recovers the UI instead of freezing it.
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback(result);
    };
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
        finish({ ok: true, item, hostname: item.hostname, count: response.count });
      });
    } catch (err) {
      finish({
        ok: false,
        error: "Acopio was reloaded — refresh this page to keep collecting.",
      });
    }
  };

  // Section 8: "two near-identical colors or fonts captured from the same
  // site" — checked before the actual save, so the tooltip can offer a
  // "you already have something close — save anyway or skip?" prompt.
  Acopio.checkDuplicate = function checkDuplicate(hostname, type, data, callback, selector) {
    try {
      chrome.runtime.sendMessage({ type: "CHECK_DUPLICATE", payload: { hostname, type, data, selector } }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          callback(null); // best-effort — a failed check should never block capture itself
          return;
        }
        callback(response.similar);
      });
    } catch (_) {
      callback(null);
    }
  };

  // Third callback arg (`total`) is the REAL count of items collected for
  // this hostname, not just how many fit in `items` (capped at `limit`) —
  // existing callers that only take (items) are unaffected.
  Acopio.fetchRecentItems = function fetchRecentItems(hostname, limit, callback) {
    try {
      chrome.runtime.sendMessage({ type: "GET_RECENT_ITEMS", payload: { hostname, limit } }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          callback([], 0); // best-effort — an empty stack just falls back to the plain first-time button
          return;
        }
        callback(response.items, response.total);
      });
    } catch (_) {
      callback([], 0);
    }
  };

  Acopio.fetchCollectionRecentItems = function fetchCollectionRecentItems(collectionId, limit, callback) {
    try {
      chrome.runtime.sendMessage(
        { type: "GET_COLLECTION_RECENT_ITEMS", payload: { collectionId, limit } },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.ok) {
            callback([], 0, null);
            return;
          }
          callback(response.items || [], response.total || 0, response.name || null);
        }
      );
    } catch (_) {
      callback([], 0, null);
    }
  };

  Acopio.saveNote = function saveNote(itemId, note) {
    try {
      chrome.runtime.sendMessage({ type: "UPDATE_NOTE", payload: { id: itemId, note } });
    } catch (_) {
      // Same "extension was reloaded" case as finalizeCapture. The item
      // itself is already saved by this point — losing just the note text
      // here is a minor, silent degradation rather than something worth
      // interrupting the already-completing dismissal flow for.
    }
  };

  Acopio.updateItemDimensions = function updateItemDimensions(itemId, width, height) {
    try {
      chrome.runtime.sendMessage({ type: "UPDATE_ITEM_DIMENSIONS", payload: { id: itemId, width, height } });
    } catch (_) {
      // Same class of edge case as saveNote — a best-effort correction,
      // not worth surfacing a failure for.
    }
  };
})();
