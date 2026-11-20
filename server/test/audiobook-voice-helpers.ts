/**
 * Test helpers for the audiobook voice area: a stand-in for core's book
 * service (the `BookAccess` subset) over a real MirliService, and a stub TTS
 * model whose audio has word-like tone bursts with pauses at punctuation.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import type { BookAccess, BookParagraph } from "../src/audiobook/render-access.js";
import type { Book, Chapter, Character } from "../src/audiobook/types.js";
import { Config } from "../src/config.js";
import type { ModelInfo } from "../src/models/types.js";
import { segmentCreateSchema } from "../src/schemas.js";
import { MirliService } from "../src/service.js";

export const TTS = "audiocpp-kokoro";
export const SR = 24000;

/** Speech-like audio: 0.22 s tone per word, 30 ms between words (too short
 *  to cut at), 350 ms after , . ! ? and 200 ms of silence at each end. */
export function fakeSpeech(text: string, amp = 0.3): Float32Array {
  const parts: number[] = [];
  const silence = (s: number) => {
    for (let i = 0; i < Math.round(s * SR); i++) parts.push(0);
  };
  const tone = (s: number, f: number) => {
    for (let i = 0; i < Math.round(s * SR); i++) parts.push(amp * Math.sin((2 * Math.PI * f * i) / SR));
  };
  silence(0.2);
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  tokens.forEach((w, i) => {
    tone(0.22, 200 + (w.length % 7) * 40);
    if (i < tokens.length - 1) silence(/[,.!?;:]$/.test(w) ? 0.35 : 0.03);
  });
  silence(0.2);
  return Float32Array.from(parts);
}

export class FakeBook implements BookAccess {
  readonly events: { bookId: string; event: { type: string } & Record<string, unknown> }[] = [];
  readonly hub = {
    publish: (bookId: string, event: { type: string } & Record<string, unknown>) => this.events.push({ bookId, event }),
  };
  book: Book;
  chapters: Chapter[] = [];
  characters: Character[] = [];
  meta = new Map<string, { character_id: string | null; locked: boolean; is_heading: boolean; model_id: string | null; voiced_text: string | null; stale: boolean }>();
  voiced: { id: string; text: string }[] = [];

  constructor(private readonly svc: MirliService) {
    this.book = {
      id: "book1", project_id: null, title: "Test", subtitle: null, author: null, narrator: null,
      description: null, language: "en", genres: [], series: null, series_index: null, isbn: null,
      publisher: null, publication_date: null, cover_path: null, created_at: "", updated_at: "",
      settings: {
        model_id: TTS, narrator_voice_id: null, request_options: {}, mastering: "acx", cast_mode: "multi",
        pacing: { paragraph_gap_s: 0.5, heading_gap_s: 1.5, head_room_tone_s: 0.5, tail_room_tone_s: 2 },
      },
    };
  }

  addChapter(title: string, paragraphs: (string | { pause: number } | { text: string; heading?: boolean; locked?: boolean })[]): Chapter {
    const story = this.svc.createStory(title);
    const chapter: Chapter = { id: `ch${this.chapters.length + 1}`, book_id: "book1", story_id: story.id, position: this.chapters.length, title, kind: "chapter", included: true };
    this.chapters.push(chapter);
    for (const p of paragraphs) {
      if (typeof p === "object" && "pause" in p) {
        this.svc.createSegment(story.id, segmentCreateSchema.parse({ kind: "pause", duration_s: p.pause }));
        continue;
      }
      const text = typeof p === "string" ? p : p.text;
      const seg = this.svc.createSegment(story.id, segmentCreateSchema.parse({ text }));
      if (typeof p === "object") this.setMeta(seg.id, { is_heading: Boolean(p.heading), locked: Boolean(p.locked) });
    }
    return chapter;
  }

  setMeta(id: string, m: Partial<{ character_id: string | null; locked: boolean; is_heading: boolean; model_id: string | null }>) {
    const cur = this.meta.get(id) ?? { character_id: null, locked: false, is_heading: false, model_id: null, voiced_text: null, stale: false };
    this.meta.set(id, { ...cur, ...m });
  }

