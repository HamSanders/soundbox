/**
 * Audiobooks voice area: what it needs from the book (core) and its own
 * stores.
 *
 * `BookAccess` is the subset of core's `AudiobookService` the voice code
 * calls, written structurally so core's service satisfies it as-is and tests
 * can pass a small fake. Paragraph and character writes always go through it,
 * never straight to core's tables.
 *
 * The stores are keyed by the open `Database`: switching profile swaps
 * `svc.db`, and the stores follow.
 */

import { randomUUID } from "node:crypto";

import type { Database } from "../db.js";
import type { StorySegment } from "../schemas.js";
import { PronunciationStore } from "./pronounce-store.js";
import { RenderStore } from "./render-store.js";
import { TakeStore } from "./takes-store.js";
import type { Book, Chapter, Character, ParagraphMeta } from "./types.js";

export type ParagraphStatus = "unvoiced" | "voiced" | "stale" | "locked";

export type BookParagraph = StorySegment &
  ParagraphMeta & {
    status: ParagraphStatus;
    model_id: string | null;
  };

export type CharacterInput = Partial<Omit<Character, "id" | "book_id">>;

export interface BookEvents {
  publish(bookId: string, event: { type: string } & Record<string, unknown>): void;
}

export interface BookAccess {
  readonly hub: BookEvents;
  getBook(id: string): (Book & { chapters: Chapter[]; characters: Character[] }) | null;
  getChapter(chapterId: string): Chapter | null;
  chapterForSegment(segmentId: string): Chapter | null;
  getParagraphs(chapterId: string): BookParagraph[] | null;
  getParagraph(segmentId: string): BookParagraph | null;
  addParagraph(
    chapterId: string,
    fields: { text: string; position?: number | null; character_id?: string | null; is_heading?: boolean },
  ): BookParagraph;
  updateParagraph(
    segmentId: string,
    fields: { text?: string; character_id?: string | null; locked?: boolean; is_heading?: boolean },
  ): BookParagraph | null;
  setParagraphCharacter(segmentIds: string | string[], characterId: string | null): number;
  markStale(segmentIds: string[]): number;
  markVoiced(segmentId: string, spokenText: string): void;
  modelFor(segmentId: string): string | null;
  voiceFor(bookId: string, characterId: string | null): string | null;
  listCharacters(bookId: string): Character[];
  getCharacter(id: string): Character | null;
  createCharacter(bookId: string, fields: CharacterInput & { name: string }): Character;
  updateCharacter(id: string, fields: CharacterInput): Character | null;
  deleteCharacter(id: string): boolean;
}

export interface VoiceStores {
  pronunciations: PronunciationStore;
  takes: TakeStore;
  renders: RenderStore;
}

const stores = new WeakMap<Database, VoiceStores>();

export function voiceStores(db: Database): VoiceStores {
  let s = stores.get(db);
  if (!s) {
    const id = () => randomUUID();
    const now = () => new Date().toISOString();
    s = {
      pronunciations: new PronunciationStore(db.conn, id, now),
      takes: new TakeStore(db.conn, id, now),
      renders: new RenderStore(db.conn, id, now),
    };
    stores.set(db, s);
  }
  return s;
}
