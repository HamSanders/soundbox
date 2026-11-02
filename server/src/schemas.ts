/**
 * Wire types and their validators.
 *
 * These are the shapes documented in
 * `docs/API.md` and consumed by `app/src/lib/api.ts` — the field names and
 * optionality here are the contract, so keep them in step with both.
 *
 * Zod stands in for Pydantic: the `*Schema` exports validate and coerce request
 * bodies at the route boundary, and the `T` types are what the rest of the
 * server passes around.
 */

import { z } from "zod";

import { DEVICE_KINDS, MAX_DEVICES_PER_TRACK, type DeviceSpec } from "./devices.js";
import type { ModelParam } from "./models/params.js";

export type { ModelParam, ParamGroup, ParamType } from "./models/params.js";

/**
 * Where a model runs, and therefore which affordances make sense for it.
 *
 * The UI branches on this rather than re-deriving it from `hf_repo` being
 * empty or `vram_estimate_mb` being zero: "runs somewhere else" is a fact
 * about the model, not something to infer from two fields that happen to be
 * falsy.
 *
 *   "local"    — weights on this machine, run by audio.cpp.
 *   "endpoint" — a custom endpoint: somebody's server, reached over HTTP.
 */
export type ModelProvider = "local" | "endpoint";

export type ModelStatus =
  | "not_installed"
  | "needs_runtime"
  | "installed"
  | "downloading"
  | "loaded"
  /** Something of the weights is on disk but not enough to run: a download
   *  that stopped, or a package missing a file. Repair downloads the rest. */
  | "incomplete"
  | "error";

/** What `POST /api/models/:id/selftest` reports: one short render through
 *  the normal path, timed, nothing saved. */
export interface ModelSelfTest {
  model: string;
  ok: boolean;
  /** Where it ran, as the health endpoint names it. */
  device: string;
  /** Wall time including any load. */
  elapsed_s: number;
  /** Seconds of audio that came back, or null when it failed. */
  rendered_s: number | null;
  error: string | null;
}

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export type JobPhase =
  | "queued"
  | "installing"
  | "loading"
  | "downloading"
  | "generating"
  | "encoding"
  | "done";

export type Commercial = "yes" | "no" | "conditional";
export type Source = "app" | "api" | "mcp";
export type SoundEditOp =
  | "trim"
  | "normalize"
  | "reverse"
  | "gain"
  | "highpass"
  | "lowpass"
  | "pitch"
  | "stretch";

export interface LicenseInfo {
  name: string;
  commercial: Commercial;
  url: string;
  note?: string | null;
}

export interface ModelSupports {
  negative_prompt: boolean;
  seed: boolean;
  steps: boolean;
  cfg: boolean;
  /** Lyrics-conditioned vocal generation (audio.cpp's --lyrics flag). Only
   *  ACE-Step currently declares this. */
  lyrics: boolean;
  /** Text-to-speech input (a spoken-word script rather than a description of
   *  a sound). Declared by TTS/voice-cloning families. */
  text: boolean;
  /** Needs a reference audio clip to clone a voice from (audio.cpp voice
   *  cloning/voice-conversion families). */
  voice_reference: boolean;
  /** Can continue an existing library sound past its end, conditioned on it
   *  (audio.cpp's ACE-Step `--task-route complete`). See `GenerateRequest.edit`. */
  extend: boolean;
  /** Can re-render an existing sound in a new style while keeping its
   *  structure and melody (ACE-Step `--task-route cover`). */
  cover: boolean;
  /** Can regenerate a time window inside an existing sound (ACE-Step
   *  `--task-route repaint`). Drives the editor's Repaint tool, `/api/repaint`
   *  and the `repaint` edit on generate. */
  repaint: boolean;
}

export const DEFAULT_SUPPORTS: ModelSupports = {
  negative_prompt: false,
  seed: true,
  steps: false,
  cfg: false,
  lyrics: false,
  text: false,
  voice_reference: false,
  extend: false,
  cover: false,
  repaint: false,
};

/** The audio-to-audio edits a `gen` model can run on a library sound. */
export const EDIT_KINDS = ["extend", "cover", "repaint"] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

export const editOptionsSchema = z.object({
  /** `cover` only — how closely to follow the source (audio.cpp's
   *  `audio_cover_strength`). 1 = faithful, 0 = loose. */
  cover_strength: z.number().min(0).max(1).nullish(),
  /**
   * `extend` only — how much of the clip's tail to feed back as context when
   * the target runs past the model's maximum length.
   *
   * Only consulted for a target the model cannot render in one pass. Longer
   * keeps the continuation more coherent; shorter produces more new audio per
   * pass, since the two share one generation's budget. Defaults to half the
   * model's maximum.
   */
  extend_window_s: z.number().min(1).max(300).nullish(),
  /** `repaint` only — the window to regenerate, in source seconds. */
  repaint_start_s: z.number().min(0).nullish(),
  repaint_end_s: z.number().min(0).nullish(),
  repaint_mode: z.enum(["balanced", "conservative", "aggressive"]).nullish(),
  repaint_strength: z.number().min(0).max(1).nullish(),
});
export type EditOptions = z.infer<typeof editOptionsSchema>;

