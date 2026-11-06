/**
 * Configuration, the data directory layout, and persisted settings.
 *
 * The on-disk shape (`settings.json`,
 * the directory names) is deliberately stable, so an existing `~/.soundbox`
 * written by an earlier version is picked up unchanged.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  DEFAULT_PROFILE_ID,
  profileRoot,
  readRegistry,
  writeRegistry,
  type Registry,
} from "./profiles.js";
import { type AudioEndpoint, withEndpointDefaults } from "./endpoints/types.js";

export const APP_NAME = "soundbox";
/** From server/package.json, which sits one level above both src/ and dist/,
 *  so the same relative path works under tsx, vitest and the built server. */
export const VERSION: string = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 17494;

export type OutputFormat = "wav" | "mp3";
export type DeviceChoice = "auto" | "cuda" | "mps" | "cpu";
export type OtelSource = "env" | "settings" | "none";
export type LlmMode = "off" | "managed" | "external";

/**
 * Where artwork comes from, mirroring `LlmMode` because the choice is the
 * same one: nothing, something we install for you, or something you already
 * run. "off" is the default — artwork is a nicety, and a first launch should
 * not download an image model nobody asked for.
 */
export type ImageMode = "off" | "managed" | "external";

/**
 * Which API an external image endpoint speaks. There is no common standard the
 * way `/v1/chat/completions` is for text, so this is not detectable from the
 * base URL alone and has to be declared.
 *
 *   "openai"  — POST /v1/images/generations (OpenAI, LocalAI, most proxies)
 *   "a1111"   — POST /sdapi/v1/txt2img (Automatic1111, Forge, SD.Next)
 */
export type ImageApiKind = "openai" | "a1111";

/**
 * Where the audio.cpp runtime and its weights come from.
 *
 * Deliberately missing the `"off"` that `LlmMode` and `ImageMode` have: the
 * prompt assistant and cover art are niceties, but audio.cpp is the only
 * engine Soundbox generates audio with, so switching it off would leave the
 * app with nothing to do.
 *
 *   "managed"  — our own install under `<base>/bin/audiocpp`, weights under
 *                `<base>/models/audiocpp`. The default, and the whole of a
 *                normal user's experience: they never learn audio.cpp exists.
 *   "external" — an audio.cpp the user already runs. Points at their binary
 *                and, via `audiocpp_models_dir`, their models folder, so the
 *                two installs share one set of weights instead of each
 *                downloading its own.
 */
export type AudioCppMode = "managed" | "external";

export interface SettingsData {
  output_format: OutputFormat;
  normalize_lufs: number | null;
  trim_silence: boolean;
  auto_unload_minutes: number;
  hf_token: string | null;
  device: DeviceChoice;
  otel_endpoint: string;
  enabled_audiocpp_models: string[];
  audiocpp_mode: AudioCppMode;
  /** Absolute path to the folder audio.cpp packages are installed under, or
   *  null for the managed default (`<base>/models/audiocpp`). Only meaningful
   *  in "external" mode — this is what lets Soundbox and a standalone
   *  audio.cpp see the same weights. */
  audiocpp_models_dir: string | null;
  /** Absolute path to the folder generated audio is written to, or null for
   *  the default (`<profile>/sounds`). Deliberately separate from
   *  `audiocpp_models_dir`: weights are large, replaceable and shared, while
   *  sounds are the user's own work — the two belong on different disks often
   *  enough that one setting cannot serve both. */
  sounds_dir: string | null;
  llm_mode: LlmMode;
  llm_model: string;
  llm_external_base_url: string;
  llm_external_model: string;
  llm_external_api_key: string | null;
  image_mode: ImageMode;
  image_model: string;
  image_external_kind: ImageApiKind;
  image_external_base_url: string;
  image_external_model: string;
  image_external_api_key: string | null;
  /** Queue artwork automatically when a music generation finishes. Off by
   *  default: the image model competes for the same VRAM as the audio model,
   *  and nobody's first render should get slower for a picture. */
  image_auto_artwork: boolean;
  /** Custom audio endpoints — other people's servers Soundbox sends requests
   *  to instead of running a model itself. Each is one model in the pickers.
   *  Not settable through PATCH /api/settings: it has its own routes, so a key
   *  can be kept without the client ever holding it. See endpoints/types.ts. */
  audio_endpoints: AudioEndpoint[];
  /**
   * When first-run setup was finished or skipped, as an ISO timestamp, or null
   * for a profile that has never seen it.
   *
   * A timestamp rather than a boolean because the interesting question later is
   * "which build did this person onboard under" — a `false` tells you nothing
   * when the wizard grows a step. Set on both Finish and Skip: the wizard must
   * never reappear on its own, and the dashboard's banner is what carries a
   * skipped setup forward instead. `""` clears it, the same convention
   * `sounds_dir` uses, which is how Settings' "Run setup again" works.
   */
  onboarded_at: string | null;
}

