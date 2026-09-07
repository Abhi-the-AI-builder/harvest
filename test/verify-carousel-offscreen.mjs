#!/usr/bin/env node
/**
 * Reproduces the "Figma clipboard payload too large or empty" hard-fail
 * seen on real carousels (mehak-e2e-report.json). A carousel viewport
 * clips an oversized flex track via overflow:hidden + transform:translateX
 * — none of pruneInvisibleInClone's checks (display/visibility/opacity/
 * 0-size/left<-8000) catch a slide moved off-screen this way, so every
 * off-screen slide's full subtree gets serialized into the clipboard HTML
 * right alongside the one visible slide.
 *
 * Run: node test/verify-carousel-offscreen.mjs
 */
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { extname, join, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 8772;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const filePath = join(ROOT, urlPath);
      if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
      res.end(readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const server = await startServer();
const url = `http://127.0.0.1:${PORT}/test/fixtures/carousel-offscreen.html`;

let browser;
let exitCode = 1;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("  [pageerror]", err.message));
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

  await page.evaluate(() => {
    window.chrome = {
      runtime: {
        lastError: null,
        sendMessage(msg, cb) {
          (async () => {
            try {
              if (msg && msg.type === "FETCH_IMAGE_BYTES" && msg.payload && msg.payload.url) {
                const res = await fetch(msg.payload.url).catch(() => null);
                if (!res || !res.ok) return cb({ ok: false });
                const buf = new Uint8Array(await res.arrayBuffer());
                cb({ ok: true, bytes: Array.from(buf), contentType: res.headers.get("content-type") || "" });
                return;
              }
              if (msg && msg.type === "ENSURE_DOM_TO_FIGMA") return cb({ ok: true });
              cb({ ok: false });
            } catch (err) {
              cb({ ok: false, error: String(err) });
            }
          })();
        },
      },
    };
  });
  for (const rel of ["src/content/shared.js", "vendor/dom-to-figma.js", "src/content/figma-clipboard.js"]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const report = await page.evaluate(async () => {
    const el = document.getElementById("carousel");
    try {
      const out = await AcopioFigmaClipboard.convertLiveToDocument(el, { name: "Carousel" });
      const allNodes = (out.document.nodeChanges || []).map((n) => ({
        type: n && n.type,
        name: n && n.name,
        characters: n && n.characters,
      }));
      const texts = (out.document.nodeChanges || [])
        .filter((n) => n && n.type === "TEXT")
        .map((n) => (n.characters || "").trim())
        .filter(Boolean);
      return {
        threw: false,
        htmlLen: out.html.length,
        nodeCount: (out.document.nodeChanges || []).length,
        allNodes,
        texts,
        offscreenSlidesLeaked: texts.filter((t) => t.includes("offscreen")).length,
      };
    } catch (err) {
      return { threw: true, error: String((err && err.message) || err) };
    }
  });

  console.log(JSON.stringify(report, null, 2));

  if (report.threw) {
    console.log("\nRESULT: HARD FAIL — conversion threw, nothing pasteable.");
    exitCode = 1;
  } else if (report.offscreenSlidesLeaked > 0) {
    console.log(
      `\nRESULT: BUG CONFIRMED — ${report.offscreenSlidesLeaked} off-screen slide(s) leaked into the capture (htmlLen=${report.htmlLen}).`
    );
    exitCode = 1;
  } else {
    console.log(`\nRESULT: PASS — only the visible slide was captured (htmlLen=${report.htmlLen}).`);
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
