/**
 * "Suggest soundscape": the prompt, the parser, the keyword fallback, the
 * scene bed mode, and the route. No model: the assistant's reply is a string.
 */

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { layoutBed } from "../src/audiobook/beds.js";
import { audiobooks } from "../src/audiobook/service.js";
import type { Manuscript } from "../src/audiobook/types.js";
import { Config } from "../src/config.js";
import {
  SUGGESTION_LEVELS,
  buildSoundscapeMessages,
  extractJson,
  heuristicSoundscape,
  labelledText,
  parseSoundscape,
  splitScenes,
  type SoundscapeInput,
} from "../src/llm/soundscape.js";
import type { Sound } from "../src/schemas.js";

const para = (text: string, i: number) => ({ id: `seg-${i + 1}`, text });

const STORM_CHAPTER: SoundscapeInput = {
  chapter_title: "The Storm",
  book_title: "The Lantern",
  genres: ["Mystery"],
  paragraphs: [
    "Rain hammered the lighthouse windows all evening.",
    "Thunder rolled over the bay, and the rain did not stop.",
    "Mara climbed the stairs. Somewhere below, a door slammed.",
    "* * *",
    "By morning the town was quiet. She smiled at the warm kitchen, laughing with her sister at home.",
    "They laughed again, warm and gentle, as the kettle sang.",
  ].map(para),
};

describe("splitScenes", () => {
  it("splits at scene-break lines and drops them", () => {
    expect(splitScenes(STORM_CHAPTER.paragraphs)).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 5 },
    ]);
    expect(splitScenes([para("One.", 0), para("Two.", 1)])).toEqual([{ start: 0, end: 1 }]);
    expect(splitScenes([para("***", 0), para("#", 1)])).toEqual([]);
  });
});

describe("prompt", () => {
  it("labels paragraphs p1.. and never shows ids", () => {
    const [system, user] = buildSoundscapeMessages(STORM_CHAPTER);
    expect(system!.role).toBe("system");
    expect(system!.content).toContain('"scenes"');
    expect(user!.content).toContain("Chapter: The Storm");
    expect(user!.content).toContain("Genres: Mystery");
    expect(user!.content).toContain("p3: Mara climbed the stairs.");
    expect(user!.content).not.toContain("seg-");
  });

  it("trims paragraphs to fit the budget", () => {
    const long = Array.from({ length: 50 }, (_, i) => para("word ".repeat(400), i));
    const text = labelledText(long, 5000);
    expect(text.length).toBeLessThan(5000 + 50 * 20);
    expect(text).toContain("p50: ");
  });
});

describe("parseSoundscape", () => {
  const reply = [
    "Here you go:",
    "```json",
    JSON.stringify({
      scenes: [
        { start: "p1", end: "p3", kind: "ambience", mood: "tense", setting: "storm at the lighthouse", prompt: "heavy rain on glass, distant thunder" },
        { start: "p6", end: "p5", kind: "music", mood: "warm", prompt: "soft acoustic guitar, slow, instrumental" },
        { start: "p99", end: "p100", kind: "ambience", prompt: "nowhere" },
        { start: "p1", end: "p2", kind: "dialogue", prompt: "bad kind" },
        { start: "p1", end: "p2", kind: "music", prompt: "" },
      ],
      sfx: [
        { paragraph: "p3", quote: "a door slammed", prompt: "heavy door slamming in a stairwell" },
        { paragraph: "seg-2", prompt: "real ids are not accepted" },
        { paragraph: "p3", quote: "a door slammed", prompt: "heavy door slamming in a stairwell" },
      ],
    }),
    "```",
  ].join("\n");

  it("maps labels back to ids and drops what points nowhere", () => {
    const out = parseSoundscape(reply, STORM_CHAPTER);
    expect(out.map((s) => s.kind)).toEqual(["ambience", "music", "sfx"]);
    const [amb, music, sfx] = out;
    expect(amb).toMatchObject({
      start_paragraph_id: "seg-1",
      end_paragraph_id: "seg-3",
      setting: "storm at the lighthouse",
      mood: "tense",
      label: "Storm at the lighthouse",
      source: "llm",
      gain_db: SUGGESTION_LEVELS.ambience.gain_db,
      duck_db: SUGGESTION_LEVELS.ambience.duck_db,
    });
    // A reversed range is put the right way round.
    expect(music).toMatchObject({ start_paragraph_id: "seg-5", end_paragraph_id: "seg-6" });
    expect(sfx).toMatchObject({ start_paragraph_id: "seg-3", end_paragraph_id: "seg-3", duck_db: 0 });
    expect(sfx!.reason).toContain("a door slammed");
    expect(new Set(out.map((s) => s.id)).size).toBe(out.length);
  });

  it("gives the same ids for the same reply", () => {
    expect(parseSoundscape(reply, STORM_CHAPTER).map((s) => s.id)).toEqual(
      parseSoundscape(reply, STORM_CHAPTER).map((s) => s.id),
    );
  });

  it("throws on a reply with no JSON, so the caller can fall back", () => {
    expect(() => parseSoundscape("I would suggest some rain.", STORM_CHAPTER)).toThrow(/no JSON/);
    expect(extractJson('{"a": 1')).toBeNull();
    expect(extractJson('text {"a": 1} text')).toEqual({ a: 1 });
  });
});

