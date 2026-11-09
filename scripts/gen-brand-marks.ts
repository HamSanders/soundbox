#!/usr/bin/env -S npx tsx
/**
 * Writes the static copies of the Mirli mark (the display-face M) from
 * app/src/lib/brand-geometry.ts:
 *
 *   app/public/favicon.svg                 paper M on a black tile (both builds)
 *   site/public/press/mirli-mark.svg       the same, 1024 px, for the press kit
 *   site/public/press/mirli-mark-light.svg black M on a paper tile
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

import { markSvgMarkup, markViewBox } from "../app/src/lib/brand-geometry";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const INK = "#070707";
const PAPER = "#eeede9";

/** A rounded tile with the M centred and inset so it breathes. */
function tile(opts: { ink: string; ground: string; inset: number; px?: number }): string {
  const box = markViewBox(opts.inset);
  const [x, y, size] = [box.x, box.y, box.size].map((n) => Math.round(n * 10) / 10);
  const px = opts.px ? ` width="${opts.px}" height="${opts.px}"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${size} ${size}"${px}>` +
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="${opts.ground}"/>` +
    markSvgMarkup(opts.ink) +
    `</svg>\n`
  );
}

const files: Record<string, string> = {
  // Tighter in the favicon: at 16 px every pixel of letter counts.
  "app/public/favicon.svg": tile({ ink: PAPER, ground: INK, inset: 0.14 }),
  "site/public/press/mirli-mark.svg": tile({ ink: PAPER, ground: INK, inset: 0.2, px: 1024 }),
  "site/public/press/mirli-mark-light.svg": tile({ ink: INK, ground: PAPER, inset: 0.2, px: 1024 }),
};

for (const [rel, svg] of Object.entries(files)) {
  writeFileSync(path.join(root, rel), svg);
  console.log(rel);
}
