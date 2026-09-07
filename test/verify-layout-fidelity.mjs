#!/usr/bin/env node
/**
 * Layout fidelity: placement, spacing, size, early wrap + paste safe-margin.
 * Compares live DOM geometry to Figma Kiwi scene (layout auto vs absolute),
 * then asserts the production fidelity convert path (20px inset, no page offset).
 *
 * Run: node test/verify-layout-fidelity.mjs
 */
import { createServer } from "http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { extname, join, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 8771;
const OUT = join(ROOT, "test/screenshots");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
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
const url = `http://127.0.0.1:${PORT}/test/fixtures/layout-fidelity.html`;

let browser;
let exitCode = 1;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("  [page]", msg.text());
  });
  page.on("pageerror", (err) => console.error("  [pageerror]", err.message));

  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  const report = await page
    .waitForFunction(() => window.__ACOPIO_LAYOUT_FIDELITY__, null, {
      timeout: 45000,
    })
    .then((h) => h.jsonValue());

  console.log("\n=== Layout fidelity report ===");
  console.log(JSON.stringify(report, null, 2));

  mkdirSync(OUT, { recursive: true });
  const shotPath = join(OUT, "layout-fidelity.png");
  await page.locator("#target").screenshot({ path: shotPath });
  console.log(`\nScreenshot: ${shotPath}`);

  // Production Copy path: paste safe-margin + zero page-offset (generic fixture).
  await page.evaluate(() => {
    window.chrome = {
      runtime: {
        lastError: null,
        sendMessage(msg, cb) {
          (async () => {
            try {
              if (msg && msg.type === "FETCH_IMAGE_BYTES" && msg.payload && msg.payload.url) {
                const res = await fetch(msg.payload.url).catch(() => null);
                if (!res || !res.ok) {
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
  await page.addScriptTag({ path: join(ROOT, "src/content/shared.js") });
  await page.addScriptTag({ path: join(ROOT, "src/content/figma-clipboard.js") });

  const padReport = await page.evaluate(async () => {
    const PAD = AcopioFigmaClipboard.PASTE_SAFE_MARGIN_PX || 20;
    const el = document.getElementById("target");
    const live = el.getBoundingClientRect();
    const out = await AcopioFigmaClipboard.convertLiveToDocument(el, {
      name: "Layout fidelity card",
    });
    const changes = (out.document && out.document.nodeChanges) || [];
    const byGuid = new Map(changes.map((n) => [n.guid, n]));
    function nodeXY(n) {
      const t = n && n.transform;
      if (!t) return { x: 0, y: 0 };
      return { x: t.m02 ?? t[4] ?? 0, y: t.m12 ?? t[5] ?? 0 };
    }
    function absXY(n) {
      let x = 0;
      let y = 0;
      let cur = n;
      let guard = 0;
      while (cur && guard++ < 64) {
        const p = nodeXY(cur);
        x += p.x;
        y += p.y;
        const pg = cur.parentIndex && cur.parentIndex.guid;
        if (!pg) break;
        cur = byGuid.get(pg);
        if (!cur || cur.type === "CANVAS" || cur.type === "DOCUMENT") break;
      }
      return { x, y };
    }
    const texts = changes
      .filter((n) => n && n.type === "TEXT" && n.characters)
      .map((n) => {
        const a = absXY(n);
        return { characters: n.characters.slice(0, 40), absX: a.x, absY: a.y };
      });
    const minY = texts.reduce((m, t) => Math.min(m, t.absY), Infinity);
    const minX = texts.reduce((m, t) => Math.min(m, t.absX), Infinity);
    const frames = changes.filter((n) => n && n.type === "FRAME");
    const root =
      frames.find((f) => {
        const w = f.size && (f.size.x ?? f.size.w);
        const h = f.size && (f.size.y ?? f.size.h);
        return (
          Math.abs((w || 0) - out.width) < 2 &&
          Math.abs((h || 0) - out.height) < 2
        );
      }) || frames[0];
    const badOffset = frames.filter((f) => {
      if (!root || f.guid === root.guid) return false;
      if ((f.parentIndex && f.parentIndex.guid) !== root.guid) return false;
      const w = f.size && (f.size.x ?? f.size.w);
      const h = f.size && (f.size.y ?? f.size.h);
      const same =
        Math.abs((w || 0) - live.width) < 5 &&
        Math.abs((h || 0) - live.height) < 5;
      if (!same) return false;
      const { x, y } = nodeXY(f);
      const atPad = Math.abs(x - PAD) <= 5 && Math.abs(y - PAD) <= 5;
      return !atPad && (Math.abs(x) > 5 || Math.abs(y) > 5);
    });

    return {
      pasteSafeMargin: out.pasteSafeMargin,
      outW: out.width,
      outH: out.height,
      liveW: +live.width.toFixed(1),
      liveH: +live.height.toFixed(1),
      minTextAbsX: Number.isFinite(minX) ? +minX.toFixed(1) : null,
      minTextAbsY: Number.isFinite(minY) ? +minY.toFixed(1) : null,
      badOffsetCount: badOffset.length,
      textCount: texts.length,
      htmlLen: out.html ? out.html.length : 0,
      padOk: out.pasteSafeMargin === PAD,
      sizeOk:
        Math.abs(out.width - (live.width + PAD * 2)) < 3 &&
        Math.abs(out.height - (live.height + PAD * 2)) < 3,
      insetOk:
        Number.isFinite(minY) &&
        minY >= PAD - 1 &&
        Number.isFinite(minX) &&
        minX >= PAD - 1,
      noPageOffset: badOffset.length === 0,
    };
  });

  console.log("\n=== Fidelity paste-safe-margin (generic) ===");
  console.log(JSON.stringify(padReport, null, 2));
  writeFileSync(
    join(OUT, "layout-fidelity-pad-report.json"),
    JSON.stringify({ layout: report, pad: padReport }, null, 2)
  );

  const layoutOk = Boolean(report && report.ok);
  const padOk =
    padReport &&
    padReport.padOk &&
    padReport.sizeOk &&
    padReport.insetOk &&
    padReport.noPageOffset &&
    padReport.htmlLen > 500 &&
    padReport.textCount >= 3;

  if (layoutOk && padOk) {
    console.log(
      `\nRESULT: PASS — layout + 20px paste inset (winner: ${report.winner}).`
    );
    exitCode = 0;
  } else {
    console.log("\nRESULT: FAIL — see layout and/or pad reports.");
    if (!layoutOk) {
      if (report?.auto?.fails?.length) console.log("auto fails:", report.auto.fails);
      if (report?.absolute?.fails?.length) {
        console.log("absolute fails:", report.absolute.fails);
      }
    }
    if (!padOk) console.log("pad fails:", padReport);
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
