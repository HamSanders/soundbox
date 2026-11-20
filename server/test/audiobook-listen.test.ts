/**
 * Audiobook listening and publishing: the listen manifest, the live chapter
 * mix, progress, bookmarks, tags, the store checklist and the web player and
 * RSS exports. No models and no network: "voicing" a paragraph points its
 * segment at a sine-wave WAV written straight into the sounds folder.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { writeWav } from "../src/audio/dsp.js";
import { imageInfo } from "../src/audiobook/publish/checklist.js";
import { isoDuration, slug } from "../src/audiobook/publish/common.js";
import type { ListenManifest } from "../src/audiobook/publish/manifest.js";
import { listenStore } from "../src/audiobook/publish/store.js";
import { buildZip } from "../src/audiobook/publish/zip.js";
import { audiobooks, type BookDetail } from "../src/audiobook/service.js";
import type { Manuscript } from "../src/audiobook/types.js";
import { Config } from "../src/config.js";
import type { Sound } from "../src/schemas.js";

let app: FastifyInstance;
let dataDir: string;
const H = { "content-type": "application/json" };

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-audiobook-listen-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

const RATE = 8000;

/** A sine-wave sound row with a real WAV behind it. */
function sineSound(seconds: number, hz = 440): string {
  const id = randomUUID();
  const n = Math.round(seconds * RATE);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = 0.25 * Math.sin((2 * Math.PI * hz * i) / RATE);
  const file = `${id}.wav`;
  const size = writeWav(join(app.soundbox.config.paths.sounds, file), [samples], RATE);
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
    size_bytes: size,
    source: "api",
  };
  app.soundbox.db.insertSound(sound, file);
  return id;
}

function manuscript(title: string): Manuscript {
  return {
    title,
    subtitle: "A test",
    author: "A. Writer",
    language: "en",
    description: "A short test book.",
    isbn: null,
    publisher: null,
    publication_date: "2026-01-02",
    cover: null,
    warnings: [],
    sections: [
      { title: "Chapter One", kind: "chapter", included: true, paragraphs: ["The lamp turned.", "Nobody answered."] },
      { title: "Chapter Two", kind: "chapter", included: true, paragraphs: ["Morning came."] },
      { title: "Sample", kind: "retail_sample", included: true, paragraphs: ["A taste of the book."] },
      { title: "Copyright", kind: "front_matter", included: false, paragraphs: ["All rights reserved."] },
    ],
  };
}

async function newBook(title = "The Lighthouse"): Promise<BookDetail> {
  return audiobooks(app.soundbox).createBookFromManuscript(manuscript(title));
}

/** Voice every paragraph of a chapter: 1 s clips with a 0.5 s gap. */
function voiceChapter(chapterId: string, seconds = 1): void {
  const paragraphs = audiobooks(app.soundbox).getParagraphs(chapterId)!;
  let t = 0;
  for (const p of paragraphs) {
    app.soundbox.updateSegment(p.id, { sound_id: sineSound(seconds), start_s: t, duration_s: seconds });
    t += seconds + 0.5;
  }
}

