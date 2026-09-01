# Design Standards — read and apply this before touching any UI, every single time

This file is permanent project memory. It applies to the initial build **and every change request after it**, without me repeating it. If you're about to write or edit any component, page, popup, or styling in this project, run the process below first — every time, not just once.

The core problem this file exists to prevent: producing UI that is functionally correct but looks like a generic template — default spacing, default blue buttons, default shadows, no point of view. "Make it look nice" is not specific enough for you to self-check against, so don't work from that. Work from the concrete rules below instead.

---

## 0. The process — do not skip steps or compress them

1. **Plan first, in writing, before any component code.** Produce a short design-token plan (Section 2) specific to this exact screen/feature.
2. **Critique your own plan against the three clichés in Section 6, and against the quality bar in Section 3,** before building. If it matches one of the clichés, revise it and note what you changed. If it falls short of the Section 3 bar — looks like a basic dev tool rather than something CRED/Stable Money/Navi's design teams would ship — go back and raise it before writing code, not after. **Also check your plan against Section 5's anti-flat checklist before writing any code — if you can already tell it'll fail one of those bullets, redesign now, not after building.**
3. **Build.**
4. **Verify with real evidence, not self-assessment** (Section 9) — actual screenshots, actual measurements, not "this should look good."
5. **Score yourself against the checklist in Section 8, honestly, item by item.**
6. **Iterate at least once based on that scoring before showing me anything.** First-pass output is not final output.

Do all of this in your own working/thinking process — don't narrate it to me step by step. Only show me the result once you'd actually stand behind it.

---

## 1. If I give you a reference image or screenshot

Reference images live in `reference-images/` in this same project — read them directly from disk (`reference-images/01-tooltip-ui-reference.png` through `10-onboarding-progress-nudge.png`) rather than waiting for them to be pasted again.

Do not eyeball it and approximate. Extract literal values before writing any component code:
- Every distinct color as a hex value (background, text, borders, accents)
- Every spacing gap you can measure (padding, margins, gaps between elements) — round to the nearest value in the spacing scale below, don't invent a new number
- Font sizes, weights, and line-heights for each distinct text role (heading, body, label, caption)
- Corner radius values
- Shadow characteristics (how soft, how dark, how far offset — or absence of shadow)
- Icon style (outline vs. filled, stroke width, corner treatment)

Write these into an actual `design-tokens.md` or `tokens.css` in the repo before writing component code. If a reference image conflicts with the default scales in Section 2, the reference image wins — update the scale to match it, don't average the two.

---

## 2. Design token system — use real numbers, not vibes

**Spacing scale (4px base unit):** 4, 8, 12, 16, 24, 32, 48, 64, 96. Every margin, padding, and gap in the project must be one of these values. If you find yourself writing `13px` or `17px` because it "looked right," stop — round to the nearest scale value and check that it still looks right; usually it does, and now it's consistent with everything else.

**Type scale (modular, ~1.25 ratio from a 16px base):** 12 / 14 / 16 / 20 / 25 / 31 / 39px. Assign each a clear role (caption, body, body-emphasis, subheading, heading, display) and use each role consistently — don't pick a one-off size for a single element.

**Color system:** 4–6 named colors total, each with a stated job:
- 1 primary background
- 1 surface/card color (usually background + a subtle step, not pure white on off-white or vice versa without reason)
- 1 primary text color, 1 secondary/muted text color
- 1 accent (used sparingly — for the one or two things that should draw the eye, not every button/link/icon)
- Optionally 1 semantic color group for success/error/warning if the product needs it

Don't add a color that isn't in this list. If something needs a new color, that's a decision — make it deliberately and add it to this system, don't drop in an arbitrary hex value inline.

**Radius scale:** pick 2 values total (e.g. 8px for small elements like buttons/inputs, 16px for cards/panels) and use only those two, consistently, everywhere. Mixing 4px, 6px, 8px, 12px radii across a UI reads as sloppy even if no single instance looks wrong.

**Shadow/elevation:** define 2–3 levels max (e.g. `resting`, `raised`, `overlay`) as named values, each with a specific blur/spread/opacity — don't write a fresh `box-shadow` value per component.

**Motion:** if you use animation/transition, define timing once (e.g. 150ms ease-out for hover states, 250ms for panel transitions) and reuse it — inconsistent timing across a UI feels cheap even when each individual animation is fine.

---

## 3. Quality-bar reference: CRED, Stable Money, Navi

These are the products I'm calibrating quality against — not because this is a fintech tool, but because they represent the ceiling of Indian consumer-app design polish, and I want this extension held to that bar, not to "decent Chrome extension" standards. Don't literally reskin any of them — this is a design-research tool for a designer, not a finance app — but inherit the specific disciplines each one is known for:

