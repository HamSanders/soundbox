/**
 * Soundbox HTTP API client.
 *
 * Types mirror docs/API.md exactly. Every network call in the app goes through
 * this module, so swapping in the in-memory mock (VITE_MOCK=1) is a one-line
 * change at the bottom of the file.
 */

/* ------------------------------------------------------------------ types */

export type ModelStatus =
  | "not_installed"
  /** Weights are downloaded, but the audio.cpp engine that runs them is not
   *  installed. A different remedy from not_installed: install the engine
   *  (Models page), rather than download anything. */
  | "needs_runtime"
  | "installed"
  | "downloading"
  | "loaded"
  /** Something of the weights is on disk but not enough to run: a download
   *  that stopped, or a package missing a file. Repair downloads the rest. */
  | "incomplete"
  | "error";

/** Where a model runs: weights on this machine ("local"), or a custom
 *  endpoint someone else's server answers ("endpoint"). */
export type ModelProvider = "local" | "endpoint";

/** `commercial` drives the licence badge colour on the Models screen. */
export interface LicenseInfo {
  name: string;
  commercial: "yes" | "conditional" | "no";
  url?: string | null;
  note?: string | null;
}

export interface ModelSupports {
  negative_prompt: boolean;
  seed: boolean;
  steps: boolean;
  cfg: boolean;
  /** Lyrics-conditioned vocal generation (ACE-Step). */
  lyrics: boolean;
  /** Text-to-speech input (a spoken-word script rather than a description of
   *  a sound). Declared by TTS/voice-cloning engines. */
  text: boolean;
  /** Needs a reference audio clip to clone a voice from. */
  voice_reference: boolean;
  /** Can continue an existing sound past its end (ACE-Step). */
  extend: boolean;
  /** Can re-render an existing sound in a new style, keeping its structure
   *  and melody (ACE-Step). */
  cover: boolean;
  /** Can regenerate a time window inside an existing sound — the editor's
   *  Repaint tool, over whatever range is highlighted. */
  repaint: boolean;
}

/** The audio-to-audio edits a generation model can run on a library sound. */
export type EditKind = "extend" | "cover" | "repaint";

export interface EditOptions {
  /** `cover` — 1 follows the source closely, 0 is loose. */
  cover_strength?: number | null;
  /**
   * `extend` — how much of the clip's tail to feed back as context when the
   * target runs past what the model can render in one pass.
   *
   * Only consulted for such a target. Longer keeps the continuation coherent;
   * shorter produces more new audio per pass, because the two share one
   * generation's budget. Defaults to half the model's maximum.
   */
  extend_window_s?: number | null;
  repaint_start_s?: number | null;
  repaint_end_s?: number | null;
  repaint_mode?: "balanced" | "conservative" | "aggressive" | null;
  repaint_strength?: number | null;
}

export interface ModelDefaults {
  duration_s: number;
  steps?: number | null;
  cfg?: number | null;
}

export interface Model {
  id: string;
  name: string;
  vendor: string;
  description: string;
  license: LicenseInfo;
  hf_repo: string;
  gated: boolean;
  /** audio.cpp's loader family ("vibevoice", "chatterbox"). What a model will
   *  listen to is a property of the family, so this is what its parameter list
   *  is keyed by. */
  family: string;
  /** The knobs this family actually accepts, from audio.cpp's own
   *  `model_params.json`. Empty is a real answer: it means the words and the
   *  voice are the only controls this model has. */
  params: ModelParam[];
  /** Which surface drives this model:
   *
   *    "gen" — prompt → audio; the Generate composer.
   *    "sep" — existing audio → stems; a sound's "Split into stems" action.
   *    "tts" — script → speech; the Voice studio.
   *    "vc"  — existing audio re-voiced; the Voice studio's convert action.
   *
   *  Only "gen" appears in the Generate composer's model picker. */
  task: "gen" | "sep" | "tts" | "vc";
  /** Built-in voice names this model ships (for a "tts" model that has them),
   *  or empty when a reference clip is the only way to pick a voice. */
  voice_ids: string[];
  /** True for a cloning/conversion-only family with no default voice at all
   *  (e.g. Chatterbox) — pickers must not offer a "Model default" choice for
   *  one of these. */
  requires_voice_reference?: boolean;
  /** What kind of model this is, for the Generate composer's category tabs.
   *  "sfx"/"music"/"voice" are prompt-driven generation flavours, "utility"
   *  covers non-generative engines like stem separation. */
  category: "sfx" | "music" | "voice" | "utility";
  max_duration_s: number;
  sample_rate: number;
  channels: number;
  supports: ModelSupports;
  defaults: ModelDefaults;
  vram_estimate_mb: number;
  /** Highest guidance scale that still produces usable audio, or null/absent
   *  for no model-specific ceiling. Distilled few-step models are tuned for
   *  cfg ~1 and collapse into noise well below the API's global limit. */
  max_cfg?: number | null;
  /** Extra runtime packages this model needs beyond the engine. Empty for
   *  every audio.cpp model; kept so a future runtime can state its needs. */
  extras: string[];
  status: ModelStatus;
  /** Where this model runs. Absent from an older server, which only had local
   *  ones — treat a missing value as "local". */
  provider?: ModelProvider;
  /** Whether the engine that runs this model is installed. False with
   *  weights present is exactly the "needs_runtime" case. */
  installed_deps: boolean;
  /** Whether Soundbox can install this model's engine itself. */
  auto_installable?: boolean;
  /** Plain-language explanation shown when auto_installable is false. */
  manual_install_reason?: string | null;
  /** The equivalent shell command, for display and copy-to-clipboard. */
  install_command?: string | null;
  error?: string | null;
  /** Set alongside `error` when the adapter could not report its status. */
  failure?: Failure | null;
  /** Id of the in-flight download/install job for this model, from server
   *  job state rather than client memory — lets a row resume watching
   *  progress after a reload or remount (e.g. a tab switch) instead of
   *  showing "Not installed" while a job is quietly still running. */
  active_job_id?: string | null;
  /** Rolling average wall time (seconds) of this model's recent successful
   * generations, or null with no history yet. Lets the UI show a duration
   * estimate before Generate is clicked instead of only discovering it from
   * a stuck-looking queue. */
  avg_duration_s?: number | null;
}

/**
 * One knob a model family will listen to.
 *
 * Mirrors `ModelParam` in server/src/models/params.ts, which reads audio.cpp's
 * own parameter table. Passed back as `request_options` — a plain string map,
 * because `--request-option key=value` is what the binary takes.
 */
export interface ModelParam {
  name: string;
  type: "slider" | "number" | "bool" | "text" | "choice";
  label: string;
  info?: string | null;
  placeholder?: string | null;
  /** Which section of the delivery panel this belongs in. "delivery" is the
   *  one that changes how a line is read; the rest are progressively further
   *  from that question. */
  group: "delivery" | "sampling" | "quality" | "phrasing" | "voice" | "advanced";
  default: string | number | boolean;
  minimum?: number | null;
  maximum?: number | null;
  step?: number | null;
  /** 0 means integer. */
  precision?: number | null;
  choices?: string[];
  /** Another knob that has to be set for this one to do anything — VibeVoice's
   *  `temperature` needs `do_sample=true`. The server fills these in, so this
   *  is here to be explained in the UI, not enforced by it. */
  requires?: { name: string; value: string } | null;
}

/**
 * A saved voice — the unit the Voice studio reuses across generations.
 *
 * Two kinds, which are not interchangeable at generation time: a "clone"
 * carries a reference clip (any model declaring `supports.voice_reference`
 * could read it), while a "builtin" is a name out of one model family's own
 * list and means nothing to any other family.
 *
 * Both name a model in `model_id`, chosen when the voice is made. For a
 * builtin that is a constraint; for a clone it is a decision, and the reason
 * every speech surface can offer one control — pick the voice, and the model
 * comes with it — instead of two that can be put out of step.
 */
export interface Voice {
  id: string;
  name: string;
  kind: "clone" | "builtin";
  created_at: string;
  /** clone: served URL of the reference clip, playable directly. */
  reference_file?: string | null;
  /** builtin: the model's own voice name. */
  voice_id?: string | null;
  /** The model this voice speaks through — a builtin's own family, or the
   *  one a clone was saved against. Null only for clones saved before
   *  voices carried a model. */
  model_id?: string | null;
  /** Free text about the voice — and the description a generated avatar is
   *  drawn from, so it is worth filling in. */
  notes?: string | null;
  /** Served URL of a generated avatar (`/artwork/…png`), or null/absent when
   *  none has been drawn. Optional so a server predating artwork still fits. */
  artwork?: string | null;
  /** How many library sounds were read in this voice — what
   *  `listSounds({ voice_id })` returns. Absent on an older server. */
  read_count?: number;
  /** clone: the clips this voice is made from, oldest first. With one, it is
   *  `reference_file`; with several, `reference_file` is them joined. */
  samples?: VoiceSample[];
}

/** One clip a clone voice is made from. */
export interface VoiceSample {
  id: string;
  /** Served URL, playable directly. */
  file: string;
  /** Null for the clip of a voice saved before voices held several. */
  duration_s: number | null;
  created_at: string;
}

/** A voice as a portable file (`.soundbox-voice.json`): its fields plus its
 *  clips as base64 WAV. Opaque to the app — it is downloaded and uploaded
 *  whole, never edited. */
export interface VoiceExportFile {
  format: "soundbox-voice";
  version: number;
  voice: { name: string; kind: "clone" | "builtin" };
  [key: string]: unknown;
}

