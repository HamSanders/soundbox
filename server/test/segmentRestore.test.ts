import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import * as dsp from "../src/audio/dsp.js";

/**
 * Putting a clip back exactly as it was.
 *
 * The studio's undo for a delete, and its duplicate, both recreate a clip with
 * one `POST /segments`. When create only took text, place and sound, an undone
 * delete came back untrimmed, unfaded and at unity gain, and a long music clip
 * could not come back at all — create capped `duration_s` at a pause's 60s.
 */

let app: FastifyInstance;
let dataDir: string;
let soundId: string;
let storyId: string;

const RATE = 44100;
const SECONDS = 4;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "konchi-restore-test-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();

  const tmp = await mkdtemp(join(tmpdir(), "konchi-restore-wav-"));
  const path = join(tmp, "clip.wav");
  dsp.writeWav(path, [new Float32Array(RATE * SECONDS)], RATE);
  const upload = await app.inject({
    method: "POST",
    url: "/api/sounds/upload?name=Clip",
    headers: { "content-type": "audio/wav" },
    payload: await readFile(path),
  });
  expect(upload.statusCode).toBe(201);
  soundId = upload.json().id;
  await rm(tmp, { recursive: true, force: true });

  const story = await app.inject({ method: "POST", url: "/api/stories", payload: { title: "Restore" } });
  expect(story.statusCode).toBeLessThan(300);
  storyId = story.json().id;
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("POST /api/stories/:id/segments with clip state", () => {
  it("keeps trim, fades, gain and mute", async () => {
    const resp = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/segments`,
      payload: {
        sound_id: soundId,
        start_s: 1,
        trim_start_s: 0.5,
        duration_s: 2,
        fade_in_s: 0.25,
        fade_out_s: 0.75,
        gain_db: -6,
        muted: true,
      },
    });
    expect(resp.statusCode).toBeLessThan(300);
    const seg = resp.json();
    expect(seg).toMatchObject({
      sound_id: soundId,
      start_s: 1,
      trim_start_s: 0.5,
      duration_s: 2,
      fade_in_s: 0.25,
      fade_out_s: 0.75,
      gain_db: -6,
      muted: true,
    });
  });

  it("never plays more of the sound than there is past the trim", async () => {
    const resp = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/segments`,
      payload: { sound_id: soundId, trim_start_s: 3, duration_s: 10 },
    });
    expect(resp.statusCode).toBeLessThan(300);
    expect(resp.json().duration_s).toBeCloseTo(SECONDS - 3, 3);
  });

  it("still plays the whole sound when no duration is given", async () => {
    const resp = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/segments`,
      payload: { sound_id: soundId },
    });
    expect(resp.json().duration_s).toBeCloseTo(SECONDS, 3);
    expect(resp.json().muted).toBe(false);
    expect(resp.json().gain_db).toBe(0);
  });
});