- **From CRED — obsessive execution over restraint.** CRED's reputation isn't its color palette, it's that every tap, transition, and micro-interaction is deliberately choreographed (their own design leadership has said this directly — small moments of delight, engineered on purpose, not left as defaults). It uses hard-edged, high-contrast, confidently geometric UI (their public neoPOP design language: bold flat color blocks, crisp offset shadows rather than soft blurry ones, thick deliberate borders) against a premium dark foundation, with information delivered in tight, uncluttered chunks — never more than what's needed on screen at once. **Apply this as:** design the hover-capture tooltip and the "+ Collect" confirmation as the one moment in this product that gets CRED-level micro-interaction attention — a deliberate, satisfying transition on save, not a default browser toast. Keep every other screen disciplined and uncluttered rather than spreading that energy thin.
- **From Stable Money — clarity-first trust, one accent against a clean base.** Stable Money deliberately stayed light-mode-only in a category full of dark-mode fintech apps, keeping the base UI clean and neutral, and spending its personality on one confident accent (purple/neon) used sparingly rather than throughout — plus small gamified moments layered onto what is fundamentally a data-heavy, trust-critical interface. **Apply this as:** the Library grid (colors, fonts, folders) is data-dense the same way a deposit/investment dashboard is — resist the urge to decorate it; keep the base neutral and let one accent color do the pointing (primary buttons, active states, the collect confirmation) rather than color competing for attention across the screen.
- **From Navi — radical simplicity, mass-legible over clever.** Navi's whole positioning is reducing financial complexity to the fewest possible steps and the plainest possible language, with generous whitespace and big, unambiguous typography rather than dense information-forward layouts. **Apply this as:** the capture flow (hover → tooltip → collect → optional note) should read as obviously simple even to someone seeing it for the first time — no onboarding tour required to understand what a button does.

One honest caveat: exact hex values, spacing, and current-version typography for these three apps aren't something I can verify precisely from here, and all three update their UI over time. If you want pixel-accurate tokens from any of them specifically, extract those the same way described in Section 1 — from a real screenshot of the current app, not from a general impression of the brand.

---

## 4. Concrete component patterns — this is literally what "not flat" looks like

I gave you 8 reference screenshots, included in `reference-images/03-stacked-account-cards.png` through `10-onboarding-progress-nudge.png` — read them directly from disk, they don't need to be re-attached. In order: a crypto exchange asset panel (`03`), a team-management dashboard (`04`), an insurance summary card (`05`), an event-invite modal (`06`), a personal portfolio site (`07`), a scattered-app-collage hero (`08`), an email compose modal (`09`), and an onboarding progress nudge (`10`). What they share is **depth, hierarchy, and restraint used deliberately** — not flat rectangles with text in them. Below is what to extract from each and exactly where to apply it in this extension. Treat this section as literally as Section 2's number scales — these are specific patterns to build, not moodboard inspiration to vaguely gesture at.

**Pattern 1 — Label-above-value hierarchy** (`03`, `04`, `05`, `10`). A small, muted, uppercase-or-sentence-case caption sits above a large, bold, high-contrast value. Never put a label and its value at the same size/weight. **Apply to:** every stat in this extension — item counts on folder cards, the count in a Collection card, metrics in the font-detail tooltip (size/line-height/letter-spacing) should read as small caption + bold value, not as one flat line of text.

**Pattern 2 — Layered/offset stacked cards for grouped accounts or categories** (`03`). The crypto asset panel shows a "Funding" card and "Unified Trading" card layered with an intentional offset, each peeking out from behind the next, with a floating summary panel on top. **Apply to:** the Library folder-card cover — instead of a flat grid of thumbnails, layer 2–3 captured item previews with a slight offset and rotation, so a folder reads as a stack of things you collected, not a static collage. This directly matches what Screenshot 2 from earlier was already gesturing at — this reference makes the exact depth/offset technique explicit.

**Pattern 3 — Soft pastel icon badges for categorization, not plain text or monochrome icons** (`04`, `09`). Both the dashboard and the email compose view use a colored, rounded-square badge behind each icon (light blue, yellow, purple; red/orange/green by file type) rather than a plain gray icon. **Apply to:** the four capture types (color/font/image/component) — give each its own soft pastel badge color, used consistently everywhere that type appears (tooltip, library card, family-view section header) so a type is recognizable by color at a glance, the same way file types are in the email reference.

**Pattern 4 — Chip/token inputs with avatars or swatches, not plain text lists** (`09`). The email compose view shows recipients as removable chips (avatar + name + ✕) inside a bordered field, not a comma-separated text list. **Apply to:** the multi-select-to-Collection flow — selected items should appear as removable chips (small thumbnail/swatch + short label + ✕) in the "add to collection" bar, not a plain counter like "4 selected."

