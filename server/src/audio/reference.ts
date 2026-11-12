/**
 * Reference clips — the audio a cloned voice is read from.
 *
 * Kept apart from dsp.ts because the rules here run the other way round. A
 * generated sound is a deliverable, so it is trimmed and loudness-normalised
 * until it is ready for an editor. A reference clip is an *input* to a model:
 * level and timbre are part of what is being captured. So nothing below ever
 * boosts a clip or changes its tone. It only cuts silence off the ends, takes
 * out DC offset and pulls a peak back under full scale.
 *
 * A voice can hold several clips. audio.cpp takes exactly one `--voice-ref`,
 * so they are joined into one file: each clip levelled to the group's
 * median loudness, then laid end to end with a short pause between. Voicebox
 * does the same. Averaging embeddings would be the cleverer version, but the
 * families Konchi drives have no embedding to average — they take a WAV.
 */

import { ModelError } from "../errors.js";
import { frameCount, resampleAudio, type Audio } from "./dsp.js";

/** Below this a clip carries too little speech for any family to copy. */
export const MIN_REFERENCE_S = 1;
/** Beyond this per clip the model gets slower without sounding more like
 *  anyone; the combined file has its own cap, below. */
export const MAX_REFERENCE_S = 60;
/** The joined reference stops getting better long before this — models read
 *  the first stretch of a long reference and ignore or truncate the rest. */
export const MAX_COMBINED_S = 90;
/** Clips per voice. Voicebox recommends three to five; more is padding. */
export const MAX_SAMPLES = 5;
/** Pause laid between clips when several are joined, so one speaker's last
 *  word does not run into the next clip's first. */
export const JOIN_GAP_S = 0.3;

/** RMS under which a clip is treated as silence (about -50 dBFS). A mic left
 *  on the wrong input records exactly this, and the clone it makes is noise. */
const SILENT_RMS = 0.003;
/** Silence threshold for the end trim. Gentler than dsp.trimSilence's -50 dB
 *  because a room's noise floor on a laptop mic sits around -50. */
const TRIM_THRESHOLD_DB = -45;
/** Kept either side of the first and last sound, so a breath in or a word's
 *  tail is not cut off. */
const TRIM_PAD_S = 0.15;
/** Peak ceiling (-0.2 dBFS). Only ever applied downward. */
const PEAK_CEILING = 0.977;

function toMono(audio: Audio): Float32Array {
  const n = frameCount(audio);
  if (audio.length === 1) return audio[0]!;
  const out = new Float32Array(n);
  for (const ch of audio) for (let i = 0; i < n; i++) out[i]! += ch[i]! / audio.length;
  return out;
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const v of samples) sum += v * v;
  return Math.sqrt(sum / samples.length);
}

function peak(samples: Float32Array): number {
  let p = 0;
  for (const v of samples) {
    const a = Math.abs(v);
    if (a > p) p = a;
  }
  return p;
}

/**
 * Refuse a clip that cannot make a voice, before it is saved as one.
 *
 * The failure this exists for is the silent one: a recording from the wrong
 * input, saved without complaint, that turns every line read in it into hiss
 * — and nothing says why until somebody listens.
 */
export function checkReference(audio: Audio, sampleRate: number): void {
  const seconds = frameCount(audio) / sampleRate;
  if (seconds < MIN_REFERENCE_S) {
    throw new ModelError(
      `That clip is ${seconds.toFixed(1)}s long. A voice needs at least ${MIN_REFERENCE_S}s of speech.`,
    );
  }
  if (seconds > MAX_REFERENCE_S) {
    throw new ModelError(
      `That clip is ${Math.round(seconds)}s long. Keep a reference clip under ${MAX_REFERENCE_S}s — ` +
        "cut the best stretch out of it, or add it as several shorter clips.",
    );
  }
  if (rms(toMono(audio)) < SILENT_RMS) {
    throw new ModelError(
      "That clip is almost silent. Check the recording input, or pick a louder clip.",
    );
  }
}

/**
 * Clean a clip up without changing the voice in it: remove DC offset, cut
 * near-silence off both ends (keeping a little padding), and bring a peak that
 * is over full scale back under it. A quiet clip stays quiet.
 *
 * Returns mono: a voice reference has one speaker, and a stereo phone memo's
 * two channels only differ by the room.
 */
export function tidyReference(audio: Audio, sampleRate: number): Audio {
  const mono = Float32Array.from(toMono(audio));
  if (mono.length === 0) return [mono];

  let mean = 0;
  for (const v of mono) mean += v;
  mean /= mono.length;
  if (mean !== 0) for (let i = 0; i < mono.length; i++) mono[i]! -= mean;

  const threshold = Math.pow(10, TRIM_THRESHOLD_DB / 20);
  let first = -1;
  let last = -1;
  for (let i = 0; i < mono.length; i++) {
    if (Math.abs(mono[i]!) > threshold) {
      if (first < 0) first = i;
      last = i;
    }
  }
  let out = mono;
  if (first >= 0) {
    const pad = Math.round(TRIM_PAD_S * sampleRate);
    out = mono.slice(Math.max(0, first - pad), Math.min(mono.length, last + pad + 1));
  }

  const p = peak(out);
  if (p > PEAK_CEILING) {
    const scale = PEAK_CEILING / p;
    for (let i = 0; i < out.length; i++) out[i]! *= scale;
  }
  return [out];
}

/**
 * Join a voice's clips into the one file `--voice-ref` takes.
 *
 * Every clip is made mono and resampled to the first clip's rate, then levelled
 * to the median RMS of the set — the median rather than the loudest so one hot
 * clip does not drag every other one up into clipping, and rather than the mean
 * so one near-silent clip does not drag them down. The gain is capped so no
 * clip peaks over the ceiling.
 */
export function combineReferences(
  clips: { audio: Audio; sampleRate: number }[],
): { audio: Audio; sampleRate: number } {
  if (clips.length === 0) throw new ModelError("A voice needs at least one clip.");
  const sampleRate = clips[0]!.sampleRate;
  const monos = clips.map((c) => {
    const mono = toMono(c.audio);
    return c.sampleRate === sampleRate
      ? Float32Array.from(mono)
      : resampleAudio([mono], c.sampleRate, sampleRate)[0]!;
  });

  const levels = monos.map(rms).filter((v) => v > 0);
  const sorted = [...levels].sort((a, b) => a - b);
  const target = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;

  const gap = Math.round(JOIN_GAP_S * sampleRate);
  const total = monos.reduce((n, m) => n + m.length, 0) + gap * (monos.length - 1);
  const out = new Float32Array(total);
  let offset = 0;
  monos.forEach((mono, i) => {
    const level = rms(mono);
    const p = peak(mono);
    let gain = level > 0 && target > 0 ? target / level : 1;
    if (p > 0 && p * gain > PEAK_CEILING) gain = PEAK_CEILING / p;
    for (let j = 0; j < mono.length; j++) out[offset + j] = mono[j]! * gain;
    offset += mono.length + (i < monos.length - 1 ? gap : 0);
  });
  return { audio: [out], sampleRate };
}
