/**
 * In-memory mock backend (VITE_MOCK=1).
 *
 * Implements the same surface as the HTTP client so the whole UI — including
 * job streaming and audio playback — works with no server. Audio is synthesised
 * in-browser with an OfflineAudioContext and handed out as blob URLs.
 */

import type {
  Failure,
  AssistantChatRequest,
  AssistantOpenersRequest,
  AssistantOpenersResponse,
  Conversation,
  DirectoryListing,
  HistoryEntry,
  NewHistoryEntry,
  AssistantChatResponse,
  AudioCppCatalogEntry,
  AudioEndpoint,
  AudioEndpointInput,
  EndpointPreset,
  EnhanceLyricsRequest,
  EnhanceLyricsResponse,
  EnhanceRequest,
  EnhanceResponse,
  Model,
  GenerateRequest,
  HealthStatus,
  Job,
  JobRef,
  ImageModelEntry,
  ImageStatus,
  LlmModelEntry,
  LlmStatus,
  LogTail,
  McpCall,
  McpCallQuery,
  McpClient,
  McpStatus,
  McpToolInfo,
  ConvertRequest,
  Project,
  Session,
  Profile,
  Settings,
  SpeakRequest,
  Story,
  StorySegment,
  StoryTrack,
  Voice,
  SettingsPatch,
  SkillInstallRequest,
  SkillInstallResult,
  Sound,
  SoundEditRequest,
  SoundPatch,
  SoundQuery,
  SoundboxApi,
  SoundsPage,
  StemSelection,
  TagCount,
  Unsubscribe,
} from "./api";
import { clampDeviceParams, createDevice } from "./devices";
import { followPlacement } from "./reading-order";