export interface ModelInfo {
  id: string;
  name: string;
  vendor: string;
  description: string;
  license: LicenseInfo;
  hf_repo?: string | null;
  gated: boolean;
  /** audio.cpp's loader family ("vibevoice", "chatterbox"). What a model will
   *  listen to is a property of the family, so this is what selects its
   *  per-model parameter list. */
  family: string;
  /** The knobs this family actually accepts, from audio.cpp's own
   *  `model_params.json` — see models/params.ts. Empty means the words and the
   *  voice are the only controls it has. */
  params: ModelParam[];
  /** Which audio.cpp task drives this model, and therefore which UI it
   *  belongs to:
   *
   *    "gen" — prompt → audio; the Generate composer.
   *    "sep" — existing audio → stems; a sound's "Split into stems" action.
   *    "tts" — script → speech; the Voice studio.
   *    "vc"  — existing audio re-voiced; the Voice studio's convert action.
   *
   *  Only "gen" appears in the Generate composer's model picker. */
  task: "gen" | "sep" | "tts" | "vc";
  /** Built-in voice names this model ships (audio.cpp's `--voice-id`), or
   *  empty when the only way to pick a voice is a reference clip. */
  voice_ids: string[];
  /** True for a cloning/conversion-only family with no default voice at all
   *  (e.g. Chatterbox) — the UI must not offer a "Model default" choice for
   *  one of these, since there is nothing behind it. */
  requires_voice_reference: boolean;
  /** What kind of model this is, for the Generate composer's category tabs.
   *  "sfx"/"music"/"voice" are prompt-driven generation flavours, "utility"
   *  covers non-generative engines like stem separation. */
  category: "sfx" | "music" | "voice" | "utility";
  max_duration_s: number;
  sample_rate: number;
  channels: number;
  supports: ModelSupports;
  defaults: Record<string, number>;
  vram_estimate_mb: number;
  max_cfg?: number | null;
  extras: string[];
  status: ModelStatus;
  /** Where this model runs: weights on this machine driven by audio.cpp, or a
   *  custom endpoint. See `ModelProvider`. */
  provider: ModelProvider;
  installed_deps: boolean;
  auto_installable: boolean;
  manual_install_reason?: string | null;
  install_command?: string | null;
  error?: string | null;
  /** Set alongside `error` when the adapter could not report its status. */
  failure?: Failure | null;
  active_job_id?: string | null;
  avg_duration_s?: number | null;
}

/**
 * A saved voice: a name plus the thing that makes a model speak in it.
 *
 * Two kinds, distinguished by `kind`, because they are not interchangeable at
 * generation time — one becomes `--voice-ref`, the other `--voice-id`:
 *
 *   "clone"   — a reference clip on disk the user supplied. Portable across
 *               any family that declares supports.voice_reference.
 *   "builtin" — a name from one family's own voice list (spec.voice_ids), so
 *               it only means anything to that model. `model_id` records which.
 *
 * Saved rather than re-picked per generation because a voice is the unit
 * people reuse: a character keeps their voice across a whole script.
 */
export interface Voice {
  id: string;
  name: string;
  kind: "clone" | "builtin";
  created_at: string;
  /** `clone`: served path to the reference clip. Null for `builtin`. */
  reference_file?: string | null;
  /** `builtin`: audio.cpp's --voice-id value. Null for `clone`. */
  voice_id?: string | null;
  /** The model this voice speaks through. For a `builtin` it is the family
   *  whose voice list the name came from, since the name is meaningless to
   *  any other. For a `clone` it is the family the clip was saved against:
   *  the clip itself would work anywhere, but a voice is what the UI picks,
   *  and the model falls out of it rather than being chosen alongside it.
   *  Null only for clones saved before voices carried a model. */
  model_id?: string | null;
  /** Free-text note — accent, age, character, wherever the clip came from.
   *  Also the description a generated avatar is drawn from. */
  notes?: string | null;
  /** Served URL of a generated avatar (`/artwork/<file>.png`), or null. */
  artwork?: string | null;
  /** How many library sounds were read in this voice — single-voice reads and
   *  conversions, the same set `GET /api/sounds?voice_id=` returns. */
  read_count?: number;
  /** `clone`: the clips this voice is made from, oldest first. With one,
   *  `reference_file` is that clip; with several, it is all of them joined.
   *  Always empty for `builtin`. */
  samples?: VoiceSample[];
}

/** One clip a clone voice was made from. */
export interface VoiceSample {
  id: string;
  /** Served path, `/files/<name>`. */
  file: string;
  /** Null for the clip of a voice saved before voices held several. */
  duration_s: number | null;
  created_at: string;
}

export interface AudioCppCatalogEntry {
  id: string;
  name: string;
  vendor: string;
  description: string;
  license: LicenseInfo;
  verified: boolean;
  always_on: boolean;
  enabled: boolean;
  /** True when this model's weights are already on this machine. Weights are
   *  shared by every profile while the enable list is per-profile, so presence
   *  on disk enables the model everywhere — the toggle has nothing left to do
   *  and the row says so instead. */
  on_disk: boolean;
  /** What kind of model this is, for the Models page's search/filter. */
  category: "sfx" | "music" | "voice" | "utility";
  /** "custom" means it came from the user's own `models/custom.json` rather
   *  than the shipped catalog — always on, never verified by us. */
  source: "builtin" | "custom";
}

export interface HealthStatus {
  status: "ok";
  version: string;
  device: string;
  gpu_name?: string | null;
  vram_total_mb?: number | null;
  vram_free_mb?: number | null;
  loaded_model?: string | null;
  queue_length: number;
}

export interface Origin {
  source: Source;
  client_name?: string | null;
  client_version?: string | null;
  mcp_session_id?: string | null;
}

/** "Claude Code 1.2" for display, or null when the client didn't identify itself. */
export function originLabel(origin: Origin | null | undefined): string | null {
  if (!origin?.client_name) return null;
  return `${origin.client_name} ${origin.client_version ?? ""}`.trim();
}

/** A stable name for a class of failure. See `failure.ts` for the rules. */
export type FailureTopic =
  | "gpu_oom"
  | "host_memory"
  | "paging_file"
  | "backend_mismatch"
  | "runtime_missing"
  | "disk_full"
  | "hf_gated"
  | "hf_unreachable"
  | "download_stalled"
  | "download_truncated"
  | "model_not_installed"
  | "model_file_corrupt"
  | "timeout"
  | "no_audio"
  | "queue_full";

/** One way out of a failure: a label that states its effect and an app route. */
export interface FailureFix {
  label: string;
  to: string;
}

/**
 * What went wrong, in the user's terms, with the raw text kept whole.
 * Built by `buildFailure()` in `failure.ts` and rendered by the app's
 * `FailureCard`. `error` on the same record stays the plain message for
 * callers that only want a string.
 */
export interface Failure {
  topic: FailureTopic | null;
  /** What happened, one line. */
  title: string;
  /** Why, what to do, and what is kept. Null when unclassified. */
  hint: string | null;
  /** Up to two. */
  fixes: FailureFix[];
  /** A retry with nothing changed would fail the same way. */
  terminal: boolean;
  /** The job phase or step it failed in, when known. */
  stage: string | null;
  /** Exactly what the runtime or server said. */
  detail: string;
}

