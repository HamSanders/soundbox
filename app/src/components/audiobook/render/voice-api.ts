/**
 * Client for the audiobook voice routes (`server/src/routes/audiobook-voice.ts`):
 * cast, pronunciation, takes and render runs. Shared by the cast, pronounce,
 * takes and render slots. Under `VITE_MOCK=1` every call goes to
 * `voice-mock.ts`.
 */

import { IS_MOCK, request, type Job } from "@/lib/api";
import type { Character, PronunciationKind, PronunciationRule, RenderScope, RenderStatus, Take } from "@/lib/audiobook-types";

import { mockVoiceApi } from "./voice-mock";

export interface TakeRow extends Take {
  origin: "generate" | "selection" | "render";
  source_text: string;
  gen_ms: number | null;
  audio_s: number | null;
}

export interface SplicePlan {
  mode: "words" | "sentence" | "paragraph";
  start: number;
  end: number;
  cut_start_s: number | null;
  cut_end_s: number | null;
  reason: string | null;
}

export interface RenderLogEntry {
  segment_id: string;
  attempt: number;
  outcome: "retry" | "failed" | "warning";
  checks: string[];
  message: string;
  at: string;
}

export interface RenderRunView {
  id: string;
  book_id: string;
  scope: RenderScope;
  overwrite: boolean;
  status: RenderStatus;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  current_segment_id: string | null;
  error: string | null;
  log: RenderLogEntry[];
  options: { max_retries: number; asr_model: string | null };
  created_at: string;
  updated_at: string;
}

export interface ChapterEstimate {
  chapter_id: string;
  title: string;
  paragraphs: number;
  to_voice: number;
  characters: number;
  audio_s: number;
  render_s: number;
}

export interface Estimate {
  chapters: ChapterEstimate[];
  total: Omit<ChapterEstimate, "chapter_id" | "title">;
  basis: { model_id: string; rtf: number; chars_per_s: number; measured: boolean; samples: number }[];
  asr_model: string | null;
}

export interface VoiceSuggestion {
  character: string;
  voice_id: string | null;
  score: number;
  shared: boolean;
  alternatives: { voice_id: string; score: number }[];
}

export interface DetectResult {
  source: "llm" | "heuristic";
  characters: Character[];
  created: number;
  cast: number;
  split: number;
  notes: string[];
  voices_applied: number;
}

export interface TermSuggestion {
  term: string;
  count: number;
  reason: "name" | "invented";
  example: string;
}

export interface RuleInput {
  term: string;
  kind?: PronunciationKind;
  replacement: string;
  case_sensitive?: boolean;
  whole_word?: boolean;
}

export interface PlayResult {
  job: Job;
  text: string;
  spoken?: string;
  warnings?: string[];
}

export interface VoiceApi {
  listCharacters(bookId: string): Promise<Character[]>;
  createCharacter(bookId: string, fields: Partial<Character> & { name: string }): Promise<Character>;
  updateCharacter(bookId: string, id: string, fields: Partial<Character>): Promise<Character>;
  deleteCharacter(bookId: string, id: string): Promise<void>;
  detect(bookId: string, opts: { split_dialogue?: boolean; chapter_ids?: string[] }): Promise<DetectResult>;
  merge(bookId: string, keepId: string, mergeIds: string[]): Promise<Character>;
  suggestVoices(bookId: string, apply?: boolean): Promise<{ suggestions: VoiceSuggestion[]; applied: number }>;
  /** `characterId` null previews the narrator. */
  preview(bookId: string, characterId: string | null, voiceId?: string | null): Promise<PlayResult>;
  replaceVoice(bookId: string, from: string, to: string): Promise<{ characters: number; narrator: boolean }>;

  listRules(bookId: string | null): Promise<PronunciationRule[]>;
  createRule(bookId: string | null, rule: RuleInput): Promise<{ rule: PronunciationRule; stale: number }>;
  updateRule(bookId: string | null, id: string, rule: Partial<RuleInput>): Promise<{ rule: PronunciationRule; stale: number }>;
  deleteRule(bookId: string | null, id: string): Promise<{ stale: number }>;
  reorderRules(bookId: string | null, ids: string[]): Promise<PronunciationRule[]>;
  importRules(bookId: string | null, file: File): Promise<{ added: number; updated: number; warnings: string[]; stale: number }>;
  exportUrl(bookId: string | null, format: "pls" | "txt"): string;
  suggestTerms(bookId: string): Promise<TermSuggestion[]>;
  playTerm(bookId: string, opts: { rule_id?: string; draft?: RuleInput }): Promise<PlayResult>;