/* ------------------------------------------------------------- utilities */

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}-${Date.now().toString(36)}`;

/** Deterministic 0..1 PRNG so peaks/waveforms are stable across reloads. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

type Shape = "impact" | "swell" | "burst" | "tonal";

/** 256 normalised peaks with a plausible envelope for the given shape. */
function synthPeaks(seed: number, shape: Shape): number[] {
  const rand = rng(seed);
  const n = 256;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let env: number;
    switch (shape) {
      case "impact":
        env = Math.exp(-8 * t);
        break;
      case "swell":
        env = Math.sin(Math.PI * t) ** 1.4;
        break;
      case "burst":
        env = t < 0.06 ? t / 0.06 : Math.exp(-3.2 * (t - 0.06));
        break;
      default:
        env = 0.55 + 0.35 * Math.sin(t * Math.PI * 6);
    }
    const jitter = 0.55 + 0.45 * rand();
    out.push(Math.min(1, Math.max(0.01, env * jitter)));
  }
  return out;
}

/* --------------------------------------------------- in-browser WAV synth */

function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = 44 + frames * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, frames * channels * 2, true);

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

/** Render a short noise/tone sketch shaped by `peaks` and return a blob URL. */
async function renderBlobUrl(
  durationS: number,
  peaks: number[],
  shape: Shape,
  seed: number,
): Promise<string> {
  const AC: typeof OfflineAudioContext =
    (window as unknown as { OfflineAudioContext: typeof OfflineAudioContext })
      .OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  const sampleRate = 44100;
  const frames = Math.max(1, Math.floor(durationS * sampleRate));
  const ctx = new AC(1, frames, sampleRate);
  const buf = ctx.createBuffer(1, frames, sampleRate);
  const ch = buf.getChannelData(0);
  const rand = rng(seed);
  const baseFreq = 80 + (seed % 7) * 55;
  let phase = 0;
  for (let i = 0; i < frames; i++) {
    const t = i / frames;
    const env = peaks[Math.min(peaks.length - 1, Math.floor(t * peaks.length))];
    const noise = rand() * 2 - 1;
    phase += (2 * Math.PI * baseFreq * (shape === "tonal" ? 1 : 1 - 0.6 * t)) / sampleRate;
    const tone = Math.sin(phase);
    const mix = shape === "tonal" ? 0.85 * tone + 0.15 * noise : 0.35 * tone + 0.65 * noise;
    ch[i] = mix * env * 0.7;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return URL.createObjectURL(encodeWav(rendered));
}

/* --------------------------------------------------------- sound editing */
//
// The mock's answer to `POST /api/sounds/{id}/edit`: decode the source clip's
// synthesised WAV back to samples, run the same op the backend would (trim,
// gain, reverse, EQ, pitch/time-stretch), and re-encode. The DSP here is
// deliberately simple — one-pole filters instead of scipy's Butterworth,
// linear-interpolation resampling instead of librosa's phase vocoder — good
// enough to demo the controls without pulling a real audio library into the
// mock. The backend (`soundbox/audio.py`) is the one this has to *look*
// right next to, not be bit-identical with.

async function decodeMono(fileUrl: string): Promise<{ samples: Float32Array; sampleRate: number }> {
  const AC: typeof AudioContext =
    (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const res = await fetch(fileUrl);
    const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
    if (decoded.numberOfChannels === 1) {
      return { samples: decoded.getChannelData(0).slice(), sampleRate: decoded.sampleRate };
    }
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const ch = decoded.getChannelData(c);
      for (let i = 0; i < decoded.length; i++) mono[i] += ch[i] / decoded.numberOfChannels;
    }
    return { samples: mono, sampleRate: decoded.sampleRate };
  } finally {
    void ctx.close();
  }
}

function reverseSamples(s: Float32Array): Float32Array {
  const out = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s[s.length - 1 - i];
  return out;
}

function gainSamples(s: Float32Array, gainDb: number): Float32Array {
  const g = 10 ** (gainDb / 20);
  const out = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s[i] * g;
  return out;
}

function trimSamples(s: Float32Array, sampleRate: number, startS: number, endS: number): Float32Array {
  const start = Math.max(0, Math.round(startS * sampleRate));
  const end = Math.min(s.length, Math.round(endS * sampleRate));
  if (end <= start) throw new Error("The trim's end must be after its start.");
  return s.slice(start, end);
}

function peakNormalizeSamples(s: Float32Array, targetDbfs = -1): Float32Array {
  let peak = 0;
  for (let i = 0; i < s.length; i++) peak = Math.max(peak, Math.abs(s[i]));
  if (peak <= 1e-8) return s.slice();
  const g = 10 ** (targetDbfs / 20) / peak;
  const out = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s[i] * g;
  return out;
}

/** One-pole filters, not the backend's Butterworth — enough roll-off to
 *  demonstrate the control in the mock. */
function onePoleLowpass(s: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  const out = new Float32Array(s.length);
  let prev = 0;
  for (let i = 0; i < s.length; i++) {
    prev += alpha * (s[i] - prev);
    out[i] = prev;
  }
  return out;
}

function onePoleHighpass(s: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);
  const out = new Float32Array(s.length);
  let prevIn = s[0] ?? 0;
  let prevOut = 0;
  for (let i = 0; i < s.length; i++) {
    prevOut = alpha * (prevOut + s[i] - prevIn);
    prevIn = s[i];
    out[i] = prevOut;
  }
  return out;
}

/** Linear-interpolation resample — ties pitch and duration together, unlike
 *  the backend's librosa phase vocoder. A real independent pitch/time model
 *  is out of scope for a mock backend. */
function resample(s: Float32Array, factor: number): Float32Array {
  const outLen = Math.max(1, Math.round(s.length / factor));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * factor;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(s.length - 1, i0 + 1);
    const frac = srcPos - i0;
    out[i] = (s[i0] ?? 0) * (1 - frac) + (s[i1] ?? 0) * frac;
  }
  return out;
}

function computePeaksFromSamples(s: Float32Array, buckets = 256): number[] {
  if (s.length === 0) return new Array(buckets).fill(0) as number[];
  const chunk = Math.max(1, Math.floor(s.length / buckets));
  const peaks: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const start = b * chunk;
    const end = b === buckets - 1 ? s.length : Math.min(s.length, start + chunk);
    let max = 0;
    for (let i = start; i < end; i++) max = Math.max(max, Math.abs(s[i]));
    peaks.push(max);
  }
  const top = Math.max(...peaks, 0);
  return peaks.map((p) => (top > 0 ? Math.round((p / top) * 10000) / 10000 : 0));
}

/** Mono 16-bit PCM WAV — the edit path's own encoder, separate from
 *  `encodeWav` above (which encodes an `AudioBuffer` for the synth path). */
function encodeMonoWav(samples: Float32Array, sampleRate: number): Blob {
  const frames = samples.length;
  const bytes = 44 + frames * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, frames * 2, true);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    off += 2;
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

const EDIT_LABELS: Record<SoundEditRequest["op"], string> = {
  trim: "trimmed",
  normalize: "normalised",
  reverse: "reversed",
  gain: "gain",
  highpass: "high-pass",
  lowpass: "low-pass",
  pitch: "pitch shift",
  stretch: "time-stretch",
};

/* ----------------------------------------------------------------- state */

const models: Model[] = [
  {
    id: "stable-audio-3-small-sfx",
    family: "stable_audio",
    params: [],
    name: "Stable Audio 3.0 Small SFX",
    vendor: "Stability AI",
    description:
      "0.6B-parameter diffusion model from the Stable Audio 3.0 family, tuned for sound effects and sized for consumer GPUs.",
    license: {
      name: "Stability AI Community License",
      commercial: "conditional",
      url: "https://stability.ai/license",
      note: "Free for individuals and organisations with under $1M annual revenue. Above that you need a Stability enterprise licence.",
    },
    hf_repo: "stabilityai/stable-audio-3-small-sfx",
    gated: true,
    task: "gen",
    voice_ids: [],
    category: "sfx",
    max_duration_s: 11,
    sample_rate: 44100,
    channels: 2,
    supports: { negative_prompt: true, seed: true, steps: true, cfg: true, lyrics: false, text: false, voice_reference: false, extend: false, cover: false, repaint: false },
    defaults: { duration_s: 5, steps: 8, cfg: 1.0 },
    vram_estimate_mb: 3000,
    extras: [],
    status: "not_installed",
    installed_deps: false,
    error: null,
  },
  {
    id: "stable-audio-open-small",
    family: "stable_audio",
    params: [],
    name: "Stable Audio Open Small",
    vendor: "Stability AI",
    description:
      "341M-parameter text-to-audio, ~11s stereo 44.1kHz. Fast, great for one-shot SFX and short ambiences.",
    license: {
      name: "Stability AI Community License",
      commercial: "conditional",
      url: "https://huggingface.co/stabilityai/stable-audio-open-small",
      note: "Free for individuals and organisations with under $1M annual revenue. Above that you need a Stability enterprise licence.",
    },
    hf_repo: "stabilityai/stable-audio-open-small",
    gated: true,
    task: "gen",
    voice_ids: [],
    category: "sfx",
    max_duration_s: 11,
    sample_rate: 44100,
    channels: 2,
    supports: { negative_prompt: true, seed: true, steps: true, cfg: true, lyrics: false, text: false, voice_reference: false, extend: false, cover: false, repaint: false },
    defaults: { duration_s: 5, steps: 8, cfg: 1.0 },
    vram_estimate_mb: 4000,
    extras: [],
    status: "installed",
    installed_deps: true,
    error: null,
  },
  {
    id: "audiogen-medium",
    family: "audiogen",
    params: [],
    name: "AudioGen Medium",
    vendor: "Meta",
    description:
      "1.5B autoregressive audio LM. Slower, but strong on layered environmental sound and long ambience beds.",
    license: {
      name: "CC-BY-NC 4.0",
      commercial: "no",
      url: "https://huggingface.co/facebook/audiogen-medium",
      note: "Model weights are released for research use only.",
    },
    hf_repo: "facebook/audiogen-medium",
    gated: false,
    task: "gen",
    voice_ids: [],
    category: "sfx",
    max_duration_s: 30,
    sample_rate: 16000,
    channels: 1,
    supports: { negative_prompt: false, seed: true, steps: false, cfg: true, lyrics: false, text: false, voice_reference: false, extend: false, cover: false, repaint: false },
    defaults: { duration_s: 8, steps: null, cfg: 3.0 },
    vram_estimate_mb: 7200,
    extras: [],
    status: "incomplete",
    installed_deps: false,
    error: null,
  },
  {
    id: "tangoflux-base",
    family: "tangoflux",
    params: [],
    name: "TangoFlux Base",
    vendor: "Declare Lab",
    description:
      "Rectified-flow text-to-audio at 44.1kHz. Very fast sampling — usable for iterating on a prompt in real time.",
    license: {
      name: "Apache-2.0",
      commercial: "yes",
      url: "https://www.apache.org/licenses/LICENSE-2.0",
      note: null,
    },
    hf_repo: "declare-lab/TangoFlux",
    gated: false,
    task: "gen",
    voice_ids: [],
    category: "sfx",
    max_duration_s: 30,
    sample_rate: 44100,
    channels: 1,
    supports: { negative_prompt: true, seed: true, steps: true, cfg: true, lyrics: false, text: false, voice_reference: false, extend: false, cover: false, repaint: false },
    defaults: { duration_s: 6, steps: 25, cfg: 3.5 },
    vram_estimate_mb: 5600,
    extras: [],
    // Exercises the "weights present, runtime missing" state in the mock,
    // which is otherwise only reachable with a half-installed real setup.
    status: "needs_runtime",
    installed_deps: false,
    error: null,
  },
  {
    id: "audiocpp-stable-audio-3-sfx",
    family: "stable_audio",
    params: [],
    name: "Stable Audio 3.0 SFX (audio.cpp)",
    vendor: "Stability AI",
    description:
      "The same Stable Audio 3.0 Small SFX weights as the native model, run through audio.cpp's C++/ggml runtime from a quantised GGUF. Lower VRAM, no Python stack, at the cost of reloading the model on every generation.",
    license: {
      name: "Stability AI Community License",
      commercial: "conditional",
      url: "https://stability.ai/license",
      note: "Free for individuals and organisations with under $1M annual revenue. Above that you need a Stability enterprise licence.",
    },
    hf_repo: "audio-cpp/audio.cpp-gguf",
    gated: false,
    task: "gen",
    voice_ids: [],
    category: "sfx",
    max_duration_s: 120,
    sample_rate: 44100,
    channels: 2,
    supports: { negative_prompt: false, seed: true, steps: true, cfg: true, lyrics: false, text: false, voice_reference: false, extend: false, cover: false, repaint: false },
    defaults: { duration_s: 10, steps: 8, cfg: 1.0 },
    vram_estimate_mb: 2500,
    max_cfg: 3.0,
    extras: ["audio-cpp"],
    status: "not_installed",
    installed_deps: false,
    auto_installable: false,
    manual_install_reason:
      "This model runs on audio.cpp, a native binary rather than a Python package — there is nothing for pip to install.",
    error: null,
  },
  {
    id: "audiocpp-stable-audio-3-small-music",
    family: "stable_audio",
    params: [],
    name: "Stable Audio 3.0 Small Music (audio.cpp)",
    vendor: "Stability AI",
    description:
      "Music-tuned sibling of the SFX model above, same stable_audio loader and GGUF repo, different fine-tune.",
    license: {
      name: "Stability AI Community License",
      commercial: "conditional",
      url: "https://stability.ai/license",
      note: "Free for individuals and organisations with under $1M annual revenue. Above that you need a Stability enterprise licence.",
    },
    hf_repo: "audio-cpp/audio.cpp-gguf",
    gated: false,
    task: "gen",
    voice_ids: [],
    category: "music",
    max_duration_s: 120,
    sample_rate: 44100,
    channels: 2,
    supports: { negative_prompt: false, seed: true, steps: true, cfg: true, lyrics: false, text: false, voice_reference: false, extend: false, cover: false, repaint: false },
    defaults: { duration_s: 10, steps: 8, cfg: 1.0 },
    vram_estimate_mb: 2500,
    max_cfg: 3.0,
    extras: ["audio-cpp"],
    status: "not_installed",
    installed_deps: false,
    auto_installable: false,
    manual_install_reason:
      "This model runs on audio.cpp, a native binary rather than a Python package — there is nothing for pip to install.",
    error: null,
  },
  {
    id: "audiocpp-ace-step",
    family: "ace_step",
    params: [],
    name: "ACE-Step 1.5 Turbo (audio.cpp)",
    vendor: "ACE Studio / StepFun",
    description:
      "Lyrics-conditioned vocal music generation via a different loader family (ace_step) than Stable Audio. Turbo variant, distilled for few-step sampling. Set lyrics to sing a song instead of generating instrumental audio.",
    license: {
      name: "Apache 2.0 (unverified)",
      commercial: "yes",
      url: "https://github.com/ace-step/ACE-Step/blob/main/LICENSE",
      note: "Check the model card before shipping — the licence text itself is unverified, only generation was tested.",
    },
    hf_repo: "audio-cpp/audio.cpp-gguf",
    gated: false,
    task: "gen",
    voice_ids: [],
    category: "music",
    max_duration_s: 60,
    // Measured, not documented anywhere: 48kHz, not the 44.1kHz every other
    // model on this page uses.
    sample_rate: 48000,
    channels: 2,
    // The real catalogue declares all three audio-to-audio routes for
    // ACE-Step; the mock said none, which left the editor's Repaint tool
    // invisible in a mock build for no reason but staleness.
    supports: { negative_prompt: false, seed: true, steps: true, cfg: true, lyrics: true, text: false, voice_reference: false, extend: true, cover: true, repaint: true },
    defaults: { duration_s: 10, steps: 8, cfg: 1.0 },
    vram_estimate_mb: 4000,
    max_cfg: 3.0,
    extras: ["audio-cpp"],
    // Installed in the fixture: it is the only model that can extend, cover
    // or repaint, so with it absent a mock build cannot show the timeline's
    // audio-to-audio actions at all — the rows are gated on a ready model.
    status: "installed",
    installed_deps: true,
    auto_installable: false,
    manual_install_reason:
      "This model runs on audio.cpp, a native binary rather than a Python package — there is nothing for pip to install.",
    error: null,
  },
  {
    id: "audiocpp-chatterbox",
    family: "chatterbox",
    name: "Chatterbox (audio.cpp)",
    vendor: "Resemble AI",
    description:
      "Voice cloning from a reference clip. Its `exaggeration` knob is the one control here that measurably changes how a line is read.",
    license: {
      name: "MIT",
      commercial: "yes",
      url: "https://github.com/resemble-ai/chatterbox",
      note: null,
    },
    hf_repo: "audio-cpp/audio.cpp-gguf",
    gated: false,
    task: "tts",
    voice_ids: [],
    requires_voice_reference: true,
    category: "voice",
    max_duration_s: 0,
    sample_rate: 24000,
    channels: 1,
    supports: {
      negative_prompt: false, seed: true, steps: false, cfg: false, lyrics: false,
      text: true, voice_reference: true, extend: false, cover: false, repaint: false,
    },
    defaults: { duration_s: 0 },
    vram_estimate_mb: 3000,
    extras: ["audio-cpp"],
    status: "installed",
    installed_deps: true,
    auto_installable: false,
    manual_install_reason:
      "This model runs on audio.cpp, a native binary rather than a Python package.",
    error: null,
    // Verbatim from audio.cpp's own model_params.json, the same source the
    // server reads — so the mock's sliders have the ranges the real ones do.
    params: [
      { name: "exaggeration", type: "slider", label: "exaggeration", group: "delivery",
        default: 0.5, minimum: 0, maximum: 2, step: 0.05,
        info: "Takes effect after the model is reloaded." },
      { name: "guidance_scale", type: "slider", label: "guidance_scale", group: "quality",
        default: 0.5, minimum: 0, maximum: 1, step: 0.05,
        info: "Takes effect after the model is reloaded." },
      { name: "temperature", type: "slider", label: "temperature", group: "sampling",
        default: 0.8, minimum: 0, maximum: 2, step: 0.05 },
      { name: "repetition_penalty", type: "slider", label: "repetition_penalty", group: "sampling",
        default: 1.2, minimum: 1, maximum: 2, step: 0.01 },
    ],
  },
];

/** Builds a placeholder Model row for an enabled-but-unverified catalog
 *  entry — same shape a real audio.cpp model reports before its binary is
 *  installed, so the row renders through the normal Models page rather than
 *  needing special-casing there. */
function audioCppModelFromCatalog(
  entry: Omit<AudioCppCatalogEntry, "enabled" | "on_disk">,
): Model {
  return {
    // A catalog row carries no loader family, and an uninstalled placeholder
    // has no parameters to offer until it is real.
    family: "",
    params: [],
    id: entry.id,
    name: entry.name,
    vendor: entry.vendor,
    description: entry.description,
    license: entry.license,
    hf_repo: "audio-cpp/audio.cpp-gguf",
    gated: false,
    task: "gen",
    voice_ids: [],
    category: entry.category,
    max_duration_s: 60,
    sample_rate: 44100,
    channels: 2,
    supports: { negative_prompt: false, seed: true, steps: true, cfg: true, lyrics: false, text: false, voice_reference: false, extend: false, cover: false, repaint: false },
    defaults: { duration_s: 10, steps: 8, cfg: 1.0 },
    vram_estimate_mb: 4000,
    max_cfg: 3.0,
    extras: ["audio-cpp"],
    // A model adopted because its weights are on the machine has to *say* it
    // is downloaded — an "On this device" row beside a Download button would
    // be the mock contradicting itself.
    status: DOWNLOADED_EXTRAS.has(entry.id) ? "installed" : "not_installed",
    installed_deps: false,
    auto_installable: false,
    manual_install_reason:
      "This model runs on audio.cpp, a native binary rather than a Python package — there is nothing for pip to install.",
    error: null,
  };
}

interface SeedSound {
  name: string;
  prompt: string;
  tags: string[];
  model: string;
  duration_s: number;
  shape: Shape;
  favorite: boolean;
  /** Who "made" this seed sound — mixed on purpose so Library filters and
   *  the source badge have something to show without waiting for a live
   *  agent to connect. */
  source?: "app" | "api" | "mcp";
  client?: string;
}

const seedSounds: SeedSound[] = [
  {
    name: "Door slam 01",
    prompt: "heavy wooden door slam, dry room, close mic",
    tags: ["door", "impact", "foley"],
    model: "audiocpp-stable-audio-3-sfx",
    duration_s: 2.4,
    shape: "impact",
    favorite: true,
  },
  {
    name: "UI confirm blip",
    prompt: "short synthetic UI confirmation blip, clean, bright",
    tags: ["ui", "synth"],
    model: "audiocpp-stable-audio-3-sfx",
    duration_s: 0.8,
    shape: "tonal",
    favorite: true,
  },
  {
    name: "Gravel footstep",
    prompt: "single footstep on loose gravel, outdoor, no reverb",
    tags: ["footstep", "foley"],
    model: "audiocpp-stable-audio-3-sfx",
    duration_s: 1.1,
    shape: "burst",
    favorite: false,
    source: "mcp",
    client: "claude-code 2.1.0",
  },
  {
    name: "Rain on tin roof",
    prompt: "steady rain hitting a corrugated tin roof, distant thunder",
    tags: ["ambience", "rain", "weather"],
    model: "audiocpp-stable-audio-3-sfx",
    duration_s: 9.5,
    shape: "swell",
    favorite: false,
  },
  {
    name: "Sword unsheath",
    prompt: "metal sword drawn from leather scabbard, sharp ring-out",
    tags: ["weapon", "metal", "foley"],
    model: "audiocpp-stable-audio-3-sfx",
    duration_s: 1.8,
    shape: "burst",
    favorite: false,
    source: "mcp",
    client: "cursor 1.4.2",
  },
  {
    name: "Distant explosion",
    prompt: "large explosion heard from far away, low rumble tail",
    tags: ["explosion", "impact"],
    model: "audiocpp-stable-audio-3-sfx",
    duration_s: 6.0,
    shape: "impact",
    favorite: true,
  },
  {
    name: "Server room hum",
    prompt: "constant server room hum with fan whine, tight space",
    tags: ["ambience", "machine"],
    model: "audiocpp-stable-audio-3-sfx",
    duration_s: 12.0,
    shape: "swell",
    favorite: false,
  },
  {
    name: "Glass shatter",
    prompt: "pane of glass shattering on concrete, debris settling",
    tags: ["glass", "impact", "debris"],
    model: "audiocpp-stable-audio-3-sfx",
    duration_s: 3.2,
    shape: "burst",
    favorite: false,
    source: "api",
  },
];

interface MockSound extends Sound {
  _shape: Shape;
  _seed: number;
}

/** Sessions mirror the backend: created on first generate, titled from the
 *  prompt, bumped on every sound. Seed sounds start ungrouped, like a real
 *  library that predates sessions. */
const sessions: Session[] = [];

/** Projects, unlike sessions, are never created implicitly — only by name,
 *  from the sidebar's "New project" — so the mock starts with none. */
const projects: Project[] = [];

/** A line written but not yet spoken still holds its place on the timeline —
 *  the studio's own placeholder width, mirrored here so the mock's thumbnails
 *  match what its studio draws. */
function estimateDuration(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(0.8, words * 0.4);
}

/** Stories, like projects, only exist once you make one. */
const stories: Story[] = [];
const segments: StorySegment[] = [];
const tracks: StoryTrack[] = [];

/**
 * Saved voices. Seeded with two so the Voice studio has something to pick on
 * a cold start — one builtin (PocketTTS ships real voice names) and one clone,
 * which are the two kinds the studio has to render differently.
 */
const voices: Voice[] = [
  {
    id: "voice-mock-narrator",
    name: "Narrator",
    kind: "builtin",
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    reference_file: null,
    voice_id: "peter_yearsley",
    model_id: "audiocpp-pocket-tts",
    notes: "Measured, documentary read.",
  },
  {
    id: "voice-mock-ada",
    name: "Ada",
    kind: "clone",
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    // No real clip in the mock — the studio treats a null reference as
    // "nothing to preview" rather than breaking.
    reference_file: null,
    voice_id: null,
    // A clone is tied to a model too — the voice is what gets picked, and
    // the model it speaks through comes with it. Chatterbox because it is the
    // one text-to-speech family this mock catalogue actually reports: a voice
    // pointed at a model that is not installed is filtered out of every
    // picker, which is exactly what happens to the builtin above.
    model_id: "audiocpp-chatterbox",
    notes: "Cloned from a studio read.",
  },
];

/** A voice as the server returns it: with its library count, which the
 *  server computes rather than stores. */
function withVoiceCounts(voice: Voice): Voice {
  return {
    ...voice,
    samples: voice.kind === "clone" ? [...(voice.samples ?? [])] : [],
    read_count: sounds.filter((s) => s.voice_id === voice.id).length,
  };
}

/** A clip's length for the mock's clip list, read the way the browser reads
 *  it. Null when it cannot be decoded, which the list renders as no length. */
async function mockDuration(file: Blob): Promise<number | null> {
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    return buffer.duration;
  } catch {
    return null;
  }
}

/** Stable ids so the mock log reads like one coherent run. */
const mockJobId = "3f4c0470-deb7-4310-82a1-4fca49dfd9b1";
const mockOtherJobId = "b1ab888b-7160-45f7-b15a-2c9bc2fa9a42";

const sounds: MockSound[] = seedSounds.map((s, i) => {
  const seed = 1000 + i * 137;
  const peaks = synthPeaks(seed, s.shape);
  return {
    id: `snd-${String(i + 1).padStart(3, "0")}`,
    created_at: new Date(Date.now() - (i + 1) * 3600_000 * 5).toISOString(),
    model: s.model,
    prompt: s.prompt,
    negative_prompt: i % 3 === 0 ? "music, voice" : null,
    duration_s: s.duration_s,
    seed,
    steps: 8,
    cfg: 3.0,
    sample_rate: 44100,
    channels: 1,
    file: "",
    peaks,
    favorite: s.favorite,
    tags: s.tags,
    name: s.name,
    size_bytes: Math.round(s.duration_s * 44100 * 2),
    session_id: null,
    project_id: null,
    effective_project_id: null,
    source: s.source ?? "app",
    client: s.client ?? null,
    _shape: s.shape,
    _seed: seed,
  };
});

const jobs = new Map<string, Job>();
const jobListeners = new Map<string, Set<(job: Job) => void>>();

/** Mirrors the real backend's models.audiocpp.CATALOG_EXTRA — kept short and
 *  hand-in-sync since there's no server here to read it from. */
const AUDIOCPP_CATALOG_EXTRA: Omit<AudioCppCatalogEntry, "enabled" | "on_disk">[] = [
  {
    id: "audiocpp-stable-audio-3-medium",
    name: "Stable Audio 3.0 Medium (audio.cpp)",
    vendor: "Stability AI",
    description:
      "Larger sibling of the SFX model, same stable_audio loader. No native model exists for this size yet.",
    license: {
      name: "Stability AI Community License",
      commercial: "conditional",
      url: "https://stability.ai/license",
    },
    verified: false,
    always_on: false,
    category: "music",
  },
  {
    id: "audiocpp-heartmula",
    name: "HeartMuLa (audio.cpp)",
    vendor: "Unverified",
    description:
      "Music generation via the heartmula loader. Least verified entry — vendor and licence unchecked.",
    license: {
      name: "Unknown",
      commercial: "conditional",
      url: "https://huggingface.co/audio-cpp/audio.cpp-gguf",
    },
    verified: false,
    always_on: false,
    category: "music",
  },
];

/** Catalog extras whose weights the mock pretends are already downloaded —
 *  the case that used to show an "off" toggle beside a usable model. */
const DOWNLOADED_EXTRAS = new Set(["audiocpp-heartmula"]);

/**
 * A pretend Windows disk for the folder picker.
 *
 * Keyed by folder path, valued by child folder names. Enough shape to walk
 * up, down and across drives, which is all the picker does — the real
 * endpoint reads the server's actual filesystem.
 */
const mockDisk: Record<string, string[]> = {
  "C:\\": ["Program Files", "Users", "Windows"],
  "C:\\Users": ["you", "Public"],
  "C:\\Users\\you": [".soundbox", "Documents", "Downloads", "Music"],
  "C:\\Users\\you\\.soundbox": ["artwork", "bin", "cache", "models", "sounds"],
  "C:\\Users\\you\\Music": ["Recordings", "Samples"],
  "D:\\": ["audio", "backups"],
  "D:\\audio": ["libraries", "renders"],
};

function mockListing(path: string): DirectoryListing {
  // Walk up to something the pretend disk knows about, the same way the
  // server falls back to the nearest folder that still exists.
  let at = path.trim() || "C:\\Users\\you";
  while (!(at in mockDisk) && at.includes("\\")) {
    at = at.slice(0, at.lastIndexOf("\\")) || at.slice(0, 2) + "\\";
    if (at.length === 2) at += "\\";
  }
  if (!(at in mockDisk)) at = "C:\\Users\\you";
  const isRoot = at.length === 3 && at.endsWith(":\\");
  return {
    path: at,
    parent: isRoot ? null : at.slice(0, at.lastIndexOf("\\")) || null,
    separator: "\\",
    home: "C:\\Users\\you",
    writable: !at.startsWith("C:\\Windows"),
    roots: [
      { name: "C:", path: "C:\\" },
      { name: "D:", path: "D:\\" },
    ],
    entries: (mockDisk[at] ?? []).map((name) => ({
      name,
      path: at.endsWith("\\") ? at + name : at + "\\" + name,
    })),
  };
}

let settings: Settings = {
  data_dir: "C:\\Users\\you\\.soundbox",
  hf_token_set: false,
  output_format: "wav",
  normalize_lufs: -16,
  trim_silence: true,
  auto_unload_minutes: 10,
  device: "auto",
  otel_endpoint: "",
  enabled_audiocpp_models: [],
  audiocpp_mode: "managed",
  audiocpp_models_dir: "C:\\Users\\you\\.soundbox\\models\\audiocpp",
  sounds_dir: "C:\\Users\\you\\.soundbox\\sounds",
  llm_mode: "off",
  llm_model: "qwen3-1.7b",
  llm_external_base_url: "",
  llm_external_model: "",
  llm_external_api_key_set: false,
  image_mode: "off",
  image_model: "sd-turbo",
  image_external_kind: "a1111",
  image_external_base_url: "",
  image_external_model: "",
  image_external_api_key_set: false,
  image_auto_artwork: false,
  onboarded_at: null,
};

/** Profiles are a server-side notion — a data directory each — so the mock
 *  keeps the same shape and simply pretends the switch happened. */
let activeProfile = "default";

let profiles: Profile[] = [
  {
    id: "default",
    name: "Default",
    created_at: "",
    data_dir: "C:\\Users\\you\\.soundbox",
    active: true,
  },
  {
    id: "demo",
    name: "Demo",
    created_at: "2026-02-01T10:00:00Z",
    data_dir: "C:\\Users\\you\\.soundbox\\profiles\\demo",
    active: false,
  },
];

const withActive = (p: Profile): Profile => ({ ...p, active: p.id === activeProfile });

/**
 * The stand-in "cover" the mock attaches — an inline SVG data URL, not a
 * picture. No image model runs in a browser, and a stock photo pretending to
 * be a render would be the one dishonest pixel in a mock whose whole job is
 * showing real UI states.
 */
const MOCK_ARTWORK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#1f2937"/>` +
      `</linearGradient></defs>` +
      `<rect width="64" height="64" fill="url(#g)"/>` +
      `<text x="32" y="38" font-family="sans-serif" font-size="9" fill="#ffffffcc" ` +
      `text-anchor="middle">mock</text></svg>`,
  );

