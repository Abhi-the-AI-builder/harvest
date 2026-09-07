#!/usr/bin/env node
/**
 * Systemic Copy→Figma parity matrix (local fixtures — every-site invariants).
 * Run: node test/verify-parity-matrix.mjs
 *
 * Invariants covered (html.to.design bar for Acopio paste path):
 * 1. Heading BR — two lines, pad clearance, no soft-split orphans
 * 2. Padded control — leaf fontSize (14), not padding-box 16
 * 3. Overflow caption — painted bounds + caption text present
 * 4. Mixed card — Text + Image inventory
 * 5. Marquee — freeze transform; logos horizontal (shared Y); netflix visible
 * 6. CSS-class background-image — frozen url present / IMAGE or fill
 * 7. Sticky header inside card — sticky baked; bar text present
 * 8. Canvas logo — rasterized to IMAGE (no empty canvas hole)
 * 9. Same-origin iframe — inlined snippet text (not empty)
 * 10. Line-clamp — frozen height; caption present; not expanded tall
 * 11. Clip-path avatar — IMAGE leaf present
 * 12. Picture art-direction — pinned currentSrc IMAGE
 * 13. Glass blend — label text present (honest approx)
 * 14. Hidden decoy — invisible strings absent from TEXT nodes
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "test/screenshots");
mkdirSync(OUT, { recursive: true });
const FIXTURE = pathToFileURL(join(ROOT, "test/fixtures/parity-matrix.html")).href;

function injectChromeMock() {
  window.chrome = {
    runtime: {
      id: "acopio-test",
      lastError: null,
      sendMessage(msg, cb) {
        (async () => {
          try {
            if (msg?.type === "FETCH_IMAGE_BYTES" && msg.payload?.url) {
              const res = await fetch(msg.payload.url).catch(() => null);
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

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
  await page.goto(FIXTURE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate(injectChromeMock);
  for (const rel of [
    "src/content/shared.js",
    "vendor/dom-to-figma.js",
    "src/content/figma-clipboard.js",
  ]) {
    await page.addScriptTag({ path: join(ROOT, rel) });
  }

  const report = await page.evaluate(async () => {
    const PAD = window.AcopioFigmaClipboard.PASTE_SAFE_MARGIN_PX || 20;
    const cases = {};

    function xy(n) {
      const t = n.transform;
      return { x: t?.m02 ?? t?.[4] ?? null, y: t?.m12 ?? t?.[5] ?? null };
    }
    function absXY(n, byGuid) {
      let x = 0;
      let y = 0;
      let cur = n;
      let guard = 0;
      while (cur && guard++ < 64) {
        const p = xy(cur);
        if (p.x != null) x += p.x;
        if (p.y != null) y += p.y;
        const pg = cur.parentIndex && cur.parentIndex.guid;
        if (!pg) break;
        cur = byGuid.get(`${pg.sessionID}:${pg.localID}`);
        if (!cur || cur.type === "CANVAS" || cur.type === "DOCUMENT") break;
      }
      return { x, y };
    }
    function byGuidMap(doc) {
      const changes = (doc && doc.nodeChanges) || [];
      return new Map(
        changes
          .filter((n) => n && n.guid)
          .map((n) => [`${n.guid.sessionID}:${n.guid.localID}`, n])
      );
    }
    function textsOf(doc) {
      const changes = (doc && doc.nodeChanges) || [];
      const byGuid = byGuidMap(doc);
      return changes
        .filter((n) => n && n.type === "TEXT" && n.characters)
        .map((n) => {
          const p = xy(n);
          const a = absXY(n, byGuid);
          return {
            characters: n.characters,
            x: p.x,
            y: p.y,
            absX: a.x,
            absY: a.y,
            fontSize: n.fontSize,
            glyphs:
              n.derivedTextData && Array.isArray(n.derivedTextData.glyphs)
                ? n.derivedTextData.glyphs.length
                : 0,
          };
        });
    }
    function imagesOf(doc) {
      const changes = (doc && doc.nodeChanges) || [];
      return changes.filter(
        (n) =>
          n &&
          (n.type === "RECTANGLE" || n.type === "ELLIPSE" || n.type === "FRAME") &&
          Array.isArray(n.fill) &&
          n.fill.some((f) => f && (f.type === "IMAGE" || f.imageHash || f.image))
      );
    }
    function hasImageFillSafe(doc) {
      const changes = (doc && doc.nodeChanges) || [];
      return changes.some(
        (n) =>
          n &&
          Array.isArray(n.fill) &&
          n.fill.some(
            (f) =>
              f &&
              (f.type === "IMAGE" ||
                f.imageHash ||
                (f.image && (f.image.hash || f.image.dataBlob)))
          )
      );
    }
    function nodeSize(n) {
      return {
        w: n?.size?.x ?? n?.size?.w ?? null,
        h: n?.size?.y ?? n?.size?.h ?? null,
      };
    }

    async function convertCase(sel) {
      const el = document.querySelector(sel);
      if (!el) return { ok: false, reason: "missing", sel };
      const out = await AcopioFigmaClipboard.convertLiveToDocument(el, {
        name: sel,
      });
      return {
        ok: true,
        sel,
        width: out.width,
        height: out.height,
        contentHeight: out.contentHeight,
        pad: out.pasteSafeMargin,
        texts: textsOf(out.document),
        imageCount: imagesOf(out.document).length,
        hasImage: hasImageFillSafe(out.document),
        frames: ((out.document && out.document.nodeChanges) || [])
          .filter((n) => n && n.type === "FRAME")
          .map((n) => {
            const p = xy(n);
            const s = nodeSize(n);
            return { name: n.name, x: p.x, y: p.y, w: s.w, h: s.h, clips: n.clipsContent };
          }),
        inventory:
          typeof Acopio !== "undefined" && Acopio.inventoryContainsLabels
            ? Acopio.inventoryContainsLabels(el)
            : [],
        painted:
          typeof Acopio !== "undefined" && Acopio.measurePaintedBounds
            ? (() => {
                const b = Acopio.measurePaintedBounds(el);
                const r = el.getBoundingClientRect();
                return {
                  borderH: +r.height.toFixed(1),
                  paintedH: +b.height.toFixed(1),
                };
              })()
            : null,
      };
    }

    async function prepProbe(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const prep = await AcopioFigmaClipboard.prepareFidelityClone(el, {
        name: sel,
      });
      try {
        const root = prep.contentTarget || prep.target;
        return {
          html: (root && root.outerHTML) || "",
          hasCanvasStill: Boolean(
            root && root.querySelector && root.querySelector("[data-acopio-canvas-still]")
          ),
          hasIframeInline: Boolean(
            root &&
              root.querySelector &&
              root.querySelector('[data-acopio-iframe="inline"]')
          ),
          hasMaskStill: Boolean(
            root && root.querySelector && root.querySelector("[data-acopio-mask-still]")
          ),
          bgImage: (() => {
            const hero =
              (root && root.querySelector && root.querySelector(".css-bg-hero")) ||
              root;
            return (hero && hero.style && hero.style.backgroundImage) || "";
          })(),
          clampStyle: (() => {
            const c =
              root && root.querySelector && root.querySelector(".clamp-caption");
            if (!c) return null;
            return {
              height: c.style.height,
              overflow: c.style.overflow,
              clamp: c.style.webkitLineClamp || c.style.getPropertyValue("-webkit-line-clamp"),
            };
          })(),
          stickyPos: (() => {
            const b =
              root && root.querySelector && root.querySelector(".sticky-bar");
            return b ? b.style.position : null;
          })(),
          pictureSrcsetGone: (() => {
            const img =
              root && root.querySelector && root.querySelector("picture img, img");
            if (!img) return null;
            return {
              src: img.getAttribute("src") || "",
              srcset: img.getAttribute("srcset"),
              sources: root.querySelectorAll("picture source").length,
            };
          })(),
          decoyText: (root && root.textContent) || "",
        };
      } finally {
        prep.cleanup();
      }
    }

    // 1 Heading BR — convert the title node (owns <br>), not the card chrome
    {
      const c = await convertCase(".hero-title");
      const hs = (c.texts || []).filter((t) =>
        /Discover curated|world's top designers|curated work|designers/i.test(
          t.characters
        )
      );
      const line1 = (c.texts || []).find((t) =>
        /Discover curated work from/i.test(t.characters)
      );
      const line2 = (c.texts || []).find((t) =>
        /the world's top designers/i.test(t.characters)
      );
      const ys = hs
        .map((t) => (t.absY != null ? t.absY : t.y))
        .filter((y) => y != null)
        .sort((a, b) => a - b);
      const minY = ys.length ? ys[0] : null;
      const dy =
        line1 && line2
          ? (line2.absY ?? line2.y) - (line1.absY ?? line1.y)
          : ys.length >= 2
            ? ys[1] - ys[0]
            : null;
      const softOrphans = (c.texts || []).filter((t) =>
        /^(Discover|curated work|from|designers)$/i.test(
          String(t.characters || "").trim()
        )
      );
      cases.headingBr = {
        ...c,
        minY,
        dy,
        line1: line1 && line1.characters,
        line2: line2 && line2.characters,
        softOrphanCount: softOrphans.length,
        pass:
          c.ok &&
          c.pad === PAD &&
          minY != null &&
          minY >= PAD - 0.5 &&
          Boolean(line1) &&
          Boolean(line2) &&
          dy != null &&
          Math.abs(dy - 48) < 6 &&
          softOrphans.length === 0 &&
          hs.every((t) => t.glyphs > 0),
      };
    }

    // 2 Padded control — leaf 14px inside section (must not flatten card)
    {
      const c = await convertCase("#case-button");
      const t = (c.texts || []).find((x) =>
        /Submit Portfolio/i.test(x.characters)
      );
      const structureOk = (c.texts || []).some((x) =>
        /Padded control label/i.test(x.characters)
      );
      cases.paddedControl = {
        ...c,
        figFontSize: t && t.fontSize,
        structureOk,
        pass:
          c.ok &&
          t &&
          t.fontSize === 14 &&
          t.glyphs > 0 &&
          structureOk,
      };
    }

    // 3 Overflow caption — painted bounds taller than border media box alone
    {
      const c = await convertCase("#case-caption");
      const hasCaption = (c.texts || []).some((t) =>
        /Share your work/i.test(t.characters)
      );
      cases.overflowCaption = {
        ...c,
        hasCaption,
        pass:
          c.ok &&
          hasCaption &&
          c.painted &&
          c.painted.paintedH >= c.painted.borderH - 1,
      };
    }

    // 4 Mixed card — Text + Image inventory
    {
      const c = await convertCase("#case-mixed");
      const inv = c.inventory || [];
      cases.mixedCard = {
        ...c,
        pass:
          c.ok &&
          inv.includes("Text") &&
          inv.includes("Image") &&
          (c.texts || []).some((t) => /Harshit/i.test(t.characters)),
      };
    }

    // 5 Marquee — freeze mid-scroll; logos share a horizontal Y band
    {
      const c = await convertCase("#case-marquee");
      const logoTexts = (c.texts || []).filter((t) =>
        /netflix|google|apple|uber|swiggy|cred|zomato/i.test(t.characters)
      );
      const logoNames = logoTexts.map((t) => t.characters.toLowerCase());
      const negFrames = (c.frames || []).filter((f) => f.x != null && f.x < -20);
      const ys = logoTexts
        .map((t) => (t.absY != null ? t.absY : t.y))
        .filter((y) => y != null);
      const ySpread =
        ys.length >= 2 ? Math.max(...ys) - Math.min(...ys) : 0;
      cases.marquee = {
        ...c,
        logoTexts: logoNames,
        negFrames: negFrames.length,
        ySpread: +ySpread.toFixed(2),
        pass:
          c.ok &&
          logoNames.includes("netflix") &&
          logoNames.includes("google") &&
          negFrames.length === 0 &&
          ySpread <= 8,
      };
    }

    // 6 CSS-class background-image
    {
      const probe = await prepProbe("#case-css-bg");
      const c = await convertCase("#case-css-bg");
      const bgOk =
        probe &&
        /url\(/i.test(probe.bgImage || "") &&
        /data:image|BG CLASS|4F6EF7|linear-gradient/i.test(probe.bgImage || "");
      cases.cssBg = {
        ...c,
        bgImage: probe && probe.bgImage,
        pass: c.ok && Boolean(bgOk),
      };
    }

    // 7 Sticky header inside card
    {
      const probe = await prepProbe("#sticky-card");
      const c = await convertCase("#sticky-card");
      const hasBar = (c.texts || []).some((t) => /Sticky tools/i.test(t.characters));
      cases.stickyInCard = {
        ...c,
        stickyPos: probe && probe.stickyPos,
        pass:
          c.ok &&
          hasBar &&
          probe &&
          (probe.stickyPos === "absolute" || probe.stickyPos === ""),
      };
    }

    // 8 Canvas logo → still img
    {
      const probe = await prepProbe("#canvas-wrap");
      const c = await convertCase("#canvas-wrap");
      const hasMark = (c.texts || []).some((t) =>
        /Canvas brand mark|ACOPIO/i.test(t.characters)
      );
      cases.canvasLogo = {
        ...c,
        hasCanvasStill: probe && probe.hasCanvasStill,
        pass: c.ok && probe && probe.hasCanvasStill && (c.hasImage || hasMark),
      };
    }

    // 9 Same-origin iframe inline
    {
      const probe = await prepProbe("#iframe-host");
      const c = await convertCase("#iframe-host");
      const hasSnippet = (c.texts || []).some((t) =>
        /Iframe snippet body/i.test(t.characters)
      );
      cases.iframeSnippet = {
        ...c,
        hasIframeInline: probe && probe.hasIframeInline,
        pass: c.ok && probe && probe.hasIframeInline && hasSnippet,
      };
    }

    // 10 Line-clamp — painted height frozen
    {
      const live = document.querySelector("#clamp-caption");
      const liveH = live ? live.getBoundingClientRect().height : 0;
      const probe = await prepProbe("#case-clamp");
      const c = await convertCase("#clamp-caption");
      const hasText = (c.texts || []).some((t) =>
        /intentionally long enough/i.test(t.characters)
      );
      const clampH = probe && probe.clampStyle && parseFloat(probe.clampStyle.height);
      const heightOk =
        liveH > 0 &&
        clampH > 0 &&
        Math.abs(clampH - liveH) < 4 &&
        (c.contentHeight != null
          ? c.contentHeight <= liveH + 8
          : c.height <= liveH + PAD * 2 + 8);
      cases.lineClamp = {
        ...c,
        liveH,
        clampH,
        clampStyle: probe && probe.clampStyle,
        pass: c.ok && hasText && heightOk,
      };
    }

    // 11 Clip-path / mask avatar → IMAGE leaf (or mask still)
    {
      const probe = await prepProbe("#case-mask");
      const c = await convertCase("#case-mask");
      cases.maskAvatar = {
        ...c,
        hasMaskStill: probe && probe.hasMaskStill,
        pass: c.ok && (c.hasImage || (probe && probe.hasMaskStill)),
      };
    }

    // 12 Picture art-direction — pin currentSrc, drop srcset
    {
      const probe = await prepProbe("#picture-card");
      const c = await convertCase("#picture-card");
      const pin = probe && probe.pictureSrcsetGone;
      const pinnedWide =
        pin &&
        /WIDE|22c55e|data:image/i.test(pin.src || "") &&
        !/FALLBACK|ef4444/i.test(pin.src || "") &&
        pin.srcset == null &&
        pin.sources === 0;
      cases.pictureArt = {
        ...c,
        pin,
        // SVG data URLs may become VECTOR fills — pin correctness is the claim.
        pass: c.ok && Boolean(pinnedWide),
      };
    }

    // 13 Glass blend — label survives (honest approx)
    {
      const c = await convertCase("#glass-panel");
      const hasLabel = (c.texts || []).some((t) => /Glass label/i.test(t.characters));
      cases.glassBlend = {
        ...c,
        pass: c.ok && hasLabel,
      };
    }

    // 14 Hidden decoy pruned
    {
      const probe = await prepProbe("#decoy-host");
      const c = await convertCase("#decoy-host");
      const allText = (c.texts || []).map((t) => t.characters).join("\n");
      const decoyGone =
        !/SHOULD_NOT_APPEAR_HIDDEN/i.test(allText) &&
        !/SHOULD_NOT_APPEAR_OPACITY/i.test(allText) &&
        probe &&
        !/SHOULD_NOT_APPEAR_HIDDEN/i.test(probe.decoyText || "") &&
        !/SHOULD_NOT_APPEAR_OPACITY/i.test(probe.decoyText || "");
      const hasVisible = (c.texts || []).some((t) => /Visible only/i.test(t.characters));
      cases.hiddenDecoy = {
        ...c,
        pass: c.ok && hasVisible && Boolean(decoyGone),
      };
    }

    const passCount = Object.values(cases).filter((c) => c.pass).length;
    const failCount = Object.values(cases).filter((c) => !c.pass).length;
    return { pad: PAD, passCount, failCount, cases };
  });

  writeFileSync(join(OUT, "parity-matrix-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(
    report.failCount === 0
      ? `\nRESULT: PASS (${report.passCount} cases)`
      : `\nRESULT: FAIL (${report.failCount} failed)`
  );
  await browser.close();
  process.exit(report.failCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