export interface Job {
  id: string;
  kind: "generate" | "download" | "separate" | "speak" | "convert" | "segment" | "export" | "selftest";
  status: JobStatus;
  phase: JobPhase;
  progress: number;
  message: string;
  error?: string | null;
  /** Set alongside `error` when the job failed. */
  failure?: Failure | null;
  request: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  queue_position?: number | null;
  eta_s?: number | null;
}

export interface Sound {
  id: string;
  created_at: string;
  model: string;
  prompt: string;
  negative_prompt?: string | null;
  lyrics?: string | null;
  track_name?: string | null;
  /** Which audio-to-audio edit produced this sound from `parent_id`, or
   *  null for a plain prompt→audio render. */
  edit?: EditKind | null;
  edit_options?: EditOptions | null;
  duration_s: number;
  seed?: number | null;
  steps?: number | null;
  cfg?: number | null;
  sample_rate: number;
  channels: number;
  file: string;
  peaks: number[];
  favorite: boolean;
  tags: string[];
  name: string;
  size_bytes: number;
  session_id?: string | null;
  project_id?: string | null;
  effective_project_id?: string | null;
  source: Source;
  client?: string | null;
  parent_id?: string | null;
  /** Served URL of generated cover art (`/artwork/<file>.png`), or null when
   *  none has been made. Only music sounds get one in the app, but nothing
   *  here restricts it — the restriction is a product decision, not a shape. */
  artwork?: string | null;
  /** The saved Voice that read this sound, when there was exactly one — a
   *  single-voice speak or a voice conversion. Null for multi-voice dialogues
   *  (no one avatar is honest) and for everything that isn't speech. Lets a
   *  list show the voice's avatar where a music track would show its cover. */
  voice_id?: string | null;
}

export interface McpCall {
  id: string;
  ts: string;
  tool: string;
  status: "running" | "ok" | "error";
  client_name?: string | null;
  client_version?: string | null;
  session_id?: string | null;
  transport: "http" | "stdio";
  args: Record<string, unknown>;
  duration_ms?: number | null;
  error?: string | null;
  job_id?: string | null;
  sound_ids: string[];
  trace_id?: string | null;
}

export interface McpClient {
  name: string;
  version?: string | null;
  calls: number;
  errors: number;
  sounds: number;
  sessions: number;
  first_seen: string;
  last_seen: string;
  active: boolean;
}

export interface McpToolInfo {
  name: string;
  title?: string | null;
  description: string;
  calls: number;
}

export interface OtelStatus {
  enabled: boolean;
  installed: boolean;
  endpoint?: string | null;
  source: "env" | "settings" | "none";
  service_name: string;
  error?: string | null;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  files: string[];
  installed_at: Record<string, string>;
}

export interface SkillTarget {
  id: string;
  label: string;
  path: string;
  exists: boolean;
}

export interface McpStatus {
  endpoint: string;
  stdio_command: string;
  server_name: string;
  server_version: string;
  tools: McpToolInfo[];
  clients: McpClient[];
  calls_total: number;
  errors_total: number;
  sounds_total: number;
  calls_24h: number;
  last_call_at?: string | null;
  active_sessions: number;
  otel: OtelStatus;
  skills: SkillInfo[];
  skill_targets: SkillTarget[];
}

export interface SkillInstallResult {
  target: string;
  dest: string;
  installed: string[];
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  sound_count: number;
  project_id?: string | null;
}

export interface Project {
  id: string;
  name: string;
  created_at: string;
  sound_count: number;
}

