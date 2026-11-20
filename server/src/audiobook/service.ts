/**
 * The audiobook service: the one API every audiobook module calls.
 *
 * Get it with `audiobooks(svc)`; there is one per `MirliService`. It reads the
 * store through `svc.db.audiobooks` at call time, so a profile switch (which
 * reopens the database) needs nothing from here.
 *
 * Public methods
 * --------------
 * Events
 *   hub                                       AudiobookHub: publish(bookId, event), subscribe
 *   onDelete(cb)                              cleanup before a book's or chapter's stories go
 *   onDuplicate(cb)                           after duplicateBook, with old->new chapter and segment
 *                                             id maps, so a module can copy its own rows (beds)
 *
 * Books
 *   listBooks(project?): BookSummary[]       undefined = all, null = no project, else that project's
 *   getBook(id): BookDetail | null            book + chapters (with stats) + characters + totals
 *   createBook(fields): BookDetail            blank book with one empty chapter
 *   createBookFromManuscript(manuscript, settings?, opts?): BookDetail   (import)
 *   updateBook(id, fields): BookDetail | null  settings merge; narrator change re-voices nothing,
 *                                              it updates segment voices and marks takes stale
 *   deleteBook(id, deleteSounds = true): Promise<boolean>
 *   setCover(id, bytes, mime): Promise<BookDetail | null>
 *   coverFile(id): { path, mime } | null
 *   stats(id): BookStats | null
 *
 * Chapters
 *   addChapter(bookId, { title, kind?, included?, position?, paragraphs?, headings? }): ChapterWithStats
 *   addChapterFromText(bookId, { text, title?, kind?, position?, markdown?, max_chars? }): ChapterWithStats
 *                                             cleaned with the importer's rules (import/plain, import/text)
 *   duplicateBook(bookId, title?): Promise<BookDetail>
 *   updateChapter(chapterId, { title?, kind?, included? }): Chapter | null
 *   reorderChapters(bookId, ids): boolean
 *   deleteChapter(chapterId, deleteSounds = true): Promise<boolean>
 *   getChapter(chapterId): Chapter | null
 *   chapterForSegment(segmentId): Chapter | null      any segment of a chapter story (beds too)
 *   chapterForParagraph(segmentId): Chapter | null    track-0 segments only
 *
 * Paragraphs are track 0 of a chapter story. Other tracks hold soundscape
 * beds; nothing here lists, counts, casts, replaces, reorders, captures or
 * deletes them.
 *
 * Paragraphs (one paragraph = one story_segments row)
 *   getParagraphs(chapterId): Paragraph[] | null
 *   getParagraph(segmentId): Paragraph | null
 *   addParagraph(chapterId, { text, position?, character_id?, is_heading?, kind?, duration_s? }): Paragraph
 *                                             kind "pause" is a beat of silence of duration_s
 *   splitParagraph(segmentId, at): { first, second }    split the text at a character offset
 *   mergeWithNext(segmentId, joiner?): { paragraph, removed_id, split_at }
 *   reorderParagraphs(chapterId, ids): Paragraph[] | null
 *   updateParagraph(segmentId, { text?, character_id?, locked?, is_heading?, model_id? }): Paragraph | null
 *   modelFor(segmentId): string | null        paragraph override, else character's, else book's
 *   deleteParagraph(segmentId): boolean
 *   setParagraphCharacter(segmentIds | segmentId, characterId | null): number
 *   markStale(segmentIds): number             e.g. a pronunciation rule changed
 *   markVoiced(segmentId, spokenText): void   the render path records what it spoke
 *   replace(bookId, ReplaceRequest): ReplaceResult   find/replace, skips locked paragraphs
 *
 * Review notes
 *   listNotes(bookId, { resolved?, chapterId?, segmentId? }): BookNote[]
 *   addNote(segmentId, body, at_s?): BookNote
 *   updateNote(noteId, { body?, resolved?, at_s? }): BookNote | null
 *   deleteNote(noteId): boolean
 *
 * Snapshots (saved versions)
 *   saveSnapshot(bookId, label?): SnapshotInfo
 *   listSnapshots(bookId), getSnapshot(snapshotId), deleteSnapshot(snapshotId)
 *   diffSnapshot(snapshotId): SnapshotDiff     snapshot -> current, by paragraph id
 *   restoreSnapshot(snapshotId): Promise<{ book, before }>   saves "Before restoring" first
 *
 * Characters (table owned here; routes and detection belong to the voice area)
 *   listCharacters(bookId), getCharacter(id), createCharacter(bookId, fields),
 *   updateCharacter(id, fields), deleteCharacter(id)
 *   syncVoices(bookId, segmentIds?): number   write each paragraph's voice/speaker from the cast;
 *                                             a changed voice marks its take stale
 *   voiceFor(bookId, characterId): string | null   the voice a paragraph is read with
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ModelError } from "../errors.js";
import type { StorySegment } from "../schemas.js";
import type { MirliService } from "../service.js";
import { AudiobookHub } from "./hub.js";
import { textToBlocks } from "./import/plain.js";
import { cleanParagraphs, tidyTitle } from "./import/text.js";
import {
  AudiobookStore,
  chapterStatus,
  type BookFields,
  type BookNote,
  type BookStats,
  type ChapterWithStats,
  type CharacterFields,
  type ParagraphStatus,
  type SettingsPatch,
  type SnapshotInfo,
  PARAGRAPH_TRACK,
} from "./store.js";
import type {
  Book,
  Chapter,
  ChapterKind,
  Character,
  Manuscript,
  ParagraphMeta,
} from "./types.js";

export type { BookNote, BookStats, ChapterWithStats, ParagraphStatus, SnapshotInfo } from "./store.js";

/** A paragraph: the story segment, its audiobook state, and a status. */
export type Paragraph = StorySegment &
  ParagraphMeta & {
    status: ParagraphStatus;
    /** This paragraph's own model, or null to use the character's or book's. */
    model_id: string | null;
  };

export interface BookSummary extends Book {
  stats: BookStats;
}

export interface BookDetail extends Book {
  chapters: ChapterWithStats[];
  characters: Character[];
  stats: BookStats;
}

export interface ReplaceRequest {
  find: string;
  replace: string;
  case_sensitive?: boolean;
  whole_word?: boolean;
  /** Treat `find` as a regular expression; `replace` may use $1 etc. */
  regex?: boolean;
  /** Limit to these chapters. Default: every chapter. */
  chapter_ids?: string[];
  /** Count only; change nothing. */
  dry_run?: boolean;
}

export interface ReplaceResult {
  /** Matches found in unlocked paragraphs (replaced unless dry_run). */
  matches: number;
  /** Paragraphs whose text changed (or would change). */
  paragraphs: number;
  /** Locked paragraphs that matched and were left alone. */
  skipped_locked: number;
  /** Matches inside those locked paragraphs. */
  skipped_matches: number;
  changed: { chapter_id: string; segment_id: string }[];
  dry_run: boolean;
}

/** One paragraph as a snapshot keeps it. */
export interface SnapshotParagraph {
  segment_id: string;
  kind: "line" | "pause";
  text: string;
  duration_s: number | null;
  character_id: string | null;
  locked: boolean;
  is_heading: boolean;
  model_id: string | null;
  /** The take on the timeline when the snapshot was saved. */
  sound_id: string | null;
  request_options: Record<string, string>;
}

