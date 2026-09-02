// Clipboard copy — single tile, section copy-all, rich HTML payloads.
(function () {
  if (window.AcopioClipboardCopy) return;

  const H = window.AcopioExportHelpers;
  const CH = window.AcopioCopyHelpers;

  const limits = {
    minPngBytes: 200,
    maxCompositeItems: 24,
    maxCompositeHeight: 14000,
  };
  const NO_SCREENSHOT_MSG = CH.NO_SCREENSHOT_MSG;

  function itemUserNote(item) {
    if (item.type === "note") return String((item.data && item.data.text) || item.note || "").trim();
    return item.note && String(item.note).trim() ? String(item.note).trim() : "";
  }

  function isVisualRasterItem(item) {
    return (item.type === "component" || item.type === "image") && CH.itemHasImage(item);
  }

  function itemsNeedVisualPng(items) {
    return items.some((item) => item.type === "component" || item.type === "image");
  }

  function describeVisualFallback(item, index = 0) {
    const data = item.data || {};
    const label = H.itemCopyLabel(item, index);
    const note = itemUserNote(item);
    const lines = [label];
    if (item.type === "image" && data.url) lines.push(data.url);
    if (item.sourceUrl) lines.push(`Source: ${item.sourceUrl}`);
    if (item.selector) lines.push(`Selector: ${item.selector}`);
    if (note) lines.push(note);
    return lines.join("\n\n");
  }

  function fontCopyString(data) {
    let s = `${data.family || "?"}, ${data.weight || "?"}`;
    if (data.sizePx) s += `, ${data.sizePx}px`;
    if (data.lineHeightPx) s += ` / ${data.lineHeightPx}px line-height`;
    return s;
  }

  function primaryPlainText(item) {
    const data = item.data || {};
    if (item.type === "color") return data.hex || "?";
    if (item.type === "font") return fontCopyString(data);
    return null;
  }

  function describeItemForCopy(item, index = 0) {
    const data = item.data || {};
    const label = H.itemCopyLabel(item, index);
    const note = itemUserNote(item);

    if (item.type === "note") {
      const lines = [label];
      if (data.text) lines.push(String(data.text));
      if (item.note && String(item.note).trim()) lines.push(String(item.note).trim());
      return lines.join("\n\n");
    }

    // Component/image with PNG: label + note only — no dimensions or metadata.
    if (isVisualRasterItem(item)) {
      return note ? `${label}\n\n${note}` : label;
    }

    if (item.type === "component" || item.type === "image") {
      return describeVisualFallback(item, index);
    }

    const lines = [label];
    if (item.type === "color") {
      lines.push(data.hex || "?");
    } else if (item.type === "font") {
      lines.push(fontCopyString(data));
    } else if (item.type === "pairing") {
      lines.push(`Heading: ${data.headingFamily || "?"} · Body: ${data.bodyFamily || "?"}`);
    }
    if (note) lines.push(note);
    return lines.join("\n\n");
  }

  function plainTextForClipboard(items) {
    if (items.length === 1) {
      const item = items[0];
      const primary = primaryPlainText(item);
      const note = itemUserNote(item);
      if (primary) return note ? `${primary}\n\n${note}` : primary;
    }
    return items.map((item, i) => describeItemForCopy(item, i)).join("\n\n---\n\n");
  }

  function htmlForItemBody(item, data) {
    const noteText = itemUserNote(item);
    if (noteText) {
      return `<div>${Acopio.escapeHtml(noteText).replace(/\n/g, "<br>")}</div>`;
    }
    if (item.type === "color") {
      return `<div>${Acopio.escapeHtml(data.hex || "?")}</div>`;
    }
    if (item.type === "font") {
      return `<div>${Acopio.escapeHtml(fontCopyString(data))}</div>`;
    }
    if (item.type === "pairing") {
      return `<div>${Acopio.escapeHtml(`Heading: ${data.headingFamily || "?"} · Body: ${data.bodyFamily || "?"}`)}</div>`;
    }
    return "";
  }

  async function buildCopyHtml(items) {
    const MAX_TOTAL_IMAGES = 6;
    let remaining = MAX_TOTAL_IMAGES;
    const budgets = items.map((item) => {
      if (!CH.itemHasImage(item) || remaining <= 0) return 0;
      const take = Math.min(remaining, item.type === "note" ? 3 : 1);
      remaining -= take;
      return take;
    });
    const parts = await Promise.all(
      items.map(async (item, i) => {
        const data = item.data || {};
        const visual = isVisualRasterItem(item);
        let html = `<div style="margin-bottom:16px;">`;

        if (budgets[i] > 0) {
          try {
            const blobs = (await CH.resolveItemImages(item)).slice(0, budgets[i]);
            for (const blob of blobs) {
              if (!blob || !blob.size) continue;
              try {
                const dataUrl = await H.blobToDataUrl(blob);
                if (dataUrl) {
                  html += `<img src="${dataUrl}" style="max-width:480px;display:block;margin-bottom:8px;" />`;
                }
              } catch (_) {
                // skip this one image, keep going
              }
            }
          } catch (_) {
            // resolveItemImages itself failed for this item
          }
        }

        if (!visual) {
          html += `<div style="font-weight:600;margin-bottom:8px;">${Acopio.escapeHtml(H.itemCopyLabel(item, i))}</div>`;
        }
        html += htmlForItemBody(item, data);
        html += `</div>`;
        return html;
      })
    );
    const body = parts.join("");
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
    return new Blob([doc], { type: "text/html" });
  }

  function shouldIncludeCopyHtml(items) {
    if (items.length > 1) return true;
    const item = items[0];
    if (isVisualRasterItem(item)) return Boolean(itemUserNote(item));
    return CH.itemHasImage(item) || item.type === "note" || item.type === "pairing";
  }

  async function collectVisualPngBlobs(items) {
    const visualItems = items.filter(isVisualRasterItem);
    const pngBlobs = [];
    for (const item of visualItems) {
      const itemBlobs = await CH.resolveItemImages(item);
      const first = itemBlobs.find((b) => b && b.size > 0);
      if (first) pngBlobs.push(first);
    }
    return { visualItems, pngBlobs };
  }

  async function compositeWithLimits(blobs) {
    if (!blobs.length) return { blob: null, usedCount: 0 };
    if (blobs.length === 1) return { blob: blobs[0], usedCount: 1 };

    let batch = blobs.slice(0, limits.maxCompositeItems);
    while (batch.length > 0) {
      const composite = await H.compositePngBlob(batch, { gap: 8, maxWidth: 480, maxHeight: limits.maxCompositeHeight });
      if (composite && composite.size >= limits.minPngBytes) {
        return { blob: composite, usedCount: batch.length };
      }
      if (batch.length === 1) return { blob: batch[0], usedCount: 1 };
      batch = batch.slice(0, Math.max(1, Math.floor(batch.length / 2)));
    }
    return { blob: blobs[0] || null, usedCount: blobs[0] ? 1 : 0 };
  }

  async function buildVisualPngBlob(items) {
    const { pngBlobs } = await collectVisualPngBlobs(items);
    if (!pngBlobs.length) return null;
    return (await compositeWithLimits(pngBlobs)).blob;
  }

  async function buildRichClipboardItem(items, opts = {}) {
    const textContent = opts.visualFallback
      ? items.map((item, i) => describeVisualFallback(item, i)).join("\n\n---\n\n")
      : plainTextForClipboard(items);
    const clipboardTypes = {
      "text/plain": new Blob([textContent], { type: "text/plain" }),
    };
    if (shouldIncludeCopyHtml(items)) {
      clipboardTypes["text/html"] = await buildCopyHtml(items);
    }
    return new ClipboardItem(clipboardTypes);
  }

  async function buildColorFontClipboardItem(item) {
    const textContent = plainTextForClipboard([item]);
    const clipboardTypes = {
      "text/plain": new Blob([textContent], { type: "text/plain" }),
    };
    if (shouldIncludeCopyHtml([item])) {
      clipboardTypes["text/html"] = await buildCopyHtml([item]);
    }
    const swatchBlobs = await CH.resolveItemImages(item);
    const swatch = swatchBlobs.find((b) => b && b.size > 0);
    if (swatch) {
      const validated = await H.ensureValidPngBlob(swatch);
      if (validated && validated.size >= limits.minPngBytes) {
        clipboardTypes["image/png"] = validated;
      }
    }
    return new ClipboardItem(clipboardTypes);
  }

  async function writeImageOnlyClipboard(pngBlob) {
    const validated = await H.ensureValidPngBlob(pngBlob);
    if (!validated || validated.size < limits.minPngBytes) {
      throw new Error(NO_SCREENSHOT_MSG);
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": validated })]);
    return validated;
  }

  async function writeClipboardWithFallback(items) {
    if (items.length === 1 && (items[0].type === "color" || items[0].type === "font")) {
      const clipboardItem = await buildColorFontClipboardItem(items[0]);
      try {
        await navigator.clipboard.write([clipboardItem]);
        return { mode: clipboardItem.types.includes("image/png") ? "dual" : "text" };
      } catch (err) {
        throw new Error(`Couldn't copy to clipboard: ${String((err && err.message) || err)}`);
      }
    }

    const { visualItems, pngBlobs } = await collectVisualPngBlobs(items);

    if (itemsNeedVisualPng(items)) {
      const canCopyImage = pngBlobs.length > 0 && pngBlobs.length >= visualItems.length;
      if (canCopyImage) {
        const { blob: pngBlob, usedCount } = await compositeWithLimits(pngBlobs);
        try {
          await writeImageOnlyClipboard(pngBlob);
          return { mode: "image", usedCount, totalVisual: visualItems.length };
        } catch (err) {
          const msg = String((err && err.message) || err);
          if (!msg.includes("no screenshot") && !msg.includes("Couldn't copy")) {
            throw new Error(`Couldn't copy to clipboard: ${msg}`);
          }
          // fall through to rich-text fallback
        }
      }
      const clipboardItem = await buildRichClipboardItem(items, { visualFallback: true });
      try {
        await navigator.clipboard.write([clipboardItem]);
        return { mode: "text-fallback" };
      } catch (err) {
        throw new Error(`Couldn't copy to clipboard: ${String((err && err.message) || err)}`);
      }
    }

    const clipboardItem = await buildRichClipboardItem(items);
    try {
      await navigator.clipboard.write([clipboardItem]);
      return { mode: "text" };
    } catch (err) {
      throw new Error(`Couldn't copy to clipboard: ${String((err && err.message) || err)}`);
    }
  }

  function copyErrorMessage(err) {
    const msg = String((err && err.message) || err || "");
    if (msg.includes("no screenshot")) return NO_SCREENSHOT_MSG;
    if (msg.startsWith("Couldn't copy")) return msg;
    return `Couldn't copy — ${msg || "try again."}`;
  }

  async function copyAllInSection(items, btn, deps) {
    const showFeedback = deps.showFeedback;
    if (items.length === 0) {
      showFeedback("Nothing to copy in this section.", "error");
      return;
    }
    const original = btn.innerHTML;
    btn.disabled = true;
    try {
      const result = await writeClipboardWithFallback(items);
      btn.innerHTML = Acopio.ICONS.check;
      setTimeout(() => {
        btn.innerHTML = original;
      }, 1200);
      if (result.mode === "image") {
        const capped = result.usedCount < result.totalVisual;
        const countNote = capped
          ? ` (${result.usedCount} of ${result.totalVisual} fit in one image)`
          : "";
        showFeedback(
          `Copied ${items.length} screenshot${items.length === 1 ? "" : "s"}${countNote} — paste into Slack, Figma, or any image field.`,
          "success"
        );
      } else if (result.mode === "text-fallback") {
        showFeedback(
          `Copied ${items.length} item${items.length === 1 ? "" : "s"} as text — screenshot unavailable, so URL and metadata were included.`,
          "success"
        );
      } else {
        showFeedback(`Copied ${items.length} item${items.length === 1 ? "" : "s"}.`, "success");
      }
    } catch (err) {
      console.error("[Acopio] section copy failed:", err);
      showFeedback(copyErrorMessage(err), "error");
    } finally {
      btn.disabled = false;
    }
  }

  async function copySingleItem(item, btn, deps) {
    const showToast = deps.showToast;
    try {
      await writeClipboardWithFallback([item]);
      if (btn) {
        const original = btn.innerHTML;
        btn.innerHTML = Acopio.ICONS.check;
        setTimeout(() => { btn.innerHTML = original; }, 1200);
      }
    } catch (err) {
      console.error("[Acopio] item copy failed:", err);
      showToast(copyErrorMessage(err), null);
    }
  }

  window.AcopioClipboardCopy = {
    describeItemForCopy,
    plainTextForClipboard,
    fontCopyString,
    buildCopyHtml,
    buildRichClipboardItem,
    buildVisualPngBlob,
    writeClipboardWithFallback,
    copyAllInSection,
    copySingleItem,
    isVisualRasterItem,
    itemUserNote,
    NO_SCREENSHOT_MSG,
    limits,
  };
})();
