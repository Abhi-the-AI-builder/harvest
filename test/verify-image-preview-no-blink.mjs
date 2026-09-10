#!/usr/bin/env node
/**
 * User-reported (two rounds):
 * 1. On Pinterest, hovering a pin makes Acopio upgrade the page's small
 *    grid thumbnail to the real full-resolution original for the preview —
 *    a much bigger, slower-loading file. The WHOLE tooltip visibly
 *    blinked/jumped the instant that download finished, not just the
 *    preview image itself.
 * 2. The first fix (reserve the box via CSS aspect-ratio computed from the
 *    source's own w/h) created a NEW bug: a tall Pinterest pin (236x419,
 *    a real reported case) produced a huge ~500px-tall preview box, since
 *    aspect-ratio has no ceiling of its own. Directly reported with a
 *    screenshot showing the ballooned preview area.
 *
 * Root cause of both: no fixed reference size at all originally (only a
 * max-height ceiling on the <img> itself, not the container — height:auto
 * meant near-zero space until load), then an aspect-ratio-derived size
 * that scales unboundedly with the source's own shape.
 *
 * 3. Even with a fixed height, the component preview still showed visible
 *    empty space above/below the screenshot — object-fit:contain (chosen
 *    to "show the full selection, never crop") letterboxes anything that
 *    isn't exactly the box's own ratio. Reported live with a 942x544
 *    component leaving gaps in a 140px-tall box; asked to zoom/crop
 *    instead so there's never empty space, at the cost of not always
 *    showing every edge pixel.
 *
 * Fixed properly this time: .image-swatch-card is a genuinely FIXED
 * 140px height for BOTH images and components (one shared constant, not
 * two) — NOT derived from the source at all — with object-fit:cover
 * cropping any shape to fill it completely, the same way a photo grid
 * thumbnail works. A portrait pin, a landscape banner, and a wide
 * component screenshot all get the identical, fully-filled preview size.
 *
 * This test drives the real showFor() -> render() path with a genuinely
 * DELAYED image response (a real network round-trip, not a timer) using a
 * TALL portrait image matching the exact reported aspect ratio, and
 * measures the card's actual bounding box before and after that delayed
 * load completes, plus the absolute preview height against the fixed
 * constant.
 *
 * Run: node test/verify-image-preview-no-blink.mjs
 */
import { chromium } from "playwright";
import { createServer } from "http";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8775;

// 400x300 solid-color PNG (the "high quality" image), and a 40x30 thumb of
// the exact same aspect ratio (the on-page placeholder) — both 1x1-pixel
// PNGs stretched are fine, only the declared pixel dimensions matter here.
const PNG_1PX =
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc0c0c00000030100feff670a5edb0000000049454e44ae426082";
function pngBuffer() {
  return Buffer.from(PNG_1PX, "hex");
}