export interface SnapshotChapter {
  id: string;
  story_id: string;
  title: string;
  kind: ChapterKind;
  included: boolean;
  paragraphs: SnapshotParagraph[];
}

export interface BookSnapshotData {
  version: 1;
  book: Omit<Book, "id" | "created_at" | "updated_at" | "cover_path">;
  characters: Character[];
  chapters: SnapshotChapter[];
}

export type DiffStatus = "added" | "removed" | "changed";

export interface SnapshotDiff {
  snapshot: SnapshotInfo;
  /** Book fields whose value differs, by name. */
  book: { field: string; before: unknown; after: unknown }[];
  chapters: {
    chapter_id: string;
    title: string;
    status: DiffStatus | "same";
    title_before?: string;
    paragraphs: { segment_id: string; status: DiffStatus; before: string | null; after: string | null }[];
  }[];
  summary: { added: number; removed: number; changed: number };
}

export interface DuplicateScope {
  from_book_id: string;
  to_book_id: string;
  /** Original chapter id -> copy's chapter id. */
  chapters: Map<string, string>;
  /** Original segment id -> copy's segment id, every track. */
  segments: Map<string, string>;
}

export type DeleteScope = { book_id: string; chapter_ids: string[]; story_ids: string[] };

const NARRATOR_SPEAKER = "Narrator";
const COVER_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function emptyTotals(): BookStats {
  return {
    chapters: 0,
    paragraphs: 0,
    voiced: 0,
    stale: 0,
    locked: 0,
    characters: 0,
    duration_s: 0,
    open_notes: 0,
  };
}

function stringOptions(options: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(options)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The pattern for a find/replace request. Throws ModelError on a bad regex. */
export function replacePattern(req: ReplaceRequest): RegExp {
  let source = req.regex ? req.find : escapeRegex(req.find);
  if (req.whole_word) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, `gu${req.case_sensitive ? "" : "i"}`);
  } catch (exc) {
    throw new ModelError(`Invalid pattern: ${exc instanceof Error ? exc.message : String(exc)}`);
  }
}

export class AudiobookService {
  readonly hub = new AudiobookHub();
  private readonly deleteHooks: ((scope: DeleteScope) => void | Promise<void>)[] = [];
  private readonly duplicateHooks: ((scope: DuplicateScope) => void | Promise<void>)[] = [];

  constructor(private readonly svc: MirliService) {}

  private get store(): AudiobookStore {
    return this.svc.db.audiobooks;
  }

  /** Run before a book's or chapter's stories are deleted, so a module can
   *  drop rows that point at their segments or sounds (takes, renders). */
  onDelete(cb: (scope: DeleteScope) => void | Promise<void>): void {
    this.deleteHooks.push(cb);
  }

  /** Run after a book is duplicated, so a module can copy rows that point
   *  at the original's chapters or segments (the soundscape's beds). */
  onDuplicate(cb: (scope: DuplicateScope) => void | Promise<void>): void {
    this.duplicateHooks.push(cb);
  }

  /* ------------------------------------------------------------------ books */

  listBooks(project?: string | null): BookSummary[] {
    return this.store.listBooks(project).map((book) => ({ ...book, stats: this.stats(book.id)! }));
  }

  getBook(id: string): BookDetail | null {
    const book = this.store.getBook(id);
    if (!book) return null;
    const stats = this.store.chapterStats(id);
    const notes = this.store.openNoteCounts(id);
    const totals = emptyTotals();
    const chapters: ChapterWithStats[] = this.store.listChapters(id).map((chapter) => {
      const s = stats.get(chapter.id)!;
      totals.chapters++;
      totals.paragraphs += s.paragraphs;
      totals.voiced += s.voiced;
      totals.stale += s.stale;
      totals.locked += s.locked;
      totals.characters += s.characters;
      totals.duration_s += s.duration_s;
      const open = notes.get(chapter.id) ?? 0;
      totals.open_notes += open;
      const { stale: _stale, ...chapterStats } = s;
      return {
        ...chapter,
        stats: chapterStats,
        status: chapterStatus(chapterStats),
        open_notes: open,
      };
    });
    totals.duration_s = Math.round(totals.duration_s * 100) / 100;
    return { ...book, chapters, characters: this.store.listCharacters(id), stats: totals };
  }

  stats(id: string): BookStats | null {
    return this.getBook(id)?.stats ?? null;
  }

  createBook(fields: BookFields & { title?: string | null }): BookDetail {
    const book = this.store.createBook({ ...fields, title: fields.title?.trim() || "Untitled book" });
    this.addChapter(book.id, { title: "Chapter 1" });
    return this.getBook(book.id)!;
  }

  /**
   * Build a whole book from a parsed manuscript. Each section becomes a
   * chapter; each paragraph a segment. With `headings` (default on), a
   * chapter's title is spoken as its first paragraph, marked as a heading,
   * unless the section already starts with it.
   */
  async createBookFromManuscript(
    manuscript: Manuscript,
    settings: SettingsPatch = {},
    opts: { headings?: boolean; project_id?: string | null } = {},
  ): Promise<BookDetail> {
    const book = this.store.createBook({
      title: manuscript.title?.trim() || "Untitled book",
      subtitle: manuscript.subtitle,
      author: manuscript.author,
      description: manuscript.description,
      language: manuscript.language || "en",
      isbn: manuscript.isbn,
      publisher: manuscript.publisher,
      publication_date: manuscript.publication_date,
      project_id: opts.project_id ?? null,
      settings,
    });
    for (const section of manuscript.sections) {
      this.addChapterQuiet(book.id, {
        title: section.title || "Untitled",
        kind: section.kind,
        included: section.included,
        paragraphs: section.paragraphs,
        headings: opts.headings ?? true,
        breaks: section.breaks,
        sceneBreakS: book.settings.pacing.scene_break_s ?? 2,
      });
    }
    if (manuscript.cover) await this.setCover(book.id, manuscript.cover.bytes, manuscript.cover.mime);
    this.hub.publish(book.id, { type: "chapters" });
    return this.getBook(book.id)!;
  }

  updateBook(id: string, fields: BookFields): BookDetail | null {
    const before = this.store.getBook(id);
    if (!before) return null;
    if (fields.settings?.narrator_voice_id) this.assertVoice(fields.settings.narrator_voice_id);
    const book = this.store.updateBook(id, fields)!;
    // A book's chapters live in its project too, so the project's library
    // view finds the book's audio.
    if ("project_id" in fields && before.project_id !== book.project_id) {
      for (const chapter of this.store.listChapters(id)) {
        this.svc.setStoryProject(chapter.story_id, book.project_id);
      }
    }
    if (fields.settings?.request_options !== undefined) {
      const options = stringOptions(book.settings.request_options);
      for (const chapter of this.store.listChapters(id)) {
        this.svc.setStoryOptions(chapter.story_id, options);
      }
    }
    if (
      before.settings.narrator_voice_id !== book.settings.narrator_voice_id ||
      before.settings.cast_mode !== book.settings.cast_mode
    ) {
      this.syncVoices(id);
    }
    this.hub.publish(id, { type: "book" });
    return this.getBook(id);
  }

