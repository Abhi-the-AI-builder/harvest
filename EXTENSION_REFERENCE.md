# Harvest — Extension Reference

What the extension actually does today, as implemented — not the original
design intent (that's `SPEC.md`/`PLAN.md`, which predate several features
below), and not a test plan (write your own test cases from this). Every
claim here is grounded in the real source, with file:line-shaped pointers
where it matters. If something below turns out to not match the running
code, the code is right and this doc is stale — flag it.

---

## 1. What it is

A Chrome MV3 extension for a designer doing competitive UI research: hover
any element on any website to capture its color, font, image, or component
structure into a per-site library, or drag-select any text on a page to
capture it as a note. All data storage is local (IndexedDB) with no
telemetry, analytics, or third-party endpoint of any kind — audited this
session (every `fetch`/`XMLHttpRequest`/network-triggering call in the
codebase traced to its call site; see §13's "Network egress" entry for the
one correction that audit produced to this paragraph's original, slightly
overstated wording).

## 2. Architecture

**Contexts** (separate JS execution environments, separate global scope,
communicate only via `chrome.runtime.sendMessage`/`chrome.storage`):

- **Background service worker** — `src/background.js`. Owns the IndexedDB
  writes for messages sent from content scripts, badge/context-menu state,
  restricted-tab tracking, `chrome.tabs.captureVisibleTab` for screenshots,
  HTML re-sanitization on the way into storage.
- **Content scripts** — injected into every `http(s)://` page
  (`manifest.json`'s `content_scripts`, `all_frames: false`, so never inside
  iframes), in this exact load order:
  1. `shared.js` — shared utilities (`Harvest.*` namespace on `window`):
     icons, type-badge color palette, hostname helper, debounce, UUID,
     PII regex, `escapeHtml`, `ownRoots` registry (see below).
  2. `sanitize.js` — `Harvest.sanitizeCaptureElement`, `isJavascriptUri`
     (exported for reuse), strips scripts/handlers/dangerous URIs/password
     values before anything is captured.
  3. `tagger.js` — element-type detection (`color`/`font`/`image`/
     `component`) from computed style, used by the hover-capture path.
  4. `overlay.js` — the hover-capture tooltip: positioning, rendering,
     capture/save flow, session capture stack, sanitized-preview building.
  5. `toolbar.js` — the floating on-page pill (drag, toggles, panel-open,
     close).
  6. `notes.js` — the independent text-selection capture system (own
     shadow root, own state, own storage key).
  7. `content.js` — wires hover/right-click/keyboard triggers to
     `overlay.js`, plus the component-layer-tree extraction
     (`extractComponentLayers`) used when a `component` type is captured.
- **Side panel** — `src/sidepanel/sidepanel.html`/`.js`/`.css`. The full
  Library UI: Sites/Collections/Notes tabs, item grids, export, compare.
