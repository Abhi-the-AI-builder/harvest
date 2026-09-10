#!/usr/bin/env node
/**
 * User's question: "why the image was not able to export if it got
 * collected" — answered by root-causing that a plain <img src> display
 * (unrestricted) and a fetch() to read raw bytes (CORS-restricted) are
 * different operations. inlineImageUrlAtCapture (Collect time) only ever
 * tried a plain fetch() from the content script's own page context — a
 * cross-origin image whose server doesn't grant CORS to that origin fails
 * there no matter what, even though the picture displays fine everywhere
 * (Library, tooltip) since those just point an <img> at the live URL.
 *
 * Then: "can we fix that?" — yes, partially: the background service
 * worker can fetch cross-origin resources exempt from the TARGET
 * server's CORS policy entirely, because Chrome grants that once the
 * extension holds host_permissions covering the URL (this extension
 * declares <all_urls>). export-helpers.js's own export-time fetch
 * already tries this background fallback; Collect-time inlining never
 * did. Fixed by adding the same fallback to inlineImageUrlAtCapture, so
 * an item becomes a fully self-contained file (data.inlineDataUrl) at
 * the moment it's collected whenever the extension's own permissions
 * allow it, instead of only ever depending on the source staying live
 * and fetchable whenever export happens to run later.
 *
 * This drives the REAL Collect flow end to end — showFor() -> real click
 * on the real ".collect-btn" -> the real CAPTURE_ITEM payload — with the
 * page's own fetch() for the image URL deliberately rejected (simulating
 * a real cross-origin CORS failure) while the mocked "background
 * service worker" relay succeeds, same asymmetry a real CORS-restricted
 * image has in production.
 *
 * Run: node test/verify-collect-cors-fallback.mjs
 */
import { chromium } from "playwright";
import { createServer } from "http";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8777;

const JPEG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc0c0c00000030100feff670a5edb0000000049454e44ae426082",
  "hex"
); // (a 1x1 PNG works fine here — only recognizability + round-trip matters, not the exact format)

function startServer() {
  const server = createServer((req, res) => {
    if (req.url === "/cross-origin-photo.jpg") {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(JPEG_BYTES);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<img id="pic" src="/cross-origin-photo.jpg" width="100" height="100" style="position:absolute;left:100px;top:100px;display:block;" />`);
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

let browser;
let exitCode = 1;
const server = await startServer();
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
  // Long enough for the page's own initial <img> load to genuinely finish
  // before the route below starts intercepting — otherwise the very
  // first image request can itself get caught mid-flight, which isn't
  // what this test is isolating (only the LATER fetch() attempt should
  // be blocked, exactly like a real cross-origin CORS rejection would be
  // while the image itself already displays fine).
  await page.waitForTimeout(200);

  const imageUrl = `http://127.0.0.1:${PORT}/cross-origin-photo.jpg`;

  // Force the page's OWN fetch() for this exact image to fail — standing
  // in for a real cross-origin CORS rejection (the <img> tag above still
  // loads it fine, same as production: display is unrestricted, fetch()
  // is not). The initial <img> load already happened via a real request
  // before this route is installed, so the picture is still visible;
  // only the content-script's later fetch() attempt is blocked.
  await page.route(imageUrl, (route) => route.abort("failed"));

  let backgroundFetchCalled = false;
  await page.exposeFunction("__serverFetchBytes", async () => {
    // Stands in for background.js's own real fetch() — a service worker
    // is not subject to the page's CORS restriction the way the content
    // script's fetch above is, so this succeeds where that one can't.
    backgroundFetchCalled = true;
    const res = await fetch(imageUrl);
    const buf = await res.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  });

  await page.evaluate(() => {
    window.__capturedItemPayload = null;
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
            if (msg?.type === "FETCH_IMAGE_BYTES") {
              const bytes = await window.__serverFetchBytes();
              if (cb) cb({ ok: true, bytes, contentType: "image/jpeg" });
              return;
            }
            if (msg?.type === "CAPTURE_ITEM") {
              window.__capturedItemPayload = msg.payload;
              if (cb) cb({ ok: true, item: msg.payload });
              return;
            }
            if (cb) cb({ ok: true });
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

  await page.evaluate(() => {
    const el = document.getElementById("pic");
    Acopio.overlay.showFor(el, { type: "image", family: "image" });
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const host = Acopio.overlayHostNode();
    host.shadowRoot.querySelector(".collect-btn").click();
  });
  await page.waitForFunction(() => window.__capturedItemPayload !== null, { timeout: 8000 });
  const payload = await page.evaluate(() => window.__capturedItemPayload);

  if (pageErrors.length) console.log("Page errors during the flow:", pageErrors);

  const hasInlineDataUrl = !!(payload && payload.data && payload.data.inlineDataUrl);
  console.log(JSON.stringify({ hasInlineDataUrl, backgroundFetchCalled }, null, 2));

  const fails = [];
  if (!backgroundFetchCalled) {
    fails.push("the background-relayed fetch fallback was never even attempted — the direct fetch() failure didn't trigger it");
  }
  if (!hasInlineDataUrl) {
    fails.push("data.inlineDataUrl was never set — the CORS-blocked image still wasn't inlined at Collect time, the reported bug is still present");
  }

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — the direct fetch failed (simulated CORS rejection), and Collect correctly fell back to the background-relayed fetch to inline the image anyway.");
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