  async deleteBook(id: string, deleteSounds = true): Promise<boolean> {
    const book = this.store.getBook(id);
    if (!book) return false;
    const chapters = this.store.listChapters(id);
    await this.runDeleteHooks({
      book_id: id,
      chapter_ids: chapters.map((c) => c.id),
      story_ids: chapters.map((c) => c.story_id),
    });
    for (const chapter of chapters) await this.svc.deleteStory(chapter.story_id, deleteSounds);
    this.store.deleteBook(id);
    if (book.cover_path) await unlinkQuiet(join(this.svc.config.paths.artwork, book.cover_path));
    this.hub.publish(id, { type: "deleted" });
    return true;
  }

  async setCover(id: string, bytes: Uint8Array, mime: string): Promise<BookDetail | null> {
    const book = this.store.getBook(id);
    if (!book) return null;
    const ext = COVER_MIME[mime.toLowerCase()];
    if (!ext) throw new ModelError(`Unsupported cover type '${mime}'. Use PNG, JPEG, WebP or GIF.`);
    const dir = this.svc.config.paths.artwork;
    mkdirSync(dir, { recursive: true });
    const filename = `book-${id}-${randomUUID().slice(0, 8)}.${ext}`;
    await writeFile(join(dir, filename), bytes);
    this.store.updateBook(id, { cover_path: filename });
    if (book.cover_path) await unlinkQuiet(join(dir, book.cover_path));
    this.hub.publish(id, { type: "book" });
    return this.getBook(id);
  }

  coverFile(id: string): { path: string; mime: string } | null {
    const book = this.store.getBook(id);
    if (!book?.cover_path) return null;
    const ext = book.cover_path.split(".").pop() ?? "";
    const mime = Object.entries(COVER_MIME).find(([, e]) => e === ext)?.[0] ?? "image/png";
    return { path: join(this.svc.config.paths.artwork, book.cover_path), mime };
  }

  /** Cover bytes, for exporters that embed it. */
  async coverBytes(id: string): Promise<{ bytes: Buffer; mime: string } | null> {
    const file = this.coverFile(id);
    if (!file) return null;
    try {
      return { bytes: await readFile(file.path), mime: file.mime };
    } catch {
      return null;
    }
  }

  /* --------------------------------------------------------------- chapters */

  getChapter(chapterId: string): Chapter | null {
    return this.store.getChapter(chapterId);
  }

  /** The chapter of any segment in a chapter story, beds included. */
  chapterForSegment(segmentId: string): Chapter | null {
    return this.store.chapterForSegment(segmentId);
  }

  /** The chapter of a paragraph (a track-0 segment); null for a bed. */
  chapterForParagraph(segmentId: string): Chapter | null {
    return this.store.chapterForParagraph(segmentId);
  }

  addChapter(
    bookId: string,
    fields: {
      title: string;
      kind?: ChapterKind;
      included?: boolean;
      position?: number | null;
      paragraphs?: string[];
      headings?: boolean;
    },
  ): ChapterWithStats {
    const chapter = this.addChapterQuiet(bookId, fields);
    this.hub.publish(bookId, { type: "chapters" });
    return this.getBook(bookId)!.chapters.find((c) => c.id === chapter.id)!;
  }

  private addChapterQuiet(
    bookId: string,
    fields: {
      title: string;
      kind?: ChapterKind;
      included?: boolean;
      position?: number | null;
      paragraphs?: string[];
      headings?: boolean;
      /** Indexes into `paragraphs` to mark as headings. */
      headingIndexes?: number[];
      /** Scene breaks: a pause goes before `paragraphs[i]` for each i. */
      breaks?: number[];
      /** Length of a scene-break pause, seconds. */
      sceneBreakS?: number;
    },
  ): Chapter {
    const book = this.store.getBook(bookId);
    if (!book) throw new ModelError(`Book '${bookId}' not found.`);
    const title = fields.title.trim() || "Untitled";
    const narrator = this.existingVoice(book.settings.narrator_voice_id);
    const now = new Date().toISOString();
    return this.store.transaction(() => {
      const story = this.svc.db.createStory(randomUUID(), title, now, book.project_id, "script");
      const options = stringOptions(book.settings.request_options);
      if (Object.keys(options).length > 0) this.svc.db.setStoryOptions(story.id, options);
      const chapter = this.store.createChapter(bookId, story.id, { ...fields, title });
      // Headings and breaks index the paragraphs as given; empty ones are
      // dropped, so both are carried on each kept paragraph rather than
      // recomputed after.
      const headingAt = new Set(fields.headingIndexes ?? []);
      const breakAt = new Set(fields.breaks ?? []);
      const kept: { text: string; heading: boolean; breakBefore: boolean }[] = [];
      let pendingBreak = false;
      (fields.paragraphs ?? []).forEach((raw, i) => {
        if (breakAt.has(i)) pendingBreak = true;
        const text = raw.trim();
        if (!text) return;
        // A break before the first paragraph is not a break inside the chapter.
        kept.push({ text, heading: headingAt.has(i), breakBefore: pendingBreak && kept.length > 0 });
        pendingBreak = false;
      });
      const firstIsTitle = kept[0]?.text.toLowerCase() === title.toLowerCase();
      const heading = fields.headings === true && (fields.kind ?? "chapter") === "chapter" && !firstIsTitle;
      if (heading) kept.unshift({ text: title, heading: true, breakBefore: false });
      else if (firstIsTitle) kept[0]!.heading = true;
      const pauseS = fields.sceneBreakS ?? 2;
      for (const line of kept) {
        if (line.breakBefore && pauseS > 0) {
          this.svc.db.createSegment(randomUUID(), story.id, now, {
            text: "",
            kind: "pause",
            durationS: pauseS,
          });
        }
        const segment = this.svc.db.createSegment(randomUUID(), story.id, now, {
          text: line.text,
          voice_id: narrator,
          speaker: NARRATOR_SPEAKER,
          language: book.language,
        });
        if (line.heading) this.store.setMeta(segment.id, { is_heading: true });
      }
      return chapter;
    });
  }

  /**
   * A chapter from pasted text, cleaned up with the importer's rules: blank
   * lines separate paragraphs, hard-wrapped lines are joined and hyphens
   * mended, Markdown is stripped, footnote markers dropped and very long
   * paragraphs split at sentences. A heading line in the text becomes a
   * heading paragraph; the first one is the title when none is given.
   */
  addChapterFromText(
    bookId: string,
    fields: {
      text: string;
      title?: string | null;
      kind?: ChapterKind;
      position?: number | null;
      markdown?: boolean;
      max_chars?: number;
    },
  ): ChapterWithStats {
    const blocks = textToBlocks(fields.text, fields.markdown ?? false);
    const paragraphs: string[] = [];
    const headingIndexes: number[] = [];
    let title = fields.title?.trim() || null;
    for (const block of blocks) {
      if (block.type === "heading") {
        const text = tidyTitle(block.text);
        if (!text) continue;
        if (!title) {
          title = text;
          continue;
        }
        headingIndexes.push(paragraphs.length);
        paragraphs.push(text);
      } else {
        paragraphs.push(...cleanParagraphs([block.text], { maxChars: fields.max_chars }));
      }
    }
    if (paragraphs.length === 0) throw new ModelError("There is no text to make a chapter from.");
    if (!title) {
      const words = paragraphs[0]!.split(/\s+/).slice(0, 6).join(" ");
      title = words.length < paragraphs[0]!.length ? `${words}…` : words;
    }
    const chapter = this.addChapterQuiet(bookId, {
      title,
      kind: fields.kind,
      position: fields.position,
      paragraphs,
      headings: true,
      headingIndexes,
    });
    this.hub.publish(bookId, { type: "chapters" });
    return this.getBook(bookId)!.chapters.find((c) => c.id === chapter.id)!;
  }

