#!/usr/bin/env -S npx tsx
/**
 * Writes the static copies of the Mirli mark from the one drawing in
 * app/src/lib/brand-geometry.ts:
 *
 *   app/public/favicon.svg            paper bird on a black tile (both builds)
 *   site/public/press/mirli-mark.svg       the same, 1024 px, for the press kit
 *   site/public/press/mirli-mark-light.svg black bird on a paper tile
 *
 * The press kit's PNGs are rendered from those SVGs with a headless browser:
 *
 *   npx tsx scripts/gen-brand-marks.ts
 *   msedge --headless --disable-gpu --hide-scrollbars --window-size=1024,1024 \
 *     --screenshot=site/public/press/mirli-mark.png site/public/press/mirli-mark.svg
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VIEWBOX, birdSvgMarkup, type BrandCut } from "../app/src/lib/brand-geometry";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const INK = "#070707";
const PAPER = "#eeede9";

/** A rounded tile with the bird centred and inset so it breathes. */
function tile(opts: { cut: BrandCut; ink: string; ground: string; px?: number }): string {
  const { x, y, size } = VIEWBOX;
  const pad = size * 0.1;
  const outer = size + pad * 2;
  const px = opts.px ? ` width="${opts.px}" height="${opts.px}"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x - pad} ${y - pad} ${outer} ${outer}"${px}>` +
    `<rect x="${x - pad}" y="${y - pad}" width="${outer}" height="${outer}" rx="${outer * 0.18}" fill="${opts.ground}"/>` +
    birdSvgMarkup(opts.cut, opts.ink) +
    `</svg>\n`
  );
}

const files: Record<string, string> = {
  "app/public/favicon.svg": tile({ cut: "small", ink: PAPER, ground: INK }),
  "site/public/press/mirli-mark.svg": tile({ cut: "full", ink: PAPER, ground: INK, px: 1024 }),
  "site/public/press/mirli-mark-light.svg": tile({ cut: "full", ink: INK, ground: PAPER, px: 1024 }),
};

for (const [rel, svg] of Object.entries(files)) {
  writeFileSync(path.join(root, rel), svg);
  console.log(rel);
}
