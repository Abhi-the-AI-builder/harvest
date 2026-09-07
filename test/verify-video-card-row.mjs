#!/usr/bin/env node
/**
 * A row of link-wrapped cards where most contain a <video> with no poster
 * and preload="metadata" (so no frame has actually decoded yet) — a very
 * common real pattern (portfolio/social feed video previews). Confirmed
 * live: resolveVideoOrPoster's own last-resort fallback returned the raw
 * video FILE url, which materializeVideosForCapture then used as an <img
 * src> — trying to fetch and embed a multi-MB video file as a still image
 * stalled long enough to block every sibling card behind it from ever
 * finishing conversion. Fixed in shared.js by only using that fallback
 * when it's genuinely a static image (resolved.isVideo === false).
 *
 * Run: node test/verify-video-card-row.mjs
 */
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { extname, join, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 8792;
const MIME = { ".html": "text/html; charset=utf-8" };

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const p = join(ROOT, decodeURIComponent((req.url || "/").split("?")[0]));
      if (!p.startsWith(ROOT) || !existsSync(p)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[extname(p)] || "application/octet-stream" });
      res.end(readFileSync(p));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const server = await startServer();
const url = `http://127.0.0.1:${PORT}/test/fixtures/hscroll-cards.html`;
const TIMEOUT_MS = 8000;

let browser;
let exitCode = 1;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("  [pageerror]", err.message));
  await page.evaluate(() => {}); // no-op to keep pattern consistent with other harnesses
  await page.evaluate(() => {
    window.chrome = { runtime: { lastError: null, sendMessage(msg, cb) { cb({ ok: false }); } } };
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1000);

  for (const rel of ["src/content/shared.js", "vendor/dom-to-figma.js", "src/content/figma-clipboard.js"]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const start = Date.now();
  const report = await Promise.race([
    page.evaluate(async () => {
      const el = document.getElementById("row");
      const res = await AcopioFigmaClipboard.convertLiveToDocument(el, { name: "Row" });
      const texts = (res.document.nodeChanges || [])
        .filter((n) => n && n.type === "TEXT")
        .map((n) => n.characters);
      return { timedOut: false, texts };
    }),
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true, texts: [] }), TIMEOUT_MS)),
  ]);
  const elapsedMs = Date.now() - start;

  const expectedCaptions = [
    "Career Survival Arcade",
    "Spiral3D",
    "Interactive Dragon Pet",
    "I built the motion tool",
  ];
  const joined = report.texts.join(" | ");
  const missing = expectedCaptions.filter((c) => !joined.includes(c));

  console.log(`Elapsed: ${elapsedMs}ms (timeout at ${TIMEOUT_MS}ms)`);
  console.log("Texts found:", JSON.stringify(report.texts));

  if (report.timedOut) {
    console.log("\nRESULT: HARD FAIL — conversion never completed (video-file-as-image stall).");
    exitCode = 1;
  } else if (missing.length > 0) {
    console.log(`\nRESULT: FAIL — missing captions from cards after a video: ${missing.join(", ")}`);
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — every card converted, including all siblings after unloaded videos.");
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
