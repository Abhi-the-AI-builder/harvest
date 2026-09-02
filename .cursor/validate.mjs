#!/usr/bin/env node
// Lightweight, dependency-free validation for the Harvest extension.
// Harvest is a no-build MV3 extension loaded unpacked, so "install" just
// confirms the manifest parses, every referenced source file exists, and
// every JS file is syntactically valid. Runs offline and is idempotent.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg) => {
  console.error(`\u2717 ${msg}`);
  process.exitCode = 1;
};

const manifestPath = join(repoRoot, "manifest.json");
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  console.log("\u2713 manifest.json is valid JSON");
} catch (err) {
  fail(`manifest.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

// Collect every file the manifest references.
const referenced = new Set();
const add = (p) => p && referenced.add(p);
add(manifest.background?.service_worker);
add(manifest.side_panel?.default_path);
for (const cs of manifest.content_scripts ?? []) {
  for (const js of cs.js ?? []) add(js);
  for (const css of cs.css ?? []) add(css);
}
for (const size of Object.keys(manifest.icons ?? {})) add(manifest.icons[size]);
for (const war of manifest.web_accessible_resources ?? []) {
  for (const r of war.resources ?? []) add(r);
}

for (const rel of referenced) {
  if (!existsSync(join(repoRoot, rel))) fail(`manifest references missing file: ${rel}`);
}
if (!process.exitCode) console.log(`\u2713 all ${referenced.size} manifest-referenced files exist`);

// Syntax-check every JS file in the project (source + vendored).
const jsFiles = execFileSync("bash", [
  "-c",
  "find src vendor -name '*.js' | sort",
], { cwd: repoRoot, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

let jsOk = 0;
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ["--check", f], { cwd: repoRoot });
    jsOk++;
  } catch (err) {
    fail(`JS syntax error in ${f}: ${err.stderr?.toString() ?? err.message}`);
  }
}
if (jsOk === jsFiles.length) console.log(`\u2713 ${jsOk} JS files pass syntax check`);

if (process.exitCode) {
  console.error("\nValidation failed.");
} else {
  console.log("\nHarvest validation passed \u2014 load /workspace unpacked at chrome://extensions.");
}
