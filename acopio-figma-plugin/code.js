// Acopio Import — main plugin thread. Runs in the Figma sandbox (has figma.* access,
// no DOM). ui.html parses clipboard JSON; this file builds nodes. Components with
// data.layoutTree become editable Auto Layout; otherwise screenshot / legacy layers.

figma.showUI(__html__, { width: 320, height: 560 });

const GRID_COLUMNS = 4;
const GRID_GAP = 40;
const SECTION_GAP = 80;
const SECTION_PADDING = 32;
const CARD_CONTENT_WIDTH = 220;
const MAX_IMAGE_DIMENSION = 480; // clamp for a plain captured photo/screenshot thumbnail
// A whole component LAYOUT isn't a thumbnail — a completely normal 1248px-
// wide desktop hero section was being crushed down to under 500px because
// it shared MAX_IMAGE_DIMENSION with single decorative photos, which made
// every text-wrap/overlap issue worse on top of just looking cramped.
// 1600 comfortably fits real desktop component widths at or near 1:1
// while still bounding the rare genuinely oversized capture.
const MAX_COMPONENT_DIMENSION = 1600;
const CARD_FILL = { r: 1, g: 1, b: 1 };
const CARD_STROKE = { r: 0.898, g: 0.898, b: 0.898 }; // #E5E5E5
const CAPTION_COLOR = { r: 0.4, g: 0.4, b: 0.4 };
const FALLBACK_FONT = { family: "Inter", style: "Regular" };
const PLACEHOLDER_FILL = { r: 0.9, g: 0.9, b: 0.9 };
const IDENTITY_GRADIENT_TRANSFORM = [
  [1, 0, 0],
  [0, 1, 0],
];
// Left-to-right, matching IDENTITY's own natural stop order (position 0
// at the left) — used for CSS "to right" / an unrecognized/diagonal angle.
const HORIZONTAL_GRADIENT_TRANSFORM = IDENTITY_GRADIENT_TRANSFORM;
// Top-to-bottom — verified live against the real Figma API before
// shipping (not derived from docs alone, which don't state this
// convention): this exact matrix is genuinely non-degenerate and
// genuinely vertical, but maps gradientStops position 0 to the BOTTOM
// and position 1 to the TOP — the opposite of what the position numbers
// alone would suggest. hexStopsToGradientPaint below compensates by
// reversing stop order for the "down" direction (CSS's default, and by
// far the most common real case — a photo's bottom-fade vignette) and
// leaving it natural for "up", rather than hunting for a different
// matrix that maps position 0 to the top directly — confirmed live that
// two independent attempts at such a matrix either degenerated to a
// flat color (a singular matrix — determinant zero) or produced the
// same inverted result as this one, so reversing stops against this
// verified-working matrix was more reliable than continuing to guess at
// the transform itself.
const VERTICAL_GRADIENT_TRANSFORM = [
  [0, -1, 1],
  [1, 0, 0],
];
const MAX_LAYER_ELEMENTS = 500; // align with capture MAX_TREE_NODES — mega-lists must not drop siblings silently

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// The export file is user-editable JSON and may come from an older/newer
// Harvest version, so every value pulled from `item.data` is treated as
// untrusted input here — anything that isn't a finite number in range
// falls back to a safe default instead of producing NaN/undefined, which
// the Figma API throws on (killing the whole import, not just one card).
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

// Like safeDimension, but 0 is a legitimate value (e.g. a square corner
// radius), so it can't use the ">0" rule that dimensions use.
function safeNonNegative(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Layer x/y are offsets from the component's own top-left and may
// legitimately be 0 or (rarely, from rounding) slightly negative.
function safeCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Layers give plain "#RRGGBB"/"#RGB" hex strings rather than the {r,g,b}
// objects the top-level color item type uses. Untrusted input (hand-edited
// or from a different Harvest version) — anything that doesn't parse
// cleanly returns null so callers can fall back to a neutral color instead
// of feeding NaN into a Figma paint.
function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const num = parseInt(h, 16);
  return { r: ((num >> 16) & 255) / 255, g: ((num >> 8) & 255) / 255, b: (num & 255) / 255 };
}

// `direction` defaults to "right" — the existing, always-horizontal
// behavior every OTHER call site still relies on (the `layers`/font/color
// paths never captured a real direction and are left exactly as they
// were). Only the layoutTree path (buildTreeNode) passes a real captured
// direction. See VERTICAL_GRADIENT_TRANSFORM above for why "down"
// reverses stop order instead of using a different matrix.
// Each entry in `hexStops` is either a bare hex string (the older shape,
// still used by the font/legacy-rect call sites below, which never had
// alpha info to carry) or a { hex, a } object (content.js's
// parseGradientStopsWithAlpha, used by the real layoutTree component
// path) — accepting both means a transparent-to-opaque fade (a photo's
// legibility scrim, the common real case) keeps its transparent stop
// transparent instead of every stop silently becoming fully opaque,
// which is what previously turned that kind of fade into a flat black
// rectangle.
function hexStopsToGradientPaint(hexStops, direction, gradientType) {
  const valid = (Array.isArray(hexStops) ? hexStops : [])
    .map((s, i, arr) => {
      const rgb = hexToRgb(typeof s === "string" ? s : s && s.hex);
      if (!rgb) return null;
      const a = typeof s === "object" && s && typeof s.a === "number" ? safeOpacity(s.a) : 1;
      const position =
        typeof s === "object" && s && typeof s.position === "number"
          ? Math.max(0, Math.min(1, s.position))
          : i / Math.max(1, arr.length - 1);
      return { r: rgb.r, g: rgb.g, b: rgb.b, a, position };
    })
    .filter(Boolean);
  if (valid.length < 2) return null;

  const type =
    gradientType === "radial"
      ? "GRADIENT_RADIAL"
      : gradientType === "angular"
        ? "GRADIENT_ANGULAR"
        : "GRADIENT_LINEAR";

  if (type === "GRADIENT_RADIAL") {
    // Centered radial — Figma default radial transform.
    return {
      type: "GRADIENT_RADIAL",
      gradientTransform: [
        [0.5, 0, 0.5],
        [0, 0.5, 0.5],
      ],
      gradientStops: valid.map((c) => ({
        position: c.position,
        color: { r: c.r, g: c.g, b: c.b, a: c.a },
      })),
    };
  }
  if (type === "GRADIENT_ANGULAR") {
    return {
      type: "GRADIENT_ANGULAR",
      gradientTransform: [
        [0.5, 0, 0.5],
        [0, 0.5, 0.5],
      ],
      gradientStops: valid.map((c) => ({
        position: c.position,
        color: { r: c.r, g: c.g, b: c.b, a: c.a },
      })),
    };
  }

  const isVertical = direction === "up" || direction === "down";
  const transform = isVertical ? VERTICAL_GRADIENT_TRANSFORM : HORIZONTAL_GRADIENT_TRANSFORM;
  const ordered = direction === "down" || direction === "left" ? valid.slice().reverse() : valid;
  return {
    type: "GRADIENT_LINEAR",
    gradientTransform: transform,
    gradientStops: ordered.map((c, i) => ({
      position: i / Math.max(1, ordered.length - 1),
      color: { r: c.r, g: c.g, b: c.b, a: c.a },
    })),
  };
}

function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Harvest stores gradientStops as the raw CSS `background-image` string
// (e.g. "linear-gradient(90deg, rgb(255,0,0) 0%, rgb(0,0,255) 100%)"), not
// a structured stop list — so we extract the rgb()/rgba() literals in the
// order they appear, same approach Harvest's own shared.js uses.
function parseGradientStopsFromCss(cssString) {
  if (typeof cssString !== "string" || !cssString) return [];
  const matches = cssString.match(/rgba?\([^)]+\)/g) || [];
  return matches.map((m) => {
    const nums = (m.match(/[\d.]+/g) || []).map(Number);
    return {
      r: safeColorChannel(nums[0]),
      g: safeColorChannel(nums[1]),
      b: safeColorChannel(nums[2]),
      a: safeOpacity(nums.length > 3 ? nums[3] : 1),
    };
  });
}

