/**
 * Audiobook export: mix, master, check and encode a book's chapters.
 *
 * Per included chapter: mix its story (`MirliService.mixStory`), master it
 * with the chosen preset (`audio/master.ts`), measure it (`audio/meter.ts`)
 * and judge it (`export-qc.ts`), then encode (`audio/encode.ts`).
 *
 *   layout "files"   one file per chapter with ACX names, zipped together
 *                    with captions and read-along JSON when asked for.
 *   layout "single"  one file, chapters joined; M4B (always single) and MP3
 *                    carry chapter markers.
 *
 * Exports run in the background, one at a time, outside the model job queue
 * so a long encode never holds up generation. Progress goes out on the
 * book's event stream as `{ type: "export", ... }`. The `book_exports` table
 * is this module's own, created on the shared connection like HistoryStore.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Database } from "better-sqlite3";

import { type Audio, frameCount } from "../audio/dsp.js";
import {
  DEFAULT_BITRATE,
  type FfmpegInfo,
  acxFileName,
  buildEncodeArgs,
  concatList,
  concatWav16,
  detectFfmpeg,
  ffmetadata,
  formatUnavailable,
  runFfmpeg,
  tagMetadata,
  writeWav16,
} from "../audio/encode.js";
import { ROOM_TONE_DB, roomTone } from "../audio/master.js";
import { measure } from "../audio/meter.js";
import { ModelError } from "../errors.js";
import type { MirliService } from "../service.js";
import { closingCredits, narratorLine, openingCredits, pickSample, SAMPLE_TARGET_S } from "./credits.js";
import { checkBook, checkReport, splitChecks } from "./export-qc.js";
import { runMaster } from "./export-runner.js";
import { MAX_FILE_S, SPLIT_MARGIN_S } from "./export-split.js";
import type { MasterPart } from "./export-worker.js";
import { type ExportedChapterAudio, setExportAudioProvider } from "./publish/manifest.js";
import { type ZipEntry, writeZip } from "./export-zip.js";
import { type BookDetail, audiobooks } from "./service.js";
import { type ReadAlongChapter, cues, paragraphTimings, readAlong, toSrt, toVtt } from "./timings.js";
import type {
  BookExport,
  Chapter,
  ChapterQc,
  ExportRequest,
  LoudnessReport,
  MasteringPresetId,
  ParagraphTiming,
} from "./types.js";

/* ------------------------------------------------------------------ store */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS book_exports (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'book',
  request     TEXT NOT NULL,
  status      TEXT NOT NULL,
  progress    REAL NOT NULL DEFAULT 0,
  message     TEXT,
  path        TEXT,
  size_bytes  INTEGER,
  qc          TEXT NOT NULL DEFAULT '[]',
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_exports_book ON book_exports(book_id, created_at);
CREATE TABLE IF NOT EXISTS book_chapter_masters (
  chapter_id  TEXT PRIMARY KEY,
  preset      TEXT NOT NULL,
  shift_s     REAL NOT NULL,
  duration_s  REAL NOT NULL,
  updated_at  TEXT NOT NULL
);
`;

/** One chapter's own file inside an export, as the player needs it. */
export interface ExportChapterFile extends ExportedChapterAudio {
  chapter_id: string;
}

/** A BookExport plus what the history list shows. */
export interface BookExportRecord extends BookExport {
  kind: "book" | "sample";
  progress: number;
  message: string | null;
  size_bytes: number | null;
  /** File name the download is served as. */
  filename: string | null;
  updated_at: string;
}

interface ExportRow {
  id: string;
  book_id: string;
  kind: string;
  request: string;
  status: string;
  progress: number;
  message: string | null;
  path: string | null;
  size_bytes: number | null;
  qc: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export class ExportStore {
  constructor(private readonly conn: Database) {
    this.conn.exec(SCHEMA);
    const columns = this.conn.prepare("PRAGMA table_info(book_exports)").all() as { name: string }[];
    if (!columns.some((c) => c.name === "chapters")) {
      this.conn.exec("ALTER TABLE book_exports ADD COLUMN chapters TEXT NOT NULL DEFAULT '[]'");
    }
  }

  /** Per-chapter playable files an export kept (files layout), for the player. */
  setChapters(id: string, chapters: ExportChapterFile[]): void {
    this.conn.prepare("UPDATE book_exports SET chapters = ? WHERE id = ?").run(JSON.stringify(chapters), id);
  }

  chapters(id: string): ExportChapterFile[] {
    const r = this.conn.prepare("SELECT chapters FROM book_exports WHERE id = ?").get(id) as { chapters: string } | undefined;
    return r ? (JSON.parse(r.chapters) as ExportChapterFile[]) : [];
  }

  private static row(r: ExportRow): BookExportRecord {
    return {
      id: r.id,
      book_id: r.book_id,
      kind: r.kind === "sample" ? "sample" : "book",
      request: JSON.parse(r.request) as ExportRequest,
      status: r.status as BookExport["status"],
      progress: r.progress,
      message: r.message,
      path: r.path,
      size_bytes: r.size_bytes,
      filename: r.path ? (r.path.split(/[\\/]/).pop() ?? null) : null,
      qc: JSON.parse(r.qc) as ChapterQc[],
      error: r.error,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  create(bookId: string, kind: "book" | "sample", request: ExportRequest): BookExportRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.conn
      .prepare(
        `INSERT INTO book_exports (id, book_id, kind, request, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
      )
      .run(id, bookId, kind, JSON.stringify(request), now, now);
    return this.get(id)!;
  }

  get(id: string): BookExportRecord | null {
    const r = this.conn.prepare("SELECT * FROM book_exports WHERE id = ?").get(id) as ExportRow | undefined;
    return r ? ExportStore.row(r) : null;
  }

  list(bookId: string): BookExportRecord[] {
    return (
      this.conn.prepare("SELECT * FROM book_exports WHERE book_id = ? ORDER BY created_at DESC").all(bookId) as ExportRow[]
    ).map(ExportStore.row);
  }

  update(
    id: string,
    patch: Partial<Pick<BookExportRecord, "status" | "progress" | "message" | "path" | "size_bytes" | "error">> & {
      qc?: ChapterQc[];
    },
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${k} = ?`);
      values.push(k === "qc" ? JSON.stringify(v) : v);
    }
    sets.push("updated_at = ?");
    values.push(new Date().toISOString(), id);
    this.conn.prepare(`UPDATE book_exports SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  delete(id: string): void {
    this.conn.prepare("DELETE FROM book_exports WHERE id = ?").run(id);
  }

  bookIds(): string[] {
    return (this.conn.prepare("SELECT DISTINCT book_id FROM book_exports").all() as { book_id: string }[]).map((r) => r.book_id);
  }

  deleteForBook(bookId: string): void {
    this.conn.prepare("DELETE FROM book_exports WHERE book_id = ?").run(bookId);
  }

  /** Exports left running by a restart can never finish. */
  failInterrupted(): void {
    this.conn
      .prepare(
        "UPDATE book_exports SET status = 'failed', error = 'Interrupted by a restart.' WHERE status IN ('queued', 'running')",
      )
      .run();
  }

  setMaster(chapterId: string, preset: MasteringPresetId, shiftS: number, durationS: number): void {
    this.conn
      .prepare(
        `INSERT INTO book_chapter_masters (chapter_id, preset, shift_s, duration_s, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chapter_id) DO UPDATE SET preset = excluded.preset, shift_s = excluded.shift_s,
           duration_s = excluded.duration_s, updated_at = excluded.updated_at`,
      )
      .run(chapterId, preset, shiftS, durationS, new Date().toISOString());
  }

  getMaster(chapterId: string): { preset: string; shift_s: number; duration_s: number } | null {
    return (
      (this.conn
        .prepare("SELECT preset, shift_s, duration_s FROM book_chapter_masters WHERE chapter_id = ?")
        .get(chapterId) as { preset: string; shift_s: number; duration_s: number } | undefined) ?? null
    );
  }

  deleteMasters(chapterIds: string[]): void {
    const stmt = this.conn.prepare("DELETE FROM book_chapter_masters WHERE chapter_id = ?");
    for (const id of chapterIds) stmt.run(id);
  }
}