/* --------------------------------------------------------- custom endpoints */

/** A short version of the server's presets (server/src/endpoints/presets.ts) —
 *  enough to drive the form, not a copy to keep in sync line by line. */
const MOCK_ENDPOINT_PRESETS: EndpointPreset[] = [
  {
    id: "localai-ace-step",
    label: "LocalAI — ACE-Step music",
    hint: "LocalAI's /v1/sound-generation with an ACE-Step model. Set the model name to the one your LocalAI serves.",
    docs_url: "https://localai.io/docs/features/text-to-audio/",
    endpoint: {
      task: "music",
      url: "http://localhost:8080/v1/sound-generation",
      headers: {},
      body_template:
        '{\n  "model_id": "ace-step-turbo",\n  "caption": "{{prompt}}",\n  "lyrics": "{{lyrics}}",\n  "instrumental": {{instrumental}},\n  "bpm": {{bpm}},\n  "keyscale": "{{key}}",\n  "duration_seconds": {{duration}}\n}',
      response_path: "",
      pcm_sample_rate: 24000,
      max_duration_s: 240,
      voices: [],
    },
  },
  {
    id: "openai-speech",
    label: "OpenAI-compatible speech (/v1/audio/speech)",
    hint: "OpenAI, LocalAI, Inference Gateway and most proxies. Asks for WAV, so no ffmpeg is needed.",
    docs_url: "https://platform.openai.com/docs/api-reference/audio/createSpeech",
    endpoint: {
      task: "speech",
      url: "http://localhost:8080/v1/audio/speech",
      headers: {},
      body_template:
        '{\n  "model": "tts-1",\n  "input": "{{text}}",\n  "voice": "{{voice}}",\n  "response_format": "wav"\n}',
      response_path: "",
      pcm_sample_rate: 24000,
      max_duration_s: 300,
      voices: ["alloy", "echo", "nova"],
    },
  },
];

const MOCK_TEMPLATE_VARIABLES: Record<string, string> = {
  prompt: "The description from the composer (sound effects and music).",
  negative_prompt: "What to avoid, when the composer has one. Null otherwise.",
  lyrics: "Lyrics for a vocal track. Null when there are none.",
  instrumental: "true when there are no lyrics.",
  duration: "Requested length in seconds.",
  duration_ms: "Requested length in milliseconds.",
  bpm: 'A tempo named in the prompt ("90 BPM"). Null when there is none.',
  key: 'A key named in the prompt ("A minor", "Ebm"). Null when there is none.',
  seed: "The seed for this render.",
  steps: "Sampler steps, when set. Null otherwise.",
  cfg: "Guidance scale, when set. Null otherwise.",
  text: "The line to speak (speech endpoints).",
  voice: "The chosen voice name, or the endpoint's default voice (speech).",
  voice_ref_b64: "The reference clip of a cloned voice, base64 WAV (speech). Null otherwise.",
  language: "A language code when one was chosen (speech). Null otherwise.",
};

const mockEndpoints: (AudioEndpoint & { api_key: string | null })[] = [];

/** The model a saved endpoint shows up as — what the server's EndpointModel
 *  describes, trimmed to what the pickers read. */
function endpointAsModel(ep: AudioEndpoint): Model {
  const speech = ep.task === "speech";
  const uses = (v: string) => ep.body_template.includes(`{{${v}}}`);
  let host = ep.url;
  try {
    host = new URL(ep.url).host;
  } catch {
    // keep the raw string
  }
  return {
    id: `endpoint:${ep.id}`,
    family: "endpoint",
    params: [],
    name: ep.name,
    vendor: host,
    description: `A custom endpoint: requests are sent to ${ep.url}.`,
    license: { name: "Set by the endpoint", commercial: "conditional", url: "" },
    hf_repo: "",
    gated: false,
    task: speech ? "tts" : "gen",
    voice_ids: speech ? [...ep.voices] : [],
    category: ep.task === "speech" ? "voice" : ep.task,
    max_duration_s: ep.max_duration_s,
    sample_rate: speech ? 24000 : 44100,
    channels: speech ? 1 : 2,
    supports: {
      negative_prompt: uses("negative_prompt"),
      seed: uses("seed"),
      steps: uses("steps"),
      cfg: uses("cfg"),
      lyrics: uses("lyrics"),
      text: speech,
      voice_reference: speech && uses("voice_ref_b64"),
      extend: false,
      cover: false,
      repaint: false,
    },
    defaults: { duration_s: Math.min(10, ep.max_duration_s) },
    vram_estimate_mb: 0,
    extras: [],
    status: "installed",
    installed_deps: true,
    provider: "endpoint",
    error: null,
  };
}

function syncEndpointModels(): void {
  for (let i = models.length - 1; i >= 0; i--) {
    if (models[i]!.id.startsWith("endpoint:")) models.splice(i, 1);
  }
  for (const ep of mockEndpoints) if (ep.enabled) models.push(endpointAsModel(ep));
}

const publicEndpoint = ({ api_key, ...rest }: AudioEndpoint & { api_key: string | null }): AudioEndpoint => ({
  ...rest,
  api_key_set: Boolean(api_key),
});

function endpointFromInput(
  id: string,
  input: AudioEndpointInput,
  previous: { api_key: string | null } | undefined,
): AudioEndpoint & { api_key: string | null } {
  const { api_key: key, ...rest } = input;
  const api_key = key === undefined || key === null ? (previous?.api_key ?? null) : key.trim() || null;
  return { ...rest, id, api_key, api_key_set: Boolean(api_key) };
}

/* ------------------------------------------------------------------ artwork */

let imageEngineInstalled = false;
const imageModels: ImageModelEntry[] = [
  {
    id: "sd-turbo",
    name: "SD-Turbo (Q8)",
    vendor: "Stability AI",
    license: {
      name: "Stability AI Community License",
      commercial: "conditional",
      url: "https://stability.ai/license",
    },
    hf_repo: "Green-Sky/SD-Turbo-GGUF",
    files: [{ flag: "-m", path: "sd_turbo-f16-q8_0.gguf", size_bytes: 2_023_745_376 }],
    size_bytes: 2_023_745_376,
    extra_args: [],
    source: "builtin",
    description: "Default — 512px in a single step.",
    resolution: 512,
    steps: 1,
    cfg: 1.0,
    recommended: true,
    installed: false,
  },
  {
    id: "sdxl-turbo",
    name: "SDXL-Turbo (Q8)",
    vendor: "Stability AI",
    license: {
      name: "Stability AI Non-Commercial Community License",
      commercial: "no",
      url: "https://stability.ai/license",
    },
    hf_repo: "OlegSkutte/sdxl-turbo-GGUF",
    files: [{ flag: "-m", path: "sd_xl_turbo_1.0.q8_0.gguf", size_bytes: 4_098_988_672 }],
    size_bytes: 4_098_988_672,
    extra_args: [],
    source: "builtin",
    description: "Better composition, twice the VRAM. Non-commercial licence.",
    resolution: 512,
    steps: 4,
    cfg: 1.0,
    recommended: false,
    installed: false,
  },
  {
    id: "sd35-medium",
    name: "Stable Diffusion 3.5 Medium",
    vendor: "Stability AI",
    license: {
      name: "Stability AI Community License",
      commercial: "conditional",
      url: "https://stability.ai/license",
    },
    hf_repo: "stabilityai/stable-diffusion-3.5-medium",
    files: [
      { flag: "-m", path: "sd3.5_medium.safetensors", size_bytes: 5_107_104_286 },
      { flag: "--clip_l", path: "text_encoders/clip_l.safetensors", size_bytes: 246_144_152 },
      { flag: "--clip_g", path: "text_encoders/clip_g.safetensors", size_bytes: 1_389_382_176 },
      {
        flag: "--t5xxl",
        path: "text_encoders/t5xxl_fp8_e4m3fn.safetensors",
        size_bytes: 4_893_934_904,
      },
    ],
    size_bytes: 11_636_565_518,
    description:
      "Full-size quality at 1024px, in exchange for a long download and most of a 16 GB card.",
    resolution: 1024,
    steps: 28,
    cfg: 4.5,
    extra_args: ["--sampling-method", "euler", "--clip-on-cpu"],
    recommended: false,
    installed: false,
    source: "builtin",
  },
];

function imageStatusSnapshot(): ImageStatus {
  const model = imageModels.find((m) => m.id === settings.image_model) ?? null;
  const ready =
    settings.image_mode === "external"
      ? settings.image_external_base_url.length > 0
      : settings.image_mode === "managed" && imageEngineInstalled && (model?.installed ?? false);
  return {
    mode: settings.image_mode,
    ready,
    detail: ready ? null : "Artwork isn't set up yet.",
    engine: {
      installed: imageEngineInstalled,
      version: imageEngineInstalled ? "master-827-97d2990" : null,
      backend: imageEngineInstalled ? "cuda" : null,
    },
    model: model ? { ...model } : null,
    catalog: imageModels.map((m) => ({ ...m })),
    external: {
      kind: settings.image_external_kind,
      base_url: settings.image_external_base_url,
      model: settings.image_external_model,
      api_key_set: settings.image_external_api_key_set,
    },
    running: ready && settings.image_mode === "managed",
    auto_artwork: settings.image_auto_artwork,
    // Same demonstration-only stance as the LLM probe above: nothing is
    // actually reachable from the browser, so the mock just shows the
    // "found one" state so Settings has something to render.
    detected:
      settings.image_mode === "off"
        ? [
            {
              label: "Automatic1111",
              base_url: "http://127.0.0.1:7860",
              kind: "a1111" as const,
              models: ["sd_xl_base_1.0"],
            },
          ]
        : [],
  };
}

/* -------------------------------------------------------- prompt assistant */

let llmEngineInstalled = false;
const llmModels: (Omit<LlmModelEntry, "installed"> & { installed: boolean })[] = [
  {
    id: "qwen3-0.6b",
    name: "Qwen3 0.6B",
    vendor: "Alibaba",
    license: "Apache-2.0",
    size_bytes: 639_446_688,
    description: "Smallest option — fastest on modest hardware, lower rewrite quality.",
    recommended: false,
    installed: false,
  },
  {
    id: "qwen3-1.7b",
    name: "Qwen3 1.7B",
    vendor: "Alibaba",
    license: "Apache-2.0",
    size_bytes: 1_834_426_016,
    description: "Default — a good balance of speed and rewrite quality on most GPUs.",
    recommended: true,
    installed: false,
  },
  {
    id: "qwen3-4b",
    name: "Qwen3 4B",
    vendor: "Alibaba",
    license: "Apache-2.0",
    size_bytes: 2_497_280_256,
    description: "Best rewrite quality; slower to load and more VRAM alongside an audio model.",
    recommended: false,
    installed: false,
  },
];

function llmStatusSnapshot(): LlmStatus {
  const model = llmModels.find((m) => m.id === settings.llm_model) ?? null;
  return {
    mode: settings.llm_mode,
    engine: { installed: llmEngineInstalled, version: llmEngineInstalled ? "b4831" : null, backend: llmEngineInstalled ? "cuda" : null },
    model: model ? { ...model } : null,
    catalog: llmModels.map((m) => ({ ...m })),
    external: {
      base_url: settings.llm_external_base_url,
      model: settings.llm_external_model,
      api_key_set: false,
    },
    running: settings.llm_mode === "managed" && llmEngineInstalled && (model?.installed ?? false),
    // Nothing to actually probe from the browser — the mock just demonstrates
    // the "found one" state so the Settings suggestion has something to show.
    detected:
      settings.llm_mode === "off"
        ? [{ label: "Ollama", base_url: "http://127.0.0.1:11434", models: ["llama3.1", "qwen2.5:7b"] }]
        : [],
  };
}

/** Deterministic-ish canned rewrites so the composer's enhance button has
 *  something plausible to show without a real model. */
function mockEnhance(prompt: string, n: number, category: "sfx" | "music" | undefined): string[] {
  const sfxTemplates = [
    (p: string) => `heavy wooden door slamming shut in a stone corridor, evoking "${p}"`,
    (p: string) => `glass bottle shattering on concrete, sharp and close, like "${p}"`,
    (p: string) => `metal chain dragging across a stone floor in a dark cellar, "${p}"`,
  ];
  const musicTemplates = [
    (p: string) => `dark orchestral-hybrid theme, slow tempo, mournful strings — "${p}"`,
    (p: string) => `driving synth-pop, punchy bassline, bright pads — "${p}"`,
    (p: string) => `sparse ambient pads, distant reverb, unsettling drone — "${p}"`,
  ];
  const templates = category === "music" ? musicTemplates : sfxTemplates;
  return Array.from({ length: n }, (_, i) => templates[i % templates.length]!(prompt.trim()));
}

/** Plausible suggested tags — a separate field from the prompt, kept as
 *  short keywords on purpose (that's the shape the real assistant produces
 *  too; see llm/enhance.ts's `NOT_A_TAG_LIST`). */
function mockTags(category: "sfx" | "music" | undefined): string[] {
  return category === "music"
    ? ["orchestral", "dark", "slow-tempo", "strings"]
    : ["door", "impact", "stone", "close-mic"];
}

/* ---------------------------------------------------------- audio priming */

let audioReady: Promise<void> | null = null;

function ensureAudio(): Promise<void> {
  audioReady ??= (async () => {
    for (const s of sounds) {
      if (!s.file) {
        s.file = await renderBlobUrl(
          Math.min(s.duration_s, 6),
          s.peaks,
          s._shape,
          s._seed,
        );
      }
    }
  })();
  return audioReady;
}

/* --------------------------------------------------------- job simulation */

