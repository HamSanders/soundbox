/**
 * The checks every engine installer runs on a GitHub release before trusting
 * it. Shared by `audiocppBinary.ts`, `llamaServerBinary.ts` and
 * `sdServerBinary.ts`, which otherwise each own their asset matching.
 *
 * Three things are being guarded here, all of them reachable from an HTTP
 * request that only names a version:
 *
 *   - The version is spliced into a GitHub API path. A "version" of
 *     `../../other/repo/releases/latest` would look up — and install — a
 *     different project's release, so a tag has to look like a tag.
 *   - The release's `tag_name` becomes a directory under the install root, so
 *     the same rule applies to what GitHub sends back.
 *   - Each asset's download URL comes from that response too, and must point
 *     at this installer's own repository's release downloads, not anywhere a
 *     response could name.
 *
 * And then the bytes themselves: an archive with no checksum to compare
 * against is refused, not installed with a warning. A binary we run with the
 * user's privileges is the one download where "probably fine" isn't enough.
 * `KONCHI_ALLOW_UNVERIFIED_BINARIES=1` is the explicit way out for a release
 * that genuinely publishes no hashes.
 */

import { z } from "zod";
import { envVar } from "../env.js";

/** Set to `1` (or `true`) to install an engine archive that no checksum
 *  manifest or GitHub digest covers. Off by default. */
export const ALLOW_UNVERIFIED_ENV = "KONCHI_ALLOW_UNVERIFIED_BINARIES";

const TAG_PATTERN = /^(latest|v?[A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;

/** Whether `tag` is a plausible release tag (or "latest"): letters, digits,
 *  dot, dash, underscore, no path segments. */
export function isSafeReleaseTag(tag: unknown): tag is string {
  return typeof tag === "string" && TAG_PATTERN.test(tag) && !tag.includes("..");
}

/** The request-body shape of the three engine-install routes. */
export const engineInstallRequestSchema = z.object({
  version: z
    .string()
    .refine(isSafeReleaseTag, { message: "version must be 'latest' or a release tag like v1.2.3" })
    .optional(),
  backend: z
    .string()
    .regex(/^[a-z0-9_-]{1,20}$/i, "backend must be a short name like cuda, vulkan or cpu")
    .optional(),
});

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string | null;
}

export interface Release {
  tag_name?: string;
  assets?: ReleaseAsset[];
}

/** The API URL for `version` of `repo`. Throws if the version isn't a tag. */
export function releaseApiUrl(
  repo: string,
  version: string,
  makeError: (message: string) => Error,
): string {
  if (!isSafeReleaseTag(version)) {
    throw makeError(`'${version}' is not a release tag. Use 'latest' or a tag like v1.2.3.`);
  }
  const base = `https://api.github.com/repos/${repo}/releases`;
  return version === "latest" ? `${base}/latest` : `${base}/tags/${encodeURIComponent(version)}`;
}

/** Whether `url` is a download from `repo`'s own GitHub releases. Parsed
 *  rather than prefix-matched on the raw string, so dot segments and a
 *  look-alike host can't slip through. GitHub repo names are
 *  case-insensitive, so the path is compared that way. */
export function isRepoAssetUrl(repo: string, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.host === "github.com" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/releases/download/`)
  );
}

function isSafeAssetName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 255 &&
    !/[\\/:\0]/.test(name) &&
    name !== "." &&
    name !== ".."
  );
}

/**
 * Validate a release response from `repo`: its tag (a directory name to be),
 * and every asset's name (a temp file name) and URL. Returns the tag to
 * install under. Rejecting the whole release on one bad asset is deliberate —
 * a response that lies about one URL isn't one to trust about the others.
 */
export function checkRelease(
  repo: string,
  release: Release,
  makeError: (message: string) => Error,
): string {
  const tag = release.tag_name;
  if (!isSafeReleaseTag(tag) || tag === "latest") {
    throw makeError(`GitHub returned a release of ${repo} with an unusable tag '${String(tag)}'.`);
  }
  for (const asset of release.assets ?? []) {
    if (!isSafeAssetName(asset.name) || !isRepoAssetUrl(repo, asset.browser_download_url)) {
      throw makeError(
        `Release ${tag} of ${repo} lists an asset that doesn't download from ` +
          `https://github.com/${repo}/releases (${String(asset.name)}). Refusing to install it.`,
      );
    }
  }
  return tag;
}

export function allowUnverified(): boolean {
  const raw = (envVar(ALLOW_UNVERIFIED_ENV) ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** The expected hex SHA-256 for `name` in a `sha256sum`-format manifest, or
 *  null when the manifest doesn't list it. */
export function sha256FromManifest(name: string, manifest: string): string | null {
  for (const line of manifest.split(/\r?\n/)) {
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && parts[parts.length - 1]!.replace(/^\*+/, "") === name) {
      return parts[0]!.toLowerCase();
    }
  }
  return null;
}

/** The hex SHA-256 from a GitHub asset `digest` ("sha256:<hex>", or bare
 *  hex), or null when absent or in an algorithm we don't check. */
export function sha256FromDigest(digest: string | null | undefined): string | null {
  if (!digest) return null;
  const [algo, value] = digest.includes(":") ? digest.split(":", 2) : ["sha256", digest];
  if ((algo ?? "").toLowerCase() !== "sha256" || !/^[0-9a-f]{64}$/i.test(value ?? "")) {
    return null;
  }
  return value!.toLowerCase();
}

/**
 * Verify one downloaded asset against everything the release says about it:
 * GitHub's own `digest` for the asset (it arrives in the API response, not as
 * another file an attacker could edit alongside the binary) and the release's
 * checksum manifest when there is one. Either is enough; both are checked
 * when both exist; neither means refusal (see `verifySha256`).
 */
export function verifyAsset(
  repo: string,
  asset: ReleaseAsset,
  actual: string,
  manifest: string | null,
  makeError: (message: string) => Error,
): void {
  const fromDigest = sha256FromDigest(asset.digest);
  const fromManifest = manifest === null ? null : sha256FromManifest(asset.name, manifest);
  if (fromDigest === null && fromManifest === null) {
    verifySha256(repo, asset.name, actual, null, makeError);
    return;
  }
  if (fromDigest !== null) verifySha256(repo, asset.name, actual, fromDigest, makeError);
  if (fromManifest !== null) verifySha256(repo, asset.name, actual, fromManifest, makeError);
}

/**
 * Compare a download's hash against the expected one. With nothing to compare
 * against, refuse — unless the user opted in via `KONCHI_ALLOW_UNVERIFIED_BINARIES`,
 * in which case warn and carry on.
 */
export function verifySha256(
  repo: string,
  assetName: string,
  actual: string,
  expected: string | null,
  makeError: (message: string) => Error,
): void {
  if (expected === null) {
    if (allowUnverified()) {
      console.warn(
        `no checksum published for ${assetName}; installing unverified because ` +
          `${ALLOW_UNVERIFIED_ENV} is set`,
      );
      return;
    }
    throw makeError(
      `No checksum is published for ${assetName}, so it can't be verified and won't be ` +
        `installed. Download it yourself from https://github.com/${repo}/releases, or set ` +
        `${ALLOW_UNVERIFIED_ENV}=1 to install it unverified.`,
    );
  }
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw makeError(
      `Checksum mismatch for ${assetName}: expected ${expected}, got ${actual}. The ` +
        `download may be corrupt or tampered with — try again, and if it persists, ` +
        `download manually from https://github.com/${repo}/releases.`,
    );
  }
}
