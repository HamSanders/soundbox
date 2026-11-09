/**
 * One adapter for every model `audio.cpp` can run.
 *
 * `audio.cpp` (https://github.com/0xShug0/audio.cpp) is a ggml-based C++
 * runtime that implements 50+ audio model families behind one CLI, with CUDA,
 * Metal, Vulkan and CPU backends. Inference needs no Python (and no Node)
 * runtime of its own, so the whole per-model cost collapses to one entry in
 * the catalog: a family name, a weights repo, and the metadata the UI card
 * shows.
 *
 * The trade is that we drive a subprocess rather than hold a model in VRAM, so
 * `load()` only resolves and validates paths — the weights land in VRAM inside
 * the child process for the duration of one generate and are released when it
 * exits. See docs/AUDIOCPP.md.
 *
 * Set up:
 *
 *     SOUNDBOX_AUDIOCPP_BIN=C:\tools\audio.cpp\audiocpp_cli.exe
 *     SOUNDBOX_AUDIOCPP_BACKEND=cuda     # optional; default auto-detects
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, readdir, rm, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { applyFades, decodeWav, frameCount, readWav, type Audio } from "../audio/dsp.js";
import { getLogger } from "../logging.js";
import {
  speechBody,
  type StreamSpeechEvent,
  type StreamTaskEvent,
  type TaskResult,
} from "./audiocppRuntime.js";
import { defaultDataDir, getConfig } from "../config.js";
import { downloadToFile } from "../download.js";
import { CancelledJob, ModelError, StreamUnsupported } from "../errors.js";
import {
  DEFAULT_SUPPORTS,
  type EditKind,
  type EditOptions,
  type ModelInfo,
  type ModelSupports,
  type LicenseInfo,
} from "../schemas.js";
import { BIN_ENV, detectBackend, findBinary } from "./audiocppBinary.js";
import { knownStreamingFamilies, refreshStreamingFamilies } from "./audiocppModes.js";
import { paramsFor } from "./params.js";
import type { SpeakOptions, StreamChunk } from "./types.js";

const log = getLogger("soundbox.audiocpp");

/** Binary discovery lives in `audiocppBinary.ts` — one module owns "where is
 *  the binary", whether the answer is a managed install or the user's own —
 *  but callers have always reached for it here, next to the model that runs
 *  it. Re-export rather than move every call site. */
export { BIN_ENV, findBinary };

/** Marker extra, not a package extra — audio.cpp is a native binary, so there
 *  is nothing for a package manager to install. */
export const EXTRA = "audio-cpp";

export const BACKEND_ENV = "SOUNDBOX_AUDIOCPP_BACKEND";

/** How long one generate may run before we assume the child is wedged. */
export const GENERATE_TIMEOUT_S = 1800.0;

/** The job a progress callback belongs to, so a running child can be killed
 *  when the job is cancelled. Same contract the Python side exposed by hanging
 *  a `.handle` attribute off the progress callable. */
export interface JobHandle {
  readonly cancelled: boolean;
}

export type ProgressFn = ((fraction: number, message: string) => void) & {
  handle?: JobHandle;
};

/**
 * Everything that differs between two audio.cpp-backed models.
 *
 * Adding a model means adding one of these. If that stops being true — if a
 * model needs a flag no other model needs — prefer a subclass over growing
 * this into a bag of optionals.
 */
export interface ModelSpec {
  id: string;
  name: string;
  vendor: string;
  description: string;
  /** audio.cpp's --family value, which selects the loader. */
  family: string;
  /**
   * The package id audio.cpp's own `model_specs/*.json` gives these weights,
   * e.g. "stable_audio_3_small_sfx_q8_0".
   *
   * This is what lets the runtime's package manager install and account for a
   * model instead of Soundbox re-deriving the download from `hf_repo` +
   * `weights_glob` — the two describe the same package, but only this one is
   * a name audio.cpp answers to. Null for a bring-your-own entry, which by
   * definition names no upstream package.
   */
  audiocpp_package_id: string | null;
  /**
   * The folder name audio.cpp installs this package into, relative to the
   * models root — e.g. "Stable-Audio-3-Small-SFX-GGUF", or the two-segment
   * "PocketTTS-GGUF/english".
   *
   * Soundbox used to nest weights under its own model id instead
   * (`<root>/audiocpp-stable-audio-3-sfx/…`), one level deeper than audio.cpp
   * looks. That extra level was the whole reason the two installs could not
   * see each other's downloads. Following upstream's layout is what makes a
   * shared models root actually shared — and it de-duplicates the packages
   * several catalog entries have in common (ACE-Step turbo, base and XL are
   * all one `ACE-Step1.5-GGUF`).
   */
  audiocpp_target_dir: string | null;
  /**
   * Repo prefix audio.cpp strips on the way in, so a repo path
   * `Chatterbox-GGUF/chatterbox-q8_0.gguf` lands as `chatterbox-q8_0.gguf`
   * inside the target directory. Null when the package's files are already
   * bare at the repo root (minimax_music3's dedicated repo).
   */
  audiocpp_strip_prefix: string | null;
  /** What kind of model this is, for the Generate composer's category tabs. */
  category: "sfx" | "music" | "voice" | "utility";
  /** Repo holding the GGUF weights. Empty for a bring-your-own model that
   *  points at `weights_path` instead — nothing to download. */
  hf_repo: string;
  /**
   * An absolute path to weights already on this machine, for a model the user
   * added themselves (see `<data dir>/models/custom.json`, docs/AUDIOCPP.md).
   *
   * When set it *is* the answer `weightsFile()` gives, so `hf_repo` /
   * `weights_glob` are unused and nothing is ever downloaded or deleted for
   * this model: the file belongs to the user, not to Soundbox's data dir. A
   * file for `weights_layout: "file"`, a directory for `"directory"`.
   */
  weights_path: string | null;
  /** Which file(s) in that repo this model needs. Keeps a multi-model GGUF
   *  repo from pulling every quantisation of every family. A list matches the
   *  union of its patterns, for models assembled from several files. */
  weights_glob: string[];
  /**
   * Whether `--model` wants a single GGUF or the directory holding a whole
   * package.
   *
   * "file" is the norm: one GGUF is the model, and `weightsFile()` picks the
   * largest match. "directory" is for families that load a *package* — several
   * required components plus JSON config — and resolve the parts themselves
   * from a directory root. Confirmed live against 0.6.1 for minimax_music3:
   * passing it a directory makes it look for `tokenizer/tokenizer.json`,
   * `tokenizer/tokenizer_config.json` and `config/language_model.json`
   * relative to that root, and passing it a lone .gguf is simply wrong — the
   * largest-match rule would hand it one of five components and drop the rest.
   */
  weights_layout: "file" | "directory";
  /**
   * Repo-relative paths that must all be present before a "directory" model
   * counts as downloaded. Unused when `weights_layout` is "file", where the
   * existence of a matching GGUF is the whole check.
   *
   * These are the binary's own preflight checks, discovered by running
   * `--inspect` against a directory and following what it asked for next — not
   * guessed from the repo listing.
   */
  weights_required: string[];
  /**
   * Repo-relative subdirectory that is the package's real root, for a
   * "directory" model whose files live under a prefix inside a shared repo.
   * The binary's package spec for minimax_h3 lists its files under
   * `MiniMax-H3-Q4-GGUF/` with a `strip_prefix` of the same — audio.cpp's own
   * downloader strips it, ours preserves repo paths, so `--model` has to point
   * at the subdirectory rather than the download root. Null for packages whose
   * repo root is the package root (minimax_music3's dedicated repo).
   */
  weights_root: string | null;
  license: LicenseInfo;
  max_duration_s: number;
  sample_rate: number;
  channels: number;
  vram_estimate_mb: number;
  /** Extra `--request-option key=value` pairs to pass verbatim, for anything a
   *  family needs that has no dedicated flag. The common generation parameters
   *  do have real flags (see `command()`), so this is normally empty — it is
   *  the escape hatch, not the mechanism. */
  request_options: Record<string, string>;
  /**
   * How to write a good prompt *for this model specifically*, in the second
   * person, appended to the prompt-assistant's system message when someone
   * enhances a prompt targeting it (see `llm/enhance.ts`).
   *
   * Lives in the catalog JSON rather than a table in code for the same reason
   * everything else here does: a model's prompting conventions are data about
   * that model, published in its own model card, and adding a model should
   * stay a JSON edit. Omit it and the loader family's generic guidance
   * applies instead — an unspecified guide is not a broken one.
   */
  prompt_guide?: string | null;
  defaults: Record<string, number>;
  supports: ModelSupports;
  max_cfg: number | null;
  gated: boolean;
  /** Which audio.cpp `--task` this family is driven through, and therefore
   *  which Model method and flag set applies:
   *
   *    "gen" — prompt → audio (`--text` as a *description*), generate()
   *    "sep" — existing audio → stems (`--audio`), separate()
   *    "tts" — script → speech (`--text` as *words to say*, plus a voice
   *            via `--voice-ref` clip or `--voice-id` built-in), speak()
   *    "vc"  — existing audio + target voice → audio in that voice
   *            (`--audio` + `--voice-ref`), convert()
   *
   *  The gen/tts split matters beyond the flag name: a gen model reads --text
   *  as "what the sound is like" and needs a duration, while a tts model reads
   *  it as "the words", and its length falls out of the script. */
  task: "gen" | "sep" | "tts" | "vc";
  /**
   * The literal `--task` value to send the binary, when it differs from
   * `task` above. `task` picks the Model *method* (speak() vs convert()) and
   * flag set; `cli_task` is what the family actually calls that mode in
   * `--list-loaders`. They agree for most `tts`/`vc` families, but not all —
   * confirmed live: Chatterbox's loader only registers `clon` and `vc`, no
   * `tts` at all, so a `--task tts` call is rejected outright with "Chatterbox
   * supports VoiceCloning and VoiceConversion" before it ever looks at
   * `--voice-ref`. Defaults to `task` when unset. */
  cli_task: string;
  /** Built-in voice names this family ships (audio.cpp's `--voice-id`), for
   *  families that have them. Empty means the only way to pick a voice is a
   *  reference clip. */
  voice_ids: string[];
  /**
   * Whether this family is cloning/conversion-only and has no default voice
   * to fall back to — a `speak()` call with neither `voiceRefPath` nor
   * `voiceId` isn't legal for it, unlike a family with a baked-in default
   * (e.g. VibeVoice). Confirmed against the real binary for Chatterbox: it
   * rejects the request with "Chatterbox supports VoiceCloning and
   * VoiceConversion" rather than falling back to any default, so this is data
   * worth catching before the subprocess runs, not just a nicety. */
  requires_voice_reference: boolean;
  /**
   * Whether this family requires its prompt to be speaker-tagged, i.e. every
   * line prefixed `Speaker N:`.
   *
   * VibeVoice is dialogue-native and *rejects* a bare line outright —
   * "VibeVoice prompt has no valid Speaker N: lines", confirmed against the
   * real binary — so this isn't a nicety, it's the difference between working
   * and failing. Data rather than a special case in speak(), because it's a
   * per-family fact like every other field here. */
  speaker_tagged_prompt: boolean;
  /**
   * Whether this family rejects a generation that carries no `--lyrics` at all.
   *
   * Distinct from `supports.lyrics`, which says lyrics are *accepted*:
   * minimax_music3 accepts them and also refuses to run without them, so a
   * prompt-only render needs an explicit instrumental marker supplied for the
   * user. Only meaningful when `supports.lyrics` is true.
   */
  lyrics_required: boolean;
  /**
   * The family's own request-option name for the target length, for a `gen`
   * family that does not accept the generic `duration_seconds` field.
   *
   * audio.cpp 0.9.x rejects any request option a family does not declare
   * ("unknown MiDashengLM-Gen request option: duration_seconds"), and only
   * some families map the generic field onto their own `duration_sec`. Null
   * (the default) sends the generic field, which every verified family takes.
   * Likewise a `gen` family with `supports.steps` / `supports.cfg` false is
   * sent no step count / guidance scale at all, rather than one it rejects.
   */
  duration_option: string | null;
  /**
   * audio.cpp `--task-route` names for the audio-to-audio edits this family
   * offers, keyed by the `EditKind` the API exposes. A family with no entry
   * for a kind must also not declare `supports.<kind>` — `command()` refuses
   * rather than silently rendering text2music.
   *
   * Confirmed live against ACE-Step (0.6.x): `cover` re-renders the clip in a
   * new style at the source's length; `repaint` regenerates a
   * `--repaint-start/--repaint-end` window. "extend" is *also* the repaint
   * route — a window that starts at the source's end and runs to
   * `--duration-seconds` returns the source bit-for-bit followed by the new
   * material (checked sample-by-sample). The docs' `complete` route does
   * not do that: it renders a fresh clip merely conditioned on the source,
   * with none of the source in it, so it is not what "extend" means here.
   */
  edit_routes: Partial<Record<EditKind, string>>;
  /** Whether someone has actually run this model end-to-end through this
   *  adapter and confirmed the flags take effect. False means the family
   *  exists in audio.cpp's --list-loaders output and a GGUF was found at
   *  weights_glob when the entry was written, but sample_rate, max_duration_s,
   *  defaults and request_options are still guesses. Gates whether the model
   *  appears without the user opting in — see CATALOG_EXTRA. */
  verified: boolean;
  /** "builtin" is the shipped catalog JSON; "custom" is the user's own
   *  `custom.json`. Custom entries are always shown (the user added them on
   *  purpose) but never claim to be verified — nobody here has run them. */
  source: "builtin" | "custom";
}

