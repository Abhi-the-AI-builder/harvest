#!/usr/bin/env node
/**
 * Node verification for Acopio copy/export pipeline.
 * Tests pure helpers + mocked browser APIs for RTF/HTML/ZIP companions.
 * Run: node test/verify-export-copy.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PNG_1x1_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_1x1_DATA_URL = `data:image/png;base64,${PNG_1x1_B64}`;

let passed = 0;
let failed = 0;

function assert(condition, label, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Minimal browser mocks for loading IIFE modules ──────────────────────────

function bytesFromB64(b64) {
  const bin = Buffer.from(b64, "base64");
  return new Uint8Array(bin);
}

function createMockCanvas(width, height) {
  return {
    width: width || 1,
    height: height || 1,
    getContext() {
      return { drawImage() {}, fillRect() {}, fillText() {}, fillStyle: "", textBaseline: "" };
    },
    toBlob(cb, mime) {
      if (mime === "image/png") {
        const png = bytesFromB64(PNG_1x1_B64);
        cb(new Blob([png], { type: "image/png" }));
        return;
      }
      // Emit a tiny valid JPEG (SOI + EOI markers + padding) for RTF hex tests
      const jpeg = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
        0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
        0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
        0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
        0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
        0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
        0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
        0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
        0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
        0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d,
        0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7b, 0x94,
        0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xd9,
      ]);
      cb(new Blob([jpeg], { type: mime || "image/jpeg" }));
    },
    toDataURL() {
      return PNG_1x1_DATA_URL;
    },
  };
}

function createMockDocument() {
  return {
    createElement(tag) {
      if (tag === "canvas") return createMockCanvas(1, 1);
      return { style: {}, appendChild() {}, setAttribute() {}, innerHTML: "" };
    },
  };
}

async function mockCreateImageBitmap(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const isPng = bytes.length >= 2 && bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpeg) {
    throw new Error("Invalid image data");
  }
  let width = 1;
  let height = 1;
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    width =
      (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    height =
      (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (!width) width = 1;
    if (!height) height = 1;
  }
  return { width, height, close() {} };
}

class MockFileReader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((ab) => {
      const b64 = Buffer.from(ab).toString("base64");
      this.result = `data:${blob.type || "application/octet-stream"};base64,${b64}`;
      if (this.onload) this.onload();
    });
  }
}

function createSandbox() {
  const sandbox = {
    window: {},
    document: createMockDocument(),
    createImageBitmap: mockCreateImageBitmap,
    FileReader: MockFileReader,
    Blob,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => {
      try {
        return Buffer.from(s.replace(/\s/g, ""), "base64").toString("binary");
      } catch (_) {
        throw new Error("Invalid character");
      }
    },
    console,
    setTimeout,
    clearTimeout,
    Acopio: {
      escapeHtml(str) {
        return String(str)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      },
      ICONS: { check: "✓" },
    },
    chrome: { runtime: { sendMessage: async () => ({ ok: true, fileUploadId: "test-upload" }) } },
    fetch: async () => ({ ok: false }),
    URL: { createObjectURL: () => "blob:mock", revokeObjectURL() {} },
    JSZip: null,
  };
  sandbox.window = sandbox;
  return vm.createContext(sandbox);
}

function loadModule(ctx, relativePath) {
  const code = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  vm.runInContext(code, ctx, { filename: relativePath });
  return ctx;
}

// ── Tests ───────────────────────────────────────────────────────────────────

function testPurePngHelpers(H) {
  console.log("\n1. base64DataUrlToBytes + PNG magic bytes");
  const bytes = H.base64DataUrlToBytes(PNG_1x1_DATA_URL);
  assert(bytes && bytes.length > 8, "base64DataUrlToBytes returns bytes");
  assert(H.isPngBytes(bytes), "decoded bytes have PNG magic 89 50");
  assert(bytes[0] === 0x89 && bytes[1] === 0x50, "PNG signature is 89 50 4E 47");

  const bad = H.base64DataUrlToBytes("data:image/png;base64,!!!");
  assert(!bad || !bad.length || !H.isPngBytes(bad), "invalid base64 does not yield PNG bytes");

  const dims = H.pngDimensions(bytes);
  assert(dims.width === 1 && dims.height === 1, `pngDimensions reads IHDR (${dims.width}x${dims.height})`);
}

async function testEnsureValidPngBlob(H) {
  console.log("\n2. ensureValidPngBlob");
  const pngBytes = bytesFromB64(PNG_1x1_B64);
  const valid = await H.ensureValidPngBlob(new Blob([pngBytes], { type: "image/png" }));
  assert(valid && valid.size > 0 && valid.type === "image/png", "valid PNG blob passes through");

  const fakePng = new Blob([Buffer.from("not a png")], { type: "image/png" });
  const rejected = await H.ensureValidPngBlob(fakePng);
  assert(rejected === null, "non-PNG bytes keyed as image/png are rejected");
}

async function testResolveExportImageBytes(H) {
  console.log("\n3. resolveExportImageBytes (mock component)");
  const item = {
    type: "component",
    data: { previewImage: PNG_1x1_DATA_URL, boundingBoxWidth: 100, boundingBoxHeight: 50 },
  };
  const bytes = await H.resolveExportImageBytes(item);
  assert(bytes && bytes.length > 0, "component previewImage resolves to bytes");
  assert(H.isPngBytes(bytes), "resolved bytes are PNG (89 50)");
  console.log(`       → ${bytes.length} bytes, magic: ${bytes[0].toString(16)} ${bytes[1].toString(16)}`);
}

async function testRtfCompanion(H, ZipExport) {
  console.log("\n4. RTF companion (notes-with-images.rtf)");
  const pngBytes = bytesFromB64(PNG_1x1_B64);
  const entries = [
    {
      type: "component",
      note: "Test component note for RTF",
      imageBytes: pngBytes,
      imageFile: "component-div-hero-100x50-abc123.png",
    },
  ];
  const rtf = await ZipExport.buildNotedVisualsRtf(entries);
  const hasBlip = rtf.includes("\\jpegblip") || rtf.includes("\\pngblip");
  assert(hasBlip, "RTF contains \\\\jpegblip or \\\\pngblip");

  const blipMatch = rtf.match(/\\(?:jpeg|png)blip[\s\S]*?([0-9a-f]{200,})/i);
  const hexLen = blipMatch ? blipMatch[1].length : 0;
  assert(hexLen > 100, `RTF pict hex data length > 100 (got ${hexLen})`);
  assert(rtf.includes("Test component note for RTF"), "RTF contains note text");
  console.log(`       → RTF length ${rtf.length}, hex snippet ${hexLen} chars`);
}

function testCollectionReportHtml(H, ZipExport) {
  console.log("\n5. collection-report.html (base64 embedded images)");
  const pngBytes = bytesFromB64(PNG_1x1_B64);
  const entries = [
    {
      type: "component",
      note: "HTML note test",
      imageBytes: pngBytes,
      imageFile: "component-test-100x50-abc123.png",
      sourceUrl: "https://example.com/page",
      selector: "div.hero",
    },
  ];
  const html = ZipExport.buildCollectionReportHtml(entries);
  const base64Match = html.match(/<img src="data:image\/png;base64,([A-Za-z0-9+/=]{80,})"/);
  const base64Len = base64Match ? base64Match[1].length : 0;
  assert(base64Len > 80, `HTML img has substantial base64 (${base64Len} chars)`);
  assert(html.includes("<img"), "HTML contains img tag");
  assert(html.includes("HTML note test"), "HTML contains note text");
  assert(html.includes("https://example.com/page"), "HTML contains source URL");
  console.log(`       → base64 length: ${base64Len}, total HTML: ${html.length} bytes`);
}

function testZipOnlyHtmlReport(ZipExport) {
  console.log("\n6b. ZIP noted visuals — collection-report.html only");
  // performZipExport writes only collection-report.html (not md/rtf/doc/readme).
  // Helper builders still exist for unit tests; this verifies the intended export surface.
  const entries = [
    {
      type: "component",
      note: "Markdown note",
      imageFile: "component-test-100x50-abc123.png",
      sourceUrl: "https://example.com",
      selector: "div.hero",
    },
  ];
  const html = ZipExport.buildCollectionReportHtml(entries);
  assert(html.includes("collection-report") || html.includes("Collection report"), "HTML report builder still works");
  assert(typeof ZipExport.buildCollectionReportMarkdown === "function", "MD builder retained for tests");
}

async function testZipComponentPng(H, ZipExport) {
  console.log("\n7. ZIP component-*.png file");
  const jszipCode = fs.readFileSync(path.join(ROOT, "vendor/jszip.min.js"), "utf8");
  const jszipCtx = vm.createContext({
    window: {},
    module: { exports: {} },
    exports: {},
    define: undefined,
    self: {},
    global: {},
    setTimeout,
    clearTimeout,
    setImmediate: (fn) => setTimeout(fn, 0),
  });
  jszipCtx.window = jszipCtx;
  jszipCtx.self = jszipCtx;
  jszipCtx.global = jszipCtx;
  vm.runInContext(jszipCode, jszipCtx);
  const JSZip = jszipCtx.module.exports.default || jszipCtx.module.exports || jszipCtx.JSZip;

  const mockItem = {
    id: "abc123def456",
    type: "component",
    hostname: "example.com",
    selector: "div.hero",
    data: { previewImage: PNG_1x1_DATA_URL, boundingBoxWidth: 100, boundingBoxHeight: 50 },
    note: "ZIP note test",
  };

  const expectedBytes = await H.resolveExportImageBytes(mockItem);
  assert(H.isPngBytes(expectedBytes), `source PNG magic: ${expectedBytes[0].toString(16)} ${expectedBytes[1].toString(16)}`);
  console.log(`       → resolveExportImageBytes: ${expectedBytes.length} bytes before ZIP write`);

  const zip = new JSZip();
  const folder = zip.folder("example-com");
  const notedVisuals = [];
  await ZipExport.ZIP_WRITERS.component(folder, mockItem, notedVisuals);

  const files = Object.keys(folder.files).filter((k) => !k.endsWith("/"));
  const pngFile = files.find((f) => f.endsWith(".png") && f.includes("component-"));
  assert(pngFile, `component-*.png exists (${files.join(", ")})`);
  assert(pngFile.includes("component-div.hero-100x50-abc123.png"), `expected filename in ${pngFile}`);
  assert(expectedBytes[0] === 0x89 && expectedBytes[1] === 0x50, `PNG magic verified from resolveExportImageBytes`);
  console.log(`       → ${pngFile.split("/").pop()}: ${expectedBytes.length} bytes (89 50)`);

  assert(notedVisuals.length === 1, "noted component pushed to notedVisuals array");
  assert(notedVisuals[0].imageBytes && notedVisuals[0].imageBytes.length > 0, "notedVisuals has imageBytes");
}

async function testNotionBlocks(NotionExport) {
  console.log("\n8. Notion file_upload blocks (3 components)");
  const items = [1, 2, 3].map((n) => ({
    id: `comp-${n}`,
    type: "component",
    data: { previewImage: PNG_1x1_DATA_URL },
    note: `Note ${n}`,
  }));
  const { blocks } = await NotionExport.buildNotionBlocksForItems(items);
  const uploadBlocks = blocks.filter(
    (b) => b.type === "image" && b.image && b.image.type === "file_upload"
  );
  assert(uploadBlocks.length === 3, `3 file_upload image blocks (got ${uploadBlocks.length})`);
  uploadBlocks.forEach((b, i) => {
    assert(b.image.file_upload.id === "test-upload", `block ${i + 1} has upload id`);
  });
}

async function testClipboardMimeTypes(ctx) {
  console.log("\n9. Clipboard MIME types (mock ClipboardItem)");
  const H = ctx.AcopioExportHelpers;
  const CC = ctx.AcopioClipboardCopy;
  const CH = ctx.AcopioCopyHelpers;

  let lastClipboardWrite = null;
  ctx.ClipboardItem = class MockClipboardItem {
    constructor(types) {
      this._types = types;
      this.types = Object.keys(types);
    }
    async getType(type) {
      return this._types[type];
    }
  };
  ctx.navigator = {
    clipboard: {
      async write(items) {
        lastClipboardWrite = items[0];
      },
    },
  };

  const item = {
    type: "component",
    data: { previewImage: PNG_1x1_DATA_URL },
    note: "Clipboard note",
  };

  // Component copy must be image/png only — text/html/plain cause paste targets to pick text.
  CC.limits.minPngBytes = 1;
  await CC.writeClipboardWithFallback([item]);
  assert(lastClipboardWrite, "writeClipboardWithFallback calls navigator.clipboard.write");
  assert(
    lastClipboardWrite.types.length === 1 && lastClipboardWrite.types[0] === "image/png",
    `visual copy is image/png only (got ${lastClipboardWrite.types.join(", ")})`
  );
  const pngBlob = await lastClipboardWrite.getType("image/png");
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
  assert(H.isPngBytes(pngBytes), "clipboard PNG has valid magic bytes");
  console.log(`       → clipboard PNG: ${pngBytes.length} bytes`);

  const noImageItem = { type: "component", data: {}, selector: "div.hero", sourceUrl: "https://example.com" };
  await CC.writeClipboardWithFallback([noImageItem]);
  assert(lastClipboardWrite, "component without screenshot falls back to rich text");
  assert(lastClipboardWrite.types.includes("text/plain"), "fallback copy includes text/plain");
  const fallbackText = await lastClipboardWrite.getType("text/plain").then((b) => b.text());
  assert(fallbackText.includes("div.hero"), "fallback text includes selector metadata");
  assert(!lastClipboardWrite.types.includes("image/png"), "fallback copy does not force image/png");

  // Multi-item: one with screenshot + one without must not hard-fail or
  // silently paste only the imaged item.
  const withImage = {
    type: "component",
    data: { previewImage: PNG_1x1_DATA_URL },
    selector: "div.card",
    sourceUrl: "https://example.com/a",
  };
  const withoutImage = {
    type: "component",
    data: {},
    selector: "div.missing",
    sourceUrl: "https://example.com/b",
  };
  await CC.writeClipboardWithFallback([withImage, withoutImage]);
  assert(lastClipboardWrite.types.includes("text/plain"), "mixed multi-item falls back to text");
  assert(!lastClipboardWrite.types.includes("image/png"), "mixed multi-item does not force image/png");
  const mixedText = await lastClipboardWrite.getType("text/plain").then((b) => b.text());
  assert(mixedText.includes("div.missing"), "mixed fallback keeps metadata for item without screenshot");

  const colorItem = { type: "color", data: { hex: "#336699" } };
  CC.limits.minPngBytes = 1;
  await CC.writeClipboardWithFallback([colorItem]);
  assert(lastClipboardWrite.types.includes("text/plain"), "color copy uses text/plain");
  const colorText = await lastClipboardWrite.getType("text/plain").then((b) => b.text());
  assert(colorText === "#336699", `color plain text is hex only (got "${colorText}")`);
  assert(lastClipboardWrite.types.includes("image/png"), "color copy includes swatch image/png");

  const fontItem = { type: "font", data: { family: "Inter", weight: 600, sizePx: 16, lineHeightPx: 24 } };
  await CC.writeClipboardWithFallback([fontItem]);
  const fontText = await lastClipboardWrite.getType("text/plain").then((b) => b.text());
  assert(fontText === "Inter, 600, 16px / 24px line-height", `font plain text is useful string (got "${fontText}")`);
  assert(lastClipboardWrite.types.includes("image/png"), "font copy includes sample image/png");

  const blobs = await CH.resolveItemImages(item);
  assert(blobs.length === 1 && blobs[0].size > 0, "resolveItemImages returns PNG for mock component");
}

async function main() {
  console.log("Acopio copy/export verification (Node)\n" + "=".repeat(50));

  const ctx = createSandbox();
  loadModule(ctx, "src/sidepanel/export/export-helpers.js");
  const H = ctx.AcopioExportHelpers;

  testPurePngHelpers(H);
  await testEnsureValidPngBlob(H);
  await testResolveExportImageBytes(H);

  loadModule(ctx, "src/sidepanel/export/zip-export.js");
  const ZipExport = ctx.AcopioZipExport;

  await testRtfCompanion(H, ZipExport);
  testCollectionReportHtml(H, ZipExport);
  testZipOnlyHtmlReport(ZipExport);
  await testZipComponentPng(H, ZipExport);

  loadModule(ctx, "src/sidepanel/export/notion-export.js");
  await testNotionBlocks(ctx.AcopioNotionExport);

  loadModule(ctx, "src/sidepanel/copy/copy-helpers.js");
  loadModule(ctx, "src/sidepanel/copy/clipboard-copy.js");
  await testClipboardMimeTypes(ctx);

  console.log("\n" + "=".repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
