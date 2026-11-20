/**
 * Beds: music, ambience and sound effects under a chapter's narration.
 *
 * A bed is laid out as ordinary clips on its own story track (index 1 and up)
 * in the chapter's story, so the studio timeline shows and edits it, and the
 * story mixdown hears it. The `book_beds` row only holds what the clips
 * cannot: where the audio came from (library sound or prompt), how it should
 * be laid out (loop, intro/outro, paragraph anchor), and how it ducks under
 * the narration on track 0.
 *
 * Laying out is idempotent: the bed's clips are removed and placed again from
 * the row, so "fit to chapter" after the narration changes length is one call.
 * Hand edits to the clips on the timeline last until the next layout.
 *
 * Ducking is applied at mix time (`duckChapterLanes`, called by the export
 * mixdown) rather than written into the clips, so changing the depth never
 * needs a re-render.
 */

import { randomUUID } from "node:crypto";

import type { Database } from "better-sqlite3";

import { applyDucking, resolveDuck, type DuckOptions } from "../audio/duck.js";
import type { Audio } from "../audio/dsp.js";
import { ModelError } from "../errors.js";
import type { ModelInfo, StorySegment } from "../schemas.js";
import type { MirliService } from "../service.js";
import { audiobooks } from "./service.js";
import type { Chapter, ChapterKind } from "./types.js";

export type BedKind = "music" | "ambience" | "sfx";
/** Where in the chapter a music or ambience bed plays. */
export type BedMode = "full" | "intro" | "outro" | "intro_outro";
export type BedStatus = "generating" | "ready" | "failed";

export const BED_KINDS: BedKind[] = ["music", "ambience", "sfx"];
export const BED_MODES: BedMode[] = ["full", "intro", "outro", "intro_outro"];

export interface Bed {
  id: string;
  book_id: string;
  chapter_id: string;
  kind: BedKind;
  /** Shown as the track name. */
  label: string;
  /** The story track the bed's clips sit on (1 and up). */
  track_index: number;
  /** The library sound the clips play; null while it is being generated. */
  sound_id: string | null;
  /** The prompt it was generated from, if it was. */
  prompt: string | null;
  model_id: string | null;
  gain_db: number;
  fade_in_s: number;
  fade_out_s: number;
  /** Repeat the sound to fill its span. Music and ambience only. */
  loop: boolean;
  mode: BedMode;
  /** Length of the intro and outro pieces; null = the sound's own length. */
  intro_s: number | null;
  /** SFX: the paragraph it fires at. null = chapter start. */
  anchor_segment_id: string | null;
  /** Seconds after the anchor (or chapter start). */
  offset_s: number;
  /** null = no ducking. */
  duck: DuckOptions | null;
  status: BedStatus;
  job_id: string | null;
  error: string | null;
  /** Clips currently placed for this bed. */
  segment_ids: string[];
  /** The narration length the clips were laid out against. */
  laid_out_s: number;
  created_at: string;
  updated_at: string;
}

/** A bed plus what is derived on read. */
export interface BedView extends Bed {
  /** Narration changed length since the bed was laid out. */
  stale: boolean;
}

export interface BedInput {
  kind?: BedKind;
  label?: string | null;
  sound_id?: string | null;
  prompt?: string | null;
  model_id?: string | null;
  /** Length to generate, seconds. Default depends on kind and mode. */
  duration_s?: number | null;
  gain_db?: number;
  fade_in_s?: number;
  fade_out_s?: number;
  loop?: boolean;
  mode?: BedMode;
  intro_s?: number | null;
  anchor_segment_id?: string | null;
  offset_s?: number;
  /** false = no ducking; an object overrides the defaults. */
  duck?: Partial<DuckOptions> | false | null;
}

export type BedPatch = Omit<BedInput, "kind" | "prompt" | "model_id" | "duration_s">;

export interface BedWarning {
  id: "distribution" | "retail_sample" | "noise_floor";
  severity: "info" | "warn";
  message: string;
  chapter_ids: string[];
}