// Standard numeric-weight → style-name mapping (the same one Google Fonts
// itself uses, and what Figma expects for any Google Font family — which
// covers most real captures: DM Sans, DM Mono, PT Serif, Inter, Roboto,
// Open Sans, etc. are all built into every Figma file with zero local
// install needed, so a load failure here is almost always a STYLE NAME
// mismatch, not a genuinely unavailable font). Researched against
// html.to.design's own documented approach (see chat) — real HTML→Figma
// tools treat correct font loading as one of exactly two pillars that
// prevent text collisions (the other being full Auto Layout, out of scope
// here); silently falling back to Inter on the first miss, as this used
// to do, changes the text's rendered width and directly causes the
// reflow/overlap bug reported live. Trying every plausible name for the
// requested weight BEFORE giving up costs nothing (loadFontAsync on a
// nonexistent style just rejects fast) and meaningfully raises the odds
// of loading the REAL family instead of silently substituting a different
// one with different metrics.
const WEIGHT_STYLE_NAMES = {
  100: ["Thin", "Hairline"],
  200: ["ExtraLight", "Extra Light", "UltraLight", "Ultra Light"],
  300: ["Light"],
  400: ["Regular", "Normal", "Book"],
  500: ["Medium"],
  600: ["SemiBold", "Semi Bold", "DemiBold", "Demi Bold"],
  700: ["Bold"],
  800: ["ExtraBold", "Extra Bold", "UltraBold", "Ultra Bold", "Heavy"],
  900: ["Black", "Heavy"],
};
// The nearest defined weight bucket, not just the exact one — a font-
// weight of 450 or 550 (real values some sites use) should still try
// "Regular"/"Medium" first rather than skipping straight to a distant
// fallback name that's less likely to exist.
function nearestWeightBucket(w) {
  const buckets = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  return buckets.reduce((best, b) => (Math.abs(b - w) < Math.abs(best - w) ? b : best), 400);
}
async function loadFontForWeight(family, weight, italic) {
  const w = parseInt(weight, 10) || 400;
  const bucket = nearestWeightBucket(w);
  const styleNames = WEIGHT_STYLE_NAMES[bucket] || ["Regular"];
  const candidates = [];
  if (italic) {
    for (const style of styleNames) {
      if (style === "Regular" || style === "Normal" || style === "Book") {
        candidates.push({ family, style: "Italic" });
      } else {
        candidates.push({ family, style: `${style} Italic` });
        candidates.push({ family, style: `${style}Italic` });
      }
    }
    candidates.push({ family, style: "Italic" }, { family, style: "Bold Italic" });
  }
  for (const style of styleNames) candidates.push({ family, style });
  // 400 and 700 are by far the most common real-world weights and the
  // ones every Google Font family is guaranteed to have — worth trying
  // even if the requested weight bucket was something else, before
  // giving up on the real family entirely.
  candidates.push({ family, style: "Regular" }, { family, style: "Bold" });
  candidates.push(FALLBACK_FONT);
  for (const candidate of candidates) {
    try {
      await figma.loadFontAsync(candidate);
      return candidate;
    } catch (e) {
      // try the next candidate
    }
  }
  return null;
}

async function makeCaption(text) {
  const node = figma.createText();
  await figma.loadFontAsync(FALLBACK_FONT);
  node.fontName = FALLBACK_FONT;
  node.fontSize = 11;
  node.fills = [{ type: "SOLID", color: CAPTION_COLOR }];
  node.characters = text;
  node.textAutoResize = "HEIGHT";
  node.resize(CARD_CONTENT_WIDTH, node.height);
  return node;
}

function makeCard(name) {
  const card = figma.createFrame();
  card.name = name;
  card.layoutMode = "VERTICAL";
  card.primaryAxisSizingMode = "AUTO";
  card.counterAxisSizingMode = "AUTO";
  card.itemSpacing = 8;
  card.paddingTop = 16;
  card.paddingBottom = 16;
  card.paddingLeft = 16;
  card.paddingRight = 16;
  card.fills = [{ type: "SOLID", color: CARD_FILL }];
  card.strokes = [{ type: "SOLID", color: CARD_STROKE }];
  card.strokeWeight = 1;
  card.cornerRadius = 8;
  return card;
}

async function buildColorCard(item) {
  const data = item.data || {};
  const card = makeCard(`Color — ${data.hex || "?"}`);

  const swatch = figma.createRectangle();
  swatch.resize(CARD_CONTENT_WIDTH, 100);
  swatch.cornerRadius = 4;

  if (data.isGradient) {
    const stops = parseGradientStopsFromCss(data.gradientStops);
    const paint =
      stops.length >= 2
        ? {
            type: "GRADIENT_LINEAR",
            gradientTransform: IDENTITY_GRADIENT_TRANSFORM,
            gradientStops: stops.map((s, i) => ({
              position: stops.length === 1 ? 0 : i / (stops.length - 1),
              color: { r: s.r, g: s.g, b: s.b, a: s.a },
            })),
          }
        : { type: "SOLID", color: { r: 0.8, g: 0.8, b: 0.8 } };
    swatch.fills = [paint];
  } else {
    const rgb = data.rgb || {};
    swatch.fills = [
      {
        type: "SOLID",
        color: {
          r: safeColorChannel(rgb.r),
          g: safeColorChannel(rgb.g),
          b: safeColorChannel(rgb.b),
        },
        opacity: safeOpacity(data.alpha),
      },
    ];
  }

  card.appendChild(swatch);
  card.appendChild(await makeCaption(data.isGradient ? "Gradient" : data.hex || "Color"));
  return card;
}

async function buildFontCard(item) {
  const data = item.data || {};
  const card = makeCard(`Font — ${data.family || "?"}`);

  const font = await loadFontForWeight(data.family || "Inter", data.weight);
  const sample = figma.createText();
  if (font) sample.fontName = font;
  sample.fontSize = clamp(data.sizePx || 16, 8, 96);
  if (data.letterSpacingPx) sample.letterSpacing = { value: data.letterSpacingPx, unit: "PIXELS" };
  if (data.lineHeightPx) sample.lineHeight = { value: data.lineHeightPx, unit: "PIXELS" };
  const sampleText = typeof data.sampleText === "string" ? data.sampleText.trim() : "";
  const familyText = typeof data.family === "string" ? data.family : "";
  sample.characters = sampleText || familyText || "Sample text";

  const textRgb =
    (data.colorRgb && {
      r: safeColorChannel(data.colorRgb.r),
      g: safeColorChannel(data.colorRgb.g),
      b: safeColorChannel(data.colorRgb.b),
    }) ||
    hexToRgb(data.colorHex);
  if (textRgb) {
    sample.fills = [
      {
        type: "SOLID",
        color: textRgb,
        opacity: safeOpacity(data.colorAlpha),
      },
    ];
  }

  // A "Button" (or any text element with a real captured background/
  // border — Harvest now saves this for every font item, not just ones
  // tagged "button") is a real on-page shape, not just typography. Wrap
  // the text in a real, editable frame with the captured fill/border/
  // radius instead of dropping straight to a bare text node — the same
  // "real editable node at its real appearance" standard the `layers`
  // path already holds components to.
  const gradientPaint = hexStopsToGradientPaint(data.backgroundGradientStops);
  const hasBox = Boolean(gradientPaint || data.backgroundHex || data.borderColorHex);
  if (hasBox && data.boundingBoxWidth > 0 && data.boundingBoxHeight > 0) {
    const boxScale = Math.min(1, CARD_CONTENT_WIDTH / data.boundingBoxWidth);
    const boxW = Math.max(1, Math.round(data.boundingBoxWidth * boxScale));
    const boxH = Math.max(1, Math.round(data.boundingBoxHeight * boxScale));
    const box = figma.createFrame();
    box.name = "Captured shape";
    box.layoutMode = "HORIZONTAL";
    box.primaryAxisAlignItems = "CENTER";
    box.counterAxisAlignItems = "CENTER";
    box.primaryAxisSizingMode = "FIXED";
    box.counterAxisSizingMode = "FIXED";
    box.resize(boxW, boxH);
    box.cornerRadius = safeNonNegative(data.borderRadius, 0) * boxScale;
    box.fills = gradientPaint
      ? [gradientPaint]
      : data.backgroundHex
      ? [{ type: "SOLID", color: hexToRgb(data.backgroundHex) || { r: 1, g: 1, b: 1 }, opacity: safeOpacity(data.backgroundAlpha) }]
      : [];
    if (data.borderColorHex && data.borderWidthPx) {
      box.strokes = [{ type: "SOLID", color: hexToRgb(data.borderColorHex) || { r: 0, g: 0, b: 0 } }];
      box.strokeWeight = Math.max(1, Math.round(data.borderWidthPx * boxScale));
    }
    sample.textAutoResize = "WIDTH_AND_HEIGHT";
    box.appendChild(sample);
    card.appendChild(box);
  } else {
    sample.textAutoResize = "HEIGHT";
    sample.resize(CARD_CONTENT_WIDTH, sample.height);
    card.appendChild(sample);
  }

  const info = `${data.family || "Unknown"} · ${data.weight || "400"} · ${Math.round(data.sizePx || 0)}px${font ? "" : " (font unavailable, showing fallback)"}`;
  card.appendChild(await makeCaption(info));
  return card;
}

