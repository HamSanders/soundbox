/**
 * A MIDI take keeps its notes.
 *
 * The studio places a take as a WAV, and the clip now also carries the notes
 * it was rendered from (`midi`), so it can be reopened in the piano roll and
 * rendered again. What matters here is that the notes survive the round trip
 * through the story, that a library from before the column existed opens and
 * reads exactly as it did, and that a bad blob costs the notes, not the story.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import { Database } from "../src/db.js";
import { buildMcp } from "../src/mcp/server.js";
import { MirliService } from "../src/service.js";
import * as dsp from "../src/audio/dsp.js";

const TAKE = {
  notes: [
    { note: 60, velocity: 0.8, start_s: 0, duration_s: 0.5 },
    { note: 64, velocity: 0.6, start_s: 0.5, duration_s: 0.5 },
    { note: 67, velocity: 1, start_s: 1, duration_s: 1 },
  ],
  bpm: 96,
  instrument: "bowed",
  cover: { prompt: "solo violin, large hall", strength: 0.8 },
  role: "dry" as const,
  take_id: "take-test-1",
};

describe("clip notes over HTTP", () => {
  let app: FastifyInstance;
  let dataDir: string;
  let soundId: string;
  let storyId: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "soundbox-clipmidi-test-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();

    const tmp = await mkdtemp(join(tmpdir(), "soundbox-clipmidi-wav-"));
    const path = join(tmp, "take.wav");
    dsp.writeWav(path, [new Float32Array(44100 * 2)], 44100);
    const upload = await app.inject({
      method: "POST",
      url: "/api/sounds/upload?name=Take",
      headers: { "content-type": "audio/wav" },
      payload: await readFile(path),
    });
    expect(upload.statusCode).toBe(201);
    soundId = upload.json().id;
    await rm(tmp, { recursive: true, force: true });

    const story = await app.inject({ method: "POST", url: "/api/stories", payload: { title: "Take" } });
    storyId = story.json().id;
  });

  afterAll(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const create = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/api/stories/${storyId}/segments`, payload });
  const patch = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: "PATCH", url: `/api/stories/${storyId}/segments/${id}`, payload });
  const list = async () =>
    (await app.inject({ method: "GET", url: `/api/stories/${storyId}/segments` })).json() as {
      id: string;
      midi: unknown;
    }[];

  it("keeps the notes on create and reads them back", async () => {
    const resp = await create({ sound_id: soundId, start_s: 0, midi: TAKE });
    expect(resp.statusCode).toBe(201);
    expect(resp.json().midi).toEqual(TAKE);
    const again = (await list()).find((s) => s.id === resp.json().id);
    expect(again?.midi).toEqual(TAKE);
  });

  it("reads null on a clip that is only audio", async () => {
    const resp = await create({ sound_id: soundId, start_s: 5 });
    expect(resp.json().midi).toBeNull();
  });

  it("replaces the notes on a re-render, and forgets them on null", async () => {
    const id = (await create({ sound_id: soundId, start_s: 10, midi: TAKE })).json().id;
    const edited = { ...TAKE, notes: [{ note: 62, velocity: 0.5, start_s: 0, duration_s: 2 }] };
    const resp = await patch(id, { sound_id: soundId, midi: edited });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().midi).toEqual(edited);

    // A patch that does not mention midi leaves it alone.
    expect((await patch(id, { gain_db: -3 })).json().midi).toEqual(edited);

    expect((await patch(id, { midi: null })).json().midi).toBeNull();
  });

  it("refuses notes that are not notes", async () => {
    const bad = { ...TAKE, notes: [{ note: 200, velocity: 0.5, start_s: 0, duration_s: 1 }] };
    expect((await create({ sound_id: soundId, midi: bad })).statusCode).toBe(422);
    expect((await create({ sound_id: soundId, midi: { ...TAKE, notes: [] } })).statusCode).toBe(422);
  });

  it("lets a split clip go of its notes", async () => {
    const id = (await create({ sound_id: soundId, start_s: 20, midi: TAKE })).json().id;
    const resp = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/segments/${id}/split`,
      payload: { at_s: 1 },
    });
    expect(resp.statusCode).toBeLessThan(300);
    const halves = resp.json() as { midi: unknown }[];
    expect(halves.map((h) => h.midi)).toEqual([null, null]);
  });
});

describe("a library from before clips kept notes", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("opens, reads every old clip without notes, and takes new ones", () => {
    dir = mkdtempSync(join(tmpdir(), "soundbox-clipmidi-legacy-"));
    const path = join(dir, "soundbox.db");

    // Build a current library, then take the column away: what is left is
    // the shape an older Mirli wrote.
    const first = new Database(path);
    first.createStory("st1", "Old", "2026-10-01T00:00:00Z");
    first.createSegment("seg1", "st1", "2026-10-01T00:00:00Z", { text: "an old line" });
    first.close();
    const raw = new BetterSqlite3(path);
    raw.exec("ALTER TABLE story_segments DROP COLUMN midi");
    const columns = raw.prepare("PRAGMA table_info(story_segments)").all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain("midi");
    raw.close();

    const db = new Database(path);
    try {
      const old = db.getSegment("seg1");
      expect(old?.text).toBe("an old line");
      expect(old?.midi).toBeNull();
      const fresh = db.createSegment("seg2", "st1", "2026-10-02T00:00:00Z", { midi: TAKE });
      expect(fresh.midi).toEqual(TAKE);
    } finally {
      db.close();
    }
  });

  it("reads a blob that no longer validates as no notes, not a failed story", () => {
    dir = mkdtempSync(join(tmpdir(), "soundbox-clipmidi-bad-"));
    const path = join(dir, "soundbox.db");
    const db = new Database(path);
    try {
      db.createStory("st1", "Bad", "2026-10-01T00:00:00Z");
      db.createSegment("seg1", "st1", "2026-10-01T00:00:00Z", { midi: TAKE });
      for (const blob of ['{"notes":"nope"}', "not json"]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reaching past the API on purpose
        (db as any).conn.prepare("UPDATE story_segments SET midi=? WHERE id='seg1'").run(blob);
        expect(db.getSegment("seg1")?.midi).toBeNull();
        expect(db.listSegments("st1")).toHaveLength(1);
      }
    } finally {
      db.close();
    }
  });
});

describe("soundbox.get_story", () => {
  let client: Client;
  let svc: MirliService;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "soundbox-clipmidi-mcp-"));
    svc = new MirliService(new Config(dataDir));
    const server = buildMcp(() => svc);
    client = new Client({ name: "test", version: "0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  });

  afterAll(async () => {
    await client.close();
    await svc.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("shows a take's notes, and nothing on a clip without them", async () => {
    const story = svc.createStory("MCP", null, "music");
    const base = { text: "", kind: "pause" as const, track_index: 0, duration_s: 2 };
    svc.createSegment(story.id, { ...base, midi: TAKE });
    svc.createSegment(story.id, { ...base, start_s: 3 });

    const res = (await client.callTool({
      name: "soundbox.get_story",
      arguments: { story_id: story.id },
    })) as { content: { text: string }[] };
    const lines = JSON.parse(res.content.map((c) => c.text).join("")).lines as {
      midi?: unknown;
    }[];
    expect(lines[0]?.midi).toEqual(TAKE);
    expect(lines[1]).not.toHaveProperty("midi");
  });
});
