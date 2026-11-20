/**
 * Opening and closing credits, and the retail sample.
 *
 * ACX asks for opening credits (title, subtitle, author, narrator) and
 * closing credits ("The End" or similar) as their own files, first and last,
 * and a retail sample of 1 to 5 minutes that starts with narration and has
 * no credits or music (research §8). The credits are chapters of kind
 * `opening_credits` / `closing_credits` whose paragraphs are the lines below,
 * so they are voiced and mastered like any chapter.
 *
 * Narration from Mirli is synthetic, and the credits say so plainly ("a
 * digital voice"), the way Spotify's distribution flow labels AI-narrated
 * books (research §4).
 */

import type { Book, ParagraphTiming } from "./types.js";

export const DIGITAL_VOICE = "a digital voice";

type CreditBook = Pick<Book, "title" | "subtitle" | "author" | "narrator">;

const sentence = (s: string): string => {
  const t = s.trim();
  return /[.!?]["')\]]?$/.test(t) ? t : `${t}.`;
};

/** "Narrated by Ana, a digital voice." / "Narrated by a digital voice." */
export function narratorLine(narrator: string | null): string {
  const name = narrator?.trim();
  return name ? `Narrated by ${name}, ${DIGITAL_VOICE}.` : `Narrated by ${DIGITAL_VOICE}.`;
}

/** Opening credits, one paragraph per line so book pacing applies between them. */
export function openingCredits(book: CreditBook): string[] {
  const lines = [sentence(book.title)];
  if (book.subtitle?.trim()) lines.push(sentence(book.subtitle));
  if (book.author?.trim()) lines.push(`Written by ${book.author.trim()}.`);
  lines.push(narratorLine(book.narrator));
  return lines;
}

/** Closing credits. */
export function closingCredits(book: CreditBook): string[] {
  const lines = ["The End."];
  const by = book.author?.trim() ? `, written by ${book.author.trim()}` : "";
  lines.push(`You have been listening to ${book.title.trim()}${by}.`);
  lines.push(narratorLine(book.narrator));
  return lines;
}

/* ---------------------------------------------------------------- sample */

export const SAMPLE_MIN_S = 60;
/** ACX: 5 minutes or less. Kept under it with room for the tail tone. */
export const SAMPLE_MAX_S = 290;
export const SAMPLE_TARGET_S = 240;

/**
 * Pick the sample span from a chapter's paragraph timings: from the first
 * paragraph, through whole paragraphs, ending at the last paragraph end at
 * or under `targetS` (and never past `SAMPLE_MAX_S`). Returns null when the
 * chapter is shorter than a minute of narration.
 */
export function pickSample(
  timings: ParagraphTiming[],
  targetS = SAMPLE_TARGET_S,
): { start_s: number; end_s: number } | null {
  if (timings.length === 0) return null;
  const start = timings[0].start_s;
  const limit = Math.min(Math.max(SAMPLE_MIN_S, targetS), SAMPLE_MAX_S);
  let end = -1;
  for (const t of timings) {
    if (t.end_s - start <= limit) end = t.end_s;
    else break;
  }
  if (end < 0) end = start + limit; // a single paragraph longer than the limit: cut inside it
  if (end - start < SAMPLE_MIN_S) {
    const last = timings[timings.length - 1].end_s;
    if (last - start < SAMPLE_MIN_S) return null;
    end = Math.min(last, start + limit);
  }
  return { start_s: start, end_s: end };
}
