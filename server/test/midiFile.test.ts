/**
 * The studio's `.mid` export, read back by its own import.
 *
 * `writeMidiFile` and `parseMidiFile` live in the app (`app/src/lib/midi.ts`);
 * vitest.config.ts maps the app's `@/` alias so they load here. A take that
 * survives export and import unchanged, to within one tick, is a take another
 * tool will read the same way.
 */

import { describe, expect, it } from "vitest";

import { parseMidiFile, writeMidiFile } from "@/lib/midi";
import type { MidiNote } from "@/lib/midi";

const bytes = (file: Uint8Array): ArrayBuffer =>
  file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;

const byStart = (a: MidiNote, b: MidiNote): number => a.start_s - b.start_s || a.note - b.note;

describe("writeMidiFile", () => {
  const take: MidiNote[] = [
    { note: 60, velocity: 0.8, start_s: 0, duration_s: 0.5 },
    { note: 64, velocity: 0.55, start_s: 0, duration_s: 0.5 },
    { note: 67, velocity: 1, start_s: 0.513, duration_s: 1.27 },
    { note: 72, velocity: 0.1, start_s: 2.001, duration_s: 0.25 },
    // A repeat of the same pitch straight after its first strike.
    { note: 72, velocity: 0.9, start_s: 2.25, duration_s: 0.6 },
  ];

  for (const bpm of [100, 133, 60]) {
    it(`round-trips a take at ${bpm} bpm within a tick`, () => {
      const ppq = 480;
      // One tick, plus float slack: each end rounds by half a tick.
      const tick = 60 / bpm / ppq + 1e-9;
      const back = parseMidiFile(bytes(writeMidiFile(take, bpm, ppq))).sort(byStart);
      const want = [...take].sort(byStart);

      expect(back).toHaveLength(want.length);
      back.forEach((n, i) => {
        const w = want[i]!;
        expect(n.note).toBe(w.note);
        expect(Math.abs(n.start_s - w.start_s)).toBeLessThanOrEqual(tick);
        expect(Math.abs(n.duration_s - w.duration_s)).toBeLessThanOrEqual(tick);
        // Velocity goes through a 0-127 byte.
        expect(Math.abs(n.velocity - w.velocity)).toBeLessThanOrEqual(1 / 127);
      });
    });
  }

  it("writes a format 0 header and the tempo as a meta event", () => {
    const file = writeMidiFile(take, 120, 480);
    const view = new DataView(bytes(file));
    expect(String.fromCharCode(...file.slice(0, 4))).toBe("MThd");
    expect(view.getUint16(8)).toBe(0);
    expect(view.getUint16(10)).toBe(1);
    expect(view.getUint16(12)).toBe(480);
    // Delta 0, FF 51 03, then 500000 µs per beat for 120 bpm.
    expect([...file.slice(22, 29)]).toEqual([0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]);
  });

  it("cuts an overlapping same-pitch note at the next strike", () => {
    const overlapping: MidiNote[] = [
      { note: 60, velocity: 0.5, start_s: 0, duration_s: 2 },
      { note: 60, velocity: 0.5, start_s: 1, duration_s: 1 },
    ];
    const back = parseMidiFile(bytes(writeMidiFile(overlapping, 120))).sort(byStart);
    expect(back).toHaveLength(2);
    expect(back[0]!.duration_s).toBeCloseTo(1, 3);
    expect(back[1]!.start_s).toBeCloseTo(1, 3);
  });
});
