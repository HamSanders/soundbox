/**
 * The Mirli blackbird as plain path data, shared by the React mark
 * (`components/brand-mark.tsx`) and the static files written by
 * `scripts/gen-brand-marks.ts` (favicon, press kit), so there is one drawing.
 *
 * Drawn in a 200-unit box; `VIEWBOX` is the square around the bird.
 */

export const VIEWBOX = { x: 30, y: 29, size: 150 } as const;

/** Body with the eye cut out (draw with `fill-rule="evenodd"`). */
export const BODY =
  "M55,93 C62,84 78,82 88,92 L104,110 C116,120 128,128 140,134 L172,150 " +
  "C168,155 161,156 156,153 L150,151 L133,145 C110,153 82,147 72,129 C66,117 62,107 55,101 Z " +
  "M73.4,92 a3.4,3.4 0 1,0 -6.8,0 a3.4,3.4 0 1,0 6.8,0 Z";
export const BEAK = "M34,98 L56,92.5 L55.5,101.5 Z";
export const WING = "M84,112 C84,94 94,80 112,74 L120,73 L120,118 C108,126 92,124 84,112 Z";

/** Six thin bars for large sizes, four thick ones that survive 16-32px. */
export const CUTS = {
  full: { bars: [70, 58, 52, 58, 70, 82], width: 7.5, pitch: 10.5 },
  small: { bars: [66, 54, 60, 76], width: 11, pitch: 14 },
} as const;

export type BrandCut = keyof typeof CUTS;

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}

/** The waveform bars: each one stops on the wing's rising underside. */
export function bars(cut: BrandCut): Bar[] {
  const c = CUTS[cut];
  return c.bars.map((top, i) => {
    const x = 116 + i * c.pitch;
    const bottom = 118 - (x + c.width / 2 - 118) * 0.45;
    return { x, y: top, width: c.width, height: bottom - top, rx: c.width / 2 };
  });
}

/** The bird as SVG markup in one colour, for files written outside React. */
export function birdSvgMarkup(cut: BrandCut, ink: string): string {
  const rects = bars(cut)
    .map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height.toFixed(2)}" rx="${b.rx}"/>`)
    .join("");
  return `<g fill="${ink}"><path d="${BODY}" fill-rule="evenodd"/><path d="${BEAK}"/><path d="${WING}"/>${rects}</g>`;
}
