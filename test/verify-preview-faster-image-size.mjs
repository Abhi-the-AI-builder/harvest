#!/usr/bin/env node
/**
 * User-reported: the tooltip's live preview felt slow to render a high-
 * quality Pinterest image. Root cause: the preview thumbnail (a fixed
 * 140px box, per this session's own earlier fix) was requesting the same
 * full /originals/ file Collect saves — often several megabytes — just to
 * shrink it into a small box. That download time is exactly the "slow"
 * the user felt, and it bought nothing visually since the box is tiny.
 *
 * Fixed by giving the live preview its own resolver
 * (Acopio.resolveImgSrcForPreview / upgradeImageUrlForPreview) that
 * targets Pinterest's /736x/ derivative instead of /originals/ — already
 * cached for virtually every pin, comfortably larger than the 140px box
 * even at 2x DPI, and a fraction of the download size. Collect/export
 * still resolves the real, full-resolution URL independently at save
 * time (buildTypeData in content.js), so final quality is unaffected.
 *
 * This test drives the real showFor() -> render() path for both the
 * plain "image" type and a "component" containing a dominant photo, and
 * inspects the actual <img>/<video> src the tooltip put on screen.
 *
 * Run: node test/verify-preview-faster-image-size.mjs
 */
import { chromium } from "playwright";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PIN_ORIGINAL = "https://i.pinimg.com/236x/ab/cd/ef/abcdef1234567890.jpg";

let browser;
let exitCode = 1;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.setContent(`
    <img id="pin" src="${PIN_ORIGINAL}" style="position:absolute;left:200px;top:150px;width:200px;height:200px;display:block;" />
    <div id="card" style="position:absolute;left:200px;top:400px;width:300px;height:200px;background:#fff;">
      <img src="${PIN_ORIGINAL}" style="width:280px;height:180px;display:block;" />
    </div>
  `);
  await page.waitForTimeout(50);

  // No real network needed for this check — just inspect what src the
  // tooltip actually assigns, before any fetch happens.
  await page.route("**/i.pinimg.com/**", (route) => route.abort());

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

  // Case 1: plain "image" type.
  await page.evaluate(() => {
    const el = document.getElementById("pin");
    Acopio.overlay.showFor(el, { type: "image", family: "image" });
  });
  await page.waitForTimeout(200);
  const imageTypeSrc = await page.evaluate(() => {
    const host = Acopio.overlayHostNode();
    const img = host && host.shadowRoot && host.shadowRoot.querySelector(".image-swatch-card .thumb");
    return img ? img.src : null;
  });
  console.log("Plain image type preview src:", imageTypeSrc);

  // Case 2: "component" containing a dominant inner photo (the instant
  // placeholder path, separate branch, separate call site).
  await page.evaluate(() => {
    const el = document.getElementById("card");
    Acopio.overlay.showFor(el, { type: "component", family: "other" });
  });
  await page.waitForTimeout(200);
  const componentPlaceholderSrc = await page.evaluate(() => {
    const host = Acopio.overlayHostNode();
    const img = host && host.shadowRoot && host.shadowRoot.querySelector(".image-swatch-card .thumb");
    return img ? img.src : null;
  });
  console.log("Component instant-placeholder preview src:", componentPlaceholderSrc);

  // Confirm collect-time resolution (an independent code path,
  // content.js's buildTypeData) still gets the real, full-resolution URL —
  // this is what Acopio.resolveImgSrc (no "ForPreview") is used for.
  const collectTimeUrl = await page.evaluate((url) => Acopio.resolveImgSrc({ currentSrc: url, src: url }), PIN_ORIGINAL);
  console.log("Collect-time (buildTypeData) resolved URL:", collectTimeUrl);

  if (pageErrors.length) console.log("Page errors during the flow:", pageErrors);

  const fails = [];
  if (!imageTypeSrc || !imageTypeSrc.includes("/736x/")) {
    fails.push(`plain image preview should request /736x/, got "${imageTypeSrc}"`);
  }
  if (imageTypeSrc && imageTypeSrc.includes("/originals/")) {
    fails.push(`plain image preview should NOT request the full /originals/ file, got "${imageTypeSrc}"`);
  }
  if (!componentPlaceholderSrc || !componentPlaceholderSrc.includes("/736x/")) {
    fails.push(`component instant-placeholder preview should request /736x/, got "${componentPlaceholderSrc}"`);
  }
  if (!collectTimeUrl || !collectTimeUrl.includes("/originals/")) {
    fails.push(`collect-time resolution should still get the full /originals/ file (unaffected by the preview speedup), got "${collectTimeUrl}"`);
  }

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — both preview paths request the smaller, faster /736x/ derivative instead of the full original; collect-time resolution is untouched and still gets full quality.");
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  process.exit(exitCode);
}
