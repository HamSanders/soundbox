/**
 * Listening state: where a listener is in each book, and the bookmarks and
 * notes they left on the way.
 *
 * A class over the shared connection in the `HistoryStore` pattern, with its
 * own `CREATE TABLE IF NOT EXISTS` schema. It holds no audio and no text; a
 * position is a chapter id plus seconds into that chapter's audio, so it
 * stays valid whichever source (an export or the live mix) is playing.
 */

import { randomUUID } from "node:crypto";

import type { Database } from "better-sqlite3";

import type { MirliService } from "../../service.js";

export const LISTEN_SCHEMA = `
CREATE TABLE IF NOT EXISTS book_progress (
    book_id     TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    chapter_id  TEXT,
    position_s  REAL NOT NULL DEFAULT 0,
    speed       REAL NOT NULL DEFAULT 1,
    -- Seconds listened across the whole book, for the shelf's progress bar.
    book_position_s REAL NOT NULL DEFAULT 0,
    finished_at TEXT,
    started_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_bookmarks (
    id          TEXT PRIMARY KEY,
    book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chapter_id  TEXT NOT NULL,
    position_s  REAL NOT NULL,
    segment_id  TEXT,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_bookmarks_book ON book_bookmarks(book_id, chapter_id, position_s);

-- Free-form shelf tags ("Slow burn", "Found family"), next to the book's
-- genres. Listening metadata, so it lives here rather than on books.
CREATE TABLE IF NOT EXISTS book_tags (
    book_id  TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    tag      TEXT NOT NULL,
    PRIMARY KEY (book_id, tag)
);
`;

export interface ListenProgress {
  book_id: string;
  chapter_id: string | null;
  position_s: number;
  speed: number;
  /** Seconds into the book as a whole (sum of earlier chapters + position). */
  book_position_s: number;
  finished_at: string | null;
  started_at: string;
  updated_at: string;
}

export interface Bookmark {
  id: string;
  book_id: string;
  chapter_id: string;
  position_s: number;
  /** The paragraph playing when it was made, for the read-along jump. */
  segment_id: string | null;
  /** Empty for a plain bookmark; text makes it a note. */
  note: string;
  created_at: string;
  updated_at: string;
}

export interface ProgressPatch {
  chapter_id: string | null;
  position_s: number;
  speed?: number;
  book_position_s?: number;
  /** true marks the book finished, false clears it, omitted leaves it. */
  finished?: boolean;
}

type ProgressRow = ListenProgress;

export class ListenStore {
  constructor(
    private readonly conn: Database,
    private readonly newId: () => string,
    private readonly now: () => string,
  ) {
    this.conn.exec(LISTEN_SCHEMA);
  }

  /* --------------------------------------------------------------- progress */

  getProgress(bookId: string): ListenProgress | null {
    const row = this.conn.prepare("SELECT * FROM book_progress WHERE book_id=?").get(bookId) as
      | ProgressRow
      | undefined;
    return row ?? null;
  }

  allProgress(): Map<string, ListenProgress> {
    const rows = this.conn.prepare("SELECT * FROM book_progress").all() as ProgressRow[];
    return new Map(rows.map((r) => [r.book_id, r]));
  }

  setProgress(bookId: string, patch: ProgressPatch): ListenProgress {
    const now = this.now();
    const prev = this.getProgress(bookId);
    const finishedAt =
      patch.finished === true ? (prev?.finished_at ?? now) : patch.finished === false ? null : (prev?.finished_at ?? null);
    const next: ListenProgress = {
      book_id: bookId,
      chapter_id: patch.chapter_id,
      position_s: Math.max(0, patch.position_s),
      speed: patch.speed ?? prev?.speed ?? 1,
      book_position_s: Math.max(0, patch.book_position_s ?? prev?.book_position_s ?? 0),
      finished_at: finishedAt,
      started_at: prev?.started_at ?? now,
      updated_at: now,
    };
    this.conn
      .prepare(
        `INSERT INTO book_progress (book_id, chapter_id, position_s, speed, book_position_s, finished_at, started_at, updated_at)
         VALUES (@book_id, @chapter_id, @position_s, @speed, @book_position_s, @finished_at, @started_at, @updated_at)
         ON CONFLICT(book_id) DO UPDATE SET chapter_id=excluded.chapter_id, position_s=excluded.position_s,
           speed=excluded.speed, book_position_s=excluded.book_position_s, finished_at=excluded.finished_at,
           updated_at=excluded.updated_at`,
      )
      .run(next);
    return next;
  }

