# Harvest — Plan

Selective hover-to-collect design-research Chrome extension. Source spec:
`design-harvest-extension-prompt.md` (13 sections). Ground rules that apply to
every change from here on: `../` sibling `harvest-ground-rules.md`, copied
into this repo as `GROUND_RULES.md` for reference.

## Understanding, confirmed

- Core loop: hover any element → scoped Shadow-DOM tooltip → "+ Collect" →
  optional note → toast. No mode toggle, no page badge. Must never block
  normal browsing; the tooltip's own DOM is the only clickable surface.
- 4 capture types (color, font, image, component), auto-tagged by the
  Section 6 heuristic, folders keyed on exact hostname, Collections as a
  separate cross-cutting reference-only grouping.
- Security (Section 9) is not a nice-to-have: sanitize on capture AND on
  every render, never persist form field values, size-cap components, warn
  on likely-PII text.
- Five build phases (Section 12), each a testable checkpoint, this document
  covers Phase 1 now and will be extended as later phases land.

## Assumptions (stated, not asked — per Section 1/12 instruction)

1. **No build step for v1.** The stack recommendation (vanilla TS content
   script, React/Vite extension pages) is sound for a mature product, but
   for an extension I need to load unpacked and iterate on quickly, a build
   pipeline is friction with no payoff yet. Phase 1 ships as plain ES2020
   JS, loaded as ordered `content_scripts` files sharing one `window.Harvest`
   namespace (same pattern already used in the sibling `design-extractor`
   project in this workspace). I'll revisit TypeScript if/when the codebase
   size makes the lack of types actually costly — flagging this rather than
   silently deciding it's final.

2. **Where IndexedDB actually lives — this is the one architecturally
   load-bearing decision in Phase 1.** A content script's `indexedDB` is the
   *page's own origin* database (e.g. stripe.com's), not the extension's.
   If capture wrote there directly, the Library page (running at
   `chrome-extension://<id>/...`) could never read it back, and data would
   be scattered one silo per website — exactly the fragmentation this
   product exists to fix. So: the content script never touches IndexedDB
   directly. It sends captured items to the background service worker via
   `chrome.runtime.sendMessage`, and the service worker owns the single
   IndexedDB database (`harvest-db`, origin = the extension itself),
   performs the second sanitization pass there, and writes them. Extension
   pages (popup, later Library) read the same database directly, since they
   share the extension's origin. This also naturally gives atomic
   per-write transactions without extra coordination (Section 8's
   concurrent-tab requirement): every capture is one transaction against
   one database, regardless of which tab/site it came from.

3. **Icons are placeholder solid-color PNGs** (accent-color squares, no
   artwork pass) until there's a real Library UI to establish visual
   identity around. Functional, not final.

4. **Superseded by real usage:** Phase 1 originally shipped a thin popup
   (hostname + count only). Testing surfaced that this wasn't enough — there
   was nowhere to actually see what got collected. Replaced the popup with
   a **side panel** (`chrome.sidePanel`, opens on toolbar-icon click) that
   shows the current site's items live, in a compact tile grid by default
   with an Expand toggle for a detail-card view. This is a deliberate
   deviation from Section 7's "Library opens as a full tab, not the popup"
   — the side panel is the quick/glanceable view; the full tab (Section 7's
   folder grid, three-way grouping, multi-select, search) is still coming
   in Phase 2 for real browsing/comparison work. Confirmed with the user
   before building rather than assumed.

5. **Duplicate-detection, auto-tag override pill, and multi-item DOM-tree
   walking polish are Section 3/6 items but functionally land now** since
   they're part of the capture interaction itself (Section 2.9) — only the
   *Library-side* duplicate prompt UI is deferred to Phase 3 per the
   phase plan. Phase 1's job is: capture is correct, safe, and saved.

## File structure

```
harvest/
  PLAN.md
  GROUND_RULES.md
  QA_CHECKLIST.md
  manifest.json
  icons/
    icon16.png  icon48.png  icon128.png
  src/
    background.js          # service worker: context menu, owns IndexedDB, message router
    content/
      shared.js             # window.Harvest namespace, hostname/uuid/debounce helpers
      sanitize.js            # capture-time + render-time sanitization (Section 9)
      tagger.js               # auto type/family detection (Section 6)
      overlay.js               # Shadow DOM tooltip: render, position/flip, tree-walk, note field, toast
      content.js                # hover listener, orchestrates tagger+overlay, sends CAPTURE_ITEM
    db/
      db.js                      # shared IndexedDB module (schemaVersion, migrations, CRUD) — imported by background.js and popup.js
    popup/
      popup.html
      popup.css
      popup.js
  test/
    xss-adversarial.html          # Section 10's required adversarial test page
```

## Phase plan (Section 12)

- **Phase 1 (this pass):** capture interaction (hover, tooltip, collect,
  note field) + storage, sanitization built in from day one. No Library UI.
- Phase 2: Library page, folder grid, folder detail, by-website grouping.
- Phase 3: by-type toggle, delete/undo, duplicate-detection UI, Collections.
- Phase 4: Compare/pairing view.
- Phase 5: Export (ZIP, handoff sheet, Figma clipboard bridge).

Each phase ends with: what to manually test, which Section 8 edge cases are
handled vs. deferred, and actual Section 10 test results (including the
adversarial XSS test once capture/storage exist) — reported honestly.
