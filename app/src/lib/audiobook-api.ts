/**
 * Audiobook API client. The server half is `server/src/routes/audiobooks.ts`
 * (core) plus each area's own routes; this file covers core's.
 *
 * Under `VITE_MOCK=1` the same interface is served by the in-memory mock in
 * `audiobook-mock.ts`, the same switch `api.ts` uses.
 */

import { IS_MOCK, request, type StorySegment } from "./api";
import type {
  Book,
  BookSettings,
  Chapter,
  ChapterKind,
  ChapterStats,
  ChapterStatus,
  Character,
  PacingSettings,
  ParagraphMeta,
} from "./audiobook-types";
import { mockAudiobookApi } from "./audiobook-mock";

/* ------------------------------------------------------------------ types */

export type ParagraphStatus = "unvoiced" | "voiced" | "stale" | "locked";

/** A paragraph: its story segment, its audiobook state and a status. */
export type Paragraph = StorySegment &
  ParagraphMeta & {
    status: ParagraphStatus;
  };

export interface BookStats {
  chapters: number;
  paragraphs: number;
  voiced: number;
  stale: number;
  locked: number;
  characters: number;
  duration_s: number;
}

export interface ChapterWithStats extends Chapter {
  stats: ChapterStats;
  status: ChapterStatus;
}

export interface BookSummary extends Book {
  stats: BookStats;
}

export interface BookDetail extends Book {
  chapters: ChapterWithStats[];
  characters: Character[];
  stats: BookStats;
}

export type SettingsPatch = Partial<Omit<BookSettings, "pacing">> & {
  pacing?: Partial<PacingSettings>;
};

export type BookPatch = Partial<
  Omit<Book, "id" | "settings" | "created_at" | "updated_at" | "cover_path">
> & { settings?: SettingsPatch };

export interface ChapterCreate {
  title?: string;
  kind?: ChapterKind;
  included?: boolean;
  position?: number | null;
  paragraphs?: string[];
}

export interface ChapterPatch {
  title?: string;
  kind?: ChapterKind;
  included?: boolean;
}

export interface ParagraphCreate {
  text?: string;
  position?: number | null;
  character_id?: string | null;
  is_heading?: boolean;
}

export interface ParagraphPatch {
  text?: string;
  character_id?: string | null;
  locked?: boolean;
  is_heading?: boolean;
}

export interface ReplaceRequest {
  find: string;
  replace: string;
  case_sensitive?: boolean;
  whole_word?: boolean;
  regex?: boolean;
  chapter_ids?: string[];
  dry_run?: boolean;
}

export interface ReplaceResult {
  matches: number;
  paragraphs: number;
  skipped_locked: number;
  skipped_matches: number;
  changed: { chapter_id: string; segment_id: string }[];
  dry_run: boolean;
}

/** What `GET /api/audiobooks/:id/events` sends. Other areas add their own
 *  types; clients ignore the ones they don't know. */
export type AudiobookEvent =
  | { type: "hello" }
  | { type: "book" }
  | { type: "chapters" }
  | { type: "paragraphs"; chapter_id: string; segment_ids?: string[] }
  | { type: "characters" }
  | { type: "deleted" }
  | ({ type: string } & Record<string, unknown>);

export interface AudiobookApi {
  listBooks(): Promise<BookSummary[]>;
  getBook(id: string): Promise<BookDetail>;
  createBook(fields?: BookPatch): Promise<BookDetail>;
  updateBook(id: string, patch: BookPatch): Promise<BookDetail>;
  deleteBook(id: string, deleteSounds?: boolean): Promise<void>;
  uploadCover(id: string, file: Blob): Promise<BookDetail>;
  /** Where the cover image is served, or null when the book has none. */
  coverUrl(book: Pick<Book, "id" | "cover_path">): string | null;

  addChapter(bookId: string, req?: ChapterCreate): Promise<ChapterWithStats>;
  updateChapter(bookId: string, chapterId: string, patch: ChapterPatch): Promise<ChapterWithStats>;
  reorderChapters(bookId: string, ids: string[]): Promise<ChapterWithStats[]>;
  deleteChapter(bookId: string, chapterId: string): Promise<void>;

  listParagraphs(bookId: string, chapterId: string): Promise<Paragraph[]>;
  addParagraph(bookId: string, chapterId: string, req: ParagraphCreate): Promise<Paragraph>;
  updateParagraph(bookId: string, segmentId: string, patch: ParagraphPatch): Promise<Paragraph>;
  deleteParagraph(bookId: string, segmentId: string): Promise<void>;
  castParagraphs(bookId: string, segmentIds: string[], characterId: string | null): Promise<{ changed: number }>;

