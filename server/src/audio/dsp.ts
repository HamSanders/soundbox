/**
 * Audio post-processing: trim, normalise, peaks, filters, write.
 *
 * Every model hands back float
 * samples shaped (channels, samples) in [-1, 1]; everything downstream of that
 * is shared, so the models stay thin.
 *
 * The Python original leaned on numpy, soundfile, pyloudnorm, librosa and
 * scipy. None of those exist here, so this module carries from-scratch
 * implementations of the pieces that matter: an ITU-R BS.1770-4 integrated
 * loudness meter, an FFT + phase vocoder, a windowed-sinc resampler and
 * zero-phase Butterworth filtering. Where an algorithm is a port of a specific
 * library routine that is called out at the function, because the numbers are
 * only reproducible if the exact variant is followed.
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
// wavefile is CommonJS and has no named ESM export, so the interop default
// import is the only form that resolves at runtime under NodeNext.
import wavefile from "wavefile";

const { WaveFile } = wavefile;

import { ModelError } from "../errors.js";

export const PEAK_BUCKETS = 256;

/** Audio is channels-first: one Float32Array of samples per channel. */
export type Audio = Float32Array[];

/** Anything an model might hand us: 1D, 2D or 3D nested numeric data. */
export type RawAudio =
  | ArrayLike<number>
  | ArrayLike<ArrayLike<number>>
  | ArrayLike<ArrayLike<ArrayLike<number>>>;

const isArrayLike = (v: unknown): v is ArrayLike<unknown> =>
  typeof v === "object" && v !== null && typeof (v as ArrayLike<unknown>).length === "number";

/** Number of samples per channel (0 when there are no channels). */
export function frameCount(audio: Audio): number {
  return audio.length ? audio[0].length : 0;
}

/**
 * Join clips end to end, with `gapS` seconds of silence between them.
 *
 * Written for multi-speaker dialogue, where each turn is synthesised
 * separately and the gap is the beat between speakers. Clips are matched to
 * the widest channel count present (mono up-mixed by duplication) so a mono
 * TTS line and a stereo one can share a timeline; callers are responsible for
 * matching sample rates first, since resampling needs a rate this function
 * has no opinion about.
 */
export function concatAudio(clips: Audio[], sampleRate: number, gapS = 0): Audio {
  const present = clips.filter((c) => c.length > 0);
  if (present.length === 0) return [new Float32Array(0)];

  const channels = Math.max(...present.map((c) => c.length));
  const gapFrames = Math.max(0, Math.round(gapS * sampleRate));
  const total =
    present.reduce((sum, c) => sum + frameCount(c), 0) + gapFrames * (present.length - 1);

  const out: Audio = Array.from({ length: channels }, () => new Float32Array(total));
  let offset = 0;
  for (let i = 0; i < present.length; i++) {
    const clip = present[i];
    const frames = frameCount(clip);
    for (let c = 0; c < channels; c++) {
      // Mono into stereo: reuse channel 0 rather than leaving silence on the
      // right, which would pan a whole speaker's turn hard left.
      out[c].set(clip[Math.min(c, clip.length - 1)].subarray(0, frames), offset);
    }
    offset += frames;
    if (i < present.length - 1) offset += gapFrames;
  }
  return out;
}

/**
 * Mix clips onto one timeline, each at its own start offset.
 *
 * `concatAudio`'s cousin for arranged audio rather than sequential dialogue:
 * where that one lays clips end to end and controls the beat between them,
 * this one puts each clip exactly where the timeline says it goes. Gaps are
 * silence, and clips that overlap sum — which is the whole reason a story has
 * tracks, so two voices can talk over each other on purpose.
 *
 * The sum is clipped rather than normalised: normalising would quietly change
 * the level of a mix the user has already balanced by ear, whereas clipping
 * only touches material that was genuinely too hot. Callers match sample rates
 * first, same as `concatAudio`.
 */
export function mixTimeline(
  clips: { audio: Audio; startS: number }[],
  sampleRate: number,
): Audio {
  const present = clips.filter((c) => c.audio.length > 0 && frameCount(c.audio) > 0);
  if (present.length === 0) return [new Float32Array(0)];

  const channels = Math.max(...present.map((c) => c.audio.length));
  const offsets = present.map((c) => Math.max(0, Math.round(c.startS * sampleRate)));
  const total = Math.max(...present.map((c, i) => offsets[i] + frameCount(c.audio)));

  const out: Audio = Array.from({ length: channels }, () => new Float32Array(total));
  for (let i = 0; i < present.length; i++) {
    const clip = present[i].audio;
    const frames = frameCount(clip);
    const offset = offsets[i];
    for (let c = 0; c < channels; c++) {
      // Mono into stereo duplicates channel 0, for the same reason as
      // concatAudio: silence on the right would pan the clip hard left.
      const src = clip[Math.min(c, clip.length - 1)];
      const dst = out[c];
      for (let f = 0; f < frames; f++) dst[offset + f] += src[f];
    }
  }
  return clip(out);
}

// --------------------------------------------------------------- shaping

/**
 * Normalise any sane array shape to channels-first float32.
 *
 * Mirrors `to_channels_first`, including the transpose heuristic: more rows
 * than columns means the data is samples-first and needs transposing.
 */
