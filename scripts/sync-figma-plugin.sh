#!/usr/bin/env bash
# Sync the canonical Acopio Figma plugin from this repo into an optional
# ~/Downloads copy. Prefer importing the REPO manifest in Figma — Downloads
# is only for people who already registered that path.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/acopio-figma-plugin"
DEST="${1:-$HOME/Downloads/acopio-figma-plugin}"

if [[ ! -f "$SRC/manifest.json" ]]; then
  echo "Missing $SRC/manifest.json" >&2
  exit 1
fi

mkdir -p "$DEST"
rsync -a --delete \
  --exclude '.DS_Store' \
  "$SRC/" "$DEST/"

echo "Synced Acopio Import plugin → $DEST"
echo "Canonical install (preferred): $SRC/manifest.json"
echo "If Figma still points at Downloads, re-import OR run this script after every plugin edit."
