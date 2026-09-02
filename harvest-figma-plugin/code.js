// Harvest Import — Figma plugin main thread.
// Receives parsed payloads from ui.html and creates frames on the current page.

figma.showUI(__html__, { width: 320, height: 300 });

const STACK_GAP = 24;
const FRAME_PADDING = 16;
const INNER_GAP = 8;
const MAX_IMAGE_DIMENSION = 640;
const CONTENT_WIDTH = 320;
const FALLBACK_FONT = { family: "Inter", style: "Regular" };
const MUTED_COLOR = { r: 0.45, g: 0.45, b: 0.45 };
const PLACEHOLDER_FILL = { r: 0.93, g: 0.93, b: 0.93 };
const CARD_FILL = { r: 1, g: 1, b: 1 };
const CARD_STROKE = { r: 0.898, g: 0.898, b: 0.898 };

const TYPE_LABELS = {
  component: "Component",
  image: "Image",
  color: "Color",
  font: "Font",
  note: "Note",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeDimension(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function safeColorChannel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return clamp(n > 1 ? n / 255 : n, 0, 1);
}

function safeOpacity(value) {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, 0, 1) : 1;
}

function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const num = parseInt(h, 16);
  return { r: ((num >> 16) & 255) / 255, g: ((num >> 8) & 255) / 255, b: (num & 255) / 255 };
}

function dataUrlToBytes(dataUrl) {
  const comma = String(dataUrl).indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function loadFont(family, weight) {
  const w = parseInt(weight, 10) || 400;
  const style = w >= 600 ? "Bold" : "Regular";
  const candidates = [
    { family: family || "Inter", style },
    { family: family || "Inter", style: "Regular" },
    FALLBACK_FONT,
  ];
  for (const candidate of candidates) {
    try {
      await figma.loadFontAsync(candidate);
      return candidate;
    } catch (_) {
      // try next
    }
  }
  return null;
}

function makeItemFrame(name) {
  const frame = figma.createFrame();
  frame.name = name;
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "FIXED";
  frame.resize(CONTENT_WIDTH + FRAME_PADDING * 2, 100);
  frame.itemSpacing = INNER_GAP;
  frame.paddingTop = FRAME_PADDING;
  frame.paddingBottom = FRAME_PADDING;
  frame.paddingLeft = FRAME_PADDING;
  frame.paddingRight = FRAME_PADDING;
  frame.fills = [{ type: "SOLID", color: CARD_FILL }];
  frame.strokes = [{ type: "SOLID", color: CARD_STROKE }];
  frame.strokeWeight = 1;
  frame.cornerRadius = 8;
  return frame;
}

async function makeCaption(text) {
  const node = figma.createText();
  await figma.loadFontAsync(FALLBACK_FONT);
  node.fontName = FALLBACK_FONT;
  node.fontSize = 11;
  node.fills = [{ type: "SOLID", color: MUTED_COLOR }];
  node.characters = text;
  node.textAutoResize = "HEIGHT";
  node.resize(CONTENT_WIDTH, node.height);
  return node;
}

async function makeNoteBlock(noteText) {
  const node = figma.createText();
  await figma.loadFontAsync(FALLBACK_FONT);
  node.fontName = FALLBACK_FONT;
  node.fontSize = 12;
  node.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];
  node.characters = noteText;
  node.textAutoResize = "HEIGHT";
  node.resize(CONTENT_WIDTH, node.height);
  return node;
}

function makeImageRect(dataUrl, width, height) {
  const w = safeDimension(width, 300);
  const h = safeDimension(height, 200);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(w, h), CONTENT_WIDTH / w);
  const rect = figma.createRectangle();
  rect.resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  const image = figma.createImage(dataUrlToBytes(dataUrl));
  rect.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: image.hash }];
  return rect;
}

function makePlaceholderRect(width, height, label) {
  const rect = figma.createRectangle();
  rect.resize(Math.max(1, width), Math.max(1, height));
  rect.fills = [{ type: "SOLID", color: PLACEHOLDER_FILL }];
  rect.name = label || "Unavailable";
  return rect;
}

