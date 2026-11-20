/**
 * Audiobook export end to end over HTTP against a temp data directory. No
 * models: each paragraph is "voiced" by writing a synthetic narration WAV and
 * pointing its segment at it, as a generation would.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

import { buildApp } from "../src/app.js";
import { decodeWav, writeWav } from "../src/audio/dsp.js";
import { prng } from "../src/audio/master.js";
import { audiobookExports } from "../src/audiobook/export.js";
import { exportedAudio } from "../src/audiobook/publish/manifest.js";
import { audiobooks } from "../src/audiobook/service.js";
import type { ChapterQc, Manuscript } from "../src/audiobook/types.js";
import { Config } from "../src/config.js";
import type { Sound } from "../src/schemas.js";

const HAS_FFMPEG = spawnSync("ffmpeg", ["-hide_banner", "-version"], { windowsHide: true }).status === 0;
const RATE = 24_000;

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-audiobook-export-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
});

afterAll(async () => {
  await audiobookExports(app.soundbox).idle();
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

function call(opts: Parameters<FastifyInstance["inject"]>[0] & object) {
  const o = opts as { headers?: Record<string, string> };
  return app.inject({ ...(opts as object), headers: { "x-soundbox": "1", ...(o.headers ?? {}) } } as never);
}

async function json<T = any>(method: string, url: string, payload?: unknown): Promise<T> {
  const res = await call({ method: method as "GET", url, payload: payload as object });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} -> ${res.statusCode} ${res.body}`);
  return res.body ? (res.json() as T) : (undefined as T);
}

let seed = 1;
/** A quiet TTS-like line: modulated tone "words", digital-zero edges. */
function voiceLine(seconds: number): string {
  const rand = prng(seed++);
  const out = new Float32Array(Math.round(seconds * RATE));
  let t = 0.05;
  while (t < seconds - 0.1) {
    const word = 0.15 + rand() * 0.2;
    const from = Math.round(t * RATE);
    const to = Math.min(out.length, Math.round((t + word) * RATE));
    const f = 160 + rand() * 140;
    for (let i = from; i < to; i++) {
      out[i] = 0.08 * Math.sin((Math.PI * (i - from)) / (to - from)) * Math.sin((2 * Math.PI * f * i) / RATE);
    }
    t += word + 0.07;
  }
  const id = randomUUID();
  const file = `${id}.wav`;
  writeWav(join(app.soundbox.config.paths.sounds, file), [out], RATE);
  const sound: Sound = {
    id,
    created_at: new Date().toISOString(),
    model: "test",
    prompt: "",
    duration_s: seconds,
    sample_rate: RATE,
    channels: 1,
    file: "",
    peaks: [],
    favorite: false,
    tags: [],
    name: "take",
    size_bytes: 0,
    source: "api",
  };
  app.soundbox.db.insertSound(sound, file);
  return id;
}

const manuscript: Manuscript = {
  title: "The Lighthouse Keeper",
  subtitle: "A Story",
  author: "A. Writer",
  language: "en",
  description: null,
  isbn: null,
  publisher: null,
  publication_date: "2026-01-01",
  cover: null,
  warnings: [],
  sections: [
    { title: "Chapter One", kind: "chapter", included: true, paragraphs: Array.from({ length: 8 }, (_, i) => `One, paragraph ${i}.`) },
    { title: "Chapter Two", kind: "chapter", included: true, paragraphs: ["The lamp turned.", "Morning came."] },
  ],
};

/** Voice every paragraph of every chapter, laid end to end with a gap. */
function voiceBook(bookId: string, lengthS = 9): void {
  const ab = audiobooks(app.soundbox);
  for (const chapter of ab.getBook(bookId)!.chapters) {
    let at = 0;
    for (const p of ab.getParagraphs(chapter.id)!) {
      app.soundbox.updateSegment(p.id, { sound_id: voiceLine(lengthS), start_s: at, duration_s: lengthS });
      at += lengthS + 0.5;
    }
  }
}

async function finished(bookId: string, exportId: string) {
  await audiobookExports(app.soundbox).idle();
  return json("GET", `/api/audiobooks/${bookId}/exports/${exportId}`);
}