function emit(job: Job) {
  jobs.set(job.id, { ...job });
  for (const cb of jobListeners.get(job.id) ?? []) cb({ ...job });
}

function newJob(kind: Job["kind"], request: unknown): Job {
  const job: Job = {
    id: nextId(kind),
    kind,
    status: "queued",
    phase: "queued",
    progress: 0,
    message: "queued",
    error: null,
    request,
    result: null,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
  };
  jobs.set(job.id, job);
  return job;
}

const cancelled = new Set<string>();

/**
 * A short job that exists only to give the UI something to watch.
 *
 * The story jobs (speaking one line, mixing a story down) have no simulation
 * worth writing — the mock has no synthesiser and no DSP — but the pages that
 * start them stream progress and act on completion, so they still need a real
 * job to follow. `finish` runs at the end and returns the job's result.
 */
function startMockJob(
  kind: Job["kind"],
  finish: () => { sounds: string[]; [key: string]: unknown },
  request: unknown = {},
): JobRef {
  const job = newJob(kind, request);
  void (async () => {
    await wait(150);
    if (cancelled.has(job.id)) return;
    job.status = "running";
    job.started_at = new Date().toISOString();
    for (const [phase, progress, message] of [
      ["generating", 0.4, "working"],
      ["encoding", 0.85, "writing audio"],
    ] as const) {
      await wait(400);
      if (cancelled.has(job.id)) return;
      job.phase = phase;
      job.progress = progress;
      job.message = message;
      emit(job);
    }
    await wait(300);
    if (cancelled.has(job.id)) return;
    job.status = "done";
    job.phase = "done";
    job.progress = 1;
    job.message = "done";
    job.result = finish();
    job.finished_at = new Date().toISOString();
    emit(job);
  })();
  return { job_id: job.id };
}

/** The canned failures behind a "fail: <topic>" prompt. Any other word
 *  after "fail:" gives an unclassified failure. */
function mockFailure(prompt: string, job: Job): Failure | null {
  const m = /^fail:\s*(\w+)?/i.exec(prompt.trim());
  if (!m) return null;
  const which = (m[1] ?? "").toLowerCase();
  const base = { stage: job.phase, terminal: false };
  switch (which) {
    case "oom":
      return {
        ...base,
        topic: "gpu_oom",
        title: "The GPU ran out of memory",
        hint:
          "This is video memory, not system RAM. A shorter duration, fewer steps or variations, or a smaller model fits; closing other programs that use the GPU frees some. Everything already in the library is kept.",
        fixes: [{ label: "Pick a smaller model", to: "/models" }],
        detail:
          "ggml_backend_cuda_buffer_type_alloc_buffer: allocating 2048.00 MiB on device 0: cudaMalloc failed: out of memory\nstable-audio: failed to allocate compute buffer\naudio.cpp exited with code 1.",
      };
    case "disk":
      return {
        ...base,
        terminal: true,
        topic: "disk_full",
        title: "The disk is full",
        hint:
          "There was no room to write the file, so the partial file was removed. Free space on the drive that holds the Soundbox data directory, or move the models folder to another drive, then try again.",
        fixes: [{ label: "Check storage in Settings", to: "/settings" }],
        detail: "ENOSPC: no space left on device, write",
      };
    case "stalled":
      return {
        ...base,
        topic: "download_stalled",
        title: "The download stopped receiving data",
        hint:
          "The connection went quiet for too long, so the partial file was discarded and a retry starts clean. Check the network, a VPN or a proxy first.",
        fixes: [{ label: "Open Models", to: "/models" }],
        detail:
          "Download of https://huggingface.co/stabilityai/stable-audio-open-small/resolve/main/model.gguf stalled — no data for 60s. Check your network and try again.",
      };
    default:
      return {
        ...base,
        topic: null,
        title: "audio.cpp exited with code 3.",
        hint: null,
        fixes: [],
        detail: "audio.cpp exited with code 3.\n\n[stable-audio] unknown sampler 'dpm++'\n[stable-audio] aborting",
      };
  }
}

/** Walk a job through its phases over roughly three seconds. */
async function runGenerateJob(job: Job, req: GenerateRequest) {
  const model = models.find((e) => e.id === req.model);
  await wait(150);
  if (cancelled.has(job.id)) return;

  const needsLoad = model ? model.status !== "loaded" : false;
  job.started_at = new Date().toISOString();
  job.status = "running";

  // "fail: oom" and friends make the job fail the way the server would,
  // so the failure card can be seen without a GPU to run out of memory.
  const forced = mockFailure(req.prompt, job);
  if (forced) {
    job.status = "error";
    job.phase = "generating";
    job.message = "Failed";
    job.error = forced.detail;
    job.failure = forced;
    job.finished_at = new Date().toISOString();
    emit(job);
    return;
  }

  if (needsLoad && model) {
    job.phase = "loading";
    for (let i = 1; i <= 4; i++) {
      await wait(140);
      if (cancelled.has(job.id)) return;
      job.progress = (i / 4) * 0.25;
      job.message = `loading ${model.name}`;
      emit(job);
    }
    for (const e of models) if (e.status === "loaded") e.status = "installed";
    model.status = "loaded";
  }

  const steps = req.steps ?? 8;
  job.phase = "generating";
  for (let i = 1; i <= steps; i++) {
    await wait(1900 / steps);
    if (cancelled.has(job.id)) return;
    job.progress = 0.25 + (i / steps) * 0.65;
    job.message = `step ${i}/${steps}`;
    emit(job);
  }

  job.phase = "encoding";
  job.progress = 0.94;
  job.message = "encoding";
  emit(job);
  await wait(250);
  if (cancelled.has(job.id)) return;

  const created: string[] = [];
  const variations = Math.max(1, Math.min(4, req.variations ?? 1));
  for (let v = 0; v < variations; v++) {
    const seed = req.seed ?? Math.floor(Math.random() * 1_000_000);
    const shape: Shape = (["impact", "burst", "swell", "tonal"] as Shape[])[v % 4];
    const peaks = synthPeaks(seed + v * 31, shape);
    const id = nextId("snd");
    const file = await renderBlobUrl(Math.min(req.duration_s, 6), peaks, shape, seed + v);
    const sound: MockSound = {
      id,
      created_at: new Date().toISOString(),
      model: req.model,
      prompt: req.prompt,
      negative_prompt: req.negative_prompt ?? null,
      duration_s: req.duration_s,
      seed: seed + v,
      steps: req.steps ?? null,
      cfg: req.cfg ?? null,
      sample_rate: model?.sample_rate ?? 44100,
      channels: 1,
      file,
      peaks,
      favorite: false,
      tags: req.tags ?? [],
      name: `${req.prompt.split(",")[0].slice(0, 34)}${variations > 1 ? ` ${v + 1}` : ""}`,
      size_bytes: Math.round(req.duration_s * 44100 * 2),
      session_id: req.session_id ?? null,
      // Never set at generation time — inherited from the session instead,
      // same as the server. Explicit filing happens afterwards, from the
      // Library.
      project_id: null,
      effective_project_id:
        sessions.find((x) => x.id === req.session_id)?.project_id ?? null,
      source: req.origin?.source ?? "api",
      client:
        req.origin?.source === "mcp"
          ? `${req.origin.client_name ?? "unknown"}${req.origin.client_version ? ` ${req.origin.client_version}` : ""}`
          : null,
      _shape: shape,
      _seed: seed + v,
    };
    sounds.unshift(sound);
    created.push(id);
    const ses = sessions.find((x) => x.id === req.session_id);
    if (ses) {
      ses.updated_at = sound.created_at;
      ses.sound_count += 1;
      sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    }
  }

  // Asked for stems rather than a mix: the job is not done until they exist,
  // and what it hands back is the stems — same contract as the server's.
  if (req.separate && created.length) {
    const stemIds: string[] = [];
    for (const id of created) {
      const sub = newJob("separate", { source_sound_id: id });
      await runSeparateJob(sub, "htdemucs", id, req.separate);
      stemIds.push(...((sub.result?.sounds as string[]) ?? []));
      job.progress = 0.95;
      job.message = "separating";
      emit(job);
    }
    if (stemIds.length) {
      job.phase = "done";
      job.status = "done";
      job.progress = 1;
      job.message = "done";
      job.finished_at = new Date().toISOString();
      job.result = { sounds: stemIds, sources: created };
      emit(job);
      return;
    }
  }

  job.phase = "done";
  job.status = "done";
  job.progress = 1;
  job.message = "done";
  job.finished_at = new Date().toISOString();
  job.result = { sounds: created };
  emit(job);
}

const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;

/** The mock's half of `stems.ts`: which of the four names a request asked
 *  for, plus the summed leftovers when it asked to keep them. */
function chooseStems(selection: StemSelection | null | undefined): string[] {
  const keep = (selection?.keep ?? []).map((n) => n.toLowerCase());
  if (!keep.length) return [...STEM_NAMES];
  const kept = keep.filter((n) => (STEM_NAMES as readonly string[]).includes(n));
  const dropped = STEM_NAMES.filter((n) => !kept.includes(n));
  return selection?.rest === "merge" && dropped.length ? [...kept, "rest"] : kept;
}

/** Mock of `--task sep`: splits a sound into a fixed 4-stem set. Real
 *  audio.cpp's stem set/count depends on the loader family and hasn't been
 *  confirmed against a live run (see docs/AUDIOCPP.md) — this is a plausible
 *  stand-in, not a claim about what htdemucs actually emits. */
/**
 * Synthesise a script one line at a time, the way the server does.
 *
 * Progress ticks per line rather than on a timer so a long dialogue reads as
 * "Line 7/20" in the UI, which is the whole reason multi-speaker needs its own
 * job kind rather than reusing generate's.
 */
async function runSpeakJob(job: Job, req: SpeakRequest) {
  await wait(150);
  if (cancelled.has(job.id)) return;

  job.started_at = new Date().toISOString();
  job.status = "running";
  job.phase = "generating";

  const lines = req.lines.filter((l) => l.text.trim());
  for (let i = 0; i < lines.length; i++) {
    await wait(420);
    if (cancelled.has(job.id)) return;
    job.progress = ((i + 1) / lines.length) * 0.9;
    job.message = lines.length > 1 ? `Line ${i + 1}/${lines.length}` : "Speaking";
    emit(job);
  }

  // Roughly 150 words a minute, plus the gaps — close enough that the
  // rendered waveform's length isn't obviously wrong next to the script.
  const words = lines.reduce((n, l) => n + l.text.trim().split(/\s+/).length, 0);
  const durationS = Math.min(
    30,
    Math.max(1, words / 2.5 + (req.gap_s ?? 0.4) * Math.max(0, lines.length - 1)),
  );
  const script = lines.map((l) => (l.speaker ? `${l.speaker}: ${l.text}` : l.text)).join("\n");
  const seed = Math.floor(Math.random() * 1e6);
  const peaks = synthPeaks(seed, "tonal");
  const id = nextId("snd");

  const sound: MockSound = {
    id,
    created_at: new Date().toISOString(),
    model: req.model,
    prompt: script,
    negative_prompt: null,
    duration_s: durationS,
    seed: req.seed ?? seed,
    steps: req.steps ?? null,
    cfg: req.cfg ?? null,
    sample_rate: 44100,
    channels: 1,
    file: await renderBlobUrl(durationS, peaks, "tonal", seed),
    peaks,
    favorite: false,
    tags: req.tags ?? [],
    name: req.name || script.split("\n")[0].slice(0, 48) || "Spoken",
    size_bytes: Math.round(durationS * 44100 * 2),
    session_id: req.session_id ?? null,
    project_id: req.project_id ?? null,
    effective_project_id: req.project_id ?? null,
    source: "app",
    client: null,
    // Same rule the real server applies: one distinct voice across the read
    // gets stamped, a mixed dialogue gets nothing.
    voice_id: (() => {
      const ids = new Set(lines.map((l) => l.voice_id ?? null));
      return ids.size === 1 ? [...ids][0] : null;
    })(),
    _shape: "tonal",
    _seed: seed,
  };
  sounds.unshift(sound);

  job.phase = "done";
  job.status = "done";
  job.progress = 1;
  job.message = "done";
  job.finished_at = new Date().toISOString();
  job.result = { sounds: [id] };
  emit(job);
}

/** Re-voice an existing sound. Derived from the source (hence `parent_id`),
 *  same as a stem or an edit. */
async function runConvertJob(job: Job, req: ConvertRequest) {
  const source = sounds.find((s) => s.id === req.source_sound_id);
  await wait(150);
  if (cancelled.has(job.id) || !source) return;

  job.started_at = new Date().toISOString();
  job.status = "running";
  job.phase = "generating";
  for (let i = 1; i <= 4; i++) {
    await wait(400);
    if (cancelled.has(job.id)) return;
    job.progress = (i / 4) * 0.9;
    job.message = "Converting voice";
    emit(job);
  }

  const voice = voices.find((v) => v.id === req.voice_id);
  const seed = source._seed + 991;
  const peaks = synthPeaks(seed, source._shape);
  const id = nextId("snd");
  const converted: MockSound = {
    ...source,
    id,
    created_at: new Date().toISOString(),
    model: req.model,
    file: await renderBlobUrl(source.duration_s, peaks, source._shape, seed),
    peaks,
    favorite: false,
    name: `${source.name} (${voice?.name ?? "converted"})`,
    parent_id: source.id,
    voice_id: req.voice_id,
    _seed: seed,
  };
  sounds.unshift(converted);

  job.phase = "done";
  job.status = "done";
  job.progress = 1;
  job.message = "done";
  job.finished_at = new Date().toISOString();
  job.result = { sounds: [id] };
  emit(job);
}

async function runSeparateJob(
  job: Job,
  modelId: string,
  sourceId: string,
  selection: StemSelection | null = null,
) {
  const source = sounds.find((s) => s.id === sourceId);
  await wait(150);
  if (cancelled.has(job.id) || !source) return;

  const names = chooseStems(selection);
  job.started_at = new Date().toISOString();
  job.status = "running";
  job.phase = "generating";
  for (let i = 1; i <= names.length; i++) {
    await wait(500);
    if (cancelled.has(job.id)) return;
    job.progress = (i / names.length) * 0.9;
    job.message = `separating (${i}/${names.length})`;
    emit(job);
  }

  const created: string[] = [];
  for (const [i, stemName] of names.entries()) {
    const seed = source._seed + i * 17;
    const peaks = synthPeaks(seed, source._shape);
    const id = nextId("snd");
    const file = await renderBlobUrl(Math.min(source.duration_s, 6), peaks, source._shape, seed);
    const stem: MockSound = {
      ...source,
      id,
      created_at: new Date().toISOString(),
      model: modelId,
      file,
      peaks,
      favorite: false,
      tags: source.tags,
      name: `${source.name} (${stemName})`,
      parent_id: source.id,
      _shape: source._shape,
      _seed: seed,
    };
    sounds.unshift(stem);
    created.push(id);
  }

  job.phase = "done";
  job.status = "done";
  job.progress = 1;
  job.message = "done";
  job.finished_at = new Date().toISOString();
  job.result = { sounds: created };
  emit(job);
}

/**
 * A repaint, mocked: the source clip with new peaks inside the window and the
 * old ones either side, which is exactly what the real one returns — the
 * untouched part of a repaint is untouched.
 */
