/**
 * Fetches and manages the `sd-server` binary — the artwork engine.
 *
 * Third sibling of `audiocppBinary.ts` / `llamaServerBinary.ts`, and the same
 * shape on purpose: resolve OS + backend, download the matching GitHub release
 * asset, verify it, cache it under the data directory, and resolve env
 * override → managed install → PATH when something needs to run it.
 *
 * stable-diffusion.cpp is picked for the same reason audio.cpp is: one native
 * ggml binary that runs a checkpoint with no Python stack behind it. Its
 * `sd-server` exposes OpenAI-style `/v1/...` *and* Automatic1111-style
 * `/sdapi/v1/...` endpoints, which is what lets `image/client.ts` treat the
 * managed engine and somebody's existing Automatic1111 install as the same
 * thing — only the way the base URL is obtained differs.
 *
 * Two things differ from the llama.cpp installer, both confirmed against a
 * live release rather than assumed:
 *
 *   - Asset names carry the *build* platform, not a short tag:
 *     `sd-master-<sha>-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip`,
 *     `sd-master-<sha>-bin-Darwin-macOS-26.5.2-arm64.zip`,
 *     `sd-master-<sha>-bin-win-cuda12-x64.zip`. So platform and arch are
 *     matched on a set of aliases rather than one token.
 *   - No `SHA256SUMS.txt` is published. GitHub's own per-asset `digest` field
 *     is used instead, which is a stronger check than the manifest anyway
 *     since it comes from the API response rather than a file in the release.
 *     An asset without one is refused (see `releaseInstall.ts`).
 */

import { createHash } from "node:crypto";
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

export const GITHUB_REPO = "leejet/stable-diffusion.cpp";
export const BINARY_NAME = process.platform === "win32" ? "sd-server.exe" : "sd-server";

/** Used when the caller doesn't pin a version (a tag like `master-827-97d2990`). */
export const DEFAULT_VERSION = "latest";

const HTTP_TIMEOUT_MS = 30_000;

export const BIN_ENV = "KONCHI_SD_SERVER_BIN";
export const BACKEND_ENV = "KONCHI_SD_SERVER_BACKEND";

export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallError";
  }
}

export type InstallProgressFn = (fraction: number, message: string) => void;

/** Where a resolved binary came from; `null` when none was found. Same
 *  three routes, and the same reason for telling them apart, as the other two
 *  binary modules: only a managed install has a version we know. */
export type BinarySource = "managed" | "env" | "path";

export interface InstallStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
  backend: string | null;
  source: BinarySource | null;
}

/** `<data dir>/bin/sd/` — sibling of `bin/audiocpp/` and `bin/llama/`, so
 *  removing one runtime never disturbs another. */
function installRoot(): string {
  let root: string;
  try {
    // `base`, not `root`: the runtimes are shared by every profile — see
    // profiles.ts — so switching profile must not re-download a binary.
    root = getConfig().paths.base;
  } catch {
    root = defaultDataDir();
  }
  return join(root, "bin", "sd");
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

function isManagedPath(path: string): boolean {
  const root = installRoot();
  return path === root || path.startsWith(root + sep);
}

export async function findBinary(): Promise<string | null> {
  const override = (envVar(BIN_ENV) ?? "").trim();
  if (override) return (await isFile(override)) ? override : null;

  const managed = await findManagedBinary();
  if (managed) return managed;

  const onPath = await which(BINARY_NAME);
  if (onPath) return onPath;

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
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(
        dir,
        name.toLowerCase().endsWith(ext.toLowerCase()) ? name : name + ext,
      );
      if (await isFile(candidate)) return candidate;
    }
  }
  return null;
}

/* ---------------------------------------------------------- asset matching */

/** Tokens that identify this machine's OS in an asset name. More than one
 *  because the release names carry the *builder's* OS string. */
export function platformTags(): string[] {
  if (process.platform === "win32") return ["win"];
  if (process.platform === "darwin") return ["darwin", "macos"];
  return ["linux", "ubuntu"];
}