describe("analyze", () => {
  it("reports ACX pass/fail per chapter, and flags chapters without audio", async () => {
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript);
    const before = await json<ChapterQc[]>("POST", `/api/audiobooks/${book.id}/master/analyze`, { mastering: "acx" });
    expect(before).toHaveLength(2);
    expect(before[0].checks[0]).toMatchObject({ id: "audio", pass: false });

    voiceBook(book.id);
    const raw = await json<ChapterQc[]>("POST", `/api/audiobooks/${book.id}/master/analyze`, { mastering: "none" });
    // TTS-level audio, digital-zero pauses: fails ACX untouched.
    const failed = raw[0].checks.filter((c) => !c.pass).map((c) => c.id);
    expect(failed).toContain("digital_silence");
    expect(failed).toContain("sample_rate");

    const qc = await json<ChapterQc[]>("POST", `/api/audiobooks/${book.id}/master/analyze`, { mastering: "acx" });
    for (const chapter of qc) {
      expect(chapter.checks.filter((c) => !c.pass)).toEqual([]);
      expect(chapter.report.rms_db).toBeGreaterThanOrEqual(-23);
      expect(chapter.report.rms_db).toBeLessThanOrEqual(-18);
      expect(chapter.report.peak_dbfs).toBeLessThanOrEqual(-3);
      expect(chapter.report.noise_floor_db).toBeLessThanOrEqual(-60);
      expect(chapter.report.sample_rate).toBe(44_100);
      expect(chapter.report.channels).toBe(1);
    }
  });
});

describe("timings", () => {
  it("returns paragraph timings shifted by the master's room tone", async () => {
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript);
    voiceBook(book.id);
    const chapter = book.chapters[1];
    const raw = await json<any[]>("GET", `/api/audiobooks/${book.id}/chapters/${chapter.id}/timings`);
    expect(raw.map((t) => t.text)).toEqual(["Chapter Two", "The lamp turned.", "Morning came."].slice(-raw.length));
    await json("POST", `/api/audiobooks/${book.id}/master/analyze`, { mastering: "acx", chapter_ids: [chapter.id] });
    const after = await json<any[]>("GET", `/api/audiobooks/${book.id}/chapters/${chapter.id}/timings`);
    expect(after[0].start_s).toBeGreaterThan(raw[0].start_s);
    // Speech starts 50 ms into the fixture clip, so the clip itself lands at 0.70.
    expect(after[0].start_s).toBeCloseTo(0.7, 2);
  });
});

describe("export", () => {
  it("WAV files layout: ACX names, zip with captions and read-along", async () => {
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript);
    voiceBook(book.id, 4);
    const res = await call({
      method: "POST",
      url: `/api/audiobooks/${book.id}/exports`,
      payload: { format: "wav", layout: "files", mastering: "acx", include_cover: false, include_transcripts: true },
    });
    expect(res.statusCode).toBe(202);
    const done = await finished(book.id, res.json().id);
    expect(done.status, done.error).toBe("done");
    expect(done.filename).toMatch(/\.zip$/);
    expect(done.qc).toHaveLength(2);

    const dl = await call({ method: "GET", url: `/api/audiobooks/${book.id}/exports/${done.id}/download` });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/zip");
    const names = zipNames(dl.rawPayload);
    expect(names).toEqual([
      "01_Chapter One.wav",
      "02_Chapter Two.wav",
      "01_Chapter One.srt",
      "01_Chapter One.vtt",
      "02_Chapter Two.srt",
      "02_Chapter Two.vtt",
      "read-along.json",
    ]);
    const wav = zipFile(dl.rawPayload, "01_Chapter One.wav");
    expect(wav.readUInt16LE(34)).toBe(16);
    const { sampleRate, audio } = decodeWav(wav);
    expect(sampleRate).toBe(44_100);
    expect(audio).toHaveLength(1);
    const along = JSON.parse(zipFile(dl.rawPayload, "read-along.json").toString());
    expect(along.chapters[0].paragraphs.length).toBeGreaterThan(0);

    const history = await json<any[]>("GET", `/api/audiobooks/${book.id}/exports`);
    expect(history[0].id).toBe(done.id);

    // Listen's player gets the mastered chapter files and their timings.
    const served = exportedAudio(app.soundbox, book.id);
    expect([...served.keys()].sort()).toEqual(book.chapters.map((c) => c.id).sort());
    const first = served.get(book.chapters[0].id)!;
    expect(first.mime).toBe("audio/wav");
    expect(decodeWav(readFileSync(first.path)).sampleRate).toBe(44_100);
    expect(first.timings!.length).toBeGreaterThan(0);
    expect(first.duration_s).toBeGreaterThan(30);
  });

  it("refuses formats that need ffmpeg when it is missing, with the reason", async () => {
    if (HAS_FFMPEG) return; // covered by the real encode below
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript);
    const res = await call({
      method: "POST",
      url: `/api/audiobooks/${book.id}/exports`,
      payload: { format: "mp3", layout: "files", mastering: "acx" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body).toMatch(/ffmpeg/);
  });

  it("reports ffmpeg status", async () => {
    const info = await json("GET", "/api/audiobooks/ffmpeg");
    expect(info.available).toBe(HAS_FFMPEG);
  });

  it.skipIf(!HAS_FFMPEG)("M4B single file with chapter markers", async () => {
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript);
    voiceBook(book.id, 3);
    const { id } = await json("POST", `/api/audiobooks/${book.id}/exports`, {
      format: "m4b",
      layout: "files", // m4b is always single
      mastering: "acx",
      include_cover: false,
      include_transcripts: false,
    });
    const done = await finished(book.id, id);
    expect(done.status, done.error).toBe("done");
    expect(done.request.layout).toBe("single");
    expect(done.filename).toMatch(/\.m4b$/);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_chapters", "-of", "json", done.path], {
      encoding: "utf8",
      windowsHide: true,
    });
    const chapters = JSON.parse(probe.stdout).chapters as { tags: { title: string }; start_time: string }[];
    expect(chapters.map((c) => c.tags.title)).toEqual(["Chapter One", "Chapter Two"]);
    expect(Number(chapters[1].start_time)).toBeGreaterThan(20);
  });
});

