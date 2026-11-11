#!/usr/bin/env -S npx tsx
/**
 * Writes the static copies of the Mirli mark (the one-line M) from
 * app/src/lib/brand-geometry.ts:
 *
 *   app/public/favicon.svg                 paper M on a dusk tile (both builds)
 *   site/public/press/mirli-mark.svg       the same, 1024 px, for the press kit
 *   site/public/press/mirli-mark-light.svg ink M on a paper tile
 *
 * The press tiles carry the beak dot where the stroke lands. The favicon does
 * not: under 48 px the dot is noise.
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

import { MARK_WEIGHT, markSvgMarkup, markViewBox } from "../app/src/lib/brand-geometry";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const INK = "#14130f";
const PAPER = "#f1ece0";
const DUSK = "#1b1f2c";
const BEAK = "#f2a40c";
/** Where the pen stops: the last point of `M_PATH`. */
const LANDING = { x: 62.8, y: 124.5, r: 7 };

/** A rounded tile with the M centred and inset so it breathes. */
function tile(opts: { ink: string; ground: string; inset: number; weight: number; px?: number; dot?: boolean }): string {
  const box = markViewBox(opts.inset, opts.weight);
  const [x, y, size] = [box.x, box.y, box.size].map((n) => Math.round(n * 10) / 10);
  const px = opts.px ? ` width="${opts.px}" height="${opts.px}"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${size} ${size}"${px}>` +
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="${opts.ground}"/>` +
    markSvgMarkup(opts.ink, opts.weight) +
    (opts.dot ? `<circle cx="${LANDING.x}" cy="${LANDING.y}" r="${LANDING.r}" fill="${BEAK}"/>` : "") +
    `</svg>\n`
  );
}

const files: Record<string, string> = {
  // Tight and heavy in the favicon: at 16 px every pixel of line counts.
  "app/public/favicon.svg": tile({ ink: PAPER, ground: DUSK, inset: 0.06, weight: MARK_WEIGHT.small }),
  "site/public/press/mirli-mark.svg": tile({
    ink: PAPER,
    ground: DUSK,
    inset: 0.14,
    weight: MARK_WEIGHT.large,
    px: 1024,
    dot: true,
  }),
  "site/public/press/mirli-mark-light.svg": tile({
    ink: INK,
    ground: PAPER,
    inset: 0.14,
    weight: MARK_WEIGHT.large,
    px: 1024,
    dot: true,
  }),
};

for (const [rel, svg] of Object.entries(files)) {
  writeFileSync(path.join(root, rel), svg);
  console.log(rel);
}
