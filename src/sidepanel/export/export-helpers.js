// Shared export utilities — filenames, blobs, RTF fragments, raster helpers.
(function () {
  if (window.HarvestExportHelpers) return;

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

    if (item.type === "component" && data.previewImage) {
      const fromPreview = await fromDataUrl(data.previewImage);
      if (fromPreview) return fromPreview;
    }
    if (data.inlineDataUrl) {
      const fromInline = await fromDataUrl(data.inlineDataUrl);
      if (fromInline) return fromInline;
    }
    if (item.type === "image" && data.url) {
      try {
        const resp = await fetch(data.url);
        if (resp.ok) {
          const raw = await H.blobToBytes(await resp.blob());
          const png = await H.ensurePngBytes(raw);
          return png || raw;
        }
      } catch (_) {
        // fall through
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
    const res = await fetch(url);
    const srcBlob = await res.blob();
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
    ctx.fillStyle = data.hex || "#cccccc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return H.canvasToPngBlob(canvas);
  };

  H.fontSamplePngBlob = function fontSamplePngBlob(data) {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#17181A";
    const size = Math.min(data.sizePx || 32, 72);
    ctx.font = `${data.weight || 400} ${size}px ${data.fallbackStack || "sans-serif"}`;
    ctx.textBaseline = "middle";
    ctx.fillText((data.sampleText || data.family || "Aa").slice(0, 24) || "Aa", 16, canvas.height / 2);
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
    if (!node.url) return;
    try {
      const resp = await fetch(node.url);
      if (!resp.ok) return;
      const contentType = resp.headers.get("content-type") || "";
      if (contentType.includes("svg") || /\.svg(\?|#|$)/i.test(node.url)) {
        const svgText = await resp.text();
        const dataUrl = await H.svgMarkupToPngDataUrl(svgText, null, node.width, node.height);
        if (dataUrl) node.inlineDataUrl = dataUrl;
        return;
      }
      const blob = await resp.blob();
      node.inlineDataUrl = await H.blobToDataUrl(blob);
    } catch (_) {
      // fall through — plugin falls back to a placeholder for this leaf
    }
  };

  H.inlineTreeAssets = async function inlineTreeAssets(node) {
    if (!node || typeof node !== "object") return;
    if (node.kind === "image" && node.url) {
      await H.inlineImageUrl(node);
    } else if (node.kind === "icon-placeholder" && node.svgMarkup) {
      const dataUrl = await H.svgMarkupToPngDataUrl(node.svgMarkup, node.resolvedColor, node.width, node.height);
      if (dataUrl) node.inlineDataUrl = dataUrl;
    }
    if (Array.isArray(node.children)) {
      await Promise.all(node.children.map(H.inlineTreeAssets));
    }
  };

  window.HarvestExportHelpers = H;
})();
