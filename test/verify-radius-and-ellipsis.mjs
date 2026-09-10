#!/usr/bin/env node
/**
 * Two independent fixes verified together since both are small "materialize
 * a corrected value before conversion" corrections:
 *
 * 1. border-radius:50% — getComputedStyle never resolves this to a pixel
 *    value (confirmed: returns the literal string "50%" regardless of real
 *    box size, on both shorthand and per-corner longhand). A naive
 *    parseFloat gave an identically wrong "50" on a 64px AND a 200px box.
 *    Fixed by materializeBorderRadiusForCapture resolving percentages
 *    against the box's own real width/height before conversion runs.
 *
 * 2. text-overflow:ellipsis (single-line truncation) — captured the full
 *    untruncated string, not what's visually shown before the ellipsis.
 *    Fixed by materializeSingleLineEllipsisForCapture.
 *
 * Run: node test/verify-radius-and-ellipsis.mjs
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
    <div id="circle" style="width:64px;height:64px;border-radius:50%;background:#333"></div>
    <div id="pill" style="width:200px;height:120px;border-radius:50%;background:#333"></div>
    <div id="plain" style="width:80px;height:80px;border-radius:12px;background:#333"></div>
    <div id="ellipsis-title" style="width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:18px;">This is a very long title that should truncate with an ellipsis at the end</div>
  `);
  await page.evaluate(() => {
    window.chrome = { runtime: { lastError: null, sendMessage(msg, cb) { cb({ ok: true }); } } };
  });
  for (const rel of ["src/content/shared.js", "vendor/dom-to-figma.js", "src/content/figma-clipboard.js"]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const radii = await page.evaluate(async () => {
    const out = {};
    for (const id of ["circle", "pill", "plain"]) {
      const el = document.getElementById(id);
      const res = await AcopioFigmaClipboard.convertLiveToDocument(el, { name: id });
      const frames = (res.document.nodeChanges || []).filter((n) => n.type === "FRAME");
      out[id] = frames[frames.length - 1] ? frames[frames.length - 1].cornerRadius : null;
    }
    return out;
  });

  const ellipsisText = await page.evaluate(async () => {
    const el = document.getElementById("ellipsis-title");
    const res = await AcopioFigmaClipboard.convertLiveToDocument(el, { name: "ellipsis" });
    const text = (res.document.nodeChanges || []).find((n) => n.type === "TEXT");
    return text ? text.characters : null;
  });

  console.log("Radii:", JSON.stringify(radii));
  console.log("Ellipsis text:", JSON.stringify(ellipsisText));

  const fails = [];
  if (radii.circle !== 32) fails.push(`circle cornerRadius expected 32, got ${radii.circle}`);
  if (radii.pill !== 60) fails.push(`pill cornerRadius expected 60, got ${radii.pill}`);
  if (radii.plain !== 12) fails.push(`plain cornerRadius expected 12 (unchanged), got ${radii.plain}`);
  if (!ellipsisText || ellipsisText.length >= 76) fails.push(`ellipsis text not truncated: ${JSON.stringify(ellipsisText)}`);
  if (ellipsisText && !ellipsisText.endsWith("…")) fails.push(`ellipsis text missing trailing "…": ${JSON.stringify(ellipsisText)}`);

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — border-radius resolves correctly, ellipsis text matches what's visually shown.");
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  process.exit(exitCode);
}
