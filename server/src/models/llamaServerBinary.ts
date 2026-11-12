/**
 * Fetches and manages the `llama-server` binary itself.
 *
 * Sibling of `audiocppBinary.ts`, same shape deliberately: resolve OS +
 * backend, download the matching GitHub release asset, verify it, and cache
 * it under the data directory. `findBinary()` here plays the same role
 * `audiocpp.ts`'s `findBinary()` does — env override, then the managed
 * install, then PATH — so an engine installed via the CLI or the Models page
 * is picked up automatically by `llm/runtime.ts`.
 */

import { spawn, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join, sep } from "node:path";

import { defaultDataDir, getConfig } from "../config.js";
import { DownloadError, downloadToFile } from "../download.js";
import {
  checkRelease,
  releaseApiUrl,
  verifyAsset,
  type Release,
  type ReleaseAsset,
} from "./releaseInstall.js";
import { envVar } from "../env.js";

export const GITHUB_REPO = "ggml-org/llama.cpp";
export const BINARY_NAME = process.platform === "win32" ? "llama-server.exe" : "llama-server";

/** Used when the caller doesn't pin a version (a release tag like "b4831"). */
export const DEFAULT_VERSION = "latest";

const HTTP_TIMEOUT_MS = 30_000;

export const BIN_ENV = "KONCHI_LLAMA_SERVER_BIN";
export const BACKEND_ENV = "KONCHI_LLAMA_SERVER_BACKEND";

/** Raised for anything the user could plausibly fix (no matching asset,
 *  checksum mismatch, network). Message is written for a human. */
export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallError";
  }
}

export type InstallProgressFn = (fraction: number, message: string) => void;

/**
 * Where a resolved binary came from. `null` when none was found.
 *
 * "managed" is our own install under `<data dir>/bin/llama/<version>`; "env"
 * and "path" are the bring-your-own routes. The distinction matters to the
 * caller: only a managed install has a version we know, and only a managed
 * install is ours to upgrade or delete.
 */
export type BinarySource = "managed" | "env" | "path";

export interface InstallStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
  backend: string | null;
  source: BinarySource | null;
}

/** `<data dir>/bin/llama/` — sibling of `bin/audiocpp/`: a separate managed
 *  runtime, cleared independently of both the audio engine and the LLM
 *  weights under `models/llm/`. */
function installRoot(): string {
  let root: string;
  try {
    // `base`, not `root`: the runtimes are shared by every profile — see
    // profiles.ts — so switching profile must not re-download a binary.
    root = getConfig().paths.base;
  } catch {
    root = defaultDataDir();
  }
  return join(root, "bin", "llama");
}

function versionDir(version: string): string {
  return join(installRoot(), version);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The binary from the most recently installed version, if any. Same
 *  mtime-sorted approach as `audiocppBinary.findManagedBinary` — no separate
 *  "active version" pointer file to keep in sync. */
export async function findManagedBinary(): Promise<string | null> {
  for (const version of await installedVersions()) {
    const candidate = join(versionDir(version), BINARY_NAME);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

export async function installedVersions(): Promise<string[]> {
  const root = installRoot();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs: { name: string; mtime: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (!(await isFile(join(dir, BINARY_NAME)))) continue;
    dirs.push({ name: entry.name, mtime: (await stat(dir)).mtimeMs });
  }
  dirs.sort((a, b) => b.mtime - a.mtime);
  return dirs.map((d) => d.name);
}

/**
 * Whether *a* usable llama-server exists, managed or not.
 *
 * Resolves through the same `findBinary()` order the runtime launches with,
 * so a user who set `KONCHI_LLAMA_SERVER_BIN` or has llama.cpp on PATH is
 * not told the engine is missing and pushed into downloading a second copy.
 * Only a managed install carries a version — an external binary's release tag
 * isn't ours to know, and guessing it from a directory name would be a lie.
 */
export async function status(): Promise<InstallStatus> {
  const binary = await findBinary();
  if (binary === null) {
    return { installed: false, version: null, path: null, backend: null, source: null };
  }
  const managed = isManagedPath(binary);
  return {
    installed: true,
    version: managed ? basename(join(binary, "..")) : null,
    path: binary,
    backend: backend(),
    source: managed ? "managed" : (envVar(BIN_ENV) ?? "").trim() ? "env" : "path",
  };
}

/** Whether `path` is one of ours, i.e. sits under the managed install root.
 *  Prefix comparison rather than a re-scan of `installedVersions()`: the
 *  question is only "did we put it there", and both sides come from `join()`
 *  so separators already agree. */
function isManagedPath(path: string): boolean {
  const root = installRoot();
  return path === root || path.startsWith(root + sep);
}

/**
 * Env override, then the managed install, then PATH — same order
 * `audiocpp.ts`'s `findBinary()` uses, so an install via `konchi model
 * install llm` or a hand-set env var both work without restarting.
 */
export async function findBinary(): Promise<string | null> {
  const override = (envVar(BIN_ENV) ?? "").trim();
  if (override) return (await isFile(override)) ? override : null;

  const managed = await findManagedBinary();
  if (managed) return managed;

  const onPath = await which(BINARY_NAME);
  if (onPath) return onPath;

  // Same launcher problem `audiocpp.findBinary()` documents: a server spawned
  // by the desktop shell often inherits a PATH without Homebrew in it, even
  // though `brew install llama.cpp` put llama-server exactly where PATH lookup
  // should have found it.
  if (process.platform === "darwin") {
    for (const prefix of ["/opt/homebrew/bin", "/usr/local/bin"]) {
      const candidate = join(prefix, BINARY_NAME);
      if (await isFile(candidate)) return candidate;
    }
  }

  return null;
}

async function which(name: string): Promise<string | null> {
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name.toLowerCase().endsWith(ext.toLowerCase()) ? name : name + ext);
      if (await isFile(candidate)) return candidate;
    }
  }
  return null;
}