/* ---------------------------------------------------------------- service */

export interface RenderedPart extends MasterPart {
  /** Paragraph timings inside this part's own file. */
  timings: ParagraphTiming[];
  duration_s: number;
}

export interface RenderedChapter {
  chapter: Chapter;
  sampleRate: number;
  channels: number;
  shiftS: number;
  durationS: number;
  /** Whole chapter. */
  report: LoudnessReport;
  timings: ParagraphTiming[];
  /** One per file: several when the chapter was split at 120 minutes. */
  parts: RenderedPart[];
  /** The mastered audio, only when asked for. */
  audio: Audio | null;
}

export interface RenderOptions {
  includeBeds?: boolean;
  /** Write each part as 16-bit WAV here (part n > 0 gets `.partN`). */
  wavPath?: string | null;
  conform?: { rate?: number; channels: number } | null;
  /** Split at ACX's 120-minute limit (files layout and QC). */
  split?: boolean;
  returnAudio?: boolean;
}

export interface AnalyzeOptions {
  mastering?: MasteringPresetId;
  chapter_ids?: string[];
  include_beds?: boolean;
}

export interface CreditsRequest {
  opening?: boolean;
  closing?: boolean;
  /** Replace the paragraphs of an existing credits chapter with fresh text. */
  replace?: boolean;
  sample?: { chapter_id?: string; target_s?: number; format?: "mp3" | "wav" } | false;
}