export function toChannelsFirst(audio: RawAudio | Audio): Audio {
  const rows = toNested(audio);
  if (rows.length === 0) return [new Float32Array(0)];

  // Heuristic: more columns than rows means it's already channels-first.
  const channels = rows.length;
  const samples = rows[0].length;
  if (channels > samples) {
    const out: Audio = [];
    for (let c = 0; c < samples; c++) {
      const ch = new Float32Array(channels);
      for (let s = 0; s < channels; s++) ch[s] = rows[s][c];
      out.push(ch);
    }
    return out;
  }
  return rows;
}

/** Flatten `audio` to a rectangular list of rows, zeroing non-finite samples. */
function toNested(audio: RawAudio | Audio): Float32Array[] {
  let node: unknown = audio;
  // (batch, channels, samples) — take the first item, same as `a[0]` in Python.
  const depth = nestingDepth(node);
  if (depth === 3) node = (node as ArrayLike<unknown>)[0];
  else if (depth === 1) node = [node]; // 1D -> a single channel
  else if (depth !== 2) throw new Error(`unsupported audio shape (depth ${depth})`);

  const rows = node as ArrayLike<ArrayLike<number>>;
  const out: Float32Array[] = [];
  let nonFinite = false;
  for (let r = 0; r < rows.length; r++) {
    const src = rows[r];
    const dst = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) {
      const v = src[i];
      // A diverged sampler emits NaN/Inf. Left alone these become undefined
      // values on the way to PCM — in practice full-scale noise. Zero them at
      // the door.
      if (Number.isFinite(v)) dst[i] = v;
      else nonFinite = true;
    }
    out.push(dst);
  }
  if (nonFinite) {
    console.warn("model output contained non-finite samples; replacing with silence");
  }
  if (out.length > 1) {
    // Ragged input would make every downstream loop unsafe; numpy would have
    // rejected it outright, so do the same.
    const n = out[0].length;
    for (const ch of out) {
      if (ch.length !== n) throw new Error("unsupported audio shape (ragged channels)");
    }
  }
  return out;
}

function nestingDepth(node: unknown): number {
  let depth = 0;
  let cur = node;
  while (isArrayLike(cur)) {
    depth += 1;
    if (cur.length === 0) break;
    cur = cur[0];
  }
  return depth;
}

/** Per-sample mean across channels — the mono sum used by trim and peaks. */
function meanChannels(audio: Audio): Float32Array {
  const n = frameCount(audio);
  const out = new Float32Array(n);
  if (!audio.length) return out;
  for (const ch of audio) for (let i = 0; i < n; i++) out[i] += ch[i];
  for (let i = 0; i < n; i++) out[i] /= audio.length;
  return out;
}

function maxAbs(audio: Audio): number {
  let peak = 0;
  for (const ch of audio) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

function mapChannels(audio: Audio, fn: (v: number, i: number) => number): Audio {
  return audio.map((ch) => {
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) out[i] = fn(ch[i], i);
    return out;
  });
}

function sliceChannels(audio: Audio, start: number, end: number): Audio {
  return audio.map((ch) => ch.slice(start, end));
}

// ---------------------------------------------------------------- levels

/**
 * Trim leading/trailing near-silence.
 *
 * Models routinely pad the tail of a short SFX with a second of nothing;
 * trimming is what makes generated clips usable as-is in an NLE.
 */
export function trimSilence(audio: Audio, sampleRate: number, thresholdDb = -50.0): Audio {
  const mono = meanChannels(audio);
  if (mono.length === 0) return audio;
  const ampThreshold = Math.pow(10, thresholdDb / 20.0);
  let first = -1;
  let last = -1;
  for (let i = 0; i < mono.length; i++) {
    if (Math.abs(mono[i]) > ampThreshold) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return audio;
  const pad = Math.trunc(0.01 * sampleRate); // keep 10ms so transients aren't clipped
  const start = Math.max(0, first - pad);
  const end = Math.min(mono.length, last + pad);
  return sliceChannels(audio, start, end);
}

/**
 * Loudness-normalise to `targetLufs`, then guard against clipping.
 *
 * Short SFX are often shorter than the 400ms block ITU-R BS.1770 needs; in
 * that case fall back to peak normalisation instead of returning silence.
 * Any metering failure falls back the same way — never fail a render on
 * metering.
 */
export function normalizeLoudness(audio: Audio, sampleRate: number, targetLufs: number): Audio {
  const duration = frameCount(audio) / sampleRate;
  if (duration < 0.5) return peakNormalize(audio, -1.0);

  let loudness: number;
  try {
    loudness = integratedLoudness(audio, sampleRate);
  } catch (exc) {
    console.warn(`loudness metering failed (${String(exc)}); using peak normalisation`);
    return peakNormalize(audio, -1.0);
  }
  if (!Number.isFinite(loudness)) return peakNormalize(audio, -1.0);

  const gain = Math.pow(10, (targetLufs - loudness) / 20.0);
  const out = mapChannels(audio, (v) => v * gain);
  const peak = maxAbs(out);
  if (peak > 0.9885) {
    // -0.1 dBFS ceiling
    const scale = 0.9885 / peak;
    // In place: `out` is this function's own copy, and a second full copy of
    // a ten-minute song is 200 MB.
    for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] = ch[i] * scale;
  }
  return out;
}

export function peakNormalize(audio: Audio, targetDbfs = -1.0): Audio {
  const peak = maxAbs(audio);
  if (peak <= 1e-8) return audio;
  const scale = Math.pow(10, targetDbfs / 20.0) / peak;
  return mapChannels(audio, (v) => v * scale);
}

export function clip(audio: Audio): Audio {
  return mapChannels(audio, (v) => (v > 1 ? 1 : v < -1 ? -1 : v));
}

