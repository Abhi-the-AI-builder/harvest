#!/usr/bin/env bash
# Bundle @figit/dom-to-figma for content-script / sidepanel copy → Figma ⌘V.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/vendor"
npx esbuild "$ROOT/node_modules/@figit/dom-to-figma/dist/figma.mjs" \
  --bundle \
  --format=iife \
  --global-name=AcopioDomToFigma \
  --outfile="$ROOT/vendor/dom-to-figma.js" \
  --platform=browser \
  --target=chrome120 \
  --minify
echo "Wrote vendor/dom-to-figma.js ($(wc -c < "$ROOT/vendor/dom-to-figma.js" | tr -d ' ') bytes)"