export interface SoundPage {
  items: Sound[];
  total: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

/* --------------------------------------------------------------- validators */

const originSchema = z.object({
  source: z.enum(["app", "api", "mcp"]).default("api"),
  client_name: z.string().nullish(),
  client_version: z.string().nullish(),
  mcp_session_id: z.string().nullish(),
});

/**
 * Tag hygiene, applied once here so the library never accumulates
 * near-duplicates ("Door", "door ", "door") that fragment filtering.
 * Order is preserved rather than sorted — the caller's first mention wins.
 */
function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * Which stems to keep out of a split, and what happens to the rest.
 *
 * Optional everywhere it appears: omitted means the whole set, which is what
 * every caller sent before choosing existed. See `stems.ts` for the matching
 * rules and for why "merge" is a different edit from "discard" rather than a
 * tidier spelling of it.
 */
export const stemSelectionSchema = z.object({
  keep: z.array(z.string().min(1).max(40)).max(16).default([]),
  rest: z.enum(["discard", "merge"]).default("discard"),
});

export type StemSelectionRequest = z.infer<typeof stemSelectionSchema>;

export const generateRequestSchema = z.object({
  model: z.string(),
  prompt: z.string().min(1).max(2000),
  negative_prompt: z.string().nullish(),
  duration_s: z.number().gt(0).max(300).default(5.0),
  seed: z.number().int().min(0).max(2 ** 31 - 1).nullish(),
  steps: z.number().int().min(1).max(500).nullish(),
  cfg: z.number().min(0).max(30).nullish(),
  /** Lyrics for a lyrics-conditioned vocal model (ACE-Step). Ignored by
   *  models that don't declare supports.lyrics. */
  lyrics: z.string().max(4000).nullish(),
  track_name: z.string().max(200).nullish(),
  /** An existing library sound to edit rather than render from scratch.
   *  Requires `edit`; the model must declare `supports.<edit>`. The result is
   *  stored as a new sound with `parent_id` pointing back here. */
  source_sound_id: z.string().nullish(),
  /** Which audio-to-audio route to run on `source_sound_id`:
   *    "extend"  — continue the source to `duration_s` total seconds
   *    "cover"   — re-render it in the style of `prompt` (length locked to source)
   *    "repaint" — regenerate `edit_options.repaint_start_s..repaint_end_s` */
  edit: z.enum(EDIT_KINDS).nullish(),
  edit_options: editOptionsSchema.nullish(),
  variations: z.number().int().min(1).max(4).default(1),
  tags: z.array(z.string()).default([]).transform(normalizeTags),
  session_id: z.string().nullish(),
  project_id: z.string().nullish(),
  origin: originSchema.nullish(),
  /**
   * Split what this renders, before the job reports done.
   *
   * For "give me the drums from a beat like this": the render is a means to
   * the stems, so the two steps are one request rather than a generation the
   * caller has to notice finishing and then split by hand. The job's `sounds`
   * are the stems that were asked for; the mix they came from stays in the
   * library as their parent, under `sources`.
   */
  separate: stemSelectionSchema
    .extend({ model: z.string().nullish() })
    .nullish(),
}).superRefine((req, ctx) => {
  if (req.edit && !req.source_sound_id) {
    ctx.addIssue({ code: "custom", path: ["source_sound_id"], message: `edit "${req.edit}" needs source_sound_id.` });
  }
  if (req.source_sound_id && !req.edit) {
    ctx.addIssue({ code: "custom", path: ["edit"], message: "source_sound_id needs an edit kind." });
  }
  if (req.edit === "repaint") {
    const o = req.edit_options;
    if (o?.repaint_start_s == null || o?.repaint_end_s == null || o.repaint_end_s <= o.repaint_start_s) {
      ctx.addIssue({ code: "custom", path: ["edit_options"], message: "repaint needs repaint_start_s < repaint_end_s." });
    }
  }
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

/**
 * Per-request knobs for one model family, by that family's own option names.
 *
 * Values are strings because that is what `--request-option key=value` takes;
 * typing them per family would mean re-declaring audio.cpp's parameter table in
 * Zod, and the table already exists (models/params.ts). Unknown keys are
 * accepted rather than rejected: the binary ignores what it doesn't know, and
 * a model added upstream shouldn't need a schema change here to be driveable.
 */
export const requestOptionsSchema = z.record(z.string().max(60), z.string().max(2000));

/** Split an existing library Sound into stems (vocals/drums/bass/other, or
 *  whatever the loader family produces) via audio.cpp's `--task sep`. No
 *  prompt/duration/seed — those only mean something for `--task gen`. */
export const separateRequestSchema = z.object({
  model: z.string(),
  source_sound_id: z.string(),
  /** Keep only some of what comes out. Omit for all of it. */
  stems: stemSelectionSchema.nullish(),
});

export type SeparateRequest = z.infer<typeof separateRequestSchema>;

/**
 * Repaint a window of an existing library sound.
 *
 * The same route as `generate` with `edit: "repaint"`, offered as its own
 * request because the caller that wants it — the waveform editor, with a
 * range highlighted — knows the window and nothing else. Everything the model
 * needs besides the window (which model, how long the result is, the words
 * that were being sung) is inherited from the source rather than asked for
 * again, since a repaint that changed the track's length or lyrics would not
 * be a repaint.
 */
export const repaintRequestSchema = z.object({
  source_sound_id: z.string(),
  /** The window to regenerate, in source seconds. */
  start_s: z.number().min(0),
  end_s: z.number().min(0),
  /** What should be there instead. Omit to keep the source's own prompt —
   *  "the same thing, another way", which is what a reroll of a bad bar is. */
  prompt: z.string().max(2000).nullish(),
  /** Overrides the source's lyrics for the whole render. Omit to keep them. */
  lyrics: z.string().max(4000).nullish(),
  /** A specific repaint-capable model. Omit to let the server pick: the
   *  source's own model if it can, otherwise a ready one that can. */
  model: z.string().nullish(),
  /** How far the new material may drift from what was there. */
  strength: z.number().min(0).max(1).nullish(),
  mode: z.enum(["balanced", "conservative", "aggressive"]).nullish(),
  seed: z.number().int().min(0).max(2 ** 31 - 1).nullish(),
  variations: z.number().int().min(1).max(4).default(1),
  session_id: z.string().nullish(),
  project_id: z.string().nullish(),
  origin: originSchema.nullish(),
}).superRefine((req, ctx) => {
  if (req.end_s <= req.start_s) {
    ctx.addIssue({ code: "custom", path: ["end_s"], message: "end_s must be greater than start_s." });
  }
});

export type RepaintRequest = z.infer<typeof repaintRequestSchema>;

/**
 * One speaker's turn in a script.
 *
 * A single-voice read is just a one-line script, so there is no separate
 * single-speaker request shape — the studio sends one line, a dialogue sends
 * several. `voice_id` refers to a saved Voice, not to audio.cpp's --voice-id;
 * resolving which of those it becomes is the service's job.
 */
export const scriptLineSchema = z.object({
  /** Saved Voice id, or null for the model's default voice. */
  voice_id: z.string().nullish(),
  text: z.string().min(1).max(20000),
  /** Display name for the speaker in the UI ("Narrator", "Ada"). Carried so a
   *  dialogue reads back the way it was written; not sent to the model. */
  speaker: z.string().max(80).nullish(),
  /** The TTS model this line is read on, when it differs from the request's
   *  — a dialogue between voices made on different families. Null or absent
   *  reads it on the request's `model`. */
  model: z.string().nullish(),
});

export type ScriptLine = z.infer<typeof scriptLineSchema>;

/**
 * Speak a script through a `--task tts` model.
 *
 * Multi-speaker dialogue is `lines.length > 1` with differing voice_ids: each
 * line is synthesised on its own and the results are concatenated, which is
 * what lets one dialogue mix voices from different families. `gap_s` is the
 * silence inserted between turns.
 */
export const speakRequestSchema = z.object({
  model: z.string(),
  lines: z.array(scriptLineSchema).min(1).max(200),
  seed: z.number().int().min(0).max(2 ** 31 - 1).nullish(),
  steps: z.number().int().min(1).max(500).nullish(),
  cfg: z.number().min(0).max(30).nullish(),
  /** Silence between consecutive lines, in seconds. */
  gap_s: z.number().min(0).max(5).default(0.4),
  /** `--load-option key=value` pairs, e.g. PocketTTS' `language`. */
  load_options: z.record(z.string(), z.string()).default({}),
  /** `--request-option key=value` pairs from the model family's own parameter
   *  list — how the read is shaped. See models/params.ts. */
  request_options: requestOptionsSchema.default({}),
  name: z.string().max(200).nullish(),
  tags: z.array(z.string()).default([]).transform(normalizeTags),
  session_id: z.string().nullish(),
  project_id: z.string().nullish(),
  origin: originSchema.nullish(),
});

export type SpeakRequest = z.infer<typeof speakRequestSchema>;

/** Re-voice an existing library sound through a `--task vc` model. */
export const convertRequestSchema = z.object({
  model: z.string(),
  source_sound_id: z.string(),
  /** Saved Voice to convert *to*. Must be a "clone" voice: voice conversion
   *  needs reference audio, and a builtin name gives the model nothing to
   *  match against. */
  voice_id: z.string(),
  seed: z.number().int().min(0).max(2 ** 31 - 1).nullish(),
  session_id: z.string().nullish(),
  project_id: z.string().nullish(),
  origin: originSchema.nullish(),
});

export type ConvertRequest = z.infer<typeof convertRequestSchema>;

export const voiceCreateSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["clone", "builtin"]).default("clone"),
  /** builtin only: audio.cpp's --voice-id value. */
  voice_id: z.string().max(120).nullish(),
  /** The model this voice speaks through — required in the UI for both kinds,
   *  nullish here so a clone saved before the tie still validates. */
  model_id: z.string().nullish(),
  notes: z.string().max(2000).nullish(),
  /** clone only: id of a library sound to use as the reference clip, as an
   *  alternative to uploading one. Lets a generated read become a voice. */
  source_sound_id: z.string().nullish(),
  /** clone only: clean the clip up before saving — DC offset out, silence cut
   *  off both ends, an over-full-scale peak pulled back. Never boosts or
   *  re-tones it. Off by default so an API caller gets their bytes verbatim. */
  tidy: z.boolean().default(false),
});

