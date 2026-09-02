# Launch guide — Path B (Google sign-in + Notion export)

Step-by-step checklist to ship Harvest on the Chrome Web Store with cloud export enabled.

**You are here:** extension code is built; Supabase project exists; Google/Notion/Figma OAuth and the Edge Function still need finishing before the store upload.

---

## How the pieces fit together

```
Your Mac (edit code)
    → GitHub (backup, history)
    → npm run build:store (creates a .zip)
    → Chrome Web Store Developer Dashboard (upload zip)
    → Google reviews → users install

Supabase (auth + Notion secret proxy)     ← separate from Chrome
Notion integration                        ← you create in Notion's dashboard
Figma OAuth app (optional)                ← only if you want "Connect Figma"
```

GitHub does **not** auto-deploy to Chrome. You upload the zip yourself (or automate later with GitHub Actions).

---

## Phase 1 — Test locally (today)

### 1.1 Load the extension

1. Open Chrome → `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select the `harvest/` folder
4. Open any website → hover an element → **+ Collect**
5. Open the side panel → confirm items appear

After code changes: **Reload** the extension, then **refresh each open tab**.

### 1.2 Get your OAuth redirect URI

This URL must be registered in Supabase, Notion, and Figma.

1. With the extension loaded, open the service worker console:
   - `chrome://extensions` → Harvest → **Service worker** (click the link)
2. Look for: `[Harvest] OAuth redirect URI for Figma/Notion app setup: https://XXXX.chromiumapp.org/`
3. Copy that full URL — you'll paste it in several dashboards

> **Important:** The extension ID (and redirect URI) from **Load unpacked** is different from the **Chrome Web Store** ID. You'll register the store URI again after your first upload (Phase 4).

---

## Phase 2 — Configure Supabase (your account)

Project: `https://cpzqpmjyshxxpmxsqfni.supabase.co`

### 2.1 Enable Google sign-in

Google sign-in gates **Notion** cloud export. **Figma export does not require Google sign-in or Figma OAuth** — it downloads/copies JSON for the companion Harvest Figma plugin.

**Two different redirect URLs — don't mix them up:**

| Where | What to register |
|-------|------------------|
| **Google Cloud Console** → OAuth client → Authorized redirect URIs | `https://cpzqpmjyshxxpmxsqfni.supabase.co/auth/v1/callback` only |
| **Supabase** → Authentication → URL Configuration → Redirect URLs | `https://amlkaimomfaeckfnkcielkpagajdgpah.chromiumapp.org/` (your unpacked extension ID — get yours from §1.2) |

The `chromiumapp.org` URL never goes in Google Cloud Console. Google only talks to Supabase; Supabase redirects back to the extension.

#### Step-by-step

