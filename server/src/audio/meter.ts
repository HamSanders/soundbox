/**
 * Loudness metering for audiobook QC: the numbers ACX and the other retailers
 * judge a chapter file by.
 *
 * Pure functions over channels-first float audio, no I/O, so every one of
 * them is tested on generated sine, noise and silence fixtures.
 *
 * What "RMS" means here. ACX states its level requirement as "Measure between
 * -23dB and -18dB RMS" and its floor as "-60dB RMS", and names no weighting.
 * ACX staff told a narrator the figure is "unweighted rms"
 * (https://forum.audacityteam.org/t/measure-between-23db-and-18db-rms/32770),
 * and Audacity's ACX Check, the tool narrators use to pre-check against ACX,
 * measures plain unweighted RMS over the file
 * (https://plugins.audacityteam.org/analyzers/loudness-compliance-checks).
 * So this is unweighted RMS in dBFS with a full-scale sine reading -3.01 dB,
 * not A-weighted and not AES-17's +3 dB sine-referenced figure.
 */

import { type Audio, frameCount, integratedLoudness } from "./dsp.js";
import type { LoudnessReport } from "../audiobook/types.js";

/** What a non-finite level (digital zero) reports as, so JSON can carry it. */
export const FLOOR_DB = -120;

/** Window for the noise floor: the quietest stretch this long. */
export const NOISE_WINDOW_S = 0.5;

/** Below this short-window RMS a stretch counts as room tone, not speech. */
export const SILENCE_THRESHOLD_DB = -50;

export const toDb = (linear: number): number =>
  linear > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(linear)) : FLOOR_DB;

export const fromDb = (db: number): number => 10 ** (db / 20);

/** Mean square over every sample of every channel, between frames [from, to). */
function meanSquare(audio: Audio, from = 0, to = frameCount(audio)): number {
  if (audio.length === 0 || to <= from) return 0;
  let sum = 0;
  for (const ch of audio) {
    for (let i = from; i < to; i++) sum += ch[i] * ch[i];
  }
  return sum / (audio.length * (to - from));
}

/** Unweighted RMS of the whole signal in dBFS (full-scale sine = -3.01). */
export function rmsDb(audio: Audio): number {
  return toDb(Math.sqrt(meanSquare(audio)));
}

/** Highest absolute sample value, linear. */
export function samplePeak(audio: Audio): number {
  let peak = 0;
  for (const ch of audio) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/* -------------------------------------------------------------- true peak */

/**
 * The 4x oversampling interpolator for true-peak metering.
 *
 * ITU-R BS.1770-4 Annex 2 measures true peak by oversampling 4x with a
 * 48-tap polyphase FIR and taking the absolute maximum
 * (https://www.itu.int/rec/R-REC-BS.1770). Its published coefficients are for
 * 48 kHz; this uses a Hann-windowed sinc of the same shape (12 taps per
 * phase, 48 in total), which agrees with the reference to well under 0.1 dB
 * on the inter-sample overs it exists to catch.
 */
const OVERSAMPLE = 4;
const TAPS_PER_PHASE = 12;
const PHASES: Float64Array[] = (() => {
  const half = TAPS_PER_PHASE / 2;
  const phases: Float64Array[] = [];
  for (let p = 0; p < OVERSAMPLE; p++) {
    const taps = new Float64Array(TAPS_PER_PHASE);
    let sum = 0;
    for (let k = 0; k < TAPS_PER_PHASE; k++) {
      // Output at i + p/4 from input frame j = i + k - half + 1.
      const x = p / OVERSAMPLE - (k - half + 1);
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const window = Math.abs(x) >= half ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * x) / half);
      taps[k] = sinc * window;
      sum += taps[k];
    }
    // Each phase passes DC at unity, so a constant reads as itself.
    for (let k = 0; k < TAPS_PER_PHASE; k++) taps[k] /= sum;
    phases.push(taps);
  }
  return phases;
})();

/** Largest sum of |taps| over the phases: no interpolated value can exceed
 *  the window's largest |sample| times this. */
const TAP_GAIN = Math.max(...PHASES.map((t) => t.reduce((s, v) => s + Math.abs(v), 0)));

/** |sample| maxima over the interpolation window [i - 5, i + 6] of each frame. */
function windowAbsMax(channel: Float32Array): Float32Array {
  const n = channel.length;
  const half = TAPS_PER_PHASE / 2;
  const out = new Float32Array(n);
  // Monotonic deque over the index window.
  const dq = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let next = 0;
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n - 1, i + half);
    while (next <= hi) {
      const v = Math.abs(channel[next]);
      while (tail > head && Math.abs(channel[dq[tail - 1]]) <= v) tail--;
      dq[tail++] = next++;
    }
    while (dq[head] < i - half + 1) head++;
    out[i] = Math.abs(channel[dq[head]]);
  }
  return out;
}

function interpolatedMax(channel: Float32Array, i: number): number {
  const n = channel.length;
  const half = TAPS_PER_PHASE / 2;
  let m = Math.abs(channel[i]);
  for (let p = 1; p < OVERSAMPLE; p++) {
    const taps = PHASES[p];
    let acc = 0;
    for (let k = 0; k < TAPS_PER_PHASE; k++) {
      const j = i + k - half + 1;
      if (j >= 0 && j < n) acc += channel[j] * taps[k];
    }
    const a = Math.abs(acc);
    if (a > m) m = a;
  }
  return m;
}

