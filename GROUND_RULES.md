# Acopio — Ground Rules (apply to every future change)

Selective hover-to-collect design-research Chrome extension. Local-only, no backend, Manifest V3, Chromium-only. These are the constraints that survive past v1 — pulled from Sections 9 and 13 of the spec, plus the invariants those sections depend on.

## Never weaken these (Section 9)
- Sanitize captured HTML/CSS twice: at capture (strip `<script>`, inline event handlers, `javascript:` URIs, `<iframe>/<object>/<embed>`) and again at render (sandboxed iframe, no `allow-scripts`, or DOMPurify before any `innerHTML`)
- Same sanitization pass before ZIP export
- Never capture `<input>/<textarea>/<select>` **values** — style only
- Drop `data-*`/ARIA attributes that could carry personal or session data
- Soft-warn (don't silently save) if a capture looks like it contains an email or long digit sequence
- Warn before saving a component capture over ~500 nodes / a few hundred KB
- Permissions stay at `activeTab` + `storage` + `unlimitedStorage` + `contextMenus` — no broader host permissions without explicitly flagging the tradeoff
- No `eval()`/`Function()`/execution of anything derived from page content
- No network calls except to the page currently being browsed — no telemetry, analytics, or third-party calls
- Sanitize folder/collection names before using as ZIP paths (strip `../`, slashes, null bytes)

If a change seems to require loosening any of the above, stop and name the conflict — don't decide it quietly.

## Data model integrity
- Any schema change → bump `schemaVersion` + write a real migration function. Old folders/items/Collections must never silently break.
- Collections store `itemRefs` (`folderHostname` + `itemId`) only — never copy the item. Resolve live on render, never cache stale.
- Folders key on **exact hostname** — `www.` vs bare vs subdomain are separate folders by design, not a bug.
- Deleting an item → clean up every Collection's `itemRefs`; the delete/undo toast must say how many Collections are affected.
- Deleting a Collection → underlying items are untouched. State this explicitly in the confirm dialog copy, not just in docs.
- Writes use atomic IndexedDB transactions, not read-then-write (concurrent tabs on the same site must not clobber each other).

## Scope boundaries — flag, don't quietly build toward these
- No cloud sync, accounts, or team sharing
- No real Figma write-API plugin in v1 — only the SVG-clipboard-bridge "Copy for Figma" for colors/simple shapes. Full component export is a v2 research spike.
- No bulk/full-page auto-scan — selective hover-capture is the whole differentiation
- No AI/LLM auto-tagging or semantic search — deterministic DOM heuristics only (Section 6 priority order)
- Chromium only — no Firefox

## Every change request, automatically (Section 13)
1. Small ask → small, scoped diff. No drive-by refactors, renames, or "cleanup" of unrelated code.
2. Change touches capture, storage, or rendering → re-run the relevant Section 10 tests, adversarial XSS test specifically if HTML storage/display is touched. Report actual results, not "should work."
3. Extend the existing design system (spacing/color/type from Sections 3 & 7) — don't invent new conventions per change.
4. A bug reveals a QA gap → add that case to `QA_CHECKLIST.md` so it's caught automatically going forward.
5. Never add a new permission, external network call, or telemetry without flagging it first — local-only/minimal-permission is a commitment, not a v1 default to relax later.

## Build process (Section 12)
- Start with `PLAN.md`: confirmed understanding, stated assumptions (don't ask to confirm — state and proceed), proposed file structure
- Phases, each a testable checkpoint: (1) capture + storage with Section 9 sanitization built in from day one → (2) Library/folder views, by-website grouping → (3) by-type grouping, auto-tagging, delete/undo, dup detection → (4) Compare/pairing view → (5) Export (ZIP + handoff sheet + Figma clipboard bridge)
- After each phase: report what to manually test, which Section 8 edge cases are handled vs. deferred, and actual results of the relevant Section 10 tests — run them first, report honestly including failures
