/**
 * decodeWav / writeWav read and write WAV directly now, not through wavefile
 * (see dsp.ts: wavefile needed ~20x a file's size in memory). These hold the
 * new code to wavefile's own numbers, so nothing a user already has decodes or
 * re-encodes differently.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import wavefile from "wavefile";
import { afterAll, describe, expect, it } from "vitest";

import { decodeWav, encodeWav24, readWav, writeWav } from "../src/audio/dsp.js";

const { WaveFile } = wavefile;
const dir = mkdtempSync(join(tmpdir(), "wav-codec-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** What decodeWav returned when it was wavefile. */
function wavefileDecode(bytes: Buffer) {
  const wav = new WaveFile();
  wav.fromBuffer(bytes);
  wav.toBitDepth("32f");
  const fmt = wav.fmt as { numChannels: number; sampleRate: number };
  const raw = wav.getSamples(false) as unknown as Float64Array | Float64Array[];
  const chans = fmt.numChannels === 1 ? [raw as Float64Array] : (raw as Float64Array[]);
  return { audio: chans.map((c) => Float32Array.from(c)), sampleRate: fmt.sampleRate };
}

/** What writeWav wrote when it was wavefile. */
function wavefileEncode(audio: Float32Array[], rate: number): Buffer {
  const wav = new WaveFile();
  const chans = audio.map((c) => Array.from(c));
  wav.fromScratch(audio.length, rate, "32f", chans.length === 1 ? chans[0] : chans);
  wav.toBitDepth("24");
  return Buffer.from(wav.toBuffer());
}

/** A few seconds' worth of awkward values: extremes, zero, and noise. */
function signal(frames: number, seed: number): Float32Array {
  const out = new Float32Array(frames);
  let x = seed;
  for (let i = 0; i < frames; i++) {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    out[i] = (x / 2 ** 30 - 1) * 0.999;
  }
  out.set([1, -1, 0, 0.5, -0.5, 1 / 3, -1 / 3], 0);
  return out;
}

function fromWavefile(channels: number, rate: number, depth: string, data: Float32Array[]): Buffer {
  const wav = new WaveFile();
  // Integer depths want integer samples: scale the float signal the way a
  // writer of that depth would.
  const scaled = data.map((ch) => {
    if (depth === "32f" || depth === "64") return Array.from(ch);
    const bits = Number(depth);
    const max = 2 ** (bits - 1) - 1;
    return Array.from(ch, (v) => {
      const s = Math.round(v * max);
      return bits === 8 ? s + 128 : s;
    });
  });
  wav.fromScratch(channels, rate, depth, channels === 1 ? scaled[0] : scaled);
  return Buffer.from(wav.toBuffer());
}

describe("decodeWav", () => {
  for (const depth of ["8", "16", "24", "32", "32f", "64"]) {
    for (const channels of [1, 2]) {
      it(`matches wavefile for ${depth}-bit, ${channels} channel(s)`, () => {
        const data = Array.from({ length: channels }, (_, c) => signal(4096, 7 + c));
        const bytes = fromWavefile(channels, 44_100, depth, data);
        const ours = decodeWav(bytes);
        const theirs = wavefileDecode(bytes);
        expect(ours.sampleRate).toBe(theirs.sampleRate);
        expect(ours.audio.length).toBe(theirs.audio.length);
        // Exactly equal, except 32-bit integer: wavefile's own unpacking of it
        // is off by a float ulp (it read -2147483647 as -1.0000001, outside
        // [-1, 1]), so there the old numbers are matched to float precision.
        const same =
          depth === "32" ? (a: number, b: number) => Math.abs(a - b) <= 2 ** -23 : (a: number, b: number) => Object.is(a, b);
        for (let c = 0; c < channels; c++) {
          const bad = ours.audio[c].findIndex((v, i) => !same(v, theirs.audio[c][i]));
          expect(bad === -1 ? null : [bad, ours.audio[c][bad], theirs.audio[c][bad]]).toBeNull();
        }
      });
    }
  }

  it("skips chunks before the data and reads a WAV whose data size is unknown", () => {
    const pcm = Buffer.alloc(8);
    pcm.writeInt16LE(16384, 0);
    pcm.writeInt16LE(-16384, 2);
    pcm.writeInt16LE(32767, 4);
    pcm.writeInt16LE(-32768, 6);
    const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([3, 0, 0, 0]), Buffer.from("abc\0")]);
    const fmt = Buffer.alloc(24);
    fmt.write("fmt ", 0);
    fmt.writeUInt32LE(16, 4);
    fmt.writeUInt16LE(1, 8);
    fmt.writeUInt16LE(1, 10);
    fmt.writeUInt32LE(24_000, 12);
    fmt.writeUInt32LE(48_000, 16);
    fmt.writeUInt16LE(2, 20);
    fmt.writeUInt16LE(16, 22);
    const data = Buffer.concat([Buffer.from("data"), Buffer.from([0xff, 0xff, 0xff, 0xff]), pcm]);
    const head = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")]);
    const { audio, sampleRate } = decodeWav(Buffer.concat([head, list, fmt, data]));
    expect(sampleRate).toBe(24_000);
    expect(Array.from(audio[0])).toEqual([Math.fround(16384 / 32767), -0.5, 1, -1]);
  });
});

describe("writeWav", () => {
  it("writes the same bytes wavefile did, mono and stereo", () => {
    for (const channels of [1, 2]) {
      const audio = Array.from({ length: channels }, (_, c) => signal(10_000, 3 + c));
      expect(encodeWav24(audio, 44_100).equals(wavefileEncode(audio, 44_100))).toBe(true);
    }
  });

  it("writes 0 for a tiny value, where wavefile wrote 8", () => {
    const tiny = [Float32Array.of(1e-14, -1e-14)];
    expect(wavefileEncode(tiny, 8000).readIntLE(44, 3)).toBe(8);
    const ours = encodeWav24(tiny, 8000);
    expect(ours.readIntLE(44, 3)).toBe(0);
    expect(ours.readIntLE(47, 3)).toBe(0);
  });

  it("clamps out-of-range samples instead of wrapping them", () => {
    const bytes = encodeWav24([Float32Array.of(1.5, -1.5, Number.NaN)], 8000);
    expect([bytes.readIntLE(44, 3), bytes.readIntLE(47, 3), bytes.readIntLE(50, 3)]).toEqual([8388607, -8388608, 0]);
  });

  it("round-trips through a file and reports the file's size", () => {
    const path = join(dir, "x.wav");
    const audio = [signal(2000, 1), signal(2000, 2)];
    const size = writeWav(path, audio, 48_000);
    expect(size).toBe(readFileSync(path).length);
    const back = readWav(path);
    expect(back.sampleRate).toBe(48_000);
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 2000; i++) expect(Math.abs(back.audio[c][i] - audio[c][i])).toBeLessThan(2e-7);
    }
  });
});
