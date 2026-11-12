/**
 * The desktop installers, and a guess at which one the visitor needs.
 *
 * Shared by every "Download" on the site: the home page's hero button, its
 * platform picker and `/download`. The installer filenames carry the version
 * (`Soundbox_0.4.1_x64-setup.exe`), so nothing here hardcodes one. Pages
 * prerender with a link that always works (`/download`, or GitHub's
 * `releases/latest`), then `useInstallers` asks the GitHub API for the latest
 * release once per tab and swaps in the direct file links.
 *
 * Both lookups run after mount, so the prerendered HTML is the same for
 * everyone.
 */

import { useEffect, useState } from "react";

import { REPO_URL } from "@/lib/marketing-links";

export const LATEST_RELEASE_URL = `${REPO_URL}/releases/latest`;
const API_BASE = REPO_URL.replace("https://github.com/", "https://api.github.com/repos/");

export interface ReleaseAsset {
  name: string;
  size: number;
  download_count: number;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  published_at: string;
  assets: ReleaseAsset[];
}

export type PlatformId = "windows" | "mac-arm" | "mac-intel";

export interface Platform {
  id: PlatformId;
  label: string;
  /** For "Download for …". */
  short: string;
  detail: string;
  match: (name: string) => boolean;
}

export const PLATFORMS: Platform[] = [
  {
    id: "windows",
    label: "Windows",
    short: "Windows",
    detail: "Windows 10 and 11, x64",
    match: (n) => /x64-setup\.exe$/i.test(n),
  },
  {
    id: "mac-arm",
    label: "macOS",
    short: "Mac",
    detail: "Apple silicon, M1 and later",
    match: (n) => /aarch64\.dmg$/i.test(n),
  },
  {
    id: "mac-intel",
    label: "macOS Intel",
    short: "Intel Mac",
    detail: "Older Macs, x64",
    match: (n) => /x64\.dmg$/i.test(n),
  },
];

export function megabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

/** `GET` a GitHub API path and hand back the JSON, or null on any failure. */
export async function github<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The slice of the User-Agent Client Hints API used below (Chromium only). */
interface UserAgentData {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
}

/**
 * A best guess at the visitor's installer, or null on a phone, a tablet or
 * Linux, where there is nothing to hand over.
 *
 * A Mac's user agent says "Intel" on Apple silicon too, so the string cannot
 * tell the two apart. Chromium browsers will say which through client hints;
 * Safari and Firefox will not, and there a Mac gets the Apple silicon build,
 * which is what every Mac sold since late 2020 needs. The picker further down
 * the page covers a wrong guess.
 */
export async function detectPlatform(): Promise<PlatformId | null> {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return null;
  // iPadOS Safari calls itself a Mac; a Mac has no touch screen.
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return null;
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) {
    const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
    try {
      const hints = await data?.getHighEntropyValues?.(["architecture"]);
      if (hints?.architecture === "x86") return "mac-intel";
    } catch {
      // Refused or unsupported: fall through to the default.
    }
    return "mac-arm";
  }
  return null;
}

const CACHE_KEY = "soundbox.latest-release";
const CACHE_MS = 10 * 60 * 1000;
let pending: Promise<Release | null> | null = null;

/**
 * The latest release, fetched once per page load and kept for ten minutes per
 * tab. The unauthenticated API allows 60 requests an hour per address, and a
 * visitor clicking between pages should not spend them.
 */
export function latestRelease(): Promise<Release | null> {
  if (pending) return pending;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const { at, release } = JSON.parse(raw) as { at: number; release: Release };
      if (Date.now() - at < CACHE_MS) return (pending = Promise.resolve(release));
    }
  } catch {
    // No storage, or a stale shape: ask again.
  }
  pending = github<Release>("/releases/latest").then((release) => {
    if (!release) {
      pending = null; // let the next mount retry
      return null;
    }
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release }));
    } catch {
      // Private window: fine, the in-memory promise still serves this page.
    }
    return release;
  });
  return pending;
}

export interface Installers {
  /** Null until the API answers, and for good if it never does. */
  release: Release | null;
  /** The visitor's platform, or null when unknown or not yet looked up. */
  mine: PlatformId | null;
  /** The detected platform and its file, when both are known. */
  primary: Platform | undefined;
  primaryAsset: ReleaseAsset | undefined;
  assetFor: (platform: Platform) => ReleaseAsset | undefined;
}

export function useInstallers(): Installers {
  const [release, setRelease] = useState<Release | null>(null);
  const [mine, setMine] = useState<PlatformId | null>(null);

  useEffect(() => {
    let live = true;
    void detectPlatform().then((id) => live && setMine(id));
    void latestRelease().then((r) => live && r && setRelease(r));
    return () => {
      live = false;
    };
  }, []);

  const assetFor = (platform: Platform) => release?.assets.find((a) => platform.match(a.name));
  const primary = PLATFORMS.find((p) => p.id === mine);
  return { release, mine, primary, primaryAsset: primary && assetFor(primary), assetFor };
}