describe("listen manifest", () => {
  it("lists listenable chapters with live timings and null timings for unvoiced text", async () => {
    const book = await newBook();
    const [one, two] = book.chapters.filter((c) => c.kind === "chapter");
    voiceChapter(one.id);

    const res = await app.inject({ method: "GET", url: `/api/audiobooks/${book.id}/listen` });
    expect(res.statusCode).toBe(200);
    const m = res.json() as ListenManifest;
    // Excluded front matter and the retail sample are not chapters to listen to.
    expect(m.chapters.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two"]);
    const c1 = m.chapters[0];
    expect(c1.source).toBe("live");
    expect(c1.audio_url).toContain(`/listen/chapters/${one.id}/audio`);
    // The importer opens each chapter with its title as a heading paragraph.
    expect(c1.paragraphs.map((p) => [p.text, p.start_s, p.end_s, p.is_heading])).toEqual([
      ["Chapter One", 0, 1, true],
      ["The lamp turned.", 1.5, 2.5, false],
      ["Nobody answered.", 3, 4, false],
    ]);
    expect(c1.duration_s).toBe(4);
    const c2 = m.chapters[1];
    expect(c2.id).toBe(two.id);
    expect(c2.audio_url).toBeNull();
    expect(c2.paragraphs[0].start_s).toBeNull();
    expect(m.duration_s).toBe(4);
    // No voiced retail sample: the preview is the opening of chapter one.
    expect(m.sample).toMatchObject({ chapter_id: one.id, from: "first_chapter", end_s: 4 });
    expect(m.word_timings).toBe(false);
    expect(m.cast[0]).toMatchObject({ role: "Narrator", character_id: null });
  });

  it("uses a voiced retail sample chapter for the preview", async () => {
    const book = await newBook("Sampled");
    const sample = book.chapters.find((c) => c.kind === "retail_sample")!;
    voiceChapter(sample.id);
    const m = (await app.inject({ method: "GET", url: `/api/audiobooks/${book.id}/listen` })).json() as ListenManifest;
    expect(m.sample).toMatchObject({ chapter_id: sample.id, from: "retail_sample" });
  });

  it("404s for an unknown book", async () => {
    const res = await app.inject({ method: "GET", url: `/api/audiobooks/nope/listen` });
    expect(res.statusCode).toBe(404);
  });
});

describe("chapter audio", () => {
  it("mixes the chapter to one WAV, caches it and serves byte ranges", async () => {
    const book = await newBook("Mixed");
    const one = book.chapters.find((c) => c.kind === "chapter")!;
    voiceChapter(one.id);
    const url = `/api/audiobooks/${book.id}/listen/chapters/${one.id}/audio`;

    const full = await app.inject({ method: "GET", url });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("audio/wav");
    expect(full.headers["accept-ranges"]).toBe("bytes");
    // 4 s at 8 kHz, 24-bit mono, plus the 44-byte header.
    expect(full.rawPayload.length).toBe(44 + 4 * RATE * 3);

    const part = await app.inject({ method: "GET", url, headers: { range: "bytes=0-99" } });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 0-99/${full.rawPayload.length}`);
    expect(part.rawPayload.length).toBe(100);

    const bad = await app.inject({ method: "GET", url, headers: { range: "bytes=999999999-" } });
    expect(bad.statusCode).toBe(416);
  });

  it("mixes beds on other tracks but keeps them out of the read-along", async () => {
    const book = await newBook("Bedded");
    const one = book.chapters.find((c) => c.kind === "chapter")!;
    voiceChapter(one.id);
    // A 6 s music bed under the narration, on track 1.
    app.soundbox.createSegment(one.story_id, {
      text: "Rain on the roof",
      track_index: 1,
      start_s: 0,
      sound_id: sineSound(6, 220),
      kind: "line",
    } as Parameters<typeof app.soundbox.createSegment>[1]);
    const m = (await app.inject({ method: "GET", url: `/api/audiobooks/${book.id}/listen` })).json() as ListenManifest;
    expect(m.chapters[0].paragraphs.map((p) => p.text)).not.toContain("Rain on the roof");
    expect(m.chapters[0].duration_s).toBe(4);
    const audio = await app.inject({ method: "GET", url: `/api/audiobooks/${book.id}/listen/chapters/${one.id}/audio` });
    // The mix runs to the end of the bed.
    expect(audio.rawPayload.length).toBe(44 + 6 * RATE * 3);
  });

  it("respects track mute, solo and gain", async () => {
    const book = await newBook("Faders");
    const one = book.chapters.find((c) => c.kind === "chapter")!;
    voiceChapter(one.id);
    app.soundbox.createSegment(one.story_id, {
      text: "",
      track_index: 1,
      start_s: 0,
      sound_id: sineSound(6, 220),
      kind: "line",
    } as Parameters<typeof app.soundbox.createSegment>[1]);
    const url = `/api/audiobooks/${book.id}/listen/chapters/${one.id}/audio`;
    const length = async () => (await app.inject({ method: "GET", url })).rawPayload.length;
    const peak = async () => {
      const wav = (await app.inject({ method: "GET", url })).rawPayload;
      let max = 0;
      for (let i = 44; i + 2 < wav.length; i += 3) max = Math.max(max, Math.abs(wav.readIntLE(i, 3)));
      return max / 0x7fffff;
    };
    expect(await length()).toBe(44 + 6 * RATE * 3);
    // Mute the bed: only the 4 s of narration is left.
    app.soundbox.updateTrack(one.story_id, 1, { muted: true });
    expect(await length()).toBe(44 + 4 * RATE * 3);
    // Solo the bed: only soloed tracks are heard, so the 6 s bed plays alone.
    app.soundbox.updateTrack(one.story_id, 1, { muted: false, soloed: true });
    expect(await length()).toBe(44 + 6 * RATE * 3);
    app.soundbox.updateTrack(one.story_id, 1, { soloed: false });
    // Pull narration down 12 dB and the bed off: the peak follows the fader.
    app.soundbox.updateTrack(one.story_id, 1, { muted: true });
    const loud = await peak();
    app.soundbox.updateTrack(one.story_id, 0, { gain_db: -12 });
    const quiet = await peak();
    expect(quiet / loud).toBeCloseTo(10 ** (-12 / 20), 2);
  });

  it("404s when nothing in the chapter is voiced", async () => {
    const book = await newBook("Silent");
    const one = book.chapters.find((c) => c.kind === "chapter")!;
    const res = await app.inject({ method: "GET", url: `/api/audiobooks/${book.id}/listen/chapters/${one.id}/audio` });
    expect(res.statusCode).toBe(404);
  });
});

describe("progress, bookmarks and tags", () => {
  it("saves and resumes a position, and marks a book finished", async () => {
    const book = await newBook("Progress");
    const one = book.chapters.find((c) => c.kind === "chapter")!;
    const url = `/api/audiobooks/${book.id}/progress`;
    expect((await app.inject({ method: "GET", url })).json()).toBeNull();

    const put = await app.inject({
      method: "PUT",
      url,
      headers: H,
      payload: { chapter_id: one.id, position_s: 12.5, speed: 1.35, book_position_s: 12.5 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ chapter_id: one.id, position_s: 12.5, speed: 1.35, finished_at: null });

    const done = await app.inject({ method: "PUT", url, headers: H, payload: { chapter_id: one.id, position_s: 0, finished: true } });
    expect(done.json().finished_at).toBeTruthy();
    // speed is kept when not sent
    expect(done.json().speed).toBe(1.35);

    const shelf = (await app.inject({ method: "GET", url: "/api/audiobooks/listen/shelf" })).json() as {
      id: string;
      progress: { finished_at: string | null } | null;
    }[];
    expect(shelf.find((b) => b.id === book.id)?.progress?.finished_at).toBeTruthy();

    const bad = await app.inject({ method: "PUT", url, headers: H, payload: { chapter_id: "nope", position_s: 1 } });
    expect(bad.statusCode).toBe(404);
    const slow = await app.inject({ method: "PUT", url, headers: H, payload: { chapter_id: one.id, position_s: 1, speed: 9 } });
    expect(slow.statusCode).toBe(422);
  });

  it("creates, edits and deletes bookmarks and notes", async () => {
    const book = await newBook("Marks");
    const one = book.chapters.find((c) => c.kind === "chapter")!;
    const url = `/api/audiobooks/${book.id}/bookmarks`;
    const created = await app.inject({ method: "POST", url, headers: H, payload: { chapter_id: one.id, position_s: 3 } });
    expect(created.statusCode).toBe(201);
    const mark = created.json();
    expect(mark).toMatchObject({ chapter_id: one.id, position_s: 3, note: "" });

    const patched = await app.inject({ method: "PATCH", url: `${url}/${mark.id}`, headers: H, payload: { note: "Lovely line" } });
    expect(patched.json().note).toBe("Lovely line");
    expect((await app.inject({ method: "GET", url })).json()).toHaveLength(1);

    const m = (await app.inject({ method: "GET", url: `/api/audiobooks/${book.id}/listen` })).json() as ListenManifest;
    expect(m.bookmarks[0].note).toBe("Lovely line");

    expect((await app.inject({ method: "DELETE", url: `${url}/${mark.id}`, headers: { "x-soundbox": "1" } })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url })).json()).toHaveLength(0);
    expect((await app.inject({ method: "DELETE", url: `${url}/${mark.id}`, headers: { "x-soundbox": "1" } })).statusCode).toBe(404);
  });

  it("sets shelf tags", async () => {
    const book = await newBook("Tagged");
    const res = await app.inject({
      method: "PUT",
      url: `/api/audiobooks/${book.id}/tags`,
      headers: H,
      payload: { tags: ["Slow burn", "Found family", "Slow burn", " "] },
    });
    expect(res.json().tags).toEqual(["Found family", "Slow burn"]);
    const shelf = (await app.inject({ method: "GET", url: "/api/audiobooks/listen/shelf" })).json() as { id: string; tags: string[] }[];
    expect(shelf.find((b) => b.id === book.id)?.tags).toEqual(["Found family", "Slow burn"]);
  });

  it("drops listening state with the book", async () => {
    const book = await newBook("Gone");
    const one = book.chapters.find((c) => c.kind === "chapter")!;
    listenStore(app.soundbox).setProgress(book.id, { chapter_id: one.id, position_s: 1 });
    listenStore(app.soundbox).addBookmark(book.id, { chapter_id: one.id, position_s: 1 });
    await audiobooks(app.soundbox).deleteBook(book.id);
    expect(listenStore(app.soundbox).getProgress(book.id)).toBeNull();
    expect(listenStore(app.soundbox).listBookmarks(book.id)).toEqual([]);
  });
});

describe("shelf", () => {
  it("reports duration and playable chapters per book", async () => {
    const book = await newBook("Shelved");
    const one = book.chapters.find((c) => c.kind === "chapter")!;
    voiceChapter(one.id);
    const shelf = (await app.inject({ method: "GET", url: "/api/audiobooks/listen/shelf" })).json() as {
      id: string;
      duration_s: number;
      chapters: number;
      playable_chapters: number;
    }[];
    const row = shelf.find((b) => b.id === book.id)!;
    expect(row).toMatchObject({ chapters: 2, playable_chapters: 1 });
    expect(row.duration_s).toBe(4);
  });
});

describe("publish", () => {
  it("builds a store checklist per target", async () => {
    const book = await newBook("Checklist");
    const res = await app.inject({ method: "GET", url: `/api/audiobooks/${book.id}/publish/checklist` });
    expect(res.statusCode).toBe(200);
    const targets = res.json() as { id: string; ready: boolean; items: { id: string; pass: boolean }[] }[];
    expect(targets.map((t) => t.id)).toEqual(["spotify", "apple_books", "read_along", "podcast_rss", "web_player"]);
    const spotify = targets[0];
    expect(spotify.ready).toBe(false);
    expect(spotify.items.find((i) => i.id === "cover")?.pass).toBe(false);
    expect(spotify.items.find((i) => i.id === "title")?.pass).toBe(true);
    expect(spotify.items.find((i) => i.id === "narrator")?.pass).toBe(false);
  });

  it("exports a self-contained web player with read-along data and JSON-LD", async () => {
    const book = await newBook("Web Player Book");
    const [one, two] = book.chapters.filter((c) => c.kind === "chapter");
    voiceChapter(one.id);
    voiceChapter(two.id, 2);
    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${book.id}/publish/webplayer`,
      headers: H,
      payload: { encoding: "wav" },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.files).toEqual(
      expect.arrayContaining([
        "index.html",
        "readalong.json",
        "book.jsonld",
        "audio/01-chapter-one.wav",
        "audio/02-chapter-two.wav",
      ]),
    );
    const html = readFileSync(join(out.dir, "index.html"), "utf8");
    // Book data and JSON-LD are inline, so the page works from file://.
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]);
    expect(ld).toMatchObject({
      "@type": "Audiobook",
      name: "Web Player Book",
      author: { name: "A. Writer" },
      duration: "PT9S",
      inLanguage: "en",
      datePublished: "2026-01-02",
    });
    expect(ld.hasPart).toHaveLength(2);
    expect(html).toContain('<script id="book" type="application/json">');
    expect(html).not.toMatch(/fetch\(/);
    const doc = JSON.parse(readFileSync(join(out.dir, "readalong.json"), "utf8"));
    expect(doc.chapters[1]).toMatchObject({ title: "Chapter Two", audio: "audio/02-chapter-two.wav", duration_s: 4.5 });
    expect(doc.chapters[0].paragraphs[2]).toMatchObject({ text: "Nobody answered.", start_s: 3, end_s: 4 });

    expect(existsSync(out.zip_path)).toBe(true);
    const zip = await app.inject({ method: "GET", url: out.download_url });
    expect(zip.statusCode).toBe(200);
    expect(zip.rawPayload.subarray(0, 4).toString("hex")).toBe("504b0304");
    const bad = await app.inject({ method: "GET", url: `/api/audiobooks/${book.id}/publish/files/..%2Fsoundbox.db` });
    expect(bad.statusCode).toBe(400);
  });

  it("refuses to publish a book with no audio", async () => {
    const book = await newBook("Empty");
    const res = await app.inject({ method: "POST", url: `/api/audiobooks/${book.id}/publish/webplayer`, headers: H, payload: { encoding: "wav" } });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("exports a serial podcast feed, one episode per chapter", async () => {
    const book = await newBook("Feed & Friends");
    const [one, two] = book.chapters.filter((c) => c.kind === "chapter");
    voiceChapter(one.id);
    voiceChapter(two.id);
    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${book.id}/publish/rss`,
      headers: H,
      payload: { base_url: "https://example.test/books/feed", encoding: "wav", zip: false },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.zip_path).toBeNull();
    const feed = readFileSync(join(out.dir, "feed.xml"), "utf8");
    expect(feed).toContain('xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"');
    expect(feed).toContain("<title>Feed &amp; Friends</title>");
    expect(feed).toContain("<itunes:type>serial</itunes:type>");
    expect(feed.match(/<item>/g)).toHaveLength(2);
    expect(feed).toContain('<enclosure url="https://example.test/books/feed/audio/01-chapter-one.wav"');
    expect(feed).toContain("<itunes:episode>2</itunes:episode>");
    expect(feed).toMatch(/<pubDate>Fri, 02 Jan 2026 00:00:00 \+0000<\/pubDate>/);
    expect(out.warnings.join(" ")).toMatch(/cover art/);

    const bad = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${book.id}/publish/rss`,
      headers: H,
      payload: { base_url: "ftp://nope" },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("podcast feed validity", () => {
  /**
   * A structural check in the spirit of the W3C feed validator and Apple's
   * podcast requirements (https://podcasters.apple.com/support/823-podcast-requirements):
   * well-formed XML, RSS 2.0 with the itunes namespace, required channel and
   * item elements, enclosure url/length/type, unique GUIDs and enclosure URLs,
   * RFC 2822 dates, ASCII URLs, and itunes values from the allowed sets.
   */
  function validate(xmlText: string): string[] {
    const errors: string[] = [];
    // Well-formedness: every tag closes in order; entities are the five XML ones.
    const stack: string[] = [];
    const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
    const body = xmlText.replace(/^<\?xml[^>]*\?>\s*/, "");
    if (!/^<\?xml version="1.0" encoding="UTF-8"\?>/.test(xmlText)) errors.push("missing XML declaration");
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(body)) !== null) {
      const [, close, name, , self] = m;
      if (self) continue;
      if (close) {
        if (stack.pop() !== name) errors.push(`mismatched </${name}>`);
      } else stack.push(name);
    }
    if (stack.length) errors.push(`unclosed ${stack.join(",")}`);
    for (const ent of xmlText.match(/&[^;\s]*;?/g) ?? []) {
      if (!/^&(amp|lt|gt|quot|apos);$/.test(ent)) errors.push(`bad entity ${ent}`);
    }
    if (!/<rss version="2.0"[^>]*xmlns:itunes="http:\/\/www.itunes.com\/dtds\/podcast-1.0.dtd"/.test(xmlText)) {
      errors.push("rss 2.0 with itunes namespace");
    }
    const channel = xmlText.slice(xmlText.indexOf("<channel>"), xmlText.indexOf("<item>"));
    for (const tag of ["title", "link", "description", "language", "itunes:author", "itunes:explicit", "itunes:type"]) {
      if (!new RegExp(`<${tag}>[^<]+</${tag}>`).test(channel)) errors.push(`channel <${tag}>`);
    }
    if (!/<itunes:category text="[^"]+"/.test(channel)) errors.push("channel itunes:category");
    if (!/<itunes:explicit>(true|false)<\/itunes:explicit>/.test(channel)) errors.push("itunes:explicit value");
    if (!/<itunes:type>(episodic|serial)<\/itunes:type>/.test(channel)) errors.push("itunes:type value");
    const items = xmlText.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    if (items.length === 0) errors.push("no items");
    const guids = new Set<string>();
    const urls = new Set<string>();
    for (const item of items) {
      if (!/<title>[^<]+<\/title>/.test(item)) errors.push("item title");
      const enc = /<enclosure url="([^"]+)" length="(\d+)" type="(audio\/[\w+.-]+)"\/>/.exec(item);
      if (!enc) errors.push("item enclosure");
      else {
        if (!/^https?:\/\/[!-~]+$/.test(enc[1].replace(/&amp;/g, "&"))) errors.push(`non-ASCII or relative url ${enc[1]}`);
        if (Number(enc[2]) <= 0) errors.push("enclosure length");
        if (urls.has(enc[1])) errors.push("duplicate enclosure url");
        urls.add(enc[1]);
      }
      const guid = /<guid[^>]*>([^<]+)<\/guid>/.exec(item)?.[1];
      if (!guid) errors.push("item guid");
      else if (guids.has(guid)) errors.push("duplicate guid");
      else guids.add(guid);
      const date = /<pubDate>([^<]+)<\/pubDate>/.exec(item)?.[1];
      if (!date || !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/.test(date)) {
        errors.push(`pubDate ${date}`);
      }
      if (!/<itunes:duration>\d+<\/itunes:duration>/.test(item)) errors.push("itunes:duration");
      if (!/<itunes:episode>[1-9]\d*<\/itunes:episode>/.test(item)) errors.push("itunes:episode");
      if (!/<itunes:episodeType>(full|trailer|bonus)<\/itunes:episodeType>/.test(item)) errors.push("itunes:episodeType");
    }
    return errors;
  }

  it("passes the structural checks, including awkward titles", async () => {
    const book = await newBook("Q & A: <Tales> \"of\" O'Brien – Ü");
    const [one, two] = book.chapters.filter((c) => c.kind === "chapter");
    voiceChapter(one.id);
    voiceChapter(two.id);
    const png = Buffer.alloc(64);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(1400, 16);
    png.writeUInt32BE(1400, 20);
    await audiobooks(app.soundbox).setCover(book.id, png, "image/png");
    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${book.id}/publish/rss`,
      headers: H,
      payload: { base_url: "https://example.test/feeds/q-a", encoding: "wav", zip: false, owner_email: "owner@example.test" },
    });
    expect(res.statusCode).toBe(200);
    const feed = readFileSync(join(res.json().dir, "feed.xml"), "utf8");
    expect(validate(feed)).toEqual([]);
    expect(feed).toContain('<itunes:image href="https://example.test/feeds/q-a/cover.png"/>');
    expect(feed).toContain("<itunes:email>owner@example.test</itunes:email>");
  });

  it("the validator catches a broken feed", () => {
    expect(validate("<rss><channel><item></channel></rss>").length).toBeGreaterThan(0);
  });
});

describe("helpers", () => {
  it("formats ISO 8601 durations", () => {
    expect(isoDuration(0)).toBe("PT0S");
    expect(isoDuration(3725)).toBe("PT1H2M5S");
    expect(isoDuration(3600)).toBe("PT1H");
  });

  it("slugs to ASCII", () => {
    expect(slug("Les Misérables: Tome I")).toBe("les-miserables-tome-i");
    expect(slug("???")).toBe("book");
  });

  it("reads PNG and JPEG sizes", () => {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(3000, 16);
    png.writeUInt32BE(2999, 20);
    expect(imageInfo(png)).toEqual({ width: 3000, height: 2999, format: "png" });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0xb8, 0x0b, 0xb8, 0, 0, 0, 0, 0, 0]);
    expect(imageInfo(jpeg)).toEqual({ width: 3000, height: 3000, format: "jpeg" });
  });

  it("writes a readable zip", () => {
    const zip = buildZip([
      { name: "a.txt", source: Buffer.from("hello hello hello hello") },
      { name: "b.wav", source: Buffer.from("RIFF") },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(2);
  });
});
