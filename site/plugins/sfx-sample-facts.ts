/**
 * `virtual:sfx-sample-facts`: each catalogue sample's duration and file size,
 * read from `site/public/sfx/<category>/manifest.json` at build time.
 *
 * The manifests are fetched at runtime because their waveform peaks are too
 * big to bundle (see `useSampleManifest`). That left the prerendered sample
 * pages with no duration at all, since the fetch never runs during SSR. These
 * two numbers per sample are small enough to bundle, so they are, and the
 * server render and the hydrated page agree on them.
 *
 * Shape: `{ [category]: { [sample]: [durationS, sizeBytes] } }`.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

const ID = "virtual:sfx-sample-facts";
const RESOLVED = `\0${ID}`;

export function sfxSampleFacts(sfxDir: string): Plugin {
  return {
    name: "konchi:sfx-sample-facts",
    resolveId(source) {
      return source === ID ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      const facts: Record<string, Record<string, [number, number]>> = {};
      for (const entry of readdirSync(sfxDir, { withFileTypes: true })) {
        const file = path.join(sfxDir, entry.name, "manifest.json");
        if (!entry.isDirectory() || !existsSync(file)) continue;
        this.addWatchFile(file);
        const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<
          string,
          { durationS: number; sizeBytes: number }
        >;
        facts[entry.name] = Object.fromEntries(
          Object.entries(manifest).map(([slug, m]) => [
            slug,
            [Math.round(m.durationS * 100) / 100, m.sizeBytes],
          ]),
        );
      }
      return `export default ${JSON.stringify(facts)};`;
    },
  };
}
