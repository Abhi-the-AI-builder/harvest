#!/usr/bin/env bash
# Builds a Chrome Web Store upload zip (extension files only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/manifest.json" | head -1)"
BUILD="$ROOT/dist/build"
ZIP="$ROOT/dist/harvest-v${VERSION}-store.zip"

if [[ -z "$VERSION" ]]; then
  echo "Could not read version from manifest.json" >&2
  exit 1
fi

if [[ ! -f "$ROOT/src/config.js" ]]; then
  echo "Missing src/config.js — create it from src/config.example.js" >&2
  exit 1
fi

rm -rf "$BUILD"
mkdir -p "$BUILD" "$ROOT/dist"

for item in manifest.json icons fonts vendor src; do
  cp -R "$ROOT/$item" "$BUILD/"
done

# Never ship dev-only overrides or secrets file.
rm -f "$BUILD/src/config.local.js"

cd "$BUILD"
zip -r "$ZIP" . -x "*.DS_Store" -x "__MACOSX/*" >/dev/null

echo "Built $ZIP ($(du -h "$ZIP" | cut -f1))"
