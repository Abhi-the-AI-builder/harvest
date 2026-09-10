#!/usr/bin/env node
/**
 * User-reported: collection-report.md shouldn't be in the export at all,
 * and the HTML report files should be named/ordered so they're clearly
 * "whole collection -> components -> images -> collection with notes"
 * instead of the old catalog.html/images.html/components.html/
 * collection-report.html(+.md) naming, which didn't sort into any
 * particular sequence and didn't say what each file actually was.
 *
 * This drives the REAL performZipExport end to end (not the individual
 * builder functions other tests already cover) and inspects the actual
 * filenames JSZip ends up with.
 *
 * Run: node test/verify-export-file-sequence.mjs
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
    window.chrome = { runtime: { lastError: null, sendMessage(msg, cb) { if (cb) cb({ ok: false }); } } };
    // performZipExport triggers a real <a download> click — no-op it so
    // the test doesn't need a real download sink, same idea as JSDOM-less
    // headless runs elsewhere in this suite.
    const realClick = HTMLElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      window.__lastDownloadName = this.download;
    };
  });
  for (const rel of [
    "vendor/jszip.min.js",
    "src/content/shared.js",
    "src/sidepanel/export/export-helpers.js",
    "src/sidepanel/export/zip-export.js",
  ]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const smallPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  const names = await page.evaluate(async (smallPng) => {
    const items = [
      {
        id: "comp-1",
        type: "component",
        hostname: "example.com",
        note: "a note on this one",
        selector: "div.card",
        sourceUrl: "https://example.com/",
        data: {
          outerHTML: "<div><h2>My Component</h2></div>",
          boundingBoxWidth: 300,
          boundingBoxHeight: 200,
          previewImage: smallPng,
        },
      },
      {
        id: "img-1",
        type: "image",
        hostname: "example.com",
        note: "",
        selector: "img.photo",
        sourceUrl: "https://example.com/",
        data: { width: 10, height: 10, inlineDataUrl: smallPng },
      },
    ];
    let captured = null;
    const originalGenerate = JSZip.prototype.generateAsync;
    JSZip.prototype.generateAsync = function (opts) {
      captured = this;
      return originalGenerate.call(this, opts);
    };
    await AcopioZipExport.performZipExport(
      { items, scopeKey: "test-export", siteCount: 1 },
      { showFeedback: () => {} }
    );
    JSZip.prototype.generateAsync = originalGenerate;
    const names = [];
    captured.folder("example.com").forEach((relPath) => names.push(relPath));
    return names;
  }, smallPng);

  console.log(JSON.stringify(names, null, 2));

  const fails = [];
  const expectedPresent = ["1-whole-collection.html", "2-components.html", "3-images.html", "4-collection-with-notes.html", "README.txt"];
  for (const name of expectedPresent) {
    if (!names.includes(name)) fails.push(`missing expected file "${name}"`);
  }
  const oldNames = ["catalog.html", "images.html", "components.html", "collection-report.html", "collection-report.md"];
  for (const name of oldNames) {
    if (names.includes(name)) fails.push(`old filename "${name}" should not appear anymore`);
  }
  if (names.some((n) => n.endsWith(".md"))) {
    fails.push(`no .md file should be in the export at all, found: ${names.filter((n) => n.endsWith(".md")).join(", ")}`);
  }
  // Confirm alphabetical sort actually produces the requested sequence.
  const reportFiles = names.filter((n) => /^\d-.*\.html$/.test(n)).sort();
  const expectedOrder = ["1-whole-collection.html", "2-components.html", "3-images.html", "4-collection-with-notes.html"];
  if (JSON.stringify(reportFiles) !== JSON.stringify(expectedOrder)) {
    fails.push(`report files don't sort into the expected sequence: got ${JSON.stringify(reportFiles)}, expected ${JSON.stringify(expectedOrder)}`);
  }

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — real performZipExport produces the correctly-named, correctly-sequenced report files with no .md file anywhere.");
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  process.exit(exitCode);
}
