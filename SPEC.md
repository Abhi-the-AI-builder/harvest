# Build: "Acopio" — A Selective Design-Research Chrome Extension

> Working name only — rename freely. Attach the two reference screenshots (tooltip UI and folder grid UI) alongside this prompt when you paste it in. Written descriptions of both are included below as a fallback.

## 1. Who this is for and why

I'm a product designer doing competitive/inspiration research across many websites for a single project (e.g. comparing 8–10 fintech/SaaS homepages). Right now that means switching between 5–6 separate tools (color picker, font identifier, screenshot tool, manual bookmarking) and the connection between "this color came from this site, next to this font, next to this button" gets lost. I want one extension where I can be **selective** — grab only the specific things I actually want, not a bulk scan of everything on the page — and have it land in an **organized, per-site library** automatically, so I can compare across sites later and export what I need.

This is a real project I intend to use daily and potentially ship publicly later. Build it like a real product, not a prototype — but scope the first version tightly (see Section 4).

**Do not ask me to re-explain anything covered in this document.** If something is genuinely ambiguous and blocks progress, state your assumption explicitly in a short "Assumptions" note and keep building rather than stopping to ask.

---

## 2. Core interaction model (this is the heart of the product — get this right)

There is **no separate "capture mode" toggle or on-page badge.** Instead:

1. User hovers over **any element** on any webpage (a heading, a paragraph, a background color, an image, a button, a whole card/section).
2. The element under the cursor gets a subtle outline (dashed border, ~1–2px, in a neutral accent color that stays visible on both light and dark backgrounds).
3. A small floating tooltip/card appears near the cursor (not blocking the element), showing:
   - What kind of element this is (auto-detected — see Section 6)
   - The 2–3 most relevant facts about it (font name + size for text, hex + swatch for color, dimensions for images, a mini thumbnail for components)
   - A primary **"+ Collect"** button
4. Clicking "+ Collect" saves it immediately and shows a tiny inline text field for an optional one-line note, auto-focused, which auto-dismisses after ~2–3 seconds of inactivity or on Enter/blur (saving whatever was typed, empty is fine).
5. A small non-blocking toast confirms the save and names which folder it went to ("Saved to stripe.com").
6. User can keep hovering and collecting multiple things in the same session without any mode switching — it's just how the extension always behaves when active on a tab.
7. Normal browsing (clicking links, typing in forms, scrolling) must **never** be interrupted by this — the outline/tooltip is purely a hover affordance and must not intercept real clicks on interactive elements unless the user explicitly clicks the "+ Collect" button inside the tooltip itself. Design this carefully: use `pointer-events` scoping so only the tooltip itself is clickable, not the underlying page element.
8. Also add a **right-click context menu item** ("Collect this element with Acopio") as a secondary, keyboard/mouse-accessible way to trigger the same tooltip — useful near viewport edges or for accessibility.
9. Support **DOM-tree walking while the tooltip is open**: pressing `↑`/`↓` (or a small "select parent / select child" control in the tooltip) lets the user widen or narrow the selection without re-hovering pixel-perfectly — this matters because the exact leaf node under the cursor often isn't the "component" the user actually wants (e.g. hovering text inside a card should let them step up to select the whole card).

**Critical technical requirement:** the injected tooltip/outline UI must render inside a **Shadow DOM root** with fully scoped styles (its own CSS reset), so it never inherits or leaks styles from the host page, and never gets visually broken by the host page's own CSS. Keep it visually consistent (light theme, clean sans-serif, generous padding, soft shadow) on every website regardless of that site's own design.

---

## 3. Reference UI (describe + attach screenshots)

**Screenshot 1 — capture tooltip reference:**
A white rounded card, appears near the hovered element. Top line shows the CSS-selector-style identifier in monospace (e.g. `h1.homeexp-hero_heading`) — small, gray, useful for power users but not the headline. Below a divider: a small icon badge (rounded square, "T" for typography) next to the font family name in bold. Below that, three metrics in a row, each with a small icon: size (↕), line-height (≡), letter-spacing (↔). Another divider, then "Text color" label with a color swatch square and hex code. Use this as a layout reference for the **text/typography variant** of the tooltip — clean, metric-forward, icon-led. Adapt the same card language for color, image, and component variants (see Section 6), and add our own required elements on top: the "+ Collect" button and optional note field, which this reference doesn't show.

