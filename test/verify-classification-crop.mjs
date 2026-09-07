#!/usr/bin/env node
/**
 * Classification + painted-bounds crop guards (no Figma paste required).
 * Run: node test/verify-classification-crop.mjs
 */
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("https://www.wallofportfolios.in/?company=All", {
  waitUntil: "networkidle",
  timeout: 120000,
});
await page.waitForTimeout(2500);

await page.addScriptTag({ path: join(ROOT, "src/content/shared.js") });

const report = await page.evaluate(() => {
  // Synthetic mixed card (Harshit-style): photo + visible text.
  const card = document.createElement("div");
  card.setAttribute("data-acopio-test-card", "1");
  card.innerHTML = `
    <div class="wrap">
      <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" width="120" height="80" alt="" />
      <div class="meta">
        <div>Harshit Sharma</div>
        <div>Lead Product Designer</div>
        <div style="padding-bottom:8px">7 years of experience</div>
      </div>
    </div>
  `;
  Object.assign(card.style, {
    position: "fixed",
    left: "20px",
    top: "20px",
    width: "200px",
    background: "#fff",
    zIndex: "99999",
  });
  document.body.appendChild(card);

  const icon = Acopio.componentIconFor(card.outerHTML);
  const labels = Acopio.inventoryContainsLabels(card);

  // Overflowing caption below border box
  const row = document.createElement("div");
  row.setAttribute("data-acopio-test-row", "1");
  Object.assign(row.style, {
    position: "fixed",
    left: "240px",
    top: "20px",
    width: "180px",
    height: "100px",
    overflow: "visible",
    background: "#eee",
    zIndex: "99999",
  });
  const caption = document.createElement("div");
  caption.textContent = "Share your work, AI experiments & more";
  Object.assign(caption.style, {
    position: "absolute",
    left: "0",
    top: "100px",
    fontSize: "14px",
    lineHeight: "18px",
    color: "#000",
  });
  row.appendChild(caption);
  document.body.appendChild(row);

  const border = row.getBoundingClientRect();
  const painted = Acopio.measurePaintedBounds(row);

  return {
    icon,
    labels,
    mixedOk: icon === "component" && labels.includes("Image") && labels.includes("Text"),
    borderH: +border.height.toFixed(1),
    paintedH: +painted.height.toFixed(1),
    cropOk: painted.height > border.height + 10,
  };
});

console.log(JSON.stringify(report, null, 2));
const ok = report.mixedOk && report.cropOk;
console.log(ok ? "\nRESULT: PASS" : "\nRESULT: FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
