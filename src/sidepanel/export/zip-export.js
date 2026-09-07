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


  const CATALOG_STYLES = [
    "body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#fafafa;color:#17181a;line-height:1.5;margin:0}",
    ".wrap{max-width:720px;margin:32px auto;padding:0 16px 48px}",
    "h1{font-size:20px;font-weight:600;margin:0 0 8px}",
    "h2{font-size:14px;font-weight:650;letter-spacing:0.04em;text-transform:uppercase;color:#6b6e76;margin:32px 0 12px}",
    ".intro{color:#6b6e76;font-size:14px;margin:0 0 32px}",
    ".entry{background:#fff;border:1px solid rgba(23,24,26,0.09);border-radius:16px;padding:24px;margin-bottom:16px;box-shadow:0 1px 2px rgba(23,24,26,0.06)}",
    ".entry-head{display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap}",
    ".type-pill{font-size:12px;font-weight:600;padding:4px 8px;border-radius:8px}",
    ".type-color{background:#f3e8e4;color:#c1552f}",
    ".type-font{background:#e8eef8;color:#1d3461}",
    ".type-image{background:#dff3ec;color:#1e8f72}",
    ".type-component{background:#fbf0dc;color:#b07d1f}",
    ".type-note{background:#e3eefb;color:#2f6fed}",
    ".type-pairing{background:#f0e8f8;color:#6b3fa0}",
    ".family-pill{font-size:12px;font-weight:600;padding:4px 8px;border-radius:8px;background:rgba(29,52,97,0.08);color:#1d3461}",
    ".entry-num{font-size:12px;color:#6b6e76;font-weight:600}",
    ".swatch{width:100%;height:120px;border-radius:8px;border:1px solid rgba(23,24,26,0.09);margin-bottom:16px}",
    ".swatch-sm{height:48px}",
    ".hex{font-size:25px;font-weight:700;letter-spacing:0.02em;margin:0 0 8px}",
    ".stop-row{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}",
    ".stop-chip{display:inline-flex;align-items:center;gap:8px;padding:4px 8px;border-radius:8px;border:1px solid rgba(23,24,26,0.09);background:#fafafa}",
    ".stop-swatch{width:16px;height:16px;border-radius:4px;border:1px solid rgba(23,24,26,0.12);flex:none}",
    ".stop-hex{font-size:14px;font-weight:650;font-variant-numeric:tabular-nums}",
    ".css-value{font-size:12px;color:#6b6e76;word-break:break-all;margin:0 0 16px;padding:12px;border-radius:8px;background:#f5f5f6;border:1px solid rgba(23,24,26,0.06)}",
    ".font-sample{margin:0 0 16px;padding:16px;border-radius:8px;border:1px solid rgba(23,24,26,0.09);background:#fafafa;overflow-wrap:anywhere}",
    ".props{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;margin:0 0 16px}",
    ".prop-label{font-size:12px;font-weight:600;color:#6b6e76;margin:0 0 4px}",
    ".prop-value{font-size:16px;font-weight:650;color:#17181a}",
    ".entry img{max-width:100%;height:auto;display:block;border-radius:8px;border:1px solid rgba(23,24,26,0.09);margin-bottom:16px}",
    ".meta{font-size:12px;color:#6b6e76;margin:0 0 8px}",
    ".meta a{color:#1d3461}",
    ".note-block{margin-top:16px;padding-top:16px;border-top:1px solid rgba(23,24,26,0.09)}",
    ".note-label{font-size:12px;font-weight:600;color:#6b6e76;margin:0 0 8px}",
    ".note{font-size:16px;line-height:1.55;white-space:pre-wrap}",
    ".quote{font-size:16px;line-height:1.55;border-left:3px solid #1d3461;padding-left:12px;margin:0 0 16px;color:#17181a}",
    ".footer{margin-top:32px;font-size:12px;color:#6b6e76}",
    "@media print{body{background:#fff}.entry{box-shadow:none;break-inside:avoid}}",
    "@media (max-width:560px){.props{grid-template-columns:1fr}}",
  ].join("");

  function escHtml(s) {
    return Acopio.escapeHtml(String(s == null ? "" : s)).replace(/\n/g, "<br>");
  }

  function propHtml(label, value) {
    if (value == null || value === "") return "";
    return (
      `<div class="prop"><div class="prop-label">${escHtml(label)}</div>` +
      `<div class="prop-value">${escHtml(value)}</div></div>`
    );
  }

  function noteBlockHtml(note) {
    const text = note && String(note).trim();
    if (!text) return "";
    return (
      `<div class="note-block">` +
      `<div class="note-label">Your note</div>` +
      `<div class="note">${escHtml(text)}</div>` +
      `</div>`
    );
  }

  function catalogTypeLabel(type) {
    if (type === "color") return "Color";
    if (type === "font") return "Font";
    if (type === "image") return "Image";
    if (type === "component") return "Component";
    if (type === "note") return "Note";
    if (type === "pairing") return "Pairing";
    return type || "Item";
  }

  function resolveGradientCss(data) {
    if (!data || !data.isGradient) return "";
    const raw = data.gradientStops;
    if (typeof raw === "string" && raw.includes("gradient")) return raw;
    return "";
  }

  function resolveGradientStopHexes(data) {
    const css = resolveGradientCss(data);
    if (css && typeof Acopio.parseGradientStops === "function") {
      return Acopio.parseGradientStops(css);
    }
    return [];
  }

  function renderCatalogItemHtml(item, index, imageSrc) {
    const data = item.data || {};
    const num = String(index + 1).padStart(2, "0");
    const type = item.type || "item";
    const parts = [];
    parts.push('<section class="entry">');
    parts.push('<div class="entry-head">');
    parts.push(`<span class="entry-num">${num}</span>`);
    parts.push(`<span class="type-pill type-${escHtml(type)}">${escHtml(catalogTypeLabel(type))}</span>`);
    if (item.family && (type === "font" || type === "color")) {
      parts.push(`<span class="family-pill">${escHtml(item.family)}</span>`);
    }
    parts.push("</div>");

    if (type === "color") {
      const gradCss = resolveGradientCss(data);
      const stops = resolveGradientStopHexes(data);
      const isGrad = !!(data.isGradient && (gradCss || stops.length >= 2));
      if (isGrad) {
        const bg = gradCss || `linear-gradient(90deg, ${stops.join(", ")})`;
        parts.push(`<div class="swatch" style="background:${Acopio.escapeHtml(bg)}"></div>`);
        parts.push(`<div class="hex">Gradient · ${stops.length} stop${stops.length === 1 ? "" : "s"}</div>`);
        if (stops.length) {
          parts.push('<div class="stop-row">');
          stops.forEach((hex) => {
            const h = String(hex).toUpperCase();
            parts.push(
              `<div class="stop-chip"><span class="stop-swatch" style="background:${escHtml(h)}"></span>` +
                `<span class="stop-hex">${escHtml(h)}</span></div>`
            );
          });
          parts.push("</div>");
        }
        const props = [propHtml("Type", "Gradient")];
        if (gradCss && typeof Acopio.parseGradientDirection === "function") {
          props.push(propHtml("Direction", Acopio.parseGradientDirection(gradCss)));
        }
        if (props.length) parts.push(`<div class="props">${props.join("")}</div>`);
        if (gradCss) {
          parts.push(`<pre class="css-value">${escHtml(gradCss)}</pre>`);
        }
      } else {
        const hex = String(data.hex || "?").toUpperCase();
        parts.push(`<div class="swatch" style="background:${escHtml(hex)}"></div>`);
        parts.push(`<div class="hex">${escHtml(hex)}</div>`);
        const props = [];
        if (data.rgb) {
          props.push(propHtml("RGB", `${Math.round(data.rgb.r)}, ${Math.round(data.rgb.g)}, ${Math.round(data.rgb.b)}`));
        }
        if (data.alpha != null && Number(data.alpha) < 0.999) {
          props.push(propHtml("Alpha", String(Math.round(Number(data.alpha) * 100) / 100)));
        }
        if (props.length) parts.push(`<div class="props">${props.join("")}</div>`);
      }
    } else if (type === "font") {
      const sample = (data.sampleText && String(data.sampleText).trim()) || data.family || "Aa";
      const style = typeof Acopio.fontInlineStyle === "function" ? Acopio.fontInlineStyle(data) : "";
      parts.push(`<div class="font-sample" style="${style}">${escHtml(sample)}</div>`);
      const props = [
        propHtml("Font name", data.family || "?"),
        propHtml("Weight", data.weight || "?"),
        propHtml("Size", data.sizePx != null ? `${Math.round(data.sizePx)}px` : ""),
        propHtml("Line height", data.lineHeightPx != null ? `${Math.round(data.lineHeightPx)}px` : ""),
        propHtml(
          "Letter spacing",
          data.letterSpacingPx != null && Number(data.letterSpacingPx) !== 0
            ? `${data.letterSpacingPx}px`
            : data.letterSpacingPx === 0
              ? "0"
              : ""
        ),
        propHtml("Color", data.colorHex ? String(data.colorHex).toUpperCase() : ""),
      ].filter(Boolean);
      if (props.length) parts.push(`<div class="props">${props.join("")}</div>`);
      if (data.colorHex) {
        const hex = String(data.colorHex).toUpperCase();
        parts.push(`<div class="swatch swatch-sm" style="background:${escHtml(hex)}" title="${escHtml(hex)}"></div>`);
      }
    } else if (type === "pairing") {
      parts.push(
        `<div class="font-sample" style="font-family:${escHtml(data.headingFallbackStack || data.headingFamily || "sans-serif")};font-weight:${escHtml(data.headingWeight || "700")};font-size:${Math.round(data.headingSizePx || 28)}px;color:${escHtml(data.headingColorHex || "#17181a")}">${escHtml(data.headingSampleText || data.headingFamily || "Heading")}</div>`
      );
      parts.push(
        `<div class="font-sample" style="font-family:${escHtml(data.bodyFallbackStack || data.bodyFamily || "sans-serif")};font-weight:${escHtml(data.bodyWeight || "400")};font-size:${Math.round(data.bodySizePx || 16)}px;color:${escHtml(data.bodyColorHex || "#17181a")}">${escHtml(data.bodySampleText || data.bodyFamily || "Body")}</div>`
      );
      parts.push(`<div class="props">${propHtml("Heading", data.headingFamily || "?")}${propHtml("Body", data.bodyFamily || "?")}</div>`);
    } else if (type === "note") {
      parts.push(`<div class="quote">${escHtml(data.text || "")}</div>`);
      if (data.truncated) {
        parts.push('<p class="meta">Selection was truncated at 4,000 characters.</p>');
      }
    } else if (imageSrc) {
      parts.push(`<img src="${Acopio.escapeHtml(String(imageSrc))}" alt="${escHtml(catalogTypeLabel(type))} ${num}" />`);
    }

    if (item.selector && type !== "note" && type !== "color" && type !== "font") {
      parts.push(`<p class="meta">Selector: <code>${escHtml(item.selector)}</code></p>`);
    }
    if (item.sourceUrl) {
      parts.push(`<p class="meta">Source: <a href="${escHtml(item.sourceUrl)}">${escHtml(item.sourceUrl)}</a></p>`);
    }
    // Personal annotation from Collect — separate from a note-type's captured text.
    parts.push(noteBlockHtml(item.note));
    parts.push("</section>");
    return parts.join("");
  }

  function buildCatalogHtml(items, opts = {}) {
    const hostname = opts.hostname || "";
    const imageSrcById = opts.imageSrcById || {};
    const list = Array.isArray(items) ? items : [];
    const counts = list.reduce((acc, item) => {
      const t = item.type || "item";
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});
    const countBits = Object.keys(counts)
      .map((t) => `${counts[t]} ${catalogTypeLabel(t).toLowerCase()}${counts[t] === 1 ? "" : "s"}`)
      .join(" · ");
    const parts = [
      "<!DOCTYPE html>",
      '<html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      "<title>Acopio — Design catalog</title>",
      "<style>",
      CATALOG_STYLES,
      "</style></head><body>",
      '<div class="wrap">',
      "<h1>Acopio — Design catalog</h1>",
      `<p class="intro">${list.length} item${list.length === 1 ? "" : "s"}${hostname ? ` from ${escHtml(hostname)}` : ""}${countBits ? ` — ${escHtml(countBits)}` : ""}. Colors show swatches and codes (gradients show the blend and each stop); fonts show the sample and typography properties. Notes you added at collect time appear under each item as <strong>Your note</strong>.</p>`,
    ];

    const order = ["color", "font", "pairing", "image", "component", "note"];
    const byType = new Map();
    list.forEach((item) => {
      const t = item.type || "item";
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(item);
    });
    let index = 0;
    order.forEach((type) => {
      const group = byType.get(type);
      if (!group || !group.length) return;
      parts.push(`<h2>${escHtml(catalogTypeLabel(type))}s</h2>`);
      group.forEach((item) => {
        parts.push(renderCatalogItemHtml(item, index, imageSrcById[item.id] || ""));
        index += 1;
      });
      byType.delete(type);
    });
    byType.forEach((group) => {
      group.forEach((item) => {
        parts.push(renderCatalogItemHtml(item, index, imageSrcById[item.id] || ""));
        index += 1;
      });
    });

    parts.push(`<p class="footer">${escHtml(new Date().toLocaleString())} — Acopio — Gather. Connect. Simplify</p>`);
    parts.push("</div></body></html>");
    return parts.join("\n");
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
      "ACOPIO ZIP EXPORT — How to view this handoff",
      "============================================",
      "",
      "RECOMMENDED: catalog.html",
      "  Double-click to open in Chrome, Safari, Firefox, or Edge.",
      "  Colors: swatch + hex code (gradients show the full blend + each stop).",
      "  Fonts: sample text + font name, weight, size, line height, tracking, color.",
      "  Notes you typed at Collect appear under each item as \"Your note\".",
      "  Use Print → Save as PDF for a PDF.",
      "",
      "Also in this folder (when present):",
      "  collection-report.html — Image/component captures that have notes (with embedded images)",
      "  collection-report.md   — Markdown with relative image paths (Obsidian, Notion import)",
      "  color-*.png / font-*.png / component-*.png / image-*.png — Individual files",
      "  color-*.txt / font-*.txt — Plain-text property sheets",
      "  notes-with-images.doc / .rtf — Word-oriented noted-visual packages",
      "",
      "Plain-text editors (Notepad, TextEdit plain mode) cannot show images or swatches.",
      "Use catalog.html instead.",
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
    const lines = [];
    if (item.data.isGradient) {
      const css = typeof item.data.gradientStops === "string" ? item.data.gradientStops : "";
      const stops =
        css && typeof Acopio.parseGradientStops === "function" ? Acopio.parseGradientStops(css) : [];
      lines.push("Type: Gradient");
      if (stops.length) lines.push(`Stops: ${stops.join(", ")}`);
      if (css && typeof Acopio.parseGradientDirection === "function") {
        lines.push(`Direction: ${Acopio.parseGradientDirection(css)}`);
      }
      if (css) lines.push(`CSS: ${css}`);
    } else {
      lines.push(`Hex: ${item.data.hex || "?"}`);
      if (item.data.rgb) {
        lines.push(`RGB: ${Math.round(item.data.rgb.r)}, ${Math.round(item.data.rgb.g)}, ${Math.round(item.data.rgb.b)}`);
      }
      if (item.data.alpha != null && Number(item.data.alpha) < 0.999) {
        lines.push(`Alpha: ${item.data.alpha}`);
      }
    }
    if (item.note) lines.push(`Note: ${item.note}`);
    folder.file(`color-${hex}${noteSlug}-${id6}.txt`, lines.join("\n"));
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
      `Font name: ${item.data.family || "?"}`,
      `Weight: ${item.data.weight || "?"}`,
      `Size: ${item.data.sizePx != null ? `${item.data.sizePx}px` : "?"}`,
    ];
    if (item.data.lineHeightPx != null) lines.push(`Line height: ${item.data.lineHeightPx}px`);
    if (item.data.letterSpacingPx != null) lines.push(`Letter spacing: ${item.data.letterSpacingPx}px`);
    if (item.data.colorHex) lines.push(`Color: ${String(item.data.colorHex).toUpperCase()}`);
    if (item.data.sampleText) lines.push(`Sample: ${item.data.sampleText}`);
    if (item.family) lines.push(`Role: ${item.family}`);
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
    return imageFilename;
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
    return componentImageBytes && componentImageBytes.length ? imageFilename : null;
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
    if (!writer) return null;
    if (item.type === "note") {
      await writer(folder, item, deps.noteFilenameFor, deps.noteTextBlockFor);
      return null;
    }
    if (item.type === "image" || item.type === "component") {
      return await writer(folder, item, notedVisuals);
    }
    await writer(folder, item);
    return null;
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
      let wroteCatalog = false;
      for (const [hostKey, hostItems] of byHost) {
        const folder = zip.folder(hostKey);
        const notedVisuals = [];
        const imageSrcById = {};
        for (const item of hostItems) {
          const writtenImage = await writeItemToZip(folder, item, notedVisuals, deps);
          if (writtenImage) imageSrcById[item.id] = writtenImage;
        }

        folder.file(
          "catalog.html",
          buildCatalogHtml(hostItems, {
            hostname: hostItems[0] && hostItems[0].hostname,
            imageSrcById,
          })
        );
        folder.file("README.txt", buildExportReadme());
        wroteCatalog = true;

        if (notedVisuals.length > 0) {
          anyNotedVisuals = true;
          const normalized = await Promise.all(
            notedVisuals.map(async (entry) => ({
              ...entry,
              imageBytes: entry.imageBytes ? await H.ensurePngBytes(entry.imageBytes) : null,
            }))
          );
          folder.file("collection-report.html", buildCollectionReportHtml(normalized));
          folder.file("collection-report.md", buildCollectionReportMarkdown(normalized));
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
      const reportHint = wroteCatalog
        ? siteCount > 1
          ? " Open catalog.html in each site folder for colors, fonts, and notes."
          : " Open catalog.html for colors, fonts, and notes."
        : "";
      const notedHint = anyNotedVisuals
        ? " collection-report.html has noted screenshots."
        : "";
      showFeedback(`ZIP downloaded — ${countLabel}.${reportHint}${notedHint}`, "success");
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
    buildCatalogHtml,
    buildExportReadme,
    resolveComponentImageBytes,
    ZIP_WRITERS,
  };
})();
