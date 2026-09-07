#!/usr/bin/env node
/**
 * Google Fonts Inter → Figma convert must embed LATIN faces (not cyrillic-ext)
 * and keep heading/CTA characters in the Kiwi scene.
 *
 * Run: node test/verify-google-fonts-figma.mjs
 */
import { createServer } from "http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { extname, join, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 8773;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

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
      res.writeHead(200, {
        "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      });
      res.end(readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const server = await startServer();
const url = `http://127.0.0.1:${PORT}/test/fixtures/google-fonts-inter-hero.html`;

let browser;
let exitCode = 1;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const glyphWarnings = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (/No glyph found/i.test(t)) glyphWarnings.push(t);
    if (msg.type() === "error") console.error("  [page]", t);
  });

  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.fonts && document.fonts.status === "loaded", null, {
    timeout: 30000,
  }).catch(() => {});

  // Mock extension font/image fetch so harvest works outside Chrome extension.
  await page.addInitScript(() => {});
  await page.evaluate(() => {
    window.chrome = {
      runtime: {
        sendMessage(msg, cb) {
          (async () => {
            try {
              if (msg && msg.type === "FETCH_IMAGE_BYTES" && msg.payload && msg.payload.url) {
                const res = await fetch(msg.payload.url);
                if (!res.ok) {
                  cb({ ok: false });
                  return;
                }
                const buf = new Uint8Array(await res.arrayBuffer());
                cb({
                  ok: true,
                  bytes: Array.from(buf),
                  contentType: res.headers.get("content-type") || "",
                });
                return;
              }
              if (msg && msg.type === "ENSURE_DOM_TO_FIGMA") {
                cb({ ok: true });
                return;
              }
              cb({ ok: false });
            } catch (err) {
              cb({ ok: false, error: String(err) });
            }
          })();
        },
      },
    };
  });

  await page.addScriptTag({
    path: join(ROOT, "src/content/shared.js"),
  });
  await page.addScriptTag({
    path: join(ROOT, "vendor/dom-to-figma.js"),
  });
  await page.addScriptTag({
    path: join(ROOT, "src/content/figma-clipboard.js"),
  });

  const report = await page.evaluate(async () => {
    const el = document.getElementById("hero");
    const liveRect = el.getBoundingClientRect();
    const faces = await Acopio.collectFontFaceRulesAsync();
    const interFaces = faces.filter((f) => /inter/i.test(f.family));
    const latinCount = interFaces.filter((f) => f.coversLatin !== false).length;
    const nonLatinCount = interFaces.filter((f) => f.coversLatin === false).length;
    const harvested = await Acopio.harvestFontBytesForElement(el);
    const harvestedNonLatin = harvested.filter((f) => f.coversLatin === false).length;
    const harvestedLatin = harvested.filter((f) => f.coversLatin !== false).length;

    // Production fidelity path (same as Copy clipboard) — includes 20px paste inset.
    const out = await AcopioFigmaClipboard.convertLiveToDocument(el, {
      name: "Hero",
      fontAssets: harvested,
    });
    const changes = (out.document && out.document.nodeChanges) || [];
    const byGuid = new Map(changes.map((n) => [n.guid, n]));
    function nodeXY(n) {
      const t = n && n.transform;
      if (!t) return { x: 0, y: 0 };
      return { x: t.m02 ?? t[4] ?? 0, y: t.m12 ?? t[5] ?? 0 };
    }
    function absY(n) {
      let y = 0;
      let cur = n;
      let guard = 0;
      while (cur && guard++ < 64) {
        y += nodeXY(cur).y;
        const pg = cur.parentIndex && cur.parentIndex.guid;
        if (!pg) break;
        cur = byGuid.get(pg);
        if (!cur || cur.type === "CANVAS" || cur.type === "DOCUMENT") break;
      }
      return y;
    }
    const texts = changes
      .filter((n) => n && n.type === "TEXT" && n.characters)
      .map((n) => ({ characters: n.characters, absY: absY(n) }));
    const glyphCount = changes.reduce((sum, n) => {
      const g =
        n &&
        n.derivedTextData &&
        Array.isArray(n.derivedTextData.glyphs)
          ? n.derivedTextData.glyphs.length
          : 0;
      return sum + g;
    }, 0);
    // Line-split TEXT nodes are correct fidelity (CSS wraps). Flatten for
    // content checks so "the\nworld" still counts as the full heading.
    const flat = texts
      .map((t) => t.characters)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const minTextAbsY = texts.reduce((m, t) => Math.min(m, t.absY), Infinity);
    const frames = changes.filter((n) => n && n.type === "FRAME");
    const root = frames.find((f) => {
      const w = f.size && (f.size.x ?? f.size.w);
      const h = f.size && (f.size.y ?? f.size.h);
      return Math.abs((w || 0) - out.width) < 2 && Math.abs((h || 0) - out.height) < 2;
    }) || frames[0];
    const badOffset = frames.filter((f) => {
      if (!root || f.guid === root.guid) return false;
      if ((f.parentIndex && f.parentIndex.guid) !== root.guid) return false;
      const w = f.size && (f.size.x ?? f.size.w);
      const h = f.size && (f.size.y ?? f.size.h);
      const same =
        Math.abs((w || 0) - liveRect.width) < 5 &&
        Math.abs((h || 0) - liveRect.height) < 5;
      if (!same) return false;
      const { x, y } = nodeXY(f);
      const atPad = Math.abs(x - 20) <= 5 && Math.abs(y - 20) <= 5;
      return !atPad && (Math.abs(x) > 5 || Math.abs(y) > 5);
    });

    // Heading line pair must not smash (html.to.design parity bar).
    const headingLines = texts
      .filter((t) =>
        /Discover curated|world's top designers/i.test(t.characters || "")
      )
      .sort((a, b) => (a.absY || 0) - (b.absY || 0));
    let headingNoSmash = true;
    if (headingLines.length >= 2) {
      const a = headingLines[0];
      const b = headingLines[1];
      const dy = (b.absY || 0) - (a.absY || 0);
      const step = 40 * 1.15; // fixture h1 font-size 40 / line-height 1.15
      headingNoSmash = dy >= step * 0.85;
    }
    const minHeadingAbsY = headingLines.reduce(
      (m, t) => Math.min(m, t.absY == null ? m : t.absY),
      Infinity
    );

    return {
      interFaceCount: interFaces.length,
      latinCount,
      nonLatinCount,
      harvestedCount: harvested.length,
      harvestedLatin,
      harvestedNonLatin,
      htmlLen: out.html ? out.html.length : 0,
      textCount: texts.length,
      glyphCount,
      hasHeading: /Discover curated work from the world/i.test(flat),
      hasCta: /Submit Portfolio/i.test(flat),
      hasShowcase: /Showcase your portfolio/i.test(flat),
      headingNoSmash,
      minHeadingAbsY: Number.isFinite(minHeadingAbsY) ? +minHeadingAbsY.toFixed(1) : null,
      texts: texts.map((t) => t.characters),
      pasteSafeMargin: out.pasteSafeMargin,
      outW: out.width,
      outH: out.height,
      liveW: +liveRect.width.toFixed(1),
      liveH: +liveRect.height.toFixed(1),
      minTextAbsY: Number.isFinite(minTextAbsY) ? +minTextAbsY.toFixed(1) : null,
      badOffsetCount: badOffset.length,
      sampleHarvest: harvested.slice(0, 4).map((f) => ({
        family: f.family,
        weight: f.weight,
        coversLatin: f.coversLatin,
      })),
    };
  });

  console.log("\n=== Google Fonts Inter → Figma report ===");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Glyph warnings during convert: ${glyphWarnings.length}`);
  if (glyphWarnings.length) {
    console.log(glyphWarnings.slice(0, 8).join("\n"));
  }

  mkdirSync(join(ROOT, "test/screenshots"), { recursive: true });
  writeFileSync(
    join(ROOT, "test/screenshots/google-fonts-inter-report.json"),
    JSON.stringify({ report, glyphWarnings: glyphWarnings.slice(0, 40) }, null, 2)
  );
  await page.locator("#hero").screenshot({
    path: join(ROOT, "test/screenshots/google-fonts-inter-hero.png"),
  });

  const ok =
    report &&
    report.htmlLen > 1000 &&
    report.hasHeading &&
    report.hasCta &&
    report.hasShowcase &&
    report.headingNoSmash !== false &&
    report.minHeadingAbsY != null &&
    report.minHeadingAbsY >= 19 &&
    report.harvestedNonLatin === 0 &&
    report.glyphCount > 40 &&
    glyphWarnings.length === 0 &&
    report.pasteSafeMargin === 20 &&
    Math.abs(report.outW - (report.liveW + 40)) < 3 &&
    Math.abs(report.outH - (report.liveH + 40)) < 3 &&
    report.minTextAbsY != null &&
    report.minTextAbsY >= 19 &&
    report.badOffsetCount === 0;

  if (ok) {
    console.log(
      "\nRESULT: PASS — latin Inter faces, glyph paths present, heading+CTA in scene."
    );
    exitCode = 0;
  } else {
    console.log("\nRESULT: FAIL — see report above.");
  }
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
  process.exit(exitCode);
}