export type VoiceCreate = z.input<typeof voiceCreateSchema>;

/** Add a clip to an existing clone voice from a library sound. (An upload
 *  from disk is a raw WAV body on the same route instead.) */
export const voiceSampleCreateSchema = z.object({
  source_sound_id: z.string(),
  tidy: z.boolean().default(false),
});

/**
 * A voice as a file you can carry to another machine: `.soundbox-voice.json`.
 *
 * JSON with the clips inlined as base64 WAV rather than a zip, because the
 * server has no zip dependency and a voice is at most a few megabytes of
 * clips. The joined reference is not carried — it is rebuilt from the clips
 * on import — and nor is the avatar, which is redrawn from the notes.
 */
export const voiceExportSchema = z.object({
  format: z.literal("soundbox-voice"),
  version: z.literal(1),
  exported_at: z.string().nullish(),
  voice: z.object({
    name: z.string().min(1).max(120),
    kind: z.enum(["clone", "builtin"]),
    voice_id: z.string().max(120).nullish(),
    model_id: z.string().nullish(),
    notes: z.string().max(2000).nullish(),
  }),
  samples: z
    .array(z.object({ wav_base64: z.string().min(1), duration_s: z.number().nullish() }))
    .max(5)
    .default([]),
});

export type VoiceExport = z.infer<typeof voiceExportSchema>;

export const voicePatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  notes: z.string().max(2000).nullish(),
});

export type VoicePatch = z.infer<typeof voicePatchSchema>;

export const soundPatchSchema = z.object({
  name: z.string().nullish(),
  favorite: z.boolean().nullish(),
  tags: z.array(z.string()).nullish(),
  project_id: z.string().nullish(),
});

export type SoundPatch = z.infer<typeof soundPatchSchema>;

export const sessionPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  project_id: z.string().nullish(),
});

export type SessionPatch = z.infer<typeof sessionPatchSchema>;

export const projectPatchSchema = z.object({ name: z.string().min(1).max(200) });

/* ---------------------------------------------------------------- profiles */

/** Create and rename take the same body: a display name. The id is derived
 *  from it once, at creation, and never changes — see `profiles.ts`. */
export const profileNameSchema = z.object({ name: z.string().min(1).max(60) });

/* ----------------------------------------------------------------- stories */

/**
 * Which of the two builders a story belongs to.
 *
 * "script" is the Script Builder — words first, a cast, a script beside the
 * timeline. "music" is the Music Builder — a prompt, takes, and clips you
 * arrange. Chosen when the story is created rather than guessed afterwards
 * (see `Story.studio` for the guess, which is still what the shelf's filters
 * read), because the choice decides which tool opens and an empty story has
 * nothing to guess from.
 */
export const storyBuilderSchema = z.enum(["script", "music"]);
export type StoryBuilder = z.infer<typeof storyBuilderSchema>;

export const storyPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  project_id: z.string().nullish(),
  /** The story's default delivery, applied to every line without its own. */
  request_options: requestOptionsSchema.optional(),
  /** Only meaningful on create; a story does not change tools afterwards. */
  builder: storyBuilderSchema.optional(),
});

export type StoryPatch = z.infer<typeof storyPatchSchema>;

/**
 * A new line in a story.
 *
 * Everything is optional because the useful gesture is "give me an empty line
 * to type into" — a segment with no text, no voice and no audio is a valid
 * state that exists for as long as it takes to write it. `position` omitted
 * means append.
 */
export const segmentCreateSchema = z.object({
  speaker: z.string().max(80).nullish(),
  voice_id: z.string().nullish(),
  text: z.string().max(20000).default(""),
  language: z.string().max(20).nullish(),
  track_index: z.number().int().min(-16).max(16).default(0),
  position: z.number().int().min(0).nullish(),
  start_s: z.number().min(0).nullish(),
  /** Drop an existing library sound straight onto the timeline instead of
   *  writing a line to be spoken. Not everything in a story is speech — a
   *  score bed, a door slam, a take recorded elsewhere — and re-generating
   *  something you already have would be absurd. */
  sound_id: z.string().nullish(),
  /** "pause" is a beat of silence rather than something spoken; its length is
   *  `duration_s` and it has no text, voice or audio. */
  kind: z.enum(["line", "pause"]).default("line"),
  /** A pause's length, or — with `sound_id` — how much of the sound plays.
   *  Omitted with a sound, the clip plays all of it. */
  duration_s: z.number().min(0).max(600).nullish(),
  /** How this line should be read. Omit to follow the story's default. */
  request_options: requestOptionsSchema.optional(),
  /** Clip state, the same fields a patch takes, so putting a clip back (an
   *  undone delete, a duplicate) is one call rather than a create and a fix. */
  trim_start_s: z.number().min(0).optional(),
  fade_in_s: z.number().min(0).max(60).optional(),
  fade_out_s: z.number().min(0).max(60).optional(),
  gain_db: z.number().min(-40).max(24).optional(),
  muted: z.boolean().optional(),
});