export interface VoiceCreate {
  name: string;
  kind?: "clone" | "builtin";
  voice_id?: string | null;
  model_id?: string | null;
  notes?: string | null;
  /** clone: turn an existing library sound into a voice. */
  source_sound_id?: string | null;
  /** clone: trim silence off the ends, take out DC offset and pull a hot peak
   *  back. Never boosts or re-tones the clip. */
  tidy?: boolean;
}

export interface VoicePatch {
  name?: string;
  notes?: string | null;
}

/** One speaker's turn. `voice_id` is a saved Voice's id, or null for the
 *  model's default voice. */
export interface ScriptLine {
  voice_id?: string | null;
  text: string;
  /** Display name only — carried so a dialogue reads back the way it was
   *  written, never sent to the model. */
  speaker?: string | null;
}

export interface SpeakRequest {
  model: string;
  lines: ScriptLine[];
  seed?: number | null;
  steps?: number | null;
  cfg?: number | null;
  /** Silence between turns, in seconds. */
  gap_s?: number;
  /** `--load-option` pairs, e.g. PocketTTS' `language`. */
  load_options?: Record<string, string>;
  name?: string | null;
  tags?: string[];
  session_id?: string | null;
  project_id?: string | null;
  /** Attribution, exactly as on `GenerateRequest`. */
  origin?: Origin;
}

export interface ConvertRequest {
  model: string;
  source_sound_id: string;
  /** Must be a "clone" voice — conversion needs reference audio to match. */
  voice_id: string;
  seed?: number | null;
  session_id?: string | null;
  project_id?: string | null;
  origin?: Origin;
}

/** One row of GET /models/audiocpp/catalog — a model the audio.cpp adapter
 *  could run, whether or not the user has enabled it. */
export interface AudioCppCatalogEntry {
  id: string;
  name: string;
  vendor: string;
  description: string;
  license: LicenseInfo;
  /** Whether this model has actually been generated with and its numbers
   *  confirmed, vs. read off a sibling model or guessed. True for the shipped
   *  always_on models; never true for a `source: "custom"` one, which nobody
   *  here has run. */
  verified: boolean;
  /** True for the models registered unconditionally — `enabled` doesn't
   *  apply to these; they show in the Models list regardless. Includes the
   *  user's own custom.json entries: adding one is the opt-in. */
  always_on: boolean;
  /** Whether this id is currently in Settings.enabled_audiocpp_models (or
   *  always_on, or already downloaded). Toggle with
   *  updateSettings({ enabled_audiocpp_models }). */
  enabled: boolean;
  /** True when this model's weights are already on this machine. Weights are
   *  shared by every profile while the enable list is per-profile, so presence
   *  on disk enables the model everywhere — the toggle has nothing left to do
   *  and the row says so instead. */
  on_disk: boolean;

  /** What kind of model this is, for the Models page's search/filter. */
  category: "sfx" | "music" | "voice" | "utility";
  /** Where the entry came from: the shipped catalog, or the user's own
   *  `<data dir>/models/custom.json`. Optional so a stale server (or the mock)
   *  that predates the field still typechecks. */
  source?: "builtin" | "custom";
}

/** One row of GET /api/llm/status's `catalog` — a curated GGUF chat model for
 *  the local prompt assistant, whether or not it's downloaded. */
export interface LlmModelEntry {
  id: string;
  name: string;
  vendor: string;
  license: string;
  size_bytes: number;
  description: string;
  recommended: boolean;
  installed: boolean;
}

/** A local LLM server (Ollama, LM Studio, a bare llama-server) found already
 *  running on this machine, so external mode can be set up in one click
 *  instead of steering everyone toward installing the managed engine. */
export interface DetectedLlmEndpoint {
  label: string;
  base_url: string;
  models: string[];
}

export interface LlmStatus {
  mode: "off" | "managed" | "external";
  engine: { installed: boolean; version: string | null; backend: string | null };
  model: LlmModelEntry | null;
  catalog: LlmModelEntry[];
  external: { base_url: string; model: string; api_key_set: boolean };
  /** Whether the managed llama-server process is currently up. Always false
   *  in external mode. */
  running: boolean;
  detected: DetectedLlmEndpoint[];
}

/** One entry of GET /api/image/status's `catalog` — an artwork checkpoint
 *  Soundbox can install for you, and whether it already is. */
/** One weight file and the sd-server flag it loads under. A turbo checkpoint
 *  is one of these; SD 3.5 is four (`-m`, `--clip_l`, `--clip_g`, `--t5xxl`). */
export interface ImageWeightFile {
  flag: string;
  /** Repo-relative for a catalog model, absolute for one of your own. */
  path: string;
  size_bytes: number;
}

export interface ImageModelEntry {
  id: string;
  name: string;
  vendor: string;
  license: LicenseInfo;
  /** Empty for a model whose files are already on your disk. */
  hf_repo: string;
  files: ImageWeightFile[];
  /** Total still to download — 0 when installed, and 0 for a model you
   *  supplied the files for. */
  size_bytes: number;
  description: string;
  resolution: number;
  steps: number;
  cfg: number;
  extra_args: string[];
  recommended: boolean;
  installed: boolean;
  /** "custom" means it came from your own `custom.json`. */
  source: "builtin" | "custom";
}

/** An image server already listening on this machine. Carries the API shape
 *  as well as the URL, since that is the part the user would otherwise have to
 *  know to fill in. */
export interface DetectedImageEndpoint {
  label: string;
  base_url: string;
  kind: "openai" | "a1111";
  models: string[];
}

export interface ImageStatus {
  mode: "off" | "managed" | "external";
  /** Whether artwork can be produced right now. The UI hides its generate
   *  actions on this single value rather than re-deriving the rule. */
  ready: boolean;
  /** Why not, when `ready` is false — phrased for display. */
  detail: string | null;
  engine: { installed: boolean; version: string | null; backend: string | null };
  model: ImageModelEntry | null;
  catalog: ImageModelEntry[];
  external: { kind: "openai" | "a1111"; base_url: string; model: string; api_key_set: boolean };
  /** Whether the managed sd-server process is currently up. */
  running: boolean;
  auto_artwork: boolean;
  detected: DetectedImageEndpoint[];
}

/** A custom audio endpoint, as the server returns it (the key withheld). Each
 *  one is a model in the pickers, `endpoint:<id>`. */
export interface AudioEndpoint {
  id: string;
  name: string;
  task: "sfx" | "music" | "speech";
  url: string;
  api_key_set: boolean;
  headers: Record<string, string>;
  /** JSON with `{{variable}}` placeholders. */
  body_template: string;
  /** Dotted path to base64 audio in a JSON response; "" for a raw audio body. */
  response_path: string;
  pcm_sample_rate: number;
  max_duration_s: number;
  voices: string[];
  enabled: boolean;
}

/** What PUT /api/endpoints/:id and the test take. `api_key` omitted keeps the
 *  saved key; "" clears it. */
export type AudioEndpointInput = Omit<AudioEndpoint, "id" | "api_key_set"> & {
  api_key?: string | null;
};

export interface EndpointPreset {
  id: string;
  label: string;
  hint: string;
  docs_url: string;
  endpoint: Omit<AudioEndpoint, "id" | "name" | "api_key_set" | "enabled">;
}

export interface EndpointList {
  endpoints: AudioEndpoint[];
  presets: EndpointPreset[];
  /** Template variable → what it holds. */
  variables: Record<string, string>;
}

export interface EndpointTestResult {
  duration_s: number;
  sample_rate: number;
  channels: number;
}

export interface EnhanceRequest {
  prompt: string;
  n?: number;
  category?: "sfx" | "music";
  lyrics?: boolean;
  /** The model this will actually generate with — grounds the rewrite in
   *  that model's own documented prompting conventions (e.g. Stable Audio's
   *  tempo/instrumentation emphasis vs ACE-Step's tag-style genre field)
   *  instead of generic advice. Omit for generic guidance only. */
  model?: string;
}

export interface EnhanceResponse {
  variations: string[];
  /** Short suggested keywords for Soundbox's own Tags field — a separate
   *  thing from `variations`, which stays a natural-phrase prompt. Apply
   *  these to `ComposerSettings.tags`, never into the prompt text. */
  tags: string[];
}

/* ------------------------------------------------------ studio assistant */

/** Re-exported rather than redeclared: the assistant and the studio planner
 *  are handed the very same snapshot. */
export type { StudioContext } from "./studio-command";
import type { DeviceSpec } from "./devices";
import type { StudioContext } from "./studio-command";

/** One turn of the studio assistant's thread. The thread lives in the page
 *  (see `assistant-store.ts`) and is sent whole on every call — the server
 *  keeps no conversation state. */
export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

/** A request the assistant has written, in the composer's own terms. The
 *  server has already checked it: `model` is an installed generation model,
 *  `duration_s` fits it, `lyrics` only ride on a model that sings. */
export interface AssistantProposal {
  model: string;
  prompt: string;
  negative_prompt?: string | null;
  lyrics?: string | null;
  track_name?: string | null;
  duration_s?: number | null;
  tags?: string[];
}

/** POST /api/assistant/chat — see server/src/llm/assistant.ts. */
export interface AssistantChatRequest {
  messages: AssistantTurn[];
  /** What is in the composer right now, so "make it longer" refers to it. */
  draft?: AssistantProposal | null;
  /** The timeline open beside the chat, so questions about the arrangement
   *  ("how many tracks?") are answered rather than deflected. Omitted when
   *  no studio is open. */
  studio?: StudioContext | null;
}

