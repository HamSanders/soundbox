/**
 * One-time move from Konchi's old weights layout to audio.cpp's.
 *
 * Konchi used to install packages under its own model id:
 *
 *     <root>/audiocpp-ace-step/ACE-Step1.5-GGUF/turbo/…gguf
 *
 * audio.cpp installs the same package one level higher, with the repo prefix
 * stripped rather than preserved:
 *
 *     <root>/ACE-Step1.5-GGUF/turbo/…gguf
 *
 * That extra level is why weights downloaded by one tool were invisible to the
 * other. Adopting upstream's layout fixes it, but only if what is already on
 * disk comes along — nobody should re-download tens of gigabytes because we
 * changed our minds about a directory name.
 *
 * This is a rename, not a copy: it moves the inner package directory up one
 * level and removes the emptied husk. It runs at startup, is idempotent, and
 * treats every failure as non-fatal — a models directory it cannot reorganise
 * is a reason to fall back to re-downloading one model, never a reason to stop
 * the server from starting.
 */

import { existsSync } from "node:fs";
import { readdir, rename, rmdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";

import type { ModelSpec } from "./audiocpp.js";

export interface MigrationResult {
  moved: string[];
  skipped: { id: string; reason: string }[];
  failed: { id: string; error: string }[];
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Merge `src` into `dest`, moving whole subtrees where possible. */
async function mergeInto(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (existsSync(to)) {
      // Something is already there. A directory we can descend into and
      // merge; a file that exists in both is the same package file twice, so
      // the destination — the one audio.cpp would have written — wins.
      if (entry.isDirectory() && (await isDir(to))) await mergeInto(from, to);
      continue;
    }
    await rename(from, to);
  }
  await rmdir(src).catch(() => undefined);
}

/**
 * Move every legacy package directory into its audio.cpp location.
 *
 * Only touches directories named after a catalog id that we know the target
 * layout for — anything else in the models root belongs to somebody else and
 * is left alone.
 */
export async function migrateLayout(
  audiocppRoot: string,
  specs: readonly ModelSpec[],
): Promise<MigrationResult> {
  const result: MigrationResult = { moved: [], skipped: [], failed: [] };
  if (!(await isDir(audiocppRoot))) return result;

  for (const spec of specs) {
    // Bring-your-own entries point at weights the user owns elsewhere, and
    // entries with no upstream package have no target layout to move to.
    if (spec.weights_path || !spec.audiocpp_target_dir) continue;

    const legacyRoot = join(audiocppRoot, spec.id);
    if (!(await isDir(legacyRoot))) continue;

    // The package sat under its strip_prefix inside the legacy folder, or
    // directly in it when the package has no prefix (minimax_music3).
    const prefix = spec.audiocpp_strip_prefix;
    const source = prefix ? join(legacyRoot, ...prefix.split("/")) : legacyRoot;
    if (!(await isDir(source))) {
      result.skipped.push({ id: spec.id, reason: "no package directory inside the legacy folder" });
      continue;
    }

    const dest = join(audiocppRoot, ...spec.audiocpp_target_dir.split("/"));
    if (dest === source) continue; // already where it belongs

    try {
      await mkdir(dirname(dest), { recursive: true });
      if (existsSync(dest)) {
        await mergeInto(source, dest);
      } else {
        await rename(source, dest);
      }
      // Drop the emptied legacy folder. Only if empty: anything left in it is
      // something we did not put there and did not understand.
      if (prefix) await rmdir(legacyRoot).catch(() => undefined);
      result.moved.push(spec.id);
    } catch (exc) {
      result.failed.push({ id: spec.id, error: String(exc) });
    }
  }

  return result;
}