export interface CreditsResult {
  opening: Chapter | null;
  closing: Chapter | null;
  sample: BookExportRecord | null;
}

/** Ids that may name a folder: letters, digits, "-" and "_" only. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const EXT: Record<ExportRequest["format"], string> = { mp3: "mp3", wav: "wav", flac: "flac", m4b: "m4b" };
const MIME: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", m4b: "audio/mp4" };

/** Narration lane; beds sit on lanes 1 and up. */
const NARRATION_TRACK = 0;

export class AudiobookExportService {
  readonly store: ExportStore;
  /** Longest file before a chapter is split (ACX: 120 min, less a margin). */
  maxFileS = MAX_FILE_S - SPLIT_MARGIN_S;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly svc: MirliService) {
    this.store = new ExportStore(svc.db.sqlite);
    this.store.failInterrupted();
    this.sweepOrphans();
    setExportAudioProvider(svc, (bookId) => this.chapterAudio(bookId)); // [audiobooks:export]
    audiobooks(svc).onDelete((scope) => {
      this.store.deleteMasters(scope.chapter_ids);
      // Hooks run before the book row goes, so check again once it has.
      const all = this.books.getBook(scope.book_id)?.chapters.length === scope.chapter_ids.length;
      if (all) setTimeout(() => this.sweepOrphans(), 2000).unref();
    });
  }

  /** Drop exports (rows and files) whose book no longer exists. */
  sweepOrphans(): void {
    // The trash included: a trashed book's exports are its own until it is purged.
    const ids = new Set(this.books.allBookIds());
    for (const bookId of this.store.bookIds()) {
      if (ids.has(bookId)) continue;
      for (const e of this.store.list(bookId)) this.removeFiles(e);
      this.store.deleteForBook(bookId);
    }
  }

  private get books() {
    return audiobooks(this.svc);
  }

  private get root(): string {
    return join(this.svc.config.paths.root, "exports", "audiobooks");
  }

  ffmpeg(refresh = false): Promise<FfmpegInfo> {
    return detectFfmpeg(refresh);
  }

  private book(bookId: string): BookDetail {
    const book = this.books.getBook(bookId);
    if (!book) throw new ModelError(`Book '${bookId}' not found.`);
    return book;
  }

  private chaptersFor(book: BookDetail, ids?: string[]): Chapter[] {
    if (ids && ids.length) {
      const set = new Set(ids);
      const picked = book.chapters.filter((c) => set.has(c.id));
      if (picked.length !== set.size) throw new ModelError("Some chapter ids are not in this book.");
      return picked;
    }
    return book.chapters.filter((c) => c.included);
  }

  /**
   * The newest finished export's file for each chapter, for listen's player,
   * web player and RSS. Only exports that kept one file per chapter count;
   * a single joined file has no per-chapter file to hand over.
   */
  chapterAudio(bookId: string): Map<string, ExportedChapterAudio> {
    const out = new Map<string, ExportedChapterAudio>();
    for (const e of this.store.list(bookId)) {
      if (e.status !== "done" || e.kind !== "book") continue;
      for (const c of this.store.chapters(e.id)) {
        if (out.has(c.chapter_id) || !existsSync(c.path)) continue;
        out.set(c.chapter_id, { path: c.path, mime: c.mime, duration_s: c.duration_s, timings: c.timings });
      }
    }
    return out;
  }

  /** Paragraph timings of one chapter in its mastered file, from the last master. */
  timings(chapterId: string): ParagraphTiming[] | null {
    const paragraphs = this.books.getParagraphs(chapterId);
    if (!paragraphs) return null;
    const m = this.store.getMaster(chapterId);
    return paragraphTimings(paragraphs, m?.shift_s ?? 0, m?.duration_s);
  }

  /**
   * Channel count every file of the book should have: 1 for ACX (it writes
   * mono), otherwise the layout most included chapters mix to, read from
   * the clips' metadata without decoding anything.
   */
  bookChannels(book: BookDetail, preset: MasteringPresetId, includeBeds = true): number {
    if (preset === "acx") return 1;
    const counts = new Map<number, number>();
    for (const chapter of book.chapters.filter((c) => c.included)) {
      let ch = 0;
      for (const s of this.svc.listSegments(chapter.story_id)) {
        if (s.muted || !s.sound_id) continue;
        if (s.track_index !== NARRATION_TRACK && (!includeBeds || chapter.kind === "retail_sample")) continue;
        ch = Math.max(ch, s.sound?.channels ?? this.svc.getSound(s.sound_id)?.channels ?? 1);
      }
      if (ch > 0) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    let best = 1;
    let n = 0;
    for (const [ch, c] of counts) if (c > n || (c === n && ch < best)) [best, n] = [ch, c];
    return best;
  }

  /**
   * Mix one chapter (here: it needs the database), then master, measure,
   * split and write it on the worker thread. Throws when it has no audio.
   */
  async renderChapter(
    chapter: Chapter,
    preset: MasteringPresetId,
    book: BookDetail,
    options: RenderOptions = {},
  ): Promise<RenderedChapter> {
    const beds = options.includeBeds !== false && chapter.kind !== "retail_sample";
    const fail = (exc: unknown) =>
      new ModelError(`${chapter.title}: ${exc instanceof Error ? exc.message : String(exc)}`);
    let planned;
    try {
      planned = this.svc.planMix(chapter.story_id, {
        tracks: beds ? undefined : (lane) => lane === NARRATION_TRACK,
        includeBeds: beds,
      });
    } catch (exc) {
      throw fail(exc);
    }
    if (!planned) throw new ModelError(`${chapter.title}: the chapter's story is missing.`);
    const paragraphs = this.books.getParagraphs(chapter.id) ?? [];
    const heading = new Map(paragraphs.map((p) => [p.id, p.is_heading]));
    const timeline = paragraphTimings(paragraphs);
    const result = await runMaster({
      mix: planned.plan,
      preset,
      pacing: book.settings.pacing,
      wavPath: options.wavPath ?? null,
      conform: options.conform ?? null,
      returnAudio: options.returnAudio,
      split: options.split
        ? {
            paragraphs: timeline.map((t) => ({
              start_s: t.start_s,
              end_s: t.end_s,
              is_heading: heading.get(t.segment_id) ?? false,
            })),
            maxS: this.maxFileS,
          }
        : null,
    }).catch((exc: unknown) => {
      throw fail(exc);
    });
    const durationS = result.frames / result.sampleRate;
    this.store.setMaster(chapter.id, preset, result.shiftS, durationS);
    const timings = paragraphTimings(paragraphs, result.shiftS, durationS);
    const parts: RenderedPart[] = result.parts.map((part, n) => {
      const next = result.parts[n + 1]?.from_s ?? Infinity;
      const dur = part.frames / result.sampleRate;
      return {
        ...part,
        duration_s: round3(dur),
        timings: timings
          .filter((t) => t.start_s >= part.from_s && t.start_s < next)
          .map((t) => ({
            ...t,
            start_s: round3(t.start_s - part.from_s + part.shift_s),
            end_s: round3(Math.min(dur, t.end_s - part.from_s + part.shift_s)),
          })),
      };
    });
    return {
      chapter,
      sampleRate: result.sampleRate,
      channels: result.channels,
      shiftS: result.shiftS,
      durationS,
      report: result.report,
      timings,
      parts,
      audio: result.audio,
    };
  }

  /**
   * QC every chosen chapter as it would ship (one file per chapter, split
   * at 120 minutes). A chapter with no audio gets one failing `audio` check
   * instead of a report.
   */
  async analyze(bookId: string, options: AnalyzeOptions = {}): Promise<ChapterQc[]> {
    const book = this.book(bookId);
    const preset = options.mastering ?? book.settings.mastering;
    const channels = this.bookChannels(book, preset, options.include_beds);
    const measured: RenderedChapter[] = [];
    const missing: ChapterQc[] = [];
    const chosen = this.chaptersFor(book, options.chapter_ids);
    for (const chapter of chosen) {
      try {
        measured.push(
          await this.renderChapter(chapter, preset, book, {
            includeBeds: options.include_beds,
            split: true,
            // Exports always bring every file to the book's layout.
            conform: { channels },
          }),
        );
      } catch (exc) {
        missing.push(emptyQc(chapter.id, exc));
      }
    }
    const judged = judge(measured, preset, channels);
    const order = new Map(chosen.map((c, i) => [c.id, i]));
    return [...judged, ...missing].sort((a, b) => order.get(a.chapter_id)! - order.get(b.chapter_id)!);
  }

  list(bookId: string): BookExportRecord[] {
    return this.store.list(bookId);
  }

  get(exportId: string): BookExportRecord | null {
    return this.store.get(exportId);
  }

  deleteExport(exportId: string): boolean {
    const e = this.store.get(exportId);
    if (!e) return false;
    if (e.status === "running" || e.status === "queued") throw new ModelError("This export is still running.");
    this.removeFiles(e);
    this.store.delete(exportId);
    return true;
  }

  private removeFiles(e: BookExportRecord): void {
    rmSync(this.exportDir(e.book_id, e.id), { recursive: true, force: true });
  }

  /** Validate, record and queue an export. Resolves with the queued record. */
  async start(bookId: string, request: ExportRequest): Promise<BookExportRecord> {
    const book = this.book(bookId);
    const reason = formatUnavailable(request.format, await this.ffmpeg());
    if (reason) throw new ModelError(reason);
    const chapters = this.chaptersFor(book, request.chapter_ids);
    if (chapters.length === 0) throw new ModelError("No chapters to export: include at least one.");
    const normalized: ExportRequest = {
      ...request,
      layout: request.format === "m4b" ? "single" : request.layout,
      bitrate_kbps:
        request.format === "mp3" || request.format === "m4b"
          ? (request.bitrate_kbps ?? DEFAULT_BITRATE[request.format])
          : undefined,
    };
    const record = this.store.create(bookId, "book", normalized);
    this.enqueue(record.id, () => this.runBook(record.id, bookId, normalized));
    return record;
  }

  private enqueue(id: string, run: () => Promise<void>): void {
    this.queue = this.queue.then(run).catch((exc) => {
      this.store.update(id, { status: "failed", error: exc instanceof Error ? exc.message : String(exc) });
    });
  }

  /** Wait for everything queued so far (tests). */
  idle(): Promise<void> {
    return this.queue;
  }

  private progress(e: { id: string; book_id: string }, status: BookExport["status"], progress: number, message: string): void {
    this.store.update(e.id, { status, progress, message });
    this.books.hub.publish(e.book_id, { type: "export", export_id: e.id, status, progress, message });
  }

  /** An export's folder under the exports root. Book and export ids are
   *  generated UUIDs; anything else (a "..", a slash) is refused rather
   *  than joined into a path. */
  private exportDir(bookId: string, exportId: string): string {
    if (!SAFE_ID.test(bookId) || !SAFE_ID.test(exportId)) throw new Error("Not a valid book or export id.");
    return join(this.root, bookId, exportId);
  }

  private async runBook(id: string, bookId: string, request: ExportRequest): Promise<void> {
    const ref = { id, book_id: bookId };
    const fail = (error: string) => {
      this.store.update(id, { status: "failed", error });
      this.books.hub.publish(bookId, { type: "export", export_id: id, status: "failed", error });
    };
    let book: BookDetail;
    try {
      book = this.book(bookId);
    } catch (exc) {
      fail(exc instanceof Error ? exc.message : String(exc));
      return;
    }
    const dir = this.exportDir(bookId, id);
    mkdirSync(dir, { recursive: true });
    const work = join(dir, "work");
    mkdirSync(work, { recursive: true });
    try {
      const chapters = this.chaptersFor(book, request.chapter_ids);
      const files = request.layout === "files";
      const ext = EXT[request.format];
      const channels = this.bookChannels(book, request.mastering, request.include_beds);
      const cover = request.include_cover ? await this.writeCover(bookId, work) : null;
      const baseTags = {
        album: book.title,
        author: book.author,
        narrator: book.narrator,
        year: book.publication_date?.slice(0, 4) ?? null,
        publisher: book.publisher,
        language: book.language,
        comment: narratorLine(book.narrator),
      };
      const encodeFile = async (input: string, out: string, tags: Record<string, string>, extra: { meta?: string; concat?: boolean } = {}) => {
        const r = await runFfmpeg(
          buildEncodeArgs({
            format: request.format as Exclude<ExportRequest["format"], "wav">,
            input,
            concat: extra.concat,
            output: out,
            bitrateKbps: request.bitrate_kbps,
            tags,
            metadataFile: extra.meta ?? null,
            cover,
          }),
        );
        if (!r.ok) throw new ModelError(`Encoding failed: ${r.error}`);
      };

      // Master every chapter on the worker, which writes each file (or part)
      // as 16-bit WAV: no chapter's audio is held here, so a long book never
      // sits in memory and the event loop stays free.
      const rendered: RenderedChapter[] = [];
      let rate: number | undefined;
      for (let i = 0; i < chapters.length; i++) {
        this.progress(ref, "running", (i / chapters.length) * 0.7, `Mastering ${chapters[i].title}`);
        const r = await this.renderChapter(chapters[i], request.mastering, book, {
          includeBeds: request.include_beds,
          wavPath: join(work, `${String(i).padStart(3, "0")}.wav`),
          // A joined file needs one rate; files only need one layout.
          conform: { channels, rate: files ? undefined : rate },
          split: files,
        });
        rate ??= r.sampleRate;
        rendered.push(r);
      }
      const qc = judge(rendered, request.mastering, channels);
      this.store.update(id, { qc });

      const outputs: ZipEntry[] = [];
      const along: ReadAlongChapter[] = [];
      const kept: ExportChapterFile[] = [];

      if (files) {
        const total = rendered.reduce((n, r) => n + r.parts.length, 0);
        let index = chapters[0]?.kind === "opening_credits" ? 0 : 1;
        let track = 0;
        for (const r of rendered) {
          for (let n = 0; n < r.parts.length; n++) {
            const part = r.parts[n];
            const title = r.parts.length > 1 ? `${r.chapter.title} Part ${n + 1}` : r.chapter.title;
            const name = acxFileName(index++, title, ext);
            track++;
            this.progress(ref, "running", 0.7 + (track / total) * 0.25, `Encoding ${name}`);
            const file = join(dir, name);
            if (request.format === "wav") renameSync(part.wav!, file);
            else {
              await encodeFile(part.wav!, file, tagMetadata({ ...baseTags, title, track, totalTracks: total }));
              rmSync(part.wav!, { force: true });
            }
            outputs.push({ name, source: file });
            along.push({
              chapter_id: r.chapter.id,
              title,
              file: name,
              start_s: 0,
              duration_s: part.duration_s,
              paragraphs: part.timings,
            });
            // The player plays a chapter as one file; split chapters stay
            // with listen's live mix.
            if (r.parts.length === 1) {
              kept.push({ chapter_id: r.chapter.id, path: file, mime: MIME[ext], duration_s: part.duration_s, timings: part.timings });
            }
          }
        }
      } else {
        const name = acxFileName(0, book.title, ext).slice(3);
        const file = join(dir, name);
        const wavs = rendered.map((r) => r.parts[0].wav!);
        const starts: number[] = [];
        let at = 0;
        for (const r of rendered) {
          starts.push(round3(at));
          at += r.parts[0].frames / r.sampleRate;
        }
        const tags = tagMetadata({ ...baseTags, title: book.title });
        this.progress(ref, "running", 0.75, `Encoding ${name}`);
        if (request.format === "wav") await concatWav16(wavs, file);
        else {
          const meta = join(work, "chapters.txt");
          writeFileSync(
            meta,
            ffmetadata(
              tags,
              rendered.map((r, i) => ({ title: r.chapter.title, start_s: starts[i], end_s: starts[i] + r.parts[0].duration_s })),
            ),
          );
          const list = join(work, "list.txt");
          writeFileSync(list, concatList(wavs));
          await encodeFile(list, file, tags, { meta, concat: true });
        }
        outputs.push({ name, source: file });
        rendered.forEach((r, i) =>
          along.push({
            chapter_id: r.chapter.id,
            title: r.chapter.title,
            file: name,
            start_s: starts[i],
            duration_s: r.parts[0].duration_s,
            paragraphs: r.parts[0].timings,
          }),
        );
      }

      if (request.include_transcripts) {
        if (files) {
          for (const c of along) {
            const stem = c.file.replace(/\.[^.]+$/, "");
            outputs.push({ name: `${stem}.srt`, source: Buffer.from(toSrt(cues(c.paragraphs))) });
            outputs.push({ name: `${stem}.vtt`, source: Buffer.from(toVtt(cues(c.paragraphs))) });
          }
        } else {
          const all = along.flatMap((c) =>
            c.paragraphs.map((p) => ({ ...p, start_s: p.start_s + c.start_s, end_s: p.end_s + c.start_s })),
          );
          const stem = outputs[0].name.replace(/\.[^.]+$/, "");
          outputs.push({ name: `${stem}.srt`, source: Buffer.from(toSrt(cues(all))) });
          outputs.push({ name: `${stem}.vtt`, source: Buffer.from(toVtt(cues(all))) });
        }
        outputs.push({
          name: "read-along.json",
          source: Buffer.from(JSON.stringify(readAlong(bookId, book.title, along), null, 2)),
        });
      }

      let path: string;
      if (outputs.length === 1) {
        path = outputs[0].source as string;
      } else {
        this.progress(ref, "running", 0.96, "Writing zip");
        path = join(dir, `${acxFileName(0, book.title, "zip").slice(3)}`);
        await writeZip(path, outputs);
        // Chapter files stay beside the zip: listen's player streams them.
        const keep = new Set(kept.map((k) => k.path));
        for (const o of outputs) if (typeof o.source === "string" && !keep.has(o.source)) rmSync(o.source, { force: true });
      }
      rmSync(work, { recursive: true, force: true });
      this.store.setChapters(id, kept);
      this.store.update(id, { status: "done", progress: 1, message: null, path, size_bytes: statSync(path).size });
      this.books.hub.publish(bookId, { type: "export", export_id: id, status: "done", progress: 1 });
    } catch (exc) {
      rmSync(work, { recursive: true, force: true });
      fail(exc instanceof Error ? exc.message : String(exc));
    }
  }

  private async writeCover(bookId: string, dir: string): Promise<string | null> {
    const cover = await this.books.coverBytes(bookId);
    if (!cover) return null;
    // ID3 APIC and MP4 covr hold JPEG or PNG only.
    const ext = cover.mime === "image/png" ? "png" : cover.mime === "image/jpeg" ? "jpg" : null;
    if (!ext) return null;
    const path = join(dir, `cover.${ext}`);
    writeFileSync(path, cover.bytes);
    return path;
  }

  /* -------------------------------------------------------------- credits */

  async credits(bookId: string, req: CreditsRequest): Promise<CreditsResult> {
    const book = this.book(bookId);
    const result: CreditsResult = { opening: null, closing: null, sample: null };
    const upsert = (kind: "opening_credits" | "closing_credits", title: string, lines: string[]) => {
      const existing = book.chapters.find((c) => c.kind === kind);
      if (existing && !req.replace) return existing as Chapter;
      if (existing) {
        for (const p of this.books.getParagraphs(existing.id) ?? []) this.books.deleteParagraph(p.id);
        for (const text of lines) this.books.addParagraph(existing.id, { text });
        return this.books.getChapter(existing.id);
      }
      const position = kind === "opening_credits" ? 0 : book.chapters.length;
      return this.books.addChapter(bookId, { title, kind, position, paragraphs: lines });
    };
    if (req.opening) result.opening = upsert("opening_credits", "Opening Credits", openingCredits(book));
    if (req.closing) {
      // Re-read: adding opening credits moved every chapter down one.
      const fresh = this.book(bookId);
      book.chapters = fresh.chapters;
      result.closing = upsert("closing_credits", "Closing Credits", closingCredits(book));
    }
    if (req.sample) result.sample = await this.startSample(bookId, req.sample);
    return result;
  }

  /**
   * A retail sample: 1-5 minutes from a narrated chapter, starting at its
   * first paragraph, narration only (no beds), mastered for ACX.
   */
  async startSample(
    bookId: string,
    opts: { chapter_id?: string; target_s?: number; format?: "mp3" | "wav" },
  ): Promise<BookExportRecord> {
    const book = this.book(bookId);
    const info = await this.ffmpeg();
    const format = opts.format ?? (info.available && info.encoders.mp3 ? "mp3" : "wav");
    const reason = formatUnavailable(format, info);
    if (reason) throw new ModelError(reason);
    const chapter = opts.chapter_id
      ? book.chapters.find((c) => c.id === opts.chapter_id)
      : book.chapters.find((c) => c.included && c.kind === "chapter" && c.stats.voiced > 0);
    if (!chapter) throw new ModelError("No voiced chapter to take a sample from.");
    const request: ExportRequest = {
      format,
      bitrate_kbps: format === "mp3" ? 192 : undefined,
      layout: "single",
      chapter_ids: [chapter.id],
      mastering: "acx",
      include_cover: false,
      include_transcripts: false,
      include_beds: false,
    };
    const record = this.store.create(bookId, "sample", request);
    this.enqueue(record.id, () => this.runSample(record.id, book, chapter, format, opts.target_s ?? SAMPLE_TARGET_S));
    return record;
  }

  private async runSample(id: string, book: BookDetail, chapter: Chapter, format: "mp3" | "wav", targetS: number) {
    const ref = { id, book_id: book.id };
    const dir = this.exportDir(book.id, id);
    mkdirSync(dir, { recursive: true });
    try {
      this.progress(ref, "running", 0.2, `Mastering ${chapter.title}`);
      const r = await this.renderChapter(chapter, "acx", book, { includeBeds: false, returnAudio: true });
      const mastered = r.audio!;
      // Skip the chapter's spoken heading: a sample starts with the story.
      const body = r.timings.filter((t, i) => !(i === 0 && t.text.trim().toLowerCase() === chapter.title.trim().toLowerCase()));
      const span = pickSample(body.length ? body : r.timings, targetS);
      if (!span) throw new ModelError(`${chapter.title} has under a minute of narration; pick a longer chapter.`);
      const head = book.settings.pacing.head_room_tone_s;
      const tail = Math.max(1, Math.min(2, book.settings.pacing.tail_room_tone_s));
      const from = Math.max(0, Math.round((span.start_s - head) * r.sampleRate));
      const to = Math.min(frameCount(mastered), Math.round(span.end_s * r.sampleRate));
      const tailFrames = Math.round(tail * r.sampleRate);
      const bed = roomTone(tailFrames, ROOM_TONE_DB, 9);
      const audio = mastered.map((ch) => {
        const o = new Float32Array(to - from + tailFrames);
        o.set(ch.subarray(from, to));
        o.set(bed, to - from);
        return o;
      });
      const report = measure(audio, r.sampleRate);
      const qc = checkBook([{ chapter_id: chapter.id, report }], "acx");
      this.store.update(id, { qc });
      const name = acxFileName(0, `${book.title} Sample`, format).slice(3);
      const path = join(dir, name);
      this.progress(ref, "running", 0.7, `Encoding ${name}`);
      if (format === "wav") writeWav16(path, audio, r.sampleRate);
      else {
        const tmp = join(dir, "sample.wav");
        writeWav16(tmp, audio, r.sampleRate);
        const res = await runFfmpeg(
          buildEncodeArgs({
            format,
            input: tmp,
            output: path,
            bitrateKbps: 192,
            tags: tagMetadata({ title: `${book.title} (sample)`, album: book.title, author: book.author, narrator: book.narrator, comment: narratorLine(book.narrator) }),
          }),
        );
        rmSync(tmp, { force: true });
        if (!res.ok) throw new ModelError(`Encoding failed: ${res.error}`);
      }
      this.store.update(id, { status: "done", progress: 1, message: null, path, size_bytes: statSync(path).size });
      this.books.hub.publish(book.id, { type: "export", export_id: id, status: "done", progress: 1 });
    } catch (exc) {
      const error = exc instanceof Error ? exc.message : String(exc);
      this.store.update(id, { status: "failed", error });
      this.books.hub.publish(book.id, { type: "export", export_id: id, status: "failed", error });
    }
  }

  /** Path of a finished export's file, or null. */
  downloadPath(exportId: string): string | null {
    const e = this.store.get(exportId);
    return e?.status === "done" && e.path && existsSync(e.path) ? e.path : null;
  }
}

