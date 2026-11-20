/**
 * Audiobook beds: layout (pure), then the HTTP routes against a temp data
 * directory. No models: library sounds are bare rows, and the one generation
 * test swaps the generate job for a runner that returns a fake sound.
 */

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { beds, layoutBed, narrationLength, type LayoutInput } from "../src/audiobook/beds.js";
import { audiobooks } from "../src/audiobook/service.js";
import type { Manuscript } from "../src/audiobook/types.js";
import { Config } from "../src/config.js";
import { buildApp } from "../src/app.js";
import type { ModelInfo, Sound, StorySegment } from "../src/schemas.js";

/* ------------------------------------------------------------------ layout */

const base: LayoutInput = {
  kind: "music",
  mode: "full",
  loop: true,
  sound_s: 30,
  chapter_s: 100,
  intro_s: null,
  fade_in_s: 3,
  fade_out_s: 5,
  anchor_s: 0,
  offset_s: 0,
};

describe("layoutBed", () => {
  it("loops to the chapter length with overlapping seams", () => {
    const clips = layoutBed(base);
    expect(clips[0]).toMatchObject({ start_s: 0, duration_s: 30, fade_in_s: 3, fade_out_s: 0 });
    // 2 s crossfade: each clip starts 28 s after the last
    expect(clips.map((c) => c.start_s)).toEqual([0, 28, 56, 84]);
    const last = clips[clips.length - 1];
    expect(last.start_s + last.duration_s).toBeCloseTo(100, 6);
    expect(last.fade_out_s).toBe(5);
  });

  it("plays once, trimmed to the chapter, without loop", () => {
    expect(layoutBed({ ...base, loop: false, sound_s: 300 })).toEqual([
      { start_s: 0, trim_start_s: 0, duration_s: 100, fade_in_s: 3, fade_out_s: 5 },
    ]);
    expect(layoutBed({ ...base, loop: false })).toHaveLength(1);
  });

  it("places intro, outro, and both", () => {
    expect(layoutBed({ ...base, mode: "intro", intro_s: 12 })).toEqual([
      { start_s: 0, trim_start_s: 0, duration_s: 12, fade_in_s: 3, fade_out_s: 5 },
    ]);
    expect(layoutBed({ ...base, mode: "outro", intro_s: 12 })[0]).toMatchObject({ start_s: 88, duration_s: 12 });
    const both = layoutBed({ ...base, mode: "intro_outro", intro_s: 12 });
    expect(both.map((c) => c.start_s)).toEqual([0, 88]);
    // Pieces that would meet become one full bed.
    expect(layoutBed({ ...base, mode: "intro_outro", intro_s: 60 }).map((c) => c.start_s)).toEqual([0, 28, 56, 84]);
  });

  it("lays the sound out once before anything is voiced", () => {
    expect(layoutBed({ ...base, chapter_s: 0 })).toEqual([
      { start_s: 0, trim_start_s: 0, duration_s: 30, fade_in_s: 3, fade_out_s: 5 },
    ]);
  });

  it("puts an sfx at its anchor plus offset, never before zero", () => {
    const sfx = { ...base, kind: "sfx" as const, sound_s: 2, fade_in_s: 0, fade_out_s: 0 };
    expect(layoutBed({ ...sfx, anchor_s: 40, offset_s: 1.5 })).toEqual([
      { start_s: 41.5, trim_start_s: 0, duration_s: 2, fade_in_s: 0, fade_out_s: 0 },
    ]);
    expect(layoutBed({ ...sfx, anchor_s: 1, offset_s: -5 })[0].start_s).toBe(0);
  });

  it("caps clips at the timeline's 600 s limit and refuses absurd loops", () => {
    const long = layoutBed({ ...base, sound_s: 900, chapter_s: 1500 });
    expect(Math.max(...long.map((c) => c.duration_s))).toBeLessThanOrEqual(600);
    expect(() => layoutBed({ ...base, sound_s: 0.01, chapter_s: 3600 })).toThrow(/too short/);
  });

  it("keeps fades inside a short clip", () => {
    const [c] = layoutBed({ ...base, loop: false, sound_s: 4, fade_in_s: 3, fade_out_s: 5 });
    expect(c.fade_in_s + c.fade_out_s).toBeLessThanOrEqual(c.duration_s + 1e-9);
  });
});