describe("heuristicSoundscape", () => {
  it("finds a setting per scene, a mood where there is no setting, and sound effects", () => {
    const out = heuristicSoundscape(STORM_CHAPTER);
    const scenes = out.filter((s) => s.kind !== "sfx");
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({ kind: "ambience", setting: "storm", start_paragraph_id: "seg-1", end_paragraph_id: "seg-3" });
    expect(scenes[1]).toMatchObject({ kind: "music", mood: "warm", start_paragraph_id: "seg-5", end_paragraph_id: "seg-6" });
    const sfx = out.filter((s) => s.kind === "sfx");
    expect(sfx.map((s) => [s.start_paragraph_id, s.label])).toEqual([
      ["seg-2", "Thunder"],
      ["seg-3", "Door slam"],
    ]);
    expect(out.every((s) => s.source === "heuristic")).toBe(true);
    expect(out.every((s) => s.gain_db <= -12)).toBe(true);
  });

  it("does not fire on a thing that only makes a sound", () => {
    const quiet = { chapter_title: "x", paragraphs: [para("She closed the door and sat by the window.", 0)] };
    expect(heuristicSoundscape(quiet).filter((s) => s.kind === "sfx")).toEqual([]);
  });

  it("suggests nothing for plain text", () => {
    expect(heuristicSoundscape({ chapter_title: "x", paragraphs: [para("He read the letter twice.", 0)] })).toEqual([]);
  });
});

describe("scene beds", () => {
  it("lay out from the start paragraph to the end paragraph", () => {
    const clips = layoutBed({
      kind: "ambience",
      mode: "scene",
      loop: true,
      sound_s: 30,
      chapter_s: 200,
      intro_s: null,
      fade_in_s: 2,
      fade_out_s: 2,
      anchor_s: 40,
      offset_s: 0,
      end_s: 100,
    });
    expect(clips[0]!.start_s).toBe(40);
    const last = clips[clips.length - 1]!;
    expect(last.start_s + last.duration_s).toBeCloseTo(100, 6);
  });

  it("run to the chapter's end without an end paragraph, and once when nothing is voiced", () => {
    const base = { kind: "music" as const, mode: "scene" as const, loop: false, sound_s: 20, intro_s: null, fade_in_s: 0, fade_out_s: 0, offset_s: 0 };
    expect(layoutBed({ ...base, chapter_s: 90, anchor_s: 60 })).toEqual([
      { start_s: 60, trim_start_s: 0, duration_s: 20, fade_in_s: 0, fade_out_s: 0 },
    ]);
    expect(layoutBed({ ...base, chapter_s: 0, anchor_s: 0, end_s: 0 })[0]).toMatchObject({ start_s: 0, duration_s: 20 });
  });
});

/* -------------------------------------------------------------------- HTTP */

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-audiobook-soundscape-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

function fakeSound(duration: number): string {
  const id = randomUUID();
  app.soundbox.db.insertSound(
    {
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
      name: "s",
      size_bytes: 0,
      source: "api",
    } as Sound,
    `${id}.wav`,
  );
  return id;
}