/* ---------------------------------------------------------------- helpers */

function emptyQc(chapterId: string, exc: unknown): ChapterQc {
  return {
    chapter_id: chapterId,
    report: {
      rms_db: -120,
      peak_dbfs: -120,
      noise_floor_db: -120,
      integrated_lufs: -120,
      duration_s: 0,
      head_silence_s: 0,
      tail_silence_s: 0,
      sample_rate: 0,
      channels: 0,
    },
    checks: [{ id: "audio", pass: false, message: exc instanceof Error ? exc.message : String(exc) }],
  };
}

/** QC for rendered chapters: the report checks against one book-wide
 *  channel count, plus the split checks for chapters cut at 120 minutes. */
function judge(rendered: RenderedChapter[], preset: MasteringPresetId, bookChannels: number): ChapterQc[] {
  return rendered.map((r) => ({
    chapter_id: r.chapter.id,
    report: r.report,
    checks: splitChecks(checkReport(r.report, preset, { bookChannels }), r.parts, r.chapter.title),
  }));
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

const services = new WeakMap<MirliService, AudiobookExportService>();

export function audiobookExports(svc: MirliService): AudiobookExportService {
  let s = services.get(svc);
  if (!s) {
    s = new AudiobookExportService(svc);
    services.set(svc, s);
  }
  return s;
}
