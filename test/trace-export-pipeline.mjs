/**
 * Node trace: component item → resolveExportImageBytes → copy HTML → ZIP → Notion blocks.
 * Run: node test/trace-export-pipeline.mjs
 *
 * Uses minimal DOM shims (canvas/createImageBitmap) — validates the pure data path only.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function loadScript(relativePath) {
  const code = readFileSync(join(root, relativePath), "utf8");
  vm.runInContext(code, ctx, { filename: relativePath });
}

// Minimal browser shims for export-helpers
const sandbox = {
  window: {},
  console,
  Blob: global.Blob,
  btoa: global.btoa,
  atob: global.atob,
  Uint8Array: global.Uint8Array,
  FileReader: class {
    constructor() {
      this.result = null;
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        this.result = `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
        this.onload && this.onload();
      });
    }
  },
  createImageBitmap: async (blob) => {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    return {
      width: isPng ? 1 : isJpeg ? 1 : 100,
      height: isPng ? 1 : isJpeg ? 1 : 100,
      close() {},
    };
  },
  document: {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return { drawImage() {}, fillRect() {}, fillText() {} };
        },
        toBlob(cb) {
          const bytes = Uint8Array.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1,
          ]);
          cb(new Blob([bytes], { type: "image/png" }));
        },
      };
    },
  },
  Acopio: { escapeHtml: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;") },
  chrome: { runtime: { sendMessage: async () => ({ ok: true, fileUploadId: "upload-trace" }) } },
};
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);

loadScript("src/sidepanel/export/export-helpers.js");
loadScript("src/sidepanel/copy/copy-helpers.js");
loadScript("src/sidepanel/copy/clipboard-copy.js");
loadScript("src/sidepanel/export/zip-export.js");
loadScript("src/sidepanel/export/notion-export.js");

const H = sandbox.window.AcopioExportHelpers;
const CH = sandbox.window.AcopioCopyHelpers;

const componentItem = {
  id: "trace-comp-001",
  type: "component",
  hostname: "example.com",
  selector: "div.hero",
  note: "Trace note",
  data: { previewImage: PNG_1x1, boundingBoxWidth: 862, boundingBoxHeight: 551 },
};

async function run() {
  const checks = [];

  const bytes = await H.resolveExportImageBytes(componentItem);
  checks.push(["resolveExportImageBytes returns PNG bytes", bytes && H.isPngBytes(bytes)]);

  const blobs = await CH.resolveItemImages(componentItem);
  checks.push(["resolveItemImages returns one blob", blobs.length === 1 && blobs[0].size > 0]);

  const htmlBlob = await sandbox.window.AcopioClipboardCopy.buildCopyHtml([componentItem]);
  const html = await htmlBlob.text();
  checks.push(["copy HTML embeds data:image", html.includes("data:image")]);
  checks.push(["copy HTML has note after image", html.indexOf("data:image") < html.indexOf("Trace note")]);

  const text = sandbox.window.AcopioClipboardCopy.describeItemForCopy(componentItem, 0);
  checks.push(["plain text is label + note only", text === "Component 1\n\nTrace note"]);
  checks.push(["plain text has no dimensions", !text.includes("862") && !text.includes("×")]);

  const notedVisuals = [{ type: "component", note: "Trace note", imageBytes: bytes, imageFile: "component-hero.png" }];
  const rtf = await sandbox.window.AcopioZipExport.buildNotedVisualsRtf(notedVisuals);
  checks.push(["RTF has jpegblip", rtf.includes("\\jpegblip")]);
  checks.push(["RTF has picw/pich", /\\picw\d+/.test(rtf) && /\\pich\d+/.test(rtf)]);

  const { blocks } = await sandbox.window.AcopioNotionExport.buildNotionBlocksForItems([componentItem]);
  const imgBlock = blocks.find((b) => b.type === "image" && b.image && b.image.type === "file_upload");
  checks.push(["Notion image block uses file_upload", !!imgBlock]);
  checks.push(["Notion image caption is empty array", Array.isArray(imgBlock.image.caption) && imgBlock.image.caption.length === 0]);

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
    if (!ok) failed += 1;
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
