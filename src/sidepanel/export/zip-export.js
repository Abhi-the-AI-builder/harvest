// ZIP export — one handler per item type; RTF for noted visuals.
(function () {
  if (window.AcopioZipExport) return;

  const H = window.AcopioExportHelpers;

  async function buildNotedVisualsRtf(entries) {
    let rtf = "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fnil Helvetica;}}\\f0\\fs22\n";
    rtf += "\\b ACOPIO - Captures with notes\\b0\\par\n";
    rtf += `${entries.length} item${entries.length === 1 ? "" : "s"}\\par\\par\n`;
    rtf += "Each capture is shown as an image, followed by your note.\\par\\par\n";
    rtf += "Tip: open collection-report.html in your browser for images with notes (recommended).\\par\\par\n";
    rtf += "\\line\\par\\par\n";

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const num = String(index + 1).padStart(2, "0");
      const typeLabel = entry.type === "image" ? "IMAGE" : "COMPONENT";
      rtf += `\\b ${num}  ${typeLabel}\\b0\\par\\par\n`;

      if (entry.imageBytes && entry.imageBytes.length) {
        const pict = await H.bytesToRtfPicture(entry.imageBytes);
        if (pict) {
          rtf += `${pict}\\par\\par\n`;
        } else if (entry.imageFile) {
          rtf += `\\i Open ${H.escapeRtf(entry.imageFile)} in this folder, or collection-report.html in a browser.\\i0\\par\\par\n`;
        }
      } else if (entry.imageFile) {
        rtf += `\\i Open ${H.escapeRtf(entry.imageFile)} in this folder, or collection-report.html in a browser.\\i0\\par\\par\n`;
      }

      rtf += "\\b YOUR NOTE\\b0\\par\n";
      rtf += `${H.escapeRtf(entry.note)}\\par\\par\n`;
      rtf += "\\line\\par\\par\n";
    }

    rtf += `\\par\\fs18 ${H.escapeRtf(new Date().toLocaleString())} - Acopio — Gather. Connect. Simplify\\par\n`;
    rtf += "}";
    return rtf;
  }

  const REPORT_STYLES = [
    "body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#fafafa;color:#17181a;line-height:1.5;margin:0}",
    ".wrap{max-width:720px;margin:32px auto;padding:0 16px 48px}",
    "h1{font-size:20px;font-weight:600;margin:0 0 8px}",
    ".intro{color:#6b6e76;font-size:14px;margin:0 0 32px}",
    ".entry{background:#fff;border:1px solid rgba(23,24,26,0.09);border-radius:8px;padding:24px;margin-bottom:24px;box-shadow:0 1px 2px rgba(23,24,26,0.06)}",
    ".entry-head{display:flex;align-items:center;gap:8px;margin-bottom:16px}",
    ".type-pill{font-size:12px;font-weight:600;padding:4px 8px;border-radius:4px}",
    ".type-image{background:#dff3ec;color:#1e8f72}",
    ".type-component{background:#fbf0dc;color:#b07d1f}",
    ".entry-num{font-size:12px;color:#6b6e76;font-weight:600}",
    ".entry img{max-width:100%;height:auto;display:block;border-radius:8px;border:1px solid rgba(23,24,26,0.09);margin-bottom:16px}",
    ".meta{font-size:12px;color:#6b6e76;margin-bottom:16px}",
    ".meta a{color:#1d3461}",
    ".note-label{font-size:12px;font-weight:600;color:#6b6e76;margin:0 0 8px}",
    ".note{font-size:16px;line-height:1.55}",
    ".footer{margin-top:32px;font-size:12px;color:#6b6e76}",
    "@media print{body{background:#fff}.entry{box-shadow:none;break-inside:avoid}}",
  ].join("");

  function entryTypeLabel(entry) {
    return entry.type === "image" ? "Image" : "Component";
  }

  function entryTypeClass(entry) {
    return entry.type === "image" ? "type-image" : "type-component";
  }

  function entryImageSrc(entry, embedImages = true) {
    if (embedImages && entry.imageBytes && entry.imageBytes.length) {
      const dataUrl = H.bytesToDataUrl(entry.imageBytes, "image/png");
      if (dataUrl) return dataUrl;
    }
    if (entry.imageFile) return entry.imageFile;
    if (!embedImages && entry.imageBytes && entry.imageBytes.length) {
      const dataUrl = H.bytesToDataUrl(entry.imageBytes, "image/png");
      if (dataUrl) return dataUrl;
    }
    return "";
  }

  function buildCollectionReportHtml(entries, opts = {}) {
    const embedImages = opts.embedImages !== false;
    const esc = (s) => Acopio.escapeHtml(String(s)).replace(/\n/g, "<br>");
    const parts = [
      "<!DOCTYPE html>",
      "<html lang=\"en\"><head><meta charset=\"utf-8\">",
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
      "<title>Acopio — Collection report</title>",
      "<style>", REPORT_STYLES, "</style></head><body>",
      "<div class=\"wrap\">",
      "<h1>Acopio — Collection report</h1>",
      `<p class="intro">${entries.length} capture${entries.length === 1 ? "" : "s"} with notes — image, then your note. Print this page or save as PDF from your browser.</p>`,
    ];

    entries.forEach((entry, index) => {
      const num = String(index + 1).padStart(2, "0");
      const typeLabel = entryTypeLabel(entry);
      const imgSrc = entryImageSrc(entry, embedImages);
      parts.push("<section class=\"entry\">");
      parts.push("<div class=\"entry-head\">");
      parts.push(`<span class="entry-num">${num}</span>`);
      parts.push(`<span class="type-pill ${entryTypeClass(entry)}">${esc(typeLabel)}</span>`);
      parts.push("</div>");
      if (imgSrc) {
        parts.push(`<img src="${imgSrc}" alt="${esc(typeLabel)} ${num}" />`);
      }
      if (entry.selector) {
        parts.push(`<p class="meta">Selector: <code>${esc(entry.selector)}</code></p>`);
      }
      if (entry.sourceUrl) {
        parts.push(`<p class="meta">Source: <a href="${esc(entry.sourceUrl)}">${esc(entry.sourceUrl)}</a></p>`);
      }
      parts.push("<div class=\"note-label\">Your note</div>");
      parts.push(`<div class="note">${esc(entry.note)}</div>`);
      parts.push("</section>");
    });

    parts.push(`<p class="footer">${esc(new Date().toLocaleString())} — Acopio — Gather. Connect. Simplify</p>`);
    parts.push("</div></body></html>");
    return parts.join("\n");
  }

  function buildCollectionReportMarkdown(entries) {
    const lines = [
      "# Acopio — Collection report",
      "",
      `${entries.length} capture${entries.length === 1 ? "" : "s"} with notes.`,
      "",
    ];
    entries.forEach((entry, index) => {
      const num = String(index + 1).padStart(2, "0");
      const typeLabel = entryTypeLabel(entry);
      lines.push(`## ${num} · ${typeLabel}`);
      lines.push("");
      if (entry.imageFile) {
        lines.push(`![${typeLabel} ${num}](${entry.imageFile})`);
        lines.push("");
      }
      if (entry.selector) lines.push(`**Selector:** ${entry.selector}`);
      if (entry.sourceUrl) lines.push(`**Source:** ${entry.sourceUrl}`);
      lines.push("");
      lines.push(`**Your note:** ${entry.note}`);
      lines.push("");
    });
    lines.push(`---`);
    lines.push(`${new Date().toLocaleString()} — Acopio — Gather. Connect. Simplify`);
    return lines.join("\n");
  }

  function buildExportReadme() {
    return [
      "ACOPIO ZIP EXPORT — How to view captures with notes",
      "=====================================================",
      "",
      "RECOMMENDED: collection-report.html",
      "  Double-click to open in Chrome, Safari, Firefox, or Edge.",
      "  Images are embedded — works offline. Use Print → Save as PDF for a PDF.",
      "",
      "Also in this folder:",
      "  collection-report.md     — Markdown with relative image paths (Obsidian, Notion import)",
      "  component-*.png / image-*.png — Individual capture files",
      "  notes-with-images.doc    — Open in Microsoft Word (images use relative paths)",
      "  notes-with-images.rtf    — Rich Text; images may not show in TextEdit or WordPad",
      "",
      "Plain-text editors (Notepad, TextEdit plain mode) cannot show images.",
      "Use collection-report.html instead.",
      "",
    ].join("\n");
  }

  function buildNotedVisualsHtml(entries) {
    return buildCollectionReportHtml(entries);
  }

  function buildNotedVisualsDoc(entries) {
    const html = buildCollectionReportHtml(entries, { embedImages: false });
    const bodyStart = html.indexOf("<body>");
    const bodyEnd = html.indexOf("</body>");
    const inner = bodyStart >= 0 && bodyEnd > bodyStart ? html.slice(bodyStart + 6, bodyEnd) : "";
    const styleStart = html.indexOf("<style>");
    const styleEnd = html.indexOf("</style>");
    const style = styleStart >= 0 && styleEnd > styleStart ? html.slice(styleStart, styleEnd + 8) : "";
    return [
      "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\"",
      "xmlns:w=\"urn:schemas-microsoft-com:office:word\"",
      "xmlns=\"http://www.w3.org/TR/REC-html40\">",
      "<head><meta charset=\"utf-8\">",
      "<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->",
      style,
      "</head><body>",
      inner,
      "</body></html>",
    ].join("\n");
  }

  async function writeColorToZip(folder, item) {
    const id6 = item.id.slice(0, 6);
    const hex = (item.data.hex || "color").replace("#", "").toUpperCase();
    const noteSlug = item.note ? `-${H.sanitizeFilename(item.note.slice(0, 30))}` : "";
    const blob = await H.colorSwatchPngBlob(item.data);
    folder.file(`color-${hex}${noteSlug}-${id6}.png`, blob);
  }

  async function writePairingToZip(folder, item) {
    const id6 = item.id.slice(0, 6);
    const heading = H.sanitizeFilename(item.data.headingFamily || "heading");
    const body = H.sanitizeFilename(item.data.bodyFamily || "body");
    const lines = [`Heading font: ${item.data.headingFamily || "?"}`, `Body font: ${item.data.bodyFamily || "?"}`];
    if (item.note) lines.push(`Note: ${item.note}`);
    folder.file(`pairing-${heading}-${body}-${id6}.txt`, lines.join("\n"));
  }

  async function writeFontToZip(folder, item) {
    const id6 = item.id.slice(0, 6);
    const family = H.sanitizeFilename(item.data.family || "font");
    const size = item.data.sizePx ? `${item.data.sizePx}px` : "";
    const base = `font-${family}${size ? "-" + size : ""}-${id6}`;
    const blob = await H.fontSamplePngBlob(item.data);
    folder.file(`${base}.png`, blob);
    const lines = [
      `Family: ${item.data.family || "?"}`,
      `Weight: ${item.data.weight || "?"}`,
      `Size: ${item.data.sizePx ? item.data.sizePx + "px" : "?"}`,
    ];
    if (item.note) lines.push(`Note: ${item.note}`);
    folder.file(`${base}.txt`, lines.join("\n"));
  }

  async function writeImageToZip(folder, item, notedVisuals) {
    const id6 = item.id.slice(0, 6);
    const hasNote = !!(item.note && String(item.note).trim());
    const dims = item.data.width && item.data.height ? `${item.data.width}x${item.data.height}` : "size-unknown";
    const desc = H.sanitizeFilename(item.selector || "image");
    let imageFilename = null;
    let imageBytes = null;

    imageBytes = await H.resolveExportImageBytes(item);
    if (imageBytes) {
      imageFilename = `image-${desc}-${dims}-${id6}.png`;
      folder.file(imageFilename, imageBytes);
    } else if (item.data.url) {
      imageBytes = await H.fetchHttpImageBytes(item.data.url);
      if (imageBytes) {
        imageFilename = `image-${desc}-${dims}-${id6}.png`;
        folder.file(imageFilename, imageBytes);
      }
    }

    if (!imageBytes) {
      const lines = [`Link: ${item.data.url || "no URL"}`, `Size: ${dims}`];
      if (item.note) lines.push(`Note: ${item.note}`);
      folder.file(`image-${desc}-${dims}-link-only-${id6}.txt`, lines.join("\n"));
    }

    if (hasNote) {
      notedVisuals.push({
        type: "image",
        note: String(item.note).trim(),
        imageBytes: imageBytes ? await H.ensurePngBytes(imageBytes) : null,
        imageFile: imageFilename,
        sourceUrl: item.sourceUrl || "",
        selector: item.selector || "",
      });
    }
  }

  async function writeNoteToZip(folder, item, noteFilenameFor, noteTextBlockFor) {
    const noteFilename = noteFilenameFor(item);
    folder.file(noteFilename, noteTextBlockFor(item));
    if (Array.isArray(item.data.images)) {
      const noteBase = noteFilename.replace(/\.md$/, "");
      for (let i = 0; i < item.data.images.length; i++) {
        try {
          const resp = await fetch(item.data.images[i]);
          if (resp.ok) {
            const blob = await resp.blob();
            const ext = (blob.type.split("/")[1] || "jpg").split("+")[0];
            folder.file(`${noteBase}-img${i + 1}.${ext}`, blob);
          }
        } catch (_) {
          // one image failing to fetch shouldn't drop the note's text
        }
      }
    }
  }

  async function resolveComponentImageBytes(item) {
    let bytes = await H.resolveExportImageBytes(item);
    const data = item.data || {};
    if (bytes && bytes.length) return bytes;

    if (data.previewImage) {
      console.warn("[Acopio export] resolveExportImageBytes returned null; retrying previewImage decode", {
        id: item.id,
        selector: item.selector,
      });
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
    if (!bytes && data.outerHTML) {
      const mediaUrl = H.componentMediaUrlFromOuterHtml(data.outerHTML, item.sourceUrl);
      if (mediaUrl) {
        try {
          const blob = await H.urlToPngBlob(mediaUrl);
          if (blob) bytes = await H.blobToBytes(blob);
        } catch (_) {
          // fall through
        }
      }
    }
    if (!bytes) {
      console.warn("[Acopio export] No image bytes for component — all decode paths failed", {
        id: item.id,
        selector: item.selector,
        hasPreviewImage: !!data.previewImage,
        hasInlineDataUrl: !!data.inlineDataUrl,
      });
    }
    return bytes;
  }

  async function writeComponentToZip(folder, item, notedVisuals) {
    const id6 = item.id.slice(0, 6);
    const hasNote = !!(item.note && String(item.note).trim());
    const dims = item.data.boundingBoxWidth && item.data.boundingBoxHeight
      ? `${item.data.boundingBoxWidth}x${item.data.boundingBoxHeight}` : "size-unknown";
    const desc = H.sanitizeFilename(item.selector || "component");
    const base = `component-${desc}-${dims}-${id6}`;
    const imageFilename = `${base}.png`;
    let componentImageBytes = await resolveComponentImageBytes(item);

    if (componentImageBytes && componentImageBytes.length) {
      folder.file(imageFilename, componentImageBytes);
    } else {
      const lines = [];
      if (item.note) lines.push(`Note: ${item.note}`);
      lines.push(`Selector: ${item.selector || "?"}`);
      lines.push(`Size: ${dims}`);
      if (item.sourceUrl) lines.push(`Source: ${item.sourceUrl}`);
      folder.file(`${base}-no-image-${id6}.txt`, lines.join("\n"));
    }

    if (hasNote) {
      notedVisuals.push({
        type: "component",
        note: String(item.note).trim(),
        imageBytes: componentImageBytes ? await H.ensurePngBytes(componentImageBytes) : null,
        imageFile: componentImageBytes ? imageFilename : null,
        sourceUrl: item.sourceUrl || "",
        selector: item.selector || "",
      });
    }
  }

  const ZIP_WRITERS = {
    color: writeColorToZip,
    pairing: writePairingToZip,
    font: writeFontToZip,
    image: writeImageToZip,
    note: writeNoteToZip,
    component: writeComponentToZip,
  };

  async function writeItemToZip(folder, item, notedVisuals, deps) {
    const writer = ZIP_WRITERS[item.type];
    if (!writer) return;
    if (item.type === "note") {
      await writer(folder, item, deps.noteFilenameFor, deps.noteTextBlockFor);
    } else if (item.type === "image" || item.type === "component") {
      await writer(folder, item, notedVisuals);
    } else {
      await writer(folder, item);
    }
  }

  async function performZipExport(exportContext, deps) {
    const showFeedback = deps.showFeedback;
    if (!exportContext || exportContext.items.length === 0) {
      showFeedback("Nothing to export in this scope.", "error");
      return;
    }
    showFeedback("Building ZIP…");
    try {
      const zip = new JSZip();
      const byHost = new Map();
      for (const item of exportContext.items) {
        const key = H.sanitizeFilename(item.hostname || "unknown");
        if (!byHost.has(key)) byHost.set(key, []);
        byHost.get(key).push(item);
      }
      let anyNotedVisuals = false;
      for (const [hostKey, hostItems] of byHost) {
        const folder = zip.folder(hostKey);
        const notedVisuals = [];
        for (const item of hostItems) {
          await writeItemToZip(folder, item, notedVisuals, deps);
        }
        if (notedVisuals.length > 0) {
          anyNotedVisuals = true;
          const normalized = await Promise.all(
            notedVisuals.map(async (entry) => ({
              ...entry,
              imageBytes: entry.imageBytes ? await H.ensurePngBytes(entry.imageBytes) : null,
            }))
          );
          folder.file("collection-report.html", buildCollectionReportHtml(normalized));
        }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportContext.scopeKey}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      const count = exportContext.items.length;
      const siteCount = exportContext.siteCount || new Set(exportContext.items.map((item) => item.hostname)).size;
      const countLabel =
        siteCount > 1
          ? `${count} item${count === 1 ? "" : "s"} from ${siteCount} sites`
          : `${count} item${count === 1 ? "" : "s"}`;
      const reportHint =
        siteCount > 1
          ? " Each site folder has its own collection-report.html for noted captures."
          : " Open collection-report.html in your browser to view notes with images.";
      const successMsg = anyNotedVisuals
        ? `ZIP downloaded — ${countLabel}.${reportHint}`
        : `ZIP downloaded — ${countLabel}.`;
      showFeedback(successMsg, "success");
    } catch (err) {
      showFeedback(`Export failed: ${String((err && err.message) || err)}. Try again?`, "error");
    }
  }

  window.AcopioZipExport = {
    performZipExport,
    buildNotedVisualsRtf,
    buildNotedVisualsHtml,
    buildNotedVisualsDoc,
    buildCollectionReportHtml,
    buildCollectionReportMarkdown,
    buildExportReadme,
    resolveComponentImageBytes,
    ZIP_WRITERS,
  };
})();
