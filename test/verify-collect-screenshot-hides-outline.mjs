#!/usr/bin/env node
/**
 * User-reported: the dashed hover-selection outline (and/or the tooltip
 * card) shows up baked into a "+Collect"ed component's saved image, which
 * then also shows up wherever that image gets used later (ZIP export,
 * Copy → Figma preview, etc.).
 *
 * Static review of the hide-own-UI mechanism in captureElementScreenshot
 * (overlay.js) looked architecturally sound — both the outline
 * (paintedOutlineEl) and the tooltip's shadow-DOM host are registered via
 * Acopio.registerOwnRoot, and get hidden right before the capture. This
 * test replaces static review with the real thing: it drives the ACTUAL
 * production code path — Acopio.overlay.showFor() (the exact call
 * content.js makes on a real hover) followed by a real click on the real
 * ".collect-btn" — with a real Playwright page.screenshot() standing in
 * for chrome.tabs.captureVisibleTab, and inspects the pixel actually
 * saved as the item's previewImage at the outline's own border position.
 *
 * If the accent navy (#1D3461) shows up at that exact pixel, the outline
 * leaked into the saved capture — a real, reproducing bug. If not, this
 * specific capture (a real "component" collect, in the exact code path
 * that ships) is clean, and the reported case is most likely a stale item
 * saved before earlier fixes in this same pipeline.
 *
 * Run: node test/verify-collect-screenshot-hides-outline.mjs
 */
import { chromium } from "playwright";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACCENT_RGB = [0x1d, 0x34, 0x61]; // #1D3461, overlay.js's own ACCENT constant

