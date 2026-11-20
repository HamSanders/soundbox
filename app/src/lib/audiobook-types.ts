/**
 * Audiobooks: the shared contract every audiobook module builds against.
 *
 * A book is a list of chapters, and each chapter is backed by one existing
 * `story`. A paragraph is one `story_segments` row, so the studio timeline,
 * delivery controls, track devices and export mixing all keep working on a
 * chapter. The audiobook tables only hold what stories don't: book metadata,
 * chapter order and kind, characters, per-paragraph casting and lock state,
 * takes, pronunciations, render runs and exports.
 *
 * Mirror of `server/src/audiobook/types.ts`. Change both together.
 */

export type ChapterKind =
  | "opening_credits"
  | "front_matter" // copyright, dedication, epigraph, foreword...
  | "chapter"
  | "back_matter" // afterword, acknowledgements, about the author...
  | "closing_credits"
  | "retail_sample";

export interface PacingSettings {
  /** Silence between paragraphs, seconds. */
  paragraph_gap_s: number;
  /** Extra silence after a chapter heading paragraph, seconds. */
  heading_gap_s: number;
  /** Room tone at the head of each chapter file (ACX: 0.5–1 s). */
  head_room_tone_s: number;
  /** Room tone at the tail of each chapter file (ACX: 1–5 s). */
  tail_room_tone_s: number;
}

export interface BookSettings {
  /** Default TTS model id for new paragraphs (e.g. "audiocpp:kokoro", "endpoint:<id>"). */
  model_id: string | null;
  /** Narrator voice: every paragraph without a character uses it. */
  narrator_voice_id: string | null;
  /** Default delivery options applied to every chapter story. */
  request_options: Record<string, unknown>;
  pacing: PacingSettings;
  /** Mastering preset id (see MasteringPreset). */
  mastering: MasteringPresetId;
  /** "single" = narrator only; "multi" = narrator + a voice per character. */
  cast_mode: "single" | "multi";
}

export interface Book {
  id: string;
  project_id: string | null;
  title: string;
  subtitle: string | null;
  author: string | null;
  /** Credited narrator name(s) for the credits and metadata. */
  narrator: string | null;
  description: string | null;
  language: string; // BCP-47, e.g. "en"
  genres: string[];
  series: string | null;
  series_index: number | null;
  isbn: string | null;
  publisher: string | null;
  publication_date: string | null;
  /** Library-relative path of the cover image, if any. */
  cover_path: string | null;
  settings: BookSettings;
  created_at: string;
  updated_at: string;
}

export type ChapterStatus = "empty" | "partial" | "voiced" | "mastered";

export interface Chapter {
  id: string;
  book_id: string;
  /** The story that holds this chapter's paragraphs and timeline. */
  story_id: string;
  position: number;
  title: string;
  kind: ChapterKind;
  /** Excluded chapters stay in the book but are skipped by render and export. */
  included: boolean;
}

/** Derived counts; computed on read, never stored. */
export interface ChapterStats {
  chapter_id: string;
  paragraphs: number;
  voiced: number;
  locked: number;
  characters: number; // text characters, for time/cost estimates
  duration_s: number; // sum of voiced clip durations
}

export interface Character {
  id: string;
  book_id: string;
  name: string;
  /** Other names the text uses for this character ("Liz", "Miss Bennet"). */
  aliases: string[];
  description: string | null; // age, gender, accent, temperament: drives voice suggestions
  voice_id: string | null;
  model_id: string | null; // null = book default
  request_options: Record<string, unknown>;
  /** Display colour token index, so a voice keeps one colour across the UI. */
  color: number;
}

/** Audiobook state for one paragraph (one story_segments row). */
export interface ParagraphMeta {
  segment_id: string;
  chapter_id: string;
  /** null = narrator. */
  character_id: string | null;
  locked: boolean;
  /** Paragraph is a chapter heading (gets heading_gap_s after it). */
  is_heading: boolean;
}