**Screenshot 2 — folder/library reference:**
A grid of rounded cards, each representing one website's folder. Each card shows a fanned/stacked set of thumbnail previews (font sample, a photo, a logo, etc. layered like a hand of cards) as the folder's "cover," the site's favicon in a small circular badge bottom-right, the domain name in bold at the bottom-left, and a metadata line below the card (e.g. "18h ago · 69 images" or "9 pages · 23 images"). A small "×" appears top-right of each card on hover, for quick delete. Use this as the direct reference for the **Library / folder grid view** (Section 7). Note that `razorpay.com` and `accounts.razorpay.com` appear as two separate folders — confirms folders should key on **exact hostname**, not root domain.

Elevate both — don't just clone them. Use a real design system (consistent spacing scale, one accent color, restrained shadows) rather than default browser/Bootstrap styling. This is a design tool built by and for a designer — it needs to look like one.

---

## 4. Scope: build this now (v1) vs. explicitly not now (v2+)

**Build now:**
- Hover-to-collect for 4 element types: **color, font/text, image, component (arbitrary element/div)**
- Auto-creation of one folder per exact website hostname
- Optional note per captured item
- Delete individual items (with undo toast) and delete whole folders (with confirm + undo)
- Duplicate/near-duplicate detection at save time
- Library view: grid of folders (Screenshot 2 style)
- Folder detail view: everything captured from one site
- **Three grouping modes** on the library screen: *by source folder* (automatic, by website), *by element family* (automatic — all headings together, all body text together, all colors together, etc.), and *by Collection* (manual — user-created, cross-cutting groups built by hand-picking items regardless of which site or type they are; see Section 7G)
- **Font pairing compare view**: pick any captured heading font + any captured body font (same-site or cross-site) and render a live sample layout; save a good pairing as a new item
- Export: (a) download any folder or the whole library as a `.zip` with a clear internal folder structure, (b) a generated one-page "handoff sheet" (colors row, heading fonts row, body fonts row, image/component thumbnails) as a shareable image/PDF, formatted according to whichever grouping mode is currently active
- Everything stored **locally only** — no login, no backend, no network calls except to the current webpage being browsed