function startServer() {
  let releaseSlow = null;
  const slowReady = new Promise((resolve) => (releaseSlow = resolve));
  const server = createServer((req, res) => {
    if (req.url === "/thumb.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(pngBuffer());
      return;
    }
    if (req.url === "/highres.png") {
      // Genuinely slow — resolves only once the test explicitly releases
      // it, so "before vs after that load lands" is unambiguous.
      slowReady.then(() => {
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(pngBuffer());
      });
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <img id="pin" src="/thumb.png" width="236" height="419" style="display:block;" />
    `);
  });
  return new Promise((resolve) => {
    server.listen(PORT, "127.0.0.1", () => resolve({ server, releaseSlow: () => releaseSlow() }));
  });
}

let browser;
let exitCode = 1;
const { server, releaseSlow } = await startServer();
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
  await page.waitForTimeout(50);

  await page.evaluate(() => {
    window.chrome = {
      runtime: {
        id: "acopio-test",
        lastError: null,
        getURL(p) {
          return `chrome-extension://test-id/${p}`;
        },
        onMessage: { addListener() {} },
        sendMessage(msg, cb) {
          if (cb) cb({ ok: true });
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

  // Point Acopio's own preview-resolution resolver at the slow endpoint —
  // same real function the tooltip's live preview actually calls
  // (Acopio.resolveImgSrcForPreview -> Acopio.upgradeImageUrlForPreview,
  // a separate, smaller-derivative resolver from the full-resolution one
  // Collect/export uses), not a reimplementation.
  await page.evaluate((port) => {
    const original = Acopio.upgradeImageUrlForPreview;
    Acopio.upgradeImageUrlForPreview = function (url) {
      if (String(url).includes("/thumb.png")) {
        return `http://127.0.0.1:${port}/highres.png`;
      }
      return original ? original(url) : url;
    };
  }, PORT);

  await page.evaluate(() => {
    const el = document.getElementById("pin");
    Acopio.overlay.showFor(el, { type: "image", family: "image" });
  });
  await page.waitForTimeout(300);

  function measureCard() {
    return page.evaluate(() => {
      const host = Acopio.overlayHostNode();
      const cardEl = host && host.shadowRoot && host.shadowRoot.querySelector(".card");
      const swatch = host && host.shadowRoot && host.shadowRoot.querySelector(".image-swatch-card");
      const img = host && host.shadowRoot && host.shadowRoot.querySelector(".thumb");
      return {
        cardHeight: cardEl ? cardEl.getBoundingClientRect().height : null,
        swatchHeight: swatch ? swatch.getBoundingClientRect().height : null,
        imgComplete: img ? img.complete && img.naturalWidth > 0 : null,
        isPending: swatch ? swatch.classList.contains("image-swatch-card-pending") : null,
      };
    });
  }

  const beforeLoad = await measureCard();
  console.log("Before the slow high-res image resolves:", JSON.stringify(beforeLoad));

  // Now let the slow "full resolution" download actually complete.
  releaseSlow();
  await page.waitForTimeout(300);

  const afterLoad = await measureCard();
  console.log("After the slow high-res image resolves:", JSON.stringify(afterLoad));

  // Component previews share the same fixed 140px height as images (via
  // .image-swatch-card-component) — one constant, not two.
  await page.evaluate(() => {
    const el = document.getElementById("pin");
    Acopio.overlay.showFor(el, { type: "component", family: "other" });
  });
  await page.waitForTimeout(300);
  const componentSwatch = await page.evaluate(() => {
    const host = Acopio.overlayHostNode();
    const swatch = host && host.shadowRoot && host.shadowRoot.querySelector(".image-swatch-card");
    const thumb = swatch ? swatch.querySelector(".thumb") : null;
    return {
      height: swatch ? swatch.getBoundingClientRect().height : null,
      hasComponentClass: swatch ? swatch.classList.contains("image-swatch-card-component") : null,
      // Fills the box completely (crops instead of letterboxing) — this is
      // what actually eliminates the reported empty space, not just the
      // fixed height on its own.
      objectFit: thumb ? getComputedStyle(thumb).objectFit : null,
    };
  });
  console.log("Component preview swatch:", JSON.stringify(componentSwatch));

  if (pageErrors.length) console.log("Page errors during the flow:", pageErrors);

  const fails = [];
  if (beforeLoad.swatchHeight == null || beforeLoad.swatchHeight <= 0) {
    fails.push("no reserved swatch height BEFORE the high-res image loaded at all — box wasn't pre-sized");
  }
  if (beforeLoad.isPending !== true) {
    fails.push("expected the pending/shimmer state to be active before the high-res image loads");
  }
  if (afterLoad.isPending !== false) {
    fails.push("expected the pending/shimmer state to clear once the high-res image loads");
  }
  if (!afterLoad.imgComplete) {
    fails.push("the high-res image never actually finished loading — test setup issue");
  }
  if (
    beforeLoad.cardHeight == null ||
    afterLoad.cardHeight == null ||
    Math.abs(beforeLoad.cardHeight - afterLoad.cardHeight) > 1
  ) {
    fails.push(
      `tooltip card height changed when the high-res image loaded: ${beforeLoad.cardHeight} -> ${afterLoad.cardHeight} (this IS the reported "whole tooltip blinks" bug if it moved)`
    );
  }
  if (
    beforeLoad.swatchHeight == null ||
    afterLoad.swatchHeight == null ||
    Math.abs(beforeLoad.swatchHeight - afterLoad.swatchHeight) > 1
  ) {
    fails.push(`preview box height changed when the image loaded: ${beforeLoad.swatchHeight} -> ${afterLoad.swatchHeight} (should stay static per direct request)`);
  }
  // The regression this test was extended to catch: a naive aspect-ratio
  // reservation computed from this exact 236x419 portrait source would
  // produce a box roughly 280 * (419/236) =~ 497px tall — nowhere near a
  // small, constant preview size. Confirms the fix is a real fixed
  // height, not just "consistent before/after" (which an oversized-but-
  // stable box would also satisfy).
  if (afterLoad.swatchHeight == null || afterLoad.swatchHeight > 200) {
    fails.push(
      `preview box is ${afterLoad.swatchHeight}px tall for a 236x419 portrait source — expected a small FIXED height (~140px), not one derived from the image's own aspect ratio`
    );
  }
  if (!componentSwatch.hasComponentClass) {
    fails.push("component preview swatch missing the .image-swatch-card-component modifier class");
  }
  if (componentSwatch.height == null || Math.abs(componentSwatch.height - 140) > 1) {
    fails.push(`component preview height expected to be a fixed 140px, got ${componentSwatch.height}`);
  }
  if (componentSwatch.objectFit !== "cover") {
    fails.push(
      `component preview thumb should use object-fit:cover to fill the box with no empty space, got "${componentSwatch.objectFit}" — this is the reported empty-space bug if it's "contain"`
    );
  }

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — the preview box is pre-sized and stays static (card height unchanged) while a slow high-resolution image loads in; only the preview area itself shows the loading shimmer.");
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
  process.exit(exitCode);
}
