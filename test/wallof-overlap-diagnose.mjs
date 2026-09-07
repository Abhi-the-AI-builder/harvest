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
      lastError: null,
      sendMessage(msg, cb) {
        (async () => {
          try {
            if (msg?.type === "FETCH_IMAGE_BYTES" && msg.payload?.url) {
              const res = await fetch(msg.payload.url, { mode: "cors" }).catch(() => null);
              if (!res?.ok) { cb({ ok: false }); return; }
              const buf = new Uint8Array(await res.arrayBuffer());
              cb({ ok: true, bytes: Array.from(buf), contentType: res.headers.get("content-type") || "" });
              return;
            }
            if (msg?.type === "ENSURE_DOM_TO_FIGMA") { cb({ ok: true }); return; }
            cb({ ok: false });
          } catch (e) { cb({ ok: false, error: String(e) }); }
        })();
      },
    },
  };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("https://www.wallofportfolios.in/?company=All", { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(2500);

await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll("section, div, main, article, header"));
  let best = null, bestScore = -1;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    if (r.width < 700 || r.width > 1100 || r.height < 400 || r.height > 750) continue;
    const text = (el.innerText || "").slice(0, 400);
    if (!/Discover curated work/i.test(text) || !/Submit Portfolio/i.test(text)) continue;
    const score = r.width * r.height;
    if (score > bestScore) { bestScore = score; best = el; }
  }
  if (best) best.setAttribute("data-acopio-e2e-hero", "1");
});

await page.evaluate(injectChromeMock);
for (const rel of ["src/content/shared.js", "vendor/dom-to-figma.js", "src/content/figma-clipboard.js"]) {
  await page.addScriptTag({ path: join(ROOT, rel) });
}

const report = await page.evaluate(async () => {
  const el = document.querySelector("[data-acopio-e2e-hero='1']");
  const rootRect = el.getBoundingClientRect();

  // Heading DOM structure
  const h1 = el.querySelector("h1") || Array.from(el.querySelectorAll("*")).find(n => /Discover curated work/i.test(n.innerText||"") && (n.innerText||"").length < 100);
  const headingInfo = h1 ? {
    tag: h1.tagName,
    className: String(h1.className||"").slice(0,120),
    childCount: h1.children.length,
    childTags: Array.from(h1.children).map(c => c.tagName),
    html: h1.innerHTML.slice(0, 500),
    cs: {
      fontSize: getComputedStyle(h1).fontSize,
      lineHeight: getComputedStyle(h1).lineHeight,
      letterSpacing: getComputedStyle(h1).letterSpacing,
      whiteSpace: getComputedStyle(h1).whiteSpace,
      display: getComputedStyle(h1).display,
      overflow: getComputedStyle(h1).overflow,
      height: getComputedStyle(h1).height,
      width: getComputedStyle(h1).width,
    },
    rect: (() => {
      const r = h1.getBoundingClientRect();
      return { x: +(r.left-rootRect.left).toFixed(1), y: +(r.top-rootRect.top).toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1) };
    })(),
  } : null;

  // Freeze-sample logos from the fidelity clone (matches paste, not mid-scroll).
  let frozenLogos = [];
  const prep = await AcopioFigmaClipboard.prepareFidelityClone(el, { name: "Hero" });
  try {
    const clone = prep.contentTarget;
    const cr = clone.getBoundingClientRect();
    frozenLogos = Array.from(clone.querySelectorAll("img"))
      .map((img) => {
        const r = img.getBoundingClientRect();
        return {
          alt: (img.alt || "").slice(0, 40),
          x: +(r.left - cr.left).toFixed(1),
          y: +(r.top - cr.top).toFixed(1),
          w: +r.width.toFixed(1),
          h: +r.height.toFixed(1),
          inClone:
            r.right > cr.left + 1 &&
            r.left < cr.right - 1 &&
            r.bottom > cr.top + 1 &&
            r.top < cr.bottom - 1,
        };
      })
      .filter((i) => i.w > 4 && i.inClone)
      .sort((a, b) => a.x - b.x || a.y - b.y);
  } finally {
    prep.cleanup();
  }

  // Live imgs (diagnostic only — may be mid-scroll)
  const imgs = Array.from(el.querySelectorAll("img")).map(img => {
    const r = img.getBoundingClientRect();
    const p = img.parentElement;
    const pcs = p ? getComputedStyle(p) : null;
    return {
      alt: (img.alt||"").slice(0,40),
      src: (img.currentSrc||img.src||"").slice(0,80),
      x: +(r.left-rootRect.left).toFixed(1),
      y: +(r.top-rootRect.top).toFixed(1),
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
      parentOverflow: pcs ? `${pcs.overflow}/${pcs.overflowX}` : null,
      parentClass: p ? String(p.className||"").slice(0,80) : null,
      inRoot: r.right > rootRect.left && r.left < rootRect.right && r.bottom > rootRect.top && r.top < rootRect.bottom,
    };
  }).filter(i => i.w > 4);

  const out = await AcopioFigmaClipboard.convertLiveToDocument(el, { name: "Component 1" });
  const changes = (out.document && out.document.nodeChanges) || [];

  function xy(n) {
    const t = n.transform;
    return { x: t?.m02 ?? t?.[4] ?? null, y: t?.m12 ?? t?.[5] ?? null };
  }
  function wh(n) {
    return { w: n.size?.x ?? null, h: n.size?.y ?? null };
  }

  const texts = changes.filter(n => n?.type === "TEXT" && n.characters).map(n => {
    const {x,y} = xy(n);
    const {w,h} = wh(n);
    return {
      characters: n.characters,
      x: x != null ? +x.toFixed(1) : null,
      y: y != null ? +y.toFixed(1) : null,
      w: w != null ? +w.toFixed(1) : null,
      h: h != null ? +h.toFixed(1) : null,
      fontSize: n.fontSize,
      lineHeight: n.lineHeight,
      letterSpacing: n.letterSpacing,
      textAutoResize: n.textAutoResize,
      textAlignVertical: n.textAlignVertical,
      parentGuid: n.parentIndex?.guid,
    };
  });

  // Sibling overlap only (same parent) — cross-frame pairs are false alarms.
  const overlaps = [];
  const byParent = new Map();
  for (const t of texts) {
    const key = t.parentGuid ? `${t.parentGuid.sessionID}:${t.parentGuid.localID}` : "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(t);
  }
  for (const group of byParent.values()) {
    if (group.length < 2) continue;
    const sorted = group.slice().sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const step = (prev.lineHeight && prev.lineHeight.value) || prev.fontSize || 16;
      const dy = (cur.y ?? 0) - (prev.y ?? 0);
      if (dy < step * 0.85) {
        overlaps.push({
          a: prev.characters.slice(0, 40),
          b: cur.characters.slice(0, 40),
          dy: +dy.toFixed(1),
          ay: prev.y,
          by: cur.y,
          step,
        });
      }
    }
  }

  const headingTexts = texts.filter((t) => /Discover curated|world's top designers/i.test(t.characters));
  const minHeadingY = headingTexts.reduce(
    (m, t) => (t.y == null ? m : Math.min(m, t.y)),
    Infinity
  );

  const frames = changes.filter(n => n?.type === "FRAME").slice(0, 20).map(n => {
    const {x,y} = xy(n);
    const {w,h} = wh(n);
    return { name: n.name, x, y, w, h, clips: n.clipsContent };
  });

  return {
    pasteSafeMargin: out.pasteSafeMargin,
    width: out.width,
    height: out.height,
    headingInfo,
    imgCount: imgs.length,
    imgs: imgs.slice(0, 25),
    frozenLogos: frozenLogos.slice(0, 12),
    texts,
    overlaps,
    headingTexts,
    minHeadingY: Number.isFinite(minHeadingY) ? minHeadingY : null,
    frames,
    negFrameCount: (changes || [])
      .filter((n) => n?.type === "FRAME")
      .filter((n) => {
        const t = n.transform;
        const x = t?.m02 ?? t?.[4] ?? 0;
        return x < -5;
      }).length,
    typeCounts: changes.reduce((a,n)=>{a[n.type]=(a[n.type]||0)+1;return a;},{}),
  };
});