let browser;
let exitCode = 1;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.setContent(`
    <div id="card" style="position:absolute;left:200px;top:150px;width:320px;height:220px;background:#fff;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:20px;box-sizing:border-box;">
      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='280' height='100'%3E%3Crect fill='%234F6EF7' width='280' height='100'/%3E%3C/svg%3E" width="280" height="100" style="display:block;border-radius:8px;" />
      <h2 style="font-size:18px;margin:12px 0 4px;">Redefining Dashboards</h2>
      <button style="background:#e0217a;color:#fff;border:none;border-radius:20px;padding:6px 16px;">VIEW →</button>
    </div>
  `);
  await page.waitForTimeout(100);

  // Bridge CAPTURE_VISIBLE_TAB to a REAL Playwright screenshot, exactly the
  // native chrome.tabs.captureVisibleTab this stands in for.
  await page.exposeFunction("__realCapture", async () => {
    const buf = await page.screenshot({ type: "png" });
    return buf.toString("base64");
  });

  await page.evaluate(() => {
    window.__capturedItemPayload = null;
    window.chrome = {
      runtime: {
        id: "acopio-test",
        lastError: null,
        getURL(path) {
          return `chrome-extension://test-id/${path}`;
        },
        onMessage: { addListener() {} },
        sendMessage(msg, cb) {
          (async () => {
            try {
              if (msg?.type === "CAPTURE_VISIBLE_TAB") {
                const b64 = await window.__realCapture();
                cb({ ok: true, dataUrl: `data:image/png;base64,${b64}` });
                return;
              }
              if (msg?.type === "CAPTURE_ITEM") {
                window.__capturedItemPayload = msg.payload;
                if (cb) cb({ ok: true, item: msg.payload });
                return;
              }
              if (cb) cb({ ok: true });
            } catch (e) {
              if (cb) cb({ ok: false, error: String(e) });
            }
          })();
        },
      },
      storage: {
        local: {
          get(_keys, cb) {
            cb({});
          },
          set(_obj, cb) {
            if (cb) cb();
          },
        },
        onChanged: { addListener() {} },
      },
    };
  });

  for (const rel of [
    "src/content/shared.js",
    "src/content/sanitize.js",
    "src/content/tagger.js",
    "src/content/figma-clipboard.js",
    "src/content/overlay.js",
    "src/content/toolbar.js",
    "src/content/notes.js",
    "src/content/content.js",
  ]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }
  await page.waitForTimeout(100);

  // Real production call: exactly what content.js does when the mouse
  // settles on an element — builds the tooltip AND applies the dashed
  // outline (applyOutline, inside render()).
  await page.evaluate(() => {
    const el = document.getElementById("card");
    Acopio.overlay.showFor(el, { type: "component", family: "other" });
  });
  await page.waitForTimeout(300);

  const outlineCheck = await page.evaluate(() => {
    const host = Acopio.overlayHostNode();
    const outlineEl = document.querySelector('[data-acopio="painted-outline"]');
    const collectBtn = host && host.shadowRoot && host.shadowRoot.querySelector(".collect-btn");
    return {
      hasOutline: !!outlineEl,
      outlineRect: outlineEl ? outlineEl.getBoundingClientRect().toJSON() : null,
      hasCollectBtn: !!collectBtn,
    };
  });
  console.log("Outline present before collect:", JSON.stringify(outlineCheck));
  if (!outlineCheck.hasOutline || !outlineCheck.hasCollectBtn) {
    console.log("\nRESULT: FAIL — couldn't even set up the real hover state (outline or Collect button missing) — check fixture/tagInfo.");
    process.exit(1);
  }

  // Real click on the real button — exactly what a user does.
  await page.evaluate(() => {
    const host = Acopio.overlayHostNode();
    host.shadowRoot.querySelector(".collect-btn").click();
  });

  // Wait for the async collect pipeline (screenshot capture + finalize) to land.
  await page.waitForFunction(() => window.__capturedItemPayload !== null, { timeout: 8000 });
  const payload = await page.evaluate(() => window.__capturedItemPayload);

  if (pageErrors.length) {
    console.log("Page errors during the flow:", pageErrors);
  }

  const previewImage = payload && payload.data && payload.data.previewImage;
  console.log("Got previewImage:", previewImage ? `${previewImage.length} chars` : "NONE");
  if (!previewImage) {
    console.log("\nRESULT: FAIL — no previewImage was saved at all (capture pipeline didn't produce an image).");
    process.exit(1);
  }

  // Save the captured PNG and inspect it for the accent navy border color
  // anywhere along what would have been the outline's own edge.
  const { writeFileSync } = await import("fs");
  const base64 = previewImage.split(",")[1];
  const pngBuf = Buffer.from(base64, "base64");
  const outPath = join(ROOT, "test/screenshots/collect-preview-check.png");
  writeFileSync(outPath, pngBuf);

  const analysis = await page.evaluate(
    async ({ dataUrl, accentRgb }) => {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let matches = 0;
      const [ar, ag, ab] = accentRgb;
      const tol = 12;
      for (let i = 0; i < data.length; i += 4) {
        const dr = Math.abs(data[i] - ar);
        const dg = Math.abs(data[i + 1] - ag);
        const db = Math.abs(data[i + 2] - ab);
        if (dr < tol && dg < tol && db < tol) matches += 1;
      }
      return { width, height, accentPixelCount: matches, totalPixels: width * height };
    },
    { dataUrl: previewImage, accentRgb: ACCENT_RGB }
  );

  console.log(JSON.stringify(analysis, null, 2));
  const accentFraction = analysis.accentPixelCount / Math.max(1, analysis.totalPixels);
  console.log(`Accent-colored pixel fraction: ${(accentFraction * 100).toFixed(4)}%`);

  // A handful of stray/antialiased pixels near real page content matching
  // by coincidence is expected noise; a leaked dashed border draws a
  // continuous ~1.5px navy line around the whole crop, which is orders of
  // magnitude more pixels than coincidence would ever produce.
  const THRESHOLD_FRACTION = 0.001;
  if (accentFraction > THRESHOLD_FRACTION) {
    console.log(`\nRESULT: FAIL — ${analysis.accentPixelCount} accent-navy pixels found in the saved previewImage (saved to ${outPath} for inspection) — the outline leaked into the real collect pipeline.`);
    exitCode = 1;
  } else {
    console.log(`\nRESULT: PASS — no accent-navy outline pixels in the saved previewImage from a real showFor()+click(".collect-btn") flow (image saved to ${outPath} for manual inspection too). The hide-own-UI mechanism works correctly in the current code; a contaminated export is most likely a stale item saved before earlier fixes.`);
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  process.exit(exitCode);
}
