// Child processes: audiocpp_server (TTS and STT, one process each so a
// transcription never waits on the lock a TTS line holds) and llama-server.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { config } from "./config.mjs";

const children = [];

export function stopEngines() {
  for (const c of children.splice(0)) {
    try {
      c.kill();
    } catch {}
  }
}
process.on("exit", stopEngines);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopEngines();
    process.exit(0);
  });
}

async function waitFor(url, label, proc, timeoutMs = 180_000) {
  const t0 = Date.now();
  let exited = null;
  proc.once("exit", (code) => (exited = code));
  while (Date.now() - t0 < timeoutMs) {
    if (exited !== null) throw new Error(`${label} exited with code ${exited} during start-up`);
    try {
      const r = await fetch(url);
      if (r.ok) return Date.now() - t0;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`${label} did not answer ${url} in ${timeoutMs} ms`);
}

function launch(label, bin, args, env = process.env) {
  if (!existsSync(bin)) throw new Error(`${label}: binary not found at ${bin}`);
  const logDir = join(config.scratch, "logs");
  mkdirSync(logDir, { recursive: true });
  const proc = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env });
  const tail = [];
  const onOut = (b) => {
    tail.push(b.toString());
    if (tail.length > 40) tail.shift();
    if (process.env.SPIKE_ENGINE_LOG) process.stderr.write(`[${label}] ${b}`);
  };
  proc.stdout.on("data", onOut);
  proc.stderr.on("data", onOut);
  proc.tail = () => tail.join("");
  children.push(proc);
  return proc;
}

/** One audiocpp_server holding one streaming model, loaded at start. */
export async function startAudiocpp(kind, override = {}) {
  const m = { ...config[kind], ...override };
  const port = override.port ?? (kind === "tts" ? config.ttsPort : config.sttPort);
  const weights = join(config.modelsDir, m.weights);
  if (!existsSync(weights)) throw new Error(`${kind}: weights missing at ${weights} (run: npm run setup)`);
  const cfgDir = join(config.scratch, "engine-config");
  mkdirSync(cfgDir, { recursive: true });
  const cfgPath = join(cfgDir, `${kind}-${port}.json`);
  writeFileSync(
    cfgPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port,
        backend: config.audiocppBackend,
        device: 0,
        threads: 1,
        lazy_load: false,
        models: [{ id: m.id, family: m.family, path: weights, task: kind === "tts" ? "tts" : "asr", mode: m.mode }],
      },
      null,
      2,
    ),
  );
  const proc = launch(`audiocpp-${kind}`, config.audiocppServer, ["--config", cfgPath, "--no-ui"]);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const ms = await waitFor(`${baseUrl}/health`, `audiocpp-${kind}`, proc);
    return { baseUrl, model: m.id, startMs: ms, proc };
  } catch (e) {
    throw new Error(`${e.message}\n${proc.tail()}`);
  }
}

/** The LLM endpoint: a spawned llama-server, or whatever the env points at. */
export async function startLlm() {
  const l = config.llm;
  if (l.provider === "openai") {
    if (!l.baseUrl || !l.model) throw new Error("LLM_PROVIDER=openai needs LLM_BASE_URL and LLM_MODEL");
    return { baseUrl: l.baseUrl.replace(/\/+$/, ""), model: l.model, apiKey: l.apiKey, local: false, startMs: 0 };
  }
  if (l.provider === "claude") {
    const { startClaudeBrain } = await import("./claude/start.mjs");
    return startClaudeBrain({ port: config.llmPort, model: l.claudeModel, effort: l.claudeEffort });
  }
  if (l.provider !== "local") throw new Error(`unknown LLM_PROVIDER "${l.provider}" (local | openai | claude)`);
  if (!existsSync(l.gguf)) throw new Error(`LLM weights missing at ${l.gguf} (set LLM_GGUF)`);
  // Mirli's managed llama-server is a CUDA 12 build; without cudart64_12.dll
  // on the DLL search path it finds no GPU and quietly runs on the CPU.
  const env = { ...process.env };
  if (existsSync(l.cudaRuntimeDir)) env.PATH = `${l.cudaRuntimeDir}${delimiter}${env.PATH ?? env.Path ?? ""}`;
  delete env.Path;
  const proc = launch("llama", l.llamaServer, [
    "-m", l.gguf,
    "--host", "127.0.0.1",
    "--port", String(config.llmPort),
    "-c", "4096",
    "--no-webui",
    "--parallel", "1",
    "-ngl", String(l.gpuLayers),
  ], env);
  const baseUrl = `http://127.0.0.1:${config.llmPort}`;
  try {
    const ms = await waitFor(`${baseUrl}/health`, "llama-server", proc);
    return { baseUrl: `${baseUrl}/v1`, model: "local", apiKey: "", local: true, startMs: ms, proc };
  } catch (e) {
    throw new Error(`${e.message}\n${proc.tail()}`);
  }
}
