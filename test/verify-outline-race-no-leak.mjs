#!/usr/bin/env node
/**
 * User-reported (live screenshot of the tooltip itself, not an exported
 * file): the dashed hover-selection outline showed up BAKED INTO the
 * preview thumbnail for a "button" family item (a <T> "Pin Sans" /
 * "Button" tag).
 *
 * Root cause: inside render(), buildTypeBody(el, ...) — which kicks off
 * captureElementPreview -> captureElementScreenshot for a "button" family
 * item — used to run 300+ lines BEFORE applyOutline(el). captureElement-
 * Screenshot's hide-list (which own-roots currently overlap the crop) is
 * a synchronous snapshot taken the moment it's called; the actual native
 * capture only fires later, after a double rAF + a message round trip.
 * On the very first-ever hover of a button element, applyOutline (which
 * creates the outline <div> and registers it as an own-root) hadn't run
 * yet when that snapshot was taken — so the outline didn't exist to hide,
 * even though it existed by the time the real screenshot fired a few
 * frames later.
 *
 * Fixed by moving applyOutline(el) to run FIRST in render(), before
 * buildTypeBody — so any capture buildTypeBody triggers always sees the
 * current render's own outline element already in place.
 *
 * This test drives the real showFor() -> render() path (a single, first-
 * ever hover — no second render, no artificial race needed to reproduce
 * this) and inspects the actual preview thumbnail's pixels for the
 * outline's accent color.
 *
 * Run: node test/verify-outline-race-no-leak.mjs
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
    <button id="btn" style="position:absolute;left:250px;top:200px;width:220px;height:60px;font-size:22px;background:#555;color:#fff;border:none;border-radius:8px;">portfolio ⌄</button>
  `);
  await page.waitForTimeout(50);

  await page.exposeFunction("__realCapture", async () => {
    const buf = await page.screenshot({ type: "png" });
    return buf.toString("base64");
  });

  await page.evaluate(() => {
    // Ground truth, recorded at the exact moment the native capture would
    // fire — a screenshot/pixel-scan of a thin, dashed 1.5px border can
    // dilute below a color-tolerance threshold depending on crop geometry
    // and anti-aliasing even when the underlying state is wrong; computed
    // visibility at this precise instant cannot lie about whether the
    // hide actually took effect in time.
    window.__outlineVisibilityAtCaptureTime = null;
    window.chrome = {
      runtime: {
        id: "acopio-test",
        lastError: null,
        getURL(p) {
          return `chrome-extension://test-id/${p}`;
        },
        onMessage: { addListener() {} },
        sendMessage(msg, cb) {
          (async () => {
            try {
              if (msg?.type === "CAPTURE_VISIBLE_TAB") {
                const outlineEl = document.querySelector('[data-acopio="painted-outline"]');
                window.__outlineVisibilityAtCaptureTime = outlineEl
                  ? getComputedStyle(outlineEl).visibility
                  : "no-outline-element";
                const b64 = await window.__realCapture();
                if (cb) cb({ ok: true, dataUrl: `data:image/png;base64,${b64}` });
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
        local: { get(k, cb) { cb({}); }, set(o, cb) { if (cb) cb(); } },
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
  await page.waitForTimeout(50);

  // The ONE real hover that reproduces this — no second render, no
  // artificial delay, exactly what a user does hovering a button for the
  // first time on a page.
  await page.evaluate(() => {
    const el = document.getElementById("btn");
    Acopio.overlay.showFor(el, { type: "font", family: "button" });
  });
  await page.waitForTimeout(400);

  const outlineExists = await page.evaluate(
    () => !!document.querySelector('[data-acopio="painted-outline"]')
  );
  console.log("Outline div exists after the render:", outlineExists);

  const visibilityAtCaptureTime = await page.evaluate(() => window.__outlineVisibilityAtCaptureTime);
  console.log("Outline computed visibility at the exact moment of native capture:", visibilityAtCaptureTime);

  const analysis = await page.evaluate(async ({ accentRgb }) => {
    const host = Acopio.overlayHostNode();
    const thumb = host && host.shadowRoot && host.shadowRoot.querySelector(".component-preview-thumb");
    if (!thumb || !thumb.src) return { noThumb: true };
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = thumb.src;
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
      if (Math.abs(data[i] - ar) < tol && Math.abs(data[i + 1] - ag) < tol && Math.abs(data[i + 2] - ab) < tol) {
        matches += 1;
      }
    }
    return { width, height, accentPixelCount: matches, totalPixels: width * height };
  }, { accentRgb: ACCENT_RGB });

  console.log(JSON.stringify(analysis, null, 2));
  if (pageErrors.length) console.log("Page errors during the flow:", pageErrors);

  const fails = [];
  if (!outlineExists) fails.push("outline div never appeared at all — test setup issue");
  if (visibilityAtCaptureTime !== "hidden") {
    fails.push(
      `outline was NOT actually hidden at the moment of native capture (computed visibility: "${visibilityAtCaptureTime}", expected "hidden") — this is the confirmed root cause, independent of whether the pixel scan below happens to also show contamination`
    );
  }
  if (analysis.noThumb) {
    fails.push("no preview thumbnail was ever produced — test setup issue");
  } else {
    const fraction = analysis.accentPixelCount / Math.max(1, analysis.totalPixels);
    console.log(`Accent-colored pixel fraction in the preview thumbnail: ${(fraction * 100).toFixed(4)}%`);
    if (fraction > 0.001) {
      fails.push(
        `${analysis.accentPixelCount} accent-navy pixels found in the preview thumbnail on a single first-ever hover — this IS the reported bug`
      );
    }
  }

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — a single first-ever hover on a button-family element produces a preview thumbnail with no leaked outline pixels.");
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  process.exit(exitCode);
}