/** A place in the app the guide pointed at. Checked server-side against the
 *  real route table, so it is always somewhere that exists. */
export interface AssistantLink {
  to: string;
  label: string;
}

export interface AssistantChatResponse {
  reply: string;
  /** Where to go next. Empty when the answer does not point anywhere. */
  links: AssistantLink[];
  /** Which documentation the answer was drawn from ("docs/MCP.md › Tools"),
   *  so it can be checked rather than trusted. */
  sources: string[];
}

/** One empty-thread chip: the pill label, and the message tapping it sends. */
export interface AssistantOpener {
  label: string;
  text: string;
}

export interface AssistantOpenersRequest {
  studio?: StudioContext | null;
}

export interface AssistantOpenersResponse {
  openers: AssistantOpener[];
}

/** POST /api/enhance/lyrics — writes a full lyric sheet (structure tags,
 *  syllable-balanced lines) from a theme or rough draft, a different skill
 *  from rewriting the one-line caption. */
export interface EnhanceLyricsRequest {
  theme: string;
  /** The current caption/style prompt, for tag consistency. */
  style?: string;
}

export interface EnhanceLyricsResponse {
  lyrics: string;
}

export interface Sound {
  id: string;
  created_at: string;
  model: string;
  prompt: string;
  negative_prompt?: string | null;
  /** Lyrics used for a lyrics-conditioned vocal generation, or null. */
  lyrics?: string | null;
  track_name?: string | null;
  /** Which audio-to-audio edit made this sound from `parent_id`, if any. */
  edit?: EditKind | null;
  edit_options?: EditOptions | null;
  duration_s: number;
  seed?: number | null;
  steps?: number | null;
  cfg?: number | null;
  sample_rate: number;
  channels: number;
  /** Served from `/files/{id}.wav`. */
  file: string;
  /** 256 normalised peaks — feed straight to wavesurfer so it never decodes. */
  peaks: number[];
  favorite: boolean;
  tags: string[];
  name: string;
  size_bytes: number;
  /** The session this was generated in, or null for ungrouped sounds. */
  session_id?: string | null;
  /** The project this sound is filed under *directly* — an explicit
   *  override set from the Library. Null does not mean unfiled: the sound
   *  may still inherit one from its session. Use `effective_project_id` to
   *  display or filter by "what project is this actually in". */
  project_id?: string | null;
  /** `project_id` if set, else the project inherited from its session, else
   *  null. Read-only — set `project_id` to override inheritance, or the
   *  session's `project_id` to change what gets inherited. */
  effective_project_id?: string | null;
  /** Who asked for this. Pre-existing sounds read as `"app"` — the only
   *  source that existed before attribution was recorded. */
  source: SoundSource;
  /** Human-readable client label ("claude-code 2.1.0") for MCP-originated
   *  sounds; null for the app and anonymous API callers. */
  client?: string | null;
  /** The sound this one was derived from via a non-destructive edit (trim,
   *  normalise, reverse, gain, EQ, pitch/time-stretch), or null for an
   *  original generation. */
  parent_id?: string | null;
  /** Served URL of generated cover art (`/artwork/…png`), or null/absent.
   *  Only music tracks get one in the app. */
  artwork?: string | null;
  /** The saved Voice that read this sound, when there was exactly one — a
   *  single-voice read or a voice conversion. Null/absent for multi-voice
   *  dialogues and non-speech sounds. The library tile uses it to show the
   *  voice's avatar where a music track shows its cover. */
  voice_id?: string | null;
}

export type SoundEditOp =
  | "trim"
  | "normalize"
  | "reverse"
  | "gain"
  | "highpass"
  | "lowpass"
  | "pitch"
  | "stretch";

/** One non-destructive edit — always produces a new derived `Sound` rather
 *  than mutating the source. Only the fields the chosen `op` needs matter. */
export interface SoundEditRequest {
  op: SoundEditOp;
  /** `op: "trim"` — manual in/out points, in seconds. */
  start_s?: number;
  end_s?: number;
  /** `op: "normalize"` — defaults to -16 LUFS server-side if omitted. */
  target_lufs?: number;
  /** `op: "gain"`. */
  gain_db?: number;
  /** `op: "highpass" | "lowpass"`. */
  cutoff_hz?: number;
  /** `op: "pitch"`. */
  semitones?: number;
  /** `op: "stretch"` — >1 shortens (faster), <1 lengthens (slower). */
  rate?: number;
}

export interface GenerateRequest {
  model: string;
  prompt: string;
  negative_prompt?: string | null;
  /** Lyrics for a lyrics-conditioned vocal model (ACE-Step). Ignored by
   *  models whose `supports.lyrics` is false. */
  lyrics?: string | null;
  track_name?: string | null;
  /** Edit an existing library sound instead of rendering from scratch.
   *  Needs `edit`; the model must declare `supports.<edit>`. The result
   *  comes back as a new sound whose `parent_id` is this one. */
  source_sound_id?: string | null;
  /** "extend" continues the source to `duration_s` total; "cover" re-renders
   *  it in the style of `prompt` at the source's length; "repaint" redoes
   *  `edit_options.repaint_start_s..repaint_end_s`. */
  edit?: EditKind | null;
  edit_options?: EditOptions | null;
  duration_s: number;
  seed?: number | null;
  steps?: number | null;
  cfg?: number | null;
  variations?: number;
  tags?: string[];
  /** Group this generation into an existing session. Omit and the server
   *  starts a new one titled from the prompt; the id comes back on the job's
   *  `request`, which is how the composer learns which session it is in. */
  session_id?: string | null;
  /** File a brand-new session into this project the moment it's created.
   *  Only takes effect when `session_id` is absent — an existing session's
   *  project is changed with `renameSession`'s sibling, `setSessionProject`. */
  project_id?: string | null;
  /** Attribution for the resulting sounds. The app always sends
   *  `{source: "app"}` (see `useGenerate`); omitting it entirely is what an
   *  external API caller does, and reads as `source: "api"` on the server. */
  origin?: Origin;
  /** Split the render before the job reports done, and hand back the stems
   *  instead of the mix. The mix still lands in the library as their parent —
   *  the job's `sources` names it. Omit for a plain render. */
  separate?: (StemSelection & { model?: string | null }) | null;
}

/**
 * Which stems to keep out of a split, and what happens to the rest.
 *
 * `keep` empty means all of them, which is what every caller sent before
 * choosing existed. "discard" throws the others away; "merge" sums them into
 * one `rest` sound — the original minus what was taken out, so the pieces
 * still add back up to the take you started from.
 */
export interface StemSelection {
  keep: string[];
  rest: "discard" | "merge";
}

/** What htdemucs and its siblings produce. A default for a picker that has to
 *  offer something before any separation has actually run — the real names
 *  come from the separator's own output. */
export const COMMON_STEM_NAMES = ["vocals", "drums", "bass", "other"];

export type SoundSource = "app" | "api" | "mcp";

export interface Origin {
  source: SoundSource;
  client_name?: string | null;
  client_version?: string | null;
}

/** One working thread of related generations — the "chat" a Recent entry
 *  opens back into. Sounds can exist without one (API/MCP, or made before
 *  sessions existed), so the Library stays the flat view over everything. */
/**
 * A durable thread: what happened in one studio, in order.
 *
 * Distinct from `Session`, which groups the *sounds* one run of generations
 * produced. This groups the causes — what was asked, what it did, what came
 * of it — and survives the browser it was typed in.
 */
export interface Conversation {
  id: string;
  title: string;
  /** The studio it happened in, or null for a thread held outside one. */
  story_id: string | null;
  created_at: string;
  updated_at: string;
  entry_count: number;
}

/** One turn of cause and effect. All three halves are optional because not
 *  every turn has all three — see server/src/history.ts. */
export interface HistoryEntry {
  id: string;
  conversation_id: string;
  position: number;
  role: "user" | "assistant";
  content: string;
  /** One line per edit, in the words the chat used when it applied them. */
  actions: string[];
  /** Sounds this turn produced, so the entry can play them back. */
  sound_ids: string[];
  /** The job that carried it out — the bridge across to the logs. */
  job_id: string | null;
  created_at: string;
}

/** What a caller appends. `id` and `position` are the server's to assign. */
export interface NewHistoryEntry {
  role: "user" | "assistant";
  content?: string;
  actions?: string[];
  sound_ids?: string[];
  job_id?: string | null;
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
  /** Bumped on every generation; Recent is ordered by this. */
  updated_at: string;
  sound_count: number;
  /** The project this session is nested in, if any. Every sound generated in
   *  it inherits this project automatically, unless moved out directly. */
  project_id?: string | null;
}

/** A folder for sounds you file into it — a game's footstep set, a client's
 *  brief — that outlives any one working session. Unlike a session, deleting
 *  a project only unfiles its sounds; they stay in the library. */
export interface Project {
  id: string;
  name: string;
  created_at: string;
  sound_count: number;
}

/**
 * Which tool a story belongs to.
 *
 * "script" is the Script Builder — words first: a script beside the timeline,
 * a cast, lines you voice and re-voice. "music" is the Music Builder — a
 * prompt, takes, and clips you arrange. They share the timeline, the library
 * and the chat; what differs is what you start from, which is why this is
 * chosen when the story is created rather than guessed from what landed on
 * the timeline afterwards.
 */
export type StoryBuilder = "script" | "music";

/** Where a story opens, by which builder owns it. The one place that turns a
 *  story into a URL. */
export function studioPath(story: Pick<Story, "id" | "builder">): string {
  return `/studio/${story.builder}/${story.id}`;
}

