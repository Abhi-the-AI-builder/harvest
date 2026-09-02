// Copy helpers — image resolution per item type for clipboard export.
(function () {
  if (window.AcopioCopyHelpers) return;

  const H = window.AcopioExportHelpers;

  const NO_SCREENSHOT_MSG = "This component has no screenshot — hover and Collect again.";

  function itemHasImage(item) {
    const data = item.data || {};
    if (item.type === "color" || item.type === "font") return true;
    if (item.type === "image") return Boolean(data.inlineDataUrl || data.url);
    if (item.type === "component") {
      return Boolean(data.previewImage || data.inlineDataUrl || componentMediaUrlFromOuterHtml(data.outerHTML, item.sourceUrl));
    }
    if (item.type === "note") return Array.isArray(data.images) && data.images.length > 0;
    return false;
  }

  function componentMediaUrlFromOuterHtml(outerHTML, sourceUrl) {
    return H.componentMediaUrlFromOuterHtml(outerHTML, sourceUrl);
  }

  async function pushValidPngBlob(blobs, candidate) {
    const png = await H.ensureValidPngBlob(candidate);
    if (png && png.size) blobs.push(png);
  }

  async function resolveNoteImages(data, blobs) {
    for (const url of data.images.slice(0, 3)) {
      try {
        await pushValidPngBlob(blobs, await H.urlToPngBlob(url));
      } catch (_) {
        // skip this one image, keep going
      }
    }
  }

  async function resolveComponentImageBytes(item) {
    const data = item.data || {};
    let bytes = await H.resolveExportImageBytes(item);
    if (bytes && bytes.length) return bytes;

    if (data.previewImage) {
      const raw = H.base64DataUrlToBytes(data.previewImage);
      if (raw && raw.length) {
        bytes = await H.ensurePngBytes(raw, H.dataUrlMime(data.previewImage));
        if (!bytes) bytes = raw;
      }
    }
    if (!bytes && data.inlineDataUrl) {
      const raw = H.base64DataUrlToBytes(data.inlineDataUrl);
      if (raw && raw.length) {
        bytes = await H.ensurePngBytes(raw, H.dataUrlMime(data.inlineDataUrl));
        if (!bytes) bytes = raw;
      }
    }
    if (!bytes) {
      const mediaUrl = componentMediaUrlFromOuterHtml(data.outerHTML, item.sourceUrl);
      if (mediaUrl) {
        try {
          const blob = await H.urlToPngBlob(mediaUrl);
          if (blob) bytes = await H.blobToBytes(blob);
        } catch (_) {
          // fall through
        }
      }
    }
    return bytes;
  }

  async function resolveItemImages(item) {
    const data = item.data || {};
    const blobs = [];
    try {
      if (item.type === "note" && Array.isArray(data.images)) {
        await resolveNoteImages(data, blobs);
        return blobs;
      }
      if (item.type === "component") {
        const bytes = await resolveComponentImageBytes(item);
        if (bytes && bytes.length) {
          await pushValidPngBlob(blobs, new Blob([bytes], { type: H.mimeFromBytes(bytes) }));
          if (blobs.length) return blobs;
        }
      } else {
        const bytes = await H.resolveExportImageBytes(item);
        if (bytes && bytes.length) {
          await pushValidPngBlob(blobs, new Blob([bytes], { type: H.mimeFromBytes(bytes) }));
          if (blobs.length) return blobs;
        }
      }
      if (item.type === "color") {
        await pushValidPngBlob(blobs, await H.colorSwatchPngBlob(data));
      } else if (item.type === "font") {
        await pushValidPngBlob(blobs, await H.fontSamplePngBlob(data));
      } else if (item.type === "image" && (data.inlineDataUrl || data.url)) {
        await pushValidPngBlob(blobs, await H.urlToPngBlob(data.inlineDataUrl || data.url));
      }
    } catch (_) {
      // fall through to whatever was already collected
    }
    return blobs;
  }

  window.AcopioCopyHelpers = {
    itemHasImage,
    resolveItemImages,
    resolveNoteImages,
    resolveComponentImageBytes,
    componentMediaUrlFromOuterHtml,
    NO_SCREENSHOT_MSG,
  };
})();