export type SegmentCreate = z.infer<typeof segmentCreateSchema>;

/** Every field a segment can be edited into, script side and timeline side
 *  alike — the card list patches text/voice, the timeline patches
 *  start_s/track_index/gain, and both go through the same endpoint. */
export const segmentPatchSchema = z.object({
  speaker: z.string().max(80).nullish(),
  voice_id: z.string().nullish(),
  text: z.string().max(20000).optional(),
  language: z.string().max(20).nullish(),
  track_index: z.number().int().min(-16).max(16).optional(),
  start_s: z.number().min(0).optional(),
  /** Point the clip at different audio, keeping where it sits and how it is
   *  trimmed. This is what a repaint lands as: the same clip in the same
   *  place, playing the take that came back. */
  sound_id: z.string().nullish(),
  muted: z.boolean().optional(),
  gain_db: z.number().min(-40).max(24).optional(),
  /** For a pause, its length. For a clip, how much of its source audio plays
   *  — shortening a clip is a smaller duration, not a new sound. */
  duration_s: z.number().min(0).max(600).optional(),
  /** How far into the source sound the clip starts. */
  trim_start_s: z.number().min(0).optional(),
  /** Seconds of fade at each end. Capped well below any clip's length; the
   *  mixdown clamps to what the clip actually has. */
  fade_in_s: z.number().min(0).max(60).optional(),
  fade_out_s: z.number().min(0).max(60).optional(),
  /** How this line should be read. An empty object clears the override and
   *  puts the line back on the story's default. */
  request_options: requestOptionsSchema.optional(),
});

export type SegmentPatch = z.infer<typeof segmentPatchSchema>;

/** Reorder sends the whole new order rather than a move-this-there delta: the
 *  card list and the timeline can both reorder, and a delta applied against a
 *  list the client no longer agrees with silently scrambles the script. */
export const segmentReorderSchema = z.object({
  segment_ids: z.array(z.string()).min(1).max(500),
});

/** Speak one segment. The model and tuning live on the request rather than on
 *  the segment because they are a property of *this* take, not of the line —
 *  regenerating a line through a different model is the normal way to use
 *  this, and stamping the old choice onto the row would fight that. */
export const segmentGenerateSchema = z.object({
  model: z.string(),
  seed: z.number().int().min(0).max(2 ** 31 - 1).nullish(),
  steps: z.number().int().min(1).max(500).nullish(),
  cfg: z.number().min(0).max(30).nullish(),
  load_options: z.record(z.string(), z.string()).default({}),
  /**
   * Delivery knobs for this take, overriding both the line's stored options and
   * the story's defaults.
   *
   * Present so a caller can audition a setting without committing it to the
   * script. Omit it and the read uses what the line and story already say,
   * which is what makes re-reading a story reproduce the delivery you set.
   */
  request_options: requestOptionsSchema.optional(),
});

export type SegmentGenerate = z.infer<typeof segmentGenerateSchema>;

/** Open a library sound in the studio, optionally splitting it into stems
 *  first so each part lands on its own track. */
/**
 * A lane and the controls that belong to it.
 *
 * Separate from the clips on it because they answer different questions: a
 * clip's `muted` is "leave this line out", a track's is "I am not listening to
 * this part right now". Collapsing them would mean unmuting a track forgot
 * which of its clips you had silenced.
 */
export interface StoryTrack {
  story_id: string;
  track_index: number;
  /** Null until named; the UI falls back to the lane number. */
  name: string | null;
  muted: boolean;
  /** With any track soloed, only soloed tracks are heard. */
  soloed: boolean;
  gain_db: number;
  /** The track's insert chain, in order. Heard in the studio's timeline
   *  playback; the export mixdown is still dry. See ./devices.ts. */
  devices: DeviceSpec[];
}

/** One device as a client may send it. Loose on purpose — ids and knobs may
 *  be left out — because `normalizeChain` fills and clamps every chain before
 *  it is stored; rejecting a 1.2 mix outright would be stricter than the
 *  rack's own dials, which land at the end. */
export const deviceInputSchema = z.object({
  id: z.string().max(64).optional(),
  kind: z.enum(DEVICE_KINDS),
  bypassed: z.boolean().optional(),
  params: z.record(z.string(), z.number()).optional(),
});

export const trackPatchSchema = z.object({
  name: z.string().max(80).nullish(),
  muted: z.boolean().optional(),
  soloed: z.boolean().optional(),
  gain_db: z.number().min(-40).max(24).optional(),
  /** Replaces the whole chain; [] empties it. */
  devices: z.array(deviceInputSchema).max(MAX_DEVICES_PER_TRACK).optional(),
});

export type TrackPatch = z.infer<typeof trackPatchSchema>;

export const storyFromSoundSchema = z.object({
  sound_id: z.string(),
  separate: z.boolean().default(false),
  /** A "sep"-task model. Omit to use a ready one. */
  model: z.string().nullish(),
  /** Which stems get a lane. Omit for all of them. */
  stems: stemSelectionSchema.nullish(),
});

export const segmentSplitSchema = z.object({
  /** Where to cut, in seconds from the clip's left edge as it plays on the
   *  timeline — `trim_start_s` into its source, not the source's start. */
  at_s: z.number().gt(0),
});

