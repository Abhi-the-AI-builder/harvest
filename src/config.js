// Production config shipped with the Chrome Web Store build.
// The anon key is public by design (Row Level Security protects data).
// OAuth client IDs are also public. Never put service_role or Notion's
// client secret here — that secret lives only in the Supabase Edge Function.
//
// For local dev overrides, use src/config.local.js (gitignored).
self.ACOPIO_SUPABASE_URL = "https://cpzqpmjyshxxpmxsqfni.supabase.co";
self.ACOPIO_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwenFwbWp5c2h4eHBteHNxZm5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNjIxODAsImV4cCI6MjEwMzgzODE4MH0.QM6tE5rBJHWZsXtGLiHH5Q4eZNQwhbt0dpwHYVTkXV8";

// Fill these before the final store upload (see LAUNCH-PATH-B.md).
self.ACOPIO_FIGMA_CLIENT_ID = "w8QS2p4cBooG6Ohu5eGoLM";
self.ACOPIO_NOTION_CLIENT_ID = "3ced872b-594c-818b-a255-003774feeecf";

// Figma export menu + companion plugin handoff. false in store builds;
// override to true in src/config.local.js for local testing.
self.ACOPIO_ENABLE_FIGMA_EXPORT = false;
