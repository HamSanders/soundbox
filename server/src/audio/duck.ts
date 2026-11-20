/**
 * Ducking: pull a music or ambience bed down wherever narration is present.
 *
 * Sidechain-style. The narration is the key signal: it is measured in short
 * blocks, every block louder than `threshold_db` counts as speech, gaps
 * shorter than `hold_ms` are bridged so the bed does not pump between words,
 * and the result is moved `lookahead_ms` earlier so the bed is already down
 * when the first syllable lands. The gain then slides toward its target,
 * down by `depth_db` over `attack_ms` and back up over `release_ms`, in dB, so
 * a ramp sounds even rather than sagging at one end.
 *
 * Pure: no I/O, no state. The gain is computed per block (10 ms) and
 * interpolated per sample, so an hour-long chapter costs a few hundred
 * thousand envelope points rather than a gain value per sample.
 *
 * `duckAutomation` is the same idea for a player that only knows where the
 * narration clips sit (the app's Web Audio playback): it returns gain
 * breakpoints for an AudioParam. `app/src/components/audiobook/beds/duck.ts`
 * mirrors it. Change both together.
 */

import type { Audio } from "./dsp.js";

export interface DuckOptions {
  /** How far the bed drops under narration, in dB (positive). 0 = no ducking. */
  depth_db: number;
  /** Time to reach full depth once narration starts, ms. */
  attack_ms: number;
  /** Time to recover after narration stops, ms. */
  release_ms: number;
  /** Start ducking this long before narration starts, ms. */
  lookahead_ms: number;
  /** Gaps in narration shorter than this stay ducked, ms. */
  hold_ms: number;
  /** Narration louder than this (block RMS, dBFS) counts as speech. */
  threshold_db: number;
}

/**
 * Defaults for a spoken-word bed. 12 dB under the voice is the common
 * starting point for music under dialogue; the lookahead matches the attack
 * so the bed reaches full depth as the voice starts.
 */
export const DEFAULT_DUCK: DuckOptions = {
  depth_db: 12,
  attack_ms: 250,
  release_ms: 600,
  lookahead_ms: 250,
  hold_ms: 400,
  threshold_db: -45,
};

/** Envelope resolution. 10 ms is finer than any attack anyone would set. */
export const DUCK_BLOCK_S = 0.01;

export function resolveDuck(opts: Partial<DuckOptions> = {}): DuckOptions {
  const o = { ...DEFAULT_DUCK };
  for (const key of Object.keys(DEFAULT_DUCK) as (keyof DuckOptions)[]) {
    const v = opts[key];
    if (typeof v === "number" && Number.isFinite(v)) o[key] = v;
  }
  o.depth_db = Math.max(0, o.depth_db);
  o.attack_ms = Math.max(0, o.attack_ms);
  o.release_ms = Math.max(0, o.release_ms);
  o.lookahead_ms = Math.max(0, o.lookahead_ms);
  o.hold_ms = Math.max(0, o.hold_ms);
  return o;
}

/** Which blocks of `narration` hold speech, before hold and lookahead. */
export function speechBlocks(
  narration: Audio,
  sampleRate: number,
  blocks: number,
  thresholdDb: number,
): Uint8Array {
  const out = new Uint8Array(blocks);
  const blockFrames = Math.max(1, Math.round(sampleRate * DUCK_BLOCK_S));
  const frames = narration.length ? narration[0].length : 0;
  const threshold = Math.pow(10, thresholdDb / 20);
  const thresholdSq = threshold * threshold;
  for (let b = 0; b < blocks; b++) {
    const from = b * blockFrames;
    if (from >= frames) break;
    const to = Math.min(frames, from + blockFrames);
    let loudest = 0;
    for (const channel of narration) {
      let sum = 0;
      for (let f = from; f < to; f++) sum += channel[f] * channel[f];
      loudest = Math.max(loudest, sum / (to - from));
    }
    out[b] = loudest > thresholdSq ? 1 : 0;
  }
  return out;
}

/**
 * Turn speech blocks into a duck target: bridge short gaps, then shift
 * earlier by the lookahead. Mutates nothing; returns a new array.
 */
export function duckTarget(speech: Uint8Array, opts: DuckOptions): Uint8Array {
  const n = speech.length;
  const held = new Uint8Array(speech);
  const holdBlocks = Math.round(opts.hold_ms / 1000 / DUCK_BLOCK_S);
  let last = -1;
  for (let b = 0; b < n; b++) {
    if (!speech[b]) continue;
    if (last >= 0 && b - last - 1 > 0 && b - last - 1 <= holdBlocks) held.fill(1, last + 1, b);
    last = b;
  }
  const lookBlocks = Math.round(opts.lookahead_ms / 1000 / DUCK_BLOCK_S);
  if (lookBlocks === 0) return held;
  const out = new Uint8Array(n);
  // Walk backwards: a block is ducked if speech starts within lookahead of it.
  let countdown = 0;
  for (let b = n - 1; b >= 0; b--) {
    if (held[b]) countdown = lookBlocks + 1;
    if (countdown > 0) {
      out[b] = 1;
      countdown--;
    }
  }
  return out;
}

