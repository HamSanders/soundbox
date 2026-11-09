/**
 * The Mirli mark: a capital M cut from Big Shoulders Display at weight 800,
 * the same face as the wordmark and page titles. The outline is the font's
 * own glyph, flattened to a path so the favicon and press-kit files need no
 * webfont to render it (regenerate with scripts/gen-brand-marks.ts if the
 * weight changes).
 *
 * Coordinates are font units (2000 per em) with the origin at the glyph's
 * top-left: the M is `M_WIDTH` wide and `M_HEIGHT` (cap height) tall.
 */

export const M_PATH =
  "M0 1600V0H422.2L545.2 618L580.7 1370.4H629.2L662.7 618L787.6 0H1208.3V1600H950V1114.5L999.4 227.9H947.6L858 1131L746.9 1598.3H461L351.9 1131L260.7 227.9H210.9L258.3 1114.5V1600Z";
export const M_WIDTH = 1208.3;
export const M_HEIGHT = 1600;

/**
 * A square viewBox with the M centred in it. `inset` is the share of the
 * square left empty above and below the letter.
 */
export function markViewBox(inset = 0): { x: number; y: number; size: number } {
  const size = M_HEIGHT / (1 - inset * 2);
  return { x: (M_WIDTH - size) / 2, y: (M_HEIGHT - size) / 2, size };
}

/** The M as standalone SVG markup, for the static files. */
export function markSvgMarkup(ink: string): string {
  return `<path d="${M_PATH}" fill="${ink}"/>`;
}