/**
 * One clip on a story's timeline, reduced to the three numbers it takes to
 * draw the arrangement small.
 *
 * The shelf renders a thumbnail of every story's timeline, and it asks for up
 * to 200 stories at once — so this is deliberately not a StorySegment. No
 * text, no voice, no peaks: a lane, a start and a length is the whole picture
 * at thumbnail size, and anything else would be bytes spent on pixels nobody
 * can resolve. The keys are one letter for the same reason.
 */
export interface TimelineClip {
  /** Lane the clip sits in. */
  t: number;
  /** Start, in seconds from the top of the story. */
  s: number;
  /** Length, in seconds — as the timeline would draw it, which for a line
   *  that has been written but not yet spoken is an estimate from its word
   *  count rather than zero. */
  d: number;
}

/**
 * A story: an ordered, multi-track script that persists and gets arranged.
 *
 * Where a Session is a flat run of independent generations ("what did I make
 * in this thread"), a story is a document — its lines carry a place in the
 * script *and* a place in time, are regenerated individually without losing
 * either, and outlive any single job.
 */
export interface Story {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  project_id?: string | null;
  /** The story's default delivery — the model-family knobs every line is read
   *  with unless it carries its own. */
  request_options: Record<string, string>;
  segment_count: number;
  /** Which studio this story belongs to, guessed from what it actually
   *  contains: a spoken line (voice_id or text) makes it "voice"; otherwise
   *  the category of the models behind its clips decides "music" or "sfx".
   *  Null for an empty story, or one whose clips don't say either way. Not
   *  stored — a story is free-form audio arranging, not a form with a type
   *  field — so this is recomputed from its segments on every read. */
  studio?: "voice" | "music" | "sfx" | null;
  /** Which builder opens this story — the Script Builder or the Music
   *  Builder. Unlike `studio` this *is* stored: it is the choice made at the
   *  "new sound" door, and an empty story has no clips to guess from. Stories
   *  written before the split have no stored value, so they fall back to
   *  whatever `studio` guesses. */
  builder: StoryBuilder;
  /** Every clip's placement, for drawing the arrangement as a thumbnail.
   *  Only the list route fills this in — a story you have actually opened has
   *  the real timeline, and an agent reading over MCP has no use for a
   *  picture. Capped, so a very long story previews its opening. */
  timeline?: TimelineClip[];
}

/**
 * One line of a story, and one clip on its timeline.
 *
 * `position` (reading order in the card list) and `start_s`/`track_index`
 * (placement on the timeline) are deliberately independent: dragging a clip
 * later in time re-numbers `position` to match, since the order things happen
 * in is the order they are read in. `sound_id` is null until the line has been
 * spoken, which is the normal state for anything just typed.
 */
export interface StorySegment {
  id: string;
  story_id: string;
  position: number;
  track_index: number;
  speaker?: string | null;
  voice_id?: string | null;
  text: string;
  language?: string | null;
  sound_id?: string | null;
  kind: "line" | "pause";
  /** Offset into the source sound. With `duration_s` this trims the clip
   *  without touching the audio, so it can be lengthened again. */
  trim_start_s: number;
  /** Hydrated by the segment list so the timeline has every clip's peaks in
   *  one round trip instead of one request per visible clip. */
  sound?: Sound | null;
  start_s: number;
  duration_s?: number | null;
  /** Seconds of fade at each end of the clip. */
  fade_in_s: number;
  fade_out_s: number;
  /** This line's own delivery knobs, empty when it follows the story's. */
  request_options: Record<string, string>;
  muted: boolean;
  gain_db: number;
  created_at: string;
  updated_at: string;
}

export const soundEditRequestSchema = z.object({
  op: z.enum([
    "trim",
    "normalize",
    "reverse",
    "gain",
    "highpass",
    "lowpass",
    "pitch",
    "stretch",
  ]),
  start_s: z.number().min(0).nullish(),
  end_s: z.number().gt(0).nullish(),
  target_lufs: z.number().min(-40).max(0).nullish(),
  gain_db: z.number().min(-40).max(24).nullish(),
  cutoff_hz: z.number().gt(0).max(20000).nullish(),
  semitones: z.number().min(-24).max(24).nullish(),
  rate: z.number().gt(0.25).max(4.0).nullish(),
});

export type SoundEditRequest = z.infer<typeof soundEditRequestSchema>;

export const settingsPatchSchema = z.object({
  output_format: z.enum(["wav", "mp3"]).nullish(),
  normalize_lufs: z.number().nullish(),
  trim_silence: z.boolean().nullish(),
  auto_unload_minutes: z.number().int().min(0).max(600).nullish(),
  hf_token: z.string().nullish(),
  device: z.enum(["auto", "cuda", "mps", "cpu"]).nullish(),
  otel_endpoint: z.string().nullish(),
  enabled_audiocpp_models: z.array(z.string()).nullish(),
  audiocpp_mode: z.enum(["managed", "external"]).nullish(),
  // Empty string restores the managed default, matching audio.cpp's own
  // `POST /v1/ui/models-root` convention. `updateSettings` drops nulls, so an
  // explicit null could not clear it.
  audiocpp_models_dir: z.string().nullish(),
  // Same "" convention: where generated audio is written, independent of where
  // weights live. See `Paths.sounds`.
  sounds_dir: z.string().nullish(),
  llm_mode: z.enum(["off", "managed", "external"]).nullish(),
  llm_model: z.string().nullish(),
  llm_external_base_url: z.string().nullish(),
  llm_external_model: z.string().nullish(),
  llm_external_api_key: z.string().nullish(),
  image_mode: z.enum(["off", "managed", "external"]).nullish(),
  image_model: z.string().nullish(),
  image_external_kind: z.enum(["openai", "a1111"]).nullish(),
  image_external_base_url: z.string().nullish(),
  image_external_model: z.string().nullish(),
  image_external_api_key: z.string().nullish(),
  image_auto_artwork: z.boolean().nullish(),
  // ISO timestamp when first-run setup was finished or skipped. "" clears it,
  // the `sounds_dir` convention — see `Config.updateSettings`.
  onboarded_at: z.string().nullish(),
});

/**
 * PUT /api/endpoints/:id — create or replace one custom audio endpoint.
 *
 * `api_key` follows the `hf_token` convention: omitted (or null) keeps the
 * stored key, so the form never needs to hold it; "" clears it.
 */
