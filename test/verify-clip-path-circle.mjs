#!/usr/bin/env node
/**
 * clip-path: circle()/ellipse() is invisible to a plain DOM+computed-style
 * capture — the box still converts as a full rectangle. Fixed by
 * materializeClipPathForCapture, which rewrites an INSCRIBED circle/ellipse
 * (centered, sized to the box) as real border-radius:50%+overflow:hidden —
 * properties the pipeline already converts correctly for any content, not
 * just <img>.
 *
 * Also verifies the conservative side: an OFF-CENTER circle (a partial crop,
 * not a full avatar-style clip) must NOT be forced into a centered circle,
 * since that would misrepresent the crop rather than just leaving it as an
 * unclipped rectangle.
 *
 * Run: node test/verify-clip-path-circle.mjs
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
    <div id="avatar" style="width:100px;height:100px;background:green;clip-path:circle(50%);"></div>
    <div id="ellipseAvatar" style="width:160px;height:100px;background:teal;clip-path:ellipse(50% 50% at 50% 50%);"></div>
    <div id="offcenter" style="width:100px;height:100px;background:purple;clip-path:circle(20px at 15px 15px);"></div>
  `);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.chrome = { runtime: { lastError: null, sendMessage(msg, cb) { cb({ ok: true }); } } };
  });
  for (const rel of ["src/content/shared.js", "vendor/dom-to-figma.js", "src/content/figma-clipboard.js"]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const results = await page.evaluate(async () => {
    async function frameFor(id) {
      const el = document.getElementById(id);
      const res = await AcopioFigmaClipboard.convertLiveToDocument(el, { name: id });
      const changes = res.document.nodeChanges || [];
      // The frame representing the element itself is the one sized to its rect.
      return changes.find((n) => Math.round(n.size?.x || 0) === Math.round(el.getBoundingClientRect().width));
    }
    const avatar = await frameFor("avatar");
    const ellipseAvatar = await frameFor("ellipseAvatar");
    const offcenter = await frameFor("offcenter");
    return {
      avatarRadius: avatar?.cornerRadius ?? avatar?.rectangleCornerRadii ?? null,
      avatarClips: avatar?.clipsContent ?? null,
      ellipseRadius: ellipseAvatar?.cornerRadius ?? null,
      offcenterRadius: offcenter?.cornerRadius ?? null,
    };
  });

  console.log(JSON.stringify(results, null, 2));

  const fails = [];
  if (!results.avatarRadius || results.avatarRadius < 40) {
    fails.push(`inscribed circle: expected ~50px cornerRadius, got ${results.avatarRadius}`);
  }
  if (!results.ellipseRadius || results.ellipseRadius < 40) {
    fails.push(`inscribed ellipse: expected ~50px cornerRadius, got ${results.ellipseRadius}`);
  }
  if (results.offcenterRadius && results.offcenterRadius > 0) {
    fails.push(`off-center circle should NOT be forced into a centered circle, got cornerRadius ${results.offcenterRadius}`);
  }

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — inscribed circle/ellipse clip-path converts to real corner radius, off-center case left alone.");
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  process.exit(exitCode);
}
