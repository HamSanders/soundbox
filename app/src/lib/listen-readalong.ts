/**
 * Read-along: which word is being spoken.
 *
 * Paragraph timings are real (each paragraph is its own clip on the
 * timeline). Word timings are not, yet: inside a paragraph the time is split
 * across words by their length in characters, plus a little extra after
 * punctuation, which a narrator pauses on. Close enough to follow along;
 * not exact.
 *
 * ASR ALIGNMENT HOOK: when the server can align words with a local ASR model
 * (qwen3-asr), it will set `ListenManifest.word_timings` and send real
 * `{ word, start_s, end_s }` per paragraph. `wordTimings()` is the one place
 * to switch over: return the aligned list when it is present and fall back to
 * `estimateWords()` when it is not.
 */

import type { ListenParagraph } from "./listen-types";

export interface WordSpan {
  /** The word as written, with its trailing punctuation. */
  text: string;
  /** Character offset in the paragraph text. */
  offset: number;
  start_s: number;
  end_s: number;
}

const PAUSE_AFTER = /[.!?;:]["'”’)]*$|[,—–]["'”’)]*$/;

/** Split paragraph text into words and spread its duration across them. */
export function estimateWords(paragraph: Pick<ListenParagraph, "text" | "start_s" | "end_s">): WordSpan[] {
  const { text, start_s, end_s } = paragraph;
  const tokens: { text: string; offset: number; weight: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const word = m[0];
    const letters = word.replace(/[^\p{L}\p{N}]/gu, "").length;
    // Characters approximate syllables; a pause mark adds a beat.
    const weight = Math.max(1, letters) + 1 + (PAUSE_AFTER.test(word) ? (/[.!?]/.test(word) ? 4 : 2) : 0);
    tokens.push({ text: word, offset: m.index, weight });
  }
  if (start_s === null || end_s === null || tokens.length === 0) {
    return tokens.map((t) => ({ text: t.text, offset: t.offset, start_s: NaN, end_s: NaN }));
  }
  const total = tokens.reduce((s, t) => s + t.weight, 0);
  const span = Math.max(0, end_s - start_s);
  let t = start_s;
  return tokens.map((tok) => {
    const d = (tok.weight / total) * span;
    const w = { text: tok.text, offset: tok.offset, start_s: t, end_s: t + d };
    t += d;
    return w;
  });
}

/** Word timings for a paragraph: aligned when available, else estimated. */
export function wordTimings(paragraph: ListenParagraph): WordSpan[] {
  // [ASR alignment] Prefer `paragraph.words` here once the manifest carries them.
  return estimateWords(paragraph);
}

/** Index of the word playing at `t`, or -1. */
export function wordAt(words: WordSpan[], t: number): number {
  for (let i = words.length - 1; i >= 0; i--) {
    if (!Number.isNaN(words[i].start_s) && words[i].start_s <= t) return i;
  }
  return -1;
}