export interface Take {
  id: string;
  segment_id: string;
  sound_id: string;
  /** The text actually spoken (after pronunciation rules). */
  spoken_text: string;
  voice_id: string | null;
  model_id: string;
  request_options: Record<string, unknown>;
  seed: number | null;
  /** The take currently on the timeline. */
  selected: boolean;
  created_at: string;
}

export type PronunciationKind = "alias" | "ipa" | "cmu";

export interface PronunciationRule {
  id: string;
  /** null = global dictionary shared by every book. */
  book_id: string | null;
  term: string;
  kind: PronunciationKind;
  /** Alias text, or the phoneme string for ipa/cmu. */
  replacement: string;
  case_sensitive: boolean;
  whole_word: boolean;
  /** First match wins, top to bottom. */
  position: number;
}

export type RenderScope =
  | { kind: "book" }
  | { kind: "chapter"; chapter_id: string }
  | { kind: "paragraphs"; segment_ids: string[] };

export type RenderStatus = "queued" | "running" | "paused" | "done" | "failed" | "cancelled";

/** A batch voicing run. Persisted, so it resumes after a restart. */
export interface RenderRun {
  id: string;
  book_id: string;
  scope: RenderScope;
  /** Re-voice paragraphs that already have audio (locked ones never are). */
  overwrite: boolean;
  status: RenderStatus;
  total: number;
  done: number;
  failed: number;
  current_segment_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type MasteringPresetId = "acx" | "podcast" | "none";

export interface LoudnessReport {
  rms_db: number;
  peak_dbfs: number; // true peak
  noise_floor_db: number;
  integrated_lufs: number;
  duration_s: number;
  head_silence_s: number;
  tail_silence_s: number;
  sample_rate: number;
  channels: number;
}

export interface QcCheck {
  id: string; // "rms" | "peak" | "noise_floor" | "room_tone_head" | "room_tone_tail" | "max_length" | ...
  pass: boolean;
  message: string;
}

export interface ChapterQc {
  chapter_id: string;
  report: LoudnessReport;
  checks: QcCheck[];
}

export type ExportFormat = "mp3" | "wav" | "flac" | "m4b";

export interface ExportRequest {
  format: ExportFormat;
  /** mp3 only. ACX wants 192 CBR. */
  bitrate_kbps?: number;
  /** "files" = one file per included chapter (ACX naming), zipped. "single" = one file (m4b always single, with chapter markers). */
  layout: "files" | "single";
  chapter_ids?: string[]; // default: every included chapter
  mastering: MasteringPresetId;
  include_cover: boolean;
  /** Also write SRT/VTT captions and a read-along JSON (paragraph timings). */
  include_transcripts: boolean;
  /** Mix music/SFX beds (tracks 1+) into the export. Default true; always off for retail_sample chapters. */
  include_beds?: boolean;
}

export interface BookExport {
  id: string;
  book_id: string;
  request: ExportRequest;
  status: "queued" | "running" | "done" | "failed";
  /** Absolute path of the zip or single file when done. */
  path: string | null;
  qc: ChapterQc[];
  error: string | null;
  created_at: string;
}

/**
 * The parsed manuscript the importer hands to the book store. Parsers
 * (EPUB/PDF/DOCX/TXT/MD/HTML/URL) produce this; nothing downstream sees files.
 */
export interface Manuscript {
  title: string | null;
  subtitle: string | null;
  author: string | null;
  language: string | null;
  description: string | null;
  isbn: string | null;
  publisher: string | null;
  publication_date: string | null;
  cover: { bytes: Uint8Array; mime: string } | null;
  sections: ManuscriptSection[];
  /** Parser warnings shown on the review screen ("12 pages had no text layer"). */
  warnings: string[];
}

export interface ManuscriptSection {
  title: string;
  /** Detected kind; the review screen lets the user change it. */
  kind: ChapterKind;
  /** Suggested include state (copyright pages default to false). */
  included: boolean;
  paragraphs: string[];
}

/** Read-along timing for one paragraph inside a rendered chapter file. */
export interface ParagraphTiming {
  segment_id: string;
  start_s: number;
  end_s: number;
  text: string;
  character_id: string | null;
}