/**
 * Per input frame, the largest absolute value of the signal anywhere between
 * that frame and the next, found by 4x interpolation. Used by the limiter,
 * which needs to know where the inter-sample overs are.
 *
 * Frames whose whole interpolation window is too quiet to reach `floor`
 * (even at the filter's worst-case gain) are not interpolated and report
 * their own |sample|: the limiter only cares about frames above its ceiling,
 * and this skips the 48 multiplies on nearly all of them.
 */
export function truePeakEnvelope(channel: Float32Array, floor = 0): Float32Array {
  const n = channel.length;
  const out = new Float32Array(n);
  const local = windowAbsMax(channel);
  for (let i = 0; i < n; i++) {
    out[i] = local[i] * TAP_GAIN <= floor ? Math.abs(channel[i]) : interpolatedMax(channel, i);
  }
  return out;
}

/** True peak, linear: the sample peak or the highest inter-sample peak. */
export function truePeak(audio: Audio): number {
  let peak = 0;
  for (const ch of audio) {
    const local = windowAbsMax(ch);
    for (let i = 0; i < ch.length; i++) {
      // Only frames that could beat the peak so far are interpolated.
      if (local[i] * TAP_GAIN <= peak) continue;
      const m = interpolatedMax(ch, i);
      if (m > peak) peak = m;
    }
  }
  return peak;
}

export function truePeakDb(audio: Audio): number {
  return toDb(truePeak(audio));
}

/* ------------------------------------------------------------ noise floor */

/** RMS in dB of consecutive windows `windowS` long, hopping by half a window. */
export function windowedRmsDb(audio: Audio, sampleRate: number, windowS: number): number[] {
  const frames = frameCount(audio);
  const size = Math.max(1, Math.round(windowS * sampleRate));
  if (frames <= size) return [rmsDb(audio)];
  const hop = Math.max(1, Math.floor(size / 2));
  const out: number[] = [];
  for (let from = 0; from + size <= frames; from += hop) {
    out.push(toDb(Math.sqrt(meanSquare(audio, from, from + size))));
  }
  return out;
}

/**
 * The noise floor in dB RMS.
 *
 * With `roomTone` ranges (seconds) it is the RMS over those, which is what a
 * reviewer listens to. Otherwise it is the RMS of the quietest 500 ms window
 * in the file: on narration that is a pause between sentences, which is
 * where hiss and hum are exposed. A file of digital zero reads FLOOR_DB.
 */
export function noiseFloorDb(
  audio: Audio,
  sampleRate: number,
  roomTone?: { start_s: number; end_s: number }[],
): number {
  const frames = frameCount(audio);
  if (roomTone && roomTone.length > 0) {
    let sum = 0;
    let count = 0;
    for (const r of roomTone) {
      const from = Math.max(0, Math.round(r.start_s * sampleRate));
      const to = Math.min(frames, Math.round(r.end_s * sampleRate));
      if (to <= from) continue;
      sum += meanSquare(audio, from, to) * (to - from);
      count += to - from;
    }
    if (count > 0) return toDb(Math.sqrt(sum / count));
  }
  const windows = windowedRmsDb(audio, sampleRate, NOISE_WINDOW_S);
  return windows.length ? Math.min(...windows) : FLOOR_DB;
}

/* --------------------------------------------------------- head/tail tone */

/** Short windows (10 ms) used to find where speech starts and stops. */
const EDGE_WINDOW_S = 0.01;

/**
 * Seconds of room tone before the first window louder than `thresholdDb`
 * and after the last one. A file with nothing above it is all silence and
 * reports its full length at both ends.
 */
export function edgeSilence(
  audio: Audio,
  sampleRate: number,
  thresholdDb = SILENCE_THRESHOLD_DB,
): { head_s: number; tail_s: number } {
  const frames = frameCount(audio);
  const duration = frames / sampleRate;
  const size = Math.max(1, Math.round(EDGE_WINDOW_S * sampleRate));
  const threshold = fromDb(thresholdDb) ** 2;
  let first = -1;
  let last = -1;
  for (let from = 0; from < frames; from += size) {
    const to = Math.min(frames, from + size);
    if (meanSquare(audio, from, to) > threshold) {
      if (first < 0) first = from;
      last = to;
    }
  }
  if (first < 0) return { head_s: duration, tail_s: duration };
  return { head_s: first / sampleRate, tail_s: (frames - last) / sampleRate };
}

/* ----------------------------------------------------------------- report */

/** Integrated loudness, FLOOR_DB for silence or audio shorter than 400 ms. */
export function integratedLufs(audio: Audio, sampleRate: number): number {
  if (frameCount(audio) / sampleRate < 0.4) return FLOOR_DB;
  const l = integratedLoudness(audio, sampleRate);
  return Number.isFinite(l) ? Math.max(FLOOR_DB, l) : FLOOR_DB;
}

const round = (v: number, places = 2): number => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

/** Everything QC needs to know about one file. */
export function measure(
  audio: Audio,
  sampleRate: number,
  options: { roomTone?: { start_s: number; end_s: number }[] } = {},
): LoudnessReport {
  const edges = edgeSilence(audio, sampleRate);
  return {
    rms_db: round(rmsDb(audio)),
    peak_dbfs: round(truePeakDb(audio)),
    noise_floor_db: round(noiseFloorDb(audio, sampleRate, options.roomTone)),
    integrated_lufs: round(integratedLufs(audio, sampleRate)),
    duration_s: round(frameCount(audio) / sampleRate, 3),
    head_silence_s: round(edges.head_s, 3),
    tail_silence_s: round(edges.tail_s, 3),
    sample_rate: sampleRate,
    channels: audio.length,
  };
}