  listTakes(bookId: string, segmentId: string): Promise<TakeRow[]>;
  selectTake(bookId: string, segmentId: string, takeId: string): Promise<TakeRow>;
  deleteTake(bookId: string, segmentId: string, takeId: string): Promise<void>;
  regenerateSelection(bookId: string, segmentId: string, range: { start: number; end: number }): Promise<{ plan: SplicePlan; take: TakeRow }>;

  startRender(bookId: string, req: { scope: RenderScope; overwrite?: boolean; asr_check?: boolean }): Promise<RenderRunView>;
  listRenders(bookId: string): Promise<RenderRunView[]>;
  renderAction(bookId: string, runId: string, action: "pause" | "resume" | "cancel"): Promise<RenderRunView>;
  estimate(bookId: string, chapterId?: string | null, overwrite?: boolean): Promise<Estimate>;

  /** Where a take's audio is served. */
  soundUrl(soundId: string): string;
}

const base = (id: string) => `/api/audiobooks/${encodeURIComponent(id)}`;
const rules = (bookId: string | null) => (bookId ? `${base(bookId)}/pronunciations` : "/api/pronunciations");
const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const enc = encodeURIComponent;

const httpVoiceApi: VoiceApi = {
  listCharacters: (b) => request(`${base(b)}/characters`),
  createCharacter: (b, f) => request(`${base(b)}/characters`, { method: "POST", ...json(f) }),
  updateCharacter: (b, id, f) => request(`${base(b)}/characters/${enc(id)}`, { method: "PATCH", ...json(f) }),
  deleteCharacter: (b, id) => request(`${base(b)}/characters/${enc(id)}`, { method: "DELETE" }),
  detect: (b, o) => request(`${base(b)}/characters/detect`, { method: "POST", ...json(o) }),
  merge: (b, keep, ids) => request(`${base(b)}/characters/merge`, { method: "POST", ...json({ keep_id: keep, merge_ids: ids }) }),
  suggestVoices: (b, apply = false) => request(`${base(b)}/characters/suggest-voices`, { method: "POST", ...json({ apply }) }),
  preview: (b, c, v) => request(`${base(b)}/characters/${enc(c ?? "narrator")}/preview`, { method: "POST", ...json({ voice_id: v ?? null }) }),
  replaceVoice: (b, from, to) => request(`${base(b)}/voices/replace`, { method: "POST", ...json({ from, to }) }),

  listRules: (b) => request(rules(b)),
  createRule: (b, r) => request(rules(b), { method: "POST", ...json(r) }),
  updateRule: (b, id, r) => request(`${rules(b)}/${enc(id)}`, { method: "PATCH", ...json(r) }),
  deleteRule: (b, id) => request(`${rules(b)}/${enc(id)}`, { method: "DELETE" }),
  reorderRules: (b, ids) => request(`${rules(b)}/reorder`, { method: "POST", ...json({ ids }) }),
  importRules: async (b, file) =>
    request(`${rules(b)}/import?filename=${enc(file.name)}`, {
      method: "POST",
      body: await file.text(),
      headers: { "Content-Type": "text/plain" },
    }),
  exportUrl: (b, format) => `${rules(b)}/export.${format}`,
  suggestTerms: (b) => request(`${base(b)}/pronunciations/suggest`, { method: "POST" }),
  playTerm: (b, o) => request(`${base(b)}/pronunciations/play`, { method: "POST", ...json(o) }),

  listTakes: (b, s) => request(`${base(b)}/paragraphs/${enc(s)}/takes`),
  selectTake: (b, s, t) => request(`${base(b)}/paragraphs/${enc(s)}/takes/${enc(t)}/select`, { method: "POST" }),
  deleteTake: (b, s, t) => request(`${base(b)}/paragraphs/${enc(s)}/takes/${enc(t)}`, { method: "DELETE" }),
  regenerateSelection: (b, s, range) => request(`${base(b)}/paragraphs/${enc(s)}/generate`, { method: "POST", ...json({ range }) }),

  startRender: (b, r) => request(`${base(b)}/render`, { method: "POST", ...json(r) }),
  listRenders: (b) => request(`${base(b)}/renders`),
  renderAction: (b, id, a) => request(`${base(b)}/renders/${enc(id)}/${a}`, { method: "POST" }),
  estimate: (b, c, o = false) =>
    request(`${base(b)}/estimate?${c ? `chapter_id=${enc(c)}&` : ""}overwrite=${o ? "true" : "false"}`),

  soundUrl: (id) => `/files/${enc(id)}.wav`,
};

export const voiceApi: VoiceApi = IS_MOCK ? mockVoiceApi : httpVoiceApi;

/** "1 h 04 min", "3 min 20 s", "12 s". */
export function formatDuration(s: number): string {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m) return sec ? `${m} min ${sec} s` : `${m} min`;
  return `${sec} s`;
}