async function buildImageCard(item) {
  const data = item.data || {};
  const card = makeCard(`Image — ${data.altText || data.format || "untitled"}`);

  if (data.inlineDataUrl) {
    const image = figma.createImage(dataUrlToBytes(data.inlineDataUrl));
    const w = safeDimension(data.width, 300);
    const h = safeDimension(data.height, 200);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(w, h));
    const rect = figma.createRectangle();
    rect.resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    rect.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: image.hash }];
    card.appendChild(rect);
    card.appendChild(await makeCaption(data.altText || `${Math.round(w)}×${Math.round(h)}`));
  } else {
    const placeholder = figma.createRectangle();
    placeholder.resize(CARD_CONTENT_WIDTH, 120);
    placeholder.fills = [{ type: "SOLID", color: { r: 0.93, g: 0.93, b: 0.93 } }];
    card.appendChild(placeholder);
    card.appendChild(await makeCaption("Image unavailable — original fetch failed at export time"));
  }
  return card;
}

function buildRectLayerNode(layer, scale) {
  const node = figma.createRectangle();
  const w = Math.max(1, Math.round(safeDimension(layer.width, 10) * scale));
  const h = Math.max(1, Math.round(safeDimension(layer.height, 10) * scale));
  node.resize(w, h);
  node.cornerRadius = safeNonNegative(layer.radius, 0) * scale;

  const gradientPaint = hexStopsToGradientPaint(layer.gradientStops);
  const paint = gradientPaint || { type: "SOLID", color: hexToRgb(layer.fill) || PLACEHOLDER_FILL };
  node.fills = [{ ...paint, opacity: safeOpacity(layer.opacity) }];
  return node;
}

async function buildTextLayerNode(layer, scale) {
  const node = figma.createText();
  const family = typeof layer.fontFamily === "string" && layer.fontFamily ? layer.fontFamily : "Inter";
  const italic = layer.fontStyle === "italic" || /italic/i.test(String(layer.fontStyle || ""));
  const font = await loadFontForWeight(family, layer.fontWeight, italic);
  if (font) node.fontName = font;

  node.fontSize = clamp(safeDimension(layer.fontSizePx, 16) * scale, 1, 400);
  const lineHeightPx = Number(layer.lineHeightPx);
  if (Number.isFinite(lineHeightPx) && lineHeightPx > 0) {
    node.lineHeight = { value: lineHeightPx * scale, unit: "PIXELS" };
  }
  const letterSpacingPx = Number(layer.letterSpacingPx);
  if (Number.isFinite(letterSpacingPx) && letterSpacingPx !== 0) {
    node.letterSpacing = { value: letterSpacingPx * scale, unit: "PIXELS" };
  }
  const deco = String(layer.textDecoration || "").toLowerCase();
  if (deco.includes("underline")) node.textDecoration = "UNDERLINE";
  else if (deco.includes("line-through")) node.textDecoration = "STRIKETHROUGH";
  node.textAlignHorizontal =
    { left: "LEFT", center: "CENTER", right: "RIGHT", justify: "JUSTIFIED" }[layer.textAlign] || "LEFT";
  node.fills = [{ type: "SOLID", color: hexToRgb(layer.color) || { r: 0.1, g: 0.1, b: 0.1 } }];
  // A CSS opacity below 1 on the source element (a de-emphasized label, a
  // fading state) — Figma's whole-node `opacity`, not a fill opacity, is
  // the direct equivalent; defaults to 1 (safeOpacity) when Harvest didn't
  // send one (older exports, before this field existed).
  node.opacity = safeOpacity(layer.opacity);

  // Fixed width, auto-growing height — not fixed width+height. The
  // captured width/height matched exactly how this text wrapped in its
  // ORIGINAL font; Figma frequently substitutes a fallback (the real font
  // usually isn't installed — see loadFontForWeight above), which renders
  // wider or narrower at the same pixel size and can push the same string
  // onto an extra line. With a fixed height that extra line has nowhere
  // to go but overlapping the next layer down (confirmed live: exactly
  // what turned "Automatic field mapping" — one line on the real page —
  // into two overlapping the paragraph below it in Figma). Auto-height
  // lets a wider substitute font grow the box instead of colliding with
  // whatever comes after it; height is still the right dimension to make
  // flexible here since layers already paint in back-to-front order, so a
  // taller text node pushes forward, not backward, into anything painted
  // after it.
  //
  // Order matters here in a way that isn't obvious from the Plugin API
  // docs, and got this exactly backwards before: `textAutoResize` MUST be
  // set AFTER `.characters`, not before. Setting it first (as this used
  // to do) leaves `node.height` silently stuck at whatever `resize()`
  // seeded it to — Figma still PAINTS the text wrapped correctly
  // regardless, but the plugin API's own `.height` property never catches
  // up, which is invisible right up until something else (a manual
  // parent-frame resize, a later measurement) reads that height and gets
  // a stale number. Verified live: with the old order, a real substituted
  // string that needed 212px reported `.height` as 85 — its ORIGINAL
  // seed height — even after being appended to the page and rendered.
  // Reordering to characters-then-autoResize (confirmed live: same string
  // then correctly reports 212) is what actually makes `.height` usable
  // for anything downstream, including the absolute-mode frame-growth fix
  // right below in buildTreeNode, which depends on reading real child
  // heights to avoid overlapping whatever comes after it.
  const w = Math.max(1, Math.round(safeDimension(layer.width, 100) * scale));
  const seedH = Math.max(1, Math.round(safeDimension(layer.height, 20) * scale));
  node.resize(w, seedH);
  node.characters = typeof layer.text === "string" ? layer.text : "";
  node.textAutoResize = "HEIGHT";
  await applyTextRanges(node, layer.ranges, scale);
  // text-shadow → DROP_SHADOW on the TEXT node (Harvest now captures this).
  const textEffects = Array.isArray(layer.effects) && layer.effects.length
    ? layer.effects
    : layer.effect
      ? [layer.effect]
      : [];
  if (textEffects.length) {
    const mapped = [];
    for (const e of textEffects) {
      if (!e || typeof e !== "object") continue;
      const c = e.color || {};
      mapped.push({
        type: e.type === "INNER_SHADOW" ? "INNER_SHADOW" : "DROP_SHADOW",
        color: {
          r: safeColorChannel(c.r),
          g: safeColorChannel(c.g),
          b: safeColorChannel(c.b),
          a: safeOpacity(c.a),
        },
        offset: {
          x: (Number(e.offsetX) || 0) * scale,
          y: (Number(e.offsetY) || 0) * scale,
        },
        radius: safeNonNegative(e.radius, 0) * scale,
        spread: safeNonNegative(e.spread, 0) * scale,
        visible: true,
        blendMode: "NORMAL",
      });
    }
    if (mapped.length) node.effects = mapped;
  }
  return node;
}

// Same-line multi-style runs from Harvest (`ranges`) — load each span's
// font then setRange*. Failures are swallowed per-range so one missing
// weight doesn't abort the whole text node.
async function applyTextRanges(node, ranges, scale) {
  if (!Array.isArray(ranges) || ranges.length === 0) return;
  const len = node.characters.length;
  if (len === 0) return;
  for (const range of ranges) {
    if (!range || typeof range !== "object") continue;
    const start = Math.max(0, Math.min(len, Math.floor(Number(range.start) || 0)));
    const end = Math.max(start, Math.min(len, Math.floor(Number(range.end) || 0)));
    if (end <= start) continue;
    try {
      const family =
        typeof range.fontFamily === "string" && range.fontFamily ? range.fontFamily : "Inter";
      const italic = range.fontStyle === "italic" || /italic/i.test(String(range.fontStyle || ""));
      const font = await loadFontForWeight(family, range.fontWeight, italic);
      if (font) node.setRangeFontName(start, end, font);
    } catch (e) {}
    try {
      const size = Number(range.fontSizePx);
      if (Number.isFinite(size) && size > 0) {
        node.setRangeFontSize(start, end, clamp(size * scale, 1, 400));
      }
    } catch (e) {}
    try {
      const rgb = hexToRgb(range.color);
      if (rgb) node.setRangeFills(start, end, [{ type: "SOLID", color: rgb }]);
    } catch (e) {}
    try {
      const ls = Number(range.letterSpacingPx);
      if (Number.isFinite(ls) && ls !== 0) {
        node.setRangeLetterSpacing(start, end, { value: ls * scale, unit: "PIXELS" });
      }
    } catch (e) {}
    try {
      const d = String(range.textDecoration || "").toLowerCase();
      if (d.includes("underline")) node.setRangeTextDecoration(start, end, "UNDERLINE");
      else if (d.includes("line-through")) node.setRangeTextDecoration(start, end, "STRIKETHROUGH");
    } catch (e) {}
  }
}