describe("narrationLength", () => {
  const seg = (o: Partial<StorySegment>) => ({ track_index: 0, kind: "line", sound_id: "s", start_s: 0, duration_s: 1, ...o }) as StorySegment;
  it("is the end of the last voiced clip or pause on track 0", () => {
    expect(
      narrationLength([
        seg({ start_s: 0, duration_s: 5 }),
        seg({ start_s: 5, duration_s: 0.5, kind: "pause", sound_id: null }),
        seg({ start_s: 6, duration_s: 3, sound_id: null }), // unvoiced
        seg({ start_s: 0, duration_s: 50, track_index: 1 }), // a bed
      ]),
    ).toBe(5.5);
  });
});

/* -------------------------------------------------------------------- HTTP */

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-audiobook-beds-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

function fakeSound(duration = 2.5, name = "take"): string {
  const id = randomUUID();
  const sound: Sound = {
    id,
    created_at: new Date().toISOString(),
    model: "test",
    prompt: "",
    duration_s: duration,
    sample_rate: 24000,
    channels: 1,
    file: "",
    peaks: [],
    favorite: false,
    tags: [],
    name,
    size_bytes: 0,
    source: "api",
  };
  app.soundbox.db.insertSound(sound, `${id}.wav`);
  return id;
}

function call(opts: Parameters<FastifyInstance["inject"]>[0] & object) {
  const o = opts as { headers?: Record<string, string> };
  return app.inject({ ...(opts as object), headers: { "x-soundbox": "1", ...(o.headers ?? {}) } } as never);
}

