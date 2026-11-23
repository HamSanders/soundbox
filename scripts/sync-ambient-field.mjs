#!/usr/bin/env node
// Copies the ambient background (app/src/lib/ambient/ambient-field.js) to the
// desktop splash, which loads before any server exists and so cannot import
// it from the app. `--check` fails instead of writing, for CI.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "app/src/lib/ambient/ambient-field.js");
const to = join(root, "src-tauri/splash/ambient-field.js");
const banner = "// Copied from app/src/lib/ambient/ambient-field.js by scripts/sync-ambient-field.mjs. Edit that one.\n";
const want = banner + readFileSync(from, "utf8");
let have = "";
try { have = readFileSync(to, "utf8"); } catch {}
if (have === want) process.exit(0);
if (process.argv.includes("--check")) {
  console.error(`${to} is out of date: run node scripts/sync-ambient-field.mjs`);
  process.exit(1);
}
writeFileSync(to, want);
console.log(`wrote ${to}`);
