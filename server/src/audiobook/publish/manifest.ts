/**
 * The listen manifest: everything a player needs to play a book and follow
 * along in its text, in one response.
 *
 * Chapter audio comes from one of two places:
 *
 *  - **export**: the latest finished export, when the export module has
 *    registered a provider (`setExportAudioProvider`). Its files are mastered
 *    and its timings come from the export's own read-along data.
 *  - **live**: otherwise the chapter's story is mixed on demand (`mix.ts`),
 *    and each voiced paragraph's timing is its clip's place on the timeline
 *    (`start_s` + clip length).
 *
 * Unvoiced paragraphs still appear, with null timings, so the read-along text
 * is the whole chapter and not only the parts that have audio yet.
 */

import type { MirliService } from "../../service.js";
import type { StorySegment } from "../../schemas.js";
import { audiobooks, type Paragraph } from "../service.js";
import type { Book, Chapter, ChapterKind, Character, ParagraphTiming } from "../types.js";
import type { Bookmark, ListenProgress } from "./store.js";

/** ACX's retail sample limit, and what Spotify uses from a preview chapter. */
export const SAMPLE_MAX_S = 5 * 60;

export interface ListenParagraph {
  segment_id: string;
  text: string;
  /** Seconds into the chapter audio; null when the paragraph has no audio. */
  start_s: number | null;
  end_s: number | null;
  character_id: string | null;
  is_heading: boolean;
}

export interface ListenChapter {
  id: string;
  title: string;
  kind: ChapterKind;
  position: number;
  /** Length of the chapter audio, seconds (0 when nothing is voiced). */
  duration_s: number;
  /** Where to fetch the chapter's audio, or null when nothing is voiced. */
  audio_url: string | null;
  source: "export" | "live" | null;
  paragraphs: ListenParagraph[];
}

export interface ListenCastMember {
  /** null = the narrator. */
  character_id: string | null;
  role: string;
  voice_id: string | null;
  voice_name: string | null;
}

export interface ListenSample {
  chapter_id: string;
  start_s: number;
  end_s: number;
  /** "retail_sample" when the book has its own sample chapter. */
  from: "retail_sample" | "first_chapter";
}

export interface ListenManifest {
  book: Book & { cover_url: string | null; tags: string[] };
  cast: ListenCastMember[];
  characters: Pick<Character, "id" | "name" | "color">[];
  chapters: ListenChapter[];
  duration_s: number;
  sample: ListenSample | null;
  progress: ListenProgress | null;
  bookmarks: Bookmark[];
  /**
   * Word-level timings are estimated by the player from paragraph timings.
   * When an ASR alignment pass exists it sets this true and fills
   * `ListenParagraph.words` (not yet defined; see listen-readalong.ts).
   */
  word_timings: boolean;
}

/** One chapter's audio from an export, handed over by the export module. */
export interface ExportedChapterAudio {
  /** Absolute path of the chapter file. */
  path: string;
  mime: string;
  duration_s: number;
  /** Paragraph timings inside that file (null = derive from the story). */
  timings: ParagraphTiming[] | null;
}

/** Returns the latest export's per-chapter audio, keyed by chapter id. */
export type ExportAudioProvider = (bookId: string) => Map<string, ExportedChapterAudio> | null;

const providers = new WeakMap<MirliService, ExportAudioProvider>();

/** Hook for the export module: serve finished exports to the player. */
export function setExportAudioProvider(svc: MirliService, provider: ExportAudioProvider): void {
  providers.set(svc, provider);
}

export function exportedAudio(svc: MirliService, bookId: string): Map<string, ExportedChapterAudio> {
  try {
    return providers.get(svc)?.(bookId) ?? new Map();
  } catch {
    return new Map();
  }
}

/** Chapters a listener hears, in order: included, and not the retail sample
 *  (that one is the Preview button, not part of the book). */
export function listenableChapters(chapters: Chapter[]): Chapter[] {
  return chapters
    .filter((c) => c.included && c.kind !== "retail_sample")
    .sort((a, b) => a.position - b.position);
}

/** Length a clip plays for: its own duration, or the sound's less the trim. */
export function clipLength(segment: StorySegment): number {
  if (segment.duration_s != null && segment.duration_s > 0) return segment.duration_s;
  const full = segment.sound?.duration_s ?? 0;
  return Math.max(0, full - (segment.trim_start_s ?? 0));
}

/** Whether a segment contributes audio to the live mix. */
export function audible(segment: StorySegment): boolean {
  return segment.kind === "line" && Boolean(segment.sound_id) && !segment.muted && clipLength(segment) > 0;
}

/** Read-along timings for a chapter from its story's timeline. */
export function liveTimings(paragraphs: Paragraph[]): ParagraphTiming[] {
  return paragraphs
    .filter((p) => audible(p))
    .map((p) => ({
      segment_id: p.id,
      start_s: round(p.start_s),
      end_s: round(p.start_s + clipLength(p)),
      text: p.text,
      character_id: p.character_id,
    }))
    .sort((a, b) => a.start_s - b.start_s);
}

