/**
 * Audiobook mastering: take a chapter's dry mixdown to a file a retailer
 * accepts.
 *
 * Presets:
 *
 *   acx      mono, 44.1 kHz, RMS aimed at -20 dB (ACX allows -23 to -18),
 *            true-peak limited at -3.5 dBFS (ACX allows -3; the 0.5 dB is
 *            headroom for the MP3 encoder's own overshoot), a downward
 *            expander that keeps pauses at or below -60 dB, and room tone at
 *            head and tail from the book's pacing.
 *   podcast  -16 LUFS integrated, -1 dBTP, channels kept, 44.1 kHz.
 *   none     untouched.
 *
 * ACX's figures and the room-tone lengths are in docs/audiobooks/
 * research-elevenlabs.md §8, with sources.
 *
 * Room tone is a real, quiet noise bed rather than digital zero. ACX rejects
 * gated-to-nothing pauses as over-processing ("if you use a noise gate to get
 * complete silence (no 'room tone') ACX will reject you",
 * https://forum.audacityteam.org/t/noise-floor-passes-in-audacity-fails-in-acx/94865),
 * and Audacity's ACX Check flags a dead -inf floor as a warning
 * (https://plugins.audacityteam.org/analyzers/loudness-compliance-checks).
 * TTS output has no room at all, so every pause would be exactly that. The
 * bed sits at -70 dB RMS: 10 dB under ACX's -60 dB ceiling and inaudible
 * under speech. The level is our choice inside ACX's limit, not a published
 * number.
 */

import { type Audio, frameCount, resampleAudio } from "./dsp.js";
import { edgeSilence, fromDb, integratedLufs, rmsDb, truePeakDb, truePeakEnvelope } from "./meter.js";
import type { MasteringPresetId, PacingSettings } from "../audiobook/types.js";

export const MASTER_RATE = 44_100;

export interface PresetSpec {
  id: MasteringPresetId;
  label: string;
  /** null keeps the source layout. */
  channels: 1 | null;
  sampleRate: number | null;
  /** What the gain stage aims at: unweighted RMS or integrated LUFS. */
  target: { kind: "rms"; db: number } | { kind: "lufs"; db: number } | null;
  ceilingDbtp: number | null;
  expander: boolean;
  roomTone: boolean;
}

export const PRESETS: Record<MasteringPresetId, PresetSpec> = {
  acx: {
    id: "acx",
    label: "ACX / Audible",
    channels: 1,
    sampleRate: MASTER_RATE,
    target: { kind: "rms", db: -20 },
    ceilingDbtp: -3.5,
    expander: true,
    roomTone: true,
  },
  podcast: {
    id: "podcast",
    label: "Podcast (-16 LUFS)",
    channels: null,
    sampleRate: MASTER_RATE,
    target: { kind: "lufs", db: -16 },
    ceilingDbtp: -1,
    expander: false,
    roomTone: false,
  },
  none: {
    id: "none",
    label: "None",
    channels: null,
    sampleRate: null,
    target: null,
    ceilingDbtp: null,
    expander: false,
    roomTone: false,
  },
};

/** Room tone bed level, dB RMS. See the file comment. */
export const ROOM_TONE_DB = -70;

/* ---------------------------------------------------------------- helpers */

/** Small seeded PRNG (mulberry32), so a master is reproducible. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function downmixMono(audio: Audio): Audio {
  if (audio.length <= 1) return audio;
  const frames = frameCount(audio);
  const out = new Float32Array(frames);
  for (const ch of audio) for (let i = 0; i < frames; i++) out[i] += ch[i] / audio.length;
  return [out];
}

function gain(audio: Audio, db: number): Audio {
  const g = fromDb(db);
  return audio.map((ch) => ch.map((v) => v * g));
}

/**
 * Room tone: gently low-passed white noise at `levelDb` RMS. Low-passed
 * because flat white noise reads as hiss; a quiet room is darker.
 */