const DEFAULT_SETTINGS: SettingsData = {
  output_format: "wav",
  normalize_lufs: -16.0,
  trim_silence: true,
  auto_unload_minutes: 10,
  hf_token: null,
  device: "auto",
  otel_endpoint: "",
  enabled_audiocpp_models: [],
  audiocpp_mode: "managed",
  audiocpp_models_dir: null,
  sounds_dir: null,
  llm_mode: "off",
  llm_model: "qwen3-1.7b",
  llm_external_base_url: "",
  llm_external_model: "",
  llm_external_api_key: null,
  image_mode: "off",
  image_model: "sd-turbo",
  image_external_kind: "openai",
  image_external_base_url: "",
  image_external_model: "",
  image_external_api_key: null,
  image_auto_artwork: false,
  audio_endpoints: [],
  onboarded_at: null,
};

/** Every key a client is allowed to set, so an unknown field is ignored rather
 *  than persisted into settings.json where it would linger forever. */
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SettingsData)[];

export interface PublicSettings {
  data_dir: string;
  hf_token_set: boolean;
  output_format: OutputFormat;
  normalize_lufs: number | null;
  trim_silence: boolean;
  auto_unload_minutes: number;
  device: DeviceChoice;
  otel_endpoint: string;
  enabled_audiocpp_models: string[];
  audiocpp_mode: AudioCppMode;
  /** Always the path actually in force, resolved — never null — so the UI can
   *  show where weights land without repeating the default here. */
  audiocpp_models_dir: string;
  /** Always the path actually in force, resolved — never null — so the UI can
   *  show where sounds land without repeating the default here. */
  sounds_dir: string;
  llm_mode: LlmMode;
  llm_model: string;
  llm_external_base_url: string;
  llm_external_model: string;
  llm_external_api_key_set: boolean;
  image_mode: ImageMode;
  image_model: string;
  image_external_kind: ImageApiKind;
  image_external_base_url: string;
  image_external_model: string;
  image_external_api_key_set: boolean;
  image_auto_artwork: boolean;
  onboarded_at: string | null;
}

export class Settings {
  output_format: OutputFormat = DEFAULT_SETTINGS.output_format;
  normalize_lufs: number | null = DEFAULT_SETTINGS.normalize_lufs;
  trim_silence: boolean = DEFAULT_SETTINGS.trim_silence;
  auto_unload_minutes: number = DEFAULT_SETTINGS.auto_unload_minutes;
  hf_token: string | null = DEFAULT_SETTINGS.hf_token;
  device: DeviceChoice = DEFAULT_SETTINGS.device;
  otel_endpoint: string = DEFAULT_SETTINGS.otel_endpoint;
  enabled_audiocpp_models: string[] = [];
  audiocpp_mode: AudioCppMode = DEFAULT_SETTINGS.audiocpp_mode;
  audiocpp_models_dir: string | null = DEFAULT_SETTINGS.audiocpp_models_dir;
  sounds_dir: string | null = DEFAULT_SETTINGS.sounds_dir;
  llm_mode: LlmMode = DEFAULT_SETTINGS.llm_mode;
  llm_model: string = DEFAULT_SETTINGS.llm_model;
  llm_external_base_url: string = DEFAULT_SETTINGS.llm_external_base_url;
  llm_external_model: string = DEFAULT_SETTINGS.llm_external_model;
  llm_external_api_key: string | null = DEFAULT_SETTINGS.llm_external_api_key;
  image_mode: ImageMode = DEFAULT_SETTINGS.image_mode;
  image_model: string = DEFAULT_SETTINGS.image_model;
  image_external_kind: ImageApiKind = DEFAULT_SETTINGS.image_external_kind;
  image_external_base_url: string = DEFAULT_SETTINGS.image_external_base_url;
  image_external_model: string = DEFAULT_SETTINGS.image_external_model;
  image_external_api_key: string | null = DEFAULT_SETTINGS.image_external_api_key;
  image_auto_artwork: boolean = DEFAULT_SETTINGS.image_auto_artwork;
  audio_endpoints: AudioEndpoint[] = [];
  onboarded_at: string | null = DEFAULT_SETTINGS.onboarded_at;