  /**
   * Copy a book: metadata, settings, cover, cast, chapters and paragraphs
   * with their casting, lock, heading, model, delivery and takes, plus every
   * other clip on the chapter stories (soundscape beds) and the stories'
   * track settings. The copy shares audio with the original (deleting
   * either keeps audio the other still uses). Notes and versions are not
   * copied. `onDuplicate` hooks run last, with the id maps.
   */
  async duplicateBook(bookId: string, title?: string | null): Promise<BookDetail> {
    const src = this.store.getBook(bookId);
    if (!src) throw new ModelError(`Book '${bookId}' not found.`);
    const { id: _id, created_at: _c, updated_at: _u, cover_path, settings, ...fields } = src;
    const copy = this.store.createBook({
      ...fields,
      title: title?.trim() || `${src.title} (copy)`,
      settings,
    });
    const characters = new Map<string, string>();
    for (const c of this.store.listCharacters(bookId)) {
      const { id, book_id: _b, ...rest } = c;
      characters.set(id, this.store.createCharacter(copy.id, rest).id);
    }
    const now = new Date().toISOString();
    const chapterMap = new Map<string, string>();
    const segmentMap = new Map<string, string>();
    for (const chapter of this.store.listChapters(bookId)) {
      const meta = new Map(this.paragraphsOf(chapter).map((p) => [p.id, p]));
      // Every clip in story order, beds included, so positions carry over.
      const segments = this.svc.db.listSegments(chapter.story_id);
      const tracks = this.svc.db.listTracks(chapter.story_id);
      const srcStory = this.svc.db.getStory(chapter.story_id);
      this.store.transaction(() => {
        const story = this.svc.db.createStory(randomUUID(), chapter.title, now, src.project_id, "script");
        if (srcStory && Object.keys(srcStory.request_options).length > 0) {
          this.svc.db.setStoryOptions(story.id, srcStory.request_options);
        }
        for (const t of tracks) {
          this.svc.db.updateTrack(story.id, t.track_index, {
            name: t.name,
            muted: t.muted,
            soloed: t.soloed,
            gain_db: t.gain_db,
            devices: t.devices,
          });
        }
        const made = this.store.createChapter(copy.id, story.id, {
          title: chapter.title,
          kind: chapter.kind,
          included: chapter.included,
        });
        chapterMap.set(chapter.id, made.id);
        const stale: string[] = [];
        for (const s of segments) {
          const p = meta.get(s.id);
          const segment = this.svc.db.createSegment(randomUUID(), story.id, now, {
            text: s.text,
            kind: s.kind,
            speaker: s.speaker ?? null,
            voice_id: s.voice_id ?? null,
            language: s.language ?? null,
            sound_id: s.sound_id ?? null,
            durationS: s.duration_s ?? null,
            track_index: s.track_index,
            start_s: s.start_s,
            trim_start_s: s.trim_start_s,
            fade_in_s: s.fade_in_s,
            fade_out_s: s.fade_out_s,
            gain_db: s.gain_db,
            muted: s.muted,
            request_options: s.request_options,
            midi: s.midi ?? null,
          });
          segmentMap.set(s.id, segment.id);
          if (!p) continue; // a bed: no paragraph state
          this.store.setMeta(segment.id, {
            character_id: p.character_id ? (characters.get(p.character_id) ?? null) : null,
            locked: p.locked,
            is_heading: p.is_heading,
            model_id: p.model_id,
          });
          if (p.sound_id) {
            this.store.markVoiced(segment.id, p.text);
            if (p.status === "stale") stale.push(segment.id);
          }
        }
        if (stale.length) this.store.markStale(stale);
      });
    }
    if (cover_path) {
      const bytes = await this.coverBytes(bookId);
      if (bytes) await this.setCover(copy.id, bytes.bytes, bytes.mime);
    }
    for (const hook of this.duplicateHooks) {
      await hook({ from_book_id: bookId, to_book_id: copy.id, chapters: chapterMap, segments: segmentMap });
    }
    return this.getBook(copy.id)!;
  }

  updateChapter(
    chapterId: string,
    fields: { title?: string; kind?: ChapterKind; included?: boolean },
  ): Chapter | null {
    const chapter = this.store.updateChapter(chapterId, {
      ...fields,
      title: fields.title?.trim() || undefined,
    });
    if (!chapter) return null;
    if (fields.title?.trim()) this.svc.renameStory(chapter.story_id, chapter.title);
    this.hub.publish(chapter.book_id, { type: "chapters" });
    return chapter;
  }

  reorderChapters(bookId: string, ids: string[]): boolean {
    const ok = this.store.reorderChapters(bookId, ids);
    if (ok) this.hub.publish(bookId, { type: "chapters" });
    return ok;
  }

  async deleteChapter(chapterId: string, deleteSounds = true): Promise<boolean> {
    const chapter = this.store.getChapter(chapterId);
    if (!chapter) return false;
    await this.runDeleteHooks({
      book_id: chapter.book_id,
      chapter_ids: [chapter.id],
      story_ids: [chapter.story_id],
    });
    this.store.deleteChapter(chapterId);
    await this.svc.deleteStory(chapter.story_id, deleteSounds);
    this.hub.publish(chapter.book_id, { type: "chapters" });
    return true;
  }

  private async runDeleteHooks(scope: DeleteScope): Promise<void> {
    for (const hook of this.deleteHooks) await hook(scope);
  }

  /* ------------------------------------------------------------- paragraphs */

  getParagraphs(chapterId: string): Paragraph[] | null {
    const chapter = this.store.getChapter(chapterId);
    if (!chapter) return null;
    return this.paragraphsOf(chapter);
  }

  private paragraphsOf(chapter: Chapter): Paragraph[] {
    const segments = this.svc
      .listSegments(chapter.story_id)
      .filter((s) => s.track_index === PARAGRAPH_TRACK);
    const stale = this.store.staleSegments(chapter.story_id);
    const meta = this.store.getMeta(segments.map((s) => s.id));
    return segments.map((segment) => {
      const m = AudiobookStore.meta(segment.id, chapter.id, meta.get(segment.id));
      const status: ParagraphStatus = m.locked
        ? "locked"
        : segment.kind === "pause"
          ? "voiced"
          : !segment.sound_id
            ? "unvoiced"
            : stale.has(segment.id)
              ? "stale"
              : "voiced";
      return { ...segment, ...m, status };
    });
  }

  getParagraph(segmentId: string): Paragraph | null {
    const chapter = this.store.chapterForParagraph(segmentId);
    if (!chapter) return null;
    return this.paragraphsOf(chapter).find((p) => p.id === segmentId) ?? null;
  }

