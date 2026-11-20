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

describe("beds in the export", () => {
  const BED_HZ = 100;

  /** A WAV sound of `fn(t)` for `seconds`, registered in the library. */
  function toneSound(seconds: number, fn: (t: number) => number): string {
    const out = new Float32Array(Math.round(seconds * RATE)).map((_, i) => fn(i / RATE));
    const id = randomUUID();
    writeWav(join(app.soundbox.config.paths.sounds, `${id}.wav`), [out], RATE);
    app.soundbox.db.insertSound(
      {
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
        name: "tone",
        size_bytes: 0,
        source: "api",
      },
      `${id}.wav`,
    );
    return id;
  }

  /** Amplitude of the `hz` component over [from, to) seconds (Goertzel). */
  function toneDb(ch: Float32Array, rate: number, hz: number, from: number, to: number): number {
    const a = Math.round(from * rate);
    const b = Math.round(to * rate);
    const w = (2 * Math.PI * hz) / rate;
    const coeff = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = a; i < b; i++) {
      const s0 = ch[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    return 20 * Math.log10((2 * Math.sqrt(power)) / (b - a) + 1e-12);
  }

  /** Narration 0-8 s and 16-24 s (1 kHz), a 100 Hz bed under it all, ducked 12 dB. */
  async function bedBook() {
    const book = await audiobooks(app.soundbox).createBookFromManuscript({
      ...manuscript,
      sections: [{ title: "Bedded", kind: "chapter", included: true, paragraphs: ["First.", "Second."] }],
    });
    const chapter = book.chapters[0];
    const [p1, p2] = audiobooks(app.soundbox).getParagraphs(chapter.id)!.filter((p) => p.text !== "Bedded");
    const voice = () => toneSound(8, (t) => 0.3 * Math.sin(2 * Math.PI * 1000 * t));
    app.soundbox.updateSegment(p1.id, { sound_id: voice(), start_s: 0, duration_s: 8 });
    app.soundbox.updateSegment(p2.id, { sound_id: voice(), start_s: 16, duration_s: 8 });
    const bedSound = toneSound(30, (t) => 0.1 * Math.sin(2 * Math.PI * BED_HZ * t));
    await json("POST", `/api/audiobooks/${book.id}/chapters/${chapter.id}/beds`, {
      sound_id: bedSound,
      kind: "music",
      loop: true,
      gain_db: 0,
      fade_in_s: 0,
      fade_out_s: 0,
      duck: { depth_db: 12 },
    });
    return { book, chapter };
  }

  async function exportWav(bookId: string, chapterId: string, includeBeds: boolean) {
    const { id } = await json("POST", `/api/audiobooks/${bookId}/exports`, {
      format: "wav",
      layout: "files",
      chapter_ids: [chapterId],
      mastering: "none",
      include_cover: false,
      include_transcripts: false,
      include_beds: includeBeds,
    });
    const done = await finished(bookId, id);
    expect(done.status, done.error).toBe("done");
    return decodeWav(readFileSync(done.path));
  }

  it("ducks the bed about depth dB under narration and leaves it up in gaps", async () => {
    const { book, chapter } = await bedBook();
    const { audio, sampleRate } = await exportWav(book.id, chapter.id, true);
    const under = toneDb(audio[0], sampleRate, BED_HZ, 3, 6);
    const gap = toneDb(audio[0], sampleRate, BED_HZ, 11, 13);
    expect(gap).toBeCloseTo(-20, 0); // 0.1 amplitude, untouched in the gap
    expect(gap - under).toBeGreaterThan(10.5);
    expect(gap - under).toBeLessThan(13.5);
    // Narration itself is not ducked.
    expect(toneDb(audio[0], sampleRate, 1000, 3, 6)).toBeCloseTo(20 * Math.log10(0.3), 0);
  });

  it("include_beds:false drops the bed", async () => {
    const { book, chapter } = await bedBook();
    const { audio, sampleRate } = await exportWav(book.id, chapter.id, false);
    expect(toneDb(audio[0], sampleRate, BED_HZ, 11, 13)).toBeLessThan(-80);
    expect(toneDb(audio[0], sampleRate, 1000, 3, 6)).toBeCloseTo(20 * Math.log10(0.3), 0);
  });

  it("the worker's mix matches the in-process mixStory exactly (beds ducked)", async () => {
    const { renderMix } = await import("../src/audiobook/export-mix.js");
    const { book, chapter } = await bedBook();
    const inline = app.soundbox.mixStory(chapter.story_id)!;
    const planned = app.soundbox.planMix(chapter.story_id)!;
    const viaPlan = renderMix(planned.plan);
    expect(viaPlan.sampleRate).toBe(inline.sampleRate);
    expect(viaPlan.audio.length).toBe(inline.audio.length);
    for (let c = 0; c < inline.audio.length; c++) {
      expect(viaPlan.audio[c].length).toBe(inline.audio[c].length);
      let worst = 0;
      for (let i = 0; i < inline.audio[c].length; i++) worst = Math.max(worst, Math.abs(viaPlan.audio[c][i] - inline.audio[c][i]));
      expect(worst).toBe(0);
    }
    expect(book.id).toBeTruthy();
  });

  it("files mix mono and stereo chapters to one layout across the book", async () => {
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript);
    voiceBook(book.id, 3); // mono narration everywhere
    // Chapter two gets a stereo bed: its mix would be stereo on its own.
    const ch2 = book.chapters[1];
    const id = randomUUID();
    const tone = new Float32Array(10 * RATE).map((_, i) => 0.05 * Math.sin(i / 30));
    writeWav(join(app.soundbox.config.paths.sounds, `${id}.wav`), [tone, tone], RATE);
    app.soundbox.db.insertSound(
      { id, created_at: new Date().toISOString(), model: "t", prompt: "", duration_s: 10, sample_rate: RATE, channels: 2, file: "", peaks: [], favorite: false, tags: [], name: "st", size_bytes: 0, source: "api" },
      `${id}.wav`,
    );
    await json("POST", `/api/audiobooks/${book.id}/chapters/${ch2.id}/beds`, { sound_id: id, kind: "music", loop: true, gain_db: 0 });
    const qc = await json<ChapterQc[]>("POST", `/api/audiobooks/${book.id}/master/analyze`, { mastering: "podcast" });
    expect(qc.map((c) => c.report.channels)).toEqual([1, 1]);
    expect(qc.every((c) => c.checks.find((k) => k.id === "channels")!.pass)).toBe(true);
    const { id: eid } = await json("POST", `/api/audiobooks/${book.id}/exports`, {
      format: "wav", layout: "files", mastering: "podcast", include_cover: false, include_transcripts: false,
    });
    const done = await finished(book.id, eid);
    expect(done.status, done.error).toBe("done");
    const dl = await call({ method: "GET", url: `/api/audiobooks/${book.id}/exports/${eid}/download` });
    const names = zipNames(dl.rawPayload);
    for (const n of names) expect(decodeWav(zipFile(dl.rawPayload, n)).audio.length).toBe(1);
  });

  it("splits a chapter longer than the file limit, at a heading paragraph, with room tone on each part", async () => {
    const ex = audiobookExports(app.soundbox);
    const book = await audiobooks(app.soundbox).createBookFromManuscript({
      ...manuscript,
      sections: [{ title: "Long One", kind: "chapter", included: true, paragraphs: Array.from({ length: 8 }, (_, i) => `Para ${i}.`) }],
    });
    voiceBook(book.id, 9); // 8 x 9 s + gaps: about 76 s
    const chapter = book.chapters[0];
    const paras = audiobooks(app.soundbox).getParagraphs(chapter.id)!;
    // Mark the paragraph at about 40 s as the secondary header.
    const header = paras.find((p) => p.start_s >= 38)!;
    await json("PATCH", `/api/audiobooks/${book.id}/paragraphs/${header.id}`, { is_heading: true });
    const before = ex.maxFileS;
    ex.maxFileS = 50; // stand-in for 120 minutes
    try {
      const qc = await json<ChapterQc[]>("POST", `/api/audiobooks/${book.id}/master/analyze`, { mastering: "acx" });
      expect(qc[0].checks.find((c) => c.id === "secondary_header")!.pass).toBe(true);
      expect(qc[0].checks.find((c) => c.id === "max_length")!.message).toMatch(/Split into 2 files/);
      const { id } = await json("POST", `/api/audiobooks/${book.id}/exports`, {
        format: "wav", layout: "files", mastering: "acx", include_cover: false, include_transcripts: true,
      });
      const done = await finished(book.id, id);
      expect(done.status, done.error).toBe("done");
      const dl = await call({ method: "GET", url: `/api/audiobooks/${book.id}/exports/${id}/download` });
      const names = zipNames(dl.rawPayload).filter((n) => n.endsWith(".wav"));
      expect(names).toEqual(["01_Long One Part 1.wav", "02_Long One Part 2.wav"]);
      const { measure } = await import("../src/audio/meter.js");
      for (const n of names) {
        const { audio, sampleRate } = decodeWav(zipFile(dl.rawPayload, n));
        const r = measure(audio, sampleRate);
        expect(r.duration_s).toBeLessThanOrEqual(50 + 3);
        expect(r.head_silence_s).toBeGreaterThanOrEqual(0.5);
        expect(r.tail_silence_s).toBeGreaterThanOrEqual(1);
        expect(r.noise_floor_db).toBeGreaterThan(-100); // room tone, not zeros
      }
      // Part two's read-along starts with the header paragraph near its head.
      const along = JSON.parse(zipFile(dl.rawPayload, "read-along.json").toString());
      expect(along.chapters[1].paragraphs[0].segment_id).toBe(header.id);
      expect(along.chapters[1].paragraphs[0].start_s).toBeLessThan(1.5);
      // Split chapters are not handed to the player as one file.
      expect(exportedAudio(app.soundbox, book.id).has(chapter.id)).toBe(false);
    } finally {
      ex.maxFileS = before;
    }
  });

  it("a retail_sample chapter never carries the bed", async () => {
    const { book, chapter } = await bedBook();
    await json("PATCH", `/api/audiobooks/${book.id}/chapters/${chapter.id}`, { kind: "retail_sample" });
    const { audio, sampleRate } = await exportWav(book.id, chapter.id, true);
    expect(toneDb(audio[0], sampleRate, BED_HZ, 11, 13)).toBeLessThan(-80);
  });
});