interface RawEntry {
  id: string;
  name: string;
  vendor: string;
  description: string;
  family: string;
  audiocpp_package_id?: string;
  audiocpp_target_dir?: string;
  audiocpp_strip_prefix?: string;
  category: "sfx" | "music" | "voice" | "utility";
  hf_repo?: string;
  weights_glob?: string | string[];
  weights_path?: string;
  weights_layout?: "file" | "directory";
  weights_required?: string[];
  weights_root?: string;
  license?: string | LicenseInfo;
  max_duration_s: number;
  sample_rate: number;
  channels: number;
  vram_estimate_mb: number;
  request_options?: Record<string, string>;
  defaults?: Record<string, number>;
  supports?: Partial<ModelSupports>;
  max_cfg?: number | null;
  gated?: boolean;
  task?: "gen" | "sep" | "tts" | "vc";
  cli_task?: string;
  voice_ids?: string[];
  requires_voice_reference?: boolean;
  lyrics_required?: boolean;
  duration_option?: string;
  edit_routes?: Partial<Record<EditKind, string>>;
  speaker_tagged_prompt?: boolean;
  verified?: boolean;
}

interface RawCatalog {
  licenses?: Record<string, LicenseInfo>;
  models?: RawEntry[];
  catalog_extra?: RawEntry[];
}

/**
 * The catalog file, whether we're running from `src/` under tsx or from
 * `dist/` after a build. `tsc` copies no JSON into the output tree, so the
 * built server reads the file back out of `src/` rather than us having to add
 * a copy step to the build.
 */
function catalogPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const local = join(here, "audiocpp_models_catalog.json");
  if (existsSync(local)) return local;
  return join(here, "..", "..", "src", "models", "audiocpp_models_catalog.json");
}

/**
 * Read MODELS / CATALOG_EXTRA from the JSON catalog.
 *
 * The catalog is data, not code, specifically so adding a model or fixing a
 * measured default is a JSON edit reviewable without touching this module. A
 * license field is either a string key into `licenses`, or an inline object
 * for a one-off (see the ACE-Step / HeartMuLa entries).
 */
function loadCatalog(path: string = catalogPath()): [ModelSpec[], ModelSpec[]] {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as RawCatalog;
  const spec = specReader(raw, "builtin");
  return [(raw.models ?? []).map(spec), (raw.catalog_extra ?? []).map(spec)];
}

/** The licence a user entry gets when it names none. Their own weights on
 *  their own disk: we have no basis to claim terms, and saying so is more
 *  honest than defaulting to permissive. */
const UNKNOWN_LICENSE: LicenseInfo = {
  name: "Unspecified",
  commercial: "no",
  url: "",
  note: "Added locally with no licence declared — check the weights' own terms before using output commercially.",
};

/** Builds the RawEntry -> ModelSpec reader for one catalog file, closing over
 *  that file's `licenses` table so a user catalog can define its own keys. */
function specReader(raw: RawCatalog, source: "builtin" | "custom") {
  const licenses = raw.licenses ?? {};

  const license = (value: string | LicenseInfo | undefined): LicenseInfo => {
    if (value === undefined) return UNKNOWN_LICENSE;
    if (typeof value === "string") {
      const found = licenses[value];
      if (!found) throw new Error(`audiocpp catalog: unknown license key '${value}'`);
      return found;
    }
    return value;
  };

  return (entry: RawEntry): ModelSpec => ({
    id: entry.id,
    name: entry.name,
    vendor: entry.vendor,
    description: entry.description,
    family: entry.family,
    audiocpp_package_id: entry.audiocpp_package_id ?? null,
    audiocpp_target_dir: entry.audiocpp_target_dir ?? null,
    audiocpp_strip_prefix: entry.audiocpp_strip_prefix ?? null,
    category: entry.category,
    hf_repo: entry.hf_repo ?? "",
    weights_path: entry.weights_path ?? null,
    weights_glob:
      entry.weights_glob === undefined
        ? []
        : Array.isArray(entry.weights_glob)
          ? [...entry.weights_glob]
          : [entry.weights_glob],
    weights_layout: entry.weights_layout ?? "file",
    weights_required: [...(entry.weights_required ?? [])],
    weights_root: entry.weights_root ?? null,
    license: license(entry.license),
    max_duration_s: entry.max_duration_s,
    sample_rate: entry.sample_rate,
    channels: entry.channels,
    vram_estimate_mb: entry.vram_estimate_mb,
    request_options: { ...(entry.request_options ?? {}) },
    defaults: { ...(entry.defaults ?? {}) },
    supports: { ...DEFAULT_SUPPORTS, ...(entry.supports ?? {}) },
    max_cfg: entry.max_cfg ?? null,
    gated: entry.gated ?? false,
    task: entry.task ?? "gen",
    cli_task: entry.cli_task ?? entry.task ?? "gen",
    voice_ids: [...(entry.voice_ids ?? [])],
    requires_voice_reference: entry.requires_voice_reference ?? false,
    lyrics_required: entry.lyrics_required ?? false,
    duration_option: entry.duration_option ?? null,
    edit_routes: entry.edit_routes ?? {},
    speaker_tagged_prompt: entry.speaker_tagged_prompt ?? false,
    // A user cannot mark their own entry verified: "verified" means someone
    // ran it end-to-end through this adapter and confirmed the numbers, which
    // is a claim about this project, not about the file on their disk.
    verified: source === "builtin" ? (entry.verified ?? false) : false,
    source,
  });
}

/**
 * MODELS: verified, shown unconditionally — everything here has been run
 * end-to-end (weights download, load, generate, decode) and its numbers
 * confirmed against real output, not just audio.cpp's docs.
 * CATALOG_EXTRA: cataloged but unverified, hidden until a user opts a specific
 * id in via Settings.enabled_audiocpp_models.
 */
export const [MODELS, CATALOG_EXTRA] = loadCatalog();

/* ------------------------------------------------------- the user's catalog */

/**
 * `<data dir>/models/custom.json` — bring your own model.
 *
 * Same shape as the shipped catalog (a `models` array, optionally its own
 * `licenses` table), because the shipped catalog is already data rather than
 * code: adding a model is a JSON edit, and there is no reason that edit has to
 * land in this repo. An entry may point at `weights_path` for weights already
 * on disk, or give `hf_repo`/`weights_glob` to have them pulled like any
 * other. See docs/AUDIOCPP.md.
 */
export function userCatalogPath(): string {
  let root: string;
  try {
    root = getConfig().paths.models;
  } catch {
    // Config not constructed yet (tests, CLI before startup) — same fallback
    // audiocppBinary.installRoot() uses.
    root = join(defaultDataDir(), "models");
  }
  return join(root, "custom.json");
}

let userCache: { key: string; specs: ModelSpec[] } | null = null;

/**
 * The user's own entries, re-read when the file changes.
 *
 * Cached on path + mtime + size rather than loaded once at import: this file
 * is edited by hand while the server is running, and making someone restart to
 * see their own model is exactly the friction the escape hatch exists to
 * remove. `modelSpecs()` is called on startup and on settings changes, not per
 * generation, so one `stat` is not a cost worth optimising away.
 *
 * A malformed file yields an empty list and a warning, never a throw. Refusing
 * to start over a stray comma in an optional file would be a worse failure
 * than the models quietly not appearing — the same call the corrupt-settings
 * path makes in config.ts.
 */
export function userModelSpecs(): ModelSpec[] {
  const path = userCatalogPath();
  let key: string;
  try {
    const st = statSync(path);
    key = `${path}:${st.mtimeMs}:${st.size}`;
  } catch {
    userCache = null;
    return [];
  }
  if (userCache?.key === key) return userCache.specs;

  let specs: ModelSpec[] = [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as RawCatalog;
    const spec = specReader(raw, "custom");
    const builtinIds = new Set([...MODELS, ...CATALOG_EXTRA].map((m) => m.id));
    const seen = new Set<string>();
    for (const entry of raw.models ?? []) {
      const problem = validateUserEntry(entry, seen);
      if (problem) {
        console.warn(`custom.json: skipping '${entry?.id ?? "(no id)"}' — ${problem}`);
        continue;
      }
      seen.add(entry.id);
      // Shadowing a shipped entry is allowed on purpose: pointing an id at
      // your own quantisation of the same model is a reason to be here. It is
      // surprising enough to say out loud, though.
      if (builtinIds.has(entry.id)) {
        console.warn(`custom.json: '${entry.id}' overrides the built-in model of the same id.`);
      }
      specs.push(spec(entry));
    }
  } catch (exc) {
    console.warn(`custom.json: ignored — ${exc instanceof Error ? exc.message : String(exc)}`);
    specs = [];
  }
  userCache = { key, specs };
  return specs;
}

