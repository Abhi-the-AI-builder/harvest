#!/usr/bin/env node
/**
 * Playwright harness for verify-fixes.html and verify-clipboard-png.html
 * Run: node test/playwright-verify.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

async function runPageChecks(page, htmlFile, label) {
  const fileUrl = `file://${path.join(ROOT, "test", htmlFile)}`;
  console.log(`\n--- ${label}: ${htmlFile} ---`);
  await page.goto(fileUrl);
  await page.waitForTimeout(1500);

  if (htmlFile === "verify-fixes.html") {
    const exportFails = await page.locator("#zip-section .fail, #copy-section .fail, #notion-section .fail").count();
    const exportPasses = await page.locator("#zip-section .pass, #copy-section .pass, #notion-section .pass").count();
    console.log(`  Export/copy/notion: ${exportPasses} pass, ${exportFails} fail`);
    return exportFails === 0;
  }

  if (htmlFile === "verify-clipboard-png.html") {
    await page.click("#btn-resolve");
    await page.waitForTimeout(500);
    const resolveLog = await page.locator("#log").textContent();
    const resolveOk = resolveLog.includes("70 bytes") && (resolveLog.includes("89 50") || resolveLog.includes("0x89 0x50"));
    console.log(`  Resolve: ${resolveOk ? "PASS" : "FAIL"}`);
    console.log(`  ${resolveLog.split("\n").slice(0, 4).join(" | ")}`);

    // Grant clipboard permissions and test write/read
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.click("#btn-copy");
    await page.waitForTimeout(500);
    const copyLog = await page.locator("#log").textContent();
    const copyOk = copyLog.includes("SUCCESS");
    console.log(`  Copy: ${copyOk ? "PASS" : "FAIL"}`);

    await page.click("#btn-read");
    await page.waitForTimeout(500);
    const readLog = await page.locator("#log").textContent();
    const hasPng = readLog.includes("image/png") && readLog.includes("magic=89 50");
    console.log(`  Read-back: ${hasPng ? "PASS" : "FAIL"}`);
    if (hasPng) {
      const match = readLog.match(/image\/png: (\d+) bytes/);
      if (match) console.log(`  → Clipboard image/png: ${match[1]} bytes`);
    }
    return resolveOk && copyOk && hasPng;
  }

  return false;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

let allOk = true;
try {
  allOk = (await runPageChecks(page, "verify-fixes.html", "Browser module tests")) && allOk;
  allOk = (await runPageChecks(page, "verify-clipboard-png.html", "Clipboard PNG test")) && allOk;
} catch (err) {
  console.error("Playwright error:", err.message);
  allOk = false;
} finally {
  await browser.close();
}

console.log(`\nPlaywright overall: ${allOk ? "ALL PASS" : "SOME FAILURES"}`);
process.exit(allOk ? 0 : 1);
