// Clipboard copy — single tile, section copy-all, rich HTML payloads.
// Color → SVG swatch (no PNG). Font/pairing → styled text (no PNG).
// Component/image → PNG-only when screenshots exist (unchanged).
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
    const metrics = Acopio.fontMetricsLine(data);
    const color = Acopio.fontColorHex(data);
    if (metrics && color) return `${metrics}\n${color}`;
    return metrics || color || `${(data && data.family) || "?"}`;
  }

  function fontDataFromItem(item) {
    if (!item) return null;
    if (item.type === "font") return item.data || {};
    if (item.type === "pairing") {
      const d = item.data || {};
      return [
        {
          family: d.headingFamily,
          fallbackStack: d.headingFallbackStack || d.headingFamily,
          weight: d.headingWeight,
          sizePx: d.headingSizePx,
          lineHeightPx: d.headingLineHeightPx,
          letterSpacingPx: d.headingLetterSpacingPx,
          colorHex: d.headingColorHex,
          sampleText: d.headingSampleText || d.headingFamily || "Heading",
        },
        {
          family: d.bodyFamily,
          fallbackStack: d.bodyFallbackStack || d.bodyFamily,
          weight: d.bodyWeight,
          sizePx: d.bodySizePx,
          lineHeightPx: d.bodyLineHeightPx,
          letterSpacingPx: d.bodyLetterSpacingPx,
          colorHex: d.bodyColorHex,
          sampleText: d.bodySampleText || d.bodyFamily || "Body",
        },
      ];
    }
    return null;
  }

  function sortFontsHeadingFirst(items) {
    const fonts = items.filter((i) => i.type === "font");
    const rank = (item) => {
      if (item.family === "heading") return 0;
      if (item.family === "body") return 1;
      return 2;
    };
    return fonts.slice().sort((a, b) => rank(a) - rank(b) || String(a.capturedAt || "").localeCompare(String(b.capturedAt || "")));
  }

  function primaryPlainText(item) {
    const data = item.data || {};
    if (item.type === "color") return data.hex || "?";
    if (item.type === "font") return Acopio.fontSamplePlainText(data);
    if (item.type === "pairing") {
      const parts = fontDataFromItem(item);
      if (Array.isArray(parts)) {
        return parts.map((d) => Acopio.fontSamplePlainText(d)).join("\n\n");
      }
    }
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
      lines.push(Acopio.fontSamplePlainText(data));
    } else if (item.type === "pairing") {
      lines.push(primaryPlainText(item) || `Heading: ${data.headingFamily || "?"} · Body: ${data.bodyFamily || "?"}`);
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
    const onlyFonts = items.length > 0 && items.every((i) => i.type === "font");
    if (onlyFonts) {
      return sortFontsHeadingFirst(items)
        .map((item) => Acopio.fontSamplePlainText(item.data || {}))
        .join("\n\n");
    }
    return items.map((item, i) => describeItemForCopy(item, i)).join("\n\n---\n\n");
  }

  function htmlForItemBody(item, data) {
    const noteText = itemUserNote(item);
    if (item.type === "font") {
      let html = Acopio.fontStyledHtmlFragment(data);
      if (noteText) html += `<div style="margin-top:8px;color:#6B6E76;font-size:12px;">${Acopio.escapeHtml(noteText).replace(/\n/g, "<br>")}</div>`;
      return html;
    }
    if (item.type === "pairing") {
      const parts = fontDataFromItem(item);
      let html = Array.isArray(parts)
        ? Acopio.fontsStackedHtmlBody(parts)
        : `<div>${Acopio.escapeHtml(`Heading: ${data.headingFamily || "?"} · Body: ${data.bodyFamily || "?"}`)}</div>`;
      if (noteText) html += `<div style="margin-top:8px;color:#6B6E76;font-size:12px;">${Acopio.escapeHtml(noteText).replace(/\n/g, "<br>")}</div>`;
      return html;
    }
    if (noteText) {
      return `<div>${Acopio.escapeHtml(noteText).replace(/\n/g, "<br>")}</div>`;
    }
    if (item.type === "color") {
      return `<div>${Acopio.escapeHtml(data.hex || "?")}</div>`;
    }
    return "";
  }

  async function buildCopyHtml(items) {
    const MAX_TOTAL_IMAGES = 6;
    let remaining = MAX_TOTAL_IMAGES;
    const budgets = items.map((item) => {
      // Color/font paste as SVG/text — never embed raster previews.
      if (item.type === "color" || item.type === "font" || item.type === "pairing") return 0;
      if (!CH.itemHasImage(item) || remaining <= 0) return 0;
      const take = Math.min(remaining, item.type === "note" ? 3 : 1);
      remaining -= take;
      return take;
    });

    const onlyFonts = items.length > 0 && items.every((i) => i.type === "font");
    if (onlyFonts) {
      const ordered = sortFontsHeadingFirst(items);
      const doc = Acopio.fontsStackedHtmlDocument(ordered.map((i) => i.data || {}));
      return new Blob([doc], { type: "text/html" });
    }

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

        if (!visual && item.type !== "font" && item.type !== "pairing") {
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
    if (item.type === "font" || item.type === "pairing" || item.type === "color") return true;
    return CH.itemHasImage(item) || item.type === "note";
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

  async function buildColorClipboardPayload(items) {
    const colorDatas = items.map((i) => i.data || {});
    const hexLine = colorDatas.map((d) => d.hex || "?").join("\n");
    const svg = Acopio.colorsSwatchSvgMarkup(colorDatas);
    return {
      svg,
      humanPlain: hexLine,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${svg}</body></html>`,
    };
  }

  async function buildFontClipboardPayload(items) {
    const fontItems = items.filter((i) => i.type === "font" || i.type === "pairing");
    const orderedDatas = [];
    // Pairings first as heading→body blocks, then multi-select fonts
    // sorted heading-before-body.
    fontItems
      .filter((i) => i.type === "pairing")
      .forEach((item) => {
        const parts = fontDataFromItem(item);
        if (Array.isArray(parts)) orderedDatas.push(...parts);
      });
    sortFontsHeadingFirst(fontItems.filter((i) => i.type === "font")).forEach((i) => {
      orderedDatas.push(i.data || {});
    });
    const svg = Acopio.fontBoardSvgMarkup(orderedDatas);
    const plain = plainTextForClipboard(fontItems);
    const html = Acopio.fontsStackedHtmlDocument(orderedDatas);
    return { svg, humanPlain: plain, html };
  }

  async function writeImageOnlyClipboard(pngBlob) {
    const validated = await H.ensureValidPngBlob(pngBlob);
    if (!validated || validated.size < limits.minPngBytes) {
      return false;
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": validated })]);
    return true;
  }

  function allOfType(items, type) {
    return items.length > 0 && items.every((i) => i.type === type);
  }

  function allTypography(items) {
    return items.length > 0 && items.every((i) => i.type === "font" || i.type === "pairing");
  }

  async function writeClipboardWithFallback(items) {
    // Colors only → SVG as text/plain (Figma vector paste). No PNG.
    if (allOfType(items, "color")) {
      try {
        const payload = await buildColorClipboardPayload(items);
        const result = await Acopio.writeDesignClipboard(payload);
        return { mode: result.mode === "text-fallback" ? "text" : "swatch" };
      } catch (err) {
        throw new Error(`Couldn't copy to clipboard: ${String((err && err.message) || err)}`);
      }
    }

    // Fonts / pairings → SVG <text> board (Figma editable) + HTML fallback.
    if (allTypography(items)) {
      try {
        const payload = await buildFontClipboardPayload(items);
        await Acopio.writeDesignClipboard(payload);
        return { mode: "text" };
      } catch (err) {
        throw new Error(`Couldn't copy to clipboard: ${String((err && err.message) || err)}`);
      }
    }

    // Mixed colors + fonts → one SVG board (swatches + type), no PNG.
    const noVisual = !itemsNeedVisualPng(items);
    const onlyColorFont =
      noVisual &&
      items.every((i) => i.type === "color" || i.type === "font" || i.type === "pairing" || i.type === "note");
    if (onlyColorFont && items.some((i) => i.type === "color") && items.some((i) => i.type === "font" || i.type === "pairing")) {
      try {
        const colorDatas = items.filter((i) => i.type === "color").map((i) => i.data || {});
        const fontDatas = [];
        sortFontsHeadingFirst(items.filter((i) => i.type === "font")).forEach((i) => fontDatas.push(i.data || {}));
        items.filter((i) => i.type === "pairing").forEach((i) => {
          const parts = fontDataFromItem(i);
          if (Array.isArray(parts)) fontDatas.push(...parts);
        });
        const colorH = Math.max(160, colorDatas.length * 108);
        const colorSvg = Acopio.colorsSwatchSvgMarkup(colorDatas);
        const fontSvg = Acopio.fontBoardSvgMarkup(fontDatas);
        const colorInner = colorSvg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
        const fontInner = fontSvg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
        const fontW = Number((/width="(\d+(?:\.\d+)?)"/.exec(fontSvg) || [])[1]) || 480;
        const fontH = Number((/height="(\d+(?:\.\d+)?)"/.exec(fontSvg) || [])[1]) || 200;
        const colorW = Number((/width="(\d+(?:\.\d+)?)"/.exec(colorSvg) || [])[1]) || 240;
        const boardW = Math.ceil(Math.max(480, fontW, colorW));
        const boardH = Math.ceil(colorH + 16 + fontH);
        const combined =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${boardW}" height="${boardH}" viewBox="0 0 ${boardW} ${boardH}">` +
          `<rect width="${boardW}" height="${boardH}" fill="#FFFFFF"/>` +
          `<g>${colorInner}</g>` +
          `<g transform="translate(0 ${colorH + 16})">${fontInner}</g>` +
          `</svg>`;
        const htmlBlob = await buildCopyHtml(items);
        await Acopio.writeDesignClipboard({
          svg: combined,
          humanPlain: plainTextForClipboard(items),
          html: await htmlBlob.text(),
        });
        return { mode: "text" };
      } catch (err) {
        throw new Error(`Couldn't copy to clipboard: ${String((err && err.message) || err)}`);
      }
    }

    const { visualItems, pngBlobs } = await collectVisualPngBlobs(items);

    // Single component → dual clipboard. Prefer collect-time bake (live CSS),
    // then live re-bake from source tab, then styled remount, then PNG-only.
    if (
      items.length === 1 &&
      items[0].type === "component" &&
      window.AcopioFigmaClipboard &&
      items[0].data
    ) {
      const item = items[0];
      const pngBlob = pngBlobs[0] || (await buildVisualPngBlob([item]));
      const plain = H.itemCopyLabel(item, 0);
      const dualOpts = {
        name: item.selector || "Component",
        width: Math.round((item.data.boundingBoxWidth) || 480),
        height: Math.round((item.data.boundingBoxHeight) || 320),
        pngBlob: pngBlob || null,
        plainText: plain,
        fontAssets: item.data.fontFaces || [],
      };

      async function refreshItemData() {
        if (!item.id || !window.AcopioDB || typeof AcopioDB.getItem !== "function") return;
        try {
          const fresh = await AcopioDB.getItem(item.id);
          if (fresh && fresh.data) item.data = fresh.data;
        } catch (_) {}
      }

      async function waitForBake(maxMs) {
        const start = Date.now();
        while (Date.now() - start < maxMs) {
          await refreshItemData();
          if (item.data && item.data.figmaClipboardHtml) return item.data.figmaClipboardHtml;
          await new Promise((r) => setTimeout(r, 400));
        }
        return null;
      }

      async function bakeFromSourceTab() {
        if (!item.selector) return null;
        try {
          const tabs = await chrome.tabs.query({});
          const sourceHost = (() => {
            try {
              return item.sourceUrl ? new URL(item.sourceUrl).hostname : "";
            } catch (_) {
              return "";
            }
          })();
          const candidates = tabs.filter((t) => {
            if (t.id == null || !t.url) return false;
            try {
              const host = new URL(t.url).hostname;
              if (sourceHost && host === sourceHost) return true;
            } catch (_) {}
            return false;
          });
          const ordered = [
            ...candidates.filter((t) => t.active),
            ...candidates.filter((t) => !t.active),
          ];
          for (const tab of ordered.slice(0, 4)) {
            try {
              const resp = await chrome.tabs.sendMessage(tab.id, {
                type: "BAKE_FIGMA_CLIPBOARD",
                payload: {
                  itemId: item.id,
                  selector: item.selector,
                  name: dualOpts.name,
                  width: dualOpts.width,
                  height: dualOpts.height,
                  fontAssets: dualOpts.fontAssets,
                },
              });
              if (resp && resp.ok && resp.html) {
                item.data.figmaClipboardHtml = resp.html;
                if (resp.fontAssets && resp.fontAssets.length) {
                  item.data.fontFaces = resp.fontAssets;
                  dualOpts.fontAssets = resp.fontAssets;
                }
                return resp.html;
              }
            } catch (_) {}
          }
        } catch (_) {}
        return null;
      }

      await refreshItemData();
      if (!item.data.figmaClipboardHtml) {
        await waitForBake(2500);
      }
      if (!item.data.figmaClipboardHtml) {
        await bakeFromSourceTab();
      }

      if (item.data.figmaClipboardHtml) {
        const baked = await AcopioFigmaClipboard.copyBakedFigmaClipboard(
          item.data.figmaClipboardHtml,
          dualOpts
        );
        if (baked.ok) {
          if (baked.mode === "figma+image" || baked.mode === "figma") {
            return { mode: baked.mode === "figma+image" ? "figma+image" : "figma-layers" };
          }
          if (baked.mode === "image") {
            return {
              mode: "image",
              usedCount: 1,
              totalVisual: 1,
              fallback: true,
              reason: "Editable Figma layers unavailable — copied screenshot only",
            };
          }
        }
      }

      // Prefer styled freeze HTML over bare outerHTML (unstyled remount breaks fidelity).
      const remountHtml = item.data.figmaHtml || null;
      if (remountHtml) {
        const converted = await AcopioFigmaClipboard.copyOuterHtmlAsEditableFigma(remountHtml, dualOpts);
        if (converted.ok) {
          if (converted.mode === "figma+image" || converted.mode === "figma") {
            return { mode: converted.mode === "figma+image" ? "figma+image" : "figma-layers" };
          }
          if (converted.mode === "image") {
            return {
              mode: "image",
              usedCount: 1,
              totalVisual: 1,
              fallback: true,
              reason: "Editable Figma layers unavailable — copied screenshot only",
            };
          }
        }
      }
      // Fall through to PNG if conversion/write failed.
    }

    if (itemsNeedVisualPng(items)) {
      const visualTypeCount = items.filter(
        (item) => item.type === "component" || item.type === "image"
      ).length;
      const canCopyImage =
        pngBlobs.length > 0 &&
        pngBlobs.length >= visualTypeCount &&
        pngBlobs.length >= visualItems.length;
      if (canCopyImage) {
        const { blob: pngBlob, usedCount } = await compositeWithLimits(pngBlobs);
        if (pngBlob) {
          try {
            const wrote = await writeImageOnlyClipboard(pngBlob);
            if (wrote) {
              return { mode: "image", usedCount, totalVisual: visualItems.length };
            }
          } catch (err) {
            const msg = String((err && err.message) || err);
            if (!msg.includes("Couldn't copy") && !msg.includes("Document is not focused") && !msg.includes("NotAllowedError")) {
              // Unexpected clipboard failure — still try text fallback below.
            }
          }
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
      } else if (result.mode === "figma+image" || result.mode === "figma-layers") {
        showFeedback(
          result.mode === "figma+image"
            ? `Copied — refined Auto Layout for Figma; image for chat/notes.`
            : `Copied refined layers — paste in Figma (⌘V).`,
          "success"
        );
      } else if (result.mode === "swatch") {
        showFeedback(
          `Copied ${items.length} swatch${items.length === 1 ? "" : "es"} — paste into Figma as vector color.`,
          "success"
        );
      } else if (result.mode === "text-fallback") {
        showFeedback(
          `Copied ${items.length} item${items.length === 1 ? "" : "s"} as text — screenshot unavailable, so URL and metadata were included.`,
          "success"
        );
      } else if (allTypography(items)) {
        showFeedback(
          `Copied text — paste into Figma for editable typography.`,
          "success"
        );
      } else {
        showFeedback(`Copied ${items.length} item${items.length === 1 ? "" : "s"}.`, "success");
      }
    } catch (err) {
      if (!isExpectedCopyFailure(err)) {
        console.error("[Acopio] section copy failed:", err);
      }
      showFeedback(copyErrorMessage(err), "error");
    } finally {
      btn.disabled = false;
    }
  }

  function isExpectedCopyFailure(err) {
    const msg = String((err && err.message) || err || "");
    return (
      msg.includes("no screenshot") ||
      msg.includes("Couldn't copy") ||
      msg.includes("Document is not focused") ||
      msg.includes("NotAllowedError")
    );
  }

  async function copySingleItem(item, btn, deps) {
    const showToast = deps.showToast;
    try {
      const result = await writeClipboardWithFallback([item]);
      if (btn) {
        const original = btn.innerHTML;
        btn.innerHTML = Acopio.ICONS.check;
        setTimeout(() => { btn.innerHTML = original; }, 1200);
      }
      if (!showToast) return;
      if (result && (result.mode === "figma+image" || result.mode === "figma-layers")) {
        showToast(
          result.mode === "figma+image"
            ? "Copied — refined Auto Layout for Figma; image for chat/notes"
            : "Copied refined layers — paste in Figma (⌘V)",
          null
        );
      } else if (result && result.mode === "image" && result.fallback) {
        showToast(
          result.reason ||
            "Copied screenshot — editable Figma paste unavailable for this component",
          null
        );
      } else if (result && result.mode === "text-fallback") {
        showToast("Copied as text — no screenshot on this item.", null);
      } else if (result && result.mode === "swatch") {
        showToast("Copied swatch", null);
      } else if (item.type === "font" || item.type === "pairing") {
        showToast("Copied text", null);
      }
    } catch (err) {
      // Missing screenshots and focus/permission clipboard denials are
      // user-facing toasts, not bugs — don't console.error (that surfaces
      // in Cursor/DevTools as an "Acopio crashed" report).
      if (!isExpectedCopyFailure(err)) {
        console.error("[Acopio] item copy failed:", err);
      }
      if (showToast) showToast(copyErrorMessage(err), null);
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
