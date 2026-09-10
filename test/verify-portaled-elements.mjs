#!/usr/bin/env node
/**
 * A React/Vue modal, tooltip, or dropdown rendered as a sibling of <body>
 * (portaled out for z-index/overflow reasons) is invisible to a plain
 * subtree walk from the selected root, even though it visually belongs to
 * the card being captured. Fixed by materializePortaledElementsForCapture,
 * which scans the whole document for real candidates (position:fixed/
 * absolute, substantially overlapping the capture region) and grafts
 * correctly-positioned copies into the clone.
 *
 * Also verifies the conservative side of the fix: an unrelated fixed
 * element elsewhere on the page (a cookie banner, a sticky top bar) that
 * only brushes the capture region must NOT be pulled in.
 *
 * Run: node test/verify-portaled-elements.mjs
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
    <div id="card" style="position:relative;width:240px;height:150px;background:#eee;padding:16px;">
      <div>Card title</div>
      <button id="trigger">Options</button>
    </div>
    <div id="dropdown" style="position:fixed;left:20px;top:80px;width:150px;height:80px;background:navy;color:white;padding:8px;">
      Dropdown menu content
    </div>
    <div id="cookie-banner" style="position:fixed;left:0;top:0;width:100%;height:6px;background:red;"></div>
  `);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.chrome = { runtime: { lastError: null, sendMessage(msg, cb) { cb({ ok: true }); } } };
  });
  for (const rel of ["src/content/shared.js", "vendor/dom-to-figma.js", "src/content/figma-clipboard.js"]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const texts = await page.evaluate(async () => {
    const el = document.getElementById("card");
    const res = await AcopioFigmaClipboard.convertLiveToDocument(el, { name: "card" });
    return (res.document.nodeChanges || []).filter((n) => n.type === "TEXT").map((n) => n.characters);
  });

  console.log(JSON.stringify(texts, null, 2));

  const joined = texts.join(" | ");
  const fails = [];
  if (!joined.includes("Card title")) fails.push("own card content missing");
  if (!joined.includes("Dropdown menu content")) fails.push("portaled dropdown was not pulled in");
  if (joined.toLowerCase().includes("banner")) fails.push("unrelated decoy element was incorrectly pulled in");

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — portaled dropdown included, unrelated decoy correctly excluded.");
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  process.exit(exitCode);
}
