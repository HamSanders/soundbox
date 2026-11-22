// Real-time voice conversation spike. `node server.mjs`, then open
// http://127.0.0.1:17650. See README.md.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { extname, join } from "node:path";

import { WebSocketServer } from "ws";

import { config } from "./lib/config.mjs";
import { Conversation } from "./lib/conversation.mjs";
import { startAudiocpp, startLlm, stopEngines } from "./lib/engines.mjs";
import { GpuMeter } from "./lib/gpu.mjs";
import { chat } from "./lib/llm.mjs";
import { transcribe } from "./lib/stt.mjs";
import { PcmTap } from "./lib/tap.mjs";
import { probeSampleRate, speak } from "./lib/tts.mjs";
import { Vad } from "./lib/vad.mjs";
import { listVoices } from "./lib/voices.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gpu = new GpuMeter();
await gpu.start();
const vram = { baseline: gpu.current };
console.log(`VRAM before engines: ${vram.baseline} MiB`);

// One at a time so each engine's VRAM cost can be read off the meter.
async function timed(label, start, warm) {
  const before = gpu.current;
  const engine = await start();
  await warm(engine);
  await sleep(600);
  vram[label] = gpu.current - before;
  console.log(`${label}: up in ${engine.startMs} ms, +${vram[label]} MiB VRAM`);
  return engine;
}

const tap = new PcmTap();
const stt = await timed("stt", () => startAudiocpp("stt"), async (e) => {
  await transcribe(e, new Int16Array(16000));
});
const tts = await timed("tts", () => startAudiocpp("tts"), async (e) => {
  const fmt = await probeSampleRate(e);
  tap.format.sample_rate = fmt.sampleRate;
  tap.format.channels = fmt.channels;
  let first = 0;
  for await (const ev of speak(e, "Ready when you are.")) if (ev.pcm && !first) first = ev.pcm.length / 2;
  tap.format.chunk_samples = first / fmt.channels;
});
const llm = await timed("llm", startLlm, async (e) => {
  for await (const _ of chat(e, [{ role: "user", content: "Say hi." }])) break;
});
await Vad.create();
vram.total = gpu.current - vram.baseline;
console.log(`all engines: +${vram.total} MiB VRAM; TTS format`, tap.format);

mkdirSync(join(config.root, "runs"), { recursive: true });
const turnsLog = join(config.root, "runs", process.env.SPIKE_RUN_LOG ?? "turns.jsonl");
const recent = [];
function logTurn(rec) {
  recent.push(rec);
  if (recent.length > 200) recent.shift();
  appendFileSync(turnsLog, JSON.stringify(rec) + "\n");
  const f = (v) => (v == null ? "   -" : String(v).padStart(4));
  console.log(
    `turn ${String(rec.turn).padStart(2)} | eos->transcript ${f(rec.eos_to_transcript_ms)} | ->first token ${f(rec.eos_to_first_token_ms)}` +
      ` | ->first audio ${f(rec.eos_to_first_audio_ms)} ms (target ${rec.target_ms}) | VRAM peak ${rec.vram_peak_mib} MiB` +
      (rec.barged_in ? " | barged in" : "") + (rec.discarded ? ` | discarded: ${rec.discarded}` : ""),
  );
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const server = http.createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/tts.pcm") return tap.addHttp(res);
  if (path === "/voices") {
    return listVoices().then(
      (v) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(v.map(({ id, name, model }) => ({ id, name, model })))),
      (e) => res.writeHead(500).end(String(e.message)),
    );
  }
  if (path === "/metrics") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ vram, format: tap.format, vad: config.vad, partial_ms: config.partialMs, turns: recent }));
  }
  const file = path === "/" ? "home.html" : path.slice(1); // the landing page; the video call is index.html
  if (!/^[\w.-]+$/.test(file) || !MIME[extname(file)]) return res.writeHead(404).end();
  try {
    const body = readFileSync(join(config.root, "public", file));
    res.writeHead(200, { "Content-Type": MIME[extname(file)], "Cache-Control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path !== "/ws" && path !== "/tap") return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => (path === "/tap" ? tap.addWs(ws) : converse(ws)));
});

async function converse(ws) {
  const send = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  const sendPcm = (buf) => ws.readyState === 1 && ws.send(buf, { binary: true });
  const convo = new Conversation({ tts, stt, llm, gpu, tap, log: logTurn, voices: listVoices }, send, sendPcm);
  await convo.init();
  ws.on("message", (data, isBinary) => {
    if (isBinary) return convo.onMic(data);
    try {
      convo.onControl(JSON.parse(data.toString()));
    } catch {}
  });
  ws.on("close", () => convo.close());
  send({ type: "hello", mic_rate: 16000, tts: tap.format, vad: config.vad, vram });
}

server.listen(config.port, "127.0.0.1", () => {
  console.log(`\nopen http://127.0.0.1:${config.port}  (PCM tap: /tts.pcm and ws /tap)`);
});
process.on("uncaughtException", (e) => {
  console.error(e);
  stopEngines();
  process.exit(1);
});
