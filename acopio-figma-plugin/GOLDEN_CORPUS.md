# Figma import golden corpus

Manual fidelity checklist for **Export to Figma → Acopio Import**. Re-collect after extension changes (old Library items lack new tree fields). Install the plugin from the **repo** `manifest.json` only.

## Protocol (every case)

1. Reload extension (`chrome://extensions`)
2. Hover → Collect the target region on a live site
3. Export to Figma → follow **Finish in Figma** modal
4. Run **Acopio Import** from repo → Import or Paste
5. Inspect layers + caption (editable vs `screenshot — …`)
6. Spot-check: Copy / ZIP still PNG-only for that component

## Cases (8–12)

| # | Surface | Target | Expected | Result | Gaps |
|---|---------|--------|----------|--------|------|
| 1 | SaaS pricing / feature | Card with title, body, CTA | Editable VERTICAL stack or honest screenshot | _ | _ |
| 2 | Marketing / app | Primary button row (icon + label) | HORIZONTAL AL; `::before` icon if present | _ | _ |
| 3 | Product docs / app | Top nav (logo + links) | Editable row; overflow clipped | _ | _ |
| 4 | Landing | Hero with background image | Bg as IMAGE fill (cover/crop); not empty | _ | _ |
| 5 | CTA with CSS icon | Button using `::before` content | Pseudo as child frame/text | _ | _ |
| 6 | Toolbar / filter bar | `flex-direction: row-reverse` | Reverse order preserved in AL | _ | _ |
| 7 | Dashboard | Equal column CSS grid | Wrapped HORIZONTAL AL | _ | _ |
| 8 | Dashboard | Irregular / named grid | **Screenshot** caption (not smashed AL) | _ | _ |
| 9 | Analytics | Chart / canvas widget | Canvas snapshot image leaf or screenshot | _ | _ |
| 10 | Multi-style copy | Heading with bold + muted spans | Text ranges or screenshot if broken | _ | _ |
| 11 | Overlay UI | Card with drop + inset shadow | Multiple effects on frame | _ | _ |
| 12 | Sparse / iframe | Embedded widget or empty shell | Screenshot of collected region | _ | _ |

## Hard rules

- **No empty gray cards** when Collect attached `previewImage`
- Caption must say **screenshot** when structure was skipped or rebuild failed
- Toast / modal must never claim layers exist before Import finishes

## Automation helper

```bash
npm run test:figma-payload
```

Validates sample payloads under `acopio-figma-plugin/fixtures/` (structure + screenshot preference rules). Does **not** replace running Import in Figma Desktop.

## Last run log

| Date | Operator | Cases passed | Notes |
|------|----------|--------------|-------|
| 2026-09-06 | agent (structure + fixtures) | fixtures green; live Figma pending user | Handoff + preferScreenshot + irregular grid shipped; re-run table above in Desktop |

Fill Result / Gaps columns when you run live imports.
