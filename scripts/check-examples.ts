/**
 * Fails when an entry in `app/src/content/examples.ts` no longer matches the
 * catalogue it was copied from, or when its audio file is missing.
 * Run: npx tsx scripts/check-examples.ts
 */
import { existsSync } from "node:fs";

import { EXAMPLES } from "../app/src/content/examples";
import { SFX_CATEGORIES } from "../app/src/content/sfx/categories";
import { MUSIC_TRACKS } from "../app/src/content/music/tracks";

const problems: string[] = [];
for (const [id, ex] of Object.entries(EXAMPLES) as [string, (typeof EXAMPLES)[keyof typeof EXAMPLES]][]) {
  if (!existsSync(`site/public${ex.file}`)) problems.push(`${id}: ${ex.file} is missing`);
  if (ex.kind === "sfx") {
    const sample = SFX_CATEGORIES.flatMap((c) => c.content.samples).find((s) => s.slug === id);
    if (!sample) problems.push(`${id}: no such sfx sample`);
    else if (sample.prompt !== ex.prompt || sample.model !== ex.model || sample.source !== "model")
      problems.push(`${id}: differs from the sfx catalogue`);
  } else if (ex.kind === "music") {
    const track = MUSIC_TRACKS.find((t) => t.slug === id);
    if (!track) problems.push(`${id}: no such music track`);
    else if (track.prompt !== ex.prompt || (track as { model?: string }).model !== ex.model)
      problems.push(`${id}: differs from the music catalogue`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${Object.keys(EXAMPLES).length} examples match their catalogues.`);