writeFileSync(join(OUT, "wallof-overlap-diagnose.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

// Golden parity bar vs html.to.design: no ascender clip, no sibling smash,
// paste inset, heading stacked on CSS line-height (72px), frozen Netflix→Zomato logos.
const headingOk = report.minHeadingY != null && report.minHeadingY >= 0;
const overlapOk = (report.overlaps || []).length === 0;
const padOk = report.pasteSafeMargin === 20;
const headingPair = (report.headingTexts || [])
  .slice()
  .sort((a, b) => (a.y || 0) - (b.y || 0));
const lineStackOk =
  headingPair.length >= 2 &&
  Math.abs((headingPair[1].y || 0) - (headingPair[0].y || 0) - 72) <= 2;
const frozen = report.frozenLogos || [];
const logoAlts = frozen.map((i) => String(i.alt || "").toLowerCase());
const expectedLogoOrder = [
  "netflix",
  "google",
  "apple",
  "uber",
  "swiggy",
  "cred",
  "zomato",
];
const logoOrderOk = expectedLogoOrder.every(
  (name, i) => logoAlts[i] && logoAlts[i].includes(name)
);
const noNegLogoX = frozen.every((i) => (i.x == null ? true : i.x >= -1));
const noNegFrames = (report.negFrameCount || 0) === 0;
console.log(
  `\nASSERTS: minHeadingY=${report.minHeadingY} (>=0? ${headingOk}) siblingOverlaps=${(report.overlaps || []).length} pad=${report.pasteSafeMargin} lineStack72=${lineStackOk} logoOrder=${logoOrderOk} frozenLogos=${logoAlts.slice(0, 7).join(",")} noNegLogoX=${noNegLogoX} noNegFrames=${noNegFrames}`
);
await browser.close();
process.exit(
  headingOk &&
    overlapOk &&
    padOk &&
    lineStackOk &&
    logoOrderOk &&
    noNegLogoX &&
    noNegFrames
    ? 0
    : 1
);
