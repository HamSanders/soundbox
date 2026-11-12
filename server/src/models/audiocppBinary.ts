/**
 * Fetches and manages the `audiocpp_cli` binary itself.
 *
 * Every model Konchi runs goes through one native binary rather than a
 * pip-installable package, so this module is the auto-managed alternative to
 * "download it yourself and set KONCHI_AUDIOCPP_BIN": resolve OS + backend,
 * download the matching GitHub release asset, verify it, and cache it under
 * the data directory. `audiocpp.findBinary()` checks this managed location
 * before falling back to PATH, so an installed-via-CLI binary is picked up
 * automatically.
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

export const GITHUB_REPO = "0xShug0/audio.cpp";
export const BINARY_NAME =
  process.platform === "win32" ? "audiocpp_cli.exe" : "audiocpp_cli";

/** Used when the caller doesn't pin a version. */
export const DEFAULT_VERSION = "latest";

/** Bring-your-own override: an absolute path to an audiocpp_cli the user
 *  installed themselves. Re-exported from `audiocpp.ts`, which is where the
 *  error messages that name it live. */
export const BIN_ENV = "KONCHI_AUDIOCPP_BIN";

/** How long a single HTTP call may take. Release metadata is small; the binary
 *  download itself streams with its own progress reporting below. */
const HTTP_TIMEOUT_MS = 30_000;

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
 * "managed" is our own install under `<data dir>/bin/audiocpp/<version>`;
 * "env" and "path" are the bring-your-own routes. Only a managed install has
 * a version we know, and only a managed install is ours to upgrade or delete.
 */
export type BinarySource = "managed" | "env" | "path";

export interface InstallStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
  backend: string | null;
  source: BinarySource | null;
}

/**
 * `<data dir>/bin/audiocpp/` — sibling of `models/`, not inside it: this holds
 * an executable, not weights, and the two should be clearable independently
 * (deleting models shouldn't remove the runtime, and vice versa).
 */
function installRoot(): string {
  let root: string;
  try {
    // `base`, not `root`: the runtimes are shared by every profile — see
    // profiles.ts — so switching profile must not re-download a binary.
    root = getConfig().paths.base;
  } catch {
    // Config not constructed yet (tests, CLI before startup) — fall back to
    // the same default Config() would use, so a status check still works.
    root = defaultDataDir();
  }
  return join(root, "bin", "audiocpp");
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

/**
 * The binary from the most recently installed version, if any.
 *
 * `installedVersions()` sorts by mtime of the version directory, so a fresh
 * install always wins over an older cached version without needing a separate
 * "active" pointer file to keep in sync.
 */
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
 * Whether *a* usable audiocpp_cli exists, managed or not.
 *
 * Resolves through the same `findBinary()` order generation uses, so someone
 * who set `KONCHI_AUDIOCPP_BIN` or ran `brew install audio-cpp` isn't told
 * the runtime is missing and pushed into downloading a second copy. Only a
 * managed install carries a version — an external binary's release tag isn't
 * ours to know, and inferring it from a directory name would be a guess
 * presented as fact.
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
    backend: detectBackend(),
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
 * Locate audiocpp_cli: explicit env var, then a `konchi model install
 * audiocpp`-managed install, then PATH.
 *
 * The managed dir is checked before PATH so a user who ran the installer
 * doesn't have a stray system-wide `audiocpp_cli` silently win instead.
 */
export async function findBinary(): Promise<string | null> {
  const override = (envVar(BIN_ENV) ?? "").trim();
  if (override) return (await isFile(override)) ? override : null;

  const managed = await findManagedBinary();
  if (managed) return managed;

  const onPath = await which(BINARY_NAME);
  if (onPath) return onPath;

  // A process this app spawns (e.g. via the Tauri desktop shell, or any
  // other launcher that doesn't source a login shell's rc files) often gets
  // a PATH that omits Homebrew entirely, even though `brew install
  // audio-cpp` — the documented macOS install path (docs/AUDIOCPP.md) — put
  // the binary right where PATH lookup should have found it. Check the
  // well-known Homebrew prefixes directly rather than make every launcher
  // responsible for propagating PATH correctly.
  if (process.platform === "darwin") {
    for (const prefix of ["/opt/homebrew/bin", "/usr/local/bin"]) {
      const candidate = join(prefix, BINARY_NAME);
      if (await isFile(candidate)) return candidate;
    }
  }

  return null;
}

/** `shutil.which` equivalent: PATH lookup honouring PATHEXT on Windows. */
async function which(name: string): Promise<string | null> {
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, name.toLowerCase().endsWith(ext.toLowerCase()) ? name : name + ext);
      if (await isFile(candidate)) return candidate;
    }
  }
  return null;
}