/* ---------------------------------------------------------- asset matching */

function platformTag(): string {
  if (process.platform === "win32") return "win";
  if (process.platform === "darwin") return "macos";
  return "ubuntu";
}

let _backendCache: string | null = null;

/** Same probe as `audiocppBinary.detectBackend`: Metal on Apple silicon,
 *  Vulkan as the cross-vendor GPU fallback on Windows/Linux (broader hardware
 *  coverage than CUDA alone for a small chat model), CPU otherwise. */
export function detectBackend(): string {
  if (_backendCache !== null) return _backendCache;
  let result = "cpu";
  try {
    if (process.platform === "darwin") {
      result = "metal";
    } else {
      const probe = spawnSync("nvidia-smi", ["-L"], {
        timeout: 5_000,
        windowsHide: true,
        stdio: "ignore",
      });
      result = probe.status === 0 ? "cuda" : "vulkan";
    }
  } catch {
    result = "vulkan";
  }
  _backendCache = result;
  return result;
}

/** The backend actually in force: env override, else the same detection
 *  `install()` uses to pick a release asset. */
export function backend(): string {
  const override = (envVar(BACKEND_ENV) ?? "").trim();
  if (override) return override;
  return detectBackend();
}

function archTag(): string {
  const machine = process.arch.toLowerCase();
  if (machine === "x64" || machine === "amd64" || machine === "x86_64") return "x64";
  if (machine === "arm64" || machine === "aarch64") return "arm64";
  return machine;
}

/**
 * Higher is a better match. 0 means "wrong platform, never pick this."
 *
 * llama.cpp's release assets (as of the `bNNNN` tag scheme) are named like
 * `llama-<tag>-bin-win-cuda-12.4-x64.zip`, `llama-<tag>-bin-win-vulkan-x64.zip`,
 * `llama-<tag>-bin-win-cpu-x64.zip`, `llama-<tag>-bin-macos-arm64.zip`,
 * `llama-<tag>-bin-ubuntu-x64.zip`, plus a DLL-only `cudart-llama-bin-win-cuda-*`
 * companion for the CUDA build. Matched on substrings, not a strict pattern —
 * asset naming has drifted across releases before and will again.
 */
export function assetScore(
  assetName: string,
  platform: string,
  backend: string,
  arch: string,
): number {
  const name = assetName.toLowerCase();
  if (!name.includes(platform)) return 0;
  // The cudart package ships DLLs only, no llama-server binary at all — it is
  // fetched separately as a companion; see companionAsset().
  if (isRuntimeOnlyAsset(name)) return 0;
  // macOS releases bundle Metal support in one universal-ish build per arch;
  // there's no separate "metal" tag to match on.
  if (platform === "macos") {
    let score = name.includes(arch) ? 2 : 0;
    return score;
  }
  let score = 1;
  if (backend !== "cpu" && name.includes(backend)) score += 3;
  if (backend === "cpu" && name.includes("cpu")) score += 1;
  if (name.includes(arch)) score += 1;
  return score;
}

