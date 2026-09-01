# Notes & Collections — Test Cases (pre-deploy)

Purpose: a flow-by-flow test matrix for the two systems this pass focused on —
text-selection Notes capture, and Collections. Built from a full read of the
actual implementation (`src/content/notes.js`, `src/sidepanel/sidepanel.js`,
`src/db/db.js`, `src/background.js`), not guessed from the UI alone, plus
live adversarial testing in real Chrome this session. Distinct from
`QA_CHECKLIST.md` (that file is a chronological build log across the whole
extension); this one is a standing checklist scoped to these two systems,
meant to be worked through top to bottom before shipping.

Status legend: `[x]` verified live this session, `[ ]` not yet run, `[!]` bug
found — see the note under it for current status.

---

## 1. Notes capture mode — the toggle itself

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 1.1 | Toggle on (side panel) | Open side panel → click the notes-toggle icon in the topbar | Icon shows active state; `harvestNotesActive` becomes `true` in storage |
| 1.2 | Toggle on (floating toolbar) | Collapse to floating toolbar → click the note-icon button | Same effect as 1.1, from the other surface |
| 1.3 | Two surfaces stay in sync | Toggle on in side panel, then open the floating toolbar (or vice versa) | Both surfaces show the same active/inactive state without a page refresh |
| 1.4 | Mutually exclusive with hover-capture | With notes mode ON, click the hover-capture (cursor) toggle | Notes mode turns OFF, hover-capture turns ON — never both on at once (verified by design: both `toolbar.js` and `sidepanel.js` write `{harvestActive:true, harvestNotesActive:false}` in one atomic storage write) |
| 1.5 | Reverse of 1.4 | With hover-capture ON, turn notes mode on | Hover-capture turns off |
| 1.6 | Off by default | Fresh install / never-touched storage | Both capture modes default to `false` — selecting text does nothing until explicitly turned on |
| [x] 1.7 | Toggle persists across reload | Toggle notes mode on, reload the extension, refresh the page | Still on — confirmed live this session |

## 2. Triggering the capture tooltip

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 2.1 | Plain mouse-drag selection | With notes mode on, drag-select a paragraph | Tooltip appears near the selection |
| 2.2 | Keyboard selection (Shift+Arrow) | Click into text, hold Shift+Arrow to extend selection | Tooltip appears (debounced 350ms — `selectionchange` listener, not `mouseup`) |
| 2.3 | Keyboard selection (Ctrl/Cmd+A) | Select-all on a page | Tooltip appears, `data.text` reflects the whole page (subject to the 4,000-char cap — see 3.x) |
| [x] 2.4 | **Extreme case: whole-page selection spanning every heading/section** | Select from the very first visible text node to the very last (25 headings, 4,000+ chars, dozens of images/links in range) on a real, complex page (monday.com homepage) | **Verified live**: tooltip renders correctly, does not blink/disappear, positions near the start of the selection. This is the exact shape of bug that existed before this session (`findHeadingRanges` walking the whole subtree) — confirmed fixed under a selection larger than the original bug report. |
| 2.5 | Deselecting hides it | With the tooltip showing, click elsewhere on the page (collapsing the selection) | Tooltip closes |
| 2.6 | Re-selecting the exact same range | Select some text, then immediately select the identical range again | No-op, no flicker/re-render (`rangesEqual` guard — by design, not a bug) |
| 2.7 | Selecting inside Harvest's own UI | Try to select text inside the tooltip itself (e.g. the folder-picker label) | Should not be treated as a new page selection / should not retrigger capture |
| 2.8 | Selection across an iframe boundary | Select text that starts on the main page and would cross into an embedded iframe | Selection can't actually cross a same-origin-restricted iframe boundary in browsers — confirm this doesn't throw, just naturally stops at the boundary |
| 2.9 | Rapid selection changes | Quickly select A, then before the tooltip settles select B, then C | Only the final selection's tooltip should end up showing — debounce should coalesce, not stack multiple tooltips |
| 2.10 | Selection while a menu is open (folder picker or color picker) | Open the folder-choose menu, then (without closing it) change the page's underlying text selection | Per `isInteracting()` guard: should NOT re-render/wipe the open menu out from under the user |

## 3. Extraction limits & content correctness

