/**
 * What `ModelManager` and `service.ts` require of a model, whatever runs it.
 *
 * Only the part the service actually uses, which is smaller than
 * `AudioCppModel` itself:
 *
 *   describe() / status()      what the Models page and pickers show
 *   loaded / load() / unload() readiness, and the residency dance
 *   generate() and friends     the four task methods, one per surface
 *
 * All four task methods are required even though no model does more than one
 * of them. Making them optional would push a `?.` or a cast onto every call
 * site in `service.ts`, to guard against a case that cannot happen: the
 * service has already refused on `info.task` by then. An implementation whose
 * task this isn't throws a sentence saying so, which is a better failure than
 * "generate is not a function" either way.
 *
 * `EditSpec` and `ProgressFn` are imported from the audio.cpp adapter rather
 * than redeclared here. They were defined there first and every caller already
 * names them from there; a type-only import is erased at build time, so this
 * costs no cycle, and one definition means the two adapters cannot drift into
 * subtly different progress contracts.
 */

import type { Audio } from "../audio/dsp.js";
import type { ModelInfo, ModelProvider } from "../schemas.js";
import type { EditSpec, ProgressFn } from "./audiocpp.js";

/** What every task method returns: samples plus the rate they are at. */
export interface RenderedAudio {
  audio: Audio;
  sampleRate: number;
}

export interface GenerateOptions {
  negativePrompt?: string | null;
  seed?: number | null;
  steps?: number | null;
  cfg?: number | null;
  lyrics?: string | null;
  trackName?: string | null;
  edit?: EditSpec | null;
  progress?: ProgressFn;
}

export interface SpeakOptions {
  voiceRefPath?: string | null;
  voiceId?: string | null;
  seed?: number | null;
  steps?: number | null;
  cfg?: number | null;
  loadOptions?: Record<string, string>;
  requestOptions?: Record<string, string>;
  progress?: ProgressFn;
}

/** One item of a streamed read: a chunk of audio, then the end. */
export type StreamChunk =
  | { kind: "audio"; audio: import("../audio/dsp.js").Audio; sampleRate: number }
  | { kind: "done"; ttftMs: number | null };

/** Re-exported: `ModelProvider` lives in `schemas.ts` because `ModelInfo`
 *  carries it and that is the wire type. Named here too, since this is the
 *  module a model implementation already imports. */
export type { ModelProvider } from "../schemas.js";

export interface GenerationModel {
  readonly id: string;
  readonly provider: ModelProvider;
  /** Set when a load or a generation failed, and surfaced as `status: "error"`
   *  with this text. Writable — the manager clears it before a retry. */
  error: string | null;
  /** pip extras / native runtimes this model needs. Empty for both of today's
   *  implementations, and shown by the UI when a runtime is missing. */
  readonly extras: string[];
  readonly autoInstallable: boolean;

  /** Ready to run *right now* — weights resolved, or an API key present.
   *  Neither implementation holds anything in VRAM between calls. */
  readonly loaded: boolean;

  describe(): ModelInfo;
  status(): Promise<ModelInfo>;
  depsInstalled(): Promise<boolean>;
  /** Throw a message the user can act on if this model cannot run yet. */
  requireDeps(): Promise<void>;
  isDownloaded(): Promise<boolean>;
  /** `signal` aborts a transfer in flight — a download is the one lifecycle
   *  step slow enough that cancelling has to reach the socket, not just the
   *  job record. */
  download(progress?: ProgressFn, signal?: AbortSignal): Promise<void>;
  load(progress?: ProgressFn): Promise<void>;
  unload(): void;

  generate(prompt: string, durationS: number, options?: GenerateOptions): Promise<RenderedAudio>;
  speak(text: string, options?: SpeakOptions): Promise<RenderedAudio>;
  /** Speak one line as it is generated. Absent on models that can't stream. */
  speakStream?(
    text: string,
    options: SpeakOptions & { signal: AbortSignal },
  ): AsyncGenerator<StreamChunk>;
  convert(
    sourceWavPath: string,
    voiceRefPath: string,
    options?: { seed?: number | null; progress?: ProgressFn },
  ): Promise<RenderedAudio>;
  separate(
    sourceWavPath: string,
    options?: { progress?: ProgressFn },
  ): Promise<{ stemName: string; audio: RenderedAudio }[]>;
}
