// Section 2 — the Shadow DOM tooltip overlay. Fully isolated styles, no
// inheritance from the host page. This file owns rendering + positioning +
// DOM-tree-walk + note field + toast. content.js owns *when* to show it
// (hover/context-menu/keyboard) and hands it a target element + tag info.
(function () {
  const Acopio = window.Acopio;
  const ACCENT = "#1D3461"; // deep navy — calmer, more premium than the earlier orange

  // Bundled locally (fonts/Inter-var.woff2, SIL Open Font License) and
  // loaded via chrome.runtime.getURL — never from Google Fonts at runtime,
  // which would be exactly the kind of external network call Section 9's
  // local-only commitment rules out. getURL() only works because the file
  // is declared in manifest.json's web_accessible_resources.
  const INTER_URL = chrome.runtime.getURL("fonts/Inter-var.woff2");

  const SHEET = `
    :host {
      all: initial;
      /* Same token values as sidepanel.css and toolbar.js — see
         design-tokens.md. Duplicated (not imported) because each is an
         isolated Shadow DOM / document, but must stay numerically identical
         so the tooltip, toolbar, and panel read as one product. */
      --color-bg: #FAFAFA;
      --color-surface: #FFFFFF;
      --color-text: #17181A;
      --color-text-muted: #6B6E76;
      --color-accent: ${ACCENT};
      --color-accent-wash: rgba(29,52,97,0.10);
      --color-danger: #C33D2E;
      --color-border: rgba(23,24,26,0.09);
      --color-border-strong: rgba(23,24,26,0.18);
      --color-warning-bg: #FFF4E5;
      --color-warning-text: #8A5A10;
      --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px;
      --text-caption: 12px; --text-body: 14px; --text-subheading: 16px; --text-heading: 20px;
      --radius-xs: 4px; --radius-sm: 8px; --radius-lg: 20px; --radius-full: 999px;
      --type-color-bg: #FDE8E1; --type-color-fg: #C1552F;
      --type-font-bg: #EDEAFB; --type-font-fg: #5B4FC4;
      --type-image-bg: #DFF3EC; --type-image-fg: #1E8F72;
      --type-folder-bg: #E8EEF7; --type-folder-fg: #1D3461;
      --type-component-bg: #FBF0DC; --type-component-fg: #B07D1F;
      --shadow-raised: 0 2px 6px rgba(23,24,26,0.08), 0 8px 20px rgba(23,24,26,0.10);
      --shadow-overlay: 0 8px 24px rgba(23,24,26,0.14), 0 24px 48px rgba(23,24,26,0.16);
      --ease-fast: 120ms ease-out;
      --ease-base: 180ms cubic-bezier(.2,.7,.3,1);
      --ease-spring: 320ms cubic-bezier(.34,1.56,.64,1);
    }
    @font-face {
      font-family: "Inter";
      src: url("${INTER_URL}") format("woff2");
      font-weight: 100 900;
      font-display: swap;
    }
    * { box-sizing: border-box; font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    :focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; border-radius: var(--radius-sm); }
    .card {
      position: fixed;
      z-index: 2147483647;
      background: var(--color-surface);
      color: var(--color-text);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-overlay);
      padding: var(--space-4) var(--space-4) var(--space-3) var(--space-4);
      width: 280px;
      pointer-events: auto;
      font-size: var(--text-body);
      line-height: 1.4;
      border: 1px solid var(--color-border);
      animation: acopio-in var(--ease-base);
    }
    .card.card--no-entrance { animation: none; }
    @keyframes acopio-in { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
    /* Folder destination — compact chip (icon + name + chevron), not a
       full-width field. Hairline under the row separates destination from type. */
    .folder-header {
      display: flex; align-items: center; gap: var(--space-2); justify-content: flex-start;
      padding-bottom: var(--space-3); margin-bottom: var(--space-3);
      border-bottom: 1px solid var(--color-border);
      cursor: grab; touch-action: none;
    }
    .folder-header.is-dragging { cursor: grabbing; }
    .folder-btn {
      display: inline-flex; align-items: center; gap: var(--space-2);
      flex: 0 1 auto; max-width: 100%; width: max-content; min-width: 0;
      border: none; background: transparent; color: var(--color-text);
      border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2);
      font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left;
      transition: background var(--ease-fast), color var(--ease-fast);
    }
    /* Wash only — no accent outline box on hover/open. */
    .folder-btn:hover, .folder-btn[aria-expanded="true"] {
      background: var(--color-accent-wash); color: var(--color-accent);
    }
    .folder-btn:focus { outline: none; }
    .folder-btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
    .folder-btn-icon {
      width: 22px; height: 22px; border-radius: var(--radius-xs); flex: none;
      display: flex; align-items: center; justify-content: center;
      background: var(--type-folder-bg); color: var(--type-folder-fg);
      overflow: hidden;
    }
    .folder-btn-icon.is-site {
      background: var(--color-surface); border: 1px solid var(--color-border);
      color: var(--color-text-muted);
    }
    .folder-btn-icon svg { width: 14px; height: 14px; }
    .folder-btn-icon img { width: 14px; height: 14px; object-fit: contain; display: block; }
    .folder-btn-label {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      flex: 0 1 auto; max-width: 160px; min-width: 0;
    }
    .folder-btn-chevron { flex: none; display: flex; color: var(--color-text-muted); transition: transform var(--ease-fast); }
    .folder-btn-chevron svg { width: 11px; height: 11px; }
    .folder-btn[aria-expanded="true"] .folder-btn-chevron { transform: rotate(180deg); color: var(--color-accent); }
    .folder-btn:hover .folder-btn-chevron { color: var(--color-accent); }

    /* Folder menu is portaled to documentElement (sibling of host) so it
       isn't trapped by the host's fixed containing block / pointer-events.
       Styles for that portal live on the element via a dedicated class
       sheet injected once — keep a twin here for any in-shadow fallback. */
    .folder-menu {
      position: fixed; z-index: 2147483646; min-width: 200px; max-width: 280px; max-height: 260px;
      overflow-y: auto; background: var(--color-surface); border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-sm); box-shadow: var(--shadow-overlay); padding: var(--space-1);
      display: flex; flex-direction: column; gap: 2px; pointer-events: auto;
      box-sizing: border-box;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .folder-menu-item {
      display: flex; align-items: center; gap: var(--space-2); width: 100%;
      border: none; background: none; text-align: left; cursor: pointer;
      padding: var(--space-2) var(--space-3); border-radius: var(--radius-xs);
      font: inherit; font-size: 12px; color: var(--color-text);
      transition: background var(--ease-fast);
    }
    .folder-menu-item > .folder-menu-item-label {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1;
    }
    .folder-menu-item-icon {
      width: 16px; height: 16px; flex: none; display: flex; align-items: center; justify-content: center;
      color: var(--color-text-muted); overflow: hidden;
    }
    .folder-menu-item-icon svg { width: 13px; height: 13px; }
    .folder-menu-item-icon img { width: 14px; height: 14px; object-fit: contain; display: block; }
    .folder-menu-item:hover { background: var(--color-accent-wash); }
    .folder-menu-item[aria-checked="true"] { color: var(--color-accent); font-weight: 600; }
    .folder-menu-item-check { margin-left: auto; flex: none; display: none; color: var(--color-accent); }
    .folder-menu-item[aria-checked="true"] .folder-menu-item-check { display: flex; }
    .folder-menu-item-check svg { width: 11px; height: 11px; }
    .folder-menu-divider { height: 1px; background: var(--color-border); margin: var(--space-1) 0; }
    .folder-menu-new-form { display: flex; gap: var(--space-1); padding: var(--space-1); align-items: center; }
    .folder-menu-new-input {
      flex: 1; min-width: 0; border: 1px solid var(--color-border-strong); border-radius: var(--radius-xs);
      padding: var(--space-2); font: inherit; font-size: 12px; color: var(--color-text); background: var(--color-bg);
      outline: none;
    }
    .folder-menu-new-input:focus { border-color: var(--color-accent); }
    .folder-menu-new-confirm {
      width: 28px; height: 28px; border: none; border-radius: var(--radius-xs); flex: none;
      background: var(--color-accent); color: var(--color-surface); display: flex; align-items: center; justify-content: center;
      cursor: pointer;
    }
    .folder-menu-new-confirm svg { width: 11px; height: 11px; }
    .folder-menu-new-confirm:disabled { opacity: 0.5; cursor: default; }

    /* Type + dimensions + copy — sits just above the preview, no divider. */
    .type-meta-row {
      display: flex; align-items: center; gap: var(--space-2); justify-content: space-between;
      padding-bottom: var(--space-2); margin-bottom: var(--space-2);
    }
    .type-meta-row > .row { min-width: 0; flex: none; }
    .type-meta-row .copy-btn { width: 26px; height: 26px; border-radius: var(--radius-sm); }
    .type-meta-row .copy-btn svg { width: 13px; height: 13px; }

    /* Kept for rare iframe fallback header. */
    .selector-row {
      display: flex; align-items: center; gap: var(--space-2); justify-content: space-between;
      padding-bottom: var(--space-2); margin-bottom: var(--space-2);
    }
    .selector-row-draggable { cursor: grab; touch-action: none; }
    .selector-row-draggable.is-dragging { cursor: grabbing; }
    .selector {
      flex: 1; min-width: 0;
      font-size: 12px;
      font-weight: 500;
      color: var(--color-text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Up = select the parent element at this same hover point, down =
       back to where you were. This is the actual answer to "there are two
       fonts/elements stacked right here, I can only see one" — a heading
       and its parent section (or a styled span and its own parent) often
       carry genuinely different fonts/colors at the exact same pixel;
       elementFromPoint can only ever return the topmost one on its own.
       Previously reachable only via arrow keys while hovering the card
       (undiscoverable — nothing on screen hinted this existed at all). */
    .selector-nav-btns { display: flex; gap: 2px; flex: none; }
    /* Named distinctly from .nav-btn (an existing, differently-styled class
       already used for the Skip/Cancel buttons in the size/duplicate
       confirm dialogs further down) — reusing that exact name here
       collided the two: whichever rule happened to come later in the
       stylesheet silently won for every property both set, so these
       chevrons and those confirm buttons were fighting over one definition
       instead of each keeping its own. */
    .selector-nav-btn {
      width: 22px; height: 22px; border-radius: var(--radius-xs); border: 1px solid var(--color-border-strong);
      background: var(--color-surface); color: var(--color-text-muted); display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: background var(--ease-fast), color var(--ease-fast);
    }
    .selector-nav-btn:hover:not(:disabled) { background: var(--color-accent-wash); color: var(--color-accent); }
    .selector-nav-btn:disabled { opacity: 0.35; cursor: default; }
    .selector-nav-btn svg { width: 11px; height: 11px; }
    /* Proactive duplicate flag — shown on hover, before you've clicked
       anything, not just as a confirmation after you try to save. Quiet
       (muted text, no border/shadow) since it's informational, not a
       warning — you can still collect it again on purpose. */
    .already-collected {
      display: flex; align-items: center; gap: var(--space-1); margin: -2px 0 var(--space-2);
      font-size: 11px; color: var(--color-text-muted);
    }
    .already-collected svg { color: var(--color-accent); flex: none; width: 12px; height: 12px; }
    /* Match card bottom padding (--space-3): note→divider, divider→stack, and
       stack→card bottom all read as the same 12px gap. */
    .divider { height: 1px; background: var(--color-border); margin: var(--space-3) 0; }
    .row { display: flex; align-items: center; gap: var(--space-2); }
    /* Small inline icon directly in the headline row — not a floating
       badge over a decorative band. Matches the reference tooltip exactly:
       icon and title share one compact line, nothing else competing for
       vertical space above them. */
    .type-icon {
      width: 22px; height: 22px; border-radius: var(--radius-xs); flex: none;
      display: flex; align-items: center; justify-content: center;
      color: var(--color-text-muted); background: var(--color-bg);
      font-size: 12px; font-weight: 700;
    }
    /* Pattern 3 — same pastel badge per type used everywhere (tooltip,
       tile, card, folder-cover fallback). */
    .type-icon-color { background: var(--type-color-bg); color: var(--type-color-fg); }
    .type-icon-font { background: var(--type-font-bg); color: var(--type-font-fg); }
    .type-icon-image { background: var(--type-image-bg); color: var(--type-image-fg); }
    .type-icon-component { background: var(--type-component-bg); color: var(--type-component-fg); }
    .headline { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; min-width: 0; }
    /* design-extractor's own .badge.role-chip (picker.js) — its neutral
       variant, specifically the one it reserves for "a plain fact about
       the element" (its own comment's wording) rather than a pass/fail
       verdict, which is exactly what a dimension value is here too. Sits
       right next to the label now, not pushed to the card's far edge —
       tabular-nums keeps the digits from jittering in width as the
       hovered element changes size. */
    .headline-meta {
      flex: none; margin-left: var(--space-1);
      font-size: 10.5px; font-weight: 600; color: var(--color-text-muted); white-space: nowrap;
      font-variant-numeric: tabular-nums;
      background: var(--color-bg); padding: 3px 9px; border-radius: var(--radius-full);
    }
    .child-label { color: var(--color-text-muted); font-weight: 500; }
    /* One tight row, real metric-specific icons (size/line-height/letter-
       spacing/color) instead of generic arrows — the reference's actual
       icon language, not an approximation of it. */
    /* design-extractor's .tmetric-row carries its own border-bottom +
       padding-bottom — a visible break between "what this is" and
       whatever comes next (color row, hint, or the note field here) —
       instead of relying on margin alone the way this row previously did.
       That missing divider was flattening the card's rhythm compared to
       the reference, which visibly separates every conceptual chunk. */
    .metrics { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-3); padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border); flex-wrap: wrap; }
    /* Monospace + tabular-nums, matching design-extractor's .tmetric
       exactly — these are precise measured values (px sizes, hex, pixel
       dimensions), and reading as data (fixed-width digits) rather than
       ordinary prose is the whole reason the reference sets them this way. */
    .metric {
      display: flex; align-items: center; gap: var(--space-1); color: var(--color-text);
      font-family: ui-monospace, "SF Mono", monospace; font-size: 11.5px; font-weight: 500;
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .metric .icon { color: var(--color-text-muted); display: flex; align-items: center; }
    /* The "Contains: Heading, Text, Image" row shares .metric's icon+row
       layout but is prose (a list of words), not a measured value — the
       monospace/tabular-nums treatment above is specifically for numeric
       data like "220×140px", and would look wrong applied to word lists. */
    .metric-prose { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-variant-numeric: normal; font-size: var(--text-caption); }
    /* "Contains: Group, Group, Group" as one long comma-joined string broke
       badly with more than a few children — either overrunning the card's
       fixed width with no wrap, or wrapping mid-word with no visual
       separation between items. Real wrapped chips instead: each one
       clickable to jump straight to that specific child (so you can
       collect exactly that nested piece, not just the group as a whole),
       and they wrap cleanly at any count instead of breaking. */
    /* Label + chips on one flex-wrap row: chips sit inline after
       "Contains:" when they fit, and wrap onto the next line when they
       don't. display:contents on .contains-chips lets each chip join
       the parent wrap so the label stays on the first line with whatever
       chips fit, rather than the whole chip group dropping as a block. */
    .contains-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      margin-top: var(--space-3);
    }
    .contains-row .child-label { margin-bottom: 0; flex: none; }
    .contains-chips { display: contents; }
    .contains-chip {
      border: 1px solid transparent; background: var(--color-bg); border-radius: var(--radius-full);
      padding: 2px var(--space-2); font-size: 11px; font-weight: 600; color: var(--color-text); cursor: pointer;
      transition: filter var(--ease-fast);
    }
    .contains-chip:hover { filter: brightness(0.96); }
    .contains-chip-overflow { cursor: default; color: var(--color-text-muted); background: var(--color-bg); filter: none !important; }
    .contains-chip-image { background: var(--type-image-bg); color: var(--type-image-fg); }
    .contains-chip-font { background: var(--type-font-bg); color: var(--type-font-fg); }
    .contains-chip-component { background: var(--type-component-bg); color: var(--type-component-fg); }
    .contains-chip-overflow:hover { background: var(--color-bg); border-color: var(--color-border-strong); color: var(--color-text-muted); }
    /* Ported verbatim from design-extractor's own .color-card/.color-info
       (sidepanel.css) — the exact "Primary #fe6200" reference component,
       not a re-derived approximation. Its own comment on this technique:
       "Overlapping the swatch, not stacked under it — the mask cuts a
       concave notch at the top-left corner only, so the info panel reads
       as a card physically resting on top of the color block (its own bg
       shows through the notch) instead of two flat rectangles glued
       together." Achieved via mask-image on the BODY panel itself (pulled
       up over the swatch with a negative margin-top), not a separate notch
       element with its own radial-gradient background — simpler, and this
       is literally how the source does it.
       Original: .color-swatch { height:74px } .color-info { margin-top:-18px;
       padding:17px 14px 13px 16px; border-top-right-radius:10px;
       mask-image: radial-gradient(circle 18px at 0 0, transparent 17.5px, #000 18px); }
       Snapped to the 4px radius grid (18→16, 10→16 as well — one shared
       radius across the notch and the corner it blends into, cleaner than
       two different near-values) — margin-top, mask circle, and the
       transparent/opaque mask stops all move together since they're the
       same physical radius described three times. */
    .color-swatch-card { border-radius: var(--radius-lg); overflow: hidden; border: 1px solid var(--color-border); }
    .color-swatch-top { height: 74px; position: relative; }
    .color-swatch-body {
      position: relative;
      margin-top: -16px;
      /* Left and right padding equal (both space-4) — the original had
         left bigger than right (space-4 vs space-3), copied from the
         reference's own numbers, which were only ever about clearing the
         top-left notch on the FIRST line. The 16px top padding alone
         already clears that curve with room to spare, so the extra left
         padding was pure asymmetry with no actual job once content (like
         a multi-row gradient chip grid) extends below the notch — it just
         read as the whole block being off-center. */
      padding: var(--space-4) var(--space-4) var(--space-3) var(--space-4);
      background: var(--color-surface);
      border-top-right-radius: 16px;
      -webkit-mask-image: radial-gradient(circle 16px at 0 0, transparent 15.5px, #000 16px);
      mask-image: radial-gradient(circle 16px at 0 0, transparent 15.5px, #000 16px);
    }
    .color-swatch-caption { font-size: 11px; font-weight: 650; letter-spacing: 0.005em; color: var(--color-text); margin-bottom: 6px; }
    .color-swatch-value { font-size: 12px; font-weight: 600; color: var(--color-text); line-height: 1.25; }
    .color-swatch-value-row { display: flex; align-items: center; gap: var(--space-2); }
    /* Secondary background block on a font/button tooltip — same swatch
       language as the dedicated color-type card, just appended below the
       text metrics instead of replacing them. */
    .bg-swatch-block { margin-top: var(--space-3); }
    /* Text color + background color side by side, each its own labeled
       column, instead of two full-width stacked sections each repeating
       "color" in the caption and eating a full row for one chip. */
    .color-pair-row { display: flex; gap: var(--space-3); margin-top: var(--space-3); }
    .color-pair-col { flex: 1; min-width: 0; }
    .color-pair-col .gradient-stop { width: 100%; box-sizing: border-box; }
    .copy-btn {
      border: none; background: var(--color-bg); border-radius: var(--radius-xs);
      width: 18px; height: 18px; flex: none; display: flex; align-items: center; justify-content: center;
      color: var(--color-text-muted); cursor: pointer; transition: background var(--ease-fast), color var(--ease-fast);
    }
    .copy-btn:hover { background: var(--color-accent-wash); color: var(--color-accent); }
    .copy-btn.is-copied { background: var(--color-accent); color: var(--color-surface); border-color: var(--color-accent); }
    /* Header copy/copy-as-SVG buttons — a primary header action, not a
       small inline chip accessory, so they match the SAME larger size the
       prominent single-hex "solo" chip already uses (.gradient-stop-solo
       .copy-btn below) rather than the small multi-stop-chip default
       above. Same class, same borderless/flat chrome either way — only
       the size differs by context, exactly like the solo/default split
       already established for color chips. */
    /* Side by side, each stop its own small bordered chip — not a stacked
       column of full-width rows, which read as heavier/bulkier than the
       actual amount of information (a swatch, a hex, a copy button)
       justified. Wraps to a new line only once stops genuinely don't fit. */
    /* flex:1 on each chip (not just flex-wrap on the parent) — with a
       fixed content width, two stops didn't reliably fit the card's actual
       ~216px content area and wrapped to their own lines even though two
       side by side would have fit with tighter spacing; letting each chip
       share the row and shrink to what it actually needs (a 7-char hex
       code isn't going anywhere near overflowing) keeps 2-3 stops on one
       line, the common case, and still wraps once there truly isn't room. */
    .gradient-stops { display: flex; flex-wrap: wrap; gap: 4px; }
    .gradient-stop {
      /* No min-width:0 — a flex item's default min-width:auto is what
         makes it refuse to shrink below its own content's natural size
         (swatch + hex text + copy button, none of which can compress
         further) and wrap to a new line instead. Removing that default
         was the actual bug: it let the chip shrink past what its
         fixed-size children need, pushing the copy button out past the
         chip's own padded edge instead of wrapping. */
      display: flex; align-items: center; gap: 4px; flex: 1 1 88px; justify-content: center;
      border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 3px 5px;
    }
    .gradient-stop-swatch { width: 14px; height: 14px; border-radius: var(--radius-xs); border: 1px solid var(--color-border); flex: none; }
    .gradient-stop-value {
      font-size: 12px; font-weight: 600; color: var(--color-text);
      white-space: nowrap;
    }
    .gradient-stop-overflow { color: var(--color-text-muted); font-size: 12px; font-weight: 600; justify-content: center; }
    .gradient-stop-solo {
      justify-content: flex-start; gap: 8px; padding: 8px 8px 8px 10px; width: 100%;
    }
    .gradient-stop-solo .gradient-stop-swatch { width: 20px; height: 20px; border-radius: var(--radius-xs); }
    .gradient-stop-solo .gradient-stop-value { font-size: 12px; font-weight: 700; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .gradient-stop-solo .copy-btn { width: 26px; height: 26px; border-radius: var(--radius-sm); flex: none; }
    .gradient-stop-solo .copy-btn svg { width: 13px; height: 13px; }
    /* Two of these sit side by side in .color-pair-row, each in a
       min-width:0 half-width column — the full-size solo metrics above
       (26px button, 20px swatch, 13px text) were sized for ONE chip
       filling the whole card width, and don't actually fit two-up; the
       column shrinking below that combined content width was exactly
       what pushed the copy button out past its own edge. Scaled back
       down to the same compact metrics the multi-stop gradient chips
       already use safely at this width. */
    .color-pair-col .gradient-stop-solo { gap: 4px; padding: 3px 5px; }
    .color-pair-col .gradient-stop-solo .gradient-stop-swatch { width: 14px; height: 14px; }
    .color-pair-col .gradient-stop-solo .gradient-stop-value { font-size: 12px; font-weight: 600; }
    .color-pair-col .gradient-stop-solo .copy-btn { width: 18px; height: 18px; border-radius: var(--radius-xs); }
    .color-pair-col .gradient-stop-solo .copy-btn svg { width: 11px; height: 11px; }
    .warning {
      margin-top: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm);
      background: var(--color-warning-bg); color: var(--color-warning-text); font-size: var(--text-caption); line-height: 1.4;
    }
    /* Compact single tag showing the current classification — click to
       reveal the full .family-pills picker below instead of always
       showing all 4 options (was clutter for the common "detection is
       already right" case). */
    /* Tinted with the one accent (not a new color per classification —
       Heading/Body/Button/Other aren't part of the established 4-color
       type system, so giving each its own hue would be adding colors
       outside it; the accent wash is the same "this is interactive /
       currently selected" treatment already used elsewhere, e.g. the
       type-chip badges and the collection-picker rows). */
    /* Tinted with the type-font color (the same purple the font type-icon
       badge already uses everywhere else) — Heading/Body/Button/Other are
       all still fundamentally a font classification, so one consistent
       tint reads as "this is about the font," same logic as the Contains
       chips below reusing the same 4 established colors rather than
       inventing new ones per label. */
    .family-tag {
      display: inline-flex; align-items: center; gap: var(--space-1); margin-top: var(--space-3);
      border: 1px solid transparent; background: var(--type-font-bg); border-radius: var(--radius-full);
      padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3); font-size: var(--text-caption); font-weight: 600; color: var(--type-font-fg); cursor: pointer;
      transition: filter var(--ease-fast);
    }
    .family-tag:hover { filter: brightness(0.96); }
    /* The inline variant sitting in the headline row itself, right before
       the font name — same tag, no standalone top margin, sized down a
       step so it reads as a small prefix label, not competing with the
       actual headline text next to it. */
    .family-tag-inline { margin-top: 0; padding: 2px var(--space-2); font-size: 11px; flex: none; }
    /* Informational, not a click-to-change control like the font family
       tag it borrows its shape from — neutral instead of accent-tinted,
       default cursor instead of pointer. */
    .dimensions-tag { background: var(--color-bg); color: var(--color-text-muted); cursor: default; }
    .family-pills { display: flex; gap: var(--space-1); margin-top: var(--space-3); flex-wrap: wrap; }
    .pill {
      border: 1px solid var(--color-border-strong); background: var(--color-surface); border-radius: var(--radius-full);
      padding: 3px var(--space-2); font-size: 11px; cursor: pointer; color: var(--color-text-muted);
      transition: background var(--ease-fast), color var(--ease-fast), border-color var(--ease-fast);
    }
    .pill:hover { border-color: var(--color-accent); color: var(--color-text); }
    .pill[data-active="true"] { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-surface); }
    /* flex-end: the .collect-btn and .stack-group cases both stretch to
       fill (flex:1), so this only actually matters for the lone-fab case
       (an already-collected element with nothing captured yet this page
       load) — without it, that single 38px circular button would sit at
       the row's left edge instead of trailing the content above it the
       way the fab in a stack-group already visually trails its stack. */
    .actions { display: flex; gap: var(--space-2); align-items: center; justify-content: flex-end; }
    .collect-btn {
      flex: 1; background: var(--color-accent); color: var(--color-surface);
      border: none; border-radius: var(--radius-full);
      padding: var(--space-3) var(--space-4); font-size: var(--text-caption); font-weight: 600; cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: var(--space-2);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 3px 10px rgba(29,52,97,0.35);
      transition: transform var(--ease-spring), background var(--ease-fast), filter var(--ease-fast);
    }
    .collect-btn:hover { filter: brightness(1.08); }
    .collect-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .collect-btn.is-collected { background: var(--color-accent); transform: scale(1.04); }
    .collect-btn svg { flex: none; }
    .nav-btn {
      width: 28px; height: 28px; border-radius: var(--radius-sm); border: 1px solid var(--color-border-strong);
      background: var(--color-bg); cursor: pointer; color: var(--color-text); font-size: var(--text-caption); flex: none;
      transition: background var(--ease-fast);
    }
    .nav-btn:hover { background: var(--color-border); }
    .stack-group {
      display: flex; align-items: center; gap: var(--space-3); flex: 1;
      background: var(--color-bg); border-radius: var(--radius-full); padding: 5px var(--space-2) 5px var(--space-3);
      border: 1px solid var(--color-border);
    }
    .capture-stack {
      display: flex; align-items: center; flex: 1; cursor: pointer; min-width: 0;
    }
    .stack-cards { display: flex; align-items: center; padding: var(--space-1) 0; }
    .stack-card {
      width: 34px; height: 34px; border-radius: var(--radius-sm); flex: none;
      border: 2px solid var(--color-surface); box-shadow: var(--shadow-raised);
      overflow: hidden; background: var(--color-bg); margin-left: -14px;
      display: flex; align-items: center; justify-content: center;
      transition: transform var(--ease-fast);
    }
    .stack-card:first-child { margin-left: 0; }
    .stack-card:nth-child(1) { transform: rotate(-7deg); }
    .stack-card:nth-child(2) { transform: rotate(4deg); }
    .stack-card:nth-child(3) { transform: rotate(-3deg); }
    .stack-card:nth-child(4) { transform: rotate(6deg); }
    .stack-card:nth-child(5) { transform: rotate(-5deg); }
    .stack-card:nth-child(6) { transform: rotate(3deg); }
    .stack-card:nth-child(7) { transform: rotate(-6deg); }
    .capture-stack:hover .stack-card { transform: translateY(-2px) rotate(0deg); }
    /* New card entering the stack after a collect — the spring half of the
       signature moment (design-tokens.md): it visibly flies in and settles
       with a slight overshoot, rather than just appearing. */
    .stack-card.is-entering { animation: acopio-stack-in var(--ease-spring); }
    @keyframes acopio-stack-in { from { transform: scale(0.4) translateY(-10px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
    .stack-card img, .stack-card video { width: 100%; height: 100%; object-fit: cover; }
    .stack-card .mini-font { font-size: var(--text-caption); font-weight: 700; }
    .stack-card .mini-icon { color: var(--color-text-muted); font-size: 16px; }
    /* Pattern 5's overflow count — same size/overlap/border language as a
       real .stack-card so it reads as part of the same stack, not a
       separate badge bolted on, but upright (never rotated) and text-only
       since it's a count, not a preview. */
    .stack-overflow {
      width: 34px; height: 34px; border-radius: var(--radius-sm); flex: none;
      border: 2px solid var(--color-surface); box-shadow: var(--shadow-raised);
      background: var(--color-text); color: var(--color-surface); margin-left: -14px;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700;
    }
    .collect-fab {
      width: 38px; height: 38px; border-radius: var(--radius-full); flex: none;
      background: var(--color-accent); color: var(--color-surface); border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 3px 10px rgba(29,52,97,0.4);
      transition: transform var(--ease-spring), filter var(--ease-fast);
    }
    .collect-fab:hover { filter: brightness(1.05); transform: scale(1.04); }
    .collect-fab:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    .collect-fab.is-collected { transform: scale(1.12); }
    .note-field {
      margin-top: var(--space-3); width: 100%; border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm);
      padding: var(--space-2) var(--space-3); font-size: var(--text-caption); outline: none; color: var(--color-text); background: var(--color-surface);
      transition: border-color var(--ease-fast);
      /* A textarea now, not a single-line input — grows with what you type
         (autosizeNoteField below) instead of scrolling the text sideways.
         Caps out at 3 lines so a long note can't keep stretching the
         tooltip taller and taller; past that it scrolls vertically inside
         its own fixed height, same convention as everything else in this
         card. 1.4em ties the cap to this field's own line-height/font-size
         instead of a guessed pixel number. */
      font-family: inherit; line-height: 1.4; resize: none; overflow-y: auto;
      max-height: calc(1.4em * 3 + var(--space-2) * 2 + 2px);
    }
    .note-field:focus { border-color: var(--color-accent); }
    /* Same card frame as the color/font swatch (.color-swatch-card) —
       border + var(--radius-lg) + clipped overflow — instead of a bare
       edge-to-edge <img> with no border and a much smaller radius. The
       image doesn't need the notch/mask (there's no caption+value text
       sitting underneath it the way color/font have), just the same
       "this is a deliberate card, not a raw thumbnail" frame. */
    .image-swatch-card { margin-top: var(--space-2); border-radius: var(--radius-lg); overflow: hidden; border: 1px solid var(--color-border); background: var(--color-bg); }
    .thumb { display: block; width: 100%; max-height: 160px; object-fit: cover; }
    .error { color: var(--color-danger); font-size: var(--text-caption); margin-top: var(--space-2); }
    /* Pattern 8 — quiet inline microcopy near the action ("Draft saved"
       reference), not a loud centered toast. Light surface, muted text,
       small accent checkmark — present but understated. */
    .toast {
      position: fixed; z-index: 2147483647; bottom: var(--space-5); left: 50%; transform: translateX(-50%);
      background: var(--color-surface); color: var(--color-text-muted); padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-sm); font-size: var(--text-caption); border: 1px solid var(--color-border);
      box-shadow: var(--shadow-raised); animation: acopio-toast-in var(--ease-base);
      display: flex; align-items: center; gap: var(--space-2);
      /* Generous budget (90vw, capped at 480px) so any normal-length
         message stays on one straight line — text only ever wraps/
         truncates past that, instead of breaking early with room to
         spare. */
      max-width: min(90vw, 480px);
    }
    .toast svg { color: var(--color-accent); flex: none; }
    .toast span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @keyframes acopio-toast-in { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
  `;

  let host, shadow, cardEl, toastTimer, toastEl;
  let currentTarget = null;
  let currentTagInfo = null;
  let outlinedEl = null;
  let prevOutline = "";
  // Typed into the always-visible note field before Collect is ever
  // clicked (Section 6 rework — see buildNoteField). Lives at module scope,
  // not local to render(), because render() re-runs for the SAME element on
  // every family-tag pill click and duplicate-check resolution — resetting
  // it there would erase what you'd already typed. Reset only on a
  // genuinely new element (showFor) or on hide().
  let noteValue = "";
  let noteFieldHasFocus = false;
  let isSaving = false;
  // Whether the compact family tag is expanded into the full Heading/Body/
  // Button/Other picker. Reset only when a genuinely new element is
  // selected (showFor/navigate) — NOT inside render() itself, since
  // clicking the tag to expand it calls render() to redraw, and resetting
  // there would immediately collapse it right back before the user ever
  // saw the alternatives.
  let pillsExpanded = false;
  // User-requested: the tooltip could land over the exact page chrome
  // (a site's own back button, nav) the user needed to click next, with no
  // way to move it out of the way short of dismissing the whole tooltip.
  // A manual nudge applied on top of whatever positionCard already
  // computed — {dx, dy} in px, or null when nothing's been dragged.
  // Reset only on a genuinely new element (showFor), same rule as
  // pillsExpanded above — render() re-running for the SAME element (a
  // nav-arrow click, a color-pill pick) should keep whatever position the
  // user already dragged it to, not snap back.
  let cardDragOffset = null;
  // What you've collected recently — seeded from this site's existing
  // history on load (below), then grows with whatever you capture this
  // page load too. Not the full history (that's what the side panel is
  // for), just a lightweight "here's your progress" confirmation so
  // hovering around a site you've already researched doesn't look like a
  // first-ever visit, and collecting more things doesn't feel like it
  // vanished into a void each time.
  //
  // How many actually fit is derived from the real, fixed CSS numbers
  // below — .card is a constant 280px (not responsive to whatever was
  // captured), so the space available for stacked thumbnails before they'd
  // start crowding the collect button is always the same, and can be
  // computed once instead of guessed. Real, confirmed bug this replaces: a
  // hardcoded cap of 4 kept showing "+2" (etc.) even when the row visibly
  // had room for more — the cap and the actual available space had nothing
  // to do with each other.
  const STACK_CARD_W = 34; // .stack-card width
  const STACK_CARD_OVERLAP = 14; // .stack-card margin-left (all but :first-child)
  const STACK_CARD_STEP = STACK_CARD_W - STACK_CARD_OVERLAP; // extra width each additional stacked card/chip adds
  const COLLECT_FAB_W = 38; // .collect-fab width
  const TOOLTIP_W = 280; // .card width
  const TOOLTIP_PAD = 16; // --space-4, .card padding (both sides)
  const STACK_GROUP_PAD_L = 12; // --space-3, .stack-group padding-left
  const STACK_GROUP_PAD_R = 8; // --space-2, .stack-group padding-right
  // --space-3 — the exact gap kept clear between the card stack and the
  // collect button (.stack-group's flex `gap`). This is the "12px to the
  // collect button" that must stay intact — it's a constant flex gap, not
  // eaten by extra cards, as long as the stack's content doesn't outgrow
  // the width budget computed below.
  const STACK_TO_FAB_GAP = 12;
  const captureStackW = TOOLTIP_W - TOOLTIP_PAD * 2 - STACK_GROUP_PAD_L - STACK_GROUP_PAD_R - STACK_TO_FAB_GAP - COLLECT_FAB_W;
  // Total stacked "slots" (real thumbnails, or the overflow chip — same
  // 34px/-14px footprint either way) that fit in that width without
  // touching the reserved gap: the first slot costs a full card width, every
  // slot after that only adds STACK_CARD_STEP thanks to the overlap.
  const MAX_STACK_SLOTS = Math.max(1, Math.floor((captureStackW - STACK_CARD_W) / STACK_CARD_STEP) + 1);
  let sessionCaptures = [];
  // The REAL total collected from this site — sessionCaptures itself only
  // ever holds the most recent MAX_STACK_SLOTS (older ones are shift()'d out
  // entirely below), so it can't answer "how many have I actually
  // collected here" once that's more than fits on screen. Kept separately
  // so buildStackPreview can show an honest "+N more" instead of silently
  // capping with no sign anything was left out (Pattern 5 — an overflow
  // count, not a mystery truncation).
  let sessionCaptureTotal = 0;
  // Folder destination for Collect — null = this site's automatic folder;
  // a collection id = file into that Collection (and show its stack).
  // Same storage key as notes.js so picks stay consistent across capture modes.
  const LAST_FOLDER_KEY = "acopioLastFolderByHost";
  let selectedCollectionId = null;
  // When filing into another site's folder (Library Sites card), override
  // the item hostname. Null = current page hostname. Ignored while a
  // Collection is selected (Collections link items that still live in
  // their capture-site folder).
  let selectedDestinationHostname = null;
  let selectedFolderName = Acopio.hostname();
  let collectionsCache = [];
  let siteFoldersCache = [];
  let folderMenuEl = null;
  let folderMenuOpen = false;
  let folderMenuLoadId = 0;
  let stackLoadGeneration = 0;

  function siteFolderLabel() {
    return Acopio.hostname() || "This site";
  }

  function effectiveHostname() {
    if (selectedCollectionId) return Acopio.hostname();
    return selectedDestinationHostname || Acopio.hostname();
  }

  // Prefer the live page's own <link rel="icon"> (works in content-script
  // UI). Chrome's _favicon endpoint is a fallback. Never leave the badge
  // empty — show a globe immediately, then swap when an image loads.
  function fillSiteFavicon(containerEl, hostname) {
    Acopio.fillSiteFavicon(containerEl, hostname);
  }

  function updateFolderBtnChrome(btn) {
    const folderBtn = btn || (cardEl && cardEl.querySelector(".folder-btn"));
    if (!folderBtn) return;
    const labelEl = folderBtn.querySelector(".folder-btn-label");
    const iconEl = folderBtn.querySelector(".folder-btn-icon");
    const name = folderDisplayName(selectedFolderName || siteFolderLabel());
    if (labelEl) labelEl.textContent = name;
    folderBtn.setAttribute("aria-label", `Collect to ${name}`);
    folderBtn.title = `Collect to ${name} — click to change`;
    if (!iconEl) return;
    if (selectedCollectionId) {
      iconEl.classList.remove("is-site");
      iconEl.innerHTML = Acopio.ICONS.folder;
    } else {
      fillSiteFavicon(iconEl, effectiveHostname());
    }
  }

  // Icon already says "folder" — label is only the chosen name (never
  // "Folder:" / "After switching to:" prefixes).
  function folderDisplayName(name) {
    let s = String(name || "").trim();
    s = s.replace(/^Folder:\s*/i, "");
    s = s.replace(/^After switching to:\s*/i, "");
    s = s.replace(/^Collecting to:\s*/i, "");
    return s || siteFolderLabel();
  }

  function getCollections() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "GET_COLLECTIONS" }, (response) => {
          if (chrome.runtime.lastError || !response || !response.ok) {
            resolve([]);
            return;
          }
          resolve(response.collections || []);
        });
      } catch (_) {
        resolve([]);
      }
    });
  }

  function getSiteFolders() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "GET_SITE_FOLDERS" }, (response) => {
          if (chrome.runtime.lastError || !response || !response.ok) {
            resolve([]);
            return;
          }
          const folders = response.folders || [];
          Acopio.rememberSiteFavicons(folders);
          resolve(folders);
        });
      } catch (_) {
        resolve([]);
      }
    });
  }

  function getLastFolder(hostname) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([LAST_FOLDER_KEY], (res) => {
          const map = (res && res[LAST_FOLDER_KEY]) || {};
          resolve(map[hostname] || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function setLastFolder(hostname, collectionId) {
    try {
      chrome.storage.local.get([LAST_FOLDER_KEY], (res) => {
        const map = (res && res[LAST_FOLDER_KEY]) || {};
        map[hostname] = collectionId;
        chrome.storage.local.set({ [LAST_FOLDER_KEY]: map });
      });
    } catch (_) {
      // best-effort
    }
  }

  function closeFolderMenu() {
    folderMenuLoadId += 1; // invalidate any in-flight open fetch
    if (folderMenuEl) {
      folderMenuEl.remove();
      folderMenuEl = null;
    }
    folderMenuOpen = false;
    const btn = cardEl && cardEl.querySelector(".folder-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function applyStackItems(items, total) {
    sessionCaptures = (items || []).slice().reverse();
    sessionCaptureTotal = total || sessionCaptures.length;
  }

  function loadStackForCurrentFolder(callback) {
    const myLoad = ++stackLoadGeneration;
    const done = (items, total) => {
      if (myLoad !== stackLoadGeneration) return;
      applyStackItems(items, total);
      if (callback) callback();
    };
    if (selectedCollectionId) {
      Acopio.fetchCollectionRecentItems(selectedCollectionId, MAX_STACK_SLOTS, (items, total, name) => {
        if (name) selectedFolderName = folderDisplayName(name);
        done(items, total);
      });
    } else {
      Acopio.fetchRecentItems(effectiveHostname(), MAX_STACK_SLOTS, (items, total) => {
        done(items, total);
      });
    }
  }

  function refreshActionsInPlace() {
    const actionsEl = cardEl && cardEl.querySelector(".actions");
    if (!actionsEl || !currentTarget) return;
    populateActions(actionsEl);
    positionCard(currentTarget.getBoundingClientRect());
  }

  function selectCollectFolder(collectionId, collectionName, siteHostname) {
    selectedCollectionId = collectionId;
    if (collectionId) {
      selectedDestinationHostname = null;
      selectedFolderName = folderDisplayName(collectionName || "Folder");
    } else {
      selectedDestinationHostname = siteHostname || Acopio.hostname();
      selectedFolderName = folderDisplayName(collectionName || selectedDestinationHostname || siteFolderLabel());
    }
    setLastFolder(Acopio.hostname(), collectionId);
    updateFolderBtnChrome();
    loadStackForCurrentFolder(() => refreshActionsInPlace());
  }

  function ensureFolderMenuPortalStyles() {
    Acopio.ensureFolderMenuPortalStyles();
  }

  function positionFolderMenu(anchorBtn) {
    if (!folderMenuEl || !anchorBtn) return;
    const margin = 8;
    const r = anchorBtn.getBoundingClientRect();
    folderMenuEl.style.visibility = "hidden";
    folderMenuEl.style.display = "flex";
    const menuWidth = Math.max(280, folderMenuEl.offsetWidth || 280);
    const menuHeight = folderMenuEl.offsetHeight || 160;
    let left = r.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
    let top = r.bottom + 4;
    if (top + menuHeight > window.innerHeight - margin) {
      top = Math.max(margin, r.top - menuHeight - 4);
    }
    folderMenuEl.style.left = `${left}px`;
    folderMenuEl.style.top = `${top}px`;
    folderMenuEl.style.visibility = "visible";
  }

  function openFolderMenu(folderBtn) {
    // Always re-query Sites + Folders before painting — never rely on a
    // stale cache from page load / a previous open (user may have created
    // or deleted folders in the side panel since then).
    if (folderMenuEl) {
      folderMenuEl.remove();
      folderMenuEl = null;
    }
    const loadId = ++folderMenuLoadId;
    folderBtn.setAttribute("aria-expanded", "true");
    folderMenuOpen = true;
    Promise.all([getCollections(), getSiteFolders()]).then(([collections, siteFolders]) => {
      if (loadId !== folderMenuLoadId) return;
      if (!folderMenuOpen || !cardEl || !cardEl.contains(folderBtn)) return;
      collectionsCache = collections || [];
      siteFoldersCache = siteFolders || [];
      renderFolderMenu(folderBtn);
    });
  }

  function renderFolderMenu(folderBtn) {
    if (folderMenuEl) {
      folderMenuEl.remove();
      folderMenuEl = null;
    }
    ensureFolderMenuPortalStyles();
    folderMenuEl = document.createElement("div");
    folderMenuEl.className = "acopio-folder-menu";
    folderMenuEl.setAttribute("role", "menu");
    folderMenuEl.setAttribute("data-acopio-folder-menu", "true");

    function buildFolderMenuItem(label, checked, onClick, iconKind, hostnameForIcon) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "folder-menu-item";
      btn.setAttribute("role", "menuitemradio");
      btn.setAttribute("aria-checked", String(checked));
      const iconWrap = document.createElement("span");
      iconWrap.className = "folder-menu-item-icon";
      if (iconKind === "site") fillSiteFavicon(iconWrap, hostnameForIcon || label);
      else iconWrap.innerHTML = Acopio.ICONS.folder;
      btn.appendChild(iconWrap);
      const labelSpan = document.createElement("span");
      labelSpan.className = "folder-menu-item-label";
      labelSpan.textContent = label;
      btn.appendChild(labelSpan);
      const check = document.createElement("span");
      check.className = "folder-menu-item-check";
      check.innerHTML = Acopio.ICONS.check;
      btn.appendChild(check);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      });
      return btn;
    }

    function addHeading(text) {
      const h = document.createElement("div");
      h.className = "folder-menu-heading";
      h.textContent = text;
      folderMenuEl.appendChild(h);
    }

    const currentHost = Acopio.hostname();
    const sites = siteFoldersCache.slice();
    if (currentHost && !sites.some((f) => f.hostname === currentHost)) {
      sites.unshift({ hostname: currentHost, count: 0 });
    }
    sites.sort((a, b) => {
      if (a.hostname === currentHost) return -1;
      if (b.hostname === currentHost) return 1;
      return a.hostname.localeCompare(b.hostname);
    });

    addHeading("Sites");
    sites.forEach((folder) => {
      const host = folder.hostname;
      const isCurrentDest = !selectedCollectionId && effectiveHostname() === host;
      folderMenuEl.appendChild(
        buildFolderMenuItem(host, isCurrentDest, () => {
          selectCollectFolder(null, host, host);
          closeFolderMenu();
        }, "site", host)
      );
    });

    folderMenuEl.appendChild(Object.assign(document.createElement("div"), { className: "folder-menu-divider" }));

    addHeading("Folders");
    collectionsCache.forEach((c) => {
      folderMenuEl.appendChild(
        buildFolderMenuItem(c.name, selectedCollectionId === c.id, () => {
          selectCollectFolder(c.id, c.name, null);
          closeFolderMenu();
        }, "collection")
      );
    });

    folderMenuEl.appendChild(Object.assign(document.createElement("div"), { className: "folder-menu-divider" }));

    const form = document.createElement("div");
    form.className = "folder-menu-new-form";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "folder-menu-new-input";
    input.placeholder = "New folder name";
    input.maxLength = 60;
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); confirm(); }
      if (e.key === "Escape") { e.preventDefault(); closeFolderMenu(); }
    });
    input.addEventListener("click", (e) => e.stopPropagation());
    form.appendChild(input);
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "folder-menu-new-confirm";
    confirmBtn.innerHTML = Acopio.ICONS.plus;
    confirmBtn.title = "Create folder";
    confirmBtn.setAttribute("aria-label", "Create folder");
    const confirm = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      confirmBtn.disabled = true;
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        confirmBtn.disabled = false;
        showInlineError("Acopio didn't hear back — try again in a moment.");
      }, 8000);
      try {
        chrome.runtime.sendMessage({ type: "CREATE_COLLECTION", payload: { name } }, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          if (chrome.runtime.lastError || !response || !response.ok) {
            confirmBtn.disabled = false;
            showInlineError((response && response.error) || "Couldn't create that folder — try again.");
            return;
          }
          collectionsCache = [{ id: response.collection.id, name: response.collection.name }, ...collectionsCache.filter((c) => c.id !== response.collection.id)];
          selectCollectFolder(response.collection.id, response.collection.name, null);
          closeFolderMenu();
          showToast(`Created "${response.collection.name}" — collecting goes here`);
        });
      } catch (_) {
        settled = true;
        clearTimeout(timeoutId);
        confirmBtn.disabled = false;
        showInlineError("Acopio was reloaded — refresh this page to keep collecting.");
      }
    };
    confirmBtn.addEventListener("click", (e) => { e.stopPropagation(); confirm(); });
    form.appendChild(confirmBtn);
    folderMenuEl.appendChild(form);

    document.documentElement.appendChild(folderMenuEl);
    Acopio.registerOwnRoot(folderMenuEl);
    positionFolderMenu(folderBtn);
  }

  // Seed stack + remembered folder once content.js helpers are available.
  setTimeout(() => {
    Promise.all([getCollections(), getSiteFolders(), getLastFolder(Acopio.hostname())]).then(
      ([collections, siteFolders, lastId]) => {
        collectionsCache = collections || [];
        siteFoldersCache = siteFolders || [];
        if (lastId && collectionsCache.some((c) => c.id === lastId)) {
          selectedCollectionId = lastId;
          selectedDestinationHostname = null;
          const found = collectionsCache.find((c) => c.id === lastId);
          selectedFolderName = folderDisplayName((found && found.name) || siteFolderLabel());
        } else {
          selectedCollectionId = null;
          selectedDestinationHostname = Acopio.hostname();
          selectedFolderName = folderDisplayName(siteFolderLabel());
        }
        updateFolderBtnChrome();
        if (sessionCaptures.length === 0) {
          loadStackForCurrentFolder(() => {
            if (cardEl && currentTarget) refreshActionsInPlace();
          });
        }
      }
    );
  }, 0);
  // Set right after a successful collect, consumed the next time
  // buildStackPreview() runs (see there) so the newly-added card plays its
  // spring entrance exactly once, on the next tooltip that shows it.
  let pendingStackAnim = false;
  // Bumped on every render()/hide() — lets an in-flight async save (which
  // may resolve well after the user has moved on to a different element,
  // or dismissed the tooltip entirely) recognize it's stale and avoid
  // touching a cardEl that's no longer the one it started with.
  let generation = 0;

  // The most recent successful element-screenshot capture (see
  // captureElementPreview below) — reused at Collect time so the item gets
  // exactly the same crop the tooltip just showed instead of firing a
  // second captureVisibleTab call for the same element. Overwritten
  // wholesale by the next capture; there's only ever one live "current
  // hover" preview worth keeping around.
  let lastElementCapture = null; // { el, dataUrl }

  // Reference-counted, shared across every concurrent captureElementScreenshot
  // call — NOT one prevVisibility snapshot per call. Real, confirmed bug:
  // hovering across several elements in normal succession starts several
  // OVERLAPPING captures (a new one fires per settled hover, before the
  // previous one has finished its own round trip). Each call used to save
  // its own private "what was visibility before I hid it" snapshot — the
  // SECOND overlapping call reads that as "hidden" (the first call already
  // hid it moments earlier), not the true original "visible". Whichever
  // call finishes LAST then "restores" to whatever ITS OWN snapshot said,
  // which can be that corrupted "hidden" — leaving the tooltip/toolbar
  // permanently invisible even though nothing is capturing anymore.
  // Reproduced live on glean.com: the on-page outline appears on hover
  // (unaffected — it's applied directly to the page element, not to
  // Acopio's own host), but the tooltip card itself never shows again
  // after the first hover, because host.style.visibility was left stuck
  // at "hidden". A simple hide/show counter fixes this the same way any
  // shared-resource show/hide race is fixed: only the FIRST hide actually
  // records the true original state, and only the LAST matching restore
  // (count back to zero) actually applies it.
  let rootsHideCount = 0;
  let rootsTrueVisibility = null;

  // A full snapshot of what Collect would need to save — tagInfo, the
  // extracted data, oversize info — taken the moment the tooltip opens
  // (showFor/navigate), while the element is definitely still connected.
  // Some sites (Pinterest's virtualized masonry grid is the clearest real
  // case) remove and recreate the exact DOM node you hovered within a few
  // seconds — well inside the ordinary time it takes to read the tooltip
  // and move the cursor down to the Collect button. Without this,
  // completely unremarkable mouse travel alone turned a perfectly valid
  // capture into "This element changed — try again." onCollectClick falls
  // back to this if currentTarget is no longer connected by click time.
  let lastKnownCapture = null; // { el, tagInfo, data }

  // True when a capture came back with no real size/content to build from —
  // the signature of a live rect read landing AFTER the element visually
  // collapsed (0×0), NOT of a node that was actually removed from the DOM
  // (that's the separate el.isConnected check below). Confirmed live: a
  // hover-triggered dropdown/submenu stays technically connected and
  // "visible" by every other test, but its real box collapses to 0 the
  // instant the mouse leaves its trigger to travel toward Acopio's own
  // floating tooltip — which is exactly what happens between opening the
  // tooltip and clicking Collect. onCollectClick used to always prefer a
  // fresh re-read over the snapshot taken while the tooltip first opened,
  // so every capture from inside a dropdown/menu silently exported as an
  // empty 0×0 component (0 elements, "paste the HTML into html.to.design")
  // even though the tooltip had shown real content a second earlier.
  function isDegenerateCapture(tagInfo, data) {
    if (!data) return true;
    if (tagInfo.type === "component") return !data.boundingBoxWidth || !data.boundingBoxHeight || !data.layoutTree;
    if (tagInfo.type === "font") return !data.boundingBoxWidth || !data.boundingBoxHeight;
    if (tagInfo.type === "image") return !data.width || !data.height;
    return false; // color has no rect dependency to collapse
  }

  function ensureHost() {
    if (host) return;
    host = document.createElement("div");
    host.setAttribute("data-acopio-root", "true");
    // Keep the host itself out of layout/hit-testing; only the card inside
    // (via pointer-events: auto in the sheet) is ever clickable.
    host.style.cssText = "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;";
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = SHEET;
    shadow.appendChild(style);
    document.documentElement.appendChild(host);
    Acopio.registerOwnRoot(host);
  }

  Acopio.overlayHostNode = () => host;

  function clearOutline() {
    if (outlinedEl) {
      outlinedEl.style.outline = prevOutline;
      outlinedEl = null;
    }
  }

  function applyOutline(el) {
    clearOutline();
    outlinedEl = el;
    prevOutline = el.style.outline;
    el.style.outline = `1.5px dashed ${ACCENT}`;
    el.style.outlineOffset = "1px";
  }

  const selectorFor = Acopio.cssSelectorFor;

  function positionCard(anchorRect) {
    const margin = 10;
    const cardW = 280; // matches .card's width (border-box, so padding is already included)
    const cardH = cardEl.offsetHeight || 220;
    let left = anchorRect.right + margin;
    let top = anchorRect.top;

    if (left + cardW > window.innerWidth) {
      left = anchorRect.left - cardW - margin;
    }
    if (left < margin) {
      // Neither side fits comfortably (small viewport) — place below/above instead.
      left = Math.min(Math.max(anchorRect.left, margin), window.innerWidth - cardW - margin);
      top = anchorRect.bottom + margin;
      if (top + cardH > window.innerHeight) {
        top = anchorRect.top - cardH - margin;
      }
    }
    top = Math.min(Math.max(top, margin), window.innerHeight - cardH - margin);

    // Purely additive — only fires when the three branches above provably
    // have nowhere clear to put the card (the anchor itself is both wider
    // and taller than the viewport, e.g. a full-bleed hero section), so it
    // can't change where any already-working case lands. Without this, the
    // right/left/below/above fallbacks all end up clamping back onto the
    // element somewhere, which can land the card directly over the exact
    // content the user is about to collect — reported live: hovering a
    // full-viewport hero put the card over its own heading text. Pinning
    // to a fixed viewport corner in this one case is at least predictable,
    // rather than wherever clamping happens to fall.
    const anchorFillsViewport =
      anchorRect.width >= window.innerWidth - margin * 2 && anchorRect.height >= window.innerHeight - margin * 2;
    if (anchorFillsViewport) {
      left = window.innerWidth - cardW - margin;
      top = margin;
    }

    // A manual drag nudge (see cardDragOffset's own comment) applies on
    // top of the natural computed position, clamped the same way the
    // natural position already is — so a drag that happened to end near
    // an edge doesn't push the card off-screen if this same element gets
    // re-positioned again afterward (a nav-arrow click, a color pick).
    if (cardDragOffset) {
      left = Math.min(Math.max(left + cardDragOffset.dx, margin), window.innerWidth - cardW - margin);
      top = Math.min(Math.max(top + cardDragOffset.dy, margin), window.innerHeight - cardH - margin);
    }

    cardEl.style.left = `${left}px`;
    cardEl.style.top = `${top}px`;
  }

  // Precise, meaning-specific metric icons — matching the reference
  // tooltip's own icon language (small-A/big-A for size, overlined-A for
  // line-height, bracketed-A for letter-spacing, a plain ring for color)
  // instead of generic unicode arrows that don't actually depict what
  // they mean.
  // Exact icon language design-extractor's own tooltip uses (picker.js,
  // ICON_SIZE_D/ICON_LINE_HEIGHT_D/ICON_TRACKING_D) — a ↕ arrow, ≡ stacked
  // lines, ↔ arrow — not an approximation of it. Same viewBox/stroke-width
  // as the source, copied verbatim rather than redrawn from a description.
  const METRIC_ICONS = {
    fontSize: `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v11M4.5 3.5L7 1.5l2.5 2M4.5 10.5L7 12.5l2.5-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    lineHeight: `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1.5 3.5h11M1.5 7h11M1.5 10.5h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    letterSpacing: `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1.5 7h11M3.5 4.5L1.5 7l2 2.5M10.5 4.5L12.5 7l-2 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    ring: `<svg viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
    // Component-only metrics — a resize-corners glyph for the pixel size,
    // and stacked/nested squares for how many elements are inside it. Icons
    // were missing here (every other metric in the tooltip has one), and
    // "N children" is DOM jargon a designer may not immediately parse —
    // paired with this icon and reworded to "elements inside" it reads as
    // plain English instead.
    dimensions: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6V2h4M14 10v4h-4M2 2l4.5 4.5M14 14 9.5 9.5"/></svg>`,
    layers: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2" y="2" width="7" height="7" rx="1"/><rect x="7" y="7" width="7" height="7" rx="1"/></svg>`,
  };

  // "3 children" says how many but not what — the actual question a
  // designer has before collecting a container. Names the direct children
  // in plain terms instead (tag name alone is either DOM jargon too, or
  // ambiguous — a <div> tells you nothing), capped so a component with a
  // long list of rows doesn't turn into a wall of text.
  // Shared cap for any row of color/gradient-stop chips (a 6-stop gradient
  // or a text element with several distinctly-colored spans both need a
  // limit) — same "+N more" overflow pattern already used for the
  // "Contains:" chips and the session-capture stack, not a silent
  // slice(0, 2) that just drops the rest with no indication anything was
  // cut.
  const COLOR_CHIP_CAP = 6;
  function buildColorChipsHtml(hexes) {
    const shown = hexes.slice(0, COLOR_CHIP_CAP);
    let html = shown
      .map(
        (hex) => `
      <div class="gradient-stop">
        <span class="gradient-stop-swatch" style="background:${hex}"></span>
        <span class="gradient-stop-value">${hex}</span>
        <button type="button" class="copy-btn" data-copy="${hex}" title="Copy ${hex}" aria-label="Copy ${hex}">${Acopio.ICONS.copy}</button>
      </div>
    `
      )
      .join("");
    if (hexes.length > COLOR_CHIP_CAP) {
      html += `<div class="gradient-stop gradient-stop-overflow">+${hexes.length - COLOR_CHIP_CAP} more</div>`;
    }
    return html;
  }
  // The single-value counterpart to buildColorChipsHtml — same bordered
  // chip shape (swatch, hex, copy) as one gradient stop, used everywhere
  // a lone color value is shown so a single color and a multi-stop
  // gradient read as the same visual language, not two different ones.
  function buildColorChipEl(hex) {
    const chip = document.createElement("div");
    // -solo: a single color value gets more visual weight than one stop
    // in a multi-color gradient row — there's only one, and it's standing
    // in a spot (Text color / Background color) that otherwise reads as
    // cramped next to the roomier cards around it. Multi-stop gradients
    // keep the compact default (see .gradient-stops below) since several
    // of those side by side is exactly the case that got scaled down
    // earlier this session for being too bulky.
    chip.className = "gradient-stop gradient-stop-solo";
    chip.innerHTML = `<span class="gradient-stop-swatch" style="background:${hex}"></span><span class="gradient-stop-value">${hex}</span><button type="button" class="copy-btn" data-copy="${hex}" title="Copy ${hex}" aria-label="Copy ${hex}">${Acopio.ICONS.copy}</button>`;
    return chip;
  }

  const CHILD_TAG_LABELS = {
    img: "Image", picture: "Image", svg: "Icon",
    // Same "(GIF)" language the image-type tooltip already uses for a
    // hovered <video> (see the isVideo branch above) — an autoplay/loop
    // video standing in for an animated GIF file is what this element
    // being a <video> at all means in practice for a hover-capture tool,
    // not a general video file.
    video: "GIF",
    h1: "Heading", h2: "Heading", h3: "Heading", h4: "Heading", h5: "Heading", h6: "Heading",
    p: "Text", span: "Text",
    a: "Link", button: "Button", input: "Input", textarea: "Input", select: "Input", form: "Form",
    ul: "List", ol: "List", li: "List item", table: "Table",
  };
  // A generic wrapper (div, section — anything with no tag-level label of
  // its own) used to always fall back to a bare "Group", regardless of
  // what was actually inside it — a component with two photo cards and a
  // text block read as "Group, Group, Group", saying nothing. Peeking at
  // its own dominant content (the same heuristic componentIconFor already
  // uses for thumbnail icons) gives it a real label instead.
  function labelForChild(k) {
    const tag = k.tagName.toLowerCase();
    // A literal animated .gif file is still an <img> tag — indistinguishable
    // from a static photo by tag alone, hence "Contains: Image" for content
    // that's actually moving. Checked ahead of the generic img->Image
    // mapping, same file-extension signal content.js's own capture path
    // already uses to decide what got saved.
    if (tag === "img") {
      const src = Acopio.resolveImgSrc(k) || k.getAttribute("src") || "";
      if (/\.gif(\?|#|$)/i.test(src)) return "GIF";
    }
    if (CHILD_TAG_LABELS[tag]) return CHILD_TAG_LABELS[tag];
    const kind = Acopio.componentIconFor(k.outerHTML);
    if (kind === "image") return "Image";
    if (kind === "font") return "Text";
    return "Group";
  }
  // Tints each "Contains:" chip (and the font family tag) using the same
  // 4 established type colors already used everywhere else in the product
  // (the type-icon badges) — not new colors invented per label. Every
  // child label maps onto whichever of the 4 it's actually closest to;
  // there's no 5th category, so structural stuff (links, lists, forms,
  // inputs, groups) reads as "component" — the same bucket the type
  // detector itself would put them in if you hovered them directly.
  const CHIP_KIND = {
    Image: "image", Icon: "image", GIF: "image",
    Heading: "font", Text: "font",
  };
  function chipKindFor(label) {
    return CHIP_KIND[label] || "component";
  }
  function describeChildren(el) {
    return Array.from(el.children).map((k) => ({ el: k, label: labelForChild(k) }));
  }

  // A real screenshot of exactly this element, cropped from a full-viewport
  // capture — the honest fix for a component preview that used to only ever
  // show "the first <img> found inside it" (nothing for a pure-text/UI
  // component, and a mismatch against the Contains: chips whenever a
  // component had both text AND a photo — the chips listed both, the
  // preview showed only the photo). Best-effort and silent on failure: an
  // element scrolled out of the viewport, a restricted page, or Chrome's
  // own capture rate limit all just leave whatever buildTypeBody already
  // rendered synchronously in place, never an error the user has to see for
  // what is fundamentally a nice-to-have upgrade over that fallback.
  // Core screenshot mechanics as a promise — usable both from the passive
  // hover-triggered preview below (which also updates the tooltip's own
  // thumb) AND from an on-demand call at copy-click time when neither a
  // hover capture nor a stored previewImage already exists (see
  // resolveCopyImageBlob's component branch: "why am I not able to copy
  // image?" turned out to be exactly that — the copy button had no viable
  // fallback and just silently produced a text-only clipboard write. The
  // element is still on screen at click time, same as it was on hover —
  // there's no real reason copying has to depend on an earlier capture
  // having already happened to succeed).
  // `purpose: "preview"` marks this as the passive, hover-triggered
  // capture — cancellable server-side (background.js) the instant a newer
  // hover supersedes it, so a queue backed up with stale preview requests
  // can never delay the one that still matters. Omitted (the last-resort
  // capture inside resolveCopyImageBlob, fired by an explicit Copy click)
  // always runs for real — confirmed live as the actual root cause of a
  // real reported bug: copying a component after a few seconds of normal
  // hovering-around-the-page still pasted as plain text with no image,
  // because that copy-click capture was stuck behind a pile of preview
  // requests for elements the user had already moved past.
  function captureElementScreenshot(el, purpose) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return Promise.resolve(null);
    if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return Promise.resolve(null);
    // Acopio renders more than just this tooltip on the page — the
    // floating toolbar pill (toolbar.js) is a second, separately-positioned
    // surface that's just as real and on-screen as the tooltip is. Hiding
    // every registered Acopio root (Acopio.ownRoots) instead of naming
    // individual elements one at a time (confirmed live: the toolbar's own
    // "+" glyph baked into a capture before this covered it too).
    // visibility (not display:none, which could shift layout elsewhere) —
    // hidden for the ~1 frame the capture needs, restored either way.
    // Double rAF, not a single one: one rAF only guarantees "about to
    // paint," not "has painted" — captureVisibleTab can still win that
    // race and capture the pre-hide frame with just one.
    const roots = Acopio.ownRoots.filter((r) => {
      if (!r || !r.style) return false;
      // Passive hover previews crop the hovered element only — the tooltip
      // sits beside it and the floating toolbar is elsewhere. Hiding Acopio
      // roots for every preview made the open tooltip/toolbar visibly blink.
      if (purpose === "preview") return false;
      return true;
    });
    // Only the FIRST concurrent hide records the true original state — see
    // rootsHideCount/rootsTrueVisibility above for why a per-call snapshot
    // was wrong. A later overlapping call reading roots that are already
    // hidden must never mistake "hidden" for the real original value.
    if (rootsHideCount === 0) {
      rootsTrueVisibility = roots.map((r) => r.style.visibility);
    }
    rootsHideCount += 1;
    roots.forEach((r) => { r.style.visibility = "hidden"; });
    // Idempotent — called as soon as a response arrives (don't make the
    // tooltip/toolbar wait through image decode + canvas encode just to
    // reappear) AND, separately, from the timeout guard below if no
    // response ever arrives at all. Guards against THIS call's own restore
    // firing twice; the shared counter below guards against restoring
    // early while a DIFFERENT concurrent call still needs roots hidden.
    let visibilityRestored = false;
    const restoreVisibility = () => {
      if (visibilityRestored) return;
      visibilityRestored = true;
      rootsHideCount = Math.max(0, rootsHideCount - 1);
      if (rootsHideCount === 0 && rootsTrueVisibility) {
        roots.forEach((r, i) => { if (r) r.style.visibility = rootsTrueVisibility[i]; });
        rootsTrueVisibility = null;
      }
    };
    return new Promise((resolve) => {
      // Guaranteed to settle exactly once, even if the CAPTURE_VISIBLE_TAB
      // response never arrives at all — a real, confirmed MV3 failure mode:
      // the background service worker can be suspended by Chrome mid-
      // request (most likely to happen exactly when captures are firing
      // back to back, hovering from element to element, which is also
      // exactly when this function is called most often). Without this,
      // roots stay visibility:hidden FOREVER when that happens — Acopio's
      // own tooltip and toolbar silently vanish (the DOM node is still
      // there, "open," just invisible), matching the reported "tooltip is
      // open but not showing anywhere, needs a refresh to work again."
      // captureVisibleTab is Chrome-rate-limited to ~2/sec, so a real
      // response almost always lands well inside this window; a genuinely
      // hung request still recovers visibility instead of losing it.
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        restoreVisibility();
        resolve(result);
      };
      const timeoutId = setTimeout(() => finish(null), 4000);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // sendMessage throws synchronously (not just an async lastError)
          // when the extension context has been invalidated — reloading
          // the extension while this page was already open, most commonly.
          try {
            chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB", purpose }, (response) => {
              restoreVisibility(); // as soon as we have any response — don't wait on image decode below
              if (chrome.runtime.lastError || !response || !response.ok) {
                // Silent to the UI on purpose (a nice-to-have upgrade over
                // the best-effort fallback, not a required feature).
                // "superseded by a newer hover" is an expected race when the
                // pointer moves on before captureVisibleTab returns — not a
                // real failure, so don't noise the console with it.
                const errMsg =
                  (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
                  (response && response.error) ||
                  "unknown error";
                if (!String(errMsg).includes("superseded")) {
                  console.error("[Acopio] screenshot failed:", errMsg);
                }
                finish(null);
                return;
              }
              const img = new Image();
              img.onload = () => {
                const dpr = window.devicePixelRatio || 1;
                // Clamp the crop to whatever part of the element is
                // actually on-screen — captureVisibleTab only has pixels
                // for the viewport, not whatever's scrolled past its edges.
                const cropLeft = Math.max(0, rect.left);
                const cropTop = Math.max(0, rect.top);
                const sx = cropLeft * dpr;
                const sy = cropTop * dpr;
                const sw = (Math.min(rect.right, window.innerWidth) - cropLeft) * dpr;
                const sh = (Math.min(rect.bottom, window.innerHeight) - cropTop) * dpr;
                if (sw <= 0 || sh <= 0) return finish(null);
                // Cap the OUTPUT size — a full-page hero section shouldn't
                // turn into a multi-megabyte STORED dataURL just because
                // the source screenshot is high-DPI; downscale
                // proportionally past this width. Only for the small,
                // passive in-tooltip preview thumbnail (purpose ===
                // "preview") — that's a real, deliberate size/storage
                // trade-off for a thumbnail nobody zooms into. Real,
                // confirmed bug this used to also apply to: the SAME cap
                // and the SAME lossy JPEG re-encode below were being used
                // for the explicit Copy action too, silently downscaling
                // and re-compressing whatever you actually meant to copy
                // and paste somewhere — confirmed live pasting a captured
                // 862×551 component came through as a 257KB image, well
                // under what that resolution should need. Anything that
                // isn't the passive preview (the last-resort capture
                // resolveCopyImageBlob fires, or a future non-preview
                // caller) gets the real captured resolution, uncapped.
                const MAX_W = purpose === "preview" ? 480 * dpr : Infinity;
                const outW = Math.min(sw, MAX_W);
                const outH = outW * (sh / sw);
                const canvas = document.createElement("canvas");
                canvas.width = outW;
                canvas.height = outH;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
                try {
                  // JPEG (lossy, but small) for the passive preview
                  // thumbnail only. Anything else gets a real lossless
                  // PNG straight off the canvas — no compression artifact,
                  // no second lossy generation when urlToPngBlob later
                  // re-encodes it (a PNG source there is returned as-is,
                  // not re-processed at all).
                  finish(purpose === "preview" ? canvas.toDataURL("image/jpeg", 0.85) : canvas.toDataURL("image/png"));
                } catch (_) {
                  finish(null); // fail closed — never surface a canvas error for a nice-to-have preview
                }
              };
              img.onerror = () => finish(null);
              img.src = response.dataUrl;
            });
          } catch (_) {
            // Extension context invalidated — same as everywhere else this
            // is guarded, silently give up rather than throw inside
            // render()/copyForPaste and break the tooltip/copy action.
            finish(null);
          }
        });
      });
    });
  }

  function captureElementPreview(el, myGeneration) {
    if (!cardEl) return;
    captureElementScreenshot(el, "preview").then((dataUrl) => {
      if (!dataUrl) return;
      if (myGeneration !== generation || !cardEl) return;
      lastElementCapture = { el, dataUrl };
      const existingThumb = cardEl.querySelector(".component-preview-thumb");
      const freshImg = document.createElement("img");
      freshImg.className = "thumb component-preview-thumb";
      freshImg.src = dataUrl;
      if (existingThumb) {
        existingThumb.replaceWith(freshImg);
      } else {
        // No best-effort thumb existed yet (a pure-text/UI component, or a
        // font/button item — neither has an <img>/<video> of its own
        // already in the body) — this is the first and only preview it'll
        // get, inserted at the top of the body content, same spot the
        // existing-img case already uses.
        const swatchCard = document.createElement("div");
        swatchCard.className = "image-swatch-card";
        swatchCard.style.marginTop = "var(--space-3)";
        swatchCard.appendChild(freshImg);
        const bodyEl = cardEl.querySelector(".type-body");
        if (bodyEl) bodyEl.insertAdjacentElement("afterbegin", swatchCard);
      }
    });
  }

  function buildTypeBody(el, tagInfo, style) {
    const frag = document.createElement("div");
    // Stable anchor for captureElementPreview's fallback insertion below —
    // that function used to target cardEl's own ".row", back when the
    // headline lived in the body. It now lives in .selector-row instead
    // (see render()'s header restructuring), so ".row" still matches
    // something, just the wrong one — the compact header row, not this
    // body — which silently misdirected the preview into the header as a
    // tiny badge (confirmed live: exactly what showed up for both a
    // pure-text component and a captured button). class="type-body" is a
    // fixed, type-agnostic handle directly on the body content itself, so
    // that insertion point can't drift again if the header changes shape.
    frag.className = "type-body";

    if (tagInfo.type === "color") {
      const bg = style.backgroundColor;
      const parsed = Acopio.rgbToHex(bg);
      const hex = parsed ? parsed.hex : "n/a";
      // A gradient background carries multiple real colors, not one — a
      // button/hero block with a two- or three-stop gradient was always
      // reduced to a single flat swatch (whichever color
      // getComputedStyle(el).backgroundColor happened to report, often
      // just a fallback, not any actual stop). Each stop gets its own
      // swatch + hex + copy button instead, same as design-extractor's own
      // "Gradient (N stops)" card.
      const gradientStops = Acopio.parseGradientStops(style.backgroundImage);
      if (gradientStops.length >= 2) {
        frag.innerHTML = `
          <div class="color-swatch-card">
            <div class="color-swatch-top" style="background:${Acopio.escapeHtml(style.backgroundImage)}"></div>
            <div class="color-swatch-body">
              <div class="color-swatch-caption">Gradient (${gradientStops.length} stops)</div>
              <div class="gradient-stops">${buildColorChipsHtml(gradientStops)}</div>
            </div>
          </div>
        `;
      } else {
        frag.innerHTML = `
          <div class="color-swatch-card">
            <div class="color-swatch-top" style="background:${parsed ? parsed.hex : "#ccc"}"></div>
            <div class="color-swatch-body">
              <div class="color-swatch-caption">Background color</div>
            </div>
          </div>
        `;
        // Same bordered gradient-stop chip shape as everywhere else a color
        // value shows — a single color and a multi-stop gradient now read
        // as one visual language instead of two (this used to be a
        // borderless .color-swatch-value-row, the one spot left that
        // hadn't been brought in line with buildColorChipEl).
        frag.querySelector(".color-swatch-body").appendChild(buildColorChipEl(hex));
      }
    } else if (tagInfo.type === "font") {
      // The first entry in a computed font-family stack is often a generic
      // system keyword (-apple-system, BlinkMacSystemFont, system-ui), not
      // a real font name a designer would recognize — showing that raw
      // string as the tooltip's big headline reads as a bug, not a font.
      const rawFamily = style.fontFamily.split(",")[0].replace(/['"]/g, "").trim();
      const SYSTEM_FONT_KEYWORDS = new Set(["-apple-system", "blinkmacsystemfont", "system-ui", "-webkit-standard"]);
      const family = Acopio.escapeHtml(
        SYSTEM_FONT_KEYWORDS.has(rawFamily.toLowerCase()) ? "System font" : rawFamily
      );
      // Headline is always the font family name — the family-tag pill
      // further down ("Heading"/"Body"/"Button"/"Other") is what already
      // says which role this is, for every one of the four classifications
      // including button. An earlier version made the button case special
      // (headline "Button", font name demoted to a caption) specifically to
      // lead with the role — but that pill still renders "Button" right
      // underneath regardless, so it said "Button" twice on screen with no
      // new information the second time. One rule for all four keeps it to
      // one "say it once" reading, matching the same principle already
      // applied to Component's own "Contains:" line below.
      // getComputedStyle(el).color only ever reports THIS element's own
      // text color — a heading with a de-emphasized nested span ("Glean
      // connects **knowledge**, systems...") genuinely has two colors on
      // screen, but hovering the outer heading only ever surfaced the
      // first. A quick pass over direct text-bearing children catches the
      // common "one or two inline spans styled differently" case (not a
      // full per-character scan) and shows both hexes instead of silently
      // reporting only whichever one the outer element happens to have.
      // Dedupe AFTER converting to hex, not on the raw rgb()/rgba() string
      // — rgbToHex drops alpha, so e.g. rgb(0,0,0) on the element itself
      // and rgba(0,0,0,0.9) on a slightly-muted child span (a common real
      // pattern) are two distinct strings that resolve to the identical
      // #000000, and deduping on the string first was showing that as
      // "two colors" with two identical swatch chips.
      const colorHexes = Array.from(
        new Set(
          [style.color, ...Array.from(el.children)
            .filter((c) => (c.textContent || "").trim().length > 0)
            .map((c) => window.getComputedStyle(c).color)]
            .map((c) => Acopio.rgbToHex(c))
            .filter(Boolean)
            .map((p) => p.hex)
        )
      );
      const colorTitle = colorHexes.length > 1 ? `Multiple colors detected: ${colorHexes.join(", ")}` : "";
      frag.innerHTML = `
        <div class="row"><div class="type-icon type-icon-font">${Acopio.ICONS.font}</div><div class="headline">${family}</div></div>
        <div class="metrics">
          <div class="metric"><span class="icon">${METRIC_ICONS.fontSize}</span>${parseFloat(style.fontSize).toFixed(0)}px</div>
          <div class="metric"><span class="icon">${METRIC_ICONS.lineHeight}</span>${parseFloat(style.lineHeight) ? parseFloat(style.lineHeight).toFixed(0) + "px" : "normal"}</div>
          <div class="metric"><span class="icon">${METRIC_ICONS.letterSpacing}</span>${style.letterSpacing === "normal" ? "0" : parseFloat(style.letterSpacing).toFixed(1)}px</div>
        </div>
      `;
      // A button is a real, visually distinct on-page shape — padding,
      // corner radius, an icon, maybe a gradient — that the typography
      // metrics and color swatches below say nothing about. Reuses the
      // exact same real-screenshot mechanism the "component" type already
      // gets (captureElementPreview inserts its own thumb right after the
      // headline row once the capture resolves) rather than inventing a
      // second, weaker preview path — a button classification is just as
      // visual as a component, so it earns the same honest preview.
      if (tagInfo.family === "button") {
        captureElementPreview(el, generation);
      }
      // A plain outline ring icon + hex text, crammed into the same row as
      // three unrelated size metrics, was the one place left still using
      // the old flat treatment while everywhere else (the color type card,
      // gradient stops, the background block below) got a real filled
      // swatch + copy button. Text color gets its own row instead, same
      // swatch+value+copy language as those, not squeezed in as a fourth
      // same-size metric.
      // A button (or any text element) with a gradient or solid background
      // used to have that background silently dropped — this element is
      // classified as font/button on purpose (the label is the primary
      // thing you're capturing), but a gradient "Unlock report" button
      // genuinely has a second real design value worth seeing, not just
      // its white text color.
      const bgGradientStops = Acopio.parseGradientStops(style.backgroundImage);
      const bgParsed = Acopio.rgbToHex(style.backgroundColor);
      const hasSolidBg = bgParsed && style.backgroundColor !== "rgba(0, 0, 0, 0)";

      // Single text color + single solid background is the common case —
      // sit side by side as two bordered chips (the same shape as a
      // gradient stop: swatch, hex, copy — not the old borderless single
      // row), instead of two full-width stacked sections each with their
      // own caption eating vertical space. Multi-stop gradients still get
      // their own full-width section below (a 6-chip grid doesn't fit
      // next to anything).
      if (colorHexes.length === 1 && hasSolidBg) {
        const row = document.createElement("div");
        row.className = "color-pair-row";
        const textCol = document.createElement("div");
        textCol.className = "color-pair-col";
        textCol.innerHTML = `<div class="color-swatch-caption">Text</div>`;
        textCol.appendChild(buildColorChipEl(colorHexes[0]));
        const bgCol = document.createElement("div");
        bgCol.className = "color-pair-col";
        bgCol.innerHTML = `<div class="color-swatch-caption">Background</div>`;
        bgCol.appendChild(buildColorChipEl(bgParsed.hex));
        row.appendChild(textCol);
        row.appendChild(bgCol);
        frag.appendChild(row);
      } else {
        if (colorHexes.length) {
          const textColorBlock = document.createElement("div");
          textColorBlock.className = "bg-swatch-block";
          const textColorCaption = document.createElement("div");
          textColorCaption.className = "color-swatch-caption";
          textColorCaption.textContent = "Text color";
          textColorBlock.appendChild(textColorCaption);
          if (colorHexes.length === 1) {
            textColorBlock.appendChild(buildColorChipEl(colorHexes[0]));
          } else {
            // Two+ colors — each one gets its OWN swatch+hex+copy chip,
            // same as the gradient stops (every swatch used to be grouped
            // on the left with every hex grouped separately on the right,
            // instead of each swatch paired with the value it belongs to).
            const stopsWrap = document.createElement("div");
            stopsWrap.className = "gradient-stops";
            if (colorTitle) stopsWrap.title = colorTitle;
            stopsWrap.innerHTML = buildColorChipsHtml(colorHexes);
            textColorBlock.appendChild(stopsWrap);
          }
          frag.appendChild(textColorBlock);
        }
        if (hasSolidBg) {
          const bgBlock = document.createElement("div");
          bgBlock.className = "bg-swatch-block";
          const label = document.createElement("div");
          label.className = "color-swatch-caption";
          label.textContent = "Background color";
          bgBlock.appendChild(label);
          bgBlock.appendChild(buildColorChipEl(bgParsed.hex));
          frag.appendChild(bgBlock);
        }
      }
      if (bgGradientStops.length >= 2) {
        const bgBlock = document.createElement("div");
        bgBlock.className = "bg-swatch-block";
        const label = document.createElement("div");
        label.className = "color-swatch-caption";
        label.textContent = `Background gradient (${bgGradientStops.length} stops)`;
        bgBlock.appendChild(label);
        const stopsWrap = document.createElement("div");
        stopsWrap.className = "gradient-stops";
        stopsWrap.innerHTML = buildColorChipsHtml(bgGradientStops);
        bgBlock.appendChild(stopsWrap);
        frag.appendChild(bgBlock);
      }
      // The Heading/Body/Button/Other classification sits right in the
      // headline row, immediately after the font name — it used to only
      // appear as a separate pill well below the metrics, disconnected
      // from the name it's actually classifying. Only the compact,
      // single-tag state moves up here; the expanded 4-option picker (once
      // you click to correct it) stays below, where there's room for it.
      if (!pillsExpanded) {
        const FAMILY_LABEL = { heading: "Heading", body: "Body", button: "Button", other: "Other" };
        const inlineTag = document.createElement("button");
        inlineTag.type = "button";
        inlineTag.className = "family-tag family-tag-inline";
        inlineTag.textContent = FAMILY_LABEL[tagInfo.family] || "Other";
        inlineTag.title = "Click to correct the detected category";
        inlineTag.setAttribute("aria-label", `Detected as ${FAMILY_LABEL[tagInfo.family] || "Other"} — click to change`);
        inlineTag.addEventListener("click", (e) => {
          e.stopPropagation();
          pillsExpanded = true;
          render();
        });
        frag.querySelector(".row").appendChild(inlineTag);
      }
    } else if (tagInfo.type === "image") {
      // el itself might be a decorated wrapper (gradient tint, hover
      // scrim) around the real photo rather than the photo itself — the
      // same resolution isImageish used to classify it this way in the
      // first place (Acopio.findRealMediaChild). Without this, hovering
      // one of these showed the wrapper's own (often blank, sometimes
      // gradient-tinted) background instead of the actual photo — visible
      // only after clicking into wherever the real bare <img> renders on
      // its own, uncovered.
      const mediaEl = /^(img|video)$/.test(el.tagName.toLowerCase()) ? el : Acopio.findRealMediaChild(el) || el;
      const tag = mediaEl.tagName.toLowerCase();
      const isImgTag = tag === "img";
      const isVideoTag = tag === "video";
      // SVG's own <image> leaf element (isImageish, tagger.js) — no
      // .src/.naturalWidth the way HTML's <img> has (see
      // resolveSvgImageHref); a bounding-box read stands in for
      // naturalWidth/Height since SVG elements don't carry offsetWidth/
      // Height either (that's an HTMLElement-only property).
      const isSvgImageTag = tag === "image";
      // Fourth case — a CSS background-image div (a hero banner, product
      // photo used as a background rather than a real <img>). isImageish
      // (tagger.js) already recognizes these as images; this preview used
      // to only handle actual <img>/<video> tags, so hovering one of these
      // showed "Image" with no thumbnail at all — silently blank, which is
      // what "hovering the image but it's not visible in the tooltip" was.
      // Same URL-extraction regex content.js's own capture path already
      // uses, so the preview shown here matches what actually gets saved.
      const style2 = isImgTag || isVideoTag || isSvgImageTag ? null : window.getComputedStyle(mediaEl);
      const bgUrlMatch = style2 ? style2.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/) : null;
      // resolveVideoOrPoster may downgrade isVideo to false (MSE/HLS blob:
      // src with no way to render a copy elsewhere — see there); the label
      // and which element gets built below both follow that resolved
      // value, not the bare tag check, so the tooltip never claims "(GIF)"
      // for something it's actually about to save as a plain photo.
      const videoResolved = isVideoTag ? Acopio.resolveVideoOrPoster(mediaEl) : null;
      const isVideo = videoResolved ? videoResolved.isVideo : false;
      const svgRect = isSvgImageTag ? mediaEl.getBoundingClientRect() : null;
      const src = isImgTag
        ? Acopio.resolveImgSrc(mediaEl) || ""
        : videoResolved
          ? videoResolved.url || ""
          : isSvgImageTag
            ? Acopio.resolveSvgImageHref(mediaEl) || ""
            : bgUrlMatch ? bgUrlMatch[1] : "";
      const w = isVideoTag ? mediaEl.videoWidth || mediaEl.offsetWidth : isImgTag ? mediaEl.naturalWidth || mediaEl.offsetWidth : isSvgImageTag ? svgRect.width : mediaEl.offsetWidth;
      const h = isVideoTag ? mediaEl.videoHeight || mediaEl.offsetHeight : isImgTag ? mediaEl.naturalHeight || mediaEl.offsetHeight : isSvgImageTag ? svgRect.height : mediaEl.offsetHeight;
      // A literal animated .gif FILE (a real <img src="....gif">, as
      // opposed to the autoplay-<video>-standing-in-for-a-gif case isVideo
      // already covers above) is still just an "img" tag by every DOM
      // signal — same file-extension check labelForChild (below) already
      // uses for the "Contains:" chip case, applied here too so a direct
      // hover on one says "Image (GIF)" instead of a plain, misleadingly
      // static-sounding "Image".
      const isGifFile = isImgTag && /\.gif(\?|#|$)/i.test(src);
      frag.innerHTML = `
        <div class="row"><div class="type-icon type-icon-image">${Acopio.ICONS.image}</div><div class="headline">${isVideo || isGifFile ? "Image (GIF)" : "Image"}</div><div class="headline-meta">${Math.round(w)}×${Math.round(h)}px</div></div>
      `;
      // Kept as a direct reference (not re-queried later) — src's own
      // upgradeImageUrl (shared.js) may point this at a genuinely bigger
      // file than the one currently sitting in the page's DOM (Pinterest's
      // grid thumbnails are a real-world example: the page's own <img> is
      // a small preview, but the URL Acopio actually resolves — and would
      // save — is the full-resolution original). The w×h shown above comes
      // from the PAGE's <img>, since that's the only thing synchronously
      // known at render time; once the upgraded preview image actually
      // loads, its real naturalWidth/Height replaces that number, so the
      // tooltip never shows a smaller resolution than what Collect would
      // actually save.
      const headlineMetaEl = frag.querySelector(".headline-meta");
      // Built as real elements (not interpolated into the innerHTML string
      // above) — a src pulled from CSS or currentSrc shouldn't be trusted
      // as safe markup to splice into an HTML string, and video attributes
      // (autoplay/muted/loop) are easy to get subtly wrong when serialized
      // as text anyway. Set as real DOM properties/attributes instead.
      if (src && isVideo) {
        const swatchCard = document.createElement("div");
        swatchCard.className = "image-swatch-card";
        const video = document.createElement("video");
        video.className = "thumb";
        video.src = src;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        swatchCard.appendChild(video);
        frag.appendChild(swatchCard);
      } else if (src) {
        const swatchCard = document.createElement("div");
        swatchCard.className = "image-swatch-card";
        const img = document.createElement("img");
        img.className = "thumb";
        img.src = src;
        Acopio.withPinterestFallback(img, src);
        const myGeneration = generation;
        img.addEventListener("load", () => {
          if (myGeneration !== generation || !headlineMetaEl.isConnected) return;
          if (img.naturalWidth && img.naturalHeight) {
            headlineMetaEl.textContent = `${img.naturalWidth}×${img.naturalHeight}px`;
          }
        });
        swatchCard.appendChild(img);
        frag.appendChild(swatchCard);
      }
    } else {
      const rect = el.getBoundingClientRect();
      const children = describeChildren(el);
      // Dimensions sit as a tag right after "Component" in the headline —
      // same inline-tag treatment the font type's Heading/Body/Button/
      // Other classification got, instead of a separate one-line metrics
      // row underneath with its own icon for a single value.
      frag.innerHTML = `
        <div class="row"><div class="type-icon type-icon-component">${Acopio.ICONS.component}</div><div class="headline">Component</div><span class="family-tag family-tag-inline dimensions-tag">${Math.round(rect.width)}×${Math.round(rect.height)}px</span></div>
      `;
      // A component that's dominated by a real photo (a card, a hero
      // block) used to only ever show the generic two-squares icon and a
      // text list saying "Contains: Image, Text" — you'd have to already
      // know it had a photo in it. The image type gets a real thumbnail;
      // this gives a component one too when it actually contains one,
      // instead of describing it in words only.
      const previewImg = el.querySelector("img, video");
      const previewSrc = previewImg
        ? previewImg.tagName.toLowerCase() === "video"
          ? Acopio.videoSrcFor(previewImg)
          : Acopio.resolveImgSrc(previewImg)
        : null;
      if (previewSrc) {
        // No separate caption here — the "Image" chip in "Contains:" below
        // already says this exists; a redundant label above the thumbnail
        // was saying it twice.
        const swatchCard = document.createElement("div");
        swatchCard.className = "image-swatch-card";
        swatchCard.style.marginTop = "var(--space-3)";
        const thumb = document.createElement(previewImg.tagName.toLowerCase() === "video" ? "video" : "img");
        // component-preview-thumb: the real captureElementPreview screenshot
        // (below) swaps THIS element out once it resolves — this extracted
        // <img>/<video> is only ever the instant, synchronous placeholder.
        thumb.className = "thumb component-preview-thumb";
        thumb.src = previewSrc;
        Acopio.withPinterestFallback(thumb, previewSrc); // no-op for video / non-Pinterest src
        if (thumb.tagName === "VIDEO") {
          thumb.autoplay = true;
          thumb.loop = true;
          thumb.muted = true;
          thumb.playsInline = true;
        }
        swatchCard.appendChild(thumb);
        frag.appendChild(swatchCard);
      }
      // Kick off the real screenshot regardless of whether previewSrc found
      // anything — a pure-text/UI component (no img/video at all) still
      // deserves a real preview, not just the generic two-squares icon it'd
      // otherwise be stuck with. cardEl doesn't have this frag's contents
      // attached yet (render() does that right after buildTypeBody
      // returns), which is fine — captureElementPreview's own response
      // callback only runs later, well after that's happened.
      captureElementPreview(el, generation);
      if (children.length === 0) {
        const emptyRow = document.createElement("div");
        emptyRow.className = "metric metric-prose";
        emptyRow.style.marginTop = "var(--space-2)";
        emptyRow.innerHTML = `<span class="icon">${METRIC_ICONS.layers}</span>Empty — no elements inside`;
        frag.appendChild(emptyRow);
      } else {
        const containsRow = document.createElement("div");
        containsRow.className = "contains-row";
        const label = document.createElement("span");
        label.className = "metric metric-prose child-label";
        label.innerHTML = `<span class="icon">${METRIC_ICONS.layers}</span>Contains:`;
        containsRow.appendChild(label);

        const chipsWrap = document.createElement("div");
        chipsWrap.className = "contains-chips";
        const CAP = 6;
        // Each chip jumps straight to that specific child and re-renders
        // for it — the actual answer to "I can collect the whole group,
        // but how do I collect exactly the one thing inside it?".
        children.slice(0, CAP).forEach(({ el: childEl, label: childLabel }) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = `contains-chip contains-chip-${chipKindFor(childLabel)}`;
          chip.textContent = childLabel;
          chip.title = `Jump to this ${childLabel.toLowerCase()} to collect just that piece`;
          chip.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!childEl.isConnected) {
              showInlineError("This element changed — try again.");
              return;
            }
            currentTarget = childEl;
            currentTagInfo = childEl.tagName.toLowerCase() === "iframe"
              ? { type: "component", family: "other" }
              : Acopio.detectTag(childEl);
            pillsExpanded = false;
            noteValue = ""; // same reason as navigate() — a different element, not a carried-over note
            render();
          });
          chipsWrap.appendChild(chip);
        });
        if (children.length > CAP) {
          const overflow = document.createElement("span");
          overflow.className = "contains-chip contains-chip-overflow";
          overflow.textContent = `+${children.length - CAP} more`;
          chipsWrap.appendChild(overflow);
        }
        containsRow.appendChild(chipsWrap);
        frag.appendChild(containsRow);
      }
    }
    // One wiring pass, after every branch above has finished building —
    // every .copy-btn (color card, gradient stops, text-color block,
    // background block) already exists in frag by this point regardless
    // of which branch ran, so there's no need for each branch to attach
    // its own identical listener separately.
    frag.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const text = btn.dataset.copy;
        navigator.clipboard.writeText(text).then(() => {
          const original = btn.innerHTML;
          btn.innerHTML = Acopio.ICONS.check;
          btn.classList.add("is-copied");
          setTimeout(() => {
            btn.innerHTML = original;
            btn.classList.remove("is-copied");
          }, 1200);
        }).catch(() => {});
      });
    });
    return frag;
  }

  const BADGE_LABEL = { color: "C", font: "T", image: "I" };

  // The preview zone's fill: for a captured color, use the actual hex —
  // the curved band becomes a genuinely large, prominent swatch instead of
  // a decorative strip, which is a real functional upgrade, not just
  // visual polish. Every other type gets a neutral light backdrop.
  function previewFill(tagInfo, style) {
    if (tagInfo.type === "color") {
      const parsed = Acopio.rgbToHex(style.backgroundColor);
      return parsed ? parsed.hex : "#e5e7eb";
    }
    return "#f1f2f4";
  }

  // The curved band itself. A single smooth wave (two mirrored cubic
  // béziers), not a straight-cut divider — the specific structural detail
  // from the reference card. Deepest point sits under the badge (left:16,
  // width:34 → center ≈ x=33) so the icon visually reads as sitting astride
  // the curve, half in the colored band and half in the white body below.
  function buildPreviewZone(fill) {
    const wrap = document.createElement("div");
    wrap.className = "preview-zone";
    wrap.innerHTML = `
      <svg viewBox="0 0 280 58" preserveAspectRatio="none">
        <path d="M0,0 H280 V14 C240,14 215,46 165,48 C115,50 95,20 55,20 C35,20 15,26 0,40 Z" fill="${fill}"></path>
      </svg>
    `;
    return wrap;
  }

  // One small thumbnail per captured item in the session stack. Reuses the
  // same per-type visual language as the main tooltip body (swatch for
  // color, sample glyph for font, real thumbnail for image, generic icon
  // for component) at a much smaller size — DOM-built, not string-based,
  // since item.note/selector could in principle contain characters that'd
  // need escaping in an innerHTML template and there's no reason to take
  // that risk for a purely decorative thumbnail.
  function buildMiniThumb(item, animateIn) {
    const card = document.createElement("div");
    card.className = animateIn ? "stack-card is-entering" : "stack-card";
    card.title = item.selector || item.type;
    if (item.type === "color") {
      card.style.background = (item.data && item.data.hex) || "#ccc";
    } else if (item.type === "font") {
      const label = document.createElement("span");
      label.className = "mini-font";
      label.textContent = "Aa";
      label.style.fontFamily = (item.data && item.data.fallbackStack) || "sans-serif";
      card.appendChild(label);
    } else if (item.type === "image" && item.data && item.data.url && item.data.isVideo) {
      const video = document.createElement("video");
      video.src = item.data.url;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      card.appendChild(video);
    } else if (item.type === "image" && item.data && item.data.url) {
      const img = document.createElement("img");
      img.src = item.data.url;
      Acopio.withPinterestFallback(img, item.data.url);
      img.alt = "";
      card.appendChild(img);
    } else if (item.data && item.data.previewImage) {
      // A component captured with a real screenshot (captureElementPreview)
      // — the same crop the tooltip showed while you were collecting it,
      // not a generic icon.
      const img = document.createElement("img");
      img.src = item.data.previewImage;
      img.alt = "";
      card.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "mini-icon";
      const kind = Acopio.componentIconFor(item.data && item.data.outerHTML);
      icon.innerHTML = kind === "image" ? Acopio.ICONS.image : kind === "font" ? Acopio.ICONS.font : Acopio.ICONS.component;
      card.appendChild(icon);
    }
    return card;
  }

  // The compact circular "+" — shared by the post-first-capture stack
  // group (buildStackPreview's sibling) and the "already in your
  // collection" case below, which needs the exact same treatment on its
  // own with no stack beside it (there's nothing collected THIS page load
  // yet, just a proactive duplicate match against an earlier visit).
  function buildCollectFab() {
    const fab = document.createElement("button");
    fab.className = "collect-fab";
    fab.type = "button";
    fab.setAttribute("aria-label", "Collect this element");
    fab.title = "+ Collect";
    fab.innerHTML = Acopio.ICONS.plus;
    fab.addEventListener("click", onCollectClick);
    return fab;
  }

  function buildStackPreview() {
    const stack = document.createElement("div");
    stack.className = "capture-stack";
    stack.title = "Open the Acopio panel";
    stack.setAttribute("role", "button");
    stack.tabIndex = 0;
    const cardsWrap = document.createElement("div");
    cardsWrap.className = "stack-cards";
    // Fill every slot the row actually has room for (MAX_STACK_SLOTS, see
    // where it's computed above) before falling back to an overflow chip —
    // only reserve a slot for that chip when there's truly more than fits.
    const willOverflow = sessionCaptureTotal > MAX_STACK_SLOTS;
    const cardSlots = willOverflow ? MAX_STACK_SLOTS - 1 : MAX_STACK_SLOTS;
    const shown = sessionCaptures.slice(-cardSlots);
    shown.forEach((item, i) => {
      // Only the most recently collected item plays the spring entrance,
      // and only once (the flag is consumed here) — otherwise every card
      // would replay it on every re-render, which reads as broken, not
      // deliberate.
      const animateIn = pendingStackAnim && i === shown.length - 1;
      cardsWrap.appendChild(buildMiniThumb(item, animateIn));
    });
    // Pattern 5 (avatar/item stacking with an overflow count) — the stack
    // only ever has room for MAX_STACK_SLOTS thumbnails (see the width math
    // above), but silently capping there with no indication anything was
    // left out read as the count being wrong/lost rather than just not all
    // displayed (real complaint: "why does it only show 4 when I've
    // collected more than 9"). A plain "+N" chip, same overflow language
    // already used for the "Contains:"
    // chip row, closes that gap honestly instead of pretending the row's
    // capacity is all there is.
    const overflow = sessionCaptureTotal - shown.length;
    if (overflow > 0) {
      const overflowChip = document.createElement("div");
      overflowChip.className = "stack-overflow";
      overflowChip.textContent = `+${overflow}`;
      cardsWrap.appendChild(overflowChip);
    }
    pendingStackAnim = false;
    stack.appendChild(cardsWrap);
    // "from this site," not "this session" — sessionCaptures may now be
    // seeded from a past visit's history (see the setTimeout fetch above),
    // not only things captured during the current page load.
    stack.setAttribute(
      "aria-label",
      selectedCollectionId
        ? `${sessionCaptureTotal || sessionCaptures.length} items in ${selectedFolderName} — open the Acopio panel`
        : `${sessionCaptureTotal || sessionCaptures.length} items collected from this site — open the Acopio panel`
    );
    // A nice free tie-together rather than a dead end: clicking the stack
    // itself (not the + button next to it) jumps straight to the side
    // panel, where these items are actually browsable — Compare/export
    // views land in a later phase, so the panel is the honest "see more"
    // destination right now, not a half-built package/export flow.
    // sendMessage throws synchronously on an invalidated extension context
    // (reloaded while this page was already open) — the .catch() below only
    // catches an async rejection, not that synchronous throw, so this also
    // needs its own try/catch, same as captureElementPreview above.
    const openPanel = () => {
      try {
        chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" }).catch(() => {});
      } catch (_) {
        // Nothing to do — the stack is purely a shortcut into the panel.
      }
    };
    stack.addEventListener("click", openPanel);
    stack.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPanel();
      }
    });
    return stack;
  }

  // Fills (or refills) the bottom action row from current sessionCaptures
  // state — the plain first-time "+ Collect" button, or the stack + fab
  // once there's something to show. Shared by render() (building the card
  // from scratch) and doFinalize's success path (updating just this row in
  // place after a save, instead of tearing down and reopening the whole
  // tooltip — see there for why that mattered).
  function populateActions(actions) {
    actions.innerHTML = "";
    if (sessionCaptures.length > 0) {
      // Already collected something — show what, plus a compact circular
      // "+" instead of the full-width button, so the action row
      // communicates "here's your progress" not just "collect this one
      // thing" every single time. Stack + fab share one rounded container
      // so they read as a single composed element, not two loose controls
      // sitting next to each other.
      const group = document.createElement("div");
      group.className = "stack-group";
      group.appendChild(buildStackPreview());
      group.appendChild(buildCollectFab());
      actions.appendChild(group);
    } else {
      const collectBtn = document.createElement("button");
      collectBtn.className = "collect-btn";
      collectBtn.type = "button";
      collectBtn.innerHTML = `${Acopio.ICONS.plus}<span>Collect</span>`;
      collectBtn.addEventListener("click", onCollectClick);
      actions.appendChild(collectBtn);
    }
  }

  // --- Copy for pasting elsewhere (Figma, Claude, a doc) ------------------
  // One clipboard write can carry more than one format at once — a visual
  // target (Figma, a doc, Slack) picks up the PNG, a text target (Claude's
  // own chat input, a plain-text field) picks up the description instead,
  // so a single click gives whichever destination you paste into the
  // format it can actually use, rather than a flat picture everywhere.
  // Real Figma Auto Layout (matching padding/gaps/resizing, not just a
  // picture of them) isn't reachable this way at all — that's Figma's own
  // internal data model, only writable from a plugin running inside Figma
  // itself, nothing a browser clipboard write can carry — so this never
  // claims to produce that; "Copy as SVG" below is the closest honest
  // equivalent, and only offered when the content is genuinely vector to
  // begin with.
  function canvasToPngBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }
  async function urlToPngBlob(url) {
    const res = await fetch(url);
    const srcBlob = await res.blob();
    if (srcBlob.type === "image/png") return srcBlob;
    const bitmap = await createImageBitmap(srcBlob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvasToPngBlob(canvas);
  }
  async function dataUrlToPngDataUrl(dataUrl) {
    if (!dataUrl) return null;
    if (String(dataUrl).startsWith("data:image/png")) return dataUrl;
    try {
      const blob = await urlToPngBlob(dataUrl);
      if (!blob) return dataUrl;
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (_) {
      return dataUrl;
    }
  }
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  function overlayCopyLabel(tagInfo) {
    if (tagInfo.type === "component") return "Component 1";
    if (tagInfo.type === "image") return "Image 1";
    if (tagInfo.type === "color") return "Color 1";
    if (tagInfo.type === "font") return "Font 1";
    return "Item 1";
  }
  function colorSwatchPngBlob(data) {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 200;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = data.hex || "#cccccc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvasToPngBlob(canvas);
  }
  function fontSamplePngBlob(data) {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#17181A";
    const size = Math.min(data.sizePx || 32, 72);
    ctx.font = `${data.weight || 400} ${size}px ${data.fallbackStack || "sans-serif"}`;
    ctx.textBaseline = "middle";
    ctx.fillText((data.sampleText || data.family || "Aa").slice(0, 24) || "Aa", 16, canvas.height / 2);
    return canvasToPngBlob(canvas);
  }
  // Best-effort — a blocked cross-origin fetch (no CORS header on the
  // source image) or a not-yet-resolved component screenshot just means no
  // image half of the copy, not a failure of the whole action; the text
  // description still goes through on its own.
  async function resolveCopyImageBlob(tagInfo, data, el) {
    // Diagnostic only — logs exactly which branch supplied (or failed to
    // supply) the image half of a copy, and why. Added specifically
    // because a real reported case (copy a component, paste elsewhere,
    // get text with no image) couldn't be reproduced or root-caused from
    // outside a real installed extension — this turns the NEXT repro into
    // a definitive console trace instead of another round of guessing.
    // Safe to leave in permanently: console.debug, not user-visible UI.
    const trace = (stage, detail) => console.debug("[Acopio copy]", stage, detail || "");
    try {
      if (tagInfo.type === "color") return await colorSwatchPngBlob(data);
      if (tagInfo.type === "font") return await fontSamplePngBlob(data);
      if (tagInfo.type === "image" && data.url) return await urlToPngBlob(data.url);
      if (tagInfo.type === "component") {
        // Always capture fresh, full-resolution, here — deliberately NOT
        // reusing lastElementCapture/data.previewImage as the first choice
        // anymore. Both of those come from the passive PREVIEW capture
        // (captureElementPreview → captureElementScreenshot(el,
        // "preview")), which is intentionally small (480px-wide cap) and
        // lossy (JPEG) — exactly right for a thumbnail nobody zooms into,
        // exactly wrong for something you're actually copying out to use
        // somewhere. Real, confirmed bug: pasting a captured 862×551
        // component came through as a 257KB image — well under what that
        // resolution needs — because Copy was silently reusing that same
        // small preview capture instead of taking its own. el is still on
        // screen here (copyForPaste is only reachable via a button inside
        // the live tooltip, which only renders while hovering the real
        // element), so a fresh capture always has something real to work
        // from — no reason to settle for the low-res one by default.
        trace("firing a full-resolution capture for copy (not reusing the small preview one)");
        const freshDataUrl = await captureElementScreenshot(el); // no "preview" purpose → full resolution, lossless PNG, see captureElementScreenshot
        if (freshDataUrl) {
          trace("full-resolution screenshot succeeded", { dataUrlLen: freshDataUrl.length });
          return await urlToPngBlob(freshDataUrl);
        }
        // Fresh capture genuinely failed (off-screen, a transient Chrome
        // API error) — the small cached preview is still a real image and
        // strictly better than no image at all, so it's kept as a
        // fallback, just no longer the first choice.
        if (lastElementCapture && lastElementCapture.el === el && lastElementCapture.dataUrl) {
          trace("fresh capture failed — falling back to lastElementCapture (lower resolution)", { dataUrlLen: lastElementCapture.dataUrl.length });
          return await urlToPngBlob(lastElementCapture.dataUrl);
        }
        if (data.previewImage) {
          trace("fresh capture failed — falling back to data.previewImage (lower resolution)", { dataUrlLen: data.previewImage.length });
          return await urlToPngBlob(data.previewImage);
        }
        trace("no fresh capture and no cached fallback — no image will be attached to this copy");
      }
    } catch (err) {
      trace("threw — no image will be attached to this copy", String((err && err.message) || err));
      // fall through to null
    }
    return null;
  }
  function copyDescriptionFor(tagInfo, data, el) {
    const src = window.location.href;
    if (tagInfo.type === "color") {
      const gradientNote = data.isGradient ? ` (gradient: ${data.gradientStops})` : "";
      return `Color: ${data.hex || "?"}${gradientNote}\nFrom: ${src}`;
    }
    if (tagInfo.type === "font") {
      const lh = data.lineHeightPx ? `/${Math.round(data.lineHeightPx)}px` : "";
      const ls = data.letterSpacingPx ? `, ${data.letterSpacingPx}px letter-spacing` : "";
      return `Font: ${data.family}, ${data.weight}, ${Math.round(data.sizePx)}px${lh}${ls}\nSample: "${data.sampleText || ""}"\nFrom: ${src}`;
    }
    if (tagInfo.type === "image") {
      const gifNote = data.isVideo ? " (GIF)" : "";
      return `Image: ${Math.round(data.width)}×${Math.round(data.height)}px${gifNote}\n${data.url || ""}\nFrom: ${src}`;
    }
    const contains = [...new Set(describeChildren(el).map((c) => c.label))];
    const containsNote = contains.length ? `\nContains: ${contains.join(", ")}` : "";
    return `Component: ${Math.round(data.boundingBoxWidth)}×${Math.round(data.boundingBoxHeight)}px${containsNote}\nFrom: ${src}`;
  }
  function flashCopyFeedback(btn) {
    const original = btn.innerHTML;
    btn.innerHTML = Acopio.ICONS.check;
    btn.classList.add("is-copied");
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.remove("is-copied");
    }, 1200);
  }
  async function copyForPaste(el, tagInfo, data, btn) {
    try {
      const note = noteValue.trim();
      const label = overlayCopyLabel(tagInfo);
      const imageBlob = await resolveCopyImageBlob(tagInfo, data, el);
      const isVisual = (tagInfo.type === "component" || tagInfo.type === "image") && imageBlob;
      const clipboardTypes = {};

      if (isVisual) {
        clipboardTypes["image/png"] = imageBlob;
        const plainText = note ? `${label}\n\n${note}` : label;
        clipboardTypes["text/plain"] = new Blob([plainText], { type: "text/plain" });
        if (note) {
          const dataUrl = await blobToDataUrl(imageBlob);
          const noteHtml = Acopio.escapeHtml(note).replace(/\n/g, "<br>");
          const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><img src="${dataUrl}" style="max-width:480px;display:block;margin-bottom:8px;" /><div>${noteHtml}</div></body></html>`;
          clipboardTypes["text/html"] = new Blob([html], { type: "text/html" });
        }
      } else if (imageBlob) {
        clipboardTypes["image/png"] = imageBlob;
        clipboardTypes["text/plain"] = new Blob([copyDescriptionFor(tagInfo, data, el)], { type: "text/plain" });
        clipboardTypes["text/html"] = new Blob([copyDescriptionFor(tagInfo, data, el)], { type: "text/html" });
      } else {
        const text = copyDescriptionFor(tagInfo, data, el);
        clipboardTypes["text/plain"] = new Blob([text], { type: "text/plain" });
        if (tagInfo.type === "component" && data.outerHTML) {
          clipboardTypes["text/html"] = new Blob([data.outerHTML], { type: "text/html" });
        }
      }

      await navigator.clipboard.write([new ClipboardItem(clipboardTypes)]);
      flashCopyFeedback(btn);
    } catch (err) {
      console.error("[Acopio] copy failed:", err);
      showInlineError("Couldn't copy — try again.");
    }
  }
  async function copySvgMarkup(el, btn) {
    try {
      if (el.tagName.toLowerCase() !== "svg") throw new Error("not svg");
      await navigator.clipboard.writeText(el.outerHTML);
      flashCopyFeedback(btn);
    } catch (err) {
      console.error("[Acopio] SVG copy failed:", err);
      showInlineError("Couldn't copy SVG — try again.");
    }
  }

  function render(options = {}) {
    ensureHost();
    generation++;
    closeFolderMenu();
    if (cardEl) cardEl.remove();
    isSaving = false;
    if (!selectedCollectionId) selectedFolderName = folderDisplayName(siteFolderLabel());
    cardEl = document.createElement("div");
    cardEl.className = options.skipEntrance ? "card card--no-entrance" : "card";
    cardEl.setAttribute("role", "region");
    cardEl.setAttribute("aria-label", "Acopio capture panel");

    const el = currentTarget;
    const style = window.getComputedStyle(el);

    if (el.tagName.toLowerCase() === "iframe") {
      cardEl.innerHTML = `
        <div class="selector">${selectorFor(el)}</div>
        <div class="row"><div class="type-icon">!</div><div class="headline">Embedded content</div></div>
        <div class="warning">Can't collect from embedded content on a different domain.</div>
      `;
      shadow.appendChild(cardEl);
      positionCard(el.getBoundingClientRect());
      return;
    }

    // Built before the header rows — its leading ".row" (type icon + label
    // + dimensions) moves into the type-meta row just above the preview.
    const bodyFrag = buildTypeBody(el, currentTagInfo, style);
    const typeHeaderRow = bodyFrag.querySelector(".row");
    if (typeHeaderRow) typeHeaderRow.remove();

    // Folder destination — where Collect will file this item. Drag handle
    // for the card lives on this row (not on the type/copy row below).
    const folderHeader = document.createElement("div");
    folderHeader.className = "folder-header";
    const folderBtn = document.createElement("button");
    folderBtn.type = "button";
    folderBtn.className = "folder-btn";
    folderBtn.setAttribute("aria-haspopup", "true");
    folderBtn.setAttribute("aria-expanded", "false");
    folderBtn.title = "Choose where to collect";
    const folderIcon = document.createElement("span");
    folderIcon.className = "folder-btn-icon";
    folderBtn.appendChild(folderIcon);
    const folderLabel = document.createElement("span");
    folderLabel.className = "folder-btn-label";
    folderBtn.appendChild(folderLabel);
    const folderChevron = document.createElement("span");
    folderChevron.className = "folder-btn-chevron";
    folderChevron.innerHTML = Acopio.ICONS.chevronDown;
    folderBtn.appendChild(folderChevron);
    folderBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (folderMenuOpen) {
        closeFolderMenu();
        return;
      }
      // Defer one frame so this same click's capture-phase window listener
      // has finished. Always fetch fresh Sites + Folders inside openFolderMenu.
      const btn = folderBtn;
      requestAnimationFrame(() => {
        if (!cardEl || !cardEl.contains(btn)) return;
        openFolderMenu(btn);
      });
    });
    folderHeader.appendChild(folderBtn);
    cardEl.appendChild(folderHeader);
    // Must run after the button is built (and preferably mounted) — earlier
    // this ran before append and queried cardEl, so icon + name stayed blank.
    updateFolderBtnChrome(folderBtn);

    let dragStartX = 0;
    let dragStartY = 0;
    let dragBaseOffset = { dx: 0, dy: 0 };
    let dragging = false;
    folderHeader.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      folderHeader.setPointerCapture(e.pointerId);
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragBaseOffset = cardDragOffset ? { ...cardDragOffset } : { dx: 0, dy: 0 };
      folderHeader.classList.add("is-dragging");
    });
    folderHeader.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      cardDragOffset = {
        dx: dragBaseOffset.dx + (e.clientX - dragStartX),
        dy: dragBaseOffset.dy + (e.clientY - dragStartY),
      };
      positionCard(el.getBoundingClientRect());
    });
    const endDrag = () => {
      dragging = false;
      folderHeader.classList.remove("is-dragging");
    };
    folderHeader.addEventListener("pointerup", endDrag);
    folderHeader.addEventListener("pointercancel", endDrag);

    // Type + size + copy — just above the preview (was previously the top header).
    const typeMetaRow = document.createElement("div");
    typeMetaRow.className = "type-meta-row";
    if (typeHeaderRow) {
      typeMetaRow.appendChild(typeHeaderRow);
    } else {
      const selectorLine = document.createElement("div");
      selectorLine.className = "selector";
      selectorLine.textContent = selectorFor(el);
      typeMetaRow.appendChild(selectorLine);
    }

    const navBtns = document.createElement("div");
    navBtns.className = "selector-nav-btns";

    const copyData = (lastKnownCapture && lastKnownCapture.el === el ? lastKnownCapture.data : null) || Acopio.buildCaptureData(el, currentTagInfo).data;
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "copy-btn";
    copyBtn.innerHTML = Acopio.ICONS.copy;
    copyBtn.title = "Copy — image for Figma/docs, description for Claude/text";
    copyBtn.setAttribute("aria-label", "Copy this capture");
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyForPaste(el, currentTagInfo, copyData, copyBtn);
    });
    navBtns.appendChild(copyBtn);
    if (currentTagInfo.type === "image" && el.tagName.toLowerCase() === "svg") {
      const copySvgBtn = document.createElement("button");
      copySvgBtn.type = "button";
      copySvgBtn.className = "copy-btn";
      copySvgBtn.innerHTML = Acopio.ICONS.codeBrackets;
      copySvgBtn.title = "Copy as SVG — pastes into Figma as real editable vector layers";
      copySvgBtn.setAttribute("aria-label", "Copy as SVG markup");
      copySvgBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        copySvgMarkup(el, copySvgBtn);
      });
      navBtns.appendChild(copySvgBtn);
    }

    typeMetaRow.appendChild(navBtns);
    cardEl.appendChild(typeMetaRow);

    cardEl.appendChild(bodyFrag);

    // "Already collected" — proactive, on hover, not just a confirmation
    // you hit after clicking Collect, opening the panel, and going looking
    // — that round trip is real effort for something this check can answer
    // in place. Covers every capture type: color/font by near-match, image
    // by exact URL, component by exact selector (see AcopioDB.
    // findSimilarItem for why component/image use an exact match instead
    // of a similarity heuristic). Pure/synchronous data build (no capture
    // side effects) so hovering never writes anything; the `generation`
    // guard drops the result if you've moved to a different element by the
    // time the async DB check resolves.
    {
      // Component matching only needs the selector (see findSimilarItem),
      // so this skips buildCaptureData for it entirely — that path runs a
      // full sanitize pass over the element's outerHTML (Section 9), real
      // work not worth doing on every settled hover just to check
      // duplication.
      const dupData = currentTagInfo.type === "component" ? null : Acopio.buildCaptureData(el, currentTagInfo).data;
      const myGeneration = generation;
      Acopio.checkDuplicate(
        Acopio.hostname(),
        currentTagInfo.type,
        dupData,
        (similar) => {
          if (myGeneration !== generation || !cardEl) return;
          if (!similar) return;
          // copyData (used by the copy button above) is either this
          // session's lastKnownCapture or a freshly recomputed snapshot —
          // buildTypeData's component branch never attaches previewImage
          // to either (that field only ever gets set on the STORED item at
          // Collect time). Without this, resolveCopyImageBlob's only image
          // source for an already-collected component is the ephemeral
          // lastElementCapture cache, which silently produces a text-only
          // clipboard write whenever that cache missed (element partially
          // off-screen, timing). The duplicate lookup just handed back the
          // real stored item, which DOES carry a genuine saved screenshot —
          // use it as the fallback so copying an already-collected
          // component actually includes an image.
          if (currentTagInfo.type === "component" && !copyData.previewImage && similar.data && similar.data.previewImage) {
            copyData.previewImage = similar.data.previewImage;
          }
          const badge = document.createElement("div");
          badge.className = "already-collected";
          badge.innerHTML = `${Acopio.ICONS.check}<span>Already in your collection</span>`;
          typeMetaRow.insertAdjacentElement("afterend", badge);
          // This resolves asynchronously, after the actions row already
          // rendered — a fresh, first-ever-this-page-load hover (no session
          // captures yet) would otherwise still get the full-width "+
          // Collect" button even though it's a duplicate, offering "collect
          // this" as if it were new. Swap to the same compact fab the
          // post-first-capture case uses once we know better, so an
          // already-collected element never invites a first-time action.
          const fullBtn = cardEl.querySelector(".collect-btn");
          if (fullBtn) fullBtn.replaceWith(buildCollectFab());
        },
        selectorFor(el)
      );
    }

    // Family classification (Section 6: "let the user override the
    // auto-detected family"). Scoped to text captures only — the options
    // are a text classification; a captured color swatch or image doesn't
    // have a "Heading" reading. The compact single-tag state now lives
    // inline in the headline itself (see buildTypeBody's font branch) —
    // this only ever renders the expanded 4-option picker, once you've
    // clicked that inline tag to correct it.
    if (currentTagInfo.type === "font" && pillsExpanded) {
      const FAMILY_LABEL = { heading: "Heading", body: "Body", button: "Button", other: "Other" };
      const pillsWrap = document.createElement("div");
      pillsWrap.setAttribute("role", "group");
      pillsWrap.setAttribute("aria-label", "Correct the detected category");
      pillsWrap.className = "family-pills";
      ["heading", "body", "button", "other"].forEach((fam) => {
        const pill = document.createElement("button");
        pill.className = "pill";
        pill.type = "button";
        pill.textContent = FAMILY_LABEL[fam];
        pill.dataset.active = String(currentTagInfo.family === fam);
        pill.setAttribute("aria-pressed", String(currentTagInfo.family === fam));
        pill.addEventListener("click", () => {
          currentTagInfo.family = fam;
          currentTagInfo.familyOverridden = true;
          pillsExpanded = false;
          render();
        });
        pillsWrap.appendChild(pill);
      });
      cardEl.appendChild(pillsWrap);
    }

    const piiCheck = Acopio.PII_PATTERN.test(el.textContent || "");
    if (piiCheck) {
      const warn = document.createElement("div");
      warn.className = "warning";
      warn.textContent = "This might contain personal info — capture anyway?";
      cardEl.appendChild(warn);
    }

    // Always here, above Collect — not a step that appears after clicking
    // Collect and then vanishes on its own a couple seconds later. That
    // auto-vanishing version meant there was no real window to actually
    // type a note before it disappeared. Prefilled from noteValue so
    // switching the family-tag pill (which re-runs render() for the same
    // element) doesn't erase what's already been typed. Never auto-focused
    // — this appears on every ordinary hover, and stealing focus from the
    // page just from hovering would be exactly the "interrupts normal
    // browsing" failure the hover-only trigger design otherwise avoids.
    const noteField = document.createElement("textarea");
    noteField.className = "note-field";
    noteField.rows = 1;
    noteField.placeholder = "Add a note (optional)";
    noteField.setAttribute("aria-label", "Note for this item (optional)");
    noteField.maxLength = 140;
    noteField.value = noteValue;
    // Grows the field to fit what's actually been typed, up to the 3-line
    // cap set in CSS (.note-field's max-height) — past that, height stops
    // growing and the CSS overflow-y:auto takes over instead. Resetting to
    // "auto" first is what lets scrollHeight shrink back down too (e.g.
    // after deleting a wrapped line), not just grow.
    const autosizeNoteField = () => {
      noteField.style.height = "auto";
      noteField.style.height = `${noteField.scrollHeight}px`;
    };
    noteField.addEventListener("input", () => { noteValue = noteField.value; autosizeNoteField(); });
    // Keep typing (including Enter, arrows, Escape) inside the field from
    // reaching the window-level keydown listener below — otherwise Escape
    // would close the tooltip mid-sentence and arrow keys would try to
    // navigate the DOM tree instead of moving the text cursor. Enter now
    // legitimately inserts a newline (this is a textarea) rather than
    // needing special-casing — nothing here submits on it.
    noteField.addEventListener("keydown", (e) => e.stopPropagation());
    // While actually typing, the mouse cursor is very often resting
    // somewhere other than the note field itself (clicked in, then hands
    // move to the keyboard) — without this, an ordinary hover-driven
    // mousemove elsewhere would retarget the whole tooltip to a new
    // element mid-sentence and silently drop whatever was just typed
    // (showFor() resets noteValue for a genuinely new element). Focus is
    // the actual signal of "committed to writing a note here," not mere
    // hover, so it's what gates protection — not just the field existing.
    noteField.addEventListener("focus", () => { noteFieldHasFocus = true; });
    noteField.addEventListener("blur", () => { noteFieldHasFocus = false; });
    cardEl.appendChild(noteField);

    const actions = document.createElement("div");
    actions.className = "actions";
    populateActions(actions);

    // A real divider between "what this is" (type body, family tag,
    // warnings) and "what to do about it" (Collect) — the same
    // content/action separation design-extractor's own tooltip uses,
    // instead of relying on margin alone to imply the boundary.
    const actionsDivider = document.createElement("div");
    actionsDivider.className = "divider";
    cardEl.appendChild(actionsDivider);
    cardEl.appendChild(actions);

    shadow.appendChild(cardEl);
    // Confirmed, real bug: this used to run right after
    // cardEl.appendChild(noteField) above, which only attaches the field to
    // cardEl — cardEl itself isn't attached to the shadow tree (and so has
    // no real layout box at all) until shadow.appendChild(cardEl) here.
    // Reading scrollHeight before that point measured a detached node —
    // scrollHeight came back ~0, and that got locked in as the field's
    // inline height, rendering as a squashed sliver on every fresh hover
    // (confirmed live: an empty note field's real rect height was 18px
    // against an expected ~35px). Now it only runs once the field is
    // actually laid out in the document, matching what its own comment
    // always claimed but didn't actually do.
    autosizeNoteField();
    applyOutline(el);
    positionCard(el.getBoundingClientRect());
  }

  function showToast(message) {
    // Bug this replaces: the old version cleared the removal *timer* but
    // never removed the *previous toast element itself* — so capturing a
    // second item within 2.6s of the first left the first toast's <div>
    // permanently orphaned in the shadow DOM (its own timer got cancelled
    // by the clearTimeout, nothing else ever removed it). Multiple rapid
    // captures stacked up literally-never-removed "Saved to X" toasts,
    // which is a very plausible cause of "extension won't close, it's
    // showing everywhere." Removing the previous toast synchronously here
    // means there is only ever at most one on screen.
    if (toastEl) toastEl.remove();
    clearTimeout(toastTimer);
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    // Pattern 8 — quiet inline confirmation (icon + muted text on a light
    // surface), not a loud centered dark pill. Same checkmark as the
    // collect-moment button, so "this worked" reads as one consistent
    // signal everywhere in the product.
    toastEl.innerHTML = `${Acopio.ICONS.check}<span></span>`;
    toastEl.querySelector("span").textContent = message;
    shadow.appendChild(toastEl);
    const thisToast = toastEl;
    toastTimer = setTimeout(() => {
      thisToast.remove();
      if (toastEl === thisToast) toastEl = null;
    }, 2600);
  }

  let isCollectingPreview = false;

  async function inlineImageUrlAtCapture(data) {
    if (!data || data.inlineDataUrl) return;
    if (data.isVideo) return;
    if (!data.url) return;
    try {
      const tryUrls = [Acopio.upgradeImageUrl(data.url)];
      const fb = Acopio.pinterestFallbackUrl(tryUrls[0]);
      if (fb) tryUrls.push(fb);
      tryUrls.push(data.url);
      for (const tryUrl of tryUrls) {
        try {
          const resp = await fetch(tryUrl);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          data.inlineDataUrl = await blobToDataUrl(blob);
          return;
        } catch (_) {
          // try next URL candidate
        }
      }
    } catch (_) {
      // Export paths can still try the live URL — this is best-effort at collect time.
    }
  }

  async function inlineVideoFrameAtCapture(el, data) {
    if (!data || !data.isVideo || data.inlineDataUrl || !el) return;
    const mediaEl = /^(img|video)$/.test(el.tagName.toLowerCase()) ? el : Acopio.findRealMediaChild(el) || el;
    if (mediaEl.tagName.toLowerCase() !== "video") return;
    try {
      if (mediaEl.readyState >= 2 && mediaEl.videoWidth > 0) {
        const canvas = document.createElement("canvas");
        canvas.width = mediaEl.videoWidth;
        canvas.height = mediaEl.videoHeight;
        canvas.getContext("2d").drawImage(mediaEl, 0, 0);
        data.inlineDataUrl = await dataUrlToPngDataUrl(canvas.toDataURL("image/png"));
        return;
      }
    } catch (_) {
      // fall through to poster
    }
    const poster = mediaEl.getAttribute("poster");
    if (poster) {
      try {
        const resp = await fetch(poster);
        if (resp.ok) {
          data.inlineDataUrl = await blobToDataUrl(await resp.blob());
        }
      } catch (_) {
        // export may still try data.url
      }
    }
  }

  async function assignPreviewImageAndFinalize(el, tagInfo, data) {
    isCollectingPreview = true;
    try {
      if (tagInfo.type === "component") {
        // Always take a fresh full-resolution capture at collect time — do not
        // gate on lastElementCapture matching (that left previewImage unset when
        // the passive hover preview was stale or missing, breaking sidepanel copy/ZIP).
        let source = await captureElementScreenshot(el);
        if (!source && lastElementCapture && lastElementCapture.el === el && lastElementCapture.dataUrl) {
          source = lastElementCapture.dataUrl;
        }
        if (source) {
          data.previewImage = await dataUrlToPngDataUrl(source);
        }
      } else if (tagInfo.type === "image") {
        if (data.isVideo) {
          await inlineVideoFrameAtCapture(el, data);
        } else {
          await inlineImageUrlAtCapture(data);
        }
      }
    } catch (_) {
      if (tagInfo.type === "component" && lastElementCapture && lastElementCapture.el === el && lastElementCapture.dataUrl) {
        try {
          data.previewImage = await dataUrlToPngDataUrl(lastElementCapture.dataUrl);
        } catch (_) {
          data.previewImage = lastElementCapture.dataUrl;
        }
      }
    } finally {
      isCollectingPreview = false;
    }
    doFinalize(el, tagInfo, data);
  }

  function onCollectClick() {
    if (isSaving || isCollectingPreview) return; // a fast double-click must not send two CAPTURE_ITEM messages for one click
    let el = currentTarget;
    let tagInfo = currentTagInfo;
    let data;
    if (el && el.isConnected) {
      ({ data } = Acopio.buildCaptureData(el, tagInfo));
      if (
        isDegenerateCapture(tagInfo, data) &&
        lastKnownCapture &&
        lastKnownCapture.el === el &&
        !isDegenerateCapture(lastKnownCapture.tagInfo, lastKnownCapture.data)
      ) {
        // Live read collapsed since the tooltip opened — the snapshot taken
        // while it was still genuinely on screen is strictly better than a
        // fresh read of a box that's now 0×0.
        ({ tagInfo, data } = lastKnownCapture);
      }
    } else if (lastKnownCapture && lastKnownCapture.el === currentTarget) {
      // The exact node is gone (see lastKnownCapture above), but everything
      // needed for a valid save was already captured while it was still
      // connected — use that instead of failing a capture that's actually
      // still perfectly good.
      ({ tagInfo, data } = lastKnownCapture);
      el = lastKnownCapture.el;
    } else {
      showInlineError("This element changed — try again.");
      return;
    }
    assignPreviewImageAndFinalize(el, tagInfo, data);
  }

  function doFinalize(el, tagInfo, data) {
    isSaving = true;
    // Either the first-capture wide button or the post-first-capture
    // circular fab — whichever is currently rendered.
    const btn = cardEl.querySelector(".collect-btn, .collect-fab");
    const isFab = btn && btn.classList.contains("collect-fab");
    // Restoring plain text on error used to wipe out the icon entirely —
    // capture the real idle markup (icon + label) once, up front, so
    // "Couldn't save, try again" doesn't silently regress the button back
    // to looking like the old text-only version.
    const btnIdleHTML = btn ? btn.innerHTML : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = isFab ? "…" : "Saving…";
    }
    const myGeneration = generation;
    const noteToSave = noteValue.trim();
    const captureOptions = selectedCollectionId
      ? null
      : { hostname: effectiveHostname() };
    Acopio.finalizeCapture(el, tagInfo, data, noteToSave, (result) => {
      isSaving = false;
      // The tooltip may have been hidden, or moved on to a different
      // element entirely, while this was in flight — don't reach into a
      // cardEl that isn't this session's anymore.
      if (myGeneration !== generation) return;
      if (!result.ok) {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = btnIdleHTML;
        }
        showInlineError(result.error || "Couldn't save this item.");
        return;
      }
      sessionCaptures.push(result.item);
      if (sessionCaptures.length > MAX_STACK_SLOTS) sessionCaptures.shift();
      // When collecting into this site's folder, result.count is authoritative.
      // For a Collection destination, bump the collection stack total locally
      // (background doesn't recompute collection totals on CAPTURE_ITEM).
      if (selectedCollectionId) {
        sessionCaptureTotal = (sessionCaptureTotal || 0) + 1;
      } else if (typeof result.count === "number") {
        sessionCaptureTotal = result.count;
      }
      const linkCollection = selectedCollectionId
        ? new Promise((resolve) => {
            try {
              chrome.runtime.sendMessage(
                {
                  type: "ADD_ITEMS_TO_COLLECTION",
                  payload: {
                    collectionId: selectedCollectionId,
                    itemRefs: [{ folderHostname: result.item.hostname, itemId: result.item.id }],
                  },
                },
                () => resolve()
              );
            } catch (_) {
              resolve();
            }
          })
        : Promise.resolve();
      // Best-effort dimension correction: data.url may already be the
      // upgraded, full-resolution file (upgradeImageUrl, shared.js) even
      // though data.width/height were only ever known from whatever <img>
      // the page had rendered at capture time — often a smaller grid
      // thumbnail. Loading the actual saved URL and checking its real
      // naturalWidth/Height means a Library card never keeps showing a
      // smaller number than the file it's actually pointing at. Silent on
      // failure (a blocked cross-origin load, a dead URL) — the original,
      // still-correct-URL dimensions just stay as they were.
      if (tagInfo.type === "image" && !data.isVideo && data.url) {
        const verifyImg = new Image();
        verifyImg.onload = () => {
          if (verifyImg.naturalWidth && verifyImg.naturalHeight && (verifyImg.naturalWidth !== data.width || verifyImg.naturalHeight !== data.height)) {
            Acopio.updateItemDimensions(result.item.id, verifyImg.naturalWidth, verifyImg.naturalHeight);
          }
        };
        verifyImg.src = data.url;
      }
      pendingStackAnim = true;
      // The one deliberate high-craft moment (design-tokens.md): the button
      // morphs into a checkmark with a spring overshoot instead of jumping
      // straight to the note field. Brief and unskippable-by-design — it's
      // the single confirmation the whole capture flow gets, so it earns a
      // beat rather than a silent instant swap.
      if (btn) {
        btn.classList.add("is-collected");
        btn.innerHTML = isFab ? Acopio.ICONS.check : `${Acopio.ICONS.check}<span>Collected</span>`;
      }
      const myFinalizeGeneration = myGeneration;
      linkCollection.then(() => {
        setTimeout(() => {
          if (myFinalizeGeneration !== generation) return; // moved on before the beat finished
          const destLabel = selectedCollectionId ? selectedFolderName : result.hostname;
          showToast(`Collected to ${destLabel}`);
          // Refresh just the action row in place instead of hide()'ing the
          // whole tooltip — the old behavior fully tore the card down, and
          // since the mouse was usually still sitting right over the same
          // element, content.js's hover-settle logic would immediately
          // reopen it a beat later, reading as an unwanted flicker rather
          // than a confirmation. Everything else about the card (what it is,
          // its position) is unchanged; only the collection bar needs to
          // reflect the item that just landed.
          const actionsEl = cardEl && cardEl.querySelector(".actions");
          if (actionsEl) populateActions(actionsEl);
          noteValue = "";
          const noteFieldEl = cardEl && cardEl.querySelector(".note-field");
          // Clearing the value alone would leave a textarea that grew to 3
          // lines still sitting at that height with nothing in it — height
          // is inline style now (autosizeNoteField), so it has to be reset
          // explicitly too, not just the value.
          if (noteFieldEl) { noteFieldEl.value = ""; noteFieldEl.style.height = "auto"; }
          positionCard(el.getBoundingClientRect()); // action row's height likely changed
        }, 420);
      });
    }, captureOptions);
  }

  function showInlineError(msg) {
    let el = cardEl.querySelector(".error");
    if (!el) {
      el = document.createElement("div");
      el.className = "error";
      el.setAttribute("role", "alert");
      cardEl.appendChild(el);
    }
    el.textContent = msg;
  }

  function hide() {
    generation++;
    clearOutline();
    closeFolderMenu();
    if (cardEl) {
      cardEl.remove();
      cardEl = null;
    }
    currentTarget = null;
    currentTagInfo = null;
    lastKnownCapture = null;
    navStack = [];
    noteValue = "";
    noteFieldHasFocus = false; // removing a focused element fires blur naturally, but don't rely on ordering
  }

  // Best-effort — never let a snapshot failure block the tooltip itself
  // from opening; onCollectClick's own live path is still there for the
  // (overwhelmingly common) case where the element is still connected at
  // click time anyway.
  function snapshotCapture(el, tagInfo) {
    try {
      const { data } = Acopio.buildCaptureData(el, tagInfo);
      lastKnownCapture = { el, tagInfo, data };
    } catch (_) {
      lastKnownCapture = null;
    }
  }

  function captureFingerprint(el, tagInfo) {
    if (!el || !tagInfo) return "";
    if (tagInfo.type === "image") {
      const mediaEl = /^(img|video)$/.test(el.tagName.toLowerCase()) ? el : Acopio.findRealMediaChild(el) || el;
      const tag = mediaEl.tagName.toLowerCase();
      if (tag === "video") return `video:${mediaEl.currentSrc || mediaEl.src || ""}`;
      if (tag === "img") return `img:${Acopio.resolveImgSrc(mediaEl) || ""}`;
      const style = window.getComputedStyle(mediaEl);
      const bg = style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
      return bg ? `bg:${bg[1]}` : `media:${tag}`;
    }
    return `${tagInfo.type}|${tagInfo.family || ""}`;
  }

  function showFor(el, tagInfo) {
    if (!el || Acopio.isOwnNode(el)) return;
    currentTarget = el;
    currentTagInfo = tagInfo;
    navStack = [];
    pillsExpanded = false; // new element selected — start collapsed again
    noteValue = ""; // a genuinely different element — don't carry the last one's note over
    cardDragOffset = null; // new element — start at the natural computed position again
    snapshotCapture(el, tagInfo);
    render();
    // Some sites (Pinterest's own "GIF" pins are the clearest real case)
    // lazily swap in the real <video>/media element several hundred ms
    // AFTER the hover itself — well after Acopio's own 130ms settle-
    // debounce already rendered a one-shot snapshot of whatever was in the
    // DOM at that instant (a static placeholder image, at that point).
    // Nothing about "the mouse moved to a new element" happens when that
    // later swap completes — same el the whole time — so the render above
    // never naturally re-fires on its own, and the tooltip is left showing
    // a plain "Image" for something that's actually a video/GIF. One
    // bounded recheck, only if still hovering this exact element and not
    // mid-interaction, catches this without a full MutationObserver.
    const recheckEl = el;
    const initialFingerprint = captureFingerprint(recheckEl, tagInfo);
    setTimeout(() => {
      if (currentTarget !== recheckEl) return; // moved on to something else already
      if (noteFieldHasFocus || isSaving || folderMenuOpen) return; // don't yank the tooltip away mid-interaction
      if (recheckEl.tagName.toLowerCase() === "iframe") return;
      const freshTagInfo = Acopio.detectTag(recheckEl);
      const freshFingerprint = captureFingerprint(recheckEl, freshTagInfo);
      snapshotCapture(recheckEl, freshTagInfo);
      if (freshFingerprint === initialFingerprint) return; // nothing material changed — no rebuild blink
      currentTagInfo = freshTagInfo;
      render({ skipEntrance: true });
    }, 600);
  }

  function isVisible() {
    return Boolean(cardEl);
  }

  // The card sits off to the side of whatever's hovered (positionCard), so
  // reaching its "+ Collect" button means crossing real page in between —
  // other elements, empty space. content.js's hover-settle logic used to
  // treat that transit exactly like hovering something new: it'd retarget
  // to whatever was momentarily under the cursor mid-flight and re-render
  // for a completely different element, deleting the very button the user
  // was moving toward before the click ever landed. This is the standard
  // "safe triangle" fix dropdown menus use — while a card is open, project
  // the cursor a few frames ahead along its current velocity, and treat
  // "that projected point lands on/near the card" as still heading toward
  // it, not as abandoning it for whatever's directly underneath right now.
  function isMovingTowardCard(x, y, dx, dy) {
    if (!cardEl) return false;
    const rect = cardEl.getBoundingClientRect();
    const pad = 6;
    const inside = (px, py) => px >= rect.left - pad && px <= rect.right + pad && py >= rect.top - pad && py <= rect.bottom + pad;
    if (inside(x, y)) return true;
    if (dx === 0 && dy === 0) return false;
    // Extrapolate several frames ahead of the last observed movement — a
    // deliberate, roughly-straight move toward the card projects onto it;
    // a move that's actually heading elsewhere doesn't.
    return inside(x + dx * 6, y + dy * 6);
  }

  // Listening on `window` (not `document`) matters: many sites — anything
  // React/SPA-based with its own modals — register a global Escape/keydown
  // handler on `document` during their own startup, which runs before our
  // content script (we inject at document_idle, deliberately late). Two
  // listeners on the same node/phase fire in registration order, so a
  // page's own capture-phase `document` listener that calls
  // stopImmediatePropagation() would silently eat the keypress before we
  // ever see it — which is exactly what was happening. `window` is earlier
  // than `document` in the capture path regardless of registration order,
  // so listening there means we always see the key first.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      // Close the folder picker first — Escape shouldn't pause capture just
      // because a destination menu was open.
      if (folderMenuOpen) {
        e.preventDefault();
        e.stopPropagation();
        closeFolderMenu();
        return;
      }
      // Deliberately NOT gated on isVisible() anymore — this used to only
      // fire while a tooltip happened to be open, so Escape was only ever
      // a "dismiss what's currently showing" key. The actual ask was a
      // standalone way to pause hover-capture at any time, without having
      // to go find and click the floating toolbar's toggle icon first —
      // Escape now does that on its own, whether or not anything is
      // currently hovered/open.
      if (isVisible()) hide();
      // hide() only dismisses this one card — content.js's own hover
      // tracking (hoverTarget) isn't reset by it, so the very next
      // mousemove onto a different element would just reopen a fresh
      // tooltip there, which read as "Escape doesn't actually turn this
      // off." Pausing hover-capture here (the same storage write the
      // toolbar/panel toggle icon makes) is what actually stops it —
      // content.js's own storage.onChanged listener picks this up and
      // starts short-circuiting every mousemove, and the toggle icon
      // flips to its paused state too since it's driven by the same flag.
      // Idempotent — a harmless no-op write if hover-capture was already
      // off, so this never needs to check current state first.
      chrome.storage.local.set({ acopioActive: false });
    },
    true
  );

  // Fallback dismissal path: clicking anywhere outside the card closes it.
  // Also on `window` capture for the same reason as above. Never calls
  // preventDefault/stopPropagation, so the click still reaches the page
  // underneath completely normally (Section 2.7) — this only ever hides
  // our own overlay, it doesn't interfere with what the click was for.
  //
  // CRITICAL: must use e.composedPath()[0], not e.target. A listener
  // outside a shadow root (this one, on `window`) sees `e.target`
  // *retargeted* to the shadow host for any event originating inside the
  // shadow tree — that's standard, spec'd shadow DOM behavior, not a bug
  // in the page. That meant `cardEl.contains(e.target)` was checking
  // whether cardEl contains the *host* (always false — the host is an
  // ancestor of cardEl, not a descendant), so this fired `hide()` on
  // literally every click inside the tooltip, including "+ Collect"
  // itself, a split second before the button's own bubble-phase handler
  // even ran — tooltip vanishes, nothing gets collected, no error shown
  // (showInlineError itself then threw on the now-null cardEl). Real,
  // reproduced, fixed. composedPath()[0] is the true innermost element,
  // unaffected by retargeting.
  window.addEventListener(
    "click",
    (e) => {
      if (!isVisible()) return;
      const realTarget = e.composedPath()[0];
      // Folder menu is portaled onto documentElement (not inside cardEl).
      if (folderMenuEl && folderMenuEl.contains(realTarget)) return;
      if (realTarget && realTarget.closest && realTarget.closest("[data-acopio-folder-menu]")) return;
      if (cardEl && cardEl.contains(realTarget)) {
        // Clicking elsewhere on the card (not the folder control) closes
        // an open folder menu without dismissing the tooltip.
        if (folderMenuOpen && !realTarget.closest(".folder-btn")) closeFolderMenu();
        return;
      }
      if (folderMenuOpen) {
        closeFolderMenu();
        return;
      }
      hide();
    },
    true
  );

  Acopio.overlay = {
    showFor,
    hide,
    isVisible,
    isMovingTowardCard,
    showToast,
    // Any tooltip sub-state where losing the current card mid-decision
    // would be surprising/destructive (editing a note, deciding on an
    // oversize-capture confirmation, or an in-flight save) — content.js's
    // hover/context-menu triggers check this before ever calling showFor()
    // on a new element. `isSaving` matters here specifically: without it,
    // the slightest mouse drift during the async save round-trip could
    // yank the tooltip to a different element before the response comes
    // back. The `generation` guard in doFinalize correctly stops that from
    // corrupting the new tooltip, but it does so by silently dropping the
    // success/error feedback for the item you just tried to collect — from
    // the outside that looks exactly like "clicked Collect, tooltip
    // vanished, nothing happened," even though the save may have gone
    // through. Blocking hover during the save closes that gap.
    isBusy: () => noteFieldHasFocus || isSaving || folderMenuOpen,
  };
})();
