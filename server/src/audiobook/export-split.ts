/**
 * Splitting chapters that are too long for one file.
 *
 * ACX allows at most 120 minutes per file; a longer section is split into
 * several files, and each file after the first starts with a spoken
 * "secondary header" (for example "Chapter Twelve, continued") so a listener
 * knows where they are (research §8). Mirli can't speak a header that isn't
 * in the manuscript, so the split prefers a paragraph marked as a heading:
 * add one where the chapter should break, voice it, and the export splits
 * there. Without one it splits at the last paragraph that fits and the QC
 * check `secondary_header` fails with that advice.
 */

/** ACX's limit, and the margin kept under it for room tone and rounding. */
export const MAX_FILE_S = 120 * 60;
export const SPLIT_MARGIN_S = 30;

export interface SplitParagraph {
  start_s: number;
  end_s: number;
  is_heading: boolean;
}

export interface SplitCut {
  /** Where the next file starts, seconds into the chapter file. */
  at_s: number;
  /** The next file starts on a heading paragraph (a secondary header). */
  header: boolean;
}

/**
 * Cut points for a chapter `durationS` long. Paragraphs are in file seconds,
 * in order. A cut sits in the middle of the gap before the paragraph that
 * opens the next file. Empty when the chapter fits in one file.
 */
export function planSplit(
  paragraphs: SplitParagraph[],
  durationS: number,
  maxS = MAX_FILE_S - SPLIT_MARGIN_S,
): SplitCut[] {
  const cuts: SplitCut[] = [];
  let start = 0;
  while (durationS - start > maxS) {
    const limit = start + maxS;
    // Candidates: paragraphs that open a file ending before the limit, and
    // leave the current file at least a third of the limit long.
    const candidates = paragraphs
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i > 0 && p.start_s > start + maxS / 3 && p.start_s <= limit);
    if (candidates.length === 0) {
      // One paragraph longer than the limit: cut inside it, at the limit.
      cuts.push({ at_s: limit, header: false });
      start = limit;
      continue;
    }
    const heading = [...candidates].reverse().find(({ p }) => p.is_heading);
    const pick = heading ?? candidates[candidates.length - 1];
    const prevEnd = paragraphs[pick.i - 1].end_s;
    const at = Math.max(start, (Math.min(prevEnd, pick.p.start_s) + pick.p.start_s) / 2);
    cuts.push({ at_s: at, header: !!heading });
    start = at;
  }
  return cuts;
}
