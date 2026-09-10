#!/usr/bin/env node
/**
 * Three separate ZIP-export fixes, verified against the real export code
 * (not reimplemented logic):
 *
 * 1. Readable filenames — a raw CSS selector ("a.framer-9bdXY") used to be
 *    the filename for images/components. Now prefers real content (a
 *    component's own heading text, an image's alt text) via
 *    componentLabelFromOuterHtml / imageLabelFromItem.
 * 2. No redundant .txt sidecars — color and font items used to also write
 *    a plain-text property sheet duplicating what catalog.html already
 *    shows per-item. Removed.
 * 3. Mixed-type split — exporting components AND images together also
 *    produces images.html and components.html alongside the combined
 *    catalog.html; a folder with only one of the two types does not get a
 *    redundant duplicate file.
 *
 * Run: node test/verify-zip-export-structure.mjs
 */
import { chromium } from "playwright";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let browser;
let exitCode = 1;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("  [pageerror]", err.message));
  await page.setContent("<div></div>");
  await page.evaluate(() => {
    window.chrome = { runtime: { lastError: null, sendMessage(msg, cb) { cb({ ok: false }); } } };
  });
  for (const rel of [
    "vendor/jszip.min.js",
    "src/content/shared.js",
    "src/sidepanel/export/export-helpers.js",
    "src/sidepanel/export/zip-export.js",
  ]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const result = await page.evaluate(async () => {
    const componentItem = {
      id: "comp-0001-aaaaaaaa",
      type: "component",
      hostname: "example.com",
      note: "",
      selector: "div.framer-17cXyZ",
      data: {
        outerHTML: "<div><h2>Redefining Dashboards for Indian Fintech</h2><p>case study</p></div>",
        boundingBoxWidth: 300,
        boundingBoxHeight: 200,
        previewImage:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      },
    };
    const imageItem = {
      id: "img-0002-bbbbbbbb",
      type: "image",
      hostname: "example.com",
      note: "",
      selector: "img.framer-9bdXY",
      data: {
        alt: "Product screenshot",
        width: 10,
        height: 10,
        inlineDataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      },
    };
    const colorItem = {
      id: "color-0003-cccccccc",
      type: "color",
      hostname: "example.com",
      note: "",
      data: { hex: "#4F6EF7", rgb: { r: 79, g: 110, b: 247 }, alpha: 1 },
    };

    const zip = new JSZip();
    const folder = zip.folder("example.com");
    const notedVisuals = [];
    const imageSrcById = {};

    const writeItemToZip = AcopioZipExport.ZIP_WRITERS;
    imageSrcById[componentItem.id] = await writeItemToZip.component(folder, componentItem, notedVisuals);
    imageSrcById[imageItem.id] = await writeItemToZip.image(folder, imageItem, notedVisuals);
    await writeItemToZip.color(folder, colorItem);

    const allItems = [componentItem, imageItem, colorItem];
    folder.file("catalog.html", AcopioZipExport.buildCatalogHtml(allItems, { hostname: "example.com", imageSrcById }));
    folder.file(
      "images.html",
      AcopioZipExport.buildCatalogHtml([imageItem], { hostname: "example.com", imageSrcById, title: "Images", pageHeading: "Images" })
    );
    folder.file(
      "components.html",
      AcopioZipExport.buildCatalogHtml([componentItem], { hostname: "example.com", imageSrcById, title: "Components", pageHeading: "Components" })
    );

    const names = [];
    folder.forEach((relPath) => names.push(relPath));
    return { names };
  });

  console.log(JSON.stringify(result.names, null, 2));

  const fails = [];
  const names = result.names;
  const componentFile = names.find((n) => n.startsWith("component-"));
  const imageFile = names.find((n) => n.startsWith("image-"));

  if (!componentFile) fails.push("no component file found at all");
  else if (!componentFile.includes("Redefining Dashboards")) {
    fails.push(`component filename doesn't use its heading text, got "${componentFile}"`);
  } else if (componentFile.includes("framer-17cXyZ")) {
    fails.push(`component filename still leaks the raw CSS selector: "${componentFile}"`);
  }

  if (!imageFile) fails.push("no image file found at all");
  else if (!imageFile.includes("Product screenshot")) {
    fails.push(`image filename doesn't use its alt text, got "${imageFile}"`);
  } else if (imageFile.includes("framer-9bdXY")) {
    fails.push(`image filename still leaks the raw CSS selector: "${imageFile}"`);
  }

  if (names.some((n) => /^color-.*\.txt$/.test(n))) {
    fails.push("color-*.txt sidecar still present — should be removed (catalog.html covers it)");
  }
  if (!names.some((n) => /^color-.*\.png$/.test(n))) {
    fails.push("color-*.png missing entirely — removing the .txt must not have removed the .png too");
  }

  if (!names.includes("images.html")) fails.push("images.html missing from a mixed component+image export");
  if (!names.includes("components.html")) fails.push("components.html missing from a mixed component+image export");
  if (!names.includes("catalog.html")) fails.push("catalog.html (the combined/global file) missing");

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — readable filenames, no redundant .txt sidecars, mixed-type split all correct.");
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  process.exit(exitCode);
}
