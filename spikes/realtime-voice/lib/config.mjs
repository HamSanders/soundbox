// All configuration comes from the environment. Nothing here reads or writes
// Mirli's data dir except, read-only, the LLM weights and llama-server binary
// the app already downloaded (override both to avoid even that).

import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;
const here = dirname(fileURLToPath(import.meta.url));
const num = (name, fallback) => {
  const v = Number(env[name]);
  return env[name] !== undefined && Number.isFinite(v) ? v : fallback;
};

const audiocppCli = env.MIRLI_AUDIOCPP_BIN ?? env.SOUNDBOX_AUDIOCPP_BIN ?? "";
const scratch = env.SPIKE_DIR ?? join(homedir(), ".mirli-spike");
const mirliData = join(homedir(), ".soundbox");

export const config = {
  root: resolve(here, ".."),
  scratch,
  modelsDir: env.SPIKE_MODELS_DIR ?? join(scratch, "models"),
  port: num("SPIKE_PORT", 17650),

  // audio.cpp: the server binary sits beside the CLI the env var points at.
  audiocppServer:
    env.SPIKE_AUDIOCPP_SERVER ??
    (audiocppCli ? join(dirname(audiocppCli), "audiocpp_server.exe") : ""),
  audiocppBackend: env.MIRLI_AUDIOCPP_BACKEND ?? env.SOUNDBOX_AUDIOCPP_BACKEND ?? "cuda",
  ttsPort: num("SPIKE_TTS_PORT", 17651),
  sttPort: num("SPIKE_STT_PORT", 17652),
  llmPort: num("SPIKE_LLM_PORT", 17653),

  tts: {
    id: "voxcpm2-stream",
    family: "voxcpm2",
    mode: "streaming",
    weights: "VoxCPM2-GGUF/voxcpm2-q8_0.gguf",
    // Optional reference clip (wav) to clone; unset = seeded default voice.
    voiceRef: env.SPIKE_VOICE_REF ?? "",
    seed: num("SPIKE_TTS_SEED", 7),
  },
  stt: {
    id: "nemotron-offline",
    family: "nemotron_asr",
    // Offline on purpose: see lib/stt.mjs for the measurement behind it.
    mode: "offline",
    weights: "Nemotron-3.5-ASR-Streaming-0.6B-GGUF/nemotron-3.5-asr-streaming-0.6b-q8_0.gguf",
    language: env.SPIKE_STT_LANGUAGE ?? "en-US",
  },
  vadModel: "silero_vad.onnx",

  llm: {
    // "local": spawn llama-server on LLM_GGUF. "openai": any OpenAI-compatible
    // endpoint (LLM_BASE_URL, LLM_MODEL, key in LLM_API_KEY). Never hard-coded.
    provider: env.LLM_PROVIDER ?? "local",
    baseUrl: env.LLM_BASE_URL ?? "",
    apiKey: env.LLM_API_KEY ?? "",
    model: env.LLM_MODEL ?? "",
    llamaServer:
      env.LLAMA_SERVER_BIN ?? join(mirliData, "bin", "llama", "b10545", "llama-server.exe"),
    gguf: env.LLM_GGUF ?? join(mirliData, "models", "llm", "qwen3-1.7b", "Qwen3-1.7B-Q8_0.gguf"),
    cudaRuntimeDir: env.LLAMA_CUDA_DIR ?? join(scratch, "cudart12"),
    // 99 = all layers on the GPU. 0 = CPU only, which frees about 2.5 GB of
    // VRAM for the face model.
    gpuLayers: num("LLM_GPU_LAYERS", 99),
    maxTokens: num("LLM_MAX_TOKENS", 160),
    system:
      env.LLM_SYSTEM ??
      "You are a friendly voice companion in a live spoken conversation. " +
        "Reply in one to three short spoken sentences. Plain words only: " +
        "no lists, no markdown, no emoji, no stage directions.",
  },

  vad: {
    threshold: num("VAD_THRESHOLD", 0.5),
    // Consecutive 32 ms speech frames before a turn starts...
    startFrames: num("VAD_START_FRAMES", 3),
    // ...and before speech over the assistant's own audio counts as barge-in.
    bargeFrames: num("VAD_BARGE_FRAMES", 6),
    // Trailing silence that ends the user's turn. The floor of the whole loop.
    endpointMs: num("VAD_ENDPOINT_MS", 400),
    // Silence after which a reply is started speculatively (0 = never; the
    // reply then starts at the endpoint). Must be below endpointMs.
    speculateMs: num("VAD_SPECULATE_MS", 160),
    // Audio kept from before the VAD fired, so the first word isn't clipped.
    prerollFrames: num("VAD_PREROLL_FRAMES", 25),
  },
  // Re-transcribe the utterance-so-far this often while the user talks.
  partialMs: num("STT_PARTIAL_MS", 480),
  // Speak the first clause of a reply as soon as it has this many words.
  firstClauseWords: num("FIRST_CLAUSE_WORDS", 4),
  targetMs: 500,
};
