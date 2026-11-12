/**
 * A custom audio endpoint, presented to the rest of Konchi as a model.
 *
 * The mirror of `AudioCppModel` across `models/types.ts`'s `GenerationModel`.
 * Everything after `generate()` — loudness, peaks, the Sound row, artwork, the
 * Library, MCP — takes samples and a rate and does not care where they came
 * from, so the whole cost of an endpoint lands here.
 *
 * What it quietly breaks, and how:
 *
 *  - **Nothing is downloaded and nothing is resident.** `download()` refuses
 *    rather than succeeding at nothing: a button that offers it is a bug. And
 *    `loaded` is true whenever the endpoint is configured, which is what keeps
 *    `service.ts` from calling `ModelManager.load()` — so an endpoint never
 *    takes the residency slot, and never evicts the local model holding VRAM.
 *  - **The prompt may leave the machine.** Most endpoints people point this at
 *    are on their own network, but the URL is theirs to choose, so the
 *    description says where requests go rather than assuming.
 *  - **Capabilities come from the template.** A body with no `{{seed}}` cannot
 *    honour a seed, so the composer should not offer one; `supports` is
 *    derived from which variables the template actually uses.
 */

import { readFile } from "node:fs/promises";

import { ModelError } from "../errors.js";
import { DEFAULT_SUPPORTS, type ModelInfo } from "../schemas.js";
import type { GenerateOptions, GenerationModel, RenderedAudio, SpeakOptions } from "../models/types.js";
import { type FetchFn, requestAudio } from "./client.js";
import {
  bpmFromPrompt,
  keyFromPrompt,
  renderTemplate,
  type TemplateVars,
  templateVariables,
} from "./template.js";
import { type AudioEndpoint, endpointModelId, isLocalUrl } from "./types.js";

export class EndpointModel implements GenerationModel {
  readonly endpoint: AudioEndpoint;
  readonly provider = "endpoint" as const;
  error: string | null = null;
  /** Nothing to install: the dependency is a server somebody else runs. */
  readonly extras: string[] = [];
  readonly autoInstallable = false;
  private readonly fetchImpl: FetchFn;

  constructor(endpoint: AudioEndpoint, fetchImpl: FetchFn = fetch) {
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
  }

  get id(): string {
    return endpointModelId(this.endpoint.id);
  }

  /** "Ready to run" means there is a URL to send to. Whether the server
   *  behind it is up is only knowable by asking, which a status poll should
   *  not do on every Models page refresh. */
  get loaded(): boolean {
    return Boolean(this.endpoint.url);
  }

  private get uses(): Set<string> {
    return new Set(templateVariables(this.endpoint.body_template));
  }

  /* --------------------------------------------------------------- metadata */

  describe(): ModelInfo {
    const ep = this.endpoint;
    const uses = this.uses;
    const speech = ep.task === "speech";
    let host = ep.url;
    try {
      host = new URL(ep.url).host;
    } catch {
      // An unparseable URL still describes; generate() is where it fails.
    }
    return {
      id: this.id,
      name: ep.name,
      vendor: host,
      description:
        `A custom endpoint: requests are sent to ${ep.url}. ` +
        (isLocalUrl(ep.url)
          ? `What it runs, and on what terms, is up to that server.`
          : `That host is outside this machine and its local network, so prompts and lyrics leave ` +
            `it. What it runs, what it keeps and what it charges are up to that service.`),
      license: { name: "Set by the endpoint", commercial: "conditional", url: "" },
      hf_repo: null,
      gated: false,
      // Matches no `params.ts` family on purpose, so the composer shows only
      // the common controls and no audio.cpp knobs this server never sees.
      family: "endpoint",
      params: [],
      task: speech ? "tts" : "gen",
      voice_ids: speech ? [...ep.voices] : [],
      requires_voice_reference: false,
      category: ep.task === "speech" ? "voice" : ep.task,
      max_duration_s: ep.max_duration_s,
      // Only consulted for audio-to-audio edits, which an endpoint does not do.
      sample_rate: speech ? 24_000 : 44_100,
      channels: speech ? 1 : 2,
      supports: {
        ...DEFAULT_SUPPORTS,
        negative_prompt: uses.has("negative_prompt"),
        seed: uses.has("seed"),
        steps: uses.has("steps"),
        cfg: uses.has("cfg"),
        lyrics: uses.has("lyrics"),
        text: speech,
        voice_reference: speech && uses.has("voice_ref_b64"),
      },
      // The composer opens at this length; the app's model type requires it.
      defaults: { duration_s: Math.min(10, ep.max_duration_s) },
      // Zero rather than an estimate: none of this machine's VRAM is used.
      vram_estimate_mb: 0,
      extras: [],
      status: this.loaded ? "installed" : "error",
      error: this.loaded ? null : "This endpoint has no URL.",
      installed_deps: true,
      auto_installable: false,
      provider: "endpoint",
    };
  }

