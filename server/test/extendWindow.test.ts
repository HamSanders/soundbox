import { describe, expect, it } from "vitest";

import { concatAudio, frameCount, trimRange, type Audio } from "../src/audio/dsp.js";

/**
 * The windowing arithmetic behind `KonchiService.extendWindowed`.
 *
 * The service method itself needs a loaded model and a child process, so what
 * is pinned here is the part that decides how many passes to run and where the
 * seams land — the part that silently produces a clip of the wrong length if
 * it is wrong.
 *
 * The audio assertions stand in for the property the whole approach rests on:
 * a repaint past the end of its input returns that input unchanged, so the new
 * material can be spliced onto the source with no crossfade and no drift in
 * position.
 */

const RATE = 1000;

/**
 * A ramp, so any splice error shows up as a discontinuity in the values.
 *
 * Scaled down to sample range on purpose: at a magnitude of 60 a float32 can
 * only resolve steps of about 4e-6, which is coarser than the seam this is
 * meant to detect. Keeping the values where real audio lives keeps the
 * tolerance meaningful.
 */
const STEP = 1 / (RATE * 100);

function ramp(fromS: number, toS: number): Audio {
  const frames = Math.round((toS - fromS) * RATE);
  return [Float32Array.from({ length: frames }, (_, i) => (fromS + i / RATE) / 100)];
}

/** What a windowed pass does: hand back the tail unchanged, then new audio. */
function fakePass(tail: Audio, wantS: number): Audio {
  const tailS = frameCount(tail) / RATE;
  const newS = wantS - tailS;
  const last = tail[0][tail[0].length - 1];
  const fresh = [Float32Array.from({ length: Math.round(newS * RATE) }, (_, i) => last + (i + 1) * STEP)];
  return concatAudio([tail, fresh], RATE);
}

function windowedExtend(source: Audio, targetS: number, capS: number, windowS: number): Audio {
  const stride = capS - windowS;
  let take = source;
  for (let pass = 0; pass < 100; pass += 1) {
    const haveS = frameCount(take) / RATE;
    if (haveS >= targetS - 0.001) break;
    const tail = trimRange(take, RATE, haveS - windowS, haveS);
    const wantS = Math.min(capS, windowS + (targetS - haveS));
    const result = fakePass(tail, wantS);
    take = concatAudio([take, trimRange(result, RATE, windowS, Number.MAX_SAFE_INTEGER)], RATE);
    if (stride <= 0) break;
  }
  const haveS = frameCount(take) / RATE;
  return haveS > targetS + 0.001 ? trimRange(take, RATE, 0, targetS) : take;
}

describe("windowed extend", () => {
  it("passes the cap a clip that is already at it", () => {
    // The case the whole thing exists for: 60s source, 60s model, +30s wanted.
    const out = windowedExtend(ramp(0, 60), 90, 60, 30);
    expect(frameCount(out) / RATE).toBeCloseTo(90, 2);
  });

  it("keeps the source untouched at the head of the result", () => {
    const source = ramp(0, 60);
    const out = windowedExtend(source, 90, 60, 30);
    for (let i = 0; i < frameCount(source); i += 997) {
      expect(out[0][i]).toBeCloseTo(source[0][i], 6);
    }
  });

  it("joins without a discontinuity", () => {
    const out = windowedExtend(ramp(0, 60), 90, 60, 30);
    // The seam sits at the source's end. A splice off by even one frame shows
    // up as a step in a ramp.
    for (let i = 1; i < frameCount(out); i += 1) {
      expect(out[0][i] - out[0][i - 1]).toBeCloseTo(STEP, 7);
    }
  });

  it("runs as many passes as the stride requires", () => {
    // 60s source, 60s cap, 30s window → 30s of new audio per pass.
    expect(frameCount(windowedExtend(ramp(0, 60), 75, 60, 30)) / RATE).toBeCloseTo(75, 2);
    expect(frameCount(windowedExtend(ramp(0, 60), 150, 60, 30)) / RATE).toBeCloseTo(150, 2);
  });

  it("trades stride for context, and both fit one generation", () => {
    // A longer window means fewer new seconds per pass, never a longer render.
    for (const window of [15, 30, 45]) {
      const out = windowedExtend(ramp(0, 60), 120, 60, window);
      expect(frameCount(out) / RATE).toBeCloseTo(120, 2);
    }
  });

  it("does not overshoot the requested length", () => {
    // The last pass would naturally produce a full stride; the result is
    // trimmed back to what was asked for.
    const out = windowedExtend(ramp(0, 60), 65, 60, 30);
    expect(frameCount(out) / RATE).toBeCloseTo(65, 2);
  });
});
