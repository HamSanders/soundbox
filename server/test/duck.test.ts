/**
 * Ducking: the bed drops under narration and recovers after it, with the
 * attack, release, lookahead and hold it was asked for. Sine and silence
 * fixtures only.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DUCK,
  applyDucking,
  duckAutomation,
  duckTarget,
  duckingEnvelope,
  resolveDuck,
} from "../src/audio/duck.js";
import type { Audio } from "../src/audio/dsp.js";

const SR = 8000;

function tone(seconds: number, amp = 0.5, hz = 220): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

/** Narration: silence, then speech from `from` to `to`, over `total` seconds. */
function speech(total: number, from: number, to: number): Audio {
  const out = new Float32Array(Math.round(total * SR));
  out.set(tone(to - from), Math.round(from * SR));
  return [out];
}

function rmsDb(channel: Float32Array, fromS: number, toS: number): number {
  const a = Math.round(fromS * SR);
  const b = Math.round(toS * SR);
  let sum = 0;
  for (let i = a; i < b; i++) sum += channel[i] * channel[i];
  return 10 * Math.log10(sum / (b - a));
}

describe("resolveDuck", () => {
  it("fills defaults and clamps negatives", () => {
    const o = resolveDuck({ depth_db: -3, attack_ms: Number.NaN, release_ms: 100 });
    expect(o.depth_db).toBe(0);
    expect(o.attack_ms).toBe(DEFAULT_DUCK.attack_ms);
    expect(o.release_ms).toBe(100);
  });
});

describe("duckTarget", () => {
  const opts = resolveDuck({ hold_ms: 30, lookahead_ms: 20 });
  it("bridges gaps up to the hold and shifts earlier by the lookahead", () => {
    // blocks: speech at 5-6, gap of 3 (bridged), speech at 10, gap of 5, speech at 16
    const s = new Uint8Array(20);
    s[5] = s[6] = s[10] = s[16] = 1;
    const t = Array.from(duckTarget(s, opts));
    // 3..10 ducked (lookahead 2 before 5, gap 7-9 bridged), 14..16 ducked
    expect(t).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0]);
  });
});

describe("duckingEnvelope", () => {
  it("reaches full depth as speech starts when lookahead equals attack", () => {
    const env = duckingEnvelope(speech(3, 1, 2), SR, 3 * SR, {
      depth_db: 12,
      attack_ms: 200,
      lookahead_ms: 200,
      release_ms: 300,
      hold_ms: 0,
    });
    const at = (s: number) => env[Math.round(s / 0.01)];
    expect(at(0.5)).toBe(0);
    expect(at(0.8)).toBeCloseTo(0, 5); // ramp begins here
    expect(at(0.9)).toBeCloseTo(-6, 4); // halfway down
    expect(at(1.0)).toBeCloseTo(-12, 4);
    expect(at(1.5)).toBeCloseTo(-12, 4);
    expect(at(2.15)).toBeCloseTo(-6, 0); // halfway back up
    expect(at(2.5)).toBe(0);
  });

  it("is flat with zero depth", () => {
    const env = duckingEnvelope(speech(1, 0.2, 0.6), SR, SR, { depth_db: 0 });
    expect(env.every((v) => v === 0)).toBe(true);
  });

  it("ignores narration below the threshold", () => {
    const quiet: Audio = [tone(1, 0.001)]; // about -63 dBFS RMS
    const env = duckingEnvelope(quiet, SR, SR, { threshold_db: -45 });
    expect(env.every((v) => v === 0)).toBe(true);
  });
});

describe("applyDucking", () => {
  it("drops the bed by the depth under speech and leaves it alone elsewhere", () => {
    const bed: Audio = [tone(4, 0.3, 110), tone(4, 0.3, 110)];
    const out = applyDucking(bed, speech(4, 1, 3), {
      sampleRate: SR,
      depth_db: 10,
      attack_ms: 100,
      release_ms: 100,
      lookahead_ms: 100,
      hold_ms: 0,
    });
    expect(out).toHaveLength(2);
    expect(out[0]).not.toBe(bed[0]);
    const before = rmsDb(bed[0], 1.2, 2.8);
    expect(rmsDb(out[0], 1.2, 2.8) - before).toBeCloseTo(-10, 1);
    expect(rmsDb(out[1], 1.2, 2.8) - before).toBeCloseTo(-10, 1);
    expect(rmsDb(out[0], 0.1, 0.8) - rmsDb(bed[0], 0.1, 0.8)).toBeCloseTo(0, 3);
    expect(rmsDb(out[0], 3.3, 3.9) - rmsDb(bed[0], 3.3, 3.9)).toBeCloseTo(0, 3);
  });

  it("treats a narration shorter than the bed as silence past its end", () => {
    const bed: Audio = [tone(2, 0.3, 110)];
    const out = applyDucking(bed, speech(0.5, 0, 0.5), { sampleRate: SR, hold_ms: 0, release_ms: 100 });
    expect(rmsDb(out[0], 1.2, 1.9) - rmsDb(bed[0], 1.2, 1.9)).toBeCloseTo(0, 3);
  });

  it("returns an empty bed unchanged", () => {
    expect(applyDucking([new Float32Array(0)], speech(1, 0, 1), { sampleRate: SR })[0]).toHaveLength(0);
  });
});

describe("duckAutomation", () => {
  const opts = { depth_db: 12, attack_ms: 200, release_ms: 500, lookahead_ms: 200, hold_ms: 300 };

  it("ramps down before each clip and back up after it", () => {
    expect(duckAutomation([{ start_s: 2, end_s: 5 }], opts)).toEqual([
      { time_s: 1.8, gain_db: 0 },
      { time_s: 2, gain_db: -12 },
      { time_s: 5, gain_db: -12 },
      { time_s: 5.5, gain_db: 0 },
    ]);
  });

  it("merges clips whose gap is inside the hold or the release", () => {
    const pts = duckAutomation(
      [
        { start_s: 6, end_s: 7 },
        { start_s: 1, end_s: 2 },
        { start_s: 2.2, end_s: 3 }, // inside hold
        { start_s: 3.6, end_s: 4 }, // ramps would collide
      ],
      opts,
    );
    expect(pts.map((p) => p.time_s)).toEqual([0.8, 1, 4, 4.5, 5.8, 6, 7, 7.5]);
  });

  it("clips a ramp that would start before zero", () => {
    const pts = duckAutomation([{ start_s: 0.1, end_s: 1 }], opts);
    expect(pts[0]).toEqual({ time_s: 0, gain_db: 0 });
    expect(pts[1].time_s).toBeCloseTo(0.1, 9);
  });

  it("is empty with zero depth", () => {
    expect(duckAutomation([{ start_s: 0, end_s: 1 }], { depth_db: 0 })).toEqual([]);
  });
});
