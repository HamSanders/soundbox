import { describe, expect, it } from "vitest";

import { analyze } from "./analyze";

const RATE = 22050;

/**
 * A drum-ish click track at `bpm` plus sustained notes, `seconds` long. The first
 * three notes (the tonic triad) are louder than the rest (passing tones), as in music.
 */
function synth(bpm: number, notes: number[], seconds = 20): Float32Array {
  const x = new Float32Array(RATE * seconds);
  const beat = (60 / bpm) * RATE;
  for (let n = 0; n * beat < x.length; n++) {
    const start = Math.round(n * beat);
    for (let i = 0; i < 800 && start + i < x.length; i++) {
      x[start + i]! += 0.8 * Math.exp(-i / 120) * (Math.random() * 2 - 1);
    }
  }
  notes.forEach((m, j) => {
    const f = 440 * 2 ** ((m - 69) / 12);
    const amp = j < 3 ? 0.1 : 0.03;
    for (let i = 0; i < x.length; i++) x[i]! += amp * Math.sin((2 * Math.PI * f * i) / RATE);
  });
  return x;
}

describe("analyze", () => {
  it.each([90, 120, 128, 140, 174])("finds %d BPM", (bpm) => {
    const r = analyze(synth(bpm, [60, 64, 67]), RATE);
    // Half- or double-time is an accepted reading, shown as the alternative.
    const hit = [r.bpm, r.bpmAlt ?? -1].some((v) => Math.abs(v - bpm) < 2);
    expect(hit).toBe(true);
  });

  it("finds C major from a C major triad and scale tones", () => {
    const r = analyze(synth(120, [48, 64, 67, 62, 65, 69, 71]), RATE);
    expect(`${r.key} ${r.mode}`).toBe("C major");
    expect(r.camelot).toBe("8B");
    expect(r.relative).toBe("A minor");
  });

  it("finds A minor from an A minor triad", () => {
    const r = analyze(synth(100, [45, 60, 64, 59, 62, 65, 67]), RATE);
    expect(`${r.key} ${r.mode}`).toBe("A minor");
    expect(r.camelot).toBe("8A");
  });

  it("decimates 44.1 kHz input without changing the answer", () => {
    const x = synth(128, [55, 59, 62, 64, 66, 69, 72], 15);
    const up = new Float32Array(x.length * 2);
    for (let i = 0; i < x.length; i++) up[2 * i] = up[2 * i + 1] = x[i]!;
    const r = analyze(up, RATE * 2);
    expect(Math.abs(r.bpm - 128)).toBeLessThan(2);
    expect(`${r.key} ${r.mode}`).toBe("G major");
  });
});