export function reverse(audio: Audio): Audio {
  return audio.map((ch) => {
    const out = new Float32Array(ch.length);
    for (let i = 0, j = ch.length - 1; i < ch.length; i++, j--) out[i] = ch[j];
    return out;
  });
}

export function applyGainDb(audio: Audio, gainDb: number): Audio {
  const g = Math.pow(10, gainDb / 20.0);
  return mapChannels(audio, (v) => v * g);
}

/**
 * Fade a clip in and out, in place of nothing.
 *
 * Equal-power curves (`sin`/`cos`) rather than linear ones, because these are
 * also the halves of a crossfade: two linear ramps summed across an overlap
 * dip by 3 dB in the middle, which is audible as a hole exactly where two
 * clips are supposed to be joining seamlessly. Equal power holds the level
 * flat through the join, and on a fade against silence it sounds no different
 * from a linear one.
 *
 * Both lengths are clamped to what the clip has: a two-second fade on a
 * one-second clip is a mistake worth surviving, not worth failing on.
 */
export function applyFades(
  audio: Audio,
  sampleRate: number,
  fadeInS: number,
  fadeOutS: number,
): Audio {
  const frames = frameCount(audio);
  if (frames === 0) return audio;
  const inFrames = Math.min(frames, Math.max(0, Math.round(fadeInS * sampleRate)));
  const outFrames = Math.min(frames - inFrames, Math.max(0, Math.round(fadeOutS * sampleRate)));
  if (inFrames === 0 && outFrames === 0) return audio;

  return audio.map((channel) => {
    const out = new Float32Array(channel);
    for (let i = 0; i < inFrames; i += 1) {
      out[i] *= Math.sin((Math.PI / 2) * (i / inFrames));
    }
    for (let i = 0; i < outFrames; i += 1) {
      const from = frames - outFrames + i;
      out[from] *= Math.cos((Math.PI / 2) * (i / outFrames));
    }
    return out;
  });
}

/** Manual in/out trim, as opposed to `trimSilence`'s automatic one. */
export function trimRange(
  audio: Audio,
  sampleRate: number,
  startS: number,
  endS: number,
): Audio {
  const n = frameCount(audio);
  const start = Math.max(0, Math.round(startS * sampleRate));
  const end = Math.min(n, Math.round(endS * sampleRate));
  if (end <= start) throw new ModelError("The trim's end must be after its start.");
  return sliceChannels(audio, start, end);
}

// ----------------------------------------------------------- BS.1770-4

/**
 * ITU-R BS.1770-4 integrated loudness in LUFS.
 *
 * Port of `pyloudnorm.Meter.integrated_loudness` (which is what the Python
 * server used). The constants below are pyloudnorm's exact filter designs; the
 * meter is only reproducible if the same two-stage K-weighting is applied with
 * the same coefficient formulas, so they are spelled out rather than derived.
 *
 * Returns -Infinity for material that is entirely below the absolute gate,
 * which the caller treats as "not finite" and falls back to peak normalising.
 */
export function integratedLoudness(audio: Audio, sampleRate: number): number {
  const numChannels = audio.length;
  const numSamples = frameCount(audio);
  const T_g = 0.4; // block size, seconds
  if (numSamples / sampleRate < T_g) {
    throw new Error("Audio must have length greater than the block size");
  }

  // Stage 1: high-shelf modelling the acoustic effect of the head.
  // Stage 2: RLB high-pass. Both are biquads applied causally, in order.
  const shelf = highShelfCoeffs(sampleRate, 1681.9744509555319, 1 / Math.SQRT2, 3.99984385397);
  const rlb = rlbHighPassCoeffs(sampleRate, 38.13547087602444, 0.5003270373238773);
  // Channel weights: L/R/C unweighted, surrounds +1.5 dB. Anything beyond five
  // channels is weighted 1.0, matching pyloudnorm's default table.
  const G = (i: number): number => (i === 3 || i === 4 ? 1.41 : 1.0);

  const overlap = 0.75;
  const step = 1.0 - overlap;
  const T = numSamples / sampleRate;
  const numBlocks = Math.round((T - T_g) / (T_g * step)) + 1;

  // z[i][j]: mean square of channel i over block j. One channel is filtered at
  // a time, in place, and dropped once its blocks are summed: holding every
  // channel's filtered copy (and the copy between the two stages) at once came
  // to 24 bytes per sample, about 120 MB for a minute of stereo.
  const z: Float64Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    const zi = new Float64Array(numBlocks);
    const ch = Float64Array.from(audio[i]);
    biquadInPlace(shelf, ch);
    biquadInPlace(rlb, ch);
    for (let j = 0; j < numBlocks; j++) {
      const l = Math.trunc(T_g * (j * step) * sampleRate);
      const u = Math.trunc(T_g * (j * step + 1) * sampleRate);
      let acc = 0;
      for (let k = l; k < u && k < numSamples; k++) acc += ch[k] * ch[k];
      zi[j] = acc / (T_g * sampleRate);
    }
    z.push(zi);
  }

  // Block loudness, then the two-stage gate: an absolute -70 LUFS floor, then a
  // relative gate 10 LU below the mean of the blocks that survived the first.
  const blockLoudness = new Float64Array(numBlocks);
  for (let j = 0; j < numBlocks; j++) {
    let sum = 0;
    for (let i = 0; i < numChannels; i++) sum += G(i) * z[i][j];
    blockLoudness[j] = -0.691 + 10.0 * Math.log10(sum);
  }

  const Gamma_a = -70.0;
  let kept: number[] = [];
  for (let j = 0; j < numBlocks; j++) if (blockLoudness[j] > Gamma_a) kept.push(j);
  if (kept.length === 0) return -Infinity;

  const gatedMean = (blocks: number[]): number => {
    let sum = 0;
    for (let i = 0; i < numChannels; i++) {
      let acc = 0;
      for (const j of blocks) acc += z[i][j];
      sum += G(i) * (acc / blocks.length);
    }
    return sum;
  };

  const Gamma_r = -0.691 + 10.0 * Math.log10(gatedMean(kept)) - 10.0;
  kept = [];
  for (let j = 0; j < numBlocks; j++) {
    if (blockLoudness[j] > Gamma_r && blockLoudness[j] > Gamma_a) kept.push(j);
  }
  if (kept.length === 0) return -Infinity;

  return -0.691 + 10.0 * Math.log10(gatedMean(kept));
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ high-shelf, normalised by a0 — pyloudnorm's "high_shelf" design. */
function highShelfCoeffs(fs: number, fc: number, Q: number, gainDb: number): Biquad {
  const A = Math.pow(10, gainDb / 40.0);
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const sqA = Math.sqrt(A);
  const a0 = A + 1 - (A - 1) * cos + 2 * sqA * alpha;
  return {
    b0: (A * (A + 1 + (A - 1) * cos + 2 * sqA * alpha)) / a0,
    b1: (-2 * A * (A - 1 + (A + 1) * cos)) / a0,
    b2: (A * (A + 1 + (A - 1) * cos - 2 * sqA * alpha)) / a0,
    a1: (2 * (A - 1 - (A + 1) * cos)) / a0,
    a2: (A + 1 - (A - 1) * cos - 2 * sqA * alpha) / a0,
  };
}

