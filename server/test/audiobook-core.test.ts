/**
 * Audiobook core: books, chapters, paragraphs, casting, stale tracking and
 * find/replace, end to end over HTTP against a temp data directory. No
 * models: "voicing" a paragraph is pointing its segment at a sound row.
 */

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { audiobooks } from "../src/audiobook/service.js";
import type { Manuscript } from "../src/audiobook/types.js";
import { Config } from "../src/config.js";
import type { Sound } from "../src/schemas.js";

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-audiobook-core-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

const manuscript: Manuscript = {
  title: "The Lighthouse Keeper",
  subtitle: null,
  author: "A. Writer",
  language: "en",
  description: "A short test book.",
  isbn: null,
  publisher: null,
  publication_date: null,
  cover: null,
  warnings: [],
  sections: [
    {
      title: "Copyright",
      kind: "front_matter",
      included: false,
      paragraphs: ["All rights reserved."],
    },
    {
      title: "Chapter One",
      kind: "chapter",
      included: true,
      paragraphs: [
        "The lamp turned all night.",
        '"Is anyone there?" asked Mara.',
        "Nobody answered the lamp.",
      ],
    },
    {
      title: "Chapter Two",
      kind: "chapter",
      included: true,
      paragraphs: ["Chapter Two", "Morning came with the lamp still lit."],
    },
  ],
};

function fakeSound(): string {
  const id = randomUUID();
  const sound: Sound = {
    id,
    created_at: new Date().toISOString(),
    model: "test",
    prompt: "",
    duration_s: 2.5,
    sample_rate: 24000,
    channels: 1,
    file: "",
    peaks: [],
    favorite: false,
    tags: [],
    name: "take",
    size_bytes: 0,
    source: "api",
  };
  app.soundbox.db.insertSound(sound, `${id}.wav`);
  return id;
}

function addVoice(name: string): string {
  const id = randomUUID();
  app.soundbox.db.createVoice(
    { id, name, kind: "builtin", created_at: new Date().toISOString(), voice_id: name, model_id: "test" },
    null,
  );
  return id;
}

/** Every request carries the CSRF header the UI sends. */
function call(opts: Parameters<FastifyInstance["inject"]>[0] & object) {
  const o = opts as { headers?: Record<string, string> };
  return app.inject({ ...(opts as object), headers: { "x-soundbox": "1", ...(o.headers ?? {}) } } as never);
}

