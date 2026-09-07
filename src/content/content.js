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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "OPEN_TOOLTIP_AT_CONTEXT_TARGET") {
      if (lastContextTarget) openTooltipFor(lastContextTarget);
      return undefined;
    }
    if (message && message.type === "ACOPIO_WALKTHROUGH_PREVIEW") {
      if (!Acopio.overlay) return undefined;
      if (message.show) {
        if (message.kind === "toolbar" && typeof Acopio.overlay.showWalkthroughToolbarHint === "function") {
          Acopio.overlay.showWalkthroughToolbarHint();
        } else if (typeof Acopio.overlay.showWalkthroughPreview === "function") {
          Acopio.overlay.showWalkthroughPreview();
        }
      } else if (typeof Acopio.overlay.hideWalkthroughPreview === "function") {
        Acopio.overlay.hideWalkthroughPreview();
      }
      return undefined;
    }
    if (message && message.type === "BAKE_FIGMA_CLIPBOARD") {
      (async () => {
        try {
          const payload = message.payload || {};
          let el = null;
          if (payload.selector) {
            try {
              el = document.querySelector(payload.selector);
            } catch (_) {}
          }
          if (!el || !el.isConnected) {
            sendResponse({ ok: false, error: "Component not on this page — open the source tab and Copy again, or Collect again." });
            return;
          }
          if (!window.AcopioFigmaClipboard) {
            sendResponse({ ok: false, error: "Figma converter not loaded." });
            return;
          }
          await AcopioFigmaClipboard.ensureLoaded();
          const baked = await Promise.race([
            AcopioFigmaClipboard.convertLiveToClipboardHtml(el, {
              name: payload.name || "Component",
              width: payload.width,
              height: payload.height,
              fontAssets: payload.fontAssets || [],
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Figma bake timed out")), 20000)
            ),
          ]);
          const html = typeof baked === "string" ? baked : baked && baked.html;
          const fontAssets =
            typeof baked === "object" && baked && baked.fontAssets ? baked.fontAssets : [];
          if (!html) {
            sendResponse({ ok: false, error: "Convert returned empty." });
            return;
          }
          if (payload.itemId) {
            try {
              chrome.runtime.sendMessage({
                type: "MERGE_ITEM_DATA",
                payload: {
                  id: payload.itemId,
                  patch: {
                    figmaClipboardHtml: html,
                    ...(fontAssets.length ? { fontFaces: fontAssets } : {}),
                  },
                },
              });
            } catch (_) {}
          }
          sendResponse({ ok: true, html, fontAssets });
        } catch (err) {
          sendResponse({
            ok: false,
            error: String((err && err.message) || err || "Bake failed."),
          });
        }
      })();
      return true;
    }
    return undefined;
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
  const LAYER_SKIP_TAGS = new Set(["script", "style", "noscript", "template"]);
  const LAYER_EMBED_TAGS = new Set(["iframe", "object", "embed"]);
  const MAX_TREE_NODES = 500;

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
  function resolveRadiusToken(raw, rect) {
    const token = (raw || "0").split(" ")[0];
    if (token.endsWith("%")) {
      const pct = parseFloat(token) || 0;
      return Math.round((pct / 100) * Math.min(rect.width, rect.height));
    }
    return parseFloat(token) || 0;
  }
  function resolveRadius(style, rect) {
    return resolveRadiusToken(style.borderRadius, rect);
  }
  // Per-corner radii for Figma (topLeftRadius…); `radius` stays the max for
  // older plugin builds that only read a single cornerRadius.
  function resolveCornerRadii(style, rect) {
    const tl = resolveRadiusToken(style.borderTopLeftRadius, rect);
    const tr = resolveRadiusToken(style.borderTopRightRadius, rect);
    const br = resolveRadiusToken(style.borderBottomRightRadius, rect);
    const bl = resolveRadiusToken(style.borderBottomLeftRadius, rect);
    return {
      radius: Math.max(tl, tr, br, bl),
      radiusTL: tl,
      radiusTR: tr,
      radiusBR: br,
      radiusBL: bl,
    };
  }

  // All box-shadows → Figma DROP_SHADOW / INNER_SHADOW (html.to.design keeps stacks;
  // we previously kept only the first outer shadow).
  function parseBoxShadowEffects(boxShadow) {
    if (!boxShadow || boxShadow === "none") return [];
    const parts = [];
    let depth = 0;
    let cur = "";
    for (let i = 0; i < boxShadow.length; i++) {
      const ch = boxShadow[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) parts.push(cur.trim());
    const effects = [];
    for (const part of parts) {
      const inset = /\binset\b/i.test(part);
      const colorMatch = part.match(/rgba?\([^)]+\)/);
      const colorInfo = colorMatch ? Acopio.rgbToHex(colorMatch[0]) : null;
      if (!colorInfo) continue;
      const nums = part
        .replace(/rgba?\([^)]+\)/g, "")
        .replace(/\binset\b/gi, "")
        .trim()
        .split(/\s+/)
        .map(parseFloat)
        .filter((n) => Number.isFinite(n));
      if (nums.length < 2) continue;
      effects.push({
        type: inset ? "INNER_SHADOW" : "DROP_SHADOW",
        offsetX: nums[0] || 0,
        offsetY: nums[1] || 0,
        radius: nums[2] || 0,
        spread: nums[3] || 0,
        color: {
          r: colorInfo.r / 255,
          g: colorInfo.g / 255,
          b: colorInfo.b / 255,
          a: colorInfo.a,
        },
      });
    }
    return effects;
  }

  function parseFilterBlurEffect(filter) {
    if (!filter || filter === "none") return null;
    const m = String(filter).match(/blur\(\s*([0-9.]+)px\s*\)/i);
    if (!m) return null;
    const radius = parseFloat(m[1]);
    if (!Number.isFinite(radius) || radius <= 0) return null;
    return { type: "LAYER_BLUR", radius };
  }

  // ::before / ::after — SaaS CTAs (chevrons, badge dots, icon fonts) vanish
  // without this. Approximate size/position from computed style (no pseudo rect API).
  function extractPseudoLayers(el, elRect) {
    const out = [];
    for (const which of ["::before", "::after"]) {
      let ps;
      try {
        ps = window.getComputedStyle(el, which);
      } catch (_) {
        continue;
      }
      const content = (ps.content || "").trim();
      if (!content || content === "none" || content === "normal") continue;
      if (ps.display === "none" || ps.visibility === "hidden") continue;
      if (parseFloat(ps.opacity) === 0) continue;

      let width = parseFloat(ps.width);
      let height = parseFloat(ps.height);
      const fontSize = parseFloat(ps.fontSize) || 12;
      if (!Number.isFinite(width) || width <= 0) width = fontSize;
      if (!Number.isFinite(height) || height <= 0) {
        height = parseFloat(ps.lineHeight) || fontSize;
      }
      if (width < 1 && height < 1) continue;

      const pos = ps.position;
      let x = 0;
      let y = 0;
      if (pos === "absolute" || pos === "fixed") {
        const left = parseFloat(ps.left);
        const top = parseFloat(ps.top);
        const right = parseFloat(ps.right);
        const bottom = parseFloat(ps.bottom);
        if (Number.isFinite(left)) x = Math.round(left);
        else if (Number.isFinite(right)) x = Math.round(elRect.width - right - width);
        if (Number.isFinite(top)) y = Math.round(top);
        else if (Number.isFinite(bottom)) y = Math.round(elRect.height - bottom - height);
      } else if (which === "::after") {
        x = Math.max(0, Math.round(elRect.width - width));
      }

      const opacity = ownOpacity(ps);
      const positioning =
        pos === "absolute" || pos === "fixed" ? "ABSOLUTE" : undefined;
      const urlMatch = content.match(/^url\(\s*["']?([^"')]+)["']?\s*\)$/i);
      const quoted = content.match(/^["']([\s\S]*)["']$/);
      const text = quoted ? quoted[1] : "";

      if (urlMatch) {
        out.push({
          kind: "image",
          x,
          y,
          width: Math.round(width),
          height: Math.round(height),
          url: urlMatch[1],
          opacity,
          sizing: MEDIA_SIZING,
          positioning,
          pseudo: which,
        });
        continue;
      }

      const bgImg = ps.backgroundImage;
      if ((!text || text === "") && bgImg && bgImg !== "none" && !bgImg.includes("gradient")) {
        const m = bgImg.match(/url\(["']?([^"')]+)["']?\)/);
        if (m) {
          out.push({
            kind: "image",
            x,
            y,
            width: Math.round(width),
            height: Math.round(height),
            url: m[1],
            opacity,
            sizing: { horizontal: "FILL", vertical: "FILL" },
            backgroundSize: (ps.backgroundSize || "cover").split(",")[0].trim().toLowerCase(),
            backgroundPosition: (ps.backgroundPosition || "center").split(",")[0].trim(),
            positioning,
            pseudo: which,
          });
          continue;
        }
      }

      const bg = Acopio.rgbToHex(ps.backgroundColor);
      const gradientDesc = Acopio.parseGradientDescriptor(ps.backgroundImage);
      const isGradient = Boolean(gradientDesc);
      if ((!text || text === "") && isGradient) {
        out.push({
          kind: "frame",
          x,
          y,
          width: Math.round(width),
          height: Math.round(height),
          fill: null,
          fillOpacity: 1,
          gradientStops: gradientDesc.stops,
          gradientDirection: gradientDesc.direction,
          gradientType: gradientDesc.type,
          opacity,
          children: [],
          layout: null,
          positioning,
          pseudo: which,
        });
        continue;
      }
      if ((!text || text === "") && bg && bg.a > 0.02) {
        out.push({
          kind: "frame",
          x,
          y,
          width: Math.round(width),
          height: Math.round(height),
          fill: bg.hex,
          fillOpacity: bg.a,
          opacity,
          children: [],
          layout: null,
          positioning,
          pseudo: which,
        });
        continue;
      }

      if (text) {
        const colorInfo = Acopio.rgbToHex(ps.color);
        const typo = textTypoExtras(ps);
        out.push({
          kind: "text",
          x,
          y,
          width: Math.round(Math.max(width, fontSize)),
          height: Math.round(Math.max(height, fontSize)),
          text: applyTextTransform(text.slice(0, 200), typo.textTransform),
          fontFamily: ps.fontFamily.split(",")[0].replace(/['"]/g, "").trim(),
          fontWeight: ps.fontWeight,
          fontSizePx: fontSize,
          lineHeightPx: parseFloat(ps.lineHeight) || null,
          color: colorInfo ? colorInfo.hex : "#000000",
          textAlign: ps.textAlign,
          opacity,
          sizing: leafSizing(ps.display),
          positioning,
          pseudo: which,
          ...typo,
        });
      }
    }
    return out;
  }

  function textTypoExtras(style) {
    const letterSpacingPx = style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing) || 0;
    const fontStyle = /italic/i.test(style.fontStyle || "") ? "italic" : "normal";
    const deco = (style.textDecorationLine || "").toLowerCase();
    let textDecoration = "none";
    if (deco.includes("underline")) textDecoration = "underline";
    else if (deco.includes("line-through")) textDecoration = "line-through";
    const tt = (style.textTransform || "none").toLowerCase();
    const textTransform =
      tt === "uppercase" || tt === "lowercase" || tt === "capitalize" ? tt : "none";
    return { letterSpacingPx, fontStyle, textDecoration, textTransform };
  }

  function applyTextTransform(text, textTransform) {
    if (!text || !textTransform || textTransform === "none") return text;
    if (textTransform === "uppercase") return text.toUpperCase();
    if (textTransform === "lowercase") return text.toLowerCase();
    if (textTransform === "capitalize") {
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return text;
  }

  function parseTextShadowEffects(textShadow) {
    if (!textShadow || textShadow === "none") return [];
    // Reuse box-shadow parser shape: "offsetX offsetY blur color"
    return parseBoxShadowEffects(textShadow).map((e) => ({
      ...e,
      type: "DROP_SHADOW",
    }));
  }

  function captureBorderStroke(style) {
    const sides = ["Top", "Right", "Bottom", "Left"];
    const parsed = [];
    for (const side of sides) {
      const width = parseFloat(style[`border${side}Width`]) || 0;
      const borderStyle = style[`border${side}Style`];
      const color = Acopio.rgbToHex(style[`border${side}Color`]);
      if (width > 0 && borderStyle !== "none" && color && color.a > 0.02) {
        parsed.push({ side: side.toLowerCase(), width: Math.round(width), hex: color.hex, a: color.a });
      }
    }
    if (!parsed.length) return { stroke: undefined, strokeWeight: undefined, borders: undefined };
    const uniform =
      parsed.length === 4 &&
      parsed.every(
        (p) => p.width === parsed[0].width && p.hex === parsed[0].hex && Math.abs(p.a - parsed[0].a) < 0.01
      );
    if (uniform || parsed.length === 1) {
      const p = parsed[0];
      return {
        stroke: { hex: p.hex, a: p.a },
        strokeWeight: p.width,
        borders: parsed.length === 4 && !uniform ? parsed : undefined,
      };
    }
    // Prefer the visually dominant side (max width) as the single stroke
    // Figma can apply today; keep full `borders` for future per-side rebuild.
    const dominant = parsed.reduce((a, b) => (b.width > a.width ? b : a));
    return {
      stroke: { hex: dominant.hex, a: dominant.a },
      strokeWeight: dominant.width,
      borders: parsed,
    };
  }

  function textStyleSnapshot(style) {
    const colorInfo = Acopio.rgbToHex(style.color);
    return {
      fontFamily: style.fontFamily.split(",")[0].replace(/['"]/g, "").trim(),
      fontWeight: style.fontWeight,
      fontSizePx: parseFloat(style.fontSize) || 14,
      color: colorInfo ? colorInfo.hex : "#000000",
      ...textTypoExtras(style),
    };
  }

  // Same-line only: mixed inline spans keep per-span styles as Figma text
  // ranges. Multi-line mixed styling still flattens to one uniform style
  // (Range tops diverge once wrapping starts — separate absolutely-placed
  // runs would overlap under font substitution).
  function clientRectsSameLine(rects, tolerancePx) {
    const tops = [];
    for (const r of rects) {
      if (!r || (r.width < 0.5 && r.height < 0.5)) continue;
      tops.push(r.top);
    }
    if (tops.length <= 1) return true;
    return Math.max(...tops) - Math.min(...tops) <= tolerancePx;
  }

  function styleSnapKey(snap) {
    return [
      snap.fontFamily,
      snap.fontWeight,
      snap.fontSizePx,
      snap.color,
      snap.letterSpacingPx,
      snap.fontStyle,
      snap.textDecoration,
    ].join("\0");
  }

  // Collapse whitespace the same way the flatten path does, while mapping
  // each original index onto the collapsed string (for range remapping).
  function collapseTextWithIndexMap(raw) {
    const map = new Int32Array(raw.length + 1);
    let out = "";
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === " " || ch === "\t") {
        if (out.length > 0 && out[out.length - 1] === " ") {
          map[i] = out.length - 1;
          continue;
        }
        map[i] = out.length;
        out += " ";
      } else {
        map[i] = out.length;
        out += ch;
      }
    }
    map[raw.length] = out.length;

    // / *\n+ */g → "\n"
    let out2 = "";
    const map2 = new Int32Array(out.length + 1);
    let i = 0;
    while (i < out.length) {
      if (out[i] === " " || out[i] === "\n") {
        let j = i;
        let sawNl = false;
        while (j < out.length && (out[j] === " " || out[j] === "\n")) {
          if (out[j] === "\n") sawNl = true;
          j++;
        }
        if (sawNl) {
          for (let k = i; k < j; k++) map2[k] = out2.length;
          map2[j] = out2.length + 1;
          out2 += "\n";
          i = j;
          continue;
        }
      }
      map2[i] = out2.length;
      out2 += out[i];
      i++;
    }
    map2[out.length] = out2.length;

    const trimStart = out2.length - out2.trimStart().length;
    const trimmed = out2.trim();
    const trimEndExclusive = trimStart + trimmed.length;

    function mapRawIndex(rawIndex, asExclusiveEnd) {
      const clamped = Math.max(0, Math.min(rawIndex, raw.length));
      let mid = map[clamped];
      let dest = map2[Math.min(mid, out.length)];
      if (asExclusiveEnd && clamped > 0) {
        const prevMid = map[clamped - 1];
        const prevDest = map2[Math.min(prevMid, Math.max(0, out.length - 1))];
        dest = Math.max(dest, prevDest + 1);
      }
      dest = Math.max(trimStart, Math.min(dest, trimEndExclusive)) - trimStart;
      return Math.max(0, Math.min(trimmed.length, dest));
    }

    return { text: trimmed, mapRawIndex };
  }

  // Walk direct content (text + nested inline tags + <br>) into one string
  // with optional per-span ranges when every text fragment shares a line.
  function extractFlattenedInlineText(el, style) {
    const pieces = [];
    const allRects = [];

    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const owner = node.parentElement || el;
        const st = owner === el ? style : window.getComputedStyle(owner);
        const raw = node.textContent || "";
        if (!raw) return;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects());
        range.detach && range.detach();
        for (const r of rects) allRects.push(r);
        pieces.push({ raw, snap: textStyleSnapshot(st) });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      if (tag === "br") {
        pieces.push({ raw: "\n", snap: textStyleSnapshot(style) });
        return;
      }
      if (LAYER_SKIP_TAGS.has(tag)) return;
      for (const child of node.childNodes) visit(child);
    }
    for (const child of el.childNodes) visit(child);

    const raw = pieces.map((p) => p.raw).join("");
    const { text, mapRawIndex } = collapseTextWithIndexMap(raw);
    if (!text) return null;

    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) || 16;
    const sameLine = clientRectsSameLine(allRects, Math.max(4, lineHeight * 0.55));

    let ranges = null;
    if (pieces.length > 0) {
      const built = [];
      let rawAt = 0;
      for (const p of pieces) {
        const rawStart = rawAt;
        const rawEnd = rawAt + p.raw.length;
        rawAt = rawEnd;
        if (!p.raw || p.raw === "\n") continue;
        const start = mapRawIndex(rawStart, false);
        const end = mapRawIndex(rawEnd, true);
        if (end <= start) continue;
        const prev = built[built.length - 1];
        if (prev && prev.end === start && styleSnapKey(prev) === styleSnapKey(p.snap)) {
          prev.end = end;
        } else {
          built.push({ start, end, ...p.snap });
        }
      }
      const keys = new Set(built.map(styleSnapKey));
      // Always record mixed runs when styles differ. layoutTree only attaches
      // them when sameLine (absolute Figma runs break across wraps); font
      // clipboard uses them as SVG tspans either way.
      if (built.length > 0 && keys.size > 1) {
        ranges = built
          .map((r) => ({
            start: r.start,
            end: Math.min(r.end, 500),
            fontFamily: r.fontFamily,
            fontWeight: r.fontWeight,
            fontSizePx: r.fontSizePx,
            color: r.color,
            letterSpacingPx: r.letterSpacingPx,
            fontStyle: r.fontStyle,
            textDecoration: r.textDecoration,
          }))
          .filter((r) => r.end > r.start && r.start < 500);
        if (ranges.length < 2) ranges = null;
      }
    }

    return { text: text.slice(0, 500), ranges, sameLine };
  }

  /**
   * Multi-line mixed styles: one absolutely placed TEXT leaf per client-rect
   * run so wraps don't lose bold/color (uniform flatten was the old path).
   */
  function extractAbsoluteMixedTextRuns(el, style, containerRect) {
    const runs = [];
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const owner = node.parentElement || el;
        const st = owner === el ? style : window.getComputedStyle(owner);
        const raw = (node.textContent || "").replace(/\s+/g, " ");
        if (!raw.trim()) return;
        const snap = textStyleSnapshot(st);
        const typo = textTypoExtras(st);
        const range = document.createRange();
        try {
          range.selectNodeContents(node);
          const rects = Array.from(range.getClientRects());
          range.detach && range.detach();
          // Distribute characters across rects roughly by width share
          const widths = rects.map((r) => Math.max(0.5, r.width));
          const totalW = widths.reduce((a, b) => a + b, 0) || 1;
          let cursor = 0;
          const chars = applyTextTransform(raw.trim(), typo.textTransform);
          for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (r.width < 0.5 && r.height < 0.5) continue;
            const share = Math.max(1, Math.round((chars.length * widths[i]) / totalW));
            const slice = chars.slice(cursor, i === rects.length - 1 ? chars.length : cursor + share);
            cursor += share;
            if (!slice) continue;
            const colorInfo = Acopio.rgbToHex(st.color);
            const textEffects = parseTextShadowEffects(st.textShadow);
            runs.push({
              kind: "text",
              x: Math.round(r.left - containerRect.left),
              y: Math.round(r.top - containerRect.top),
              width: Math.round(Math.max(1, r.width)),
              height: Math.round(Math.max(1, r.height)),
              text: slice.slice(0, 500),
              fontFamily: snap.fontFamily,
              fontWeight: snap.fontWeight,
              fontSizePx: snap.fontSizePx,
              lineHeightPx: parseFloat(st.lineHeight) || null,
              color: colorInfo ? colorInfo.hex : snap.color,
              textAlign: st.textAlign,
              opacity: ownOpacity(st),
              sizing: { horizontal: "FIXED", vertical: "HUG" },
              positioning: "ABSOLUTE",
              ...(textEffects.length ? { effects: textEffects, effect: textEffects[0] } : {}),
              ...typo,
            });
          }
        } catch (_) {}
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      if (tag === "br" || LAYER_SKIP_TAGS.has(tag)) return;
      for (const child of node.childNodes) visit(child);
    }
    for (const child of el.childNodes) visit(child);
    return runs;
  }

  // Simple rotate(Ndeg|rad|turn) only — ignore matrix(...) / compound
  // transforms for v1. Prefer computed string, then inline style, then
  // computedStyleMap()'s CSSRotate when the browser exposes it.
  function parseSimpleRotationDeg(style, el) {
    function fromRotateString(value) {
      if (!value || value === "none") return null;
      const cleaned = String(value).trim();
      const m = cleaned.match(/^rotate\(\s*(-?[\d.]+)(deg|rad|turn)\s*\)$/i);
      if (!m) return null;
      let deg = parseFloat(m[1]);
      if (!Number.isFinite(deg)) return null;
      const unit = m[2].toLowerCase();
      if (unit === "rad") deg = (deg * 180) / Math.PI;
      else if (unit === "turn") deg *= 360;
      return deg;
    }
    let deg = fromRotateString(style && style.transform);
    if (deg != null) return deg;
    if (el && el.style) {
      deg = fromRotateString(el.style.transform);
      if (deg != null) return deg;
    }
    try {
      if (el && typeof el.computedStyleMap === "function") {
        const list = el.computedStyleMap().get("transform");
        if (list && list.length === 1) {
          const item = list[0];
          if (item && item.angle && typeof item.angle.value === "number") {
            const unit = String(item.angle.unit || "deg").toLowerCase();
            let v = item.angle.value;
            if (unit === "rad") v = (v * 180) / Math.PI;
            else if (unit === "turn") v *= 360;
            if (Number.isFinite(v)) return v;
          }
        }
      }
    } catch (e) {
      /* computedStyleMap / CSSRotate not available */
    }
    return null;
  }

  // Full CSS transform (rotate/scale/skew/matrix) for Figma rebuild.
  function attachTransform(node, style, el) {
    const t = Acopio.parseCssTransform(style, el);
    if (t) {
      node.transform = t;
      if (t.rotationDeg != null && Math.abs(t.rotationDeg) > 0.01) {
        node.rotationDeg = t.rotationDeg;
      }
      return node;
    }
    const rotationDeg = parseSimpleRotationDeg(style, el);
    if (rotationDeg != null && rotationDeg !== 0) node.rotationDeg = rotationDeg;
    return node;
  }

  // Back-compat alias
  function attachRotation(node, style, el) {
    return attachTransform(node, style, el);
  }

  // Light DOM children plus open shadow roots (web components). Same
  // visibility/clip filters apply at the probe/walk call sites.
  function directChildElements(el) {
    const out = Array.from(el.children);
    if (el.shadowRoot) {
      for (const child of Array.from(el.shadowRoot.children)) out.push(child);
    }
    return out;
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
    // Include auto/scroll: partial content still sits behind a clip window
    // (marquees, horizontal carousels, overflow lists). Treating only
    // hidden/clip left scrolled-away siblings in the tree as if visible.
    const clipLike = (v) =>
      v === "hidden" || v === "clip" || v === "auto" || v === "scroll";
    return (
      clipLike(style.overflow) ||
      clipLike(style.overflowX) ||
      clipLike(style.overflowY)
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
    "space-around": "SPACE_BETWEEN",
    "space-evenly": "SPACE_BETWEEN",
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
  // Gap prefers real CSS `gap`/`rowGap`/`columnGap` when parseable (not
  // the literal "normal"), else the median empirical gap between
  // consecutive children's rects — that median still catches margin-driven
  // spacing when CSS gap is absent (a real hero section with margin-top
  // between siblings and gap:normal).
  function parseCssGap(value) {
    if (!value || value === "normal") return null;
    const n = parseFloat(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
  }
  function gapsAlongAxis(childRects, isColumn) {
    const gaps = [];
    for (let i = 1; i < childRects.length; i++) {
      gaps.push(
        isColumn
          ? childRects[i].y - (childRects[i - 1].y + childRects[i - 1].height)
          : childRects[i].x - (childRects[i - 1].x + childRects[i - 1].width)
      );
    }
    return gaps;
  }
  function medianGapAlongAxis(childRects, isColumn) {
    if (childRects.length < 2) return 0;
    const gaps = gapsAlongAxis(childRects, isColumn).slice().sort((a, b) => a - b);
    return Math.max(0, Math.round(gaps[Math.floor(gaps.length / 2)]));
  }
  // A single Auto Layout `itemSpacing` can only ever hold ONE number for
  // every gap in the frame. When real consecutive gaps actually differ
  // (an eyebrow→media gap of 20 next to a media→body gap of 24, both very
  // ordinary in real designs), collapsing them to one median doesn't
  // average out — every child after the first mismatch inherits that
  // step's error AND every error before it, so the drift compounds
  // downward through the whole subtree (confirmed live: a real card with
  // non-uniform gaps showed an identical, growing y-offset — 12, 12, 12px
  // — at every single descendant, not scattered noise). This is strictly
  // worse than the "don't risk a wrong guess" principle this file already
  // applies to layout-mode eligibility itself (see the comment above
  // JUSTIFY_TO_PRIMARY) — so the same principle applies here: only trust
  // an INFERRED (non-CSS) gap when the real gaps actually agree with each
  // other. A real explicit CSS `gap`/`row-gap`/`column-gap` value is never
  // subject to this check — the browser already enforces it uniformly by
  // definition, so callers only run this against the medianGapAlongAxis
  // fallback path, not the parsed-CSS one.
  function gapsAreUniform(childRects, isColumn) {
    if (childRects.length < 3) return true; // one gap can't be "non-uniform" with itself
    const gaps = gapsAlongAxis(childRects, isColumn);
    const sorted = gaps.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const tolerance = Math.max(2, Math.abs(median) * 0.15);
    return gaps.every((g) => Math.abs(g - median) <= tolerance);
  }

  function flexPaddingFields(style) {
    return {
      paddingTop: Math.round(parseFloat(style.paddingTop) || 0),
      paddingRight: Math.round(parseFloat(style.paddingRight) || 0),
      paddingBottom: Math.round(parseFloat(style.paddingBottom) || 0),
      paddingLeft: Math.round(parseFloat(style.paddingLeft) || 0),
    };
  }

  function detectFlexLayout(style, childRects) {
    const display = style.display;
    if (display !== "flex" && display !== "inline-flex") return null;
    const direction = style.flexDirection || "row";
    const isReverse = direction.endsWith("reverse");
    const isColumn = direction.startsWith("column");
    const wrap = style.flexWrap === "wrap" || style.flexWrap === "wrap-reverse";
    const mainCss = parseCssGap(isColumn ? style.rowGap : style.columnGap) ?? parseCssGap(style.gap);
    const crossCss = parseCssGap(isColumn ? style.columnGap : style.rowGap) ?? parseCssGap(style.gap);
    if (mainCss == null && !gapsAreUniform(childRects, isColumn)) return null; // can't infer one safe number — fall back to fixed positions
    const gap = mainCss != null ? mainCss : medianGapAlongAxis(childRects, isColumn);
    const stretch = style.alignItems === "stretch";
    const layout = {
      mode: isColumn ? "VERTICAL" : "HORIZONTAL",
      gap,
      primaryAlign: JUSTIFY_TO_PRIMARY[style.justifyContent] || "MIN",
      counterAlign: ALIGN_TO_COUNTER[style.alignItems] || "MIN",
      ...flexPaddingFields(style),
    };
    if (isReverse) layout.reverseChildren = true;
    if (wrap) {
      if (crossCss == null && !gapsAreUniform(childRects, !isColumn)) return null;
      layout.wrap = true;
      layout.counterGap = crossCss != null ? crossCss : medianGapAlongAxis(childRects, !isColumn);
    }
    if (stretch) layout.stretchChildren = true;
    return layout;
  }

  // Equal-ish CSS Grid → HORIZONTAL Auto Layout with wrap (same class of
  // approximation html.to.design uses for simple card grids). Named areas
  // or irregular track sizes stay absolute (layout null).
  function looksLikeEqualGridColumns(templateColumns) {
    const cols = (templateColumns || "").trim();
    if (!cols || cols === "none") return false;
    if (/repeat\(/i.test(cols)) return true;
    const tracks = cols.split(/\s+(?![^(]*\))/).filter(Boolean);
    if (tracks.length < 1) return false;
    if (tracks.every((t) => t === tracks[0])) return true;
    // equal fr tracks: 1fr 1fr 1fr
    const trimmed = tracks.map((t) => t.trim());
    return (
      trimmed.length >= 2 &&
      trimmed.every((t) => /^\d*\.?\d+fr$/i.test(t)) &&
      trimmed.every((t) => t.toLowerCase() === trimmed[0].toLowerCase())
    );
  }
  function childrenShareSimilarWidths(childRects) {
    if (childRects.length < 2) return childRects.length === 1;
    const widths = childRects.map((r) => r.width).filter((w) => w > 0);
    if (widths.length < 2) return false;
    const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
    if (avg < 1) return false;
    return widths.every((w) => Math.abs(w - avg) / avg <= 0.35);
  }
  function detectGridLayout(style, childRects) {
    if (style.display !== "grid" && style.display !== "inline-grid") return null;
    const areas = (style.gridTemplateAreas || "").trim();
    if (areas && areas !== "none" && /"[^".\s]+/.test(areas)) return null; // named regions → irregular
    const equalCols =
      looksLikeEqualGridColumns(style.gridTemplateColumns) || childrenShareSimilarWidths(childRects);
    if (!equalCols) return null;
    const colGapCss = parseCssGap(style.columnGap) ?? parseCssGap(style.gap);
    const rowGapCss = parseCssGap(style.rowGap) ?? parseCssGap(style.gap);
    if (colGapCss == null && !gapsAreUniform(childRects, false)) return null;
    if (rowGapCss == null && !gapsAreUniform(childRects, true)) return null;
    const colGap = colGapCss != null ? colGapCss : medianGapAlongAxis(childRects, false);
    const rowGap = rowGapCss != null ? rowGapCss : medianGapAlongAxis(childRects, true);
    const stretch = style.alignItems === "stretch";
    const layout = {
      mode: "HORIZONTAL",
      wrap: true,
      gap: colGap,
      counterGap: rowGap,
      primaryAlign: "MIN",
      counterAlign: ALIGN_TO_COUNTER[style.alignItems] || "MIN",
      ...flexPaddingFields(style),
    };
    if (stretch) layout.stretchChildren = true;
    return layout;
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
    // Block stack has no real CSS gap property at all — this number is
    // ALWAYS inferred from margins, so the uniformity gate always applies
    // here (unlike flex/grid, which can trust a real CSS gap outright).
    if (!gapsAreUniform(childRects, true)) return null;
    return {
      mode: "VERTICAL",
      gap: medianGapAlongAxis(childRects, true),
      primaryAlign: "MIN",
      counterAlign: "MIN",
      ...flexPaddingFields(style),
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

      if (tag === "img") {
        const url = Acopio.resolveImgSrc(el);
        if (!url) {
          // Broken/lazy img with no resolved src — keep the box so layout holds.
          return attachRotation(
            {
              kind: "frame",
              x: rect.x,
              y: rect.y,
              width: Math.max(1, rect.width),
              height: Math.max(1, rect.height),
              fill: "#E8E8E8",
              fillOpacity: 1,
              opacity,
              children: [],
              layout: null,
            },
            style,
            el
          );
        }
        const inlineDataUrl = Acopio.rasterizeImgElement(el) || undefined;
        return attachRotation(
          {
            kind: "image",
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            url,
            inlineDataUrl,
            opacity,
            sizing: MEDIA_SIZING,
            radius: resolveRadius(style, { width: rect.width, height: rect.height }),
          },
          style,
          el
        );
      }

      // Video: prefer a frozen current frame (works offline in Figma); else poster/src URL.
      if (tag === "video") {
        let inlineDataUrl = null;
        try {
          if (el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0) {
            const c = document.createElement("canvas");
            c.width = el.videoWidth;
            c.height = el.videoHeight;
            c.getContext("2d").drawImage(el, 0, 0);
            inlineDataUrl = c.toDataURL("image/png");
          }
        } catch (_) {
          inlineDataUrl = null;
        }
        const url = inlineDataUrl || Acopio.resolveVideoOrPoster(el).url;
        if (!url) {
          return attachRotation(
            {
              kind: "frame",
              x: rect.x,
              y: rect.y,
              width: Math.max(1, rect.width),
              height: Math.max(1, rect.height),
              fill: "#E8E8E8",
              fillOpacity: 1,
              opacity,
              children: [],
              layout: null,
            },
            style,
            el
          );
        }
        return attachRotation(
          {
            kind: "image",
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            url,
            inlineDataUrl: inlineDataUrl || undefined,
            opacity,
            sizing: MEDIA_SIZING,
          },
          style,
          el
        );
      }

      // Canvas bitmaps are opaque to the DOM tree — snapshot pixels when untainted.
      if (tag === "canvas") {
        let inlineDataUrl = null;
        try {
          if (el.width > 0 && el.height > 0) inlineDataUrl = el.toDataURL("image/png");
        } catch (_) {
          inlineDataUrl = null;
        }
        if (!inlineDataUrl) {
          // Tainted / empty — keep layout space so the parent doesn't collapse.
          return attachRotation(
            {
              kind: "frame",
              x: rect.x,
              y: rect.y,
              width: Math.max(1, rect.width),
              height: Math.max(1, rect.height),
              fill: "#E8E8E8",
              fillOpacity: 1,
              opacity,
              children: [],
              layout: null,
            },
            style,
            el
          );
        }
        return attachRotation(
          {
            kind: "image",
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            url: inlineDataUrl,
            inlineDataUrl,
            opacity,
            sizing: MEDIA_SIZING,
          },
          style,
          el
        );
      }

      // Cross-origin embeds can't be walked — preserve the box so surrounding layout holds.
      if (LAYER_EMBED_TAGS.has(tag)) {
        return attachRotation(
          {
            kind: "frame",
            x: rect.x,
            y: rect.y,
            width: Math.max(1, rect.width),
            height: Math.max(1, rect.height),
            fill: "#EEEEEE",
            fillOpacity: 1,
            opacity,
            children: [],
            layout: null,
          },
          style,
          el
        );
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
        return attachRotation(
          {
            kind: "icon-placeholder",
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            opacity,
            sizing: MEDIA_SIZING,
            svgMarkup: resolveSvgMarkup(el),
            resolvedColor: resolvedColorInfo ? resolvedColorInfo.hex : undefined,
          },
          style,
          el
        );
      }

      // This element's own background becomes the FRAME's own fill below
      // (no separate rect layer duplicating the frame's bounds needed —
      // every container is a real frame now, so its background just IS
      // the frame's fill, the same way a CSS background paints directly
      // on the box, not a synthetic child sitting behind it).
      const bg = Acopio.rgbToHex(style.backgroundColor);
      const bgImageRaw = style.backgroundImage;
      const gradientDesc = Acopio.parseGradientDescriptor(bgImageRaw);
      const isGradient = Boolean(gradientDesc);
      const hasSolidBg = Boolean(bg && bg.a > 0.02);
      const fill = hasSolidBg && !isGradient ? bg.hex : null;
      const gradientStops = gradientDesc ? gradientDesc.stops : undefined;
      const gradientDirection = gradientDesc ? gradientDesc.direction : undefined;
      const gradientType = gradientDesc ? gradientDesc.type : undefined;
      const fillOpacity = hasSolidBg ? bg.a : 1;
      const corners = resolveCornerRadii(style, rect);
      const radius = corners.radius;
      const borderStroke = captureBorderStroke(style);
      const stroke = borderStroke.stroke;
      const strokeWeight = borderStroke.strokeWeight;
      const shadowEffects = parseBoxShadowEffects(style.boxShadow);
      const blurEffect = parseFilterBlurEffect(style.filter);
      const effects = shadowEffects.slice();
      if (blurEffect) effects.push(blurEffect);
      // Back-compat single effect (first drop shadow) for older plugin builds
      const effect = shadowEffects.find((e) => e.type === "DROP_SHADOW") || shadowEffects[0] || null;

      const children = [];

      // Pseudos first (painted under / over real children depending on which)
      const pseudoLayers = extractPseudoLayers(el, {
        width: rect.width,
        height: rect.height,
      });
      const beforePseudos = pseudoLayers.filter((n) => n.pseudo === "::before");
      const afterPseudos = pseudoLayers.filter((n) => n.pseudo === "::after");
      for (const n of beforePseudos) {
        delete n.pseudo;
        children.push(n);
      }

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
          const bgSize = (style.backgroundSize || "cover").split(",")[0].trim().toLowerCase();
          children.push({
            kind: "image",
            x: 0,
            y: 0,
            width: rect.width,
            height: rect.height,
            url: bgUrl,
            opacity: 1,
            sizing: { horizontal: "FILL", vertical: "FILL" },
            backgroundSize: bgSize,
            backgroundPosition: (style.backgroundPosition || "center").split(",")[0].trim(),
            radius: corners.radius,
            radiusTL: corners.radiusTL,
            radiusTR: corners.radiusTR,
            radiusBR: corners.radiusBR,
            radiusBL: corners.radiusBL,
          });
        }
      }

      let hasOwnText = false;
      for (const { text, rect: textRect } of directTextNodeLayers(el, elRect, style)) {
        hasOwnText = true;
        const colorInfo = Acopio.rgbToHex(style.color);
        const typo = textTypoExtras(style);
        const textEffects = parseTextShadowEffects(style.textShadow);
        children.push({
          kind: "text",
          x: textRect.x,
          y: textRect.y,
          width: textRect.width,
          height: textRect.height,
          text: applyTextTransform(text.slice(0, 500), typo.textTransform),
          fontFamily: style.fontFamily.split(",")[0].replace(/['"]/g, "").trim(),
          fontWeight: style.fontWeight,
          fontSizePx: parseFloat(style.fontSize) || 14,
          lineHeightPx: parseFloat(style.lineHeight) || null,
          color: colorInfo ? colorInfo.hex : "#000000",
          textAlign: style.textAlign,
          opacity,
          sizing: leafSizing(style.display),
          ...(textEffects.length ? { effects: textEffects, effect: textEffects[0] } : {}),
          ...typo,
        });
      }

      // Probe direct element children once (cheap relative to the rest of
      // this walk, which already calls getComputedStyle per element)
      // purely to decide the layout mode BEFORE recursing for real —
      // detection needs every child's rect/position/float up front, not
      // discovered one at a time mid-recursion. Includes open shadowRoot
      // children so web-component content is layout-detected, not skipped.
      const childProbe = [];
      for (const child of directChildElements(el)) {
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
      const isPositionedStyle = (s) => s.position === "absolute" || s.position === "fixed";
      const inFlowProbe = childProbe.filter((p) => !isPositionedStyle(p.style));
      const hasPositionedChild = childProbe.some((p) => isPositionedStyle(p.style));
      const allChildrenPositioned = childProbe.length > 0 && inFlowProbe.length === 0;
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
      // uses. Same-line mixed spans keep per-span styles via `ranges`;
      // multi-line mixed styling still loses per-run style deliberately
      // so wrapped runs never overlap under font substitution.
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
        // Prefer one text node with per-span `ranges` when every fragment
        // shares roughly the same line. Multi-line mixed styling keeps the
        // uniform flatten (lose per-span style) so wrapped runs don't
        // overlap under font substitution.
        const extracted = extractFlattenedInlineText(el, style);
        if (extracted && extracted.text) {
          // Multi-line mixed styles → absolute runs (keeps bold/color per wrap).
          if (
            extracted.ranges &&
            extracted.ranges.length >= 2 &&
            !extracted.sameLine
          ) {
            const absRuns = extractAbsoluteMixedTextRuns(el, style, elRect);
            if (absRuns.length >= 1) {
              return attachTransform(
                {
                  kind: "frame",
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                  fill: null,
                  opacity,
                  children: absRuns,
                  layout: null,
                },
                style,
                el
              );
            }
          }
          const colorInfo = Acopio.rgbToHex(style.color);
          const typo = textTypoExtras(style);
          const textEffects = parseTextShadowEffects(style.textShadow);
          const textNode = {
            kind: "text",
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            text: applyTextTransform(extracted.text, typo.textTransform),
            fontFamily: style.fontFamily.split(",")[0].replace(/['"]/g, "").trim(),
            fontWeight: style.fontWeight,
            fontSizePx: parseFloat(style.fontSize) || 14,
            lineHeightPx: parseFloat(style.lineHeight) || null,
            color: colorInfo ? colorInfo.hex : "#000000",
            textAlign: style.textAlign,
            opacity,
            sizing: leafSizing(style.display),
            ...(textEffects.length ? { effects: textEffects, effect: textEffects[0] } : {}),
            ...typo,
          };
          if (extracted.ranges && extracted.sameLine) textNode.ranges = extracted.ranges;
          return attachTransform(textNode, style, el);
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
      // Abs/fixed children no longer force the whole parent to layout:null
      // — in-flow siblings still get flex/grid/block Auto Layout; only when
      // EVERY child is positioned (or mixed text+elements / floats) do we
      // fall back to absolute for the container.
      const hasMixedTextAndElements = hasOwnText && childProbe.length > 0;
      let layout = null;
      // Irregular/named CSS Grid cannot be honest Auto Layout — wrapping
      // equal columns would smash cell positions. Flag for Collect screenshot.
      let irregularGrid = false;
      if (!allChildrenPositioned && !hasMixedTextAndElements) {
        const inFlowRects = inFlowProbe.map((p) => p.rect);
        layout = detectFlexLayout(style, inFlowRects);
        if (!layout) layout = detectGridLayout(style, inFlowRects);
        if (
          !layout &&
          (style.display === "grid" || style.display === "inline-grid") &&
          inFlowRects.length >= 2
        ) {
          irregularGrid = true;
        }
        if (!layout && !hasFloatedChild) {
          layout = detectBlockStackLayout(style, inFlowRects);
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

      const orderedProbe =
        layout && layout.reverseChildren ? childProbe.slice().reverse() : childProbe;

      let walkedElementKids = 0;
      for (const p of orderedProbe) {
        if (truncated) break;
        const childNode = walk(p.el, elRect, nextClipRect);
        if (childNode) {
          walkedElementKids += 1;
          // Keep parent Auto Layout for in-flow siblings; abs/fixed kids
          // escape via Figma layoutPositioning ABSOLUTE + captured x/y.
          if (isPositionedStyle(p.style)) childNode.positioning = "ABSOLUTE";
          const flexGrow = parseFloat(p.style.flexGrow);
          if (Number.isFinite(flexGrow) && flexGrow > 0) {
            childNode.layoutGrow = 1;
            // Primary-axis FILL hint when parent is a known flex/stack —
            // plugin prefers layoutGrow; sizing helps older plugin builds.
            if (layout && childNode.positioning !== "ABSOLUTE") {
              const base = childNode.sizing || { horizontal: "FIXED", vertical: "FIXED" };
              childNode.sizing =
                layout.mode === "HORIZONTAL"
                  ? { horizontal: "FILL", vertical: base.vertical || "FIXED" }
                  : { horizontal: base.horizontal || "FIXED", vertical: "FILL" };
            }
          }
          children.push(childNode);
        }
      }

      // Visible DOM kids existed but every walk() returned null (clip /
      // truncation / visibility) — mark truncated so Figma can prefer screenshot.
      if (childProbe.length > 0 && walkedElementKids === 0) truncated = true;

      for (const n of afterPseudos) {
        delete n.pseudo;
        children.push(n);
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

      return attachRotation(
        {
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
          gradientType,
          opacity,
          radius,
          radiusTL: corners.radiusTL,
          radiusTR: corners.radiusTR,
          radiusBR: corners.radiusBR,
          radiusBL: corners.radiusBL,
          clipsContent: elementClips(style),
          stroke,
          strokeWeight,
          borders: borderStroke.borders,
          effect,
          effects: effects.length ? effects : undefined,
          layout,
          sizing: ownSizing,
          children,
          preferScreenshotHint: irregularGrid && !layout ? true : undefined,
        },
        style,
        el
      );
    }

    function countUsefulLeaves(node) {
      if (!node || typeof node !== "object") return 0;
      if (node.kind === "text") return node.text ? 1 : 0;
      if (node.kind === "image" || node.kind === "icon-placeholder") return 1;
      if (node.kind === "frame") {
        let n = 0;
        const kids = Array.isArray(node.children) ? node.children : [];
        for (const ch of kids) n += countUsefulLeaves(ch);
        if (n === 0 && (node.fill || (node.gradientStops && node.gradientStops.length))) return 1;
        return n;
      }
      return 0;
    }

    function minimalRootFrame(r) {
      return {
        kind: "frame",
        x: 0,
        y: 0,
        width: Math.max(1, Math.round(r.width)),
        height: Math.max(1, Math.round(r.height)),
        fill: null,
        fillOpacity: 1,
        opacity: 1,
        children: [],
        layout: null,
        preferScreenshot: true,
      };
    }

    const rootRect = rootEl.getBoundingClientRect();
    let tree = walk(rootEl, rootRect, null); // null: no ancestor clip above the capture root itself
    // Dual collect path (always):
    //   layoutTree  → Export to Figma (editable Auto Layout)
    //   previewImage → Copy / ZIP (attached later in overlay) + last-resort Figma fallback
    // Prefer screenshot ONLY when the tree has nothing useful to rebuild —
    // never because images failed CORS or a grid was irregular (those stay
    // editable with placeholders / absolute children).
    if (!tree) {
      truncated = true;
      tree = minimalRootFrame(rootRect);
    } else {
      const useful = countUsefulLeaves(tree);
      if (useful === 0) {
        tree.preferScreenshot = true;
        truncated = true;
      }
    }
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
      const textColor = Acopio.rgbToHex(style.color);
      const bgParsed = Acopio.rgbToHex(style.backgroundColor);
      const hasSolidBg = Boolean(bgParsed && bgParsed.a > 0.02);
      const bgGradientStops = Acopio.parseGradientStops(style.backgroundImage);
      const borderWidthPx = parseFloat(style.borderTopWidth) || 0;
      const borderParsed = Acopio.rgbToHex(style.borderTopColor);
      const hasVisibleBorder = Boolean(
        borderWidthPx > 0 && style.borderTopStyle !== "none" && borderParsed && borderParsed.a > 0.02
      );
      // Preserve mixed bold/regular (and color) runs inside one sentence —
      // plain textContent + root fontWeight was flattening everything to one
      // weight on Copy → Figma. Reuse the component layoutTree extractor.
      const extracted = extractFlattenedInlineText(el, style);
      const sampleText =
        (extracted && extracted.text) ||
        (el.textContent || "").trim().slice(0, 500);
      const out = {
        family,
        fallbackStack: style.fontFamily,
        weight: style.fontWeight,
        sizePx: parseFloat(style.fontSize),
        lineHeightPx: parseFloat(style.lineHeight) || null,
        letterSpacingPx: style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing),
        source: detectFontSource(family),
        sampleText,
        fontMayStillBeLoading: !fontsReady,
        // Text fill (tooltip already shows this live; previously never saved).
        colorHex: textColor ? textColor.hex : null,
        colorRgb: textColor ? { r: textColor.r, g: textColor.g, b: textColor.b } : null,
        colorAlpha: textColor ? textColor.a : 1,
        boundingBoxWidth: Math.round(rect.width),
        boundingBoxHeight: Math.round(rect.height),
        backgroundHex: hasSolidBg ? bgParsed.hex : null,
        backgroundAlpha: hasSolidBg ? bgParsed.a : 1,
        backgroundGradientStops: bgGradientStops.length >= 2 ? bgGradientStops : undefined,
        borderRadius: resolveRadius(style, rect),
        borderColorHex: hasVisibleBorder ? borderParsed.hex : null,
        borderWidthPx: hasVisibleBorder ? borderWidthPx : 0,
      };
      if (extracted && extracted.ranges && extracted.ranges.length >= 2) {
        out.ranges = extracted.ranges;
      }
      return out;
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
    const painted =
      typeof Acopio.measurePaintedBounds === "function"
        ? Acopio.measurePaintedBounds(el)
        : null;
    const rect = el.getBoundingClientRect();
    const boxW = painted && painted.width > 0 ? painted.width : rect.width;
    const boxH = painted && painted.height > 0 ? painted.height : rect.height;
    // Tree extraction reads the LIVE element's computed styles/rects —
    // must run before sanitizeCaptureElement's clone is the only copy left,
    // and independent of it: sanitized.html stays the "paste as HTML"
    // representation, layoutTree is the "real editable Figma nodes,
    // reflow-safe" one.
    const { tree, truncated: layersTruncated } = extractComponentLayers(el);
    // Style-frozen HTML for Library → Figma clipboard. Bare outerHTML loses
    // page CSS on remount (padding/gap collapse to 0). Built from the live
    // tree while computed styles are still available.
    const figmaHtml =
      (typeof Acopio.buildFigmaStyledHtml === "function" && Acopio.buildFigmaStyledHtml(el)) ||
      "";
    return {
      __sanitizeResult: sanitized, // consumed by buildCaptureData's caller, stripped before storage
      outerHTML: sanitized.html,
      figmaHtml: figmaHtml || undefined,
      scopedCss: "", // Library preview CSS still deferred; figmaHtml covers Copy→Figma spacing
      boundingBoxWidth: Math.round(boxW),
      boundingBoxHeight: Math.round(boxH),
      layoutTree: tree,
      layersTruncated,
      preferScreenshot: Boolean(tree && tree.preferScreenshot),
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
          const errMsg = chrome.runtime.lastError.message;
          if (Acopio.isContextInvalidatedError(errMsg) || !Acopio.isRuntimeAlive()) {
            Acopio.reloadPageForStaleExtension();
            finish({ ok: false, error: "Reconnecting Acopio — refreshing this page…" });
            return;
          }
          finish({ ok: false, error: errMsg });
          return;
        }
        if (!response || !response.ok) {
          finish({ ok: false, error: (response && response.error) || "Unknown error." });
          return;
        }
        finish({
          ok: true,
          item: response.item || item,
          hostname: item.hostname,
          count: response.count,
          updated: Boolean(response.updated),
        });
      });
    } catch (err) {
      Acopio.reloadPageForStaleExtension();
      finish({
        ok: false,
        error: "Reconnecting Acopio — refreshing this page…",
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