  addParagraph(
    chapterId: string,
    fields: {
      text: string;
      position?: number | null;
      character_id?: string | null;
      is_heading?: boolean;
      kind?: "line" | "pause";
      duration_s?: number | null;
    },
  ): Paragraph {
    const chapter = this.store.getChapter(chapterId);
    if (!chapter) throw new ModelError(`Chapter '${chapterId}' not found.`);
    const book = this.store.getBook(chapter.book_id)!;
    const pause = fields.kind === "pause";
    const segment = this.svc.createSegment(
      chapter.story_id,
      pause
        ? {
            text: "",
            position: fields.position ?? null,
            track_index: 0,
            kind: "pause",
            duration_s: fields.duration_s ?? 1,
          }
        : {
            text: fields.text,
            position: fields.position ?? null,
            voice_id: this.existingVoice(book.settings.narrator_voice_id),
            speaker: NARRATOR_SPEAKER,
            language: book.language,
            track_index: 0,
            kind: "line",
          },
    );
    if (pause) {
      this.publishParagraphs(chapter, [segment.id]);
      return this.getParagraph(segment.id)!;
    }
    if (fields.is_heading) this.store.setMeta(segment.id, { is_heading: true });
    if (fields.character_id) this.setParagraphCharacter([segment.id], fields.character_id);
    this.publishParagraphs(chapter, [segment.id]);
    return this.getParagraph(segment.id)!;
  }

  /**
   * Edit one paragraph. A locked paragraph's text can't change (unlock it
   * first); its lock, heading flag and character can.
   */
  updateParagraph(
    segmentId: string,
    fields: {
      text?: string;
      character_id?: string | null;
      locked?: boolean;
      is_heading?: boolean;
      model_id?: string | null;
    },
  ): Paragraph | null {
    const chapter = this.store.chapterForParagraph(segmentId);
    if (!chapter) return null;
    if (fields.text !== undefined) {
      const current = this.getParagraph(segmentId)!;
      const unlocking = fields.locked === false;
      if (current.locked && !unlocking && fields.text !== current.text) {
        throw new ModelError("This paragraph is locked. Unlock it to edit its text.");
      }
      // Record what the take was voiced from before the text moves.
      this.store.syncVoiced([chapter.story_id]);
      this.svc.updateSegment(segmentId, { text: fields.text });
    }
    const meta: { locked?: boolean; is_heading?: boolean; model_id?: string | null } = {};
    if (fields.locked !== undefined) meta.locked = fields.locked;
    if (fields.is_heading !== undefined) meta.is_heading = fields.is_heading;
    if ("model_id" in fields) meta.model_id = fields.model_id ?? null;
    if (Object.keys(meta).length > 0) this.store.setMeta(segmentId, meta);
    if ("character_id" in fields) this.setParagraphCharacter([segmentId], fields.character_id ?? null);
    this.publishParagraphs(chapter, [segmentId]);
    return this.getParagraph(segmentId);
  }

  /**
   * Split a paragraph's text at a character offset. The first half keeps the
   * segment (and its take, now stale); the second is a new, unvoiced
   * paragraph read by the same character.
   */
  splitParagraph(segmentId: string, at: number): { first: Paragraph; second: Paragraph } {
    const p = this.getParagraph(segmentId);
    if (!p) throw new ModelError("Paragraph not found.");
    if (p.kind !== "line") throw new ModelError("Only a spoken paragraph can be split.");
    if (p.locked) throw new ModelError("This paragraph is locked. Unlock it to split it.");
    const head = p.text.slice(0, at).trimEnd();
    const tail = p.text.slice(at).trimStart();
    if (!head || !tail) throw new ModelError("Split inside the text, not at its start or end.");
    const chapter = this.store.getChapter(p.chapter_id)!;
    this.store.syncVoiced([chapter.story_id]);
    this.svc.updateSegment(segmentId, { text: head });
    const second = this.addParagraph(chapter.id, {
      text: tail,
      position: p.position + 1,
      character_id: p.character_id,
    });
    if (p.model_id) this.store.setMeta(second.id, { model_id: p.model_id });
    this.publishParagraphs(chapter, [segmentId, second.id]);
    return { first: this.getParagraph(segmentId)!, second: this.getParagraph(second.id)! };
  }

  /**
   * Append the next paragraph's text to this one and delete the next. The
   * first keeps its casting; its take goes stale. `split_at` is where the
   * second half starts in the merged text, so a caller can undo by
   * splitting there.
   */
  mergeWithNext(
    segmentId: string,
    joiner = " ",
  ): { paragraph: Paragraph; removed_id: string; split_at: number } {
    const p = this.getParagraph(segmentId);
    if (!p) throw new ModelError("Paragraph not found.");
    const chapter = this.store.getChapter(p.chapter_id)!;
    const list = this.paragraphsOf(chapter);
    const next = list[list.findIndex((x) => x.id === segmentId) + 1];
    if (!next) throw new ModelError("There is no paragraph after this one.");
    if (p.kind !== "line" || next.kind !== "line") {
      throw new ModelError("Only two spoken paragraphs can be merged.");
    }
    if (p.locked || next.locked) throw new ModelError("Unlock both paragraphs to merge them.");
    const sep = p.text && next.text ? joiner : "";
    const splitAt = p.text.length + sep.length;
    this.store.syncVoiced([chapter.story_id]);
    this.svc.updateSegment(segmentId, { text: p.text + sep + next.text });
    this.store.moveNotes(next.id, segmentId);
    this.svc.deleteSegment(next.id);
    this.publishParagraphs(chapter, [segmentId, next.id]);
    return { paragraph: this.getParagraph(segmentId)!, removed_id: next.id, split_at: splitAt };
  }

  /** `ids` must be every paragraph of the chapter, in the new reading order.
   *  Beds on other tracks keep their places. */
  reorderParagraphs(chapterId: string, ids: string[]): Paragraph[] | null {
    const chapter = this.store.getChapter(chapterId);
    if (!chapter) return null;
    const order = this.withParagraphOrder(chapter.story_id, ids);
    if (!order || !this.svc.reorderSegments(chapter.story_id, order)) return null;
    this.publishParagraphs(chapter, ids);
    return this.paragraphsOf(chapter);
  }

  /**
   * The story's full segment order with its track-0 rows replaced, slot for
   * slot, by `ids`; every other segment stays where it is. Null unless `ids`
   * is exactly the story's paragraphs.
   */
  private withParagraphOrder(storyId: string, ids: string[]): string[] | null {
    const all = this.svc.db.listSegments(storyId);
    const paragraphs = all.filter((s) => s.track_index === PARAGRAPH_TRACK);
    const known = new Set(paragraphs.map((s) => s.id));
    if (ids.length !== paragraphs.length || new Set(ids).size !== ids.length) return null;
    if (!ids.every((id) => known.has(id))) return null;
    let next = 0;
    return all.map((s) => (s.track_index === PARAGRAPH_TRACK ? ids[next++]! : s.id));
  }

  deleteParagraph(segmentId: string): boolean {
    const chapter = this.store.chapterForParagraph(segmentId);
    if (!chapter) return false;
    const ok = this.svc.deleteSegment(segmentId);
    if (ok) this.publishParagraphs(chapter, [segmentId]);
    return ok;
  }

