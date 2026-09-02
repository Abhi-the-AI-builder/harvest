// Clipboard copy — single tile, section copy-all, rich HTML payloads.
(function () {
  if (window.HarvestClipboardCopy) return;

  const H = window.HarvestExportHelpers;
  const CH = window.HarvestCopyHelpers;

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

    // Component/image: label only, or label + note — no dimensions or metadata.
    if (isVisualRasterItem(item)) {
      return note ? `${label}\n\n${note}` : label;
    }

    const lines = [label];
    if (item.type === "color") {
      lines.push(data.hex || "?");
    } else if (item.type === "font") {
      lines.push(`${data.family || "?"}, ${data.weight || "?"}`);
    } else if (item.type === "pairing") {
      lines.push(`Heading: ${data.headingFamily || "?"} · Body: ${data.bodyFamily || "?"}`);
    }
    if (note) lines.push(note);
    return lines.join("\n\n");
  }

  function htmlForItemBody(item, data) {
    const noteText = itemUserNote(item);
    if (noteText) {
      return `<div>${Harvest.escapeHtml(noteText).replace(/\n/g, "<br>")}</div>`;
    }
    if (item.type === "color") {
      return `<div>${Harvest.escapeHtml(data.hex || "?")}</div>`;
    }
    if (item.type === "font") {
      return `<div>${Harvest.escapeHtml(`${data.family || "?"}, ${data.weight || "?"}`)}</div>`;
    }
    if (item.type === "pairing") {
      return `<div>${Harvest.escapeHtml(`Heading: ${data.headingFamily || "?"} · Body: ${data.bodyFamily || "?"}`)}</div>`;
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
          html += `<div style="font-weight:600;margin-bottom:8px;">${Harvest.escapeHtml(H.itemCopyLabel(item, i))}</div>`;
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

  function assertVisualCopyReady(items, pngBlobs, visualItems) {
    if (!itemsNeedVisualPng(items)) return;

    const missing = items.filter((item) => {
      if (item.type !== "component" && item.type !== "image") return false;
      return !CH.itemHasImage(item);
    });
    if (missing.length) throw new Error(NO_SCREENSHOT_MSG);

    if (!pngBlobs.length || pngBlobs.length < visualItems.length) {
      throw new Error(NO_SCREENSHOT_MSG);
    }
  }

  async function buildRichClipboardItem(items) {
    const textContent = items.map((item, i) => describeItemForCopy(item, i)).join("\n\n---\n\n");
    const clipboardTypes = {
      "text/plain": new Blob([textContent], { type: "text/plain" }),
    };
    if (shouldIncludeCopyHtml(items)) {
      clipboardTypes["text/html"] = await buildCopyHtml(items);
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
    const { visualItems, pngBlobs } = await collectVisualPngBlobs(items);

    if (itemsNeedVisualPng(items)) {
      assertVisualCopyReady(items, pngBlobs, visualItems);
      const { blob: pngBlob, usedCount } = await compositeWithLimits(pngBlobs);
      try {
        await writeImageOnlyClipboard(pngBlob);
        return { mode: "image", usedCount, totalVisual: visualItems.length };
      } catch (err) {
        const msg = String((err && err.message) || err);
        if (msg.includes("no screenshot")) throw err;
        throw new Error(`Couldn't copy to clipboard: ${msg}`);
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
      btn.innerHTML = Harvest.ICONS.check;
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
      } else {
        showFeedback(`Copied ${items.length} item${items.length === 1 ? "" : "s"}.`, "success");
      }
    } catch (err) {
      console.error("[Harvest] section copy failed:", err);
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
        btn.innerHTML = Harvest.ICONS.check;
        setTimeout(() => { btn.innerHTML = original; }, 1200);
      }
    } catch (err) {
      console.error("[Harvest] item copy failed:", err);
      showToast(copyErrorMessage(err), null);
    }
  }

  window.HarvestClipboardCopy = {
    describeItemForCopy,
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