**Explicitly do not build now (call these out as future phases, don't scope-creep into v1):**
- Any cloud sync, accounts, or team sharing
- A real Figma plugin / write-API integration (Figma has no public "create nodes remotely" API without a companion plugin running inside Figma itself — this is a real technical constraint, not a small task). For v1, ship a **"Copy for Figma"** action that uses the SVG-clipboard-bridge technique (structured SVG on the system clipboard that Figma's native paste recognizes) for colors and simple shapes — this is achievable without a companion plugin. Treat full component-to-Figma-layers export as a v2 research spike, not a v1 commitment.
- Bulk/automatic full-page scanning ("grab everything on this page") — this product is intentionally selective, that's the whole differentiation
- AI/LLM-based auto-tagging or semantic search — use deterministic DOM heuristics only for v1 (see Section 6)
- Non-Chromium browser support (Firefox etc.)

---

## 5. Data model

Design storage around this shape (adapt as needed, but keep the folder-by-hostname + typed-items structure):

```json
{
  "schemaVersion": 1,
  "folders": {
    "stripe.com": {
      "hostname": "stripe.com",
      "favicon": "https://stripe.com/favicon.ico",
      "createdAt": "2026-08-24T10:00:00Z",
      "lastUpdatedAt": "2026-08-24T11:32:00Z",
      "items": [
        {
          "id": "uuid",
          "type": "color | font | image | component",
          "capturedAt": "ISO timestamp",
          "sourceUrl": "https://stripe.com/pricing",
          "sourcePageTitle": "Pricing — Stripe",
          "selector": "h1.homeexp-hero_heading",
          "note": "user's optional one-liner",
          "family": "heading | body | button | color | image | other",
          "contextThumbnail": "base64 or blob ref — small crop around the element",
          "data": {
            "...type-specific fields, see below..."
          }
        }
      ]
    }
  }
}
```

Add a separate top-level structure for manual Collections. Collections **reference** item IDs — they never duplicate or move the underlying item, which still lives in its origin website folder:

```json
{
  "collections": {
    "collectionId": {
      "id": "uuid",
      "name": "Shoe inspiration",
      "createdAt": "ISO timestamp",
      "lastUpdatedAt": "ISO timestamp",
      "itemRefs": [
        { "folderHostname": "nike.com", "itemId": "uuid" },
        { "folderHostname": "allbirds.com", "itemId": "uuid" }
      ]
    }
  }
}
```

When rendering a Collection, resolve each `itemRef` against the live item in its origin folder (don't cache a stale copy) — so if the underlying item's note or data is edited later, the Collection view stays accurate automatically.

Type-specific `data` fields:
- **color**: `{ hex, rgb, alpha, isGradient, gradientStops? }`
- **font**: `{ family, fallbackStack, weight, sizePx, lineHeightPx, letterSpacingPx, source: "google-fonts | custom | system", sampleText }`
- **image**: `{ url, width, height, altText, format, blobIfFetched? }`
- **component**: `{ outerHTML, scopedCss, boundingBoxWidth, boundingBoxHeight }`

Use **IndexedDB** (not just `chrome.storage.local`) for anything containing images/blobs/large HTML, since `chrome.storage.local` has small per-item limits even with `unlimitedStorage`. Use `chrome.storage.local` only for small metadata/settings. Request the `unlimitedStorage` permission in the manifest.

---

## 6. Auto-tagging logic (no manual labeling required)

Determine `type` and `family` automatically from the hovered element, using this priority order:
1. If element or ancestor has a computed `background-color`/`background-image` that's visually dominant and the element has no meaningful text → `type: color`
2. If element is `h1`–`h6` → `type: font, family: heading`
3. If element is `p`, `span`, `li`, or has substantial text content and isn't a heading → `type: font, family: body`
4. If element is `button`, `a` styled as a button (padding + background + border-radius heuristics), or has role="button" → `family: button` (still capture its font AND its color as one combined "button style" item if feasible, or as two linked items — your call, document the choice)
5. If element is `img`, `picture`, `svg`, or has a `background-image` that IS the meaningful content → `type: image`
6. Otherwise, if it's a container with multiple children (card, section, nav) → `type: component, family: other`

Let the user override the auto-detected family with one tap in the tooltip if it's wrong (small pill selector: Heading / Body / Button / Other) — don't make this a required step, just a correction option.

---

## 7. Screens

**A. Content-script overlay** (Section 2) — lives on every page, Shadow DOM isolated.

**B. Extension popup** (click the toolbar icon) — lightweight: shows a "Currently on: stripe.com — 4 items collected" summary and a button to open the full Library. Don't try to cram the whole library into the popup; popups are small and constrained.

**C. Library page** (opens as a full extension tab/page, not the popup — this needs room):
- Top: three-way toggle — **"By website"** / **"By type"** / **"Collections"**
- By website → folder grid exactly per Screenshot 2's layout language
- By type → five sections (Colors, Headings, Body Text, Buttons, Images/Components), each showing items as a horizontal scroll or wrap-grid, with a small source-site tag on each item so provenance is never lost even in this view
- Collections → same card-grid visual language as folders (Screenshot 2 style: stacked thumbnail cover, name, item count, last-updated), but the cards represent user-named Collections instead of websites, and each item inside shows its source-site tag since a Collection can span many sites
- **Multi-select mode**: a "Select" toggle in the toolbar of any of the three views turns on checkboxes on every item card. With one or more items selected, a bottom action bar appears with **"Add to Collection"** (dropdown of existing Collections + "New Collection…") and **"Remove"**. This is the only entry point for building/editing a Collection — keep the hover-capture flow itself free of this decision (see Section 2).
- Search/filter bar (by note text, by site, by hex value, by font name) — works across all three grouping modes
- Empty state: friendly illustration/copy for first-time users with zero folders — a short "hover anything, click Collect" hint, not a blank page. Collections view gets its own empty state too ("Select a few items anywhere in your library and group them here").

**G. Collection detail page**: same layout pattern as folder detail (Section D), scoped to one Collection's `itemRefs`. Supports rename, delete, and reorder (drag to reorder, since Collections are often moodboard-like and sequence can matter). Deleting a Collection **only removes the grouping** — it must never delete the underlying items, which still exist in their origin website folders. State this explicitly in the delete-confirmation copy itself (e.g. "This won't delete the items themselves, only this grouping") so there's no ambiguity for the user in the moment.

**D. Folder detail page**: everything from one site, same by-website/by-type toggle scoped to just that folder, plus folder-level rename/delete/export actions.

**E. Compare / Pairing view**: two dropdowns ("Heading font" / "Body font"), each populated from every font item across the whole library (tagged with source site), rendering a live styled sample ("The quick brown fox..." headline + a paragraph) using the actual captured weights/sizes. A "Save this pairing" button stores it as a new synthetic item (`type: "pairing"`) inside a special "Pairings" pseudo-folder, so invented combinations aren't lost.

**F. Export flow**: from Library, a folder, or a type-group — "Export as ZIP" and "Export as handoff sheet" (image/PDF). ZIP structure should mirror whichever grouping mode was active when exporting.

---

## 8. Edge cases and error handling — go through every one of these

**DOM / capture-time:**
- Element is removed or re-rendered (SPA/React) between hover and click → re-validate the element reference at click time; if stale, show a small inline error in the tooltip ("This element changed — try again") instead of silently saving garbage or crashing.
- Element lives inside a **cross-origin iframe** → content scripts cannot reach into it; detect this and show "Can't collect from embedded content on a different domain" rather than failing silently.
- Element lives inside a **Shadow DOM** on the host page (open shadow roots) → pierce it where possible; closed shadow roots are inherently inaccessible — degrade gracefully, don't error loudly.
- Page has a strict CSP or is a restricted URL (`chrome://`, some banking/finance sites, the Chrome Web Store itself) → extension can't inject at all; detect and show a clear disabled state via the toolbar icon rather than doing nothing with no explanation.
- Fonts not fully loaded yet at hover time (FOIT/FOUC) → wait on `document.fonts.ready` where feasible; if capture happens before that, flag the item with a small "font may still have been loading" note rather than silently recording a fallback font as if it were correct.
- Tooltip would render off-screen (element near viewport edge) → detect available space and flip/reposition the tooltip (above/below, left/right) automatically.

**Data / storage:**
- Two near-identical colors or fonts captured from the same site → detect via a similarity threshold (e.g. hex distance under some tolerance for colors, same family+weight+size for fonts) and prompt "You already have something close — save anyway or skip?"
- Storage quota exceeded → catch the error explicitly, tell the user clearly, and prompt them to export/back up and clear old items rather than failing silently or corrupting existing data.
- Extension updates and the stored data schema changes → always write and check `schemaVersion`; provide a migration function path, never assume old data matches the new shape.
- Same site accessed via `www.` vs bare domain, or via different subdomains → treat as **separate folders by design** (matches the reference screenshot's own behavior) — document this as intentional, not a bug, though a manual "merge folders" action is a reasonable small addition if time allows.
- Two tabs on the same site capturing concurrently → use atomic IndexedDB transactions for writes, not a read-then-write pattern, to avoid one tab's save clobbering another's.

**UX / trust:**
- Deleting a folder is destructive and can represent hours of research → require a confirmation step, and support undo for at least ~10 seconds after deletion.
- Deleting a single item → no confirmation needed (low stakes), but do show an undo toast.
- First-time use → in-context hint on first hover ("Click + Collect to save this"), not a modal tutorial that blocks the page.
- Since storage is local-only, uninstalling the extension or clearing browser data destroys everything with no recovery → surface this clearly once (e.g. in the Library page footer: "Everything here lives only in this browser. Export regularly to back up.") — don't bury it in a settings page nobody visits.
- Keyboard-only users need a path to the same tooltip without a mouse hover — support Tab-focus traversal into collectible elements plus Enter to open the tooltip, and make sure the "+ Collect" button and note field are screen-reader labeled.

**Collections:**
- Deleting an item from its origin folder must also remove it from every Collection referencing it (resolve and clean up `itemRefs` on delete) — and the delete-confirmation/undo toast should mention this if the item belongs to any Collections ("Also removes it from 2 collections"), so the user isn't surprised later by a Collection that silently shrank.
- Deleting a Collection must **never** delete the underlying items — this is a grouping-only action. Make this unmistakable in the confirmation dialog itself, not just in documentation.
- An item can belong to zero, one, or many Collections simultaneously — don't build this as an exclusive "move to folder" pattern; it's additive tagging via multi-select, not filing.
- Renaming a Collection should not affect anything about the underlying items.
- Two Collections with the same name → allow it (they're distinguished by ID internally), but consider a soft warning ("You already have a Collection called this") rather than a hard block, since duplicate names for different moodboard iterations is a legitimate use case.
- Selecting items across a very large library for multi-select should stay performant — don't re-render the entire grid on every checkbox toggle; keep selection state isolated from the rendering of unselected cards.

**Export:**
- Image capture may fail due to CORS when trying to fetch actual bytes cross-origin → best-effort fetch at capture or export time; if it fails, gracefully fall back to storing the image URL + dimensions only, and mark the item as "link-only" in the export rather than silently omitting it or crashing the whole export.
- Zip generation or browser download gets blocked → catch and surface a retry option, don't fail silently.

---

## 9. Guardrails & security — non-negotiable, implement before Phase 1 is "done"

**Sanitize every piece of captured HTML/CSS before it is stored, and again before it is ever rendered back.** A `component` capture's `outerHTML` comes from an arbitrary, untrusted website — treat it as hostile input, not as trusted content, even though the user deliberately chose to capture it:
- Strip `<script>` tags entirely on capture.
- Strip all inline event-handler attributes (`onclick`, `onmouseover`, `onerror`, etc.) and any `javascript:` URIs in `href`/`src`.
- Strip `<iframe>`, `<object>`, `<embed>` from captured markup — a captured "component" should never be able to load or run anything live.
- When rendering a captured component back (Library thumbnail, Compare view, export preview), render it inside a **sandboxed `<iframe>` with `sandbox="allow-same-origin"` only (no `allow-scripts`)**, or through a sanitizer library (e.g. DOMPurify) before any `innerHTML` assignment — never trust that the capture-time sanitization alone is sufficient; sanitize again at render time as a second layer.
- Apply the same sanitization pass before ZIP export, so exported files can't carry a live payload either.

**Never capture sensitive or private data, even accidentally:**
- Explicitly exclude `<input>`, `<textarea>`, `<select>` **values** from any capture — if the user hovers over a form field, capture its visual styling (for a "form field" design reference) but never its current value, since that could be a password, an email, or other personal data mid-session.
- Do not capture `data-*` attributes or ARIA attributes verbatim into stored HTML if they might carry user-specific content (e.g. a logged-in user's name embedded in a data attribute) — capture structural/style attributes (`class`, layout-relevant inline styles) but drop attributes that commonly carry personal or session data.
- If a captured region visually contains what looks like an email address or long digit sequence (lightweight regex check, not a hard guarantee), show a one-time soft warning in the tooltip ("This might contain personal info — capture anyway?") rather than silently saving it.

**Cap what a single capture can contain:**
- If a "component" selection exceeds a reasonable size threshold (e.g. more than ~500 descendant nodes, or the `outerHTML` string exceeds a few hundred KB), warn the user before saving ("This is a large section — capture anyway?") rather than silently storing something close to an entire page and bloating IndexedDB.

**Extension-level permission guardrails** (ties back to Section 9's stack notes, restated here as a security principle, not just a stack choice):
- Minimum necessary permissions only (`activeTab`, `storage`, `unlimitedStorage`, `contextMenus`) — never request broader host permissions than the capture interaction actually needs.
- The content script must never `eval()`, `Function()`, or otherwise execute anything derived from page content.
- The extension must never make network requests to any destination other than the page currently being browsed (for best-effort image fetches) — no telemetry, no analytics pings, no third-party calls, given the local-only privacy promise already made to the user in Section 8.

**Export-time guardrails:**
- Sanitize folder/collection names before using them as file/folder names in the exported ZIP (strip path-traversal characters like `../`, slashes, null bytes) — a website hostname is attacker-controllable in theory (e.g. a subdomain crafted to include odd characters), so never trust it raw as a filesystem path segment.

---

## 10. QA & testing plan — verify, don't assume

Writing correct-looking code for the capture flow, storage, and export is not the same as proving it doesn't break. For each feature area below, test all four categories — **happy path, edge case, error case, and adversarial case** — don't stop at the happy path. Write these as an actual `QA_CHECKLIST.md` in the repo and check items off as you verify them, rather than just asserting things work.

**Capture flow:**
- Happy: hover a heading / a color block / an image / a card on a plain static site → correct type auto-detected, correct data captured, lands in the correct hostname folder.
- Edge: hover an element that visually changes on `:hover` (many buttons/cards do) → captured data must reflect the resting computed style, not a mid-transition frame; test by capturing the same element twice and confirming identical results.
- Edge: capture on a page that's still loading / a font that hasn't finished loading yet → verify the "font may still have been loading" flag from Section 8 actually appears rather than silently recording a wrong fallback font.
- Edge: capture inside a virtualized/infinite-scroll list where DOM nodes get recycled while scrolling → scroll, then hover, then scroll again before clicking Collect — confirm no stale/wrong element gets saved.
- Error: attempt capture on a CSP-restricted page → verify the toolbar icon shows the disabled state and nothing silently fails.
- Error: attempt capture inside a cross-origin iframe → verify the "can't collect from embedded content" message appears instead of a crash or a blank capture.
- **Adversarial (do this — don't skip it):** build a small local test page containing a `<div>` with an embedded `<script>alert('xss')</script>`, a second element with `onclick="alert('xss')"`, and a form with a password field pre-filled with a fake value. Capture all three. Verify: the script never executes when the item is viewed in the Library, Compare view, or an exported/opened handoff sheet; the `onclick` attribute is absent from stored data; the password value is never present anywhere in storage. This is the direct verification of Section 9 — don't consider Section 9 "done" until this test actually passes.
- Adversarial: craft a component selection with a deliberately huge subtree (hundreds of nested nodes) → verify the size-cap warning from Section 9 fires instead of silently storing everything.

**Storage & data integrity:**
- Near-duplicate color/font captured on the same site → confirm the "already have something close" prompt fires.
- Force `chrome.storage`/IndexedDB near its quota (test with a script that pre-fills storage) → confirm the quota-exceeded warning surfaces cleanly rather than corrupting existing folders.
- Manually edit a stored record's `schemaVersion` down by one and reload the extension → confirm the migration path runs and data isn't lost or misread.
- Open the same site in two tabs and capture from both roughly simultaneously → confirm both items end up saved, not one silently overwriting the other.

**Library, grouping, and collections:**
- Verify item counts match exactly across "by website," "by type," and "by Collection" views for the same underlying data — a count mismatch means the grouping logic has a bug.
- Multi-select 15–20 items spanning at least 3 different site-folders and 3 different types, add to a new Collection, confirm all appear correctly with accurate source-site tags.
- Delete an item that belongs to 2 collections → confirm it disappears from both, and the delete confirmation mentioned this before you confirmed.
- Delete a Collection → confirm the underlying items are still fully intact in their original folders afterward.
- Search by hex value, by font name, and by note text → confirm results are correct in all three grouping modes, not just the default one.

**Compare/pairing and export:**
- Pick a heading font from one site and a body font from a different site in the Compare view → confirm the live render uses the actual captured weight/size/line-height, not defaults.
- Export a single folder, the whole library, and a Collection as ZIP → open each and confirm the internal folder structure matches whichever grouping mode was active.
- Force an image capture to fail its CORS fetch (test against a known cross-origin-restricted image) → confirm export falls back to "link-only" for that item instead of breaking the whole export.
- Generate a handoff sheet with at least one missing/failed image → confirm the sheet still renders instead of erroring out entirely.

**Cross-site compatibility — manually test the capture flow against at least one real site from each category, not just one dev-friendly test page:**
- A heavy client-rendered SPA with frequent re-renders (confirms stale-element handling actually works, not just in theory)
- A site using Shadow DOM web components
- A site with strict CSP headers
- A site using custom `@font-face` fonts, one using only system fonts, and one using Google Fonts
- A dark-themed site (confirms the tooltip stays legible and visually consistent regardless of host page)
- A site with several embedded iframes/ads
- A very long single-page/infinite-scroll site
- An image-heavy e-commerce-style page

**Performance:**
- Build a library with 500+ items across 20+ folders and confirm the grid still renders smoothly and multi-select toggling doesn't visibly lag.
- Rapidly hover across many elements in quick succession on a dense page and confirm the tooltip doesn't flicker, lag, or leak event listeners over time (check this with the browser's own performance/memory profiler, not just visually).

**Accessibility:**
- Navigate to a collectible element using only Tab, open its tooltip with Enter, and complete a capture using only the keyboard.
- Confirm the "+ Collect" button and note field have proper labels via a screen reader (VoiceOver or ChromeVox is fine for a spot-check).

**Phase-end smoke test (run this exact short list before declaring any phase in Section 12 "done" and moving to the next):**
1. Capture one of each type (color, font, image, component) on a real, unmodified live website — not just a local test page.
2. Confirm all four appear correctly in their auto-created folder.
3. Refresh the extension/reload the browser and confirm nothing was lost.
4. Run the XSS adversarial test above.
5. Delete one item and confirm the undo toast works.

---

## 11. Technical stack recommendation

- **Manifest V3**, Chrome/Edge/Brave (Chromium-based) only for v1
- Content script: vanilla TypeScript + Shadow DOM for the overlay UI (avoid injecting a full React tree into arbitrary third-party pages unless you're confident about bundle size and isolation — a lightweight approach is safer here)
- Extension pages (Library, Popup): fine to use React/Vite here since these are the extension's own isolated pages, not injected into third-party sites
- Storage: `IndexedDB` for item data/blobs, `chrome.storage.local` for lightweight settings
- Permissions: prefer `activeTab` + `contextMenus` + `storage` + `unlimitedStorage` over broad `<all_urls>` host permissions if at all possible, to keep the permission footprint minimal and Web-Store-review-friendly — only fall back to broader host permissions if `activeTab` genuinely can't support the always-available hover affordance, and explain that tradeoff if you hit it
- Zip export: JSZip
- No backend, no external API calls except to whatever page the user is actively browsing

---

## 12. How I want you to work

1. First, write a short `PLAN.md`: confirm your understanding of the phases below, flag any assumptions you're making (don't ask me to confirm them — just state them and proceed), and propose a folder/file structure for the extension project.
2. Build in this order, and treat each as a checkpoint you can manually test before moving on:
   - Phase 1: capture interaction (hover, tooltip, collect, note field) + local storage, no library UI yet — just confirm data is being saved correctly. **Build the Section 9 sanitization rules into the capture pipeline from this phase onward — do not store raw, unsanitized `outerHTML` "for now" and plan to fix it later; that's how this class of bug ships.**
   - Phase 2: Library page, folder grid view, folder detail view, by-website grouping
   - Phase 3: by-type grouping toggle, auto-tagging logic, delete/undo, duplicate detection
   - Phase 4: Compare/pairing view
   - Phase 5: Export (ZIP + handoff sheet + Figma-clipboard-bridge for colors)
3. After each phase, tell me what to manually test in the browser and what edge cases from Section 8 you've handled vs. deferred — run the relevant portion of the Section 10 test matrix yourself first (including the adversarial XSS test once capture/storage exist), and report the results honestly, including anything that failed or that you deferred.
4. Keep the UI distinctive and intentional — this is a tool for a designer, it should not look like a generic dev-tools clone. Reference the two screenshots for tone (clean, light, precise, icon-led) but make your own layout and spacing decisions rather than copying pixel-for-pixel.

---

## 13. Ground rules for every change request after this initial build

I will keep coming back with bug reports, tweaks, and new feature requests long after v1 ships. Apply these automatically, every time, without me repeating them:

1. **Never weaken a Section 9 guardrail to make a change easier.** If a request seems to require loosening sanitization, widening permissions, or storing captured HTML unsanitized "just for this one feature," stop and name the conflict explicitly instead of quietly doing it. Tell me the tradeoff and let me decide — don't decide for me.

2. **Preserve existing data and schema compatibility.** Any change touching Section 5's data model needs a real migration path (bump `schemaVersion`, write a migration function). Never assume it's fine to just change the shape and let existing folders, collections, or items silently break.

3. **Small requests get small, scoped changes.** If I ask you to fix one button or adjust one field, don't treat it as license to refactor unrelated code, rename things, or "clean up" nearby files unless I asked for that. Match the size of the fix to the size of the ask.

4. **Don't quietly rebuild toward the Section 4 "not now" list.** If a request nudges toward cloud sync, accounts, or a backend — even if it would make that one request easier — point that out explicitly rather than building it in without flagging it.

5. **Re-run the relevant Section 10 tests after any change touching capture, storage, or rendering** — run the adversarial XSS test specifically if the change touches how captured HTML is stored or displayed anywhere. Tell me you ran it and what the result was, not just that the change "should work."

6. **Extend the existing design system, don't start a new one.** New UI should reuse the spacing, color, and typography decisions already established (Sections 3 and 7), not introduce its own conventions per change.

7. **If a bug reveals a case the QA checklist missed, add it to `QA_CHECKLIST.md`** so that failure mode gets caught automatically going forward, not just patched once and forgotten.

8. **Never add a new permission, a new external network call, or any telemetry without telling me first.** The local-only, minimal-permission design in Sections 8 and 9 is a commitment I'm relying on, not just a v1 default you can quietly relax later.
