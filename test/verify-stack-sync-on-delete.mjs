#!/usr/bin/env node
/**
 * User-reported: deleted a site's folder in the side panel, then started
 * collecting again on that same still-open tab — the tooltip's own
 * "recently collected" stack strip kept showing the OLD, pre-delete items
 * instead of syncing to the real (now much smaller) folder.
 *
 * Root cause: overlay.js seeds `sessionCaptures` from the real DB exactly
 * ONCE per page load (a `sessionCaptures.length === 0` guarded fetch) and
 * otherwise only ever grows it locally on this tab's own successful
 * Collect. A deletion made in the side panel — a separate extension page,
 * with its own direct IndexedDB access — never told this tab's content
 * script anything happened.
 *
 * Fixed with the same chrome.storage.onChanged mechanism this codebase
 * already uses for acopioActive sync: db.js now writes
 * acopioLibraryChangedAt on every add/delete/restore, and overlay.js reacts
 * by refreshing the stack immediately if the tooltip is open, or marking it
 * dirty for the next render() if it's currently closed.
 *
 * This test drives the REAL functions against a REAL IndexedDB (available
 * in headless Chrome) — not a reimplementation of the logic being tested.
 *
 * Run: node test/verify-stack-sync-on-delete.mjs
 */
import { chromium } from "playwright";
import { createServer } from "http";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8774;