export function roomTone(frames: number, levelDb: number, seed = 1): Float32Array {
  const rand = prng(seed);
  const out = new Float32Array(frames);
  let y = 0;
  let sum = 0;
  for (let i = 0; i < frames; i++) {
    y += 0.5 * (rand() * 2 - 1 - y);
    out[i] = y;
    sum += y * y;
  }
  const rms = frames > 0 ? Math.sqrt(sum / frames) : 0;
  if (rms > 0) {
    const g = fromDb(levelDb) / rms;
    for (let i = 0; i < frames; i++) out[i] *= g;
  }
  return out;
}

/* --------------------------------------------------------------- expander */

export interface ExpanderOptions {
  /** Below this envelope level the signal is turned down. */
  thresholdDb: number;
  /** Downward expansion ratio: 1 dB under the threshold becomes `ratio` dB. */
  ratio: number;
  /** Never turn down more than this. */
  rangeDb: number;
  attackS: number;
  holdS: number;
  releaseS: number;
  /** The gain opens this far ahead of a word, so onsets are never clipped. */
  lookaheadS: number;
}

export const DEFAULT_EXPANDER: ExpanderOptions = {
  thresholdDb: -50,
  ratio: 3,
  rangeDb: 30,
  attackS: 0.002,
  holdS: 0.12,
  releaseS: 0.2,
  lookaheadS: 0.01,
};

/**
 * Downward expander with lookahead and hold.
 *
 * Gentler than a gate: quiet word tails and breaths under the threshold are
 * lowered in proportion rather than cut, and the hold keeps the gain open
 * through the short dips inside a word. The gain is computed from the
 * loudest channel and applied to all, so the image never shifts.
 */
export function expand(audio: Audio, sampleRate: number, opts: ExpanderOptions = DEFAULT_EXPANDER): Audio {
  const frames = frameCount(audio);
  if (frames === 0) return audio;
  // Envelope: peak-hold detector over a 5 ms window, from the loudest channel.
  const envWin = Math.max(1, Math.round(0.005 * sampleRate));
  const level = new Float32Array(frames);
  for (const ch of audio) for (let i = 0; i < frames; i++) level[i] = Math.max(level[i], Math.abs(ch[i]));
  const env = slidingMax(level, envWin);

  const look = Math.round(opts.lookaheadS * sampleRate);
  const holdFrames = Math.round(opts.holdS * sampleRate);
  const attack = Math.exp(-1 / Math.max(1, opts.attackS * sampleRate));
  const release = Math.exp(-1 / Math.max(1, opts.releaseS * sampleRate));
  const threshold = fromDb(opts.thresholdDb);

  const out = audio.map(() => new Float32Array(frames));
  let g = 1;
  let hold = 0;
  for (let i = 0; i < frames; i++) {
    const e = env[Math.min(frames - 1, i + look)];
    let target: number;
    if (e >= threshold) {
      target = 1;
      hold = holdFrames;
    } else if (hold > 0) {
      target = 1;
      hold--;
    } else {
      const under = (e > 0 ? 20 * Math.log10(e) : -200) - opts.thresholdDb;
      target = fromDb(Math.max(-opts.rangeDb, under * (opts.ratio - 1)));
    }
    // Opening is fast (attack), closing is slow (release).
    const coeff = target > g ? attack : release;
    g = target + coeff * (g - target);
    for (let c = 0; c < audio.length; c++) out[c][i] = audio[c][i] * g;
  }
  return out;
}

/** Maximum over a centred window of `size` frames (monotonic deque). */
function slidingMax(x: Float32Array, size: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  const half = Math.floor(size / 2);
  const dq = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let next = 0;
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n - 1, i + half);
    while (next <= hi) {
      while (tail > head && x[dq[tail - 1]] <= x[next]) tail--;
      dq[tail++] = next++;
    }
    while (dq[head] < i - half) head++;
    out[i] = x[dq[head]];
  }
  return out;
}

