// Fetch the three model files this spike needs into the scratch models dir
// (~/.mirli-spike/models by default). Skips anything already there.
// The LLM is not fetched: by default the spike reuses, read-only, the Qwen3
// GGUF and llama-server that Mirli's own "Enhance" feature downloaded.

import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { config } from "./lib/config.mjs";

const HF = "https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/";
const FILES = [
  // [path under modelsDir, url, licence]
  [config.tts.weights, HF + config.tts.weights, "Apache-2.0 (openbmb/VoxCPM2)"],
  [config.stt.weights, HF + config.stt.weights, "OpenMDW-1.1 (nvidia/nemotron-3.5-asr-streaming-0.6b)"],
  [
    config.vadModel,
    "https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx",
    "MIT (snakers4/silero-vad)",
  ],
];

for (const [rel, url, licence] of FILES) {
  const dest = join(config.modelsDir, rel);
  if (existsSync(dest)) {
    console.log(`have  ${rel} (${(statSync(dest).size / 1e6).toFixed(0)} MB)`);
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  console.log(`fetch ${rel}  [${licence}]`);
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
  await pipeline(Readable.fromWeb(resp.body), createWriteStream(dest + ".part"));
  renameSync(dest + ".part", dest);
  console.log(`  ok, ${(statSync(dest).size / 1e6).toFixed(0)} MB`);
}
// llama.cpp's CUDA 12 runtime DLLs, for the llama-server build Mirli manages
// (b10545, cuda-12.4). Only needed on Windows, and only if that install lacks
// them, which it did on the dev machine: without them the LLM runs on the CPU.
const cudart = config.llm.cudaRuntimeDir;
if (process.platform === "win32" && config.llm.provider === "local" && !existsSync(join(cudart, "cudart64_12.dll"))) {
  const url = "https://github.com/ggml-org/llama.cpp/releases/download/b10545/cudart-llama-bin-win-cuda-12.4-x64.zip";
  console.log(`fetch ${url}  [NVIDIA CUDA runtime, redistributed by llama.cpp]`);
  mkdirSync(cudart, { recursive: true });
  const zip = join(cudart, "cudart.zip");
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
  await pipeline(Readable.fromWeb(resp.body), createWriteStream(zip));
  const r = spawnSync("tar", ["-xf", zip, "-C", cudart], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("could not unpack the CUDA runtime zip with tar");
  rmSync(zip);
}
console.log(`models in ${config.modelsDir}`);