describe("listen serves exported audio", () => {
  it("the listen manifest switches from the live mix to the mastered export, with its timings", async () => {
    const book = await audiobooks(app.soundbox).createBookFromManuscript(manuscript);
    voiceBook(book.id, 3);
    const before = await json("GET", `/api/audiobooks/${book.id}/listen`);
    expect(before.chapters.map((c: any) => c.source)).toEqual(["live", "live"]);

    const { id } = await json("POST", `/api/audiobooks/${book.id}/exports`, {
      format: "wav",
      layout: "files",
      mastering: "acx",
      include_cover: false,
      include_transcripts: false,
    });
    expect((await finished(book.id, id)).status).toBe("done");

    const after = await json("GET", `/api/audiobooks/${book.id}/listen`);
    const served = exportedAudio(app.soundbox, book.id);
    for (const chapter of after.chapters) {
      expect(chapter.source).toBe("export");
      const file = served.get(chapter.id)!;
      expect(chapter.duration_s).toBeCloseTo(file.duration_s, 2);
      // Paragraph times are the mastered file's, shifted by the head room tone.
      const voiced = chapter.paragraphs.filter((p: any) => p.start_s !== null);
      expect(voiced.map((p: any) => p.start_s)).toEqual(file.timings!.map((t) => t.start_s));
      const live = before.chapters.find((c: any) => c.id === chapter.id).paragraphs.find((p: any) => p.start_s !== null);
      expect(voiced[0].start_s).toBeGreaterThan(live.start_s);

      const res = await call({ method: "GET", url: chapter.audio_url });
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.equals(readFileSync(file.path))).toBe(true);
      expect(decodeWav(res.rawPayload).sampleRate).toBe(44_100);
    }
  });
});
