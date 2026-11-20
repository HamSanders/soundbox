/**
 * The audiobook store: books, chapters, characters and per-paragraph state.
 *
 * A class over the shared connection, like `HistoryStore`, running its own
 * `CREATE TABLE IF NOT EXISTS` schema. It holds only what stories lack. A
 * chapter points at the story that holds its paragraphs, and a paragraph's
 * row here is keyed by its `story_segments` id. A segment with no row here is
 * an ordinary narrator paragraph, unlocked, so lines added in the studio
 * timeline show up in the book without any bookkeeping.
 *
 * Stories themselves are created and deleted by the service (it owns sound
 * file cleanup); this file never writes to `stories` or `story_segments`.
 */

import type { Database } from "better-sqlite3";

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
} from "./types.js";

/** A settings patch: any field, and any part of pacing. */
export type SettingsPatch = Partial<Omit<BookSettings, "pacing">> & {
  pacing?: Partial<PacingSettings>;
};

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
    id               TEXT PRIMARY KEY,
    project_id       TEXT REFERENCES projects(id) ON DELETE SET NULL,
    title            TEXT NOT NULL,
    subtitle         TEXT,
    author           TEXT,
    narrator         TEXT,
    description      TEXT,
    language         TEXT NOT NULL DEFAULT 'en',
    genres           TEXT NOT NULL DEFAULT '[]',
    series           TEXT,
    series_index     REAL,
    isbn             TEXT,
    publisher        TEXT,
    publication_date TEXT,
    cover_path       TEXT,
    settings         TEXT NOT NULL DEFAULT '{}',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_updated ON books(updated_at DESC);