async function runRepaintJob(
  job: Job,
  modelId: string,
  sourceId: string,
  startS: number,
  endS: number,
  prompt: string | null,
) {
  const source = sounds.find((s) => s.id === sourceId);
  await wait(150);
  if (cancelled.has(job.id) || !source) return;

  job.started_at = new Date().toISOString();
  job.status = "running";
  job.phase = "generating";
  for (let i = 1; i <= 6; i++) {
    await wait(400);
    if (cancelled.has(job.id)) return;
    job.progress = (i / 6) * 0.9;
    job.message = `repainting (${i}/6)`;
    emit(job);
  }

  const seed = source._seed + 991;
  const fresh = synthPeaks(seed, source._shape);
  const from = Math.round((startS / source.duration_s) * source.peaks.length);
  const to = Math.round((endS / source.duration_s) * source.peaks.length);
  const peaks = source.peaks.map((v, i) => (i >= from && i < to ? fresh[i % fresh.length] : v));
  const id = nextId("snd");
  const file = await renderBlobUrl(
    Math.min(source.duration_s, 6),
    peaks,
    source._shape,
    seed,
  );
  const painted: MockSound = {
    ...source,
    id,
    created_at: new Date().toISOString(),
    model: modelId,
    prompt: prompt?.trim() || source.prompt,
    file,
    peaks,
    favorite: false,
    name: `${source.name} (repainted)`,
    parent_id: source.id,
    _shape: source._shape,
    _seed: seed,
  };
  sounds.unshift(painted);

  job.phase = "done";
  job.status = "done";
  job.progress = 1;
  job.message = "done";
  job.finished_at = new Date().toISOString();
  job.result = { sounds: [id] };
  emit(job);
}

async function runDownloadJob(job: Job, modelId: string) {
  const model = models.find((e) => e.id === modelId);
  if (model) model.status = "downloading";
  job.status = "running";
  job.phase = "loading";
  job.started_at = new Date().toISOString();
  for (let i = 1; i <= 12; i++) {
    await wait(230);
    if (cancelled.has(job.id)) {
      if (model) model.status = "not_installed";
      return;
    }
    job.progress = i / 12;
    job.message = `${Math.round((i / 12) * (model?.vram_estimate_mb ?? 4000))} MB / ${model?.vram_estimate_mb ?? 4000} MB`;
    emit(job);
  }
  if (model) model.status = "installed";
  job.status = "done";
  job.phase = "done";
  job.progress = 1;
  job.message = "download complete";
  job.finished_at = new Date().toISOString();
  emit(job);
}

/* --------------------------------------------------------------------- mcp */
//
// Mock telemetry so the Agents page has something to show with no real agent
// connected. Two clients: one active a moment ago, one from yesterday — so
// the page demonstrates both the live dot and the "seen before" state.

const MOCK_TOOLS: Omit<McpToolInfo, "calls">[] = [
  {
    name: "soundbox.generate",
    title: "Generate a sound effect",
    description:
      "Generate one or more sound effects from a text description and save them to the library.",
  },
  {
    name: "soundbox.list_models",
    title: "List sound models",
    description: "List available generation models with their status and licence.",
  },
  {
    name: "soundbox.list_sounds",
    title: "Search the sound library",
    description: "Search previously generated sounds. Use before generating something new.",
  },
  {
    name: "soundbox.get_sound",
    title: "Get one sound",
    description: "Fetch a single sound by id, including its absolute file path.",
  },
  {
    name: "soundbox.delete_sound",
    title: "Delete a sound",
    description: "Permanently delete a sound and its audio file.",
  },
];

const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

const mcpCalls: McpCall[] = [
  {
    id: "call-1",
    ts: ago(0.3),
    tool: "soundbox.generate",
    status: "ok",
    client_name: "claude-code",
    client_version: "2.1.0",
    session_id: "sess-live-1",
    transport: "http",
    args: { prompt: "single footstep on loose gravel, outdoor, no reverb", duration_s: 1.1 },
    duration_ms: 3840,
    sound_ids: sounds[2] ? [sounds[2].id] : [],
    job_id: "job-mock-1",
    trace_id: null,
  },
  {
    id: "call-2",
    ts: ago(2),
    tool: "soundbox.list_models",
    status: "ok",
    client_name: "claude-code",
    client_version: "2.1.0",
    session_id: "sess-live-1",
    transport: "http",
    args: {},
    duration_ms: 41,
    sound_ids: [],
    job_id: null,
    trace_id: null,
  },
  {
    id: "call-3",
    ts: ago(2.2),
    tool: "soundbox.list_sounds",
    status: "ok",
    client_name: "claude-code",
    client_version: "2.1.0",
    session_id: "sess-live-1",
    transport: "http",
    args: { q: "footstep", limit: 5 },
    duration_ms: 18,
    sound_ids: [],
    job_id: null,
    trace_id: null,
  },
  {
    id: "call-4",
    ts: ago(60 * 26),
    tool: "soundbox.generate",
    status: "ok",
    client_name: "cursor",
    client_version: "1.4.2",
    session_id: null,
    transport: "stdio",
    args: { prompt: "metal sword drawn from leather scabbard, sharp ring-out", duration_s: 1.8 },
    duration_ms: 5210,
    sound_ids: sounds[4] ? [sounds[4].id] : [],
    job_id: "job-mock-4",
    trace_id: null,
  },
  {
    id: "call-5",
    ts: ago(60 * 26 + 3),
    tool: "soundbox.delete_sound",
    status: "error",
    client_name: "cursor",
    client_version: "1.4.2",
    session_id: null,
    transport: "stdio",
    args: { sound_id: "snd-old-draft" },
    duration_ms: 9,
    error: "No sound with id snd-old-draft",
    sound_ids: [],
    job_id: null,
    trace_id: null,
  },
];

