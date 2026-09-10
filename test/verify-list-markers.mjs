#!/usr/bin/env node
/**
 * List bullets/numbers are browser-rendered, not literal DOM text — a
 * plain capture of <li> text content drops them. Fixed by
 * materializeListMarkersForCapture. Also verifies a real ordering bug
 * found while building this: the vendor converter reorders a node's
 * mixed element + bare-text-node children (elements come out first
 * regardless of true DOM order), which put a correctly-DOM-first marker
 * AFTER its own list item's text in the actual result — fixed by
 * wrapping the original content in its own sibling span too.
 *
 * Run: node test/verify-list-markers.mjs
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
    <ul id="ulist"><li>Apples</li><li>Bananas</li></ul>
    <ol id="olist" start="3"><li>Third</li><li>Fourth</li></ol>
  `);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.chrome = { runtime: { lastError: null, sendMessage(msg, cb) { cb({ ok: true }); } } };
  });
  for (const rel of ["src/content/shared.js", "vendor/dom-to-figma.js", "src/content/figma-clipboard.js"]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const [ulist, olist] = await Promise.all(
    ["ulist", "olist"].map((id) =>
      page.evaluate(async (id) => {
        const el = document.getElementById(id);
        const res = await AcopioFigmaClipboard.convertLiveToDocument(el, { name: id });
        return (res.document.nodeChanges || [])
          .filter((n) => n.type === "TEXT")
          .map((n) => ({ text: n.characters, x: n.transform ? n.transform.m02 ?? n.transform[4] : null }));
      }, id)
    )
  );

  console.log("ulist:", JSON.stringify(ulist));
  console.log("olist:", JSON.stringify(olist));

  const fails = [];
  if (ulist[0]?.text !== "•" || ulist[0].x !== 0) fails.push("first ulist item's bullet missing or not at x=0");
  if (ulist[1]?.text !== "Apples" || !(ulist[1].x > 0)) fails.push("'Apples' missing or not positioned after its bullet");
  if (olist[0]?.text !== "3.") fails.push(`expected "3." (start=3), got ${JSON.stringify(olist[0]?.text)}`);
  if (olist[2]?.text !== "4.") fails.push(`expected "4.", got ${JSON.stringify(olist[2]?.text)}`);

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — markers present, correctly ordered before their content, start offset respected.");
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  process.exit(exitCode);
}