/**
 * A script that stays: ordered lines you keep coming back to and rearranging.
 *
 * The distinction from a Session is what each one is *for*. A session is a log
 * of what you made in one sitting; a story is a document — its lines have a
 * place in the script and a place in time, survive being regenerated, and get
 * mixed down as a whole.
 */
/**
 * One clip on a story's timeline, reduced to the three numbers it takes to
 * draw the arrangement small — see `StoryShape`.
 *
 * Not a StorySegment on purpose: the shelf asks for up to 200 stories at
 * once, and a lane, a start and a length is the whole picture at thumbnail
 * size. Text, voices and peaks would be bytes spent on pixels nobody can
 * resolve, and the one-letter keys are the same economy.
 */
export interface TimelineClip {
  /** Lane the clip sits in. */
  t: number;
  /** Start, in seconds from the top of the story. */
  s: number;
  /** Length, in seconds, as the timeline would draw it — a line written but
   *  not yet spoken carries the same word-count estimate the studio gives it
   *  rather than a zero. */
  d: number;
}

export interface Story {
  id: string;
  title: string;
  created_at: string;
  /** Bumped on every edit to the story or any of its lines; the sidebar is
   *  ordered by this. */
  updated_at: string;
  project_id?: string | null;
  /** The story's default delivery — what every line is read with unless it
   *  carries its own. */
  request_options: Record<string, string>;
  segment_count: number;
  /** Which studio this story belongs to, guessed server-side from what its
   *  clips actually are: a spoken line makes it "voice"; otherwise the
   *  category of the models behind its clips. Null for an empty story, or one
   *  whose clips don't say either way — recomputed on every read, not a field
   *  you can set. */
  studio?: "voice" | "music" | "sfx" | null;
  /** Which of the two builders opens this story. Unlike `studio` this is
   *  stored: it is the choice made at the "new sound" door, and a brand-new
   *  story has no clips to guess from. Stories written before the split fall
   *  back to whatever `studio` guessed, server-side. */
  builder: StoryBuilder;
  /** Every clip's placement, for drawing the arrangement as a thumbnail. Only
   *  the list fills this in: a story you have opened has the real timeline
   *  beside it. Capped server-side, so a very long story previews its
   *  opening. */
  timeline?: TimelineClip[];
}

/**
 * One line of a story, and one clip on its timeline.
 *
 * `position` is the reading order and `start_s`/`track_index` are the
 * placement, but the placement is what decides the order: drag a clip later in
 * time and the script re-reads to match, because the order things happen in is
 * the order they are read in. A line with no `sound_id` hasn't been spoken yet
 * — the normal state for anything just typed.
 */
export interface StorySegment {
  id: string;
  story_id: string;
  /** Reading order in the card list. */
  position: number;
  /** Which timeline lane the clip sits in. */
  track_index: number;
  speaker?: string | null;
  voice_id?: string | null;
  text: string;
  language?: string | null;
  sound_id?: string | null;
  /** "pause" is a written beat of silence — no text, no voice, no audio, just
   *  a `duration_s`. It keeps the script reading the way it sounds. */
  kind: "line" | "pause";
  /** How far into the source sound this clip starts. With `duration_s` (how
   *  much of it plays) this trims a clip without touching its audio, so a
   *  shortened clip can always be lengthened again. */
  trim_start_s: number;
  /** Hydrated by the segment list, so the timeline has every clip's peaks
   *  without a request per clip. */
  sound?: Sound | null;
  start_s: number;
  duration_s?: number | null;
  /** Seconds of fade at each end. A hard edge is a click wherever the cut did
   *  not land on a zero crossing, so these are worth having on any clip whose
   *  edges you moved. Overlapping clips also crossfade over the overlap
   *  without either of these being set — see the timeline. */
  fade_in_s: number;
  fade_out_s: number;
  /** This line's own delivery knobs, by the model family's option names.
   *  Empty means it follows the story's default. */
  request_options: Record<string, string>;
  /** Left out of both playback and the export mixdown. */
  muted: boolean;
  gain_db: number;
  created_at: string;
  updated_at: string;
}

/**
 * A lane and the controls that belong to it.
 *
 * Separate from the clips on it because they answer different questions: a
 * clip's `muted` is "leave this line out", a track's is "I am not listening to
 * this part right now". A track with default settings has no row at all.
 */
export interface StoryTrack {
  story_id: string;
  track_index: number;
  /** Null until named; falls back to the lane number. */
  name: string | null;
  muted: boolean;
  /** With any track soloed, only soloed tracks are heard. */
  soloed: boolean;
  gain_db: number;
  /** The insert chain, in order — the device rack. Stored with the track so
   *  an agent's change over MCP reaches the studio; heard on the timeline,
   *  not in the export mixdown. */
  devices: DeviceSpec[];
}

export interface TrackPatch {
  name?: string | null;
  muted?: boolean;
  soloed?: boolean;
  gain_db?: number;
  /** Replaces the whole chain; [] empties it. */
  devices?: DeviceSpec[];
}

export interface SegmentCreate {
  speaker?: string | null;
  voice_id?: string | null;
  text?: string;
  language?: string | null;
  track_index?: number;
  /** Omit to append to the end of the script. */
  position?: number | null;
  /** Omit and the clip lands after everything already on its track, rather
   *  than stacking at 0:00. */
  start_s?: number | null;
  /** Drop an existing library sound onto the timeline instead of writing a
   *  line to be spoken — a score bed, a sound effect, a take from elsewhere. */
  sound_id?: string | null;
  kind?: "line" | "pause";
  /** A pause's length, or how much of `sound_id` plays. Ignored for a spoken
   *  line, whose duration comes from its audio. */
  duration_s?: number | null;
  request_options?: Record<string, string>;
  /** Clip state, so a clip can be put back exactly as it was. */
  trim_start_s?: number;
  fade_in_s?: number;
  fade_out_s?: number;
  gain_db?: number;
  muted?: boolean;
}

export interface SegmentPatch {
  speaker?: string | null;
  voice_id?: string | null;
  text?: string;
  language?: string | null;
  track_index?: number;
  start_s?: number;
  /** Point the clip at different audio, keeping where it sits and how it is
   *  trimmed — what a repaint from the timeline lands as. */
  sound_id?: string | null;
  muted?: boolean;
  gain_db?: number;
  /** For a pause, its length. For a clip, how much of its source plays. */
  duration_s?: number;
  trim_start_s?: number;
  fade_in_s?: number;
  fade_out_s?: number;
  /** `{}` clears the override and puts the line back on the story default. */
  request_options?: Record<string, string>;
}

/** Model and tuning for one take. Lives on the request rather than the segment
 *  because regenerating a line through a different model is the point. */
export interface SegmentGenerate {
  model: string;
  seed?: number | null;
  steps?: number | null;
  cfg?: number | null;
  load_options?: Record<string, string>;
  /** Delivery for this take only, overriding what the line and story store.
   *  Omit to read the line the way it is written. */
  request_options?: Record<string, string>;
}

export type JobKind =
  | "generate"
  | "download"
  | "separate"
  | "speak"
  | "convert"
  | "segment"
  | "export"
  /** A model self-test: one short render, timed, nothing saved. */
  | "selftest";
export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";
export type JobPhase =
  | "queued"
  | "installing"
  | "loading"
  | "downloading"
  | "generating"
  | "encoding"
  | "done";

/** A stable name for a class of failure. Mirrors `server/src/failure.ts`. */
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

export interface FailureFix {
  /** States its effect: "Download it in Models". */
  label: string;
  /** An app route. */
  to: string;
}

/** What went wrong, in the user's terms, with the raw text kept whole. The
 *  server builds it (`buildFailure`) and `FailureCard` renders it. */
export interface Failure {
  topic: FailureTopic | null;
  title: string;
  hint: string | null;
  fixes: FailureFix[];
  terminal: boolean;
  stage: string | null;
  detail: string;
}

export interface Job {
  id: string;
  kind: JobKind;
  status: JobStatus;
  phase: JobPhase;
  progress: number;
  message?: string | null;
  error?: string | null;
  /** Set alongside `error` when the job failed. */
  failure?: Failure | null;
  request?: unknown;
  /** Always carries `sounds`; some jobs add their own keys — a story built
   *  from a sound returns `story_id`, so the caller can go there. */
  result?: { sounds: string[]; story_id?: string; [key: string]: unknown } | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  /** 1-indexed position among jobs still waiting; null once running or terminal. */
  queue_position?: number | null;
  /** Rough estimated seconds until this job starts running, derived from
   * recent job durations for the same model. Null with no timing history. */
  eta_s?: number | null;
}

/**
 * A named library. Switching profile points the server at another data
 * directory — its own sounds, stories, voices and settings — while the model
 * weights and runtimes stay shared, so a switch takes a moment rather than a
 * re-download.
 */
export interface Profile {
  /** Slug derived from `name` at creation, and fixed thereafter — it is the
   *  directory name on disk. */
  id: string;
  name: string;
  /** ISO timestamp. Empty for the built-in default profile, which was never
   *  created — it is the data directory itself. */
  created_at: string;
  data_dir: string;
  active: boolean;
}

export interface ProfileList {
  active: string;
  profiles: Profile[];
}

