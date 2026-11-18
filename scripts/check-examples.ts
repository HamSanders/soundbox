/**
 * Fails when an entry in `app/src/content/examples.ts` no longer matches where
 * it came from, when its audio file is missing or not level-matched, or when a
 * file in `site/public/examples/` is not listed.
 *
 * - `catalogue` entries must equal the SFX catalogue sample of the same slug.
 * - `render` entries must equal their record in `site/public/examples/renders.json`.
 * - Every served file is level-matched to -18 LUFS with a -2 dBTP ceiling. A
 *   mostly-transient sound (a click, a blade swing) cannot reach -18 without
 *   breaking the ceiling, so it passes when it is limited by its peak instead:
 *   within 1 LU of -18, or quieter than that with its true peak within 1 dB of
 *   the ceiling. Nothing may be louder than -17 or peak above -1 dBTP.
 *
 * Run: npx tsx scripts/check-examples.ts
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { EXAMPLES } from "../app/src/content/examples";
import { SFX_CATEGORIES } from "../app/src/content/sfx/categories";

interface Render {
  model: string;
  prompt: string | null;
  lyrics: string | null;
  text: string | null;
  served: { lufs: number | null; true_peak_dbtp: number | null };
}

const renders: Record<string, Render> = JSON.parse(
  readFileSync("site/public/examples/renders.json", "utf8"),
);
const problems: string[] = [];

for (const [id, ex] of Object.entries(EXAMPLES) as [string, (typeof EXAMPLES)[keyof typeof EXAMPLES]][]) {
  if (!existsSync(`site/public${ex.file}`)) problems.push(`${id}: ${ex.file} is missing`);

  if (ex.origin === "catalogue") {
    const sample = SFX_CATEGORIES.flatMap((c) => c.content.samples).find((s) => s.slug === id);
    if (!sample) problems.push(`${id}: no such sfx sample`);
    else if (sample.prompt !== ex.prompt || sample.model !== ex.model || sample.source !== "model")
      problems.push(`${id}: differs from the sfx catalogue`);
  } else {
    const r = renders[id];
    const e = ex as { prompt?: string; lyrics?: string; text?: string; model: string };
    if (!r) {
      problems.push(`${id}: no record in renders.json`);
      continue;
    }
    if (
      r.model !== e.model ||
      (r.prompt ?? undefined) !== e.prompt ||
      (r.lyrics ?? undefined) !== e.lyrics ||
      (r.text ?? undefined) !== e.text
    )
      problems.push(`${id}: differs from its renders.json record`);
    const { lufs, true_peak_dbtp: tp } = r.served;
    if (lufs !== null && lufs > -70) {
      const matched = Math.abs(lufs + 18) <= 1;
      const peakLimited = lufs < -19 && tp !== null && tp >= -3;
      if (!matched && !peakLimited)
        problems.push(`${id}: ${lufs} LUFS is neither within 1 LU of -18 nor limited by its peak`);
    }
    if (tp !== null && tp > -1) problems.push(`${id}: true peak ${tp} dBTP is above -1`);
  }
}

const listed = new Set(Object.keys(EXAMPLES).map((id) => `${id}.mp3`));
for (const f of readdirSync("site/public/examples")) {
  if (f.endsWith(".mp3") && !listed.has(f)) problems.push(`${f} is in site/public/examples but not listed`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${Object.keys(EXAMPLES).length} examples match their sources.`);
