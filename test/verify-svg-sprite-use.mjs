#!/usr/bin/env node
/**
 * The single most common real icon pattern: one hidden <svg><symbol> sprite
 * sheet, referenced everywhere via <use href="#icon-x">. Confirmed live:
 * converted to a completely empty vector with zero fill geometry, even
 * though the browser resolves and paints <use> fine — the converter reads
 * an SVG's own literal child elements structurally, and a <use> element has
 * none of its own. Fixed by materializeSvgUseForCapture, which inlines the
 * real referenced content before conversion ever runs.
 *
 * Run: node test/verify-svg-sprite-use.mjs
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

  await page.setContent(`
    <svg style="display:none">
      <symbol id="icon-star" viewBox="0 0 24 24">
        <path d="M12 2 L15 9 L22 9 L16 14 L18 21 L12 17 L6 21 L8 14 L2 9 L9 9 Z" fill="orange"></path>
      </symbol>
    </svg>
    <div id="card" style="width:120px;height:120px;background:#eee;padding:20px;">
      <svg id="icon" width="48" height="48"><use href="#icon-star"></use></svg>
    </div>
  `);
  await page.evaluate(() => {
    window.chrome = { runtime: { lastError: null, sendMessage(msg, cb) { cb({ ok: true }); } } };
  });
  for (const rel of ["src/content/shared.js", "vendor/dom-to-figma.js", "src/content/figma-clipboard.js"]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const nodes = await page.evaluate(async () => {
    const el = document.getElementById("card");
    const res = await AcopioFigmaClipboard.convertLiveToDocument(el, { name: "card" });
    return (res.document.nodeChanges || []).map((n) => ({
      type: n.type,
      fills: (n.fillPaints || []).map((p) => p.color),
    }));
  });

  console.log(JSON.stringify(nodes, null, 2));

  const vector = nodes.find((n) => n.type === "VECTOR");
  const isOrange =
    vector &&
    vector.fills[0] &&
    Math.abs(vector.fills[0].r - 1) < 0.01 &&
    Math.abs(vector.fills[0].g - 0.6470588) < 0.01 &&
    Math.abs(vector.fills[0].b - 0) < 0.01;

  if (!vector) {
    console.log("\nRESULT: FAIL — no VECTOR node at all; <use> sprite reference did not resolve.");
    exitCode = 1;
  } else if (!isOrange) {
    console.log("\nRESULT: FAIL — VECTOR node present but wrong/missing fill color.");
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — sprite <use> resolved to a real orange VECTOR node.");
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  process.exit(exitCode);
}