export interface Settings {
  data_dir: string;
  hf_token_set: boolean;
  output_format: "wav" | "mp3";
  normalize_lufs: number | null;
  trim_silence: boolean;
  auto_unload_minutes: number;
  /** "auto" autodetects cuda/mps/cpu; an unavailable forced choice falls back. */
  device: "auto" | "cuda" | "mps" | "cpu";
  /** OTLP/HTTP collector base URL for MCP call traces + metrics, or "" when
   *  unset. Ignored while the server's OTEL_EXPORTER_OTLP_ENDPOINT env var is
   *  set — see `McpStatus.otel.source`. */
  otel_endpoint: string;
  /** Ids from AudioCppCatalogEntry the user has opted into. Empty by default
   *  — audio.cpp's always_on models don't need to be in here. */
  enabled_audiocpp_models: string[];
  /** Where the audio engine and its weights come from. No "off": audio.cpp is
   *  the only thing that generates audio here. "managed" is our own install;
   *  "external" is an audio.cpp the user already runs, sharing its weights. */
  audiocpp_mode: "managed" | "external";
  /** The packages folder actually in force, always resolved — never null. */
  audiocpp_models_dir: string;
  /** Where generated audio is written, always resolved — never null. Set
   *  independently of `audiocpp_models_dir`: weights are bulk you can
   *  re-download, sounds are the work you cannot. */
  sounds_dir: string;
  /** "off" by default. "managed" talks to a locally-installed llama-server;
   *  "external" talks to an OpenAI-compatible endpoint the user points at. */
  llm_mode: "off" | "managed" | "external";
  /** Catalog id — see GET /api/llm/status's `catalog`. Only used in "managed" mode. */
  llm_model: string;
  llm_external_base_url: string;
  llm_external_model: string;
  llm_external_api_key_set: boolean;
  /** "off" by default — no artwork anywhere. "managed" runs a locally
   *  installed sd-server; "external" talks to an image endpoint the user
   *  already runs. Mirrors `llm_mode`, deliberately. */
  image_mode: "off" | "managed" | "external";
  /** Catalog id — see GET /api/image/status's `catalog`. "managed" mode only. */
  image_model: string;
  /** Which API the external endpoint speaks. Not detectable from a base URL,
   *  so it is declared rather than guessed. */
  image_external_kind: "openai" | "a1111";
  image_external_base_url: string;
  image_external_model: string;
  image_external_api_key_set: boolean;
  /** Queue cover art automatically after a music generation. Off by default:
   *  the image engine competes for the audio model's VRAM. */
  image_auto_artwork: boolean;
  /** ISO timestamp of when first-run setup was finished or skipped, or null
   *  for a profile that has never been through it. What gates the onboarding
   *  wizard — see `lib/onboarding.ts`. */
  onboarded_at: string | null;
}

/** `hf_token` is write-only — the server never echoes it back. */
export interface SettingsPatch {
  output_format?: "wav" | "mp3";
  normalize_lufs?: number | null;
  trim_silence?: boolean;
  auto_unload_minutes?: number;
  hf_token?: string;
  device?: "auto" | "cuda" | "mps" | "cpu";
  otel_endpoint?: string;
  /** Replaces the whole list — send every id that should stay enabled, not
   *  just the one being added or removed. */
  enabled_audiocpp_models?: string[];
  audiocpp_mode?: "managed" | "external";
  /** Empty string restores the managed default. */
  audiocpp_models_dir?: string;
  /** Where generated audio is written. Empty string restores the default
   *  (`<data dir>/sounds`). Changing it moves the existing library across, so
   *  the server refuses while anything is generating. */
  sounds_dir?: string;
  llm_mode?: "off" | "managed" | "external";
  llm_model?: string;
  llm_external_base_url?: string;
  llm_external_model?: string;
  /** Write-only, like `hf_token` — the server never echoes it back. */
  llm_external_api_key?: string;
  image_mode?: "off" | "managed" | "external";
  image_model?: string;
  image_external_kind?: "openai" | "a1111";
  image_external_base_url?: string;
  image_external_model?: string;
  /** Write-only, like `hf_token`. */
  image_external_api_key?: string;
  image_auto_artwork?: boolean;
  /** Mark first-run setup done (an ISO timestamp) or, with "", undo it so the
   *  wizard opens again. */
  onboarded_at?: string;
}

/**
 * One directory, as GET /api/fs/dirs answers it — what the folder pickers in
 * Settings walk around in.
 *
 * The server's filesystem, deliberately, not the browser's: the path being
 * chosen is one the server will write to, and a browser file input cannot
 * produce a real one anyway.
 */
export interface DirectoryListing {
  /** The folder actually listed, resolved. May differ from what was asked for
   *  — a path that no longer exists resolves to its nearest living ancestor. */
  path: string;
  /** One level up, or null at a filesystem root. */
  parent: string | null;
  /** The server's path separator, so paths built client-side match its
   *  platform rather than ours. */
  separator: string;
  home: string;
  /** Whether the server can write here. A hint for the UI — the real check
   *  happens when the setting is saved. */
  writable: boolean;
  /** Drive letters on Windows, a single "/" elsewhere. The only way to cross
   *  from one drive to another, since ".." from a drive root stays put. */
  roots: { name: string; path: string }[];
  /** Subdirectories only — no files, ever. Empty for a folder the server can
   *  see but not open. */
  entries: { name: string; path: string }[];
}

/** What a model self-test reports: one short render through the normal
 *  path, timed, nothing saved. */
export interface ModelSelfTest {
  model: string;
  ok: boolean;
  device: string;
  elapsed_s: number;
  rendered_s: number | null;
  error: string | null;
}

export interface HealthStatus {
  status: string;
  version: string;
  device: string;
  gpu_name?: string | null;
  vram_total_mb?: number | null;
  vram_free_mb?: number | null;
  loaded_model: string | null;
  queue_length: number;
}

export interface SoundsPage {
  items: Sound[];
  total: number;
}

export interface SoundQuery {
  limit?: number;
  offset?: number;
  q?: string;
  tag?: string;
  favorite?: boolean;
  model?: string;
  /** Match any of these model ids — how a Library category page (SFX, Music,
   *  Text to Speech) narrows to its category without pulling every sound and
   *  filtering client-side, which silently drops matches once the category's
   *  sounds fall past the first page of the unfiltered list. */
  models?: string[];
  session_id?: string;
  project_id?: string;
  /** Sibling group derived from one source (edits, stems) — not a recursive
   *  tree, just the direct children sharing this parent. */
  parent_id?: string;
  /** Sounds read in one saved voice — the Voice Lab's per-voice history. */
  voice_id?: string;
  source?: SoundSource;
}

export interface SoundPatch {
  name?: string;
  favorite?: boolean;
  tags?: string[];
  /** Move the sound into a project, or (explicit `null`) out of one — an
   *  override that beats whatever it would otherwise inherit from its
   *  session. Omit entirely to leave filing untouched. */
  project_id?: string | null;
}

export interface TagCount {
  tag: string;
  count: number;
}

/** Tail of the server's rotating log file. Raw lines: parsing lives in the UI
 *  so the wire format stays whatever the server's logger writes. */
export interface LogTail {
  lines: string[];
}

/**
 * Repaint a highlighted window of a sound (POST /api/repaint).
 *
 * Only the window is required: the model, the length of the result and the
 * lyrics are inherited from the source, because a repaint that changed any of
 * those would be a new take rather than a repaint.
 */
export interface RepaintRequest {
  source_sound_id: string;
  start_s: number;
  end_s: number;
  /** What should be there instead. Omit to keep the source's own prompt. */
  prompt?: string | null;
  lyrics?: string | null;
  model?: string | null;
  /** 0 stays close to what was there, 1 is free to replace it. */
  strength?: number | null;
  mode?: "balanced" | "conservative" | "aggressive" | null;
  seed?: number | null;
  variations?: number;
  session_id?: string | null;
  project_id?: string | null;
  origin?: Origin;
}

export interface JobRef {
  job_id: string;
}

/** Unsubscribe function returned by {@link SoundboxApi.subscribeJob}. */
export type Unsubscribe = () => void;

/* ------------------------------------------------------------------- mcp */
//
// "Agents" — the app's view of the MCP surface: which clients have connected,
// what they've called, and how it went. Mirrors backend/src/soundbox/schemas.py.

export interface McpToolInfo {
  name: string;
  title?: string | null;
  description: string;
  /** Total calls to this tool since the server started tracking (persisted,
   *  so this survives a restart). */
  calls: number;
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
  /** A call from this client finished (or is running) in the last ~10 min. */
  active: boolean;
}

export type McpCallStatus = "running" | "ok" | "error";

export interface McpCall {
  id: string;
  ts: string;
  tool: string;
  status: McpCallStatus;
  client_name?: string | null;
  client_version?: string | null;
  session_id?: string | null;
  transport: "http" | "stdio";
  args: Record<string, unknown>;
  duration_ms?: number | null;
  error?: string | null;
  job_id?: string | null;
  sound_ids: string[];
  /** OTel trace id (hex), when an exporter is configured. */
  trace_id?: string | null;
}

export interface OtelStatus {
  enabled: boolean;
  /** Whether the `soundbox[otel]` extra is importable on the server. */
  installed: boolean;
  endpoint?: string | null;
  /** Where `endpoint` came from — "env" wins over the settings value. */
  source: "env" | "settings" | "none";
  service_name: string;
  error?: string | null;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  files: string[];
  /** Target id -> absolute install path, for targets it's already on. */
  installed_at: Record<string, string>;
}

export interface SkillTarget {
  id: string;
  label: string;
  path: string;
  /** Whether the parent directory exists on this machine — dims targets
   *  that don't apply (e.g. Cursor not installed). */
  exists: boolean;
}

