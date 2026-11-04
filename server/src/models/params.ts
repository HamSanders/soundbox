/**
 * What each model family will actually listen to.
 *
 * Everything here comes from audio.cpp's own `webui/configs/model_params.json`,
 * vendored next to this file. That matters: the alternative is a table of our
 * own guesses, and we have already learned what those are worth. The upstream
 * file is checked against `src/models/<family>/*.cpp`, and it predicted every
 * result we measured by hand — Chatterbox's `exaggeration` and `temperature`
 * move the audio, and the flags it does *not* list (`--instruct`, `--emotion`,
 * `--speaking-rate`, `cfg_weight`) do nothing on that family.
 *
 * Two things are worth knowing before trusting a row:
 *
 *  - These are **request options**, not CLI flags. `--temperature 1.4` is
 *    ignored by the families that list `temperature`; `--request-option
 *    temperature=1.4` is not. audio.cpp accepts unknown keys silently, so a
 *    wrong name is invisible rather than an error.
 *  - A listed param can still look dead because of another one. VibeVoice
 *    lists `temperature`, but it samples greedily until `do_sample=true`, so
 *    temperature alone changes nothing. Hence `requires` below.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The control types the upstream file uses. */
export type ParamType = "slider" | "number" | "bool" | "text" | "choice";

/**
 * Where a param belongs in the UI.
 *
 * The grouping is ours, not upstream's, and it is the only editorialising this
 * module does. It exists because "how should this line be said" and "how hard
 * should the sampler work" are different questions, and a flat list of 13
 * sliders makes the person writing a script read all of them to find the one
 * that matters.
 */
export type ParamGroup = "delivery" | "sampling" | "quality" | "phrasing" | "voice" | "advanced";

export interface ModelParam {
  name: string;
  type: ParamType;
  /** English, always — the upstream labels are partly Chinese, so this falls
   *  back to the bare param name rather than showing text the user can't read. */
  label: string;
  info?: string | null;
  placeholder?: string | null;
  group: ParamGroup;
  default: string | number | boolean;
  minimum?: number | null;
  maximum?: number | null;
  step?: number | null;
  /** 0 means the value is an integer. */
  precision?: number | null;
  choices?: string[];
  /**
   * Another param on the same family that has to be set for this one to do
   * anything, and the value it needs. Measured, not documented: VibeVoice's
   * `temperature` is inert until `do_sample=true`.
   */
  requires?: { name: string; value: string } | null;
}

interface RawParam {
  name: string;
  type: ParamType;
  label?: string;
  label_en?: string;
  info?: string;
  info_en?: string;
  placeholder?: string;
  placeholder_en?: string;
  default?: string | number | boolean;
  minimum?: number;
  maximum?: number;
  step?: number;
  precision?: number;
  choices?: string[];
}

/** Beside this module under tsx; back in `src/` after a build, since `tsc`
 *  copies no JSON into `dist/` — the same fallback as the catalog's
 *  `catalogPath()` in audiocpp.ts. */
function paramsPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const local = join(here, "audiocpp_model_params.json");
  if (existsSync(local)) return local;
  return join(here, "..", "..", "src", "models", "audiocpp_model_params.json");
}

const RAW = JSON.parse(readFileSync(paramsPath(), "utf8")) as Record<string, RawParam[]>;

/**
 * Which group each known param belongs to.
 *
 * A name missing from here lands in "advanced", which is the right default: an
 * unclassified knob is one nobody has decided is worth putting in front of a
 * writer, and hiding it is better than guessing it changes delivery.
 */
