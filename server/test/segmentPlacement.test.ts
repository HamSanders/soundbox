import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";

/**
 * Moving a clip moves its line.
 *
 * The script reads in the order things happen on the timeline. That used to
 * hold only because the studio followed every drag with a whole-list reorder,
 * so an agent's move — or an undone drag — left the two views disagreeing.
 * Now a PATCH that changes where a clip sits re-derives its reading position.
 */

let app: FastifyInstance;
let dataDir: string;
let storyId: string;
let ids: Record<string, string>;

const base = (): string => `/api/stories/${storyId}/segments`;

async function order(): Promise<string[]> {
  const byId = Object.fromEntries(Object.entries(ids).map(([name, id]) => [id, name]));
  const resp = await app.inject({ method: "GET", url: base() });
  return (resp.json() as { id: string }[]).map((s) => byId[s.id]!);
}

async function patch(name: string, body: Record<string, unknown>): Promise<void> {
  const resp = await app.inject({ method: "PATCH", url: `${base()}/${ids[name]}`, payload: body });
  expect(resp.statusCode).toBe(200);
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "konchi-placement-test-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
});

beforeEach(async () => {
  const story = await app.inject({ method: "POST", url: "/api/stories", payload: { title: "Order" } });
  storyId = story.json().id;
  ids = {};
  // Three pauses, so each has a length without any audio: A at 0, B at 5, C at 10.
  for (const [name, start] of [["A", 0], ["B", 5], ["C", 10]] as const) {
    const resp = await app.inject({
      method: "POST",
      url: base(),
      payload: { kind: "pause", duration_s: 2, start_s: start, track_index: 0 },
    });
    expect(resp.statusCode).toBeLessThan(300);
    ids[name] = resp.json().id;
  }
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("PATCH /api/stories/:id/segments/:segment_id placement", () => {
  it("re-reads the script when a clip moves later", async () => {
    await patch("A", { start_s: 12 });
    expect(await order()).toEqual(["B", "C", "A"]);
  });

  it("puts the line back when the move is undone", async () => {
    await patch("A", { start_s: 12 });
    await patch("A", { start_s: 0 });
    expect(await order()).toEqual(["A", "B", "C"]);
  });

  it("reads the upper lane first when two clips start together", async () => {
    await patch("C", { start_s: 5, track_index: 1 });
    expect(await order()).toEqual(["A", "B", "C"]);
    await patch("B", { track_index: 2 });
    expect(await order()).toEqual(["A", "C", "B"]);
  });

  it("ends a group move, applied one clip at a time, in timeline order", async () => {
    // Drag A and B together past C.
    await patch("A", { start_s: 20 });
    await patch("B", { start_s: 25 });
    expect(await order()).toEqual(["C", "A", "B"]);
  });

  it("leaves a hand-ordered script alone when nothing moved", async () => {
    const reorder = await app.inject({
      method: "PUT",
      url: `${base()}/reorder`,
      payload: { segment_ids: [ids.C, ids.A, ids.B] },
    });
    expect(reorder.statusCode).toBe(200);
    await patch("A", { gain_db: -3 });
    await patch("B", { start_s: 5, track_index: 0 });
    expect(await order()).toEqual(["C", "A", "B"]);
  });
});