  getBook(id: string) {
    return id === this.book.id ? { ...this.book, chapters: this.chapters, characters: this.characters } : null;
  }
  updateBook(_id: string, fields: { settings?: { narrator_voice_id?: string | null } }) {
    Object.assign(this.book.settings, fields.settings ?? {});
    return this.book;
  }
  getChapter(id: string) {
    return this.chapters.find((c) => c.id === id) ?? null;
  }
  chapterForSegment(segmentId: string) {
    const seg = this.svc.getSegment(segmentId);
    return seg ? (this.chapters.find((c) => c.story_id === seg.story_id) ?? null) : null;
  }
  getParagraphs(chapterId: string): BookParagraph[] | null {
    const c = this.getChapter(chapterId);
    if (!c) return null;
    return this.svc.listSegments(c.story_id).map((s) => {
      const m = this.meta.get(s.id);
      const locked = m?.locked ?? false;
      const status = locked ? "locked" : s.kind === "pause" ? "voiced" : !s.sound_id ? "unvoiced" : m?.stale ? "stale" : "voiced";
      return {
        ...s, segment_id: s.id, chapter_id: chapterId, character_id: m?.character_id ?? null, locked,
        is_heading: m?.is_heading ?? false, model_id: m?.model_id ?? null, status,
      } as BookParagraph;
    });
  }
  getParagraph(segmentId: string) {
    const c = this.chapterForSegment(segmentId);
    return c ? (this.getParagraphs(c.id)!.find((p) => p.id === segmentId) ?? null) : null;
  }
  addParagraph(chapterId: string, fields: { text: string; position?: number | null; character_id?: string | null; is_heading?: boolean }) {
    const c = this.getChapter(chapterId)!;
    const seg = this.svc.createSegment(c.story_id, segmentCreateSchema.parse({ text: fields.text, position: fields.position ?? null }));
    this.setMeta(seg.id, { character_id: fields.character_id ?? null, is_heading: fields.is_heading ?? false });
    return this.getParagraph(seg.id)!;
  }
  updateParagraph(segmentId: string, fields: { text?: string; character_id?: string | null; locked?: boolean; is_heading?: boolean }) {
    if (fields.text !== undefined) this.svc.updateSegment(segmentId, { text: fields.text });
    const { text: _t, ...meta } = fields;
    this.setMeta(segmentId, meta);
    return this.getParagraph(segmentId);
  }
  setParagraphCharacter(ids: string | string[], characterId: string | null) {
    const list = Array.isArray(ids) ? ids : [ids];
    for (const id of list) this.setMeta(id, { character_id: characterId });
    return list.length;
  }
  markStale(ids: string[]) {
    for (const id of ids) {
      const m = this.meta.get(id);
      this.setMeta(id, {});
      this.meta.get(id)!.stale = Boolean(this.svc.getSegment(id)?.sound_id) || (m?.stale ?? false);
    }
    return ids.length;
  }
  markVoiced(id: string, text: string) {
    this.setMeta(id, {});
    this.meta.get(id)!.stale = false;
    this.meta.get(id)!.voiced_text = text;
    this.voiced.push({ id, text });
  }
  modelFor() {
    return this.book.settings.model_id;
  }
  voiceFor(_bookId: string, characterId: string | null) {
    const c = characterId ? this.characters.find((x) => x.id === characterId) : null;
    return c?.voice_id ?? this.book.settings.narrator_voice_id;
  }
  listCharacters() {
    return this.characters;
  }
  getCharacter(id: string) {
    return this.characters.find((c) => c.id === id) ?? null;
  }
  createCharacter(bookId: string, fields: Partial<Omit<Character, "id" | "book_id">> & { name: string }) {
    const c: Character = {
      id: `c${this.characters.length + 1}`, book_id: bookId, aliases: [], description: null, voice_id: null,
      model_id: null, request_options: {}, color: this.characters.length, ...fields,
    };
    this.characters.push(c);
    return c;
  }
  updateCharacter(id: string, fields: Partial<Omit<Character, "id" | "book_id">>) {
    const c = this.getCharacter(id);
    if (!c) return null;
    Object.assign(c, fields);
    return c;
  }
  deleteCharacter(id: string) {
    const i = this.characters.findIndex((c) => c.id === id);
    if (i === -1) return false;
    this.characters.splice(i, 1);
    return true;
  }
}

export interface Harness {
  svc: MirliService;
  book: FakeBook;
  spoken: string[];
  /** Make the next n speak calls return near-silence. */
  failNext(n: number): void;
  close(): Promise<void>;
}

export async function harness(): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), "mirli-ab-voice-"));
  const svc = new MirliService(new Config(dataDir));
  svc.start();
  await svc.models.setAudiocppEnabled([TTS]);
  const real = svc.listModels.bind(svc);
  vi.spyOn(svc, "listModels").mockImplementation(async () =>
    (await real()).map((m): ModelInfo => (m.id === TTS ? { ...m, status: "loaded" } : m)),
  );
  vi.spyOn(svc.models, "load").mockResolvedValue({} as ModelInfo);
  const spoken: string[] = [];
  let failing = 0;
  vi.spyOn(svc.models.get(TTS), "speak").mockImplementation(async (text: string) => {
    spoken.push(text);
    if (failing > 0) {
      failing--;
      return { audio: [new Float32Array(SR).fill(0)], sampleRate: SR };
    }
    return { audio: [fakeSpeech(text)], sampleRate: SR };
  });
  Object.defineProperty(svc.models.get(TTS), "loaded", { get: () => true, configurable: true });
  const book = new FakeBook(svc);
  return {
    svc,
    book,
    spoken,
    failNext: (n) => (failing = n),
    close: async () => {
      await svc.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