/** RBJ high-pass, normalised by a0 — pyloudnorm's "high_pass" (RLB) design. */
function rlbHighPassCoeffs(fs: number, fc: number, Q: number): Biquad {
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Causal biquad, transposed direct form II, zero initial state (lfilter),
 *  written over its input: y[n] depends only on x[n] and the state, so each
 *  sample is read before it is replaced. */
function biquadInPlace(c: Biquad, x: Float64Array): void {
  const y = x;
  let s1 = 0;
  let s2 = 0;
  for (let n = 0; n < x.length; n++) {
    const xn = x[n];
    const yn = c.b0 * xn + s1;
    s1 = c.b1 * xn - c.a1 * yn + s2;
    s2 = c.b2 * xn - c.a2 * yn;
    y[n] = yn;
  }
}

// ----------------------------------------------------------------- peaks

/**
 * Downsample to `buckets` peak values in [0,1] for waveform drawing.
 *
 * Sent with every Sound so the client can draw a waveform without fetching and
 * decoding the audio. The chunking reproduces `numpy.array_split`: with n
 * samples over B buckets the first n % B buckets get one extra sample. Any
 * other split (e.g. uniform floor sizes) shifts the waveform visibly.
 */
export function computePeaks(audio: Audio, buckets = PEAK_BUCKETS): number[] {
  const mean = meanChannels(audio);
  if (mean.length === 0) return new Array<number>(buckets).fill(0);
  const n = Math.max(mean.length, buckets); // pad with zeros when shorter
  const mono = new Float64Array(n);
  for (let i = 0; i < mean.length; i++) mono[i] = Math.abs(mean[i]);

  const base = Math.floor(n / buckets);
  const remainder = n % buckets;
  const peaks = new Float64Array(buckets);
  let offset = 0;
  let top = 0;
  for (let b = 0; b < buckets; b++) {
    const size = base + (b < remainder ? 1 : 0);
    let m = 0;
    for (let i = offset; i < offset + size; i++) if (mono[i] > m) m = mono[i];
    offset += size;
    peaks[b] = m;
    if (m > top) top = m;
  }
  const out: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const v = top > 0 ? peaks[b] / top : peaks[b];
    out.push(Math.round(v * 1e4) / 1e4);
  }
  return out;
}

// -------------------------------------------------------------- file I/O

/**
 * Decode WAV bytes to channels-first float32 in [-1, 1].
 *
 * Split out from `readWav` because audio no longer only arrives as a file:
 * audio.cpp's task API answers with the WAV inline, and round-tripping it
 * through a temp file just to read it straight back would be theatre.
 *
 * Plain PCM and float WAV, which is everything Mirli writes and every model
 * sends, is read straight into one Float32Array per channel. wavefile, which
 * did this before, goes through two interleaved Float64Array copies and
 * per-sample function calls: about 20x the file's size in memory and 13 s of
 * blocked event loop for a one-minute stereo song, which is what ran the 512 MB
 * web studio out of memory finishing a Mirli Cloud render. The scaling is
 * wavefile's own (positive over 2^(b-1)-1, negative over 2^(b-1)), so a file
 * decodes to the same samples either way; anything unusual (compressed,
 * extensible with a non-PCM subformat, odd block sizes) still goes to
 * wavefile.
 */
export function decodeWav(bytes: Buffer | Uint8Array): { audio: Audio; sampleRate: number } {
  const buf = bytes instanceof Buffer ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return decodePlainWav(buf) ?? decodeWavSlow(buf);
}

interface PlainWav {
  format: 1 | 3;
  channels: number;
  sampleRate: number;
  bits: number;
  dataStart: number;
  dataLength: number;
}