function buildPlaceholderLayerNode(layer, scale, name) {
  const node = figma.createRectangle();
  const w = Math.max(1, Math.round(safeDimension(layer.width, 10) * scale));
  const h = Math.max(1, Math.round(safeDimension(layer.height, 10) * scale));
  node.resize(w, h);
  node.fills = [{ type: "SOLID", color: PLACEHOLDER_FILL }];
  node.opacity = safeOpacity(layer.opacity);
  node.name = name;
  return node;
}

// Harvest's export step (sidepanel.js, already async) rasterizes captured
// SVG icons and fetches blocked image URLs into a data URL ahead of time —
// this is that data URL becoming a real Figma image fill instead of the
// flat gray PLACEHOLDER_FILL rect above. Wrapped in try/catch: an
// inlineDataUrl can be present but malformed (a failed rasterization that
// still produced a truncated string, for instance), and falling back to
// the placeholder beats aborting the whole import over one leaf's image.
function parseBgFocalPoint(posStr) {
  const p = String(posStr || "center").toLowerCase().trim();
  const kw = { left: 0, right: 1, center: 0.5, top: 0, bottom: 1 };
  const parts = p.split(/\s+/).filter(Boolean);
  let x = 0.5;
  let y = 0.5;
  function axis(token, isY) {
    if (token in kw) return kw[token];
    if (/%$/.test(token)) {
      const n = parseFloat(token);
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : isY ? y : x;
    }
    return isY ? y : x;
  }
  if (parts.length === 1) {
    if (parts[0] === "top" || parts[0] === "bottom") y = axis(parts[0], true);
    else x = axis(parts[0], false);
  } else if (parts.length >= 2) {
    x = axis(parts[0], false);
    y = axis(parts[1], true);
  }
  return { x, y };
}

function buildImageFillLayerNode(layer, scale, name) {
  const node = figma.createRectangle();
  const w = Math.max(1, Math.round(safeDimension(layer.width, 10) * scale));
  const h = Math.max(1, Math.round(safeDimension(layer.height, 10) * scale));
  node.resize(w, h);
  if (
    layer.radiusTL != null ||
    layer.radiusTR != null ||
    layer.radiusBR != null ||
    layer.radiusBL != null
  ) {
    node.topLeftRadius = safeNonNegative(layer.radiusTL, 0) * scale;
    node.topRightRadius = safeNonNegative(layer.radiusTR, 0) * scale;
    node.bottomRightRadius = safeNonNegative(layer.radiusBR, 0) * scale;
    node.bottomLeftRadius = safeNonNegative(layer.radiusBL, 0) * scale;
  } else {
    node.cornerRadius = safeNonNegative(layer.radius, 0) * scale;
  }
  const image = figma.createImage(dataUrlToBytes(layer.inlineDataUrl));
  const bgSize = String(layer.backgroundSize || "").toLowerCase();
  let scaleMode = bgSize === "contain" ? "FIT" : "FILL";
  const paint = { type: "IMAGE", scaleMode, imageHash: image.hash };
  const focal = parseBgFocalPoint(layer.backgroundPosition);
  if (scaleMode === "FILL" && (Math.abs(focal.x - 0.5) > 0.02 || Math.abs(focal.y - 0.5) > 0.02)) {
    // CROP + translate so non-center background-position isn't lost (heroes / cards).
    paint.scaleMode = "CROP";
    paint.imageTransform = [
      [1, 0, 0.5 - focal.x],
      [0, 1, 0.5 - focal.y],
    ];
  }
  node.fills = [paint];
  node.opacity = safeOpacity(layer.opacity);
  node.name = name;
  return node;
}

// --- New (v2) path: data.layoutTree — a nested tree, not a flat list ---
// Every real container in the captured DOM is its own frame node, carrying
// either a `layout` (VERTICAL/HORIZONTAL, gap, padding, alignment — set
// directly from flex/block-stack CSS Harvest could read with confidence)
// or `layout: null` (nothing confidently mapped, so children keep the old
// explicit x/y instead of risking a wrong auto-layout guess). Building
// REAL Figma Auto Layout frames for the `layout` case is what actually
// prevents collisions: Figma repositions auto-layout children itself when
// one of them changes size (a substituted font rendering wider and
// wrapping an extra line, for instance) — writing fixed x/y, the only
// thing the old flat `layers` format could do, can never achieve that.
// Researched directly against how html.to.design achieves collision-free
// imports (see chat) before building this.

const AXIS_ALIGN_PRIMARY = ["MIN", "MAX", "CENTER", "SPACE_BETWEEN"];
const AXIS_ALIGN_COUNTER = ["MIN", "MAX", "CENTER", "BASELINE"];
function safeEnum(value, allowed, fallback) {
  return allowed.indexOf(value) >= 0 ? value : fallback;
}

// layoutSizingHorizontal/Vertical apply only to auto-layout children —
// and "HUG" specifically only ever applies to TEXT nodes and auto-layout
// FRAMES (a plain rectangle has no content to size itself around), so a
// leaf sizing hint of HUG gets clamped to FIXED for anything that isn't
// text. Wrapped in try/catch on top of that because these properties can
// reject an unsupported combination at runtime and no Figma instance is
// reachable from this environment to verify every case ahead of time —
// failing closed to FIXED (the old, always-safe behavior) beats a thrown
// error aborting the whole import over one node's sizing.
function applyChildSizing(childNode, sizing) {
  const isText = childNode.type === "TEXT";
  const h = (sizing && sizing.horizontal) || "FIXED";
  let v = (sizing && sizing.vertical) || "FIXED";
  if (!isText && v === "HUG") v = "FIXED";
  try {
    childNode.layoutSizingHorizontal = h;
  } catch (e) {
    try {
      childNode.layoutSizingHorizontal = "FIXED";
    } catch (e2) {}
  }
  try {
    childNode.layoutSizingVertical = v;
  } catch (e) {
    try {
      childNode.layoutSizingVertical = "FIXED";
    } catch (e2) {}
  }
}

// CSS rotate(Ndeg) from Harvest — Figma uses degrees. Applied after
// appendChild so Auto Layout has already claimed the child; still set
// when the parent is AL and the child is in-flow (not only absolute).
function applyNodeTransform(figmaNode, dataNode) {
  const t = dataNode && dataNode.transform;
  if (t && t.matrix && typeof t.matrix.a === "number") {
    const m = t.matrix;
    const x = figmaNode.x;
    const y = figmaNode.y;
    const trivialScale =
      Math.abs((t.scaleX || 1) - 1) < 0.02 && Math.abs((t.scaleY || 1) - 1) < 0.02;
    const trivialSkew = Math.abs(m.b) < 0.02 && Math.abs(m.c) < 0.02;
    if (trivialScale && trivialSkew) {
      const deg = Number(t.rotationDeg != null ? t.rotationDeg : dataNode.rotationDeg);
      if (Number.isFinite(deg) && Math.abs(deg) > 0.01) {
        try {
          figmaNode.rotation = deg;
        } catch (e) {}
      }
      return;
    }
    // Full matrix: keep visual top-left (x,y from capture) and apply linear part.
    try {
      figmaNode.relativeTransform = [
        [m.a, m.c, x],
        [m.b, m.d, y],
      ];
    } catch (e) {
      applyNodeRotation(figmaNode, dataNode);
    }
    return;
  }
  applyNodeRotation(figmaNode, dataNode);
}

function applyNodeRotation(figmaNode, dataNode) {
  const deg = Number(dataNode && dataNode.rotationDeg);
  if (!Number.isFinite(deg) || deg === 0) return;
  try {
    figmaNode.rotation = deg;
  } catch (e) {}
}

// A Figma node's own `.width`/`.height` can UNDERSTATE its true visual
// extent: a HUG child can render wider/taller than a FIXED-sized parent
// without the parent's own reported size ever reflecting that overflow
// (confirmed live: a HUG text node measured 168px inside a 127px
// FIXED-width parent, and the parent still reported 127 — Figma simply
// lets the child paint outside the parent's own box rather than
// resizing it or clipping it). This is invisible right up until
// something reads a node's `.width`/`.height` to avoid overlapping
// content NEXT TO it — which is exactly what the absolute-mode and
// counter-axis-growth corrections above do. Confirmed live: a captured
// heading with three separate siblings ("Catch breaks" / "before" /
// "customers do", real inline text wrapping the site's own CSS Grid/flex
// detection correctly declined to guess at) still overlapped even after
// gating counter-axis growth by `parentIsAutoLayout`, because the
// OUTER absolute wrapper's overlap check trusted "Catch breaks"
// wrapper's reported 251px width — which was accurate for the WRAPPER
// itself, but not for the HUG text one level further inside it that was
// quietly rendering wider. Walking the real subtree and taking the max
// reachable extent — instead of trusting any single node's own
// `.width`/`.height` — propagates an overflow at ANY depth up to
// whichever ancestor is actually doing the overlap-avoidance math,
// regardless of how many pass-through wrapper levels sit in between.
function trueExtent(node) {
  let right = node.width;
  let bottom = node.height;
  const kids = node.children || [];
  for (const child of kids) {
    const childExtent = trueExtent(child);
    right = Math.max(right, child.x + childExtent.right);
    bottom = Math.max(bottom, child.y + childExtent.bottom);
  }
  return { right, bottom };
}