- **DB layer** — `src/db/db.js`, an IndexedDB wrapper (`HarvestDB`).
  **Correction to an earlier draft of this doc**: only content scripts are
  fully routed through background (they can't reach IndexedDB directly at
  all, and don't load `db.js`). The side panel is different — `db.js` is
  loaded directly in `sidepanel.html` alongside `sidepanel.js`, and the
  side panel calls `HarvestDB.*` (delete, tag/highlight updates, folder
  delete, etc. — ~28 call sites) directly, in its own document, not via
  `chrome.runtime.sendMessage`. `background.js` imports the same `db.js`
  module separately for the paths that genuinely do need to run in the
  background context (`CAPTURE_ITEM` from a content script, since content
  scripts have no other way to reach it).

**Manifest permissions**: `activeTab`, `tabs`, `storage`, `unlimitedStorage`,
`contextMenus`, `sidePanel`, `favicon`. `host_permissions: <all_urls>`
(needed for the hover-capture content script to run everywhere).
`web_accessible_resources`: `icons/icon48.png` and the bundled Inter font,
exposed to every http/https page (needed for `chrome.runtime.getURL()`
references inside the toolbar/tooltip shadow DOMs).

**Shadow DOM isolation**: every on-page UI surface (hover tooltip, floating
toolbar, notes tooltip) is its own `attachShadow({mode:'open'})` host,
registered into `Harvest.ownRoots` so the other capture systems can
recognize "this click/hover originated inside our own UI" and not treat it
as page content. Each shadow root declares its own `<style>` with its own
copy of the design-token *values* (colors, radii, spacing) — these are
**duplicated by value across files on purpose**, not shared via import,
since each is a separate document with no natural way to share a
stylesheet. If a token changes, it has to change in every file that
declares it (`sidepanel.css`, `overlay.js`, `toolbar.js`, `notes.js` each
carry their own copy).

## 3. Data model

**Item shape** (one row in the `items` IndexedDB store):
```
{
  id: uuid,
  type: "color" | "font" | "image" | "component" | "note" | "pairing",
  family: string,          // a looser semantic label (e.g. "Heading", "Body", "Button")
  hostname: string,
  capturedAt: ISO timestamp,
  sourceUrl: string,
  sourcePageTitle: string,
  selector: string | null, // CSS-ish selector, used for component dedup; null for notes
  note: string,             // personal annotation, separate from a note-type item's own captured text
  tags: string[],           // currently only meaningfully used by notes (NOTE_TAGS)
  data: { ...type-specific fields... }
}
```

**`data` shape per type**:
- `color`: `hex`, `isGradient`, `gradientStops`
- `font`: `family`, `weight`, `sizePx`, `lineHeightPx`, `sampleText`,
  `fallbackStack`, `fontMayStillBeLoading`
- `image`: `url`, `width`, `height`, `isVideo` (true when the "GIF" is
  actually a `<video>` element), `inlineDataUrl` (when available)
- `component`: `outerHTML` (sanitized), `layoutTree` (nested Auto-Layout-
  aware tree, current format — `data.layers` is the old flat-array format,
  still read as a fallback for pre-migration items), `boundingBoxWidth/Height`,
  `previewImage` (a `data:image/jpeg;base64,...` screenshot when captured
  via the context-menu path), `oversized`/`nodeCount`,
  `containsLikelyPII`
- `note`: `text`, `images[]` (≤5 captured `<img src>` URLs), `links[]`
  (≤5 `{href, text}`), `charCount`, `truncated` (bool — text was over the
  4,000-char cap), `headingRanges[]` (character spans of `text` that came
  from an `h1`-`h6`), `colorKey` (a palette key, not a hex — see §6)
- `pairing`: `headingFamily`, `bodyFamily` (+ their own weight/size)

**Collections** are a separate store: `{id, name, createdAt, itemRefs[]}`
where each `itemRef` is `{hostname, itemId}` — **never a copy of the item's
data** (`GROUND_RULES.md`'s stated invariant). Every read of a Collection's
contents (`resolveCollectionItems`) re-fetches the live item by ref, so an
edit to the original item (a new tag, an added annotation) is automatically
reflected everywhere the item is referenced, with no cache-invalidation
logic needed anywhere.

**Dedup** (`findSimilarItem`, checked at capture time before save, in every
capture flow — hover and text-selection alike): scoped to items on the
**same hostname**.
- `color`: another color item whose hex is within a distance of 20 (a
  simple per-channel distance metric, not perceptual/LAB)
- `font`: same family + same weight + size within 1px
- `component`: same CSS selector
- `image`: same `data.url` exactly
- `note`: same `data.text` exactly

A match doesn't block saving — it surfaces as a "already collected,
collecting again adds a duplicate" warning (on the type badge for notes;
equivalent inline messaging for the hover-capture path) and the user can
proceed anyway.

## 4. Hover-capture

**Activation**: `harvestActive` in `chrome.storage.local`, default `false`.
Toggled from the side panel's cursor-icon button, the floating toolbar's
matching button, or `chrome.action` badge state. Mutually exclusive with
notes-capture mode (see §5) — turning one on turns the other off, written
as one atomic storage `.set()` call from whichever surface triggered it, so
no listener can observe an impossible "both on" moment in between.

**Triggering**: mouse hover (with a small `isMovingTowardCard` heuristic so
moving the mouse *toward* the already-open tooltip card doesn't
immediately swap it for whatever's underneath), right-click → "Collect this
element with Harvest" context-menu item, or `Alt+Enter` on a keyboard-
focused element.

**Type detection** (`tagger.js`): computed-style-based heuristics —
`hasUrlBackgroundImage` takes priority over a solid `background-color`
fallback (so a real photo with a dark fallback color classifies as
`image`, not `color` — this was a fixed false-positive), `isImageish`,
`hasDirectText`/`hasMeaningfulText` for font detection, `looksLikeButton`,
falling through to `component` for anything else structural.

**Restricted pages**: `background.js` tracks a `restrictedTabs` set — known
schemes (`chrome://`, the Web Store, etc.) are flagged instantly; anything
else gets a ~2.5s heartbeat window after navigation (the content script
pings on successful init) before being marked restricted if no heartbeat
arrives (covers CSP-blocked injection, which fails silently with no
catchable error from the extension's side). Restricted state shows as a
distinct toolbar-icon badge/title and silently prevents the tooltip from
ever appearing.

**Oversized components — correction, verified live**: this doc previously
said >600 descendant nodes triggers an inline "Capture anyway?" confirm.
That confirm existed at one point (see `QA_CHECKLIST.md`'s own history of
building it) but was deliberately **removed later** — confirmed both by
`overlay.js`'s own comment at the removal site ("No size gate here —
sanitizeCaptureElement always returns the full html regardless of size...
that prompt was pure friction for zero actual protection — removed, a
capture always goes through") and by live testing: hovering and collecting
a real 650-descendant-node element produced the normal tooltip and
collected immediately, no confirm step at all. `sanitize.js` still computes
`oversized`/`nodeCount` (used for the `MAX_HTML_BYTES`-style bookkeeping,
and still returned on the item's data), but nothing reads `oversized` to
gate the UI anymore.

**Session capture stack**: after the first successful capture on a given
page load, the tooltip's action row switches from a plain "+ Collect"
button to a fanned row of up to 4 mini-thumbnails (real swatch/font-
sample/image-thumb/generic-icon nodes, matching the actual last 4 captures
*this page load only* — not full site history) plus a compact "+" fab.
Clicking the stack opens the side panel.

**Known, accepted limitation**: an element with `:hover`-reactive CSS is
captured in its hover state, not resting state, because the cursor is
physically over it while computed style is read. Documented, not fixed
(would need reading style from a detached clone while preserving the live
ancestor chain — nontrivial).

**Positioning** (`positionCard`): tries right of the anchor, then left,
then below/above with viewport clamping; a special case added this session
handles an anchor that fills nearly the whole viewport (a full-bleed hero
section) by pinning to a corner instead of covering its own target.

**Deferred, not built**: `contextThumbnail` generation (needs
`chrome.tabs.captureVisibleTab`, which needs `activeTab`'s user-gesture
grant — only the context-menu path currently qualifies, hover path
doesn't), same-origin shadow-DOM piercing for the page being researched
(cross-origin iframes always show "can't collect," same-origin open shadow
roots are only reachable via native `elementFromPoint` piercing, not
explicitly handled beyond that).

## 5. Text-selection notes

**Activation**: `harvestNotesActive`, own storage key, same toggle pattern
and mutual-exclusivity relationship with `harvestActive` described above.
Default `false`.

**Triggering**: `mouseup` on `document` (skipped if the mouseup target is
inside Harvest's own shadow DOM), plus a 350ms-debounced `selectionchange`
listener (covers keyboard selection — Shift+Arrow, Ctrl/Cmd+A — which
never fires `mouseup`). A `rangesEqual` check (via `Range.compareBoundaryPoints`)
skips re-rendering when the exact same range is already showing, and an
`isInteracting()` guard (checks the shadow root's own `activeElement`, a
folder/color menu being open, or the most recent `mousedown` having
targeted Harvest's own UI) prevents a re-render from clobbering an
in-progress interaction like typing an annotation or using the folder
picker.

**Extraction** (`extractFromSelection` in `notes.js`):
- `text`: `selection.toString().trim()`, **capped at 4,000 characters** —
  `data.truncated` is set `true` when the original was longer, surfaced as
  a visible warning banner in the tooltip (auto-dismisses after 4s) and
  persisted on the saved item (also shown in the `.md` export and in
  clipboard-copy text, so it isn't only a moment-of-capture warning).
- `images`: real `<img>` elements the selection's `Range` actually
  intersects (`range.intersectsNode`), scanned via `querySelectorAll('img')`
  on the range's common ancestor — capped at **5**, checked cheaply enough
  to not hang even on a page with hundreds of total images.
- `links`: same technique for `<a href>`, capped at **5**, each
  `{href, text}` (text truncated to 80 chars). Any `javascript:` href
  (`Harvest.isJavascriptUri`) or non-image `data:` URI is dropped entirely
  before it's ever stored.
- `headingRanges`: character spans of `text` that came from inside an
  `h1`-`h6` on the source page — found by querying headings directly
  first (`querySelectorAll('h1,h2,...')`, a fast native call) and only
  walking text nodes *within* each matched heading, not the whole
  selection subtree. (An earlier version walked the full
  `range.commonAncestorContainer` subtree with a JS-callback
  `TreeWalker`, which could mean traversing thousands of nodes
  synchronously for a selection spanning distant page sections — that was
  a real, reproduced bug: the tooltip would blink and disappear on a large
  multi-section selection. Fixed, and re-verified this session against an
  even larger selection than the original bug report — a full 25-heading,
  4,000+-character page selection — with no blink/disappear.) Used to
  render the heading portion of a captured "heading + body" selection in
  bold in the Library, instead of the whole thing flattening into one
  visual weight.
- PII soft-warning: `Harvest.PII_PATTERN.test(text)` — same shared regex
  the hover-capture path also uses — non-blocking, shown as a banner
  stacked with the truncation banner if both apply.

**Save flow**: builds a `type:"note"` item (see §3's shape), sends
`CAPTURE_ITEM` to background (the same generic handler every capture type
uses — only branches specially for `type==="component"`), then optionally
`ADD_ITEMS_TO_COLLECTION` if a Collection (not "This site," the default)
was chosen in the tooltip's folder picker. A color tag (`colorKey`, a
palette key not a hex — survives a future palette redesign) can be set via
clicking the type badge before saving.

**Dismiss**: selection collapsing (native deselect), a local Escape
listener (two-step if a menu is open: first Escape closes the menu, a
second closes the tooltip; never touches `harvestActive`/`harvestNotesActive`
— that pause-on-Escape semantic belongs only to the hover tooltip), and an
outside-click listener using `composedPath()[0]` (shadow-DOM-safe — a
listener outside a shadow root always sees `e.target` retargeted to the
shadow host otherwise, which was the root cause of a since-fixed "every
click inside the tooltip self-destructs it" bug in the *hover* tooltip;
notes.js was built with this lesson already applied).

## 6. Side panel — Library

**Three tabs**: Sites, Collections, Notes.

- **Sites tab**: per-hostname item grid when a specific site's folder is
  open, or an "all sites" folder grid (fanned mini-thumbnail cover +
  favicon badge + hostname + count/recency) when browsing the whole
  Library. A `viewMode` state machine (`auto-site`/`manual-site`/`library`)
  prevents the view from being yanked back to whatever tab is currently
  active in the browser while the user has manually navigated into a
  specific folder.
- **Collections tab**: grid of Collection cards; opening one shows its
  resolved items, grouped by type. `currentCollectionMode` tracks whether
  a Collection was opened from the Collections tab (`"default"`, shows
  every item type) or from the Notes tab (`"notes"`, filters to only the
  note-type items in that same Collection) — a mixed Collection renders
  differently depending on which tab it was opened from, and this mode is
  re-read on every refresh so delete/undo cycles stay correctly scoped.
- **Notes tab**: every note across every site in one place, grouped by
  capture date (`note-date-group`, collapsible "Today"/other-date
  sections), independent of which site is currently active.

**Item grid** (per site/Collection): grouped into sections by type in a
fixed order — Colors, Fonts, Images, Components, Notes (appended last, not
interleaved, to keep the four original types' order exactly as it always
was). Each section has its own "Download all"/"Copy all" header action.
Notes render via their own `buildNoteTile` (a caption row + excerpt text +
tag chips, not the generic image-hero rich-card layout every other type
uses).

**Note tile specifics**: hover-only action row (download/copy/edit/delete)
lives in normal document flow directly after the tags row, collapsed to
`max-height:0` by default (zero permanent reserved space) and animated
open only on hover/focus — a real fix this session for two earlier bugs
(actions overlapping the always-visible "+Tag" button, then actions
spilling past a short tile's bottom edge into the next tile). Text renders
at 12px, uses the tile's full available width. In-note highlighting:
select a substring of the displayed text, confirm via a small floating
"Highlight" button, stored as character offsets into `data.text`
(`HarvestDB.updateItemHighlights`) — not a duplicated text copy — and
click an existing highlight to remove it.

**Select mode**: multi-select across a grid (site-scoped, Library-wide, or
inside a Collection), feeding into "Add to Collection" (new or existing)
and bulk export/delete.

**Delete + undo**: every delete (single item, whole site folder, whole
Collection) shows an undo toast; undo restores the item/folder/Collection
including Collection memberships (`affectedCollectionIds` tracked at
delete time so undo can re-add the itemRefs, not just resurrect the bare
item).

**Empty states**: 4 separate `hidden`-toggled sections
(`#empty`/`#library-empty`/`#collections-empty`/`#notes-empty`), each with
its own copy and its own composite illustration (a tilted 3-card stack —
skeleton-content styling, not literal captured-looking content — plus the
real 10-card capture-stack preview below it). Each must own exactly one
composite + one stack-fan nested *inside* its own `hidden` wrapper — a real
bug this session had 3 of the 4 sitting outside their wrapper entirely
(permanently visible regardless of tab/empty state), now fixed and
structurally re-verified.

## 7. Collections

Creation happens from two places: the multi-select "Add to Collection" flow
(new-or-existing picker) and the notes-capture tooltip's own folder picker
(same new-or-existing picker, reused). Both call the same
`ADD_ITEMS_TO_COLLECTION` background handler wrapping
`HarvestDB.addItemsToCollection`.

Deletion: a custom confirm modal (never native `confirm()`) whose copy
explicitly states the underlying items are untouched — deleting a
Collection only removes the Collection row and its itemRefs list, never
the items themselves, consistent with the itemRefs-only storage model.
Removing a *single* item from just one Collection (not deleting the item
outright) is a separate, smaller action that only touches that one itemRef.

**Known gap, not user-reachable**: `HarvestDB.renameCollection(id, name)`
exists at the DB layer (`db.js:326`) but is never called from
`sidepanel.js` or `background.js` — there is no rename button/flow wired up
anywhere in the UI. A Collection's name is fixed at creation time.

## 8. Compare / Pairing

Two dropdowns (Heading font, Body font) populated from real fonts already
captured across the whole Library (not placeholders), a live preview card
rendering actual family/weight/size, and a "Save this pairing" button that
writes a `type:"pairing"` item (see §3) into a synthetic "Pairings" folder.

## 9. Export

Five distinct export paths, all reading from a shared `exportContext`
(`{items, scopeKey, scopeLabel}`) set by whichever entry point triggered
the export (a site folder, a Collection, a multi-select):

1. **ZIP** (`performZipExport`) — per-hostname folders inside the zip, a
   `manifest.txt` per folder. Per type: color → manifest line only; font/
   pairing → manifest line; image → best-effort live fetch into a real
   file, falls back to a "link-only" manifest line on fetch failure
   (CORS-blocked host) without breaking the rest of the export; component
   → real sanitized `outerHTML` as `.html` + the JPEG preview screenshot if
   one exists; **note** → a `.md` file (reusing `noteTextBlockFor` — the
   same formatter the single-note download uses) plus best-effort fetches
   of the note's own captured images as real files. The note branch was
   **entirely missing until this session** — notes in an exported scope
   silently contributed nothing while the success toast still claimed the
   full item count. Fixed and added.
2. **Figma-plugin JSON** (`performPluginJsonExport` → `buildPluginJsonPayload`)
   — a downloadable `.json`, every item type included (not type-filtered),
   `image`/`component` types get their referenced images/icons fetched and
   inlined as base64 (the plugin itself runs with `networkAccess: none`, so
   it can't fetch anything at import time) — notes are included but their
   image URLs are *not* inlined by this path (a smaller, lower-priority
   gap than the ZIP one, since the plugin has no note-rendering concept to
   begin with).
3. **Figma-plugin clipboard** (`performPluginClipboardExport`) — identical
   payload, written as plain text via `navigator.clipboard.writeText` for
   the plugin's own "paste from clipboard" button, instead of a file.
4. **Figma color-swatch clipboard** (`performFigmaExport`) — colors only;
   builds a real SVG of swatch rects + hex labels, copies as text so it can
   be pasted directly onto a Figma canvas. "No colors in this scope" if
   none exist.
5. **Handoff-sheet PNG** — a canvas-rendered summary sheet. Deliberately
   does **not** draw real captured image pixels onto the canvas (a
   cross-origin image without CORS headers taints the whole canvas, and
   `canvas.toBlob()` then fails for the entire sheet, not just that one
   image) — uses dimensioned placeholder blocks instead, trading fidelity
   for the export never breaking over one uncooperative image host.

## 10. Copy-to-clipboard

One shared path (`buildRichClipboardItem`, `sidepanel.js`), used by both
the section-header "copy all" button and every individual item's own copy
button (including the single-note copy button, which used to be a much
thinner `writeText`-only implementation before this session — now
identical to the section-copy path, so a single item's copy can never be
less complete than copying it as part of a section).

**Mechanism**: exactly **one** `ClipboardItem` per `navigator.clipboard.write()`
call — Chrome's Async Clipboard API reliably supports a single
`ClipboardItem`, not an array of several (confirmed the hard way earlier
in this project: an array-of-`ClipboardItem`s approach failed identically
regardless of item count). That one `ClipboardItem` carries **two MIME
representations** at once — `text/plain` (a per-item description, joined
with `---` dividers for multi-item copies) and `text/html` (the same
descriptions, HTML-escaped, with up to a global budget of **6 total
images** across the whole copy embedded inline as base64 `data:` URIs).
The image budget is computed **synchronously, up front, in one pass**
before any async fetching starts — checking a shared counter from inside
already-started parallel per-item async work would race, since every
item's work runs synchronously up to its first `await` and would all read
the same pre-decrement budget value. Both MIME payloads are themselves
Promises, so `.write()` fires synchronously (preserving the click's user-
activation window) while the actual image fetching resolves in the
background. The entire synchronous setup (building both promises,
constructing `ClipboardItem`, calling `.write()`) is wrapped in try/catch
— a synchronous throw here (unavailable API, invalid MIME key, a malformed
item) used to escape uncaught and permanently strand the button in a
disabled state with zero feedback; now every failure path, sync or async,
reaches the same reset/error-toast handling.

A target that only reads `text/plain` (Notepad) gets readable text with no
markup; a target that reads `text/html` (Docs, Figma, most rich editors)
gets the same text plus real inline images.

## 11. Floating toolbar

A shadow-DOM pill fixed to the page (draggable by its logo/brand handle,
position persisted via `chrome.storage.local`'s `harvestToolbarPos`,
re-clamped to the current viewport specifically at the moment it becomes
visible — not just once at initial render — since the initial render can
happen while the pill is still `hidden`, where `offsetWidth` reads 0 and a
rough 140px fallback estimate gets used for the clamp instead of the real
width, which could leave the real, wider pill partway off-screen once
later shown; this was a real, reproduced bug this session).

Buttons, left to right: brand/drag-handle, hover-capture toggle, notes
toggle, a divider, open-side-panel, another divider, close (×). Close
pauses hover-capture AND hides the pill in one click, persisted so it
doesn't reappear on refresh (with a "show it again" recovery link in the
side panel footer, so it's never a dead end). The "Collapse to floating
toolbar" action (side panel → this pill) writes
`harvestToolbarDismissed:false` then calls `window.close()` — a real,
fixed bug this session: closing the panel before that async storage write
had actually committed (no callback awaited) could silently drop the
write, matching the exact reported symptom of "the floating toolbar only
shows up after a page refresh." Fixed by waiting for the write's own
callback before closing.

**Visual language**: intentionally matched to the sibling Design System
Extractor project's own floating toolbar — `12px` corner radius on the bar,
`8px` on each button (the literal pixel values from that project's CSS,
not an approximated substitute — an earlier pass tried substituting
Harvest's own 20px design token here and it visibly didn't match, corrected
per direct comparison), every button's icon normalized to one consistent
size via a single `button svg` rule (the four icons — cursor/notes/panel/
close — previously ranged from 10px to 15px despite sharing one 16×16
`viewBox`, throwing off the row's visual rhythm), and the logo given
`object-fit:cover` + an 8px radius instead of a hard-edged square.

## 12. Security / sanitization

`sanitize.js`'s `Harvest.sanitizeCaptureElement` strips `<script>` tags,
every inline event-handler attribute, password field values, and any
`javascript:`/dangerous `data:` URI before a captured component's HTML is
ever stored or rendered back. `background.js`'s `reSanitizeHtml` re-runs
sanitization server-side (well, background-worker-side) on the way into
IndexedDB, not trusting the content script's pass alone. `notes.js`
maintains its own independent, smaller implementation of the same
`javascript:`/`data:` URI check for captured links (`isUnsafeHref`) — not
a shared function with `sanitize.js`, so if one is ever updated the other
needs updating too; worth explicitly re-checking both stay consistent
whenever either changes.

Oversized-component and PII detection are both non-blocking soft signals
(confirm-to-proceed for size, a dismissable warning banner for PII), never
a hard block — the design position throughout is that Harvest should warn
a designer about a copyright/PII-shaped risk in what they're collecting,
not decide for them that they can't collect it.

## 13. Known limitations, deferred items, and open questions

- `:hover`-reactive elements capture their hover state, not resting state
  (§4) — accepted trade-off, documented, not fixed.
- `contextThumbnail` for hover-path captures — deferred, needs a
  `chrome.tabs.captureVisibleTab` call gated on a user gesture the hover
  path doesn't currently have.
- Same-origin shadow-DOM piercing on researched pages — not explicitly
  handled beyond native `elementFromPoint`'s own default piercing.
- `HarvestDB.renameCollection` exists with no UI path to reach it (§7).
- A truncated note (§5) shows the warning at capture time and in every
  export/copy path, but the compact Library tile itself has no persistent
  visual indicator that a given note was truncated — open question, not
  decided either way, whether that's worth its own small badge on the
  tile.
- The side panel document itself cannot be reached by any browser
  automation tooling (confirmed repeatedly across this project) — anything
  side-panel-specific ultimately needs a human's own eyes in real Chrome,
  automation can only reach content-script surfaces (the hover tooltip,
  the notes tooltip, the floating toolbar) on regular pages.
- **Network egress, audited**: every `fetch`/`XMLHttpRequest`/
  network-triggering call in the codebase traced to its call site — all are
  either an explicit user action (download button, ZIP/Figma export,
  clipboard copy fetching an image to embed/inline) or the browser's normal
  behavior of loading an `<img>`/`<video>` `src` to actually display a
  thumbnail of something already captured. No telemetry, analytics, or
  third-party endpoint anywhere. Favicon badges use Chrome's own internal
  `_favicon/` cache endpoint (the declared `favicon` permission), never an
  external favicon service. One correction to this doc's own opening
  paragraph: "nothing leaves the browser except export/copy" slightly
  overstated it — viewing a Library/folder/tooltip thumbnail for an
  `image`/`component` item re-fetches that item's original source URL
  every time it's rendered, not only at export time. Expected and
  necessary (there's no other way to show a preview of something hosted
  elsewhere), just worth being precise about.
- **Two real security bugs found via adversarial testing and fixed this
  session**: `isJavascriptUri` (`sanitize.js`, shared by `notes.js`) and
  `notes.js`'s own `data:` URI check both only matched a URI's scheme
  literally — `href="java\tscript:alert(1)"` (or the same with an embedded
  newline/CR) bypassed both, even though real browsers strip embedded
  ASCII tab/newline/CR from anywhere in a URL during parsing and still
  execute it as the intended scheme (a real, documented XSS filter-bypass
  technique, not theoretical). Both now strip those characters from the
  whole string before checking, verified live against the exact bypass
  strings plus a battery of legitimate URLs (zero false positives).
- **Truncation could corrupt an emoji**: the 4,000-char note-text cap used
  a plain `text.slice()`, which cuts by UTF-16 code unit, not code point —
  a cut landing inside a surrogate pair (most emoji, and other
  astral-plane characters) left a dangling unpaired surrogate, which is
  invalid when later UTF-8-encoded (the `.md` export, clipboard text).
  Fixed with a surrogate-pair-safe truncate that backs off one unit when
  the cut would split a pair; verified live against a constructed
  boundary case.
- **Storage-write races, audited beyond the one already fixed**: searched
  every `chrome.storage.local.set()` call site in `sidepanel.js` (5 total)
  for the same "async write immediately followed by something that could
  tear the document down before the write's own callback fires" pattern
  that caused the collapse-toolbar bug — only the one already-fixed
  collapse handler has that shape; the other four (the three toggle
  writes, plus the one-time "panel is now open" write) are never followed
  by anything that closes/navigates the panel. Also confirmed
  `CAPTURE_ITEM`'s background handler never reads `harvestActive`/
  `harvestNotesActive` at all, so toggling capture mode off can't cancel
  or corrupt an in-flight save (it only affects whether the content script
  decides to start a *new* one). For the general "side panel closes while
  a `HarvestDB.*` call from §2's ~28 direct call sites is in flight"
  question: not the same class of bug as the collapse case, since Chrome's
  own panel-close UI isn't driven synchronously by Harvest's own code the
  way `window.close()` was — the transaction has virtually always already
  been queued with the browser's IndexedDB engine (which continues
  independently of the document) by the time a human actually closes the
  panel. Not proven impossible in the extreme case, but not the same
  reproducible, self-inflicted race — no speculative change made here.
