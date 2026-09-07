#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test/screenshots");
mkdirSync(OUT, { recursive: true });

function injectChromeMock() {
  window.chrome = {
    runtime: {
      id: "acopio-test",
      lastError: null,
      sendMessage(msg, cb) {
        (async () => {
          try {
            if (msg?.type === "FETCH_IMAGE_BYTES" && msg.payload?.url) {
              const res = await fetch(msg.payload.url, { mode: "cors" }).catch(() => null);
              if (!res?.ok) {
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
            if (msg?.type === "ENSURE_DOM_TO_FIGMA") {
              cb({ ok: true });
              return;
            }
            cb({ ok: false });
          } catch (e) {
            cb({ ok: false, error: String(e) });
          }
        })();
      },
    },
  };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("https://www.wallofportfolios.in/?company=All", {
  waitUntil: "networkidle",
  timeout: 120000,
});
await page.waitForTimeout(2500);

// Stabilize like hero verify — touch the DOM before injecting.
await page.evaluate(() => {
  document.documentElement.setAttribute("data-acopio-e2e", "1");
});

await page.evaluate(injectChromeMock);
for (const rel of [
  "src/content/shared.js",
  "vendor/dom-to-figma.js",
  "src/content/figma-clipboard.js",
]) {
  await page.addScriptTag({ path: join(ROOT, rel) });
}

let report;
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    report = await page.evaluate(async () => {
  const out = { checks: [] };
  const pass = (name, ok, detail) => out.checks.push({ name, ok, detail });

  // Designer card: Text + Image inventory
  // Cards live inside `.app-main-wrap` (overflow scroll) — window.scrollTo is a no-op.
  const mainWrap =
    document.querySelector(".app-main-wrap") ||
    Array.from(document.querySelectorAll("*")).find((el) => {
      const s = getComputedStyle(el);
      return (
        (s.overflowY === "auto" || s.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight + 200
      );
    });
  if (mainWrap) mainWrap.scrollTop = Math.min(1800, mainWrap.scrollHeight);
  else window.scrollTo(0, Math.min(1400, document.body.scrollHeight));
  await new Promise((r) => setTimeout(r, 900));

  const cards = Array.from(
    document.querySelectorAll("a.card, .cards.w-dyn-item, a, article, div")
  ).filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 260 || r.width > 480 || r.height < 260 || r.height > 480) return false;
    if (r.bottom < 0 || r.top > window.innerHeight + 200) return false;
    const t = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (t.length < 18 || t.length > 220) return false;
    return Boolean(el.querySelector("img")) && /\b(Designer|India|experience|Years)\b/i.test(t);
  });
  const card = cards[0];
  if (!card) {
    pass("designer-card-found", false, {
      scanned: Array.from(document.querySelectorAll("a")).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 260 && r.width < 480 && r.height > 260;
      }).length,
    });
  } else {
    const inv = Acopio.inventoryContainsLabels(card);
    const icon = Acopio.componentIconFor(card.outerHTML.slice(0, 8000));
    const painted = Acopio.measurePaintedBounds(card);
    const box = card.getBoundingClientRect();
    out.designer = {
      text: (card.innerText || "").replace(/\s+/g, " ").slice(0, 100),
      inv,
      icon,
      boxH: Math.round(box.height),
      paintedH: Math.round(painted.height),
    };
    pass("designer-has-text-chip", inv.includes("Text"), inv);
    pass("designer-has-image-chip", inv.includes("Image"), inv);
    pass("designer-not-image-only-icon", icon !== "image", icon);
    pass("designer-painted-gte-box", painted.height >= box.height - 1, {
      painted: painted.height,
      box: box.height,
    });
  }

  // Cards row captions — still inside the overflow scroller.
  if (mainWrap) mainWrap.scrollTop = Math.min(900, mainWrap.scrollHeight);
  else window.scrollTo(0, Math.min(900, document.body.scrollHeight));
  await new Promise((r) => setTimeout(r, 600));
  const caption = Array.from(document.querySelectorAll("a,div,p,span")).find((el) =>
    /Share your work|Interaction in 3D|What Designers Are Working/i.test(
      (el.innerText || "").slice(0, 120)
    )
  );
  let row = null;
  if (caption) {
    let p = caption.parentElement;
    for (let i = 0; i < 8 && p; i++) {
      const r = p.getBoundingClientRect();
      if (p.children.length >= 5 && r.width > 900 && r.height > 200 && r.height < 900) {
        row = p;
        break;
      }
      p = p.parentElement;
    }
  }
  if (!row) {
    pass("cards-row-found", false, "no row");
  } else {
    const painted = Acopio.measurePaintedBounds(row);
    const box = row.getBoundingClientRect();
    const conv = await AcopioFigmaClipboard.convertLiveToDocument(row, {
      name: "Cards row",
    });
    out.row = {
      class: String(row.className || "").slice(0, 80),
      childCount: row.children.length,
      boxH: Math.round(box.height),
      paintedH: Math.round(painted.height),
      contentH: conv.contentHeight,
      convertH: conv.height,
      pad: conv.pasteSafeMargin,
    };
    pass("cards-row-found", true, out.row);
    pass(
      "cards-row-content-covers-box",
      conv.contentHeight >= box.height - 2,
      out.row
    );
    pass(
      "cards-row-pad",
      conv.pasteSafeMargin === 20 && conv.height >= conv.contentHeight + 40,
      out.row
    );
  }

  // Hero marquee + heading after freeze
  const hero = Array.from(document.querySelectorAll("section,div")).find((el) => {
    const r = el.getBoundingClientRect();
    const t = (el.innerText || "").slice(0, 400);
    return (
      r.width > 700 &&
      r.width < 1100 &&
      r.height > 400 &&
      r.height < 750 &&
      /Discover curated work/i.test(t) &&
      /Submit Portfolio/i.test(t)
    );
  });
  if (!hero) {
    pass("hero-found", false, null);
  } else {
    const conv = await AcopioFigmaClipboard.convertLiveToDocument(hero, {
      name: "Hero",
    });
    const frames = (conv.document?.nodeChanges || []).filter((n) => n.type === "FRAME");
    const xy = (n) => {
      const t = n.transform;
      return { x: t?.m02 ?? t?.[4] ?? 0, y: t?.m12 ?? t?.[5] ?? 0 };
    };
    const neg = frames.filter((f) => xy(f).x < -5);
    const texts = (conv.document?.nodeChanges || []).filter(
      (n) =>
        n.type === "TEXT" &&
        /Discover curated work|world's top designers/i.test(n.characters || "")
    );
    // Prefer the H1 pair only (exclude CTA "worldwide").
    const heading = texts
      .filter((t) => /Discover|world's top/i.test(t.characters || ""))
      .sort((a, b) => (xy(a).y || 0) - (xy(b).y || 0));
    out.hero = {
      negCount: neg.length,
      neg: neg.slice(0, 3).map((f) => ({ ...xy(f), w: f.size?.x ?? f.size?.w })),
      heading: heading.map((t) => ({
        c: t.characters?.slice(0, 40),
        y: xy(t).y,
        h: t.size?.y ?? t.size?.h,
        align: t.textAlignVertical,
      })),
    };
    pass("hero-no-negative-marquee-frames", neg.length === 0, out.hero);
    pass(
      "hero-heading-two-lines",
      heading.length === 2 && /Discover/i.test(heading[0]?.characters || ""),
      out.hero.heading
    );
    pass(
      "hero-heading-lineheight-spaced",
      heading.length >= 2 &&
        Math.abs((xy(heading[1]).y || 0) - (xy(heading[0]).y || 0) - 72) <= 2,
      out.hero.heading
    );
    pass(
      "hero-heading-minY-ge-0",
      heading.every((t) => (xy(t).y || 0) >= 0),
      out.hero.heading
    );
    // Scene-level marquee parity: no mid-scroll negative-x logo tracks.
    pass(
      "hero-logo-strip-frozen-no-midscroll",
      neg.length === 0,
      { negCount: neg.length }
    );
  }

  out.ok = out.checks.every((c) => c.ok);
  return out;
    });
    break;
  } catch (err) {
    if (attempt === 2) throw err;
    console.error("retry after", String(err && err.message ? err.message : err));
    await page.waitForTimeout(1500);
    await page.evaluate(injectChromeMock);
    for (const rel of [
      "src/content/shared.js",
      "vendor/dom-to-figma.js",
      "src/content/figma-clipboard.js",
    ]) {
      await page.addScriptTag({ path: join(ROOT, rel) });
    }
  }
}

writeFileSync(join(OUT, "wallof-cards-classify-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(report.ok ? "RESULT: PASS" : "RESULT: FAIL");
await browser.close();
process.exit(report.ok ? 0 : 1);
