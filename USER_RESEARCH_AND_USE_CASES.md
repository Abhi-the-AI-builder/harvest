# Acopio — User Research & Use Cases

**Purpose of this document:** this is a briefing document, not a spec. It exists to give a design tool (or a human designer) everything it needs to *feel* who Acopio is for, what their day looks like without it, and what changes when they have it — so that whatever gets designed (landing page, app store assets, onboarding, marketing illustrations, pitch deck) is grounded in a real workflow, not a generic "productivity app" template.

Product name: **Acopio** — Gather. Connect. Simplify. ("Acopio" is Spanish for a gathering, a stockpile — the harvest of everything you've collected.)

---

## 1. What Acopio actually is, in one paragraph

Acopio is a Chrome extension for designers who spend part of their job looking at *other people's* interfaces — competitor products, inspiration sites, client references — and need to walk away with more than a memory of what they saw. You hover over anything on any website — a button, a headline, a photo, a whole card component — and Acopio identifies exactly what it is (a color, a font, an image, or a UI component) and lets you collect it with one click. Everything you collect is automatically organized by the site it came from, stays connected to its real source, and can be exported later into Figma, Notion, or a clean ZIP handoff — as real usable assets, not screenshots you have to re-derive information from.

---

## 2. Who this is actually for

Four real usage patterns, not abstract "personas" — these are composites of how design research actually happens, grounded in how the tool is built (per-site auto-organization, Collections for cross-site groupings, a Compare/Pairing view for typography, ZIP/Figma/Notion export).

### A. The product designer doing competitive research before a redesign
Told to "look at what Linear, Notion, and Stripe are doing" before a design review in three days. Needs to walk into that review with more than "I looked at their sites" — needs actual reference material: their button states, their empty states, their exact color palette, how they pair fonts. This work is inherently *cross-site* — the output isn't "notes about Linear" and "notes about Notion" separately, it's a synthesized comparison.

### B. The freelance/agency designer building a client mood board
A new client says "make it feel premium, like these three sites." The designer needs to build a moodboard fast, keep it organized *per reference site* (so they can go back and say "this came from site X"), and eventually hand something clean to the client or a teammate — not a Pinterest board full of ads and AI slop, not fifty randomly-named screenshot files in a Downloads folder.

### C. The design-systems person auditing typography and color across the market
Needs to answer "what type scale is everyone actually shipping in production right now" — this means visiting 15–20 real sites, and for each one, capturing the actual computed font (family, weight, size, line-height) exactly as rendered, not eyeballed from a screenshot. The Compare/Pairing view (test how a captured heading font looks next to a captured body font) is built specifically for this kind of person.

### D. The junior designer or student building a personal reference library
Doesn't have a client brief — is building long-term taste. Sees something great while browsing normally (not "doing research," just living online) and wants to grab it *right then*, without breaking flow to open a new tool, without it disappearing into a bookmarks folder they'll never revisit. This is the "notes" / text-selection capture use case as much as the visual one — a great sentence of microcopy, a clever empty-state message, deserves to be collected exactly like a color does.

---

## 3. The old way — what people actually do today, and what it costs them

This is the most important section for a design tool to internalize: **the problem isn't that no tools exist.** Single-purpose tools are good and well-loved. The problem is that doing real design research means stitching together 4-6 different tools, and the seams between them are where the pain lives.

### The current toolkit, piece by piece

| Need | What people actually use today | What it doesn't do |
|---|---|---|
| Grab a color from a site | **ColorZilla** — eyedropper, reads a pixel, shows the hex | Doesn't know *where* that color came from, doesn't save it anywhere organized — you still have to paste the hex somewhere yourself |
| Identify a font | **WhatFont** / **Fonts Ninja** — hover over text, see the family/size/weight | Same problem: shows you the info, then evaporates the moment you navigate away, unless you manually write it down |
| Save a whole layout for later | **Screenshot** (native, or a capture extension) | A flat image. The exact hex, the exact font, the source URL — all gone, baked into pixels you'd have to reverse-engineer again |
| Build a moodboard | **Pinterest** | Ads interrupt the board every 3-4 pins; the feed is increasingly AI-generated images that look fine as a thumbnail and fall apart up close — bad material for real client work |
| Build a moodboard, alternative | **Figma / FigJam** | Not built for this: no video, no way to *browse and clip* from the web directly, and boards over ~50 images start lagging the browser — Figma's real job is vector editing, not being an inspiration inbox |
| Keep it all written down | **Notion doc**, or a running Google Doc | Someone has to manually transcribe every hex code, every font name, paste every screenshot, write the source URL by hand, for every single item |

**The actual workflow, stitched together, for one "let me research 5 competitor sites" task:**

1. Open the first site.
2. Right-click → Inspect, or open ColorZilla, to get a color → copy the hex → alt-tab to a doc → paste it → manually label what it was ("this was their primary button").
3. Open WhatFont, hover the heading → alt-tab back to the doc → type the font name, weight, size by hand.
4. Screenshot a component you liked → save the file → alt-tab back → drag it into the doc, or upload it somewhere.
5. Repeat steps 2–4 for every item worth keeping on this one page — realistically 5–10 things per site if it's a genuinely good reference.
6. Repeat the entire thing for the next 4 sites.
7. At the end, the "deliverable" is a messy doc with pasted screenshots, hand-typed hex codes that may already have a typo, and no consistent structure — and if someone asks "wait, where did this teal color come from again?", the honest answer is often "I don't remember."

**Time cost, realistically:** for a thorough pass on one competitor site (10+ items worth capturing: 2-3 colors, 2 fonts, 3-4 component screenshots, source notes) — 20 to 40 minutes of pure manual transcription, on top of the actual *looking and thinking* time. For a "check 5 competitors" task, that's 2-3+ hours of copy-paste-relabel work before any actual synthesis or design work happens.

**The emotional texture of this, specifically** (worth designing around):
- **Alt-tab fatigue** — the constant context-switch between "the site," "the color tool," and "the doc" breaks the actual creative/analytical thinking the research is for.
- **The nagging fear of losing the source** — six sites in, "wait, was this hex from Linear or from Notion?" A designer *should* be thinking about why a color works, not playing detective with their own notes an hour later.
- **The last-mile drop-off** — people start strong (first site, well-organized notes) and by site four or five, quietly give up on the discipline and just eyeball things, because the manual overhead is exhausting. The research quality degrades exactly when there's the most material to compare.
- **Nothing is reusable** — a screenshot in a Google Doc can't be pasted into Figma as an editable frame. A hex typed into Notion can't be dragged onto a Figma canvas as a real fill. The research and the actual design work remain two disconnected artifacts.

---

## 4. The new way — the same task, with Acopio

Same "research 5 competitor sites" task:

1. Open the first site. Hover the primary button — a tooltip appears identifying it as a color, showing the real hex, live. Click **+ Collect**. Done — no alt-tab, no retyping.
2. Hover the heading — tooltip identifies the font family/weight/size, live, exactly as rendered by the browser (not eyeballed). **+ Collect**.
3. Hover a whole card component — tooltip identifies it as a component, captures a real screenshot *and* the underlying structure. **+ Collect**.
4. Select a well-written line of empty-state copy with a normal text drag — a small tooltip offers to save it as a note, with the source page and any nearby image/link automatically attached. Collect.
5. Everything just captured is *already* organized — filed automatically under that site's own folder in the side panel library, with the real source URL, the real captured value, and a timestamp — with zero manual filing.
6. Move to site two. Repeat. Nothing from site one has to be re-found or re-labeled — it's just sitting there, correctly organized, the whole time.
7. After all 5 sites: open the side panel, see 5 clean per-site folders. Multi-select the specific items worth keeping across all of them, drop them into one **Collection** (a cross-site grouping, e.g. "Redesign refs — Q1"). Export that Collection straight to a real Figma file (as actual layers — real color fills, real text with the real font, real component screenshots — not a pasted PNG) or a Notion page (a clean written page with everything organized) or a ZIP (descriptively-named real files, ready to hand to a teammate — a swatch PNG named for its exact hex, a font sample, a component's HTML and screenshot).

**What actually changed:** the "capture" step goes from "notice something → alt-tab → manually retype it correctly → alt-tab back" (10–30 seconds of *pure friction* per item, before you can even move to the next thing) down to "notice something → one hover, one click" (2-3 seconds), and the "organize it afterward" step — normally its own separate, dreaded chore — never has to happen at all, because it's organized *at the moment of capture*, automatically, by source.

**Time cost, realistically, same 5-site task:** the actual capturing becomes close to the speed of just *looking* at the sites — the bottleneck is now genuinely "how fast can a person read and evaluate a design," not "how fast can they transcribe it." The 2-3 hours of manual transcription work in the old flow collapses to essentially the time spent actually browsing, plus a couple of minutes at the end to build the Collection and export.

---

## 5. Feature walkthrough, mapped to real moments (not a feature list)

- **Hover-capture tooltip (color / font / image / component)** — the core loop. Appears the instant you hover something Acopio can identify; a draggable header row means it never has to permanently block something on the page you still need to click (a nav bar, a "next" arrow) — you just drag it a few pixels out of the way rather than losing the capture entirely.
- **The collect confirmation** — a small, deliberate, satisfying moment (not a generic browser toast) — because the whole product's premise is that collecting something should feel *lighter* than the old way, and the one moment that gets extra craft is the one the user repeats fifty times in a session.
- **Notes capture (text selection)** — independent of hover-capture, its own toggle. This is for the part of design research that isn't visual: a smart piece of microcopy, an onboarding flow's exact wording, a pricing page's exact framing. Selecting text on any page, the normal way, offers to save it — plus any image or link the selection happens to cross.
- **Per-site automatic folders** — you never file anything by hand. Every capture already knows what site it came from.
- **Collections** — the cross-site layer on top of that automatic organization. This is where "research" becomes "a deliverable" — pulling the best items from 5 different auto-organized site folders into one purposeful group ("Redesign refs," "Client moodboard — final picks").
- **Compare / Pairing view** — pick a captured heading font and a captured body font side by side, live, to test whether they actually work together — the exact question a design-systems audit needs answered, without opening Figma just to test two fonts next to each other.
- **Export — ZIP / Figma / Notion** — the payoff. Research that stays trapped in one browser tab's session isn't a deliverable; export is what turns "things I looked at" into "things a team can use." A ZIP with real, descriptively-named files (not `IMG_4821.png`), a real Figma file with actual editable layers (via the companion Plugin-API import, because Figma's own API can't create layers directly — the honest, working path), or a real Notion page a teammate can just open and read.
- **Everything stays connected to its source** — every captured item remembers exactly which URL it came from and when. The "wait, where did this come from again?" moment from the old workflow structurally can't happen.

---

## 6. Detailed use-case scenarios (narrative)

### Scenario 1 — "The redesign kickoff" (Persona A)
Priya, a product designer, gets a Slack message Monday morning: "Before Thursday's review, can you pull together how Linear, Notion, and Height handle their onboarding empty states?" She doesn't open a new tool or a new doc. She opens the three sites in tabs, and as she clicks through each product's onboarding, she hovers and collects: the empty-state illustration style (component), the exact muted gray used for placeholder text (color), the heading font (font), and — catching herself mid-read — highlights and saves the actual sentence Linear uses for its "you're all caught up" state, because the *writing* is doing real work there too. By lunch, she has three clean per-site folders. She multi-selects the dozen best items across all three into a Collection called "Onboarding empty-states — review," and exports it straight to a Notion page. She pastes the Notion link into the Thursday review doc. Total active capture time: maybe 25 minutes, spread across a normal browsing session — not a dedicated "research block" she had to protect on her calendar.

### Scenario 2 — "The client wants 'premium'" (Persona B)
Jordan, a freelance designer, gets three reference URLs from a new client with the brief "make it feel like this." Instead of opening Pinterest (and fighting through ads and AI-generated noise) or starting a Figma board that'll lag once it's full of screenshots, Jordan opens the three sites directly and captures the actual DNA of "premium" as this client means it: the specific near-black background color, the exact serif/sans pairing, three hero-section component screenshots at real resolution. Each site's captures land in their own folder automatically — so a week later, when the client says "actually, less like site #2, more like the others," Jordan can open that one folder and see exactly what came from where, no memory required. Exports the final Collection as a ZIP to hand to the client alongside the proposal — real files, not a link to a private Figma board the client can't open.

### Scenario 3 — "What is everyone actually shipping" (Persona C)
Alex runs a quarterly type-and-color audit for the design system team — a genuinely tedious task historically done with a spreadsheet and a lot of DevTools. This quarter, Alex visits 18 sites, and for each one, captures the real, computed heading font and body font — not eyeballed, the actual rendered `font-family`/weight/size. Using the Compare/Pairing view, Alex tests a few captured heading fonts against the design system's own current body font to see whether the system already handles what the market is doing, or is falling behind. The whole audit — previously a half-day of manual DevTools screenshotting and spreadsheet-filling — happens in the same time it takes to actually browse 18 sites once, because the "recording what I found" step is now just "the click I was already going to make."

### Scenario 4 — "Building taste, not doing a task" (Persona D)
Sam is a design student who isn't researching anything in particular today — just browsing, the normal way people browse. A portfolio site has a hover-state micro-interaction that's genuinely clever. Instead of it living only in memory (or requiring Sam to stop, open a totally different app, and awkwardly try to explain what they just saw), one hover and a click saves it — screenshot, source, everything — into a running personal library that's quietly built itself over months, organized by site, without Sam ever having done a single "organizing" session. Half a year later, applying for an internship, Sam has an actual, real, sourced reference library to point to — not a vague memory of "cool stuff I've seen."

---

## 7. The emotional arc — what a designer feels, before and after

**Before (the old way):** low-grade tedium punctuated by small panics. The actual looking-and-evaluating part of design research — which should feel like the fun, curious part of the job — gets buried under manual transcription labor. By the third or fourth site in a research session, discipline erodes and quality drops. There's a specific, recognizable anxiety around "did I write that source down correctly" that has nothing to do with design skill and everything to do with tooling friction.

**After (with Acopio):** the capture step disappears into the browsing itself — it stops being a separate task with its own cognitive overhead and just becomes a reflex, like bookmarking used to be but with actual structure and reusability behind it. The feeling to design toward is **flow, not efficiency** — not "look how fast this is" but "I never had to stop and think about the tool at all, I was just looking at things and deciding what was good." The payoff moment — opening a folder that organized itself, exporting a Collection that becomes a real Figma file or Notion page in one click — should feel like relief and a little bit of "oh, that's already done?" surprise, not triumphant productivity-porn energy. This is a quiet, competence-affirming tool, not a loud one.

---

## 8. Notes for whoever designs from this document

- **The moment worth illustrating most** is the hover → tooltip → collect loop itself — it's the one interaction repeated dozens of times a session, and the entire product's promise rests on it feeling lightweight rather than like "yet another dialog to fill out."
- **A strong visual metaphor**: the *before* state is scattered, disconnected fragments — sticky notes, browser tabs, a messy doc, screenshots with cryptic filenames, arrows and question marks connecting things that got separated from their source. The *after* state is the same raw material, now visibly organized into clean, labeled groups, each item still visibly tethered to where it came from.
- **Avoid** generic "productivity app" visual language — a dashboard full of charts, a rocket ship, generic collaboration-avatar clusters. This isn't a team-coordination tool; it's a personal-research tool that happens to produce shareable output at the end.
- **Don't visually undersell how mundane the old workflow is** — the contrast lands harder if the "before" state is recognizably ordinary and tedious (a cluttered Google Doc, a Downloads folder full of `Screenshot 2026-...png` files, a dozen open tabs) rather than exaggerated or cartoonish.
- **Real numbers land better than vague claims** — "a 5-site competitive scan that used to eat 2-3 hours of copy-paste work now takes the time it takes to browse 5 sites once" is a more honest and more specific claim than "10x faster."
- **The color/font/image/component distinction is a real design opportunity** — each of the four capture types could have its own small, distinct visual identity (already true inside the product itself, via tinted badges), which gives a design tool a natural, non-arbitrary way to add color and variety to marketing material without inventing an unrelated palette.
- **Tone**: quiet confidence, not hype. The target user is a working designer who is skeptical of "revolutionary" productivity claims (they've seen a hundred of them) and will trust specific, concrete, slightly self-deprecating honesty about how tedious the old way actually was — because it names their exact, lived frustration — over generic superlatives.

---

## Sources consulted for this research

- [UX Competitive Analysis: 6 Research Methods & Complete Guide](https://www.uxpin.com/studio/blog/competitive-analysis-for-ux/) — UXPin
- [Top UX and UI Design Tools for Product Teams](https://maze.co/collections/ux-ui-design/tools/) — Maze
- [Stop Using Pinterest for Work (Private Moodboard Workflow)](https://bookmarkjar.com/blog/pinterest-alternative-designers) — Bookmarkjar
- [14 Best Figma Alternatives for Moodboarding](https://www.kosmik.app/blog/figma-alternatives) — Kosmik
- [ColorZilla — Chrome Web Store](https://chromewebstore.google.com/detail/colorzilla/bhlhnicpbhignbdhedgjhgdocnmhomnp)
- [WhatFont — Chrome Web Store](https://chromewebstore.google.com/detail/whatfont/jabopobgcpjmedljpbcaablpmlmfcogm)
- [Fonts Ninja — Chrome Web Store](https://chromewebstore.google.com/detail/fonts-ninja/eljapbgkmlngdpckoiiibecpemleclhh)
- [Top 9 Chrome extensions designers trust for color, typography, screenshots and CSS inspection](https://thebetterwebmovement.com/top-9-chrome-extensions-designers-trust-for-color-typography-screenshots-and-css-inspection-like-colorzilla-whatfont-and-css-peeper/) — The Better Web Movement

Plus this document's account of Acopio's actual, as-built feature set (hover-capture types, notes capture, per-site folders, Collections, Compare/Pairing view, ZIP/Figma/Notion export) — grounded directly in the product's own codebase and design documentation, not inferred.
