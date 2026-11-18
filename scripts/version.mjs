#!/usr/bin/env node
/**
 * The app's version, kept in step across every file that records it.
 *
 *   node scripts/version.mjs check              all files agree? prints the version
 *   node scripts/version.mjs bump <patch|minor|major|X.Y.Z>
 *                                               set it everywhere and turn the
 *                                               changelog's Unreleased section
 *                                               into this release's
 *   node scripts/version.mjs notes [X.Y.Z]      print that release's changelog
 *                                               section (default: current version)
 *
 * The files: the root, app, server and site package.json, both entries'
 * mirrors in package-lock.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
 * and its Cargo.lock entry, and server.json (the MCP Registry entry: its
 * version and the Docker image tag it points at). Edits are textual so formatting and key order stay
 * as they were. Versions are plain X.Y.Z: the Windows installer's version
 * field takes numbers only, so a release candidate is a build of the release
 * PR rather than a -rc version (see docs/RELEASING.md).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const PLAIN = /^\d+\.\d+\.\d+$/;
const WORKSPACES = ["", "app", "server", "site"];

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const write = (rel, text) => writeFileSync(join(ROOT, rel), text);

function fail(message) {
  console.error(`version: ${message}`);
  process.exit(1);
}

/** The first `"version": "…"` in a JSON file: the top-level one in every
 *  file we read this way, since each declares it before anything nested. */
const JSON_VERSION = /("version"\s*:\s*")([^"]+)(")/;

const CARGO_TOML = /^(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m;
/** The image tag in server.json's OCI package: `…/soundbox:v0.5.0`. */
const OCI_TAG = /("identifier"\s*:\s*"ghcr\.io\/hamsanders\/soundbox:v)([^"]+)(")/;

const CARGO_LOCK = /(\[\[package\]\]\r?\nname = "soundbox-desktop"\r?\nversion = ")([^"]+)(")/;

/** Every place the version lives, each with how to read and write it. */
const SOURCES = [
  ...WORKSPACES.map((ws) => {
    const file = ws ? `${ws}/package.json` : "package.json";
    return { label: file, file, pattern: JSON_VERSION };
  }),
  { label: "src-tauri/tauri.conf.json", file: "src-tauri/tauri.conf.json", pattern: JSON_VERSION },
  { label: "src-tauri/Cargo.toml", file: "src-tauri/Cargo.toml", pattern: CARGO_TOML },
  { label: "src-tauri/Cargo.lock", file: "src-tauri/Cargo.lock", pattern: CARGO_LOCK },
  { label: "server.json", file: "server.json", pattern: JSON_VERSION },
  { label: "server.json (image tag)", file: "server.json", pattern: OCI_TAG },
];

/** package-lock.json is parsed rather than matched: the same workspace
 *  version appears under several keys, and npm writes it as plain JSON. */
function lockVersions() {
  const lock = JSON.parse(read("package-lock.json"));
  return [
    ["package-lock.json (root)", lock.version],
    ...WORKSPACES.map((ws) => [`package-lock.json (${ws || "\"\""})`, lock.packages?.[ws]?.version]),
  ];
}

function setLockVersion(version) {
  const text = read("package-lock.json");
  const lock = JSON.parse(text);
  lock.version = version;
  for (const ws of WORKSPACES) {
    if (lock.packages?.[ws]) lock.packages[ws].version = version;
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  write("package-lock.json", JSON.stringify(lock, null, 2).replace(/\n/g, eol) + eol);
}

function allVersions() {
  const found = SOURCES.map(({ label, file, pattern }) => {
    const m = pattern.exec(read(file));
    return [label, m ? m[2] : undefined];
  });
  return [...found, ...lockVersions()];
}

function check() {
  const found = allVersions();
  const expected = found[0][1];
  const wrong = found.filter(([, v]) => v !== expected);
  if (wrong.length) {
    const table = found.map(([label, v]) => `  ${v === expected ? " " : "✗"} ${label}: ${v ?? "(not found)"}`);
    fail(`files disagree (package.json says ${expected}):\n${table.join("\n")}\n` +
      "Set them together with `node scripts/version.mjs bump <X.Y.Z>`.");
  }
  if (!PLAIN.test(expected)) fail(`${expected} is not a plain X.Y.Z version`);
  return expected;
}

function next(current, how) {
  if (PLAIN.test(how)) return how;
  const [major, minor, patch] = current.split(".").map(Number);
  if (how === "patch") return `${major}.${minor}.${patch + 1}`;
  if (how === "minor") return `${major}.${minor + 1}.0`;
  if (how === "major") return `${major + 1}.0.0`;
  fail(`expected patch, minor, major or X.Y.Z, got "${how ?? ""}"`);
}

const isNewer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

/**
 * Rename `## [Unreleased]` to `## [X.Y.Z] - date`, open a fresh empty
 * Unreleased above it, and rewrite the compare links at the bottom. Refuses
 * an empty Unreleased section: a release with nothing to say is a mistake.
 */
function cutChangelog(previous, version, date) {
  const text = read("CHANGELOG.md");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const head = /^## \[Unreleased\][^\S\r\n]*\r?\n/m.exec(text);
  if (!head) fail("CHANGELOG.md has no `## [Unreleased]` heading");
  const rest = text.slice(head.index + head[0].length);
  const end = rest.search(/^## \[/m);
  const body = (end === -1 ? rest : rest.slice(0, end)).replace(/^\[[^\]]+\]: .*$/gm, "");
  if (!body.trim()) fail("CHANGELOG.md's Unreleased section is empty: nothing to release");

  const repo = /\[Unreleased\]: (https:\/\/github\.com\/[^/]+\/[^/]+)\/compare\//.exec(text)?.[1];
  if (!repo) fail("CHANGELOG.md has no [Unreleased] compare link to update");

  let out =
    text.slice(0, head.index) +
    `## [Unreleased]${eol}${eol}## [${version}] - ${date}${eol}` +
    rest;
  out = out.replace(
    /^\[Unreleased\]: .*$/m,
    `[Unreleased]: ${repo}/compare/v${version}...HEAD${eol}` +
      `[${version}]: ${repo}/compare/v${previous}...v${version}`,
  );
  write("CHANGELOG.md", out);
}

function bump(how) {
  const current = check();
  const version = next(current, how);
  if (!isNewer(version, current)) fail(`${version} is not newer than ${current}`);
  cutChangelog(current, version, new Date().toISOString().slice(0, 10));
  for (const { file, pattern } of SOURCES) {
    write(file, read(file).replace(pattern, (_, a, _v, c) => a + version + c));
  }
  setLockVersion(version);
  check();
  return version;
}

/** One release's changelog section, without its heading: the release notes. */
function notes(version) {
  const text = read("CHANGELOG.md");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = new RegExp(`^## \\[${escaped}\\][^\\n]*\\n`, "m").exec(text);
  if (!head) fail(`CHANGELOG.md has no section for ${version}`);
  const rest = text.slice(head.index + head[0].length);
  const end = rest.search(/^## \[|^\[[^\]]+\]: /m);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

const [command, arg] = process.argv.slice(2);
if (command === "check") console.log(check());
else if (command === "bump") console.log(bump(arg));
else if (command === "notes") console.log(notes(arg ?? check()));
else fail("usage: version.mjs check | bump <patch|minor|major|X.Y.Z> | notes [X.Y.Z]");