async function post(url: string, payload?: unknown) {
  return app.inject({ method: "POST", url, headers: { "x-soundbox": "1" }, payload: payload as object });
}

async function stormBook() {
  const m: Manuscript = {
    title: "Storm Book",
    subtitle: null,
    author: null,
    language: "en",
    description: null,
    isbn: null,
    publisher: null,
    publication_date: null,
    cover: null,
    warnings: [],
    sections: [{ title: "The Storm", kind: "chapter", included: true, paragraphs: STORM_CHAPTER.paragraphs.map((p) => p.text) }],
  };
  const book = await audiobooks(app.soundbox).createBookFromManuscript(m, {}, { headings: false });
  const chapter = book.chapters[0]!;
  const paragraphs = audiobooks(app.soundbox).getParagraphs(chapter.id)!;
  return { book, chapter, paragraphs };
}

describe("suggest route", () => {
  it("uses the lexicon when the assistant is off, and creates nothing", async () => {
    const { book, chapter, paragraphs } = await stormBook();
    const res = await post(`/api/audiobooks/${book.id}/chapters/${chapter.id}/beds/suggest`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe("heuristic");
    expect(body.note).toMatch(/prompt assistant/);
    expect(body.suggestions.length).toBeGreaterThan(0);
    const ids = new Set(paragraphs.map((p) => p.id));
    for (const s of body.suggestions) {
      expect(ids.has(s.start_paragraph_id)).toBe(true);
      expect(ids.has(s.end_paragraph_id)).toBe(true);
    }
    const beds = await app.inject({ method: "GET", url: `/api/audiobooks/${book.id}/beds` });
    expect(beds.json()).toEqual([]);
  });

  it("uses the assistant when it is on, and falls back when its reply is unusable", async () => {
    const { book, chapter } = await stormBook();
    const svc = app.soundbox;
    const llm = svc.llm as unknown as { chat?: unknown };
    const had = Object.prototype.hasOwnProperty.call(llm, "chat");
    const before = llm.chat;
    const settings = svc.config.settings as { llm_mode: string };
    const mode = settings.llm_mode;
    settings.llm_mode = "external";
    try {
      llm.chat = async () =>
        JSON.stringify({ scenes: [{ start: "p1", end: "p3", kind: "ambience", setting: "storm", prompt: "rain and thunder" }], sfx: [] });
      const ok = (await post(`/api/audiobooks/${book.id}/chapters/${chapter.id}/beds/suggest`)).json();
      expect(ok.source).toBe("llm");
      expect(ok.suggestions).toHaveLength(1);
      expect(ok.suggestions[0].prompt).toBe("rain and thunder");

      llm.chat = async () => "no idea";
      const fallback = (await post(`/api/audiobooks/${book.id}/chapters/${chapter.id}/beds/suggest`)).json();
      expect(fallback.source).toBe("heuristic");
      expect(fallback.note).toMatch(/could not read this chapter/);
    } finally {
      settings.llm_mode = mode;
      if (had) llm.chat = before;
      else delete llm.chat;
    }
  });

  it("accepting a scene suggestion places a bed over just that scene", async () => {
    const { book, chapter, paragraphs } = await stormBook();
    // Voice the paragraphs: 10 s each, back to back.
    paragraphs.forEach((p, i) => app.soundbox.updateSegment(p.id, { sound_id: fakeSound(10), start_s: i * 10, duration_s: 10 }));
    const res = await post(`/api/audiobooks/${book.id}/chapters/${chapter.id}/beds`, {
      kind: "ambience",
      sound_id: fakeSound(8),
      mode: "scene",
      anchor_segment_id: paragraphs[0]!.id,
      end_segment_id: paragraphs[2]!.id,
      gain_db: -28,
      duck: { depth_db: 8 },
    });
    expect(res.statusCode).toBe(201);
    const bed = res.json();
    expect(bed).toMatchObject({ mode: "scene", end_segment_id: paragraphs[2]!.id });
    const clips = app.soundbox.listSegments(chapter.story_id).filter((s) => s.track_index === bed.track_index);
    expect(Math.min(...clips.map((c) => c.start_s))).toBe(0);
    expect(Math.max(...clips.map((c) => c.start_s + (c.duration_s ?? 0)))).toBeCloseTo(30, 3);
  });
});