  constructor(data: Partial<SettingsData> = {}) {
    Object.assign(this, DEFAULT_SETTINGS, {
      // Fresh arrays: the DEFAULT_SETTINGS literal is shared, and assigning it
      // would give every Settings instance the same array to push into.
      enabled_audiocpp_models: [],
      audio_endpoints: [],
    });
    for (const key of SETTING_KEYS) {
      const value = data[key];
      if (value !== undefined) (this as Record<string, unknown>)[key] = value;
    }
    if (Array.isArray(this.audio_endpoints)) {
      this.audio_endpoints = this.audio_endpoints.map(withEndpointDefaults);
    }
  }

  /**
   * The settings the API is allowed to return.
   *
   * `hf_token` is deliberately absent — only the boolean `hf_token_set` — so a
   * token pasted into the app can never be read back out of it.
   */
  public(paths: Paths): PublicSettings {
    return {
      data_dir: paths.root,
      hf_token_set: Boolean(this.hf_token || process.env.HF_TOKEN),
      output_format: this.output_format,
      normalize_lufs: this.normalize_lufs,
      trim_silence: this.trim_silence,
      auto_unload_minutes: this.auto_unload_minutes,
      device: this.device,
      otel_endpoint: this.otel_endpoint,
      enabled_audiocpp_models: [...this.enabled_audiocpp_models],
      audiocpp_mode: this.audiocpp_mode,
      audiocpp_models_dir: this.effectiveAudiocppModelsDir(paths),
      // `paths.sounds` already has the override folded in — reading it back
      // here rather than re-resolving keeps one answer to "where do sounds go".
      sounds_dir: paths.sounds,
      llm_mode: this.llm_mode,
      llm_model: this.llm_model,
      llm_external_base_url: this.llm_external_base_url,
      llm_external_model: this.llm_external_model,
      llm_external_api_key_set: Boolean(this.llm_external_api_key),
      image_mode: this.image_mode,
      image_model: this.image_model,
      image_external_kind: this.image_external_kind,
      image_external_base_url: this.image_external_base_url,
      image_external_model: this.image_external_model,
      image_external_api_key_set: Boolean(this.image_external_api_key),
      image_auto_artwork: this.image_auto_artwork,
      onboarded_at: this.onboarded_at,
    };
  }

  /** The endpoint actually in force, and where it came from. The env var wins
   *  so a deployment can force an endpoint the app UI cannot override. */
  effectiveOtelEndpoint(): [string | null, OtelSource] {
    const env = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (env) return [env, "env"];
    if (this.otel_endpoint) return [this.otel_endpoint, "settings"];
    return [null, "none"];
  }

  /**
   * The folder audio.cpp packages live in.
   *
   * The managed default is a subdirectory of `models/` rather than `models/`
   * itself because `models/` also holds the LLM, image and Hugging Face cache
   * trees — handing audio.cpp the parent would put its package manager in
   * charge of all of them.
   *
   * An override only takes effect in "external" mode: a stale path left in
   * settings.json must not send a managed install off to a folder the user
   * has since stopped sharing.
   */
  effectiveAudiocppModelsDir(paths: Paths): string {
    if (this.audiocpp_mode === "external" && this.audiocpp_models_dir) {
      return this.audiocpp_models_dir;
    }
    return join(paths.models, "audiocpp");
  }

  effectiveHfToken(): string | null {
    return (
      this.hf_token || process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || null
    );
  }