/** The fmt and data chunks of a PCM (1) or IEEE-float (3) WAV, or null. */
function parsePlainWav(buf: Buffer): PlainWav | null {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  let fmt: Omit<PlainWav, "dataStart" | "dataLength"> | null = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > buf.length) return null;
      let format = buf.readUInt16LE(body);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the subformat GUID's first two bytes.
      if (format === 0xfffe) {
        if (size < 40 || body + 26 > buf.length) return null;
        format = buf.readUInt16LE(body + 24);
      }
      const channels = buf.readUInt16LE(body + 2);
      const sampleRate = buf.readUInt32LE(body + 4);
      const blockAlign = buf.readUInt16LE(body + 12);
      const bits = buf.readUInt16LE(body + 14);
      const ok =
        channels > 0 &&
        blockAlign === (channels * bits) / 8 &&
        ((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && (bits === 32 || bits === 64)));
      if (!ok) return null;
      fmt = { format: format as 1 | 3, channels, sampleRate, bits };
    } else if (id === "data") {
      if (!fmt) return null;
      // A streamed WAV may say 0 or 0xFFFFFFFF here: take what is actually there.
      const available = buf.length - body;
      const length = size === 0 || size > available ? available : size;
      return { ...fmt, dataStart: body, dataLength: length - (length % ((fmt.channels * fmt.bits) / 8)) };
    }
    off = body + size + (size & 1);
  }
  return null;
}

function decodePlainWav(buf: Buffer): { audio: Audio; sampleRate: number } | null {
  const wav = parsePlainWav(buf);
  if (!wav) return null;
  const { channels, bits, dataStart } = wav;
  const bytesPer = bits / 8;
  const frames = wav.dataLength / (channels * bytesPer);
  const audio: Audio = Array.from({ length: channels }, () => new Float32Array(frames));
  const max = 2 ** (bits - 1) - 1;
  const min = 2 ** (bits - 1);
  let p = dataStart;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++, p += bytesPer) {
      let v: number;
      if (wav.format === 3) {
        v = bits === 32 ? buf.readFloatLE(p) : buf.readDoubleLE(p);
      } else {
        const s =
          bits === 16
            ? buf.readInt16LE(p)
            : bits === 24
              ? buf.readIntLE(p, 3)
              : bits === 32
                ? buf.readInt32LE(p)
                : buf[p] - 128;
        v = s > 0 ? s / max : s / min;
      }
      audio[c][i] = v;
    }
  }
  return { audio, sampleRate: wav.sampleRate };
}

/** Anything plain decoding does not cover, through wavefile. */
function decodeWavSlow(buf: Buffer): { audio: Audio; sampleRate: number } {
  const wav = new WaveFile();
  wav.fromBuffer(buf);
  // Ask wavefile for float samples so we get [-1, 1] regardless of the source
  // bit depth, the same guarantee soundfile's dtype="float32" gave us.
  wav.toBitDepth("32f");
  const fmt = wav.fmt as { numChannels: number; sampleRate: number };
  const raw = wav.getSamples(false) as unknown as Float64Array | Float64Array[];
  // getSamples returns a bare array for mono and an array-of-channels above it.
  const channels: Float64Array[] = fmt.numChannels === 1 ? [raw as Float64Array] : (raw as Float64Array[]);
  return {
    audio: channels.map((ch) => Float32Array.from(ch)),
    sampleRate: fmt.sampleRate,
  };
}

/** Read a WAV file back to channels-first float32 in [-1, 1]. */
export function readWav(path: string): { audio: Audio; sampleRate: number } {
  return decodeWav(readFileSync(path));
}

/**
 * Encode 24-bit PCM WAV bytes: a plain 44-byte header, then interleaved
 * samples.
 *
 * Written directly for the same reason `decodeWav` reads directly: wavefile
 * needed a JS-array copy of every channel plus two Float64Array copies, over
 * 300 MB to write one minute of stereo. The scaling matches what wavefile did
 * (positive times 2^23-1, negative times 2^23, truncated toward zero), with
 * two differences: out-of-range samples are clamped rather than wrapped, and
 * values too small to print without an exponent become 0, where wavefile's
 * `parseInt` turned 1e-14 into 8.
 */
export function encodeWav24(audio: Audio, sampleRate: number): Buffer {
  const channels = audio.length;
  const frames = channels ? audio[0].length : 0;
  const dataLength = frames * channels * 3;
  const out = Buffer.alloc(44 + dataLength);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataLength, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * channels * 3, 28);
  out.writeUInt16LE(channels * 3, 32);
  out.writeUInt16LE(24, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataLength, 40);
  let p = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++, p += 3) {
      const s = audio[c][i];
      let v = Math.trunc(s > 0 ? s * 8388607 : s * 8388608);
      if (v > 8388607) v = 8388607;
      else if (v < -8388608 || Number.isNaN(v)) v = Number.isNaN(v) ? 0 : -8388608;
      out.writeIntLE(v, p, 3);
    }
  }
  return out;
}

/** Write 24-bit PCM WAV. Returns the file size in bytes. */
export function writeWav(path: string, audio: Audio, sampleRate: number): number {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = encodeWav24(audio, sampleRate);
  writeFileSync(path, bytes);
  return bytes.length;
}

export interface ProcessResult {
  sizeBytes: number;
  durationS: number;
  peaks: number[];
  channels: number;
}