function isRuntimeOnlyAsset(assetName: string): boolean {
  return assetName.toLowerCase().startsWith("cudart-");
}

/**
 * The extra DLL package `primary` needs unpacked beside it, if any. Mirrors
 * `audiocppBinary.companionAsset` — a CUDA `llama-server.exe` fails to start
 * ("cudart64_12.dll not found") without these sitting in the same directory.
 */
export function companionAsset(release: Release, primary: ReleaseAsset): ReleaseAsset | null {
  if (!primary.name.toLowerCase().includes("cuda")) return null;
  for (const asset of release.assets ?? []) {
    const name = asset.name.toLowerCase();
    if (name.startsWith("cudart-") && name.includes("win")) return asset;
  }
  return null;
}

/* ----------------------------------------------------------------- network */

async function fetchWithTimeout(url: string, headers: Record<string, string>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const installError = (message: string) => new InstallError(message);

async function getRelease(version: string): Promise<Release> {
  // Validated before it goes anywhere near a URL — see releaseInstall.ts.
  const url = releaseApiUrl(GITHUB_REPO, version, installError);
  let release: Release;
  try {
    const resp = await fetchWithTimeout(url, {
      Accept: "application/vnd.github+json",
      "User-Agent": "konchi",
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    release = (await resp.json()) as Release;
  } catch (exc) {
    throw new InstallError(
      `Could not reach GitHub to look up llama.cpp release '${version}' (${String(exc)}). ` +
        `Check your network, or download llama-server manually from ` +
        `https://github.com/${GITHUB_REPO}/releases and set ${BIN_ENV}.`,
    );
  }
  checkRelease(GITHUB_REPO, release, installError);
  return release;
}

function pickAsset(release: Release, backend: string | null): ReleaseAsset {
  const platform = platformTag();
  const arch = archTag();
  const resolved = backend || detectBackend();
  const assets = release.assets ?? [];
  const scored = assets
    .map((a) => ({ score: assetScore(a.name, platform, resolved, arch), asset: a }))
    .filter((pair) => pair.score > 0);
  if (scored.length === 0) {
    const names = assets.map((a) => a.name).join(", ") || "(no assets published)";
    throw new InstallError(
      `No llama.cpp release asset matches this machine (${platform}/${resolved}/${arch}) ` +
        `in release '${release.tag_name}'. Available assets: ${names}\n\n` +
        `Download one manually from https://github.com/${GITHUB_REPO}/releases and set ` +
        `${BIN_ENV} instead.`,
    );
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.asset;
}

function checksumAsset(release: Release): ReleaseAsset | null {
  for (const asset of release.assets ?? []) {
    const name = asset.name.toLowerCase();
    if (name === "sha256sums.txt" || name === "checksums.txt" || name.endsWith(".sha256")) {
      return asset;
    }
  }
  return null;
}

/** Stream one release asset to `dest`, returning its SHA-256. */
async function download(
  url: string,
  dest: string,
  progress?: InstallProgressFn,
): Promise<string> {
  try {
    const { sha256 } = await downloadToFile(url, dest, {
      headers: { "User-Agent": "konchi" },
      onProgress: (done, total) => {
        if (progress && total) {
          progress(Math.min(0.9, done / total), `Downloading llama-server — ${Math.floor(done / 1024)} KB`);
        }
      },
    });
    return sha256;
  } catch (exc) {
    if (exc instanceof DownloadError) throw new InstallError(`Download failed: ${exc.message}`);
    throw exc;
  }
}

/** The release's checksum manifest, or null when it publishes none — same
 *  rule as `audiocppBinary`: listed but unfetchable is an error. Current
 *  llama.cpp releases publish no manifest, so in practice GitHub's per-asset
 *  `digest` is what verifies these (see `releaseInstall.verifyAsset`). */
async function fetchManifest(sums: ReleaseAsset | null): Promise<string | null> {
  if (sums === null) return null;
  const resp = await fetchWithTimeout(sums.browser_download_url, { "User-Agent": "konchi" });
  if (!resp.ok) {
    throw new InstallError(
      `Could not fetch ${sums.name} to verify the download (HTTP ${resp.status}). Try again.`,
    );
  }
  return await resp.text();
}

function run(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr: stderr.trim() }));
  });
}

