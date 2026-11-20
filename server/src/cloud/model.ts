/**
 * A Mirli Cloud model, presented to the rest of Mirli as a model.
 *
 * Like `EndpointModel`, it holds nothing on this machine: `loaded` is true
 * whenever the app is signed in, so it never takes the local residency slot.
 * A render is: check the caps, submit a job (with an idempotency key, so a
 * retried request is never charged twice), poll it with real progress, then
 * download and decode the result. Cancelling the Mirli job cancels the cloud
 * job, which is free.
 */

import { randomUUID } from "node:crypto";

import { decodeAudio } from "../endpoints/client.js";
import { CancelledJob, ModelError } from "../errors.js";
import type { GenerateOptions, GenerationModel, RenderedAudio, SpeakOptions } from "../models/types.js";
import { DEFAULT_SUPPORTS, type ModelInfo } from "../schemas.js";
import { CloudClient, CloudError } from "./client.js";
import type { CloudModel as CloudModelInfo, JobParams, Task } from "./contract.js";

export interface CloudCaps {
  /** Most credits one render may cost. */
  perCall: number;
  /** Most credits all renders may cost in a UTC day, across devices. */
  perDay: number;
}

/** What a CloudModel needs from the service that owns the sign-in. */
export interface CloudContext {
  client(): CloudClient | null;
  caps(): CloudCaps;
  /** Called after each render, so the balance chip can update without a poll. */
  onSpend?(): void;
}

const POLL_MS = 1000;

export class CloudModel implements GenerationModel {
  readonly provider = "cloud" as const;
  error: string | null = null;
  readonly extras: string[] = [];
  readonly autoInstallable = false;