/** Full post chain. */
export function processAndWrite(
  audio: RawAudio | Audio,
  sampleRate: number,
  path: string,
  options: { trim?: boolean; normalizeLufs?: number | null } = {},
): ProcessResult {
  const { trim = true, normalizeLufs = -16.0 } = options;
  let a = toChannelsFirst(audio);
  if (trim) a = trimSilence(a, sampleRate);
  if (normalizeLufs !== null && normalizeLufs !== undefined) {
    a = normalizeLoudness(a, sampleRate, normalizeLufs);
  }
  // Clipped in place when every channel is already a copy made above, never
  // the caller's own arrays: one less full copy of the audio.
  const given = new Set<unknown>(Array.isArray(audio) ? audio : []);
  if (a.some((ch) => given.has(ch))) a = clip(a);
  else for (const ch of a) for (let i = 0; i < ch.length; i++) ch[i] = ch[i] > 1 ? 1 : ch[i] < -1 ? -1 : ch[i];
  const sizeBytes = writeWav(path, a, sampleRate);
  return {
    sizeBytes,
    durationS: frameCount(a) / sampleRate,
    peaks: computePeaks(a),
    channels: a.length,
  };
}

/** How long one MP3 transcode may run before it is killed. Minutes of WAV
 *  encode in seconds; this is for an ffmpeg that has hung, not a slow one. */
export const TRANSCODE_TIMEOUT_MS = 120_000;

/**
 * Best-effort WAV -> MP3 via ffmpeg. Resolves false if ffmpeg is absent,
 * fails, or runs past `timeoutMs` (it is killed then).
 *
 * Asynchronous on purpose: this runs inside a GET handler, and a synchronous
 * spawn there froze every other request — job polling, playback, the MCP
 * endpoint — for as long as ffmpeg took. The output is written beside `dst`
 * under a temporary name and renamed into place, so a transcode that dies
 * half-way never leaves a truncated file at the cache path the route checks
 * first.
 */
export function transcodeMp3(
  src: string,
  dst: string,
  bitrate = "192k",
  timeoutMs = TRANSCODE_TIMEOUT_MS,
): Promise<boolean> {
  mkdirSync(dirname(dst), { recursive: true });
  const tmp = `${dst}.${process.pid}-${Date.now()}.part`;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) {
        try {
          renameSync(tmp, dst);
          resolve(statSync(dst).isFile());
          return;
        } catch {
          // fall through to cleanup
        }
      }
      rmSync(tmp, { force: true });
      resolve(false);
    };
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(
        "ffmpeg",
        ["-y", "-loglevel", "error", "-i", src, "-b:a", bitrate, "-f", "mp3", tmp],
        { stdio: "ignore", windowsHide: true },
      );
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(false);
    }, timeoutMs);
    // ENOENT here is "ffmpeg is not on PATH", which is a normal, non-fatal state.
    proc.on("error", () => finish(false));
    proc.on("close", (code) => finish(code === 0));
  });
}

// ------------------------------------------------------------------ FFT

/**
 * In-place iterative radix-2 Cooley-Tukey FFT. `n` must be a power of two,
 * which it always is here (n_fft is 2048).
 */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] /= n;
  }
}

const N_FFT = 2048;
const HOP = 512;

/** Periodic (sym=False) Hann window, which is what librosa's STFT uses. */
function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

interface Spectrum {
  re: Float64Array[]; // [frame][bin], bins 0..nFft/2
  im: Float64Array[];
}

/** librosa.stft with center=True and reflect padding. */
function stft(y: Float64Array, nFft = N_FFT, hop = HOP): Spectrum {
  const pad = nFft >> 1;
  const padded = reflectPad(y, pad);
  const nBins = pad + 1;
  const win = hann(nFft);
  const frames = 1 + Math.floor((padded.length - nFft) / hop);
  const re: Float64Array[] = [];
  const im: Float64Array[] = [];
  const bufRe = new Float64Array(nFft);
  const bufIm = new Float64Array(nFft);
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < nFft; i++) {
      bufRe[i] = padded[off + i] * win[i];
      bufIm[i] = 0;
    }
    fft(bufRe, bufIm, false);
    re.push(bufRe.slice(0, nBins));
    im.push(bufIm.slice(0, nBins));
  }
  return { re, im };
}

/**
 * librosa.istft with center=True: overlap-add the windowed inverse frames and
 * divide by the summed squared window, then strip the centring pad and force
 * the result to `length` samples.
 */
function istft(spec: Spectrum, length: number, nFft = N_FFT, hop = HOP): Float64Array {
  const frames = spec.re.length;
  const win = hann(nFft);
  const total = nFft + hop * Math.max(frames - 1, 0);
  const acc = new Float64Array(total);
  const env = new Float64Array(total);
  const bufRe = new Float64Array(nFft);
  const bufIm = new Float64Array(nFft);
  for (let f = 0; f < frames; f++) {
    const fr = spec.re[f];
    const fi = spec.im[f];
    // Rebuild the full Hermitian-symmetric spectrum before inverting.
    for (let k = 0; k < fr.length; k++) {
      bufRe[k] = fr[k];
      bufIm[k] = fi[k];
    }
    for (let k = 1; k < nFft - fr.length + 1; k++) {
      bufRe[nFft - k] = fr[k];
      bufIm[nFft - k] = -fi[k];
    }
    fft(bufRe, bufIm, true);
    const off = f * hop;
    for (let i = 0; i < nFft; i++) {
      acc[off + i] += bufRe[i] * win[i];
      env[off + i] += win[i] * win[i];
    }
  }
  const tiny = 1e-10;
  for (let i = 0; i < total; i++) if (env[i] > tiny) acc[i] /= env[i];
  const start = nFft >> 1;
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const j = start + i;
    out[i] = j < total ? acc[j] : 0;
  }
  return out;
}