/** What the export dialog reads to offer its "include beds" toggle. */
export interface BedExportInfo {
  has_beds: boolean;
  /** Default for the toggle: off when an included chapter is a retail sample. */
  include_beds_default: boolean;
  warnings: BedWarning[];
}

const DEFAULTS: Record<BedKind, Omit<BedInput, "kind"> & { duration_s: number }> = {
  music: { gain_db: -18, fade_in_s: 3, fade_out_s: 5, loop: true, mode: "full", duration_s: 60, duck: {} },
  ambience: { gain_db: -24, fade_in_s: 4, fade_out_s: 4, loop: true, mode: "full", duration_s: 30, duck: { depth_db: 6 } },
  sfx: { gain_db: -6, fade_in_s: 0, fade_out_s: 0, loop: false, mode: "full", duration_s: 4, duck: false },
};

/** Clip length limit of the story timeline (segmentCreateSchema.duration_s). */
const MAX_CLIP_S = 600;
const MAX_CLIPS = 2000;
const MAX_FADE_S = 60;
const FIRST_BED_TRACK = 1;
const LAST_TRACK = 16;

/* ----------------------------------------------------------------- layout */

export interface ClipPlan {
  start_s: number;
  trim_start_s: number;
  duration_s: number;
  fade_in_s: number;
  fade_out_s: number;
}

export interface LayoutInput {
  kind: BedKind;
  mode: BedMode;
  loop: boolean;
  /** Length of the source sound. */
  sound_s: number;
  /** Narration length of the chapter; 0 = nothing voiced yet. */
  chapter_s: number;
  intro_s: number | null;
  fade_in_s: number;
  fade_out_s: number;
  /** SFX: start of the anchor paragraph, or 0. */
  anchor_s: number;
  offset_s: number;
}

const round = (s: number) => Math.round(s * 1000) / 1000;

/** Fill [from, to] with the sound, looping with short crossfades if asked. */
function fill(from: number, to: number, input: LayoutInput): ClipPlan[] {
  const span = to - from;
  if (span <= 0 || input.sound_s <= 0) return [];
  const unit = Math.min(input.sound_s, MAX_CLIP_S);
  const clips: ClipPlan[] = [];
  if (!input.loop || unit >= span) {
    clips.push({ start_s: from, trim_start_s: 0, duration_s: Math.min(unit, span), fade_in_s: 0, fade_out_s: 0 });
  } else {
    // Overlapping clips on one lane crossfade in the mixdown and the timeline
    // alike, so the loop seam is an overlap, not an edit.
    const xf = Math.min(2, unit / 4);
    const step = unit - xf;
    if (Math.ceil(span / step) > MAX_CLIPS) {
      throw new ModelError(
        `A ${round(unit)} s sound is too short to loop over ${Math.round(span)} s; use a longer bed.`,
      );
    }
    for (let start = from; start < to - 1e-6; start += step) {
      const duration = Math.min(unit, to - start);
      clips.push({ start_s: start, trim_start_s: 0, duration_s: duration, fade_in_s: 0, fade_out_s: 0 });
      if (start + duration >= to - 1e-6) break;
    }
  }
  const first = clips[0];
  const last = clips[clips.length - 1];
  first.fade_in_s = Math.min(input.fade_in_s, MAX_FADE_S, first.duration_s);
  last.fade_out_s = Math.min(input.fade_out_s, MAX_FADE_S, last.duration_s - (clips.length === 1 ? first.fade_in_s : 0));
  return clips.map((c) => ({
    start_s: round(c.start_s),
    trim_start_s: c.trim_start_s,
    duration_s: round(c.duration_s),
    fade_in_s: round(Math.max(0, c.fade_in_s)),
    fade_out_s: round(Math.max(0, c.fade_out_s)),
  }));
}

