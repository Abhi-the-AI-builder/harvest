// Production values live in config.js (committed, shipped in store builds).
// Copy this file to config.local.js (gitignored) only when you need local
// overrides without editing config.js.
//
// See LAUNCH-PATH-B.md for the full Path B setup walkthrough.
//
//   Project URL  → ACOPIO_SUPABASE_URL  (Supabase → Project Settings → API, no /rest/v1/ suffix)
//   anon public  → ACOPIO_SUPABASE_ANON_KEY  (same page — the anon key, NOT service_role)
self.ACOPIO_SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
self.ACOPIO_SUPABASE_ANON_KEY = "YOUR_ANON_KEY";

// Figma OAuth app client ID (figma.com/developers/apps → Create a new app).
// Redirect URI to register there: chrome.identity.getRedirectURL() at
// runtime — logged once by cloud-oauth.js's connectFigma() on first use if
// you need the exact string for this specific unpacked extension's ID.
// No client secret needed — Figma's app supports PKCE, exchanged directly
// in the extension (src/db/cloud-oauth.js), never sent anywhere else.
self.ACOPIO_FIGMA_CLIENT_ID = "YOUR_FIGMA_OAUTH_CLIENT_ID";

// Notion integration client ID (notion.so/my-integrations → new public
// integration). Same redirect URI as Figma above. UNLIKE Figma, Notion's
// client SECRET must never go here — it's a server-side value, set via
// `supabase secrets set NOTION_CLIENT_SECRET=...` for the
// notion-oauth-exchange Edge Function (supabase/functions/) to use.
self.ACOPIO_NOTION_CLIENT_ID = "YOUR_NOTION_OAUTH_CLIENT_ID";

// Figma export (extension menu + plugin JSON handoff). false for Chrome Web Store builds.
// Set true in config.local.js while testing locally.
self.ACOPIO_ENABLE_FIGMA_EXPORT = false;
