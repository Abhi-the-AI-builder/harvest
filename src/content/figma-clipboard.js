// DOM → dual clipboard (best practice):
//   image/png  → paste in chat / Notes / Slack as a screenshot
//   text/html  → Figma Kiwi envelope → editable layers on ⌘V
// Worst case: PNG only when convert fails.
// Fidelity: always convert a frozen offscreen clone (full computed styles,
// whitespace normalize, materialized ::before/::after) so spacing / type /
// color match the painted page — same idea as html.to.design.
// Uses @figit/dom-to-figma (vendor/dom-to-figma.js), loaded lazily.
(function () {
  if (window.AcopioFigmaClipboard) return;

  let loadPromise = null;
  let converterPromise = null;

  // Stored figmaHtml: curated props (IndexedDB size). Convert-time freeze
  // uses the full computed style list for exact color/paint fidelity.
  const FREEZE_PROPS = [
    "display", "position", "box-sizing", "float", "clear", "isolation",
    "width", "height", "min-width", "min-height", "max-width", "max-height",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-top-left-radius", "border-top-right-radius",
    "border-bottom-right-radius", "border-bottom-left-radius",
    "outline-width", "outline-style", "outline-color", "outline-offset",
    "gap", "row-gap", "column-gap",
    "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "flex",
    "align-items", "align-content", "align-self",
    "justify-content", "justify-items", "justify-self", "order",
    "grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-auto-flow",
    "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end",
    "top", "right", "bottom", "left", "inset", "z-index",
    "overflow", "overflow-x", "overflow-y",
    "object-fit", "object-position",
    "font-family", "font-size", "font-weight", "font-style", "font-variant",
    "line-height", "letter-spacing", "word-spacing",
    "text-align", "text-decoration-line", "text-decoration-color", "text-decoration-style",
    "text-transform", "text-indent", "white-space", "word-break", "overflow-wrap",
    "color", "opacity", "visibility",
    "background-color", "background-image", "background-size", "background-position",
    "background-repeat", "background-clip", "background-origin", "background-attachment",
    "box-shadow", "filter", "backdrop-filter", "transform", "transform-origin",
    "clip-path", "aspect-ratio", "vertical-align",
    "text-shadow", "mix-blend-mode", "-webkit-text-fill-color", "-webkit-background-clip",
    "mask-image", "mask-size", "mask-position", "mask-repeat",
    "-webkit-mask-image", "-webkit-mask-size", "-webkit-mask-position", "-webkit-mask-repeat",
    "border-image-source", "list-style-image",
    "clip-path", "-webkit-clip-path",
    "-webkit-line-clamp", "text-overflow",
  ];

  const MAX_FIGMA_HTML_BYTES = 500 * 1024;
  const MAX_FIGMA_HTML_NODES = 800;
  // Live convert can handle denser marketing/SaaS selections than we store in
  // IndexedDB. Cap still exists so pathological pages fall back to screenshot
  // instead of emitting empty/truncated layer trees.
  const MAX_CONVERT_DOM_NODES = 5000;

  /**
   * Paste safe-margin (px) on every side of the Figma root frame.
   * Figit sizes the root to the border-box and may clip glyphs whose ink
   * sits at y≈0 (tight line-box / ascenders) when overflow clips. Expanding
   * the convert target by 2× this inset and placing the frozen clone at
   * (margin, margin) guarantees ≥20px clearance from every edge without
   * changing relative layout inside the selection.
   */
  const PASTE_SAFE_MARGIN_PX = 20;

  function round2(n) {
    return Math.round(Number(n) * 100) / 100;
  }

  function nodeTransformXY(node) {
    const t = node && node.transform;
    if (!t) return { x: null, y: null };
    return {
      x: t.m02 != null ? t.m02 : t[4] != null ? t[4] : null,
      y: t.m12 != null ? t.m12 : t[5] != null ? t[5] : null,
    };
  }

  function setNodeTransformXY(node, x, y) {
    if (!node || !node.transform) return;
    const t = node.transform;
    if (t.m02 != null || t.m12 != null) {
      t.m02 = x;
      t.m12 = y;
    } else if (Array.isArray(t)) {
      t[4] = x;
      t[5] = y;
    }
  }

  function nodeSizeWH(node) {
    if (!node || !node.size) return { w: null, h: null };
    return {
      w: node.size.x != null ? node.size.x : node.size.w != null ? node.size.w : null,
      h: node.size.y != null ? node.size.y : node.size.h != null ? node.size.h : null,
    };
  }

  function getApi() {
    const g = typeof self !== "undefined" ? self : window;
    return g.AcopioDomToFigma || null;
  }

  function ensureLoaded() {
    if (getApi()) return Promise.resolve(getApi());
    if (loadPromise) return loadPromise;
    if (
      typeof location !== "undefined" &&
      String(location.protocol || "").startsWith("chrome-extension")
    ) {
      return Promise.reject(
        new Error("Figma converter not loaded — reload the side panel.")
      );
    }
    loadPromise = new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: "ENSURE_DOM_TO_FIGMA" }, (response) => {
          if (chrome.runtime.lastError) {
            loadPromise = null;
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response || !response.ok) {
            loadPromise = null;
            reject(new Error((response && response.error) || "Couldn't load Figma clipboard converter."));
            return;
          }
          let tries = 0;
          const tick = () => {
            const api = getApi();
            if (api) {
              resolve(api);
              return;
            }
            tries += 1;
            if (tries > 40) {
              loadPromise = null;
              reject(new Error("Figma clipboard converter did not load."));
              return;
            }
            setTimeout(tick, 25);
          };
          tick();
        });
      } catch (err) {
        loadPromise = null;
        reject(err);
      }
    });
    return loadPromise;
  }

  function fetchImageBytesViaExtension(url) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: "FETCH_IMAGE_BYTES", payload: { url } },
          (response) => {
            if (chrome.runtime.lastError || !response || !response.ok) {
              resolve(null);
              return;
            }
            resolve({
              bytes: new Uint8Array(response.bytes).buffer,
              mimeType: response.contentType || "image/png",
            });
          }
        );
      } catch (_) {
        resolve(null);
      }
    });
  }

  // Figma's createImage() only accepts PNG/JPEG bytes — a growing share of
  // real-world CDN images (Cloudinary, Next.js Image, Vercel, and plenty of
  // sites' own asset pipelines) now default to AVIF or WebP instead, purely
  // for their own bandwidth savings, with zero visible difference to a
  // browser (which happily decodes and displays either) or a naive fetch
  // (which succeeds with a 200 and real bytes either way). Handing those
  // bytes straight to Figma is a SILENT failure — no thrown error, the
  // image fill just doesn't render, leaving a blank gap exactly where a
  // photo/thumbnail/illustration should be (confirmed live: a real card's
  // entire hero image area — genuinely fetched, 200 OK — pasted as an
  // empty white box because its CDN happened to serve .avif). This isn't
  // one site's quirk; it's any site serving a next-gen format, an
  // increasingly common default. Re-encoding through a canvas (which the
  // BROWSER decodes AVIF/WebP into, same as it does to paint the page)
  // guarantees Figma always receives a format it actually supports,
  // regardless of what the source served. Mirrors the equivalent
  // normalization export-helpers.js's ensurePngBytes already does for the
  // ZIP/clipboard export paths — this is the same fix for the paths that
  // load in the content-script world instead of the side panel.
  async function normalizeImageBytesToPng(bytes, mimeType) {
    if (mimeType === "image/png") return { bytes, mimeType };
    try {
      const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!pngBlob) return { bytes, mimeType };
      return { bytes: await pngBlob.arrayBuffer(), mimeType: "image/png" };
    } catch (_) {
      // Genuinely undecodable by the browser too (corrupt/truncated fetch,
      // or a format neither the browser nor Figma supports) — return the
      // original bytes rather than dropping the image outright; whatever
      // downstream consumer receives them is no worse off than before this
      // normalization existed.
      return { bytes, mimeType };
    }
  }

  async function buildImageLoader(api) {
    const direct =
      typeof api.createDirectImageLoader === "function"
        ? api.createDirectImageLoader()
        : null;
    return async function acopioImageLoader(request) {
      const src = request && request.src;
      if (!src) throw new Error("No image src");
      if (src.startsWith("data:") || src.startsWith("blob:")) {
        try {
          const res = await fetch(src);
          const blob = await res.blob();
          const raw = await blob.arrayBuffer();
          return await normalizeImageBytesToPng(raw, blob.type || "image/png");
        } catch (_) {
          if (src.startsWith("blob:")) {
            throw new Error(`Failed to load image: ${src}`);
          }
          throw _;
        }
      }
      if (direct) {
        try {
          const result = await direct(request);
          if (result && result.bytes) {
            return await normalizeImageBytesToPng(result.bytes, result.mimeType);
          }
          return result;
        } catch (_) {
          /* extension fetch for CORS */
        }
      }
      const viaBg = await fetchImageBytesViaExtension(src);
      if (viaBg && viaBg.bytes) return await normalizeImageBytesToPng(viaBg.bytes, viaBg.mimeType);
      throw new Error("Couldn't load image for Figma paste");
    };
  }

  function buildFontLoader(api, fontAssets) {
    const assets = Array.isArray(fontAssets) ? fontAssets : [];
    const byFamily = new Map();
    for (const face of assets) {
      if (!face || !face.family || !face.dataUrl) continue;
      const key = String(face.family).toLowerCase();
      if (!byFamily.has(key)) byFamily.set(key, []);
      byFamily.get(key).push(face);
    }
    // latin subset — full GF Inter/etc. for ASCII UI; without this, harvested
    // cyrillic-ext files "succeed" and paste as invisible Latin text in Figma.
    const fontsource =
      typeof api.createFontsourceLoader === "function"
        ? api.createFontsourceLoader({ subset: "latin", fallbackFamily: "Inter" })
        : null;

    function parseWeight(w) {
      if (typeof w === "number" && Number.isFinite(w)) return w;
      const s = String(w || "").toLowerCase();
      if (s === "bold") return 700;
      if (s === "normal") return 400;
      // Variable axis "100 900" — treat as mid of range for matching.
      const range = s.match(/(\d+)\s+(\d+)/);
      if (range) {
        const a = parseInt(range[1], 10);
        const b = parseInt(range[2], 10);
        if (Number.isFinite(a) && Number.isFinite(b)) return Math.round((a + b) / 2);
      }
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : 400;
    }

    function weightDistance(faceWeight, wantWeight) {
      const s = String(faceWeight || "").trim();
      const range = s.match(/(\d+)\s+(\d+)/);
      if (range) {
        const a = parseInt(range[1], 10);
        const b = parseInt(range[2], 10);
        if (Number.isFinite(a) && Number.isFinite(b) && wantWeight >= a && wantWeight <= b) {
          return 0;
        }
      }
      return Math.abs(parseWeight(faceWeight) - wantWeight);
    }

    function faceIsItalic(face) {
      return /italic|oblique/i.test(String((face && face.style) || ""));
    }

    function scoreFace(face, wantWeight, wantItalic) {
      const w = weightDistance(face.weight, wantWeight);
      const ital = faceIsItalic(face) === wantItalic ? 0 : 50;
      // Heavily penalize known non-latin subsets — returning them is worse
      // than falling through to fontsource (invisible glyphs with fills).
      const latinPen = face.coversLatin === false ? 500 : 0;
      return w + ital + latinPen;
    }

    async function fromFontsource(props, wantWeight, wantItalic) {
      if (!fontsource) return null;
      try {
        return await fontsource(props);
      } catch (_) {}
      try {
        return await fontsource({
          family: "Inter",
          weight: wantWeight,
          italic: wantItalic,
        });
      } catch (_) {}
      return null;
    }

    return async function acopioFontLoader(props) {
      const family = (props && props.family) || "";
      const key = family.toLowerCase();
      const wantWeight = parseWeight(props && props.weight);
      const wantItalic = Boolean(props && props.italic);
      const candidates = (byFamily.get(key) || [])
        .filter((f) => f.coversLatin !== false)
        .slice()
        .sort(
          (a, b) => scoreFace(a, wantWeight, wantItalic) - scoreFace(b, wantWeight, wantItalic)
        );
      for (const face of candidates) {
        try {
          const res = await fetch(face.dataUrl);
          const bytes = await res.arrayBuffer();
          if (bytes && bytes.byteLength > 64) {
            return {
              bytes,
              resolvedWeight: parseWeight(face.weight),
              resolvedItalic: faceIsItalic(face),
            };
          }
        } catch (_) {}
      }
      const viaSource = await fromFontsource(
        { ...props, family: family || "Inter" },
        wantWeight,
        wantItalic
      );
      if (viaSource) return viaSource;
      // Last resort: try non-latin harvested faces only if nothing else worked
      // (icon fonts / non-Latin pages). Still prefer fontsource Inter above.
      const fallbacks = (byFamily.get(key) || [])
        .filter((f) => f.coversLatin === false)
        .slice()
        .sort(
          (a, b) => scoreFace(a, wantWeight, wantItalic) - scoreFace(b, wantWeight, wantItalic)
        );
      for (const face of fallbacks) {
        try {
          const res = await fetch(face.dataUrl);
          const bytes = await res.arrayBuffer();
          if (bytes && bytes.byteLength > 64) {
            return {
              bytes,
              resolvedWeight: parseWeight(face.weight),
              resolvedItalic: faceIsItalic(face),
            };
          }
        } catch (_) {}
      }
      throw new Error(`No font bytes for "${family}"`);
    };
  }

  function fontAssetsCacheKey(fontAssets) {
    if (!fontAssets || !fontAssets.length) return "0";
    return fontAssets
      .map((f) => `${f.family}|${f.weight}|${f.style}|${f.coversLatin !== false ? "L" : "X"}|${(f.dataUrl || "").length}`)
      .join(";");
  }

  async function getConverter(fontAssets) {
    // Recreate when font assets change so loaders stay accurate.
    const fontKey = fontAssetsCacheKey(fontAssets);
    if (converterPromise && converterPromise.__fontKey === fontKey) return converterPromise;
    converterPromise = (async () => {
      const api = await ensureLoaded();
      const create = api.createFigmaConverter;
      if (typeof create !== "function") {
        throw new Error("Figma converter API missing.");
      }
      // Absolute layout: freeze already locked painted geometry. Auto-layout
      // re-inference + wrong font metrics caused overlapping words and CTA wrap.
      return create({
        layout: "absolute",
        imageLoader: await buildImageLoader(api),
        fontLoader: buildFontLoader(api, fontAssets || []),
      });
    })();
    converterPromise.__fontKey = fontKey;
    try {
      return await converterPromise;
    } catch (err) {
      converterPromise = null;
      throw err;
    }
  }

  function raf2() {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  async function waitForFonts() {
    try {
      if (document.fonts && document.fonts.ready) {
        await Promise.race([
          document.fonts.ready,
          new Promise((r) => setTimeout(r, 1500)),
        ]);
      }
    } catch (_) {}
  }

  async function waitForImages(root) {
    if (!root || !root.querySelectorAll) return;
    const imgs = Array.from(root.querySelectorAll("img"));
    await Promise.all(
      imgs.map(async (img) => {
        try {
          // html.to.design / HTML→Figma: force eager so lazy slots aren't empty.
          try {
            img.loading = "eager";
            img.decoding = "sync";
            if (img.hasAttribute("loading")) img.setAttribute("loading", "eager");
          } catch (_) {}
          // Promote common lazy-src attrs before decode.
          if (
            (!img.currentSrc && !img.src) ||
            (img.complete && img.naturalWidth === 0)
          ) {
            let promoted = null;
            if (typeof Acopio !== "undefined" && Acopio.resolveImgSrc) {
              try {
                promoted = Acopio.resolveImgSrc(img);
              } catch (_) {}
            }
            if (!promoted) {
              for (const attr of [
                "data-src",
                "data-lazy-src",
                "data-original",
                "data-lazy",
              ]) {
                const v = img.getAttribute(attr);
                if (v && !v.startsWith("data:")) {
                  promoted = v;
                  break;
                }
              }
            }
            if (promoted && promoted !== img.getAttribute("src")) {
              try {
                img.setAttribute("src", promoted);
              } catch (_) {}
            }
          }
          if (img.complete && img.naturalWidth > 0) return;
          if (typeof img.decode === "function") {
            await Promise.race([
              img.decode(),
              new Promise((r) => setTimeout(r, 1200)),
            ]);
          } else {
            await Promise.race([
              new Promise((resolve) => {
                img.addEventListener("load", resolve, { once: true });
                img.addEventListener("error", resolve, { once: true });
              }),
              new Promise((r) => setTimeout(r, 1200)),
            ]);
          }
        } catch (_) {}
      })
    );
  }

  function measureBox(el, fallback) {
    // Border-box only for convert frame sizing. Painted-bounds (overflow ink)
    // are used for outline/screenshot elsewhere — using them here inflated
    // the Figma root past the live selection (marquees / descenders).
    const rect = el.getBoundingClientRect();
    const width = Math.max(
      1,
      round2(rect.width > 0 ? rect.width : (fallback && fallback.width) || 1)
    );
    const height = Math.max(
      1,
      round2(rect.height > 0 ? rect.height : (fallback && fallback.height) || 1)
    );
    return { width, height };
  }

  /**
   * Pause CSS animations / marquees and reset horizontal strips so the
   * visible logo set matches the live viewport (not a mid-scroll duplicate).
   *
   * wallof pattern: `.caurousel-container` is overflow:hidden (clip) while
   * child `.logo-container` carries translateX mid-scroll — transform is NOT
   * on the clip node. Must reset transforms on strip *descendants*, then
   * hide the duplicated second track.
   * Returns cleanup().
   */
  function freezeMotionForCapture(root) {
    const restores = [];
    if (!root || root.nodeType !== 1) return () => {};

    function pushStyleRestore(el, keys) {
      const snap = { el };
      for (const k of keys) snap[k] = el.style[k];
      restores.push(snap);
      return snap;
    }

    function clearMotionStyles(el) {
      el.style.setProperty("animation", "none", "important");
      el.style.setProperty("animation-play-state", "paused", "important");
      el.style.setProperty("transition", "none", "important");
      el.style.setProperty("transform", "none", "important");
      el.style.setProperty("translate", "none", "important");
      // Webflow / JS marquees rewrite transform every rAF — cancel WAAPI too.
      try {
        if (typeof el.getAnimations === "function") {
          el.getAnimations({ subtree: false }).forEach((a) => {
            try {
              a.cancel();
            } catch (_) {}
          });
        }
      } catch (_) {}
    }

    const all = [root, ...Array.from(root.querySelectorAll("*"))];
    for (const el of all) {
      try {
        if (Acopio.isOwnNode && Acopio.isOwnNode(el)) continue;
        const cs = window.getComputedStyle(el);
        const anim = cs.animationName;
        const hasAnim =
          anim && anim !== "none" && String(cs.animationDuration || "") !== "0s";
        const ox = cs.overflowX || cs.overflow;
        const overflows =
          (ox === "hidden" || ox === "clip" || ox === "auto" || ox === "scroll") &&
          el.scrollWidth > el.clientWidth + 8;
        // The reset-and-pick-a-track treatment below was built for looping
        // marquees that duplicate their content into 2+ sibling tracks for
        // a seamless wrap (see "duplicate tracks" / "872px track" below) —
        // every real case it names is plural. A plain paginated carousel
        // (Swiper/Slick/Splide and friends) is a SINGLE static track moved
        // by one non-animating transform to show whichever slide is
        // current — that transform isn't motion to freeze, it's the actual
        // content state, and blindly clearing it snaps every slide back to
        // its untransformed position while the clip stays put, so the
        // WRONG slide ends up inside the visible window (confirmed live:
        // a track parked on slide 2 via translateX(-1152px) captured slide
        // 0 instead, because clearing the transform put slide 0 back at
        // x=0 — right where the still-1152px-wide clip now looks).
        // Real marquee motion is still caught two other ways: `hasAnim`
        // just above covers CSS `animation`/`transition`-driven motion on
        // ANY element (strip or not), and `subtreeHasMotion` below covers
        // a genuinely duplicated-track marquee even with no CSS animation
        // declared. A single static track with neither signal is left
        // completely untouched — normal overflow:hidden clipping already
        // renders it correctly, the same way a screenshot would.
        const subtreeHasMotion =
          overflows &&
          Array.from(el.children || []).some((child) => {
            try {
              const ccs = window.getComputedStyle(child);
              return (
                (ccs.animationName && ccs.animationName !== "none") ||
                (child.style && (child.style.transform || child.style.translate))
              );
            } catch (_) {
              return false;
            }
          });
        const isStrip = overflows && (el.children.length >= 2 || subtreeHasMotion);

        if (hasAnim) {
          pushStyleRestore(el, ["animation", "transform", "translate", "transition"]);
          clearMotionStyles(el);
        }

        if (isStrip) {
          pushStyleRestore(el, ["animation", "transform", "translate", "transition"]);
          restores[restores.length - 1].scrollLeft = el.scrollLeft;
          clearMotionStyles(el);
          try {
            el.scrollLeft = 0;
          } catch (_) {}

          // Reset translated/animated descendants (logo tracks inside clip).
          for (const child of Array.from(el.querySelectorAll("*"))) {
            try {
              if (Acopio.isOwnNode && Acopio.isOwnNode(child)) continue;
              const ccs = window.getComputedStyle(child);
              const ctr = ccs.transform;
              const canim = ccs.animationName;
              const childAnim =
                canim && canim !== "none" && String(ccs.animationDuration || "") !== "0s";
              const childTr = ctr && ctr !== "none";
              // Also catch JS-driven marquees that park translate in style=""
              // or matrix() on a flex track wider than the clip.
              const styleTr = child.style && (child.style.transform || child.style.translate);
              if (!childAnim && !childTr && !styleTr) continue;
              pushStyleRestore(child, ["animation", "transform", "translate", "transition"]);
              clearMotionStyles(child);
            } catch (_) {}
          }

          // Force layout so getBoundingClientRect reflects transform:none
          // before we decide which duplicate track to drop.
          void el.offsetWidth;

          // After reset: keep the first track that intersects the clip;
          // display:none duplicates so figit never measures them (visibility
          // alone still left negative-x frames for the second 872px track).
          const clip = el.getBoundingClientRect();
          let keptOne = false;
          for (const child of Array.from(el.children || [])) {
            const cr = child.getBoundingClientRect();
            if (cr.width < 2 || cr.height < 2) continue;
            const intersects =
              cr.left < clip.right - 1 && cr.right > clip.left + 1;
            if (intersects && !keptOne) {
              keptOne = true;
              // Pin the kept track to the clip's left so mid-scroll
              // translateX ≠ residual negative parent-relative x in figit.
              pushStyleRestore(child, [
                "animation",
                "transform",
                "translate",
                "transition",
                "marginLeft",
                "left",
                "position",
              ]);
              clearMotionStyles(child);
              child.style.setProperty("margin-left", "0", "important");

              // Hide logo cells fully outside the clip — seamless duplicate
              // tracks must not paste as a long off-canvas strip.
              for (const cell of Array.from(child.children || [])) {
                try {
                  const cellR = cell.getBoundingClientRect();
                  if (cellR.width < 1 || cellR.height < 1) continue;
                  const cellIn =
                    cellR.left < clip.right - 1 && cellR.right > clip.left + 1;
                  if (cellIn) continue;
                  pushStyleRestore(cell, ["display", "visibility"]);
                  cell.style.setProperty("display", "none", "important");
                } catch (_) {}
              }
              continue;
            }
            if (!intersects || keptOne) {
              pushStyleRestore(child, ["display", "visibility"]);
              child.style.setProperty("display", "none", "important");
            }
          }
        }
      } catch (_) {}
    }

    return function cleanup() {
      for (let i = restores.length - 1; i >= 0; i--) {
        const r = restores[i];
        try {
          if ("animation" in r) r.el.style.animation = r.animation || "";
          if ("transform" in r) r.el.style.transform = r.transform || "";
          if ("translate" in r) r.el.style.translate = r.translate || "";
          if ("transition" in r) r.el.style.transition = r.transition || "";
          if ("marginLeft" in r) r.el.style.marginLeft = r.marginLeft || "";
          if ("left" in r) r.el.style.left = r.left || "";
          if ("position" in r) r.el.style.position = r.position || "";
          if ("scrollLeft" in r) {
            try {
              r.el.scrollLeft = r.scrollLeft || 0;
            } catch (_) {}
          }
          if ("display" in r) r.el.style.display = r.display || "";
          if ("visibility" in r) r.el.style.visibility = r.visibility || "";
        } catch (_) {}
      }
      restores.length = 0;
    };
  }

  /**
   * General safety net, independent of freezeMotionForCapture's marquee-
   * specific handling above: an element whose rect doesn't overlap ANY
   * ancestor's own overflow:hidden/clip/auto/scroll clip window is truly
   * invisible no matter how it ended up there — a paginated carousel's
   * off-screen slides (a single static track, not the duplicate-track
   * marquee pattern freezeMotionForCapture targets), a tooltip parked
   * off-canvas until hover, any translateX/Y that puts content behind an
   * unrelated ancestor's clip. Left unhandled, every one of those gets
   * fully serialized into the clipboard payload right alongside whatever
   * is actually visible — inflating (sometimes past the size cap) or
   * outright corrupting the capture with content nobody can see.
   *
   * Must run on the LIVE tree (real getBoundingClientRect, transforms
   * already applied/frozen) before cloning — a detached clone has no
   * layout to measure. Same clip-intersection approach already proven in
   * content.js's own layoutTree walk (elementClips/intersectRects/
   * rectsOverlap there) — ported here rather than shared across content
   * scripts, matching this codebase's existing per-file duplication
   * pattern for small, stable geometry helpers (see toolbar.js/notes.js).
   * Returns cleanup().
   */
  function pruneClippedForCapture(root) {
    const restores = [];
    if (!root || root.nodeType !== 1) return function cleanup() {};

    function clipLike(v) {
      return v === "hidden" || v === "clip" || v === "auto" || v === "scroll";
    }
    function elementClips(cs) {
      return clipLike(cs.overflow) || clipLike(cs.overflowX) || clipLike(cs.overflowY);
    }
    function intersectRects(a, b) {
      if (!a) return b;
      return {
        left: Math.max(a.left, b.left),
        top: Math.max(a.top, b.top),
        right: Math.min(a.right, b.right),
        bottom: Math.min(a.bottom, b.bottom),
      };
    }
    function overlaps(a, b) {
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }

    // Two passes, deliberately never interleaved: hiding an element is a
    // real DOM mutation, and a hidden flex/grid item is removed from its
    // parent's layout flow — every later sibling reflows into the gap
    // immediately. Measuring-then-hiding-then-measuring-the-next-sibling
    // in one combined walk reads each sibling's rect AFTER the previous
    // one's hide has already shifted it, so the geometry test is being
    // run against layout that no longer matches the real, original page
    // (confirmed live: hiding an off-screen carousel slide reflowed every
    // later slide one slot to the left, cascading until ALL of them
    // measured as "outside the clip" and got hidden — including the one
    // slide that was genuinely visible). Recording every (element, rect,
    // clipRect) triple up front against the untouched live layout, THEN
    // applying every hide afterward in a separate pass, means no
    // measurement ever happens after a mutation.
    const toHide = [];
    function measure(el, clipRect) {
      if (!el || el.nodeType !== 1) return;
      try {
        if (Acopio.isOwnNode && Acopio.isOwnNode(el)) return;
        if (el.style && el.style.display === "none") return; // already hidden upstream — nothing to measure or descend into
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 && rect.height < 1) return; // zero-size — pruneInvisibleInClone already handles these on the clone
        if (clipRect && !overlaps(rect, clipRect)) {
          toHide.push(el);
          return; // hidden — nothing inside it can be visible either, don't descend
        }
        const cs = window.getComputedStyle(el);
        const nextClip = elementClips(cs) ? intersectRects(clipRect, rect) : clipRect;
        for (const child of Array.from(el.children || [])) measure(child, nextClip);
      } catch (_) {}
    }

    try {
      let rootClip = null;
      const rootCs = window.getComputedStyle(root);
      if (clipLike(rootCs.overflow) || clipLike(rootCs.overflowX) || clipLike(rootCs.overflowY)) {
        rootClip = root.getBoundingClientRect();
      }
      for (const child of Array.from(root.children || [])) measure(child, rootClip);
      for (const el of toHide) {
        try {
          restores.push({ el, display: el.style.display });
          el.style.setProperty("display", "none", "important");
        } catch (_) {}
      }
    } catch (_) {}

    return function cleanup() {
      for (let i = restores.length - 1; i >= 0; i--) {
        try {
          restores[i].el.style.display = restores[i].display || "";
        } catch (_) {}
      }
      restores.length = 0;
    };
  }

  /**
   * True when this element owns its line boxes (heading/paragraph with <br>
   * or soft-wrap). False for cards/sections that merely contain multiple
   * block children — flattening those destroys buttons, labels, images.
   */
  function elementOwnsTextLineBoxes(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.querySelector(":scope > br")) return true;
    // Block/flex/grid children own their own lines — do not hoist.
    try {
      for (const child of Array.from(el.children || [])) {
        if (child.tagName === "BR") continue;
        if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
        const d = (window.getComputedStyle(child).display || "").toLowerCase();
        if (
          d === "block" ||
          d === "flex" ||
          d === "grid" ||
          d === "table" ||
          d === "list-item" ||
          d === "flow-root" ||
          d.startsWith("table")
        ) {
          return false;
        }
        // Replaced / control leaves are structure, not wrap owners.
        if (
          child.tagName === "IMG" ||
          child.tagName === "VIDEO" ||
          child.tagName === "SVG" ||
          child.tagName === "BUTTON" ||
          child.tagName === "INPUT" ||
          child.tagName === "TEXTAREA" ||
          child.tagName === "SELECT"
        ) {
          return false;
        }
      }
    } catch (_) {
      return false;
    }
    // Soft-wrap only when THIS node's inline/text content spans ≥2 line tops.
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = Array.from(range.getClientRects()).filter(
        (r) => r.width > 1 && r.height > 1
      );
      if (range.detach) range.detach();
      if (rects.length < 2) return false;
      const tops = new Set(rects.map((r) => Math.round(r.top)));
      return tops.size >= 2;
    } catch (_) {
      return false;
    }
  }

  /**
   * Split <br> / soft-wrapped text into absolute nowrap line spans using
   * Range.getClientRects — same idea as html.to.design / figit line boxes,
   * done BEFORE convert so figit cannot re-wrap with wrong font metrics
   * (wallof H1: one <br> became three overlapping TEXT nodes).
   * Only runs on elements that OWN the wrap — never on section/card wrappers.
   * Mutates live DOM; returns cleanup().
   */
  function materializeTextLinesForCapture(root) {
    const restores = [];
    if (!root || root.nodeType !== 1) return () => {};

    const candidates = [];
    const collect = (el) => {
      if (!el || el.nodeType !== 1) return;
      if (Acopio.isOwnNode && Acopio.isOwnNode(el)) return;
      if (el.hasAttribute && el.hasAttribute("data-acopio-text-lines")) return;
      const tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "PRE" || tag === "CODE" || tag === "SVG") {
        return;
      }
      // Prefer deepest elements that own the wrap (H1 with br, not the card).
      if (elementOwnsTextLineBoxes(el) && (el.innerText || "").trim().length >= 2) {
        candidates.push(el);
      }
      for (const child of Array.from(el.children || [])) collect(child);
    };
    collect(root);

    // Process deepest first so parents see already-split children.
    candidates.sort((a, b) => {
      const da = a.querySelectorAll("*").length;
      const db = b.querySelectorAll("*").length;
      return da - db;
    });

    for (const el of candidates) {
      try {
        if (!el.isConnected) continue;
        if (el.querySelector("[data-acopio-text-line]")) continue;
        const elRect = el.getBoundingClientRect();
        if (elRect.width < 2 || elRect.height < 2) continue;

        // Build per-line text from Range geometry (BR lines + soft wraps).
        // Capture per-text-node parent metrics so a bold <strong> leaf keeps
        // its size/weight instead of the wrapper's computed style.
        const lines = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode();
        while (node) {
          const raw = node.nodeValue || "";
          if (!raw.replace(/\s+/g, "").length) {
            node = walker.nextNode();
            continue;
          }
          let leafCs = null;
          try {
            leafCs = node.parentElement
              ? window.getComputedStyle(node.parentElement)
              : null;
          } catch (_) {}
          // Character walk detects soft-wrap line breaks inside one text node.
          const segments = [];
          let lineStart = 0;
          let lastTop = null;
          let lineLeft = Infinity;
          let lineRight = -Infinity;
          let lineBottom = -Infinity;
          for (let i = 0; i < raw.length; i++) {
            const range = document.createRange();
            try {
              range.setStart(node, i);
              range.setEnd(node, Math.min(i + 1, raw.length));
            } catch (_) {
              break;
            }
            const rects = Array.from(range.getClientRects());
            if (range.detach) range.detach();
            if (!rects.length) continue;
            const r = rects[0];
            const top = Math.round(r.top);
            if (lastTop != null && top > lastTop + 3) {
              segments.push({
                text: raw.slice(lineStart, i),
                left: lineLeft,
                top: lastTop,
                right: lineRight,
                bottom: lineBottom,
              });
              lineStart = i;
              lineLeft = Infinity;
              lineRight = -Infinity;
              lineBottom = -Infinity;
            }
            lastTop = top;
            lineLeft = Math.min(lineLeft, r.left);
            lineRight = Math.max(lineRight, r.right);
            lineBottom = Math.max(lineBottom, r.bottom);
          }
          if (lastTop != null) {
            segments.push({
              text: raw.slice(lineStart),
              left: lineLeft,
              top: lastTop,
              right: lineRight,
              bottom: lineBottom,
            });
          }
          for (const seg of segments) {
            // Preserve a single leading space after soft-wrap so "to" + " designers"
            // does not paste as "todesigners".
            const collapsed = String(seg.text || "").replace(/\s+/g, " ");
            const trimmed = collapsed.trim();
            if (!trimmed) continue;
            const text = /^\s/.test(seg.text) ? ` ${trimmed}` : trimmed;
            lines.push({
              text,
              x: seg.left - elRect.left,
              y: seg.top - elRect.top,
              w: Math.max(1, seg.right - seg.left),
              h: Math.max(1, seg.bottom - seg.top),
              leafCs,
            });
          }
          node = walker.nextNode();
        }

        // Deduplicate empty / near-duplicate lines
        const uniq = [];
        for (const ln of lines) {
          if (!ln.text) continue;
          const dup = uniq.find(
            (u) => Math.abs(u.y - ln.y) < 4 && u.text === ln.text
          );
          if (!dup) uniq.push(ln);
        }
        if (uniq.length < 2) continue;

        const cs = window.getComputedStyle(el);
        // -webkit-line-clamp truncates the VISIBLE box to N lines while the
        // underlying text still lays out in full — Range.getClientRects()
        // above measures that full underlying layout, so `uniq` here can
        // contain lines nobody viewing the real page ever sees. Capturing
        // them anyway is worse than not clamping at all:
        // repairTextNodesInDocument later grows this element's parent
        // frame to fit every captured line, which routinely shoves a real,
        // correctly-positioned sibling (a "See more" link, the next card —
        // anything after this element in DOM order) down into the middle
        // of text that was supposed to stay hidden. Confirmed live on a
        // Pinterest/Colab-style card: a clamped 3-line description plus a
        // "See more" link pasted with "See more" landing mid-paragraph and
        // the frame needing a manual resize to reveal what had happened.
        // Capping to the real clamp value keeps exactly what a viewer
        // actually sees — nothing more.
        const clampN = parseInt(
          cs.getPropertyValue("-webkit-line-clamp") || cs.getPropertyValue("line-clamp"),
          10
        );
        const visibleLines = Number.isFinite(clampN) && clampN > 0 ? uniq.slice(0, clampN) : uniq;
        if (visibleLines.length < 2) continue;

        const htmlBackup = el.innerHTML;
        const styleBackup = el.getAttribute("style") || "";
        restores.push({ el, html: htmlBackup, style: styleBackup });

        el.setAttribute("data-acopio-text-lines", "1");
        el.style.position = cs.position === "static" ? "relative" : cs.position;
        el.style.width = `${round2(elRect.width)}px`;
        el.style.height = `${round2(elRect.height)}px`;
        el.style.boxSizing = "border-box";
        el.innerHTML = "";

        for (const ln of visibleLines) {
          const span = document.createElement("span");
          span.setAttribute("data-acopio-text-line", "1");
          span.textContent = ln.text;
          const src = ln.leafCs || cs;
          // Preserve spaces at edges for paste ("to designers" not "todesigners").
          Object.assign(span.style, {
            position: "absolute",
            left: `${round2(ln.x)}px`,
            top: `${round2(ln.y)}px`,
            width: `${round2(Math.max(ln.w, 1))}px`,
            height: `${round2(Math.max(ln.h, 1))}px`,
            margin: "0",
            padding: "0",
            whiteSpace: "nowrap",
            display: "block",
            boxSizing: "border-box",
            overflow: "visible",
            fontFamily: src.fontFamily,
            fontSize: src.fontSize,
            fontWeight: src.fontWeight,
            fontStyle: src.fontStyle,
            lineHeight: src.lineHeight,
            letterSpacing: src.letterSpacing,
            color: src.color,
            textAlign: src.textAlign,
            textTransform: src.textTransform,
            WebkitTextFillColor:
              src.getPropertyValue("-webkit-text-fill-color") || src.color,
          });
          el.appendChild(span);
        }
      } catch (_) {}
    }

    return function cleanup() {
      for (let i = restores.length - 1; i >= 0; i--) {
        const r = restores[i];
        try {
          r.el.innerHTML = r.html;
          if (r.style) r.el.setAttribute("style", r.style);
          else r.el.removeAttribute("style");
          r.el.removeAttribute("data-acopio-text-lines");
        } catch (_) {}
      }
      restores.length = 0;
    };
  }

  function textLineHeightPx(n) {
    const fs = Number(n && n.fontSize) || 16;
    if (n && n.lineHeight && typeof n.lineHeight === "object") {
      if (n.lineHeight.units === "PIXELS" && n.lineHeight.value > 0) {
        return n.lineHeight.value;
      }
      if (n.lineHeight.units === "PERCENT" && n.lineHeight.value > 0) {
        return (fs * n.lineHeight.value) / 100;
      }
    }
    return fs * 1.2;
  }

  function setNodeSizeH(node, h) {
    if (!node || h == null) return;
    if (!node.size) node.size = {};
    if (node.size.y != null) node.size.y = h;
    else if (node.size.h != null) node.size.h = h;
    else node.size.y = h;
  }

  /**
   * Post-process figit TEXT so paste matches CSS lines (html.to.design bar):
   * 1) Clamp group minY >= 0 (figit emits Inter lines at y:-6 → ascender clip)
   * 2) Cap box height near line-height (inflated ink boxes smash the next line)
   * 3) Stack siblings by CSS line-height
   * 4) Grow parent FRAMEs + clear clipsContent
   */
  function repairTextNodesInDocument(doc) {
    if (!doc || !Array.isArray(doc.nodeChanges)) {
      return { clamped: 0, deoverlapped: 0, parentsGrew: 0 };
    }
    const changes = doc.nodeChanges;
    let clamped = 0;
    let deoverlapped = 0;
    let parentsGrew = 0;

    const guidKey = (g) => (g ? `${g.sessionID}:${g.localID}` : "");
    const byGuid = new Map();
    for (const n of changes) {
      if (n && n.guid) byGuid.set(guidKey(n.guid), n);
    }

    const texts = changes.filter((n) => n && n.type === "TEXT" && n.characters);
    for (const n of texts) {
      const fs = Number(n.fontSize) || 16;
      const lh = textLineHeightPx(n);
      const { h } = nodeSizeWH(n);
      // Tall enough for Inter-style ascenders inside the TEXT box (Figma can
      // clip glyphs when box == tight CSS line-height). Cap so the next CSS
      // line (y += lh) isn't buried inside this box.
      const inkPad = fs >= 40 ? Math.ceil(fs * 0.08) : Math.ceil(fs * 0.04);
      const needH = Math.max(lh + inkPad, fs + inkPad, Math.min(h || lh, lh * 1.15));
      if (h == null || Math.abs((h || 0) - needH) > 0.5) {
        setNodeSizeH(n, needH);
      }
      // CENTER absorbs top ink inside the box without negative parent Y.
      n.textAlignVertical = "CENTER";
      if (n.clipsContent === true) n.clipsContent = false;
      if (!n.textAutoResize) n.textAutoResize = "NONE";
    }

    const byParent = new Map();
    for (const n of texts) {
      const key = guidKey(n.parentIndex && n.parentIndex.guid) || "root";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(n);
    }

    for (const [parentKey, group] of byParent.entries()) {
      if (!group.length) continue;
      group.sort((a, b) => {
        const ay = nodeTransformXY(a).y ?? 0;
        const by = nodeTransformXY(b).y ?? 0;
        if (ay !== by) return ay - by;
        return (nodeTransformXY(a).x ?? 0) - (nodeTransformXY(b).x ?? 0);
      });

      let minY = Infinity;
      for (const n of group) {
        const y = nodeTransformXY(n).y;
        if (y != null && y < minY) minY = y;
      }
      if (Number.isFinite(minY) && minY < -0.5) {
        const shift = -minY;
        for (const n of group) {
          const { x, y } = nodeTransformXY(n);
          if (y == null) continue;
          setNodeTransformXY(n, x, y + shift);
        }
        clamped += 1;
        const parent = byGuid.get(parentKey);
        if (parent && parent.type === "FRAME") {
          const { h: ph } = nodeSizeWH(parent);
          if (ph != null) {
            setNodeSizeH(parent, ph + shift);
            parentsGrew += 1;
          }
          parent.clipsContent = false;
        }
      }

      // Only deoverlap VERTICAL stacks (soft-wrapped / BR lines). Horizontal
      // siblings (marquee logos, chip rows) share a parent but must keep y.
      for (let i = 1; i < group.length; i++) {
        const prev = group[i - 1];
        const cur = group[i];
        const px = nodeTransformXY(prev).x ?? 0;
        const py = nodeTransformXY(prev).y ?? 0;
        const cx = nodeTransformXY(cur).x ?? 0;
        const cy = nodeTransformXY(cur).y ?? 0;
        const pw = nodeSizeWH(prev).w || 0;
        const cw = nodeSizeWH(cur).w || 0;
        const prevRight = px + pw;
        const curRight = cx + cw;
        const overlapX =
          Math.min(prevRight, curRight) - Math.max(px, cx);
        const minW = Math.max(8, Math.min(pw || 8, cw || 8));
        // Same column / wrapped line: substantial X overlap. Side-by-side
        // logos have overlapX ≤ 0 or a tiny edge kiss.
        const sameColumn = overlapX > minW * 0.35;
        if (!sameColumn) continue;
        const step = textLineHeightPx(prev);
        const targetY = py + step;
        if (cy < targetY - 0.5) {
          setNodeTransformXY(cur, cx, targetY);
          deoverlapped += 1;
        }
      }

      const parent = byGuid.get(parentKey);
      if (parent && parent.type === "FRAME") {
        // Text parents must not clip ascenders; intentional overflow:hidden
        // strips (marquees/media) keep clips — see repairMarqueeFrames.
        parent.clipsContent = false;
        let maxBottom = 0;
        for (const t of group) {
          const ty = nodeTransformXY(t).y ?? 0;
          const th = nodeSizeWH(t).h || 0;
          maxBottom = Math.max(maxBottom, ty + th);
        }
        const { h: ph } = nodeSizeWH(parent);
        if (ph != null && maxBottom > ph + 0.5) {
          setNodeSizeH(parent, Math.ceil(maxBottom));
          parentsGrew += 1;
        }
      }
    }

    // Root paste frame + shallow ancestors: never clip padded glyph ink.
    // Do NOT clear clipsContent on every FRAME — overflow:hidden marquees
    // and media crops must stay clipped (repairMarqueeFrames sets those).
    for (const n of changes) {
      if (!n || n.type !== "FRAME") continue;
      const { w, h } = nodeSizeWH(n);
      if (w == null || h == null) continue;
      // Likely paste root / pad wrapper (large, near origin).
      const { x, y } = nodeTransformXY(n);
      if ((x == null || Math.abs(x) < 1) && (y == null || Math.abs(y) < 1) && w >= 200) {
        n.clipsContent = false;
      }
    }

    return { clamped, deoverlapped, parentsGrew };
  }

  /**
   * Snap leftover mid-scroll marquee tracks (negative parent-relative x on a
   * wide strip under a narrower clip parent). JS rAF marquees can race freeze;
   * this makes paste deterministic.
   */
  function repairMarqueeFramesInDocument(doc) {
    if (!doc || !Array.isArray(doc.nodeChanges)) return { fixed: 0 };
    const changes = doc.nodeChanges;
    const byGuid = new Map();
    for (const n of changes) {
      if (n && n.guid) {
        byGuid.set(`${n.guid.sessionID}:${n.guid.localID}`, n);
      }
    }
    let fixed = 0;
    for (const n of changes) {
      if (!n || n.type !== "FRAME") continue;
      const { x, y } = nodeTransformXY(n);
      const { w, h } = nodeSizeWH(n);
      if (x == null || w == null || x >= -1) continue;
      // Logo / marquee tracks are wide and short.
      if (w < 200 || (h != null && h > 220)) continue;
      const pg = n.parentIndex && n.parentIndex.guid;
      const parent = pg
        ? byGuid.get(`${pg.sessionID}:${pg.localID}`)
        : null;
      const pw = parent ? nodeSizeWH(parent).w : null;
      if (pw != null && w > pw + 20) {
        setNodeTransformXY(n, 0, y ?? 0);
        if (parent && parent.type === "FRAME") parent.clipsContent = true;
        fixed += 1;
      } else if (x < -20 && w > 400) {
        setNodeTransformXY(n, 0, y ?? 0);
        if (parent && parent.type === "FRAME") parent.clipsContent = true;
        fixed += 1;
      }
    }
    // Short wide children under a narrower parent → clip parent (logo strip).
    for (const n of changes) {
      if (!n || n.type !== "FRAME") continue;
      const { w, h } = nodeSizeWH(n);
      if (w == null || w < 120 || (h != null && (h < 24 || h > 120))) continue;
      const pg = n.parentIndex && n.parentIndex.guid;
      const parent = pg
        ? byGuid.get(`${pg.sessionID}:${pg.localID}`)
        : null;
      if (!parent || parent.type !== "FRAME") continue;
      const pw = nodeSizeWH(parent).w;
      const ph = nodeSizeWH(parent).h;
      if (pw == null || pw >= w - 8) continue;
      if (ph != null && ph > 160) continue;
      parent.clipsContent = true;
    }
    return { fixed };
  }

  async function blobUrlToDataUrl(url) {
    if (!url || !String(url).startsWith("blob:")) return null;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (_) {
      return null;
    }
  }

  function arrayBufferToDataUrl(buffer, mimeType) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const b64 = btoa(binary);
    return `data:${mimeType || "image/png"};base64,${b64}`;
  }

  async function urlToDataUrlViaExtension(url) {
    if (!url) return null;
    if (url.startsWith("data:")) return url;
    if (url.startsWith("blob:")) return blobUrlToDataUrl(url);
    if (!/^https?:/i.test(url) && !url.startsWith("//")) return null;
    const abs = url.startsWith("//")
      ? `${(typeof location !== "undefined" && location.protocol) || "https:"}${url}`
      : url;
    const viaBg = await fetchImageBytesViaExtension(abs);
    if (!viaBg || !viaBg.bytes) return null;
    try {
      return arrayBufferToDataUrl(viaBg.bytes, viaBg.mimeType || "image/png");
    } catch (_) {
      return null;
    }
  }

  /** Blob URLs die across convert/clipboard — inline as data: before figit runs. */
  async function materializeBlobImagesInClone(root) {
    if (!root || !root.querySelectorAll) return;
    await pinPictureAndImgSources(root);
    const imgs = Array.from(root.querySelectorAll("img"));
    await Promise.all(
      imgs.map(async (img) => {
        try {
          const src = img.currentSrc || img.getAttribute("src") || "";
          if (!src.startsWith("blob:")) return;
          const dataUrl = await blobUrlToDataUrl(src);
          if (dataUrl) {
            img.setAttribute("src", dataUrl);
            try {
              img.removeAttribute("srcset");
              img.removeAttribute("sizes");
            } catch (_) {}
          }
        } catch (_) {}
      })
    );
    await rewriteCssUrlPropsInClone(root, {
      onlyBlob: true,
      rewrite: blobUrlToDataUrl,
    });
  }

  /**
   * Pin <picture>/<img> to the best painted source (currentSrc / matching
   * <source>), drop srcset so figit cannot pick a different art-direction
   * candidate. Prefer live currentSrc when connected.
   */
  function bestImgSourceUrl(img) {
    if (!img) return "";
    // Prefer matching <source> over currentSrc — clones / data-URL srcsets
    // sometimes leave currentSrc stuck on the <img src> fallback.
    try {
      const picture = img.closest && img.closest("picture");
      if (picture) {
        for (const source of Array.from(picture.querySelectorAll("source"))) {
          const media = source.getAttribute("media");
          if (media) {
            try {
              if (!window.matchMedia(media).matches) continue;
            } catch (_) {}
          }
          const srcset = source.getAttribute("srcset") || "";
          const candidates = srcset
            .split(",")
            .map((p) => p.trim().split(/\s+/)[0])
            .filter(Boolean);
          if (candidates.length) return candidates[0];
          const src = source.getAttribute("src");
          if (src) return src;
        }
      }
    } catch (_) {}
    try {
      if (img.currentSrc) return img.currentSrc;
    } catch (_) {}
    return (
      img.getAttribute("src") ||
      (typeof Acopio !== "undefined" && Acopio.resolveImgSrc
        ? Acopio.resolveImgSrc(img)
        : "") ||
      ""
    );
  }

  function pinPictureAndImgSources(root) {
    if (!root || !root.querySelectorAll) return;
    const imgs = Array.from(root.querySelectorAll("img"));
    for (const img of imgs) {
      try {
        const best = bestImgSourceUrl(img);
        if (best) {
          try {
            const abs = new URL(best, location.href).href;
            img.setAttribute("src", abs);
          } catch (_) {
            img.setAttribute("src", best);
          }
        }
        try {
          img.removeAttribute("srcset");
          img.removeAttribute("sizes");
        } catch (_) {}
        const picture = img.closest && img.closest("picture");
        if (picture) {
          for (const source of Array.from(picture.querySelectorAll("source"))) {
            try {
              source.remove();
            } catch (_) {}
          }
        }
      } catch (_) {}
    }
  }

  /**
   * Live-DOM pin so currentSrc reflects the painted <picture> choice before
   * clone (offscreen clones often lose source selection).
   */
  function pinPictureSourcesForCapture(root) {
    if (!root || root.nodeType !== 1) return () => {};
    const restores = [];
    const imgs = [];
    try {
      if (root.querySelectorAll) {
        imgs.push(...Array.from(root.querySelectorAll("img")));
      }
      if (root.tagName === "IMG") imgs.push(root);
    } catch (_) {}
    for (const img of imgs) {
      try {
        const prev = {
          img,
          src: img.getAttribute("src"),
          srcset: img.getAttribute("srcset"),
          sizes: img.getAttribute("sizes"),
          sources: [],
        };
        const picture = img.closest && img.closest("picture");
        if (picture) {
          for (const source of Array.from(picture.querySelectorAll("source"))) {
            prev.sources.push({
              el: source,
              parent: source.parentNode,
              next: source.nextSibling,
              html: source.outerHTML,
            });
          }
        }
        const best = bestImgSourceUrl(img);
        if (best) {
          try {
            img.setAttribute("src", new URL(best, location.href).href);
          } catch (_) {
            img.setAttribute("src", best);
          }
        }
        img.removeAttribute("srcset");
        img.removeAttribute("sizes");
        if (picture) {
          for (const source of Array.from(picture.querySelectorAll("source"))) {
            try {
              source.remove();
            } catch (_) {}
          }
        }
        restores.push(prev);
      } catch (_) {}
    }
    return function cleanup() {
      for (let i = restores.length - 1; i >= 0; i--) {
        const r = restores[i];
        try {
          if (r.src != null) r.img.setAttribute("src", r.src);
          else r.img.removeAttribute("src");
          if (r.srcset != null) r.img.setAttribute("srcset", r.srcset);
          else r.img.removeAttribute("srcset");
          if (r.sizes != null) r.img.setAttribute("sizes", r.sizes);
          else r.img.removeAttribute("sizes");
          for (const s of r.sources) {
            if (!s.parent) continue;
            const tmp = document.createElement("div");
            tmp.innerHTML = s.html;
            const node = tmp.firstChild;
            if (node) s.parent.insertBefore(node, s.next);
          }
        } catch (_) {}
      }
      restores.length = 0;
    };
  }

  const CSS_URL_IMAGE_PROPS = [
    { css: "background-image", style: "backgroundImage" },
    { css: "mask-image", style: "maskImage" },
    { css: "-webkit-mask-image", style: "webkitMaskImage" },
    { css: "border-image-source", style: "borderImageSource" },
    { css: "list-style-image", style: "listStyleImage" },
  ];

  function extractCssUrls(val) {
    const urls = [];
    if (!val || typeof val !== "string") return urls;
    const re = /url\(\s*(?:["']?)([^"')]+)(?:["']?)\s*\)/gi;
    let m;
    while ((m = re.exec(val)) !== null) {
      const raw = (m[1] || "").trim();
      if (!raw || raw.toLowerCase().startsWith("data:")) continue;
      urls.push(raw);
    }
    return urls;
  }

  function resolveCssUrl(raw) {
    if (!raw) return null;
    if (raw.startsWith("data:")) return raw;
    if (raw.startsWith("blob:")) return raw;
    try {
      if (raw.startsWith("//")) {
        return `${(typeof location !== "undefined" && location.protocol) || "https:"}${raw}`;
      }
      return new URL(raw, location.href).href;
    } catch (_) {
      return raw;
    }
  }

  /**
   * Rewrite url(...) in frozen/computed CSS image props on the clone.
   * Reads style attribute + camelCase style + getComputedStyle fallback so
   * class-authored backgrounds (not only inline el.style) are bundled.
   */
  async function rewriteCssUrlPropsInClone(root, opts) {
    const onlyBlob = Boolean(opts && opts.onlyBlob);
    const rewrite = opts && opts.rewrite;
    if (!root || !rewrite) return;
    const all = [root, ...Array.from(root.querySelectorAll("*"))];
    await Promise.all(
      all.map(async (el) => {
        try {
          if (!el || el.nodeType !== 1 || !el.style) return;
          for (const prop of CSS_URL_IMAGE_PROPS) {
            let val =
              el.style[prop.style] ||
              el.style.getPropertyValue(prop.css) ||
              "";
            if (!val) {
              const attr = el.getAttribute("style") || "";
              if (attr && attr.includes(prop.css)) {
                const m = attr.match(
                  new RegExp(
                    prop.css.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                      "\\s*:\\s*([^;]+)",
                    "i"
                  )
                );
                if (m) val = m[1].trim();
              }
            }
            if (!val || val === "none") continue;
            if (onlyBlob && !val.includes("blob:")) continue;
            if (!onlyBlob && !/url\(/i.test(val)) continue;

            const urls = extractCssUrls(val);
            if (!urls.length) continue;
            let next = val;
            for (const raw of urls) {
              if (onlyBlob && !raw.startsWith("blob:")) continue;
              const abs = resolveCssUrl(raw);
              if (!abs) continue;
              if (!onlyBlob && abs.startsWith("data:")) continue;
              if (
                !onlyBlob &&
                !abs.startsWith("blob:") &&
                !/^https?:/i.test(abs) &&
                !abs.startsWith("//")
              ) {
                continue;
              }
              const dataUrl = await rewrite(abs);
              if (dataUrl) {
                // Replace each occurrence of the raw token carefully.
                next = next.split(raw).join(dataUrl);
              }
            }
            if (next !== val) {
              try {
                el.style.setProperty(prop.css, next);
              } catch (_) {
                el.style[prop.style] = next;
              }
            }
          }
        } catch (_) {}
      })
    );
  }

  /**
   * Materialize cross-origin <img> (and critical CSS backgrounds) to data URLs
   * via FETCH_IMAGE_BYTES so figit's imageLoader always sees same-origin bytes.
   * Prefer IMAGE fills for raster; SVG may still become VECTOR when inline.
   */
  async function materializeRemoteImagesInClone(root) {
    if (!root || !root.querySelectorAll) return;
    await pinPictureAndImgSources(root);
    const imgs = Array.from(root.querySelectorAll("img"));
    await Promise.all(
      imgs.map(async (img) => {
        try {
          const src = img.currentSrc || img.getAttribute("src") || "";
          if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;
          // Skip tiny tracking pixels
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          if (w > 0 && h > 0 && w * h < 16) return;
          const dataUrl = await urlToDataUrlViaExtension(src);
          if (dataUrl) {
            img.setAttribute("src", dataUrl);
            try {
              img.removeAttribute("srcset");
              img.removeAttribute("sizes");
            } catch (_) {}
          }
        } catch (_) {}
      })
    );

    await rewriteCssUrlPropsInClone(root, {
      onlyBlob: false,
      rewrite: urlToDataUrlViaExtension,
    });
  }

  function stylePartsFromComputed(cs, mode) {
    const parts = [];
    if (mode === "full") {
      for (let i = 0; i < cs.length; i++) {
        const prop = cs.item(i);
        if (!prop) continue;
        // Skip non-visual / inherited noise that bloats without helping paint.
        if (prop.startsWith("-webkit-user") || prop === "cursor" || prop === "caret-color") {
          continue;
        }
        parts.push(`${prop}:${cs.getPropertyValue(prop)}`);
      }
    } else {
      for (const prop of FREEZE_PROPS) {
        const val = cs.getPropertyValue(prop);
        if (val == null || val === "") continue;
        parts.push(`${prop}:${val}`);
      }
    }
    return parts;
  }

  /**
   * Copy computed styles + lock each node to its live border-box size.
   * Margins/paddings stay as computed (not zeroed) so sibling spacing matches.
   * Text metrics are forced to painted px so Figma cannot reflow type.
   * Pairs light DOM + open shadow children (clone built via cloneWithOpenShadows).
   */
  function applyFrozenStyles(liveEl, cloneEl, mode) {
    if (!liveEl || !cloneEl || liveEl.nodeType !== 1 || cloneEl.nodeType !== 1) return;
    try {
      const cs = window.getComputedStyle(liveEl);
      const parts = stylePartsFromComputed(cs, mode || "stored");
      const rect = liveEl.getBoundingClientRect();
      parts.push("box-sizing:border-box");
      if (rect.width > 0) parts.push(`width:${round2(rect.width)}px`);
      if (rect.height > 0) parts.push(`height:${round2(rect.height)}px`);
      parts.push("flex-grow:0");
      parts.push("flex-shrink:0");

      const fs = parseFloat(cs.fontSize);
      if (Number.isFinite(fs) && fs > 0) parts.push(`font-size:${round2(fs)}px`);
      const lh = cs.lineHeight;
      if (lh && lh !== "normal") {
        const lhp = parseFloat(lh);
        if (Number.isFinite(lhp) && lhp > 0) parts.push(`line-height:${round2(lhp)}px`);
      }
      const ls = parseFloat(cs.letterSpacing);
      if (Number.isFinite(ls)) parts.push(`letter-spacing:${round2(ls)}px`);
      const color = cs.color;
      if (color) parts.push(`color:${color}`);
      // Gradient/clipped text often keeps `color` but paints via
      // -webkit-text-fill-color:transparent — Figma then gets fills with
      // no visible glyphs. Force a real fill that matches painted color.
      const fillColor = cs.getPropertyValue("-webkit-text-fill-color") || "";
      const bgClip = (cs.getPropertyValue("-webkit-background-clip") || cs.backgroundClip || "").toLowerCase();
      if (
        !fillColor ||
        fillColor === "transparent" ||
        /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(fillColor) ||
        bgClip.includes("text")
      ) {
        if (color) parts.push(`-webkit-text-fill-color:${color}`);
      }
      const ws = cs.whiteSpace;
      if (ws) parts.push(`white-space:${ws}`);

      // Invisible nodes must not paste as visible Figma layers.
      const vis = (cs.visibility || "").toLowerCase();
      const op = parseFloat(cs.opacity);
      const invisible =
        cs.display === "none" ||
        vis === "hidden" ||
        vis === "collapse" ||
        op === 0;
      if (invisible) {
        parts.push("display:none");
        parts.push("visibility:hidden");
        parts.push("opacity:0");
      }

      // Line-clamp / ellipsis: lock painted height + overflow so Figma TEXT
      // cannot expand to the full unclamped string.
      if (!invisible) {
        const clampRaw = cs.getPropertyValue("-webkit-line-clamp") || "";
        const clampN = parseInt(clampRaw, 10);
        const hasClamp = Number.isFinite(clampN) && clampN > 0 && clampRaw !== "none";
        const ellipsis = (cs.textOverflow || "").toLowerCase() === "ellipsis";
        if (hasClamp || ellipsis) {
          if (rect.height > 0) {
            parts.push(`height:${round2(rect.height)}px`);
            parts.push(`max-height:${round2(rect.height)}px`);
          }
          parts.push("overflow:hidden");
          parts.push("overflow-x:hidden");
          parts.push("overflow-y:hidden");
          if (hasClamp) {
            parts.push("display:-webkit-box");
            parts.push("-webkit-box-orient:vertical");
            parts.push(`-webkit-line-clamp:${clampN}`);
          }
          if (ellipsis) parts.push("text-overflow:ellipsis");
        }
      }

      cloneEl.setAttribute("style", parts.join(";"));
    } catch (_) {}

    const liveKids =
      typeof Acopio !== "undefined" && Acopio.fidelityChildElements
        ? Acopio.fidelityChildElements(liveEl)
        : Array.from(liveEl.children || []);
    const cloneKids = Array.from(cloneEl.children || []);
    const n = Math.min(liveKids.length, cloneKids.length);
    for (let i = 0; i < n; i++) applyFrozenStyles(liveKids[i], cloneKids[i], mode);
  }

  /**
   * Briefly prep live DOM (whitespace + ::before/::after), deep-clone with
   * open shadow inlined + full computed freeze onto an offscreen host, then
   * restore the page. One pipeline for Live Copy, Collect bake, Library remount.
   *
   * Page-offset fix (systemic): figit positions each node as
   * getBoundingClientRect(el) − getBoundingClientRect(parent). A live root
   * with margin:0 100px (or page chrome) therefore emits a nested FRAME at
   * (100,120) the same size as the root — content shifts/clips. We always
   * convert a pad-root whose only child is the frozen clone at
   * (PASTE_SAFE_MARGIN_PX, PASTE_SAFE_MARGIN_PX) with margin/transform forced
   * to zero so parent-relative coords never encode page layout.
   */
  async function prepareFidelityClone(liveEl, opts) {
    const liveBox = measureBox(liveEl, opts);
    const contentW = Math.max(1, round2(liveBox.width));
    const contentH = Math.max(1, round2(liveBox.height));
    const pad = PASTE_SAFE_MARGIN_PX;
    const frameW = contentW + pad * 2;
    const frameH = contentH + pad * 2;
    const liveCleanups = [];
    try {
      if (
        typeof Acopio !== "undefined" &&
        Acopio.materializeVideosForCapture
      ) {
        liveCleanups.push(Acopio.materializeVideosForCapture(liveEl));
      }
      if (
        typeof Acopio !== "undefined" &&
        Acopio.materializeCanvasesForCapture
      ) {
        liveCleanups.push(Acopio.materializeCanvasesForCapture(liveEl));
      }
      if (
        typeof Acopio !== "undefined" &&
        Acopio.materializeIframesForCapture
      ) {
        liveCleanups.push(Acopio.materializeIframesForCapture(liveEl));
      }
      if (
        typeof Acopio !== "undefined" &&
        Acopio.bakeStickyFixedForCapture
      ) {
        liveCleanups.push(Acopio.bakeStickyFixedForCapture(liveEl));
      }
      if (
        typeof Acopio !== "undefined" &&
        Acopio.freezeLineClampForCapture
      ) {
        liveCleanups.push(Acopio.freezeLineClampForCapture(liveEl));
      }
      if (
        typeof Acopio !== "undefined" &&
        Acopio.materializeMaskedClippedForCapture
      ) {
        liveCleanups.push(Acopio.materializeMaskedClippedForCapture(liveEl));
      }
      liveCleanups.push(pinPictureSourcesForCapture(liveEl));
      liveCleanups.push(freezeMotionForCapture(liveEl));
      // Runs after motion is frozen (so a genuinely-animating marquee is
      // already settled to a stable rest frame) and before geometry is
      // measured anywhere else — see pruneClippedForCapture's own comment
      // for why this needs the live, laid-out tree rather than the clone.
      liveCleanups.push(pruneClippedForCapture(liveEl));
      if (
        typeof Acopio !== "undefined" &&
        Acopio.normalizeDisplayWhitespaceForCapture
      ) {
        liveCleanups.push(Acopio.normalizeDisplayWhitespaceForCapture(liveEl));
      }
      // Line-split AFTER whitespace normalize so BR lines keep spaces.
      liveCleanups.push(materializeTextLinesForCapture(liveEl));
      if (
        typeof Acopio !== "undefined" &&
        Acopio.materializePseudosForCapture
      ) {
        liveCleanups.push(Acopio.materializePseudosForCapture(liveEl));
      }
      await raf2();
      // Let poster/frame <img> decode before freeze + convert.
      await waitForImages(liveEl);
      await raf2();

      const host = document.createElement("div");
      host.setAttribute("data-acopio", "figma-fidelity-host");
      Object.assign(host.style, {
        position: "fixed",
        left: "-10000px",
        top: "0",
        width: `${frameW}px`,
        height: `${frameH}px`,
        margin: "0",
        padding: "0",
        border: "none",
        // Visible so ascenders/ink outside the content box aren't clipped
        // before figit measures — paste safe-margin owns the clearance.
        overflow: "visible",
        visibility: "hidden",
        pointerEvents: "none",
        zIndex: "-1",
      });

      // Transparent convert target = Figma paste root (content + 20px inset).
      const padRoot = document.createElement("div");
      padRoot.setAttribute("data-acopio", "figma-paste-safe-root");
      Object.assign(padRoot.style, {
        position: "relative",
        boxSizing: "border-box",
        width: `${frameW}px`,
        height: `${frameH}px`,
        margin: "0",
        padding: "0",
        border: "none",
        overflow: "visible",
        background: "transparent",
        transform: "none",
      });

      const clone =
        typeof Acopio !== "undefined" && Acopio.cloneWithOpenShadows
          ? Acopio.cloneWithOpenShadows(liveEl)
          : liveEl.cloneNode(true);
      if (!clone) throw new Error("Couldn't clone component for Figma.");
      applyFrozenStyles(liveEl, clone, "full");
      // Re-freeze on the clone itself — stylesheet animations can still
      // compute a mid-scroll matrix on the live tree between freeze and
      // style copy; the offscreen clone must be transform-clean for figit.
      freezeMotionForCapture(clone);
      // Drop invisible / zero-size decoys before node-cap accounting + convert
      // so opacity:0 / display:none never paste as visible layers.
      if (typeof Acopio !== "undefined" && Acopio.pruneInvisibleInClone) {
        Acopio.pruneInvisibleInClone(clone);
      }
      await materializeBlobImagesInClone(clone);
      await materializeRemoteImagesInClone(clone);

      // Zero page-offset: force clone into padRoot at (pad,pad). Figit's
      // parent-relative coords then encode selection geometry only.
      clone.style.setProperty("margin", "0", "important");
      clone.style.setProperty("margin-top", "0", "important");
      clone.style.setProperty("margin-right", "0", "important");
      clone.style.setProperty("margin-bottom", "0", "important");
      clone.style.setProperty("margin-left", "0", "important");
      clone.style.setProperty("position", "absolute", "important");
      // Do NOT set shorthand `inset` after left/top — it resets them to auto.
      clone.style.setProperty("left", `${pad}px`, "important");
      clone.style.setProperty("top", `${pad}px`, "important");
      clone.style.setProperty("right", "auto", "important");
      clone.style.setProperty("bottom", "auto", "important");
      clone.style.boxSizing = "border-box";
      clone.style.width = `${contentW}px`;
      clone.style.height = `${contentH}px`;
      clone.style.minWidth = `${contentW}px`;
      clone.style.maxWidth = `${contentW}px`;
      clone.style.minHeight = `${contentH}px`;
      clone.style.maxHeight = `${contentH}px`;
      // Prefer visible on the selection root so glyph ink at the content
      // edge isn't clipped into the paste margin. Descendants keep frozen
      // overflow (hidden/scroll) from applyFrozenStyles when the live CSS
      // actually clips.
      const liveCs = window.getComputedStyle(liveEl);
      const liveOverflow = `${liveCs.overflow || ""} ${liveCs.overflowX || ""} ${liveCs.overflowY || ""}`.toLowerCase();
      const liveClips =
        /\b(hidden|clip)\b/.test(liveOverflow) &&
        !/\bvisible\b/.test(liveCs.overflow || "");
      clone.style.setProperty(
        "overflow",
        liveClips ? "hidden" : "visible",
        "important"
      );
      clone.style.setProperty("overflow-x", liveClips ? "hidden" : "visible", "important");
      clone.style.setProperty("overflow-y", liveClips ? "hidden" : "visible", "important");
      // Scroll/entrance translate on the root (e.g. case-card translateY(12))
      // must not shift every child inside the Figma frame — size was already
      // measured from the painted box.
      clone.style.setProperty("transform", "none", "important");
      clone.style.setProperty("translate", "none", "important");

      padRoot.appendChild(clone);
      host.appendChild(padRoot);
      document.documentElement.appendChild(host);

      while (liveCleanups.length) {
        try {
          liveCleanups.pop()();
        } catch (_) {}
      }

      await waitForImages(clone);
      await raf2();

      // Honest cap: after prune, if the clone is still enormous, refuse
      // editable convert so callers fall back to screenshot — never empty layers.
      let nodeCount = 0;
      const countNodes = (node) => {
        if (!node || node.nodeType !== 1) return;
        nodeCount += 1;
        if (nodeCount > MAX_CONVERT_DOM_NODES) return;
        for (const child of Array.from(node.children || [])) countNodes(child);
      };
      countNodes(clone);
      if (nodeCount > MAX_CONVERT_DOM_NODES) {
        try {
          host.remove();
        } catch (_) {}
        throw new Error(
          "Component too complex for editable Figma layers — use screenshot fallback."
        );
      }

      return {
        target: padRoot,
        contentTarget: clone,
        width: frameW,
        height: frameH,
        contentWidth: contentW,
        contentHeight: contentH,
        pasteSafeMargin: pad,
        cleanup: () => {
          try {
            host.remove();
          } catch (_) {}
        },
      };
    } catch (err) {
      while (liveCleanups.length) {
        try {
          liveCleanups.pop()();
        } catch (_) {}
      }
      throw err;
    }
  }

  /**
   * If convert still emits a same-size child FRAME at a nonzero offset that
   * is not the paste safe-margin (classic page-margin bug), snap that frame
   * to (pad, pad). Does not double-shift children — only the mis-rooted frame.
   */
  function normalizePageOffsetFrames(doc, prepared) {
    if (!doc || !Array.isArray(doc.nodeChanges) || !prepared) return null;
    const pad = prepared.pasteSafeMargin != null ? prepared.pasteSafeMargin : PASTE_SAFE_MARGIN_PX;
    const contentW = prepared.contentWidth || prepared.width;
    const contentH = prepared.contentHeight || prepared.height;
    const changes = doc.nodeChanges;
    const frames = changes.filter((n) => n && n.type === "FRAME");
    if (!frames.length) return null;

    const root =
      frames.find((f) => {
        const { w, h } = nodeSizeWH(f);
        return (
          w != null &&
          h != null &&
          Math.abs(w - prepared.width) < 2 &&
          Math.abs(h - prepared.height) < 2
        );
      }) || frames[0];
    if (!root || !root.guid) return null;

    const rootGuid = root.guid;
    let fixed = null;
    for (const f of frames) {
      if (!f || f.guid === rootGuid) continue;
      const parentGuid = f.parentIndex && f.parentIndex.guid;
      if (parentGuid !== rootGuid) continue;
      const { x, y } = nodeTransformXY(f);
      const { w, h } = nodeSizeWH(f);
      if (x == null || y == null || w == null || h == null) continue;
      const sameSize =
        Math.abs(w - contentW) < 3 && Math.abs(h - contentH) < 3;
      const sameAsRoot =
        Math.abs(w - prepared.width) < 3 && Math.abs(h - prepared.height) < 3;
      if (!sameSize && !sameAsRoot) continue;
      const atPad = Math.abs(x - pad) < 1 && Math.abs(y - pad) < 1;
      const atOrigin = Math.abs(x) < 1 && Math.abs(y) < 1;
      if (atPad || atOrigin) continue;
      if (Math.abs(x) <= 5 && Math.abs(y) <= 5) continue;
      setNodeTransformXY(f, pad, pad);
      if (sameAsRoot && f.size) {
        if (f.size.x != null) f.size.x = contentW;
        if (f.size.y != null) f.size.y = contentH;
      }
      fixed = { name: f.name, from: { x, y }, to: { x: pad, y: pad } };
      break;
    }
    if (root.clipsContent === true) root.clipsContent = false;
    return fixed;
  }

  function buildFigmaStyledHtml(liveEl) {
    if (!liveEl || liveEl.nodeType !== 1) return "";
    const cleanups = [];
    try {
      if (
        typeof Acopio !== "undefined" &&
        Acopio.materializeVideosForCapture
      ) {
        cleanups.push(Acopio.materializeVideosForCapture(liveEl));
      }
      if (
        typeof Acopio !== "undefined" &&
        Acopio.materializeCanvasesForCapture
      ) {
        cleanups.push(Acopio.materializeCanvasesForCapture(liveEl));
      }
      if (
        typeof Acopio !== "undefined" &&
        Acopio.materializeIframesForCapture
      ) {
        cleanups.push(Acopio.materializeIframesForCapture(liveEl));
      }
      if (
        typeof Acopio !== "undefined" &&
        Acopio.bakeStickyFixedForCapture
      ) {
        cleanups.push(Acopio.bakeStickyFixedForCapture(liveEl));
      }
      if (
        typeof Acopio !== "undefined" &&
        Acopio.freezeLineClampForCapture
      ) {
        cleanups.push(Acopio.freezeLineClampForCapture(liveEl));
      }
      if (
        typeof Acopio !== "undefined" &&
        Acopio.materializeMaskedClippedForCapture
      ) {
        cleanups.push(Acopio.materializeMaskedClippedForCapture(liveEl));
      }
      if (
        typeof Acopio !== "undefined" &&
        Acopio.normalizeDisplayWhitespaceForCapture
      ) {
        cleanups.push(Acopio.normalizeDisplayWhitespaceForCapture(liveEl));
      }
      if (
        typeof Acopio !== "undefined" &&
        Acopio.materializePseudosForCapture
      ) {
        cleanups.push(Acopio.materializePseudosForCapture(liveEl));
      }
      const clone =
        typeof Acopio !== "undefined" && Acopio.cloneWithOpenShadows
          ? Acopio.cloneWithOpenShadows(liveEl)
          : liveEl.cloneNode(true);
      if (!clone) return "";
      applyFrozenStyles(liveEl, clone, "stored");
      if (typeof Acopio !== "undefined" && Acopio.pruneInvisibleInClone) {
        Acopio.pruneInvisibleInClone(clone);
      }
      let nodeCount = 0;
      const count = (node) => {
        if (node.nodeType !== 1) return;
        nodeCount += 1;
        if (nodeCount > MAX_FIGMA_HTML_NODES) return;
        for (const child of Array.from(node.children || [])) count(child);
      };
      count(clone);
      if (nodeCount > MAX_FIGMA_HTML_NODES) return "";
      const html = clone.outerHTML || "";
      if (new Blob([html]).size > MAX_FIGMA_HTML_BYTES) return "";
      return html;
    } catch (_) {
      return "";
    } finally {
      while (cleanups.length) {
        try {
          cleanups.pop()();
        } catch (_) {}
      }
    }
  }

  function escapeAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Figma reads markers in text/html. Chat/Notes that prefer HTML (and ignore
   * image/png) still need a visible image — append a small <img> after the
   * marker spans. Cap size so clipboard stays under OS limits.
   */
  async function figmaHtmlWithImageFallback(figmaHtml, pngBlob, alt) {
    if (!figmaHtml || !pngBlob || pngBlob.size > 1.5 * 1024 * 1024) return figmaHtml;
    try {
      const dataUrl = await blobToDataUrl(pngBlob);
      const img =
        `<img src="${dataUrl}" alt="${escapeAttr(alt || "Component")}" ` +
        `style="max-width:480px;height:auto;display:block;margin:0;" />`;
      if (/<\/div>\s*$/i.test(figmaHtml)) {
        return figmaHtml.replace(/<\/div>\s*$/i, `${img}</div>`);
      }
      return `${figmaHtml}${img}`;
    } catch (_) {
      return figmaHtml;
    }
  }

  /**
   * Dual clipboard (best practice):
   *   image/png  → Slack, chat, Notes, Notion image paste
   *   text/html  → Figma editable layers (Kiwi envelope)
   *   text/plain → last-resort label
   * Worst case: PNG only (or Figma-only if screenshot missing).
   */
  async function writeDualClipboard(opts) {
    const figmaHtml = opts && opts.figmaHtml ? String(opts.figmaHtml) : "";
    const pngBlob = opts && opts.pngBlob ? opts.pngBlob : null;
    const plainText = (opts && opts.plainText) || "Component";
    const label = (opts && opts.label) || plainText;

    if (!figmaHtml && !pngBlob) {
      return { ok: false, error: "Nothing to copy.", mode: null };
    }

    const htmlForClipboard = figmaHtml
      ? await figmaHtmlWithImageFallback(figmaHtml, pngBlob, label)
      : "";

    const buildTypes = (includeFigma, includePng) => {
      const types = {
        "text/plain": new Blob([plainText], { type: "text/plain" }),
      };
      if (includeFigma && htmlForClipboard) {
        types["text/html"] = new Blob([htmlForClipboard], { type: "text/html" });
      }
      if (includePng && pngBlob) {
        types["image/png"] = pngBlob;
      }
      return types;
    };

    const attempts = [];
    if (figmaHtml && pngBlob) attempts.push({ includeFigma: true, includePng: true, mode: "figma+image" });
    if (figmaHtml) attempts.push({ includeFigma: true, includePng: false, mode: "figma" });
    if (pngBlob) attempts.push({ includeFigma: false, includePng: true, mode: "image" });

    let lastErr = null;
    for (const attempt of attempts) {
      try {
        const types = buildTypes(attempt.includeFigma, attempt.includePng);
        // Need at least one of html/png besides plain.
        if (!types["text/html"] && !types["image/png"]) continue;
        await navigator.clipboard.write([new ClipboardItem(types)]);
        return { ok: true, mode: attempt.mode };
      } catch (err) {
        lastErr = err;
      }
    }
    return {
      ok: false,
      error: String((lastErr && lastErr.message) || lastErr || "Clipboard write failed."),
      mode: null,
    };
  }

  async function convertElementToFigmaResult(el, width, height, name, fontAssets, prepared) {
    const figma = await getConverter(fontAssets);
    const result = await figma.convert({
      element: el,
      width,
      height,
      name: String(name).slice(0, 80),
    });
    if (!result) throw new Error("Converter returned no payload.");
    if (result.document && prepared) {
      normalizePageOffsetFrames(result.document, prepared);
    }
    if (result.document) {
      repairTextNodesInDocument(result.document);
      repairMarqueeFramesInDocument(result.document);
      // Ensure root never clips padded ascenders.
      const frames = (result.document.nodeChanges || []).filter((n) => n && n.type === "FRAME");
      for (const f of frames.slice(0, 3)) {
        if (f.clipsContent === true) f.clipsContent = false;
      }
    }
    return result;
  }

  async function resultToClipboardHtml(result) {
    if (!result) throw new Error("Converter returned no payload.");
    if (typeof result.toClipboardHtml === "function") {
      return result.toClipboardHtml();
    }
    if (typeof result.toClipboardItem === "function") {
      const item = result.toClipboardItem();
      if (item && typeof item.getType === "function") {
        const blob = await item.getType("text/html");
        return await blob.text();
      }
    }
    throw new Error("Converter returned no clipboard HTML.");
  }

  async function convertElementToFigmaHtml(el, width, height, name, fontAssets, prepared) {
    const result = await convertElementToFigmaResult(
      el,
      width,
      height,
      name,
      fontAssets,
      prepared
    );
    return resultToClipboardHtml(result);
  }

  const MAX_BAKED_CLIPBOARD_CHARS = 4 * 1024 * 1024;

  async function resolveFontAssets(el, opts) {
    let fontAssets = (opts && opts.fontAssets) || [];
    if (
      (!fontAssets || !fontAssets.length) &&
      typeof Acopio !== "undefined" &&
      Acopio.harvestFontBytesForElement
    ) {
      try {
        fontAssets = await Promise.race([
          Acopio.harvestFontBytesForElement(el),
          new Promise((r) => setTimeout(() => r([]), 4000)),
        ]);
      } catch (_) {
        fontAssets = [];
      }
    }
    return fontAssets;
  }

  /**
   * Convert live selection via the fidelity clone path only (same as clipboard).
   * Returns figit document + clipboard HTML + geometry metadata for tests.
   */
  async function convertLiveToDocument(el, opts) {
    if (!el || !el.getBoundingClientRect) {
      throw new Error("No element to convert.");
    }
    const name =
      (opts && opts.name) ||
      (el.getAttribute && el.getAttribute("aria-label")) ||
      el.tagName ||
      "Component";
    await waitForFonts();
    await waitForImages(el);
    await raf2();

    const fontAssets = await resolveFontAssets(el, opts);
    const prepared = await prepareFidelityClone(el, opts);
    try {
      const result = await convertElementToFigmaResult(
        prepared.target,
        prepared.width,
        prepared.height,
        name,
        fontAssets,
        prepared
      );
      const html = await resultToClipboardHtml(result);
      if (!html || html.length > MAX_BAKED_CLIPBOARD_CHARS) {
        throw new Error("Figma clipboard payload too large or empty.");
      }
      const offsetFix = normalizePageOffsetFrames(result.document, prepared);
      return {
        document: result.document,
        html,
        fontAssets,
        width: prepared.width,
        height: prepared.height,
        contentWidth: prepared.contentWidth,
        contentHeight: prepared.contentHeight,
        pasteSafeMargin: prepared.pasteSafeMargin,
        offsetFix,
      };
    } finally {
      prepared.cleanup();
    }
  }

  /**
   * Convert → Figma Kiwi HTML (no clipboard write).
   * Uses frozen offscreen clone so spacing / type / color match the paint.
   */
  async function convertLiveToClipboardHtml(el, opts) {
    const out = await convertLiveToDocument(el, opts);
    return {
      html: out.html,
      fontAssets: out.fontAssets,
      width: out.width,
      height: out.height,
      contentWidth: out.contentWidth,
      contentHeight: out.contentHeight,
      pasteSafeMargin: out.pasteSafeMargin,
    };
  }

  async function copyBakedFigmaClipboard(figmaClipboardHtml, opts) {
    const pngBlob = opts && opts.pngBlob ? opts.pngBlob : null;
    const plainText = (opts && opts.plainText) || (opts && opts.name) || "Component";
    const label = (opts && opts.name) || plainText;
    if (!figmaClipboardHtml) {
      return { ok: false, error: "No baked Figma clipboard.", mode: null };
    }
    return writeDualClipboard({
      figmaHtml: figmaClipboardHtml,
      pngBlob,
      plainText,
      label,
    });
  }

  async function prepareExactTarget(el, opts) {
    const alreadyFrozen = Boolean(opts && opts.alreadyFrozen);
    await waitForFonts();
    await waitForImages(el);
    await raf2();

    const liveBox = measureBox(el, opts);
    if (alreadyFrozen) {
      const box = measureBox(el, liveBox);
      return {
        target: el,
        width: Math.max(1, round2(liveBox.width || box.width)),
        height: Math.max(1, round2(liveBox.height || box.height)),
        cleanup: () => {},
      };
    }

    return prepareFidelityClone(el, opts);
  }

  /**
   * Dual-write: Figma Auto Layout + PNG. Live elements convert in place.
   */
  async function copyElementAsEditableFigma(el, opts) {
    if (!el || !el.getBoundingClientRect) {
      return { ok: false, error: "No element to convert." };
    }
    const name =
      (opts && opts.name) ||
      (el.getAttribute && el.getAttribute("aria-label")) ||
      el.tagName ||
      "Component";
    // May be a Blob OR a pending Promise<Blob> — the caller's screenshot
    // capture and this function's own DOM→Figma conversion are two
    // independent, expensive async operations with no data dependency
    // until the very end (only writeDualClipboard actually needs the
    // resolved bytes). Accepting a promise here lets both run
    // concurrently instead of the caller having to await one before even
    // starting the other — awaiting a non-promise value is a no-op, so
    // this stays correct whether the caller already resolved it or not.
    const pngBlobInput = opts && opts.pngBlob ? opts.pngBlob : null;
    const resolvePngBlob = async () => {
      if (!pngBlobInput) return null;
      try {
        return await pngBlobInput;
      } catch (_) {
        return null;
      }
    };
    const plainText = (opts && opts.plainText) || String(name);
    const alreadyFrozen = Boolean(opts && opts.alreadyFrozen);
    const preferLive = !alreadyFrozen && el.isConnected;

    let prepared = null;
    try {
      let figmaHtml = "";
      let width = 0;
      let height = 0;

      if (preferLive) {
        try {
          const converted = await convertLiveToClipboardHtml(el, {
            name,
            width: opts && opts.width,
            height: opts && opts.height,
            fontAssets: opts && opts.fontAssets,
          });
          figmaHtml = typeof converted === "string" ? converted : converted.html;
          width =
            (converted && converted.width) ||
            measureBox(el, opts).width;
          height =
            (converted && converted.height) ||
            measureBox(el, opts).height;
        } catch (convErr) {
          const pngBlob = await resolvePngBlob();
          if (pngBlob) {
            const written = await writeDualClipboard({
              figmaHtml: "",
              pngBlob,
              plainText,
              label: name,
            });
            if (written.ok) {
              return {
                ok: true,
                mode: "image",
                fallback: true,
                error: String((convErr && convErr.message) || convErr),
              };
            }
          }
          return { ok: false, error: String((convErr && convErr.message) || convErr) };
        }
      } else {
        prepared = await prepareExactTarget(el, opts);
        width = prepared.width;
        height = prepared.height;
        try {
          figmaHtml = await convertElementToFigmaHtml(
            prepared.target,
            prepared.width,
            prepared.height,
            name,
            opts && opts.fontAssets
          );
        } catch (convErr) {
          const pngBlob = await resolvePngBlob();
          if (pngBlob) {
            const written = await writeDualClipboard({
              figmaHtml: "",
              pngBlob,
              plainText,
              label: name,
            });
            if (written.ok) {
              return {
                ok: true,
                mode: "image",
                fallback: true,
                error: String((convErr && convErr.message) || convErr),
                width,
                height,
              };
            }
          }
          return { ok: false, error: String((convErr && convErr.message) || convErr) };
        }
      }

      const written = await writeDualClipboard({
        figmaHtml,
        pngBlob: await resolvePngBlob(),
        plainText,
        label: name,
      });
      if (!written.ok) return written;
      return {
        ok: true,
        mode: written.mode,
        width,
        height,
        figmaClipboardHtml: figmaHtml,
      };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    } finally {
      if (prepared && prepared.cleanup) prepared.cleanup();
    }
  }

  async function copyOuterHtmlAsEditableFigma(outerHTML, opts) {
    if (!outerHTML || typeof document === "undefined") {
      return { ok: false, error: "No HTML to convert." };
    }
    const host = document.createElement("div");
    host.setAttribute("data-acopio", "figma-clipboard-host");
    const hostW = Math.max(1, round2((opts && opts.width) || 480));
    const hostH = Math.max(1, round2((opts && opts.height) || 320));
    Object.assign(host.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: `${hostW}px`,
      height: `${hostH}px`,
      margin: "0",
      padding: "0",
      border: "none",
      overflow: "visible",
      visibility: "hidden",
      pointerEvents: "none",
      zIndex: "-1",
    });
    try {
      host.innerHTML = outerHTML;
      document.documentElement.appendChild(host);
      const el = host.firstElementChild || host;
      if (opts && opts.width) {
        el.style.boxSizing = "border-box";
        el.style.width = `${round2(opts.width)}px`;
      }
      if (opts && opts.height) {
        el.style.boxSizing = "border-box";
        el.style.height = `${round2(opts.height)}px`;
      }
      el.style.margin = el.style.margin || "0";
      await waitForFonts();
      await waitForImages(el);
      await raf2();
      // Never skip fidelity prep on remount — re-freeze from computed styles
      // on the remounted tree (inline freeze from Collect + open-shadow spans).
      return await copyElementAsEditableFigma(el, {
        ...opts,
        alreadyFrozen: false,
        name: (opts && opts.name) || "Component",
      });
    } finally {
      try {
        host.remove();
      } catch (_) {}
    }
  }

  window.AcopioFigmaClipboard = {
    ensureLoaded,
    convertLiveToClipboardHtml,
    convertLiveToDocument,
    prepareFidelityClone,
    PASTE_SAFE_MARGIN_PX,
    copyBakedFigmaClipboard,
    copyElementAsEditableFigma,
    copyOuterHtmlAsEditableFigma,
    buildFigmaStyledHtml,
    writeDualClipboard,
  };

  if (window.Acopio) {
    window.Acopio.buildFigmaStyledHtml = buildFigmaStyledHtml;
  }
})();