function computeMcpClients(): McpClient[] {
  const active = new Set<string>();
  const byKey = new Map<string, McpClient>();
  const ACTIVE_MS = 10 * 60_000;
  for (const c of mcpCalls) {
    const key = `${c.client_name ?? "unknown"}\u0000${c.client_version ?? ""}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        name: c.client_name ?? "unknown",
        version: c.client_version,
        calls: 0,
        errors: 0,
        sounds: 0,
        sessions: 0,
        first_seen: c.ts,
        last_seen: c.ts,
        active: false,
      };
      byKey.set(key, entry);
    }
    entry.calls += 1;
    if (c.status === "error") entry.errors += 1;
    entry.sounds += c.sound_ids.length;
    if (c.ts < entry.first_seen) entry.first_seen = c.ts;
    if (c.ts > entry.last_seen) entry.last_seen = c.ts;
    if (now - new Date(c.ts).getTime() < ACTIVE_MS) active.add(key);
  }
  for (const [key, entry] of byKey) {
    entry.active = active.has(key);
    entry.sessions = new Set(mcpCalls.filter((c) => c.client_name === entry.name).map((c) => c.session_id)).size;
  }
  return [...byKey.values()].sort((a, b) => b.last_seen.localeCompare(a.last_seen));
}

let mockSkillsInstalledTo: Record<string, string> = {};

/* ------------------------------------------------------------------- api */

/** Conversations and what happened in them — the mock half of
 *  `server/src/history.ts`. Arrays rather than a Map because the only
 *  queries are "newest first" and "everything in this one". */
let conversations: Conversation[] = [];
let historyEntries: HistoryEntry[] = [];

const withCount = (c: Conversation): Conversation => ({
  ...c,
  entry_count: historyEntries.filter((e) => e.conversation_id === c.id).length,
});

export const mockApi: SoundboxApi = {
  async getHealth(): Promise<HealthStatus> {
    await wait(60);
    const loaded = models.find((e) => e.status === "loaded");
    return {
      status: "ok",
      version: "0.1.0-mock",
      device: "cuda",
      gpu_name: "NVIDIA GeForce RTX 5080",
      vram_total_mb: 16303,
      vram_free_mb: loaded ? 16303 - loaded.vram_estimate_mb : 15100,
      loaded_model: loaded?.id ?? null,
      queue_length: [...jobs.values()].filter((j) => j.status === "running").length,
    };
  },

  async listModels() {
    await wait(80);
    // Enabled here, or already downloaded — the server unions the two, so the
    // mock has to as well or the list and the catalog page disagree.
    const extra = AUDIOCPP_CATALOG_EXTRA.filter(
      (e) => settings.enabled_audiocpp_models.includes(e.id) || DOWNLOADED_EXTRAS.has(e.id),
    ).map(audioCppModelFromCatalog);
    return [...models, ...extra].map((e) => ({ ...e }));
  },

  async getAudioCppRuntime() {
    await wait(40);
    const managedDir = "C:\\Users\\you\\.soundbox\\models\\audiocpp";
    return {
      mode: settings.audiocpp_mode,
      engine: {
        installed: true,
        version: "release-0.6.1",
        path: "C:\\Users\\you\\.soundbox\\bin\\audiocpp\\release-0.6.1\\audiocpp_cli.exe",
        backend: "cuda",
        source: "managed" as const,
      },
      models_dir: settings.audiocpp_models_dir || managedDir,
      models_dir_default: managedDir,
    };
  },

  async listAudioCppCatalog() {
    await wait(60);
    const enabled = new Set(settings.enabled_audiocpp_models);
    // Mirrors models.audiocpp.MODELS — every entry verified end-to-end
    // (download → load → generate → real audio), always registered.
    const alwaysOn: AudioCppCatalogEntry[] = [
      {
        id: "audiocpp-stable-audio-3-sfx",
        name: "Stable Audio 3.0 SFX (audio.cpp)",
        vendor: "Stability AI",
        description:
          "The same Stable Audio 3.0 Small SFX weights as the native model, run through audio.cpp's ggml runtime.",
        license: {
          name: "Stability AI Community License",
          commercial: "conditional",
          url: "https://stability.ai/license",
        },
        verified: true,
        always_on: true,
        enabled: true,
        on_disk: false,
        category: "sfx",
      },
      {
        id: "audiocpp-stable-audio-3-small-music",
        name: "Stable Audio 3.0 Small Music (audio.cpp)",
        vendor: "Stability AI",
        description: "Music-tuned sibling of the SFX model, same loader and GGUF repo.",
        license: {
          name: "Stability AI Community License",
          commercial: "conditional",
          url: "https://stability.ai/license",
        },
        verified: true,
        always_on: true,
        enabled: true,
        on_disk: false,
        category: "music",
      },
      {
        id: "audiocpp-ace-step",
        name: "ACE-Step 1.5 Turbo (audio.cpp)",
        vendor: "ACE Studio / StepFun",
        description: "Music generation via a different loader family than Stable Audio.",
        license: {
          name: "Apache 2.0 (unverified)",
          commercial: "yes",
          url: "https://github.com/ace-step/ACE-Step/blob/main/LICENSE",
        },
        verified: true,
        always_on: true,
        enabled: true,
        on_disk: false,
        category: "music",
      },
    ];
    return [
      ...alwaysOn,
      // The mock's stand-in for weights already on the machine: one extra
      // nobody enabled here, which the real server adopts because the files
      // are on a disk every profile shares.
      ...AUDIOCPP_CATALOG_EXTRA.map((e) => ({
        ...e,
        on_disk: DOWNLOADED_EXTRAS.has(e.id),
        enabled: enabled.has(e.id) || DOWNLOADED_EXTRAS.has(e.id),
      })),
    ];
  },

  async downloadModel(id): Promise<JobRef> {
    await wait(60);
    const job = newJob("download", { model: id });
    void runDownloadJob(job, id);
    return { job_id: job.id };
  },

  async selfTestModel(id) {
    const model = models.find((e) => e.id === id);
    if (!model) throw new Error(`Unknown model ${id}`);
    await wait(1400);
    if (model.status === "not_installed" || model.status === "incomplete") {
      return { model: id, ok: false, device: "cuda", elapsed_s: 0.1, rendered_s: null, error: `${model.name}'s weights are not downloaded yet.` };
    }
    for (const e of models) if (e.status === "loaded") e.status = "installed";
    model.status = "loaded";
    return { model: id, ok: true, device: "cuda", elapsed_s: 1.4, rendered_s: 1, error: null };
  },

  async loadModel(id) {
    await wait(400);
    const model = models.find((e) => e.id === id);
    if (!model) throw new Error(`Unknown model ${id}`);
    if (model.status === "not_installed")
      throw new Error("Weights are not downloaded yet.");
    for (const e of models) if (e.status === "loaded") e.status = "installed";
    model.status = "loaded";
    return { ...model };
  },

  async unloadModel(id) {
    await wait(200);
    const model = models.find((e) => e.id === id);
    if (!model) throw new Error(`Unknown model ${id}`);
    model.status = "installed";
    return { ...model };
  },

  async deleteModelWeights(id) {
    await wait(200);
    const model = models.find((e) => e.id === id);
    if (!model) throw new Error(`Unknown model ${id}`);
    model.status = "not_installed";
  },

  async generate(req): Promise<JobRef> {
    await wait(80);
    if (!req.prompt.trim()) throw new Error("Prompt must not be empty.");
    // Same contract as the server: a stale or missing session id starts a
    // fresh session titled from the prompt, and the resolved id rides on the
    // job's request so the composer learns which session it is in.
    let session = req.session_id ? sessions.find((x) => x.id === req.session_id) : undefined;
    if (!session) {
      const now = new Date().toISOString();
      session = {
        id: nextId("ses"),
        title: req.prompt.split(",")[0].trim().slice(0, 48) || "New session",
        created_at: now,
        updated_at: now,
        sound_count: 0,
        // A session created inside a project (the composer's project picker,
        // set before the first generation) starts filed there.
        project_id: req.project_id ?? null,
      };
      sessions.unshift(session);
    }
    const stamped = { ...req, session_id: session.id };
    const job = newJob("generate", stamped);
    void runGenerateJob(job, stamped);
    return { job_id: job.id };
  },

  async separateSound(modelId, sourceSoundId, stems = null): Promise<JobRef> {
    await wait(80);
    if (!sounds.find((s) => s.id === sourceSoundId)) {
      throw new Error(`Unknown sound ${sourceSoundId}`);
    }
    const job = newJob("separate", {
      model: modelId,
      source_sound_id: sourceSoundId,
      stems,
    });
    void runSeparateJob(job, modelId, sourceSoundId, stems);
    return { job_id: job.id };
  },

  async repaintSound(req): Promise<JobRef> {
    await wait(80);
    const source = sounds.find((s) => s.id === req.source_sound_id);
    if (!source) throw new Error(`Unknown sound ${req.source_sound_id}`);
    if (req.end_s <= req.start_s) throw new Error("end_s must be greater than start_s.");
    if (req.end_s > source.duration_s) {
      throw new Error(`Repaint window ends past the source (${source.duration_s}s).`);
    }
    const model =
      req.model ??
      (models.find((m) => m.id === source.model && m.supports.repaint)?.id ??
        models.find((m) => m.supports.repaint)?.id);
    if (!model) throw new Error("No installed model can repaint.");
    const job = newJob("generate", { ...req, model, edit: "repaint" });
    void runRepaintJob(job, model, source.id, req.start_s, req.end_s, req.prompt ?? null);
    return { job_id: job.id };
  },

  async listJobs(limit = 50) {
    await wait(20);
    // Newest first, like the server's ring buffer.
    return [...jobs.values()]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, limit)
      .map((j) => ({ ...j }));
  },

  async getJob(id) {
    await wait(20);
    const job = jobs.get(id);
    if (!job) throw new Error(`Unknown job ${id}`);
    return { ...job };
  },

  async cancelJob(id) {
    await wait(60);
    const job = jobs.get(id);
    if (!job) throw new Error(`Unknown job ${id}`);
    cancelled.add(id);
    job.status = "cancelled";
    job.message = "cancelled";
    job.finished_at = new Date().toISOString();
    emit(job);
    return { ...job };
  },

  subscribeJob(id, onJob): Unsubscribe {
    let set = jobListeners.get(id);
    if (!set) {
      set = new Set();
      jobListeners.set(id, set);
    }
    set.add(onJob);
    const current = jobs.get(id);
    if (current) queueMicrotask(() => onJob({ ...current }));
    return () => {
      set?.delete(onJob);
    };
  },

  async listSounds(query: SoundQuery = {}): Promise<SoundsPage> {
    await ensureAudio();
    await wait(120);
    let items = sounds.slice();
    if (query.session_id) items = items.filter((s) => s.session_id === query.session_id);
    if (query.project_id)
      items = items.filter((s) => s.effective_project_id === query.project_id);
    if (query.parent_id) items = items.filter((s) => s.parent_id === query.parent_id);
    if (query.voice_id) items = items.filter((s) => s.voice_id === query.voice_id);
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.prompt.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (query.tag) items = items.filter((s) => s.tags.includes(query.tag!));
    if (query.model) items = items.filter((s) => s.model === query.model);
    if (query.favorite) items = items.filter((s) => s.favorite);
    if (query.source) items = items.filter((s) => s.source === query.source);
    const total = items.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    return {
      items: items.slice(offset, offset + limit).map((s) => ({ ...s })),
      total,
    };
  },

  async getSound(id) {
    await ensureAudio();
    const sound = sounds.find((s) => s.id === id);
    if (!sound) throw new Error(`Unknown sound ${id}`);
    return { ...sound };
  },

  async updateSound(id, patch: SoundPatch) {
    await wait(120);
    const sound = sounds.find((s) => s.id === id);
    if (!sound) throw new Error(`Unknown sound ${id}`);
    Object.assign(sound, patch);
    if ("project_id" in patch) {
      // The override takes effect immediately; clearing it (project_id:
      // null) falls back to whatever the session still inherits, not to
      // "unfiled" outright.
      const inherited = sessions.find((x) => x.id === sound.session_id)?.project_id ?? null;
      sound.effective_project_id = sound.project_id ?? inherited;
    }
    return { ...sound };
  },

  async deleteSound(id) {
    await wait(140);
    const i = sounds.findIndex((s) => s.id === id);
    if (i < 0) throw new Error(`Unknown sound ${id}`);
    const [removed] = sounds.splice(i, 1);
    if (removed.file.startsWith("blob:")) URL.revokeObjectURL(removed.file);
  },

  // Nothing to reveal — the mock backend has no real files on disk, only
  // in-memory blobs. Real backend implements this for real.
  async revealSound() {
    await wait(80);
  },

  async editSound(id, req: SoundEditRequest) {
    await ensureAudio();
    const source = sounds.find((s) => s.id === id);
    if (!source) throw new Error(`Unknown sound ${id}`);
    const { samples, sampleRate } = await decodeMono(source.file);

    let out: Float32Array;
    switch (req.op) {
      case "trim":
        if (req.start_s === undefined || req.end_s === undefined) {
          throw new Error("Trim needs both a start and an end.");
        }
        out = trimSamples(samples, sampleRate, req.start_s, req.end_s);
        break;
      case "normalize":
        out = peakNormalizeSamples(samples, -1);
        break;
      case "reverse":
        out = reverseSamples(samples);
        break;
      case "gain":
        if (req.gain_db === undefined) throw new Error("Gain needs a gain_db value.");
        out = gainSamples(samples, req.gain_db);
        break;
      case "highpass":
        if (req.cutoff_hz === undefined) throw new Error("High-pass needs a cutoff_hz value.");
        out = onePoleHighpass(samples, sampleRate, req.cutoff_hz);
        break;
      case "lowpass":
        if (req.cutoff_hz === undefined) throw new Error("Low-pass needs a cutoff_hz value.");
        out = onePoleLowpass(samples, sampleRate, req.cutoff_hz);
        break;
      case "pitch":
        if (req.semitones === undefined) throw new Error("Pitch shift needs a semitones value.");
        out = resample(samples, 2 ** (req.semitones / 12));
        break;
      case "stretch":
        if (req.rate === undefined) throw new Error("Time-stretch needs a rate value.");
        out = resample(samples, req.rate);
        break;
      default:
        throw new Error(`Unknown edit op ${String(req.op)}`);
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));

    await wait(150);
    const file = URL.createObjectURL(encodeMonoWav(out, sampleRate));
    const edited: MockSound = {
      ...source,
      id: nextId("snd"),
      created_at: new Date().toISOString(),
      duration_s: out.length / sampleRate,
      sample_rate: sampleRate,
      channels: 1,
      file,
      peaks: computePeaksFromSamples(out),
      favorite: false,
      name: `${source.name} (${EDIT_LABELS[req.op]})`,
      size_bytes: out.length * 2 + 44,
      parent_id: source.id,
    };
    sounds.unshift(edited);
    return { ...edited };
  },

  /* ------------------------------------------------------------- history */

  async listConversations(limit = 50): Promise<Conversation[]> {
    await wait(80);
    return conversations
      .slice()
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit)
      .map(withCount);
  },

  async conversationForStory(storyId: string): Promise<Conversation | null> {
    await wait(60);
    const found = conversations
      .filter((c) => c.story_id === storyId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    return found ? withCount(found) : null;
  },

  async createConversation(title = null, storyId = null): Promise<Conversation> {
    await wait(80);
    // One thread per studio, as the server's unique index has it.
    const existing = storyId ? conversations.find((c) => c.story_id === storyId) : undefined;
    if (existing) return withCount(existing);
    const at = new Date().toISOString();
    const made: Conversation = {
      id: nextId("conv"),
      title: title?.trim() || "New conversation",
      story_id: storyId,
      created_at: at,
      updated_at: at,
      entry_count: 0,
    };
    conversations.unshift(made);
    return made;
  },

  async conversationEntries(id: string): Promise<HistoryEntry[]> {
    await wait(60);
    return historyEntries
      .filter((e) => e.conversation_id === id)
      .sort((a, b) => a.position - b.position);
  },

  async appendHistory(id: string, entries: NewHistoryEntry[]): Promise<HistoryEntry[]> {
    await wait(60);
    const convo = conversations.find((c) => c.id === id);
    if (!convo) throw new Error("Conversation not found");
    const at = new Date().toISOString();
    let next = historyEntries.filter((e) => e.conversation_id === id).length;
    for (const e of entries) {
      historyEntries.push({
        id: nextId("ent"),
        conversation_id: id,
        position: next++,
        role: e.role,
        content: e.content ?? "",
        actions: e.actions ?? [],
        sound_ids: e.sound_ids ?? [],
        job_id: e.job_id ?? null,
        created_at: at,
      });
    }
    convo.updated_at = at;
    // The server titles an unnamed thread from the first thing said; the
    // mock has to agree or the Recent list reads differently offline.
    if (convo.title === "New conversation") {
      const first = entries.find((e) => e.role === "user" && e.content?.trim());
      if (first?.content) {
        const clean = first.content.trim().replace(/\s+/g, " ");
        convo.title = clean.length <= 48 ? clean : `${clean.slice(0, 48).trimEnd()}\u2026`;
      }
    }
    return await mockApi.conversationEntries(id);
  },

  async renameConversation(id: string, title: string): Promise<Conversation> {
    await wait(60);
    const convo = conversations.find((c) => c.id === id);
    if (!convo) throw new Error("Conversation not found");
    convo.title = title.trim();
    convo.updated_at = new Date().toISOString();
    return withCount(convo);
  },

  async deleteConversation(id: string): Promise<void> {
    await wait(60);
    conversations = conversations.filter((c) => c.id !== id);
    historyEntries = historyEntries.filter((e) => e.conversation_id !== id);
  },

  async listSessions(limit = 50): Promise<Session[]> {
    await wait(60);
    return sessions.slice(0, limit).map((s) => ({ ...s }));
  },

  async getSession(id): Promise<Session> {
    await wait(40);
    const s = sessions.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown session ${id}`);
    return { ...s };
  },

  async renameSession(id, title): Promise<Session> {
    await wait(80);
    const s = sessions.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown session ${id}`);
    s.title = title;
    return { ...s };
  },

  async setSessionProject(id, projectId): Promise<Session> {
    await wait(80);
    const s = sessions.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown session ${id}`);
    s.project_id = projectId;
    // Every sound still inheriting from this session (no explicit override
    // of its own) picks up the change immediately, same as the server
    // computing effective_project_id at read time rather than stamping it.
    for (const snd of sounds) {
      if (snd.session_id === id && snd.project_id == null) snd.effective_project_id = projectId;
    }
    return { ...s };
  },

  async deleteSession(id) {
    await wait(120);
    const i = sessions.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`Unknown session ${id}`);
    sessions.splice(i, 1);
    // Same as the server: the session's sounds go with it, audio included.
    for (let k = sounds.length - 1; k >= 0; k--) {
      if (sounds[k].session_id === id) {
        const [removed] = sounds.splice(k, 1);
        if (removed.file.startsWith("blob:")) URL.revokeObjectURL(removed.file);
      }
    }
  },

  /* ------------------------------------------------------------- stories */

  async listStories(limit = 50): Promise<Story[]> {
    await wait(60);
    return [...stories]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit)
      .map((s) => {
        const own = segments.filter((x) => x.story_id === s.id);
        return {
          ...s,
          segment_count: own.length,
          // The real list carries these so the shelf can draw each story's
          // arrangement; without them the mock's cards would be the only
          // place the thumbnail is missing.
          timeline: own
            .filter((x) => x.kind !== "pause")
            .sort((a, b) => a.start_s - b.start_s)
            .map((x) => ({
              t: x.track_index,
              s: x.start_s,
              d: x.duration_s ?? estimateDuration(x.text),
            })),
        };
      });
  },

  async getStory(id): Promise<Story> {
    await wait(40);
    const s = stories.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown story ${id}`);
    return { ...s, segment_count: segments.filter((x) => x.story_id === id).length };
  },

  async setStoryOptions(id, options): Promise<Story> {
    await wait(60);
    const story = stories.find((s) => s.id === id);
    if (!story) throw new Error(`Unknown story ${id}`);
    story.request_options = { ...options };
    story.updated_at = new Date().toISOString();
    return { ...story, segment_count: segments.filter((x) => x.story_id === id).length };
  },

  async createStory(title, projectId, builder): Promise<Story> {
    await wait(80);
    const now = new Date().toISOString();
    const story: Story = {
      id: nextId("story"),
      title: title || "Untitled story",
      created_at: now,
      updated_at: now,
      request_options: {},
      project_id: projectId ?? null,
      segment_count: 0,
      builder: builder ?? "script",
    };
    stories.unshift(story);
    return { ...story };
  },

  async renameStory(id, title): Promise<Story> {
    await wait(80);
    const s = stories.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown story ${id}`);
    s.title = title;
    s.updated_at = new Date().toISOString();
    return { ...s };
  },

  async setStoryProject(id, projectId): Promise<Story> {
    await wait(80);
    const s = stories.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown story ${id}`);
    s.project_id = projectId;
    s.updated_at = new Date().toISOString();
    return { ...s };
  },

  async deleteStory(id, deleteSounds = false) {
    await wait(120);
    const i = stories.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`Unknown story ${id}`);
    const doomed = segments.filter((x) => x.story_id === id);
    stories.splice(i, 1);
    for (let k = segments.length - 1; k >= 0; k--) {
      if (segments[k].story_id === id) segments.splice(k, 1);
    }
    // Same choice the server offers: the audio either goes with the story or
    // stays in the library, unfiled.
    if (deleteSounds) {
      for (const seg of doomed) {
        const k = sounds.findIndex((s) => s.id === seg.sound_id);
        if (k >= 0) {
          const [removed] = sounds.splice(k, 1);
          if (removed.file.startsWith("blob:")) URL.revokeObjectURL(removed.file);
        }
      }
    }
  },

  async listSegments(storyId): Promise<StorySegment[]> {
    await wait(60);
    return segments
      .filter((s) => s.story_id === storyId)
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ ...s, sound: sounds.find((x) => x.id === s.sound_id) ?? null }));
  },

  async createSegment(storyId, req = {}): Promise<StorySegment> {
    await wait(80);
    const mine = segments.filter((s) => s.story_id === storyId);
    const position = req.position ?? mine.length;
    if (req.position != null) {
      for (const s of mine) if (s.position >= position) s.position += 1;
    }
    const track = req.track_index ?? 0;
    const now = new Date().toISOString();
    const segment: StorySegment = {
      id: nextId("seg"),
      story_id: storyId,
      position,
      track_index: track,
      speaker: req.speaker ?? null,
      voice_id: req.voice_id ?? null,
      text: req.text ?? "",
      language: req.language ?? null,
      sound_id: req.sound_id ?? null,
      kind: req.kind ?? "line",
      // Clip state, as the server takes it, so an undone delete comes back
      // trimmed, faded and at its gain.
      trim_start_s: req.trim_start_s ?? 0,
      fade_in_s: req.fade_in_s ?? 0,
      fade_out_s: req.fade_out_s ?? 0,
      request_options: req.request_options ?? {},
      sound: null,
      start_s:
        req.start_s ??
        mine
          .filter((s) => s.track_index === track)
          .reduce((end, s) => Math.max(end, s.start_s + (s.duration_s ?? 0)), 0),
      duration_s:
        req.duration_s ??
        (req.sound_id
          ? (sounds.find((x) => x.id === req.sound_id)?.duration_s ?? null)
          : null),
      muted: req.muted ?? false,
      gain_db: req.gain_db ?? 0,
      created_at: now,
      updated_at: now,
    };
    segments.push(segment);
    return { ...segment };
  },

  async updateSegment(_storyId, segmentId, patch): Promise<StorySegment> {
    await wait(60);
    const s = segments.find((x) => x.id === segmentId);
    if (!s) throw new Error(`Unknown line ${segmentId}`);
    const from = { start_s: s.start_s, track_index: s.track_index };
    Object.assign(s, patch);
    s.updated_at = new Date().toISOString();
    if (s.start_s !== from.start_s || s.track_index !== from.track_index) {
      // The server re-reads the script when a clip moves; so does this.
      const story = segments.filter((x) => x.story_id === s.story_id);
      for (const placed of followPlacement(story, s.id)) {
        const live = segments.find((x) => x.id === placed.id);
        if (live) live.position = placed.position;
      }
    }
    return { ...s, sound: sounds.find((x) => x.id === s.sound_id) ?? null };
  },

  async deleteSegment(_storyId, segmentId) {
    await wait(100);
    const i = segments.findIndex((x) => x.id === segmentId);
    if (i < 0) throw new Error(`Unknown line ${segmentId}`);
    const [removed] = segments.splice(i, 1);
    for (const s of segments) {
      if (s.story_id === removed.story_id && s.position > removed.position) s.position -= 1;
    }
  },

  async reorderSegments(storyId, segmentIds): Promise<StorySegment[]> {
    await wait(80);
    segmentIds.forEach((id, index) => {
      const s = segments.find((x) => x.id === id);
      if (s) s.position = index;
    });
    return this.listSegments(storyId);
  },

  async generateSegment(_storyId, segmentId, _req): Promise<JobRef> {
    await wait(80);
    const segment = segments.find((x) => x.id === segmentId);
    if (!segment) throw new Error(`Unknown line ${segmentId}`);
    // The mock has no synthesiser, so it borrows an existing library sound to
    // stand in — enough for the timeline to have real peaks and a real
    // duration to lay out against.
    return startMockJob("segment", () => {
      const stand = sounds[Math.floor(Math.random() * sounds.length)];
      if (!stand) return { sounds: [] };
      segment.sound_id = stand.id;
      segment.duration_s = stand.duration_s;
      if (segment.start_s === 0) {
        const end = segments
          .filter(
            (s) =>
              s.id !== segmentId &&
              s.story_id === segment.story_id &&
              s.track_index === segment.track_index,
          )
          .reduce((e, s) => Math.max(e, s.start_s + (s.duration_s ?? 0)), 0);
        if (end > 0) segment.start_s = end;
      }
      return { sounds: [stand.id] };
    });
  },

  async splitSegment(storyId, segmentId, atS): Promise<StorySegment[]> {
    await wait(150);
    const segment = segments.find((x) => x.id === segmentId);
    if (!segment) throw new Error(`Unknown line ${segmentId}`);
    if (!segment.duration_s) throw new Error("This line has not been generated yet.");
    if (atS <= 0 || atS >= segment.duration_s) {
      throw new Error("Split point has to fall inside the clip.");
    }
    const tailDuration = segment.duration_s - atS;
    for (const s of segments) {
      if (s.story_id === storyId && s.position > segment.position) s.position += 1;
    }
    // `atS` is into the clip as it plays, so it lands `trim_start_s` into the
    // source. The mock has no renderer to cut new sounds, so both halves keep
    // the one take and the tail's trim moves on to the cut instead — the same
    // audio the server's halves hold. The head keeps the fade in, the tail
    // takes the fade out, and neither fades at the cut.
    const tail: StorySegment = {
      ...segment,
      id: nextId("seg"),
      position: segment.position + 1,
      text: "",
      start_s: segment.start_s + atS,
      trim_start_s: segment.trim_start_s + atS,
      duration_s: tailDuration,
      fade_in_s: 0,
      updated_at: new Date().toISOString(),
    };
    segment.duration_s = atS;
    segment.fade_out_s = 0;
    segments.push(tail);
    return [{ ...segment }, { ...tail }];
  },

  async storyFromSound(soundId, _separate = false, _stems = null): Promise<JobRef> {
    await wait(80);
    const source = sounds.find((s) => s.id === soundId);
    if (!source) throw new Error(`Unknown sound ${soundId}`);
    return startMockJob("separate", () => {
      // The mock has no separator, so "opening in the studio" always lands the
      // one sound on one track — enough to exercise the navigation.
      const now = new Date().toISOString();
      const story: Story = {
        id: nextId("story"), title: source.name, created_at: now, updated_at: now,
        project_id: null, request_options: {}, segment_count: 1,
        // Clips on lanes, no script: the Music Builder's shape.
        builder: "music",
      };
      stories.unshift(story);
      segments.push({
        id: nextId("seg"), story_id: story.id, position: 0, track_index: 0,
        speaker: source.name, voice_id: null, text: "", language: null,
        sound_id: source.id, kind: "line", trim_start_s: 0, sound: null,
        request_options: {},
        start_s: 0, duration_s: source.duration_s, fade_in_s: 0, fade_out_s: 0,
        muted: false, gain_db: 0,
        created_at: now, updated_at: now,
      });
      return { sounds: [source.id], story_id: story.id };
    });
  },

  async listTracks(storyId): Promise<StoryTrack[]> {
    await wait(40);
    return tracks.filter((t) => t.story_id === storyId).map((t) => ({ ...t }));
  },

  async updateTrack(storyId, trackIndex, patch): Promise<StoryTrack> {
    await wait(60);
    let track = tracks.find((t) => t.story_id === storyId && t.track_index === trackIndex);
    if (!track) {
      track = {
        story_id: storyId, track_index: trackIndex,
        name: null, muted: false, soloed: false, gain_db: 0, devices: [],
      };
      tracks.push(track);
    }
    // Clamped like the server's `normalizeChain`, so the mock never holds a
    // chain the real backend would have refused to store.
    const devices = patch.devices?.map((d) => ({
      ...d,
      params: { ...createDevice(d.kind).params, ...clampDeviceParams(d.kind, d.params) },
    }));
    Object.assign(track, patch, devices ? { devices } : {});
    return { ...track };
  },

  async deleteTrack(storyId, trackIndex): Promise<{ removed_clips: number }> {
    await wait(80);
    const doomed = segments.filter(
      (s) => s.story_id === storyId && s.track_index === trackIndex,
    );
    for (let i = segments.length - 1; i >= 0; i--) {
      const s = segments[i];
      if (s.story_id !== storyId) continue;
      if (s.track_index === trackIndex) segments.splice(i, 1);
      else if (s.track_index > trackIndex) s.track_index -= 1;
    }
    for (let i = tracks.length - 1; i >= 0; i--) {
      const t = tracks[i];
      if (t.story_id !== storyId) continue;
      if (t.track_index === trackIndex) tracks.splice(i, 1);
      else if (t.track_index > trackIndex) t.track_index -= 1;
    }
    segments
      .filter((s) => s.story_id === storyId)
      .sort((a, b) => a.position - b.position)
      .forEach((s, i) => (s.position = i));
    return { removed_clips: doomed.length };
  },

  async exportStory(storyId): Promise<JobRef> {
    await wait(80);
    return startMockJob("export", () => {
      const first = segments.find((s) => s.story_id === storyId && s.sound_id);
      return { sounds: first?.sound_id ? [first.sound_id] : [] };
    });
  },

  async listProjects(): Promise<Project[]> {
    await wait(60);
    return projects.map((p) => ({ ...p }));
  },

  async createProject(name): Promise<Project> {
    await wait(80);
    const project: Project = {
      id: nextId("proj"),
      name,
      created_at: new Date().toISOString(),
      sound_count: 0,
    };
    projects.unshift(project);
    return { ...project };
  },

  async deleteProject(id) {
    await wait(120);
    const i = projects.findIndex((p) => p.id === id);
    if (i < 0) throw new Error(`Unknown project ${id}`);
    projects.splice(i, 1);
    // Same as the server: unfile the sounds rather than deleting them, and
    // unfile every session nested in it too, so nothing keeps inheriting a
    // project that no longer exists.
    for (const s of sounds) {
      if (s.project_id === id) s.project_id = null;
      if (s.effective_project_id === id) s.effective_project_id = null;
    }
    for (const s of sessions) if (s.project_id === id) s.project_id = null;
  },

  async listVoices(): Promise<Voice[]> {
    await wait(60);
    return voices.map(withVoiceCounts);
  },

  async createVoice(req): Promise<Voice> {
    await wait(80);
    const voice: Voice = {
      id: nextId("voice"),
      name: req.name,
      kind: req.kind ?? "clone",
      created_at: new Date().toISOString(),
      // The mock has no file store; a clone points at whatever sound it was
      // made from so the UI still has something playable to preview.
      reference_file:
        (req.kind ?? "clone") === "clone"
          ? sounds.find((s) => s.id === req.source_sound_id)?.file ?? null
          : null,
      voice_id: req.voice_id ?? null,
      model_id: req.model_id ?? null,
      notes: req.notes ?? null,
    };
    voices.unshift(voice);
    return { ...voice };
  },

  async uploadSound(name): Promise<Sound> {
    await wait(200);
    // The mock has no decoder and no disk: a recording becomes a library entry
    // standing on a sound that is already there, which is enough to exercise
    // arranging a take without pretending to have captured one.
    const standIn = sounds[0];
    // Spread rather than rebuilt, so the mock's own private fields (_shape,
    // _seed) come along and the fake sound draws like every other one.
    const sound = {
      ...standIn,
      id: nextId("snd"),
      name,
      prompt: "",
      model: "recording",
      created_at: new Date().toISOString(),
    };
    sounds.unshift(sound);
    return sound;
  },

  async uploadVoice(name, file, notes, modelId): Promise<Voice> {
    await wait(140);
    // Real uploaded bytes, so playback works exactly as it would live.
    const url = URL.createObjectURL(file);
    const created = new Date().toISOString();
    const voice: Voice = {
      id: nextId("voice"),
      name,
      kind: "clone",
      created_at: created,
      reference_file: url,
      voice_id: null,
      model_id: modelId ?? null,
      notes: notes ?? null,
      samples: [{ id: nextId("sample"), file: url, duration_s: await mockDuration(file), created_at: created }],
    };
    voices.unshift(voice);
    return withVoiceCounts(voice);
  },

  async addVoiceSample(voiceId, source): Promise<Voice> {
    await wait(140);
    const voice = voices.find((v) => v.id === voiceId);
    if (!voice) throw new Error(`Unknown voice ${voiceId}`);
    if (voice.kind !== "clone") throw new Error(`'${voice.name}' is a built-in voice.`);
    const samples = voice.samples ?? [];
    if (samples.length >= 5) {
      throw new Error(`'${voice.name}' already has 5 clips. Remove one before adding another.`);
    }
    let file: string;
    let duration: number | null;
    if ("file" in source) {
      file = URL.createObjectURL(source.file);
      duration = await mockDuration(source.file);
    } else {
      const sound = sounds.find((s) => s.id === source.sourceSoundId);
      if (!sound) throw new Error(`Unknown sound ${source.sourceSoundId}`);
      file = sound.file;
      duration = sound.duration_s;
    }
    samples.push({ id: nextId("sample"), file, duration_s: duration, created_at: new Date().toISOString() });
    voice.samples = samples;
    // The mock cannot join WAVs; the first clip stands in for the joined
    // reference so the card still has something to play.
    voice.reference_file = samples[0]!.file;
    return withVoiceCounts(voice);
  },

  async deleteVoiceSample(voiceId, sampleId): Promise<Voice> {
    await wait(100);
    const voice = voices.find((v) => v.id === voiceId);
    if (!voice) throw new Error(`Unknown voice ${voiceId}`);
    const samples = voice.samples ?? [];
    if (!samples.some((s) => s.id === sampleId)) throw new Error("Unknown clip");
    if (samples.length <= 1) {
      throw new Error(`That is the only clip '${voice.name}' has. Add another first, or delete the voice.`);
    }
    voice.samples = samples.filter((s) => s.id !== sampleId);
    voice.reference_file = voice.samples[0]!.file;
    return withVoiceCounts(voice);
  },

  async exportVoice(id) {
    await wait(80);
    const voice = voices.find((v) => v.id === id);
    if (!voice) throw new Error(`Unknown voice ${id}`);
    // No clip bytes in the mock — the file is the right shape, minus audio.
    return {
      format: "soundbox-voice" as const,
      version: 1,
      exported_at: new Date().toISOString(),
      voice: {
        name: voice.name,
        kind: voice.kind,
        voice_id: voice.voice_id ?? null,
        model_id: voice.model_id ?? null,
        notes: voice.notes ?? null,
      },
      samples: [],
    };
  },

  async importVoice(file): Promise<Voice> {
    await wait(120);
    const f = file as { format?: string; voice?: Partial<Voice> };
    if (f?.format !== "soundbox-voice" || !f.voice?.name) {
      throw new Error("That isn't a Soundbox voice file.");
    }
    const names = new Set(voices.map((v) => v.name));
    let name = f.voice.name;
    for (let n = 2; names.has(name); n++) name = `${f.voice.name} (${n})`;
    const voice: Voice = {
      id: nextId("voice"),
      name,
      kind: f.voice.kind === "builtin" ? "builtin" : "clone",
      created_at: new Date().toISOString(),
      reference_file: null,
      voice_id: f.voice.voice_id ?? null,
      model_id: f.voice.model_id ?? null,
      notes: f.voice.notes ?? null,
      samples: [],
    };
    voices.unshift(voice);
    return withVoiceCounts(voice);
  },

  async updateVoice(id, patch): Promise<Voice> {
    await wait(60);
    const voice = voices.find((v) => v.id === id);
    if (!voice) throw new Error(`Unknown voice ${id}`);
    if (patch.name !== undefined) voice.name = patch.name;
    if (patch.notes !== undefined) voice.notes = patch.notes ?? null;
    return { ...voice };
  },

  async deleteVoice(id) {
    await wait(100);
    const i = voices.findIndex((v) => v.id === id);
    if (i < 0) throw new Error(`Unknown voice ${id}`);
    voices.splice(i, 1);
  },

  async speak(req): Promise<JobRef> {
    await wait(80);
    if (!req.lines.some((l) => l.text.trim())) throw new Error("The script is empty.");
    const job = newJob("speak", req);
    void runSpeakJob(job, req);
    return { job_id: job.id };
  },

  async convert(req): Promise<JobRef> {
    await wait(80);
    if (!sounds.find((s) => s.id === req.source_sound_id)) {
      throw new Error(`Unknown sound ${req.source_sound_id}`);
    }
    const job = newJob("convert", req);
    void runConvertJob(job, req);
    return { job_id: job.id };
  },

  async getLogs(lines = 200): Promise<LogTail> {
    await wait(40);
    // Enough shape to exercise the parser, the level filter and the
    // click-a-job-id path without pretending to be a real server log.
    const t = (n: number) =>
      new Date(Date.now() - n * 1000).toISOString().slice(11, 19);
    const out = [
      `${t(90)} INFO    soundbox.api: Soundbox 0.1.0 ready`,
      `${t(70)} INFO    soundbox.jobs: job ${mockJobId} queued (kind=generate model=audiocpp-stable-audio-3-sfx)`,
      `${t(68)} INFO    soundbox.jobs: job ${mockJobId} started (kind=generate model=audiocpp-stable-audio-3-sfx)`,
      `${t(60)} INFO    soundbox.jobs: job ${mockJobId} 30% phase=generating Step 3/8`,
      `${t(52)} WARNING soundbox.models.audiocpp: no CUDA device found; running on the CPU backend (slower, same output)`,
      `${t(44)} INFO    soundbox.jobs: job ${mockJobId} 90% phase=generating Step 7/8`,
      `${t(40)} INFO    soundbox.jobs: job ${mockJobId} done in 28.4s`,
      `${t(20)} ERROR   soundbox.jobs: job ${mockOtherJobId} failed: audio.cpp exited with code 1 (see the log above)`,
    ];
    return { lines: out.slice(-lines) };
  },

  async listTags(): Promise<TagCount[]> {
    await wait(60);
    const counts = new Map<string, number>();
    for (const s of sounds)
      for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  },

  async browseDirectories(path?: string | null) {
    await wait(80);
    return mockListing(path ?? "");
  },

  async getSettings() {
    await wait(60);
    return { ...settings };
  },

  async updateSettings(patch: SettingsPatch) {
    await wait(160);
    // Write-only keys are stripped and turned into their `*_set` booleans, the
    // same way the real server refuses to echo a secret back.
    const { hf_token, llm_external_api_key, image_external_api_key, ...rest } =
      patch;
    settings = { ...settings, ...rest };
    if (hf_token !== undefined) settings.hf_token_set = hf_token.length > 0;
    if (llm_external_api_key !== undefined) {
      settings.llm_external_api_key_set = llm_external_api_key.length > 0;
    }
    if (image_external_api_key !== undefined) {
      settings.image_external_api_key_set = image_external_api_key.length > 0;
    }
    // The server resolves this one rather than storing it blank, so "" comes
    // back as the default path instead of an empty field.
    if (rest.sounds_dir !== undefined && !rest.sounds_dir.trim()) {
      settings.sounds_dir = `${settings.data_dir}\\sounds`;
    }
    return { ...settings };
  },

  async listProfiles() {
    await wait(60);
    return { active: activeProfile, profiles: profiles.map(withActive) };
  },

  async createProfile(name: string) {
    await wait(120);
    const stem =
      name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "profile";
    const id = profiles.some((p) => p.id === stem) ? `${stem}-${profiles.length + 1}` : stem;
    const record: Profile = {
      id,
      name: name.trim(),
      created_at: new Date().toISOString(),
      data_dir: `C:\\Users\\you\\.soundbox\\profiles\\${id}`,
      active: false,
    };
    profiles = [...profiles, record];
    return record;
  },

  async renameProfile(id: string, name: string) {
    await wait(80);
    profiles = profiles.map((p) => (p.id === id ? { ...p, name: name.trim() } : p));
    const found = profiles.find((p) => p.id === id);
    if (!found) throw new Error("Profile not found");
    return withActive(found);
  },

  async activateProfile(id: string) {
    // Slower than the other mocks on purpose: the real switch reopens a
    // database and reconfigures two engines, and the UI needs to look right
    // while that is happening.
    await wait(500);
    if (!profiles.some((p) => p.id === id)) throw new Error(`No profile called "${id}".`);
    activeProfile = id;
    return { active: activeProfile, profiles: profiles.map(withActive) };
  },

  async deleteProfile(id: string) {
    await wait(120);
    if (id === activeProfile) {
      throw new Error("Switch to another profile before deleting this one.");
    }
    profiles = profiles.filter((p) => p.id !== id);
  },

  async enhancePrompt(req: EnhanceRequest): Promise<EnhanceResponse> {
    await wait(500);
    if (settings.llm_mode === "off") {
      throw new Error("Prompt enhancement is off. Turn it on in Settings → Prompt assistant.");
    }
    if (settings.llm_mode === "external" && (!settings.llm_external_base_url || !settings.llm_external_model)) {
      throw new Error(
        "External prompt-assistant endpoint isn't configured. Set the base URL and model " +
          "name in Settings → Prompt assistant.",
      );
    }
    if (settings.llm_mode === "managed") {
      const model = llmModels.find((m) => m.id === settings.llm_model);
      if (!llmEngineInstalled) {
        throw new Error("The prompt-assistant engine isn't installed. Install it from the Models page.");
      }
      if (!model?.installed) {
        throw new Error(`${model?.name ?? settings.llm_model} isn't downloaded yet. Download it from the Models page.`);
      }
    }
    return {
      variations: mockEnhance(req.prompt, req.n ?? 1, req.category),
      tags: mockTags(req.category),
    };
  },

  /**
   * A scripted stand-in for the studio assistant: asks one question on the
   * first turn, proposes on the next, and folds "longer"/"shorter"/"darker"
   * into the draft after that. Enough to exercise the thread, the proposal
   * card and both handoffs without a model running.
   */
  /**
   * A stand-in for the guide: matches a couple of well-known questions so the
   * links and the sources render without a model running.
   */
  async assistantChat(req: AssistantChatRequest): Promise<AssistantChatResponse> {
    await wait(500);
    if (settings.llm_mode === "off") {
      throw new Error("Prompt enhancement is off. Turn it on in Settings → Prompt assistant.");
    }
    const last = req.messages.filter((m) => m.role === "user").pop()?.content ?? "";
    const q = last.toLowerCase();

    if (/licen[cs]|commercial|ship/.test(q)) {
      return {
        reply:
          "Every model's licence is on its card on the Models page, colour-coded, and " +
          "non-commercial weights need an explicit confirmation before they download. " +
          "That is covered in the README under Models.",
        links: [{ to: "/models", label: "Models" }],
        sources: ["README › Models"],
      };
    }
    if (/mcp|agent|claude/.test(q)) {
      return {
        reply:
          "Point an MCP client at http://127.0.0.1:17494/mcp and it gets the generate, " +
          "list_models and list_sounds tools. The Agents page shows every client that " +
          "has connected and what it called. See docs/MCP.md for the stdio bridge.",
        links: [
          { to: "/agents", label: "Agents" },
        ],
        sources: ["docs/MCP.md › Connecting", "README › For agents"],
      };
    }
    if (/make|generate|write|create|edit/.test(q)) {
      return {
        reply:
          "I explain things rather than make them — generating and editing happen in a " +
          "studio, where the Chat panel can write scripts, arrange clips and mix. Open " +
          "one and carry on there.",
        links: [{ to: "/studio", label: "Studio" }],
        sources: ["docs/STUDIO.md › The studio"],
      };
    }
    return {
      reply:
        "Mock guide: ask me about licences, MCP, stems, voices or where something lives " +
        "in the app and I will answer from the documentation.",
      links: [{ to: "/dashboard", label: "Dashboard" }],
      sources: [],
    };
  },

  async assistantOpeners(req: AssistantOpenersRequest): Promise<AssistantOpenersResponse> {
    await wait(400);
    if (settings.llm_mode === "off") {
      throw new Error("Prompt enhancement is off. Turn it on in Settings → Prompt assistant.");
    }
    const unnamed = req.studio?.tracks.some((t) => !t.name) ?? false;
    if (unnamed) {
      return {
        openers: [
          { label: "Name the tracks", text: "Name the unnamed tracks on this timeline" },
          { label: "Mute the beds", text: "Mute tracks 1 and 3 so I can hear the rest" },
          { label: "Horror door", text: "I need a door slam that belongs on this arrangement" },
          { label: "Which model?", text: "Which of my models should I use for a sound on this mix?" },
        ],
      };
    }
    return {
      openers: [
        { label: "Which model?", text: "Which of my models should I use, and which can I ship commercially?" },
        { label: "Horror door", text: "I need a door slam for a horror game" },
        { label: "Lo-fi loop", text: "Write me a 20 second lo-fi beat to loop under a menu" },
        {
          label: "Theme song",
          text: "Help me make a short theme song with vocals for an indie game about a lighthouse keeper",
        },
      ],
    };
  },

  async enhanceLyrics(req: EnhanceLyricsRequest): Promise<EnhanceLyricsResponse> {
    await wait(700);
    if (settings.llm_mode === "off") {
      throw new Error("Prompt enhancement is off. Turn it on in Settings → Prompt assistant.");
    }
    const styled = req.style ? ` (${req.style})` : "";
    return {
      lyrics:
        `[Intro - atmospheric]\n\n` +
        `[Verse 1]\n` +
        `Thinking of ${req.theme.trim().slice(0, 40)}${styled}\n` +
        `Every word a little older\n\n` +
        `[Chorus - anthemic]\n` +
        `WE CARRY IT WITH US NOW\n` +
        `(with us now)\n` +
        `Feeeling it in every line\n\n` +
        `[Outro - fade out]`,
    };
  },

  async getLlmStatus(): Promise<LlmStatus> {
    await wait(60);
    return llmStatusSnapshot();
  },

  async installLlmEngine(): Promise<JobRef> {
    await wait(60);
    const job = newJob("download", { model: "llm-engine" });
    void (async () => {
      job.status = "running";
      job.phase = "installing";
      job.started_at = new Date().toISOString();
      for (let i = 1; i <= 8; i++) {
        await wait(200);
        if (cancelled.has(job.id)) return;
        job.progress = i / 8;
        job.message = "Installing prompt-assistant engine";
        emit(job);
      }
      llmEngineInstalled = true;
      job.status = "done";
      job.phase = "done";
      job.progress = 1;
      job.message = "Installed";
      job.finished_at = new Date().toISOString();
      emit(job);
    })();
    return { job_id: job.id };
  },

  async downloadLlmModel(id: string): Promise<JobRef> {
    await wait(60);
    const model = llmModels.find((m) => m.id === id);
    if (!model) throw new Error(`Unknown prompt-assistant model '${id}'.`);
    const job = newJob("download", { model: `llm:${id}` });
    void (async () => {
      job.status = "running";
      job.phase = "downloading";
      job.started_at = new Date().toISOString();
      for (let i = 1; i <= 10; i++) {
        await wait(180);
        if (cancelled.has(job.id)) return;
        job.progress = i / 10;
        job.message = `${Math.round((i / 10) * (model.size_bytes / 1024 / 1024))} MB / ${Math.round(model.size_bytes / 1024 / 1024)} MB`;
        emit(job);
      }
      model.installed = true;
      job.status = "done";
      job.phase = "done";
      job.progress = 1;
      job.message = "Download complete";
      job.finished_at = new Date().toISOString();
      emit(job);
    })();
    return { job_id: job.id };
  },

  async deleteLlmModel(id: string): Promise<void> {
    await wait(150);
    const model = llmModels.find((m) => m.id === id);
    if (model) model.installed = false;
  },
  async getImageStatus(): Promise<ImageStatus> {
    await wait(60);
    return imageStatusSnapshot();
  },

  async listEndpoints() {
    await wait(60);
    return {
      endpoints: mockEndpoints.map(publicEndpoint),
      presets: MOCK_ENDPOINT_PRESETS,
      variables: MOCK_TEMPLATE_VARIABLES,
    };
  },

  async saveEndpoint(id, input) {
    await wait(120);
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)) {
      throw new Error(`"${id}" can't be an endpoint id. Use lower-case letters, digits and hyphens.`);
    }
    const unknown = [...input.body_template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)]
      .map((m) => m[1]!)
      .filter((v) => !(v in MOCK_TEMPLATE_VARIABLES));
    if (unknown.length) throw new Error(`Unknown template variable: {{${unknown[0]}}}.`);
    const index = mockEndpoints.findIndex((e) => e.id === id);
    const next = endpointFromInput(id, input, mockEndpoints[index]);
    if (index >= 0) mockEndpoints[index] = next;
    else mockEndpoints.push(next);
    syncEndpointModels();
    return publicEndpoint(next);
  },

  async deleteEndpoint(id) {
    await wait(80);
    const index = mockEndpoints.findIndex((e) => e.id === id);
    if (index >= 0) mockEndpoints.splice(index, 1);
    syncEndpointModels();
  },

  async testEndpoint(input) {
    await wait(700);
    if (!/^https?:\/\//.test(input.url)) throw new Error("The URL must start with http:// or https://.");
    return { duration_s: input.task === "speech" ? 2.4 : Math.min(5, input.max_duration_s), sample_rate: 44100, channels: 2 };
  },

  async installImageEngine(): Promise<JobRef> {
    await wait(60);
    const job = newJob("download", { model: "image-engine" });
    void (async () => {
      job.status = "running";
      job.phase = "installing";
      job.started_at = new Date().toISOString();
      for (let i = 1; i <= 8; i++) {
        await wait(200);
        if (cancelled.has(job.id)) return;
        job.progress = i / 8;
        job.message = "Installing artwork engine";
        emit(job);
      }
      imageEngineInstalled = true;
      job.status = "done";
      job.phase = "done";
      job.progress = 1;
      job.message = "Installed";
      job.finished_at = new Date().toISOString();
      emit(job);
    })();
    return { job_id: job.id };
  },

  async downloadImageModel(id: string): Promise<JobRef> {
    await wait(60);
    const model = imageModels.find((m) => m.id === id);
    if (!model) throw new Error(`Unknown artwork model '${id}'.`);
    const job = newJob("download", { model: `image:${id}` });
    void (async () => {
      job.status = "running";
      job.phase = "downloading";
      job.started_at = new Date().toISOString();
      for (let i = 1; i <= 10; i++) {
        await wait(200);
        if (cancelled.has(job.id)) return;
        job.progress = i / 10;
        job.message = `Downloading ${model.name}`;
        emit(job);
      }
      model.installed = true;
      job.status = "done";
      job.phase = "done";
      job.progress = 1;
      job.message = "Download complete";
      job.finished_at = new Date().toISOString();
      emit(job);
    })();
    return { job_id: job.id };
  },

  async deleteImageModel(id: string): Promise<void> {
    await wait(150);
    const model = imageModels.find((m) => m.id === id);
    if (model) model.installed = false;
  },

  // There is no image model in the browser, so these stand in a placeholder
  // rather than pretend to render: the point of the mock is the surrounding
  // UI states (button, pending, attached, cleared), and a fake picture that
  // ignored the prompt would misrepresent the feature more than an obvious
  // placeholder does.
  async generateSoundArtwork(id: string): Promise<Sound> {
    await wait(900);
    const sound = sounds.find((s) => s.id === id);
    if (!sound) throw new Error("Sound not found");
    sound.artwork = MOCK_ARTWORK;
    return { ...sound };
  },

  async clearSoundArtwork(id: string): Promise<void> {
    await wait(120);
    const sound = sounds.find((s) => s.id === id);
    if (sound) sound.artwork = null;
  },

  async generateVoiceArtwork(id: string): Promise<Voice> {
    await wait(900);
    const voice = voices.find((v) => v.id === id);
    if (!voice) throw new Error("Voice not found");
    voice.artwork = MOCK_ARTWORK;
    return { ...voice };
  },

  async clearVoiceArtwork(id: string): Promise<void> {
    await wait(120);
    const voice = voices.find((v) => v.id === id);
    if (voice) voice.artwork = null;
  },


  async getMcpStatus(): Promise<McpStatus> {
    await wait(80);
    const perTool = new Map<string, number>();
    for (const c of mcpCalls) perTool.set(c.tool, (perTool.get(c.tool) ?? 0) + 1);
    const otelOn = settings.otel_endpoint.length > 0;
    return {
      endpoint: `${window.location.origin.replace(/:\d+$/, ":17494")}/mcp`,
      stdio_command: "node /absolute/path/to/soundbox/server/dist/mcp/stdio.js",
      server_name: "soundbox",
      server_version: "0.1.0-mock",
      tools: MOCK_TOOLS.map((t) => ({ ...t, calls: perTool.get(t.name) ?? 0 })),
      clients: computeMcpClients(),
      calls_total: mcpCalls.length,
      errors_total: mcpCalls.filter((c) => c.status === "error").length,
      sounds_total: sounds.filter((s) => s.source === "mcp").length,
      calls_24h: mcpCalls.filter((c) => now - new Date(c.ts).getTime() < 86_400_000).length,
      last_call_at: mcpCalls.reduce((a, c) => (c.ts > a ? c.ts : a), mcpCalls[0]?.ts ?? ""),
      active_sessions: new Set(
        mcpCalls
          .filter((c) => now - new Date(c.ts).getTime() < 600_000)
          .map((c) => c.session_id)
          .filter(Boolean),
      ).size,
      otel: {
        enabled: otelOn,
        installed: true,
        endpoint: otelOn ? settings.otel_endpoint : null,
        source: otelOn ? "settings" : "none",
        service_name: "soundbox",
        error: null,
      },
      skills: [
        {
          name: "soundbox-sfx",
          description:
            "Generate sound effects, foley and ambience locally through the Soundbox MCP server.",
          path: "backend/src/soundbox/skills/soundbox-sfx",
          files: ["SKILL.md", "references/prompting.md"],
          installed_at: mockSkillsInstalledTo.claude
            ? { claude: `${mockSkillsInstalledTo.claude}/soundbox-sfx` }
            : {},
        },
        {
          name: "soundbox-sound-pass",
          description:
            "Do a full sound pass over a project: inventory, generate and wire up every sound event it needs.",
          path: "backend/src/soundbox/skills/soundbox-sound-pass",
          files: ["SKILL.md"],
          installed_at: mockSkillsInstalledTo.claude
            ? { claude: `${mockSkillsInstalledTo.claude}/soundbox-sound-pass` }
            : {},
        },
      ],
      skill_targets: [
        { id: "claude", label: "Claude Code", path: "~/.claude/skills", exists: true },
        { id: "cursor", label: "Cursor", path: "~/.cursor/skills", exists: false },
        { id: "codex", label: "Codex", path: "~/.codex/skills", exists: false },
      ],
    };
  },

  async listMcpCalls(query: McpCallQuery = {}): Promise<McpCall[]> {
    await wait(60);
    let items = mcpCalls.slice().sort((a, b) => b.ts.localeCompare(a.ts));
    if (query.client) items = items.filter((c) => c.client_name === query.client);
    if (query.tool) items = items.filter((c) => c.tool === query.tool);
    if (query.status) items = items.filter((c) => c.status === query.status);
    return items.slice(0, query.limit ?? 100).map((c) => ({ ...c }));
  },

  async installSkills(req: SkillInstallRequest): Promise<SkillInstallResult> {
    await wait(300);
    const dest =
      req.target === "dir"
        ? (req.path ?? "")
        : `~/.${req.target === "claude" ? "claude" : req.target}/skills`;
    if (req.target !== "dir") mockSkillsInstalledTo = { ...mockSkillsInstalledTo, [req.target]: dest };
    return { target: req.target, dest, installed: req.skills ?? ["soundbox-sfx", "soundbox-sound-pass"] };
  },
};
