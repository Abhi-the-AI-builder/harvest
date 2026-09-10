#!/usr/bin/env node
/**
 * catalog.html repeated "Source: https://same-url" under every single item
 * even though the whole folder is already scoped to that one site (the
 * intro line already says "N items from that hostname") — pure noise.
 *
 * Fixed: the per-item Source line only shows when that item's own
 * hostname differs from the folder's — i.e. never in a single-site
 * folder (today's only real case, since exports already split by host
 * into separate folders), but correctly shown for a genuinely mixed list
 * if one is ever passed in directly (defensive, not exercised by the
 * current export flow but worth being correct about).
 *
 * Same fix applies to buildCollectionReportHtml/Markdown.
 *
 * Run: node test/verify-catalog-source-dedup.mjs
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
  for (const rel of ["src/content/shared.js", "src/sidepanel/export/export-helpers.js", "src/sidepanel/export/zip-export.js"]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const result = await page.evaluate(() => {
    // Case 1: a single-site folder — every item shares the folder's own
    // hostname (the real, only case exports produce today).
    const sameHostItems = [
      { id: "a", type: "note", hostname: "dwijapatel.framer.website", sourceUrl: "https://dwijapatel.framer.website/", note: "", data: { text: "first" } },
      { id: "b", type: "note", hostname: "dwijapatel.framer.website", sourceUrl: "https://dwijapatel.framer.website/work", note: "", data: { text: "second" } },
    ];
    const singleSiteHtml = AcopioZipExport.buildCatalogHtml(sameHostItems, { hostname: "dwijapatel.framer.website" });

    // Case 2: a genuinely mixed-host list (defensive — not produced by the
    // real export flow today, but the function must still handle it right
    // if ever called directly).
    const mixedHostItems = [
      { id: "c", type: "note", hostname: "site-a.com", sourceUrl: "https://site-a.com/", note: "", data: { text: "from A" } },
      { id: "d", type: "note", hostname: "site-b.com", sourceUrl: "https://site-b.com/", note: "", data: { text: "from B" } },
    ];
    const mixedHtml = AcopioZipExport.buildCatalogHtml(mixedHostItems);

    // Case 3: collection-report.html, same-site entries.
    const reportEntries = [
      { type: "note", note: "n1", hostname: "dwijapatel.framer.website", sourceUrl: "https://dwijapatel.framer.website/", selector: "" },
      { type: "note", note: "n2", hostname: "dwijapatel.framer.website", sourceUrl: "https://dwijapatel.framer.website/about", selector: "" },
    ];
    const reportHtml = AcopioZipExport.buildCollectionReportHtml(reportEntries);
    const reportMd = AcopioZipExport.buildCollectionReportMarkdown(reportEntries);

    // Case 4: an item with NO hostname at all (an old/malformed item) —
    // must default to SHOWING Source (safe: can't confirm it's the same
    // site, so don't silently hide potentially-useful info).
    const noHostnameItems = [
      { id: "e", type: "note", sourceUrl: "https://unknown-site.example/", note: "", data: { text: "no hostname field" } },
    ];
    const noHostnameHtml = AcopioZipExport.buildCatalogHtml(noHostnameItems, { hostname: "dwijapatel.framer.website" });

    // Case 5: case-insensitive hostname match (defensive — real hostnames
    // are always browser-lowercased, but the comparison must not be
    // fooled by casing either way).
    const caseMismatchItems = [
      { id: "f", type: "note", hostname: "Dwijapatel.Framer.Website", sourceUrl: "https://dwijapatel.framer.website/", note: "", data: { text: "case differs" } },
    ];
    const caseMismatchHtml = AcopioZipExport.buildCatalogHtml(caseMismatchItems, { hostname: "dwijapatel.framer.website" });

    // Case 6: 9 items from one host + 1 from a different host, WITH an
    // explicit folder hostname passed (exactly what performZipExport
    // always does) — only the one genuine outlier should show Source.
    const majorityItems = [];
    for (let i = 0; i < 9; i++) {
      majorityItems.push({
        id: `m${i}`,
        type: "note",
        hostname: "dwijapatel.framer.website",
        sourceUrl: "https://dwijapatel.framer.website/",
        note: "",
        data: { text: `item ${i}` },
      });
    }
    majorityItems.push({
      id: "outlier",
      type: "note",
      hostname: "some-other-site.com",
      sourceUrl: "https://some-other-site.com/",
      note: "",
      data: { text: "the outlier" },
    });
    const majorityHtml = AcopioZipExport.buildCatalogHtml(majorityItems, { hostname: "dwijapatel.framer.website" });

    // Case 7: the real mixed-type export path (images.html/components.html
    // built the same way performZipExport does) — both must also hide
    // Source for their single-site items.
    const imageItems = [
      { id: "img1", type: "note", hostname: "dwijapatel.framer.website", sourceUrl: "https://dwijapatel.framer.website/", note: "", data: { text: "image note" } },
    ];
    const imagesHtml = AcopioZipExport.buildCatalogHtml(imageItems, {
      hostname: "dwijapatel.framer.website",
      title: "Acopio — Images",
      pageHeading: "Acopio — Images",
    });

    return {
      singleSiteSourceCount: (singleSiteHtml.match(/class="meta">Source:/g) || []).length,
      mixedSourceCount: (mixedHtml.match(/class="meta">Source:/g) || []).length,
      reportHtmlSourceCount: (reportHtml.match(/class="meta">Source:/g) || []).length,
      reportMdSourceCount: (reportMd.match(/\*\*Source:\*\*/g) || []).length,
      noHostnameSourceCount: (noHostnameHtml.match(/class="meta">Source:/g) || []).length,
      caseMismatchSourceCount: (caseMismatchHtml.match(/class="meta">Source:/g) || []).length,
      majoritySourceCount: (majorityHtml.match(/class="meta">Source:/g) || []).length,
      imagesHtmlSourceCount: (imagesHtml.match(/class="meta">Source:/g) || []).length,
    };
  });

  console.log(JSON.stringify(result, null, 2));

  const fails = [];
  if (result.singleSiteSourceCount !== 0) {
    fails.push(`single-site folder: expected 0 "Source:" lines, got ${result.singleSiteSourceCount}`);
  }
  if (result.mixedSourceCount !== 2) {
    fails.push(`mixed-host list: expected 2 "Source:" lines (both differ from each other), got ${result.mixedSourceCount}`);
  }
  if (result.reportHtmlSourceCount !== 0) {
    fails.push(`collection-report.html, single site: expected 0 "Source:" lines, got ${result.reportHtmlSourceCount}`);
  }
  if (result.reportMdSourceCount !== 0) {
    fails.push(`collection-report.md, single site: expected 0 "Source:" lines, got ${result.reportMdSourceCount}`);
  }
  if (result.noHostnameSourceCount !== 1) {
    fails.push(`item with no hostname field: expected Source SHOWN (safe default), got ${result.noHostnameSourceCount} lines`);
  }
  if (result.caseMismatchSourceCount !== 0) {
    fails.push(`case-differing hostname ("Dwijapatel.Framer.Website" vs "dwijapatel.framer.website"): expected Source hidden (same site, different case), got ${result.caseMismatchSourceCount} lines`);
  }
  if (result.majoritySourceCount !== 1) {
    fails.push(`9-matching + 1-outlier with explicit folder hostname: expected exactly 1 "Source:" line (the outlier), got ${result.majoritySourceCount}`);
  }
  if (result.imagesHtmlSourceCount !== 0) {
    fails.push(`images.html-style single-site export: expected 0 "Source:" lines, got ${result.imagesHtmlSourceCount}`);
  }

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — Source line hidden within a single-site folder, still shown when hosts genuinely differ, in both catalog.html and collection-report.html/.md.");
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  process.exit(exitCode);
}