describe("credits and sample", () => {
  it("adds opening and closing credit chapters at the ends", async () => {
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript);
    const r = await json("POST", `/api/audiobooks/${book.id}/credits`, { opening: true, closing: true });
    expect(r.opening.kind).toBe("opening_credits");
    expect(r.closing.kind).toBe("closing_credits");
    const detail = audiobooks(app.soundbox).getBook(book.id)!;
    expect(detail.chapters.map((c) => c.kind)).toEqual(["opening_credits", "chapter", "chapter", "closing_credits"]);
    const opening = audiobooks(app.soundbox).getParagraphs(detail.chapters[0].id)!.map((p) => p.text);
    expect(opening).toEqual(["The Lighthouse Keeper.", "A Story.", "Written by A. Writer.", "Narrated by a digital voice."]);
    // Idempotent unless replace is asked for.
    const again = await json("POST", `/api/audiobooks/${book.id}/credits`, { opening: true });
    expect(again.opening.id).toBe(r.opening.id);
    expect(audiobooks(app.soundbox).getBook(book.id)!.chapters).toHaveLength(4);
  });

  it("cuts a retail sample of 1-5 minutes from narration only", async () => {
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript);
    voiceBook(book.id, 12); // 8 x 12 s + gaps in chapter one: about 100 s
    const r = await json("POST", `/api/audiobooks/${book.id}/credits`, { sample: { format: "wav", target_s: 90 } });
    const done = await finished(book.id, r.sample.id);
    expect(done.status, done.error).toBe("done");
    expect(done.kind).toBe("sample");
    const report = done.qc[0].report;
    expect(report.duration_s).toBeGreaterThanOrEqual(60);
    expect(report.duration_s).toBeLessThanOrEqual(300);
    expect(report.rms_db).toBeGreaterThanOrEqual(-23);
  });
});

/* -------------------------------------------------------- zip reading */

function* zipEntries(z: Buffer): Generator<{ name: string; data: Buffer }> {
  let o = 0;
  while (o + 4 <= z.length && z.readUInt32LE(o) === 0x04034b50) {
    const size = z.readUInt32LE(o + 18);
    const nameLen = z.readUInt16LE(o + 26);
    const extra = z.readUInt16LE(o + 28);
    const start = o + 30 + nameLen + extra;
    yield { name: z.subarray(o + 30, o + 30 + nameLen).toString(), data: z.subarray(start, start + size) };
    o = start + size;
  }
}

const zipNames = (z: Buffer) => [...zipEntries(z)].map((e) => e.name);
const zipFile = (z: Buffer, name: string) => [...zipEntries(z)].find((e) => e.name === name)!.data;
