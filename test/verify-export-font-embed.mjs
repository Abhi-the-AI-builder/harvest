#!/usr/bin/env node
/**
 * A "font" item only ever saved the family NAME ("Rebond Grotesque") —
 * meaningless outside the source page's own document, where the real
 * @font-face is already loaded. Opening a standalone ZIP export
 * (catalog.html) in a fresh browser with no idea what that font is
 * silently fell back to a generic font (confirmed by the user: a font
 * detail tooltip correctly showing "Rebond Grotesque Medium" in-page, but
 * the exported catalog.html rendering a plain fallback "a" instead).
 *
 * Fixed in two places:
 * 1. overlay.js's assignPreviewImageAndFinalize harvests real font file
 *    bytes at Collect time via Acopio.harvestFontBytesForElement (the same
 *    mechanism Copy→Figma already used for paste fidelity), storing them
 *    as item.data.fontAssets.
 * 2. zip-export.js's renderCatalogItemHtml embeds those bytes as a real
 *    @font-face when present, instead of just referencing the family name.
 *
 * This test proves the embedding actually works end-to-end: build a real
 * catalog.html using a font harvested from a live Google Fonts page (the
 * same live-network pattern test/verify-google-fonts-figma.mjs already
 * uses), then load that HTML in a COMPLETELY SEPARATE, offline page with
 * no Google Fonts link at all — the only way the embedded family can
 * become loadable there is if the real font bytes made it into the file.
 *
 * Run: node test/verify-export-font-embed.mjs
 */
import { chromium } from "playwright";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let browser;
let exitCode = 1;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });

  // --- Step 1: collect a font item from a page with a real Google Font ---
  const collectPage = await browser.newPage();
  collectPage.on("pageerror", (err) => console.error("  [pageerror]", err.message));
  await collectPage.goto(
    "data:text/html," +
      encodeURIComponent(`
        <link href="https://fonts.googleapis.com/css2?family=Pacifico&display=swap" rel="stylesheet" />
        <style>#target{font-family:'Pacifico',cursive;font-size:32px;font-weight:400;}</style>
        <div id="target">Handwritten sample</div>
      `),
    { waitUntil: "networkidle", timeout: 30000 }
  );
  await collectPage.evaluate(() => document.fonts.ready);
  await collectPage.evaluate(() => {
    window.chrome = {
      runtime: {
        lastError: null,
        sendMessage(msg, cb) {
          (async () => {
            try {
              if (msg?.type === "FETCH_IMAGE_BYTES" && msg.payload?.url) {
                const res = await fetch(msg.payload.url);
                const buf = new Uint8Array(await res.arrayBuffer());
                cb({ ok: true, bytes: Array.from(buf), contentType: res.headers.get("content-type") || "" });
                return;
              }
              cb({ ok: false });
            } catch (e) {
              cb({ ok: false });
            }
          })();
        },
      },
    };
  });
  await collectPage.addScriptTag({ path: join(ROOT, "src/content/shared.js") });

  const item = await collectPage.evaluate(async () => {
    const el = document.getElementById("target");
    const assets = await Acopio.harvestFontBytesForElement(el);
    return {
      id: "test-font-item-0001",
      type: "font",
      family: "Pacifico",
      note: "",
      data: {
        family: "Pacifico",
        fallbackStack: "'Pacifico', cursive",
        weight: "400",
        sizePx: 32,
        sampleText: "Handwritten sample",
        colorHex: "#222222",
        fontAssets: assets,
      },
    };
  });
  await collectPage.close();

  console.log(`Harvested ${item.data.fontAssets.length} font asset(s) for Pacifico`);
  if (!item.data.fontAssets.length) {
    console.log("\nRESULT: FAIL — no font bytes harvested from the live Google Fonts page (network issue?)");
    process.exit(1);
  }

  // --- Step 2: build the exported catalog.html using the real export code ---
  const exportPage = await browser.newPage();
  exportPage.on("pageerror", (err) => console.error("  [pageerror]", err.message));
  await exportPage.setContent("<div></div>");
  await exportPage.evaluate(() => {
    window.chrome = { runtime: { lastError: null, sendMessage(msg, cb) { cb({ ok: false }); } } };
  });
  for (const rel of ["src/content/shared.js", "src/sidepanel/export/export-helpers.js", "src/sidepanel/export/zip-export.js"]) {
    await exportPage.addScriptTag({ path: join(ROOT, rel) });
  }
  const catalogHtml = await exportPage.evaluate((item) => {
    return AcopioZipExport.buildCatalogHtml([item], { hostname: "example.com" });
  }, item);
  await exportPage.close();

  const hasFaceBlock = /@font-face/.test(catalogHtml) && /data:font/.test(catalogHtml);
  console.log("catalog.html contains an embedded @font-face with real bytes:", hasFaceBlock);

  // --- Step 3: load that HTML standalone, offline, in a fresh context ---
  const viewerPage = await browser.newPage();
  await viewerPage.route("**/fonts.googleapis.com/**", (route) => route.abort());
  await viewerPage.route("**/fonts.gstatic.com/**", (route) => route.abort());
  viewerPage.on("pageerror", (err) => console.error("  [pageerror]", err.message));
  await viewerPage.setContent(catalogHtml, { waitUntil: "load" });
  await viewerPage.evaluate(() => document.fonts.ready);

  const check = await viewerPage.evaluate(() => {
    const sampleEl = document.querySelector(".font-sample");
    const safeFamily = sampleEl ? getComputedStyle(sampleEl).fontFamily.split(",")[0].replace(/['"]/g, "").trim() : "";
    return {
      safeFamily,
      loadable: safeFamily ? document.fonts.check(`16px '${safeFamily}'`) : false,
      sampleText: sampleEl ? sampleEl.textContent : null,
    };
  });

  console.log(JSON.stringify(check, null, 2));

  const fails = [];
  if (!hasFaceBlock) fails.push("catalog.html has no embedded @font-face with real font bytes");
  if (!check.safeFamily || !check.safeFamily.startsWith("acopio-embed") && !check.safeFamily.startsWith("acopio-font")) {
    fails.push(`sample div's font-family doesn't reference the embedded safe family, got "${check.safeFamily}"`);
  }
  if (!check.loadable) {
    fails.push("the embedded font-family is not actually loadable offline — bytes didn't make it in correctly");
  }
  if (check.sampleText !== "Handwritten sample") {
    fails.push(`sample text mismatch: ${JSON.stringify(check.sampleText)}`);
  }

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — exported catalog.html embeds the real collected font and loads it offline, with no network font access at all.");
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  process.exit(exitCode);
}
