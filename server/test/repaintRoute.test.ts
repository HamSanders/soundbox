import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import * as dsp from "../src/audio/dsp.js";

/**
 * `POST /api/repaint` — the editor's Repaint tool, which sends a highlighted
 * range and nothing else.
 *
 * What is pinned here is everything the route refuses before it starts a
 * render, because that is the whole point of refusing it here: a bad window
 * has to fail on the click rather than minutes into a model load. The happy
 * path needs a repaint-capable model installed, which a test box does not
 * have, so the last test asserts the order instead — the window is checked
 * against the clip before the catalogue is consulted at all.
 */

let app: FastifyInstance;
let dataDir: string;
let soundId: string;

const RATE = 44100;
const SECONDS = 4;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "konchi-repaint-test-"));
  const config = new Config(dataDir);
  app = buildApp(config, { serveUi: false });
  await app.ready();

  const tmp = await mkdtemp(join(tmpdir(), "konchi-repaint-wav-"));
  const path = join(tmp, "clip.wav");
  const audio = [
    Float32Array.from({ length: RATE * SECONDS }, (_, i) => Math.sin((i / RATE) * 440 * 2 * Math.PI) * 0.2),
  ];
  dsp.writeWav(path, audio, RATE);
  const resp = await app.inject({
    method: "POST",
    url: "/api/sounds/upload?name=Clip",
    headers: { "content-type": "audio/wav" },
    payload: await readFile(path),
  });
  expect(resp.statusCode).toBe(201);
  soundId = resp.json().id;
  await rm(tmp, { recursive: true, force: true });
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("POST /api/repaint", () => {
  it("422s on a window that is not a window", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/repaint",
      payload: { source_sound_id: soundId, start_s: 2, end_s: 2 },
    });
    expect(resp.statusCode).toBe(422);
  });

  it("400s on an unknown source sound", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/repaint",
      payload: { source_sound_id: "nope", start_s: 0, end_s: 1 },
    });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().detail).toMatch(/not found/i);
  });

  it("400s on a window that ends past the clip", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/repaint",
      payload: { source_sound_id: soundId, start_s: 1, end_s: SECONDS + 5 },
    });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().detail).toMatch(/past the source/i);
  });

  it("checks the window before it goes looking for a model", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/repaint",
      payload: { source_sound_id: soundId, start_s: 1, end_s: 2 },
    });
    // No repaint-capable model is installed on a test box, so this is as far
    // as it gets — but it got past the window checks to say so.
    expect(resp.statusCode).toBe(400);
    expect(resp.json().detail).toMatch(/repaint/i);
  });
});

/**
 * Swapping a clip's audio is what a repaint from the timeline lands as: the
 * same clip, in the same place, playing the take that came back. Without it
 * the only way to change a clip's sound is to delete it and make another one,
 * which loses its position and its trim.
 */
describe("PATCH a segment's sound", () => {
  it("points the clip at another sound and refuses one that is not there", async () => {
    const story = await app.inject({ method: "POST", url: "/api/stories", payload: { title: "S" } });
    const storyId = story.json().id;
    const created = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/segments`,
      payload: { sound_id: soundId, start_s: 0, track_index: 0 },
    });
    expect(created.statusCode).toBe(201);
    const segmentId = created.json().id;

    // A second clip to point at — any sound in the library will do.
    const other = await app.inject({
      method: "POST",
      url: `/api/sounds/${soundId}/edit`,
      payload: { op: "reverse" },
    });
    expect(other.statusCode).toBe(201);
    const otherId = other.json().id;

    const ok = await app.inject({
      method: "PATCH",
      url: `/api/stories/${storyId}/segments/${segmentId}`,
      payload: { sound_id: otherId },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().sound_id).toBe(otherId);

    const bad = await app.inject({
      method: "PATCH",
      url: `/api/stories/${storyId}/segments/${segmentId}`,
      payload: { sound_id: "nope" },
    });
    expect(bad.statusCode).toBe(400);
  });
});
