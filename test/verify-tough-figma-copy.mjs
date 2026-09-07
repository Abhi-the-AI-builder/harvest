#!/usr/bin/env node
/**
 * Stress-test Copy → Figma convert on a deliberately hard component
 * (pseudos, radial/conic gradients, transforms, mixed type, custom fonts).
 *
 * Run: node test/verify-tough-figma-copy.mjs
 */
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { extname, join, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 8765;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const filePath = join(ROOT, urlPath === "/" ? "test/fixtures/tough-copy-component.html" : urlPath);
      if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const body = readFileSync(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
      res.end(body);
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const server = await startServer();
const url = `http://127.0.0.1:${PORT}/test/fixtures/tough-copy-component.html`;

let browser;
let exitCode = 1;
try {
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("  [page]", msg.text());
  });
  page.on("pageerror", (err) => console.error("  [pageerror]", err.message));

  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

  // Wait for auto-run result (fonts + convert).
  const report = await page.waitForFunction(
    () => window.__ACOPIO_TOUGH_COPY_RESULT__,
    null,
    { timeout: 45000 }
  ).then((h) => h.jsonValue());

  console.log("\n=== Tough Copy→Figma report ===");
  console.log(JSON.stringify(report, null, 2));

  const shotPath = join(ROOT, "test/screenshots/tough-copy-component.png");
  await page.locator("#target").screenshot({ path: shotPath });
  console.log(`\nScreenshot: ${shotPath}`);

  // Read clipboard back if possible
  let clipTypes = [];
  try {
    clipTypes = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return items.flatMap((it) => it.types);
    });
    console.log("Clipboard types after write:", clipTypes);
  } catch (err) {
    console.log("Clipboard read-back skipped:", err.message);
  }

  // Deep structure checks on a second convert (same stress target).
  const deep = await page.evaluate(async () => {
    const target = document.getElementById("target");
    const api = AcopioDomToFigma;
    const cleanupWs =
      typeof Acopio.normalizeDisplayWhitespaceForCapture === "function"
        ? Acopio.normalizeDisplayWhitespaceForCapture(target)
        : () => {};
    const cleanup = Acopio.materializePseudosForCapture(target);
    const rect = target.getBoundingClientRect();
    const figma = api.createFigmaConverter({
      layout: "auto",
      imageLoader: api.createDirectImageLoader(),
      fontLoader: api.createFontsourceLoader(),
    });
    const result = await figma.convert({
      element: target,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      name: "Acopio Pro promo card",
    });
    cleanup();
    cleanupWs();
    const changes = result.document.nodeChanges || [];
    const texts = changes.filter((c) => c.type === "TEXT").map((c) => c.characters || "");
    const fonts = [
      ...new Set(
        changes
          .filter((c) => c.fontName && c.fontName.family)
          .map((c) => c.fontName.family)
      ),
    ];
    const types = {};
    for (const c of changes) types[c.type] = (types[c.type] || 0) + 1;
    const root = changes.find((c) => c.type === "FRAME" && c.name === "Acopio Pro promo card");
    const indentFight = texts.filter((t) => /\n\s{2,}/.test(t));
    return {
      changeCount: changes.length,
      types,
      texts,
      fonts,
      hasNEW: texts.includes("NEW"),
      hasStar: texts.includes("✦"),
      hasMixedItalic: texts.includes("mixed italic runs"),
      hasFraunces: fonts.includes("Fraunces"),
      hasPlex: fonts.includes("IBM Plex Sans"),
      noIndentNewlines: indentFight.length === 0,
      rootSize: root && root.size ? root.size : null,
      effectNodes: changes.filter((c) => (c.effects || []).length > 0).length,
      magic: String.fromCharCode(...new Uint8Array(result.bytes || []).slice(0, 9)),
    };
  });
  console.log("\n=== Scene structure ===");
  console.log(JSON.stringify(deep, null, 2));

  const ok =
    report &&
    report.ok &&
    report.materializedSpans >= 3 &&
    report.inspect &&
    report.inspect.hasFigmaMarker &&
    report.inspect.length > 1000 &&
    deep.hasNEW &&
    deep.hasStar &&
    deep.hasMixedItalic &&
    deep.hasFraunces &&
    deep.hasPlex &&
    deep.noIndentNewlines &&
    deep.changeCount >= 20 &&
    String(deep.magic).startsWith("fig-kiwi");

  if (ok) {
    console.log(
      "\nRESULT: PASS — Kiwi clipboard has editable scene (pseudos, mixed text, custom fonts)."
    );
    console.log(
      "Manual next step: open fixture → Copy is already on clipboard from harness, or use extension Copy on a live page, then ⌘V in Figma Desktop."
    );
    exitCode = 0;
  } else {
    console.log("\nRESULT: FAIL — see report above.");
    exitCode = 1;
  }
} catch (err) {
  console.error("Harness error:", err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}

process.exit(exitCode);