async function buildColorContent(item) {
  const data = item.data || {};
  const rect = figma.createRectangle();
  rect.resize(CONTENT_WIDTH, 80);
  rect.cornerRadius = 4;
  const rgb = data.rgb ? { r: safeColorChannel(data.rgb.r), g: safeColorChannel(data.rgb.g), b: safeColorChannel(data.rgb.b) } : hexToRgb(data.hex);
  rect.fills = [{ type: "SOLID", color: rgb || PLACEHOLDER_FILL, opacity: safeOpacity(data.alpha) }];
  return [rect, await makeCaption((data.hex || "Color").toUpperCase())];
}

async function buildFontContent(item) {
  const data = item.data || {};
  const font = await loadFont(data.family, data.weight);
  const sample = figma.createText();
  if (font) sample.fontName = font;
  sample.fontSize = clamp(safeDimension(data.sizePx, 16), 8, 72);
  const sampleText = typeof data.sampleText === "string" ? data.sampleText.trim() : "";
  sample.characters = sampleText || data.family || "Sample text";
  sample.textAutoResize = "HEIGHT";
  sample.resize(CONTENT_WIDTH, sample.height);
  const info = `${data.family || "Unknown"} · ${data.weight || "400"} · ${Math.round(data.sizePx || 16)}px`;
  return [sample, await makeCaption(info)];
}

async function buildImageContent(item) {
  const data = item.data || {};
  const dataUrl = data.inlineDataUrl || null;
  if (dataUrl) {
    const rect = makeImageRect(dataUrl, data.width, data.height);
    const caption = data.altText || (data.width && data.height ? `${data.width}×${data.height}` : "Image");
    return [rect, await makeCaption(caption)];
  }
  return [
    makePlaceholderRect(CONTENT_WIDTH, 120, "Image unavailable"),
    await makeCaption("Image unavailable — not inlined at export time"),
  ];
}

async function buildComponentContent(item, renderMode) {
  const data = item.data || {};
  if (renderMode === "simple" || data.previewImage) {
    if (data.previewImage) {
      try {
        const rect = makeImageRect(
          data.previewImage,
          data.boundingBoxWidth,
          data.boundingBoxHeight
        );
        return [rect];
      } catch (_) {
        // fall through to placeholder
      }
    }
    return [
      makePlaceholderRect(CONTENT_WIDTH, 160, "Component preview unavailable"),
      await makeCaption("No preview image in export"),
    ];
  }
  return [
    makePlaceholderRect(CONTENT_WIDTH, 160, "Component"),
    await makeCaption("Use simple render mode export from Harvest"),
  ];
}

async function buildNoteContent(item) {
  const data = item.data || {};
  const text = typeof data.text === "string" ? data.text.trim() : "";
  const body = figma.createText();
  await figma.loadFontAsync(FALLBACK_FONT);
  body.fontName = FALLBACK_FONT;
  body.fontSize = 14;
  body.characters = text || "(empty note)";
  body.textAutoResize = "HEIGHT";
  body.resize(CONTENT_WIDTH, body.height);
  const nodes = [body];
  if (Array.isArray(data.images)) {
    for (const img of data.images) {
      if (img && img.inlineDataUrl) {
        try {
          nodes.push(makeImageRect(img.inlineDataUrl, img.width, img.height));
        } catch (_) {
          nodes.push(makePlaceholderRect(CONTENT_WIDTH, 80, "Image"));
        }
      }
    }
  }
  return nodes;
}

const CONTENT_BUILDERS = {
  color: buildColorContent,
  font: buildFontContent,
  image: buildImageContent,
  component: buildComponentContent,
  note: buildNoteContent,
};

async function buildItemFrame(item, index, renderMode, typeCounts) {
  const type = item && item.type;
  const labelBase = TYPE_LABELS[type] || "Item";
  typeCounts[type] = (typeCounts[type] || 0) + 1;
  const frame = makeItemFrame(`${labelBase} ${typeCounts[type]}`);

  const build = CONTENT_BUILDERS[type];
  if (!build) {
    frame.appendChild(await makeCaption(`Unsupported type: ${type || "unknown"}`));
    return frame;
  }

  const nodes = await build(item, renderMode);
  for (const node of nodes) frame.appendChild(node);

  const noteText = typeof item.note === "string" ? item.note.trim() : "";
  if (noteText) {
    frame.appendChild(await makeNoteBlock(noteText));
  }

  return frame;
}