export interface McpStatus {
  /** The streamable-HTTP URL an agent should be pointed at. */
  endpoint: string;
  stdio_command: string;
  server_name: string;
  server_version: string;
  tools: McpToolInfo[];
  clients: McpClient[];
  calls_total: number;
  errors_total: number;
  /** Sounds in the library whose source is "mcp". */
  sounds_total: number;
  calls_24h: number;
  last_call_at?: string | null;
  active_sessions: number;
  otel: OtelStatus;
  skills: SkillInfo[];
  skill_targets: SkillTarget[];
}

export interface McpCallQuery {
  limit?: number;
  client?: string;
  tool?: string;
  status?: McpCallStatus;
  since?: string;
}

export interface SkillInstallRequest {
  /** A `SkillTarget.id` ("claude", "cursor", "codex"), or "dir" with `path`. */
  target: string;
  path?: string;
  /** Skill names to install; every bundled skill when omitted. */
  skills?: string[];
}

export interface SkillInstallResult {
  target: string;
  dest: string;
  installed: string[];
}

/**
 * Which audio.cpp binary won, and where its weights live.
 *
 * Until this existed the answer was only available from `soundbox model status
 * audiocpp` on the command line, so someone whose binary resolved from
 * SOUNDBOX_AUDIOCPP_BIN or PATH had no way to see it in the app.
 */
export interface AudioCppRuntimeStatus {
  mode: "managed" | "external";
  engine: {
    installed: boolean;
    version: string | null;
    path: string | null;
    backend: string | null;
    /** "managed" is Soundbox's own install; "env" and "path" are the user's. */
    source: "managed" | "env" | "path" | null;
  };
  models_dir: string;
  /** What a managed install would use, so an override can be labelled as one. */
  models_dir_default: string;
}

export interface SoundboxApi {
  getHealth(): Promise<HealthStatus>;
  listModels(): Promise<Model[]>;
  listAudioCppCatalog(): Promise<AudioCppCatalogEntry[]>;
  getAudioCppRuntime(): Promise<AudioCppRuntimeStatus>;
  downloadModel(id: string): Promise<JobRef>;
  /** One short render, timed, nothing saved. Resolves even when the render
   *  fails: the result says so. */
  selfTestModel(id: string): Promise<ModelSelfTest>;
  loadModel(id: string): Promise<Model>;
  unloadModel(id: string): Promise<Model>;
  deleteModelWeights(id: string): Promise<void>;
  generate(req: GenerateRequest): Promise<JobRef>;
  listJobs(limit?: number): Promise<Job[]>;
  getJob(id: string): Promise<Job>;
  cancelJob(id: string): Promise<Job>;
  subscribeJob(
    id: string,
    onJob: (job: Job) => void,
    onError?: (err: Error) => void,
  ): Unsubscribe;
  listSounds(query?: SoundQuery): Promise<SoundsPage>;
  getSound(id: string): Promise<Sound>;
  updateSound(id: string, patch: SoundPatch): Promise<Sound>;
  deleteSound(id: string): Promise<void>;
  /** Non-destructive: always returns a new derived sound rather than
   *  modifying `id`'s audio in place. */
  editSound(id: string, req: SoundEditRequest): Promise<Sound>;
  /** Reveal the sound's WAV on disk in the OS file manager. Local-only, like
   *  everything else here. */
  revealSound(id: string): Promise<void>;
  /** Split `sourceSoundId` into stems via a "sep"-task model. Async like
   *  `generate` — returns a job to poll/subscribe, not the stems directly,
   *  since separation runs the same audio.cpp subprocess path. */
  separateSound(
    modelId: string,
    sourceSoundId: string,
    stems?: StemSelection | null,
  ): Promise<JobRef>;
  /** Regenerate one window of a sound, keeping the rest of it. Async like
   *  `generate` — it is a model render, so it returns a job. */
  repaintSound(req: RepaintRequest): Promise<JobRef>;
  listTags(): Promise<TagCount[]>;
  getLogs(lines?: number): Promise<LogTail>;
  listSessions(limit?: number): Promise<Session[]>;

  /** Conversations, newest first. */
  listConversations(limit?: number): Promise<Conversation[]>;
  /** The conversation held in one studio, or null. What the History panel
   *  opens with when a timeline is reopened. */
  conversationForStory(storyId: string): Promise<Conversation | null>;
  createConversation(title?: string | null, storyId?: string | null): Promise<Conversation>;
  conversationEntries(id: string): Promise<HistoryEntry[]>;
  appendHistory(id: string, entries: NewHistoryEntry[]): Promise<HistoryEntry[]>;
  renameConversation(id: string, title: string): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  getSession(id: string): Promise<Session>;
  renameSession(id: string, title: string): Promise<Session>;
  setSessionProject(id: string, projectId: string | null): Promise<Session>;
  deleteSession(id: string): Promise<void>;
  listStories(limit?: number): Promise<Story[]>;
  getStory(id: string): Promise<Story>;
  createStory(
    title?: string | null,
    projectId?: string | null,
    builder?: StoryBuilder,
  ): Promise<Story>;
  renameStory(id: string, title: string): Promise<Story>;
  setStoryProject(id: string, projectId: string | null): Promise<Story>;
  /** Set the story's default delivery. `{}` puts every line that has no
   *  override of its own back on the model's defaults. */
  setStoryOptions(id: string, options: Record<string, string>): Promise<Story>;
  /** `deleteSounds` decides whether the story's generated audio goes with it
   *  or stays in the library unfiled. */
  deleteStory(id: string, deleteSounds?: boolean): Promise<void>;
  listSegments(storyId: string): Promise<StorySegment[]>;
  createSegment(storyId: string, req?: SegmentCreate): Promise<StorySegment>;
  updateSegment(storyId: string, segmentId: string, patch: SegmentPatch): Promise<StorySegment>;
  deleteSegment(storyId: string, segmentId: string): Promise<void>;
  /** Send the whole new order, not a move-delta — see the server's schema. */
  reorderSegments(storyId: string, segmentIds: string[]): Promise<StorySegment[]>;
  /** Speak one line. Async like `speak`: returns a job, not the audio. */
  generateSegment(storyId: string, segmentId: string, req: SegmentGenerate): Promise<JobRef>;
  /** Cut a generated line in two at `atS` seconds into its own audio. Returns
   *  both halves. Synchronous — it's a trim, not a generation. */
  splitSegment(storyId: string, segmentId: string, atS: number): Promise<StorySegment[]>;
  listTracks(storyId: string): Promise<StoryTrack[]>;
  /** Upsert — a track's first setting is also its row's creation. */
  updateTrack(storyId: string, trackIndex: number, patch: TrackPatch): Promise<StoryTrack>;
  /** Remove a lane and the clips on it. Lanes above slide down. */
  deleteTrack(storyId: string, trackIndex: number): Promise<{ removed_clips: number }>;
  /** Mix the whole timeline down to one sound. Async: returns a job. */
  exportStory(storyId: string): Promise<JobRef>;
  /** Open a library sound in the studio. With `separate`, it is split into
   *  stems first and each lands on its own track. Async: the job's result
   *  carries `story_id`. */
  storyFromSound(
    soundId: string,
    separate?: boolean,
    stems?: StemSelection | null,
  ): Promise<JobRef>;
  listProjects(): Promise<Project[]>;
  createProject(name: string): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  listVoices(): Promise<Voice[]>;
  /** Create a builtin voice, or a clone from an existing library sound. For a
   *  clip from the user's disk use `uploadVoice` instead. */
  createVoice(req: VoiceCreate): Promise<Voice>;
  /** Create a clone voice from a WAV the user picked. The body is the file
   *  itself — see server/src/routes/voices.ts for why this isn't multipart. */
  uploadVoice(
    name: string,
    file: Blob,
    notes?: string | null,
    modelId?: string | null,
    tidy?: boolean,
  ): Promise<Voice>;
  /** Add a clip to a clone voice: a WAV from disk or the mic, or a library
   *  sound by id. Returns the voice with its new clip list. */
  addVoiceSample(
    voiceId: string,
    source: { file: Blob } | { sourceSoundId: string },
    tidy?: boolean,
  ): Promise<Voice>;
  /** Remove one clip. The server refuses to remove a voice's last one. */
  deleteVoiceSample(voiceId: string, sampleId: string): Promise<Voice>;
  /** The voice as a portable file, for the app to save to disk. */
  exportVoice(id: string): Promise<VoiceExportFile>;
  /** Recreate a voice from an exported file, under a new id. */
  importVoice(file: unknown): Promise<Voice>;

