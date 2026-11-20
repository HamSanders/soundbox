/**
 * Audiobooks: regenerate a selection inside a voiced paragraph.
 *
 * No installed model returns word timings (the ASR path returns text only),
 * so the selection's place in the audio is estimated: characters map to time
 * across the voiced region, and each cut is then snapped to the nearest real
 * pause. A cut only happens in silence. If either edge of the selection has no
 * pause near it (common mid-sentence, where words run together), the words
 * plan is reported as unreliable and widened to the sentence, whose edges
 * almost always fall on a pause. If even that fails, the whole paragraph is
 * regenerated. The caller reports which plan ran and why.
 *
 * Pure: arrays in, arrays out, tested with synthetic tone-and-silence audio.
 */

import type { Audio } from "../audio/dsp.js";

export interface CharRange {
  start: number;
  end: number;
}

export type SpliceMode = "words" | "sentence" | "paragraph";

export interface SplicePlan {
  mode: SpliceMode;
  /** Text range to re-voice (expanded to whole words or the sentence). */
  start: number;
  end: number;
  /** Cut points in the existing audio, seconds. Null in paragraph mode. */
  cut_start_s: number | null;
  cut_end_s: number | null;
  /** Why the plan was widened, when it was. */
  reason: string | null;
}

/** Grow a range to whole words. */
export function expandToWords(text: string, r: CharRange): CharRange {
  let start = Math.max(0, Math.min(r.start, text.length));
  let end = Math.max(start, Math.min(r.end, text.length));
  while (start > 0 && /[\p{L}\p{N}'’-]/u.test(text[start - 1]!)) start--;
  while (end < text.length && /[\p{L}\p{N}'’-]/u.test(text[end]!)) end++;
  // Drop surrounding whitespace.
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return { start, end };
}

/** Grow a range to the sentence(s) it touches, closing punctuation included. */
export function expandToSentence(text: string, r: CharRange): CharRange {
  let start = r.start;
  while (start > 0 && !/[.!?…]["”’)\]]?\s$/.test(text.slice(Math.max(0, start - 3), start))) start--;
  let end = r.end;
  const tail = /[.!?…]+["”’)\]]*/g;
  tail.lastIndex = Math.max(0, end - 1);
  const m = tail.exec(text);
  end = m ? m.index + m[0].length : text.length;
  while (start < end && /\s/.test(text[start]!)) start++;
  return { start, end };
}

/** Frame energies (dBFS RMS over all channels) at `hopS` spacing. */
export function frameDb(audio: Audio, sampleRate: number, hopS = 0.01): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate * hopS));
  const n = audio[0]?.length ?? 0;
  const frames = Math.ceil(n / hop);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    let count = 0;
    for (const ch of audio) {
      for (let i = f * hop; i < Math.min(n, (f + 1) * hop); i++) {
        sum += ch[i]! * ch[i]!;
        count++;
      }
    }
    out[f] = count ? 10 * Math.log10(sum / count + 1e-12) : -120;
  }
  return out;
}

/** Leading/trailing silence and the silent runs (pauses) of a clip. */
export function pauses(
  audio: Audio,
  sampleRate: number,
  opts: { minPauseS?: number; hopS?: number } = {},
): { voiced_start_s: number; voiced_end_s: number; gaps: { start_s: number; end_s: number }[] } {
  const hopS = opts.hopS ?? 0.01;
  const minFrames = Math.round((opts.minPauseS ?? 0.06) / hopS);
  const db = frameDb(audio, sampleRate, hopS);
  let peak = -120;
  for (const v of db) peak = Math.max(peak, v);
  const threshold = Math.max(-55, peak - 35);
  const silent = Array.from(db, (v) => v < threshold);
  let first = silent.indexOf(false);
  let last = silent.lastIndexOf(false);
  if (first === -1) {
    first = 0;
    last = db.length - 1;
  }
  const gaps: { start_s: number; end_s: number }[] = [];
  let run = -1;
  for (let f = first; f <= last + 1; f++) {
    if (f <= last && silent[f]) {
      if (run === -1) run = f;
    } else if (run !== -1) {
      if (f - run >= minFrames) gaps.push({ start_s: run * hopS, end_s: f * hopS });
      run = -1;
    }
  }
  return { voiced_start_s: first * hopS, voiced_end_s: (last + 1) * hopS, gaps };
}

/**
 * Where character `index` is spoken, by weight: letters 1, a comma or dash
 * 4, sentence punctuation 8 (each roughly a pause).
 */
export function charTime(text: string, index: number, voicedStartS: number, voicedEndS: number): number {
  const weight = (c: string) => (/[.!?…;:]/.test(c) ? 8 : /[,—–]/.test(c) ? 4 : /\s/.test(c) ? 0.6 : 1);
  let total = 0;
  let before = 0;
  for (let i = 0; i < text.length; i++) {
    const w = weight(text[i]!);
    if (i < index) before += w;
    total += w;
  }
  if (total === 0) return voicedStartS;
  return voicedStartS + (before / total) * (voicedEndS - voicedStartS);
}

const PAUSE_PUNCT = /[,.!?…;:—–]["”’)\]]*$/;

/** Text offsets where a reader pauses: just after , . ! ? ; : — and the
 *  following space. In reading order. */
export function pausePoints(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/[,.!?…;:—–]+["”’)\]]*(?=\s+\S)/g)) out.push((m.index ?? 0) + m[0].length);
  return out;
}

/** Grow a selection end over punctuation right after it ("soundly" -> "soundly,"). */
function takePunctuation(text: string, end: number): number {
  const m = /^[,.!?…;:—–]+["”’)\]]*/.exec(text.slice(end));
  return m ? end + m[0].length : end;
}

/**
 * Decide how to re-voice `range` of `text` given the current take's audio.
 *
 * A cut is only made where the text has a pause (after punctuation) and the
 * audio has a matching silence. When the clip has as many internal pauses as
 * the text, the k-th text pause is the k-th gap. Otherwise the gap must be
 * within 0.25 s of where the characters predict.
 */
export function planSelection(text: string, range: CharRange, audio: Audio, sampleRate: number): SplicePlan {
  const durationS = (audio[0]?.length ?? 0) / sampleRate;
  const p = pauses(audio, sampleRate);
  const points = pausePoints(text);
  const aligned = points.length === p.gaps.length;
  const paragraph = (reason: string | null): SplicePlan =>
    ({ mode: "paragraph", start: 0, end: text.length, cut_start_s: null, cut_end_s: null, reason });

  /** Where in the audio a text boundary can be cut, or null. */
  const cutAt = (offset: number): number | null => {
    if (text.slice(0, offset).trim() === "") return 0;
    if (text.slice(offset).trim() === "") return durationS;
    const before = text.slice(0, offset).trimEnd();
    if (!PAUSE_PUNCT.test(before)) return null;
    const k = points.findIndex((pt) => pt >= before.length);
    if (k === -1) return null;
    if (aligned) {
      const g = p.gaps[k]!;
      return (g.start_s + g.end_s) / 2;
    }
    const t = charTime(text, offset, p.voiced_start_s, p.voiced_end_s);
    let best: number | null = null;
    for (const g of p.gaps) {
      const mid = (g.start_s + g.end_s) / 2;
      const dist = t >= g.start_s && t <= g.end_s ? 0 : Math.min(Math.abs(t - g.start_s), Math.abs(t - g.end_s));
      if (dist <= 0.25 && (best === null || Math.abs(mid - t) < Math.abs(best - t))) best = mid;
    }
    return best;
  };
  const isWhole = (r: CharRange) => text.slice(0, r.start).trim() === "" && text.slice(r.end).trim() === "";
  const tryRange = (r: CharRange): { a: number; b: number } | null => {
    const a = cutAt(r.start);
    const b = cutAt(r.end);
    return a === null || b === null || b <= a ? null : { a, b };
  };

  const w0 = expandToWords(text, range);
  if (w0.end <= w0.start) return paragraph("The selection is empty.");
  const words = { start: w0.start, end: takePunctuation(text, w0.end) };
  if (isWhole(words)) return paragraph(null);
  const w = tryRange(words);
  if (w) return { mode: "words", ...words, cut_start_s: w.a, cut_end_s: w.b, reason: null };

  const sentence = expandToSentence(text, words);
  if (isWhole(sentence)) {
    return paragraph("The selection's edges fall mid-sentence with no pause to cut at, so the whole paragraph was regenerated.");
  }
  const s = tryRange(sentence);
  if (s) {
    return {
      mode: "sentence",
      ...sentence,
      cut_start_s: s.a,
      cut_end_s: s.b,
      reason: "The selection's edges fall mid-sentence with no pause to cut at, so the whole sentence was regenerated.",
    };
  }
  return paragraph("No pause in the audio matched the sentence's edges, so the whole paragraph was regenerated.");
}

/** Trim silence off both ends of a fragment, keeping `padS` of it. */
export function trimFragment(audio: Audio, sampleRate: number, padS = 0.03): Audio {
  const p = pauses(audio, sampleRate);
  const n = audio[0]?.length ?? 0;
  const a = Math.max(0, Math.floor((p.voiced_start_s - padS) * sampleRate));
  const b = Math.min(n, Math.ceil((p.voiced_end_s + padS) * sampleRate));
  return audio.map((ch) => ch.slice(a, b));
}

/**
 * Replace `[cutStartS, cutEndS)` of `base` with `insert`, joined by
 * equal-power crossfades of `xfadeS` on each side. Channel counts are matched
 * to `base` (missing channels copy the insert's first).
 */
export function spliceAudio(
  base: Audio,
  insert: Audio,
  sampleRate: number,
  cutStartS: number,
  cutEndS: number,
  xfadeS = 0.015,
): Audio {
  const n = base[0]?.length ?? 0;
  const a = Math.max(0, Math.min(n, Math.round(cutStartS * sampleRate)));
  const b = Math.max(a, Math.min(n, Math.round(cutEndS * sampleRate)));
  const x = Math.max(0, Math.round(xfadeS * sampleRate));
  return base.map((ch, c) => {
    const ins = insert[c] ?? insert[0] ?? new Float32Array(0);
    const head = ch.subarray(0, a);
    const tail = ch.subarray(b);
    const xa = Math.min(x, head.length, ins.length);
    const xb = Math.min(x, tail.length, Math.max(0, ins.length - xa));
    const out = new Float32Array(head.length + ins.length + tail.length - xa - xb);
    out.set(head.subarray(0, head.length - xa), 0);
    let o = head.length - xa;
    for (let i = 0; i < xa; i++) {
      const t = (i + 0.5) / xa;
      out[o++] = head[head.length - xa + i]! * Math.cos((t * Math.PI) / 2) + ins[i]! * Math.sin((t * Math.PI) / 2);
    }
    out.set(ins.subarray(xa, ins.length - xb), o);
    o += ins.length - xa - xb;
    for (let i = 0; i < xb; i++) {
      const t = (i + 0.5) / xb;
      out[o++] = ins[ins.length - xb + i]! * Math.cos((t * Math.PI) / 2) + tail[i]! * Math.sin((t * Math.PI) / 2);
    }
    out.set(tail.subarray(xb), o);
    return out;
  });
}
