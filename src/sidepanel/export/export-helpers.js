// Shared export utilities — filenames, blobs, RTF fragments, raster helpers.
(function () {
  if (window.AcopioExportHelpers) return;

  const H = {};

  H.sanitizeFilename = function sanitizeFilename(name) {
    return String(name).replace(/[/\\:*?"<>|]+/g, "-").replace(/\.\./g, "-").replace(/\x00/g, "").trim().slice(0, 80) || "untitled";
  };

  H.escapeRtf = function escapeRtf(text) {
    return String(text)
      .replace(/\\/g, "\\\\")
      .replace(/{/g, "\\{")
      .replace(/}/g, "\\}")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n/g, "\\par\n")
      .replace(/[^\x00-\x7F]/g, (ch) => `\\u${ch.charCodeAt(0)}?`);
  };

  H.isPngBytes = function isPngBytes(bytes) {
    return bytes && bytes.length > 2 && bytes[0] === 0x89 && bytes[1] === 0x50;
  };

  H.isJpegBytes = function isJpegBytes(bytes) {
    return bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  };

  // Real magic-byte sniff (any 2xx response can still be a non-image
  // body) — defined once in shared.js since both the content script
  // (Collect-time inlining) and this sidepanel context (export) need it.
  H.isRecognizableImageBytes = Acopio.isRecognizableImageBytes;

  H.dataUrlMime = function dataUrlMime(dataUrl) {
    const match = /^data:([^;,]+)/.exec(String(dataUrl || ""));
    return match ? match[1] : "";
  };

  H.mimeFromBytes = function mimeFromBytes(bytes) {
    if (H.isPngBytes(bytes)) return "image/png";
    if (H.isJpegBytes(bytes)) return "image/jpeg";
    return "application/octet-stream";
  };

  // Normalize any raster to PNG for HTML/base64 companions.
  H.ensurePngBytes = async function ensurePngBytes(bytes, sourceMime) {
    if (!bytes || !bytes.length) return null;
    if (H.isPngBytes(bytes)) return bytes;
    try {
      const mime = sourceMime || H.mimeFromBytes(bytes);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      const pngBlob = await H.canvasToPngBlob(canvas);
      return pngBlob ? await H.blobToBytes(pngBlob) : null;
    } catch (_) {
      return null;
    }
  };

  H.pngDimensions = function pngDimensions(bytes) {
    if (!H.isPngBytes(bytes) || bytes.length < 24) return { width: 400, height: 300 };
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return { width: width || 400, height: height || 300 };
  };

  // TextEdit and WordPad render \\jpegblip more reliably than \\pngblip.
  // picw/pich (source pixels) + picwgoal/pichgoal (display twips) are required.
  H.bytesToRtfPicture = async function bytesToRtfPicture(bytes, maxDisplayPx = 480) {
    if (!bytes || !bytes.length) return "";
    try {
      const mime = H.mimeFromBytes(bytes);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
      const width = bitmap.width;
      const height = bitmap.height;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!jpegBlob) return "";
      const jpegBytes = await H.blobToBytes(jpegBlob);
      const scale = Math.min(1, maxDisplayPx / Math.max(width, 1));
      const displayW = Math.max(1, Math.round(width * scale));
      const displayH = Math.max(1, Math.round(height * scale));
      const picwgoal = displayW * 15;
      const pichgoal = displayH * 15;
      let hex = "";
      for (let i = 0; i < jpegBytes.length; i++) {
        hex += jpegBytes[i].toString(16).padStart(2, "0");
      }
      return `{\\pict\\jpegblip\\picw${width}\\pich${height}\\picwgoal${picwgoal}\\pichgoal${pichgoal}\n${hex}}`;
    } catch (_) {
      return "";
    }
  };

  H.bytesToDataUrl = function bytesToDataUrl(bytes, mime = "image/png") {
    if (!bytes || !bytes.length) return "";
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  };

  H.componentMediaUrlFromOuterHtml = function componentMediaUrlFromOuterHtml(outerHTML, sourceUrl) {
    if (!outerHTML) return null;
    try {
      const doc = new DOMParser().parseFromString(outerHTML, "text/html");
      const media = doc.querySelector("img, video");
      if (!media) return null;
      const lazyAttrs = ["src", "data-src", "data-lazy-src", "data-original", "data-lazy"];
      const firstAttr = (el) => {
        for (const attr of lazyAttrs) {
          const val = el.getAttribute(attr);
          if (val) return val;
        }
        return null;
      };
      const raw = media.tagName.toLowerCase() === "video"
        ? firstAttr(media) || (media.querySelector("source") && firstAttr(media.querySelector("source")))
        : firstAttr(media);
      if (!raw) return null;
      if (/^(data:|https?:)/i.test(raw)) return raw;
      if (!sourceUrl) return null;
      return new URL(raw, sourceUrl).href;
    } catch (_) {
      return null;
    }
  };

  // A raw CSS selector ("a.framer-9bdXY") makes an unreadable filename — it
  // identifies the DOM node, not what a design-handoff recipient would
  // recognize. Prefer real content: the component's own heading/alt text,
  // falling back to the selector only when nothing readable exists at all.
  H.componentLabelFromOuterHtml = function componentLabelFromOuterHtml(outerHTML) {
    if (!outerHTML) return "";
    try {
      const doc = new DOMParser().parseFromString(outerHTML, "text/html");
      const heading = doc.querySelector("h1, h2, h3, h4, h5, h6, [role=heading]");
      const headingText = heading && heading.textContent && heading.textContent.trim();
      if (headingText) return headingText.slice(0, 40);
      const media = doc.querySelector("img[alt], [aria-label]");
      const mediaLabel =
        media && (media.getAttribute("alt") || media.getAttribute("aria-label") || "").trim();
      if (mediaLabel) return mediaLabel.slice(0, 40);
      const anyText = doc.body && doc.body.textContent && doc.body.textContent.trim();
      if (anyText) return anyText.slice(0, 40);
    } catch (_) {
      // fall through
    }
    return "";
  };

  H.imageLabelFromItem = function imageLabelFromItem(item) {
    const data = (item && item.data) || {};
    const alt = data.alt && String(data.alt).trim();
    if (alt) return alt.slice(0, 40);
    const url = data.url && String(data.url);
    if (url && !url.startsWith("data:")) {
      try {
        const path = new URL(url).pathname;
        const base = path.split("/").filter(Boolean).pop() || "";
        const name = decodeURIComponent(base).replace(/\.[a-z0-9]+$/i, "");
        if (name && !/^[0-9a-f]{16,}$/i.test(name)) return name.slice(0, 40);
      } catch (_) {
        // fall through
      }
    }
    return "";
  };

  H.imageUrlFetchCandidates = function imageUrlFetchCandidates(url) {
    if (!url || String(url).startsWith("data:") || String(url).startsWith("blob:")) return [];
    const candidates = [];
    const add = (u) => {
      if (u && !candidates.includes(u)) candidates.push(u);
    };
    const upgrade = typeof Acopio !== "undefined" && Acopio.upgradeImageUrl ? Acopio.upgradeImageUrl(url) : url;
    add(upgrade);
    if (typeof Acopio !== "undefined" && Acopio.pinterestFallbackUrl) {
      add(Acopio.pinterestFallbackUrl(upgrade));
    }
    add(url);
    return candidates;
  };

  H.fetchImageViaBackground = async function fetchImageViaBackground(url) {
    if (!url || typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return null;
    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "FETCH_IMAGE_BYTES", payload: { url } }, resolve);
      });
      if (!resp || !resp.ok || !resp.bytes || !resp.bytes.length) return null;
      const bytes = new Uint8Array(resp.bytes);
      if (!H.isRecognizableImageBytes(bytes)) return null;
      const png = await H.ensurePngBytes(bytes, resp.contentType || H.mimeFromBytes(bytes));
      return png || bytes;
    } catch (_) {
      return null;
    }
  };

  H.fetchHttpImageBytes = async function fetchHttpImageBytes(url) {
    const candidates = H.imageUrlFetchCandidates(url);
    for (const tryUrl of candidates) {
      try {
        const resp = await fetch(tryUrl);
        // resp.ok only means "got an HTTP 2xx" — a cross-origin fetch
        // returning a login/error page (still 200) used to be accepted
        // here as if it were a real image, because `raw` (a Uint8Array)
        // is always truthy even when its bytes aren't an image at all.
        // That garbage then got written into the ZIP as "image-*.png",
        // which the catalog dutifully referenced — a broken-image icon in
        // the exported HTML, confirmed live. Only accept it once the
        // bytes are actually recognizable as some real image format.
        if (resp.ok) {
          const raw = await H.blobToBytes(await resp.blob());
          if (H.isRecognizableImageBytes(raw)) {
            const png = await H.ensurePngBytes(raw);
            return png || raw;
          }
        }
      } catch (_) {
        // try next candidate or background fetch
      }
      const bgBytes = await H.fetchImageViaBackground(tryUrl);
      if (bgBytes && bgBytes.length && H.isRecognizableImageBytes(bgBytes)) return bgBytes;
    }
    return null;
  };

  H.resolveExportImageBytes = async function resolveExportImageBytes(item) {
    const data = item.data || {};

    async function fromDataUrl(dataUrl) {
      if (!dataUrl) return null;
      if (String(dataUrl).startsWith("data:")) {
        const raw = H.base64DataUrlToBytes(dataUrl);
        if (raw) {
          const png = await H.ensurePngBytes(raw, H.dataUrlMime(dataUrl));
          return png || raw;
        }
      }
      try {
        const blob = await H.urlToPngBlob(dataUrl);
        return blob ? await H.blobToBytes(blob) : null;
      } catch (_) {
        return null;
      }
    }

    async function fromHttpUrl(url) {
      if (!url || String(url).startsWith("data:") || String(url).startsWith("blob:")) return null;
      return H.fetchHttpImageBytes(url);
    }

    if (item.type === "component" && data.previewImage) {
      const fromPreview = await fromDataUrl(data.previewImage);
      if (fromPreview) return fromPreview;
    }
    if (data.inlineDataUrl) {
      const fromInline = await fromDataUrl(data.inlineDataUrl);
      if (fromInline) return fromInline;
    }
    if (item.type === "image" && data.url) {
      const fromUrl = await fromHttpUrl(data.url);
      if (fromUrl) return fromUrl;
    }
    if (item.type === "component" && data.outerHTML) {
      const mediaUrl = H.componentMediaUrlFromOuterHtml(data.outerHTML, item.sourceUrl);
      if (mediaUrl) {
        const fromMedia = mediaUrl.startsWith("data:")
          ? await fromDataUrl(mediaUrl)
          : await fromHttpUrl(mediaUrl);
        if (fromMedia) return fromMedia;
      }
    }
    try {
      const blob = await H.resolveItemImageBlob(item);
      if (blob) {
        const raw = await H.blobToBytes(blob);
        const png = await H.ensurePngBytes(raw);
        return png || raw;
      }
    } catch (_) {
      // fall through
    }
    return null;
  };

  H.blobToBytes = async function blobToBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
  };

  H.base64DataUrlToBytes = function base64DataUrlToBytes(dataUrl) {
    if (!dataUrl) return null;
    const str = String(dataUrl);
    const comma = str.indexOf(",");
    const b64 = comma >= 0 ? str.slice(comma + 1) : str;
    if (!b64) return null;
    try {
      const bin = atob(b64.replace(/\s/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch (_) {
      return null;
    }
  };

  H.bytesToBase64 = function bytesToBase64(bytes) {
    if (!bytes || !bytes.length) return "";
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  };

  H.itemCopyLabel = function itemCopyLabel(item, index) {
    const n = index + 1;
    if (item.type === "component") return `Component ${n}`;
    if (item.type === "image") return `Image ${n}`;
    if (item.type === "color") return `Color ${n}`;
    if (item.type === "font") return `Font ${n}`;
    if (item.type === "note") return `Note ${n}`;
    if (item.type === "pairing") return `Font pairing ${n}`;
    return `Item ${n}`;
  };

  H.canvasToPngBlob = function canvasToPngBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  };

  // Clipboard and other PNG-only consumers reject JPEG/WebP bytes keyed as image/png.
  H.ensureValidPngBlob = async function ensureValidPngBlob(blob) {
    if (!blob || !blob.size) return null;
    try {
      const bytes = await H.blobToBytes(blob);
      if (H.isPngBytes(bytes)) {
        return new Blob([bytes], { type: "image/png" });
      }
      const png = await H.ensurePngBytes(bytes, blob.type || H.mimeFromBytes(bytes));
      if (png && H.isPngBytes(png)) {
        return new Blob([png], { type: "image/png" });
      }
      return null;
    } catch (_) {
      return null;
    }
  };

  // Stack multiple PNGs vertically for multi-select clipboard paste (Case C).
  H.compositePngBlob = async function compositePngBlob(blobs, opts = {}) {
    const gap = opts.gap ?? 8;
    const maxWidth = opts.maxWidth ?? 480;
    const maxHeight = opts.maxHeight ?? 0;
    if (!blobs || !blobs.length) return null;
    if (blobs.length === 1) return blobs[0];

    const opened = [];
    try {
      let scaled = [];
      let canvasWidth = 0;
      for (const blob of blobs) {
        const bitmap = await createImageBitmap(blob);
        opened.push(bitmap);
        const scale = Math.min(1, maxWidth / Math.max(bitmap.width, 1));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        canvasWidth = Math.max(canvasWidth, w);
        scaled.push({ bitmap, w, h });
      }
      let totalHeight = scaled.reduce((sum, s, i) => sum + s.h + (i > 0 ? gap : 0), 0);
      if (maxHeight > 0 && totalHeight > maxHeight) {
        const heightScale = maxHeight / totalHeight;
        scaled = scaled.map((s) => ({
          bitmap: s.bitmap,
          w: Math.max(1, Math.round(s.w * heightScale)),
          h: Math.max(1, Math.round(s.h * heightScale)),
        }));
        canvasWidth = Math.max(...scaled.map((s) => s.w));
        totalHeight = scaled.reduce((sum, s, i) => sum + s.h + (i > 0 ? gap : 0), 0);
      }
      const canvas = document.createElement("canvas");
      canvas.width = canvasWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      let y = 0;
      for (let i = 0; i < scaled.length; i++) {
        const { bitmap, w, h } = scaled[i];
        if (i > 0) y += gap;
        ctx.drawImage(bitmap, 0, y, w, h);
        y += h;
      }
      opened.forEach((bitmap) => {
        try {
          bitmap.close();
        } catch (_) {
          // ignore
        }
      });
      return H.canvasToPngBlob(canvas);
    } catch (_) {
      opened.forEach((bitmap) => {
        try {
          bitmap.close();
        } catch (_) {
          // ignore
        }
      });
      return blobs[0] || null;
    }
  };

  H.urlToPngBlob = async function urlToPngBlob(url) {
    if (url && String(url).startsWith("data:")) {
      const bytes = H.base64DataUrlToBytes(url);
      if (!bytes || !bytes.length) return null;
      const mime = H.dataUrlMime(url) || H.mimeFromBytes(bytes);
      const png = await H.ensurePngBytes(bytes, mime);
      if (png && H.isPngBytes(png)) return new Blob([png], { type: "image/png" });
      return H.ensureValidPngBlob(new Blob([bytes], { type: mime || "application/octet-stream" }));
    }
    let srcBlob = null;
    try {
      const bytes = await H.fetchHttpImageBytes(url);
      if (bytes && bytes.length) {
        srcBlob = new Blob([bytes], { type: H.mimeFromBytes(bytes) });
      }
    } catch (_) {
      // fall through
    }
    if (!srcBlob) return null;
    if (srcBlob.type === "image/png") {
      const validated = await H.ensureValidPngBlob(srcBlob);
      if (validated) return validated;
    }
    const bitmap = await createImageBitmap(srcBlob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();
    return H.canvasToPngBlob(canvas);
  };

  H.resolveExportImageBlob = async function resolveExportImageBlob(item) {
    const bytes = await H.resolveExportImageBytes(item);
    return bytes && bytes.length ? new Blob([bytes], { type: "image/png" }) : null;
  };

  H.colorSwatchPngBlob = function colorSwatchPngBlob(data) {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 200;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const css =
      data && data.isGradient && typeof data.gradientStops === "string" ? data.gradientStops : "";
    const stops =
      css && typeof Acopio.parseGradientStops === "function" ? Acopio.parseGradientStops(css) : [];
    if (stops.length >= 2) {
      const dir =
        typeof Acopio.parseGradientDirection === "function"
          ? Acopio.parseGradientDirection(css)
          : "right";
      let grad;
      if (dir === "down") grad = ctx.createLinearGradient(0, 0, 0, h);
      else if (dir === "up") grad = ctx.createLinearGradient(0, h, 0, 0);
      else if (dir === "left") grad = ctx.createLinearGradient(w, 0, 0, 0);
      else grad = ctx.createLinearGradient(0, 0, w, 0);
      stops.forEach((hex, i) => {
        grad.addColorStop(i / (stops.length - 1), hex);
      });
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = (data && data.hex) || "#cccccc";
    }
    ctx.fillRect(0, 0, w, h);
    return H.canvasToPngBlob(canvas);
  };

  H.colorSwatchSvgBlob = function colorSwatchSvgBlob(data) {
    const markup = Acopio.colorSwatchSvgMarkup(data);
    return new Blob([markup], { type: "image/svg+xml" });
  };

  H.colorsSwatchSvgBlob = function colorsSwatchSvgBlob(colorDatas) {
    const markup = Acopio.colorsSwatchSvgMarkup(colorDatas);
    return new Blob([markup], { type: "image/svg+xml" });
  };

  // Best-matching harvested face for a given weight/style — a captured
  // element can carry more than one (a bold run inside otherwise-regular
  // text), so this picks the one actually needed for THIS render.
  H.pickFontAsset = function pickFontAsset(fontAssets, wantWeight, wantStyle) {
    const list = Array.isArray(fontAssets) ? fontAssets : [];
    if (!list.length) return null;
    const wantW = parseInt(wantWeight, 10) || 400;
    const wantS = String(wantStyle || "normal").toLowerCase();
    let best = null;
    let bestScore = -Infinity;
    for (const asset of list) {
      if (!asset || !asset.dataUrl) continue;
      const aw = parseInt(asset.weight, 10) || 400;
      let score = -Math.abs(aw - wantW);
      if (String(asset.style || "normal").toLowerCase() === wantS) score += 1000;
      if (score > bestScore) {
        bestScore = score;
        best = asset;
      }
    }
    return best;
  };

  H.fontFormatFromMime = function fontFormatFromMime(mimeType) {
    const m = String(mimeType || "").toLowerCase();
    if (m.includes("woff2")) return "woff2";
    if (m.includes("woff")) return "woff";
    if (m.includes("truetype") || m.includes("ttf")) return "truetype";
    if (m.includes("opentype") || m.includes("otf")) return "opentype";
    return "woff2";
  };

  // Real @font-face rules for every harvested face — so a standalone HTML
  // export renders the font actually collected, not its name (a browser
  // with no idea what "Rebond Grotesque" is silently falls back to a
  // generic font otherwise). `safeFamily` is a per-item, collision-free
  // name (the real family name isn't unique enough across items/exports).
  H.fontFaceStyleBlock = function fontFaceStyleBlock(fontAssets, safeFamily) {
    const list = Array.isArray(fontAssets) ? fontAssets : [];
    const rules = list
      .filter((a) => a && a.dataUrl)
      .map(
        (a) =>
          `@font-face{font-family:'${safeFamily}';src:url(${a.dataUrl}) format('${H.fontFormatFromMime(a.mimeType)}');font-weight:${parseInt(a.weight, 10) || 400};font-style:${a.style || "normal"};font-display:swap;}`
      );
    return rules.length ? `<style>${rules.join("")}</style>` : "";
  };

  // Loads a harvested face into THIS document (the sidepanel's own page,
  // separate from the source page it was captured from) so canvas text
  // measurement/drawing — fontSamplePngBlob below — paints the real font
  // instead of silently falling back the same way a standalone HTML export
  // would without an embedded @font-face.
  H.loadFontAssetIntoDocument = async function loadFontAssetIntoDocument(
    fontAssets,
    wantWeight,
    wantStyle,
    targetFamily
  ) {
    const asset = H.pickFontAsset(fontAssets, wantWeight, wantStyle);
    if (!asset || !asset.dataUrl || typeof FontFace === "undefined") return false;
    try {
      const face = new FontFace(targetFamily, `url(${asset.dataUrl})`, {
        weight: String(parseInt(asset.weight, 10) || 400),
        style: asset.style || "normal",
      });
      await face.load();
      document.fonts.add(face);
      return true;
    } catch (_) {
      return false;
    }
  };

  H.fontSamplePngBlob = async function fontSamplePngBlob(data) {
    const sample = (data.sampleText || data.family || "Aa").trim() || "Aa";
    const size = Math.min(Math.max(data.sizePx || 32, 12), 72);
    const weight = data.weight || 400;
    let family = data.fallbackStack || "sans-serif";
    if (Array.isArray(data.fontAssets) && data.fontAssets.length) {
      const safeFamily = `acopio-embed-${(data.family || "font").replace(/[^a-z0-9]/gi, "").slice(0, 24) || "font"}`;
      const loaded = await H.loadFontAssetIntoDocument(data.fontAssets, weight, data.style, safeFamily);
      if (loaded) family = `'${safeFamily}', ${data.fallbackStack || "sans-serif"}`;
    }
    const fontCss = `${weight} ${size}px ${family}`;
    const metrics = Acopio.fontMetricsLine(data);
    const color = Acopio.fontColorHex(data);
    const metaFont = "500 12px Inter, Helvetica, Arial, sans-serif";
    const padX = 16;
    const maxW = 1600;
    const natural = Acopio.measureTextWidthPx(sample, fontCss);
    const contentW = Math.min(Math.max(natural, 448), maxW - padX * 2);
    const lines = Acopio.wrapTextToWidth(sample, contentW, fontCss);
    const lineH = Math.round(data.lineHeightPx || size * 1.25);
    let width = Math.ceil(
      Math.max(
        480,
        ...lines.map((l) => Acopio.measureTextWidthPx(l, fontCss)),
        metrics ? Acopio.measureTextWidthPx(metrics, metaFont) : 0,
        color ? Acopio.measureTextWidthPx(color, metaFont) + 20 : 0
      ) + padX * 2
    );
    width = Math.min(width, maxW);
    const metaBlock = (metrics ? 18 : 0) + (color ? 22 : 0);
    const height = Math.max(120, 24 + lines.length * lineH + 12 + metaBlock + 24);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = data.colorHex || "#17181A";
    ctx.font = fontCss;
    ctx.textBaseline = "top";
    lines.forEach((line, i) => {
      ctx.fillText(line, padX, 24 + i * lineH);
    });
    let y = 24 + lines.length * lineH + 12;
    ctx.font = metaFont;
    ctx.fillStyle = "#6B6E76";
    if (metrics) {
      ctx.fillText(metrics, padX, y);
      y += 18;
    }
    if (color) {
      ctx.fillStyle = color;
      ctx.fillRect(padX, y + 1, 12, 12);
      ctx.fillStyle = "#17181A";
      ctx.font = "650 12px Inter, Helvetica, Arial, sans-serif";
      ctx.fillText(color, padX + 20, y);
    }
    return H.canvasToPngBlob(canvas);
  };

  H.resolveItemImageBlob = async function resolveItemImageBlob(item) {
    const data = item.data || {};
    try {
      if (item.type === "color") return await H.colorSwatchPngBlob(data);
      if (item.type === "font") return await H.fontSamplePngBlob(data);
      if (item.type === "image" && (data.inlineDataUrl || data.url)) {
        return data.inlineDataUrl ? await H.urlToPngBlob(data.inlineDataUrl) : await H.urlToPngBlob(data.url);
      }
      if (item.type === "component" && data.previewImage) return await H.resolveExportImageBlob(item);
    } catch (_) {
      // fall through to null
    }
    return null;
  };

  H.blobToDataUrl = function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  H.svgMarkupToPngDataUrl = function svgMarkupToPngDataUrl(svgMarkup, resolvedColor, width, height) {
    return new Promise((resolve) => {
      try {
        const resolvedMarkup = resolvedColor ? svgMarkup.replace(/currentColor/g, resolvedColor) : svgMarkup;
        const scale = 2;
        const w = Math.max(1, Math.round((width || 24) * scale));
        const h = Math.max(1, Math.round((height || 24) * scale));
        const svgUrl = URL.createObjectURL(new Blob([resolvedMarkup], { type: "image/svg+xml" }));
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/png"));
          } catch (_) {
            resolve(undefined);
          } finally {
            URL.revokeObjectURL(svgUrl);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(svgUrl);
          resolve(undefined);
        };
        img.src = svgUrl;
      } catch (_) {
        resolve(undefined);
      }
    });
  };

  H.inlineImageUrl = async function inlineImageUrl(node) {
    if (!node || !node.url) return;
    if (node.inlineDataUrl) return;
    try {
      // data: URLs are already portable — keep them without a network fetch
      if (String(node.url).startsWith("data:")) {
        node.inlineDataUrl = node.url;
        return;
      }
      const resp = await fetch(node.url);
      if (resp.ok) {
        const contentType = resp.headers.get("content-type") || "";
        if (contentType.includes("svg") || /\.svg(\?|#|$)/i.test(node.url)) {
          const svgText = await resp.text();
          const dataUrl = await H.svgMarkupToPngDataUrl(svgText, null, node.width, node.height);
          if (dataUrl) node.inlineDataUrl = dataUrl;
          return;
        }
        const blob = await resp.blob();
        node.inlineDataUrl = await H.blobToDataUrl(blob);
        return;
      }
    } catch (_) {
      // try canvas decode below
    }
    // CORS-friendly CDN images: decode via <img crossOrigin> + canvas.
    try {
      const dataUrl = await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        const done = (v) => resolve(v);
        img.onload = () => {
          try {
            const c = document.createElement("canvas");
            const maxEdge = 1024;
            const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
            c.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
            c.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            done(c.toDataURL("image/png"));
          } catch (_) {
            done(null);
          }
        };
        img.onerror = () => done(null);
        img.src = node.url;
      });
      if (dataUrl) node.inlineDataUrl = dataUrl;
    } catch (_) {
      // plugin falls back to placeholder / Collect screenshot
    }
  };

  H.inlineTreeAssets = async function inlineTreeAssets(node) {
    if (!node || typeof node !== "object") return;
    if (node.kind === "image" && (node.url || node.inlineDataUrl)) {
      await H.inlineImageUrl(node);
    } else if (node.kind === "icon-placeholder" && node.svgMarkup) {
      if (!node.inlineDataUrl) {
        const dataUrl = await H.svgMarkupToPngDataUrl(node.svgMarkup, node.resolvedColor, node.width, node.height);
        if (dataUrl) node.inlineDataUrl = dataUrl;
      }
    }
    if (Array.isArray(node.children)) {
      await Promise.all(node.children.map(H.inlineTreeAssets));
    }
  };

  H.countTreeMediaHealth = function countTreeMediaHealth(node) {
    let needed = 0;
    let ready = 0;
    function walk(n) {
      if (!n || typeof n !== "object") return;
      if (n.kind === "image" || n.kind === "icon-placeholder") {
        needed += 1;
        if (n.inlineDataUrl) ready += 1;
      }
      if (Array.isArray(n.children)) n.children.forEach(walk);
    }
    walk(node);
    return { needed, ready };
  };

  window.AcopioExportHelpers = H;
})();
