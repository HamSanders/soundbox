/**
 * Tempo and key from decoded audio, entirely in the browser. Nothing is
 * uploaded.
 *
 * Tempo: an onset-strength envelope (half-wave-rectified spectral flux at
 * ~86 frames a second), autocorrelated over 60–200 BPM, folded into 70–180
 * with a gentle preference for the 100–140 middle, then refined by parabolic
 * interpolation around the peak.
 *
 * Key: a 12-bin chroma profile summed over the track (linear-magnitude spectra,
 * 55 Hz–2 kHz, pitch class from each bin's frequency), correlated with the
 * Krumhansl–Kessler major and minor key profiles in all 24 rotations.
 *
 * Both are textbook methods written from scratch here (no AGPL Essentia), so
 * expect them to be less sure than a trained model on unusual material; the
 * result carries a confidence the page shows.
 */

export interface Analysis {
  bpm: number;
  /** Half- or double-time reading, when it is also inside 70–180 (e.g. 87 for 174). */
  bpmAlt: number | null;
  bpmConfidence: number;
  key: string;
  mode: "major" | "minor";
  keyConfidence: number;
  /** The relative key, e.g. "A minor" for C major. */
  relative: string;
  /** Camelot wheel code, e.g. "8B" for C major. */
  camelot: string;
}

const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
// Krumhansl & Kessler (1982) probe-tone profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
// Camelot numbers by tonic pitch class.
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

const FFT_SIZE = 4096;

/** In-place radix-2 FFT on (re, im). */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Mono mix of the channels. */
export function mixDown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const out = new Float32Array(channels[0]!.length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i]! += ch[i]! / channels.length;
  return out;
}

/** Halve the rate (simple 2-tap average) until it's at or under 24 kHz. */
function decimate(x: Float32Array, rate: number): { x: Float32Array; rate: number } {
  while (rate > 24000) {
    const y = new Float32Array(Math.floor(x.length / 2));
    for (let i = 0; i < y.length; i++) y[i] = 0.5 * (x[2 * i]! + x[2 * i + 1]!);
    x = y;
    rate /= 2;
  }
  return { x, rate };
}

function correlate(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function analyze(samples: Float32Array, sampleRate: number): Analysis {
  const { x, rate } = decimate(samples, sampleRate);
  const hop = Math.round(rate / 86); // ~86 frames/s
  const frames = Math.max(0, Math.floor((x.length - FFT_SIZE) / hop));
  const window = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);

  const half = FFT_SIZE / 2;
  const binHz = rate / FFT_SIZE;
  const lo = Math.ceil(55 / binHz);
  const hi = Math.min(half - 1, Math.floor(2000 / binHz));
  const pc = new Int8Array(half).fill(-1);
  for (let k = lo; k <= hi; k++) {
    const midi = 69 + 12 * Math.log2((k * binHz) / 440);
    pc[k] = ((Math.round(midi) % 12) + 12) % 12;
  }

  const chroma = new Array<number>(12).fill(0);
  const flux = new Float32Array(frames);
  let prev = new Float32Array(half);
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = x[off + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(half);
    let d = 0;
    for (let k = 1; k < half; k++) {
      const m = Math.log1p(100 * Math.hypot(re[k]!, im[k]!));
      mag[k] = m;
      const diff = m - prev[k]!;
      if (diff > 0) d += diff;
    }
    // Chroma from spectral peaks only, on linear magnitude: a Hann main lobe spans
    // more than a semitone below ~200 Hz at this resolution, so counting every bin
    // smears a note into its neighbours; log magnitude flattens the tonic-vs-passing
    // contrast that tells a key from its relative.
    for (let k = lo; k <= hi; k++) {
      const v = Math.hypot(re[k]!, im[k]!);
      if (v > Math.hypot(re[k - 1]!, im[k - 1]!) && v >= Math.hypot(re[k + 1]!, im[k + 1]!)) chroma[pc[k]!]! += v;
    }
    flux[f] = d;
    prev = mag;
  }

  // ── tempo ──
  const fps = rate / hop;
  let mean = 0;
  for (const v of flux) mean += v;
  mean /= flux.length || 1;
  const env = Array.from(flux, (v) => Math.max(0, v - mean));
  const lagFor = (bpm: number) => (60 * fps) / bpm;
  const minLag = Math.floor(lagFor(200));
  const maxLag = Math.ceil(lagFor(60));
  const ac: number[] = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i]! * env[i + lag]!;
    ac.push(s / Math.max(1, env.length - lag));
  }
  let best = minLag;
  let bestScore = -Infinity;
  let total = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    // Log-Gaussian preference centred on 120 BPM, so octave errors lean to the usual range.
    const weight = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const score = ac[lag]! * weight;
    total += Math.max(0, score);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  const a = ac[best - 1] ?? ac[best]!;
  const b = ac[best]!;
  const c = ac[best + 1] ?? ac[best]!;
  const denom = a - 2 * b + c;
  const refined = denom !== 0 ? best + (0.5 * (a - c)) / denom : best;
  let bpm = (60 * fps) / refined;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  const span = maxLag - minLag + 1;
  const bpmConfidence = total > 0 ? Math.min(1, (bestScore / (total / span)) / 6) : 0;

  // ── key ──
  const scores: { tonic: number; mode: "major" | "minor"; r: number }[] = [];
  for (let t = 0; t < 12; t++) {
    const rot = (p: number[]) => p.map((_, i) => p[(i - t + 12) % 12]!);
    scores.push({ tonic: t, mode: "major", r: correlate(chroma, rot(MAJOR)) });
    scores.push({ tonic: t, mode: "minor", r: correlate(chroma, rot(MINOR)) });
  }
  scores.sort((p, q) => q.r - p.r);
  const top = scores[0]!;
  const keyConfidence = Math.max(0, Math.min(1, (top.r - scores[1]!.r) * 4 + top.r * 0.5));
  const relTonic = top.mode === "major" ? (top.tonic + 9) % 12 : (top.tonic + 3) % 12;
  const camelot = top.mode === "major" ? `${CAMELOT_MAJOR[top.tonic]}B` : `${CAMELOT_MINOR[top.tonic]}A`;

  const alt = bpm * 2 <= 180 ? bpm * 2 : bpm / 2 >= 70 ? bpm / 2 : null;
  return {
    bpm: Math.round(bpm * 10) / 10,
    bpmAlt: alt === null ? null : Math.round(alt * 10) / 10,
    bpmConfidence,
    key: NAMES[top.tonic]!,
    mode: top.mode,
    keyConfidence,
    relative: `${NAMES[relTonic]} ${top.mode === "major" ? "minor" : "major"}`,
    camelot,
  };
}
