/**
 * Starting points for the endpoint form.
 *
 * Each is a filled-in `AudioEndpoint` minus the parts that are the user's own
 * (id, name, key). The bodies follow each project's published API docs as of
 * October 2026. They are a starting point, not a contract — the model names in
 * particular are whatever the user's server happens to serve, which is why the
 * form shows the template rather than hiding it behind the preset.
 *
 * Two kinds. Servers people run themselves come first. After them come
 * hosted APIs used with the person's own account and key (`hosted: true`):
 * the provider bills them directly, and Soundbox neither resells the service
 * nor sees the charge. Those are offered because a laptop without a GPU has no
 * other way to reach these models, and the form says plainly that prompts
 * leave the machine and that the provider charges for each render.
 *
 * The hosted bodies were written from each provider's API reference in
 * November 2026 and are kept to fields those pages document.
 */

import type { AudioEndpoint } from "./types.js";

export interface EndpointPreset {
  id: string;
  label: string;
  /** One sentence on what it targets, and what to change. */
  hint: string;
  docs_url: string;
  /** A paid service reached with the user's own key, billed by its provider. */
  hosted: boolean;
  /** Where the provider lists what a render costs. "" for self-hosted. */
  pricing_url: string;
  endpoint: Omit<AudioEndpoint, "id" | "name" | "api_key" | "enabled">;
}

const BASE = {
  api_key_header: "Authorization",
  api_key_prefix: "Bearer ",
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

/** ElevenLabs takes its key in `xi-api-key`, bare, rather than as a bearer token. */
const ELEVENLABS = { ...BASE, api_key_header: "xi-api-key", api_key_prefix: "" };

export const ENDPOINT_PRESETS: EndpointPreset[] = [
  {
    id: "localai-ace-step",
    label: "LocalAI — ACE-Step music",
    hint:
      "LocalAI's /v1/sound-generation with an ACE-Step model. Set the model name to the one your " +
      "LocalAI serves. This sends `model_id`, as LocalAI's field table names it; its ACE-Step example uses `model`, so if one is rejected, rename it.",
    docs_url: "https://localai.io/docs/features/text-to-audio/",
    hosted: false,
    pricing_url: "",
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
    hosted: false,
    pricing_url: "",
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
    hosted: false,
    pricing_url: "",
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
  {
    id: "elevenlabs-sfx",
    label: "ElevenLabs — sound effects (your account)",
    hint:
      "ElevenLabs text-to-sound-effects, up to 30 seconds, billed to your ElevenLabs account. " +
      "Answers in MP3, so ffmpeg is needed; on a plan that allows it, change output_format in the URL to wav_44100 to skip ffmpeg.",
    docs_url: "https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert",
    hosted: true,
    pricing_url: "https://elevenlabs.io/pricing/api",
    endpoint: {
      ...ELEVENLABS,
      task: "sfx",
      url: "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128",
      body_template: json({
        text: '"{{prompt}}"',
        duration_seconds: "{{duration}}",
        model_id: '"eleven_text_to_sound_v2"',
      }),
      max_duration_s: 30,
    },
  },
  {
    id: "elevenlabs-music",
    label: "ElevenLabs — music (your account)",
    hint:
      "ElevenLabs Music from a prompt, 3 seconds to 10 minutes, billed to your ElevenLabs account. " +
      "Answers in MP3, so ffmpeg is needed. Describe vocals in the prompt; this preset sends no lyrics.",
    docs_url: "https://elevenlabs.io/docs/api-reference/music/compose",
    hosted: true,
    pricing_url: "https://elevenlabs.io/pricing/api",
    endpoint: {
      ...ELEVENLABS,
      task: "music",
      url: "https://api.elevenlabs.io/v1/music",
      body_template: json({
        prompt: '"{{prompt}}"',
        music_length_ms: "{{duration_ms}}",
        model_id: '"music_v1"',
        seed: "{{seed}}",
      }),
      max_duration_s: 600,
    },
  },
  {
    id: "elevenlabs-speech",
    label: "ElevenLabs — speech (your account)",
    hint:
      "ElevenLabs text to speech, billed to your ElevenLabs account. Voices are voice IDs: replace the " +
      "example with IDs from your ElevenLabs Voices page. Answers in MP3, so ffmpeg is needed.",
    docs_url: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
    hosted: true,
    pricing_url: "https://elevenlabs.io/pricing/api",
    endpoint: {
      ...ELEVENLABS,
      task: "speech",
      url: "https://api.elevenlabs.io/v1/text-to-speech/{{voice}}?output_format=mp3_44100_128",
      body_template: json({
        text: '"{{text}}"',
        model_id: '"eleven_multilingual_v2"',
        language_code: '"{{language}}"',
        seed: "{{seed}}",
      }),
      max_duration_s: 300,
      // The voice in ElevenLabs' own API example. Users list their own.
      voices: ["JBFqnCBsd6RMkjVDRZzb"],
    },
  },
  {
    id: "fal-ace-step",
    label: "fal — ACE-Step music (your account)",
    hint:
      "ACE-Step on fal, billed to your fal account per second of audio. fal writes the tags and lyrics from the prompt. " +
      "The answer is a link to a WAV, which Soundbox downloads.",
    docs_url: "https://fal.ai/models/fal-ai/ace-step/prompt-to-audio/api",
    hosted: true,
    pricing_url: "https://fal.ai/models/fal-ai/ace-step/prompt-to-audio",
    endpoint: {
      ...BASE,
      api_key_prefix: "Key ",
      task: "music",
      url: "https://fal.run/fal-ai/ace-step/prompt-to-audio",
      body_template: json({
        prompt: '"{{prompt}}"',
        duration: "{{duration}}",
        seed: "{{seed}}",
        number_of_steps: "{{steps}}",
      }),
      response_path: "audio.url",
      max_duration_s: 240,
    },
  },
];
