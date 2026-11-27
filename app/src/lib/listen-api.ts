/**
 * Listening API client. The server half is `server/src/routes/audiobook-listen.ts`.
 * Under `VITE_MOCK=1` the same interface is served by `listen-mock.ts`.
 */

import { IS_MOCK, request } from "./api";
import { mockListenApi } from "./listen-mock";
import type {
  Bookmark,
  ChecklistTarget,
  ListenManifest,
  ListenProgress,
  ProgressPatch,
  PublishResult,
  RssRequest,
  ShelfBook,
  AudioEncoding,
} from "./listen-types";

export interface ListenApi {
  shelf(): Promise<ShelfBook[]>;
  manifest(bookId: string): Promise<ListenManifest>;
  saveProgress(bookId: string, patch: ProgressPatch): Promise<ListenProgress>;
  clearProgress(bookId: string): Promise<void>;
  addBookmark(
    bookId: string,
    req: { chapter_id: string; position_s: number; segment_id?: string | null; note?: string },
  ): Promise<Bookmark>;
  updateBookmark(bookId: string, id: string, patch: { note?: string; position_s?: number }): Promise<Bookmark>;
  deleteBookmark(bookId: string, id: string): Promise<void>;
  setTags(bookId: string, tags: string[]): Promise<{ tags: string[] }>;
  checklist(bookId: string): Promise<ChecklistTarget[]>;
  publishWebPlayer(bookId: string, req?: { encoding?: AudioEncoding }): Promise<PublishResult>;
  publishRss(bookId: string, req: RssRequest): Promise<PublishResult>;
}

const base = (id: string) => `/api/audiobooks/${encodeURIComponent(id)}`;
const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

const httpListenApi: ListenApi = {
  shelf: () => request<ShelfBook[]>("/api/audiobooks/listen/shelf"),
  manifest: (id) => request<ListenManifest>(`${base(id)}/listen`),
  saveProgress: (id, patch) => request<ListenProgress>(`${base(id)}/progress`, { method: "PUT", ...json(patch) }),
  clearProgress: (id) => request<void>(`${base(id)}/progress`, { method: "DELETE" }),
  addBookmark: (id, req) => request<Bookmark>(`${base(id)}/bookmarks`, { method: "POST", ...json(req) }),
  updateBookmark: (id, bid, patch) =>
    request<Bookmark>(`${base(id)}/bookmarks/${encodeURIComponent(bid)}`, { method: "PATCH", ...json(patch) }),
  deleteBookmark: (id, bid) =>
    request<void>(`${base(id)}/bookmarks/${encodeURIComponent(bid)}`, { method: "DELETE" }),
  setTags: (id, tags) => request<{ tags: string[] }>(`${base(id)}/tags`, { method: "PUT", ...json({ tags }) }),
  checklist: (id) => request<ChecklistTarget[]>(`${base(id)}/publish/checklist`),
  publishWebPlayer: (id, req = {}) =>
    request<PublishResult>(`${base(id)}/publish/webplayer`, { method: "POST", ...json(req) }),
  publishRss: (id, req) => request<PublishResult>(`${base(id)}/publish/rss`, { method: "POST", ...json(req) }),
};

export const listenApi: ListenApi = IS_MOCK ? mockListenApi : httpListenApi;

/** Percent listened, 0–100, or null before the first listen. */
export function listenedPercent(book: Pick<ShelfBook, "duration_s" | "progress">): number | null {
  const p = book.progress;
  if (!p) return null;
  if (p.finished_at) return 100;
  if (book.duration_s <= 0) return 0;
  return Math.min(100, Math.round((p.book_position_s / book.duration_s) * 100));
}

/** "10 hrs 37 mins", "42 mins", "35 secs": the detail page's length line. */
export function formatLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} hr${h === 1 ? "" : "s"}${m ? ` ${m} min${m === 1 ? "" : "s"}` : ""}`;
  if (m > 0) return `${m} min${m === 1 ? "" : "s"}`;
  return `${s} sec${s === 1 ? "" : "s"}`;
}

/** "10h 9m" / "42m" / "35s": the compact card length. */
export function formatShort(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** h:mm:ss / m:ss for player clocks. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
