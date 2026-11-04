/**
 * Named profiles — one Konchi install, several separate libraries.
 *
 * A profile is a data directory: its own `soundbox.db`, `sounds/`, `artwork/`
 * and `settings.json`. Switching to another one is how you keep a curated
 * "demo" library apart from the scratch you generate while developing,
 * without a second checkout or a second `KONCHI_DATA_DIR` to remember.
 *
 * Two things deliberately do *not* move with the profile:
 *
 *  - `models/` — the weights. Tens of gigabytes; a profile switch that
 *    re-downloaded them would make the feature unusable.
 *  - `bin/` — the audio.cpp / llama.cpp / stable-diffusion runtimes, same
 *    reason.
 *
 * Both live at the *install root* (`Paths.base`), and every profile shares
 * them. Only the library and the settings that describe it are per-profile.
 *
 * The default profile's directory **is** the install root, not a subdirectory
 * of it. That is what makes this backwards compatible: an existing
 * `~/.konchi` written before profiles existed is the default profile,
 * found exactly where it already is, with no migration step.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The profile that owns the install root itself. Always exists, never
 *  deletable, and cannot be renamed out of existence. */
export const DEFAULT_PROFILE_ID = "default";

/** Where named profiles live, under the install root. */
const PROFILES_DIR = "profiles";

const REGISTRY_FILE = "profiles.json";

export interface ProfileRecord {
  id: string;
  name: string;
  created_at: string;
}

export interface Registry {
  active: string;
  profiles: ProfileRecord[];
}

/** A profile as the API returns it — the record plus the two things a caller
 *  cannot compute for itself. */
export interface ProfileInfo extends ProfileRecord {
  data_dir: string;
  active: boolean;
}

const DEFAULT_RECORD: ProfileRecord = {
  id: DEFAULT_PROFILE_ID,
  name: "Default",
  // Fixed rather than "now": the default profile is not created, it is
  // discovered, and stamping it with the first-run time of whichever version
  // introduced profiles would be a lie about when the library started.
  created_at: "",
};

/**
 * Turn a display name into an id usable as a directory name.
 *
 * Ids are what appear on disk and in URLs, so they are restricted to
 * lowercase, digits and dashes. An empty result (a name that was entirely
 * punctuation, or entirely non-Latin) falls back to a stable "profile"
 * stem, which `uniqueId` then numbers.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "profile";
}

/** `slugify`, then `-2`, `-3`… until it collides with nothing. Also skips
 *  the reserved default id, so a profile named "Default" gets "default-2"
 *  rather than silently aliasing the install root. */
export function uniqueId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  used.add(DEFAULT_PROFILE_ID);
  const stem = slugify(name);
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** The directory a profile's library lives in. The default profile is the
 *  install root itself — see the module comment. */
export function profileRoot(base: string, id: string): string {
  // Ids are slugs (see `slugify`). Refuse anything else before it is joined
  // into a path that `deleteProfile` may remove recursively.
  if (id !== DEFAULT_PROFILE_ID && !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`Invalid profile id: ${id}`);
  }
  return id === DEFAULT_PROFILE_ID ? base : join(base, PROFILES_DIR, id);
}

function registryPath(base: string): string {
  return join(base, REGISTRY_FILE);
}

/**
 * Read the registry, repairing anything that would leave the server without a
 * profile to run as.
 *
 * A missing, unreadable or corrupt file is not an error: it means "no profiles
 * have been created yet", which is the state every install starts in and the
 * state a hand-edited file should degrade to rather than a crash on startup.
 */
export function readRegistry(base: string): Registry {
  let parsed: Partial<Registry> = {};
  const path = registryPath(base);
  if (existsSync(path)) {
    try {
      parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<Registry>;
    } catch {
      parsed = {};
    }
  }
  const seen = new Set<string>([DEFAULT_PROFILE_ID]);
  const profiles: ProfileRecord[] = [DEFAULT_RECORD];
  for (const entry of Array.isArray(parsed.profiles) ? parsed.profiles : []) {
    if (!entry || typeof entry.id !== "string") continue;
    const id = entry.id === DEFAULT_PROFILE_ID ? DEFAULT_PROFILE_ID : slugify(entry.id);
    if (id === DEFAULT_PROFILE_ID) {
      // A stored name for the default profile is honoured; its id is not
      // negotiable.
      if (typeof entry.name === "string" && entry.name.trim()) profiles[0] = { ...profiles[0]!, name: entry.name };
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    profiles.push({
      id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name : id,
      created_at: typeof entry.created_at === "string" ? entry.created_at : "",
    });
  }
  // An active id naming a profile that is no longer there would leave the
  // server pointing at a directory nobody can see in the list. Fall back
  // rather than resurrect it.
  const active = typeof parsed.active === "string" && seen.has(parsed.active)
    ? parsed.active
    : DEFAULT_PROFILE_ID;
  return { active, profiles };
}

/** Temp-file-then-rename, for the same reason `settings.json` does it: a
 *  crash mid-write must not leave a registry that fails to parse. */
export function writeRegistry(base: string, registry: Registry): void {
  mkdirSync(base, { recursive: true });
  const path = registryPath(base);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2), "utf-8");
  renameSync(tmp, path);
}

export function toInfo(base: string, record: ProfileRecord, active: string): ProfileInfo {
  return {
    ...record,
    data_dir: profileRoot(base, record.id),
    active: record.id === active,
  };
}