  clearProgress(bookId: string): boolean {
    return this.conn.prepare("DELETE FROM book_progress WHERE book_id=?").run(bookId).changes > 0;
  }

  /* ------------------------------------------------------------------- tags */

  allTags(): Map<string, string[]> {
    const rows = this.conn.prepare("SELECT book_id, tag FROM book_tags ORDER BY tag").all() as {
      book_id: string;
      tag: string;
    }[];
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.book_id, [...(out.get(r.book_id) ?? []), r.tag]);
    return out;
  }

  getTags(bookId: string): string[] {
    return (this.conn.prepare("SELECT tag FROM book_tags WHERE book_id=? ORDER BY tag").all(bookId) as { tag: string }[]).map(
      (r) => r.tag,
    );
  }

  setTags(bookId: string, tags: string[]): string[] {
    const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    this.conn.transaction(() => {
      this.conn.prepare("DELETE FROM book_tags WHERE book_id=?").run(bookId);
      const insert = this.conn.prepare("INSERT INTO book_tags (book_id, tag) VALUES (?, ?)");
      for (const tag of clean) insert.run(bookId, tag);
    })();
    return this.getTags(bookId);
  }

  /* -------------------------------------------------------------- bookmarks */

  listBookmarks(bookId: string): Bookmark[] {
    return this.conn
      .prepare("SELECT * FROM book_bookmarks WHERE book_id=? ORDER BY created_at")
      .all(bookId) as Bookmark[];
  }

  getBookmark(id: string): Bookmark | null {
    return (this.conn.prepare("SELECT * FROM book_bookmarks WHERE id=?").get(id) as Bookmark | undefined) ?? null;
  }

  addBookmark(
    bookId: string,
    fields: { chapter_id: string; position_s: number; segment_id?: string | null; note?: string },
  ): Bookmark {
    const now = this.now();
    const bookmark: Bookmark = {
      id: this.newId(),
      book_id: bookId,
      chapter_id: fields.chapter_id,
      position_s: Math.max(0, fields.position_s),
      segment_id: fields.segment_id ?? null,
      note: fields.note ?? "",
      created_at: now,
      updated_at: now,
    };
    this.conn
      .prepare(
        `INSERT INTO book_bookmarks (id, book_id, chapter_id, position_s, segment_id, note, created_at, updated_at)
         VALUES (@id, @book_id, @chapter_id, @position_s, @segment_id, @note, @created_at, @updated_at)`,
      )
      .run(bookmark);
    return bookmark;
  }

  updateBookmark(id: string, fields: { note?: string; position_s?: number }): Bookmark | null {
    const prev = this.getBookmark(id);
    if (!prev) return null;
    const next = {
      ...prev,
      note: fields.note ?? prev.note,
      position_s: fields.position_s === undefined ? prev.position_s : Math.max(0, fields.position_s),
      updated_at: this.now(),
    };
    this.conn
      .prepare("UPDATE book_bookmarks SET note=@note, position_s=@position_s, updated_at=@updated_at WHERE id=@id")
      .run(next);
    return next;
  }

  deleteBookmark(id: string): boolean {
    return this.conn.prepare("DELETE FROM book_bookmarks WHERE id=?").run(id).changes > 0;
  }
}

const stores = new WeakMap<MirliService, ListenStore>();

/** The listening store for this server, built on first use from the shared
 *  connection (`db.sqlite`), after core's tables exist. */
export function listenStore(svc: MirliService): ListenStore {
  let store = stores.get(svc);
  if (!store) {
    store = new ListenStore(svc.db.sqlite, () => randomUUID(), () => new Date().toISOString());
    stores.set(svc, store);
  }
  return store;
}
