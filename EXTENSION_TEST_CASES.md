# Harvest — Full-Extension Test Cases (pre-deploy)

Companion to [`NOTES_COLLECTIONS_TEST_CASES.md`](NOTES_COLLECTIONS_TEST_CASES.md)
(Notes capture + Collections, covered in full detail there — not repeated
here). This file covers everything else: hover-capture and its four capture
types, Compare/Pairing, Export, the floating toolbar + side panel chrome,
and cross-cutting security/reliability concerns. Also distinct from
`QA_CHECKLIST.md`, which is a chronological build log, not a working test
matrix — this is meant to be run top to bottom, once, right before shipping.

Grounded in the real source: `src/content/{content,overlay,tagger,sanitize,shared,toolbar}.js`,
`src/background.js`, `src/db/db.js`, `src/sidepanel/{sidepanel.js,sidepanel.css}`.

Status legend: `[x]` verified live (this session or an earlier phase, per
`QA_CHECKLIST.md`), `[ ]` not yet run, `[!]` known gap/deferred, not a
regression.

---

## 1. Hover-capture — the toggle & activation state

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 1.1 | Toggle on/off (side panel) | Click the hover-capture (cursor) icon in the side panel topbar | Hovering the page shows/stops showing the tooltip immediately, no refresh needed |
| 1.2 | Toggle on/off (floating toolbar) | Same, from the pill's cursor button | Same effect, in sync with the side panel |
| 1.3 | Toolbar action-icon badge | Toggle paused | Chrome toolbar icon shows an "OFF" badge; hover tooltip on the icon itself explains it's paused (not just the badge alone) |
| 1.4 | Right-click "Collect" while paused | Right-click an element while hover-capture is off | Context-menu item relabels itself to say capture is paused (`chrome.contextMenus.update`) — should not silently no-op with zero feedback |
| 1.5 | Restricted page (chrome://, Web Store, etc.) | Navigate to a restricted URL | Toolbar icon shows the restricted/can't-run state; no tooltip appears no matter what's hovered; no console error spam |
| 1.6 | CSP-strict page that blocks content-script injection | Navigate to a page with a strict CSP | Same restricted-state badge — driven by the heartbeat timeout (background waits ~2.5s for a heartbeat ping, marks restricted if none arrives), not just the known-scheme list |
| [!] 1.7 | Right-click "Collect" while on a restricted page | — | Existing known gap per `QA_CHECKLIST.md` — confirm still true or fixed since |

## 2. Hover-capture — targeting & the tooltip

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 2.1 | Hover a solid-color block | Hover a `div` with only a background-color | Tooltip auto-detects type `color`, shows correct hex |
| 2.2 | Hover a heading/paragraph | Hover text | Type `font`, correct family/weight/size/line-height |
| 2.3 | Hover an `<img>` | — | Type `image`, correct dimensions/URL |
| 2.4 | Hover a `<video>` used as a GIF replacement | A site serving an "animated GIF" as an autoplay muted looping `<video>` | Classified as image-type (per the GIF-support work), thumbnail renders correctly everywhere (tooltip, stack preview, Library) |
| 2.5 | Hover a card/button/composite element | Hover something with children, borders, layout | Type `component`, `layoutTree`/layer data captured |
| 2.6 | Background-image with a solid fallback color | An element with both `background-image:url(...)` AND a solid `background-color` fallback | Classified as `image`, not `color` — a real fixed false-positive; regression-check |
| 2.7 | Tooltip near a viewport edge | Hover something flush against the top/bottom/left/right of the visible window | Tooltip repositions/flips instead of clipping off-screen |
| [x] 2.8 | Element that fills almost the entire viewport | Hover a full-bleed hero section | Tooltip doesn't render on top of/obscuring its own anchor — additive fix from this session (`anchorFillsViewport` check in `positionCard`), pins to the corner instead. Re-verify live. |
| 2.9 | `:hover`-reactive element (CSS changes color/background on hover) | Hover an element whose own CSS reacts to `:hover` | **Known limitation, not a bug** — captures the hover-state style, not resting state (documented in `QA_CHECKLIST.md`). Confirm this is still the accepted trade-off, not silently regressed into something worse. |
| 2.10 | Cross-origin `<iframe>` | Hover an embedded iframe from a different origin | "Can't collect from embedded content on a different domain" message, no Collect button offered |
| 2.11 | Element removed/re-rendered between hover and click (SPA) | Hover an element, let the SPA re-render that DOM node away, then click Collect | `el.isConnected` check catches it — "This element changed — try again," not a crash or silently-wrong data |
| 2.12 | Virtualized/infinite-scroll list | Hover an item, scroll before clicking | Same stale-element guard as 2.11 |
| 2.13 | Alt+Enter keyboard path | Tab-focus an element, press Alt+Enter | Opens the same tooltip as a hover would |
| 2.14 | ↑/↓ tree-walk buttons | With the tooltip open, click ↑ to select the parent, ↓ to go back down | Selection widens/narrows correctly; keyboard ArrowUp/Down do the same **only** while the mouse rests over the tooltip card (not globally) |
| 2.15 | Font still loading at capture time | Capture text where the web font hasn't finished loading | `fontMayStillBeLoading` flag set correctly against `document.fonts.status` |
| 2.16 | Same `:hover`-reactive element captured twice | Capture once, capture again | Both captures should be internally consistent with each other (both hover-state, per 2.9's known trade-off) — not one hover-state and one resting-state |

## 3. Hover-capture — oversize & component-tree edge cases

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 3.1 | Oversized component (very large subtree) | Hover a huge container (600+ descendant nodes) | Inline "Capture anyway?" confirm (not native `window.confirm()`), Cancel and Capture-anyway both work |
| 3.2 | Cancel an oversize confirm, then hover something else | — | No leftover state from the cancelled capture leaks into the next one |
| 3.3 | Oversize confirm, then move the mouse elsewhere before deciding | Trigger oversize confirm, hover a different element without clicking Cancel/Capture | Should not silently swap the card away mid-decision (the `isBusy()` reentrancy guard) |
| 3.4 | Session capture stack (multiple captures on one page load) | Capture 4+ items on the same page without navigating away | Tooltip's action row switches to a fanned mini-thumbnail stack + compact "+", capped at the last 4 this page load |
| 3.5 | Click the capture stack itself | — | Opens the side panel |
| [!] 3.6 | `contextThumbnail` generation | — | Deferred per `QA_CHECKLIST.md` (hover-path Collect doesn't have `activeTab` permission) — confirm still deferred/not silently half-built |

## 4. Compare / Font Pairing

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 4.1 | Open Compare view | Click the compare-fonts icon | Heading-font and Body-font dropdowns, live preview card |
| 4.2 | Dropdowns populate from real captured fonts | Have several fonts captured across different sites | Both dropdowns list actual captured heading/body fonts (by family+source), not placeholders |
| 4.3 | Live preview updates | Pick a heading font, then a body font | Preview text re-renders with the real family/weight/size, not a default |
| 4.4 | Save a pairing | Pick both, click "Save this pairing" | Writes a `type:"pairing"` item into a "Pairings" pseudo-folder, correct data shape |
| 4.5 | Empty state (fewer than 1 heading + 1 body font captured) | Very fresh install, nothing captured yet | Sensible empty-state message, not a broken/empty dropdown |
| 4.6 | Re-open a saved pairing | — | Correctly restores the exact fonts that were saved |

## 5. Export

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 5.1 | ZIP export — general | Export any scope (a site folder, a Collection, a multi-select) | Valid archive (round-trips through `JSZip.loadAsync`), manifest per hostname folder |
| 5.2 | ZIP — color item | — | `manifest.txt` line with hex + family |
| 5.3 | ZIP — font/pairing item | — | Manifest line with family/weight/size (or heading+body for a pairing) |
| 5.4 | ZIP — image item, fetch succeeds | — | Real image file written, manifest references it |
| 5.5 | ZIP — image item, fetch fails (CORS-blocked host) | Export an image from a host that blocks cross-origin fetch | Falls back to a "link-only" manifest line, does not break the rest of the export |
| 5.6 | ZIP — component item | — | `.html` (real sanitized `outerHTML`) + a `.jpg` preview screenshot if one exists |
| 5.7 | ZIP — note item | See `NOTES_COLLECTIONS_TEST_CASES.md` §7.10 | Covered there in detail |
| 5.8 | ZIP — mixed scope, one type's fetch fails mid-export | A scope with several images, one of which is CORS-blocked | Only that one item degrades to link-only; every other item in the same export still succeeds fully |
| 5.9 | Figma clipboard bridge (color swatches) | Export colors via the Figma clipboard path | Real OS clipboard write succeeds (paste directly into a Figma canvas as SVG rects) |
| 5.10 | Figma clipboard bridge — no colors in scope | Try it on a scope with zero color items | "No colors in this scope to copy," not a broken empty paste |
| 5.11 | Figma-plugin JSON export (file download) | — | Downloads a `.json` with every item, images/icons inlined as base64 for `image`/`component` types |
| 5.12 | Figma-plugin JSON export — includes notes | Export a scope containing notes via this path | Notes present in the payload (this path is NOT type-filtered, unlike the old ZIP bug) — their raw image URLs won't be inlined (plugin has `networkAccess:none`), confirm that's an acceptable, known limitation rather than a silent break |
| 5.13 | Figma-plugin clipboard export | Same payload, via clipboard instead of file | Clipboard write succeeds; pasting outside the Harvest Figma plugin shows raw JSON (expected) |
| 5.14 | Handoff-sheet PNG | Export a color/font handoff sheet | Correct pixel values sampled from the generated canvas (not a blank/placeholder canvas) |
| 5.15 | Handoff sheet with a real captured image | — | **By design**, does NOT draw real image pixels (a cross-origin image without CORS headers taints the whole canvas) — placeholder block with dimensions instead. Confirm this trade-off is still true and the whole sheet doesn't fail because of it. |
| 5.16 | Export with zero items in scope | Try any export action on an empty scope | "Nothing to export," never a broken/empty file |
| 5.17 | Export interrupted (browser blocks the download) | Simulate a blocked download | Catch + surface a retry option, not a silent failure |

## 6. Floating toolbar (on-page pill)

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 6.1 | Appears/hides correctly | Toggle "Collapse to floating toolbar" from the side panel | See `NOTES_COLLECTIONS_TEST_CASES.md` §12.2 — the race-condition fix, re-verify live |
| 6.2 | Drag to reposition | Drag by the logo/brand handle | Moves smoothly, position persists across a page refresh (`harvestToolbarPos`) |
| 6.3 | Position stays clamped after a browser window resize | Drag the pill near an edge, then shrink the browser window | Should not end up partially off-screen — see §12.3 fix, re-verify specifically after a resize (not just after being hidden/shown) |
| [x] 6.4 | Visual match to the Design System Extractor project's own floating bar | Compare side by side | Corner radius (12px bar / 8px buttons — the literal values, not an approximated token), consistent icon sizing across all buttons, rounded+cover-fit logo. Verified via live screenshot comparison this session after two correction rounds (first pass substituted Harvest's own 20px token instead of the literal 12px — corrected). |
| 6.5 | Close (×) button | Click × | Hides the pill AND pauses hover-capture in one click ("close means close," not two separate steps); persists via storage so it doesn't reappear on refresh |
| 6.6 | Recovery from a closed toolbar | After closing it, look for a way back | "Show the on-page toolbar again" link in the side panel footer — not a dead end |
| 6.7 | Cursor/notes toggle buttons mirror the side panel exactly | Toggle either from the pill | State stays in sync with the side panel in both directions (already covered in Notes §1.3, applies to hover-capture's own toggle too) |
| 6.8 | Toolbar excluded from its own hover-capture | Hover the pill itself while hover-capture is active | Should never trigger the capture tooltip on the toolbar's own UI (`Harvest.ownRoots` registration) |
| 6.9 | Toolbar survives an extension reload while the tab was already open | Reload the extension via chrome://extensions with a tab already open, then interact with the toolbar on that tab | Buttons should fail gracefully with a "Harvest was reloaded — refresh this page" flash (warning icon), not silently do nothing — confirm this still holds after this session's edits touched the same file |

## 7. Side panel chrome & navigation

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 7.1 | Sites tab — per-site item grid | — | Grouped by type (Colors/Fonts/Images/Components), sorted by recency |
| 7.2 | Library "All sites" folder grid | — | Fanned mini-thumbnail cover, favicon badge, hostname, item count/recency |
| 7.3 | Favicon resolution | View the folder grid for a real, previously-visited site | Favicon loads via Chrome's own local favicon cache (not a new network request) |
| 7.4 | Favicon missing/unavailable | A site with no cached favicon | Gracefully hides the badge, doesn't show a broken-image icon |
| 7.5 | Switching tabs auto-follows the active browser tab | Browse to a new site with the panel open | Panel auto-updates to that site's items, unless the user has manually navigated into a specific folder/Collection (`viewMode` state machine should not yank the view away mid-browse) |
| 7.6 | Multi-select across the whole Library (not scoped to one site) | Select mode from the Library-wide view | Selecting/exporting/deleting works the same as a single-site select |
| 7.7 | "Select" button disabled state | View a completely empty grid | Select button is disabled, not a clickable no-op |
| 7.8 | Delete + undo (any single item, any type) | Delete an item, undo from the toast | Item restored fully, including its Collection memberships (see Notes §8.6-equivalent for the general case) |
| 7.9 | Folder (whole-site) delete + undo | Delete an entire site's folder | Batch-deletes every item for that hostname, undo restores the whole folder |
| 7.10 | Two tabs on the same hostname capturing near-simultaneously | Capture from two tabs on the same site at once | Both items persist — relies on the background service worker funneling writes through one transaction per item |

## 8. Security / sanitization (adversarial — mandatory)

Test page already exists: [`test/xss-adversarial.html`](test/xss-adversarial.html).

| # | Case | Expected |
|---|------|----------|
| 8.1 | `<script>` inside a captured component | Stripped from output; re-rendering the sanitized HTML later does not re-execute it |
| 8.2 | Inline event handler (`onclick`, etc.) | Attribute entirely absent from sanitized output (verify via `hasAttribute`, not a naive string search — a past false-alarm here was caused by an unrelated element `id` containing the word "onclick") |
| 8.3 | Password field captured as part of a component | Sanitized output has no `value` attribute at all |
| 8.4 | `javascript:` href anywhere in a captured component | Entire `href` attribute removed, not just neutralized |
| 8.5 | Same `javascript:`/`data:` filtering, but on a **note's** captured links | Covered in `NOTES_COLLECTIONS_TEST_CASES.md` §3.5-3.6 — notes.js has its own independent implementation of this check; confirm both stay consistent with each other |
| 8.6 | PII detection on a hover-captured component's text | Correctly flagged (`containsLikelyPII`) — same detection notes.js reuses for selection text |
| 8.7 | Oversized component correctly flagged | `oversized: true`, correct `nodeCount` |
| 8.8 | Full pipeline: sanitize → background re-sanitize → IndexedDB write → Library render | Not yet verified end-to-end through the *actual loaded extension* in real Chrome (only the sanitize function itself was verified in isolation) — this needs a real run, not just code review |

## 9. Storage & data integrity

| # | Case | Expected |
|---|------|----------|
| 9.1 | Inspect IndexedDB directly (`chrome-extension://<id>` → Application → IndexedDB → `harvest-db`) | Every captured item's shape matches the documented schema — do this for at least one of each type, including a note (schema is newer, not covered by the original phase-1 verification) |
| 9.2 | Reload the extension | Previously captured items still present, nothing lost |
| 9.3 | `findSimilarItem` dedup for every type, not just notes | Color (hex-distance <20), font (family+weight+size), and note (exact text match within hostname) all correctly flag a near-duplicate before save |

---

## How to use this

Same discipline as the companion file: work top to bottom, treat `[x]` as
"verified once, in one session" rather than "permanently safe," and actually
run everything marked `[ ]` before shipping — several of the bugs found this
session (the empty-state DOM leak, the collapse race condition, the silently
truncated notes, the silently dropped ZIP notes) were the kind of thing that
only shows up when you actually click through the real flow, not when
reading the code.