async function json<T = any>(method: string, url: string, payload?: unknown): Promise<T> {
  const res = await call({ method: method as "GET", url, payload: payload as object });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} -> ${res.statusCode} ${res.body}`);
  return res.body ? (res.json() as T) : (undefined as T);
}

const manuscript = (kind: "chapter" | "retail_sample" = "chapter"): Manuscript => ({
  title: "Bed Test",
  subtitle: null,
  author: null,
  language: "en",
  description: null,
  isbn: null,
  publisher: null,
  publication_date: null,
  cover: null,
  warnings: [],
  sections: [{ title: "One", kind, included: true, paragraphs: ["First line.", "Second line."] }],
});

/** A book with one chapter whose two paragraphs are voiced, 0–10 s and 10–20 s. */
async function voicedBook(kind: "chapter" | "retail_sample" = "chapter") {
  const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript(kind), {}, { headings: false });
  const chapter = book.chapters[0];
  const paragraphs = audiobooks(app.soundbox).getParagraphs(chapter.id)!;
  paragraphs.forEach((p, i) => {
    app.soundbox.updateSegment(p.id, { sound_id: fakeSound(10), start_s: i * 10, duration_s: 10 });
  });
  return { book, chapter, story: chapter.story_id, paragraphs };
}

const clipsOn = (story: string, track: number) =>
  app.soundbox.listSegments(story).filter((s) => s.track_index === track);

describe("beds over HTTP", () => {
  it("adds a library bed on its own track, looped to the narration", async () => {
    const { book, chapter, story } = await voicedBook();
    const bed = await json("POST", `/api/audiobooks/${book.id}/chapters/${chapter.id}/beds`, {
      kind: "music",
      sound_id: fakeSound(8, "Calm piano"),
      gain_db: -20,
    });
    expect(bed).toMatchObject({ kind: "music", track_index: 1, status: "ready", laid_out_s: 20, stale: false });
    expect(bed.label).toBe("Music: Calm piano");
    expect(bed.duck.depth_db).toBe(12);
    const clips = clipsOn(story, 1);
    expect(clips).toHaveLength(bed.segment_ids.length);
    expect(clips.every((c) => c.gain_db === -20)).toBe(true);
    const end = Math.max(...clips.map((c) => c.start_s + (c.duration_s ?? 0)));
    expect(end).toBeCloseTo(20, 3);
    expect(app.soundbox.listTracks(story).find((t) => t.track_index === 1)?.name).toBe("Music: Calm piano");

    const list = await json("GET", `/api/audiobooks/${book.id}/beds?chapter_id=${chapter.id}`);
    expect(list).toHaveLength(1);
  });

  it("marks a bed stale when the narration changes length, and refits it", async () => {
    const { book, chapter, story, paragraphs } = await voicedBook();
    const bed = await json("POST", `/api/audiobooks/${book.id}/chapters/${chapter.id}/beds`, {
      kind: "ambience",
      sound_id: fakeSound(30),
    });
    expect(bed.track_index).toBe(1);
    app.soundbox.updateSegment(paragraphs[1].id, { start_s: 10, duration_s: 25, sound_id: fakeSound(25) });
    const [stale] = await json("GET", `/api/audiobooks/${book.id}/beds`);
    expect(stale.stale).toBe(true);
    const [fitted] = await json("POST", `/api/audiobooks/${book.id}/chapters/${chapter.id}/beds/layout`);
    expect(fitted).toMatchObject({ stale: false, laid_out_s: 35 });
    expect(clipsOn(story, 1).every((c) => !bed.segment_ids.includes(c.id))).toBe(true);
  });

  it("anchors an sfx to a paragraph, without ducking", async () => {
    const { book, chapter, story, paragraphs } = await voicedBook();
    await json("POST", `/api/audiobooks/${book.id}/chapters/${chapter.id}/beds`, { sound_id: fakeSound(30) });
    const sfx = await json("POST", `/api/audiobooks/${book.id}/chapters/${chapter.id}/beds`, {
      kind: "sfx",
      sound_id: fakeSound(1.5, "door"),
      anchor_segment_id: paragraphs[1].id,
      offset_s: 0.5,
    });
    expect(sfx).toMatchObject({ track_index: 2, duck: null, loop: false });
    const [clip] = clipsOn(story, 2);
    expect(clip.start_s).toBeCloseTo(10.5, 6);
  });

  it("patches gain and mode by re-laying clips; a duck change leaves them", async () => {
    const { book, chapter, story } = await voicedBook();
    const bed = await json("POST", `/api/audiobooks/${book.id}/chapters/${chapter.id}/beds`, {
      sound_id: fakeSound(30),
    });
    const ducked = await json("PATCH", `/api/audiobooks/${book.id}/beds/${bed.id}`, { duck: { depth_db: 6 } });
    expect(ducked.duck.depth_db).toBe(6);
    expect(ducked.segment_ids).toEqual(bed.segment_ids);
    const off = await json("PATCH", `/api/audiobooks/${book.id}/beds/${bed.id}`, { duck: false });
    expect(off.duck).toBeNull();
    const intro = await json("PATCH", `/api/audiobooks/${book.id}/beds/${bed.id}`, {
      mode: "intro",
      intro_s: 6,
      gain_db: -10,
    });
    const clips = clipsOn(story, 1);
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ start_s: 0, duration_s: 6, gain_db: -10 });
    expect(intro.segment_ids).toEqual([clips[0].id]);
  });

  it("deletes a bed with its clips and lane", async () => {
    const { book, chapter, story } = await voicedBook();
    const bed = await json("POST", `/api/audiobooks/${book.id}/chapters/${chapter.id}/beds`, {
      sound_id: fakeSound(30),
    });
    const res = await call({ method: "DELETE", url: `/api/audiobooks/${book.id}/beds/${bed.id}` });
    expect(res.statusCode).toBe(204);
    expect(clipsOn(story, 1)).toHaveLength(0);
    expect(app.soundbox.listTracks(story).some((t) => t.track_index === 1)).toBe(false);
    expect((await call({ method: "DELETE", url: `/api/audiobooks/${book.id}/beds/${bed.id}` })).statusCode).toBe(404);
  });

  it("rejects bad input", async () => {
    const { book, chapter } = await voicedBook();
    const url = `/api/audiobooks/${book.id}/chapters/${chapter.id}/beds`;
    expect((await call({ method: "POST", url, payload: {} })).statusCode).toBe(422);
    expect((await call({ method: "POST", url, payload: { sound_id: "nope" } })).statusCode).toBe(400);
    expect(
      (await call({ method: "POST", url: `/api/audiobooks/${book.id}/chapters/nope/beds`, payload: { sound_id: fakeSound() } }))
        .statusCode,
    ).toBe(400);
    // No generation model installed in a test data dir.
    const res = await call({ method: "POST", url, payload: { prompt: "soft rain" } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/No music model is installed/);
  });

  it("generates a bed from a prompt and lays it out when the job finishes", async () => {
    const { book, chapter, story } = await voicedBook();
    const svc = app.soundbox;
    const model = {
      id: "test:music",
      name: "Test Music",
      task: "gen",
      category: "music",
      status: "installed",
      max_duration_s: 47,
    } as ModelInfo;
    const listSpy = vi.spyOn(svc, "listModels").mockResolvedValue([model]);
    let asked: Record<string, unknown> | null = null;
    const genSpy = vi.spyOn(svc, "submitGenerate").mockImplementation((req) => {
      asked = req as unknown as Record<string, unknown>;
      return svc.jobs.submit("generate", { ...req }, async () => ({ sounds: [fakeSound(40, "gen")] }));
    });
    try {
      const bed = await json("POST", `/api/audiobooks/${book.id}/chapters/${chapter.id}/beds`, {
        prompt: "warm strings, slow",
      });
      expect(bed).toMatchObject({ status: "generating", model_id: "test:music", sound_id: null });
      expect(asked).toMatchObject({ model: "test:music", prompt: "warm strings, slow", duration_s: 47 });
      let done = bed;
      for (let i = 0; i < 40 && done.status === "generating"; i++) {
        await new Promise((r) => setTimeout(r, 100));
        done = await json("GET", `/api/audiobooks/${book.id}/beds`).then((l: any[]) => l.find((b) => b.id === bed.id));
      }
      expect(done.status).toBe("ready");
      expect(clipsOn(story, 1).length).toBeGreaterThan(0);
    } finally {
      listSpy.mockRestore();
      genSpy.mockRestore();
    }
  });
});

describe("export side", () => {
  it("ducks bed lanes under lane 0, or drops them", async () => {
    const { book, chapter, story } = await voicedBook();
    await json("POST", `/api/audiobooks/${book.id}/chapters/${chapter.id}/beds`, { sound_id: fakeSound(30) });
    const sr = 1000;
    const narration = new Float32Array(4 * sr);
    for (let i = sr; i < 3 * sr; i++) narration[i] = 0.5 * Math.sin(i);
    const bed = new Float32Array(4 * sr).fill(0.1);
    const other = new Float32Array(4 * sr).fill(0.2);
    const lanes = new Map([
      [0, [narration]],
      [1, [bed]],
      [5, [other]],
    ]);
    const service = beds(app.soundbox);
    const out = service.duckChapterLanes(story, lanes, sr);
    expect(out.get(0)![0]).toBe(narration);
    expect(out.get(5)![0]).toBe(other);
    expect(out.get(1)![0][2 * sr]).toBeCloseTo(0.1 * Math.pow(10, -12 / 20), 4);
    expect(out.get(1)![0][100]).toBeCloseTo(0.1, 6);
    expect(service.duckChapterLanes(story, lanes, sr, false).has(1)).toBe(false);
    expect(service.bedSegmentIds(story).size).toBe(clipsOn(story, 1).length);
  });

  it("reports warnings and defaults include-beds off for a retail sample", async () => {
    const plain = await voicedBook();
    const empty = await json("GET", `/api/audiobooks/${plain.book.id}/beds/export-info`);
    expect(empty).toEqual({ has_beds: false, include_beds_default: true, warnings: [] });
    await json("POST", `/api/audiobooks/${plain.book.id}/chapters/${plain.chapter.id}/beds`, { sound_id: fakeSound(30) });
    const info = await json("GET", `/api/audiobooks/${plain.book.id}/beds/export-info`);
    expect(info.has_beds).toBe(true);
    expect(info.include_beds_default).toBe(true);
    expect(info.warnings.map((w: any) => w.id)).toEqual(["distribution", "noise_floor"]);

    const sample = await voicedBook("retail_sample");
    await json("POST", `/api/audiobooks/${sample.book.id}/chapters/${sample.chapter.id}/beds`, {
      sound_id: fakeSound(30),
      mode: "intro",
    });
    const sInfo = await json("GET", `/api/audiobooks/${sample.book.id}/beds/export-info`);
    expect(sInfo.include_beds_default).toBe(false);
    expect(sInfo.warnings.map((w: any) => w.id)).toEqual(["distribution", "retail_sample"]);
  });
});
