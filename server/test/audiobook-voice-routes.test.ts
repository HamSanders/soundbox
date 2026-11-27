/**
 * Audiobook voice routes end to end, on core's real book service and a
 * stubbed TTS model (tone bursts, no download, no GPU).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import type { ModelInfo } from "../src/models/types.js";
import { fakeSpeech, SR, TTS } from "./audiobook-voice-helpers.js";

let app: FastifyInstance;
let dataDir: string;
let bookId: string;
let chapterId: string;
let storyId: string;
const spoken: string[] = [];

function call(opts: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }) {
  return app.inject({ ...opts, headers: { "x-soundbox": "1", ...(opts.headers ?? {}) } } as never);
}

async function json<T = any>(method: string, url: string, payload?: unknown): Promise<T> {
  const res = await call({ method, url, payload });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} -> ${res.statusCode} ${res.body}`);
  return res.body ? (res.json() as T) : (undefined as T);
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-ab-voice-routes-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
  const svc = app.soundbox;
  await svc.models.setAudiocppEnabled([TTS]);
  const real = svc.listModels.bind(svc);
  vi.spyOn(svc, "listModels").mockImplementation(async () =>
    (await real()).map((m): ModelInfo => (m.id === TTS ? { ...m, status: "loaded" } : m)),
  );
  vi.spyOn(svc.models, "load").mockResolvedValue({} as ModelInfo);
  vi.spyOn(svc.models.get(TTS), "speak").mockImplementation(async (text: string) => {
    spoken.push(text);
    return { audio: [fakeSpeech(text)], sampleRate: SR };
  });
  Object.defineProperty(svc.models.get(TTS), "loaded", { get: () => true, configurable: true });

  const book = await json("POST", "/api/audiobooks", { title: "Routes", settings: { model_id: TTS } });
  bookId = book.id;
  const chapter = await json("POST", `/api/audiobooks/${bookId}/chapters`, {
    title: "One",
    paragraphs: [
      "The lamp turned all night over Vexhra Point.",
      "“Is anyone there?” asked Mara.",
      "Nobody answered, and Vexhra stayed dark.",
    ],
  });
  chapterId = chapter.id;
  storyId = chapter.story_id;
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

const paragraphs = () => json<any[]>("GET", `/api/audiobooks/${bookId}/chapters/${chapterId}/paragraphs`);

async function waitFor<T>(f: () => Promise<T>, ok: (t: T) => boolean): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = await f();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out");
}

describe("audiobook voice routes", { timeout: 30_000 }, () => {
  it("detects characters with the heuristic and casts the line", async () => {
    const r = await json("POST", `/api/audiobooks/${bookId}/characters/detect`, {});
    expect(r.source).toBe("heuristic");
    expect(r.characters.map((c: any) => c.name)).toEqual(["Mara"]);
    const ps = await paragraphs();
    expect(ps[1].character_id).toBe(r.characters[0].id);
  });

  it("manages pronunciation rules, suggests terms, and round-trips PLS", async () => {
    const sug = await json<any[]>("POST", `/api/audiobooks/${bookId}/pronunciations/suggest`);
    expect(sug.map((s) => s.term)).toContain("Vexhra");
    const { rule } = await json("POST", `/api/audiobooks/${bookId}/pronunciations`, { term: "Vexhra", replacement: "VEX-ra" });
    expect((await json<any[]>("GET", `/api/audiobooks/${bookId}/pronunciations`)).map((r) => r.id)).toEqual([rule.id]);
    const pls = await call({ method: "GET", url: `/api/audiobooks/${bookId}/pronunciations/export.pls` });
    expect(pls.headers["content-type"]).toMatch(/pls\+xml/);
    expect(pls.body).toContain("<grapheme>Vexhra</grapheme><alias>VEX-ra</alias>");
    const imp = await call({
      method: "POST",
      url: `/api/pronunciations/import?filename=d.txt`,
      payload: "Mara = MAH-rah\n",
      headers: { "content-type": "text/plain" },
    });
    expect(imp.statusCode).toBe(200);
    expect(imp.json().added).toBe(1);
    expect((await json<any[]>("GET", "/api/pronunciations")).map((r) => r.term)).toEqual(["Mara"]);
  });

  it("renders the chapter with pronunciation applied, then marks changed paragraphs stale", async () => {
    const est = await json("GET", `/api/audiobooks/${bookId}/estimate?chapter_id=${chapterId}`);
    expect(est.chapters[0].to_voice).toBe(3);
    const run = await json("POST", `/api/audiobooks/${bookId}/render`, { scope: { kind: "chapter", chapter_id: chapterId } });
    const done = await waitFor(() => json("GET", `/api/audiobooks/${bookId}/renders/${run.id}`), (r) => r.status === "done");
    expect(done.done).toBe(3);
    expect(spoken).toContain("The lamp turned all night over VEX-ra Point.");
    // Dialogue-only casting: Mara reads the quote, the narrator the attribution.
    expect(spoken).toContain("Is anyone there?");
    expect(spoken).toContain("asked MAH-rah.");
    let ps = await paragraphs();
    expect(ps.map((p) => p.status)).toEqual(["voiced", "voiced", "voiced"]);
    expect(ps[1].start_s).toBeGreaterThan(ps[0].start_s);

    const rules = await json<any[]>("GET", `/api/audiobooks/${bookId}/pronunciations`);
    const upd = await json("PATCH", `/api/audiobooks/${bookId}/pronunciations/${rules[0].id}`, { replacement: "VEKS-rah" });
    expect(upd.stale).toBe(2);
    ps = await paragraphs();
    expect(ps.map((p) => p.status)).toEqual(["stale", "voiced", "stale"]);
  });

  it("never voices, counts or moves clips off the narration track", async () => {
    const bed = await json("POST", `/api/stories/${storyId}/segments`, { text: "", track_index: 1, start_s: 3.25 });
    const est = await json("GET", `/api/audiobooks/${bookId}/estimate?chapter_id=${chapterId}&overwrite=true`);
    expect(est.chapters[0].paragraphs).toBe(3);
    const before = spoken.length;
    const run = await json("POST", `/api/audiobooks/${bookId}/render`, { scope: { kind: "chapter", chapter_id: chapterId }, overwrite: true });
    const done = await waitFor(() => json("GET", `/api/audiobooks/${bookId}/renders/${run.id}`), (r) => r.status === "done");
    expect(done.total).toBe(3);
    // Three paragraphs; the cast one is two calls (quote, then attribution).
    expect(spoken.length - before).toBe(4);
    const after = (await json<any[]>("GET", `/api/stories/${storyId}/segments`)).find((x) => x.id === bed.id);
    expect(after.start_s).toBe(3.25);
    expect(after.track_index).toBe(1);
  });

  it("lists, restores and deletes takes", async () => {
    const sid = (await paragraphs())[0].id;
    const takesUrl = `/api/audiobooks/${bookId}/paragraphs/${sid}/takes`;
    const start = (await json<any[]>("GET", takesUrl)).length;
    const res = await call({ method: "POST", url: `/api/audiobooks/${bookId}/paragraphs/${sid}/generate`, payload: {} });
    expect(res.statusCode).toBe(202);
    expect(typeof res.json().job_id).toBe("string");
    const takes = await waitFor(() => json<any[]>("GET", takesUrl), (t) => t.length === start + 1);
    expect(takes[0].selected).toBe(true);
    const sel = await json("POST", `${takesUrl}/${takes[1].id}/select`);
    expect(sel.selected).toBe(true);
    const del = await call({ method: "DELETE", url: `${takesUrl}/${takes[0].id}` });
    expect(del.statusCode).toBe(204);
    expect(await json<any[]>("GET", takesUrl)).toHaveLength(start);
  });

  it("regenerates a selection and reports the plan", async () => {
    const sid = (await paragraphs())[2].id;
    // "Nobody answered," ends at a comma pause.
    const r = await json("POST", `/api/audiobooks/${bookId}/paragraphs/${sid}/generate`, { range: { start: 0, end: 15 } });
    expect(r.plan.mode).toBe("words");
    expect(r.take.origin).toBe("selection");
  });

  it("pauses and cancels runs and 404s other books' runs", async () => {
    const run = await json("POST", `/api/audiobooks/${bookId}/render`, { overwrite: true });
    await json("POST", `/api/audiobooks/${bookId}/renders/${run.id}/cancel`);
    const r = await waitFor(() => json("GET", `/api/audiobooks/${bookId}/renders/${run.id}`), (x) => x.status === "cancelled");
    expect(r.status).toBe("cancelled");
    expect((await call({ method: "GET", url: `/api/audiobooks/nope/renders/${run.id}` })).statusCode).toBe(404);
    const list = await json<any[]>("GET", `/api/audiobooks/${bookId}/renders`);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0].queue).toBeUndefined();
  });

  it("refuses the ASR word check with no ASR model installed", async () => {
    const res = await call({ method: "POST", url: `/api/audiobooks/${bookId}/render`, payload: { asr_check: true } });
    expect(res.statusCode).toBe(409);
  });

  it("keeps takes while the book is in the trash, and drops them when it is deleted for good", async () => {
    const sid = (await paragraphs())[0].id;
    const count = () =>
      (app.soundbox.db.sqlite.prepare("SELECT COUNT(*) AS n FROM segment_takes WHERE segment_id = ?").get(sid) as { n: number }).n;
    const before = count();
    expect(before).toBeGreaterThan(0);
    await json("DELETE", `/api/audiobooks/${bookId}`);
    expect(count()).toBe(before);
    await json("DELETE", `/api/trash/book/${bookId}`);
    expect(count()).toBe(0);
  });
});