  toJSON(): SettingsData {
    return {
      output_format: this.output_format,
      normalize_lufs: this.normalize_lufs,
      trim_silence: this.trim_silence,
      auto_unload_minutes: this.auto_unload_minutes,
      hf_token: this.hf_token,
      device: this.device,
      otel_endpoint: this.otel_endpoint,
      enabled_audiocpp_models: this.enabled_audiocpp_models,
      audiocpp_mode: this.audiocpp_mode,
      audiocpp_models_dir: this.audiocpp_models_dir,
      sounds_dir: this.sounds_dir,
      llm_mode: this.llm_mode,
      llm_model: this.llm_model,
      llm_external_base_url: this.llm_external_base_url,
      llm_external_model: this.llm_external_model,
      llm_external_api_key: this.llm_external_api_key,
      image_mode: this.image_mode,
      image_model: this.image_model,
      image_external_kind: this.image_external_kind,
      image_external_base_url: this.image_external_base_url,
      image_external_model: this.image_external_model,
      image_external_api_key: this.image_external_api_key,
      image_auto_artwork: this.image_auto_artwork,
      audio_endpoints: this.audio_endpoints,
      onboarded_at: this.onboarded_at,
    };
  }
}

export class Paths {
  /**
   * The install root — `~/.soundbox`, or `--data-dir`.
   *
   * Shared by every profile, and the home of the things that are expensive to
   * have twice: `models/` (weights, tens of gigabytes) and `bin/` (the
   * audio.cpp and llama.cpp runtimes). See `profiles.ts`.
   */
  readonly base: string;
  /** The active profile's own directory: its library, its settings. Equal to
   *  `base` for the default profile, which is what makes an install that
   *  predates profiles work unchanged. */
  readonly root: string;
  readonly db: string;
  /**
   * Where generated audio is written and read back.
   *
   * `<root>/sounds` unless `sounds_dir` in settings says otherwise. Overridable
   * on its own, separately from `models`, because the two have opposite
   * shapes: weights are bulk that a user may want on a big scratch disk and
   * can always re-download, while sounds are the only irreplaceable thing here
   * and belong wherever their backups already run.
   */
  readonly sounds: string;
  /** `<root>/sounds` regardless of the override — what "reset" means, and what
   *  the settings field shows as its placeholder. */
  readonly defaultSounds: string;
  readonly cache: string;
  readonly models: string;
  /** Generated cover art and voice avatars. Its own directory rather than a
   *  corner of `sounds/`: these are derived, disposable, and a user clearing
   *  artwork should never risk the audio it was made for. */
  readonly artwork: string;
  readonly settingsFile: string;

  constructor(root: string, base: string = root, soundsDir?: string | null) {
    this.base = base;
    this.root = root;
    this.db = join(root, "soundbox.db");
    this.defaultSounds = join(root, "sounds");
    // `resolve` rather than the raw string: everything downstream compares and
    // joins against this, and a relative path in settings.json would otherwise
    // mean whatever the server's working directory happened to be that launch.
    this.sounds = soundsDir?.trim() ? resolve(soundsDir.trim()) : this.defaultSounds;
    this.cache = join(root, "cache");
    // Under `base`, not `root` — a profile switch must not orphan the weights
    // or send the next generation off to download them again.
    this.models = join(base, "models");
    this.artwork = join(root, "artwork");
    this.settingsFile = join(root, "settings.json");
  }

