/**
 * Which audio.cpp families can stream, read from the binary's own specs.
 *
 * audio.cpp ships `model_specs/<family>.json` beside its executables, and each
 * lists the run `modes` the family implements. That is the authority on
 * whether a streaming load will work, so `supports.streaming` comes from it
 * rather than a hand-kept list that drifts every upstream release. A user's
 * own build (`SOUNDBOX_AUDIOCPP_BIN`) answers for itself the same way.
 *
 * `describe()` is synchronous, so the answer is cached: `refresh` reads the
 * folder (async, cheap, once per binary path) and `knownStreaming` reports
 * the last answer — empty until the first refresh, which `status()` awaits.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { findBinary } from "./audiocppBinary.js";

let cachedFor: string | null = null;
let families = new Set<string>();

export async function refreshStreamingFamilies(): Promise<ReadonlySet<string>> {
  const binary = await findBinary();
  if (binary === null) return families;
  const dir = join(dirname(binary), "model_specs");
  if (cachedFor === dir) return families;
  const found = new Set<string>();
  try {
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const spec = JSON.parse(await readFile(join(dir, name), "utf8")) as {
          family?: string;
          modes?: unknown;
        };
        if (Array.isArray(spec.modes) && spec.modes.includes("streaming")) {
          found.add(spec.family ?? name.slice(0, -5));
        }
      } catch {
        // A spec we can't parse is a family we can't vouch for.
      }
    }
  } catch {
    // No model_specs folder (an older or custom build): nothing streams.
  }
  cachedFor = dir;
  families = found;
  return families;
}

export function knownStreamingFamilies(): ReadonlySet<string> {
  return families;
}

/** Tests only. */
export function setStreamingFamiliesForTest(next: Iterable<string>): void {
  families = new Set(next);
  cachedFor = "<test>";
}