/** Where a bed's clips go. Pure. */
export function layoutBed(input: LayoutInput): ClipPlan[] {
  if (input.kind === "sfx") {
    return fill(Math.max(0, input.anchor_s + input.offset_s), Math.max(0, input.anchor_s + input.offset_s) + input.sound_s, {
      ...input,
      loop: false,
    });
  }
  // Nothing voiced yet: lay the sound out once so there is something to hear.
  const length = input.chapter_s > 0 ? input.chapter_s : input.sound_s;
  const piece = Math.min(input.intro_s ?? input.sound_s, length);
  switch (input.mode) {
    case "full":
      return fill(0, length, input);
    case "intro":
      return fill(0, piece, input);
    case "outro":
      return fill(length - piece, length, input);
    case "intro_outro": {
      if (piece * 2 >= length) return fill(0, length, input);
      return [...fill(0, piece, input), ...fill(length - piece, length, input)];
    }
  }
}

/** End of the narration on track 0, seconds. */
export function narrationLength(segments: StorySegment[]): number {
  let end = 0;
  for (const s of segments) {
    if (s.track_index !== 0) continue;
    if (!s.sound_id && s.kind !== "pause") continue;
    end = Math.max(end, s.start_s + (s.duration_s ?? 0));
  }
  return round(end);
}