/**
 * The bed's gain in dB at the start of each block: 0 where it plays at its
 * own level, down to `-depth_db` under narration.
 */
export function duckingEnvelope(
  narration: Audio,
  sampleRate: number,
  frames: number,
  partial: Partial<DuckOptions> = {},
): Float32Array {
  const opts = resolveDuck(partial);
  const blockFrames = Math.max(1, Math.round(sampleRate * DUCK_BLOCK_S));
  const blocks = Math.ceil(frames / blockFrames) + 1;
  const target = duckTarget(speechBlocks(narration, sampleRate, blocks, opts.threshold_db), opts);
  const env = new Float32Array(blocks);
  const depth = opts.depth_db;
  if (depth === 0) return env;
  const down = opts.attack_ms > 0 ? (depth * DUCK_BLOCK_S * 1000) / opts.attack_ms : depth;
  const up = opts.release_ms > 0 ? (depth * DUCK_BLOCK_S * 1000) / opts.release_ms : depth;
  let g = 0;
  for (let b = 0; b < blocks; b++) {
    env[b] = g;
    const want = target[b] ? -depth : 0;
    g = want < g ? Math.max(want, g - down) : Math.min(want, g + up);
  }
  return env;
}

/**
 * Duck `bed` under `narration`. Both start at time zero and share
 * `sampleRate`; narration shorter than the bed is silence past its end.
 * Returns a new buffer the bed's shape.
 */
export function applyDucking(
  bed: Audio,
  narration: Audio,
  opts: Partial<DuckOptions> & { sampleRate: number },
): Audio {
  const { sampleRate, ...rest } = opts;
  const frames = bed.length ? bed[0].length : 0;
  if (frames === 0) return bed.map((c) => new Float32Array(c));
  const env = duckingEnvelope(narration, sampleRate, frames, rest);
  const blockFrames = Math.max(1, Math.round(sampleRate * DUCK_BLOCK_S));
  const linear = new Float32Array(env.length);
  for (let b = 0; b < env.length; b++) linear[b] = Math.pow(10, env[b] / 20);
  return bed.map((channel) => {
    const out = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      const pos = f / blockFrames;
      const b = Math.floor(pos);
      const a = linear[b];
      const next = b + 1 < linear.length ? linear[b + 1] : a;
      out[f] = channel[f] * (a + (next - a) * (pos - b));
    }
    return out;
  });
}

/** One gain breakpoint for an AudioParam-style automation lane. */
export interface DuckPoint {
  time_s: number;
  gain_db: number;
}

/**
 * Ducking as breakpoints, from where the narration clips sit rather than from
 * their audio. For a player that schedules clips (Web Audio): set the bed's
 * gain to each point with a linear ramp. Intervals closer than the hold, or
 * close enough that the release would run into the next attack, are merged.
 */
export function duckAutomation(
  intervals: { start_s: number; end_s: number }[],
  partial: Partial<DuckOptions> = {},
): DuckPoint[] {
  const opts = resolveDuck(partial);
  if (opts.depth_db === 0) return [];
  const look = opts.lookahead_ms / 1000;
  const attack = opts.attack_ms / 1000;
  const release = opts.release_ms / 1000;
  const hold = opts.hold_ms / 1000;
  const sorted = intervals
    .filter((i) => i.end_s > i.start_s)
    .sort((a, b) => a.start_s - b.start_s);
  const merged: { start_s: number; end_s: number }[] = [];
  for (const i of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && (i.start_s - prev.end_s <= hold || i.start_s - look <= prev.end_s + release)) {
      prev.end_s = Math.max(prev.end_s, i.end_s);
    } else {
      merged.push({ ...i });
    }
  }
  const points: DuckPoint[] = [];
  for (const m of merged) {
    const begin = Math.max(0, m.start_s - look);
    // A ramp that would start before zero is cut short, not shifted.
    const reached = Math.max(begin, m.start_s - look + attack);
    points.push({ time_s: begin, gain_db: 0 });
    points.push({ time_s: reached, gain_db: -opts.depth_db });
    points.push({ time_s: Math.max(reached, m.end_s), gain_db: -opts.depth_db });
    points.push({ time_s: Math.max(reached, m.end_s) + release, gain_db: 0 });
  }
  return points;
}
