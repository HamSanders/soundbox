import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import * as dsp from "../src/audio/dsp.js";

/**
 * Splitting a clip that has been trimmed.
 *
 * The split point is seconds into the clip as it plays, and a trimmed clip
 * plays `duration_s` of its source from `trim_start_s`. Split used to cut the
 * source from 0 and leave the head's trim in place, so on a trimmed clip both
 * halves held audio from the wrong part of the take.
 *
 * The source here is a ramp — each sample's value is the time it sits at —
 * so reading a half's first and last samples says exactly which stretch of
 * the take it holds.
 *
 * Loudness normalisation is left at its default on purpose. The upload is
 * normalised like any import, which only rescales the ramp, so times are read
 * against the stored source's own slope. The halves must not be normalised
 * again: each would get its own gain and the level would jump at the cut.
 */

let app: FastifyInstance;
let config: Config;
let dataDir: string;
let soundId: string;
let storyId: string;
/** The source as stored in the library, after the import's normalisation. */
let source: dsp.Audio;

const RATE = 44100;
const SECONDS = 4;
/** Sample value per second of the ramp as written, kept under full scale. */
const SLOPE = 0.9 / SECONDS;

/** The source time a half's sample came from, read against the stored ramp. */
const timeAt = (audio: dsp.Audio, frame: number): number => audio[0]![frame]! / source[0]![RATE]!;

const readHalf = (id: string): dsp.Audio =>
  dsp.readWav(join(config.paths.sounds, `${id}.wav`)).audio;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "konchi-split-test-"));
  config = new Config(dataDir);
  expect(config.settings.normalize_lufs).not.toBeNull();
  app = buildApp(config, { serveUi: false });
  await app.ready();

  const ramp = new Float32Array(RATE * SECONDS);
  for (let i = 0; i < ramp.length; i++) ramp[i] = (i / RATE) * SLOPE;
  const tmp = await mkdtemp(join(tmpdir(), "konchi-split-wav-"));
  const path = join(tmp, "ramp.wav");
  dsp.writeWav(path, [ramp], RATE);
  const upload = await app.inject({
    method: "POST",
    url: "/api/sounds/upload?name=Ramp",
    headers: { "content-type": "audio/wav" },
    payload: await readFile(path),
  });
  expect(upload.statusCode).toBe(201);
  soundId = upload.json().id;
  source = readHalf(soundId);
  await rm(tmp, { recursive: true, force: true });

  const story = await app.inject({ method: "POST", url: "/api/stories", payload: { title: "Split" } });
  expect(story.statusCode).toBeLessThan(300);
  storyId = story.json().id;
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

/** A clip playing source 1s–3s of the ramp: trimmed on both edges. */
async function trimmedClip(): Promise<string> {
  const resp = await app.inject({
    method: "POST",
    url: `/api/stories/${storyId}/segments`,
    payload: {
      sound_id: soundId,
      start_s: 10,
      trim_start_s: 1,
      duration_s: 2,
      fade_in_s: 0.25,
      fade_out_s: 0.4,
      gain_db: -6,
      muted: true,
    },
  });
  expect(resp.statusCode).toBeLessThan(300);
  return resp.json().id;
}

describe("POST /api/stories/:id/segments/:id/split on a trimmed clip", () => {
  it("cuts each half from the stretch of the source the clip plays", async () => {
    const id = await trimmedClip();
    const resp = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/segments/${id}/split`,
      payload: { at_s: 0.5 },
    });
    expect(resp.statusCode).toBe(200);
    const [head, tail] = resp.json();

    // Head: source 1.0s–1.5s, a whole untrimmed sound of its own.
    const headAudio = readHalf(head.sound_id);
    expect(dsp.frameCount(headAudio)).toBe(RATE * 0.5);
    expect(timeAt(headAudio, 0)).toBeCloseTo(1, 4);
    expect(timeAt(headAudio, RATE * 0.5 - 1)).toBeCloseTo(1.5 - 1 / RATE, 4);

    // Tail: source 1.5s–3.0s, not on to the end of the take.
    const tailAudio = readHalf(tail.sound_id);
    expect(dsp.frameCount(tailAudio)).toBe(RATE * 1.5);
    expect(timeAt(tailAudio, 0)).toBeCloseTo(1.5, 4);
    expect(timeAt(tailAudio, RATE * 1.5 - 1)).toBeCloseTo(3 - 1 / RATE, 4);

    expect(head).toMatchObject({
      id,
      start_s: 10,
      trim_start_s: 0,
      duration_s: 0.5,
      fade_in_s: 0.25,
      fade_out_s: 0,
      gain_db: -6,
      muted: true,
    });
    expect(tail).toMatchObject({
      start_s: 10.5,
      trim_start_s: 0,
      duration_s: 1.5,
      fade_in_s: 0,
      fade_out_s: 0.4,
      gain_db: -6,
      muted: true,
    });
  });

  it("leaves each half at the level it had in the source", async () => {
    const id = await trimmedClip();
    const resp = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/segments/${id}/split`,
      payload: { at_s: 0.5 },
    });
    expect(resp.statusCode).toBe(200);
    const [head, tail] = resp.json();

    // Sample for sample what the clip played either side of the cut, source
    // 1.0s–1.5s and 1.5s–3.0s, with no gain of their own. Writing the 24-bit
    // file again can round a sample by one step; normalising would move every
    // sample by the half's own gain, orders of magnitude more.
    const step = 2 ** -23;
    const expectSameAs = (half: dsp.Audio, from: number, to: number) => {
      const want = source[0]!.subarray(from * RATE, to * RATE);
      const got = half[0]!;
      expect(got.length).toBe(want.length);
      let worst = 0;
      for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(got[i]! - want[i]!));
      expect(worst).toBeLessThanOrEqual(step);
    };
    expectSameAs(readHalf(head.sound_id), 1, 1.5);
    expectSameAs(readHalf(tail.sound_id), 1.5, 3);
  });

  it("refuses a cut past the clip's trimmed right edge", async () => {
    const id = await trimmedClip();
    // Inside the source (4s) but past the 2s the clip plays.
    const resp = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/segments/${id}/split`,
      payload: { at_s: 2.5 },
    });
    expect(resp.statusCode).toBeGreaterThanOrEqual(400);
    expect(resp.statusCode).toBeLessThan(500);
  });
});
