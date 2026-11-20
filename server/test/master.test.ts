import { describe, expect, it } from "vitest";

import { type Audio, frameCount } from "../src/audio/dsp.js";
import {
  FLOOR_DB,
  edgeSilence,
  measure,
  noiseFloorDb,
  rmsDb,
  samplePeak,
  truePeakDb,
} from "../src/audio/meter.js";
import {
  ROOM_TONE_DB,
  ditherTo16,
  expand,
  fitEdges,
  limitTruePeak,
  master,
  prng,
  roomTone,
} from "../src/audio/master.js";

const RATE = 44_100;

function sine(seconds: number, amp = 1, freq = 1000, rate = RATE, phase = 0): Float32Array {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate + phase);
  return out;
}

function noise(seconds: number, amp: number, seed = 3): Float32Array {
  const rand = prng(seed);
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = amp * (rand() * 2 - 1);
  return out;
}

function join(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));

/**
 * A stand-in for narration: bursts of a modulated tone ("words") with short
 * gaps inside sentences and longer pauses between them, over a faint hiss.
 */
function narration(seconds: number, level = 0.3, hiss = 0.0005): Audio {
  const out = new Float32Array(Math.round(seconds * RATE));
  const rand = prng(11);
  let t = 0.6;
  while (t < seconds - 0.8) {
    const word = 0.18 + rand() * 0.25;
    const from = Math.round(t * RATE);
    const to = Math.min(out.length, Math.round((t + word) * RATE));
    const f = 180 + rand() * 120;
    for (let i = from; i < to; i++) {
      const x = (i - from) / (to - from);
      out[i] = level * Math.sin(Math.PI * x) * Math.sin((2 * Math.PI * f * i) / RATE) * (0.7 + 0.3 * Math.sin(i / 37));
    }
    t += word + (rand() < 0.2 ? 0.6 : 0.08);
  }
  const h = noise(seconds, hiss, 5);
  for (let i = 0; i < out.length; i++) out[i] += h[i];
  return [out];
}

