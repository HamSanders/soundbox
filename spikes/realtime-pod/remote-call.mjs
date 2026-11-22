// Headless caller against a call pod (local or through a provider proxy):
//   node remote-call.mjs "<join url with ?t=…>" <dir of 16 kHz mono s16 wavs> [minutes]
// Opens /ws and /facesrv/ws the way the page does, plays each wav at real-time pace (512-sample frames every
// 32 ms, silence otherwise) with a gap after each, loops for [minutes], and reports: per-turn server latency,
// TTS audio received, face frames per second, and whether either socket closed early (the proxy question).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { WebSocket } from "../realtime-voice/node_modules/ws/wrapper.mjs";

const [joinUrl, wavDir, minutesArg] = process.argv.slice(2);
const minutes = Number(minutesArg ?? 4);
const u = new URL(joinUrl);
const token = u.searchParams.get("t");
const wsBase = `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}`;
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);

const wavs = readdirSync(wavDir).filter((f) => f.endsWith(".wav")).sort().map((f) => {
  const b = readFileSync(join(wavDir, f));
  const data = b.indexOf("data") + 8; // plain PCM wav
  return new Int16Array(b.buffer.slice(b.byteOffset + data, b.byteOffset + b.length - ((b.length - data) % 2)));
});

const page = await fetch(joinUrl, { headers: { "User-Agent": "mirli-remote-call" } });
console.log(`${ts()} page ${page.status} ${(await page.text()).length} bytes`);

const open = (path) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${wsBase}${path}?t=${token}`, { headers: { "User-Agent": "mirli-remote-call" } });
  ws.binaryType = "nodebuffer";
  ws.once("open", () => resolve(ws));
  ws.once("unexpected-response", (_q, r) => reject(new Error(`${path}: HTTP ${r.statusCode}`)));
  ws.once("error", reject);
});

const stats = { ttsBytes: 0, faceMsgs: 0, faceBytes: 0, turns: [], closes: [] };
const voice = await open("/ws");
const face = await open("/facesrv/ws");
console.log(`${ts()} both sockets open`);
for (const [name, ws] of [["voice", voice], ["face", face]]) {
  ws.on("close", (code, why) => {
    stats.closes.push({ name, at_s: (Date.now() - t0) / 1000, code, why: String(why) });
    console.log(`${ts()} ${name} socket CLOSED code=${code} ${why}`);
  });
}
let hello = null;
voice.on("message", (d, bin) => {
  if (bin) return void (stats.ttsBytes += d.length);
  const m = JSON.parse(d.toString());
  if (m.type === "hello") hello = m;
  if (m.type === "turn") {
    stats.turns.push(m);
    console.log(`${ts()} turn ${m.turn}: eos→transcript ${m.eos_to_transcript_ms} ms, →first token ${m.eos_to_first_token_ms}, →first audio ${m.eos_to_first_audio_ms} ms | "${(m.transcript ?? "").slice(0, 50)}" → "${(m.reply ?? "").slice(0, 60)}"`);
  }
  if (m.type === "error") console.log(`${ts()} server error: ${m.message}`);
});
face.on("message", (d) => {
  stats.faceMsgs++;
  stats.faceBytes += d.length;
});
let lastFace = 0;
const faceTick = setInterval(() => {
  const n = stats.faceMsgs - lastFace;
  lastFace = stats.faceMsgs;
  process.stdout.write(`${ts()} face msgs/10s ${n}, total ${(stats.faceBytes / 1e6).toFixed(1)} MB, tts ${(stats.ttsBytes / 1e6).toFixed(2)} MB\n`);
}, 10000);

const FRAME = 512;
const silence = new Int16Array(FRAME);
const end = t0 + minutes * 60_000;
let w = 0;
let next = Date.now();
while (Date.now() < end && voice.readyState === 1) {
  const clip = wavs[w++ % wavs.length];
  const frames = [];
  for (let i = 0; i < clip.length; i += FRAME) frames.push(clip.slice(i, i + FRAME));
  for (let i = 0; i < 280; i++) frames.push(silence); // ~9 s for the reply to play out
  for (const f of frames) {
    const pad = f.length === FRAME ? f : Int16Array.from({ length: FRAME }, (_, k) => f[k] ?? 0);
    if (voice.readyState === 1) voice.send(Buffer.from(pad.buffer), { binary: true });
    next += 32;
    await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));
  }
}
clearInterval(faceTick);
const durS = (Date.now() - t0) / 1000;
console.log(JSON.stringify({
  duration_s: durS, turns: stats.turns.length,
  eos_to_first_audio_ms: stats.turns.map((t) => t.eos_to_first_audio_ms),
  tts_mb: +(stats.ttsBytes / 1e6).toFixed(2), face_msgs: stats.faceMsgs,
  face_mbit_s: +((stats.faceBytes * 8) / 1e6 / durS).toFixed(2), closes: stats.closes, hello_tts: hello?.tts,
}, null, 1));
voice.close();
face.close();
process.exit(stats.closes.length ? 1 : 0);