1. [Supabase Dashboard](https://supabase.com/dashboard) → project **cpzqpmjyshxxpmxsqfni** → **Authentication** → **Providers**
2. Enable **Google**
3. Create a Google Cloud OAuth client (if you don't have one yet):
   - [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → **Credentials** → **Create OAuth client ID**
   - Application type: **Web application**
   - Name: `Harvest` (or anything)
   - **Authorized redirect URIs** — add exactly one:
     ```
     https://cpzqpmjyshxxpmxsqfni.supabase.co/auth/v1/callback
     ```
   - Do **not** add the `chromiumapp.org` URL here
4. Copy the Google **Client ID** and **Client Secret** → paste into Supabase Google provider → **Save**
5. **Authentication** → **URL Configuration** → **Redirect URLs** → add your extension redirect URI from §1.2:
   ```
   https://amlkaimomfaeckfnkcielkpagajdgpah.chromiumapp.org/
   ```
   Include the trailing slash. Must match exactly — copy from the service worker console log:
   `[Harvest] Google sign-in redirect URI (add to Supabase → Authentication → Redirect URLs): …`
6. **Authentication** → **URL Configuration** → **Site URL** can stay as `http://localhost:3000` (not used by the extension, but don't leave it blank)

#### Google OAuth consent screen (trust/branding)

While you're in Google Cloud Console:

1. **APIs & Services** → **OAuth consent screen**
2. User type: **External** (unless you have a Google Workspace org)
3. App name: **Harvest**
4. User support email: your email
5. App logo: upload `icons/icon128.png` from this project (optional but recommended)
6. If publishing status is **Testing**: scroll to **Test users** → **Add users** → add the Gmail address you'll sign in with
7. Save

Until the app is published, only test users can sign in. Missing yourself here causes "Authorization page could not be loaded."

### 2.2 Deploy the Notion token-exchange function

Install the Supabase CLI if needed (`npm install` in this repo already includes it).

```bash
cd harvest
npx supabase login
npx supabase link --project-ref cpzqpmjyshxxpmxsqfni
npx supabase functions deploy notion-oauth-exchange
```

Set server-side secrets (Notion secret **never** goes in the extension):

```bash
npx supabase secrets set NOTION_CLIENT_ID="your-notion-integration-client-id"
npx supabase secrets set NOTION_CLIENT_SECRET="your-notion-integration-secret"
```

### 2.3 Test Google sign-in

1. Reload the extension at `chrome://extensions`
2. Open the service worker console → confirm you see:
   `[Harvest] Google sign-in redirect URI (add to Supabase → Authentication → Redirect URLs): https://….chromiumapp.org/`
3. Side panel → Export menu → **Export to Notion** (any scope with items)
4. You should be prompted to **Sign in with Google**
5. Complete sign-in → you should reach the Notion connection step

> **Figma export** ("Export to Figma" / "Copy for Figma plugin") does **not** go through Google sign-in. See [Phase 3.5 — Figma plugin export](#35-figma-plugin-export-no-oauth-required).

### 2.4 Troubleshooting: "Authorization page could not be loaded"

This error blocks **Notion** cloud export (Google sign-in step). **Figma plugin export does not use this flow** — if you only need Figma, skip to [§3.5](#35-figma-plugin-export-no-oauth-required).

One root cause for Notion — fix Google sign-in first.

**Checklist (in order):**

1. **Supabase redirect URL missing or wrong**
   - Go to Supabase → **Authentication** → **URL Configuration** → **Redirect URLs**
   - Must include exactly: `https://amlkaimomfaeckfnkcielkpagajdgpah.chromiumapp.org/` (with trailing slash)
   - Copy from service worker console — don't type it manually
   - If you moved the extension folder or re-loaded unpacked, the ID may have changed → copy the new URL

2. **Google redirect URI wrong**
   - Google Cloud Console → **Credentials** → your OAuth client → **Authorized redirect URIs**
   - Must be **only**: `https://cpzqpmjyshxxpmxsqfni.supabase.co/auth/v1/callback`
   - Remove any `chromiumapp.org` entries from Google — they belong in Supabase only

3. **Google provider not enabled in Supabase**
   - Supabase → **Authentication** → **Providers** → **Google** → enabled, with Client ID + Secret saved

4. **OAuth consent screen in Testing mode**
   - Google Cloud Console → **OAuth consent screen** → **Test users**
   - Add the Gmail you're signing in with

5. **Extension not reloaded after config changes**
   - `chrome://extensions` → Harvest → **Reload**

After fixing, try Export again. The error toast now includes the exact URLs to check.

---

## Phase 3 — Configure Notion (your account)

### 3.1 Create a public integration

1. [notion.so/my-integrations](https://www.notion.so/my-integrations) → **New integration**
2. Type: **Public**
3. Name: `Harvest`
4. **Redirect URI:** paste your redirect URI from Phase 1.2
5. Copy **OAuth client ID** and **OAuth client secret**

### 3.2 Wire into the project

Edit `src/config.js` (and `src/config.local.js` for local dev):

```js
self.HARVEST_NOTION_CLIENT_ID = "paste-client-id-here";
```

Set the secret only in Supabase (Phase 2.2) — not in any JS file.

### 3.3 Share a Notion page with the integration

In Notion: open a page → **⋯** → **Connections** → add **Harvest**.

Without this, the page picker will be empty.

### 3.4 Test Notion export end-to-end

1. Collect a few items
2. Export → **Export to Notion**
3. Sign in with Google (if not already)
4. Connect Notion
5. Pick a parent page → confirm a new child page is created

---

## Phase 3.5 — Figma plugin export (no OAuth required)

**Export to Figma** and **Copy for Figma plugin** work entirely offline — no Google sign-in, no Figma OAuth, no Supabase. They build a v2 JSON payload (with component `previewImage` PNGs inlined as data URLs) that the companion **Harvest Figma plugin** imports via the Plugin API.

Figma's public REST API cannot create design nodes — the plugin is the only path to real Figma layers.

### 3.5.1 Install the Harvest Figma plugin (one-time)

The companion plugin lives in this repo at `harvest-figma-plugin/`.

1. Open Figma Desktop (recommended) or figma.com
2. **Plugins** → **Development** → **Import plugin from manifest…**
3. Select `harvest/harvest-figma-plugin/manifest.json`
4. The plugin appears under **Development** as **Harvest Import**

You only need to do this once per machine. After that, every export is two clicks in Figma (run plugin → it auto-imports).

### 3.5.2 Export to Figma flow (2 clicks max)

1. Load the extension unpacked (Phase 1.1)
2. Collect a few items (include at least one component to verify `previewImage` PNG inlining)
3. Side panel → Export menu (chevron next to "Export as ZIP") → **Export to Figma**
4. Harvest copies the v2 JSON payload to your clipboard and opens Figma — no sign-in prompts
5. In Figma: **Plugins** → **Development** → **Harvest Import** (or press **⌘⌥P** if it was your last plugin)
6. The plugin reads the clipboard automatically (`autoImport: true`) and places frames on the current page — components as preview images, colors as swatches, fonts as text, images inlined, notes below each item

If auto-import doesn't run (clipboard permission denied), click **Import from Harvest** in the plugin panel — same clipboard payload.

**Alternatives:**

- **Copy for Figma plugin** — copies the same JSON without opening Figma; paste via the plugin's **Paste from clipboard** button
- **Download JSON for plugin** — saves `*-figma-plugin.json` for debugging; open the plugin and use Paste from clipboard with the file contents

### 3.5.3 What each export menu item does

| Menu item | OAuth needed? | Output |
|-----------|---------------|--------|
| Export to Figma | No | Copies JSON to clipboard + opens Figma |
| Copy for Figma plugin | No | Copies JSON to clipboard |
| Download JSON for plugin | No | Downloads `*-figma-plugin.json` |
| Export to Notion | Yes (Google + Notion) | Creates a Notion page |

---

## Optional — Figma OAuth (future file picker only)

Not required for **Export to Figma** or **Copy for Figma plugin**. Only needed if you later build a "pick a target Figma file" feature that uses the REST API to list files.

1. [figma.com/developers/apps](https://www.figma.com/developers/apps) → **Create a new app**
2. Under **OAuth** → **Redirect URIs**, add your extension redirect URI from Phase 1.2 (and the store URI from Phase 4.3 after publishing)
   - Copy the exact URL from the service worker console: `[Harvest] OAuth redirect URI for Figma/Notion app setup: https://….chromiumapp.org/`
   - Include the trailing slash if Chrome shows one
3. Copy the app's **Client ID** → set in `src/config.js`:
   ```js
   self.HARVEST_FIGMA_CLIENT_ID = "paste-client-id-here";
   ```
4. Reload the extension

If OAuth fails with "Authorization page could not be loaded", the redirect URI in the Figma app almost certainly doesn't match — re-copy from the service worker console and re-add it in Figma's dashboard.

---

## Phase 4 — Chrome Web Store (first upload)

### 4.1 Register as a developer

1. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Pay the **one-time $5** fee
3. Accept the developer agreement

### 4.2 Upload a draft to get your store extension ID

1. Build the store zip:

```bash
cd harvest
chmod +x scripts/build-store-zip.sh
npm run build:store
```

Output: `dist/harvest-v0.1.0-store.zip`

2. Dashboard → **New item** → upload the zip
3. Note the **extension ID** shown on the item page

### 4.3 Register the store redirect URI

Your store redirect URI is:

```
https://<STORE-EXTENSION-ID>.chromiumapp.org/
```

Add it to:

- Supabase → Authentication → Redirect URLs
- Notion integration → Redirect URIs
- Figma app → Redirect URIs (only if using optional Figma OAuth — not needed for plugin export)

Reload is not needed for store users — this is for OAuth to work on the published build.

### 4.4 Finish the store listing

| Field | What to use |
|-------|-------------|
| Name | Harvest — Design Research Collector |
| Short description | From `manifest.json` |
| Detailed description | What it does, local-first, optional Notion export |
| Category | Productivity |
| Icon | `icons/icon128.png` |
| Screenshots | 3–5 images (1280×800 recommended) |
| Privacy policy | Host `docs/privacy-policy.md` on GitHub Pages or paste into a public URL |

**Privacy policy URL example after enabling GitHub Pages:**
`https://abhi-the-ai-builder.github.io/harvest/privacy-policy.html`

### 4.5 Permission justification (Google will ask)

For `<all_urls>`:

> Harvest injects a hover tooltip on pages the user is researching so they can selectively collect colors, fonts, images, and UI components into a local design library. It only runs on pages the user visits while the extension is active.

### 4.6 Submit for review

Review usually takes **1–7 days**. You'll get email when approved.

---

## Phase 5 — Ongoing workflow (after launch)

```
1. Edit code locally
2. Test with Load unpacked
3. Bump "version" in manifest.json (e.g. 0.1.0 → 0.1.1)
4. git add / commit / push to GitHub
5. npm run build:store
6. Chrome Web Store → your item → Package → Upload new package
7. Submit update for review
```

---

## Checklist before you submit

- [ ] Core capture works (hover → collect → side panel)
- [ ] Google sign-in works
- [ ] Notion Edge Function deployed + secrets set
- [ ] Notion export creates a real page
- [ ] `src/config.js` has Notion client ID filled in
- [ ] Figma plugin export works (Export to Figma → import in plugin)
- [ ] Store redirect URI registered in Supabase + Notion
- [ ] Privacy policy hosted at a public URL
- [ ] Screenshots taken
- [ ] `npm run build:store` zip uploaded

---

## What to do right now

**Your next 3 actions:**

1. **Phase 1.2** — copy your OAuth redirect URI from the service worker console
2. **Phase 2.1** — enable Google in Supabase + add redirect URI
3. **Phase 3.1** — create the Notion integration + paste client ID into `src/config.js`

Reply with where you get stuck (e.g. "Google sign-in fails" or "supabase deploy error") and paste the exact error message.