describe("meter", () => {
  it("reads a full-scale sine at -3.01 dB RMS and 0 dBTP (unweighted)", () => {
    const a: Audio = [sine(2)];
    expect(rmsDb(a)).toBeCloseTo(-3.01, 1);
    expect(truePeakDb(a)).toBeCloseTo(0, 1);
  });

  it("reads a -20 dB sine as -23 dB RMS", () => {
    const a: Audio = [sine(2, 0.1)];
    expect(rmsDb(a)).toBeCloseTo(-23.01, 1);
  });

  it("finds an inter-sample peak a sample meter misses", () => {
    // fs/4 at 45 degrees: every sample lands at ±0.707 but the wave hits 1.0.
    const a: Audio = [sine(1, 1, RATE / 4, RATE, Math.PI / 4)];
    expect(20 * Math.log10(samplePeak(a))).toBeCloseTo(-3.01, 1);
    expect(truePeakDb(a)).toBeGreaterThan(-0.5);
  });

  it("reads uniform noise at its known RMS (amp / sqrt 3)", () => {
    const a: Audio = [noise(3, 0.01)];
    expect(rmsDb(a)).toBeCloseTo(20 * Math.log10(0.01 / Math.sqrt(3)), 0);
  });

  it("reads silence as the floor value, not -Infinity", () => {
    const r = measure([silence(2)], RATE);
    expect(r.rms_db).toBe(FLOOR_DB);
    expect(r.peak_dbfs).toBe(FLOOR_DB);
    expect(r.noise_floor_db).toBe(FLOOR_DB);
    expect(r.integrated_lufs).toBe(FLOOR_DB);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("takes the noise floor from the quietest 500 ms, or from given room tone", () => {
    const a: Audio = [join(noise(1, 0.001), sine(2, 0.3, 300), noise(1, 0.001))];
    const quiet = 20 * Math.log10(0.001 / Math.sqrt(3));
    expect(noiseFloorDb(a, RATE)).toBeCloseTo(quiet, 0);
    expect(noiseFloorDb(a, RATE, [{ start_s: 0, end_s: 0.9 }])).toBeCloseTo(quiet, 0);
  });

  it("measures head and tail silence", () => {
    const a: Audio = [join(silence(0.75), sine(1, 0.3, 300), silence(2.5))];
    const e = edgeSilence(a, RATE);
    expect(e.head_s).toBeCloseTo(0.75, 1);
    expect(e.tail_s).toBeCloseTo(2.5, 1);
  });

  it("reports integrated loudness through dsp", () => {
    const r = measure([sine(3, 0.1)], RATE);
    // A 1 kHz sine reads close to its RMS in LUFS (K-weighting is ~0 dB there).
    expect(r.integrated_lufs).toBeGreaterThan(-24);
    expect(r.integrated_lufs).toBeLessThan(-22);
    expect(r.sample_rate).toBe(RATE);
    expect(r.channels).toBe(1);
  });
});

describe("master building blocks", () => {
  it("room tone sits at the asked level and is never digital zero", () => {
    const bed = roomTone(RATE * 2, ROOM_TONE_DB);
    expect(rmsDb([bed])).toBeCloseTo(ROOM_TONE_DB, 1);
    expect(bed.some((v) => v === 0)).toBe(false);
  });

  it("limits true peak to the ceiling", () => {
    const hot: Audio = [sine(1, 1.5, 997)];
    const out = limitTruePeak(hot, RATE, -3.5);
    expect(truePeakDb(out)).toBeLessThanOrEqual(-3.5 + 0.01);
    // and does not crush it far below
    expect(truePeakDb(out)).toBeGreaterThan(-4.5);
  });

  it("expander pulls pauses down but leaves words at level", () => {
    const words = sine(0.5, 0.3, 300);
    const a: Audio = [join(noise(1, 0.001), words, noise(1, 0.001))];
    const out = expand(a, RATE);
    const mid = Math.round(1.25 * RATE);
    expect(Math.abs(out[0][mid] - a[0][mid])).toBeLessThan(1e-3);
    const pause = noiseFloorDb(out, RATE);
    expect(pause).toBeLessThan(noiseFloorDb(a, RATE) - 10);
  });

  it("does not chop the onset of a word (lookahead)", () => {
    const a: Audio = [join(silence(1), sine(0.5, 0.3, 300))];
    const out = expand(a, RATE);
    const onset = RATE + 5; // 5 frames into the word
    expect(Math.abs(out[0][onset])).toBeCloseTo(Math.abs(a[0][onset]), 3);
  });

  it("fits head and tail room tone and reports the shift", () => {
    const a: Audio = [join(silence(0.1), sine(1, 0.3, 300), silence(4))];
    const { audio, shiftS } = fitEdges(a, RATE, 0.75, 2);
    const e = edgeSilence(audio, RATE);
    expect(e.head_s).toBeCloseTo(0.75, 1);
    expect(e.tail_s).toBeCloseTo(2, 1);
    expect(shiftS).toBeCloseTo(0.65, 2);
  });

  it("dithers to 16-bit within one LSB", () => {
    const [q] = ditherTo16([sine(0.1, 0.5)]);
    const src = sine(0.1, 0.5);
    let worst = 0;
    for (let i = 0; i < q.length; i++) worst = Math.max(worst, Math.abs(q[i] / 32767 - src[i]));
    expect(worst).toBeLessThan(2 / 32767);
  });
});

describe("master presets", () => {
  const pacing = { head_room_tone_s: 0.75, tail_room_tone_s: 2 };

  it("acx: mono, 44.1 kHz, RMS in -23..-18 (near -20), peak <= -3, floor <= -60, room tone", () => {
    // Stereo at 24 kHz, too quiet, with digital-zero edges: a typical TTS mix.
    const quiet = narration(20, 0.05, 0)[0];
    const stereo24k = [quiet, quiet].map((ch) => {
      const n = Math.round((ch.length * 24_000) / RATE);
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++) o[i] = ch[Math.floor((i * RATE) / 24_000)];
      return o;
    });
    const out = master(stereo24k, 24_000, "acx", pacing);
    const r = measure(out.audio, out.sampleRate);
    expect(out.sampleRate).toBe(44_100);
    expect(r.channels).toBe(1);
    expect(r.rms_db).toBeGreaterThanOrEqual(-23);
    expect(r.rms_db).toBeLessThanOrEqual(-18);
    expect(Math.abs(r.rms_db + 20)).toBeLessThan(0.5);
    expect(r.peak_dbfs).toBeLessThanOrEqual(-3);
    expect(r.noise_floor_db).toBeLessThanOrEqual(-60);
    expect(r.noise_floor_db).toBeGreaterThan(-80); // room tone, not digital zero
    expect(r.head_silence_s).toBeGreaterThanOrEqual(0.5);
    expect(r.head_silence_s).toBeLessThanOrEqual(1);
    expect(r.tail_silence_s).toBeGreaterThanOrEqual(1);
    expect(r.tail_silence_s).toBeLessThanOrEqual(5);
  });

  it("acx: a hissy recording's floor is brought under -60", () => {
    const out = master(narration(15, 0.3, 0.01), RATE, "acx", pacing);
    const r = measure(out.audio, out.sampleRate);
    expect(r.noise_floor_db).toBeLessThanOrEqual(-60);
    expect(r.rms_db).toBeGreaterThanOrEqual(-23);
    expect(r.rms_db).toBeLessThanOrEqual(-18);
  });

  it("podcast: -16 LUFS, -1 dBTP, channels kept", () => {
    const n = narration(15, 0.05, 0)[0];
    const out = master([n, n], RATE, "podcast");
    const r = measure(out.audio, out.sampleRate);
    expect(r.channels).toBe(2);
    expect(Math.abs(r.integrated_lufs + 16)).toBeLessThan(0.5);
    expect(r.peak_dbfs).toBeLessThanOrEqual(-1);
  });

  it("none leaves audio untouched", () => {
    const a = narration(3);
    const out = master(a, 22_050, "none");
    expect(out.audio).toBe(a);
    expect(out.sampleRate).toBe(22_050);
    expect(frameCount(out.audio)).toBe(frameCount(a));
  });
});

describe("resampleFast", () => {
  it("matches dsp.resampleAudio sample for sample", async () => {
    const { resampleAudio } = await import("../src/audio/dsp.js");
    const { resampleFast } = await import("../src/audio/master.js");
    const src: Audio = [sine(0.5, 0.5, 440, 24_000)];
    for (const [from, to] of [[24_000, 44_100], [48_000, 44_100], [22_050, 44_100]] as const) {
      const input = from === 24_000 ? src : [sine(0.5, 0.5, 440, from)];
      const a = resampleAudio(input, from, to)[0];
      const b = resampleFast(input, from, to)[0];
      expect(b.length).toBe(a.length);
      let worst = 0;
      for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
      expect(worst).toBeLessThan(1e-4);
    }
  });
});