export const audioEndpointInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  task: z.enum(["sfx", "music", "speech"]),
  url: z
    .string()
    .trim()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "The URL must start with http:// or https://."),
  api_key: z.string().nullish(),
  headers: z.record(z.string(), z.string()).default({}),
  body_template: z.string().min(2).max(20_000),
  response_path: z.string().trim().max(200).default(""),
  pcm_sample_rate: z.number().int().min(8000).max(192_000).default(24_000),
  max_duration_s: z.number().gt(0).max(600).default(30),
  voices: z.array(z.string().trim().min(1).max(100)).max(200).default([]),
  enabled: z.boolean().default(true),
});
export type AudioEndpointInput = z.infer<typeof audioEndpointInputSchema>;

/** Endpoint ids become model ids (`endpoint:<id>`) and URL segments. */
export const ENDPOINT_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** POST /api/endpoints/test — try a configuration before (or after) saving
 *  it. `id` names a saved endpoint whose key to use when none is given. */
export const audioEndpointTestSchema = audioEndpointInputSchema.extend({
  id: z.string().nullish(),
  prompt: z.string().max(2000).nullish(),
});

/** POST /api/enhance. `n` caps at 5 — a rewrite-prompt list past that stops
 *  being scannable and just costs more tokens. */
export const enhanceRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  n: z.number().int().min(1).max(5).default(1),
  category: z.enum(["sfx", "music"]).nullish(),
  lyrics: z.boolean().nullish(),
  /** The model this will actually generate with. Optional — omit it and the
   *  rewrite falls back to generic guidance instead of the model's own
   *  documented prompting conventions. */
  model: z.string().nullish(),
});

/** POST /api/enhance/lyrics — writing the actual song, not the one-line
 *  caption. See `llm/enhance.ts`'s `buildLyricsMessages`. */
export const enhanceLyricsRequestSchema = z.object({
  theme: z.string().min(1).max(2000),
  /** The current caption/style prompt, for tag consistency. */
  style: z.string().max(2000).nullish(),
});
/** POST /api/conversations */
export const conversationCreateSchema = z.object({
  title: z.string().min(1).max(200).nullish(),
  story_id: z.string().nullish(),
});

export const conversationPatchSchema = z.object({
  title: z.string().min(1).max(200),
});

/** POST /api/conversations/:id/entries — see `history.ts` for why one entry
 *  carries words, effects and results together. */
export const conversationAppendSchema = z.object({
  entries: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000).optional(),
        actions: z.array(z.string().max(400)).max(100).optional(),
        sound_ids: z.array(z.string()).max(50).optional(),
        job_id: z.string().nullish(),
      }),
    )
    .min(1)
    .max(50),
});

export type EnhanceRequest = z.infer<typeof enhanceRequestSchema>;

/** The timeline snapshot both assistant chat and opener chips take. */
export const assistantStudioSchema = z.object({
  tracks: z
    .array(
      z.object({
        track_index: z.number().int(),
        name: z.string().nullable().default(null),
        muted: z.boolean().default(false),
        soloed: z.boolean().default(false),
      }),
    )
    .max(200)
    .default([]),
  clips: z
    .array(
      z.object({
        id: z.string(),
        track_index: z.number().int(),
        start_s: z.number(),
        duration_s: z.number(),
        label: z.string().default(""),
      }),
    )
    .max(500)
    .default([]),
  playhead_s: z.number().default(0),
  selected_ids: z.array(z.string()).max(500).default([]),
});

/** POST /api/assistant/chat — the multi-turn studio assistant, see
 *  `llm/assistant.ts`. The thread travels in the request: it lives in the
 *  page, and the server keeps no conversation state. */
export const assistantChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(60),
  /** The timeline open beside the chat, when there is one — same snapshot
   *  the studio planner gets, so the assistant can answer questions about
   *  the arrangement instead of pleading missing context. */
  studio: assistantStudioSchema.nullish(),
  draft: z
    .object({
      model: z.string().max(200),
      prompt: z.string().max(4000),
      negative_prompt: z.string().max(2000).nullish(),
      lyrics: z.string().max(8000).nullish(),
      track_name: z.string().max(200).nullish(),
      duration_s: z.number().positive().nullish(),
      tags: z.array(z.string().max(64)).max(20).optional(),
    })
    .nullish(),
});
export type AssistantChatRequest = z.infer<typeof assistantChatRequestSchema>;

/** POST /api/assistant/openers — empty-thread chips. */
export const assistantOpenersRequestSchema = z.object({
  studio: assistantStudioSchema.nullish(),
});
export type AssistantOpenersRequest = z.infer<typeof assistantOpenersRequestSchema>;

export const skillInstallRequestSchema = z.object({
  target: z.string().default("claude"),
  path: z.string().nullish(),
  skills: z.array(z.string()).nullish(),
});

/**
 * A studio instruction and everything it might refer to.
 *
 * Loose on purpose about what a clip or track *is*: the request only has to
 * carry enough for the model to resolve a reference, and `validateActions`
 * checks every id that comes back against this same list before anything is
 * applied. Tightening it here would only move the same check earlier.
 */
export const studioCommandRequestSchema = z.object({
  instruction: z.string().min(1).max(2000),
  context: z.object({
    tracks: z
      .array(
        z.object({
          track_index: z.number().int(),
          name: z.string().nullable().default(null),
          muted: z.boolean().default(false),
          soloed: z.boolean().default(false),
        }),
      )
      .max(200),
    clips: z
      .array(
        z.object({
          id: z.string(),
          track_index: z.number().int(),
          start_s: z.number(),
          duration_s: z.number(),
          label: z.string().default(""),
        }),
      )
      .max(500),
    playhead_s: z.number().default(0),
    selected_ids: z.array(z.string()).max(500).default([]),
    /** Saved voices a written line may be cast to. The planner may only name
     *  one of these; see `llm/studio.ts`. */
    voices: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          kind: z.enum(["clone", "builtin"]),
          notes: z.string().nullish(),
        }),
      )
      .max(200)
      .default([]),
  }),
});
