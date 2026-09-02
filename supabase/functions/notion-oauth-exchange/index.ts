// Supabase Edge Function — the one server-side step Notion's OAuth needs.
//
// Why this exists at all: Notion's token exchange is Basic-Auth'd with
// client_id:client_secret (a confidential-client flow), unlike Figma's
// (which supports PKCE and is exchanged directly from the extension — see
// src/db/cloud-oauth.js). A secret shipped inside an unpacked Chrome
// extension is extractable by anyone who loads it, so this one exchange
// step is proxied through here instead — the secret lives only in this
// function's environment variables, never in the extension bundle.
//
// Deploy: `supabase functions deploy notion-oauth-exchange`
// Required env vars (set via `supabase secrets set`):
//   NOTION_CLIENT_ID      — same value as HARVEST_NOTION_CLIENT_ID in the extension's config.local.js
//   NOTION_CLIENT_SECRET  — from notion.so/my-integrations, NEVER put this in the extension itself
//
// The extension calls this with only the one-time authorization code and
// the redirect_uri it already used — nothing secret ever crosses that
// boundary in either direction.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: CORS_HEADERS });
  }

  const clientId = Deno.env.get("NOTION_CLIENT_ID");
  const clientSecret = Deno.env.get("NOTION_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: "Notion OAuth isn't configured on the server yet." }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400, headers: CORS_HEADERS });
  }
  const { code, redirect_uri } = body || {};
  if (!code || !redirect_uri) {
    return new Response(JSON.stringify({ error: "Missing code or redirect_uri." }), { status: 400, headers: CORS_HEADERS });
  }

  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const tokenResp = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri }),
  });
  const tokenJson = await tokenResp.json();
  if (!tokenResp.ok) {
    return new Response(JSON.stringify({ error: tokenJson.error_description || tokenJson.error || "Notion token exchange failed." }), {
      status: tokenResp.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Pass through only what the extension actually needs — never forward
  // anything else Notion's response might include.
  return new Response(
    JSON.stringify({
      access_token: tokenJson.access_token,
      workspace_name: tokenJson.workspace_name,
      workspace_icon: tokenJson.workspace_icon,
    }),
    { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
