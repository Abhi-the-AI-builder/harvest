# Privacy Policy — Harvest

**Last updated:** September 1, 2026

Harvest ("the extension") is a Chrome extension for design research. This policy describes what data the extension handles and how.

## Summary

- Captured design items (colors, fonts, images, components, notes) are stored **locally in your browser** by default.
- The extension does **not** sell your data or run advertising analytics.
- Optional cloud features (Google sign-in, Notion export, Figma account connection) only run when you use them.

## Data stored locally

When you collect items, Harvest stores them in **IndexedDB** on your device, inside the extension's own storage. This includes:

- Captured design data (hex values, font metrics, image URLs, sanitized HTML, screenshots)
- Optional notes you add
- Collections you create
- Extension preferences (e.g. whether hover-capture is on)

This local data stays on your device unless you export it (ZIP, clipboard, Figma JSON, or Notion).

## Data sent over the network

Harvest only makes network requests when you are using a feature that requires it:

| When | What is sent | Why |
|------|----------------|-----|
| Browsing any site with capture on | The extension injects UI into pages you visit; it reads DOM/CSS from elements you hover or select | Core capture behavior |
| Export to Notion | Item titles, descriptions, and public image URLs you chose to export | Create a Notion page you requested |
| Sign in with Google | OAuth tokens via Supabase Auth | Verify your Harvest account for cloud export |
| Connect Notion / Figma | OAuth authorization codes and tokens | Connect your Notion or Figma account at your request |
| Supabase (auth only) | Session tokens for Google sign-in | Keep you signed in between sessions |

Harvest does **not** upload your full local library to the cloud automatically.

## Third-party services

If you use optional cloud features, these services may process data under their own policies:

- **Google** — Sign-in (OAuth)
- **Supabase** — Authentication for Harvest sign-in
- **Notion** — Page creation when you export
- **Figma** — Account connection (OAuth); layer creation uses a separate Figma plugin you install manually

## Permissions

Harvest requests Chrome permissions needed for its features:

- **Access to websites you visit** — inject the hover-capture tooltip and read element styles on pages you are researching
- **Storage** — save your library locally
- **Side panel** — show your collected library
- **Identity** — Google, Notion, and Figma sign-in flows

## Data retention and deletion

- **Local data:** Remove items in the Library, or uninstall the extension to clear local storage.
- **Notion pages:** Managed in your Notion workspace.
- **Auth sessions:** Sign out in the extension, or clear extension data in Chrome settings.

## Children's privacy

Harvest is not directed at children under 13.

## Changes

We may update this policy. The "Last updated" date at the top will change when we do.

## Contact

For privacy questions about Harvest, open an issue at:
https://github.com/Abhi-the-AI-builder/harvest/issues