/* ---------------------------------------------------------- asset matching */

function platformTag(): string {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

let _backendCache: string | null = null;

/**
 * Best-effort GPU backend guess, the same signal audiocpp.ts's generate-time
 * `backend()` uses, so "what did we install" and "what will we run with" don't
 * disagree.
 *
 * Deviation from the Python, which asked torch whether CUDA/MPS were
 * available. There is no torch in the Node backend (that was the point of
 * moving to audio.cpp), so this probes the environment directly: Apple silicon
 * always has Metal, and an `nvidia-smi` that runs and exits cleanly is the
 * cheapest reliable CUDA signal. Never fail here — a wrong guess costs speed,
 * an exception costs the install.
 */
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
      if (probe.status === 0) result = "cuda";
    }
  } catch {
    result = "cpu";
  }
  _backendCache = result;
  return result;
}

let _driverCudaCache: number | null | undefined;

/**
 * The newest CUDA version the installed NVIDIA driver supports, as
 * major + minor/100 (12.4 → 12.04), or null when it can't be read.
 *
 * Upstream publishes one CUDA build per toolkit (0.9.x: cuda12.4 and
 * cuda13.3), and a build newer than the driver fails to load its backend. The
 * header line is "CUDA Version: 12.4" on older drivers and "CUDA UMD Version:
 * 13.4" on newer ones.
 */
export function driverCudaVersion(): number | null {
  if (_driverCudaCache !== undefined) return _driverCudaCache;
  let result: number | null = null;
  try {
    const probe = spawnSync("nvidia-smi", [], { timeout: 5_000, windowsHide: true, encoding: "utf-8" });
    if (probe.status === 0) result = parseCudaVersion(probe.stdout ?? "");
  } catch {
    result = null;
  }
  _driverCudaCache = result;
  return result;
}

export function parseCudaVersion(nvidiaSmiOutput: string): number | null {
  const m = /CUDA (?:UMD )?Version:\s*(\d+)\.(\d+)/.exec(nvidiaSmiOutput);
  return m ? Number(m[1]) + Number(m[2]) / 100 : null;
}

/** The CUDA toolkit an asset was built against ("cuda12.4" → 12.04), or null
 *  for an asset whose name carries no version (0.6.x's "cuda-balance"). */
function assetCudaVersion(assetName: string): number | null {
  const m = /cuda(\d+)(?:\.(\d+))?/.exec(assetName.toLowerCase());
  return m ? Number(m[1]) + Number(m[2] ?? 0) / 100 : null;
}

/**
 * A tie-break in [0, 1) between CUDA builds that otherwise score the same:
 * the newest one the driver can run, or the oldest when the driver's version
 * is unknown (the most likely to load). A build newer than the driver gets 0.
 */
