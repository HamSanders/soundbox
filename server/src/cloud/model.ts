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
import { readFile } from "node:fs/promises";

import { decodeWav, encodeWav24 } from "../audio/dsp.js";
import { decodeAudio } from "../endpoints/client.js";
import { CancelledJob, ModelError } from "../errors.js";
import type { GenerateOptions, GenerationModel, RenderedAudio, SpeakOptions, VoiceRefInfo } from "../models/types.js";
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

/**
 * A clip as the gateway takes it: WAV, cut to the model's longest reference.
 * Uncut clips go as they are on disk. A cut one keeps its first `maxS`
 * seconds, as 24-bit PCM like every WAV Mirli writes.
 */
export async function clipForUpload(path: string, maxS: number | null): Promise<{ wav: Buffer; trimmed: boolean }> {
  const bytes = await readFile(path);
  if (maxS === null) return { wav: bytes, trimmed: false };
  const { audio, sampleRate } = decodeWav(bytes);
  const frames = audio[0]?.length ?? 0;
  const keep = Math.floor(maxS * sampleRate);
  if (frames <= keep) return { wav: bytes, trimmed: false };
  return { wav: encodeWav24(audio.map((ch) => ch.subarray(0, keep)), sampleRate), trimmed: true };
}

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
    const vc = m.task === "convert";
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
      params: [
        ...(m.languages?.length
          ? [
              {
                name: "language",
                type: "choice" as const,
                label: "Language",
                info: "The language of the text.",
                group: "voice" as const,
                default: m.languages[0]!,
                choices: [...m.languages],
              },
            ]
          : []),
        ...(m.voice_description
          ? [
              {
                name: "instruct",
                type: "text" as const,
                label: "Voice description",
                info: "Describe the voice: age, accent, tone, pace. Empty uses the model's default voice.",
                placeholder: "A warm adult narrator, calm and unhurried",
                group: "voice" as const,
                default: "",
              },
            ]
          : []),
      ],
      task: speech ? "tts" : vc ? "vc" : m.task === "separate" ? "sep" : "gen",
      voice_ids: [...m.voice_ids],
      requires_voice_reference: Boolean(m.reference?.required),
      category: m.category === "stems" ? "utility" : m.category,
      max_duration_s: m.max_duration_s,
      sample_rate: speech || vc ? 24_000 : 44_100,
      channels: speech || vc ? 1 : 2,
      supports: {
        ...DEFAULT_SUPPORTS,
        negative_prompt: m.supports.negative_prompt,
        seed: m.supports.seed,
        steps: false,
        cfg: false,
        lyrics: m.supports.lyrics,
        text: speech,
        voice_reference: m.supports.voice_reference,
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

  private async run(
    task: Task,
    params: JobParams,
    progress?: GenerateOptions["progress"],
    clips?: { reference?: string | null; source?: string | null; voice?: VoiceRefInfo | null },
  ): Promise<RenderedAudio> {
    return (await this.runAll(task, params, progress, clips))[0]!.audio;
  }

  /** One cloud job, every output it sent (a stem split sends one per stem). */
  private async runAll(
    task: Task,
    params: JobParams,
    progress?: GenerateOptions["progress"],
    clips?: { reference?: string | null; source?: string | null; voice?: VoiceRefInfo | null },
  ): Promise<{ stem: string | null; audio: RenderedAudio }[]> {
    const client = this.ctx.client();
    if (!client) throw new ModelError(`Sign in to Mirli Cloud in Settings to use ${this.info.name}.`);
    const caps = this.ctx.caps();
    try {
      if (clips?.reference || clips?.source) {
        if (clips.reference && !clips.voice?.consentAt) {
          throw new ModelError(
            `Before ${clips.voice?.name ? `“${clips.voice.name}”` : "this voice"} can be used on Mirli Cloud, confirm it's your voice ` +
              `or that you have permission to use it. Open Voice Lab → Edit voice.`,
          );
        }
        progress?.(0.01, "Uploading the clip");
        const max = this.info.reference?.max_s ?? null;
        let trimmed = false;
        if (clips.reference) {
          const clip = await clipForUpload(clips.reference, max);
          trimmed = clip.trimmed;
          const up = await client.upload(clip.wav);
          params = { ...params, reference_upload: up.upload_id };
        }
        if (clips.source) {
          const up = await client.upload((await clipForUpload(clips.source, null)).wav);
          params = { ...params, source_upload: up.upload_id };
        }
        if (clips.voice?.name) params = { ...params, voice_label: clips.voice.name.slice(0, 200) };
        // A transcript describes the whole clip; once cut, it no longer matches.
        const words = clips.voice?.transcript?.trim();
        if (words && !trimmed) params = { ...params, reference_text: words.slice(0, 2000) };
      }
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
      let job = await client.createJob(
        this.id,
        task,
        params,
        caps.perCall,
        randomUUID(),
        params.reference_upload ? "own_voice_or_permission" : undefined,
      );
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
      if (!job.outputs.length) throw new ModelError("Mirli Cloud finished but sent no audio. Nothing was charged for an empty result.");
      progress?.(0.93, job.outputs.length > 1 ? `Downloading ${job.outputs.length} files` : "Downloading the result");
      const results: { stem: string | null; audio: RenderedAudio }[] = [];
      for (const out of job.outputs) {
        const file = await client.download(out.url);
        results.push({ stem: out.stem ?? null, audio: await decodeAudio(file.bytes, out.mime ?? file.contentType, 24_000) });
      }
      this.error = null;
      this.ctx.onSpend?.();
      return results;
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
    const ref = options.voiceRefPath ?? null;
    if (ref && !this.info.supports.voice_reference) {
      throw new ModelError(`${this.info.name} can't speak in a cloned voice; pick one of its built-in voices.`);
    }
    if (!ref && this.info.reference?.required) {
      throw new ModelError(`${this.info.name} only speaks in a cloned voice. Pick one of your voices.`);
    }
    const voice = ref ? null : options.voiceId || this.info.voice_ids[0] || null;
    const language = options.requestOptions?.language ?? options.loadOptions?.language ?? null;
    const description = this.info.voice_description ? options.requestOptions?.instruct?.trim().slice(0, 500) || null : null;
    return this.run(
      "speak",
      {
        text,
        ...(voice ? { voice } : {}),
        ...(language ? { language } : {}),
        ...(description ? { prompt: description } : {}),
        ...(this.info.supports.seed && options.seed ? { seed: options.seed } : {}),
      },
      options.progress,
      { reference: ref, voice: options.voiceRef ?? null },
    );
  }

  async convert(
    sourceWavPath: string,
    voiceRefPath: string,
    options: { seed?: number | null; progress?: GenerateOptions["progress"]; voiceRef?: VoiceRefInfo | null } = {},
  ): Promise<RenderedAudio> {
    if (this.info.task !== "convert") throw new ModelError(`${this.info.name} cannot convert voices.`);
    return this.run("convert", {}, options.progress, {
      reference: voiceRefPath,
      source: sourceWavPath,
      voice: options.voiceRef ?? null,
    });
  }

  async separate(
    sourceWavPath: string,
    options: { progress?: GenerateOptions["progress"] } = {},
  ): Promise<{ stemName: string; audio: RenderedAudio }[]> {
    if (this.info.task !== "separate") throw new ModelError(`${this.info.name} cannot split stems.`);
    const outs = await this.runAll("separate", {}, options.progress, { source: sourceWavPath });
    return outs.map((o, i) => ({ stemName: o.stem ?? `stem${i + 1}`, audio: o.audio }));
  }
}