  /**
   * Cast paragraphs as a character (null = narrator), and write the voice
   * they are read with onto their segments. Returns how many changed. Locked
   * paragraphs are cast too: the lock protects the take, not the casting,
   * so their voice is left alone until they are unlocked.
   */
  setParagraphCharacter(segmentIds: string | string[], characterId: string | null): number {
    const ids = Array.isArray(segmentIds) ? segmentIds : [segmentIds];
    if (ids.length === 0) return 0;
    let character: Character | null = null;
    if (characterId) {
      character = this.store.getCharacter(characterId);
      if (!character) throw new ModelError(`Character '${characterId}' not found.`);
    }
    const byBook = new Map<string, Map<string, string[]>>();
    let n = 0;
    this.store.transaction(() => {
      for (const id of ids) {
        const chapter = this.store.chapterForParagraph(id);
        if (!chapter) continue;
        if (character && character.book_id !== chapter.book_id) {
          throw new ModelError("That character belongs to another book.");
        }
        this.store.setMeta(id, { character_id: characterId });
        const chapters = byBook.get(chapter.book_id) ?? new Map<string, string[]>();
        byBook.set(chapter.book_id, chapters);
        chapters.set(chapter.id, [...(chapters.get(chapter.id) ?? []), id]);
        n++;
      }
    });
    for (const [bookId, chapters] of byBook) {
      this.syncVoices(bookId, [...chapters.values()].flat(), false);
      for (const [chapterId, segs] of chapters) {
        this.hub.publish(bookId, { type: "paragraphs", chapter_id: chapterId, segment_ids: segs });
      }
    }
    return n;
  }

  markStale(segmentIds: string[]): number {
    const n = this.store.markStale(segmentIds);
    this.publishBySegments(segmentIds);
    return n;
  }

  markVoiced(segmentId: string, spokenText: string): void {
    this.store.markVoiced(segmentId, spokenText);
  }

  /**
   * Find and replace across a book's paragraph text. Locked paragraphs are
   * never changed; they are counted in `skipped_locked`.
   */
  replace(bookId: string, req: ReplaceRequest): ReplaceResult | null {
    const book = this.store.getBook(bookId);
    if (!book) return null;
    if (!req.find) throw new ModelError("Nothing to find.");
    const pattern = replacePattern(req);
    const only = req.chapter_ids?.length ? new Set(req.chapter_ids) : null;
    const result: ReplaceResult = {
      matches: 0,
      paragraphs: 0,
      skipped_locked: 0,
      skipped_matches: 0,
      changed: [],
      dry_run: req.dry_run === true,
    };
    const touched = new Map<string, Chapter>();
    for (const chapter of this.store.listChapters(bookId)) {
      if (only && !only.has(chapter.id)) continue;
      const paragraphs = this.paragraphsOf(chapter);
      this.store.syncVoiced([chapter.story_id]);
      const edits: [string, string][] = [];
      for (const p of paragraphs) {
        if (p.kind !== "line") continue;
        const count = p.text.match(pattern)?.length ?? 0;
        if (count === 0) continue;
        if (p.locked) {
          result.skipped_locked++;
          result.skipped_matches += count;
          continue;
        }
        const next = req.regex
          ? p.text.replace(pattern, req.replace)
          : p.text.replace(pattern, () => req.replace);
        result.matches += count;
        if (next === p.text) continue;
        result.paragraphs++;
        result.changed.push({ chapter_id: chapter.id, segment_id: p.id });
        if (!result.dry_run) edits.push([p.id, next]);
      }
      if (edits.length > 0) {
        // One transaction and one change notice per chapter, not per paragraph.
        this.store.transaction(() => {
          for (const [id, text] of edits) this.svc.db.updateSegment(id, { text });
        });
        this.svc.stories.changed(chapter.story_id);
        touched.set(chapter.id, chapter);
      }
    }
    for (const chapter of touched.values()) {
      this.hub.publish(bookId, { type: "paragraphs", chapter_id: chapter.id });
    }
    return result;
  }

  private publishParagraphs(chapter: Chapter, segmentIds: string[]): void {
    this.hub.publish(chapter.book_id, {
      type: "paragraphs",
      chapter_id: chapter.id,
      segment_ids: segmentIds,
    });
  }

  private publishBySegments(segmentIds: string[]): void {
    const seen = new Map<string, Chapter>();
    for (const id of segmentIds) {
      const chapter = this.store.chapterForParagraph(id);
      if (chapter) seen.set(chapter.id, chapter);
    }
    for (const chapter of seen.values()) {
      this.hub.publish(chapter.book_id, { type: "paragraphs", chapter_id: chapter.id });
    }
  }

  /* ------------------------------------------------------------------ notes */

  listNotes(
    bookId: string,
    opts: { resolved?: boolean; chapterId?: string; segmentId?: string } = {},
  ): BookNote[] {
    return this.store.listNotes(bookId, opts);
  }

  getNote(noteId: string): BookNote | null {
    return this.store.getNote(noteId);
  }

  addNote(segmentId: string, body: string, atS: number | null = null): BookNote {
    const chapter = this.store.chapterForParagraph(segmentId);
    if (!chapter) throw new ModelError("Paragraph not found.");
    const note = this.store.createNote(chapter.book_id, segmentId, body.trim(), atS);
    this.hub.publish(chapter.book_id, { type: "notes", chapter_id: chapter.id });
    return note;
  }

  updateNote(
    noteId: string,
    fields: { body?: string; resolved?: boolean; at_s?: number | null },
  ): BookNote | null {
    const note = this.store.updateNote(noteId, fields);
    if (note) this.hub.publish(note.book_id, { type: "notes", chapter_id: note.chapter_id });
    return note;
  }

  deleteNote(noteId: string): boolean {
    const note = this.store.getNote(noteId);
    if (!note) return false;
    this.store.deleteNote(noteId);
    this.hub.publish(note.book_id, { type: "notes", chapter_id: note.chapter_id });
    return true;
  }

  /* -------------------------------------------------------------- snapshots */

  private capture(bookId: string): BookSnapshotData {
    const book = this.store.getBook(bookId);
    if (!book) throw new ModelError(`Book '${bookId}' not found.`);
    const { id: _id, created_at: _c, updated_at: _u, cover_path: _cover, ...fields } = book;
    return {
      version: 1,
      book: fields,
      characters: this.store.listCharacters(bookId),
      chapters: this.store.listChapters(bookId).map((chapter) => ({
        id: chapter.id,
        story_id: chapter.story_id,
        title: chapter.title,
        kind: chapter.kind,
        included: chapter.included,
        paragraphs: this.paragraphsOf(chapter).map((p) => ({
          segment_id: p.id,
          kind: p.kind,
          text: p.text,
          duration_s: p.kind === "pause" ? (p.duration_s ?? null) : null,
          character_id: p.character_id,
          locked: p.locked,
          is_heading: p.is_heading,
          model_id: p.model_id,
          sound_id: p.sound_id ?? null,
          request_options: p.request_options ?? {},
        })),
      })),
    };
  }

