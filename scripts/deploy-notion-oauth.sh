#!/usr/bin/env bash
# Deploy Notion OAuth Edge Function and set server-side secrets.
# Run from the harvest/ folder after: npx supabase login
#
# Usage:
#   NOTION_CLIENT_SECRET="secret_..." bash scripts/deploy-notion-oauth.sh
#
# Or export SUPABASE_ACCESS_TOKEN first (from Supabase Dashboard → Account → Access Tokens)
# if login doesn't work in your terminal.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NOTION_CLIENT_ID="${NOTION_CLIENT_ID:-3ced872b-594c-818b-a255-003774feeecf}"
NOTION_CLIENT_SECRET="${NOTION_CLIENT_SECRET:-}"

if [[ -z "$NOTION_CLIENT_SECRET" ]]; then
  echo "Error: set NOTION_CLIENT_SECRET before running." >&2
  echo '  NOTION_CLIENT_SECRET="secret_..." bash scripts/deploy-notion-oauth.sh' >&2
  exit 1
fi

export PATH="${PATH}:/tmp/node-v24.20.0-darwin-arm64/bin"

echo "Linking project cpzqpmjyshxxpmxsqfni..."
npx supabase link --project-ref cpzqpmjyshxxpmxsqfni

echo "Deploying notion-oauth-exchange..."
npx supabase functions deploy notion-oauth-exchange

echo "Setting secrets..."
npx supabase secrets set "NOTION_CLIENT_ID=${NOTION_CLIENT_ID}"
npx supabase secrets set "NOTION_CLIENT_SECRET=${NOTION_CLIENT_SECRET}"

echo "Done. Reload the Harvest extension and test Export to Notion."
