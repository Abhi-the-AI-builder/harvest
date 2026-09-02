# Acopio — QA Checklist

Status legend: `[x]` verified, `[ ]` not yet verified, `[~]` verified by
static code review only (no live browser run — see note in Phase 1 report).

This file grows every phase (Section 12, rule 7: a bug that reveals a
missed case gets added here, not just silently patched).

## Phases 3–5 + extras (2026-08-25) — all 5 spec phases now built

Built in one pass at the user's explicit request to complete every
remaining phase without stopping in between. Verification here is real
(live browser tests with actual DOM/IndexedDB/JSZip/Canvas/Clipboard, not
just code review) but lighter-touch than earlier phases given the volume —
spot-verified the highest-risk paths, not every single combination.

**Phase 3 — delete/undo, duplicate detection, Collections**
- [x] Item delete: removes from IndexedDB, cleans up every Collection's `itemRefs`, undo toast restores both the item AND its collection membership (verified: note text survived the round trip too).
- [x] Folder delete: batch-deletes every item for a hostname via the same per-item cleanup, custom confirm modal (never native `confirm()`), undo restores the whole folder.
- [x] Collection delete: confirm copy explicitly states items are untouched (Section 7G requirement), verified underlying items survive.
- [x] Multi-select → "Add to Collection": create-new and add-to-existing both verified, itemRefs correct, cross-site mixing works (items store hostname per-ref, no shared-scope assumption anywhere).
- [x] Duplicate detection (color hex-distance <20, font family+weight+size match) wired into the capture flow with its own inline confirm — not live-tested against a real capture yet (only unit-level via `findSimilarItem` logic review), since it requires the full extension loaded in real Chrome.
- [~] "×" delete affordance on folder/collection cards — code-reviewed, not clicked live (multi-select delete-flow was, via `.card-delete-btn` on tiles).

**Phase 4 — Compare/Pairing view**
- [x] Verified live: dropdowns populate from real captured heading/body fonts across the library, live sample renders with actual family/weight/size (not defaults), "Save pairing" writes a `type:"pairing"` item into a "Pairings" pseudo-folder with correct data shape.
- [ ] Not tested: the empty-state message when fewer than one heading + one body font exist.

**Phase 5 — Export**
- [x] ZIP: ​verified with a genuine round-trip (`JSZip.loadAsync` on the generated blob, read back the manifest content) — a real, valid archive, not just "no exception thrown."
- [x] Handoff sheet PNG: verified via direct canvas pixel sampling that a color swatch renders the exact correct RGBA, not a blank canvas.
- [x] Figma clipboard bridge: verified the write succeeded (real OS clipboard-change event observed) — read-back is blocked by normal browser permission (expected, not a bug).
- [x] Cross-origin image fetch failure during ZIP export falls back to a "link-only" manifest line instead of breaking the whole export (code path exists and is reachable; not exercised against a real CORS-blocked image live).
- Deliberate safety choice: the handoff sheet does NOT draw real image pixels onto the canvas — a cross-origin image without CORS headers taints the whole canvas, and `canvas.toBlob()` then fails for the *entire* sheet, not just that image. Placeholder blocks with dimensions are used instead. This trades fidelity for the export never breaking over one uncooperative image host.