**Pattern 5 — Avatar/item stacking with an overflow count** (`04`). The dashboard shows a stack of overlapping avatars plus a "+23" badge rather than listing every one. **Apply to:** folder cards and collection cards showing "+N" when more items exist than can be previewed in the stacked cover (Pattern 2) — don't just show a flat count in text, show a few real overlapping previews plus the overflow number.

**Pattern 6 — Segmented/tick-mark progress, not just a plain filled bar** (`10`). The onboarding nudge uses a row of small colored ticks (filled red-to-orange gradient for progress, gray for remaining) instead of one continuous bar — it reads as discrete steps, which is more honest and more visually distinctive than a plain progress bar. **Apply to:** anywhere this extension shows "how much of a research session is captured" or multi-step states (if you build one) — prefer the tick pattern over a plain bar where the underlying thing is genuinely made of discrete steps/items.

**Pattern 7 — Split-button primary actions** (`09`). The email compose view's "Send email" button has an attached dropdown chevron for related options, rather than a separate second button crammed alongside it. **Apply to:** the Export action — "Export as ZIP" as the main button label with an attached chevron revealing "Export as handoff sheet" / "Copy for Figma" as related options, instead of three separate competing buttons.

**Pattern 8 — Status microcopy near actions, specific to the verb used** (`09`). The email view shows "Draft saved" quietly next to the toolbar — small, muted, present-tense, not a generic "Success!" toast. **Apply to:** the collect confirmation — reuse the exact verb from the button ("Collected" after clicking "+ Collect"), matching the writing standard already in Section 10, but now specifically styled as quiet inline microcopy near where the action happened, not a loud centered toast.

**Pattern 9 — Clear primary/secondary/tertiary button hierarchy within one row** (`03`). The crypto panel's action row has one filled accent-colored button (Deposit), one filled dark/neutral button (Withdraw), and two icon-only tertiary buttons (swap, history) — four actions, four distinct visual weights, no ambiguity about which one matters most. **Apply to:** the folder-detail and Library toolbars — the primary action (Collect, or Export) gets the accent fill; secondary actions (rename, view mode toggle) get a dark/neutral fill or outline; tertiary utility actions (settings, help) are icon-only.

**Pattern 10 — Eyebrow/category tag pills with tinted background and matching text color** (`05`). The insurance card's "ADD-ONS" label sits in a small light-blue pill with blue text, not plain gray caps text. **Apply to:** the `family` labels (Heading/Body/Button/Image/Component) wherever they appear as a tag on an item card — tinted pill, not plain text, and the tint should match that family's badge color from Pattern 3.