async function buildTreeLeafNode(node, scale) {
  if (node.kind === "text") return buildTextLayerNode(node, scale);
  if (node.kind === "image") {
    if (node.inlineDataUrl) {
      try {
        return buildImageFillLayerNode(node, scale, "Image");
      } catch (e) {}
    }
    return buildPlaceholderLayerNode(node, scale, "Image (unavailable — external URL, no network access)");
  }
  if (node.kind === "icon-placeholder") {
    if (node.inlineDataUrl) {
      try {
        return buildImageFillLayerNode(node, scale, "Icon");
      } catch (e) {}
    }
    return buildPlaceholderLayerNode(node, scale, "Icon/illustration (not rasterized)");
  }
  return null;
}

// `parentIsAutoLayout` — whether the frame calling this one for a child
// positions that child via REAL Auto Layout (`applyChildSizing`, which
// recomputes sibling positions when a child's size changes) rather than
// frozen `x`/`y` copied from the original capture. Only matters for the
// counter-axis-growth correction far below: growing a frame to fit an
// overflowing child is safe and necessary when a real Auto Layout parent
// will reflow around the new size, but actively HARMFUL when the parent
// is absolute-positioned (`layout: null`) — confirmed live: a heading
// like "Catch breaks" / "before" / "customers do", three separate
// siblings each pinned to their own captured x/y inside an absolute
// wrapper (real inline text wrapping — CSS Grid/flex detection correctly
// declined to guess at this), had "Catch breaks" grow wider via this
// same correction and collide with "before" sitting at its own frozen
// offset, which has no way to know its sibling changed size. Absent
// (root call) is treated as safe/true — the root's real container is
// `card` in buildComponentCardFromTree, which does hug to match it.
async function buildTreeNode(node, scale, parentIsAutoLayout) {
  if (!node || typeof node !== "object") return null;
  if (node.kind !== "frame") {
    try {
      return await buildTreeLeafNode(node, scale);
    } catch (e) {
      return null;
    }
  }

  const frame = figma.createFrame();
  const w = Math.max(1, Math.round(safeDimension(node.width, 10) * scale));
  const h = Math.max(1, Math.round(safeDimension(node.height, 10) * scale));
  frame.resize(w, h);
  if (
    node.radiusTL != null ||
    node.radiusTR != null ||
    node.radiusBR != null ||
    node.radiusBL != null
  ) {
    frame.topLeftRadius = safeNonNegative(node.radiusTL, 0) * scale;
    frame.topRightRadius = safeNonNegative(node.radiusTR, 0) * scale;
    frame.bottomRightRadius = safeNonNegative(node.radiusBR, 0) * scale;
    frame.bottomLeftRadius = safeNonNegative(node.radiusBL, 0) * scale;
  } else {
    frame.cornerRadius = safeNonNegative(node.radius, 0) * scale;
  }

  const gradientPaint = hexStopsToGradientPaint(
    node.gradientStops,
    node.gradientDirection,
    node.gradientType
  );
  if (gradientPaint) {
    frame.fills = [{ ...gradientPaint, opacity: safeOpacity(node.fillOpacity) }];
  } else if (node.fill) {
    frame.fills = [{ type: "SOLID", color: hexToRgb(node.fill) || { r: 1, g: 1, b: 1 }, opacity: safeOpacity(node.fillOpacity) }];
  } else {
    frame.fills = [];
  }
  // The element's own whole-box CSS opacity (already the fully-cascaded
  // value — see content.js) — separate from fillOpacity above, which only
  // ever dims the fill itself, never this frame's children.
  frame.opacity = safeOpacity(node.opacity);
  frame.clipsContent = Boolean(node.clipsContent);

  if (node.stroke && Number(node.strokeWeight) > 0) {
    const strokeRgb = hexToRgb(node.stroke.hex) || { r: 0, g: 0, b: 0 };
    frame.strokes = [{ type: "SOLID", color: strokeRgb, opacity: safeOpacity(node.stroke.a) }];
    frame.strokeWeight = safeNonNegative(node.strokeWeight, 0) * scale;
  }

  if (Array.isArray(node.effects) && node.effects.length > 0) {
    const mapped = [];
    for (const e of node.effects) {
      if (!e || typeof e !== "object") continue;
      if (e.type === "LAYER_BLUR") {
        mapped.push({
          type: "LAYER_BLUR",
          radius: safeNonNegative(e.radius, 0) * scale,
          visible: true,
        });
        continue;
      }
      const c = e.color || {};
      mapped.push({
        type: e.type === "INNER_SHADOW" ? "INNER_SHADOW" : "DROP_SHADOW",
        color: {
          r: safeColorChannel(c.r),
          g: safeColorChannel(c.g),
          b: safeColorChannel(c.b),
          a: safeOpacity(c.a),
        },
        offset: {
          x: (Number(e.offsetX) || 0) * scale,
          y: (Number(e.offsetY) || 0) * scale,
        },
        radius: safeNonNegative(e.radius, 0) * scale,
        spread: safeNonNegative(e.spread, 0) * scale,
        visible: true,
        blendMode: "NORMAL",
      });
    }
    if (mapped.length) frame.effects = mapped;
  } else if (node.effect && typeof node.effect === "object") {
    const e = node.effect;
    const c = e.color || {};
    frame.effects = [
      {
        type: "DROP_SHADOW",
        color: {
          r: safeColorChannel(c.r),
          g: safeColorChannel(c.g),
          b: safeColorChannel(c.b),
          a: safeOpacity(c.a),
        },
        offset: {
          x: (Number(e.offsetX) || 0) * scale,
          y: (Number(e.offsetY) || 0) * scale,
        },
        radius: safeNonNegative(e.radius, 0) * scale,
        spread: safeNonNegative(e.spread, 0) * scale,
        visible: true,
        blendMode: "NORMAL",
      },
    ];
  }

  const layout = node.layout;
  if (layout) {
    frame.layoutMode = layout.mode === "HORIZONTAL" ? "HORIZONTAL" : "VERTICAL";
    frame.itemSpacing = safeNonNegative(layout.gap, 0) * scale;
    frame.paddingTop = safeNonNegative(layout.paddingTop, 0) * scale;
    frame.paddingRight = safeNonNegative(layout.paddingRight, 0) * scale;
    frame.paddingBottom = safeNonNegative(layout.paddingBottom, 0) * scale;
    frame.paddingLeft = safeNonNegative(layout.paddingLeft, 0) * scale;
    frame.primaryAxisAlignItems = safeEnum(layout.primaryAlign, AXIS_ALIGN_PRIMARY, "MIN");
    frame.counterAxisAlignItems = safeEnum(layout.counterAlign, AXIS_ALIGN_COUNTER, "MIN");
    // Whether to hug the stacking axis or keep the captured size — read
    // directly from Harvest's own `primarySizing` decision (see
    // content.js's extractComponentLayers for the full reasoning: VERTICAL
    // always hugs; HORIZONTAL only hugs when its subtree actually contains
    // text that might need room to grow, e.g. a button label — a small
    // icon-centering badge never does and must stay at its real captured
    // size or it collapses to its icon's own width). `layout.primarySizing`
    // is absent on an export made before Harvest computed this — default
    // to "AUTO" (the original, pre-this-fix behavior) for that case rather
    // than silently changing how an older export renders.
    frame.primaryAxisSizingMode = layout.primarySizing === "FIXED" ? "FIXED" : "AUTO";
    frame.counterAxisSizingMode = "FIXED";
    if (layout.wrap) {
      try {
        frame.layoutWrap = "WRAP";
      } catch (e) {}
      const counterGap = layout.counterGap != null ? layout.counterGap : layout.gap;
      try {
        frame.counterAxisSpacing = safeNonNegative(counterGap, 0) * scale;
      } catch (e) {}
    }
  }

  const children = Array.isArray(node.children) ? node.children.slice(0, MAX_LAYER_ELEMENTS) : [];
  for (const child of children) {
    if (!child || typeof child !== "object") continue;
    let childNode = null;
    try {
      childNode = await buildTreeNode(child, scale, Boolean(layout));
    } catch (e) {
      childNode = null;
    }
    if (!childNode) continue;
    frame.appendChild(childNode);
    // Rotation after append so AL has claimed the child; still set for
    // in-flow (non-absolute) AL children and absolute kids alike.
    applyNodeTransform(childNode, child);
    if (layout) {
      if (child.positioning === "ABSOLUTE") {
        try {
          childNode.layoutPositioning = "ABSOLUTE";
        } catch (e) {}
        childNode.x = Math.round(safeCoord(child.x) * scale);
        childNode.y = Math.round(safeCoord(child.y) * scale);
      } else {
        // A nested frame child defaults to keeping its own captured size
        // (FIXED) rather than stretching/hugging — blindly filling it to
        // the parent's width would distort a sub-card that was genuinely
        // narrower than its container on the real page. A frame CAN carry
        // its own `sizing` now, though — Harvest sets one specifically for
        // a trivial single-text-child wrapper (a <button>/<a> label, a
        // <h3>/<p>), matching the same inline-vs-block distinction real CSS
        // makes: an inline label should HUG (so a wider substituted font
        // grows the whole pill instead of wrapping the label — confirmed
        // live: exactly what fixed a real Glean button that was wrapping to
        // 2 lines), a block heading/paragraph keeps FILL (stretch to match
        // siblings, wrap naturally — already correct). A generic nested
        // section still has no sizing of its own and falls back to FIXED —
        // unless stretchChildren (align-items:stretch) asks for counter-axis FILL.
        let sizingHint = child.sizing;
        if (!sizingHint && layout.stretchChildren) {
          sizingHint =
            layout.mode === "VERTICAL"
              ? { horizontal: "FILL", vertical: "FIXED" }
              : { horizontal: "FIXED", vertical: "FILL" };
        }
        applyChildSizing(
          childNode,
          child.kind === "frame" ? sizingHint || { horizontal: "FIXED", vertical: "FIXED" } : sizingHint
        );
        if (child.layoutGrow) {
          try {
            childNode.layoutGrow = 1;
          } catch (e) {}
        }
      }
    } else {
      childNode.x = Math.round(safeCoord(child.x) * scale);
      childNode.y = Math.round(safeCoord(child.y) * scale);
    }
  }

  // Absolute mode (`!layout`) only: a text child can render TALLER (or
  // wider) than it was captured at, because a substituted font rarely
  // matches the original's exact metrics — textAutoResize:"HEIGHT" lets
  // the TEXT NODE ITSELF grow for this, but this WRAPPER frame's own
  // captured w/h never adapts on its own, so a real font-substitution
  // case reliably overflowed this frame's bottom/right edge and
  // overlapped whatever came after it (confirmed live: a hero heading's
  // wrapper, captured at 141px tall, needed 180px once its real absolute
  // children were placed — the paragraph right after it in a real
  // Auto-Layout ancestor started at the OLD 141px regardless, landing
  // squarely on top of the heading's true, taller content). Figma's own
  // `layoutPositioning:"ABSOLUTE"` escape hatch was tried and does NOT
  // help here — verified live that a parent's hug computation excludes
  // absolutely-positioned children entirely (the same as real CSS
  // position:absolute), so an auto-layout wrapper around absolute
  // children never actually grows to fit them. Measuring the real
  // children's union AFTER they're placed and manually resizing this
  // frame to match — done here, purely in JS, no Figma auto-sizing
  // involved — is what actually works: verified live that a later
  // sibling in a real VERTICAL Auto-Layout ancestor correctly starts
  // right after this frame's NEW, grown height, with zero overlap.
  // This frame isn't appended to its own parent yet at this point (that
  // happens in the CALLER, right after buildTreeNode returns), so
  // layoutSizingHorizontal/Vertical aren't meaningfully set on it yet —
  // the caller's own applyChildSizing call sets them correctly afterward
  // regardless of anything resize() does here, nothing to preserve.
  if (!layout && frame.children.length > 0) {
    let maxRight = frame.width;
    let maxBottom = frame.height;
    for (const child of frame.children) {
      const childExtent = trueExtent(child);
      maxRight = Math.max(maxRight, child.x + childExtent.right);
      maxBottom = Math.max(maxBottom, child.y + childExtent.bottom);
    }
    if (maxRight > frame.width || maxBottom > frame.height) {
      frame.resize(maxRight, maxBottom);
    }
  }

  // Auto-layout frames (`layout` truthy) only: the PRIMARY axis already
  // grows itself correctly via `primaryAxisSizingMode` above when
  // `layout.primarySizing` says to. The COUNTER axis, though, is always
  // kept FIXED at the captured size — deliberately, so a card doesn't
  // randomly widen just because its content changed in a way that's
  // normally supposed to WRAP, not grow the container (a paragraph's text
  // child requests FILL specifically so IT stretches to match a stable
  // parent width and wraps naturally there — letting the parent hug to
  // fit the text instead would collapse that wrapping into one long
  // line). But a FIXED-sized child that independently grew on its OWN
  // primary axis (e.g. a button frame whose own width hugged wider to
  // fit a longer substituted-font label) has nowhere to put that extra
  // width on ITS side — this wrapper's counter axis stays exactly at the
  // captured size regardless, so the child visually overflows it, and
  // worse: a LATER SIBLING positioned by this wrapper's own parent lands
  // using this wrapper's stale, too-small size — confirmed live: a
  // "WATCH VIDEO" button ended up sitting squarely on top of a "REQUEST
  // DEMO" button whose own inner button frame had genuinely grown wider
  // than the plain pass-through wrapper directly around it. Growing the
  // counter axis specifically when a child's real rendered extent
  // exceeds it — never shrinking it, and never touching the primary
  // axis (already correctly self-managed) — fixes this without the risk
  // above: a FILL child is stretched to match this frame's width BY
  // FIGMA ITSELF and can never exceed it (so this never fires for the
  // paragraph-wrapping case), and a real icon inside a fixed-size badge
  // is smaller than its badge and never overflows it either.
  if (layout && parentIsAutoLayout !== false && frame.children.length > 0) {
    const isVertical = frame.layoutMode === "VERTICAL";
    let maxRight = frame.width;
    let maxBottom = frame.height;
    for (const child of frame.children) {
      const childExtent = trueExtent(child);
      maxRight = Math.max(maxRight, child.x + childExtent.right);
      maxBottom = Math.max(maxBottom, child.y + childExtent.bottom);
    }
    if (isVertical && maxRight > frame.width) {
      frame.resize(maxRight, frame.height);
      frame.primaryAxisSizingMode = layout.primarySizing === "FIXED" ? "FIXED" : "AUTO";
      frame.counterAxisSizingMode = "FIXED";
    } else if (!isVertical && maxBottom > frame.height) {
      frame.resize(frame.width, maxBottom);
      frame.primaryAxisSizingMode = layout.primarySizing === "FIXED" ? "FIXED" : "AUTO";
      frame.counterAxisSizingMode = "FIXED";
    }
  }

  return frame;
}

