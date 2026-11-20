// Why the spike transcribes offline: compares audio.cpp's streaming route
// (`/v1/audio/transcriptions/live`, model in streaming mode) with an offline
// pass over the same audio, both fed at real-time pace.
//
// Needs the main server running (it borrows its TTS to make the test clip and
// its offline STT). Starts one extra STT engine in streaming mode.
//   node bench/stt-live.mjs

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "../lib/config.mjs";
import { startAudiocpp, stopEngines } from "../lib/engines.mjs";
import { LiveSttSession, transcribe } from "../lib/stt.mjs";
import { speak } from "../lib/tts.mjs";

const tts = { baseUrl: `http://127.0.0.1:${config.ttsPort}`, model: config.tts.id };
const offline = { baseUrl: `http://127.0.0.1:${config.sttPort}`, model: config.stt.id };
const live = await startAudiocpp("stt", { id: "nemotron-stream", mode: "streaming", port: config.sttPort + 7 });

const LINES = [
  "What should I cook for dinner tonight?",
  "I was thinking about what you said earlier, and honestly, the more I turn it over, the more I think you were right to take the slower road through the hills.",
];
const rows = [];
for (const text of LINES) {
  const parts = [];
  for await (const ev of speak(tts, text)) if (ev.pcm) parts.push(ev.pcm);
  const buf = Buffer.concat(parts);
  const src = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const pcm = new Int16Array(Math.floor(src.length / 3)); // 48 kHz -> 16 kHz
  for (let i = 0; i < pcm.length; i++) pcm[i] = (src[3 * i] + src[3 * i + 1] + src[3 * i + 2]) / 3;
  const audioMs = pcm.length / 16;

  for (let rep = 0; rep < 3; rep++) {
    const t0 = performance.now();
    const s = new LiveSttSession(live);
    for (let off = 0; off < pcm.length; off += 512) {
      s.write(pcm.slice(off, off + 512));
      const due = t0 + (off + 512) / 16;
      await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
    }
    const bodyEnd = performance.now();
    const liveText = await s.finish();
    const liveDone = performance.now();
    const off = await transcribe(offline, pcm);
    const offDone = performance.now();
    const row = {
      audio_ms: Math.round(audioMs),
      live_first_delta_after_speech_start_ms: s.firstDeltaAt === null ? null : Math.round(s.firstDeltaAt - t0),
      live_first_delta_relative_to_body_end_ms: s.firstDeltaAt === null ? null : Math.round(s.firstDeltaAt - bodyEnd),
      live_final_after_body_end_ms: Math.round(liveDone - bodyEnd),
      offline_final_ms: Math.round(offDone - liveDone),
      live_text: liveText,
      offline_text: off.text,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
writeFileSync(join(config.root, "runs", "stt-live-vs-offline.json"), JSON.stringify({ when: new Date().toISOString(), rows }, null, 2));
stopEngines();
process.exit(0);