**Pattern 11 — One small decorative/personality touch per card, not zero and not many** (`05`). The insurance card has exactly one emoji accent placed at the corner, nothing else decorative on the card. **Apply to:** consider one small, restrained personality touch on the Collection cards specifically (since those are the user's own curated, personal groupings, unlike the automatic site-folders) — e.g. a tiny stack/pin icon distinguishing them, as already specified in Section 7 of the build prompt. Don't add decorative touches to the automatic folder/type views — restraint there matches Pattern 9's "one thing gets to stand out" principle.

**Pattern 12 — Nested card-in-card with a gradient hero band for confirmation moments** (`06`). The invite-created modal puts a gradient banner containing a preview card at the top, then a plain white section with the confirmation message and CTA below. **Apply to:** the compare/pairing "save this pairing" confirmation, or a first-successful-export moment — a small gradient or tinted hero region showing what was just created, above the plain confirmation text and action, rather than plain text alone.

**Numbers get real typographic weight everywhere.** Across almost every reference, numbers (balances, percentages, counts, stats) are set noticeably larger and bolder than surrounding text — never the same size as a caption. Apply this globally: any count, hex value, font size, or metric shown anywhere in this UI should visually announce itself, not blend into body text.

---

## 5. Anti-flat checklist — if any of these are true, the UI is flat and isn't done

- Every card/panel has zero shadow, or a shadow so faint it doesn't read as elevation
- Corner radius anywhere is under 8px (none of the 8 references use a sharp or barely-rounded corner)
- A stat/count/number is the same size and weight as the label describing it
- Icons are plain, unbadged, and the same neutral color everywhere — no soft tinted badges distinguishing categories
- Every button in a toolbar/action row looks the same weight — no visual distinction between the primary action and everything else
- A list of selected/tagged items is shown as plain text or a bare counter instead of chips/avatars/swatches
- A "folder" or "group" preview shows a flat grid of thumbnails with no layering, offset, or depth
- Confirmation/success moments are a single plain sentence with no visual moment at all
- The whole screen is one flat shade of white or gray with no soft tint anywhere to create depth or grouping

---

## 6. Three AI-generated defaults to actively avoid unless I explicitly ask for one of them

Language models (including you) default toward one of these three looks regardless of what the product actually is. Notice if you're drifting toward one and make a different, deliberate choice instead:

1. Warm cream background (near `#F4F1EA`) + high-contrast serif display + a terracotta/warm-clay accent (near `#D97757`).
2. Near-black background + a single bright acid-green or vermilion accent.
3. Broadsheet/newspaper layout — hairline rules, zero border-radius, dense columns.

None of these are wrong in principle, but if you land on one without a specific reason tied to this product (a design-research tool for a designer doing competitive UI research), you've defaulted rather than decided. Pick something because it fits a hover-to-collect, per-website research tool for a professional designer — not because it's the safe answer.

---

## 7. Anti-pattern checklist — if you catch yourself doing any of these, stop and fix it before moving on

- Default browser blue for links/focus states, unchanged
- Buttons that are just a colored rectangle with centered text and no other consideration (padding, weight, states)
- Every card using the identical generic drop shadow with no variation in importance
- Random spacing values that aren't on the scale in Section 2
- All-caps text used decoratively rather than for a specific label/eyebrow role
- More than one accent color competing for attention on the same screen
- Centering everything by default instead of using alignment deliberately
- Icons mixed from different visual styles (some outline, some filled, different stroke widths) in the same view
- Low-contrast gray-on-gray text that fails basic legibility
- Text or components with no distinguishable hover/focus/active/empty/error state — only ever a single "happy path" state was designed
- A tooltip, card, or panel that visually clashes with or gets lost against arbitrary host-page backgrounds (this project specifically injects UI into other people's websites — verify legibility against both light and dark host pages, not just your own test page)

---

## 8. Self-critique checklist — score honestly against every line before showing me anything

- [ ] Every spacing value used is from the defined scale — none invented ad hoc
- [ ] Every text size/weight maps to a defined role, used consistently across the whole feature
- [ ] Total color count matches the defined system — nothing extra snuck in
- [ ] Only the defined radius values appear anywhere in this UI
- [ ] There is one clear focal point per screen — not five elements competing for attention
- [ ] Whitespace is being used deliberately to group/separate things, not left over by accident
- [ ] Alignment is consistent — elements line up to a shared grid, not "close enough"
- [ ] Hover, focus, active, empty, and error states are all designed, not left as browser defaults
- [ ] The design would look intentional and specific to this product if a stranger saw one screenshot, not swappable with any other SaaS tool
- [ ] If a reference image was provided, this matches it closely on color, spacing, and type — not just "in spirit"
- [ ] Nothing from the Section 7 anti-pattern list is present
- [ ] It's legible and functional at a realistic content length (not just the one short placeholder string used while building)

If any box doesn't honestly check, fix that specific thing before moving on — don't ship with known gaps and mention them as caveats instead of fixing them.

---

## 9. Verify with evidence, not self-assessment

- Use a headless browser (Playwright/Puppeteer) to take actual screenshots of what you built, at both a normal desktop width and a narrow width, before telling me it's done.
- Look at the screenshot yourself and check it against Section 8 — a written self-assessment without actually looking at rendered output is not verification.
- If I gave you a reference image, put your screenshot and the reference side by side (even just described in your own review) and check spacing, color, and type match closely — not approximately.
- If something can't be verified visually in your environment, say so explicitly rather than asserting it looks correct.

---

## 10. Writing/copy standards (applies to every label, button, empty state, error message)

- Name things by what the person controls, not how the system is built internally.
- Buttons say exactly what happens: "Save changes," not "Submit." Keep the same verb through the whole flow — a button that says "Collect" should be followed by a toast that says "Collected," not "Saved" or "Added."
- Empty states are an invitation to act, not a dead end — say what to do, not just that there's nothing here.
- Error messages state what happened and how to fix it — never vague, never apologetic filler.
- No filler words, no marketing tone. Plain, direct, sentence case.

---

## 11. What "premium" concretely means for this project — not a vibe, a checklist

- **Restraint**: one deliberate signature moment (e.g. the hover-capture tooltip itself, done exceptionally well), quiet and disciplined everywhere else. Not every element trying to be the interesting one.
- **Consistency**: the token system in Section 2 is followed with zero exceptions — this alone is most of what separates "premium" from "generic," more than any individual clever detail.
- **Precision**: real alignment to a grid, optically balanced (not just mathematically centered — visually heavier elements may need slight offset to *read* as centered).
- **Hierarchy**: one dominant element per view; everything else recedes in support of it.
- **Finish**: every state designed (hover/focus/empty/error/loading), not just the default happy path — this is usually where "AI-built" tools give themselves away, because only the first-imagined state got attention.
