/**
 * Copy the JSON data files into `dist/` after a build.
 *
 * `audiocpp.ts` reads its catalog and parameter tables with `readFileSync`
 * rather than importing them, so `tsc` never emits or refreshes them — it only
 * compiles the `.ts`. `catalogPath()` looks next to the built module first and
 * falls back to `src/`, and that fallback was doing the work: with nothing in
 * `dist/models/`, the built server read the real catalog out of `src/`.
 *
 * Which held right up until an old copy landed in `dist/models/` and stopped
 * the fallback from firing. From then on every build silently shipped whatever
 * catalog happened to be sitting there — in practice one from months earlier,
 * before models moved to audio.cpp's own flat package layout, so every model
 * installed under the new layout read as "Not installed" in the packaged app
 * while working fine under `npm run dev`.
 *
 * So the copy is a real build step now. `dist/` is either absent (fallback) or
 * current (this script), never stale.
 */

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every non-TS file the built server reads at runtime, `src`-relative. */
const ASSETS = [
  "models/audiocpp_models_catalog.json",
  "models/audiocpp_model_params.json",
  "audiobook/classics/classics.json",
  "calls/builtin/santa.jpg",
];

for (const rel of ASSETS) {
  const to = join(root, "dist", rel);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(join(root, "src", rel), to);
  console.log(`copied ${rel}`);
}