function reflectPad(y: Float64Array, pad: number): Float64Array {
  const n = y.length;
  const out = new Float64Array(n + 2 * pad);
  for (let i = 0; i < n; i++) out[pad + i] = y[i];
  if (n <= 1) return out; // nothing to reflect against; zero padding is all we can do
  for (let i = 0; i < pad; i++) {
    out[pad - 1 - i] = y[Math.min(i + 1, n - 1)];
    out[pad + n + i] = y[Math.max(n - 2 - i, 0)];
  }
  return out;
}

/**
 * Phase vocoder — port of `librosa.phase_vocoder`.
 *
 * Resamples the STFT along time by `rate` while accumulating phase so the
 * output stays coherent. The subtlety is `dphase`: the raw frame-to-frame phase
 * difference is ambiguous modulo 2*pi, so the expected advance for each bin is
 * subtracted first, the remainder wrapped into (-pi, pi], and the expected
 * advance added back. Skipping that wrap is what makes naive implementations
 * sound smeared.
 */
function phaseVocoder(spec: Spectrum, rate: number, hop = HOP): Spectrum {
  const frames = spec.re.length;
  const nBins = frames ? spec.re[0].length : 0;
  const phaseAdvance = new Float64Array(nBins);
  for (let k = 0; k < nBins; k++) phaseAdvance[k] = (Math.PI * hop * k) / (nBins - 1);

  const nSteps = Math.max(0, Math.ceil(frames / rate));
  const outRe: Float64Array[] = [];
  const outIm: Float64Array[] = [];
  const phaseAcc = new Float64Array(nBins);
  for (let k = 0; k < nBins; k++) phaseAcc[k] = Math.atan2(spec.im[0][k], spec.re[0][k]);

  const magAt = (f: number, k: number): number =>
    f < frames ? Math.hypot(spec.re[f][k], spec.im[f][k]) : 0;
  const angAt = (f: number, k: number): number =>
    f < frames ? Math.atan2(spec.im[f][k], spec.re[f][k]) : 0;

  for (let t = 0; t < nSteps; t++) {
    const step = t * rate;
    const f0 = Math.trunc(step);
    const alpha = step - f0;
    const re = new Float64Array(nBins);
    const im = new Float64Array(nBins);
    for (let k = 0; k < nBins; k++) {
      const mag = (1 - alpha) * magAt(f0, k) + alpha * magAt(f0 + 1, k);
      re[k] = mag * Math.cos(phaseAcc[k]);
      im[k] = mag * Math.sin(phaseAcc[k]);
      let dphase = angAt(f0 + 1, k) - angAt(f0, k) - phaseAdvance[k];
      dphase -= 2 * Math.PI * Math.round(dphase / (2 * Math.PI));
      phaseAcc[k] += phaseAdvance[k] + dphase;
    }
    outRe.push(re);
    outIm.push(im);
  }
  return { re: outRe, im: outIm };
}

/** `rate` > 1 shortens the clip (faster); < 1 lengthens it (slower). */
export function timeStretch(audio: Audio, rate: number): Audio {
  if (!(rate > 0)) throw new ModelError("Time-stretch rate must be greater than zero.");
  const stretched = audio.map((ch) => stretchChannel(Float64Array.from(ch), rate));
  const minLen = stretched.reduce((m, c) => Math.min(m, c.length), Infinity);
  return stretched.map((c) => Float32Array.from(c.subarray(0, minLen)));
}

function stretchChannel(y: Float64Array, rate: number): Float64Array {
  if (y.length === 0) return y;
  const spec = stft(y);
  if (spec.re.length === 0) return y;
  const out = phaseVocoder(spec, rate);
  return istft(out, Math.max(1, Math.round(y.length / rate)));
}

/**
 * Port of `librosa.effects.pitch_shift`: stretch in time by 2**(-n/12), then
 * resample by the inverse ratio so the duration comes back and the pitch moves.
 * The sample rate is unused — only the ratio matters — but stays in the
 * signature to match the Python and every other edit op.
 */
export function pitchShift(audio: Audio, _sampleRate: number, semitones: number): Audio {
  if (semitones === 0) return audio.map((ch) => ch.slice());
  const rate = Math.pow(2.0, -semitones / 12.0);
  return audio.map((ch) => {
    const y = Float64Array.from(ch);
    const stretched = stretchChannel(y, rate);
    // Resampling from sr/rate down to sr scales length by `rate`, undoing the
    // stretch; fix_length then guarantees the original sample count exactly.
    const shifted = resample(stretched, rate);
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length && i < shifted.length; i++) out[i] = shifted[i];
    return out;
  });
}

/**
 * Resample every channel from `fromRate` to `toRate`, e.g. before handing
 * audio to a sep model that requires a fixed input rate (htdemucs wants
 * 44100 Hz and rejects anything else with "sample rate mismatch"). A no-op
 * when the rates already match.
 */
export function resampleAudio(audio: Audio, fromRate: number, toRate: number): Audio {
  if (fromRate === toRate) return audio;
  const ratio = toRate / fromRate;
  return audio.map((ch) => Float32Array.from(resample(Float64Array.from(ch), ratio)));
}

