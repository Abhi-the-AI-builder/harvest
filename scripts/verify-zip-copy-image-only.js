#!/usr/bin/env node
/**
 * Regression guard: Copy + ZIP must stay image-only for components.
 * Figma path may use layoutTree; these files must not build Figma nodes.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const files = [
  "src/sidepanel/copy/clipboard-copy.js",
  "src/sidepanel/copy/copy-helpers.js",
  "src/sidepanel/export/zip-export.js",
];

let failed = false;
function fail(msg) {
  console.error("FAIL:", msg);
  failed = true;
}
function ok(msg) {
  console.log("OK:", msg);
}

for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  // These modules must not invoke Figma plugin rebuild helpers.
  if (/buildTreeNode|buildComponentCardFromTree|layoutTree\s*&&\s*build/.test(text)) {
    fail(`${rel}: looks like Figma tree rebuild leaked into copy/ZIP`);
  } else {
    ok(`${rel}: no Figma tree rebuild API`);
  }
  if (rel.includes("zip-export") || rel.includes("copy-helpers")) {
    if (!/previewImage/.test(text)) {
      fail(`${rel}: expected previewImage usage for component PNG`);
    } else {
      ok(`${rel}: uses previewImage`);
    }
  }
}

const zip = fs.readFileSync(path.join(root, "src/sidepanel/export/zip-export.js"), "utf8");
if (!/writeComponentToZip/.test(zip)) fail("zip-export missing writeComponentToZip");
else ok("zip-export has writeComponentToZip");

const copy = fs.readFileSync(path.join(root, "src/sidepanel/copy/clipboard-copy.js"), "utf8");
if (!/component|image/.test(copy)) fail("clipboard-copy missing component/image handling");
else ok("clipboard-copy handles component/image");

if (failed) {
  console.error("\nZIP/copy image-only guard failed.");
  process.exit(1);
}
console.log("\nZIP/copy remain image-only for components (static check).");