/* ------------------------------------------------------------------ store */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS book_beds (
    id                TEXT PRIMARY KEY,
    book_id           TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chapter_id        TEXT NOT NULL REFERENCES book_chapters(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL,
    label             TEXT NOT NULL,
    track_index       INTEGER NOT NULL,
    sound_id          TEXT,
    prompt            TEXT,
    model_id          TEXT,
    gain_db           REAL NOT NULL,
    fade_in_s         REAL NOT NULL,
    fade_out_s        REAL NOT NULL,
    loop              INTEGER NOT NULL,
    mode              TEXT NOT NULL,
    intro_s           REAL,
    anchor_segment_id TEXT,
    offset_s          REAL NOT NULL DEFAULT 0,
    duck              TEXT,
    status            TEXT NOT NULL,
    job_id            TEXT,
    error             TEXT,
    segment_ids       TEXT NOT NULL DEFAULT '[]',
    laid_out_s        REAL NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_beds_chapter ON book_beds(chapter_id, track_index);
CREATE INDEX IF NOT EXISTS idx_book_beds_book ON book_beds(book_id);
`;

interface BedRow extends Omit<Bed, "loop" | "duck" | "segment_ids"> {
  loop: number;
  duck: string | null;
  segment_ids: string;
}

function fromRow(row: BedRow): Bed {
  return {
    ...row,
    loop: row.loop === 1,
    duck: row.duck ? resolveDuck(JSON.parse(row.duck) as Partial<DuckOptions>) : null,
    segment_ids: JSON.parse(row.segment_ids) as string[],
  };
}

const COLUMNS = [
  "id", "book_id", "chapter_id", "kind", "label", "track_index", "sound_id", "prompt", "model_id",
  "gain_db", "fade_in_s", "fade_out_s", "loop", "mode", "intro_s", "anchor_segment_id", "offset_s",
  "duck", "status", "job_id", "error", "segment_ids", "laid_out_s", "created_at", "updated_at",
] as const;

function toRow(bed: Bed): Record<string, unknown> {
  return {
    ...bed,
    loop: bed.loop ? 1 : 0,
    duck: bed.duck ? JSON.stringify(bed.duck) : null,
    segment_ids: JSON.stringify(bed.segment_ids),
  };
}

export class BedStore {
  constructor(private readonly conn: Database) {
    this.conn.exec(SCHEMA);
  }

  get(id: string): Bed | null {
    const row = this.conn.prepare("SELECT * FROM book_beds WHERE id=?").get(id) as BedRow | undefined;
    return row ? fromRow(row) : null;
  }

  listBook(bookId: string): Bed[] {
    return (
      this.conn
        .prepare("SELECT * FROM book_beds WHERE book_id=? ORDER BY chapter_id, track_index")
        .all(bookId) as BedRow[]
    ).map(fromRow);
  }

  listChapter(chapterId: string): Bed[] {
    return (
      this.conn.prepare("SELECT * FROM book_beds WHERE chapter_id=? ORDER BY track_index").all(chapterId) as BedRow[]
    ).map(fromRow);
  }

  save(bed: Bed): void {
    const row = toRow(bed);
    this.conn
      .prepare(
        `INSERT OR REPLACE INTO book_beds (${COLUMNS.join(",")}) VALUES (${COLUMNS.map((c) => `@${c}`).join(",")})`,
      )
      .run(Object.fromEntries(COLUMNS.map((c) => [c, row[c] ?? null])));
  }

  delete(id: string): void {
    this.conn.prepare("DELETE FROM book_beds WHERE id=?").run(id);
  }
}

/* ---------------------------------------------------------------- service */

/**
 * The shared SQLite connection. `MirliDb.conn` is private; the plan has each
 * audiobook module build its store from it, so it is read here at runtime.
 */
function connOf(svc: MirliService): Database {
  return (svc.db as unknown as { conn: Database }).conn;
}

const now = () => new Date().toISOString();
const newId = () => randomUUID();

function defaultLabel(kind: BedKind, prompt: string | null | undefined, soundName: string | null): string {
  const name = (prompt ?? soundName ?? "").trim();
  const head = kind === "music" ? "Music" : kind === "ambience" ? "Ambience" : "SFX";
  return (name ? `${head}: ${name}` : head).slice(0, 80);
}

export class BedService {
  readonly store: BedStore;
  private readonly watching = new Set<string>();

  constructor(private readonly svc: MirliService) {
    this.store = new BedStore(connOf(svc));
    audiobooks(svc).onDelete(async (scope) => {
      // The stories (and the clips on them) go with the chapters; only the
      // rows need dropping, which ON DELETE CASCADE does for whole books.
      for (const cid of scope.chapter_ids) for (const bed of this.store.listChapter(cid)) this.store.delete(bed.id);
    });
  }

  private get books() {
    return audiobooks(this.svc);
  }

  private chapterOf(bookId: string, chapterId: string): Chapter {
    const chapter = this.books.getChapter(chapterId);
    if (!chapter || chapter.book_id !== bookId) throw new ModelError(`Chapter '${chapterId}' not found.`);
    return chapter;
  }

  private view(bed: Bed, lengths: Map<string, number>): BedView {
    let length = lengths.get(bed.chapter_id);
    if (length === undefined) {
      const chapter = this.books.getChapter(bed.chapter_id);
      length = chapter ? narrationLength(this.svc.listSegments(chapter.story_id)) : 0;
      lengths.set(bed.chapter_id, length);
    }
    this.reconcile(bed);
    return {
      ...bed,
      stale: bed.kind !== "sfx" && bed.status === "ready" && length > 0 && Math.abs(length - bed.laid_out_s) > 0.05,
    };
  }

  /** A bed left "generating" by a restart, or whose job finished unseen. */
  private reconcile(bed: Bed): void {
    if (bed.status !== "generating" || !bed.job_id || this.watching.has(bed.id)) return;
    const job = this.svc.jobs.get(bed.job_id);
    if (job && job.status !== "done" && job.status !== "error" && job.status !== "cancelled") {
      void this.watch(bed.id);
      return;
    }
    void this.finishGeneration(bed.id);
  }

  list(bookId: string, chapterId?: string | null): BedView[] {
    const lengths = new Map<string, number>();
    const beds = chapterId ? this.store.listChapter(chapterId) : this.store.listBook(bookId);
    return beds.filter((b) => b.book_id === bookId).map((b) => this.view(b, lengths));
  }

  get(bookId: string, bedId: string): BedView | null {
    const bed = this.store.get(bedId);
    if (!bed || bed.book_id !== bookId) return null;
    return this.view(bed, new Map());
  }

  /** The next free story track for a new bed in this chapter. */
  private freeTrack(chapter: Chapter): number {
    const used = new Set(this.store.listChapter(chapter.id).map((b) => b.track_index));
    for (const s of this.svc.listSegments(chapter.story_id)) if (s.track_index > 0) used.add(s.track_index);
    for (let t = FIRST_BED_TRACK; t <= LAST_TRACK; t++) if (!used.has(t)) return t;
    throw new ModelError("This chapter has no free track for another bed.");
  }

  async create(bookId: string, chapterId: string, input: BedInput): Promise<BedView> {
    const chapter = this.chapterOf(bookId, chapterId);
    const kind = input.kind ?? "music";
    const d = DEFAULTS[kind];
    if (!input.sound_id && !input.prompt?.trim()) throw new ModelError("A bed needs a sound_id or a prompt.");
    const sound = input.sound_id ? this.svc.getSound(input.sound_id) : null;
    if (input.sound_id && !sound) throw new ModelError(`Sound '${input.sound_id}' not found.`);
    if (input.anchor_segment_id) this.anchorStart(chapter, input.anchor_segment_id);

    const track = this.freeTrack(chapter);
    const duck = input.duck === false || input.duck === null ? null : resolveDuck({ ...(d.duck || {}), ...(input.duck ?? {}) });
    const bed: Bed = {
      id: newId(),
      book_id: bookId,
      chapter_id: chapterId,
      kind,
      label: (input.label?.trim() || defaultLabel(kind, input.prompt, sound?.name ?? null)).slice(0, 80),
      track_index: track,
      sound_id: sound?.id ?? null,
      prompt: input.prompt?.trim() || null,
      model_id: input.model_id ?? null,
      gain_db: input.gain_db ?? d.gain_db!,
      fade_in_s: input.fade_in_s ?? d.fade_in_s!,
      fade_out_s: input.fade_out_s ?? d.fade_out_s!,
      loop: kind === "sfx" ? false : (input.loop ?? d.loop!),
      mode: input.mode ?? d.mode!,
      intro_s: input.intro_s ?? null,
      anchor_segment_id: input.anchor_segment_id ?? null,
      offset_s: input.offset_s ?? 0,
      duck: input.duck === undefined && d.duck === false ? null : duck,
      status: sound ? "ready" : "generating",
      job_id: null,
      error: null,
      segment_ids: [],
      laid_out_s: 0,
      created_at: now(),
      updated_at: now(),
    };
    this.svc.updateTrack(chapter.story_id, track, { name: bed.label });

    if (!sound) {
      const model = await this.pickModel(kind, input.model_id ?? null);
      const duration = Math.min(model.max_duration_s, input.duration_s ?? this.generateLength(kind, bed));
      const job = this.svc.submitGenerate({
        model: model.id,
        prompt: bed.prompt!,
        duration_s: duration,
        variations: 1,
        tags: ["audiobook", kind],
        track_name: bed.label,
      } as Parameters<MirliService["submitGenerate"]>[0]);
      bed.model_id = model.id;
      bed.job_id = job.id;
      this.store.save(bed);
      this.publish(bed);
      void this.watch(bed.id);
      return this.view(bed, new Map());
    }
    this.store.save(bed);
    return this.layout(bookId, bed.id);
  }

  private generateLength(kind: BedKind, bed: Bed): number {
    if (kind !== "sfx" && bed.mode !== "full" && bed.intro_s) return bed.intro_s;
    return DEFAULTS[kind].duration_s;
  }

  /** An installed prompt-to-audio model of the right category. */
  private async pickModel(kind: BedKind, requested: string | null): Promise<ModelInfo> {
    const models = await this.svc.listModels();
    if (requested) {
      const m = models.find((x) => x.id === requested);
      if (!m) throw new ModelError(`Model '${requested}' not found.`);
      if (m.task !== "gen") throw new ModelError(`${m.name} does not generate from a prompt.`);
      return m;
    }
    const category = kind === "music" ? "music" : "sfx";
    const ready = (m: ModelInfo) => m.task === "gen" && (m.status === "loaded" || m.status === "installed");
    const pick =
      models.find((m) => ready(m) && m.category === category && m.status === "loaded") ??
      models.find((m) => ready(m) && m.category === category) ??
      models.find((m) => ready(m) && m.category !== "voice");
    if (!pick) {
      throw new ModelError(
        `No ${category} model is installed. Install one from Models, or pick a sound from the library.`,
      );
    }
    return pick;
  }

  private async watch(bedId: string): Promise<void> {
    const bed = this.store.get(bedId);
    if (!bed?.job_id || this.watching.has(bedId)) return;
    this.watching.add(bedId);
    try {
      for (;;) {
        const job = this.svc.jobs.get(bed.job_id);
        if (!job || job.status === "done" || job.status === "error" || job.status === "cancelled") break;
        await new Promise((r) => setTimeout(r, 300));
      }
    } finally {
      this.watching.delete(bedId);
    }
    await this.finishGeneration(bedId);
  }

  private async finishGeneration(bedId: string): Promise<void> {
    const bed = this.store.get(bedId);
    if (!bed || bed.status !== "generating") return;
    const job = bed.job_id ? this.svc.jobs.get(bed.job_id) : null;
    const soundId = (job?.result?.sounds as string[] | undefined)?.[0] ?? null;
    if (job?.status === "done" && soundId) {
      bed.sound_id = soundId;
      bed.status = "ready";
      bed.updated_at = now();
      this.store.save(bed);
      try {
        await this.layout(bed.book_id, bed.id);
      } catch (exc) {
        this.fail(bed.id, exc instanceof Error ? exc.message : String(exc));
      }
      return;
    }
    this.fail(bed.id, job?.error ?? (job ? `Generation ${job.status}.` : "Generation was interrupted."));
  }

  private fail(bedId: string, error: string): void {
    const bed = this.store.get(bedId);
    if (!bed) return;
    bed.status = "failed";
    bed.error = error;
    bed.updated_at = now();
    this.store.save(bed);
    this.publish(bed);
  }

  private publish(bed: Bed): void {
    this.books.hub.publish(bed.book_id, { type: "beds", chapter_id: bed.chapter_id, bed_id: bed.id });
  }

  private anchorStart(chapter: Chapter, segmentId: string): number {
    const seg = this.svc.getSegment(segmentId);
    if (!seg || seg.story_id !== chapter.story_id) throw new ModelError(`Paragraph '${segmentId}' is not in this chapter.`);
    return seg.start_s;
  }

  /** Remove the bed's clips and place them again from its row. */
  async layout(bookId: string, bedId: string): Promise<BedView> {
    const bed = this.store.get(bedId);
    if (!bed || bed.book_id !== bookId) throw new ModelError(`Bed '${bedId}' not found.`);
    const chapter = this.chapterOf(bookId, bed.chapter_id);
    for (const sid of bed.segment_ids) this.svc.deleteSegment(sid);
    bed.segment_ids = [];
    const segments = this.svc.listSegments(chapter.story_id);
    const length = narrationLength(segments);
    if (bed.status === "ready" && bed.sound_id) {
      const sound = this.svc.getSound(bed.sound_id);
      if (!sound) {
        bed.status = "failed";
        bed.error = "The bed's sound is no longer in the library.";
      } else {
        let anchor = 0;
        if (bed.kind === "sfx" && bed.anchor_segment_id) {
          const seg = segments.find((s) => s.id === bed.anchor_segment_id);
          anchor = seg?.start_s ?? 0;
        }
        const plan = layoutBed({
          kind: bed.kind,
          mode: bed.mode,
          loop: bed.loop,
          sound_s: sound.duration_s,
          chapter_s: length,
          intro_s: bed.intro_s,
          fade_in_s: bed.fade_in_s,
          fade_out_s: bed.fade_out_s,
          anchor_s: anchor,
          offset_s: bed.offset_s,
        });
        for (const clip of plan) {
          const seg = this.svc.createSegment(chapter.story_id, {
            kind: "line",
            text: "",
            speaker: bed.label,
            sound_id: bed.sound_id,
            track_index: bed.track_index,
            start_s: clip.start_s,
            trim_start_s: clip.trim_start_s,
            duration_s: clip.duration_s,
            fade_in_s: clip.fade_in_s,
            fade_out_s: clip.fade_out_s,
            gain_db: bed.gain_db,
          });
          bed.segment_ids.push(seg.id);
        }
      }
    }
    bed.laid_out_s = length;
    bed.updated_at = now();
    this.store.save(bed);
    this.publish(bed);
    return this.view(bed, new Map([[chapter.id, length]]));
  }

  /** Fit every bed in a chapter to the narration as it is now. */
  async layoutChapter(bookId: string, chapterId: string): Promise<BedView[]> {
    this.chapterOf(bookId, chapterId);
    const out: BedView[] = [];
    for (const bed of this.store.listChapter(chapterId)) {
      if (bed.status === "ready") out.push(await this.layout(bookId, bed.id));
      else out.push(this.view(bed, new Map()));
    }
    return out;
  }

  async update(bookId: string, bedId: string, patch: BedPatch): Promise<BedView | null> {
    const bed = this.store.get(bedId);
    if (!bed || bed.book_id !== bookId) return null;
    const chapter = this.chapterOf(bookId, bed.chapter_id);
    if (patch.sound_id !== undefined && patch.sound_id !== null) {
      if (!this.svc.getSound(patch.sound_id)) throw new ModelError(`Sound '${patch.sound_id}' not found.`);
      bed.sound_id = patch.sound_id;
      bed.status = "ready";
      bed.error = null;
    }
    if (patch.anchor_segment_id) this.anchorStart(chapter, patch.anchor_segment_id);
    if (patch.label?.trim()) {
      bed.label = patch.label.trim().slice(0, 80);
      this.svc.updateTrack(chapter.story_id, bed.track_index, { name: bed.label });
    }
    if (patch.gain_db !== undefined) bed.gain_db = patch.gain_db;
    if (patch.fade_in_s !== undefined) bed.fade_in_s = patch.fade_in_s;
    if (patch.fade_out_s !== undefined) bed.fade_out_s = patch.fade_out_s;
    if (patch.loop !== undefined && bed.kind !== "sfx") bed.loop = patch.loop;
    if (patch.mode !== undefined) bed.mode = patch.mode;
    if (patch.intro_s !== undefined) bed.intro_s = patch.intro_s;
    if (patch.anchor_segment_id !== undefined) bed.anchor_segment_id = patch.anchor_segment_id;
    if (patch.offset_s !== undefined) bed.offset_s = patch.offset_s;
    if (patch.duck !== undefined) {
      bed.duck = patch.duck === false || patch.duck === null ? null : resolveDuck({ ...(bed.duck ?? {}), ...patch.duck });
    }
    bed.updated_at = now();
    this.store.save(bed);
    // Ducking is applied at mix time; everything else re-lays the clips.
    const onlyDuck = Object.keys(patch).every((k) => k === "duck" || k === "label");
    if (onlyDuck || bed.status !== "ready") {
      this.publish(bed);
      return this.view(bed, new Map());
    }
    return this.layout(bookId, bed.id);
  }

  async remove(bookId: string, bedId: string): Promise<boolean> {
    const bed = this.store.get(bedId);
    if (!bed || bed.book_id !== bookId) return false;
    const chapter = this.books.getChapter(bed.chapter_id);
    if (bed.job_id) {
      const job = this.svc.jobs.get(bed.job_id);
      if (job && (job.status === "queued" || job.status === "running")) this.svc.jobs.cancel(bed.job_id);
    }
    for (const sid of bed.segment_ids) this.svc.deleteSegment(sid);
    // Drop the lane too if nothing else (a hand-placed clip) lives on it.
    if (chapter && !this.svc.listSegments(chapter.story_id).some((s) => s.track_index === bed.track_index)) {
      this.svc.deleteTrack(chapter.story_id, bed.track_index);
    }
    this.store.delete(bed.id);
    this.publish(bed);
    return true;
  }

  /* --------------------------------------------------------- export side */

  /** Bed tracks of a chapter story and how each ducks. */
  bedTracks(storyId: string): Map<number, DuckOptions | null> {
    const out = new Map<number, DuckOptions | null>();
    const chapter = this.chapterForStory(storyId);
    if (!chapter) return out;
    for (const bed of this.store.listChapter(chapter.id)) out.set(bed.track_index, bed.duck);
    return out;
  }

  /** Clip ids that belong to beds in this story, for a mixdown that leaves beds out. */
  bedSegmentIds(storyId: string): Set<string> {
    const chapter = this.chapterForStory(storyId);
    const out = new Set<string>();
    if (!chapter) return out;
    const tracks = new Set(this.store.listChapter(chapter.id).map((b) => b.track_index));
    for (const s of this.svc.listSegments(storyId)) if (tracks.has(s.track_index)) out.add(s.id);
    return out;
  }

  private chapterForStory(storyId: string): Chapter | null {
    return this.svc.db.audiobooks.chapterForStory(storyId);
  }

  /**
   * The export mixdown's one call. `lanes` is each track of a chapter story
   * mixed on its own, all at `sampleRate` and starting at zero. Returns the
   * lanes to sum: bed lanes ducked under lane 0, or dropped when
   * `includeBeds` is false. Non-bed lanes pass through untouched.
   */
  duckChapterLanes(
    storyId: string,
    lanes: Map<number, Audio>,
    sampleRate: number,
    includeBeds = true,
  ): Map<number, Audio> {
    const beds = this.bedTracks(storyId);
    if (beds.size === 0) return lanes;
    const narration = lanes.get(0) ?? [new Float32Array(0)];
    const out = new Map<number, Audio>();
    for (const [lane, audio] of lanes) {
      if (!beds.has(lane)) {
        out.set(lane, audio);
        continue;
      }
      if (!includeBeds) continue;
      const duck = beds.get(lane);
      out.set(lane, duck ? applyDucking(audio, narration, { ...duck, sampleRate }) : audio);
    }
    return out;
  }

  /** Warnings and the default "include beds" state for an export. */
  exportInfo(bookId: string, chapterIds?: string[] | null): BedExportInfo {
    const book = this.books.getBook(bookId);
    if (!book) throw new ModelError(`Book '${bookId}' not found.`);
    const chosen = book.chapters.filter((c) => (chapterIds?.length ? chapterIds.includes(c.id) : c.included));
    const beds = this.store.listBook(bookId).filter((b) => b.status === "ready");
    const withBeds = chosen.filter((c) => beds.some((b) => b.chapter_id === c.id));
    const warnings: BedWarning[] = [];
    if (withBeds.length) {
      warnings.push({
        id: "distribution",
        severity: "info",
        message:
          "Music and effects are mixed into this export. Some audiobook distributors accept narration only; check your distributor's audio requirements before including beds.",
        chapter_ids: withBeds.map((c) => c.id),
      });
      const samples = withBeds.filter((c) => (c.kind as ChapterKind) === "retail_sample");
      if (samples.length) {
        warnings.push({
          id: "retail_sample",
          severity: "warn",
          message: "ACX retail samples must not contain music. Leave beds out of this export.",
          chapter_ids: samples.map((c) => c.id),
        });
      }
      const ambient = withBeds.filter((c) =>
        beds.some((b) => b.chapter_id === c.id && b.kind !== "sfx" && b.mode === "full"),
      );
      if (ambient.length) {
        warnings.push({
          id: "noise_floor",
          severity: "warn",
          message:
            "A bed that plays through a whole chapter fills the pauses, so the ACX noise-floor check (−60 dB) will measure the bed, not silence.",
          chapter_ids: ambient.map((c) => c.id),
        });
      }
    }
    return {
      has_beds: withBeds.length > 0,
      include_beds_default: !withBeds.some((c) => (c.kind as ChapterKind) === "retail_sample"),
      warnings,
    };
  }
}

const services = new WeakMap<MirliService, BedService>();

/** The bed service for this server. One per MirliService. */
export function beds(svc: MirliService): BedService {
  let service = services.get(svc);
  if (!service) {
    service = new BedService(svc);
    services.set(svc, service);
  }
  return service;
}
