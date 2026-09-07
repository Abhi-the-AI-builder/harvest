# Acopio Import — Figma plugin

Imports items from the Acopio Chrome extension onto the current Figma page.

- **Colors / fonts / images / notes** → editable cards
- **Components with `layoutTree`** → nested **Auto Layout** frames
- **Empty trees only** → Collect screenshot fallback

## Publish to Figma Community (you must do this in Desktop)

I (the agent) cannot submit to Community from your Figma account. Publish from **Figma Desktop**:

1. Open any design file in **Figma Desktop**.
2. Ensure this plugin is imported: **Plugins → Development → Import plugin from manifest…** →  
   `acopio-figma-plugin/manifest.json` in this repo (or `~/Downloads/acopio-figma-plugin/manifest.json` after `npm run sync:figma-plugin`).
3. Menu: **Plugins → Manage plugins…**
4. Find **Acopio Import** → **⋯** → **Publish**.
5. If Figma says **Invalid ID**, click **Generate ID**, paste that `id` into `manifest.json`, save, then continue publish.
6. Fill listing: name **Acopio Import**, tagline like “Import Acopio captures as editable layers”, description (clipboard → Import), category **Import**, tag **design**, support email.
7. Cover / gallery images: show Import UI + a before/after editable component.
8. Network access should show **No access to network** (`allowedDomains: ["none"]` — correct).
9. Click **Publish** → Figma reviews (email when approved). Private org publish is available on org plans if you don’t want public yet.

Official docs: [Publish classic plugins](https://help.figma.com/hc/en-us/articles/360042293394-Publish-classic-plugins-to-the-Figma-Community).

After approval, users install from Community (works in **web and Desktop**). Then update Acopio’s handoff copy to say **Plugins → Acopio Import** (not Development).

## Install (development) — before Community approval

1. Open **Figma Desktop** → any design file.
2. **Plugins → Development → Import plugin from manifest…**
3. Select:

   `/Users/abhishek/untitled folder/harvest/acopio-figma-plugin/manifest.json`

4. Run **Plugins → Development → Acopio Import**.

```bash
npm run sync:figma-plugin   # optional: mirror to ~/Downloads
```

## Connect with the extension

1. Local Acopio: set `ACOPIO_ENABLE_FIGMA_EXPORT = true` in gitignored `src/config.local.js` (store builds keep this **false**).
2. In the side panel, select items or folders → **Export to Figma** (primary when Figma is enabled; ZIP/Notion under the chevron).
3. Acopio puts JSON on the **clipboard** (or **downloads** JSON if the payload is too large / clipboard fails) and opens **Figma Desktop** via `figma://` (not the browser — Development plugins don’t run on figma.com).
4. In Desktop, open a design file → run **Acopio Import** → **Import from Acopio**. If Figma blocks clipboard read, use **Paste export instead** (⌘V / Ctrl+V).

Optional menu: **Download JSON for plugin** in Acopio, then paste that file’s contents into the plugin.

### Shared verbs (extension ↔ plugin)

| Step | Copy |
|------|------|
| Extension | **Export to Figma** |
| Modal | Open file → run **Acopio Import** → **Import** / **Paste** |
| Plugin primary | **Import from Acopio** |
| Plugin secondary | **Paste export instead** |

Never say “copied to Figma” or “exported to canvas” until the plugin finishes importing.

## Multi-site exports

Items are grouped by hostname. Each site gets a label and a row of cards on the **current page**. New nodes only — existing art is not modified.

## Components in Figma vs copy / ZIP

Collect always stores **both** on the item (local Library storage):

| Field | Used by |
|-------|---------|
| `layoutTree` | **Export to Figma** → editable Auto Layout |
| `previewImage` | **Copy** / **Export as ZIP** → PNG |

Figma uses a flat screenshot only when the editable tree is empty or rebuild fails — not because some images failed to inline.

### Figma fidelity (best-effort)

- Flex **wrap** / **row-reverse** / **column-reverse**, equal-ish **CSS Grid**, CSS/`median` gaps
- Open **shadow DOM** children; **`::before` / `::after`** as text / image / decorative frames
- Abs/fixed children as `layoutPositioning: ABSOLUTE` inside Auto Layout parents
- Clips, strokes, **stacked shadows**, simple `filter: blur()`, per-corner radii
- Multi-line multi-style text via character `ranges`
- Background-image **cover/contain/position** → FILL/FIT/CROP; **flex-grow** → `layoutGrow`
- **Canvas** / **video** snapshots when allowed
- **Irregular / named grids** and sparse trees → Collect screenshot (honest)

Still limited: closed shadow roots, matrix/compound transforms, and complex CSS stay approximate. Re-collect after updating the extension so new fields are present in the export JSON.

See [GOLDEN_CORPUS.md](./GOLDEN_CORPUS.md) for the fidelity checklist.