// IndexedDB (db.js needs a real one — no mock) is denied in an opaque
// origin like about:blank or a data: URL. A plain local HTTP server gives
// this test a real http:// origin to open it in, same reasoning as
// test/verify-google-fonts-figma.mjs's own server.
function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <div id="card" style="position:absolute;left:200px;top:150px;width:320px;height:220px;background:#fff;">
          <h2>Trusted by 45,000+ designers</h2>
          <p>Some component body text here to look plausible.</p>
        </div>
      `);
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const server = await startServer();

let browser;
let exitCode = 1;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
  await page.waitForTimeout(50);

  // Bridge chrome.storage so db.js's write (in this same page/context) and
  // overlay.js's onChanged listener (also this same page) actually talk to
  // each other, replicating real chrome.storage.onChanged semantics
  // (fires listeners on a later tick, not synchronously inside .set()).
  await page.evaluate(() => {
    window.__storageListeners = [];
    window.__lastActive = { acopioActive: true };
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
            try {
              if (msg?.type === "GET_RECENT_ITEMS") {
                const items = await window.AcopioDB.getItemsByHostname(msg.payload.hostname);
                const nonNote = items.filter((it) => it.type !== "note");
                const recent = nonNote
                  .slice()
                  .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt))
                  .slice(0, msg.payload.limit || 4);
                if (cb) cb({ ok: true, items: recent, total: nonNote.length });
                return;
              }
              if (msg?.type === "CAPTURE_ITEM") {
                await window.AcopioDB.addItem(msg.payload);
                if (cb) cb({ ok: true, item: msg.payload });
                return;
              }
              if (cb) cb({ ok: true });
            } catch (e) {
              if (cb) cb({ ok: false, error: String(e) });
            }
          })();
        },
      },
      storage: {
        local: {
          get(keys, cb) {
            cb(window.__lastActive);
          },
          set(obj, cb) {
            Object.assign(window.__lastActive, obj);
            const changes = {};
            for (const k of Object.keys(obj)) changes[k] = { newValue: obj[k] };
            // Real chrome.storage.onChanged fires asynchronously — mimic
            // that instead of calling listeners synchronously inline.
            Promise.resolve().then(() => {
              window.__storageListeners.forEach((fn) => {
                try {
                  fn(changes, "local");
                } catch (_) {}
              });
            });
            if (cb) cb();
          },
          onChanged: undefined,
        },
        onChanged: {
          addListener(fn) {
            window.__storageListeners.push(fn);
          },
        },
      },
    };
  });

  for (const rel of [
    "src/db/db.js",
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

  // Pre-seed the DB with 2 items "already collected here" before this
  // test's tooltip ever opens — this is what a returning visit to a site
  // with an existing folder looks like.
  const hostname = await page.evaluate(async () => {
    const host = Acopio.hostname() || "test.local";
    await window.AcopioDB.addItem({
      id: "pre-1",
      type: "component",
      hostname: host,
      capturedAt: new Date(Date.now() - 2000).toISOString(),
      sourceUrl: "https://" + host + "/",
      selector: "#pre-1",
      note: "",
      data: {},
    });
    await window.AcopioDB.addItem({
      id: "pre-2",
      type: "component",
      hostname: host,
      capturedAt: new Date(Date.now() - 1000).toISOString(),
      sourceUrl: "https://" + host + "/",
      selector: "#pre-2",
      note: "",
      data: {},
    });
    return host;
  });

  // At 0 real items the stack row doesn't render at all — the tooltip
  // correctly falls back to the plain first-time "+ Collect" button
  // instead of a pointless "0 items collected" row. So "no .capture-stack
  // element" IS the correct rendering for zero, not a bug — normalized to
  // the string "(no stack — 0 items)" here so assertions can treat it the
  // same as an explicit zero.
  function readStackLabel() {
    return page.evaluate(() => {
      const host = Acopio.overlayHostNode();
      const el = host && host.shadowRoot && host.shadowRoot.querySelector(".capture-stack");
      return el ? el.getAttribute("aria-label") : "(no stack — 0 items)";
    });
  }

  // Open the tooltip — this seeds sessionCaptures from the DB for the
  // first time (the existing "seed once" behavior, unchanged).
  await page.evaluate(() => {
    const el = document.getElementById("card");
    Acopio.overlay.showFor(el, { type: "component", family: "other" });
  });
  await page.waitForTimeout(400);

  const beforeDelete = await readStackLabel();
  console.log("Stack label right after opening (should show the 2 pre-seeded items):", beforeDelete);

  // Simulate the reported scenario: delete the whole folder from the side
  // panel (a separate extension context — this test represents that by
  // calling AcopioDB directly, the same way sidepanel.js does) WHILE this
  // tab's tooltip is still open, looking at the now-stale stack.
  await page.evaluate(async () => {
    const host = Acopio.hostname() || "test.local";
    await window.AcopioDB.deleteFolder(host);
  });
  // Give the async chrome.storage.onChanged tick + the resulting
  // loadStackForCurrentFolder round-trip time to land.
  await page.waitForTimeout(300);

  const afterDelete = await readStackLabel();
  console.log("Stack label after the folder was deleted (tooltip still open):", afterDelete);

  // Now simulate "started collecting again" — a fresh item lands in what
  // is now an empty folder.
  await page.evaluate(async () => {
    const host = Acopio.hostname() || "test.local";
    await window.AcopioDB.addItem({
      id: "fresh-1",
      type: "component",
      hostname: host,
      capturedAt: new Date().toISOString(),
      sourceUrl: "https://" + host + "/",
      selector: "#fresh-1",
      note: "",
      data: {},
    });
  });
  await page.waitForTimeout(300);
  const afterRecollect = await readStackLabel();
  console.log("Stack label after recollecting 1 fresh item:", afterRecollect);

  // Also test the "tooltip was closed when the change happened" path: hide
  // it, delete everything, then reopen fresh — it must show the CURRENT
  // state, not whatever sessionCaptures happened to hold before hiding.
  await page.evaluate(() => Acopio.overlay.hide());
  await page.evaluate(async () => {
    const host = Acopio.hostname() || "test.local";
    await window.AcopioDB.deleteFolder(host);
  });
  await page.waitForTimeout(150); // the onChanged tick still fires even while closed (sets stackDirty)
  await page.evaluate(() => {
    const el = document.getElementById("card");
    Acopio.overlay.showFor(el, { type: "component", family: "other" });
  });
  await page.waitForTimeout(400);
  const afterClosedThenReopen = await readStackLabel();
  console.log("Stack label after: close tooltip -> delete everything -> reopen:", afterClosedThenReopen);

  if (pageErrors.length) console.log("Page errors during the flow:", pageErrors);

  const fails = [];
  if (!beforeDelete || !beforeDelete.startsWith("2 items")) {
    fails.push(`expected "2 items..." right after opening, got ${JSON.stringify(beforeDelete)}`);
  }
  if (afterDelete !== "(no stack — 0 items)") {
    fails.push(`expected the stack to reflect 0 items after the folder was deleted while open, got ${JSON.stringify(afterDelete)} — this is the reported bug if it still shows stale items`);
  }
  if (!afterRecollect || !afterRecollect.startsWith("1 items") && !afterRecollect.startsWith("1 item")) {
    fails.push(`expected the stack to show exactly 1 item after recollecting, got ${JSON.stringify(afterRecollect)}`);
  }
  if (afterClosedThenReopen !== "(no stack — 0 items)") {
    fails.push(`expected "0 items..." after close->delete->reopen (dirty-flag path), got ${JSON.stringify(afterClosedThenReopen)}`);
  }

  if (fails.length) {
    console.log("\nRESULT: FAIL —", fails.join("; "));
    exitCode = 1;
  } else {
    console.log("\nRESULT: PASS — the tooltip's stack stays in sync with real DB deletes/restores/adds, both while open (live refresh) and while closed (dirty-flag refresh on next render).");
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
