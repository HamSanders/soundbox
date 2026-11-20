// Headless conversation: plays spoken utterances into a running server's /ws
// at real-time pace, exactly as the browser's mic worklet would (512-sample
// 16 kHz frames every 32 ms, silence in between), and reports per-turn
// latency. The "user" audio is synthesised with the TTS engine itself, then
// trailing silence is trimmed so the bench knows the true end of speech.
//
//   node server.mjs            (in one terminal)
//   node bench/turns.mjs [rounds] [--barge]

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import WebSocket from "ws";

import { config } from "../lib/config.mjs";
import { speak } from "../lib/tts.mjs";

const rounds = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 2);
const bargeTest = process.argv.includes("--barge");
const base = `127.0.0.1:${config.port}`;
const FRAME = 512;
const FRAME_MS = 32;

const LINES = [
  "Hi there, how are you doing today?",
  "What should I cook for dinner tonight?",
  "Tell me something interesting about the ocean.",
  "I had a really long day at work.",
  "Can you recommend a good book to read?",
  "What's the weather usually like in spring?",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Synthesize `text`, return 16 kHz s16 with leading/trailing silence trimmed. */
async function utterance(text, rate) {
  const tts = { baseUrl: `http://127.0.0.1:${config.ttsPort}`, model: config.tts.id };
  const parts = [];
  for await (const ev of speak(tts, text)) if (ev.pcm) parts.push(ev.pcm);
  const buf = Buffer.concat(parts);
  const src = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const step = rate / 16000;
  const out = new Int16Array(Math.floor(src.length / step));
  for (let i = 0; i < out.length; i++) {
    let acc = 0;
    const a = Math.floor(i * step);
    const b = Math.floor((i + 1) * step);
    for (let j = a; j < b; j++) acc += src[j];
    out[i] = acc / (b - a);
  }
  const loud = (i) => Math.abs(out[i]) > 500;
  let s = 0;
  let e = out.length - 1;
  while (s < e && !loud(s)) s++;
  while (e > s && !loud(e)) e--;
  return out.slice(Math.max(0, s - 320), e + 1);
}

const { format } = await (await fetch(`http://${base}/metrics`)).json();
console.log("synthesising user utterances...");
const clips = [];
for (const line of LINES) clips.push({ text: line, pcm: await utterance(line, format.sample_rate) });
const bargeClip = { text: "Wait, stop, I have another question.", pcm: await utterance("Wait, stop, I have another question.", format.sample_rate) };

const ws = new WebSocket(`ws://${base}/ws`);
await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));

// --- the fake microphone: one paced loop, speech when queued, else room tone
let source = null; // { pcm, off, onEnd }
const micStart = performance.now();
let sent = 0;
const mic = setInterval(() => {
  const due = Math.floor((performance.now() - micStart) / FRAME_MS);
  while (sent < due) {
    const frame = new Int16Array(FRAME);
    for (let i = 0; i < FRAME; i++) frame[i] = (Math.random() - 0.5) * 30;
    if (source) {
      const n = Math.min(FRAME, source.pcm.length - source.off);
      frame.set(source.pcm.subarray(source.off, source.off + n));
      source.off += n;
      if (source.off >= source.pcm.length) {
        const s = source;
        source = null;
        s.onEnd(performance.now());
      }
    }
    ws.send(Buffer.from(frame.buffer), { binary: true });
    sent++;
  }
}, 8);

function say(clip) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    source = { pcm: clip.pcm, off: 0, onEnd: (endedAt) => resolve({ startedAt, endedAt }) };
  });
}

// --- the fake speaker: tracks when queued audio would finish playing
let playEnd = 0;
let playing = false;
let firstPcmAt = null;
let flushAt = null;
let turnResolve = null;
const results = [];
setInterval(() => {
  if (playing && performance.now() >= playEnd) {
    playing = false;
    ws.send(JSON.stringify({ type: "playback", playing: false }));
  }
}, 20);

ws.on("message", (data, isBinary) => {
  const t = performance.now();
  if (isBinary) {
    firstPcmAt ??= t;
    const dur = (data.length / 2 / format.sample_rate) * 1000;
    playEnd = Math.max(playEnd, t) + dur;
    if (!playing) {
      playing = true;
      ws.send(JSON.stringify({ type: "playback", playing: true }));
    }
    return;
  }
  const m = JSON.parse(data.toString());
  if (m.type === "flush") {
    flushAt = t;
    playEnd = 0;
  } else if (m.type === "turn") turnResolve?.(m);
  else if (m.type === "error") console.error("server error:", m.message);
});
const nextTurn = () => new Promise((r) => (turnResolve = r));
const untilQuiet = async () => {
  while (playing) await sleep(30);
};

