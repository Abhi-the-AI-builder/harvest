#!/usr/bin/env node
/**
 * User-reported (screenshot): images.html rendered a broken-image icon
 * with alt text "Image 01" bleeding through, for a CSS background-image
 * div (a Webflow "cms_content" element — not a plain <img> tag).
 *
 * Root cause: fetchHttpImageBytes's `if (png || raw) return png || raw;`
 * treated ANY successful HTTP fetch (resp.ok, i.e. any 2xx) as a valid
 * image — `raw` (a Uint8Array) is truthy even when the response body
 * isn't image data at all. A cross-origin fetch from the sidepanel's own
 * chrome-extension:// origin returning a login/error page, or any other
 * non-image 200 response, got written into the ZIP as a real
 * "image-*.png" file and referenced from catalog.html — a file that
 * exists but can never actually decode as an image, which is exactly
 * what a browser shows as a broken-image icon.
 *
 * Fixed by only accepting fetched bytes once they're recognizable as an
 * actual image format (magic-byte sniff covering PNG/JPEG/GIF/WEBP/BMP,
 * plus a text sniff for SVG) — a non-image 200 response now correctly
 * falls through to the existing "couldn't resolve, write a link-only
 * .txt instead" path, same as a genuine network failure already did.
 *
 * Run: node test/verify-export-no-broken-image.mjs
 */
import { chromium } from "playwright";
import { createServer } from "http";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8776;

function startServer() {
  const server = createServer((req, res) => {
    if (req.url === "/real-image.png") {
      // Minimal valid 1x1 PNG.
      const png = Buffer.from(
        "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc0c0c00000030100feff670a5edb0000000049454e44ae426082",
        "hex"
      );
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(png);
      return;
    }
    if (req.url === "/login-page.jpg") {
      // A cross-origin fetch that "succeeds" (200) but the body is a
      // login/error page, not image data — same shape a CORS-restricted
      // site can genuinely return for an unauthenticated background fetch.
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>Please log in to view this content</body></html>");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<div></div>");
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

let browser;
let exitCode = 1;
const server = await startServer();
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("  [pageerror]", err.message));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
  await page.evaluate(() => {
    window.chrome = { runtime: { lastError: null, sendMessage(msg, cb) { if (cb) cb({ ok: false }); } } };
  });
  for (const rel of ["src/content/shared.js", "src/sidepanel/export/export-helpers.js"]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const result = await page.evaluate(async (port) => {
    const realImageBytes = await AcopioExportHelpers.fetchHttpImageBytes(`http://127.0.0.1:${port}/real-image.png`);
    const fakeImageBytes = await AcopioExportHelpers.fetchHttpImageBytes(`http://127.0.0.1:${port}/login-page.jpg`);
    return {
      realImageResolved: !!(realImageBytes && realImageBytes.length),
      realImageIsPng: realImageBytes ? AcopioExportHelpers.isPngBytes(realImageBytes) : false,
      fakeImageResolved: fakeImageBytes !== null,
    };
  }, PORT);

  console.log(JSON.stringify(result, null, 2));

  const fails = [];
  if (!result.realImageResolved || !result.realImageIsPng) {
    fails.push("a genuine PNG response should still resolve successfully — regression in the normal case");
  }
  if (result.fakeImageResolved) {
    fails.push('a 200 response with an HTML/error body was still accepted as a real image — the broken-image-in-export bug is still present');
  }

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — a genuine image still resolves normally; a 200 response with a non-image body is correctly rejected instead of being written into the export as a broken file.");
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