/** Why one user entry can't be used, or null if it can. Only the fields with
 *  no sane default are checked — everything else falls back in `specReader`,
 *  and a wrong-but-present number is the user's to fix, not ours to police. */
function validateUserEntry(entry: RawEntry | undefined, seen: ReadonlySet<string>): string | null {
  if (!entry || typeof entry !== "object") return "not an object";
  for (const field of ["id", "name", "family"] as const) {
    if (typeof entry[field] !== "string" || !entry[field].trim()) return `missing '${field}'`;
  }
  if (seen.has(entry.id)) return "duplicate id within custom.json";
  if (!entry.weights_path && !entry.hf_repo) {
    return "needs either 'weights_path' (weights already on disk) or 'hf_repo' + 'weights_glob'";
  }
  if (entry.weights_path && !isAbsolute(entry.weights_path)) {
    return "'weights_path' must be an absolute path";
  }
  if (!entry.weights_path && !entry.weights_glob) return "'hf_repo' given without 'weights_glob'";
  return null;
}

/** Built-ins plus the user's own, the latter winning on id collision. */
export function catalog(): ModelSpec[] {
  const user = userModelSpecs();
  const shadowed = new Set(user.map((s) => s.id));
  return [...MODELS.filter((s) => !shadowed.has(s.id)),
          ...CATALOG_EXTRA.filter((s) => !shadowed.has(s.id)),
          ...user];
}

export function catalogById(): Map<string, ModelSpec> {
  return new Map(catalog().map((spec) => [spec.id, spec]));
}

/**
 * Specs for MODELS plus any CATALOG_EXTRA id the user enabled.
 *
 * An id in `enabledExtraIds` that no longer matches a catalog entry (a stale
 * settings.json after a catalog edit) is silently dropped rather than raised —
 * the alternative is Soundbox refusing to start over one leftover setting,
 * which is a worse failure than the model quietly not appearing.
 */
export function modelSpecs(enabledExtraIds: ReadonlySet<string> = new Set()): ModelSpec[] {
  const user = userModelSpecs();
  const shadowed = new Set(user.map((s) => s.id));
  return [
    ...MODELS.filter((s) => !shadowed.has(s.id)),
    ...CATALOG_EXTRA.filter((s) => enabledExtraIds.has(s.id) && !shadowed.has(s.id)),
    // No opt-in gate for the user's own entries: writing them into custom.json
    // *is* the opt-in, and a second toggle in Settings would only be a way to
    // wonder why your model isn't listed.
    ...user,
  ];
}

/* --------------------------------------------------------------- the binary */

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Which ggml backend to ask for. An explicit override wins; otherwise
 * best-effort detection (see audiocppBinary.detectBackend, which documents the
 * deviation from the Python's torch-based probe). Never fails: a wrong guess
 * costs speed, an exception costs the generation.
 */
export function backend(): string {
  const override = (process.env[BACKEND_ENV] ?? "").trim();
  if (override) return override;
  return detectBackend();
}

/* -------------------------------------------------------------- progress */

// audio.cpp reports sampler progress on stderr. The format is not a stable
// contract, so treat a miss as "no progress detail" rather than an error — the
// bracketing progress() calls in generate() still move the bar.
const STEP_RE = /\b(\d+)\s*\/\s*(\d+)\b/;
const PCT_RE = /\b(\d{1,3})(?:\.\d+)?\s*%/;

export function parseProgress(line: string): number | null {
  const step = STEP_RE.exec(line);
  if (step) {
    const done = Number(step[1]);
    const total = Number(step[2]);
    if (total > 0) return Math.min(1.0, done / total);
  }
  const pct = PCT_RE.exec(line);
  if (pct) return Math.min(1.0, Number(pct[1]) / 100.0);
  return null;
}

/* ------------------------------------------------------------------ globs */

/**
 * `Path.rglob(pattern)` semantics: the pattern matches a trailing run of path
 * components, so a multi-segment glob like `Foo-GGUF/bar-q8_0.gguf` matches at
 * any depth under the root.
 */
function rglobRegex(pattern: string): RegExp {
  const body = pattern
    .split("/")
    .map((segment) =>
      segment === "**"
        ? "\u0000DOUBLE\u0000"
        : segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"),
    )
    .join("/")
    .replace(/\u0000DOUBLE\u0000\//g, "(?:.*/)?")
    .replace(/\u0000DOUBLE\u0000/g, ".*");
  return new RegExp(`(?:^|.*/)${body}$`);
}

/** A predicate matching any of `patterns`, for specs that list several. */
function rglobMatcher(patterns: string[]): (rel: string) => boolean {
  const res = patterns.map(rglobRegex);
  return (rel) => res.some((re) => re.test(rel));
}

/** An audio-to-audio edit for `generate()`: which route, on which clip. */
export interface EditSpec {
  kind: EditKind;
  sourceAudioPath: string;
  /** Length of the clip at `sourceAudioPath`, which is where an "extend"
   *  repaint window starts. */
  sourceDurationS: number;
  options: EditOptions;
}

/** What a `lyrics_required` family is given when the user wants no vocal. The
 *  binary only checks that --lyrics is present, so this is a readable marker
 *  rather than a magic value the loader parses. */
const INSTRUMENTAL_LYRICS = "[instrumental]";

/** audio.cpp's own line matcher, copied from the binary: `^Speaker\s+(\d+)\s*:` */
const SPEAKER_TAG_RE = /^Speaker\s+\d+\s*:/;

/**
 * Prefix every non-empty line with `Speaker 1:`, for families that demand it.
 *
 * Lines that already carry a tag are left alone, so a user who writes the
 * dialogue format by hand — which is how VibeVoice's own docs describe it —
 * doesn't end up with `Speaker 1: Speaker 2: ...`.
 */
function tagSpeaker(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      // Deliberately the binary's own regex, verbatim: a looser test here
      // passes `speaker1: hi` through untagged and audio.cpp rejects the whole
      // prompt with "no valid Speaker N: lines". Anything it would not accept
      // gets tagged.
      return SPEAKER_TAG_RE.test(trimmed) ? trimmed : `Speaker 1: ${trimmed}`;
    })
    .filter(Boolean)
    .join("\n");
}

async function walkFiles(root: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walkFiles(join(root, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

/* ---------------------------------------------------------------- model */

/**
 * Drives one `audio.cpp` model family through the audiocpp_cli binary.
 *
 * Deviation from the Python, which synthesised one `AudioCppModel` subclass
 * per catalog entry via `type()` so each model could be a class the registry
 * held. Nothing in the Node port needs a class per model — the spec is the
 * only thing that varies — so this is one class composed over a ModelSpec, and
 * the manager holds instances rather than constructors.
 */
interface GenerateOptions {
  negativePrompt?: string | null;
  seed?: number | null;
  steps?: number | null;
  cfg?: number | null;
  lyrics?: string | null;
  trackName?: string | null;
  /** Run an audio-to-audio route on an existing clip instead of a plain
   *  render. The clip must already be at `spec.sample_rate`. */
  edit?: EditSpec | null;
  progress?: ProgressFn;
}

/** A base64 WAV from the task API, decoded the same way a file would be. */
function decodeAudio(b64: string): { audio: Audio; sampleRate: number } {
  return decodeWav(Buffer.from(b64, "base64"));
}

/**
 * Share of samples pinned at audio.cpp's ±1 clamp, before any normalising.
 *
 * Measured on Stable Audio 3 SFX: clean renders sit at 0–0.4%, a deliberately
 * distorted "huge explosion" prompt at 1.5%, a broken render at 5–80%.
 */
export function railFraction(audio: Audio): number {
  let hits = 0;
  let total = 0;
  for (const ch of audio) {
    for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i]) >= 0.999) hits++;
    total += ch.length;
  }
  return total ? hits / total : 0;
}

/** Above this, a render is the clamped noise `retrySaturated` exists for. */
export const SATURATED_RAIL_FRACTION = 0.02;
/** 0.1s steps; the longest clean gap measured was 0.5s (0.5s → 1.0s). */
const SATURATION_RETRIES = 8;

/** Cut a longer re-render back to the asked-for length, fading the new end. */
function cutTo(audio: Audio, sampleRate: number, durationS: number): Audio {
  const frames = Math.min(frameCount(audio), Math.round(durationS * sampleRate));
  if (frames >= frameCount(audio)) return audio;
  const cut = audio.map((ch) => ch.slice(0, frames));
  return applyFades(cut, sampleRate, 0, Math.min(0.02, durationS / 4));
}

/**
 * The slice of audio.cpp's package manager this model needs.
 *
 * Declared structurally rather than imported so `audiocpp.ts` stays free of
 * the child-process machinery in `audiocppRuntime.ts` — and so a test can hand
 * in a stub without a server anywhere near it.
 */
export interface PackageInstaller {
  /** Install `packageId`; false means this build has no package manager. */
  installPackage(
    packageId: string,
    modelsRoot: string,
    backend: string | null,
    progress?: ProgressFn,
    signal?: AbortSignal,
  ): Promise<boolean>;
  deletePackage(packageId: string, modelsRoot: string, backend: string | null): Promise<boolean>;

  /* The inference half. Optional so a stub that only cares about downloads —
   * or a future host that cannot run models — still satisfies the type, and so
   * every call site has to think about the fallback. */

