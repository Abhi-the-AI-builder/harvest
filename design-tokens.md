# Harvest — design tokens

Written before the design-polish pass (2026-08-25), per the project's design
standards doc. These are the only values allowed anywhere in the UI —
tooltip (`overlay.js`), floating toolbar (`toolbar.js`), and side panel
(`sidepanel.css`). Same token values in all three (each is its own Shadow
DOM / document, so the values are duplicated as literal CSS custom
properties in each stylesheet, not shared via import — but they must stay
numerically identical).

## Why these decisions, not the defaults

Harvest is a hover-to-collect research tool for a professional designer. It
spends most of its life as a small floating surface *on top of someone
else's website* (the tooltip, the toolbar pill) plus a narrow, dense side
panel (the library). That constrains the palette more than a typical app:

- The tooltip and toolbar must stay legible sitting on an unknown host
  page — light or dark, busy or plain. A near-black theme (AI default #2)
  would fight with dark host pages constantly. A warm cream/serif theme
  (AI default #1) reads editorial, not tool-like, and this is a tool.
  Neither fits, so both are out.
- The side panel is data-dense (grids of colors/fonts/components, like a
  deposits dashboard is dense with numbers) — Stable Money's move of a
  clean neutral base + exactly one accent color applies directly. Color
  should mark selection/action, not decorate.
- One deliberate high-craft moment: the hover tooltip's "Collect" action —
  the single interaction a user repeats hundreds of times. Everything else
  (grids, modals, list rows) stays quiet and disciplined, per CRED's
  restraint-everywhere-except-the-signature-moment principle.
- The brand mark (`icons/icon*.png`) is a warm red/coral mascot. The
  primary UI accent is a separate, cooler navy. This is a deliberate split,
  not an oversight: the mascot is playful identity shown in small doses
  (toolbar drag handle, panel branding); the UI accent is functional and
  needs to read as calm/professional across hundreds of repeated hovers, so
  it stays a distinct, quieter navy rather than matching the logo hue
  1:1 — the same way many products separate an expressive icon from a
  restrained product-chrome color.

None of the three AI-default clichés apply: not warm-cream-serif-terracotta,
not near-black-neon, not broadsheet-hairline-zero-radius.

## Color

Six named colors + one semantic pair. Nothing outside this list.

| Token | Value | Job |
|---|---|---|
| `--color-bg` | `#FAFAFA` | Page/panel background |
| `--color-surface` | `#FFFFFF` | Cards, tooltip, modals — one step up from bg |
| `--color-text` | `#17181A` | Primary text |
| `--color-text-muted` | `#6B6E76` | Secondary text, captions, metadata |
| `--color-accent` | `#1D3461` | The one accent — primary actions, selection, active state |
| `--color-danger` | `#C33D2E` | Destructive actions, error text |

Derived (not new colors, just the accent/danger/text at low opacity — same
job as a "50-weight" swatch in a token system):
`--color-accent-wash` (`rgba(29,52,97,.10)`), `--color-danger-wash`
(`rgba(195,61,46,.08)`), `--color-border` (`rgba(23,24,26,.09)`),
`--color-border-strong` (`rgba(23,24,26,.18)`).

Semantic pair (size-cap / PII soft-warnings only):
`--color-warning-bg` (`#FFF4E5`), `--color-warning-text` (`#8A5A10`).

## Spacing (4px base)

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96` — `--space-1` through `--space-9`.
Every gap/padding/margin in the project rounds to one of these. (The
previous build had drifted to 5/6/7/9/10/13/14/18/20px in places — all
rounded to scale in this pass.)

## Type

12 / 14 / 16 / 20 / 25 / 31 / 39, roles:

| Token | Size | Role |
|---|---|---|
| `--text-caption` | 12 | Metadata, timestamps, helper text |
| `--text-body` | 14 | Default UI text |
| `--text-subheading` | 16 | Card headlines, section labels |
| `--text-heading` | 20 | Tooltip headline — the one place headline-weight matters |
| `--text-display` | 25 | Reserved, unused in this pass (panel is too narrow to need it) |

Weights: 400 body copy, 500 metric values, 600 emphasis/buttons/headlines,
700 eyebrow labels and type badges. Line-height: 1.2 for headline-size text,
1.5 for body/caption.

## Radius — 2 scale values + 1 shape exception

`--radius-sm: 8px` (inputs, small buttons, swatches, icon tiles),
`--radius-lg: 20px` (cards, tooltip, modals, panel surfaces — bumped from
16 to 20 in the v2 pass below: the literal tooltip/folder-grid reference
images both use a visibly larger, more generous corner than 16px; per the
project's own rule, a reference image wins over the default scale, so the
scale was updated rather than approximated). Full-round pills
(`--radius-full: 999px`) are a distinct circular shape family used
consistently for chips/toggles/the FAB/avatars — not a third arbitrary
corner value competing with the other two, the same way a "pill button" and
a "rounded-rect card" are recognized as different shapes in most systems.

## Shadow — 3 levels

- `--shadow-resting`: `0 1px 2px rgba(23,24,26,.06)` — cards at rest
- `--shadow-raised`: `0 2px 6px rgba(23,24,26,.08), 0 8px 20px rgba(23,24,26,.10)` — hover lift
- `--shadow-overlay`: `0 8px 24px rgba(23,24,26,.14), 0 24px 48px rgba(23,24,26,.16)` — tooltip, floating toolbar, modals, toasts (anything that must separate from an arbitrary host page)

## Motion

- `--ease-fast: 120ms ease-out` — hover/press states
- `--ease-base: 180ms cubic-bezier(.2,.7,.3,1)` — panel/view transitions, tooltip entrance
- `--ease-spring: 320ms cubic-bezier(.34,1.56,.64,1)` — the one signature
  moment: the Collect action. On save, the button morphs into a checkmark
  with a small overshoot pop, and the new item flies into the capture stack
  with the same spring curve — this is the CRED-grade deliberate
  micro-interaction Section 3 calls for, applied to the single action this
  product's entire value proposition rests on. Every other transition in
  the product stays quiet and uses `--ease-fast`/`--ease-base`.

## v2 — literal reference extraction (2026-08-25, later same day)

The user supplied an updated `CLAUDE.md` plus 10 numbered reference images
(`reference-images/01…10`) with an explicit instruction: treat Section 4's
12 patterns "as literally as Section 2's number scales — specific patterns
to build, not moodboard inspiration to vaguely gesture at." Two images
(`01`, `02`) are direct 1:1 references for Harvest's own tooltip and folder
grid, not general inspiration — extracted and matched as closely as
possible rather than paraphrased.

**Two deliberate, documented exceptions to the "one accent" rule below** —
both are explicit, literal mandates from Section 4 Pattern 3 (and the
folder-grid reference), not scope creep or a drift back toward decoration
for its own sake. Everything else in the system (buttons, selection,
focus rings, primary actions) still uses only `--color-accent`.

**Type badges** (Pattern 3 — "soft pastel icon badges for categorization,
not plain monochrome icons," used identically everywhere a capture type
appears: tooltip icon, tile/card type chip, folder-cover fallback):

| Type | Badge bg | Icon color |
|---|---|---|
| `color` | `#FDE8E1` | `#C1552F` |
| `font` | `#EDEAFB` | `#5B4FC4` |
| `image` | `#DFF3EC` | `#1E8F72` |
| `component` | `#FBF0DC` | `#B07D1F` |

**Folder tint palette** (reference `02` — every folder card is a solid
pastel-tinted surface, not white; tint is deterministic per hostname via a
simple string hash so the same site always lands on the same color, not
random per render): six tones — `#E4EBD9`/`#E8D3D3`/`#DCE3EF`/`#E6DEF2`/
`#F1DCE6`/`#DCE9E7` — each paired with a matching darker ink color for the
hostname text so it stays legible on its own tint (`#3E4A2E`, `#5C3636`,
`#33445E`, `#4A3C6B`, `#6B3550`, `#2E4F49` respectively).

Everything else Section 4 asks for is layout/composition, not new colors:
label-above-value stat hierarchy (Pattern 1), layered/offset stacked
previews (Pattern 2, already the folder-fan direction — reference `02`
makes the exact offset explicit), avatar-style overflow stacking (Pattern
5), chip-based multi-select instead of a bare counter (Pattern 4), a split
primary button for Export (Pattern 7), quiet inline confirmation instead of
a loud toast (Pattern 8), tinted eyebrow pills — already how `.card
.type-label` worked before this pass, just confirmed against reference `05`
(Pattern 10), and a small gradient confirmation moment for saving a font
pairing (Pattern 12). Pattern 6 (segmented tick progress) has no matching
use case in Harvest yet — no multi-step/session-progress surface exists to
apply it to — so it's intentionally not forced in anywhere, per the
document's own "where it applies" framing rather than "everywhere,
regardless."

## Gaps this pass also closes (not just re-skinning)

- No interactive element anywhere had a `:focus-visible` state — keyboard
  users got the browser default or nothing. Every button/input/pill now
  gets a 2px `--color-accent` focus ring, offset 2px, only on keyboard
  focus (not on every mouse click).
- Radius, shadow, and spacing were previously ad hoc per component (9
  different radius values, a fresh `box-shadow` string per element). Now
  driven entirely from the tables above.