  saveSnapshot(bookId: string, label?: string | null): SnapshotInfo {
    const data = this.capture(bookId);
    const info = this.store.saveSnapshot(
      bookId,
      label?.trim() || `Version of ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      data,
      {
        chapters: data.chapters.length,
        paragraphs: data.chapters.reduce((n, c) => n + c.paragraphs.length, 0),
      },
    );
    this.hub.publish(bookId, { type: "snapshots" });
    return info;
  }

  listSnapshots(bookId: string): SnapshotInfo[] {
    return this.store.listSnapshots(bookId);
  }

  getSnapshot(snapshotId: string): { info: SnapshotInfo; data: BookSnapshotData } | null {
    const snap = this.store.getSnapshot(snapshotId);
    return snap ? { info: snap.info, data: snap.data as BookSnapshotData } : null;
  }

  deleteSnapshot(snapshotId: string): boolean {
    const snap = this.store.getSnapshot(snapshotId);
    if (!snap) return false;
    this.store.deleteSnapshot(snapshotId);
    this.hub.publish(snap.info.book_id, { type: "snapshots" });
    return true;
  }

  /** What changed from the snapshot to now. Paragraphs match by id. */
  diffSnapshot(snapshotId: string): SnapshotDiff | null {
    const snap = this.getSnapshot(snapshotId);
    if (!snap) return null;
    const now = this.capture(snap.info.book_id);
    const was = snap.data;
    const diff: SnapshotDiff = {
      snapshot: snap.info,
      book: [],
      chapters: [],
      summary: { added: 0, removed: 0, changed: 0 },
    };
    for (const field of Object.keys(now.book) as (keyof BookSnapshotData["book"])[]) {
      const before = was.book[field];
      const after = now.book[field];
      if (JSON.stringify(before) !== JSON.stringify(after)) diff.book.push({ field, before, after });
    }
    const wasChapters = new Map(was.chapters.map((c) => [c.id, c]));
    const nowIds = new Set(now.chapters.map((c) => c.id));
    const count = (s: DiffStatus) => diff.summary[s]++;
    for (const c of now.chapters) {
      const old = wasChapters.get(c.id);
      const oldParas = new Map((old?.paragraphs ?? []).map((p) => [p.segment_id, p]));
      const nowParaIds = new Set(c.paragraphs.map((p) => p.segment_id));
      const paragraphs: SnapshotDiff["chapters"][number]["paragraphs"] = [];
      for (const p of c.paragraphs) {
        const before = oldParas.get(p.segment_id);
        if (!before) {
          paragraphs.push({ segment_id: p.segment_id, status: "added", before: null, after: p.text });
          count("added");
        } else if (before.text !== p.text) {
          paragraphs.push({ segment_id: p.segment_id, status: "changed", before: before.text, after: p.text });
          count("changed");
        }
      }
      for (const p of old?.paragraphs ?? []) {
        if (!nowParaIds.has(p.segment_id)) {
          paragraphs.push({ segment_id: p.segment_id, status: "removed", before: p.text, after: null });
          count("removed");
        }
      }
      const renamed = old && old.title !== c.title;
      diff.chapters.push({
        chapter_id: c.id,
        title: c.title,
        status: !old ? "added" : renamed || paragraphs.length ? "changed" : "same",
        ...(renamed ? { title_before: old.title } : {}),
        paragraphs,
      });
    }
    for (const old of was.chapters) {
      if (nowIds.has(old.id)) continue;
      diff.chapters.push({
        chapter_id: old.id,
        title: old.title,
        status: "removed",
        paragraphs: old.paragraphs.map((p) => ({
          segment_id: p.segment_id,
          status: "removed" as const,
          before: p.text,
          after: null,
        })),
      });
      diff.summary.removed += old.paragraphs.length;
    }
    return diff;
  }

  /**
   * Put the book back exactly as the snapshot has it: metadata, cast,
   * chapters and paragraphs (text, casting, lock, heading, model, delivery
   * and the take on the timeline, where that audio still exists).
   * Paragraphs and chapters deleted since come back under their old ids;
   * ones added since are removed, their audio kept in the library. A
   * "Before restoring" snapshot is saved first, so a restore can itself
   * be undone.
   */
  async restoreSnapshot(snapshotId: string): Promise<{ book: BookDetail; before: SnapshotInfo } | null> {
    const snap = this.getSnapshot(snapshotId);
    if (!snap) return null;
    const bookId = snap.info.book_id;
    const data = snap.data;
    const before = this.saveSnapshot(bookId, `Before restoring “${snap.info.label}”`);

    this.store.updateBook(bookId, { ...data.book, settings: data.book.settings });

    const keepCharacters = new Set(data.characters.map((c) => c.id));
    for (const c of this.store.listCharacters(bookId)) {
      if (!keepCharacters.has(c.id)) this.store.deleteCharacter(c.id);
    }
    for (const c of data.characters) this.store.putCharacter({ ...c, book_id: bookId });

    const keepChapters = new Set(data.chapters.map((c) => c.id));
    for (const c of this.store.listChapters(bookId)) {
      if (!keepChapters.has(c.id)) await this.deleteChapter(c.id, false);
    }
    const book = this.store.getBook(bookId)!;
    const now = new Date().toISOString();
    for (const sc of data.chapters) {
      let chapter = this.store.getChapter(sc.id);
      if (!chapter) {
        const storyId = this.svc.db.getStory(sc.story_id)
          ? sc.story_id
          : this.svc.db.createStory(sc.story_id, sc.title, now, book.project_id, "script").id;
        chapter = this.store.createChapter(bookId, storyId, {
          id: sc.id,
          title: sc.title,
          kind: sc.kind,
          included: sc.included,
        });
      } else {
        this.store.updateChapter(sc.id, { title: sc.title, kind: sc.kind, included: sc.included });
      }
      this.svc.db.renameStory(chapter.story_id, sc.title);
      this.restoreParagraphs(chapter, sc.paragraphs, keepCharacters, now);
    }
    this.store.reorderChapters(bookId, data.chapters.map((c) => c.id));
    this.syncVoices(bookId, undefined, false);
    for (const c of this.store.listChapters(bookId)) this.svc.stories.changed(c.story_id);
    this.hub.publish(bookId, { type: "book" });
    this.hub.publish(bookId, { type: "chapters" });
    this.hub.publish(bookId, { type: "characters" });
    return { book: this.getBook(bookId)!, before };
  }

  private restoreParagraphs(
    chapter: Chapter,
    paragraphs: SnapshotParagraph[],
    characters: Set<string>,
    now: string,
  ): void {
    const existing = new Map(
      this.svc.db
        .listSegments(chapter.story_id)
        .filter((s) => s.track_index === PARAGRAPH_TRACK)
        .map((s) => [s.id, s]),
    );
    const keep = new Set(paragraphs.map((p) => p.segment_id));
    const meta = this.store.getMeta([...existing.keys()]);
    const sameOptions = (a: Record<string, string>, b: Record<string, string>) =>
      JSON.stringify(a) === JSON.stringify(b);
    this.store.transaction(() => {
      for (const s of existing.values()) {
        if (!keep.has(s.id)) this.svc.db.deleteSegment(s.id);
      }
      for (const p of paragraphs) {
        const current = existing.get(p.segment_id);
        // Only touch what differs: a restore of a big book is mostly no-ops.
        const sound =
          p.sound_id && p.sound_id === current?.sound_id
            ? (current.sound ?? null)
            : p.sound_id
              ? this.svc.db.getSound(p.sound_id)
              : null;
        if (current && current.story_id === chapter.story_id) {
          const patch: Parameters<typeof this.svc.db.updateSegment>[1] = {};
          if (current.text !== p.text) patch.text = p.text;
          if ((current.sound_id ?? null) !== (sound?.id ?? null)) patch.sound_id = sound?.id ?? null;
          if (!sameOptions(current.request_options ?? {}, p.request_options)) {
            patch.request_options = p.request_options;
          }
          if (p.kind === "pause" && p.duration_s !== null && current.duration_s !== p.duration_s) {
            patch.duration_s = p.duration_s;
          }
          if (Object.keys(patch).length > 0) this.svc.db.updateSegment(p.segment_id, patch);
        } else {
          this.svc.db.createSegment(p.segment_id, chapter.story_id, now, {
            text: p.text,
            kind: p.kind,
            sound_id: sound?.id ?? null,
            durationS: p.kind === "pause" ? p.duration_s : (sound?.duration_s ?? null),
            request_options: p.request_options,
            track_index: 0,
          });
        }
        const want = {
          character_id: p.character_id && characters.has(p.character_id) ? p.character_id : null,
          locked: p.locked,
          is_heading: p.is_heading,
          model_id: p.model_id,
        };
        const m = meta.get(p.segment_id);
        const sameMeta =
          (m ? m.character_id : null) === want.character_id &&
          (m?.locked === 1) === want.locked &&
          (m?.is_heading === 1) === want.is_heading &&
          (m?.model_id ?? null) === want.model_id;
        if (!sameMeta) this.store.setMeta(p.segment_id, want);
        if (sound && (!current || current.sound_id !== sound.id || current.text !== p.text)) {
          this.store.markVoiced(p.segment_id, p.text);
        }
      }
      const order = this.withParagraphOrder(
        chapter.story_id,
        paragraphs.map((p) => p.segment_id),
      );
      if (order) this.svc.db.reorderSegments(chapter.story_id, order);
    });
  }

  /* ------------------------------------------------------------- characters */

  listCharacters(bookId: string): Character[] {
    return this.store.listCharacters(bookId);
  }

  getCharacter(id: string): Character | null {
    return this.store.getCharacter(id);
  }

  createCharacter(bookId: string, fields: CharacterFields & { name: string }): Character {
    if (!this.store.getBook(bookId)) throw new ModelError(`Book '${bookId}' not found.`);
    if (fields.voice_id) this.assertVoice(fields.voice_id);
    const character = this.store.createCharacter(bookId, fields);
    this.hub.publish(bookId, { type: "characters" });
    return character;
  }

  /** A changed voice is written onto every paragraph the character reads. */
  updateCharacter(id: string, fields: CharacterFields): Character | null {
    const before = this.store.getCharacter(id);
    if (!before) return null;
    if (fields.voice_id) this.assertVoice(fields.voice_id);
    const character = this.store.updateCharacter(id, fields)!;
    if (before.voice_id !== character.voice_id) {
      this.syncVoices(character.book_id, this.store.segmentsForCharacter(id));
    }
    this.hub.publish(character.book_id, { type: "characters" });
    return character;
  }

  /** The character's paragraphs go back to the narrator. */
  deleteCharacter(id: string): boolean {
    const character = this.store.getCharacter(id);
    if (!character) return false;
    const segments = this.store.segmentsForCharacter(id);
    this.store.deleteCharacter(id);
    this.syncVoices(character.book_id, segments);
    this.hub.publish(character.book_id, { type: "characters" });
    return true;
  }

  /** The model a paragraph should be generated on: its own override, else
   *  its character's (multi cast), else the book's. Null = caller picks
   *  (usually the voice's own model). */
  modelFor(segmentId: string): string | null {
    const p = this.getParagraph(segmentId);
    const chapter = this.store.chapterForParagraph(segmentId);
    if (!p || !chapter) return null;
    if (p.model_id) return p.model_id;
    const book = this.store.getBook(chapter.book_id)!;
    const character = p.character_id ? this.store.getCharacter(p.character_id) : null;
    if (book.settings.cast_mode === "multi" && character?.model_id) return character.model_id;
    return book.settings.model_id;
  }

  /** The voice a paragraph cast as `characterId` is read with. */
  voiceFor(bookId: string, characterId: string | null): string | null {
    const book = this.store.getBook(bookId);
    if (!book) return null;
    const character = characterId ? this.store.getCharacter(characterId) : null;
    const narrator = book.settings.narrator_voice_id;
    if (book.settings.cast_mode === "single" || !character) return this.existingVoice(narrator);
    return this.existingVoice(character.voice_id ?? narrator);
  }

  /**
   * Write each paragraph's voice and speaker from the cast. A voiced,
   * unlocked paragraph whose voice changes gets its take marked stale.
   * Returns how many segments changed.
   */
  syncVoices(bookId: string, segmentIds?: string[], publish = true): number {
    const book = this.store.getBook(bookId);
    if (!book) return 0;
    const chapters = this.store.listChapters(bookId);
    const wanted = segmentIds ? new Set(segmentIds) : null;
    const characters = new Map(this.store.listCharacters(bookId).map((c) => [c.id, c]));
    const stale: string[] = [];
    let n = 0;
    this.store.transaction(() => {
      for (const chapter of chapters) {
        const segments = this.svc.db
          .listSegments(chapter.story_id)
          .filter((s) => s.track_index === PARAGRAPH_TRACK);
        const meta = this.store.getMeta(segments.map((s) => s.id));
        for (const segment of segments) {
          if (segment.kind !== "line" || (wanted && !wanted.has(segment.id))) continue;
          const m = meta.get(segment.id);
          const character = m?.character_id ? (characters.get(m.character_id) ?? null) : null;
          const voice = this.voiceFor(bookId, character?.id ?? null);
          const speaker = character?.name ?? NARRATOR_SPEAKER;
          const locked = m?.locked === 1;
          const voiceChanges = (segment.voice_id ?? null) !== voice && !locked;
          if (!voiceChanges && segment.speaker === speaker) continue;
          this.svc.db.updateSegment(segment.id, {
            speaker,
            ...(voiceChanges ? { voice_id: voice } : {}),
          });
          if (voiceChanges && segment.sound_id) stale.push(segment.id);
          n++;
        }
      }
    });
    if (stale.length > 0) this.store.markStale(stale);
    if (publish && n > 0) {
      for (const chapter of chapters) this.svc.stories.changed(chapter.story_id);
      this.hub.publish(bookId, { type: "chapters" });
    }
    return n;
  }

  private existingVoice(voiceId: string | null | undefined): string | null {
    if (!voiceId) return null;
    return this.svc.db.getVoice(voiceId) ? voiceId : null;
  }

  private assertVoice(voiceId: string): void {
    if (!this.svc.db.getVoice(voiceId)) throw new ModelError(`Voice '${voiceId}' not found.`);
  }
}

async function unlinkQuiet(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Already gone is fine.
  }
}

const services = new WeakMap<MirliService, AudiobookService>();

/** The audiobook service for this server. One per MirliService. */
export function audiobooks(svc: MirliService): AudiobookService {
  let service = services.get(svc);
  if (!service) {
    service = new AudiobookService(svc);
    services.set(svc, service);
  }
  return service;
}