export function archTags(): string[] {
  const machine = process.arch.toLowerCase();
  if (["x64", "amd64", "x86_64"].includes(machine)) return ["x64", "x86_64", "amd64"];
  if (["arm64", "aarch64"].includes(machine)) return ["arm64", "aarch64"];
  return [machine];
}

let _backendCache: string | null = null;

/** Same probe as the other two binary modules: Metal on Apple silicon, CUDA
 *  where nvidia-smi answers, Vulkan as the cross-vendor fallback. */
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

export function backend(): string {
  const override = (envVar(BACKEND_ENV) ?? "").trim();
  if (override) return override;
  return detectBackend();
}

/**
 * Higher is a better match; 0 means "wrong platform, never pick this".
 *
 * Matched on substrings rather than a strict pattern, for the reason the
 * llama.cpp installer gives and this project has now hit twice: release asset
 * naming drifts. Two quirks specific to these assets, both from a live
 * release listing:
 *
 *   - The Linux CPU build carries *no* backend token at all
 *     (`...-Linux-Ubuntu-24.04-x86_64.zip`), while Windows spells it `cpu`.
 *     So a CPU target scores "has no other backend token" rather than
 *     "contains cpu".
 *   - CUDA is spelled `cuda12` on the primary asset and `cu12` on the cudart
 *     companion. Prefix matching on "cuda" catches the first; the companion is
 *     found by `companionAsset` instead.
 */
export function assetScore(
  assetName: string,
  platforms: string[],
  backend: string,
  arches: string[],
): number {
  const name = assetName.toLowerCase();
  if (!platforms.some((p) => name.includes(p))) return 0;
  // Runtime-only DLL packages contain no sd-server at all.
  if (isRuntimeOnlyAsset(name)) return 0;

  const otherBackends = ["cuda", "rocm", "vulkan", "hip", "sycl"].filter((b) => b !== backend);
  const hasOtherBackend = otherBackends.some((b) => name.includes(b));

  if (backend === "metal") {
    // macOS builds bundle Metal; there is no separate token to match on.
    return arches.some((a) => name.includes(a)) ? 3 : 1;
  }

  let score = 1;
  if (backend === "cpu") {
    // Either an explicit cpu build, or the plain one with no accelerator tag.
    if (name.includes("cpu")) score += 3;
    else if (!hasOtherBackend) score += 2;
    else return 0;
  } else {
    if (name.includes(backend)) score += 3;
    else if (hasOtherBackend) return 0; // a GPU build for the wrong vendor
  }
  if (arches.some((a) => name.includes(a))) score += 1;
  return score;
}

function isRuntimeOnlyAsset(assetName: string): boolean {
  return assetName.toLowerCase().startsWith("cudart-");
}

/** The CUDA runtime DLLs a Windows CUDA build needs beside it. Same failure
 *  mode the other two installers document: without these the binary dies on
 *  startup looking for `cudart64_*.dll`. */
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
      `Could not reach GitHub to look up stable-diffusion.cpp release '${version}' ` +
        `(${String(exc)}). Check your network, or download sd-server manually from ` +
        `https://github.com/${GITHUB_REPO}/releases and set ${BIN_ENV}.`,
    );
  }
  checkRelease(GITHUB_REPO, release, installError);
  return release;
}