  constructor(
    readonly info: CloudModelInfo,
    private readonly ctx: CloudContext,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  get id(): string {
    return this.info.id;
  }

  get loaded(): boolean {
    return this.ctx.client() !== null;
  }

  describe(): ModelInfo {
    const m = this.info;
    const speech = m.task === "speak";
    return {
      id: m.id,
      // The same open model may also be installed locally; the picker must
      // never leave anyone guessing which one costs credits.
      name: `${m.name} · Cloud`,
      vendor: "Mirli Cloud",
      description: `${m.description} Runs on Mirli Cloud: the prompt is sent to Mirli's servers and the render costs credits.`,
      license: { name: m.license_note, commercial: "yes", url: "" },
      hf_repo: null,
      gated: false,
      family: "cloud",
      params: [],
      task: speech ? "tts" : m.task === "separate" ? "sep" : "gen",
      voice_ids: [...m.voice_ids],
      requires_voice_reference: false,
      category: m.category === "stems" ? "utility" : m.category,
      max_duration_s: m.max_duration_s,
      sample_rate: speech ? 24_000 : 44_100,
      channels: speech ? 1 : 2,
      supports: {
        ...DEFAULT_SUPPORTS,
        negative_prompt: m.supports.negative_prompt,
        seed: m.supports.seed,
        steps: false,
        cfg: false,
        lyrics: m.supports.lyrics,
        text: speech,
        voice_reference: false,
      },
      defaults: { duration_s: m.default_duration_s },
      vram_estimate_mb: 0,
      extras: [],
      status: this.loaded ? "installed" : "error",
      error: this.loaded ? null : "Sign in to Mirli Cloud in Settings to use this model.",
      installed_deps: true,
      auto_installable: false,
      provider: "cloud",
      price: { ...m.price },
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
    if (!this.loaded) throw new ModelError(`Sign in to Mirli Cloud in Settings to use ${this.info.name}.`);
  }

  async isDownloaded(): Promise<boolean> {
    return true;
  }

  async download(): Promise<void> {
    throw new ModelError(`${this.info.name} runs on Mirli Cloud. There is nothing to download.`);
  }

  async load(): Promise<void> {
    await this.requireDeps();
  }

  unload(): void {}

  /* ---------------------------------------------------------------- render */

  private async run(task: Task, params: JobParams, progress?: GenerateOptions["progress"]): Promise<RenderedAudio> {
    const client = this.ctx.client();
    if (!client) throw new ModelError(`Sign in to Mirli Cloud in Settings to use ${this.info.name}.`);
    const caps = this.ctx.caps();
    try {
      progress?.(0.02, "Checking the price");
      const [quote, account] = await Promise.all([client.quote(this.id, task, params), client.account()]);
      if (quote.credits > caps.perCall) {
        throw new ModelError(
          `This costs ${quote.credits} credits, above your limit of ${caps.perCall} per render. ` +
            `Change it in Settings → Mirli Cloud.`,
        );
      }
      if (account.spent_today + quote.credits > caps.perDay) {
        throw new ModelError(
          `This costs ${quote.credits} credits and you've spent ${account.spent_today} of your ${caps.perDay}-credit ` +
            `daily limit. Change it in Settings → Mirli Cloud.`,
        );
      }
      if (account.balance < quote.credits) {
        throw new ModelError(
          `Not enough Mirli Cloud credits: this needs ${quote.credits} and you have ${account.balance}. ` +
            `Buy credits in Settings → Mirli Cloud.`,
        );
      }

      progress?.(0.05, `Sending to Mirli Cloud (${quote.credits} credits)`);
      let job = await client.createJob(this.id, task, params, caps.perCall, randomUUID());
      const handle = progress?.handle;
      while (job.state === "queued" || job.state === "running") {
        if (handle?.cancelled) {
          await client.cancel(job.job_id).catch(() => {});
          throw new CancelledJob();
        }
        await this.sleep(POLL_MS);
        job = await client.job(job.job_id);
        const label = job.message ?? (job.state === "queued" ? "Waiting in the Mirli Cloud queue" : "Rendering on Mirli Cloud");
        progress?.(0.05 + 0.85 * Math.max(0, Math.min(1, job.progress)), label);
      }
      if (job.state !== "succeeded") {
        throw new ModelError(job.error ?? `The Mirli Cloud render ${job.state}. Nothing was charged.`);
      }
      const out = job.outputs[0];
      if (!out) throw new ModelError("Mirli Cloud finished but sent no audio. Nothing was charged for an empty result.");
      progress?.(0.93, "Downloading the result");
      const file = await client.download(out.url);
      const audio = await decodeAudio(file.bytes, out.mime ?? file.contentType, 24_000);
      this.error = null;
      this.ctx.onSpend?.();
      return audio;
    } catch (e) {
      if (e instanceof CloudError) {
        if (e.code === "unauthorized") throw new ModelError("Mirli Cloud signed this device out. Sign in again in Settings.");
        throw new ModelError(e.message);
      }
      throw e;
    }
  }

  async generate(prompt: string, durationS: number, options: GenerateOptions = {}): Promise<RenderedAudio> {
    if (this.info.task !== "generate") throw new ModelError(`${this.info.name} is a speech model; use it from the Voice studio.`);
    if (options.edit) throw new ModelError(`${this.info.name} cannot ${options.edit.kind} an existing sound.`);
    const lyrics = options.lyrics?.trim() ? options.lyrics : null;
    return this.run(
      "generate",
      {
        prompt,
        duration_s: Math.min(durationS, this.info.max_duration_s),
        ...(this.info.supports.lyrics && lyrics ? { lyrics } : {}),
        ...(this.info.supports.negative_prompt && options.negativePrompt ? { negative_prompt: options.negativePrompt } : {}),
        ...(this.info.supports.seed && options.seed != null ? { seed: options.seed } : {}),
      },
      options.progress,
    );
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<RenderedAudio> {
    if (this.info.task !== "speak") throw new ModelError(`${this.info.name} is not a speech model.`);
    if (options.voiceRefPath) throw new ModelError(`${this.info.name} can't clone a voice yet; pick one of its built-in voices.`);
    const voice = options.voiceId || this.info.voice_ids[0] || null;
    return this.run("speak", { text, ...(voice ? { voice } : {}) }, options.progress);
  }

  async convert(): Promise<RenderedAudio> {
    throw new ModelError(`${this.info.name} cannot convert voices.`);
  }

  async separate(): Promise<{ stemName: string; audio: RenderedAudio }[]> {
    throw new ModelError(`${this.info.name} cannot split stems yet.`);
  }
}