await sleep(800);
for (let r = 0; r < rounds; r++) {
  for (const clip of clips) {
    firstPcmAt = null;
    const turnP = nextTurn();
    const { endedAt } = await say(clip);
    const rec = await turnP;
    // Ground truth from the client side: last speech sample sent -> first PCM back.
    rec.client_eos_to_first_audio_ms = firstPcmAt === null ? null : Math.round(firstPcmAt - endedAt);
    rec.said = clip.text;
    results.push(rec);
    console.log(
      `turn ${rec.turn}: "${rec.user}" | transcript ${rec.eos_to_transcript_ms} | token ${rec.eos_to_first_token_ms}` +
        ` | audio ${rec.eos_to_first_audio_ms} (client-side ${rec.client_eos_to_first_audio_ms}) ms | "${rec.reply.slice(0, 60)}"`,
    );
    await untilQuiet();
    await sleep(700);
  }
}

let barge = null;
if (bargeTest) {
  // Ask for something long, let it talk for a bit, then talk over it.
  const story = { pcm: await utterance("Please tell me a long story about a dragon and a lighthouse.", format.sample_rate) };
  firstPcmAt = null;
  flushAt = null;
  const seen = [];
  turnResolve = (m) => seen.push(m);
  await say(story);
  while (firstPcmAt === null) await sleep(10);
  await sleep(900);
  const stillGenerating = seen.length === 0;
  const t0 = performance.now();
  const said = say(bargeClip);
  while (flushAt === null && performance.now() - t0 < 6000) await sleep(5);
  const pcmAfterFlush = () => new Promise((r) => {
    const before = firstPcmAt;
    firstPcmAt = null;
    setTimeout(() => (r(firstPcmAt !== null), (firstPcmAt = before)), 250);
  });
  barge = {
    interrupted_while: stillGenerating ? "still generating audio" : "generation finished, playback only",
    speech_start_to_flush_ms: flushAt === null ? null : Math.round(flushAt - t0),
    audio_arrived_within_250ms_after_flush: flushAt === null ? null : await pcmAfterFlush(),
  };
  firstPcmAt = null;
  await said;
  while (seen.length < 2) await sleep(20);
  const [first, second] = seen;
  barge.interrupted_turn = { turn: first.turn, barged_in: first.barged_in, reply_chars: first.reply.length };
  barge.next_turn = { user: second.user, eos_to_first_audio_ms: second.eos_to_first_audio_ms, reply: second.reply };
  console.log("barge-in:", JSON.stringify(barge, null, 1));
  await untilQuiet();
}

const ok = results.filter((r) => !r.discarded && r.eos_to_first_audio_ms != null);
const stat = (key) => {
  const v = ok.map((r) => r[key]).filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, min: v[0], median: q(0.5), p90: q(0.9), max: v.at(-1) };
};
const keys = [
  "speech_start_to_first_partial_ms", "endpoint_wait_ms", "eos_to_transcript_ms", "eos_to_first_token_ms",
  "eos_to_first_audio_ms", "client_eos_to_first_audio_ms", "eos_to_reply_start_ms", "stt_ms", "stt_model_wall_ms",
  "transcript_to_first_token_ms", "first_token_to_first_piece_ms", "tts_request_to_first_audio_ms",
  "audio_ready_before_endpoint_ms", "endpoint_to_confirm_ms", "vram_peak_mib",
];
const summary = Object.fromEntries(keys.map((k) => [k, stat(k)]));
console.table(summary);
const server = await (await fetch(`http://${base}/metrics`)).json();
const name = process.env.BENCH_NAME ?? `bench-endpoint${server.vad.endpointMs}-spec${server.vad.speculateMs}`;
writeFileSync(
  join(config.root, "runs", `${name}.json`),
  JSON.stringify({ when: new Date().toISOString(), vad: server.vad, vram: server.vram, format, summary, barge, turns: results }, null, 2),
);
console.log(`wrote runs/${name}.json`);
clearInterval(mic);
ws.close();
process.exit(0);