**CSP/restricted-page disabled state (Section 8, not part of the original 5 phases' explicit scope but flagged as missing)**
- Implemented via a heartbeat: content.js pings background on successful init; background waits up to 2.5s after each navigation and marks the tab "restricted" (red badge, explanatory title) if no heartbeat arrives, plus instant detection for known-restricted URL schemes (chrome://, the Web Store, etc.).
- [ ] **Not verified live** — this fundamentally requires a real loaded extension navigating real chrome:// pages and CSP-restricted sites, which the sandboxed test harness used throughout this session cannot do (no unpacked-extension loading, confirmed earlier in this project). Code-reviewed only. This is the single highest-priority thing to check first in real Chrome.

**GIF support (user-requested, not in original spec)**
- Static `<img src="*.gif">` already worked via the pre-existing generic image path — no change needed there.
- Real gap fixed: many sites serve "animated GIFs" as an autoplay/muted/loop `<video>` element instead of an actual .gif file. `tagger.js` now recognizes `<video>` as image-type; capture extracts the URL from the element itself or a nested `<source>`; every thumbnail-rendering surface (tooltip preview, session stack, side panel tiles/cards/folder covers) now renders `<video>` instead of `<img>` for these, since an `<img>` tag can't display a video file at all (would show a broken-image glyph).
- [x] Verified live: a `<video><source></video>` element correctly classified as image-type, URL correctly extracted from the nested `<source>` when the video element itself has no direct `src`.
- [ ] Not verified: the actual visual rendering of a video-sourced thumbnail with a real playable video URL (used a fake unreachable URL for the classification/extraction test, which is enough to prove the logic but not the visual playback).

## Phase 1 — capture flow

**Happy path**
- [ ] Hover a heading / color block / image / card on a plain static site → correct type auto-detected, correct data captured, lands in correct hostname's items.
- [ ] "+ Collect" saves immediately, note field appears auto-focused, Enter/blur/2.6s-idle all commit the note.
- [ ] Toast shows "Saved to `<hostname>`".
- [ ] Right-click → "Collect this element with Acopio" opens the same tooltip.
- [ ] Alt+Enter on a Tab-focused element opens the tooltip (keyboard path).
- [ ] ↑/↓ buttons in the tooltip widen/narrow the selection; keyboard ArrowUp/ArrowDown do the same **only while the mouse is resting over the tooltip card**.

**Edge cases**
- [~] Element removed/re-rendered before click → `onCollectClick`/`finalizeCapture` check `el.isConnected` and show "This element changed — try again." — logic present, not exercised against a real SPA yet.
- [ ] `:hover`-reactive element captured twice → identical resting-state data both times.
- [ ] Font still loading at capture time → `fontMayStillBeLoading` flag set correctly (checked against `document.fonts.status`).
- [ ] Virtualized/infinite-scroll list, scroll between hover and click → no stale element saved (relies on the same `isConnected` check).
- [~] CSP-restricted page → Chrome refuses to inject the content script at all; **no explicit disabled-state UI exists yet** — this is a known Phase 1 gap, see report.
- [x] Cross-origin iframe → hovering an `<iframe>` shows "Can't collect from embedded content on a different domain," no Collect button offered. (Code path confirmed by review; not yet hovered on a real iframe-heavy page.)
- [ ] Tooltip near a viewport edge flips/repositions instead of clipping off-screen.

**Adversarial (Section 9/10 — mandatory, not optional)**

Sanitization logic itself verified 2026-08-24 by injecting the actual `shared.js`+`sanitize.js` source into the live `xss-adversarial.html` page (via the Browser pane's `javascript_tool`, not the loaded extension — I don't have a working connection to real Chrome to click through the full extension) and running `Acopio.sanitizeCaptureElement` directly against each adversarial element, then checking the *actual attribute/DOM state* of the output (not string-matching, which gave two false alarms on the first pass — see note below):
- [x] `<script>` stripped from output; rendering the sanitized HTML back via `innerHTML` on a live page does **not** re-execute it (`window.__acopioXssFired` stays `false`) — this is the specific "never executes when viewed later" check Section 10 asks for.
- [x] `onclick` attribute confirmed absent via `hasAttribute('onclick')` on the parsed output (a naive `.includes('onclick')` string check falsely "failed" here because the element's `id="onclick-target"` itself contains the substring "onclick" — worth recording so a future run doesn't get fooled by the same false alarm).
- [x] Password field's value never appears in output — sanitized `<input type="password">` has no `value` attribute at all.
- [x] `javascript:` href: the entire `href` attribute is removed (not just neutralized) — `getAttribute('href')` on the output is `null`. (Same false-alarm pattern as onclick: a naive string check flagged this because the link's own visible label text is literally "Styled link (javascript: href)" — the substring match caught the description, not a real URI.)
- [x] 600-node oversized component correctly flagged (`oversized: true`, `nodeCount: 601`).
- [x] Email/phone-like text correctly flagged (`containsLikelyPII: true`).

**What this does and doesn't prove:** this verifies the sanitization function itself is correct and that sanitized output is inert when rendered back — the actual security-critical claim. It does **not** verify the full extension pipeline (hover → tooltip → click → background re-sanitize → IndexedDB write → eventual Library render), since that needs the unpacked extension loaded in real Chrome, which I can't do from here. The oversize-confirm UI and PII-warning UI (tooltip-side behavior, not the underlying detection) are still `[ ]` unverified for the same reason — the detection logic they'd be built on is now confirmed correct, but the UI wiring around it hasn't been click-tested.

Test page: [`test/xss-adversarial.html`](test/xss-adversarial.html).

**Storage & data integrity**
- [ ] Manually inspect IndexedDB (`chrome-extension://<id>` → Application → IndexedDB → `acopio-db` → `items`) and confirm each captured item's shape matches Section 5.
- [ ] Reload the extension (chrome://extensions → reload) and confirm previously captured items are still present.
- [ ] Two tabs on the same hostname capturing near-simultaneously → both items persist (relies on background service worker funneling all writes through one IndexedDB transaction per item — see PLAN.md assumption #2 for why this is expected to hold, not yet load-tested).

**Bugs found via live testing + deep code trace, fixed this pass**
- [x] Escape didn't close the tooltip on real (React/SPA) sites — the site's own `document`-level Escape handler ran first and swallowed the key before Acopio's listener ever saw it. Fixed by moving Acopio's keydown/click-outside listeners to `window` capture, which always fires before `document`-level listeners regardless of registration order. Also added click-outside-to-dismiss as a second, independent way to close it.
- [x] **Toast leak — likely root cause of "extension won't close, showing everywhere."** `showToast` cleared the removal *timer* on each call but never removed the *previous toast element*, so capturing two items within 2.6s left the first "Saved to X" toast permanently stuck in the shadow DOM. Every capture added another one, all stacked at the same fixed position, never cleaned up. Fixed: each call now removes the previous toast synchronously before showing the new one.
- [x] Double-click on "+ Collect" could fire two `CAPTURE_ITEM` messages for one logical click (no debounce/disable guard existed) → would have silently saved duplicate items. Fixed: button disables + shows "Saving…" for the duration of the request, guarded by an `isSaving` flag.
- [x] Reentrancy hole in the right-click path: the note-field-mid-edit protection only covered the hover trigger, not the context-menu message listener — right-clicking a different element while typing a note hit the same "render() called mid note-commit" race that hover used to have. Fixed by centralizing the guard (`Acopio.overlay.isBusy()`) at the single `openTooltipFor` choke point instead of duplicating checks per trigger.
- [x] Same reentrancy class extended to the new oversize-capture confirmation (see below) — hovering elsewhere while deciding "capture anyway?" would silently swap the card away mid-decision. Same `isBusy()` guard now covers it too.
- [x] Oversized-component confirm used native `window.confirm()` — a blocking dialog that freezes the whole tab's main thread and looks like generic browser chrome, not Acopio's own design (explicitly against the spec's "shouldn't look like a generic dev-tools clone"). Replaced with an inline Cancel / "Capture anyway" state inside the tooltip card itself.
- [x] Async save callback could fire after the tooltip had already been hidden or moved on to a different element (e.g. user pressed Escape mid-save, or a slow IndexedDB write for a large component), then try to manipulate a `cardEl` that no longer existed → would have thrown. Fixed with a `generation` counter bumped on every `render()`/`hide()`; the callback checks it's still current before touching the DOM.
- [x] `chrome.runtime.sendMessage` throws synchronously (not just an async error) if the extension was reloaded while a tab's content script is still the old injected copy — very easy to hit while actively developing (i.e. reloading via chrome://extensions mid-session, exactly what we've been doing). Wrapped in try/catch with a clear "Acopio was reloaded — refresh this page" message instead of a silent failure.
- [x] `navigate()` (↑/↓ tree walk) didn't check whether the newly-selected parent/child was still connected to the DOM — a stale reference on a re-rendering SPA would silently show wrong/empty data instead of erroring. Added the same "This element changed — try again" guard used elsewhere.
- [x] Color-detection false positive: an element with a real photo/gradient `background-image` but a solid `background-color` fallback underneath (very common pattern) was classified as `color` and reported the fallback color's hex (frequently `#000000`) instead of being recognized as the image it visually is. Fixed the priority order in `tagger.js` — a `url()`-based background-image now always routes to the image rule, regardless of what `background-color` happens to also be set.

**New — global active/paused switch (not in original spec, added per user request)**
This is a deliberate departure from Section 2's "no capture-mode toggle" — added because always-on hover across every site was causing real confusion in testing ("how do I just browse normally"). Toggle lives in the side panel; state in `chrome.storage.local` (`acopioActive`, default `true`); toolbar icon shows an "OFF" badge when paused; content scripts subscribe to live storage changes so toggling takes effect on already-open tabs immediately, no page refresh needed. No new permission required (`storage` was already granted).
- [ ] Toggle off in the panel → hover no longer shows the tooltip on the current tab, without refreshing the page.
- [ ] Toggle off → any tooltip currently open closes immediately.
- [ ] Toolbar icon shows "OFF" badge while paused, clears when active.
- [ ] Toggle back on → hover-capture resumes immediately, no refresh needed.
- [ ] Right-click "Collect this element" while paused → currently silently no-ops (no feedback shown). Known gap, not fixed this pass — worth a toast/disabled menu state later if it's confusing in practice.

**New — floating on-page toolbar (not in original spec, user-requested, modeled on the sibling Design System Extractor project's pattern)**
Small pill fixed to the bottom-right of every page: brand dot (drag handle), a toggle button (same `acopioActive` state as the side panel switch, kept in sync both directions), a button to open the side panel, and an X to hide the pill for the current page load (not persisted — reappears on refresh; a permanent per-site dismiss would need a new storage key, deferred until it's clear that's actually wanted). Real SVG icons (a generic cursor/select-tool glyph and a generic sidebar-panel glyph — standard UI iconography, not a copied brand mark) replaced the original unicode glyphs, which were reported as too vague to read. Shadow-DOM isolated like the tooltip, registered in the same `Acopio.ownRoots` list so hovering it never triggers the capture tooltip underneath. Draggable by the brand dot; position persists across reloads via `chrome.storage.local` (`acopioToolbarPos`), clamped to the viewport on restore so it can't end up off-screen.

Verified 2026-08-24 by injecting the actual `shared.js`+`toolbar.js` source into a local test page (served over `http://localhost`, with `chrome.storage`/`chrome.runtime` stubbed to real in-memory behavior — including actually dispatching `onChanged`, which the first stub attempt didn't do and produced a false-negative on the toggle test, caught before reporting) and driving it with real `PointerEvent`s and `.click()`:
- [x] Click toggle → button's own visual state flips (`data-active` true→false) and the correct new value round-trips through `chrome.storage.local.set`.
- [x] Click panel button → sends `{type: "OPEN_SIDE_PANEL"}` via `chrome.runtime.sendMessage`, exactly the message `background.js` listens for.
- [x] Dragging the brand dot by a simulated `pointerdown`→`pointermove`→`pointerup` sequence moves the pill by the exact pixel delta (tested a −300,−400px drag; position landed exactly there), and persists `{left, top}` to storage.
- [x] Reloading with a pre-existing stored position restores the pill at that exact position instead of the bottom-right default.
- [ ] Still not verified: hover-tooltip exclusion (`Acopio.ownRoots`) and the `chrome.sidePanel.open()` gesture-propagation question — both need the real extension in real Chrome, which this test harness (stubbed `chrome.*` APIs, not a loaded extension) can't exercise.

**Design-system consistency fix (2026-08-24)** — the floating toolbar and the side panel started out with two different control languages for the same two toggles: icon buttons in the toolbar, but a text-labeled switch + a separate text button in the panel. Unified both around one icon-button system, with the icon SVGs themselves moved into `shared.js` (`Acopio.ICONS`) so both surfaces render from the literal same source, not just visually-similar duplicates. Verified via the same local-server-injection technique: side panel's active-toggle and density-toggle both confirmed to flip `aria-pressed`, write the correct storage value, and (after correctly waiting for the async `refresh()` to settle — an earlier read-too-early attempt gave a false negative, caught before reporting) apply `grid`/`grid expanded` correctly.

**Critical bug found and fixed (2026-08-24): every click inside the tooltip was self-destructing it**
Root cause: the click-outside-dismiss listener (added earlier for the Escape bug) checked `cardEl.contains(e.target)` from a `window`-level listener — but a listener *outside* a shadow root always sees `e.target` retargeted to the shadow host, per spec, for any event originating inside that shadow tree. So the check was really asking "does cardEl contain the host," which is always false (the host is cardEl's ancestor, not descendant) — meaning `hide()` fired on literally every click inside the tooltip, including "+ Collect" itself, a moment before the button's own handler ran. Symptom matched exactly what was reported: click Collect, tooltip vanishes, nothing saved, no error (the error path itself then threw on the now-null `cardEl`). Fixed using `e.composedPath()[0]` instead of `e.target`, which correctly returns the true innermost element regardless of shadow boundaries.

Reproduced and verified fixed via the local-server injection technique, with real synthetic clicks (not just `.click()` calls) driving the actual `overlay.js`/`content.js`/`tagger.js`/`sanitize.js` source against real DOM elements (a color div, an image, a heading):
- [x] Before the fix: confirmed via browser console the exact `TypeError` this caused (`Cannot read properties of null (reading 'querySelector')` inside `onCollectClick`), matching the reported symptom precisely.
- [x] After the fix: clicking "+ Collect" successfully saves and shows the "Saved to X" toast — no crash, no premature disappearance.
- [x] Second capture onward correctly shows the new stack-preview UI (see below) instead of crashing.

**New — session capture stack (user-requested, in-tooltip, 2026-08-24)**
After the first successful capture on a page, the tooltip's action row switches from the plain wide "+ Collect" button to a fanned stack of mini-thumbnails (reusing the same swatch/font-sample/image-thumbnail/generic-icon logic as the main tooltip body — real DOM nodes, not innerHTML, since thumbnails are built from item data) plus a compact circular "+" button. Capped at the last 4 captures *this page load* (not full site history — that's the side panel's job). Clicking the stack itself opens the side panel (reuses the existing `OPEN_SIDE_PANEL` message) rather than a half-built export/package flow, since Compare/export are later phases.
- [x] Verified live: first capture shows the plain wide button; second hover onward shows "N collected" with correctly fanned thumbnails matching what was actually captured (a blue color swatch, then an image thumbnail).
- [x] `doFinalize`'s button-state handling (disable/re-enable, idle text) updated to handle both the `.collect-btn` and `.collect-fab` variants — the initial version only queried `.collect-btn` and would have silently failed to show "Saving…"/error-recovery once the stack UI took over.
- [ ] Not yet verified: the note field's own behavior once a real user (not this synthetic-click test harness) uses it here — a minor focus-timing quirk showed up in this specific test setup where the note field auto-committed near-instantly instead of staying open, possibly specific to how synthetic clicks in this harness handle focus vs a genuine mouse click in real Chrome. Worth a specific check: does the note field actually stay open and accept typed input in real usage?

**Design pass (2026-08-24): navy theme, real fonts, fixed overflow, redundant title**
- [x] Accent color changed globally from orange (#DE7A2B) to navy (#1D3461) — tooltip, floating toolbar, side panel all migrated, verified zero remaining references via grep.
- [x] Inter font bundled locally (`fonts/Inter-var.woff2`, downloaded directly — real WOFF2 verified via `file`, not fabricated; SIL Open Font License, freely redistributable) and wired into all three surfaces via `@font-face`. Loaded via `chrome.runtime.getURL()` in the two content-script surfaces (needs `web_accessible_resources`, added) and via a plain relative path in the side panel (extension pages can reference their own packaged files directly). Explicitly NOT loaded from Google Fonts at runtime — that would violate the local-only/no-external-network-calls commitment. Verified actually applied via `document.fonts.check('16px Inter')` returning true, not just assumed from no console errors.
- [x] ↑/↓ nav-arrow unicode characters (reported as rendering garbled — "â†'" — in real Chrome) replaced with real SVG chevron icons, sidestepping character-encoding/font-rendering questions entirely.
- [x] Fixed real overflow bug in the stack-preview action row: removed the "N collected" text label (the main contributor — its removal alone recovers ~65-75px) and widened the tooltip card 248px→280px for actual breathing room rather than a bare fit. Verified with real `getBoundingClientRect()` measurements: fab button now sits 24px inside the card's right edge, not bleeding past it as it was.
- [x] Side panel's redundant "Acopio" text label removed from the in-panel topbar — Chrome's own native side-panel title bar already displays the full extension name, so the duplicate text added nothing.
- [x] Empty state (side panel, no items yet) given a small illustrated fan of blank type-badge cards instead of bare text — built from Acopio's own existing C/T/I badge iconography, not copied from the reference product's specific artwork/branding.

**Deferred, flagged explicitly rather than built quietly:** a "Create your collection" button in the empty state was requested alongside the illustration — not added, since Collections (Section 5's data model, Phase 3) don't exist yet. Adding a button with no real functionality behind it would be worse than not having one. Revisit once Collections land.

**End-to-end active/paused signal consistency (2026-08-24)**
The toolbar icon's "OFF" badge looked like a toggle switch but the icon's click behavior is fixed to "open the side panel" — clicking it never toggled anything, and its hover tooltip text never mentioned the paused state at all, so the badge and the tooltip told two disconnected stories. Fixed by making `chrome.action.setTitle()` state-aware (same `updateBadge()` call that sets the badge now also sets accurate tooltip text). Caught the same problem proactively on a second surface while auditing this: the right-click context menu item gave zero feedback when paused — clicking it silently did nothing, since the paused gate in content.js just drops the message. Now relabels itself ("...paused — resume in the panel") via `chrome.contextMenus.update()` in the same state-change handler.
- [ ] Not yet live-verified: hover the toolbar icon while paused and confirm the tooltip text updates; right-click a page while paused and confirm the menu item's label changes.

**Critical bug found and fixed (2026-08-24): `hidden` attribute silently not hiding elements**
`.empty`, `.grid`, `.library-grid` (and similar) set their own `display` value with the same CSS specificity as the browser's default `[hidden]{display:none}` rule — since sidepanel.css loads after the UA stylesheet, the class always won the cascade tie, so `el.hidden = true` stopped actually hiding anything with a `display` rule. This had been silently broken since the very first side-panel build; it only surfaced now because no earlier test had a populated grid on screen at the same time as an empty state to reveal the overlap. Confirmed live in the real extension (user screenshot showed both empty-states rendering simultaneously alongside real items) before fixing. Fix: `[hidden] { display: none !important; }` added once, globally, before any conflicting class rule. Re-verified after the fix with the same test data — single clean view, no overlap.

**New — folder grid / "All sites" library view (2026-08-24, Section 7's originally-specified by-website Library, not built until now)**
Third icon-row button (folder icon) in the side panel toggles between the per-site item view and a grid of every hostname you've collected from — fanned mini-thumbnails as the folder "cover," a favicon badge to identify the site, hostname, and item-count/recency line, matching the spec's original Screenshot-2 reference. Clicking a folder shows that site's items (reusing the existing item-rendering code, just parameterized by hostname instead of always the active tab). A `viewMode` state machine (`auto-site`/`manual-site`/`library`) makes sure browser tab-switching doesn't yank the view away while manually browsing a picked folder or the grid itself — verified this distinction is real via code trace, not yet via an actual tab-switch in real Chrome.
- [x] Verified live with synthetic multi-site data: grid renders, sorted by most-recent capture, correct per-folder counts and thumbnails; clicking a folder correctly switches to that site's item view.
- Favicon uses Chrome's own local favicon cache via the `favicon` permission's `_favicon` endpoint — explicitly NOT a new `https://hostname/favicon.ico` network request to an arbitrary remembered site, which would have broken the local-only commitment. **New permission added (`favicon`) — flagging per Section 13 rule 8.**
- [ ] Not yet verified live: favicon badges actually resolving for real visited sites (test data's fake hostnames couldn't populate Chrome's real favicon cache, so this only confirmed the graceful-degrade-to-hidden path, not the success path).
- [ ] Folder-grid card visual polish (the fanned-card "curve"/depth) flagged by the user as not yet matching the reference's quality — acknowledged, not yet iterated on.

**Also fixed this pass:** the floating toolbar's dismiss (×) button now persists via `chrome.storage.local` instead of resetting on every page refresh (was a real regression — a close button whose effect doesn't survive a refresh isn't a working close button), with a "Show the on-page toolbar again" recovery link in the side panel footer so hiding it doesn't become a dead end with no way back.

**Known limitation — not fixed, documented instead**
- **Resting-state vs `:hover`-state capture (Section 8/10 explicitly calls this out).** Because the cursor is physically over the element while its computed style is read, any `:hover`-triggered CSS (color shift, background change, etc.) is *active* at capture time — so Acopio currently captures the hover state, not the resting state, for any element with hover-reactive CSS. A real fix needs something like reading computed style from a detached clone (which won't match `:hover`) while preserving the live ancestor chain for cascade context — that's a nontrivial piece of engineering, not a one-line fix, so it's being tracked here rather than rushed. Test case: hover the same `:hover`-reactive element twice and compare the captured hex/font values — if this bug is live, both captures will show the *hover* color, not the true resting color.

**Deferred to a later phase (explicitly, not silently)**
- Near-duplicate detection prompt — Phase 3.
- Delete/undo — Phase 3.
- `contextThumbnail` generation — deferred; a plain in-page click on "+ Collect" does not grant the `activeTab` permission needed for `chrome.tabs.captureVisibleTab`, only the context-menu path would qualify. Revisit in Phase 2 when the Library needs real thumbnails — likely needs a different capture technique (e.g. `chrome.tabs.captureVisibleTab` triggered specifically from the context-menu click, with the hover path falling back to no thumbnail).
- `scopedCss` for component captures — currently stored empty; real computed-style scoping needed once Phase 2 has to *render* a captured component back.
- Same-origin Shadow DOM piercing — currently every `<iframe>`-tagged element gets the "can't collect" treatment regardless of same/cross-origin, and open shadow roots on the host page are only reachable via native `elementFromPoint` piercing (not explicitly tested).
- CSP-restricted-page disabled toolbar-icon state — not built yet.