function round(s: number): number {
  return Math.round(s * 1000) / 1000;
}

export function chapterAudioUrl(bookId: string, chapterId: string): string {
  return `/api/audiobooks/${encodeURIComponent(bookId)}/listen/chapters/${encodeURIComponent(chapterId)}/audio`;
}

export interface BuiltChapter {
  chapter: ListenChapter;
  timings: ParagraphTiming[];
  exported: ExportedChapterAudio | null;
}

/** One chapter's playable form. */
export function buildChapter(
  svc: MirliService,
  bookId: string,
  chapter: Chapter,
  exported: ExportedChapterAudio | null,
): BuiltChapter {
  const paragraphs = (audiobooks(svc).getParagraphs(chapter.id) ?? []).filter(
    (p) => p.kind === "line" && p.text.trim() !== "",
  );
  const live = liveTimings(paragraphs);
  const timings = exported?.timings ?? live;
  const byId = new Map(timings.map((t) => [t.segment_id, t]));
  const duration = exported
    ? exported.duration_s
    : live.reduce((max, t) => Math.max(max, t.end_s), 0);
  const listenParagraphs: ListenParagraph[] = paragraphs.map((p) => {
    const t = byId.get(p.id);
    return {
      segment_id: p.id,
      text: p.text,
      start_s: t ? t.start_s : null,
      end_s: t ? t.end_s : null,
      character_id: p.character_id,
      is_heading: p.is_heading,
    };
  });
  const hasAudio = duration > 0;
  return {
    chapter: {
      id: chapter.id,
      title: chapter.title,
      kind: chapter.kind,
      position: chapter.position,
      duration_s: round(duration),
      audio_url: hasAudio ? chapterAudioUrl(bookId, chapter.id) : null,
      source: hasAudio ? (exported ? "export" : "live") : null,
      paragraphs: listenParagraphs,
    },
    timings,
    exported,
  };
}

export function coverUrl(book: Book): string | null {
  if (!book.cover_path) return null;
  return `/api/audiobooks/${encodeURIComponent(book.id)}/cover?v=${encodeURIComponent(book.updated_at)}`;
}

/** Who reads the book: the narrator, then each character with a voice. */
export function castOf(svc: MirliService, book: Book, characters: Character[]): ListenCastMember[] {
  const voiceName = (id: string | null): string | null => {
    if (!id) return null;
    try {
      return svc.getVoice(id)?.name ?? null;
    } catch {
      return null;
    }
  };
  const narratorVoice = book.settings.narrator_voice_id;
  const cast: ListenCastMember[] = [
    {
      character_id: null,
      role: "Narrator",
      voice_id: narratorVoice,
      voice_name: book.narrator ?? voiceName(narratorVoice),
    },
  ];
  if (book.settings.cast_mode === "multi") {
    for (const c of characters) {
      if (!c.voice_id) continue;
      cast.push({ character_id: c.id, role: c.name, voice_id: c.voice_id, voice_name: voiceName(c.voice_id) });
    }
  }
  return cast;
}

/** The Preview button: the retail sample chapter, else the opening of the
 *  first real chapter, capped at five minutes. */
export function sampleOf(svc: MirliService, bookId: string, chapters: Chapter[], built: BuiltChapter[]): ListenSample | null {
  const retail = chapters.find((c) => c.kind === "retail_sample" && c.included);
  if (retail) {
    const b = buildChapter(svc, bookId, retail, exportedAudio(svc, bookId).get(retail.id) ?? null);
    if (b.chapter.duration_s > 0) {
      return { chapter_id: retail.id, start_s: 0, end_s: Math.min(b.chapter.duration_s, SAMPLE_MAX_S), from: "retail_sample" };
    }
  }
  const first =
    built.find((b) => b.chapter.kind === "chapter" && b.chapter.duration_s > 0) ??
    built.find((b) => b.chapter.duration_s > 0);
  if (!first) return null;
  return {
    chapter_id: first.chapter.id,
    start_s: 0,
    end_s: Math.min(first.chapter.duration_s, SAMPLE_MAX_S),
    from: "first_chapter",
  };
}

export function buildManifest(svc: MirliService, bookId: string): ListenManifest | null {
  const detail = audiobooks(svc).getBook(bookId);
  if (!detail) return null;
  const { chapters: allChapters, characters, stats: _stats, ...book } = detail;
  const exports = exportedAudio(svc, bookId);
  const built = listenableChapters(allChapters).map((c) => buildChapter(svc, bookId, c, exports.get(c.id) ?? null));
  return {
    book: { ...book, cover_url: coverUrl(book), tags: svc.db.listen.getTags(bookId) },
    cast: castOf(svc, book, characters),
    characters: characters.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    chapters: built.map((b) => b.chapter),
    duration_s: round(built.reduce((sum, b) => sum + b.chapter.duration_s, 0)),
    sample: sampleOf(svc, bookId, allChapters, built),
    progress: svc.db.listen.getProgress(bookId),
    bookmarks: svc.db.listen.listBookmarks(bookId),
    word_timings: false,
  };
}