  async status(): Promise<ModelInfo> {
    const info = this.describe();
    if (this.error) {
      info.status = "error";
      info.error = this.error;
    }
    return info;
  }

  async depsInstalled(): Promise<boolean> {
    return true;
  }

  async requireDeps(): Promise<void> {
    if (!this.loaded) throw new ModelError(`${this.endpoint.name} has no URL set. Add one in Settings → Endpoints.`);
  }

  async isDownloaded(): Promise<boolean> {
    return true;
  }

  async download(): Promise<void> {
    throw new ModelError(
      `${this.endpoint.name} is a custom endpoint. There is nothing to download — ` +
        `the server at ${this.endpoint.url} runs the model.`,
    );
  }

  async load(): Promise<void> {
    await this.requireDeps();
  }

  unload(): void {
    // Nothing is resident. Called by the manager's blanket unload paths, so
    // this must not throw the way download() does.
  }

  /* ---------------------------------------------------------------- render */

  private async send(vars: TemplateVars, progress?: GenerateOptions["progress"]): Promise<RenderedAudio> {
    const ep = this.endpoint;
    const body = renderTemplate(ep.body_template, vars);
    progress?.(0.05, `Sending to ${ep.name}`);
    // The request is one opaque wait, so there is no real progress to report;
    // a steady creep says "still working" without claiming a fraction.
    const started = Date.now();
    const tick = progress
      ? setInterval(() => {
          const elapsed = (Date.now() - started) / 1000;
          progress(Math.min(0.9, 0.05 + 0.85 * (1 - Math.exp(-elapsed / 30))), `Waiting for ${ep.name}`);
        }, 1000)
      : null;
    try {
      const handle = progress?.handle;
      const result = await requestAudio(
        {
          url: ep.url,
          apiKey: ep.api_key,
          headers: ep.headers,
          body,
          responsePath: ep.response_path,
          pcmSampleRate: ep.pcm_sample_rate,
          isCancelled: handle ? () => handle.cancelled : undefined,
        },
        this.fetchImpl,
      );
      this.error = null;
      return result;
    } finally {
      if (tick) clearInterval(tick);
    }
  }

  async generate(prompt: string, durationS: number, options: GenerateOptions = {}): Promise<RenderedAudio> {
    await this.requireDeps();
    if (this.endpoint.task === "speech") {
      throw new ModelError(`${this.endpoint.name} is a speech endpoint; use it from the Voice studio.`);
    }
    if (options.edit) {
      throw new ModelError(`${this.endpoint.name} cannot ${options.edit.kind} an existing sound.`);
    }
    const lyrics = options.lyrics?.trim() ? options.lyrics : null;
    return await this.send(
      {
        prompt,
        negative_prompt: options.negativePrompt || null,
        lyrics,
        instrumental: lyrics === null,
        duration: durationS,
        duration_ms: Math.round(durationS * 1000),
        bpm: bpmFromPrompt(prompt),
        key: keyFromPrompt(prompt),
        seed: options.seed ?? null,
        steps: options.steps ?? null,
        cfg: options.cfg ?? null,
        text: null,
        voice: null,
        voice_ref_b64: null,
        language: null,
      },
      options.progress,
    );
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<RenderedAudio> {
    await this.requireDeps();
    if (this.endpoint.task !== "speech") {
      throw new ModelError(`${this.endpoint.name} is not a speech endpoint.`);
    }
    const refB64 =
      options.voiceRefPath && this.uses.has("voice_ref_b64")
        ? (await readFile(options.voiceRefPath)).toString("base64")
        : null;
    const language = options.requestOptions?.language ?? options.loadOptions?.language ?? null;
    return await this.send(
      {
        prompt: text,
        negative_prompt: null,
        lyrics: null,
        instrumental: true,
        duration: null,
        duration_ms: null,
        bpm: null,
        key: null,
        seed: options.seed ?? null,
        steps: options.steps ?? null,
        cfg: options.cfg ?? null,
        text,
        voice: options.voiceId || this.endpoint.voices[0] || null,
        voice_ref_b64: refB64,
        language,
      },
      options.progress,
    );
  }

  async convert(): Promise<RenderedAudio> {
    throw new ModelError(`${this.endpoint.name} cannot convert voices.`);
  }

  async separate(): Promise<{ stemName: string; audio: RenderedAudio }[]> {
    throw new ModelError(`${this.endpoint.name} cannot split stems.`);
  }
}