/** Same bsdtar-pinning rationale as `audiocppBinary.windowsTar` — resolving
 *  `tar` via PATH risks picking up GNU tar ahead of System32's bsdtar, which
 *  mis-parses a bare `C:\...` destination as a remote-shell spec. */
function windowsTar(): string {
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return join(systemRoot, "System32", "tar.exe");
}

async function extract(archive: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const name = basename(archive).toLowerCase();
  const tarCmd = process.platform === "win32" ? windowsTar() : "tar";
  if (name.endsWith(".zip")) {
    if (process.platform === "linux") {
      const { code, stderr } = await run("unzip", ["-o", archive, "-d", dest]);
      if (code !== 0) {
        throw new InstallError(
          `Could not unpack ${basename(archive)} — install \`unzip\`, or download the ` +
            `release manually and set ${BIN_ENV}.` + (stderr ? `\n\n${stderr}` : ""),
        );
      }
      return;
    }
    const { code, stderr } = await run(tarCmd, ["-xf", archive, "-C", dest]);
    if (code !== 0) {
      throw new InstallError(`Could not unpack ${basename(archive)}.` + (stderr ? `\n\n${stderr}` : ""));
    }
    return;
  }
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz") || name.endsWith(".tar")) {
    const { code, stderr } = await run(tarCmd, ["-xf", archive, "-C", dest]);
    if (code !== 0) {
      throw new InstallError(`Could not unpack ${basename(archive)}.` + (stderr ? `\n\n${stderr}` : ""));
    }
    return;
  }
  await copyFile(archive, join(dest, basename(archive)));
}

/** Searches recursively — llama.cpp's Windows zips place the binary at the
 *  archive root, but Ubuntu builds have historically nested it under
 *  `build/bin/`, so the layout can't be assumed. */
async function findExtractedBinary(root: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findExtractedBinary(path);
      if (nested) return nested;
    } else if (entry.name === BINARY_NAME) {
      return path;
    }
  }
  return null;
}

/* --------------------------------------------------------------------- API */

/**
 * Download, verify, and install `llama-server`. Returns the binary path.
 *
 * Idempotent-ish, same as `audiocppBinary.install`: re-running with the same
 * version re-downloads, and the result always lands at
 * `<version>/llama-server[.exe]`.
 */
export async function install(
  version: string = DEFAULT_VERSION,
  backend: string | null = null,
  progress?: InstallProgressFn,
): Promise<string> {
  const release = await getRelease(version);
  // checkRelease() has already vetted this as a directory name.
  const resolvedVersion = release.tag_name!;
  const asset = pickAsset(release, backend);

  const destDir = versionDir(resolvedVersion);
  progress?.(0.0, `Installing llama.cpp ${resolvedVersion} (${asset.name})`);

  const companion = companionAsset(release, asset);
  const sums = checksumAsset(release);

  const tmp = await mkdtemp(join(tmpdir(), "konchi-llama-install-"));
  try {
    const checksumText = await fetchManifest(sums);

    const parts: { asset: ReleaseAsset; from: number; to: number }[] = companion
      ? [
          { asset, from: 0.0, to: 0.25 },
          { asset: companion, from: 0.25, to: 0.9 },
        ]
      : [{ asset, from: 0.0, to: 0.9 }];

    for (const part of parts) {
      const archive = join(tmp, part.asset.name);
      const sha256 = await download(part.asset.browser_download_url, archive, (f, m) =>
        progress?.(part.from + f * (part.to - part.from), m),
      );
      verifyAsset(GITHUB_REPO, part.asset, sha256, checksumText, installError);
      progress?.(part.to, `Extracting ${part.asset.name}`);
      await extract(archive, destDir);
      await rm(archive, { force: true }).catch(() => {});
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  let binary = await findExtractedBinary(destDir);
  if (binary === null) {
    throw new InstallError(
      `Downloaded ${asset.name} but it contains no ${BINARY_NAME}. The release layout may ` +
        `have changed — check https://github.com/${GITHUB_REPO}/releases/tag/${resolvedVersion}.`,
    );
  }
  const target = join(destDir, BINARY_NAME);
  if (binary !== target) {
    await rename(binary, target);
    binary = target;
  }

  if (process.platform !== "win32") {
    const mode = (await stat(binary)).mode;
    await chmod(binary, mode | 0o111);
  }

  progress?.(1.0, `Installed llama.cpp ${resolvedVersion}`);
  return binary;
}

export async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
