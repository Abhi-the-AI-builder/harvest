#!/usr/bin/env node
/**
 * A rotated element captured as part of a larger selection (a rotated badge
 * inside an otherwise-normal card) previously came back with `size` set to
 * its rotated BOUNDING BOX while `transform` also carried the real rotation
 * matrix — Figma would draw that oversized box and rotate it AGAIN,
 * compounding into a visibly wrong shape. Verified by precise computation
 * (not eyeballing): all four corners of the emitted geometry, compared
 * against the four corners of the actual live rotated box.
 *
 * Fixed by repairRotatedFramesInDocument, which solves the (exactly
 * invertible) AABB-to-true-local-size linear system from the emitted data
 * alone and corrects `size` in place, leaving `transform` untouched.
 *
 * Also verifies the conservative side: a plain, non-rotated card in the
 * same capture is completely unaffected (this repair runs unconditionally
 * over every FRAME/RECTANGLE node, so a false-positive on ordinary content
 * would be a serious regression).
 *
 * Run: node test/verify-nested-rotation.mjs
 */
import { chromium } from "playwright";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function rotatedCorners(left, top, w, h, degrees) {
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const cx = left + w / 2, cy = top + h / 2;
  const rot = (x, y) => {
    const dx = x - cx, dy = y - cy;
    return [cx + cos * dx - sin * dy, cy + sin * dx + cos * dy];
  };
  return [rot(left, top), rot(left + w, top), rot(left + w, top + h), rot(left, top + h)];
}

function figmaCorners(size, transform) {
  const { x: w, y: h } = size;
  const { m00, m01, m02, m10, m11, m12 } = transform;
  const pt = (lx, ly) => [m00 * lx + m01 * ly + m02, m10 * lx + m11 * ly + m12];
  return [pt(0, 0), pt(w, 0), pt(w, h), pt(0, h)];
}

function maxCornerDelta(a, b) {
  let max = 0;
  for (let i = 0; i < 4; i++) {
    const dx = a[i][0] - b[i][0];
    const dy = a[i][1] - b[i][1];
    max = Math.max(max, Math.hypot(dx, dy));
  }
  return max;
}

let browser;
let exitCode = 1;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("  [pageerror]", err.message));

  await page.setContent(`
    <div id="parent" style="width:400px;height:300px;position:relative;background:#eee;">
      <div id="badge" style="position:absolute;left:20px;top:20px;width:100px;height:60px;background:orange;transform:rotate(30deg);"></div>
      <div id="plain" style="position:absolute;left:200px;top:150px;width:80px;height:40px;background:teal;"></div>
    </div>
  `);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.chrome = { runtime: { lastError: null, sendMessage(msg, cb) { cb({ ok: true }); } } };
  });
  for (const rel of ["src/content/shared.js", "vendor/dom-to-figma.js", "src/content/figma-clipboard.js"]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const result = await page.evaluate(async () => {
    const el = document.getElementById("parent");
    const out = await AcopioFigmaClipboard.convertLiveToDocument(el, { name: "parent" });
    const changes = out.document.nodeChanges || [];
    const rotated = changes.find(
      (n) => n.transform && (Math.abs(n.transform.m01) > 1e-3 || Math.abs(n.transform.m10) > 1e-3)
    );
    const plain = changes.find(
      (n) =>
        n.size &&
        Math.round(n.size.x) === 80 &&
        Math.round(n.size.y) === 40
    );
    return {
      rotated: rotated ? { size: rotated.size, transform: rotated.transform } : null,
      plain: plain ? { size: plain.size, transform: plain.transform } : null,
    };
  });

  console.log(JSON.stringify(result, null, 2));

  const fails = [];
  if (!result.rotated) {
    fails.push("no rotated node found in output at all");
  } else {
    const trueCorners = rotatedCorners(20, 20, 100, 60, 30);
    const emittedCorners = figmaCorners(result.rotated.size, result.rotated.transform);
    const delta = maxCornerDelta(trueCorners, emittedCorners);
    console.log("max corner delta (px):", delta.toFixed(2));
    if (delta > 2) {
      fails.push(`rotated badge corners off by ${delta.toFixed(1)}px (expected < 2px)`);
    }
    if (Math.round(result.rotated.size.x) >= 110 || Math.round(result.rotated.size.y) >= 95) {
      fails.push(`rotated badge size still looks like the AABB (117x102), not the true 100x60: got ${JSON.stringify(result.rotated.size)}`);
    }
  }
  if (!result.plain) {
    fails.push("plain non-rotated sibling not found or its size was altered");
  } else if (Math.abs(result.plain.transform.m01) > 1e-4 || Math.abs(result.plain.transform.m10) > 1e-4) {
    fails.push("plain non-rotated sibling was incorrectly given a rotation component");
  }

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — nested rotation corners match the live DOM within 2px, plain sibling untouched.");
    exitCode = 0;
  }
} catch (err) {
  console.error("FATAL", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  process.exit(exitCode);
}