/**
 * Band-limited resampler: windowed-sinc interpolation with a Kaiser window.
 * `ratio` is targetRate / origRate. When downsampling the sinc cutoff drops to
 * `ratio` so the anti-alias filter comes for free.
 *
 * librosa defaults to soxr_hq; this is a shorter (16 zero-crossing) kernel,
 * which is a quality trade, not a behavioural one.
 */
function resample(x: Float64Array, ratio: number): Float64Array {
  if (Math.abs(ratio - 1) < 1e-12 || x.length === 0) return x.slice();
  const nOut = Math.ceil(x.length * ratio);
  const cutoff = Math.min(1.0, ratio);
  const zeros = 16;
  const halfWidth = zeros / cutoff;
  const beta = 8.6;
  const i0beta = besselI0(beta);
  const out = new Float64Array(nOut);
  for (let i = 0; i < nOut; i++) {
    const t = i / ratio; // position in input samples
    const lo = Math.ceil(t - halfWidth);
    const hi = Math.floor(t + halfWidth);
    let acc = 0;
    let norm = 0;
    for (let j = lo; j <= hi; j++) {
      const d = t - j;
      const r = d / halfWidth;
      if (r <= -1 || r >= 1) continue;
      const w = besselI0(beta * Math.sqrt(1 - r * r)) / i0beta;
      const h = cutoff * sinc(cutoff * d) * w;
      norm += h;
      if (j >= 0 && j < x.length) acc += h * x[j];
    }
    out[i] = norm !== 0 ? acc / norm : 0;
  }
  return out;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const p = Math.PI * x;
  return Math.sin(p) / p;
}

/** Modified Bessel function of the first kind, order 0 (series form). */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 60; k++) {
    const t = x / (2 * k);
    term *= t * t;
    sum += term;
    if (term < 1e-16 * sum) break;
  }
  return sum;
}

// --------------------------------------------------------------- filters

/**
 * Zero-phase 2nd-order Butterworth filtering — the equivalent of
 * `scipy.signal.sosfiltfilt(butter(2, cutoff, btype, fs=..., output="sos"))`.
 *
 * A 2nd-order Butterworth is a single biquad with Q = 1/sqrt(2), and the
 * bilinear-transform coefficients below match scipy's exactly. Filtering
 * forward then backward doubles the order and cancels the phase response;
 * scipy's odd extension at both edges is reproduced so transients at the start
 * of a clip don't get a filter-startup thump.
 */
function filterAudio(
  audio: Audio,
  sampleRate: number,
  cutoffHz: number,
  btype: "highpass" | "lowpass",
): Audio {
  const nyquist = sampleRate / 2.0;
  const cutoff = Math.min(Math.max(cutoffHz, 1.0), nyquist - 1.0);
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / Math.SQRT2; // sin(w0) / (2*Q), Q = 1/sqrt(2)
  const a0 = 1 + alpha;
  const c: Biquad =
    btype === "lowpass"
      ? {
          b0: ((1 - cos) / 2) / a0,
          b1: (1 - cos) / a0,
          b2: ((1 - cos) / 2) / a0,
          a1: (-2 * cos) / a0,
          a2: (1 - alpha) / a0,
        }
      : {
          b0: ((1 + cos) / 2) / a0,
          b1: -(1 + cos) / a0,
          b2: ((1 + cos) / 2) / a0,
          a1: (-2 * cos) / a0,
          a2: (1 - alpha) / a0,
        };
  return audio.map((ch) => Float32Array.from(filtfilt(c, Float64Array.from(ch))));
}

function filtfilt(c: Biquad, x: Float64Array): Float64Array {
  const n = x.length;
  if (n < 2) return x.slice();
  // scipy's padlen for a single second-order section with no trailing zero
  // coefficients: 3 * (2 * n_sections + 1).
  const pad = Math.min(9, n - 1);
  const ext = oddExtend(x, pad);
  const fwd = biquadWithInitial(c, ext);
  const back = biquadWithInitial(c, reverseArray(fwd));
  const un = reverseArray(back);
  return un.subarray(pad, pad + n).slice();
}

function oddExtend(x: Float64Array, pad: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n + 2 * pad);
  for (let i = 0; i < n; i++) out[pad + i] = x[i];
  for (let i = 0; i < pad; i++) {
    out[i] = 2 * x[0] - x[pad - i];
    out[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i];
  }
  return out;
}

function reverseArray(x: Float64Array): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0, j = x.length - 1; i < x.length; i++, j--) out[i] = x[j];
  return out;
}

/**
 * Biquad seeded with the step-response steady state scaled by x[0], the
 * equivalent of scipy's `lfilter_zi * x[0]`. Without it every pass would start
 * from silence and filtfilt would ring at both edges.
 */
function biquadWithInitial(c: Biquad, x: Float64Array): Float64Array {
  const gain = (c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2);
  let s2 = (c.b2 - c.a2 * gain) * x[0];
  let s1 = (c.b1 - c.a1 * gain) * x[0] + s2;
  const y = new Float64Array(x.length);
  for (let n = 0; n < x.length; n++) {
    const xn = x[n];
    const yn = c.b0 * xn + s1;
    s1 = c.b1 * xn - c.a1 * yn + s2;
    s2 = c.b2 * xn - c.a2 * yn;
    y[n] = yn;
  }
  return y;
}

export function highpass(audio: Audio, sampleRate: number, cutoffHz: number): Audio {
  return filterAudio(audio, sampleRate, cutoffHz, "highpass");
}

export function lowpass(audio: Audio, sampleRate: number, cutoffHz: number): Audio {
  return filterAudio(audio, sampleRate, cutoffHz, "lowpass");
}
