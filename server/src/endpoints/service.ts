/**
 * Custom audio endpoints: list, save, delete, and try one out.
 *
 * Kept out of `service.ts`, which only needs to hand it the config and the
 * model manager. Storage is the profile's settings.json (`audio_endpoints`);
 * every write re-registers the list with `ModelManager`, so a saved endpoint
 * is in the pickers on the next models fetch with no restart.
 */

import type { Config } from "../config.js";
import { ModelError } from "../errors.js";
import type { ModelManager } from "../models/manager.js";
import {
  type AudioEndpointInput,
  audioEndpointInputSchema,
  audioEndpointTestSchema,
  ENDPOINT_ID,
} from "../schemas.js";
import { EndpointModel } from "./model.js";
import { ENDPOINT_PRESETS, type EndpointPreset } from "./presets.js";
import { TEMPLATE_VARIABLES, validateTemplate, validateUrlTemplate } from "./template.js";
import { type AudioEndpoint, type PublicAudioEndpoint, toPublicEndpoint } from "./types.js";

export interface EndpointList {
  endpoints: PublicAudioEndpoint[];
  presets: EndpointPreset[];
  /** Name → meaning, for the template help. */
  variables: Record<string, string>;
}

export interface EndpointTestResult {
  duration_s: number;
  sample_rate: number;
  channels: number;
}

/** What a test render asks for: short, so trying a paid endpoint costs little. */
const TEST_PROMPT: Record<AudioEndpoint["task"], string> = {
  sfx: "a single wooden knock",
  music: "short calm piano phrase, 90 BPM, C major",
  speech: "This is a test of the Soundbox endpoint.",
};

export class EndpointService {
  constructor(
    private readonly config: Config,
    private readonly models: ModelManager,
  ) {}

  private get stored(): AudioEndpoint[] {
    return this.config.settings.audio_endpoints;
  }

  list(): EndpointList {
    return {
      endpoints: this.stored.map(toPublicEndpoint),
      presets: ENDPOINT_PRESETS,
      variables: TEMPLATE_VARIABLES,
    };
  }

  /** Create or replace the endpoint with this id. */
  async save(id: string, raw: unknown): Promise<PublicAudioEndpoint> {
    if (!ENDPOINT_ID.test(id)) {
      throw new ModelError(
        `"${id}" can't be an endpoint id. Use lower-case letters, digits and hyphens (up to 48).`,
      );
    }
    const input = audioEndpointInputSchema.parse(raw);
    validateTemplate(input.body_template);
    validateUrlTemplate(input.url);
    const previous = this.stored.find((e) => e.id === id) ?? null;
    const endpoint = this.build(id, input, previous);
    const next = previous
      ? this.stored.map((e) => (e.id === id ? endpoint : e))
      : [...this.stored, endpoint];
    await this.persist(next);
    return toPublicEndpoint(endpoint);
  }

  async remove(id: string): Promise<void> {
    if (!this.stored.some((e) => e.id === id)) throw new ModelError(`No endpoint called "${id}".`);
    await this.persist(this.stored.filter((e) => e.id !== id));
  }

  /**
   * Render one short clip through a configuration, saved or not, and report
   * what came back. Nothing lands in the library — this answers "is the URL,
   * template and response format right?" before anyone generates for real.
   */
  async test(raw: unknown): Promise<EndpointTestResult> {
    const req = audioEndpointTestSchema.parse(raw);
    validateTemplate(req.body_template);
    validateUrlTemplate(req.url);
    const saved = req.id ? (this.stored.find((e) => e.id === req.id) ?? null) : null;
    const endpoint = this.build(req.id || "test", req, saved);
    const model = new EndpointModel(endpoint);
    const prompt = req.prompt?.trim() || TEST_PROMPT[endpoint.task];
    const clip =
      endpoint.task === "speech"
        ? await model.speak(prompt, {})
        : await model.generate(prompt, Math.min(5, endpoint.max_duration_s), { seed: 1 });
    const frames = clip.audio[0]?.length ?? 0;
    if (frames === 0) throw new ModelError("The endpoint answered, but the audio was empty.");
    return {
      duration_s: Math.round((frames / clip.sampleRate) * 1000) / 1000,
      sample_rate: clip.sampleRate,
      channels: clip.audio.length,
    };
  }

  /** Re-register after a profile switch, whose settings.json has its own list. */
  async reload(): Promise<void> {
    await this.models.setEndpoints(this.stored);
  }

  private build(id: string, input: AudioEndpointInput, previous: AudioEndpoint | null): AudioEndpoint {
    // Omitted keeps the stored key; "" clears it — the `hf_token` convention.
    const apiKey =
      input.api_key === undefined || input.api_key === null
        ? (previous?.api_key ?? null)
        : input.api_key.trim() || null;
    return {
      id,
      name: input.name,
      task: input.task,
      url: input.url,
      api_key: apiKey,
      api_key_header: input.api_key_header,
      api_key_prefix: input.api_key_prefix,
      headers: input.headers,
      body_template: input.body_template,
      response_path: input.response_path,
      pcm_sample_rate: input.pcm_sample_rate,
      max_duration_s: input.max_duration_s,
      voices: input.voices,
      enabled: input.enabled,
    };
  }

  private async persist(next: AudioEndpoint[]): Promise<void> {
    this.config.updateSettings({ audio_endpoints: next });
    await this.models.setEndpoints(next);
  }
}