function pickAsset(release: Release, backendOverride: string | null): ReleaseAsset {
  const platforms = platformTags();
  const arches = archTags();
  const resolved = backendOverride || detectBackend();
  const assets = release.assets ?? [];
  const scored = assets
    .map((a) => ({ score: assetScore(a.name, platforms, resolved, arches), asset: a }))
    .filter((pair) => pair.score > 0);
  if (scored.length === 0) {
    const names = assets.map((a) => a.name).join(", ") || "(no assets published)";
    throw new InstallError(
      `No stable-diffusion.cpp release asset matches this machine ` +
        `(${platforms[0]}/${resolved}/${arches[0]}) in release '${release.tag_name}'. ` +
        `Available assets: ${names}\n\nDownload one manually from ` +
        `https://github.com/${GITHUB_REPO}/releases and set ${BIN_ENV} instead.`,
    );
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.asset;
}

/**
 * Verify a download against GitHub's own `digest` for that asset.
 *
 * These releases publish no checksum manifest, so this is the only integrity
 * check available — and a better one than a manifest file, since it arrives in
 * the API response rather than as another asset an attacker would be editing
 * alongside the binary. No digest means nothing to verify against, which is
 * a refusal unless `KONCHI_ALLOW_UNVERIFIED_BINARIES` says otherwise.
 */
export function verifyDigest(assetName: string, bytes: Buffer, digest: string | null): void {
  const actual = createHash("sha256").update(bytes).digest("hex");
  verifyAsset(
    GITHUB_REPO,
    { name: assetName, browser_download_url: "", digest },
    actual,
    null,
    installError,
  );
}

/** Stream one release asset to `dest`, returning its SHA-256. */
async function download(url: string, dest: string, progress?: InstallProgressFn): Promise<string> {
  try {
    const { sha256 } = await downloadToFile(url, dest, {
      headers: { "User-Agent": "konchi" },
      onProgress: (done, total) => {
        if (progress && total) {
          progress(Math.min(0.9, done / total), `Downloading sd-server — ${Math.floor(done / 1024)} KB`);
        }
      },
    });
    return sha256;
  } catch (exc) {
    if (exc instanceof DownloadError) throw new InstallError(`Download failed: ${exc.message}`);
    throw exc;
  }
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

/** Same bsdtar pinning as the other installers: a GNU `tar` earlier on PATH
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
      throw new InstallError(
        `Could not unpack ${basename(archive)}.` + (stderr ? `\n\n${stderr}` : ""),
      );
    }
    return;
  }
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz") || name.endsWith(".tar")) {
    const { code, stderr } = await run(tarCmd, ["-xf", archive, "-C", dest]);
    if (code !== 0) {
      throw new InstallError(
        `Could not unpack ${basename(archive)}.` + (stderr ? `\n\n${stderr}` : ""),
      );
    }
    return;
  }
  await copyFile(archive, join(dest, basename(archive)));
}

/** Recursive: these zips nest the binaries under `bin/` on some platforms and
 *  put them at the archive root on others. */
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
 * Download, verify, and install `sd-server`. Returns the binary path.
 *
 * The whole archive is extracted, not just the one binary: these builds ship
 * shared libraries (ggml, the backend runtime) that the server loads from
 * beside itself, so pulling the executable out on its own would install
 * something that cannot start.
 */
export async function install(
  version: string = DEFAULT_VERSION,
  backendOverride: string | null = null,
  progress?: InstallProgressFn,
): Promise<string> {
  const release = await getRelease(version);
  // checkRelease() has already vetted this as a directory name.
  const resolvedVersion = release.tag_name!;
  const asset = pickAsset(release, backendOverride);

  const destDir = versionDir(resolvedVersion);
  progress?.(0.0, `Installing stable-diffusion.cpp ${resolvedVersion} (${asset.name})`);

  const companion = companionAsset(release, asset);
  const parts: { asset: ReleaseAsset; from: number; to: number }[] = companion
    ? [
        { asset, from: 0.0, to: 0.6 },
        { asset: companion, from: 0.6, to: 0.9 },
      ]
    : [{ asset, from: 0.0, to: 0.9 }];

  const tmp = await mkdtemp(join(tmpdir(), "konchi-sd-install-"));
  try {
    for (const part of parts) {
      const archive = join(tmp, part.asset.name);
      const sha256 = await download(part.asset.browser_download_url, archive, (f, m) =>
        progress?.(part.from + f * (part.to - part.from), m),
      );
      verifyAsset(GITHUB_REPO, part.asset, sha256, null, installError);
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
    // Moved rather than copied, but the siblings it loads stay where they
    // landed — see the note on extracting the whole archive above.
    await rename(binary, target);
    binary = target;
  }

  if (process.platform !== "win32") {
    const mode = (await stat(binary)).mode;
    await chmod(binary, mode | 0o111);
  }

  progress?.(1.0, `Installed stable-diffusion.cpp ${resolvedVersion}`);
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