export function cudaPreference(assetName: string, driverCuda: number | null): number {
  const v = assetCudaVersion(assetName);
  if (v === null) return 0;
  if (driverCuda === null) return 0.5 - v / 1000;
  return v <= driverCuda ? 0.5 + v / 1000 : 0;
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
 * Release asset naming isn't standardized across projects, so this matches on
 * substrings rather than a strict pattern.
 */
export function assetScore(
  assetName: string,
  platform: string,
  backend: string,
  arch: string,
): number {
  const name = assetName.toLowerCase();
  if (!matchesPlatform(name, platform)) return 0;
  // The CUDA runtime package is DLLs only — it ships no audiocpp_cli at all,
  // so picking it as the primary asset fails with "contains no audiocpp_cli".
  // It's fetched separately as a companion; see companionAsset().
  if (isRuntimeOnlyAsset(name)) return 0;
  // 0.9.x also publishes packages with no CLI in them: the C API libraries
  // (`-lib-`), server config examples, and a Linux CUDA build made for Colab
  // that ships audiocpp_server alone.
  if (/-lib-|server-config|colab/.test(name)) return 0;
  let score = 1;
  if (backend !== "cpu" && name.includes(backend)) score += 3;
  if (backend === "cpu" && name.includes("cpu")) score += 1;
  if (name.includes(arch)) score += 1;
  // Prefer the vendor's own recommended default among the CPU-profile
  // variants (fast/balance/portable): "balance" is AVX2 and runs on any
  // modern x86-64, where "fast" is built for the packager's CPU and can fault
  // on anything missing its SIMD extensions. Without this the choice comes
  // down to asset ordering, which is not a decision anyone made.
  if (name.includes("balance")) score += 1;
  return score;
}

/** Upstream names its Linux assets after the distribution ("ubuntu-x64")
 *  rather than the OS. */
function matchesPlatform(name: string, platform: string): boolean {
  if (name.includes(platform)) return true;
  if (platform === "windows") return name.includes(".exe") || name.includes("win");
  if (platform === "linux") return name.includes("ubuntu");
  return false;
}

/** A package that carries shared libraries but no executable: audio.cpp's
 *  split-out CUDA runtime, which every CUDA profile package needs alongside
 *  it. 0.6.x called it `cuda-runtime`, 0.9.x calls it `cudart`. */
function isRuntimeOnlyAsset(assetName: string): boolean {
  return /runtime|cudart/.test(assetName.toLowerCase());
}

/**
 * The extra package `primary` needs unpacked beside it, if any.
 *
 * CUDA releases are split in two — one profile package with the binary, plus
 * one large shared runtime package of CUDA DLLs — so installing only the
 * profile package yields a binary that loads but reports "CUDA backend
 * requested but it is not registered in this build". Both halves have to land
 * in the same directory for the backend to register.
 */
export function companionAsset(release: Release, primary: ReleaseAsset): ReleaseAsset | null {
  if (!primary.name.toLowerCase().includes("cuda")) return null;
  const platform = platformTag();
  // The runtime has to match the toolkit the binary was built with: a
  // cuda13.3 binary beside cuda12.4 DLLs fails to load its backend.
  const wanted = assetCudaVersion(primary.name);
  for (const asset of release.assets ?? []) {
    const name = asset.name.toLowerCase();
    if (
      matchesPlatform(name, platform) &&
      name.includes("cuda") &&
      isRuntimeOnlyAsset(name) &&
      (wanted === null || assetCudaVersion(name) === wanted)
    ) {
      return asset;
    }
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
      `Could not reach GitHub to look up audio.cpp release '${version}' ` +
        `(${String(exc)}). Check your network, or download a binary manually per ` +
        `docs/AUDIOCPP.md and set KONCHI_AUDIOCPP_BIN.`,
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
  const driverCuda = resolved === "cuda" ? driverCudaVersion() : null;
  const scored = assets
    .map((a) => ({ score: assetScore(a.name, platform, resolved, arch), asset: a }))
    .filter((pair) => pair.score > 0)
    .map((pair) => ({
      ...pair,
      score: pair.score + (resolved === "cuda" ? cudaPreference(pair.asset.name, driverCuda) : 0),
    }));
  if (scored.length === 0) {
    const names = assets.map((a) => a.name).join(", ") || "(no assets published)";
    throw new InstallError(
      `No audio.cpp release asset matches this machine ` +
        `(${platform}/${resolved}/${arch}) in release '${release.tag_name}'. ` +
        `Available assets: ${names}\n\n` +
        `Download one manually from ` +
        `https://github.com/${GITHUB_REPO}/releases and set KONCHI_AUDIOCPP_BIN ` +
        `instead — see docs/AUDIOCPP.md.`,
    );
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.asset;
}

function checksumAsset(release: Release): ReleaseAsset | null {
  for (const asset of release.assets ?? []) {
    const name = asset.name.toLowerCase();
    if (
      name === "checksums.txt" ||
      name === "sha256sums.txt" ||
      name === "sha256sums" ||
      name.endsWith(".sha256")
    ) {
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
          progress(
            Math.min(0.9, done / total),
            `Downloading audiocpp_cli — ${Math.floor(done / 1024)} KB`,
          );
        }
      },
    });
    return sha256;
  } catch (exc) {
    if (exc instanceof DownloadError) throw new InstallError(`Download failed: ${exc.message}`);
    throw exc;
  }
}