function countTreePayloadNodes(n) {
  if (!n) return 0;
  let c = 1;
  if (Array.isArray(n.children)) for (const ch of n.children) c += countTreePayloadNodes(ch);
  return c;
}

function figmaNodeHasVisibleContent(node) {
  if (!node) return false;
  if (node.type === "TEXT") return Boolean(node.characters && String(node.characters).trim());
  if (node.type === "RECTANGLE" || node.type === "ELLIPSE" || node.type === "VECTOR") {
    const fills = node.fills;
    if (Array.isArray(fills) && fills.some((f) => f && f.visible !== false && f.type === "IMAGE")) return true;
    if (Array.isArray(fills) && fills.some((f) => f && f.visible !== false && f.type === "SOLID")) return true;
    return false;
  }
  if ("children" in node && node.children && node.children.length > 0) {
    return node.children.some(figmaNodeHasVisibleContent);
  }
  // Empty frame — only counts if it has a non-transparent fill of its own
  try {
    const fills = node.fills;
    if (Array.isArray(fills) && fills.some((f) => f && f.visible !== false && (f.type === "SOLID" || f.type === "GRADIENT_LINEAR" || f.type === "GRADIENT_RADIAL" || f.type === "GRADIENT_ANGULAR" || f.type === "IMAGE"))) {
      return true;
    }
  } catch (_) {}
  return false;
}

