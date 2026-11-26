/**
 * Audiobooks: per-paragraph QC for render runs, and the render estimate.
 *
 * A voiced paragraph fails QC when it is (near) silent, when it clips, when
 * its length is far from what the text predicts, or, when an ASR model is
 * available, when the words heard differ too much from the words written.
 * A failure triggers a retry with a new seed (up to two, like ElevenLabs'
 * Auto-Regenerate, research §4). Pure, tested on synthetic audio.
 */

import type { Audio } from "../audio/dsp.js";

export interface QcResult {
  pass: boolean;
  /** Failed check ids: "silence" | "clipping" | "length" | "words". */
  failed: string[];
  /** Checks that passed but are worth a listen. */
  warnings: string[];
  message: string;
  metrics: {
    duration_s: number;
    voiced_s: number;
    peak_dbfs: number;
    clipped_samples: number;
    expected_s: number;
    wer: number | null;
  };
}

/** Speaking rate assumed with no history: about 150 words a minute. */
export const DEFAULT_CHARS_PER_S = 14;

const dbfs = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

/** Seconds of audio above -45 dBFS in 20 ms windows. */
function voicedSeconds(audio: Audio, sampleRate: number): number {
  const hop = Math.max(1, Math.round(sampleRate * 0.02));
  const n = audio[0]?.length ?? 0;
  let voiced = 0;
  for (let i = 0; i < n; i += hop) {
    let sum = 0;
    let c = 0;
    for (const ch of audio) {
      for (let j = i; j < Math.min(n, i + hop); j++) {
        sum += ch[j]! * ch[j]!;
        c++;
      }
    }
    if (c && dbfs(Math.sqrt(sum / c)) > -45) voiced += Math.min(hop, n - i);
  }
  return voiced / sampleRate;
}

/** Samples in runs of 3+ at full scale (|x| >= 0.999): real clipping, not
 *  one peak that touched the ceiling. */
function clippedSamples(audio: Audio): number {
  let total = 0;
  for (const ch of audio) {
    let run = 0;
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(ch[i]!) >= 0.999) run++;
      else {
        if (run >= 3) total += run;
        run = 0;
      }
    }
    if (run >= 3) total += run;
  }
  return total;
}

/** Spoken length predicted from text, seconds. */
export function expectedSeconds(text: string, charsPerS = DEFAULT_CHARS_PER_S): number {
  const chars = text.replace(/\s+/g, " ").trim().length;
  return chars / Math.max(1, charsPerS);
}

/** Words for comparison: lower case, letters and digits only. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Word error rate of `heard` against `ref` (Levenshtein over words). */
export function wordErrorRate(ref: string, heard: string): number {
  const a = words(ref);
  const b = words(heard);
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]! / a.length;
}

export interface QcOptions {
  charsPerS?: number;
  /** What an ASR model heard, when the word check ran. */
  transcript?: string | null;
}

export function qcClip(audio: Audio, sampleRate: number, text: string, opts: QcOptions = {}): QcResult {
  const n = audio[0]?.length ?? 0;
  const duration = n / sampleRate;
  let peak = 0;
  for (const ch of audio) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]!));
  const voiced = voicedSeconds(audio, sampleRate);
  const clipped = clippedSamples(audio);
  const expected = expectedSeconds(text, opts.charsPerS);
  const failed: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  if (voiced < Math.min(0.25, expected * 0.3) || dbfs(peak) < -40) {
    failed.push("silence");
    notes.push(`almost no speech (${voiced.toFixed(2)} s above -45 dBFS)`);
  }
  if (clipped > Math.max(10, n * audio.length * 0.0005)) {
    failed.push("clipping");
    notes.push(`${clipped} clipped samples`);
  }
  // Short lines vary a lot, so they get an absolute allowance too.
  const lo = Math.min(expected * 0.4, expected - 1.5);
  const hi = Math.max(expected * 2.5, expected + 3);
  if (!failed.includes("silence") && (voiced < lo || duration > hi)) {
    failed.push("length");
    notes.push(`${duration.toFixed(1)} s where about ${expected.toFixed(1)} s was expected`);
  }
  let wer: number | null = null;
  if (opts.transcript !== undefined && opts.transcript !== null && words(text).length >= 4) {
    wer = wordErrorRate(text, opts.transcript);
    if (wer > 0.35) {
      failed.push("words");
      notes.push(`${Math.round(wer * 100)}% of words differ from the text`);
    } else if (wer > 0.15) {
      warnings.push("words");
      notes.push(`${Math.round(wer * 100)}% of words differ (kept)`);
    }
  }
  return {
    pass: failed.length === 0,
    failed,
    warnings,
    message: notes.length ? notes.join("; ") : "ok",
    metrics: {
      duration_s: duration,
      voiced_s: voiced,
      peak_dbfs: dbfs(peak),
      clipped_samples: clipped,
      expected_s: expected,
      wer,
    },
  };
}

/* --------------------------------------------------------------- estimate */

export interface EstimateParagraph {
  chapter_id: string;
  text: string;
  kind: "line" | "pause";
  /** Will this render voice it (unlocked, and unvoiced or overwrite)? */
  to_voice: boolean;
  duration_s: number | null;
  model_id: string | null;
}

