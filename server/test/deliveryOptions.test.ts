/**
 * Delivery settings, end to end over HTTP — minus the GPU.
 *
 * Everything here is the plumbing that would otherwise only be exercised by a
 * real generation: two new columns, two patch paths, and the empty-object
 * convention that means "put this back on the level above". A generation is
 * minutes and a model download; this is milliseconds and covers the part most
 * likely to be wrong.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";

let app: FastifyInstance;
let dataDir: string;
let storyId: string;
let segmentId: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "konchi-delivery-test-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();

  const story = await app.inject({
    method: "POST",
    url: "/api/stories",
    payload: { title: "Delivery" },
  });
  storyId = story.json().id;

  const segment = await app.inject({
    method: "POST",
    url: `/api/stories/${storyId}/segments`,
    payload: { text: "I never said that." },
  });
  segmentId = segment.json().id;
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("a story's default delivery", () => {
  it("round-trips through PATCH", async () => {
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/stories/${storyId}`,
      payload: { request_options: { exaggeration: "1.4" } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().request_options).toEqual({ exaggeration: "1.4" });

    const read = await app.inject({ method: "GET", url: `/api/stories/${storyId}` });
    expect(read.json().request_options).toEqual({ exaggeration: "1.4" });
  });

  it("treats an empty object as a real target state, not a no-op", async () => {
    await app.inject({
      method: "PATCH",
      url: `/api/stories/${storyId}`,
      payload: { request_options: {} },
    });
    const read = await app.inject({ method: "GET", url: `/api/stories/${storyId}` });
    expect(read.json().request_options).toEqual({});

    // Put it back for the tests below.
    await app.inject({
      method: "PATCH",
      url: `/api/stories/${storyId}`,
      payload: { request_options: { exaggeration: "1.4" } },
    });
  });

  it("still rejects a patch that asks for nothing at all", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/stories/${storyId}`, payload: {} });
    expect(res.statusCode).toBe(422);
  });
});

describe("a line's own delivery", () => {
  it("is empty until set — an unset line follows the story", async () => {
    const read = await app.inject({ method: "GET", url: `/api/stories/${storyId}/segments` });
    expect(read.json()[0].request_options).toEqual({});
  });

  it("round-trips through PATCH without disturbing the story's", async () => {
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/stories/${storyId}/segments/${segmentId}`,
      payload: { request_options: { exaggeration: "0.2", temperature: "1.1" } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().request_options).toEqual({ exaggeration: "0.2", temperature: "1.1" });

    const story = await app.inject({ method: "GET", url: `/api/stories/${storyId}` });
    expect(story.json().request_options).toEqual({ exaggeration: "1.4" });
  });

  it("clears back to the story's default on an empty object", async () => {
    await app.inject({
      method: "PATCH",
      url: `/api/stories/${storyId}/segments/${segmentId}`,
      payload: { request_options: {} },
    });
    const read = await app.inject({ method: "GET", url: `/api/stories/${storyId}/segments` });
    expect(read.json()[0].request_options).toEqual({});
  });

  it("leaves the delivery alone when a patch is about something else", async () => {
    await app.inject({
      method: "PATCH",
      url: `/api/stories/${storyId}/segments/${segmentId}`,
      payload: { request_options: { exaggeration: "0.9" } },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/stories/${storyId}/segments/${segmentId}`,
      payload: { text: "Reworded." },
    });
    const read = await app.inject({ method: "GET", url: `/api/stories/${storyId}/segments` });
    expect(read.json()[0]).toMatchObject({
      text: "Reworded.",
      request_options: { exaggeration: "0.9" },
    });
  });
});