  /** Take a WAV recorded in the browser into the library, so a take can be
   *  arranged on the timeline and read off disk by the export. */
  uploadSound(name: string, file: Blob, source?: string): Promise<Sound>;
  updateVoice(id: string, patch: VoicePatch): Promise<Voice>;
  deleteVoice(id: string): Promise<void>;
  /** Speak a script through a "tts"-task model. One line or many — a
   *  multi-speaker dialogue is several lines with different voices. Async like
   *  `generate`: returns a job, not the audio. */
  speak(req: SpeakRequest): Promise<JobRef>;
  /** Re-voice an existing sound through a "vc"-task model. */
  convert(req: ConvertRequest): Promise<JobRef>;
  /** List the folders inside `path` on the server's disk, for the "Browse…"
   *  pickers. Omit `path` to start at the server user's home directory. */
  browseDirectories(path?: string | null): Promise<DirectoryListing>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  listProfiles(): Promise<ProfileList>;
  /** Creates without switching — making a library and opening it are separate
   *  decisions. */
  createProfile(name: string): Promise<Profile>;
  renameProfile(id: string, name: string): Promise<Profile>;
  /** Switch the running server to this profile. Throws `ApiError` (400) while
   *  a job is in flight — see the server's `switchProfile`. */
  activateProfile(id: string): Promise<ProfileList>;
  /** `deleteData` also removes the directory. Off by default: it holds audio
   *  that exists nowhere else. */
  deleteProfile(id: string, deleteData?: boolean): Promise<void>;
  /** Rewrite a prompt via the local assistant. Throws `ApiError` (400) with
   *  an actionable message when it's off or unconfigured. */
  enhancePrompt(req: EnhanceRequest): Promise<EnhanceResponse>;
  enhanceLyrics(req: EnhanceLyricsRequest): Promise<EnhanceLyricsResponse>;
  /** One turn of the studio assistant — the multi-turn chat that explains
   *  the models and writes a prompt with you. Needs the prompt assistant on,
   *  like `enhancePrompt`. */
  assistantChat(req: AssistantChatRequest): Promise<AssistantChatResponse>;
  /** Empty-thread chips from the prompt assistant. Throws when the LLM is
   *  off, same as `assistantChat` — the chat falls back silently. */
  assistantOpeners(req: AssistantOpenersRequest): Promise<AssistantOpenersResponse>;
  getLlmStatus(): Promise<LlmStatus>;
  installLlmEngine(): Promise<JobRef>;
  downloadLlmModel(id: string): Promise<JobRef>;
  getImageStatus(): Promise<ImageStatus>;
  installImageEngine(): Promise<JobRef>;
  listEndpoints(): Promise<EndpointList>;
  saveEndpoint(id: string, input: AudioEndpointInput): Promise<AudioEndpoint>;
  deleteEndpoint(id: string): Promise<void>;
  /** Render one short clip through a configuration; nothing is saved. `id`
   *  names a saved endpoint whose key to use when the form sends none. */
  testEndpoint(input: AudioEndpointInput & { id?: string | null; prompt?: string | null }): Promise<EndpointTestResult>;
  downloadImageModel(id: string): Promise<JobRef>;
  deleteImageModel(id: string): Promise<void>;
  /** Draw (or redraw) cover art for a sound; resolves to the updated Sound. */
  generateSoundArtwork(id: string): Promise<Sound>;
  clearSoundArtwork(id: string): Promise<void>;
  generateVoiceArtwork(id: string): Promise<Voice>;
  clearVoiceArtwork(id: string): Promise<void>;
  deleteLlmModel(id: string): Promise<void>;
  getMcpStatus(): Promise<McpStatus>;
  listMcpCalls(query?: McpCallQuery): Promise<McpCall[]>;
  installSkills(req: SkillInstallRequest): Promise<SkillInstallResult>;
}

/* ------------------------------------------------------------- transport */

export class ApiError extends Error {
  status: number;
  /** The server's classified failure, when the error was a `ModelError`. */
  failure: Failure | null;
  constructor(message: string, status: number, failure: Failure | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.failure = failure;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        // The server refuses mutating /api requests that a cross-site page
        // could send without a preflight; this header proves we're not one.
        "X-Soundbox": "1",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      "Could not reach the Soundbox backend. Is the server running?",
      0,
    );
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    let failure: Failure | null = null;
    try {
      const body = (await res.json()) as {
        detail?: string;
        message?: string;
        failure?: Failure | null;
      };
      detail = body.detail ?? body.message ?? detail;
      failure = body.failure ?? null;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, res.status, failure);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(query: object | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      params.set(k, v.join(","));
      continue;
    }
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/* ------------------------------------------------------------ http impl */

const POLL_INTERVAL_MS = 750;

export const httpApi: SoundboxApi = {
  getHealth: () => request<HealthStatus>("/api/health"),

  listModels: () => request<Model[]>("/api/models"),

  listAudioCppCatalog: () =>
    request<AudioCppCatalogEntry[]>("/api/models/audiocpp/catalog"),

  getAudioCppRuntime: () => request<AudioCppRuntimeStatus>("/api/models/audiocpp/runtime"),

  downloadModel: (id) =>
    request<JobRef>(`/api/models/${encodeURIComponent(id)}/download`, {
      method: "POST",
    }),

  selfTestModel: (id) =>
    request<ModelSelfTest>(`/api/models/${encodeURIComponent(id)}/selftest`, { method: "POST" }),
  loadModel: (id) =>
    request<Model>(`/api/models/${encodeURIComponent(id)}/load`, {
      method: "POST",
    }),

  unloadModel: (id) =>
    request<Model>(`/api/models/${encodeURIComponent(id)}/unload`, {
      method: "POST",
    }),

  deleteModelWeights: (id) =>
    request<void>(`/api/models/${encodeURIComponent(id)}/weights`, {
      method: "DELETE",
    }),

  generate: (req) =>
    request<JobRef>("/api/generate", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  listJobs: (limit = 50) => request<Job[]>(`/api/jobs?limit=${limit}`),

  getJob: (id) => request<Job>(`/api/jobs/${encodeURIComponent(id)}`),

  cancelJob: (id) =>
    request<Job>(`/api/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    }),

  /**
   * SSE first; on any EventSource error we tear it down and fall back to
   * polling `GET /api/jobs/{id}` every 750ms until the job reaches a terminal
   * status.
   */
  subscribeJob(id, onJob, onError) {
    let closed = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    let source: EventSource | undefined;

    const terminal = (job: Job) =>
      job.status === "done" ||
      job.status === "error" ||
      job.status === "cancelled";

    const stop = () => {
      closed = true;
      source?.close();
      if (poll) clearInterval(poll);
    };

    const startPolling = () => {
      if (closed || poll) return;
      const tick = async () => {
        if (closed) return;
        try {
          const job = await httpApi.getJob(id);
          onJob(job);
          if (terminal(job)) stop();
        } catch (err) {
          onError?.(err as Error);
          stop();
        }
      };
      poll = setInterval(tick, POLL_INTERVAL_MS);
      void tick();
    };

    try {
      source = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`);
      source.onmessage = (ev: MessageEvent<string>) => {
        try {
          const job = JSON.parse(ev.data) as Job;
          onJob(job);
          if (terminal(job)) stop();
        } catch {
          /* ignore malformed frame */
        }
      };
      source.onerror = () => {
        if (closed) return;
        source?.close();
        source = undefined;
        startPolling();
      };
    } catch {
      startPolling();
    }

    return stop;
  },

  listSounds: (query) =>
    request<SoundsPage>(`/api/sounds${qs(query as Record<string, unknown>)}`),

  getSound: (id) => request<Sound>(`/api/sounds/${encodeURIComponent(id)}`),