async function importPayload(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const renderMode = payload.renderMode || "simple";
  if (items.length === 0) {
    throw new Error("No items to import.");
  }

  const hostnames = new Set(items.map((item) => (item && item.hostname) || "unknown"));
  const multiSite = hostnames.size > 1;
  const typeCounts = {};
  let imported = 0;
  let failed = 0;
  const topLevelFrames = [];

  async function importItemsIntoParent(itemList, parentFrame) {
    for (let i = 0; i < itemList.length; i++) {
      const item = itemList[i];
      try {
        const frame = await buildItemFrame(item, i, renderMode, typeCounts);
        parentFrame.appendChild(frame);
        imported++;
      } catch (_) {
        failed++;
      }
      figma.ui.postMessage({ type: "progress", done: imported + failed, total: items.length });
    }
  }

  if (multiSite) {
    const groups = [];
    let currentGroup = null;
    for (const item of items) {
      const host = (item && item.hostname) || "unknown";
      if (!currentGroup || currentGroup.host !== host) {
        currentGroup = { host, items: [] };
        groups.push(currentGroup);
      }
      currentGroup.items.push(item);
    }

    for (const group of groups) {
      const siteFrame = figma.createFrame();
      siteFrame.name = group.host;
      siteFrame.layoutMode = "VERTICAL";
      siteFrame.primaryAxisSizingMode = "AUTO";
      siteFrame.counterAxisSizingMode = "AUTO";
      siteFrame.itemSpacing = STACK_GAP;
      siteFrame.paddingTop = FRAME_PADDING;
      siteFrame.paddingBottom = FRAME_PADDING;
      siteFrame.paddingLeft = FRAME_PADDING;
      siteFrame.paddingRight = FRAME_PADDING;
      siteFrame.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.97 } }];
      siteFrame.strokes = [{ type: "SOLID", color: CARD_STROKE }];
      siteFrame.strokeWeight = 1;
      siteFrame.cornerRadius = 12;
      await importItemsIntoParent(group.items, siteFrame);
      if (siteFrame.children.length > 0) topLevelFrames.push(siteFrame);
    }
  } else {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        const frame = await buildItemFrame(item, i, renderMode, typeCounts);
        topLevelFrames.push(frame);
        imported++;
      } catch (_) {
        failed++;
      }
      figma.ui.postMessage({ type: "progress", done: i + 1, total: items.length });
    }
  }

  if (topLevelFrames.length === 0) {
    throw new Error("Nothing could be imported.");
  }

  const center = figma.viewport.center;
  let cursorX = Math.round(center.x - CONTENT_WIDTH / 2);
  let cursorY = Math.round(center.y - 200);

  for (const frame of topLevelFrames) {
    figma.currentPage.appendChild(frame);
    frame.x = cursorX;
    frame.y = cursorY;
    cursorY += frame.height + STACK_GAP * 2;
  }

  figma.currentPage.selection = topLevelFrames;
  figma.viewport.scrollAndZoomIntoView(topLevelFrames);

  return { imported, failed };
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === "import-payload") {
    try {
      const result = await importPayload(msg.payload);
      figma.ui.postMessage({ type: "import-complete", ...result });
      figma.notify(
        `Imported ${result.imported} item${result.imported === 1 ? "" : "s"}${
          result.failed ? ` (${result.failed} skipped)` : ""
        }`
      );
    } catch (e) {
      const message = String((e && e.message) || e);
      figma.ui.postMessage({ type: "import-error", message });
      figma.notify("Import failed — see plugin panel", { error: true });
    }
  } else if (msg.type === "cancel") {
    figma.closePlugin();
  }
};

// Tell the UI iframe we're ready — it may auto-read clipboard for autoImport exports.
figma.ui.postMessage({ type: "plugin-ready" });
