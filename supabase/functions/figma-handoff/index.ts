// Ephemeral Acopio → Figma handoff.
// Extension POSTs the export payload; Acopio Import plugin GETs by pair_key.
//
// Deploy:
//   supabase db push   # or run the migration SQL in the dashboard
//   supabase functions deploy figma-handoff
//
// Secrets (usually already set for the project):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto in hosted functions)

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TTL_MS = 30 * 60 * 1000; // 30 minutes

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabase = adminClient();
  if (!supabase) return json({ error: "Handoff service isn't configured." }, 500);

  try {
    if (req.method === "POST") {
      let body: { pairKey?: string; payload?: unknown };
      try {
        body = await req.json();
      } catch (_) {
        return json({ error: "Invalid JSON body." }, 400);
      }
      const pairKey = String(body.pairKey || "").trim();
      const payload = body.payload;
      if (!pairKey || pairKey.length < 8) return json({ error: "Missing pairKey." }, 400);
      if (!payload || typeof payload !== "object") return json({ error: "Missing payload." }, 400);

      const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
      const { data, error } = await supabase
        .from("acopio_figma_handoffs")
        .insert({ pair_key: pairKey, payload, expires_at: expiresAt })
        .select("id, pair_key, created_at, expires_at")
        .single();

      if (error) return json({ error: error.message || "Couldn't store export." }, 500);

      // Best-effort cleanup of expired rows for this pair.
      await supabase.from("acopio_figma_handoffs").delete().lt("expires_at", new Date().toISOString());

      return json({
        ok: true,
        id: data.id,
        pairKey: data.pair_key,
        expiresAt: data.expires_at,
      });
    }

    if (req.method === "GET") {
      const url = new URL(req.url);
      const pairKey = String(url.searchParams.get("pairKey") || "").trim();
      if (!pairKey) return json({ error: "Missing pairKey." }, 400);

      const { data, error } = await supabase
        .from("acopio_figma_handoffs")
        .select("id, payload, created_at, expires_at")
        .eq("pair_key", pairKey)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return json({ error: error.message || "Couldn't read export." }, 500);
      if (!data) return json({ error: "No pending export for this link. Export to Figma in Acopio first." }, 404);

      return json({
        ok: true,
        id: data.id,
        payload: data.payload,
        createdAt: data.created_at,
        expiresAt: data.expires_at,
      });
    }

    return json({ error: "GET or POST only." }, 405);
  } catch (err) {
    return json({ error: String((err && (err as Error).message) || err) }, 500);
  }
});
