#!/usr/bin/env -S npx tsx
/**
 * Prints {"<category>/<sample>": {prompt, model, seed?}} for every published
 * /sfx sample, read from the same content file the pages and the render script
 * use. Input for scripts/check-sfx-noise.py and scripts/level-sfx-samples.py.
 */
import { SFX_CATEGORIES } from "../app/src/content/sfx/categories.ts";
import { isPublished } from "../app/src/content/sfx/types.ts";

/** Same fallback as scripts/gen-sfx-samples.ts. */
const DEFAULT_MODEL = "audiocpp-stable-audio-3-sfx";

const out: Record<string, { prompt: string; model: string; seed?: number }> = {};
for (const c of SFX_CATEGORIES.filter(isPublished)) {
  for (const s of c.content.samples) {
    out[`${c.slug}/${s.slug}`] = {
      prompt: s.prompt,
      model: s.model ?? DEFAULT_MODEL,
      ...(s.seed !== undefined && { seed: s.seed }),
    };
  }
}
process.stdout.write(JSON.stringify(out));