/** Minimum over [i, i + size) (forward-looking), monotonic deque. */
function forwardMin(x: Float32Array, size: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  const dq = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && x[dq[tail - 1]] >= x[i]) tail--;
    dq[tail++] = i;
    while (dq[head] >= i + size) head++;
    out[i] = x[dq[head]];
  }
  return out;
}

/* ---------------------------------------------------------------- limiter */

/**
 * Lookahead true-peak limiter.
 *
 * The gain each frame needs is ceiling / true-peak envelope (4x oversampled,
 * see `truePeakEnvelope`). A forward minimum over the lookahead window
 * followed by a moving average of the same length gives a smooth curve that
 * is provably never above any frame's need: every frame the average covers
 * already saw the dip. The release then lets go slowly. A last static trim
 * catches the fraction of a dB that gain modulation can add between samples.
 */
export function limitTruePeak(
  audio: Audio,
  sampleRate: number,
  ceilingDbtp: number,
  options: { lookaheadS?: number; releaseS?: number } = {},
): Audio {
  const frames = frameCount(audio);
  if (frames === 0) return audio;
  const ceiling = fromDb(ceilingDbtp);
  const need = new Float32Array(frames).fill(1);
  for (const ch of audio) {
    const env = truePeakEnvelope(ch);
    for (let i = 0; i < frames; i++) {
      if (env[i] > ceiling) need[i] = Math.min(need[i], ceiling / env[i]);
    }
  }
  const L = Math.max(1, Math.round((options.lookaheadS ?? 0.005) * sampleRate));
  const mins = forwardMin(need, L);
  const smooth = new Float32Array(frames);
  let acc = 0;
  for (let i = 0; i < frames; i++) {
    acc += mins[i];
    if (i >= L) acc -= mins[i - L];
    smooth[i] = acc / Math.min(i + 1, L);
  }
  // Release: the gain may rise only this fast, which keeps it below `smooth`.
  const step = 1 / Math.max(1, (options.releaseS ?? 0.08) * sampleRate);
  let g = smooth[0];
  const out = audio.map(() => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    g = Math.min(smooth[i], g + step);
    for (let c = 0; c < audio.length; c++) out[c][i] = audio[c][i] * g;
  }
  const over = truePeakDb(out) - ceilingDbtp;
  return over > 0 ? gain(out, -over - 0.01) : out;
}

/* ------------------------------------------------------------- room tone */

/**
 * Pad or trim the quiet at each end so it is `headS` and `tailS` long.
 * Returns the audio and how far the content moved (seconds, positive = later),
 * which shifts paragraph timings by the same amount.
 */
export function fitEdges(
  audio: Audio,
  sampleRate: number,
  headS: number,
  tailS: number,
): { audio: Audio; shiftS: number } {
  const frames = frameCount(audio);
  // Speech is found relative to the file's own level (30 dB under its RMS),
  // because this runs before the level stage and the mix may be quiet.
  const threshold = Math.min(-40, Math.max(-65, rmsDb(audio) - 30));
  const edges = edgeSilence(audio, sampleRate, threshold);
  if (edges.head_s >= frames / sampleRate) {
    // Nothing but silence: a file of exactly head + tail.
    const len = Math.round((headS + tailS) * sampleRate);
    return { audio: audio.map(() => new Float32Array(len)), shiftS: 0 };
  }
  const headNow = Math.round(edges.head_s * sampleRate);
  const tailNow = Math.round(edges.tail_s * sampleRate);
  const headWant = Math.round(headS * sampleRate);
  const tailWant = Math.round(tailS * sampleRate);
  const from = Math.max(0, headNow - headWant);
  const to = frames - Math.max(0, tailNow - tailWant);
  const padHead = Math.max(0, headWant - headNow);
  const padTail = Math.max(0, tailWant - tailNow);
  const len = padHead + (to - from) + padTail;
  const out = audio.map((ch) => {
    const o = new Float32Array(len);
    o.set(ch.subarray(from, to), padHead);
    return o;
  });
  return { audio: out, shiftS: (padHead - from) / sampleRate };
}

