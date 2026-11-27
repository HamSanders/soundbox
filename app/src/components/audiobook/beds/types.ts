/** Beds, as `server/src/audiobook/beds.ts` serves them. Change both together. */

export type BedKind = "music" | "ambience" | "sfx";
/** "scene" plays from `anchor_segment_id` to the end of `end_segment_id`. */
export type BedMode = "full" | "intro" | "outro" | "intro_outro" | "scene";
export type BedStatus = "generating" | "ready" | "failed";

export interface DuckOptions {
  depth_db: number;
  attack_ms: number;
  release_ms: number;
  lookahead_ms: number;
  hold_ms: number;
  threshold_db: number;
}

export interface Bed {
  id: string;
  book_id: string;
  chapter_id: string;
  kind: BedKind;
  label: string;
  track_index: number;
  sound_id: string | null;
  prompt: string | null;
  model_id: string | null;
  gain_db: number;
  fade_in_s: number;
  fade_out_s: number;
  loop: boolean;
  mode: BedMode;
  intro_s: number | null;
  anchor_segment_id: string | null;
  end_segment_id: string | null;
  offset_s: number;
  duck: DuckOptions | null;
  status: BedStatus;
  job_id: string | null;
  error: string | null;
  segment_ids: string[];
  laid_out_s: number;
  created_at: string;
  updated_at: string;
  stale: boolean;
}

export interface BedInput {
  kind?: BedKind;
  label?: string | null;
  sound_id?: string | null;
  prompt?: string | null;
  model_id?: string | null;
  duration_s?: number | null;
  gain_db?: number;
  fade_in_s?: number;
  fade_out_s?: number;
  loop?: boolean;
  mode?: BedMode;
  intro_s?: number | null;
  anchor_segment_id?: string | null;
  end_segment_id?: string | null;
  offset_s?: number;
  duck?: Partial<DuckOptions> | false | null;
}

export type BedPatch = Omit<BedInput, "kind" | "prompt" | "model_id" | "duration_s">;

/** One proposal from "Suggest soundscape" (`server/src/llm/soundscape.ts`). */
export interface SoundscapeSuggestion {
  id: string;
  kind: BedKind;
  label: string;
  prompt: string;
  mood: string | null;
  setting: string | null;
  start_paragraph_id: string;
  end_paragraph_id: string;
  reason: string;
  gain_db: number;
  duck_db: number;
  duration_s: number;
  source: "llm" | "heuristic";
}

export interface SoundscapeResult {
  source: "llm" | "heuristic";
  suggestions: SoundscapeSuggestion[];
  note: string | null;
}

export interface BedWarning {
  id: "distribution" | "retail_sample" | "noise_floor";
  severity: "info" | "warn";
  message: string;
  chapter_ids: string[];
}

/** `GET /api/audiobooks/:id/beds/export-info`, for the export dialog. */
export interface BedExportInfo {
  has_beds: boolean;
  include_beds_default: boolean;
  warnings: BedWarning[];
}