  /** Make weights resident. False means no management on this build. */
  loadModel?(
    req: {
      id: string;
      path: string;
      family: string;
      task: string;
      mode?: string;
      loadOptions?: Record<string, string>;
    },
    modelsRoot: string,
    backend: string | null,
  ): Promise<boolean>;
  unloadModel?(id: string, modelsRoot: string, backend: string | null): Promise<void>;
  /** Run one request against a resident model; null means unavailable. */
  runTask?(
    body: Record<string, unknown>,
    modelsRoot: string,
    backend: string | null,
    progress?: { handle?: { cancelled: boolean } },
  ): Promise<TaskResult | null>;
  /** Stream one request through a resident streaming entry; null means
   *  unavailable. See `AudioCppRuntime.streamTask`. */
  streamTask?(
    body: Record<string, unknown>,
    modelsRoot: string,
    backend: string | null,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<StreamTaskEvent> | null>;
  /** Stream one TTS line over `/v1/audio/speech`: raw PCM, no format. */
  streamSpeech?(
    body: Record<string, unknown>,
    modelsRoot: string,
    backend: string | null,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<StreamSpeechEvent> | null>;
  /** Whether `id` is loaded in the server process running now. False once
   *  the process it was loaded into has exited or been replaced. */
  isResident?(id: string): boolean;
}

/**
 * Request options a family needs for a streaming run. VoxCPM2 refuses to
 * stream with `retry_badcase` on ("retrying a completed bad case is an
 * offline-only behaviour", upstream), and its default is on.
 */
const STREAM_REQUEST_OPTIONS: Record<string, Record<string, string>> = {
  voxcpm2: { retry_badcase: "false" },
};

export class AudioCppModel {
  readonly spec: ModelSpec;
  readonly modelsDir: string;
  /** Root that audio.cpp packages are installed under — `<models>/audiocpp`
   *  for a managed install, or the user's own audio.cpp models folder when
   *  they've pointed us at one. See `Settings.effectiveAudiocppModelsDir`. */
  readonly audiocppRoot: string;
  /**
   * audio.cpp's own package manager, when one is wired up.
   *
   * Injected rather than reached for globally so that constructing a model for
   * metadata — the CLI, the error path in `ModelManager.listInfo`, the tests —
   * can never accidentally spawn a server. Null means "use the built-in
   * downloader", which is exactly the pre-delegation behaviour.
   */
  readonly installer: PackageInstaller | null;
  hfToken: string | null;

  /** Weights on this machine, driven by a local binary — see `ModelProvider`. */
  readonly provider = "local" as const;

  /** The resolved GGUF path once loaded. */
  private model: string | null = null;
  /** The id this model is registered under in the runtime, when it is actually
   *  resident. Null means inference goes through a one-shot CLI call. */
  private residentId: string | null = null;
  /** The `<id>::stream` entry, when a streaming copy is resident. */
  private streamResidentId: string | null = null;
  /** The rate and layout this model's speech comes out at, learned from the
   *  first WAV it returns. `/v1/audio/speech` streams raw PCM with no header,
   *  so without this the stream can't say what it's sending. The catalogue's
   *  `sample_rate` isn't trusted for it: VoxCPM2 is listed at 44.1 kHz and
   *  speaks at 48. */
  private speechFormat: { sampleRate: number; channels: number } | null = null;
  error: string | null = null;

  readonly extras = [EXTRA];
  /** There is nothing for a package manager to install — the dependency is a
   *  prebuilt audiocpp_cli binary the user fetches themselves. */
  readonly autoInstallable = false;
  readonly manualInstallReason =
    "This model runs on audio.cpp, a native binary rather than a Python " +
    "package — there is nothing for pip to install. Run " +
    "`soundbox model install audiocpp`, or download a prebuilt " +
    "audiocpp_cli from the audio.cpp releases page and set " +
    "SOUNDBOX_AUDIOCPP_BIN to it.";

  constructor(
    spec: ModelSpec,
    modelsDir: string,
    hfToken: string | null = null,
    audiocppRoot?: string,
    installer: PackageInstaller | null = null,
  ) {
    this.spec = spec;
    this.modelsDir = modelsDir;
    this.installer = installer;
    // Defaulted rather than required so the callers that only want metadata —
    // `describe()` on the error path, the CLI, the tests — keep working
    // without threading settings through.
    this.audiocppRoot = audiocppRoot ?? join(modelsDir, "audiocpp");
    this.hfToken = hfToken;
  }

  get id(): string {
    return this.spec.id;
  }

  get loaded(): boolean {
    return this.model !== null;
  }

  /* --------------------------------------------------------- metadata */

  describe(): ModelInfo {
    const s = this.spec;
    return {
      id: s.id,
      name: s.name,
      vendor: s.vendor,
      description: s.description,
      license: s.license,
      hf_repo: s.hf_repo,
      gated: s.gated,
      family: s.family,
      params: paramsFor(s.family),
      task: s.task,
      voice_ids: [...s.voice_ids],
      requires_voice_reference: s.requires_voice_reference,
      category: s.category,
      max_duration_s: s.max_duration_s,
      sample_rate: s.sample_rate,
      channels: s.channels,
      supports: {
        ...s.supports,
        streaming: s.task === "tts" && knownStreamingFamilies().has(s.family),
      },
      defaults: { ...s.defaults },
      max_cfg: s.max_cfg,
      vram_estimate_mb: s.vram_estimate_mb,
      extras: [EXTRA],
      provider: "local",
      status: "not_installed",
      installed_deps: false,
      auto_installable: this.autoInstallable,
      manual_install_reason: this.manualInstallReason,
    };
  }

  async depsInstalled(): Promise<boolean> {
    return (await findBinary()) !== null;
  }

  async requireDeps(): Promise<void> {
    if ((await findBinary()) !== null) return;
    throw new ModelError(
      `${this.spec.name} runs on the audio.cpp binary, which isn't on ` +
        `this machine yet.\n\n` +
        `Download a prebuilt audiocpp_cli from ` +
        `https://github.com/0xShug0/audio.cpp/releases (Windows CUDA/CPU packages, ` +
        `or \`brew install audio-cpp\` on macOS), then point Soundbox at it:\n` +
        `    ${BIN_ENV}=/path/to/audiocpp_cli` +
        (process.platform === "win32" ? ".exe" : ""),
    );
  }

  /**
   * The status the UI card shows: error beats loaded beats installed, and
   * "weights on disk but no runtime" is called out separately from
   * "not installed" because the remedies are unrelated — installing the
   * runtime is not downloading a model.
   */
  async status(): Promise<ModelInfo> {
    await refreshStreamingFamilies();
    const info = this.describe();
    info.installed_deps = await this.depsInstalled();
    const downloaded = await this.isDownloaded();
    if (this.error) {
      info.status = "error";
      info.error = this.error;
    } else if (this.loaded) {
      info.status = "loaded";
    } else if (downloaded && info.installed_deps) {
      info.status = "installed";
    } else if (downloaded) {
      info.status = "needs_runtime";
    } else if (await this.hasPartialWeights()) {
      info.status = "incomplete";
    } else {
      info.status = "not_installed";
    }
    return info;
  }

  /**
   * Whether this entry's own weights are partly on disk while `weightsFile()`
   * still finds nothing to run. Only this entry's files count: several
   * catalog entries can share one package folder (ACE-Step Turbo and Base
   * both live in ACE-Step1.5-GGUF), so "the folder is not empty" would mark
   * Base incomplete the moment Turbo is installed.
   *
   * - A directory package with some, but not all, of its required files.
   * - A file package with a leftover `.part` of a file matching its glob,
   *   which a transfer that was killed rather than failed leaves behind.
   */
  private async hasPartialWeights(): Promise<boolean> {
    if (this.spec.weights_path) return false;
    const root = this.weightsDir();
    if (!existsSync(root)) return false;
    if (this.spec.weights_layout === "directory") {
      const required = this.spec.weights_required
        .map((rel) => this.onDisk(rel))
        .filter((rel): rel is string => Boolean(rel));
      const present = required.filter((rel) => existsSync(join(root, ...rel.split("/"))));
      return present.length > 0 && present.length < required.length;
    }
    const match = rglobMatcher(this.spec.weights_glob.map((g) => this.onDisk(g)));
    for (const rel of await walkFiles(root)) {
      if (rel.endsWith(".part") && match(rel.slice(0, -".part".length))) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------- weights */

  /**
   * The package's folder on disk.
   *
   * audio.cpp's own layout — `<root>/<target_directory>` — so that a models
   * root shared with a standalone audio.cpp is genuinely shared. Falls back to
   * the model id for a bring-your-own entry, which names no upstream package
   * and therefore has a folder to itself.
   */
  weightsDir(): string {
    const target = this.spec.audiocpp_target_dir;
    return target ? join(this.audiocppRoot, ...target.split("/")) : join(this.audiocppRoot, this.spec.id);
  }

  /**
   * A repo-relative path as it lands inside `weightsDir()`.
   *
   * audio.cpp drops the package's `strip_prefix` on install, so the prefix
   * that appears in `weights_glob` (which is written against the repo) is not
   * part of the on-disk path. Without this the globs would look for
   * `Chatterbox-GGUF/Chatterbox-GGUF/…`.
   */
  private onDisk(repoPath: string): string {
    const prefix = this.spec.audiocpp_strip_prefix;
    if (!prefix) return repoPath;
    if (repoPath === prefix) return "";
    return repoPath.startsWith(`${prefix}/`) ? repoPath.slice(prefix.length + 1) : repoPath;
  }

  /**
   * What this model should hand to --model, if it's on disk.
   *
   * For a "file" model that's the largest matching GGUF: a repo ships several
   * quantisations of one model, and we take quality first, since VRAM is what
   * this path already saves.
   *
   * For a "directory" model it's the weights directory itself, and "largest
   * match" would be actively wrong — the matches are *different components*
   * (encoder, transformer, vocoder…), not sizes of one thing, so picking one
   * silently drops the rest. Readiness is `weights_required` being present
   * instead, which is the binary's own preflight list.
   */
  async weightsFile(): Promise<string | null> {
    // A bring-your-own model's weights are wherever the user put them, and
    // "is it there" is the whole readiness check — no glob, no largest-match:
    // they named one exact path.
    if (this.spec.weights_path) {
      const path = this.spec.weights_path;
      const kind = this.spec.weights_layout === "directory" ? "isDirectory" : "isFile";
      try {
        return (await stat(path))[kind]() ? path : null;
      } catch {
        return null;
      }
    }
    const root = this.weightsDir();
    if (this.spec.weights_layout === "directory") {
      for (const rel of this.spec.weights_required) {
        const disk = this.onDisk(rel);
        if (disk && !existsSync(join(root, ...disk.split("/")))) return null;
      }
      // `weights_root` pointed at the subdirectory the prefix created back
      // when we preserved repo paths. Stripping the prefix *is* that step now,
      // so the package root and the weights directory are the same folder —
      // except for a bring-your-own entry, which has no prefix to strip.
      return this.spec.audiocpp_target_dir === null && this.spec.weights_root
        ? join(root, ...this.spec.weights_root.split("/"))
        : root;
    }
    const matches: { path: string; size: number }[] = [];
    const match = rglobMatcher(this.spec.weights_glob.map((g) => this.onDisk(g)));
    for (const rel of await walkFiles(root)) {
      if (!match(rel)) continue;
      const path = join(root, ...rel.split("/"));
      matches.push({ path, size: (await stat(path)).size });
    }
    matches.sort((a, b) => b.size - a.size);
    return matches.length ? matches[0]!.path : null;
  }

  async isDownloaded(): Promise<boolean> {
    return (await this.weightsFile()) !== null;
  }

  async download(progress?: ProgressFn, signal?: AbortSignal): Promise<void> {
    // Nothing to fetch for a local model — either the path the user gave is
    // there or it isn't, and saying which is more use than a download that
    // can't happen. Deliberately not a silent success: the UI's Download
    // button ends up here, and it has to mean something.
    if (this.spec.weights_path) {
      if ((await this.weightsFile()) === null) {
        const kind = this.spec.weights_layout === "directory" ? "directory" : "file";
        throw new ModelError(
          `${this.spec.name} points at local weights that aren't there: ` +
            `${this.spec.weights_path} is not a ${kind}. Fix 'weights_path' for ` +
            `'${this.spec.id}' in ${userCatalogPath()}.`,
        );
      }
      progress?.(1.0, "Using local weights");
      return;
    }

    // Preferred path: let audio.cpp install its own package. It already knows
    // this package from `model_specs`, it writes the manifest that makes the
    // result recognisable to any other audio.cpp, and it is the reason a
    // shared models root stays consistent between the two installs. Returns
    // false when this build has no package manager, which is not an error —
    // just a cue to fetch the files ourselves, below.
    const pkg = this.spec.audiocpp_package_id;
    if (this.installer && pkg) {
      progress?.(0.02, `Asking audio.cpp for ${pkg}`);
      const handled = await this.installer.installPackage(
        pkg,
        this.audiocppRoot,
        backend(),
        progress,
        signal,
      );
      if (handled) {
        progress?.(1.0, "Download complete");
        return;
      }
    }

    progress?.(0.02, `Fetching ${this.spec.weights_glob.join(", ")} from ${this.spec.hf_repo}`);
    try {
      await this.fetchWeights(progress);
    } catch (exc) {
      if (exc instanceof ModelError || exc instanceof CancelledJob) throw exc;
      throw new ModelError(explainHfError(exc, this.spec));
    }

    if ((await this.weightsFile()) === null) {
      if (this.spec.weights_layout === "directory") {
        const root = this.weightsDir();
        const missing = this.spec.weights_required.filter(
          (rel) => !existsSync(join(root, ...rel.split("/"))),
        );
        throw new ModelError(
          `${this.spec.name}'s download is incomplete — ${this.spec.hf_repo} did not ` +
            `supply: ${missing.join(", ")}. This model loads a package rather than a ` +
            `single GGUF; check https://huggingface.co/${this.spec.hf_repo} for the ` +
            `current layout.`,
        );
      }
      throw new ModelError(
        `${this.spec.hf_repo} has no file matching '${this.spec.weights_glob.join(", ")}'. ` +
          `The GGUF conversion for ${this.spec.name} may not be published yet — check ` +
          `https://huggingface.co/${this.spec.hf_repo} for the current filenames.`,
      );
    }
    progress?.(1.0, "Download complete");
  }

  /**
   * Pull just the files matching `weights_glob`.
   *
   * The GGUF repos are shared across every family audio.cpp supports; without
   * the pattern filter we'd pull tens of GB to run one model.
   */
  private async fetchWeights(progress?: ProgressFn): Promise<void> {
    const { listFiles } = await import("@huggingface/hub");
    const credentials = this.hfToken ? { accessToken: this.hfToken } : undefined;
    const match = rglobMatcher(this.spec.weights_glob);

    const wanted: { path: string; size: number }[] = [];
    for await (const file of listFiles({
      repo: { type: "model", name: this.spec.hf_repo },
      recursive: true,
      credentials,
    })) {
      if (file.type === "file" && match(file.path)) {
        wanted.push({ path: file.path, size: file.lfs?.size ?? file.size ?? 0 });
      }
    }
    if (wanted.length === 0) return; // download() reports the empty-match case

    const root = this.weightsDir();
    for (const [index, { path, size }] of wanted.entries()) {
      const url = `https://huggingface.co/${this.spec.hf_repo}/resolve/main/${path}`;
      // Strip the package prefix on the way in, exactly as audio.cpp's own
      // installer does, so a package fetched by this fallback path is
      // indistinguishable on disk from one the runtime installed.
      const dest = join(root, ...this.onDisk(path).split("/"));
      // Streamed to `<dest>.part` and renamed into place — a multi-gigabyte
      // GGUF never sits in memory, and `weightsFile()` never finds half of
      // one. The size the repo listing gave is the size it has to be.
      await downloadToFile(url, dest, {
        headers: this.hfToken ? { Authorization: `Bearer ${this.hfToken}` } : {},
        expectedBytes: size,
        onProgress: (done, total) => {
          if (progress && total) {
            // Held inside 5%-95% so the bar never claims completion before the
            // file is finalised on disk.
            const fileFrac = (index + Math.min(1, done / total)) / wanted.length;
            progress(
              0.05 + 0.9 * fileFrac,
              `Downloading — ${fmtBytes(done)} of ${fmtBytes(total)}`,
            );
          }
        },
      });
    }
  }

  /* -------------------------------------------------------- lifecycle */

  /**
   * Resolve the weights and, where the runtime can, make them resident.
   *
   * This used to be bookkeeping — it resolved a path and called that "loaded",
   * because every generation was its own process. Now it really can put a
   * model in VRAM, which is what stops the next generation paying ~8.5s of
   * startup and load. When the runtime has no management endpoints, the old
   * meaning still applies and inference falls back to the CLI.
   */
  async load(progress?: ProgressFn): Promise<void> {
    if (this.loaded) return;
    await this.requireDeps();
    const weights = await this.weightsFile();
    if (weights === null) {
      throw new ModelError(`${this.spec.name}'s weights are not downloaded yet.`);
    }
    progress?.(0.3, "Checking audio.cpp");

    if (this.installer?.loadModel) {
      progress?.(0.5, `Loading ${this.spec.name}`);
      await this.makeResident(weights);
    }

    this.model = weights;
    progress?.(1.0, "Ready");
  }

  /** Load `weights` into the runtime; leaves `residentId` null if it can't. */
  private async makeResident(weights: string): Promise<void> {
    this.residentId = null;
    if (!this.installer?.loadModel) return;
    try {
      const resident = await this.installer.loadModel(
        {
          id: this.spec.id,
          path: weights,
          family: this.spec.family,
          task: this.cliTask,
        },
        this.audiocppRoot,
        backend(),
      );
      if (resident) this.residentId = this.spec.id;
    } catch (exc) {
      // A model that will not load into the server is not necessarily a
      // model that will not run: the CLI path allocates differently and may
      // still manage it. Fall back rather than fail the load outright.
      process.stderr.write(
        `${this.spec.id}: audio.cpp could not hold it resident, using the CLI — ${String(exc)}
`,
      );
    }
  }

  async unload(): Promise<void> {
    const resident = this.residentId;
    const streamResident = this.streamResidentId;
    this.residentId = null;
    this.streamResidentId = null;
    this.model = null;
    if (resident && this.installer?.unloadModel) {
      await this.installer.unloadModel(resident, this.audiocppRoot, backend());
    }
    if (streamResident && this.installer?.unloadModel) {
      await this.installer.unloadModel(streamResident, this.audiocppRoot, backend());
    }
  }

  /** audio.cpp's task name for this model — the gen path hardcodes "gen". */
  private get cliTask(): string {
    return this.spec.task === "gen" ? "gen" : (this.spec.cli_task ?? this.spec.task);
  }

  /**
   * Run one request against the resident model, or null to use the CLI.
   *
   * The body mirrors the CLI flags with dashes turned to underscores, which is
   * what the task API accepts; unknown keys are ignored by the runtime, so a
   * field a family does not use costs nothing.
   */
  private async serverRun(
    body: Record<string, unknown>,
    progress?: ProgressFn,
  ): Promise<TaskResult | null> {
    if (!this.residentId || !this.installer?.runTask || this.model === null) return null;
    const installer = this.installer;
    const runTask = installer.runTask!.bind(installer);

    // The server process this model was loaded into can be gone by now —
    // cancelled, idle-stopped, or replaced because the models folder changed —
    // and a fresh one knows nothing of it. Load again rather than send a
    // request that can only come back "unknown model id".
    if (installer.isResident && !installer.isResident(this.residentId)) {
      progress?.(0.02, `Reloading ${this.spec.name}`);
      await this.makeResident(this.model);
      if (!this.residentId) return null;
    }

    const run = () =>
      runTask(
        { ...body, model: this.residentId, family: this.spec.family },
        this.audiocppRoot,
        backend(),
        progress,
      );

    progress?.(0.05, `Running ${this.spec.name}`);
    let result: TaskResult | null;
    try {
      result = await run();
    } catch (exc) {
      // One retry, only for a model the runtime has lost: the process died
      // under the request (a settings change restarted it), or a server we did
      // not start fresh answers that it never heard of this id. A cancel kills
      // the process too, but that is the user's answer, not a fault.
      if (exc instanceof CancelledJob) throw exc;
      const lost =
        /unknown model id/i.test(String(exc)) ||
        (installer.isResident !== undefined && !installer.isResident(this.residentId));
      if (!lost) throw exc;
      process.stderr.write(`${this.spec.id}: audio.cpp lost the model, reloading — ${String(exc)}
`);
      await this.makeResident(this.model);
      if (!this.residentId) return null;
      result = await run();
    }
    if (result === null) return null;
    progress?.(0.97, "Decoding");
    return result;
  }

  /* --------------------------------------------------------- inference */

  /**
   * `command()`'s argument list as a task-API body.
   *
   * Kept deliberately parallel to `command()` below, flag for flag, because
   * the two have to mean the same thing: whichever path a request takes, the
   * audio must come out the same. Read them side by side when changing either.
   */
  private genBody(
    prompt: string,
    durationS: number,
    options: {
      negativePrompt?: string | null;
      seed?: number | null;
      steps?: number | null;
      cfg?: number | null;
      lyrics?: string | null;
      trackName?: string | null;
      edit?: EditSpec | null;
    },
  ): Record<string, unknown> {
    const s = this.spec;
    const edit = options.edit ?? null;
    const route = edit ? s.edit_routes[edit.kind] : null;
    if (edit && !route) throw new ModelError(`${s.name} cannot ${edit.kind} an existing sound.`);

    const requestOptions: Record<string, string> = {};
    for (const [key, value] of Object.entries(s.request_options)) {
      if (key !== "negative_prompt") requestOptions[key] = value;
    }
    const negKey = s.request_options["negative_prompt"];
    if (options.negativePrompt && negKey) requestOptions[negKey] = options.negativePrompt;

    const body: Record<string, unknown> = { task: "gen", text: prompt };
    if (s.supports.steps !== false) {
      body["num_inference_steps"] = Math.trunc(options.steps || s.defaults["steps"]!);
    }
    if (s.supports.cfg !== false) body["guidance_scale"] = options.cfg ?? s.defaults["cfg"]!;
    // A cover keeps the source's length, so a target duration would mislead.
    if (edit?.kind !== "cover") {
      const length = Math.min(durationS, s.max_duration_s);
      if (s.duration_option) requestOptions[s.duration_option] = length.toFixed(3);
      else body["duration_seconds"] = length;
    }
    if (options.seed !== null && options.seed !== undefined) body["seed"] = options.seed;

    if (edit && route) {
      body["task_route"] = route;
      body["audio"] = edit.sourceAudioPath;
      const o = edit.options;
      if (edit.kind === "cover" && o.cover_strength != null) {
        requestOptions["audio_cover_strength"] = o.cover_strength.toFixed(3);
      }
      if (edit.kind === "repaint") {
        body["repaint_start"] = o.repaint_start_s ?? 0;
        body["repaint_end"] = o.repaint_end_s ?? 0;
        if (o.repaint_mode) body["repaint_mode"] = o.repaint_mode;
        if (o.repaint_strength != null) body["repaint_strength"] = o.repaint_strength;
      }
      if (edit.kind === "extend") {
        body["repaint_start"] = edit.sourceDurationS;
        body["repaint_end"] = Math.min(durationS, s.max_duration_s);
      }
    }
    if (s.supports.lyrics) {
      const words = options.lyrics || (s.lyrics_required ? INSTRUMENTAL_LYRICS : null);
      if (words) {
        body["lyrics"] = words;
        if (options.trackName) body["track_name"] = options.trackName;
      }
    }
    // `options` is the key audio.cpp reads (app/cli/request.cpp); `request_options`
    // was silently ignored, so every per-family knob was dropped on this path.
    if (Object.keys(requestOptions).length) body["options"] = requestOptions;
    return body;
  }

  private async command(
    weights: string,
    out: string,
    prompt: string,
    durationS: number,
    negativePrompt: string | null,
    seed: number | null,
    steps: number | null,
    cfg: number | null,
    lyrics: string | null,
    trackName: string | null,
    edit: EditSpec | null,
  ): Promise<string[]> {
    const binary = await findBinary();
    if (binary === null) throw new ModelError("audiocpp_cli disappeared mid-generation.");
    const s = this.spec;
    const route = edit ? s.edit_routes[edit.kind] : null;
    if (edit && !route) {
      throw new ModelError(`${s.name} cannot ${edit.kind} an existing sound.`);
    }
    // A cover does *not* keep the source's length on its own.
    //
    // This used to suppress `--duration-seconds` for a cover, on the belief
    // that audio.cpp locked the route to the source. Measured against
    // ACE-Step 1.5 turbo (audio.cpp 0.6.1) it does not: with the flag absent
    // the output is arbitrarily shorter than the source, and by a ratio that
    // is not even constant — 3.6s in gave 2.35s back, 7.7s gave 3.93s, 13.1s
    // gave 5.34s. Passing the source's own duration gives 7.68s for a 7.70s
    // source, which is the whole fix.
    //
    // It matters most to whatever lines a cover up against its source — the
    // studio stacks the two on adjacent lanes — but it was always wrong: a
    // cover that silently returns half the clip is not a cover of it.
    //
    // The length comes from the source rather than from `durationS`, because
    // a cover's length is not a thing the caller gets to choose: it is the
    // clip being covered. Callers that already send the source's duration
    // (the composer's own `startEdit`) are unaffected; one that sends
    // something else no longer silently gets a differently-sized render.
    const coverDurationS = edit?.kind === "cover" ? edit.sourceDurationS : null;
    const cmd = [
      binary,
      "--task", "gen",
      "--family", s.family,
      "--model", weights,
      "--backend", backend(),
      "--text", prompt,
      "--out", out,
      // Without --log the binary is silent until it finishes, so the UI would
      // show a frozen bar for the whole render.
      "--log",
      // Wall time / audio duration / RTF, which is exactly the number this
      // path has to justify itself on. Cheap, so always on.
      "--metrics",
    ];
    if (s.supports.steps !== false) {
      cmd.push("--num-inference-steps", String(Math.trunc(steps || s.defaults["steps"]!)));
    }
    if (s.supports.cfg !== false) {
      cmd.push("--guidance-scale", (cfg ?? s.defaults["cfg"]!).toFixed(3));
    }
    const length = Math.min(coverDurationS ?? durationS, s.max_duration_s).toFixed(3);
    if (s.duration_option) cmd.push("--request-option", `${s.duration_option}=${length}`);
    else cmd.push("--duration-seconds", length);
    if (seed !== null && seed !== undefined) cmd.push("--seed", String(seed));
    if (edit && route) {
      // Same flag as separate(): `--audio` is the source clip for edit routes,
      // `--source-audio` is something else (path-based voice/style refs).
      cmd.push("--task-route", route, "--audio", edit.sourceAudioPath);
      const o = edit.options;
      if (edit.kind === "cover" && o.cover_strength != null) {
        cmd.push("--request-option", `audio_cover_strength=${o.cover_strength.toFixed(3)}`);
      }
      if (edit.kind === "repaint") {
        cmd.push(
          "--repaint-start", String(o.repaint_start_s ?? 0),
          "--repaint-end", String(o.repaint_end_s ?? 0),
        );
        if (o.repaint_mode) cmd.push("--repaint-mode", o.repaint_mode);
        if (o.repaint_strength != null) cmd.push("--repaint-strength", o.repaint_strength.toFixed(3));
      }
      if (edit.kind === "extend") {
        // Repaint everything past the source's end, up to the requested
        // total length (see `edit_routes`). The start is the source's own
        // length so nothing of it is touched.
        const end = Math.min(durationS, s.max_duration_s);
        cmd.push(
          "--repaint-start", edit.sourceDurationS.toFixed(3),
          "--repaint-end", end.toFixed(3),
        );
      }
    }
    // Lyrics-conditioned vocal generation. Families that ignore the field
    // entirely must not be handed it, so gate on the spec rather than trusting
    // the caller not to pass it.
    //
    // `lyrics_required` families reject a request with no --lyrics at all
    // ("MiniMax Music 3 requires lyrics", confirmed live), which would make a
    // plain prompt-only render impossible. The flag merely has to be present —
    // both "[instrumental]" and a bare space satisfy it — so an absent lyric
    // becomes an explicit instrumental marker rather than an error the user
    // can do nothing about from a prompt box.
    if (s.supports.lyrics) {
      const words = lyrics || (s.lyrics_required ? INSTRUMENTAL_LYRICS : null);
      if (words) {
        cmd.push("--lyrics", words);
        if (trackName) cmd.push("--track-name", trackName);
      }
    }
    // No --negative-prompt flag exists; families that support one take it as a
    // request option. Left out of the catalog until confirmed per family, since
    // a silently-ignored key reads as "negative prompt does nothing".
    const negKey = s.request_options["negative_prompt"];
    if (negativePrompt && negKey) {
      cmd.push("--request-option", `${negKey}=${negativePrompt}`);
    }
    for (const [key, value] of Object.entries(s.request_options)) {
      if (key !== "negative_prompt") cmd.push("--request-option", `${key}=${value}`);
    }
    return cmd;
  }

  async generate(
    prompt: string,
    durationS: number,
    options: GenerateOptions = {},
  ): Promise<Awaited<ReturnType<typeof readWav>>> {
    if (this.spec.task !== "gen") {
      const method = { sep: "separate()", tts: "speak()", vc: "convert()" }[this.spec.task];
      throw new ModelError(
        `${this.spec.name} is a --task ${this.spec.task} model; use ${method}, not generate().`,
      );
    }
    if (!this.loaded) await this.load();

    const first = await this.renderOnce(prompt, durationS, options);
    // Only plain Stable Audio renders: an edit's length is pinned to its
    // source, and no other family has shown this failure.
    if (this.spec.family !== "stable_audio" || options.edit) return first;
    return await this.retrySaturated(first, prompt, durationS, options);
  }

  /**
   * Re-render a Stable Audio clip that came back as a square wave.
   *
   * audio.cpp's stable_audio (0.6.1, CPU and CUDA alike) blows up at some
   * requested durations: the decoder output lands far outside [-1, 1], the
   * runtime clamps it, and what is left is rail-to-rail noise with a crest
   * factor under 1 dB. It depends on the duration and not the seed — every
   * seed at 0.8s fails, every seed at 1.0s is fine — and is scattered rather
   * than a floor (3.7s and 4.7s fail too), so no length table can avoid it.
   * Changing `duration_padding_seconds` does not help, which puts it in the
   * seconds conditioning rather than the latent size.
   *
   * A nudged duration does render cleanly, so this retries in 0.1s steps
   * upwards and cuts the result back to what was asked for. Upwards so the
   * clip still fills the requested length; cut with a short fade so the
   * shortened tail does not click.
   */
  private async retrySaturated(
    first: { audio: Audio; sampleRate: number },
    prompt: string,
    durationS: number,
    options: GenerateOptions,
  ): Promise<{ audio: Audio; sampleRate: number }> {
    let best = first;
    let bestRail = railFraction(first.audio);
    for (let step = 1; bestRail > SATURATED_RAIL_FRACTION && step <= SATURATION_RETRIES; step++) {
      const nudged = Math.round((durationS + step * 0.1) * 1000) / 1000;
      if (nudged > this.spec.max_duration_s) break;
      options.progress?.(0.5, `Re-rendering (output clipped at ${durationS}s)`);
      const take = await this.renderOnce(prompt, nudged, options);
      const rail = railFraction(take.audio);
      log.warning(
        `${this.spec.id}: ${durationS}s render clipped (${(railFraction(first.audio) * 100).toFixed(1)}% ` +
          `at the rail); retried at ${nudged}s: ${(rail * 100).toFixed(1)}%`,
      );
      if (rail < bestRail) {
        best = { audio: cutTo(take.audio, take.sampleRate, durationS), sampleRate: take.sampleRate };
        bestRail = rail;
      }
    }
    if (bestRail > SATURATED_RAIL_FRACTION) {
      throw new ModelError(
        `${this.spec.name} produced clipped noise at ${durationS}s and at every nearby length ` +
          `tried. Try a slightly different duration.`,
      );
    }
    return best;
  }

  private async renderOnce(
    prompt: string,
    durationS: number,
    options: GenerateOptions,
  ): Promise<{ audio: Audio; sampleRate: number }> {
    const weights = this.model!;
    const { progress } = options;

    const served = await this.serverRun(
      this.genBody(prompt, durationS, options),
      progress,
    );
    if (served?.audio) return decodeAudio(served.audio);

    const tmp = await mkdtemp(join(tmpdir(), "soundbox-audiocpp-"));
    try {
      const out = join(tmp, "out.wav");
      const cmd = await this.command(
        weights,
        out,
        prompt,
        durationS,
        options.negativePrompt ?? null,
        options.seed ?? null,
        options.steps ?? null,
        options.cfg ?? null,
        options.lyrics ?? null,
        options.trackName ?? null,
        options.edit ?? null,
      );
      progress?.(0.05, "Starting audio.cpp");
      const tail = await runChild(cmd, progress);

      if (!(await isFile(out))) {
        throw new ModelError(`audio.cpp finished but wrote no audio.\n\n${tail}`);
      }
      progress?.(0.97, "Decoding");
      return await readWav(out);
    } finally {
      // Windows: a cancelled or killed audiocpp_cli can still hold out.wav open
      // for a moment after exiting, and a strict delete then raises from the
      // cleanup path — replacing the CancelledJob (or the real ggml error) the
      // caller needs to see with a confusing filesystem error. A stray temp
      // file is the strictly better failure, hence `force`.
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Speak a script via `--task tts`.
   *
   * The shape differs from generate() in more than the task name. `--text` is
   * the words to say rather than a description of a sound, so there is no
   * duration to request — the length falls out of the script. The voice comes
   * from either a reference clip (`--voice-ref`, cloning) or one of the
   * family's built-in voices (`--voice-id`); passing neither is legal and
   * gives the family's default voice.
   *
   * `steps`/`cfg` are still forwarded when the family declares them, since the
   * diffusion-based TTS families (VibeVoice, IndexTTS2) do use them.
   */
  /** The `/v1/tasks/run` body for one TTS line — shared by `speak` and
   *  `speakStream` so a streamed read honours the same voice and options. */
  private ttsBody(text: string, options: SpeakOptions): Record<string, unknown> {
    const s = this.spec;
    const body: Record<string, unknown> = {
      task: this.cliTask,
      // Dialogue-native families reject an untagged line outright.
      text: s.speaker_tagged_prompt ? tagSpeaker(text) : text,
    };
    if (options.voiceRefPath) body["voice_ref"] = options.voiceRefPath;
    else if (options.voiceId) body["voice_id"] = options.voiceId;
    if (options.seed !== null && options.seed !== undefined) body["seed"] = options.seed;
    if (s.supports.steps && options.steps) {
      body["num_inference_steps"] = Math.trunc(options.steps);
    }
    if (s.supports.cfg && options.cfg !== null && options.cfg !== undefined) {
      body["guidance_scale"] = options.cfg;
    }
    const requestOptions = { ...s.request_options, ...(options.requestOptions ?? {}) };
    // `options` is the key audio.cpp reads (app/cli/request.cpp); `request_options`
    // was silently ignored, so every per-family knob was dropped on this path.
    if (Object.keys(requestOptions).length) body["options"] = requestOptions;
    return body;
  }

  /**
   * Speak one line, yielding audio as audio.cpp produces it.
   *
   * audio.cpp fixes a model entry's run mode at load time, so streaming uses a
   * second resident entry (`<id>::stream`, `mode: "streaming"`) alongside the
   * offline one. That costs the weights twice in memory while both are held;
   * `unload()` drops both. A family with no streaming session fails that load,
   * which is reported as "can't stream" rather than faked by chunking a
   * finished render — the latency is the whole point.
   */
  async *speakStream(
    text: string,
    options: SpeakOptions & { signal: AbortSignal },
  ): AsyncGenerator<StreamChunk> {
    if (this.spec.task !== "tts") {
      throw new ModelError(`${this.spec.name} is not a text-to-speech model.`);
    }
    if (this.spec.requires_voice_reference && !options.voiceRefPath && !options.voiceId) {
      throw new ModelError(`${this.spec.name} is a cloning-only voice — pick a voice to stream with.`);
    }
    if (Object.keys(options.loadOptions ?? {}).length) {
      throw new StreamUnsupported(
        `Streaming can't use load options (they pick a weights variant at load time).`,
      );
    }
    const installer = this.installer;
    if (!installer?.loadModel || !installer.streamTask) {
      throw new StreamUnsupported(
        `This audio.cpp build has no model server, so it can't stream. Use /api/speak instead.`,
      );
    }
    if (!this.loaded) await this.load();
    const weights = this.model!;
    const streamId = `${this.spec.id}::stream`;
    if (this.streamResidentId === null || (installer.isResident && !installer.isResident(streamId))) {
      try {
        const ok = await installer.loadModel(
          { id: streamId, path: weights, family: this.spec.family, task: this.cliTask, mode: "streaming" },
          this.audiocppRoot,
          backend(),
        );
        if (!ok) throw new Error("no model server");
      } catch (exc) {
        this.streamResidentId = null;
        throw new StreamUnsupported(
          `${this.spec.name} can't stream on this build of audio.cpp (${String(exc instanceof Error ? exc.message : exc)}).`,
        );
      }
      this.streamResidentId = streamId;
    }

    // Some families need a request option set for a streaming run that an
    // offline read must not have; the caller's own value still wins.
    const streamOptions = {
      ...(STREAM_REQUEST_OPTIONS[this.spec.family] ?? {}),
      ...(options.requestOptions ?? {}),
    };
    const body = {
      ...this.ttsBody(text, { ...options, requestOptions: streamOptions }),
      model: streamId,
      family: this.spec.family,
    };

    // The live route, once we know what format it speaks in.
    const format = this.speechFormat;
    if (format && installer.streamSpeech) {
      const pcm = await installer.streamSpeech(
        speechBody(body),
        this.audiocppRoot,
        backend(),
        options.signal,
      );
      if (pcm !== null) {
        for await (const event of pcm) {
          if (event.kind === "done") {
            yield { kind: "done", ttftMs: event.ttftMs };
            continue;
          }
          const audio = fromPcm16(event.pcm, format.channels);
          if (frameCount(audio) === 0) continue;
          yield { kind: "audio", audio, sampleRate: format.sampleRate };
        }
        return;
      }
    }

    // First stream for this model: the task route, whose WAVs carry the
    // format. It may hold every chunk to the end (it does on current builds),
    // but a first stream is paying for two model loads anyway.
    const events = await installer.streamTask(body, this.audiocppRoot, backend(), options.signal);
    if (events === null) {
      throw new StreamUnsupported(`audio.cpp's model server isn't available, so it can't stream.`);
    }
    for await (const event of events) {
      if (event.kind === "done") {
        yield { kind: "done", ttftMs: event.ttftMs };
        continue;
      }
      if (!event.audio) continue;
      const { audio, sampleRate } = decodeAudio(event.audio);
      if (frameCount(audio) === 0) continue;
      this.speechFormat = { sampleRate, channels: audio.length };
      yield { kind: "audio", audio, sampleRate };
    }
  }

  async speak(
    text: string,
    options: {
      voiceRefPath?: string | null;
      voiceId?: string | null;
      seed?: number | null;
      steps?: number | null;
      cfg?: number | null;
      loadOptions?: Record<string, string>;
      /**
       * Per-request knobs from this family's own parameter list — Chatterbox's
       * `exaggeration`, IndexTTS2's `emotion_text`, a sampler `temperature`.
       *
       * Separate from `loadOptions` because they belong to this read rather
       * than to the loaded weights, and passed as `--request-option` because
       * that is the only form audio.cpp honours: `--temperature` handed to a
       * family that lists `temperature` does nothing at all. That trap is why
       * this parameter exists. See models/params.ts.
       */
      requestOptions?: Record<string, string>;
      progress?: ProgressFn;
    } = {},
  ): Promise<Awaited<ReturnType<typeof readWav>>> {
    if (this.spec.task !== "tts") {
      throw new ModelError(
        `${this.spec.name} is a --task ${this.spec.task} model; speak() needs a --task tts model.`,
      );
    }
    if (this.spec.requires_voice_reference && !options.voiceRefPath && !options.voiceId) {
      throw new ModelError(
        `${this.spec.name} is a cloning-only voice — it has no default voice to fall back ` +
          `to. Attach a reference audio clip (or pick a voice id, if it has one) before generating.`,
      );
    }
    if (!this.loaded) await this.load();
    const weights = this.model!;
    const { progress } = options;
    const s = this.spec;

    // `load_options` pick a weights *variant* (PocketTTS' `language=spanish`),
    // which a resident model has already committed to. Rather than silently
    // speak Spanish in English, hand a request that asks for a different
    // variant back to the CLI, which loads exactly what it was told to.
    const wantsVariant = Object.keys(options.loadOptions ?? {}).length > 0;
    if (!wantsVariant) {
      const body = this.ttsBody(text, options);

      const served = await this.serverRun(body, progress);
      if (served?.audio) {
        const decoded = decodeAudio(served.audio);
        this.speechFormat = { sampleRate: decoded.sampleRate, channels: decoded.audio.length };
        return decoded;
      }
    }

    const binary = await findBinary();
    if (binary === null) throw new ModelError("audiocpp_cli disappeared mid-generation.");

    const tmp = await mkdtemp(join(tmpdir(), "soundbox-audiocpp-tts-"));
    try {
      const out = join(tmp, "out.wav");
      const cmd = [
        binary,
        "--task", s.cli_task,
        "--family", s.family,
        "--model", weights,
        "--backend", backend(),
        // Dialogue-native families reject an untagged line outright, so the
        // tag is added here rather than pushed onto every caller. One call is
        // always one speaker's turn (see the service's per-line loop), hence
        // a constant "Speaker 1" rather than a running index.
        "--text", s.speaker_tagged_prompt ? tagSpeaker(text) : text,
        "--out", out,
        "--log",
        "--metrics",
      ];
      // A reference clip wins over a built-in name: if the caller went to the
      // trouble of supplying audio to clone, honouring a --voice-id instead
      // would silently ignore it.
      if (options.voiceRefPath) cmd.push("--voice-ref", options.voiceRefPath);
      else if (options.voiceId) cmd.push("--voice-id", options.voiceId);
      if (options.seed !== null && options.seed !== undefined) {
        cmd.push("--seed", String(options.seed));
      }
      if (s.supports.steps && options.steps) {
        cmd.push("--num-inference-steps", String(Math.trunc(options.steps)));
      }
      if (s.supports.cfg && options.cfg !== null && options.cfg !== undefined) {
        cmd.push("--guidance-scale", options.cfg.toFixed(3));
      }
      // e.g. PocketTTS' `language=spanish`, which selects a weights variant at
      // load time rather than per request.
      for (const [key, value] of Object.entries(options.loadOptions ?? {})) {
        cmd.push("--load-option", `${key}=${value}`);
      }
      // The caller's choices win over the catalog's defaults for a shared key:
      // a per-line `exaggeration` is a deliberate answer to a question the
      // catalog only had a default for.
      for (const [key, value] of Object.entries({
        ...s.request_options,
        ...(options.requestOptions ?? {}),
      })) {
        cmd.push("--request-option", `${key}=${value}`);
      }

      progress?.(0.05, "Starting audio.cpp");
      const tail = await runChild(cmd, progress);
      if (!(await isFile(out))) {
        throw new ModelError(`audio.cpp finished but wrote no audio.\n\n${tail}`);
      }
      progress?.(0.97, "Decoding");
      return await readWav(out);
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Re-voice an existing clip via `--task vc`.
   *
   * Both inputs are audio: `--audio` is the performance to keep (timing,
   * prosody, words) and `--voice-ref` is the voice to say it in. No text is
   * involved at all, which is what separates this from speak().
   */
  async convert(
    sourceWavPath: string,
    voiceRefPath: string,
    options: { seed?: number | null; progress?: ProgressFn } = {},
  ): Promise<Awaited<ReturnType<typeof readWav>>> {
    if (this.spec.task !== "vc") {
      throw new ModelError(
        `${this.spec.name} is a --task ${this.spec.task} model; convert() needs a --task vc model.`,
      );
    }
    if (!this.loaded) await this.load();
    const weights = this.model!;
    const { progress } = options;

    {
      const body: Record<string, unknown> = {
        task: this.cliTask,
        audio: sourceWavPath,
        voice_ref: voiceRefPath,
      };
      if (options.seed !== null && options.seed !== undefined) body["seed"] = options.seed;
      if (Object.keys(this.spec.request_options).length) {
        body["options"] = { ...this.spec.request_options };
      }
      const served = await this.serverRun(body, progress);
      if (served?.audio) return decodeAudio(served.audio);
    }

    const binary = await findBinary();
    if (binary === null) throw new ModelError("audiocpp_cli disappeared mid-conversion.");

    const tmp = await mkdtemp(join(tmpdir(), "soundbox-audiocpp-vc-"));
    try {
      const out = join(tmp, "out.wav");
      const cmd = [
        binary,
        "--task", this.spec.cli_task,
        "--family", this.spec.family,
        "--model", weights,
        "--backend", backend(),
        "--audio", sourceWavPath,
        "--voice-ref", voiceRefPath,
        "--out", out,
        "--log",
        "--metrics",
      ];
      if (options.seed !== null && options.seed !== undefined) {
        cmd.push("--seed", String(options.seed));
      }
      for (const [key, value] of Object.entries(this.spec.request_options)) {
        cmd.push("--request-option", `${key}=${value}`);
      }

      progress?.(0.05, "Starting audio.cpp");
      const tail = await runChild(cmd, progress);
      if (!(await isFile(out))) {
        throw new ModelError(`audio.cpp finished but wrote no audio.\n\n${tail}`);
      }
      progress?.(0.97, "Decoding");
      return await readWav(out);
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Split an existing audio file into stems via `--task sep`.
   *
   * Unlike generate(), the source is a file already on disk (an existing
   * library Sound), not a text prompt, and the binary writes one WAV per stem
   * into --out-dir rather than a single --out file. Stem naming is whatever
   * the loader family emits (e.g. htdemucs' vocals/drums/bass/other) — read
   * back whatever landed in the directory rather than assuming a fixed set,
   * since that hasn't been confirmed against a real run yet (see
   * docs/AUDIOCPP.md).
   */
  async separate(
    sourceWavPath: string,
    options: { progress?: ProgressFn } = {},
  ): Promise<{ stemName: string; audio: Awaited<ReturnType<typeof readWav>> }[]> {
    if (this.spec.task !== "sep") {
      const method = { gen: "generate()", tts: "speak()", vc: "convert()" }[this.spec.task];
      throw new ModelError(
        `${this.spec.name} is a --task ${this.spec.task} model; use ${method}, not separate().`,
      );
    }
    if (!this.loaded) await this.load();
    const weights = this.model!;
    const { progress } = options;

    {
      // Separation is the one task with several outputs. The runtime answers
      // with `named_audio_outputs`, one entry per stem, named by whatever the
      // loader produced — the same openness the directory listing below has,
      // so neither path assumes vocals/drums/bass/other.
      const served = await this.serverRun({ task: "sep", audio: sourceWavPath }, progress);
      const outputs = served?.named_audio_outputs;
      if (outputs?.length) {
        return outputs.map((out: { id?: string; audio: string }, i: number) => ({
          stemName: out.id || `stem_${i + 1}`,
          audio: decodeAudio(out.audio),
        }));
      }
      if (served) {
        throw new ModelError(`${this.spec.name} ran but produced no stems.`);
      }
    }

    const binary = await findBinary();
    if (binary === null) throw new ModelError("audiocpp_cli disappeared mid-separation.");

    const tmp = await mkdtemp(join(tmpdir(), "soundbox-audiocpp-sep-"));
    try {
      const outDir = join(tmp, "stems");
      await mkdir(outDir, { recursive: true });
      const cmd = [
        binary,
        "--task", "sep",
        "--family", this.spec.family,
        "--model", weights,
        "--backend", backend(),
        // Confirmed against a real htdemucs run: --source-audio is for
        // path-based *reference* inputs (voice conversion, style transfer);
        // plain sep's actual input is --audio. --source-audio produced "sep
        // requires an audio contract" instead of a real error.
        "--audio", sourceWavPath,
        "--out-dir", outDir,
        "--log",
        "--metrics",
      ];
      progress?.(0.05, "Starting audio.cpp");
      const tail = await runChild(cmd, progress);

      const files = (await readdir(outDir)).filter((f) => f.toLowerCase().endsWith(".wav")).sort();
      if (!files.length) {
        throw new ModelError(`audio.cpp finished but wrote no stems.\n\n${tail}`);
      }
      progress?.(0.97, "Decoding stems");
      const stems: { stemName: string; audio: Awaited<ReturnType<typeof readWav>> }[] = [];
      for (const file of files) {
        // "vocals.wav" -> "vocals"; whatever base name the loader chose.
        const stemName = file.replace(/\.wav$/i, "");
        stems.push({ stemName, audio: await readWav(join(outDir, file)) });
      }
      return stems;
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Ask the binary what this model's loader actually accepts.
   *
   * A development aid, not part of the model contract: `request_options` is
   * hand-written, and this is how you check it against reality without reading
   * audio.cpp's source.
   */
  async inspectOptions(): Promise<string> {
    await this.requireDeps();
    const weights = await this.weightsFile();
    if (weights === null) throw new ModelError("Download the weights first.");
    const binary = (await findBinary())!;
    return await runChild(
      [binary, "--inspect", "--family", this.spec.family, "--model", weights],
      undefined,
      120,
    );
  }
}

/** How often the CLI watchdog checks for cancellation and the deadline. */
const CHILD_WATCHDOG_MS = 500;
/** How long a killed child gets to exit before it is killed harder. */
const CHILD_KILL_GRACE_MS = 5_000;
/** The most of an unterminated line kept while waiting for its newline. A
 *  child that never prints one would otherwise grow the buffer forever. */
const CHILD_LINE_CAP = 64 * 1024;

/**
 * Run the child, forwarding progress and honouring cancellation.
 *
 * Cancellation matters more here than in an in-process model: an orphaned
 * audiocpp_cli keeps a GPU busy with nobody waiting on it, and the next queued
 * job then contends for VRAM the manager believes is free.
 *
 * Cancellation and the deadline are checked on a timer, not only when the
 * child prints something: a child that has gone silent — stuck loading, or
 * redrawing one progress line with bare `\r` — is exactly the one that needs
 * killing, and it is the one that never gives a line-driven check a turn.
 *
 * Exported for tests.
 */
export function runChild(
  cmd: string[],
  progress?: ProgressFn,
  timeoutS: number = GENERATE_TIMEOUT_S,
): Promise<string> {
  const handle = progress?.handle;
  const deadline = Date.now() + timeoutS * 1000;
  const recent: string[] = [];

  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd[0]!, cmd.slice(1), {
      windowsHide: true, // keeps a console window from flashing up per generation
      stdio: ["ignore", "pipe", "pipe"],
    });

    let failure: Error | null = null;
    let buffer = "";
    let exited = false;
    let hardKill: NodeJS.Timeout | null = null;

    const fail = (exc: Error): void => {
      if (failure) return;
      failure = exc;
      child.kill();
      // A child that ignores the polite signal still has to go: the GPU it
      // holds is the reason cancellation exists.
      hardKill = setTimeout(() => {
        if (!exited) child.kill("SIGKILL");
      }, CHILD_KILL_GRACE_MS);
      hardKill.unref();
    };

    const watchdog = setInterval(() => {
      if (handle?.cancelled) fail(new CancelledJob());
      else if (Date.now() >= deadline) {
        fail(new ModelError(`audio.cpp did not finish within ${timeoutS.toFixed(0)}s.`));
      }
    }, CHILD_WATCHDOG_MS);
    const stopTimers = (): void => {
      exited = true;
      clearInterval(watchdog);
      if (hardKill) clearTimeout(hardKill);
    };

    const onLine = (raw: string): void => {
      const line = raw.replace(/\s+$/, "");
      if (line) {
        recent.push(line);
        if (recent.length > 40) recent.splice(0, recent.length - 40);
      }
      if (handle?.cancelled) return fail(new CancelledJob());
      if (Date.now() >= deadline) {
        return fail(
          new ModelError(`audio.cpp did not finish within ${timeoutS.toFixed(0)}s.`),
        );
      }
      const frac = parseProgress(line);
      if (progress && frac !== null) {
        // Held inside the 5%-95% band the bracketing calls use, so the bar
        // never claims completion before the WAV is read.
        progress(0.05 + 0.9 * frac, "Sampling");
      }
    };

    // stderr is merged into stdout: audio.cpp writes progress to stderr and
    // metrics to stdout, and the error tail wants both interleaved.
    const feed = (chunk: Buffer): void => {
      buffer += chunk.toString("utf-8");
      // A bare \r ends a line too: progress bars redraw in place with it, and
      // splitting only on \n would hold a whole run of them as one "line".
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? "";
      if (buffer.length > CHILD_LINE_CAP) buffer = buffer.slice(-CHILD_LINE_CAP);
      for (const line of lines) onLine(line);
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);

    child.on("error", (exc) => {
      stopTimers();
      reject(new ModelError(`Could not run audio.cpp: ${exc}`));
    });

    child.on("close", (code) => {
      stopTimers();
      if (buffer) onLine(buffer);
      const tail = recent.slice(-20).join("\n");
      if (failure) return reject(failure);
      if (code !== 0) {
        return reject(new ModelError(`audio.cpp exited with code ${code}.\n\n${tail}`));
      }
      resolve(tail);
    });
  });
}

function fmtBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  for (const unit of units) {
    if (Math.abs(value) < 1024 || unit === "GB") {
      return unit === "B" || unit === "KB"
        ? `${value.toFixed(0)} ${unit}`
        : `${value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${value.toFixed(1)} GB`;
}

/** Turn Hugging Face's failures into something a user can act on. Trimmed
 *  version of base.py's `_explain_hf_error`: only the cases this path can
 *  actually hit, since audio.cpp weights are plain GGUF pulls. */
function explainHfError(exc: unknown, spec: ModelSpec): string {
  const text = String(exc);
  const lowered = text.toLowerCase();
  if (
    text.includes("401") ||
    text.includes("403") ||
    lowered.includes("gated") ||
    lowered.includes("awaiting a review")
  ) {
    return (
      `${spec.name} is a gated model. Accept the licence at ` +
      `https://huggingface.co/${spec.hf_repo} with your Hugging Face account, then add ` +
      `an access token in Settings and try again.\n\n(${text})`
    );
  }
  if (text.includes("404")) {
    return (
      `Hugging Face repo ${spec.hf_repo} was not found. It may have been ` +
      `renamed.\n\n(${text})`
    );
  }
  if (
    lowered.includes("proxy") ||
    lowered.includes("connection") ||
    lowered.includes("timed out") ||
    lowered.includes("fetch failed")
  ) {
    return `Could not reach huggingface.co. Check your network.\n\n(${text})`;
  }
  return `Download failed: ${text}`;
}

/** Interleaved s16le PCM -> channels-first float audio. */
export function fromPcm16(pcm: Buffer, channels: number): Audio {
  const frames = Math.floor(pcm.length / 2 / channels);
  const out: Audio = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      out[c]![f] = pcm.readInt16LE((f * channels + c) * 2) / 0x8000;
    }
  }
  return out;
}
