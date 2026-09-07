-- Ephemeral Figma export handoffs (Extension → Acopio Import plugin).
-- Edge Function `figma-handoff` uses the service role; no anon RLS policies.
create table if not exists public.acopio_figma_handoffs (
  id uuid primary key default gen_random_uuid(),
  pair_key text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists acopio_figma_handoffs_pair_created
  on public.acopio_figma_handoffs (pair_key, created_at desc);

alter table public.acopio_figma_handoffs enable row level security;
