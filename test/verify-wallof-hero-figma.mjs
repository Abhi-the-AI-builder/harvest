#!/usr/bin/env node
/**
 * Live wallofportfolios hero — DOM geometry vs Acopio fidelity convert document.
 * Asserts the SAME path as clipboard Copy (prepareFidelityClone → convert),
 * never a live re-convert of the page element.
 *
 * Run: node test/verify-wallof-hero-figma.mjs
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "test/screenshots");
mkdirSync(OUT, { recursive: true });

const PAGE_URL = "https://www.wallofportfolios.in/?company=All";
const PAD = 20;

function injectChromeMock() {
  window.chrome = {
    runtime: {
      id: "acopio-test",
      lastError: null,
      sendMessage(msg, cb) {
        (async () => {
          try {
            if (msg && msg.type === "FETCH_IMAGE_BYTES" && msg.payload && msg.payload.url) {
              const res = await fetch(msg.payload.url, { mode: "cors" }).catch(() => null);
              if (!res || !res.ok) {
                cb({ ok: false, error: "fetch failed" });
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
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const glyphWarnings = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (/No glyph found/i.test(t)) glyphWarnings.push(t);
  });

  console.log(`Opening ${PAGE_URL}`);
  await page.goto(PAGE_URL, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(2500);

  const heroSel = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll("section, div, main, article, header")
    );
    let best = null;
    let bestScore = -1;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width < 700 || r.width > 1100) continue;
      if (r.height < 400 || r.height > 750) continue;
      const text = (el.innerText || "").slice(0, 400);
      if (!/Discover curated work/i.test(text)) continue;
      if (!/Submit Portfolio/i.test(text)) continue;
      const score = r.width * r.height;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best) return null;
    best.setAttribute("data-acopio-e2e-hero", "1");
    const r = best.getBoundingClientRect();
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      tag: best.tagName,
      className: String(best.className || "").slice(0, 120),
      margin: getComputedStyle(best).margin,
    };
  });

  if (!heroSel) {
    console.error("Could not find hero with Discover + Submit Portfolio");
    await browser.close();
    process.exit(1);
  }
  console.log("Hero target:", heroSel);

  await page.locator("[data-acopio-e2e-hero='1']").screenshot({
    path: join(OUT, "wallof-hero-live.png"),
  });

  await page.evaluate(injectChromeMock);
  for (const rel of [
    "src/content/shared.js",
    "vendor/dom-to-figma.js",
    "src/content/figma-clipboard.js",
  ]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const report = await page.evaluate(async (PAD) => {
    const el = document.querySelector("[data-acopio-e2e-hero='1']");
    const rootRect = el.getBoundingClientRect();

    function probeDom(label, matcher) {
      const walk = (node) => {
        if (!node || node.nodeType !== 1) return null;
        // Prefer deepest match so we don't grab the hero root's innerText.
        for (const c of node.children) {
          const hit = walk(c);
          if (hit) return hit;
        }
        const t = (node.innerText || "").trim().replace(/\s+/g, " ");
        if (matcher(t, node)) return node;
        return null;
      };
      const hit = walk(el);
      if (!hit) return { label, found: false };
      const r = hit.getBoundingClientRect();
      const cs = getComputedStyle(hit);
      // For padded controls (button/a), compare TEXT metrics to the text
      // leaf — not the padding box. Otherwise fontSize/width fights are
      // false (button 16px / 145w vs glyph run 14px / 105w).
      let fontSize = parseFloat(cs.fontSize) || null;
      let textW = r.width;
      let textH = r.height;
      let textX = r.left;
      let textY = r.top;
      const isControl =
        hit.tagName === "BUTTON" ||
        hit.tagName === "A" ||
        hit.getAttribute("role") === "button" ||
        /btn|button/i.test(String(hit.className || ""));
      if (isControl) {
        try {
          const walker = document.createTreeWalker(hit, NodeFilter.SHOW_TEXT);
          let tn;
          while ((tn = walker.nextNode())) {
            if (!String(tn.textContent || "").trim()) continue;
            const pe = tn.parentElement;
            if (pe) {
              const pcs = getComputedStyle(pe);
              fontSize = parseFloat(pcs.fontSize) || fontSize;
              const range = document.createRange();
              range.selectNodeContents(tn);
              const rects = Array.from(range.getClientRects());
              if (range.detach) range.detach();
              if (rects.length) {
                let L = Infinity,
                  T = Infinity,
                  R = -Infinity,
                  B = -Infinity;
                for (const rr of rects) {
                  L = Math.min(L, rr.left);
                  T = Math.min(T, rr.top);
                  R = Math.max(R, rr.right);
                  B = Math.max(B, rr.bottom);
                }
                if (R > L && B > T) {
                  textX = L;
                  textY = T;
                  textW = R - L;
                  textH = B - T;
                }
              }
            }
            break;
          }
        } catch (_) {}
      }
      return {
        label,
        found: true,
        text: (hit.innerText || "").trim().replace(/\s+/g, " ").slice(0, 100),
        x: +(textX - rootRect.left).toFixed(1),
        y: +(textY - rootRect.top).toFixed(1),
        w: +textW.toFixed(1),
        h: +textH.toFixed(1),
        fontSize,
        fontFamily: (cs.fontFamily || "").split(",")[0].replace(/['"]/g, ""),
        fontWeight: cs.fontWeight,
        color: cs.color,
        tag: hit.tagName.toLowerCase(),
        isControl,
      };
    }

    const domProbes = [
      probeDom(
        "heading",
        (t) =>
          /Discover curated work from the world's top designers/i.test(t) &&
          t.length < 100
      ),
      probeDom(
        "subtitle",
        (t) => /Explore handpicked portfolios/i.test(t) && t.length < 140
      ),
      probeDom(
        "trusted",
        (t) => /Trusted by 45,000/i.test(t) && t.length < 80
      ),
      probeDom(
        "ctaText",
        (t) => /Showcase your portfolio/i.test(t) && t.length < 120
      ),
      probeDom(
        "submitBtn",
        (t, n) =>
          /Submit Portfolio/i.test(t) &&
          t.length < 40 &&
          (n.tagName === "BUTTON" ||
            n.getAttribute("role") === "button" ||
            /btn|button/i.test(String(n.className || "")) ||
            n.tagName === "A")
      ),
    ];

    const imgs = Array.from(el.querySelectorAll("img"))
      .map((img) => {
        const r = img.getBoundingClientRect();
        return {
          w: +r.width.toFixed(1),
          h: +r.height.toFixed(1),
          x: +(r.left - rootRect.left).toFixed(1),
          y: +(r.top - rootRect.top).toFixed(1),
          alt: (img.alt || "").slice(0, 40),
          src: (img.currentSrc || img.src || "").slice(0, 80),
        };
      })
      .filter((i) => i.w > 8 && i.h > 8);

    const harvested = await Acopio.harvestFontBytesForElement(el);

    // Fidelity convert document ONLY — never live re-convert.
    const out = await AcopioFigmaClipboard.convertLiveToDocument(el, {
      name: "Component 1",
      fontAssets: harvested,
    });
    const changes = (out.document && out.document.nodeChanges) || [];
    const byGuid = new Map(changes.map((n) => [n.guid, n]));

    function nodeXY(n) {
      const t = n.transform;
      if (!t) return { x: null, y: null };
      return { x: t.m02 ?? t[4] ?? null, y: t.m12 ?? t[5] ?? null };
    }
    function nodeSize(n) {
      if (!n.size) return { w: null, h: null };
      return { w: n.size.x ?? n.size.w ?? null, h: n.size.y ?? n.size.h ?? null };
    }
    function absXY(n) {
      let x = 0;
      let y = 0;
      let cur = n;
      let guard = 0;
      while (cur && guard++ < 64) {
        const { x: dx, y: dy } = nodeXY(cur);
        if (dx != null) x += dx;
        if (dy != null) y += dy;
        const pg = cur.parentIndex && cur.parentIndex.guid;
        if (!pg) break;
        cur = byGuid.get(pg);
        if (!cur || cur.type === "CANVAS" || cur.type === "DOCUMENT") break;
      }
      return { x, y };
    }

    const figTexts = changes
      .filter((n) => n && n.type === "TEXT" && n.characters)
      .map((n) => {
        const local = nodeXY(n);
        const abs = absXY(n);
        const { w, h } = nodeSize(n);
        return {
          characters: n.characters,
          x: local.x != null ? +local.x.toFixed(1) : null,
          y: local.y != null ? +local.y.toFixed(1) : null,
          absX: +abs.x.toFixed(1),
          absY: +abs.y.toFixed(1),
          contentX: +(abs.x - PAD).toFixed(1),
          contentY: +(abs.y - PAD).toFixed(1),
          w: w != null ? +w.toFixed(1) : null,
          h: h != null ? +h.toFixed(1) : null,
          fontSize: n.fontSize,
          fontName: n.fontName,
          glyphCount:
            n.derivedTextData && Array.isArray(n.derivedTextData.glyphs)
              ? n.derivedTextData.glyphs.length
              : 0,
        };
      });

    const figFrames = changes
      .filter((n) => n && n.type === "FRAME")
      .map((n) => {
        const { x, y } = nodeXY(n);
        const { w, h } = nodeSize(n);
        const parentGuid = n.parentIndex && n.parentIndex.guid;
        const parent = parentGuid ? byGuid.get(parentGuid) : null;
        return {
          name: n.name,
          x: x != null ? +x.toFixed(1) : null,
          y: y != null ? +y.toFixed(1) : null,
          w: w != null ? +w.toFixed(1) : null,
          h: h != null ? +h.toFixed(1) : null,
          parentType: parent && parent.type,
          parentName: parent && parent.name,
          guid: n.guid,
          parentGuid,
        };
      });

    const figImageFills = changes.filter((n) =>
      (n.fillsPaints || []).some((p) => p && p.type === "IMAGE")
    ).length;
    const figVectors = changes.filter((n) => n && n.type === "VECTOR").length;

    function matchText(needle) {
      const re = new RegExp(needle, "i");
      return figTexts.find((t) => re.test(t.characters));
    }

    const comparisons = [];
    for (const d of domProbes) {
      if (!d.found) {
        comparisons.push({ label: d.label, ok: false, reason: "DOM not found" });
        continue;
      }
      let fig = null;
      if (d.label === "heading") fig = matchText("Discover curated work");
      if (d.label === "subtitle") fig = matchText("Explore handpicked");
      if (d.label === "trusted") fig = matchText("Trusted by 45");
      if (d.label === "ctaText") fig = matchText("Showcase your portfolio");
      if (d.label === "submitBtn") fig = matchText("Submit Portfolio");
      if (!fig) {
        comparisons.push({
          label: d.label,
          ok: false,
          reason: "Figma TEXT missing",
          dom: d,
        });
        continue;
      }
      // Compare content-space (abs − pad) to DOM selection-relative coords.
      const dx = Math.abs((fig.contentX ?? 0) - d.x);
      const dy = Math.abs((fig.contentY ?? 0) - d.y);
      const dw = Math.abs((fig.w ?? 0) - d.w);
      const dh = Math.abs((fig.h ?? 0) - d.h);
      const fails = [];
      if (fig.glyphCount === 0) fails.push("zero glyphs");
      if (d.fontSize && fig.fontSize && Math.abs(fig.fontSize - d.fontSize) > 1.5) {
        fails.push(`fontSize ${d.fontSize}→${fig.fontSize}`);
      }
      // Width fights are noisy for centered / truncated TEXT runs — require
      // near-full character coverage AND a large relative delta.
      const figChars = String(fig.characters || "");
      const domChars = String(d.text || "");
      const coversMost =
        domChars.length > 0 &&
        figChars.length >= domChars.length * 0.95;
      if (
        coversMost &&
        d.label !== "subtitle" &&
        d.label !== "heading" &&
        !d.isControl &&
        d.w > 40 &&
        dw > Math.max(24, d.w * 0.12)
      ) {
        fails.push(`w Δ${dw.toFixed(1)}`);
      }
      if (
        coversMost &&
        d.label !== "heading" &&
        d.label !== "ctaText" &&
        d.label !== "submitBtn" &&
        d.h > 10 &&
        dh > Math.max(10, d.h * 0.25)
      ) {
        fails.push(`h Δ${dh.toFixed(1)}`);
      }
      // Vertical placement vs DOM. Skip horizontal: centered blocks report the
      // full element box while figit TEXT sits at the glyph origin.
      if (d.label === "subtitle" || d.label === "trusted" || d.label === "heading") {
        if (dy > 16) fails.push(`dy ${dy.toFixed(1)}`);
      }
      comparisons.push({
        label: d.label,
        ok: fails.length === 0,
        fails,
        dom: { x: d.x, y: d.y, w: d.w, h: d.h, fontSize: d.fontSize },
        fig: {
          absX: fig.absX,
          absY: fig.absY,
          contentX: fig.contentX,
          contentY: fig.contentY,
          w: fig.w,
          h: fig.h,
          fontSize: fig.fontSize,
          glyphCount: fig.glyphCount,
          characters: fig.characters.slice(0, 80),
        },
        delta: { dx: +dx.toFixed(1), dy: +dy.toFixed(1), dw: +dw.toFixed(1), dh: +dh.toFixed(1) },
      });
    }

    const rootFrame =
      figFrames.find(
        (f) =>
          Math.abs((f.w || 0) - out.width) < 2 &&
          Math.abs((f.h || 0) - out.height) < 2
      ) ||
      figFrames.find((f) => f.name === "Component 1") ||
      figFrames[0];

    const rootOk =
      rootFrame &&
      Math.abs((rootFrame.w || 0) - out.width) < 3 &&
      Math.abs((rootFrame.h || 0) - out.height) < 3 &&
      Math.abs(out.width - (rootRect.width + PAD * 2)) < 3 &&
      Math.abs(out.height - (rootRect.height + PAD * 2)) < 3;

    // No nested same-size frame at >5px offset except expected pad (20,20).
    const badOffsetFrames = [];
    for (const f of figFrames) {
      if (!rootFrame || f.guid === rootFrame.guid) continue;
      if (f.parentGuid !== rootFrame.guid) continue;
      const sameContent =
        Math.abs((f.w || 0) - rootRect.width) < 5 &&
        Math.abs((f.h || 0) - rootRect.height) < 5;
      const sameRoot =
        Math.abs((f.w || 0) - out.width) < 5 &&
        Math.abs((f.h || 0) - out.height) < 5;
      if (!sameContent && !sameRoot) continue;
      const atPad =
        Math.abs((f.x || 0) - PAD) <= 5 && Math.abs((f.y || 0) - PAD) <= 5;
      const nearZero = Math.abs(f.x || 0) <= 5 && Math.abs(f.y || 0) <= 5;
      if (atPad || nearZero) continue;
      badOffsetFrames.push(f);
    }

    const minTextAbsY = figTexts.reduce(
      (min, t) => (t.absY == null ? min : Math.min(min, t.absY)),
      Infinity
    );
    const submit = matchText("Submit Portfolio");
    const cta = matchText("Showcase your portfolio");
    const submitWithinRoot =
      submit &&
      submit.absY >= 0 &&
      submit.absY + (submit.h || 0) <= out.height + 2;
    const ctaWithinRoot =
      cta && cta.absY >= 0 && cta.absY + (cta.h || 0) <= out.height + 2;

    const asserts = {
      rootOk: Boolean(rootOk),
      pasteSafeMargin: out.pasteSafeMargin === PAD,
      minTextAbsYOk: Number.isFinite(minTextAbsY) && minTextAbsY >= 0,
      noBadPageOffset: badOffsetFrames.length === 0,
      submitWithinRoot: Boolean(submitWithinRoot),
      ctaWithinRoot: Boolean(ctaWithinRoot),
      glyphsOk: figTexts.every((t) => t.glyphCount > 0),
      logosPresent: figImageFills + figVectors >= 3,
      harvestedLatinOnly: harvested.every((f) => f.coversLatin !== false),
      // Heading lines must not smash (user evidence: overlapping "from"/"designers").
      noHeadingOverlap: (() => {
        const heads = figTexts.filter((t) =>
          /Discover curated|world's top|designers/i.test(t.characters || "")
        );
        if (heads.length < 2) return true;
        for (let i = 0; i < heads.length; i++) {
          for (let j = i + 1; j < heads.length; j++) {
            const a = heads[i];
            const b = heads[j];
            if (a.absY == null || b.absY == null) continue;
            const dy = Math.abs(a.absY - b.absY);
            const ah = a.h || 20;
            const bh = b.h || 20;
            if (dy < Math.min(ah, bh) * 0.55) return false;
          }
        }
        return true;
      })(),
      // Parent-relative heading Y must not go negative (ascender clip).
      headingMinYGe0: (() => {
        const heads = figTexts.filter((t) =>
          /Discover curated|world's top designers/i.test(t.characters || "")
        );
        return heads.every((t) => {
          const y = t.contentY != null ? t.contentY : (t.absY || 0) - PAD;
          return y >= -0.5;
        });
      })(),
      // No mid-scroll marquee frames (wide short tracks with negative x).
      noNegMarqueeFrames: !figFrames.some(
        (f) => (f.x ?? 0) < -5 && (f.w ?? 0) > 200 && (f.h == null || f.h < 220)
      ),
      // Full "the world's top designers" should stay one line (not soft-split).
      headingSecondLineIntact: (() => {
        const full = figTexts.find((t) =>
          /the world's top designers/i.test(t.characters || "")
        );
        if (full) return true;
        // Accept two BR lines without a third soft-wrap fragment.
        const a = figTexts.some((t) => /^Discover curated work from$/i.test((t.characters || "").trim()));
        const b = figTexts.some((t) => /the world's top designers/i.test(t.characters || ""));
        const orphan = figTexts.some((t) => /^designers$/i.test((t.characters || "").trim()));
        return a && b && !orphan;
      })(),
      ctaHasSpace: !figTexts.some((t) => /todesigners/i.test(t.characters || "")),
    };

    return {
      root: {
        domW: +rootRect.width.toFixed(1),
        domH: +rootRect.height.toFixed(1),
        outW: out.width,
        outH: out.height,
        contentW: out.contentWidth,
        contentH: out.contentHeight,
        pasteSafeMargin: out.pasteSafeMargin,
        figRoot: rootFrame,
        rootOk,
      },
      asserts,
      badOffsetFrames,
      minTextAbsY: Number.isFinite(minTextAbsY) ? +minTextAbsY.toFixed(1) : null,
      harvested: harvested.map((f) => ({
        family: f.family,
        weight: f.weight,
        coversLatin: f.coversLatin,
      })),
      harvestedNonLatin: harvested.filter((f) => f.coversLatin === false).length,
      domImgCount: imgs.length,
      figImageFills,
      figVectors,
      figTextCount: figTexts.length,
      figFrameCount: figFrames.length,
      changeCount: changes.length,
      typeCounts: changes.reduce((acc, n) => {
        const k = String(n && n.type);
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
      comparisons,
      htmlLen: out.html ? String(out.html).length : 0,
      passCount: comparisons.filter((c) => c.ok).length,
      failCount: comparisons.filter((c) => !c.ok).length,
    };
  }, PAD);

  report.glyphWarnings = glyphWarnings.length;
  report.glyphWarningSamples = glyphWarnings.slice(0, 10);

  writeFileSync(join(OUT, "wallof-hero-e2e-report.json"), JSON.stringify(report, null, 2));
  console.log("\n=== Wallof hero DOM vs Figma (fidelity document) ===");
  console.log(JSON.stringify(report, null, 2));

  const a = report.asserts || {};
  const criticalLabels = ["heading", "subtitle", "trusted", "ctaText"];
  const criticalFails = (report.comparisons || []).filter(
    (c) => criticalLabels.includes(c.label) && !c.ok
  );

  const ok =
    a.rootOk &&
    a.pasteSafeMargin &&
    a.minTextAbsYOk &&
    a.noBadPageOffset &&
    a.submitWithinRoot &&
    a.ctaWithinRoot &&
    a.glyphsOk &&
    a.logosPresent &&
    a.harvestedLatinOnly &&
    a.noHeadingOverlap &&
    a.headingMinYGe0 &&
    a.noNegMarqueeFrames &&
    a.headingSecondLineIntact &&
    a.ctaHasSpace &&
    criticalFails.length === 0 &&
    report.glyphWarnings === 0 &&
    report.figTextCount >= 4;

  console.log(
    ok
      ? "\nRESULT: PASS — fidelity geometry + pad + fonts + logos"
      : "\nRESULT: FAIL — see asserts / comparisons"
  );
  if (!ok) {
    console.log("criticalFails:", JSON.stringify(criticalFails, null, 2));
    console.log("asserts:", a);
  }

  await browser.close();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