async function buildComponentCardFromTree(item) {
  const data = item.data || {};
  const w = safeDimension(data.boundingBoxWidth, 300);
  const h = safeDimension(data.boundingBoxHeight, 200);
  const scale = Math.min(1, MAX_COMPONENT_DIMENSION / Math.max(w, h));

  // Screenshot ONLY when the tree is empty / flagged with nothing to rebuild.
  // Missing avatar pixels → gray image placeholders; text/buttons stay editable.
  const forceShot =
    data.preferScreenshot || (data.layoutTree && data.layoutTree.preferScreenshot);
  if (forceShot && data.previewImage && !layoutTreeHasUsefulLeaves(data.layoutTree)) {
    return buildComponentScreenshotCard(item, "screenshot — no editable structure");
  }

  const card = makeCard(`Component — ${Math.round(w)}×${Math.round(h)}`);
  let contentFrame = null;
  try {
    contentFrame = await buildTreeNode(data.layoutTree, scale);
    if (contentFrame && data.layoutTree) applyNodeTransform(contentFrame, data.layoutTree);
  } catch (e) {
    contentFrame = null;
  }

  if (contentFrame && !figmaNodeHasVisibleContent(contentFrame)) {
    contentFrame = null;
  }

  if (!contentFrame) {
    const layers = Array.isArray(data.layers) ? data.layers : [];
    if (layers.length > 0) {
      try {
        return await buildComponentCardLegacy(item);
      } catch (_) {
        // continue
      }
    }
    if (data.previewImage) {
      return buildComponentScreenshotCard(item, "screenshot — layout rebuild failed");
    }
    contentFrame = figma.createFrame();
    contentFrame.resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    contentFrame.fills = [{ type: "SOLID", color: { r: 0.93, g: 0.93, b: 0.93 } }];
  }
  contentFrame.name = "Captured layout";
  card.appendChild(contentFrame);

  const elementCount = countTreePayloadNodes(data.layoutTree) - 1;
  const caption =
    elementCount > 0
      ? `${Math.round(w)}×${Math.round(h)} · ${elementCount} element${elementCount === 1 ? "" : "s"} extracted${
          data.layersTruncated ? " (simplified — large component)" : ""
        }`
      : `${Math.round(w)}×${Math.round(h)} · structure unavailable`;
  card.appendChild(await makeCaption(caption));
  return card;
}

function layoutTreeHasUsefulLeaves(node) {
  if (!node || typeof node !== "object") return false;
  if (node.kind === "text" && node.text && String(node.text).trim()) return true;
  if (node.kind === "image" || node.kind === "icon-placeholder") return true;
  if (node.kind === "frame") {
    if (node.fill || (node.gradientStops && node.gradientStops.length)) return true;
    const kids = Array.isArray(node.children) ? node.children : [];
    return kids.some(layoutTreeHasUsefulLeaves);
  }
  return false;
}

// --- Legacy (v1) path: data.layers — a flat, position-snapshot list.
// Kept fully intact, unmodified from before this file gained the tree
// path above, so an export made before this change (already sitting on
// someone's disk) keeps importing exactly as it always did.
async function buildComponentCardLegacy(item) {
  const data = item.data || {};
  const w = safeDimension(data.boundingBoxWidth, 300);
  const h = safeDimension(data.boundingBoxHeight, 200);
  const scale = Math.min(1, MAX_COMPONENT_DIMENSION / Math.max(w, h));
  const frameW = Math.max(1, Math.round(w * scale));
  const frameH = Math.max(1, Math.round(h * scale));

  const card = makeCard(`Component — ${Math.round(w)}×${Math.round(h)}`);
  const contentFrame = figma.createFrame();
  contentFrame.name = "Captured layout";
  contentFrame.resize(frameW, frameH);
  contentFrame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  contentFrame.clipsContent = true;

  const layers = (Array.isArray(data.layers) ? data.layers : []).slice(0, MAX_LAYER_ELEMENTS);
  let built = 0;
  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue;
    let node = null;
    try {
      if (layer.kind === "rect") {
        node = buildRectLayerNode(layer, scale);
      } else if (layer.kind === "text") {
        node = await buildTextLayerNode(layer, scale);
      } else if (layer.kind === "image") {
        node = buildPlaceholderLayerNode(layer, scale, "Image (unavailable — external URL, no network access)");
      } else if (layer.kind === "icon-placeholder") {
        node = buildPlaceholderLayerNode(layer, scale, "Icon (not rasterized)");
      }
    } catch (e) {
      node = null;
    }
    if (!node) continue;
    // Append before positioning so x/y land in contentFrame's own local
    // space, which is exactly the component's top-left origin — the same
    // frame the captured coordinates are already relative to.
    contentFrame.appendChild(node);
    node.x = Math.round(safeCoord(layer.x) * scale);
    node.y = Math.round(safeCoord(layer.y) * scale);
    built++;
  }

  if (built === 0) {
    if (data.previewImage) {
      try {
        const image = figma.createImage(dataUrlToBytes(data.previewImage));
        contentFrame.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: image.hash }];
      } catch (e) {
        contentFrame.fills = [{ type: "SOLID", color: { r: 0.93, g: 0.93, b: 0.93 } }];
      }
    } else {
      contentFrame.fills = [{ type: "SOLID", color: { r: 0.93, g: 0.93, b: 0.93 } }];
    }
  }

  card.appendChild(contentFrame);
  const caption =
    built > 0
      ? `${Math.round(w)}×${Math.round(h)} · ${built} element${built === 1 ? "" : "s"} extracted${
          data.layersTruncated ? " (simplified — large component)" : ""
        }`
      : `${Math.round(w)}×${Math.round(h)} · paste the HTML into html.to.design for an editable version`;
  card.appendChild(await makeCaption(caption));
  return card;
}

// Prefer layoutTree → Auto Layout. Else screenshot. Else legacy flat layers.
async function buildComponentScreenshotCard(item, captionSuffix) {
  const data = item.data || {};
  const w = safeDimension(data.boundingBoxWidth, 300);
  const h = safeDimension(data.boundingBoxHeight, 200);
  const scale = Math.min(1, MAX_COMPONENT_DIMENSION / Math.max(w, h), CARD_CONTENT_WIDTH / w);
  const card = makeCard(`Component — ${Math.round(w)}×${Math.round(h)}`);
  const reason = captionSuffix || "screenshot (no layout tree)";
  try {
    const image = figma.createImage(dataUrlToBytes(data.previewImage));
    const rect = figma.createRectangle();
    rect.resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    rect.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: image.hash }];
    card.appendChild(rect);
    card.appendChild(await makeCaption(`${Math.round(w)}×${Math.round(h)} · ${reason}`));
  } catch (_) {
    const placeholder = figma.createRectangle();
    placeholder.resize(CARD_CONTENT_WIDTH, 120);
    placeholder.fills = [{ type: "SOLID", color: PLACEHOLDER_FILL }];
    card.appendChild(placeholder);
    card.appendChild(await makeCaption("Component preview unavailable"));
  }
  return card;
}

// Figma-only: editable structure first, never prefer a flat screenshot when
// we have a layoutTree or layers. Copy/ZIP paths do not use this file —
// they keep exporting component previews as images.
async function buildComponentCard(item) {
  const data = item.data || {};
  // Product rule: Collect stores image + editable tree. Copy/ZIP use the
  // image. Export to Figma uses layoutTree. Screenshot only if tree is empty
  // or rebuild fails entirely.
  if (
    (data.preferScreenshot || (data.layoutTree && data.layoutTree.preferScreenshot)) &&
    data.previewImage &&
    !layoutTreeHasUsefulLeaves(data.layoutTree)
  ) {
    try {
      return await buildComponentScreenshotCard(item, "screenshot — no editable structure");
    } catch (_) {
      // fall through
    }
  }
  if (data.layoutTree) {
    try {
      return await buildComponentCardFromTree(item);
    } catch (_) {
      // fall through to layers / screenshot
    }
  }
  const layers = Array.isArray(data.layers) ? data.layers : [];
  if (layers.length > 0) {
    try {
      return await buildComponentCardLegacy(item);
    } catch (_) {
      // fall through to screenshot
    }
  }
  if (data.previewImage) {
    return buildComponentScreenshotCard(
      item,
      data.layoutTree ? "screenshot — layout rebuild failed" : "screenshot (no layout tree)"
    );
  }
  return buildComponentCardLegacy(item);
}

async function buildNoteCard(item) {
  const data = item.data || {};
  const card = makeCard("Note");
  const text = typeof data.text === "string" ? data.text.trim() : "";
  const body = figma.createText();
  await figma.loadFontAsync(FALLBACK_FONT);
  body.fontName = FALLBACK_FONT;
  body.fontSize = 14;
  body.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
  body.characters = text || "(empty note)";
  body.textAutoResize = "HEIGHT";
  body.resize(CARD_CONTENT_WIDTH, body.height);
  card.appendChild(body);
  if (Array.isArray(data.images)) {
    for (const img of data.images) {
      if (!img || !img.inlineDataUrl) continue;
      try {
        const image = figma.createImage(dataUrlToBytes(img.inlineDataUrl));
        const w = safeDimension(img.width, 200);
        const h = safeDimension(img.height, 120);
        const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(w, h), CARD_CONTENT_WIDTH / w);
        const rect = figma.createRectangle();
        rect.resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
        rect.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: image.hash }];
        card.appendChild(rect);
      } catch (_) {
        // skip broken note images
      }
    }
  }
  const noteText = typeof item.note === "string" ? item.note.trim() : "";
  if (noteText) card.appendChild(await makeCaption(noteText));
  return card;
}