const GROUPS: Record<string, ParamGroup> = {
  // How it is said — the reason this module exists.
  exaggeration: "delivery",
  emotion: "delivery",
  emotion_text: "delivery",
  emotion_alpha: "delivery",
  use_emotion_text: "delivery",
  use_random_emotion: "delivery",
  instruct: "delivery",
  system_prompt: "delivery",
  speaking_rate: "delivery",
  speed: "delivery",
  variation: "delivery",
  duration_factor: "delivery",
  duration_scale: "delivery",
  length_adjust: "delivery",
  semitone_shift: "delivery",
  use_pitch_shift: "delivery",

  // How much the sampler is allowed to wander.
  temperature: "sampling",
  top_k: "sampling",
  top_p: "sampling",
  repetition_penalty: "sampling",
  do_sample: "sampling",
  num_beams: "sampling",
  best_of_n: "sampling",
  text_temperature: "sampling",
  text_top_k: "sampling",
  seed: "sampling",

  // Time spent versus fidelity.
  num_inference_steps: "quality",
  guidance_scale: "quality",
  shift: "quality",
  min_tokens: "quality",
  max_length_times: "quality",
  frames_after_eos: "quality",
  retry_badcase: "quality",

  // Where the reader breathes, and how long chunks are.
  text_chunk_size: "phrasing",
  text_chunk_mode: "phrasing",
  interval_silence_ms: "phrasing",
  cross_fade_duration_sec: "phrasing",
  edge_fade_duration_sec: "phrasing",
  edge_pad_duration_sec: "phrasing",

  // Who is speaking. Mostly redundant with Konchi's own voice library, which
  // is why these are grouped away rather than shown next to it.
  voice: "voice",
  voice_id: "voice",
  voice_samples: "voice",
  speaker: "voice",
  speaker_id: "voice",
  lang: "voice",
  language: "voice",
};

/**
 * Params that only work once a companion is set.
 *
 * Verified against the binary rather than read off the config: with
 * `do_sample` at its default of false, VibeVoice produced byte-identical audio
 * at temperature 0.8 and 1.4, and differed the moment sampling was enabled.
 */
const REQUIRES: Record<string, Record<string, { name: string; value: string }>> = {
  vibevoice: {
    temperature: { name: "do_sample", value: "true" },
    top_p: { name: "do_sample", value: "true" },
  },
};

/** True when a string is safe to show in an English UI. */
function ascii(text: string | undefined): text is string {
  return text !== undefined && text.trim() !== "" && !/[^\x00-\x7F]/.test(text);
}

/** Upstream labels are `label_en` where translated and Chinese where not; the
 *  param's own name is a better fallback than untranslated text. */
function english(en: string | undefined, raw: string | undefined, fallback: string): string {
  if (ascii(en)) return en;
  if (ascii(raw)) return raw;
  return fallback;
}

function convert(family: string, raw: RawParam): ModelParam {
  return {
    name: raw.name,
    type: raw.type,
    label: english(raw.label_en, raw.label, raw.name),
    info: ascii(raw.info_en) ? raw.info_en : ascii(raw.info) ? raw.info : null,
    placeholder: ascii(raw.placeholder_en)
      ? raw.placeholder_en
      : ascii(raw.placeholder)
        ? raw.placeholder
        : null,
    group: GROUPS[raw.name] ?? "advanced",
    default: raw.default ?? (raw.type === "bool" ? false : raw.type === "text" ? "" : 0),
    minimum: raw.minimum ?? null,
    maximum: raw.maximum ?? null,
    step: raw.step ?? null,
    precision: raw.precision ?? null,
    choices: raw.choices,
    requires: REQUIRES[family]?.[raw.name] ?? null,
  };
}

/**
 * Every param a family accepts, or an empty list for one that takes none.
 *
 * Empty is a real answer, not a missing entry: Fish Audio and Higgs have no
 * row upstream, which means the words and the voice are the only controls
 * there are. Saying so is the point.
 */
export function paramsFor(family: string | null | undefined): ModelParam[] {
  if (!family) return [];
  const raw = RAW[family];
  if (raw === undefined) return [];
  return raw.map((p) => convert(family, p));
}

/**
 * Fill in any companion a set of chosen options needs.
 *
 * Setting temperature on VibeVoice and getting identical audio back is the
 * kind of thing that reads as "this app is broken", so the dependency is
 * satisfied here rather than being explained in a tooltip. Only ever adds a
 * missing key — an explicit choice is never overwritten.
 */
export function withRequirements(
  family: string | null | undefined,
  options: Record<string, string>,
): Record<string, string> {
  const out = { ...options };
  for (const param of paramsFor(family)) {
    if (param.requires === null || param.requires === undefined) continue;
    if (!(param.name in out)) continue;
    if (!(param.requires.name in out)) out[param.requires.name] = param.requires.value;
  }
  return out;
}