  ensure(): void {
    for (const dir of [this.base, this.root, this.sounds, this.cache, this.models, this.artwork]) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export function defaultDataDir(): string {
  return process.env.SOUNDBOX_DATA_DIR || join(homedir(), `.${APP_NAME}`);
}

export class Config {
  /**
   * Not `readonly`: switching profile replaces this in place.
   *
   * Everything that needs a directory — the file routes, the LLM and image
   * services, the service's own audio paths — reads `config.paths.x` at call
   * time and holds the `Config`, not the `Paths`. Swapping the field is
   * therefore the whole of a switch for them, where handing out a new `Config`
   * would leave every one of those holders pointing at the old profile.
   */
  paths: Paths;
  settings: Settings;
  /** The install root, fixed for the process — `paths.base` follows it. */
  readonly base: string;
  /** Id of the profile currently in force. See `profiles.ts`. */
  profile: string;

  constructor(dataDir?: string, profileId?: string) {
    this.base = dataDir ?? defaultDataDir();
    const registry = readRegistry(this.base);
    // An explicit `--profile` wins over the persisted active one, and an id
    // that names nothing falls back rather than starting the server against a
    // directory the user cannot see in the list.
    const wanted = profileId ?? registry.active;
    this.profile = registry.profiles.some((p) => p.id === wanted) ? wanted : DEFAULT_PROFILE_ID;
    this.paths = new Paths(profileRoot(this.base, this.profile), this.base);
    this.paths.ensure();
    this.settings = this.loadSettings();
    // Settings live inside `paths`, so the first build cannot know about the
    // `sounds_dir` they carry. Rebuilding once they are loaded is what folds
    // the override in — cheap, and it keeps `Paths` a plain value object.
    this.rebuildPaths();
    // Keep the HF cache inside our own data directory so "uninstalling" is
    // deleting one folder. Only set when unset — an explicit HF_HOME in the
    // environment is the user's choice and outranks ours.
    if (!process.env.HF_HOME) process.env.HF_HOME = this.paths.models;
  }

  /** Re-derive `paths` from the current profile and the current `sounds_dir`,
   *  creating any directory that does not exist yet. */
  private rebuildPaths(): void {
    this.paths = new Paths(
      profileRoot(this.base, this.profile),
      this.base,
      this.settings.sounds_dir,
    );
    this.paths.ensure();
  }

  private loadSettings(): Settings {
    if (!existsSync(this.paths.settingsFile)) {
      const settings = new Settings();
      this.writeSettings(settings);
      return settings;
    }
    try {
      const raw = readFileSync(this.paths.settingsFile, "utf-8");
      return new Settings(JSON.parse(raw) as Partial<SettingsData>);
    } catch {
      // A corrupt settings file must not stop the server from starting. Fall
      // back to defaults in memory without overwriting — the bad file is
      // better evidence for the user than a silently reset one.
      return new Settings();
    }
  }

  private writeSettings(settings: Settings): void {
    // Temp-file-then-rename: a crash mid-write leaves the old settings intact
    // rather than a truncated file that fails to parse on next start.
    const tmp = `${this.paths.settingsFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(settings.toJSON(), null, 2), "utf-8");
    renameSync(tmp, this.paths.settingsFile);
  }

  /**
   * Apply a partial settings patch and persist it.
   *
   * `undefined` and `null` values are skipped rather than written, matching the
   * Python behaviour: PATCH bodies omit fields they don't mean to change, and
   * a serialiser that turns "omitted" into `null` must not clear the token.
   */
  updateSettings(patch: Partial<SettingsData>): Settings {
    for (const key of SETTING_KEYS) {
      const value = patch[key];
      if (value === undefined || value === null) continue;
      // "" is how a client asks for the default back — `updateSettings` drops
      // nulls, so an empty string is the only way to say it. Normalised here
      // rather than stored, so settings.json never holds a blank path.
      if (key === "sounds_dir" && typeof value === "string" && !value.trim()) {
        this.settings.sounds_dir = null;
        continue;
      }
      // Same convention, for the opposite reason: "" is how Settings' "Run
      // setup again" un-onboards a profile, since a null would be dropped
      // before it ever reached here.
      if (key === "onboarded_at" && typeof value === "string" && !value.trim()) {
        this.settings.onboarded_at = null;
        continue;
      }
      Object.assign(this.settings, { [key]: value });
    }
    this.writeSettings(this.settings);
    if ("sounds_dir" in patch) this.rebuildPaths();
    return this.settings;
  }

  /* ----------------------------------------------------------- profiles */

  registry(): Registry {
    return readRegistry(this.base);
  }

  /**
   * Point this config at another profile: new directories, its own settings.
   *
   * Only the config half of a switch. The live database, the enabled-model
   * list and the LLM/image engines are the service's to reconcile — see
   * `SoundboxService.switchProfile`, which is the method callers should use.
   */
  useProfile(id: string): void {
    const registry = readRegistry(this.base);
    if (!registry.profiles.some((p) => p.id === id)) {
      throw new Error(`no such profile: ${id}`);
    }
    this.profile = id;
    this.paths = new Paths(profileRoot(this.base, id), this.base);
    this.paths.ensure();
    this.settings = this.loadSettings();
    // The new profile has its own settings.json and so its own `sounds_dir`.
    this.rebuildPaths();
    writeRegistry(this.base, { ...registry, active: id });
  }
}

let _config: Config | null = null;

export function setConfig(config: Config): void {
  _config = config;
}

export function getConfig(): Config {
  if (_config === null) _config = new Config();
  return _config;
}