  replace(bookId: string, req: ReplaceRequest): Promise<ReplaceResult>;

  /** Live events for one book. Returns the unsubscribe. */
  subscribe(bookId: string, onEvent: (event: AudiobookEvent) => void): () => void;
}

const base = (id: string) => `/api/audiobooks/${encodeURIComponent(id)}`;
const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

const httpAudiobookApi: AudiobookApi = {
  listBooks: () => request<BookSummary[]>("/api/audiobooks"),
  getBook: (id) => request<BookDetail>(base(id)),
  createBook: (fields = {}) =>
    request<BookDetail>("/api/audiobooks", { method: "POST", ...json(fields) }),
  updateBook: (id, patch) => request<BookDetail>(base(id), { method: "PATCH", ...json(patch) }),
  deleteBook: (id, deleteSounds = true) =>
    request<void>(`${base(id)}?delete_sounds=${deleteSounds ? "true" : "false"}`, {
      method: "DELETE",
    }),
  uploadCover: (id, file) =>
    request<BookDetail>(`${base(id)}/cover`, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "image/png" },
    }),
  // The cover path changes with every upload, so it doubles as a cache key.
  coverUrl: (book) =>
    book.cover_path ? `${base(book.id)}/cover?v=${encodeURIComponent(book.cover_path)}` : null,

  addChapter: (bookId, req = {}) =>
    request<ChapterWithStats>(`${base(bookId)}/chapters`, { method: "POST", ...json(req) }),
  updateChapter: (bookId, chapterId, patch) =>
    request<ChapterWithStats>(`${base(bookId)}/chapters/${encodeURIComponent(chapterId)}`, {
      method: "PATCH",
      ...json(patch),
    }),
  reorderChapters: (bookId, ids) =>
    request<ChapterWithStats[]>(`${base(bookId)}/chapters/reorder`, {
      method: "POST",
      ...json({ ids }),
    }),
  deleteChapter: (bookId, chapterId) =>
    request<void>(`${base(bookId)}/chapters/${encodeURIComponent(chapterId)}`, {
      method: "DELETE",
    }),

  listParagraphs: (bookId, chapterId) =>
    request<Paragraph[]>(`${base(bookId)}/chapters/${encodeURIComponent(chapterId)}/paragraphs`),
  addParagraph: (bookId, chapterId, req) =>
    request<Paragraph>(`${base(bookId)}/chapters/${encodeURIComponent(chapterId)}/paragraphs`, {
      method: "POST",
      ...json(req),
    }),
  updateParagraph: (bookId, segmentId, patch) =>
    request<Paragraph>(`${base(bookId)}/paragraphs/${encodeURIComponent(segmentId)}`, {
      method: "PATCH",
      ...json(patch),
    }),
  deleteParagraph: (bookId, segmentId) =>
    request<void>(`${base(bookId)}/paragraphs/${encodeURIComponent(segmentId)}`, {
      method: "DELETE",
    }),
  castParagraphs: (bookId, segmentIds, characterId) =>
    request<{ changed: number }>(`${base(bookId)}/paragraphs/cast`, {
      method: "POST",
      ...json({ segment_ids: segmentIds, character_id: characterId }),
    }),

  replace: (bookId, req) =>
    request<ReplaceResult>(`${base(bookId)}/replace`, { method: "POST", ...json(req) }),

  subscribe(bookId, onEvent) {
    let source: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      if (closed) return;
      source = new EventSource(`${base(bookId)}/events`);
      source.onmessage = (msg) => {
        try {
          onEvent(JSON.parse(msg.data as string) as AudiobookEvent);
        } catch {
          /* ignore a malformed frame */
        }
      };
      source.onerror = () => {
        source?.close();
        source = null;
        // Reconnect after a pause; a restarting server comes back on its own.
        retry = setTimeout(open, 3000);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      source?.close();
    };
  },
};

export const audiobookApi: AudiobookApi = IS_MOCK ? mockAudiobookApi : httpAudiobookApi;

/** Display order of chapter kinds, with their labels. */
export const CHAPTER_KIND_LABELS: Record<ChapterKind, string> = {
  opening_credits: "Opening credits",
  front_matter: "Front matter",
  chapter: "Chapter",
  back_matter: "Back matter",
  closing_credits: "Closing credits",
  retail_sample: "Retail sample",
};

/** Percent of a book's paragraphs that have a take. */
export function bookProgress(book: { stats: Pick<BookStats, "paragraphs" | "voiced"> }): number {
  const { paragraphs, voiced } = book.stats;
  return paragraphs === 0 ? 0 : Math.round((voiced / paragraphs) * 100);
}