| # | Case | Steps | Expected |
|---|------|-------|----------|
| [x] 3.1 | **Text over 4,000 characters** | Select >4,000 characters of real text | **Bug found & fixed this session**: text silently truncated with zero indication. Now: a visible warning banner ("Only the first 4,000 characters were kept...") appears in the tooltip, and the saved item carries `data.truncated: true`, surfaced in the `.md` export and in copy-to-clipboard text. Verified live: banner appears, item saves without error. |
| 3.2 | Text exactly at 4,000 chars | Select exactly 4,000 characters | `truncated` should be `false` (boundary is `>`, not `>=`) |
| 3.3 | More than 5 images in selection range | Select a region spanning >5 `<img>` elements | Only the first 5 are captured (`extractMediaFromRange` caps at 5); should not error or hang even scanning a page with hundreds of images total (verified live: monday.com has 614 `<img>` tags on the page, tooltip still rendered promptly) |
| 3.4 | More than 5 links in selection range | Select a region spanning >5 `<a href>` elements | Only the first 5 captured, same cap logic |
| 3.5 | `javascript:` URI in a captured link | Select text containing a link with `href="javascript:..."` | Link excluded entirely (`Harvest.isJavascriptUri` check) — should never be saved |
| 3.6 | `data:` URI link (non-image) | A link with `href="data:text/html,..."` | Excluded (`isUnsafeHref` rejects all `data:` except `data:image/*`) |
| 3.7 | `data:image/*` inline image | A selection containing an `<img src="data:image/png;base64,...">` | Should be allowed through (inline images are inert) |
| 3.8 | PII-looking text | Select text containing something that matches `Harvest.PII_PATTERN` (email/phone-shaped text) | Warning banner: "This might contain personal info." Non-blocking — Collect still works. |
| 3.9 | Both truncated AND PII in the same selection | Select >4,000 chars that also contains PII-looking text | Both banners should show, stacked (not overlapping) — this is a new interaction added by the 3.1 fix, worth explicit confirmation |
| 3.10 | Heading + body captured together | Select a heading and the paragraph right after it in one drag | `headingRanges` correctly identifies which character span came from the `<h1>`-`<h6>` — rendered bold in the Library later, not flattened into one run-on line (this was Bug #3 from the earlier numbered-bug-list session; already fixed and should not regress) |
| 3.11 | Selection with no headings at all | Select plain body text only | `headingRanges` is empty array, nothing renders bold — no error |
| 3.12 | Empty/whitespace-only selection | Somehow trigger with a selection that's only whitespace | Should not qualify (`selectionQualifies`) — no tooltip |

## 4. Saving a note

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 4.1 | Save to "This site" (default) | Select text, leave folder picker at default, click Collect | Item saved with `hostname` = current site, appears in that site's Library folder AND the Notes tab |
| 4.2 | Save to an existing Collection | Select text, open folder picker, choose an existing Collection, Collect | Item saved AND added to that Collection's `itemRefs` (verify via opening the Collection afterward) |
| 4.3 | Save to a brand-new Collection created inline | Select text, folder picker → "New collection" → type a name, Collect | New Collection created, item filed into it correctly, the newly-created Collection's name is NOT stale (there was a documented past bug here — "an earlier version... re-derived the name from a cache the new folder hadn't been added to yet" — confirm this is genuinely fixed) |
| 4.4 | Set a color tag before saving | Click the type badge, pick a different color, then Collect | Saved item has the chosen color key in its data |
| 4.5 | Duplicate detection | Select and save the exact same text on the same hostname twice | Second attempt shows "already collected, collecting again adds a duplicate" on the badge tooltip; Collect still proceeds if clicked (not blocked) — **verified live this session**: this exact warning appeared correctly on a re-triggered identical selection |
| 4.6 | Save while offline / IndexedDB unavailable (adversarial) | Simulate a DB failure | Should show `showInlineError`, not crash silently, button re-enables (`isSaving` flag reset) |
| 4.7 | Double-click Collect rapidly | Click Collect twice fast | `isSaving` guard should prevent a duplicate save from the double-click itself |
| 4.8 | Save then immediately select new text | After a successful Collect, drag-select something else right away | New tooltip should open cleanly for the new selection, no leftover state from the previous save |

## 5. Dismissing the tooltip

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 5.1 | Escape with no menu open | Tooltip showing, press Escape | Tooltip closes. Must NOT touch `harvestActive`/`harvestNotesActive` (that pause-on-Escape behavior belongs only to the hover tooltip) |
| 5.2 | Escape with a menu open | Folder or color menu open, press Escape | First Escape closes just the menu; a second Escape then closes the whole tooltip (two-step, not one) |
| 5.3 | Click outside | Tooltip showing, click elsewhere on the page (not inside the tooltip) | Tooltip closes |
| 5.4 | Deselect via clicking inside the tooltip's own text field | Click into the annotation/note field, type something | Must NOT be treated as "deselected the page" and auto-close — this was a real documented bug (`document.activeElement` not resolving into shadow DOM) already fixed; regression-check it |

## 6. Library — Notes tab

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 6.1 | Notes grouped by date | Have notes from today and earlier days | Grouped under "Today"/other date labels (`note-date-group`), collapsible sections |
| 6.2 | Heading text renders bold within a note tile | View a note captured with heading+body together | Heading portion renders as `<strong class="note-tile-heading-text">`, not flattened |
| 6.3 | Tag a note | Click "+ Tag" on a note tile, pick one or more tags | Tags appear as chips on the tile, persisted |
| 6.4 | Remove a tag | Open tag picker again, uncheck a tag | Chip disappears, tag removed from `item.tags` |
| 6.5 | Edit personal annotation | Click the edit/pencil action on a note | Can add/change `item.note` (separate field from the captured text) |
| 6.6 | In-note highlighting | Select a substring of a note's own displayed text, confirm highlight | Marked with `<mark>`, persisted via `HarvestDB.updateItemHighlights`, survives a re-render |
| 6.7 | Click-to-remove a highlight | Click an existing highlighted span | Highlight removed (position-indexed logic — verify it removes the *right* highlight when multiple exist on one note) |
| 6.8 | Delete a note (+ undo) | Delete a note tile, then click Undo on the toast | Note restored, including its tags/annotation/highlights |
| 6.9 | Hover-actions don't overlap or leave dead space | Hover a short one-line note tile followed by another tile | Action icons appear inline below the text on hover only, push the next tile down (no permanent reserved space when not hovering, no overlap into the next tile — this was a real bug this session, fixed via `max-height` animation to normal document flow) |
| 6.10 | Note-tile text sizing/wrap | View notes of varying lengths | Text at 12px, uses full available width, doesn't wrap earlier than necessary despite available space |
| [!] 6.11 | Note tile shows truncation | View a note captured via case 3.1 (>4,000 chars) | Should visibly indicate it was truncated somewhere in the tile or its expanded view — **currently only the export/copy text mentions it (see 3.1 fix); the compact tile itself does not show a truncation indicator.** Worth deciding if this needs its own small badge on the tile, or if "only shows up in export" is an acceptable design choice — flagging as an open question, not silently deciding either way. |

## 7. Notes — export & copy

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 7.1 | Download one note (.md) | Click download on a single note tile | `.md` file downloads, contains heading/quote/source/captured-time/tags/my-note/links/images, correctly Markdown-formatted (blockquote per line) |
| [x] 7.2 | Copy one note | Click copy on a single note tile | **Bug found & fixed this session**: previously plain-text-only (`data.text` alone) — dropped images/links/tags/annotation entirely. Now goes through the same rich `ClipboardItem` (text/plain + text/html with inline images) as the section-level copy — verified parity between single-item and section copy. |
| 7.3 | Copy one note → paste into Notepad/plain-text target | Copy a note, paste into a plain-text app | Falls back to the `text/plain` representation — readable text, no broken markup |
| 7.4 | Copy one note → paste into a rich target (Docs, Figma, Notion) | Copy a note with images, paste into a rich editor | Text AND inline images should appear (via the `text/html` representation) |
| 7.5 | Copy/download a note with 0 images/links/tags | A minimal note with just text | Should degrade gracefully — no "undefined" or empty bullet points in the output |
| 7.6 | "Download all notes" (section header) | Click download-all on the Notes section | One combined `.md`/`.txt` file, notes separated by a clear divider |
| 7.7 | "Copy all" on the Notes section | Click copy-all on the Notes section header | One `ClipboardItem`, all notes' text + up to the global image budget (6 total images across the whole copy) embedded |
| [x] 7.8 | Copy-all with more images than the budget | Copy-all a Notes section where multiple notes together have >6 images | Budget computed synchronously up front (no race condition), first N images (by iteration order) included, rest simply omitted — should not error, should not silently drop text either |
| 7.9 | Copy fails (clipboard permission denied / API unavailable) | Simulate `navigator.clipboard` throwing | Button re-enables, user sees a clear error toast — never a permanently-disabled dead button (fixed this session: whole synchronous setup wrapped in try/catch) |
| [x] 7.10 | Note included in a ZIP export | Export a scope (Collection/multi-select) containing at least one note | **Bug found & fixed this session**: notes were silently dropped from ZIP export entirely (no branch existed for `item.type === "note"`), while the success toast still claimed the full item count. Now: each note gets a `.md` file (via the same `noteTextBlockFor`) plus its captured images as real files in the ZIP, and a manifest line. |
| 7.11 | Note's personal annotation (`item.note`) survives every copy/export path | Add an annotation to a note, then: download, copy (single), copy (section), ZIP export | Annotation text present in all four outputs |

## 8. Collections — creation & membership

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 8.1 | Create Collection from multi-select | Select-mode, pick several items across different types, "Add to Collection" → new | New Collection created with exactly those itemRefs |
| 8.2 | Add to an existing Collection from multi-select | Same flow, choose an existing Collection instead | Items appended to that Collection's `itemRefs`, no duplicates if an item is already a member |
| 8.3 | Create Collection from the notes-capture flow | Covered in 4.3 | — |
| 8.4 | A Collection mixing every item type | Build a Collection with a color, a font, an image, a component, and a note | Collection detail view groups by type (`TYPE_SECTION_ORDER`), each section renders with its correct type-specific tile/card — the note specifically uses `buildNoteTile`, not the generic rich-card layout |
| 8.5 | Cross-site Collection | Add items from two different hostnames into one Collection | No hostname-scope assumption breaks — each itemRef carries the item's own real hostname |
| 8.6 | Item deleted from its origin site while still in a Collection | Delete an item that's also a Collection member (real delete, not just remove-from-collection) | Per `GROUND_RULES.md`'s itemRefs-only invariant — confirm what actually happens: does the Collection show a broken/missing tile, or does deleting an item also clean up every Collection's itemRefs referencing it? (Existing QA_CHECKLIST.md phase-3 notes say delete does clean up itemRefs — regression-check this still holds for notes specifically, since notes are newer than that original verification.) |

## 9. Collections — viewing & navigating

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 9.1 | Collections tab list view | Open the Collections tab | Grid of Collection cards, each showing name + item count + some preview |
| 9.2 | Open a Collection from the Collections tab | Click a Collection card | Detail view opens, `currentCollectionMode` set to `"default"` |
| 9.3 | Open the same mixed Collection from the Notes tab (if it surfaces there) | Navigate via Notes tab instead | `currentCollectionMode` set to `"notes"` — detail view should filter to only show the note-type items from that Collection, not the full mixed set (this scoping logic was explicitly verified working correctly for mixed collections earlier this session) |
| 9.4 | Collections empty state | No Collections exist yet | Empty-state illustration + copy shown, scoped correctly to `#collections-empty` only (see 12.1 for the related bug) |
| 9.5 | Select mode inside a Collection detail view | Toggle Select, pick items | Multi-select works the same as the main Library grid |

## 10. Collections — deletion

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 10.1 | Delete a Collection | Click delete on a Collection, confirm | Custom confirm modal (never native `confirm()`), copy explicitly states underlying items are untouched, Collection itself removed, items still exist in their origin site's folder |
| 10.2 | Undo a Collection delete | Delete, then Undo from the toast | Collection restored with its exact original itemRefs |
| 10.3 | Remove a single item from a Collection (not a full item delete) | Inside Collection detail, remove one item from just this Collection | Only the itemRef is removed; the item itself still exists everywhere else it's filed |
| 10.4 | Delete a Collection that contains notes specifically | Delete a mixed Collection with notes in it | Notes survive in the Notes tab / their origin site, exactly like every other type — no note-specific special-case gap |

## 11. Collections — export & copy

| # | Case | Steps | Expected |
|---|------|-------|----------|
| 11.1 | ZIP export of a whole Collection | Export a mixed Collection as ZIP | Every item type present with correct content — **notes now included per the 7.10 fix**, verify this specifically for the Collections export path (not just a bare multi-select) since they share `performZipExport` but confirm the scope-building logic (`exportContext`) is identical for both entry points |
| 11.2 | Figma-plugin JSON export of a Collection | Export via the Figma-plugin JSON path | All items present in the payload (this path was already type-agnostic — confirm notes' raw image URLs don't cause an error even though they aren't inlined for this specific export, since the plugin only inlines image/component types) |
| 11.3 | "Copy all" per type-section inside a Collection | Inside a Collection detail view, copy-all on just the Notes section (if the Collection has ≥1 note) | Same rich-copy behavior as the main Library's Notes section |
| 11.4 | Export an empty Collection | Try to export a Collection with 0 items (if reachable at all) | Should show "Nothing to export," not build an empty/broken ZIP |

## 12. Cross-cutting UI regressions to re-verify (found & fixed this session)

| # | Case | What broke | Fix / re-verify |
|---|------|------------|------------------|
| [x] 12.1 | Empty-state illustration leaking across tabs | 3 of the 4 empty-state composite illustrations were sitting **outside** their `hidden` wrapper in the DOM — permanently visible on every screen (Sites tab, Library grid, Notes tab) regardless of whether that tab was actually empty. Reproduced live via user screenshots showing the illustration stacked under real Pinterest images. | Fixed: all 4 (`#empty`, `#library-empty`, `#collections-empty`, `#notes-empty`) now correctly nest exactly one composite + one stack-fan inside their own `hidden` container. Verified structurally (div balance, each section's open/close boundaries) — **re-verify visually in real Chrome, since side panel can't be screenshotted by any automation tool.** |
| [x] 12.2 | "Collapse to floating toolbar" required a page refresh to actually show the toolbar | `chrome.storage.local.set()` (async) was followed immediately by `window.close()` — a documented Chrome-extension race where tearing down a UI surface before an in-flight storage call's callback fires can silently drop that call. | Fixed: waits for the write's own callback before closing. Needs a live re-check: click Collapse, confirm the floating toolbar appears on the current tab **without** a refresh. |
| [x] 12.3 | Floating toolbar could end up positioned off-screen | `applyStoredPosition()`'s clamp only re-ran once, at initial render — if the pill was `hidden` at that moment, `offsetWidth` read 0 and fell back to a rough 140px guess, producing a clamped position that could sit the real (wider) pill partway off the viewport once later shown. Reproduced live: right edge sat 69px past the actual window edge. | Fixed: re-clamps using the real width/viewport size at the moment the pill actually becomes visible, not just at initial (possibly-hidden) render. Re-verify: collapse to floating toolbar on a narrow/resized window, confirm the whole pill stays on-screen. |
| 12.4 | Floating toolbar corner radius / icon sizing / logo treatment didn't match the sibling Design System Extractor project | Toolbar used a full 999px pill + circular buttons + unrounded, `contain`-fit logo; icons at 4 different inline sizes (10–15px) despite sharing one 16×16 viewBox, throwing off visual rhythm. | Fixed: bar now uses the literal `12px`/button `8px` radius values copied directly from that project's own CSS (not an approximated token substitute — an earlier pass tried substituting Harvest's own `--radius-lg` token and it didn't actually match, corrected per direct feedback), every button's icon normalized to one consistent size, logo given `object-fit: cover` + `border-radius: 8px`. **Needs one more live screenshot check after the latest fix to confirm the 12px value specifically landed correctly.** |

---

## How to use this

Work top to bottom. Anything marked `[x]` was verified live this session
(real Chrome, real DOM/storage, or in one case a fully reproduced extreme
selection against a real 25-heading page) — still worth a spot-check since
"verified once, in one browser session" isn't the same as "verified by you,
on your own machine, right before shipping." Everything else marked `[ ]` is
unverified and should be run for real. Anything marked `[!]` is a flagged
open question, not a bug — a design decision that hasn't been made yet
one way or the other.