async function json<T = any>(method: string, url: string, payload?: unknown): Promise<T> {
  const res = await call({ method: method as "GET", url, payload: payload as object });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} -> ${res.statusCode} ${res.body}`);
  return res.body ? (res.json() as T) : (undefined as T);
}

describe("books", () => {
  it("creates a blank book with one chapter and lists it with stats", async () => {
    const res = await call({ method: "POST", url: "/api/audiobooks", payload: { title: "Blank" } });
    expect(res.statusCode).toBe(201);
    const book = res.json();
    expect(book.title).toBe("Blank");
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].status).toBe("empty");
    expect(book.settings.pacing.paragraph_gap_s).toBeGreaterThan(0);
    expect(book.settings.cast_mode).toBe("single");

    const list = await json<any[]>("GET", "/api/audiobooks");
    expect(list.find((b) => b.id === book.id)?.stats.chapters).toBe(1);

    // The chapter's story exists and opens like any other.
    const story = await json("GET", `/api/stories/${book.chapters[0].story_id}`);
    expect(story.builder).toBe("script");
  });

  it("patches metadata and merges settings", async () => {
    const book = await json("POST", "/api/audiobooks", { title: "Patch me" });
    const patched = await json("PATCH", `/api/audiobooks/${book.id}`, {
      author: "Someone",
      genres: ["mystery"],
      settings: { pacing: { paragraph_gap_s: 0.9 }, cast_mode: "multi" },
    });
    expect(patched.author).toBe("Someone");
    expect(patched.genres).toEqual(["mystery"]);
    expect(patched.settings.pacing.paragraph_gap_s).toBe(0.9);
    // Untouched pacing fields keep their values.
    expect(patched.settings.pacing.tail_room_tone_s).toBe(book.settings.pacing.tail_room_tone_s);
    expect(patched.settings.cast_mode).toBe("multi");
  });

  it("rejects an unknown narrator voice", async () => {
    const book = await json("POST", "/api/audiobooks", { title: "Voices" });
    const res = await call({
      method: "PATCH",
      url: `/api/audiobooks/${book.id}`,
      payload: { settings: { narrator_voice_id: "nope" } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("stores and serves a cover", async () => {
    const book = await json("POST", "/api/audiobooks", { title: "Covered" });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const put = await call({
      method: "PUT",
      url: `/api/audiobooks/${book.id}/cover`,
      headers: { "content-type": "image/png" },
      payload: png,
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().cover_path).toMatch(/\.png$/);
    const get = await call({ method: "GET", url: `/api/audiobooks/${book.id}/cover` });
    expect(get.statusCode).toBe(200);
    expect(get.headers["content-type"]).toBe("image/png");
    expect(get.rawPayload.equals(png)).toBe(true);
  });

  it("filters by project and moves chapter stories with the book", async () => {
    const project = app.soundbox.createProject("Audiobook project");
    const inside = await json("POST", "/api/audiobooks", { title: "Inside", project_id: project.id });
    const outside = await json("POST", "/api/audiobooks", { title: "Outside" });
    expect((await json("GET", `/api/stories/${inside.chapters[0].story_id}`)).project_id).toBe(project.id);

    const scoped = await json<any[]>("GET", `/api/audiobooks?project_id=${project.id}`);
    expect(scoped.map((b) => b.id)).toEqual([inside.id]);
    const none = await json<any[]>("GET", "/api/audiobooks?project_id=none");
    expect(none.some((b) => b.id === outside.id)).toBe(true);
    expect(none.some((b) => b.id === inside.id)).toBe(false);

    // Moving a book moves its chapters' stories.
    await json("PATCH", `/api/audiobooks/${outside.id}`, { project_id: project.id });
    expect((await json("GET", `/api/stories/${outside.chapters[0].story_id}`)).project_id).toBe(project.id);
    expect((await json<any[]>("GET", `/api/audiobooks?project_id=${project.id}`)).length).toBe(2);
    await json("PATCH", `/api/audiobooks/${outside.id}`, { project_id: null });
    expect((await json("GET", `/api/stories/${outside.chapters[0].story_id}`)).project_id ?? null).toBeNull();
  });

  it("deletes a book and its chapter stories", async () => {
    const book = await json("POST", "/api/audiobooks", { title: "Doomed" });
    const storyId = book.chapters[0].story_id;
    const del = await call({ method: "DELETE", url: `/api/audiobooks/${book.id}` });
    expect(del.statusCode).toBe(204);
    expect((await call({ method: "GET", url: `/api/audiobooks/${book.id}` })).statusCode).toBe(404);
    expect((await call({ method: "GET", url: `/api/stories/${storyId}` })).statusCode).toBe(404);
  });
});

describe("createBookFromManuscript", () => {
  it("builds chapters, paragraphs and headings", async () => {
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript, {
      cast_mode: "multi",
    });
    expect(book.title).toBe("The Lighthouse Keeper");
    expect(book.author).toBe("A. Writer");
    expect(book.settings.cast_mode).toBe("multi");
    expect(book.chapters.map((c) => [c.title, c.kind, c.included])).toEqual([
      ["Copyright", "front_matter", false],
      ["Chapter One", "chapter", true],
      ["Chapter Two", "chapter", true],
    ]);

    // Chapter One gets its title as a heading paragraph.
    const one = await json<any[]>(
      "GET",
      `/api/audiobooks/${book.id}/chapters/${book.chapters[1].id}/paragraphs`,
    );
    expect(one.map((p) => p.text)).toEqual([
      "Chapter One",
      "The lamp turned all night.",
      '"Is anyone there?" asked Mara.',
      "Nobody answered the lamp.",
    ]);
    expect(one[0].is_heading).toBe(true);
    expect(one[1].is_heading).toBe(false);
    expect(one.every((p) => p.status === "unvoiced")).toBe(true);
    expect(one[1].chapter_id).toBe(book.chapters[1].id);

    // Chapter Two already starts with its title: no duplicate.
    const two = audiobooks(app.soundbox).getParagraphs(book.chapters[2].id)!;
    expect(two.map((p) => p.text)).toEqual(["Chapter Two", "Morning came with the lamp still lit."]);
    expect(two[0].is_heading).toBe(true);

    // Front matter gets no heading.
    const front = audiobooks(app.soundbox).getParagraphs(book.chapters[0].id)!;
    expect(front.map((p) => p.text)).toEqual(["All rights reserved."]);
  });
});

describe("scene breaks", () => {
  it("become pauses of scene_break_s at each break", async () => {
    const book = await audiobooks(app.soundbox).createBookFromManuscript(
      {
        ...manuscript,
        sections: [
          {
            title: "Chapter One",
            kind: "chapter",
            included: true,
            // Empty paragraph at 2 is dropped; the breaks still land right.
            paragraphs: ["First.", "Second.", "   ", "Third.", "Fourth."],
            breaks: [0, 3, 4],
          },
        ],
      },
      { pacing: { scene_break_s: 3.5 } },
    );
    const paras = audiobooks(app.soundbox).getParagraphs(book.chapters[0]!.id)!;
    expect(paras.map((p) => (p.kind === "pause" ? `pause ${p.duration_s}` : p.text))).toEqual([
      "Chapter One",
      "First.",
      "Second.",
      "pause 3.5",
      "Third.",
      "pause 3.5",
      "Fourth.",
    ]);
    // Pauses aren't counted as paragraphs to voice.
    expect(book.chapters[0]!.stats.paragraphs).toBe(5);

    // Default 2 s, and settable through PATCH.
    const plain = await audiobooks(app.soundbox).createBookFromManuscript({
      ...manuscript,
      sections: [{ title: "Two", kind: "chapter", included: true, paragraphs: ["A.", "B."], breaks: [1] }],
    });
    expect(plain.settings.pacing.scene_break_s).toBe(2);
    const p2 = audiobooks(app.soundbox).getParagraphs(plain.chapters[0]!.id)!;
    expect(p2.filter((p) => p.kind === "pause").map((p) => p.duration_s)).toEqual([2]);
    const patched = await json("PATCH", `/api/audiobooks/${plain.id}`, { settings: { pacing: { scene_break_s: 1.25 } } });
    expect(patched.settings.pacing.scene_break_s).toBe(1.25);
  });
});

describe("chapters", () => {
  it("adds, renames, reorders and deletes", async () => {
    const book = await json("POST", "/api/audiobooks", { title: "Chapters" });
    const a = book.chapters[0];
    const b = await json("POST", `/api/audiobooks/${book.id}/chapters`, {
      title: "Second",
      paragraphs: ["One.", "Two."],
    });
    const c = await json("POST", `/api/audiobooks/${book.id}/chapters`, {
      title: "Dedication",
      kind: "front_matter",
      position: 0,
    });
    let detail = await json("GET", `/api/audiobooks/${book.id}`);
    expect(detail.chapters.map((x: any) => x.id)).toEqual([c.id, a.id, b.id]);
    expect(detail.chapters[2].stats.paragraphs).toBe(2);

    const renamed = await json("PATCH", `/api/audiobooks/${book.id}/chapters/${b.id}`, {
      title: "Two",
      included: false,
    });
    expect(renamed.title).toBe("Two");
    expect(renamed.included).toBe(false);
    // The story's title follows, so the studio shows the same name.
    expect((await json("GET", `/api/stories/${b.story_id}`)).title).toBe("Two");

    const order = await json<any[]>("POST", `/api/audiobooks/${book.id}/chapters/reorder`, {
      ids: [a.id, b.id, c.id],
    });
    expect(order.map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    const bad = await call({
      method: "POST",
      url: `/api/audiobooks/${book.id}/chapters/reorder`,
      payload: { ids: [a.id] },
    });
    expect(bad.statusCode).toBe(422);

    const del = await call({ method: "DELETE", url: `/api/audiobooks/${book.id}/chapters/${b.id}` });
    expect(del.statusCode).toBe(204);
    expect((await call({ method: "GET", url: `/api/stories/${b.story_id}` })).statusCode).toBe(404);
    detail = await json("GET", `/api/audiobooks/${book.id}`);
    expect(detail.chapters.map((x: any) => [x.id, x.position])).toEqual([
      [a.id, 0],
      [c.id, 1],
    ]);
  });

  it("404s a chapter of another book", async () => {
    const one = await json("POST", "/api/audiobooks", { title: "One" });
    const two = await json("POST", "/api/audiobooks", { title: "Two" });
    const res = await call({
      method: "GET",
      url: `/api/audiobooks/${one.id}/chapters/${two.chapters[0].id}/paragraphs`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("paragraphs", () => {
  it("tracks voiced, stale and locked", async () => {
    const book = await json("POST", "/api/audiobooks", { title: "Status" });
    const chapter = book.chapters[0];
    const p = await json("POST", `/api/audiobooks/${book.id}/chapters/${chapter.id}/paragraphs`, {
      text: "The sea was calm.",
    });
    expect(p.status).toBe("unvoiced");

    // Voice it: point the segment at a sound, as a generation would.
    app.soundbox.updateSegment(p.id, { sound_id: fakeSound() });
    let list = await json<any[]>("GET", `/api/audiobooks/${book.id}/chapters/${chapter.id}/paragraphs`);
    expect(list[0].status).toBe("voiced");

    // Edit the text: the take no longer matches.
    await json("PATCH", `/api/audiobooks/${book.id}/paragraphs/${p.id}`, { text: "The sea was rough." });
    list = await json<any[]>("GET", `/api/audiobooks/${book.id}/chapters/${chapter.id}/paragraphs`);
    expect(list[0].status).toBe("stale");
    let detail = await json("GET", `/api/audiobooks/${book.id}`);
    expect(detail.stats.stale).toBe(1);
    expect(detail.chapters[0].status).toBe("voiced");

    // A new take clears it.
    app.soundbox.updateSegment(p.id, { sound_id: fakeSound() });
    expect(audiobooks(app.soundbox).getParagraph(p.id)!.status).toBe("voiced");

    // Marked stale (a pronunciation changed) until the next take.
    expect(audiobooks(app.soundbox).markStale([p.id])).toBe(1);
    expect(audiobooks(app.soundbox).getParagraph(p.id)!.status).toBe("stale");
    app.soundbox.updateSegment(p.id, { sound_id: fakeSound() });
    expect(audiobooks(app.soundbox).getParagraph(p.id)!.status).toBe("voiced");

    // Locked: status says so, and text edits are refused until unlocked.
    const locked = await json("PATCH", `/api/audiobooks/${book.id}/paragraphs/${p.id}`, { locked: true });
    expect(locked.status).toBe("locked");
    expect(locked.locked).toBe(true);
    const refused = await call({
      method: "PATCH",
      url: `/api/audiobooks/${book.id}/paragraphs/${p.id}`,
      payload: { text: "Changed" },
    });
    expect(refused.statusCode).toBe(400);
    detail = await json("GET", `/api/audiobooks/${book.id}`);
    expect(detail.stats.locked).toBe(1);
    expect(detail.stats.duration_s).toBe(2.5);

    const unlocked = await json("PATCH", `/api/audiobooks/${book.id}/paragraphs/${p.id}`, {
      locked: false,
      text: "Changed",
    });
    expect(unlocked.status).toBe("stale");
  });

  it("casts characters and writes their voices onto segments", async () => {
    const narrator = addVoice("narrator");
    const maraVoice = addVoice("mara");
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript, {
      narrator_voice_id: narrator,
      cast_mode: "multi",
    });
    const chapter = book.chapters[1];
    const paras = audiobooks(app.soundbox).getParagraphs(chapter.id)!;
    expect(paras[2]!.voice_id).toBe(narrator);
    expect(paras[2]!.speaker).toBe("Narrator");

    const mara = audiobooks(app.soundbox).createCharacter(book.id, { name: "Mara", voice_id: maraVoice });
    expect(mara.color).toBe(1);
    const cast = await json("POST", `/api/audiobooks/${book.id}/paragraphs/cast`, {
      segment_ids: [paras[2]!.id],
      character_id: mara.id,
    });
    expect(cast.changed).toBe(1);
    let p = audiobooks(app.soundbox).getParagraph(paras[2]!.id)!;
    expect(p.character_id).toBe(mara.id);
    expect(p.voice_id).toBe(maraVoice);
    expect(p.speaker).toBe("Mara");

    // Voiced, then the character's voice changes: new voice, stale take.
    app.soundbox.updateSegment(p.id, { sound_id: fakeSound() });
    const other = addVoice("mara-2");
    audiobooks(app.soundbox).updateCharacter(mara.id, { voice_id: other });
    p = audiobooks(app.soundbox).getParagraph(p.id)!;
    expect(p.voice_id).toBe(other);
    expect(p.status).toBe("stale");

    // Single cast: everyone reads in the narrator's voice.
    await json("PATCH", `/api/audiobooks/${book.id}`, { settings: { cast_mode: "single" } });
    expect(audiobooks(app.soundbox).getParagraph(p.id)!.voice_id).toBe(narrator);

    // Back to the narrator via PATCH with character_id null.
    const back = await json("PATCH", `/api/audiobooks/${book.id}/paragraphs/${p.id}`, {
      character_id: null,
    });
    expect(back.character_id).toBeNull();
    expect(back.speaker).toBe("Narrator");
  });

  it("stores a per-paragraph model override", async () => {
    const book = await json("POST", "/api/audiobooks", {
      title: "Models",
      settings: { model_id: "book-model" },
    });
    const cid = book.chapters[0].id;
    const p = await json("POST", `/api/audiobooks/${book.id}/chapters/${cid}/paragraphs`, {
      text: "Hi.",
    });
    expect(p.model_id).toBeNull();
    expect(audiobooks(app.soundbox).modelFor(p.id)).toBe("book-model");
    const set = await json("PATCH", `/api/audiobooks/${book.id}/paragraphs/${p.id}`, {
      model_id: "own-model",
    });
    expect(set.model_id).toBe("own-model");
    expect(audiobooks(app.soundbox).modelFor(p.id)).toBe("own-model");
    const cleared = await json("PATCH", `/api/audiobooks/${book.id}/paragraphs/${p.id}`, {
      model_id: null,
    });
    expect(cleared.model_id).toBeNull();
  });

  it("adds and deletes paragraphs", async () => {
    const book = await json("POST", "/api/audiobooks", { title: "Add" });
    const cid = book.chapters[0].id;
    const a = await json("POST", `/api/audiobooks/${book.id}/chapters/${cid}/paragraphs`, { text: "A" });
    await json("POST", `/api/audiobooks/${book.id}/chapters/${cid}/paragraphs`, { text: "C" });
    await json("POST", `/api/audiobooks/${book.id}/chapters/${cid}/paragraphs`, { text: "B", position: 1 });
    let list = await json<any[]>("GET", `/api/audiobooks/${book.id}/chapters/${cid}/paragraphs`);
    expect(list.map((p) => p.text)).toEqual(["A", "B", "C"]);
    await json("DELETE", `/api/audiobooks/${book.id}/paragraphs/${a.id}`);
    list = await json<any[]>("GET", `/api/audiobooks/${book.id}/chapters/${cid}/paragraphs`);
    expect(list.map((p) => p.text)).toEqual(["B", "C"]);
  });
});

describe("paragraph operations", () => {
  it("splits, merges back and reorders", async () => {
    const book = await json("POST", "/api/audiobooks", { title: "Ops" });
    const cid = book.chapters[0].id;
    const base = `/api/audiobooks/${book.id}`;
    const a = await json("POST", `${base}/chapters/${cid}/paragraphs`, {
      text: "First half. Second half.",
    });
    app.soundbox.updateSegment(a.id, { sound_id: fakeSound() });

    const split = await json("POST", `${base}/paragraphs/${a.id}/split`, { at: 11 });
    expect(split.first.text).toBe("First half.");
    expect(split.first.status).toBe("stale");
    expect(split.second.text).toBe("Second half.");
    expect(split.second.status).toBe("unvoiced");
    let list = await json<any[]>("GET", `${base}/chapters/${cid}/paragraphs`);
    expect(list.map((p) => p.text)).toEqual(["First half.", "Second half."]);

    const bad = await call({ method: "POST", url: `${base}/paragraphs/${a.id}/split`, payload: { at: 0 } });
    expect(bad.statusCode).toBe(422);

    const merged = await json("POST", `${base}/paragraphs/${a.id}/merge-next`, {});
    expect(merged.paragraph.text).toBe("First half. Second half.");
    expect(merged.removed_id).toBe(split.second.id);
    expect(merged.split_at).toBe(12);
    list = await json<any[]>("GET", `${base}/chapters/${cid}/paragraphs`);
    expect(list).toHaveLength(1);

    const last = await call({ method: "POST", url: `${base}/paragraphs/${a.id}/merge-next`, payload: {} });
    expect(last.statusCode).toBe(400);

    const b = await json("POST", `${base}/chapters/${cid}/paragraphs`, { text: "B" });
    const pause = await json("POST", `${base}/chapters/${cid}/paragraphs`, {
      kind: "pause",
      duration_s: 2,
    });
    expect(pause.kind).toBe("pause");
    expect(pause.duration_s).toBe(2);
    const order = await json<any[]>("POST", `${base}/chapters/${cid}/paragraphs/reorder`, {
      ids: [pause.id, b.id, a.id],
    });
    expect(order.map((p) => p.id)).toEqual([pause.id, b.id, a.id]);
    const wrong = await call({
      method: "POST",
      url: `${base}/chapters/${cid}/paragraphs/reorder`,
      payload: { ids: [a.id] },
    });
    expect(wrong.statusCode).toBe(422);
  });

  it("refuses to split a locked paragraph", async () => {
    const book = await json("POST", "/api/audiobooks", { title: "Locked ops" });
    const base = `/api/audiobooks/${book.id}`;
    const p = await json("POST", `${base}/chapters/${book.chapters[0].id}/paragraphs`, { text: "One two." });
    await json("PATCH", `${base}/paragraphs/${p.id}`, { locked: true });
    const res = await call({ method: "POST", url: `${base}/paragraphs/${p.id}/split`, payload: { at: 4 } });
    expect(res.statusCode).toBe(400);
  });
});

describe("review notes", () => {
  it("adds, resolves, filters, counts and follows a merge", async () => {
    const book = await json("POST", "/api/audiobooks", { title: "Notes" });
    const cid = book.chapters[0].id;
    const base = `/api/audiobooks/${book.id}`;
    const a = await json("POST", `${base}/chapters/${cid}/paragraphs`, { text: "One." });
    const b = await json("POST", `${base}/chapters/${cid}/paragraphs`, { text: "Two." });

    const n1 = await json("POST", `${base}/paragraphs/${a.id}/notes`, { body: "Too fast", at_s: 1.5 });
    expect(n1).toMatchObject({ body: "Too fast", at_s: 1.5, resolved: false, chapter_id: cid });
    const n2 = await json("POST", `${base}/paragraphs/${b.id}/notes`, { body: "Wrong name" });
    expect((await json("GET", base)).chapters[0].open_notes).toBe(2);
    expect((await json("GET", base)).stats.open_notes).toBe(2);

    const resolved = await json("PATCH", `${base}/notes/${n1.id}`, { resolved: true });
    expect(resolved.resolved).toBe(true);
    expect((await json<any[]>("GET", `${base}/notes?status=open`)).map((n) => n.id)).toEqual([n2.id]);
    expect((await json<any[]>("GET", `${base}/notes?status=resolved`)).map((n) => n.id)).toEqual([n1.id]);
    expect(await json<any[]>("GET", `${base}/notes?segment_id=${b.id}`)).toHaveLength(1);
    expect((await json("GET", base)).chapters[0].open_notes).toBe(1);

    // Merging b into a keeps b's note, now on a.
    await json("POST", `${base}/paragraphs/${a.id}/merge-next`, {});
    const all = await json<any[]>("GET", `${base}/notes`);
    expect(all.every((n) => n.segment_id === a.id)).toBe(true);
    expect(all).toHaveLength(2);

    await json("DELETE", `${base}/notes/${n2.id}`);
    expect(await json<any[]>("GET", `${base}/notes`)).toHaveLength(1);
    const bad = await call({ method: "POST", url: `${base}/paragraphs/${a.id}/notes`, payload: { body: " " } });
    expect(bad.statusCode).toBe(422);
  });
});

describe("snapshots", () => {
  it("saves, diffs and restores a version", async () => {
    const narrator = addVoice("snap-narrator");
    const book = await json("POST", "/api/audiobooks", {
      title: "Versions",
      settings: { narrator_voice_id: narrator, cast_mode: "multi" },
    });
    const base = `/api/audiobooks/${book.id}`;
    const cid = book.chapters[0].id;
    const a = await json("POST", `${base}/chapters/${cid}/paragraphs`, { text: "Alpha." });
    const b = await json("POST", `${base}/chapters/${cid}/paragraphs`, { text: "Beta." });
    const takeA = fakeSound();
    app.soundbox.updateSegment(a.id, { sound_id: takeA });
    const hero = audiobooks(app.soundbox).createCharacter(book.id, { name: "Hero" });
    await json("PATCH", `${base}/paragraphs/${b.id}`, { character_id: hero.id, locked: true });

    const snap = await json("POST", `${base}/snapshots`, { label: "Draft 1" });
    expect(snap).toMatchObject({ label: "Draft 1", chapters: 1, paragraphs: 2 });

    // Change things after the snapshot.
    await json("PATCH", base, { title: "Versions, revised" });
    await json("PATCH", `${base}/paragraphs/${a.id}`, { text: "Alpha, revised." });
    await json("PATCH", `${base}/paragraphs/${b.id}`, { locked: false });
    await json("DELETE", `${base}/paragraphs/${b.id}`);
    const c = await json("POST", `${base}/chapters/${cid}/paragraphs`, { text: "Gamma." });
    const extra = await json("POST", `${base}/chapters`, { title: "Added later" });
    audiobooks(app.soundbox).deleteCharacter(hero.id);
    app.soundbox.updateSegment(a.id, { sound_id: fakeSound() });

    const diff = await json(`GET`, `${base}/snapshots/${snap.id}/diff`);
    expect(diff.book).toEqual([{ field: "title", before: "Versions", after: "Versions, revised" }]);
    expect(diff.summary).toEqual({ added: 1, removed: 1, changed: 1 });
    const ch = diff.chapters.find((x: any) => x.chapter_id === cid);
    expect(ch.paragraphs).toEqual([
      { segment_id: a.id, status: "changed", before: "Alpha.", after: "Alpha, revised." },
      { segment_id: c.id, status: "added", before: null, after: "Gamma." },
      { segment_id: b.id, status: "removed", before: "Beta.", after: null },
    ]);
    expect(diff.chapters.find((x: any) => x.chapter_id === extra.id).status).toBe("added");

    const restored = await json("POST", `${base}/snapshots/${snap.id}/restore`, {});
    expect(restored.before.label).toBe("Before restoring “Draft 1”");
    expect(restored.book.title).toBe("Versions");
    expect(restored.book.chapters.map((x: any) => x.id)).toEqual([cid]);
    expect(restored.book.characters.map((x: any) => x.id)).toEqual([hero.id]);
    const paras = await json<any[]>("GET", `${base}/chapters/${cid}/paragraphs`);
    expect(paras.map((p) => [p.id, p.text])).toEqual([
      [a.id, "Alpha."],
      [b.id, "Beta."],
    ]);
    expect(paras[0].sound_id).toBe(takeA);
    expect(paras[0].status).toBe("voiced");
    expect(paras[1]).toMatchObject({ character_id: hero.id, locked: true, speaker: "Hero" });

    // Nothing differs any more; the pre-restore version is listed.
    const again = await json(`GET`, `${base}/snapshots/${snap.id}/diff`);
    expect(again.summary).toEqual({ added: 0, removed: 0, changed: 0 });
    const list = await json<any[]>("GET", `${base}/snapshots`);
    expect(list.map((s) => s.label)).toEqual(["Before restoring “Draft 1”", "Draft 1"]);

    await json("DELETE", `${base}/snapshots/${snap.id}`);
    expect(await json<any[]>("GET", `${base}/snapshots`)).toHaveLength(1);
  });
});

describe("duplicate and chapter from text", () => {
  it("makes a chapter from pasted text with the importer's cleanup", async () => {
    const book = await json("POST", "/api/audiobooks", { title: "Pasted" });
    const base = `/api/audiobooks/${book.id}`;
    const text = [
      "CHAPTER TWO",
      "",
      "The tide came in at",
      "dusk, and the harbour went quiet as a held breath.",
      "",
      "Nobody spoke. The bell rang once, a thin and tremu-",
      "lous note over the water.",
      "",
      "",
      "Part the Second",
      "",
      "Morning.",
    ].join("\n");
    const chapter = await json("POST", `${base}/chapters/from-text`, { text });
    expect(chapter.title).toBe("Chapter Two");
    const paras = await json<any[]>("GET", `${base}/chapters/${chapter.id}/paragraphs`);
    expect(paras.map((p) => p.text)).toEqual([
      "Chapter Two",
      "The tide came in at dusk, and the harbour went quiet as a held breath.",
      "Nobody spoke. The bell rang once, a thin and tremulous note over the water.",
      "Part the Second",
      "Morning.",
    ]);
    expect(paras.map((p) => p.is_heading)).toEqual([true, false, false, true, false]);

    const titled = await json("POST", `${base}/chapters/from-text`, {
      text: "Just one line of text that goes on for a little while.",
      title: "Interlude",
      position: 0,
    });
    expect(titled.title).toBe("Interlude");
    expect((await json("GET", base)).chapters[0].id).toBe(titled.id);

    const empty = await call({ method: "POST", url: `${base}/chapters/from-text`, payload: { text: "  \n\n " } });
    expect(empty.statusCode).toBe(400);
  });

  it("duplicates a book with its cast, casting and takes", async () => {
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript, { cast_mode: "multi" });
    const svc = audiobooks(app.soundbox);
    const mara = svc.createCharacter(book.id, { name: "Mara" });
    const paras = svc.getParagraphs(book.chapters[1].id)!;
    svc.setParagraphCharacter([paras[2]!.id], mara.id);
    const take = fakeSound();
    app.soundbox.updateSegment(paras[1]!.id, { sound_id: take });
    svc.updateParagraph(paras[3]!.id, { locked: true });

    const copy = await json("POST", `/api/audiobooks/${book.id}/duplicate`, {});
    expect(copy.title).toBe("The Lighthouse Keeper (copy)");
    expect(copy.id).not.toBe(book.id);
    expect(copy.chapters.map((c: any) => [c.title, c.kind, c.included])).toEqual(
      book.chapters.map((c) => [c.title, c.kind, c.included]),
    );
    expect(copy.characters.map((c: any) => c.name)).toEqual(["Mara"]);
    expect(copy.characters[0].id).not.toBe(mara.id);
    const copied = svc.getParagraphs(copy.chapters[1].id)!;
    expect(copied.map((p) => p.text)).toEqual(paras.map((p) => p.text));
    expect(copied[2]!.character_id).toBe(copy.characters[0].id);
    expect(copied[1]!.sound_id).toBe(take);
    expect(copied[1]!.status).toBe("voiced");
    expect(copied[3]!.locked).toBe(true);
    expect(copied[0]!.is_heading).toBe(true);

    expect(copy.chapters[1].stats.paragraphs).toBe(book.chapters[1].stats.paragraphs);

    // Deleting the copy keeps the original's shared take.
    await call({ method: "DELETE", url: `/api/audiobooks/${copy.id}` });
    expect(app.soundbox.db.getSound(take)).not.toBeNull();
    expect(svc.getParagraph(paras[1]!.id)!.sound_id).toBe(take);
  });
});

describe("duplicate with beds", () => {
  it("copies bed clips and track settings, and tells onDuplicate hooks", async () => {
    const svc = audiobooks(app.soundbox);
    const book = await json("POST", "/api/audiobooks", { title: "Bedded" });
    const chapter = book.chapters[0];
    const base = `/api/audiobooks/${book.id}`;
    await json("POST", `${base}/chapters/${chapter.id}/paragraphs`, { text: "One." });
    await json("POST", `${base}/chapters/${chapter.id}/paragraphs`, { text: "Two." });
    const bedSound = fakeSound();
    const bed = app.soundbox.createSegment(chapter.story_id, {
      text: "",
      sound_id: bedSound,
      track_index: 1,
      kind: "line",
      position: 1,
      start_s: 0.5,
      gain_db: -12,
      fade_in_s: 2,
    });
    app.soundbox.updateTrack(chapter.story_id, 1, { name: "Music", gain_db: -6, muted: false });

    let seen: { chapters: Map<string, string>; segments: Map<string, string> } | null = null;
    svc.onDuplicate((scope) => {
      if (scope.from_book_id === book.id) seen = scope;
    });

    const copy = await json("POST", `${base}/duplicate`, {});
    const story = copy.chapters[0].story_id;
    const segs = app.soundbox.listSegments(story);
    expect(segs.map((s) => [s.track_index, s.text])).toEqual([
      [0, "One."],
      [1, ""],
      [0, "Two."],
    ]);
    expect(segs[1]).toMatchObject({ sound_id: bedSound, start_s: 0.5, gain_db: -12, fade_in_s: 2 });
    const tracks = app.soundbox.listTracks(story);
    expect(tracks.find((t) => t.track_index === 1)).toMatchObject({ name: "Music", gain_db: -6 });

    // Paragraph view and stats still ignore the bed.
    expect(svc.getParagraphs(copy.chapters[0].id)!.map((p) => p.text)).toEqual(["One.", "Two."]);
    expect(copy.chapters[0].stats.paragraphs).toBe(2);

    expect(seen).not.toBeNull();
    expect(seen!.chapters.get(chapter.id)).toBe(copy.chapters[0].id);
    expect(seen!.segments.get(bed.id)).toBe(segs[1]!.id);
    expect(seen!.segments.size).toBe(3);
  });
});

describe("bed clips on other tracks", () => {
  it("are never paragraphs: not listed, counted, cast, replaced, reordered, noted, captured or restored away", async () => {
    const narrator = addVoice("bed-narrator");
    const book = await json("POST", "/api/audiobooks", {
      title: "Beds",
      settings: { narrator_voice_id: narrator },
    });
    const base = `/api/audiobooks/${book.id}`;
    const chapter = book.chapters[0];
    const a = await json("POST", `${base}/chapters/${chapter.id}/paragraphs`, { text: "The lamp turned." });
    const b = await json("POST", `${base}/chapters/${chapter.id}/paragraphs`, { text: "The sea was calm." });

    // A soundscape bed: a line clip with audio on track 1. Its text holds a
    // word find/replace would otherwise match.
    const bedSound = fakeSound();
    const bed = app.soundbox.createSegment(chapter.story_id, {
      text: "lamp",
      sound_id: bedSound,
      track_index: 1,
      kind: "line",
      position: 1,
    });
    const segments = () => app.soundbox.listSegments(chapter.story_id);
    const bedPosition = () => segments().findIndex((s) => s.id === bed.id);
    expect(bedPosition()).toBe(1);

    // Not listed.
    let list = await json<any[]>("GET", `${base}/chapters/${chapter.id}/paragraphs`);
    expect(list.map((p) => p.id)).toEqual([a.id, b.id]);

    // Not counted.
    let detail = await json("GET", base);
    expect(detail.chapters[0].stats).toMatchObject({ paragraphs: 2, voiced: 0, duration_s: 0 });
    expect(detail.chapters[0].status).toBe("empty");

    // Not a paragraph for the paragraph routes.
    for (const req of [
      { method: "PATCH", url: `${base}/paragraphs/${bed.id}`, payload: { locked: true } },
      { method: "POST", url: `${base}/paragraphs/${bed.id}/notes`, payload: { body: "x" } },
      { method: "POST", url: `${base}/paragraphs/${bed.id}/split`, payload: { at: 2 } },
      { method: "POST", url: `${base}/paragraphs/cast`, payload: { segment_ids: [bed.id], character_id: null } },
    ]) {
      expect((await call(req as any)).statusCode).toBe(404);
    }

    // Not cast: the narrator's voice and speaker never reach it.
    await json("PATCH", base, { settings: { narrator_voice_id: addVoice("bed-narrator-2") } });
    const after = segments().find((s) => s.id === bed.id)!;
    expect(after.voice_id ?? null).toBeNull();
    expect(after.speaker ?? null).toBeNull();

    // Not replaced.
    const replaced = await json("POST", `${base}/replace`, { find: "lamp", replace: "beacon" });
    expect(replaced.matches).toBe(1);
    expect(segments().find((s) => s.id === bed.id)!.text).toBe("lamp");

    // Not reordered: paragraph ids alone are the whole order, and the bed
    // keeps its slot.
    const reordered = await json<any[]>("POST", `${base}/chapters/${chapter.id}/paragraphs/reorder`, {
      ids: [b.id, a.id],
    });
    expect(reordered.map((p) => p.id)).toEqual([b.id, a.id]);
    expect(bedPosition()).toBe(1);
    const withBed = await call({
      method: "POST",
      url: `${base}/chapters/${chapter.id}/paragraphs/reorder`,
      payload: { ids: [a.id, bed.id, b.id] },
    });
    expect(withBed.statusCode).toBe(422);

    // Merge skips over it: the next paragraph is b's neighbour on track 0.
    const merged = await json("POST", `${base}/paragraphs/${b.id}/merge-next`, {});
    expect(merged.removed_id).toBe(a.id);
    expect(segments().some((s) => s.id === bed.id)).toBe(true);

    // Not captured, and not removed by a restore.
    const snap = await json("POST", `${base}/snapshots`, { label: "With bed" });
    expect(snap.paragraphs).toBe(1);
    const full = await json("GET", `${base}/snapshots/${snap.id}`);
    expect(full.data.chapters[0].paragraphs.map((p: any) => p.segment_id)).toEqual([b.id]);
    await json("POST", `${base}/chapters/${chapter.id}/paragraphs`, { text: "Added later." });
    const diff = await json("GET", `${base}/snapshots/${snap.id}/diff`);
    expect(diff.summary).toEqual({ added: 1, removed: 0, changed: 0 });
    await json("POST", `${base}/snapshots/${snap.id}/restore`, {});
    const bedAfter = segments().find((s) => s.id === bed.id);
    expect(bedAfter).toMatchObject({ track_index: 1, sound_id: bedSound, text: "lamp" });
    list = await json<any[]>("GET", `${base}/chapters/${chapter.id}/paragraphs`);
    expect(list.map((p) => p.id)).toEqual([b.id]);

    // Still not counted after all that.
    detail = await json("GET", base);
    expect(detail.chapters[0].stats.paragraphs).toBe(1);
    expect(detail.chapters[0].stats.duration_s).toBe(0);
  });
});

describe("find and replace", () => {
  it("replaces across chapters, skips locked paragraphs and reports counts", async () => {
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript);
    const one = audiobooks(app.soundbox).getParagraphs(book.chapters[1].id)!;
    // Lock "Nobody answered the lamp."
    audiobooks(app.soundbox).updateParagraph(one[3]!.id, { locked: true });

    const dry = await json("POST", `/api/audiobooks/${book.id}/replace`, {
      find: "lamp",
      replace: "beacon",
      dry_run: true,
    });
    expect(dry).toMatchObject({ matches: 2, paragraphs: 2, skipped_locked: 1, skipped_matches: 1 });
    expect(audiobooks(app.soundbox).getParagraphs(book.chapters[1].id)![1]!.text).toContain("lamp");

    const done = await json("POST", `/api/audiobooks/${book.id}/replace`, {
      find: "LAMP",
      replace: "beacon",
    });
    expect(done).toMatchObject({ matches: 2, paragraphs: 2, skipped_locked: 1, dry_run: false });
    const after = audiobooks(app.soundbox).getParagraphs(book.chapters[1].id)!;
    expect(after[1]!.text).toBe("The beacon turned all night.");
    expect(after[3]!.text).toBe("Nobody answered the lamp.");
    expect(audiobooks(app.soundbox).getParagraphs(book.chapters[2].id)![1]!.text).toBe(
      "Morning came with the beacon still lit.",
    );
  });

  it("honours whole word, case, regex and chapter scope", async () => {
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript);
    const whole = await json("POST", `/api/audiobooks/${book.id}/replace`, {
      find: "the",
      replace: "a",
      whole_word: true,
      case_sensitive: true,
      dry_run: true,
    });
    // "the lamp" in each chapter; "The" (case) and "there" (whole word) excluded.
    expect(whole.matches).toBe(2);

    const scoped = await json("POST", `/api/audiobooks/${book.id}/replace`, {
      find: "asked (\\w+)",
      replace: "said $1",
      regex: true,
      chapter_ids: [book.chapters[1].id],
    });
    expect(scoped.matches).toBe(1);
    const p = audiobooks(app.soundbox).getParagraphs(book.chapters[1].id)![2]!;
    expect(p.text).toBe('"Is anyone there?" said Mara.');

    const bad = await call({
      method: "POST",
      url: `/api/audiobooks/${book.id}/replace`,
      payload: { find: "(", regex: true },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("events", () => {
  it("publishes changes to subscribers", async () => {
    const service = audiobooks(app.soundbox);
    const book = await json("POST", "/api/audiobooks", { title: "Events" });
    const q = service.hub.subscribe(book.id);
    await json("POST", `/api/audiobooks/${book.id}/chapters`, { title: "Next" });
    const event = await q.next();
    expect(event.value).toEqual({ type: "chapters" });
    service.hub.publish(book.id, { type: "render", done: 1, total: 4 });
    expect((await q.next()).value).toMatchObject({ type: "render", done: 1 });
    service.hub.unsubscribe(book.id, q);
    expect(service.hub.watchers(book.id)).toBe(0);
  });

  it("404s the stream for a missing book", async () => {
    const res = await call({ method: "GET", url: "/api/audiobooks/missing/events" });
    expect(res.statusCode).toBe(404);
  });
});