/** The release's checksum manifest, or null when it publishes none. A
 *  manifest that is listed but can't be fetched is an error, not a reason to
 *  skip verification. */
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

/**
 * Runs `cmd` and returns its exit code plus captured stderr — swallowing
 * stderr here is how "Could not unpack X" ends up being the only diagnostic
 * a user ever sees for a real underlying error (bad archive, wrong tar,
 * permission denied). The caller decides whether to surface `stderr`.
 */
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

/**
 * Deviation from the Python, which used zipfile/tarfile from the stdlib. Node
 * ships neither a zip nor a tar reader, and pulling a dependency in for one
 * install path isn't worth it: every platform we target has a `tar` that reads
 * gzip, and on Windows and macOS that `tar` is bsdtar, which reads zip too.
 * GNU tar (Linux) does not, so zip falls back to `unzip` there.
 *
 * On Windows specifically, resolving `tar` via PATH is not safe: a machine
 * with Git Bash/MSYS2/Cygwin/WSL tools ahead of System32 in PATH gets GNU
 * tar, not the bundled bsdtar — and GNU tar parses a bare drive letter
 * (`C:\...`) as a `user@host:path` remote-shell spec, failing with
 * "Cannot connect to C: resolve failed" on every extraction. Pin to the
 * known System32 bsdtar so this doesn't depend on PATH order.
 */
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
          `Could not unpack ${basename(archive)} — install \`unzip\`, or download ` +
            `the release manually and set KONCHI_AUDIOCPP_BIN.` +
            (stderr ? `\n\n${stderr}` : ""),
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
  // Some releases publish the bare binary with no archive at all.
  await copyFile(archive, join(dest, basename(archive)));
}

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
 * Download, verify, and install audiocpp_cli. Returns the binary path.
 *
 * Idempotent-ish: re-running with the same version re-downloads (releases are
 * immutable, so this is only wasted bandwidth, never wrong state), and the
 * result always lands at the same `<version>/audiocpp_cli[.exe]` path.
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
  progress?.(0.0, `Installing audio.cpp ${resolvedVersion} (${asset.name})`);

  // A CUDA profile package is useless without the shared runtime DLLs, so the
  // two are fetched and unpacked as one unit — a half-installed CUDA build
  // fails at generate time with a message about the *backend*, giving no hint
  // that a second download was ever involved.
  const companion = companionAsset(release, asset);
  const sums = checksumAsset(release);

  const tmp = await mkdtemp(join(tmpdir(), "konchi-audiocpp-install-"));
  try {
    const checksumText = await fetchManifest(sums);

    // The runtime package dwarfs the profile package (hundreds of MB vs tens),
    // so it takes the bulk of the progress bar rather than an equal share.
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
      // Before extraction: nothing unverified gets unpacked into the install
      // directory, let alone run.
      verifyAsset(GITHUB_REPO, part.asset, sha256, checksumText, installError);
      progress?.(part.to, `Extracting ${part.asset.name}`);
      // Both unpack into the same directory: the CUDA DLLs have to sit beside
      // the executable that loads them.
      await extract(archive, destDir);
      // Reclaim as we go — profile plus runtime is well over a gigabyte of
      // archives, and keeping both until the end doubles the peak disk use.
      await rm(archive, { force: true }).catch(() => {});
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  let binary = await findExtractedBinary(destDir);
  if (binary === null) {
    throw new InstallError(
      `Downloaded ${asset.name} but it contains no ${BINARY_NAME}. The ` +
        `release layout may have changed — check ` +
        `https://github.com/${GITHUB_REPO}/releases/tag/${resolvedVersion}.`,
    );
  }
  const target = join(destDir, BINARY_NAME);
  if (binary !== target) {
    // Normalize to a predictable path regardless of the archive's internal
    // folder structure, so findManagedBinary() doesn't need to search on every
    // lookup.
    await rename(binary, target);
    binary = target;
  }

  if (process.platform !== "win32") {
    const mode = (await stat(binary)).mode;
    await chmod(binary, mode | 0o111);
  }

  progress?.(1.0, `Installed audio.cpp ${resolvedVersion}`);
  return binary;
}

/** True if `path` exists and is executable by this process. */
export async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
