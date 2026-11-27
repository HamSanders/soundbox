import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";

/**
 * Putting a removed lane back where it was.
 *
 * Removing a lane slides the lanes above it down. Undo has to open the gap
 * again before the lane's clips can be recreated on it, or they would land on
 * top of the lane that slid into its place.
 */

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "soundbox-track-insert-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function newStory(): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/stories", payload: { title: "Lanes" } });
  expect(res.statusCode).toBeLessThan(300);
  return res.json().id;
}

async function addPause(storyId: string, track: number): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/stories/${storyId}/segments`,
    payload: { kind: "pause", duration_s: 1, track_index: track },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

async function lanes(storyId: string) {
  const segs = (await app.inject({ method: "GET", url: `/api/stories/${storyId}/segments` })).json() as {
    id: string;
    track_index: number;
  }[];
  const tracks = (await app.inject({ method: "GET", url: `/api/stories/${storyId}/tracks` })).json() as {
    track_index: number;
    name: string | null;
    gain_db: number;
  }[];
  return {
    clips: Object.fromEntries(segs.map((s) => [s.id, s.track_index])),
    names: Object.fromEntries(tracks.map((t) => [t.track_index, t.name])),
    tracks,
  };
}

describe("POST /api/stories/:id/tracks/:index", () => {
  it("opens a gap that undoes DELETE's renumbering", async () => {
    const id = await newStory();
    for (const [i, name] of [[1, "Beds"], [2, "Rain"], [3, "Music"]] as const) {
      const res = await app.inject({ method: "PATCH", url: `/api/stories/${id}/tracks/${i}`, payload: { name } });
      expect(res.statusCode).toBe(200);
    }
    const onBeds = await addPause(id, 1);
    const onRain = await addPause(id, 2);
    const onMusic = await addPause(id, 3);

    const del = await app.inject({ method: "DELETE", url: `/api/stories/${id}/tracks/2`, headers: { "x-soundbox": "1" } });
    expect(del.json()).toEqual({ removed_clips: 1 });
    let now = await lanes(id);
    expect(now.clips).toEqual({ [onBeds]: 1, [onMusic]: 2 });
    expect(now.names).toEqual({ 1: "Beds", 2: "Music" });

    const back = await app.inject({
      method: "POST",
      url: `/api/stories/${id}/tracks/2`,
      payload: { name: "Rain", gain_db: -6, muted: true },
    });
    expect(back.statusCode).toBe(201);
    expect(back.json()).toMatchObject({ track_index: 2, name: "Rain", gain_db: -6, muted: true });

    now = await lanes(id);
    // The lane above moved back up, and the gap is empty until its clips
    // are recreated.
    expect(now.clips).toEqual({ [onBeds]: 1, [onMusic]: 3 });
    expect(now.names).toEqual({ 1: "Beds", 2: "Rain", 3: "Music" });
    expect(onRain).toBeTruthy();
  });

  it("refuses a negative or fractional index and an unknown story", async () => {
    const id = await newStory();
    expect((await app.inject({ method: "POST", url: `/api/stories/${id}/tracks/-1`, payload: {} })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: `/api/stories/${id}/tracks/1.5`, payload: {} })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: `/api/stories/nope/tracks/1`, payload: {} })).statusCode).toBe(404);
  });
});