async function buildUnsupportedCard(item) {
  const card = makeCard(`Unsupported — ${item && item.type ? item.type : "unknown"}`);
  card.appendChild(await makeCaption(`Unsupported type: ${(item && item.type) || "unknown"}`));
  return card;
}

const BUILDERS = {
  color: buildColorCard,
  font: buildFontCard,
  image: buildImageCard,
  component: buildComponentCard,
  note: buildNoteCard,
  pairing: buildUnsupportedCard,
};

// Places one site's (hostname's) items directly on the current page in a
// simple wrapping grid, as independent top-level nodes — deliberately NOT
// nested inside a shared figma.createSection()/group the way this used to
// work. Explicit user feedback: bundling every component under one shared
// container read as everything being squeezed into one big frame rather
// than each component landing as its own real, independently-selectable
// layout that can be moved/resized on its own. A plain text label above
// the row keeps the "which site is this" context the Section's name used
// to carry, without actually parenting anything under it.
async function buildSiteItems(hostname, bucketItems, startY, onItemDone) {
  const labelText = hostname ? `${hostname} (${bucketItems.length})` : `Unknown site (${bucketItems.length})`;
  const label = figma.createText();
  const labelFont = await loadFontForWeight("Inter", 600);
  if (labelFont) label.fontName = labelFont;
  label.fontSize = 20;
  label.characters = labelText;
  figma.currentPage.appendChild(label);
  label.x = SECTION_PADDING;
  label.y = startY;

  const nodes = [label];
  let cursorX = SECTION_PADDING;
  let cursorY = startY + label.height + GRID_GAP;
  let rowHeight = 0;
  let count = 0;
  let failed = 0;
  let maxY = cursorY;

  for (const item of bucketItems) {
    if (!item || typeof item !== "object") {
      failed++;
      onItemDone();
      continue;
    }
    const build = BUILDERS[item.type];
    if (!build) {
      failed++;
      onItemDone();
      continue;
    }
    let card;
    try {
      card = await build(item);
      const noteText = typeof item.note === "string" ? item.note.trim() : "";
      // Notes items already render body text; item.note is the user's annotation.
      if (noteText && item.type !== "note") {
        card.appendChild(await makeCaption(noteText));
      }
    } catch (e) {
      failed++;
      onItemDone();
      continue;
    }
    figma.currentPage.appendChild(card);
    card.x = cursorX;
    card.y = cursorY;
    nodes.push(card);

    rowHeight = Math.max(rowHeight, card.height);
    cursorX += card.width + GRID_GAP;
    count++;
    if (count % GRID_COLUMNS === 0) {
      cursorX = SECTION_PADDING;
      cursorY += rowHeight + GRID_GAP;
      rowHeight = 0;
    }
    maxY = Math.max(maxY, cursorY + rowHeight);
    onItemDone();
  }

  if (count === 0) {
    label.remove();
    return { nodes: [], imported: 0, failed, bottomY: startY };
  }

  return { nodes, imported: count, failed, bottomY: maxY };
}

async function importItems(items) {
  if (!Array.isArray(items)) {
    throw new Error("No items to import — the export file may be corrupted.");
  }

  // Group by hostname — Harvest's own notion of a "site folder" — so a
  // multi-site export lands as one labeled section per site instead of one
  // undifferentiated grid. A single-site export just gets one section.
  const buckets = new Map();
  for (const item of items) {
    const key = item && typeof item === "object" && typeof item.hostname === "string" && item.hostname ? item.hostname : "";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }

  const allNodes = [];
  let totalImported = 0;
  let totalFailed = 0;
  let doneCount = 0;
  const onItemDone = () => {
    doneCount++;
    figma.ui.postMessage({ type: "progress", done: doneCount, total: items.length });
  };

  let cursorY = 0;
  for (const [hostname, bucketItems] of buckets) {
    const result = await buildSiteItems(hostname, bucketItems, cursorY, onItemDone);
    totalImported += result.imported;
    totalFailed += result.failed;
    if (result.nodes.length > 0) {
      allNodes.push(...result.nodes);
      cursorY = result.bottomY + SECTION_GAP;
    }
  }

  if (allNodes.length > 0) {
    figma.currentPage.selection = allNodes;
    figma.viewport.scrollAndZoomIntoView(allNodes);
  }

  return { imported: totalImported, failed: totalFailed };
}

figma.ui.onmessage = async (msg) => {
  // Pair key links Acopio extension ↔ this plugin so Import can fetch
  // without reading the system clipboard (Figma often blocks that).
  if (msg.type === "get-pair-key") {
    const pairKey = await figma.clientStorage.getAsync("acopioFigmaPairKey");
    figma.ui.postMessage({ type: "pair-key", pairKey: pairKey || null });
    return;
  }
  if (msg.type === "set-pair-key") {
    const pairKey = String(msg.pairKey || "").trim();
    if (pairKey) await figma.clientStorage.setAsync("acopioFigmaPairKey", pairKey);
    figma.ui.postMessage({ type: "pair-key", pairKey: pairKey || null });
    return;
  }
  if (msg.type === "import-from-handoff") {
    try {
      let pairKey = String(msg.pairKey || "").trim();
      if (!pairKey) {
        pairKey = (await figma.clientStorage.getAsync("acopioFigmaPairKey")) || "";
      }
      if (!pairKey) {
        figma.ui.postMessage({ type: "need-pair-key" });
        return;
      }
      await figma.clientStorage.setAsync("acopioFigmaPairKey", pairKey);
      figma.ui.postMessage({ type: "progress", done: 0, total: 1 });
      const payload = await fetchHandoffPayload(pairKey);
      const items = (payload && payload.items) || [];
      if (!items.length) throw new Error("Export has no items to import.");
      const result = await importItems(items);
      figma.ui.postMessage({ type: "import-complete", ...result });
      figma.notify(
        `Imported ${result.imported} item${result.imported === 1 ? "" : "s"}${
          result.failed ? ` (${result.failed} skipped)` : ""
        }`
      );
    } catch (e) {
      figma.ui.postMessage({ type: "import-error", message: String((e && e.message) || e) });
      figma.notify("Import failed — see plugin panel for details", { error: true });
    }
    return;
  }

  // Acopio extension clipboard handoff sends { type: "import-payload", payload }
  // with payload.items. Older Harvest JSON UI sent { type: "import-items", items }.
  if (msg.type === "import-payload" || msg.type === "import-items") {
    try {
      const items =
        msg.type === "import-payload"
          ? (msg.payload && msg.payload.items) || []
          : msg.items || [];
      if (msg.payload && msg.payload.pairKey) {
        await figma.clientStorage.setAsync("acopioFigmaPairKey", String(msg.payload.pairKey));
      }
      const result = await importItems(items);
      figma.ui.postMessage({ type: "import-complete", ...result });
      figma.notify(
        `Imported ${result.imported} item${result.imported === 1 ? "" : "s"}${
          result.failed ? ` (${result.failed} skipped)` : ""
        }`
      );
    } catch (e) {
      figma.ui.postMessage({ type: "import-error", message: String((e && e.message) || e) });
      figma.notify("Import failed — see plugin panel for details", { error: true });
    }
  } else if (msg.type === "cancel") {
    figma.closePlugin();
  }
};

// Public anon key (same as extension) — RLS/service role stay on the Edge Function.
const HANDOFF_BASE = "https://cpzqpmjyshxxpmxsqfni.supabase.co/functions/v1/figma-handoff";
const HANDOFF_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwenFwbWp5c2h4eHBteHNxZm5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNjIxODAsImV4cCI6MjEwMzgzODE4MH0.QM6tE5rBJHWZsXtGLiHH5Q4eZNQwhbt0dpwHYVTkXV8";

async function fetchHandoffPayload(pairKey) {
  const url = `${HANDOFF_BASE}?pairKey=${encodeURIComponent(pairKey)}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${HANDOFF_ANON}`,
      apikey: HANDOFF_ANON,
    },
  });
  let body = {};
  try {
    body = await resp.json();
  } catch (_) {
    body = {};
  }
  if (!resp.ok) {
    throw new Error((body && body.error) || `Couldn't fetch export (${resp.status})`);
  }
  if (!body.payload) throw new Error("Empty export from handoff service.");
  return body.payload;
}

// Tell the UI iframe we're ready + any saved pair key.
figma.clientStorage.getAsync("acopioFigmaPairKey").then((pairKey) => {
  figma.ui.postMessage({ type: "plugin-ready", pairKey: pairKey || null });
});
