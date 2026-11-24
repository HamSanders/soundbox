// Mirli's live voice worker: VAD -> STT -> LLM -> streaming TTS over one WebSocket per call.
// `npm start`, then call it from Mirli's Calls page or the Discord bot (integrations/discord). See README.md.

import { appendFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";

import { WebSocketServer } from "ws";

import { config } from "./lib/config.mjs";
import { Conversation } from "./lib/conversation.mjs";
import { startAudiocpp, startLlm, stopEngines } from "./lib/engines.mjs";
import { GpuMeter } from "./lib/gpu.mjs";
import { chat } from "./lib/llm.mjs";
import { transcribe } from "./lib/stt.mjs";
import { AuthError, CallGate, CallRoutes } from "./lib/calls.mjs";
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

// Per-call routing and auth (lib/calls.mjs). Without a call secret this behaves
// as the spike always did: any page may connect, each socket is its own call.
const gate = new CallGate();
const routes = new CallRoutes(tap);
console.log(gate.secured ? `call auth on; origins: ${gate.origins.join(", ") || "any"}` : "call auth OFF (no call secret): any page may connect");

const server = http.createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const cors = gate.cors(req);
  if (req.method === "OPTIONS") return res.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }).end();
  if (path === "/readyz") {
    return res.writeHead(200, { "Content-Type": "application/json", ...cors }).end(JSON.stringify({ ready: true, busy: routes.calls.length > 0, calls: routes.calls.length, auth: gate.secured }));
  }
  const endM = path.match(/^\/internal\/calls\/([\w-]+)\/end$/);
  if (endM && req.method === "POST") {
    try {
      const who = gate.check(req, "admin");
      if (!who.admin) throw new AuthError(403, "admin token required");
    } catch (e) { return res.writeHead(e.status ?? 401).end(e.message); }
    const had = routes.end(endM[1]);
    return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ended: had }));
  }
  if (path === "/tts.pcm") {
    if (gate.secured) return res.writeHead(403).end("the HTTP tap is off while call auth is on; use ws /tap?call=<id>");
    return tap.addHttp(res);
  }
  if (path === "/voices") {
    return listVoices().then(
      (v) => res.writeHead(200, { "Content-Type": "application/json", ...cors }).end(JSON.stringify(v.map(({ id, name, model }) => ({ id, name, model })))),
      (e) => res.writeHead(500).end(String(e.message)),
    );
  }
  if (path === "/metrics") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ vram, format: tap.format, vad: config.vad, partial_ms: config.partialMs, turns: recent }));
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true, handleProtocols: CallGate.pickProtocol });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  if (path !== "/ws" && path !== "/tap") return socket.destroy();
  let who;
  try {
    who = gate.check(req, path === "/tap" ? "tap" : "voice");
  } catch (e) {
    socket.end(`HTTP/1.1 ${e.status ?? 401} ${e.status === 403 ? "Forbidden" : "Unauthorized"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (path === "/tap") {
      // /tap?call=<id>: one call's speech (what the face worker follows). Bare /tap: everything.
      const call = url.searchParams.get("call") ?? (gate.secured && !who.admin ? who.call : null);
      if (call) return routes.subscribe(call, ws);
      if (gate.secured && !who.admin) return ws.close(4003, "admin token required for the server-wide tap");
      return tap.addWs(ws);
    }
    converse(ws, who.call);
  });
});

async function converse(ws, call) {
  routes.attach(call, ws);
  const send = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  const sendPcm = (buf) => ws.readyState === 1 && ws.send(buf, { binary: true });
  const convo = new Conversation({ tts, stt, llm, gpu, tap: routes.tap(call), log: logTurn, voices: listVoices }, send, sendPcm);
  await convo.init();
  ws.on("message", (data, isBinary) => {
    if (isBinary) return convo.onMic(data);
    try {
      convo.onControl(JSON.parse(data.toString()));
    } catch {}
  });
  ws.on("close", () => convo.close());
  send({ type: "hello", call, mic_rate: 16000, tts: tap.format, vad: config.vad, vram });
}

server.listen(config.port, "127.0.0.1", () => {
  console.log(`\nlive voice worker on ws://127.0.0.1:${config.port}/ws  (Mirli's Calls page and integrations connect here)`);
});
process.on("uncaughtException", (e) => {
  console.error(e);
  stopEngines();
  process.exit(1);
});
