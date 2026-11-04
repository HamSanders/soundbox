/**
 * Starting points for the endpoint form.
 *
 * Each is a filled-in `AudioEndpoint` minus the parts that are the user's own
 * (id, name, key). The bodies follow each project's published API docs as of
 * October 2026. They are a starting point, not a contract — the model names in
 * particular are whatever the user's server happens to serve, which is why the
 * form shows the template rather than hiding it behind the preset.
 *
 * Only servers people run themselves get a preset. A hosted, billed API can
 * still be added by hand — the template takes any URL — but Konchi does not
 * promote one with a one-click entry.
 */

import type { AudioEndpoint } from "./types.js";

export interface EndpointPreset {
  id: string;
  label: string;
  /** One sentence on what it targets, and what to change. */
  hint: string;
  docs_url: string;
  endpoint: Omit<AudioEndpoint, "id" | "name" | "api_key" | "enabled">;
}

const BASE = {
  headers: {},
  response_path: "",
  pcm_sample_rate: 24_000,
  voices: [] as string[],
};

const json = (body: Record<string, string>): string =>
  // Pretty-printed with the placeholders left bare where they are numbers or
  // booleans, which is the form the issue that asked for this wrote them in.
  "{\n" +
  Object.entries(body)
    .map(([k, v]) => `  "${k}": ${v}`)
    .join(",\n") +
  "\n}";

export const ENDPOINT_PRESETS: EndpointPreset[] = [
  {
    id: "localai-ace-step",
    label: "LocalAI — ACE-Step music",
    hint:
      "LocalAI's /v1/sound-generation with an ACE-Step model. Set the model name to the one your " +
      "LocalAI serves. This sends `model_id`, as LocalAI's field table names it; its ACE-Step example uses `model`, so if one is rejected, rename it.",
    docs_url: "https://localai.io/docs/features/text-to-audio/",
    endpoint: {
      ...BASE,
      task: "music",
      url: "http://localhost:8080/v1/sound-generation",
      body_template: json({
        model_id: '"ace-step-turbo"',
        caption: '"{{prompt}}"',
        lyrics: '"{{lyrics}}"',
        instrumental: "{{instrumental}}",
        bpm: "{{bpm}}",
        keyscale: '"{{key}}"',
        duration_seconds: "{{duration}}",
      }),
      max_duration_s: 240,
    },
  },
  {
    id: "localai-sound",
    label: "LocalAI — sound effects",
    hint: "LocalAI's ElevenLabs-compatible /v1/sound-generation. Set model_id to a sound model your LocalAI serves.",
    docs_url: "https://localai.io/docs/features/text-to-audio/",
    endpoint: {
      ...BASE,
      task: "sfx",
      url: "http://localhost:8080/v1/sound-generation",
      body_template: json({
        model_id: '"your-sound-model"',
        text: '"{{prompt}}"',
        duration_seconds: "{{duration}}",
      }),
      max_duration_s: 30,
    },
  },
  {
    id: "openai-speech",
    label: "OpenAI-compatible speech (/v1/audio/speech)",
    hint:
      "OpenAI, LocalAI, Inference Gateway and most proxies. Asks for WAV, so no ffmpeg is needed. " +
      "Set the model and list the voices your server offers.",
    docs_url: "https://platform.openai.com/docs/api-reference/audio/createSpeech",
    endpoint: {
      ...BASE,
      task: "speech",
      url: "http://localhost:8080/v1/audio/speech",
      body_template: json({
        model: '"tts-1"',
        input: '"{{text}}"',
        voice: '"{{voice}}"',
        response_format: '"wav"',
      }),
      max_duration_s: 300,
      voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
    },
  },
];
