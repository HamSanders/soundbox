#!/usr/bin/env -S npx tsx
/**
 * Prints {"<category>/<take>": {prompt, model, seed?}} for every rendered take
 * of every published /sfx sample (main clips and `compare` takes), read from
 * the same content file the pages and the render script use. Input for
 * scripts/check-sfx-noise.py and scripts/level-sfx-samples.py.
 */
import { SFX_CATEGORIES } from "../app/src/content/sfx/categories.ts";
import { isPublished, sampleTakes } from "../app/src/content/sfx/types.ts";

const out: Record<string, { prompt: string; model: string; seed?: number }> = {};
for (const c of SFX_CATEGORIES.filter(isPublished)) {
  for (const s of c.content.samples) {
    for (const t of sampleTakes(s)) {
      out[`${c.slug}/${t.slug}`] = { prompt: s.prompt, model: t.model, ...(t.seed !== undefined && { seed: t.seed }) };
    }
  }
}
process.stdout.write(JSON.stringify(out));