/** Add the room-tone bed under everything, so no stretch is digital zero. */
export function addRoomTone(audio: Audio, levelDb = ROOM_TONE_DB, seed = 1): Audio {
  const frames = frameCount(audio);
  const bed = roomTone(frames, levelDb, seed);
  return audio.map((ch) => {
    const o = new Float32Array(frames);
    for (let i = 0; i < frames; i++) o[i] = ch[i] + bed[i];
    return o;
  });
}

/* ------------------------------------------------------------- 16-bit out */

/**
 * Quantise to 16-bit with TPDF dither (two uniform sources summed, 1 LSB
 * peak each side). Without it, the quiet room tone and fade tails would
 * truncate into correlated distortion.
 */
export function ditherTo16(audio: Audio, seed = 7): Int16Array[] {
  const rand = prng(seed);
  return audio.map((ch) => {
    const out = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const d = rand() - rand();
      const v = Math.round(ch[i] * 32767 + d);
      out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
    return out;
  });
}

/* ----------------------------------------------------------------- master */

export interface MasterResult {
  audio: Audio;
  sampleRate: number;
  /** Seconds the content moved (room-tone fitting); add it to timings. */
  shiftS: number;
  /** Gain the level stage applied, dB. */
  gainDb: number;
}

/**
 * Master one chapter mixdown.
 *
 * Order: layout and rate, level, expander, limiter, edges, room tone. The
 * level stage iterates because limiting takes a little RMS back off: it
 * re-measures and nudges until the result is within 0.25 dB of the target.
 */
export function master(
  input: Audio,
  inputRate: number,
  preset: MasteringPresetId,
  pacing?: Pick<PacingSettings, "head_room_tone_s" | "tail_room_tone_s">,
): MasterResult {
  const spec = PRESETS[preset];
  let audio = input;
  let rate = inputRate;
  if (spec.channels === 1) audio = downmixMono(audio);
  if (spec.sampleRate && spec.sampleRate !== rate) {
    audio = resampleAudio(audio, rate, spec.sampleRate);
    rate = spec.sampleRate;
  }
  if (!spec.target || frameCount(audio) === 0) {
    return { audio, sampleRate: rate, shiftS: 0, gainDb: 0 };
  }

  const target = spec.target;
  const measureLevel = (a: Audio): number =>
    target.kind === "rms" ? rmsDb(a) : integratedLufs(a, rate);

  // Edges first, so the level is measured on the file as it will ship. The
  // room tone is added last, after the expander has quietened the pauses.
  let shiftS = 0;
  if (spec.roomTone && pacing) {
    const fitted = fitEdges(audio, rate, pacing.head_room_tone_s, pacing.tail_room_tone_s);
    audio = fitted.audio;
    shiftS = fitted.shiftS;
  }

  const source = audio;
  const before = measureLevel(source);
  if (before <= -100) return { audio, sampleRate: rate, shiftS, gainDb: 0 };
  let gainDb = target.db - before;
  let out = source;
  for (let pass = 0; pass < 4; pass++) {
    out = gain(source, gainDb);
    if (spec.expander) out = expand(out, rate);
    if (spec.ceilingDbtp !== null) out = limitTruePeak(out, rate, spec.ceilingDbtp);
    if (spec.roomTone) out = addRoomTone(out);
    const miss = target.db - measureLevel(out);
    if (Math.abs(miss) <= 0.25) break;
    // Limited material gains less than asked; never push more than +12 dB
    // past the first estimate chasing it.
    gainDb = Math.min(gainDb + miss, target.db - before + 12);
  }
  return { audio: out, sampleRate: rate, shiftS, gainDb: Math.round(gainDb * 100) / 100 };
}