export interface ChapterEstimate {
  chapter_id: string;
  title: string;
  paragraphs: number;
  to_voice: number;
  characters: number;
  /** Predicted length of the finished chapter audio. */
  audio_s: number;
  /** Predicted wall time to voice what is left. */
  render_s: number;
}

export interface Estimate {
  chapters: ChapterEstimate[];
  total: Omit<ChapterEstimate, "chapter_id" | "title">;
  /** The rates used, per model; `measured` false means an assumed default. */
  basis: { model_id: string; rtf: number; chars_per_s: number; measured: boolean; samples: number }[];
}

/** Generation time per audio second assumed for a model with no history. */
export const DEFAULT_RTF = 1;

export function estimate(
  chapters: { id: string; title: string }[],
  paragraphs: EstimateParagraph[],
  rates: Map<string, { rtf: number; chars_per_s: number; samples: number }>,
  pacing: { paragraph_gap_s: number },
): Estimate {
  const basis = new Map<string, Estimate["basis"][number]>();
  const rate = (model: string | null) => {
    const key = model ?? "(default)";
    let b = basis.get(key);
    if (!b) {
      const m = model ? rates.get(model) : undefined;
      b = m
        ? { model_id: key, rtf: m.rtf, chars_per_s: m.chars_per_s, measured: true, samples: m.samples }
        : { model_id: key, rtf: DEFAULT_RTF, chars_per_s: DEFAULT_CHARS_PER_S, measured: false, samples: 0 };
      basis.set(key, b);
    }
    return b;
  };
  const out: ChapterEstimate[] = chapters.map((c) => ({
    chapter_id: c.id, title: c.title, paragraphs: 0, to_voice: 0, characters: 0, audio_s: 0, render_s: 0,
  }));
  const byId = new Map(out.map((c) => [c.chapter_id, c]));
  for (const p of paragraphs) {
    const c = byId.get(p.chapter_id);
    if (!c) continue;
    c.paragraphs++;
    if (p.kind === "pause") {
      c.audio_s += p.duration_s ?? 0;
      continue;
    }
    const chars = p.text.trim().length;
    c.characters += chars;
    const r = rate(p.model_id);
    const predicted = chars / Math.max(1, r.chars_per_s);
    if (p.to_voice) {
      c.to_voice++;
      c.render_s += predicted * r.rtf;
      c.audio_s += predicted;
    } else {
      c.audio_s += p.duration_s ?? predicted;
    }
    c.audio_s += pacing.paragraph_gap_s;
  }
  const total = out.reduce(
    (t, c) => ({
      paragraphs: t.paragraphs + c.paragraphs,
      to_voice: t.to_voice + c.to_voice,
      characters: t.characters + c.characters,
      audio_s: t.audio_s + c.audio_s,
      render_s: t.render_s + c.render_s,
    }),
    { paragraphs: 0, to_voice: 0, characters: 0, audio_s: 0, render_s: 0 },
  );
  const round = (c: ChapterEstimate) => ({ ...c, audio_s: Math.round(c.audio_s), render_s: Math.round(c.render_s) });
  return {
    chapters: out.map(round),
    total: { ...total, audio_s: Math.round(total.audio_s), render_s: Math.round(total.render_s) },
    basis: [...basis.values()],
  };
}

/* ---------------------------------------------------------------- pacing */

export interface PlacedSegment {
  id: string;
  kind: "line" | "pause";
  start_s: number;
  /** Clip length for lines with audio, pause length for pauses; null = unvoiced. */
  duration_s: number | null;
  is_heading: boolean;
  /** How long an unvoiced line is drawn, from `placeholderSeconds`. */
  placeholder_s?: number;
}

/**
 * How long the timeline draws a line that has no audio yet: about 0.4 s a
 * word, at least 0.8 s. The same rule as `estimateDuration` in the app's
 * `story-timeline.tsx`, so the slot an unvoiced paragraph holds is exactly
 * the clip the timeline draws for it.
 */
export function placeholderSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(0.8, words * 0.4);
}

/**
 * Lay a chapter's paragraphs end to end in reading order with the book's
 * pacing: `paragraph_gap_s` after each paragraph, plus `heading_gap_s` after
 * a heading. Pause lines keep their own length and take no extra gap.
 *
 * An unvoiced paragraph holds its place at its placeholder length, so the
 * timeline shows the chapter in reading order with room where the missing
 * audio goes, rather than every unvoiced clip piled up wherever it was made.
 * Voicing it swaps the estimate for the real length and the rest moves along.
 * Returns only the start times that change.
 */
export function layoutChapter(
  segments: PlacedSegment[],
  pacing: { paragraph_gap_s: number; heading_gap_s: number },
): Map<string, number> {
  const moves = new Map<string, number>();
  let cursor = 0;
  for (const s of segments) {
    if (s.kind === "pause") {
      if (Math.abs(s.start_s - cursor) > 0.0005) moves.set(s.id, round3(cursor));
      cursor += s.duration_s ?? 0;
      continue;
    }
    const length = s.duration_s ?? s.placeholder_s ?? 0;
    if (Math.abs(s.start_s - cursor) > 0.0005) moves.set(s.id, round3(cursor));
    cursor += length + pacing.paragraph_gap_s + (s.is_heading ? pacing.heading_gap_s : 0);
  }
  return moves;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