  updateSound: (id, patch) =>
    request<Sound>(`/api/sounds/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteSound: (id) =>
    request<void>(`/api/sounds/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  editSound: (id, req) =>
    request<Sound>(`/api/sounds/${encodeURIComponent(id)}/edit`, {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** Reveal the sound's WAV on disk — Explorer, Finder, or the Linux
   *  desktop's default file manager. Only makes sense locally, which is the
   *  only way Soundbox runs. */
  revealSound: (id) =>
    request<void>(`/api/sounds/${encodeURIComponent(id)}/reveal`, { method: "POST" }),

  separateSound: (modelId, sourceSoundId, stems = null) =>
    request<JobRef>("/api/separate", {
      method: "POST",
      body: JSON.stringify({ model: modelId, source_sound_id: sourceSoundId, stems }),
    }),

  repaintSound: (req) =>
    request<JobRef>("/api/repaint", { method: "POST", body: JSON.stringify(req) }),

  listTags: () => request<TagCount[]>("/api/tags"),

  getLogs: (lines = 200) => request<LogTail>(`/api/logs?lines=${lines}`),

  listSessions: (limit = 50) => request<Session[]>(`/api/sessions?limit=${limit}`),

  listConversations: (limit = 50) =>
    request<Conversation[]>(`/api/conversations?limit=${limit}`),

  conversationForStory: async (storyId) => {
    const found = await request<Conversation[]>(
      `/api/conversations?story_id=${encodeURIComponent(storyId)}`,
    );
    return found[0] ?? null;
  },

  createConversation: (title = null, storyId = null) =>
    request<Conversation>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ title, story_id: storyId }),
    }),

  conversationEntries: (id) =>
    request<HistoryEntry[]>(`/api/conversations/${encodeURIComponent(id)}/entries`),

  appendHistory: (id, entries) =>
    request<HistoryEntry[]>(`/api/conversations/${encodeURIComponent(id)}/entries`, {
      method: "POST",
      body: JSON.stringify({ entries }),
    }),

  renameConversation: (id, title) =>
    request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  deleteConversation: (id) =>
    request<void>(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),

  getSession: (id) => request<Session>(`/api/sessions/${encodeURIComponent(id)}`),

  renameSession: (id, title) =>
    request<Session>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  setSessionProject: (id, projectId) =>
    request<Session>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ project_id: projectId }),
    }),

  deleteSession: (id) =>
    request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listStories: (limit = 50) => request<Story[]>(`/api/stories?limit=${limit}`),

  getStory: (id) => request<Story>(`/api/stories/${encodeURIComponent(id)}`),

  createStory: (title, projectId, builder) =>
    request<Story>("/api/stories", {
      method: "POST",
      body: JSON.stringify({
        title: title ?? undefined,
        project_id: projectId ?? undefined,
        builder: builder ?? "script",
      }),
    }),

  renameStory: (id, title) =>
    request<Story>(`/api/stories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  setStoryProject: (id, projectId) =>
    request<Story>(`/api/stories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ project_id: projectId }),
    }),

  setStoryOptions: (id, options) =>
    request<Story>(`/api/stories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ request_options: options }),
    }),

  deleteStory: (id, deleteSounds = false) =>
    request<void>(
      `/api/stories/${encodeURIComponent(id)}${deleteSounds ? "?delete_sounds=true" : ""}`,
      { method: "DELETE" },
    ),

  listSegments: (storyId) =>
    request<StorySegment[]>(`/api/stories/${encodeURIComponent(storyId)}/segments`),

  createSegment: (storyId, req = {}) =>
    request<StorySegment>(`/api/stories/${encodeURIComponent(storyId)}/segments`, {
      method: "POST",
      body: JSON.stringify(req),
    }),

  updateSegment: (storyId, segmentId, patch) =>
    request<StorySegment>(
      `/api/stories/${encodeURIComponent(storyId)}/segments/${encodeURIComponent(segmentId)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),

  deleteSegment: (storyId, segmentId) =>
    request<void>(
      `/api/stories/${encodeURIComponent(storyId)}/segments/${encodeURIComponent(segmentId)}`,
      { method: "DELETE" },
    ),

  reorderSegments: (storyId, segmentIds) =>
    request<StorySegment[]>(`/api/stories/${encodeURIComponent(storyId)}/segments/reorder`, {
      method: "PUT",
      body: JSON.stringify({ segment_ids: segmentIds }),
    }),

  generateSegment: (storyId, segmentId, req) =>
    request<JobRef>(
      `/api/stories/${encodeURIComponent(storyId)}/segments/${encodeURIComponent(segmentId)}/generate`,
      { method: "POST", body: JSON.stringify(req) },
    ),

  splitSegment: (storyId, segmentId, atS) =>
    request<StorySegment[]>(
      `/api/stories/${encodeURIComponent(storyId)}/segments/${encodeURIComponent(segmentId)}/split`,
      { method: "POST", body: JSON.stringify({ at_s: atS }) },
    ),

  listTracks: (storyId) =>
    request<StoryTrack[]>(`/api/stories/${encodeURIComponent(storyId)}/tracks`),

  updateTrack: (storyId, trackIndex, patch) =>
    request<StoryTrack>(
      `/api/stories/${encodeURIComponent(storyId)}/tracks/${trackIndex}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),

  deleteTrack: (storyId, trackIndex) =>
    request<{ removed_clips: number }>(
      `/api/stories/${encodeURIComponent(storyId)}/tracks/${trackIndex}`,
      { method: "DELETE" },
    ),

  exportStory: (storyId) =>
    request<JobRef>(`/api/stories/${encodeURIComponent(storyId)}/export`, { method: "POST" }),

  storyFromSound: (soundId, separate = false, stems = null) =>
    request<JobRef>("/api/stories/from-sound", {
      method: "POST",
      body: JSON.stringify({ sound_id: soundId, separate, stems }),
    }),

  listProjects: () => request<Project[]>("/api/projects"),

  createProject: (name) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  deleteProject: (id) =>
    request<void>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listVoices: () => request<Voice[]>("/api/voices"),

  createVoice: (req) =>
    request<Voice>("/api/voices", { method: "POST", body: JSON.stringify(req) }),

  // The WAV is the whole body, so the name/notes ride as query params and the
  // Content-Type override stops `request` from labelling the bytes as JSON.
  uploadVoice: (name, file, notes, modelId, tidy) =>
    request<Voice>(
      `/api/voices/upload${qs({
        name,
        notes: notes ?? undefined,
        model_id: modelId ?? undefined,
        tidy: tidy ? "true" : undefined,
      })}`,
      {
        method: "POST",
        body: file,
        headers: { "Content-Type": "audio/wav" },
      },
    ),

  // Same shape as uploadVoice: the WAV is the whole body, so the name rides as
  // a query param and the Content-Type override stops `request` from
  // labelling the bytes as JSON.
  uploadSound: (name, file, source) =>
    request<Sound>(`/api/sounds/upload${qs({ name, source })}`, {
      method: "POST",
      body: file,
      headers: { "Content-Type": "audio/wav" },
    }),

  updateVoice: (id, patch) =>
    request<Voice>(`/api/voices/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteVoice: (id) =>
    request<void>(`/api/voices/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // One route, two bodies: raw WAV like uploadVoice, or JSON naming a sound.
  addVoiceSample: (voiceId, source, tidy) => {
    const path = `/api/voices/${encodeURIComponent(voiceId)}/samples`;
    if ("file" in source) {
      return request<Voice>(`${path}${qs({ tidy: tidy ? "true" : undefined })}`, {
        method: "POST",
        body: source.file,
        headers: { "Content-Type": "audio/wav" },
      });
    }
    return request<Voice>(path, {
      method: "POST",
      body: JSON.stringify({ source_sound_id: source.sourceSoundId, tidy: tidy ?? false }),
    });
  },

  deleteVoiceSample: (voiceId, sampleId) =>
    request<Voice>(
      `/api/voices/${encodeURIComponent(voiceId)}/samples/${encodeURIComponent(sampleId)}`,
      { method: "DELETE" },
    ),

  exportVoice: (id) =>
    request<VoiceExportFile>(`/api/voices/${encodeURIComponent(id)}/export`),

  importVoice: (file) =>
    request<Voice>("/api/voices/import", { method: "POST", body: JSON.stringify(file) }),

  speak: (req) =>
    request<JobRef>("/api/speak", { method: "POST", body: JSON.stringify(req) }),

  convert: (req) =>
    request<JobRef>("/api/convert", { method: "POST", body: JSON.stringify(req) }),

  browseDirectories: (path) =>
    request<DirectoryListing>(
      path ? `/api/fs/dirs?path=${encodeURIComponent(path)}` : "/api/fs/dirs",
    ),

  getSettings: () => request<Settings>("/api/settings"),

  updateSettings: (patch) =>
    request<Settings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  listProfiles: () => request<ProfileList>("/api/profiles"),

  createProfile: (name) =>
    request<Profile>("/api/profiles", { method: "POST", body: JSON.stringify({ name }) }),

  renameProfile: (id, name) =>
    request<Profile>(`/api/profiles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),

  activateProfile: (id) =>
    request<ProfileList>(`/api/profiles/${encodeURIComponent(id)}/activate`, { method: "POST" }),

  deleteProfile: (id, deleteData = false) =>
    request<void>(
      `/api/profiles/${encodeURIComponent(id)}${deleteData ? "?delete_data=1" : ""}`,
      { method: "DELETE" },
    ),

  enhancePrompt: (req) =>
    request<EnhanceResponse>("/api/enhance", { method: "POST", body: JSON.stringify(req) }),

  assistantChat: (req) =>
    request<AssistantChatResponse>("/api/assistant/chat", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  assistantOpeners: (req) =>
    request<AssistantOpenersResponse>("/api/assistant/openers", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  enhanceLyrics: (req) =>
    request<EnhanceLyricsResponse>("/api/enhance/lyrics", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  getLlmStatus: () => request<LlmStatus>("/api/llm/status"),

  getImageStatus: () => request<ImageStatus>("/api/image/status"),
  installImageEngine: () =>
    request<JobRef>("/api/image/engine/install", { method: "POST" }),
  listEndpoints: () => request<EndpointList>("/api/endpoints"),
  saveEndpoint: (id, input) =>
    request<AudioEndpoint>(`/api/endpoints/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteEndpoint: (id) =>
    request<void>(`/api/endpoints/${encodeURIComponent(id)}`, { method: "DELETE" }),
  testEndpoint: (input) =>
    request<EndpointTestResult>("/api/endpoints/test", { method: "POST", body: JSON.stringify(input) }),
  downloadImageModel: (id) =>
    request<JobRef>(`/api/image/models/${encodeURIComponent(id)}/download`, { method: "POST" }),
  deleteImageModel: (id) =>
    request<void>(`/api/image/models/${encodeURIComponent(id)}`, { method: "DELETE" }),
  generateSoundArtwork: (id) =>
    request<Sound>(`/api/sounds/${encodeURIComponent(id)}/artwork`, { method: "POST" }),
  clearSoundArtwork: (id) =>
    request<void>(`/api/sounds/${encodeURIComponent(id)}/artwork`, { method: "DELETE" }),
  generateVoiceArtwork: (id) =>
    request<Voice>(`/api/voices/${encodeURIComponent(id)}/artwork`, { method: "POST" }),
  clearVoiceArtwork: (id) =>
    request<void>(`/api/voices/${encodeURIComponent(id)}/artwork`, { method: "DELETE" }),

  installLlmEngine: () => request<JobRef>("/api/llm/engine/install", { method: "POST" }),

  downloadLlmModel: (id) =>
    request<JobRef>(`/api/llm/models/${encodeURIComponent(id)}/download`, { method: "POST" }),

  deleteLlmModel: (id) =>
    request<void>(`/api/llm/models/${encodeURIComponent(id)}`, { method: "DELETE" }),

  getMcpStatus: () => request<McpStatus>("/api/mcp/status"),

  listMcpCalls: (query) => request<McpCall[]>(`/api/mcp/calls${qs(query)}`),

  installSkills: (req) =>
    request<SkillInstallResult>("/api/mcp/skills/install", {
      method: "POST",
      body: JSON.stringify(req),
    }),
};

/* --------------------------------------------------------------- export */

export const IS_MOCK = import.meta.env.VITE_MOCK === "1";

import { mockApi } from "./mock";

export const api: SoundboxApi = IS_MOCK ? mockApi : httpApi;

/** Human-readable message for anything thrown by the API layer. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
