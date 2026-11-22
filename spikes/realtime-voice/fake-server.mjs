// A stand-in voice worker: the same WebSocket protocol, routing and auth as
// server.mjs (lib/calls.mjs, lib/tap.mjs), but no models. A typed message
// gets a scripted reply and a tone as its "speech". For tests of the web app,
// the Call API and the face worker's per-call routing on any machine.
//
//   SPIKE_PORT=17750 node fake-server.mjs

import http from "node:http";

import { WebSocketServer } from "ws";

import { AuthError, CallGate, CallRoutes } from "./lib/calls.mjs";
import { PcmTap } from "./lib/tap.mjs";

const PORT = Number(process.env.SPIKE_PORT || 17750);
const RATE = 48000;
const tap = new PcmTap();
tap.format.sample_rate = RATE;
const gate = new CallGate();
const routes = new CallRoutes(tap);
const VOICES = [{ id: "fake-a", name: "Test voice A", model: "fake" }, { id: "fake-b", name: "Test voice B", model: "fake" }];

/** 1 s of a tone per call, a different pitch per call so cross-talk is audible and measurable. */
function tone(seconds, hz) {
  const n = Math.round(seconds * RATE), b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / RATE) * 8000), i * 2);
  return b;
}

const server = http.createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const cors = gate.cors(req);
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  if (path === "/voices") return res.writeHead(200, { "Content-Type": "application/json", ...cors }).end(JSON.stringify(VOICES));
  if (path === "/readyz") return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ready: true, busy: routes.calls.length > 0, calls: routes.calls }));
  const m = path.match(/^\/internal\/calls\/([\w-]+)\/end$/);
  if (m && req.method === "POST") {
    try { if (!gate.check(req, "admin").admin) throw new AuthError(403, "admin token required"); }
    catch (e) { return res.writeHead(e.status ?? 401).end(e.message); }
    return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ended: routes.end(m[1]) }));
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true, handleProtocols: CallGate.pickProtocol });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname !== "/ws" && url.pathname !== "/tap") return socket.destroy();
  let who;
  try { who = gate.check(req, url.pathname === "/tap" ? "tap" : "voice"); }
  catch (e) { return socket.end(`HTTP/1.1 ${e.status ?? 401} Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (url.pathname === "/tap") {
      const call = url.searchParams.get("call");
      return call ? routes.subscribe(call, ws) : tap.addWs(ws);
    }
    converse(ws, who.call);
  });
});

let callNo = 0;
function converse(ws, call) {
  routes.attach(call, ws);
  const hz = 300 + 120 * (callNo++ % 5);
  const callTap = routes.tap(call);
  const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  let turn = 0, mic = 0, persona = "", voice = "";
  send({ type: "hello", call, mic_rate: 16000, tts: tap.format, vad: { endpointMs: 400 }, vram: { total: 0 } });
  send({ type: "state", state: "idle" });
  ws.on("message", async (data, isBinary) => {
    if (isBinary) { mic += data.length; return; }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === "persona") persona = msg.text;
    if (msg.type === "voice") { voice = msg.id; send({ type: "voice", id: voice, name: VOICES.find((v) => v.id === voice)?.name ?? voice }); }
    if (msg.type !== "text") return;
    const t = ++turn;
    send({ type: "final", text: msg.text });
    send({ type: "state", state: "thinking" });
    const reply = `You said ${msg.text}. ${persona.startsWith("You are Santa") ? "Ho ho ho!" : "Nice."} This is call ${call.slice(0, 8)}.`;
    for (const w of reply.split(" ")) { send({ type: "reply_delta", text: w + " " }); await new Promise((r) => setTimeout(r, 15)); }
    send({ type: "state", state: "speaking" });
    callTap.start({ turn: t, utterance: 0, text: reply });
    const pcm = tone(1.0, hz);
    for (let off = 0; off < pcm.length; off += 7680 * 2) {
      const chunk = pcm.subarray(off, off + 7680 * 2);
      callTap.pcm(chunk);
      if (ws.readyState === 1) ws.send(chunk, { binary: true });
      await new Promise((r) => setTimeout(r, 40));
    }
    callTap.end({ turn: t, utterance: 0 });
    send({ type: "turn", turn: t, endpoint_wait_ms: 0, eos_to_transcript_ms: 1, eos_to_first_token_ms: 2, eos_to_first_audio_ms: 3, vram_peak_mib: 0, target_ms: 500 });
    send({ type: "state", state: "idle" });
  });
}

server.listen(PORT, "127.0.0.1", () => console.log(`fake voice worker on http://127.0.0.1:${PORT}  auth ${gate.secured ? "on" : "off"}`));
