/**
 * What the listening side consumes. Mirrors the server's listen module
 * (`server/src/audiobook/publish/{manifest,store,checklist,common}.ts` and
 * `server/src/routes/audiobook-listen.ts`); change both together.
 */

import type { Book, ChapterKind } from "./audiobook-types";

export interface ListenProgress {
  book_id: string;
  chapter_id: string | null;
  position_s: number;
  speed: number;
  book_position_s: number;
  finished_at: string | null;
  started_at: string;
  updated_at: string;
}

export interface ProgressPatch {
  chapter_id: string | null;
  position_s: number;
  speed?: number;
  book_position_s?: number;
  finished?: boolean;
}

export interface Bookmark {
  id: string;
  book_id: string;
  chapter_id: string;
  position_s: number;
  segment_id: string | null;
  /** Empty for a plain bookmark; text makes it a note. */
  note: string;
  created_at: string;
  updated_at: string;
}

/** A book on the listening shelf. */
export interface ShelfBook {
  id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  description: string | null;
  language: string;
  genres: string[];
  tags: string[];
  series: string | null;
  series_index: number | null;
  publication_date: string | null;
  cover_url: string | null;
  duration_s: number;
  chapters: number;
  playable_chapters: number;
  /** Rough length of the whole text read aloud, voiced or not. */
  estimated_s: number;
  /** The bundled classic this book was started from, if any. */
  classic_id: string | null;
  progress: ListenProgress | null;
  created_at: string;
  updated_at: string;
}

export interface ListenParagraph {
  segment_id: string;
  text: string;
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
  duration_s: number;
  audio_url: string | null;
  source: "export" | "live" | null;
  paragraphs: ListenParagraph[];
}

export interface ListenCastMember {
  character_id: string | null;
  role: string;
  voice_id: string | null;
  voice_name: string | null;
}

export interface ListenSample {
  chapter_id: string;
  start_s: number;
  end_s: number;
  from: "retail_sample" | "first_chapter";
}

export interface ListenManifest {
  book: Book & { cover_url: string | null; tags: string[] };
  cast: ListenCastMember[];
  characters: { id: string; name: string; color: number }[];
  chapters: ListenChapter[];
  duration_s: number;
  sample: ListenSample | null;
  progress: ListenProgress | null;
  bookmarks: Bookmark[];
  /** True once an ASR alignment pass supplies real word timings. */
  word_timings: boolean;
}

export type ChecklistLevel = "required" | "recommended";

export interface ChecklistItem {
  id: string;
  label: string;
  level: ChecklistLevel;
  pass: boolean;
  detail: string;
}

export type ChecklistTargetId = "spotify" | "apple_books" | "read_along" | "podcast_rss" | "web_player";

export interface ChecklistTarget {
  id: ChecklistTargetId;
  name: string;
  source_url: string | null;
  ready: boolean;
  items: ChecklistItem[];
}

export type AudioEncoding = "auto" | "mp3" | "wav";

export interface PublishResult {
  kind: "webplayer" | "rss";
  name: string;
  dir: string;
  zip_path: string | null;
  download_url: string | null;
  files: string[];
  chapters: number;
  warnings: string[];
  created_at: string;
}

export interface RssRequest {
  base_url: string;
  encoding?: AudioEncoding;
  explicit?: boolean;
  owner_email?: string | null;
}
