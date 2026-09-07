#!/usr/bin/env node
/**
 * Validates Acopio → Figma plugin payload fixtures.
 * Does not run inside Figma; catches structural / honesty regressions.
 */
const fs = require("fs");
const path = require("path");

const fixturePath = path.join(
  __dirname,
  "..",
  "acopio-figma-plugin",
  "fixtures",
  "golden-payload.json"
);

function fail(msg) {
  console.error("FAIL:", msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log("OK:", msg);
}

const raw = fs.readFileSync(fixturePath, "utf8");
const payload = JSON.parse(raw);

if (![1, 2].includes(payload.version)) fail(`bad version ${payload.version}`);
else ok(`version ${payload.version}`);

if (!Array.isArray(payload.items) || payload.items.length < 3) {
  fail("expected ≥3 golden items");
} else ok(`${payload.items.length} items`);

for (const item of payload.items) {
  if (item.type !== "component") continue;
  const data = item.data || {};
  const wantsShot =
    data.preferScreenshot || (data.layoutTree && data.layoutTree.preferScreenshot);
  if (wantsShot && !data.previewImage) {
    fail(`${item.id}: preferScreenshot without previewImage`);
  } else if (wantsShot) {
    ok(`${item.id}: screenshot path has previewImage`);
  }
  if (data.layoutTree && data.layoutTree.preferScreenshotHint && !wantsShot) {
    fail(`${item.id}: preferScreenshotHint not bubbled to preferScreenshot`);
  }
  if (!data.layoutTree && !data.previewImage && !(data.layers && data.layers.length)) {
    fail(`${item.id}: no tree, layers, or preview — would be empty gray`);
  }
}

const sparse = payload.items.find((i) => i.id === "fix-sparse-screenshot");
if (!sparse || !sparse.data.preferScreenshot) fail("sparse fixture missing preferScreenshot");
else ok("sparse fixture prefers screenshot");

const grid = payload.items.find((i) => i.id === "fix-irregular-grid");
if (!grid || !grid.data.preferScreenshot) fail("irregular grid fixture missing preferScreenshot");
else ok("irregular grid fixture prefers screenshot");

if (process.exitCode) {
  console.error("\nGolden payload validation failed.");
  process.exit(process.exitCode);
}
console.log("\nAll fixture checks passed.");