-- One chapter is one story. Deleting the story (from the studio) deletes the
-- chapter too, so a book never points at a timeline that is gone.
CREATE TABLE IF NOT EXISTS book_chapters (
    id         TEXT PRIMARY KEY,
    book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    story_id   TEXT NOT NULL UNIQUE REFERENCES stories(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    title      TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'chapter',
    included   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_book_chapters_book ON book_chapters(book_id, position);

CREATE TABLE IF NOT EXISTS book_characters (
    id              TEXT PRIMARY KEY,
    book_id         TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    aliases         TEXT NOT NULL DEFAULT '[]',
    description     TEXT,
    voice_id        TEXT,
    model_id        TEXT,
    request_options TEXT NOT NULL DEFAULT '{}',
    color           INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_characters_book ON book_characters(book_id);

-- Audiobook state for one paragraph. voiced_sound_id/voiced_text snapshot the
-- text a take was made from, so an edit after voicing reads as stale.
-- stale_sound_id marks a take stale for other reasons (a pronunciation rule
-- changed); a new take has a new sound id, which clears it on its own.
CREATE TABLE IF NOT EXISTS book_paragraphs (
    segment_id      TEXT PRIMARY KEY REFERENCES story_segments(id) ON DELETE CASCADE,
    character_id    TEXT REFERENCES book_characters(id) ON DELETE SET NULL,
    locked          INTEGER NOT NULL DEFAULT 0,
    is_heading      INTEGER NOT NULL DEFAULT 0,
    -- This paragraph's own model, over the character's and the book's.
    model_id        TEXT,
    voiced_sound_id TEXT,
    voiced_text     TEXT,
    stale_sound_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_book_paragraphs_character ON book_paragraphs(character_id);

-- Review notes on a paragraph, optionally at a time inside its audio.
CREATE TABLE IF NOT EXISTS book_notes (
    id         TEXT PRIMARY KEY,
    book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    segment_id TEXT NOT NULL REFERENCES story_segments(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    at_s       REAL,
    resolved   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_notes_book ON book_notes(book_id, resolved);
CREATE INDEX IF NOT EXISTS idx_book_notes_segment ON book_notes(segment_id);
`;

/** A review note on one paragraph. */
export interface BookNote {
  id: string;
  book_id: string;
  segment_id: string;
  chapter_id: string;
  body: string;
  /** Seconds into the paragraph's audio, or null for the paragraph as a whole. */
  at_s: number | null;
  resolved: boolean;
  created_at: string;
  updated_at: string;
}

interface NoteRow {
  id: string;
  book_id: string;
  segment_id: string;
  chapter_id: string;
  body: string;
  at_s: number | null;
  resolved: number;
  created_at: string;
  updated_at: string;
}

function toNote(row: NoteRow): BookNote {
  return { ...row, resolved: row.resolved === 1 };
}

/** Defaults inside ACX's published room tone ranges (head 0.5–1 s, tail
 *  1–5 s). The gaps are a starting point for narration, not a standard. */
export const DEFAULT_SETTINGS: BookSettings = {
  model_id: null,
  narrator_voice_id: null,
  request_options: {},
  pacing: {
    paragraph_gap_s: 0.5,
    heading_gap_s: 1.5,
    head_room_tone_s: 0.75,
    tail_room_tone_s: 2,
  },
  mastering: "acx",
  cast_mode: "single",
};

export const CHAPTER_KINDS: readonly ChapterKind[] = [
  "opening_credits",
  "front_matter",
  "chapter",
  "back_matter",
  "closing_credits",
  "retail_sample",
];

export type ParagraphStatus = "unvoiced" | "voiced" | "stale" | "locked";

export interface ChapterWithStats extends Chapter {
  stats: ChapterStats;
  status: ChapterStatus;
  /** Unresolved review notes in this chapter. */
  open_notes: number;
}

/** Book-wide totals, the sum of every chapter's stats. */
export interface BookStats {
  chapters: number;
  paragraphs: number;
  voiced: number;
  stale: number;
  locked: number;
  characters: number;
  duration_s: number;
  open_notes: number;
}

interface BookRow {
  id: string;
  project_id: string | null;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  description: string | null;
  language: string;
  genres: string;
  series: string | null;
  series_index: number | null;
  isbn: string | null;
  publisher: string | null;
  publication_date: string | null;
  cover_path: string | null;
  settings: string;
  created_at: string;
  updated_at: string;
}

interface ChapterRow {
  id: string;
  book_id: string;
  story_id: string;
  position: number;
  title: string;
  kind: string;
  included: number;
}

interface CharacterRow {
  id: string;
  book_id: string;
  name: string;
  aliases: string;
  description: string | null;
  voice_id: string | null;
  model_id: string | null;
  request_options: string;
  color: number;
}

interface MetaRow {
  segment_id: string;
  character_id: string | null;
  locked: number;
  is_heading: number;
  model_id: string | null;
}

interface StatsRow {
  chapter_id: string;
  paragraphs: number | null;
  voiced: number | null;
  stale: number | null;
  locked: number | null;
  characters: number | null;
  duration_s: number | null;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseStrings(raw: string | null): string[] {
  const parsed = parseJson<unknown>(raw, []);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
}

function parseObject(raw: string | null): Record<string, unknown> {
  const parsed = parseJson<unknown>(raw, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/** Stored settings over the defaults, so a row written by an older build
 *  still has every field a newer one reads. */
export function mergeSettings(base: BookSettings, patch: SettingsPatch | null): BookSettings {
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    pacing: { ...base.pacing, ...(patch.pacing ?? {}) },
    request_options: patch.request_options ?? base.request_options,
  };
}

function toBook(row: BookRow): Book {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    subtitle: row.subtitle,
    author: row.author,
    narrator: row.narrator,
    description: row.description,
    language: row.language,
    genres: parseStrings(row.genres),
    series: row.series,
    series_index: row.series_index,
    isbn: row.isbn,
    publisher: row.publisher,
    publication_date: row.publication_date,
    cover_path: row.cover_path,
    settings: mergeSettings(DEFAULT_SETTINGS, parseObject(row.settings) as SettingsPatch),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    book_id: row.book_id,
    story_id: row.story_id,
    position: row.position,
    title: row.title,
    kind: (CHAPTER_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as ChapterKind)
      : "chapter",
    included: row.included === 1,
  };
}

function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    book_id: row.book_id,
    name: row.name,
    aliases: parseStrings(row.aliases),
    description: row.description,
    voice_id: row.voice_id,
    model_id: row.model_id,
    request_options: parseObject(row.request_options),
    color: row.color,
  };
}

function emptyStats(chapterId: string): ChapterStats {
  return { chapter_id: chapterId, paragraphs: 0, voiced: 0, locked: 0, characters: 0, duration_s: 0 };
}

export function chapterStatus(stats: ChapterStats): ChapterStatus {
  if (stats.paragraphs === 0 || stats.voiced === 0) return "empty";
  return stats.voiced >= stats.paragraphs ? "voiced" : "partial";
}

/** Fields of a book a caller may set. */
export type BookFields = Partial<
  Omit<Book, "id" | "settings" | "created_at" | "updated_at">
> & { settings?: SettingsPatch };

export type CharacterFields = Partial<Omit<Character, "id" | "book_id">>;

const BOOK_COLUMNS = [
  "project_id",
  "title",
  "subtitle",
  "author",
  "narrator",
  "description",
  "language",
  "series",
  "series_index",
  "isbn",
  "publisher",
  "publication_date",
  "cover_path",
] as const;

/** Paragraph status SQL, shared by stats and the paragraph list. A take is
 *  stale when it was marked so, or when the text moved since it was made. */
const STALE_SQL = `(s.sound_id IS NOT NULL AND (p.stale_sound_id = s.sound_id
  OR (p.voiced_sound_id = s.sound_id AND p.voiced_text IS NOT s.text)))`;

export class AudiobookStore {
  constructor(
    private readonly conn: Database,
    private readonly newId: () => string,
    private readonly now: () => string,
  ) {
    this.conn.exec(SCHEMA);
    // Columns added after the first build of this table.
    const columns = this.conn.prepare("PRAGMA table_info(book_paragraphs)").all() as {
      name: string;
    }[];
    if (!columns.some((c) => c.name === "model_id")) {
      this.conn.exec("ALTER TABLE book_paragraphs ADD COLUMN model_id TEXT");
    }
  }

  /** Run `fn` in one transaction. The service uses this to keep a story and
   *  its chapter row in step. */
  transaction<T>(fn: () => T): T {
    return this.conn.transaction(fn)();
  }

  /* ------------------------------------------------------------------ books */

  listBooks(): Book[] {
    const rows = this.conn
      .prepare("SELECT * FROM books ORDER BY updated_at DESC")
      .all() as BookRow[];
    return rows.map(toBook);
  }

  getBook(id: string): Book | null {
    const row = this.conn.prepare("SELECT * FROM books WHERE id=?").get(id) as BookRow | undefined;
    return row ? toBook(row) : null;
  }

  createBook(fields: BookFields & { title: string }): Book {
    const id = this.newId();
    const now = this.now();
    const settings = mergeSettings(DEFAULT_SETTINGS, fields.settings ?? null);
    this.conn
      .prepare(
        `INSERT INTO books (id, project_id, title, subtitle, author, narrator, description,
           language, genres, series, series_index, isbn, publisher, publication_date,
           cover_path, settings, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        fields.project_id ?? null,
        fields.title,
        fields.subtitle ?? null,
        fields.author ?? null,
        fields.narrator ?? null,
        fields.description ?? null,
        fields.language || "en",
        JSON.stringify(fields.genres ?? []),
        fields.series ?? null,
        fields.series_index ?? null,
        fields.isbn ?? null,
        fields.publisher ?? null,
        fields.publication_date ?? null,
        fields.cover_path ?? null,
        JSON.stringify(settings),
        now,
        now,
      );
    return this.getBook(id)!;
  }

  /** Patch the given fields; `settings` merges into what is stored. */
  updateBook(id: string, fields: BookFields): Book | null {
    const current = this.getBook(id);
    if (!current) return null;
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const column of BOOK_COLUMNS) {
      if (column in fields) {
        sets.push(`${column}=?`);
        const value = fields[column];
        values.push(value === undefined ? null : (value as string | number | null));
      }
    }
    if (fields.genres !== undefined) {
      sets.push("genres=?");
      values.push(JSON.stringify(fields.genres));
    }
    if (fields.settings !== undefined) {
      sets.push("settings=?");
      values.push(JSON.stringify(mergeSettings(current.settings, fields.settings)));
    }
    sets.push("updated_at=?");
    values.push(this.now());
    this.conn.prepare(`UPDATE books SET ${sets.join(", ")} WHERE id=?`).run(...values, id);
    return this.getBook(id);
  }

  /** Bump `updated_at`, so the shelf orders by last work, not last rename. */
  touchBook(id: string): void {
    this.conn.prepare("UPDATE books SET updated_at=? WHERE id=?").run(this.now(), id);
  }

  deleteBook(id: string): boolean {
    return this.conn.prepare("DELETE FROM books WHERE id=?").run(id).changes > 0;
  }

  /* --------------------------------------------------------------- chapters */

  listChapters(bookId: string): Chapter[] {
    const rows = this.conn
      .prepare("SELECT * FROM book_chapters WHERE book_id=? ORDER BY position ASC")
      .all(bookId) as ChapterRow[];
    return rows.map(toChapter);
  }

  getChapter(id: string): Chapter | null {
    const row = this.conn.prepare("SELECT * FROM book_chapters WHERE id=?").get(id) as
      | ChapterRow
      | undefined;
    return row ? toChapter(row) : null;
  }

  chapterForStory(storyId: string): Chapter | null {
    const row = this.conn.prepare("SELECT * FROM book_chapters WHERE story_id=?").get(storyId) as
      | ChapterRow
      | undefined;
    return row ? toChapter(row) : null;
  }

  /** The chapter a paragraph belongs to, through its segment's story. */
  chapterForSegment(segmentId: string): Chapter | null {
    const row = this.conn
      .prepare(
        `SELECT c.* FROM book_chapters c
           JOIN story_segments s ON s.story_id = c.story_id
          WHERE s.id=?`,
      )
      .get(segmentId) as ChapterRow | undefined;
    return row ? toChapter(row) : null;
  }

  /** Insert at `position` (default: the end), shifting the rest down. */
  createChapter(
    bookId: string,
    storyId: string,
    fields: { title: string; kind?: ChapterKind; included?: boolean; position?: number | null },
  ): Chapter {
    const id = this.newId();
    const count = (
      this.conn.prepare("SELECT COUNT(*) n FROM book_chapters WHERE book_id=?").get(bookId) as {
        n: number;
      }
    ).n;
    const position =
      fields.position == null ? count : Math.max(0, Math.min(Math.floor(fields.position), count));
    this.conn
      .prepare("UPDATE book_chapters SET position = position + 1 WHERE book_id=? AND position >= ?")
      .run(bookId, position);
    this.conn
      .prepare(
        `INSERT INTO book_chapters (id, book_id, story_id, position, title, kind, included)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        bookId,
        storyId,
        position,
        fields.title,
        fields.kind ?? "chapter",
        fields.included === false ? 0 : 1,
      );
    this.touchBook(bookId);
    return this.getChapter(id)!;
  }

  updateChapter(
    id: string,
    fields: { title?: string; kind?: ChapterKind; included?: boolean },
  ): Chapter | null {
    const current = this.getChapter(id);
    if (!current) return null;
    this.conn
      .prepare("UPDATE book_chapters SET title=?, kind=?, included=? WHERE id=?")
      .run(
        fields.title ?? current.title,
        fields.kind ?? current.kind,
        (fields.included ?? current.included) ? 1 : 0,
        id,
      );
    this.touchBook(current.book_id);
    return this.getChapter(id);
  }

  /** `ids` must be exactly the book's chapters, in the new order. */
  reorderChapters(bookId: string, ids: string[]): boolean {
    const existing = this.listChapters(bookId).map((c) => c.id);
    if (existing.length !== ids.length || new Set(ids).size !== ids.length) return false;
    const known = new Set(existing);
    if (!ids.every((id) => known.has(id))) return false;
    const stmt = this.conn.prepare("UPDATE book_chapters SET position=? WHERE id=?");
    this.conn.transaction(() => ids.forEach((id, i) => stmt.run(i, id)))();
    this.touchBook(bookId);
    return true;
  }

  /** Removes the row and closes the gap. The story is the service's to drop. */
  deleteChapter(id: string): boolean {
    const chapter = this.getChapter(id);
    if (!chapter) return false;
    this.conn.prepare("DELETE FROM book_chapters WHERE id=?").run(id);
    this.conn
      .prepare("UPDATE book_chapters SET position = position - 1 WHERE book_id=? AND position > ?")
      .run(chapter.book_id, chapter.position);
    this.touchBook(chapter.book_id);
    return true;
  }

  /* ------------------------------------------------------------------ stats */

  /**
   * Record the text each newly voiced paragraph was voiced from.
   *
   * A paragraph whose sound changed since we last looked has a new take, so
   * its current text is what that take says. Run before every read of
   * status, so a paragraph voiced anywhere (editor, render run, studio) is
   * picked up. Text edits made through this module sync first too, so the
   * text before the edit is the one recorded.
   */
  syncVoiced(storyIds: string[]): void {
    if (storyIds.length === 0) return;
    const marks = storyIds.map(() => "?").join(",");
    this.conn
      .prepare(
        `INSERT INTO book_paragraphs (segment_id, voiced_sound_id, voiced_text)
         SELECT s.id, s.sound_id, s.text FROM story_segments s
          WHERE s.story_id IN (${marks}) AND s.sound_id IS NOT NULL
         ON CONFLICT(segment_id) DO UPDATE SET
           voiced_sound_id = excluded.voiced_sound_id,
           voiced_text = excluded.voiced_text
         WHERE book_paragraphs.voiced_sound_id IS NOT excluded.voiced_sound_id`,
      )
      .run(...storyIds);
  }

  chapterStats(bookId: string): Map<string, ChapterStats & { stale: number }> {
    const chapters = this.listChapters(bookId);
    this.syncVoiced(chapters.map((c) => c.story_id));
    const rows = this.conn
      .prepare(
        `SELECT c.id AS chapter_id,
           SUM(CASE WHEN s.kind='line' THEN 1 ELSE 0 END) AS paragraphs,
           SUM(CASE WHEN s.kind='line' AND s.sound_id IS NOT NULL THEN 1 ELSE 0 END) AS voiced,
           SUM(CASE WHEN s.kind='line' AND ${STALE_SQL} THEN 1 ELSE 0 END) AS stale,
           SUM(CASE WHEN s.kind='line' AND p.locked=1 THEN 1 ELSE 0 END) AS locked,
           SUM(CASE WHEN s.kind='line' THEN length(s.text) ELSE 0 END) AS characters,
           SUM(CASE WHEN s.sound_id IS NOT NULL
                    THEN COALESCE(s.duration_s, snd.duration_s, 0) ELSE 0 END) AS duration_s
         FROM book_chapters c
         LEFT JOIN story_segments s ON s.story_id = c.story_id
         LEFT JOIN sounds snd ON snd.id = s.sound_id
         LEFT JOIN book_paragraphs p ON p.segment_id = s.id
         WHERE c.book_id = ?
         GROUP BY c.id`,
      )
      .all(bookId) as StatsRow[];
    const out = new Map<string, ChapterStats & { stale: number }>();
    for (const chapter of chapters) out.set(chapter.id, { ...emptyStats(chapter.id), stale: 0 });
    for (const row of rows) {
      out.set(row.chapter_id, {
        chapter_id: row.chapter_id,
        paragraphs: row.paragraphs ?? 0,
        voiced: row.voiced ?? 0,
        stale: row.stale ?? 0,
        locked: row.locked ?? 0,
        characters: row.characters ?? 0,
        duration_s: Math.round((row.duration_s ?? 0) * 100) / 100,
      });
    }
    return out;
  }

  /* ------------------------------------------------------------- paragraphs */

  getMeta(segmentIds: string[]): Map<string, MetaRow> {
    const out = new Map<string, MetaRow>();
    if (segmentIds.length === 0) return out;
    // Chunked: SQLite caps bound parameters per statement.
    for (let i = 0; i < segmentIds.length; i += 500) {
      const chunk = segmentIds.slice(i, i + 500);
      const rows = this.conn
        .prepare(
          `SELECT segment_id, character_id, locked, is_heading, model_id FROM book_paragraphs
            WHERE segment_id IN (${chunk.map(() => "?").join(",")})`,
        )
        .all(...chunk) as MetaRow[];
      for (const row of rows) out.set(row.segment_id, row);
    }
    return out;
  }

  /** Segment ids in a story whose take is stale. */
  staleSegments(storyId: string): Set<string> {
    this.syncVoiced([storyId]);
    const rows = this.conn
      .prepare(
        `SELECT s.id FROM story_segments s
           LEFT JOIN book_paragraphs p ON p.segment_id = s.id
          WHERE s.story_id = ? AND ${STALE_SQL}`,
      )
      .all(storyId) as { id: string }[];
    return new Set(rows.map((r) => r.id));
  }

  /** Upsert one paragraph's audiobook state. Only the given fields change. */
  setMeta(
    segmentId: string,
    fields: {
      character_id?: string | null;
      locked?: boolean;
      is_heading?: boolean;
      model_id?: string | null;
    },
  ): void {
    this.conn
      .prepare("INSERT INTO book_paragraphs (segment_id) VALUES (?) ON CONFLICT DO NOTHING")
      .run(segmentId);
    if ("character_id" in fields) {
      this.conn
        .prepare("UPDATE book_paragraphs SET character_id=? WHERE segment_id=?")
        .run(fields.character_id ?? null, segmentId);
    }
    if (fields.locked !== undefined) {
      this.conn
        .prepare("UPDATE book_paragraphs SET locked=? WHERE segment_id=?")
        .run(fields.locked ? 1 : 0, segmentId);
    }
    if (fields.is_heading !== undefined) {
      this.conn
        .prepare("UPDATE book_paragraphs SET is_heading=? WHERE segment_id=?")
        .run(fields.is_heading ? 1 : 0, segmentId);
    }
    if ("model_id" in fields) {
      this.conn
        .prepare("UPDATE book_paragraphs SET model_id=? WHERE segment_id=?")
        .run(fields.model_id ?? null, segmentId);
    }
  }

  /** Mark the current take of each segment stale. A new take clears it. */
  markStale(segmentIds: string[]): number {
    let n = 0;
    const ensure = this.conn.prepare(
      "INSERT INTO book_paragraphs (segment_id) VALUES (?) ON CONFLICT DO NOTHING",
    );
    const mark = this.conn.prepare(
      `UPDATE book_paragraphs SET stale_sound_id =
         (SELECT sound_id FROM story_segments WHERE id = ?)
       WHERE segment_id = ?`,
    );
    this.conn.transaction(() => {
      for (const id of segmentIds) {
        ensure.run(id);
        n += mark.run(id, id).changes;
      }
    })();
    return n;
  }

  /** Record that `segmentId`'s current take was voiced from `text`. For the
   *  render path, which knows exactly what it spoke. */
  markVoiced(segmentId: string, text: string): void {
    this.conn
      .prepare(
        `INSERT INTO book_paragraphs (segment_id, voiced_sound_id, voiced_text, stale_sound_id)
         SELECT id, sound_id, ?, NULL FROM story_segments WHERE id = ?
         ON CONFLICT(segment_id) DO UPDATE SET
           voiced_sound_id = excluded.voiced_sound_id,
           voiced_text = excluded.voiced_text,
           stale_sound_id = NULL`,
      )
      .run(text, segmentId);
  }

  /* ------------------------------------------------------------- characters */

  listCharacters(bookId: string): Character[] {
    const rows = this.conn
      .prepare("SELECT * FROM book_characters WHERE book_id=? ORDER BY created_at ASC, name ASC")
      .all(bookId) as CharacterRow[];
    return rows.map(toCharacter);
  }

  getCharacter(id: string): Character | null {
    const row = this.conn.prepare("SELECT * FROM book_characters WHERE id=?").get(id) as
      | CharacterRow
      | undefined;
    return row ? toCharacter(row) : null;
  }

  createCharacter(bookId: string, fields: CharacterFields & { name: string }): Character {
    const id = this.newId();
    const count = (
      this.conn.prepare("SELECT COUNT(*) n FROM book_characters WHERE book_id=?").get(bookId) as {
        n: number;
      }
    ).n;
    this.conn
      .prepare(
        `INSERT INTO book_characters (id, book_id, name, aliases, description, voice_id,
           model_id, request_options, color, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        bookId,
        fields.name,
        JSON.stringify(fields.aliases ?? []),
        fields.description ?? null,
        fields.voice_id ?? null,
        fields.model_id ?? null,
        JSON.stringify(fields.request_options ?? {}),
        // Index 0 is the narrator's colour in the UI, so characters start at 1.
        fields.color ?? count + 1,
        this.now(),
      );
    this.touchBook(bookId);
    return this.getCharacter(id)!;
  }

  updateCharacter(id: string, fields: CharacterFields): Character | null {
    const current = this.getCharacter(id);
    if (!current) return null;
    const next = { ...current, ...fields };
    this.conn
      .prepare(
        `UPDATE book_characters SET name=?, aliases=?, description=?, voice_id=?, model_id=?,
           request_options=?, color=? WHERE id=?`,
      )
      .run(
        next.name,
        JSON.stringify(next.aliases),
        next.description,
        next.voice_id,
        next.model_id,
        JSON.stringify(next.request_options),
        next.color,
        id,
      );
    this.touchBook(current.book_id);
    return this.getCharacter(id);
  }

  deleteCharacter(id: string): boolean {
    const current = this.getCharacter(id);
    if (!current) return false;
    this.conn.prepare("DELETE FROM book_characters WHERE id=?").run(id);
    this.touchBook(current.book_id);
    return true;
  }

  /** Paragraphs cast as `characterId`, across the book. */
  segmentsForCharacter(characterId: string): string[] {
    const rows = this.conn
      .prepare("SELECT segment_id FROM book_paragraphs WHERE character_id=?")
      .all(characterId) as { segment_id: string }[];
    return rows.map((r) => r.segment_id);
  }

  /* ------------------------------------------------------------------ notes */

  listNotes(
    bookId: string,
    opts: { resolved?: boolean; chapterId?: string; segmentId?: string } = {},
  ): BookNote[] {
    const where = ["n.book_id = ?"];
    const args: (string | number)[] = [bookId];
    if (opts.resolved !== undefined) {
      where.push("n.resolved = ?");
      args.push(opts.resolved ? 1 : 0);
    }
    if (opts.chapterId) {
      where.push("c.id = ?");
      args.push(opts.chapterId);
    }
    if (opts.segmentId) {
      where.push("n.segment_id = ?");
      args.push(opts.segmentId);
    }
    const rows = this.conn
      .prepare(
        `SELECT n.*, c.id AS chapter_id FROM book_notes n
           JOIN story_segments s ON s.id = n.segment_id
           JOIN book_chapters c ON c.story_id = s.story_id
          WHERE ${where.join(" AND ")}
          ORDER BY c.position, s.position, COALESCE(n.at_s, 0), n.created_at`,
      )
      .all(...args) as NoteRow[];
    return rows.map(toNote);
  }

  getNote(id: string): BookNote | null {
    const row = this.conn
      .prepare(
        `SELECT n.*, c.id AS chapter_id FROM book_notes n
           JOIN story_segments s ON s.id = n.segment_id
           JOIN book_chapters c ON c.story_id = s.story_id
          WHERE n.id = ?`,
      )
      .get(id) as NoteRow | undefined;
    return row ? toNote(row) : null;
  }

  createNote(bookId: string, segmentId: string, body: string, atS: number | null): BookNote {
    const id = this.newId();
    const now = this.now();
    this.conn
      .prepare(
        `INSERT INTO book_notes (id, book_id, segment_id, body, at_s, resolved, created_at, updated_at)
         VALUES (?,?,?,?,?,0,?,?)`,
      )
      .run(id, bookId, segmentId, body, atS, now, now);
    return this.getNote(id)!;
  }

  updateNote(id: string, fields: { body?: string; resolved?: boolean; at_s?: number | null }): BookNote | null {
    const note = this.getNote(id);
    if (!note) return null;
    this.conn
      .prepare("UPDATE book_notes SET body=?, resolved=?, at_s=?, updated_at=? WHERE id=?")
      .run(
        fields.body ?? note.body,
        (fields.resolved ?? note.resolved) ? 1 : 0,
        "at_s" in fields ? (fields.at_s ?? null) : note.at_s,
        this.now(),
        id,
      );
    return this.getNote(id);
  }

  deleteNote(id: string): boolean {
    return this.conn.prepare("DELETE FROM book_notes WHERE id=?").run(id).changes > 0;
  }

  /** Move every note on `from` to `to` (a merge folds one paragraph into another). */
  moveNotes(from: string, to: string): void {
    this.conn.prepare("UPDATE book_notes SET segment_id=?, at_s=NULL WHERE segment_id=?").run(to, from);
  }

  /** Open notes per chapter id. */
  openNoteCounts(bookId: string): Map<string, number> {
    const rows = this.conn
      .prepare(
        `SELECT c.id AS chapter_id, COUNT(*) AS n FROM book_notes n
           JOIN story_segments s ON s.id = n.segment_id
           JOIN book_chapters c ON c.story_id = s.story_id
          WHERE n.book_id = ? AND n.resolved = 0
          GROUP BY c.id`,
      )
      .all(bookId) as { chapter_id: string; n: number }[];
    return new Map(rows.map((r) => [r.chapter_id, r.n]));
  }

  /** The ParagraphMeta for a row, with defaults for a segment with no row. */
  static meta(
    segmentId: string,
    chapterId: string,
    row: MetaRow | undefined,
  ): ParagraphMeta & { model_id: string | null } {
    return {
      model_id: row?.model_id ?? null,
      segment_id: segmentId,
      chapter_id: chapterId,
      character_id: row?.character_id ?? null,
      locked: row?.locked === 1,
      is_heading: row?.is_heading === 1,
    };
  }
}
