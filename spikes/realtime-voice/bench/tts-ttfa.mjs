// Step 1: does the TTS really stream, and how long to the first audio?
// Starts only the TTS engine. `node bench/tts-ttfa.mjs [runs]`

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "../lib/config.mjs";
import { startAudiocpp, stopEngines } from "../lib/engines.mjs";
import { GpuMeter } from "../lib/gpu.mjs";
import { probeSampleRate, speak } from "../lib/tts.mjs";

const LINES = [
  ["short", "Sure, I can help."],
  ["sentence", "That sounds like a lovely way to spend the afternoon."],
  ["long", "I was thinking about what you said earlier, and honestly, the more I turn it over, the more I think you were right to take the slower road through the hills."],
];
const runs = Number(process.argv[2] ?? 5);
const gpu = new GpuMeter();
await gpu.start();
const baseline = gpu.current;

const t0 = Date.now();
const engine = await startAudiocpp("tts");
console.log(`engine up (model loaded) in ${Date.now() - t0} ms; VRAM ${baseline} -> ${gpu.current} MiB`);
const fmt = await probeSampleRate(engine);
console.log("format", fmt);

const rows = [];
async function one(label, text, tag) {
  const start = performance.now();
  let first = null;
  let bytes = 0;
  const sizes = [];
  const gaps = [];
  let last = start;
  let modelTtft = null;
  for await (const ev of speak(engine, text)) {
    if (ev.pcm) {
      const now = performance.now();
      if (first === null) first = now - start;
      else gaps.push(now - last);
      last = now;
      bytes += ev.pcm.length;
      sizes.push(ev.pcm.length / 2);
    } else if (ev.done) modelTtft = ev.modelTtftMs;
  }
  const total = performance.now() - start;
  const audioS = bytes / 2 / fmt.sampleRate;
  const row = {
    tag, label, chars: text.length, ttfa_ms: Math.round(first), model_ttft_ms: modelTtft,
    total_ms: Math.round(total), audio_s: +audioS.toFixed(2), rtf: +(total / 1000 / audioS).toFixed(3),
    chunks: sizes.length, chunk_samples: mode(sizes), max_gap_ms: Math.round(Math.max(0, ...gaps)),
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
function mode(xs) {
  const c = new Map();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

await one("short", LINES[0][1], "first-after-load");
for (let i = 0; i < runs; i++) for (const [label, text] of LINES) await one(label, text, "warm");

// Does aborting mid-line free the model, or does the next line wait it out?
const ac = new AbortController();
let n = 0;
const tAbort = performance.now();
try {
  for await (const ev of speak(engine, LINES[2][1], ac.signal)) if (ev.pcm && ++n === 3) ac.abort();
} catch {}
const afterAbort = performance.now();
await one("short", LINES[0][1], "after-abort");
console.log(`abort after 3 chunks at ${Math.round(afterAbort - tAbort)} ms; next line's ttfa is the 'after-abort' row`);

const peak = gpu.peak;
gpu.stop();
const out = { when: new Date().toISOString(), model: config.tts.weights, format: fmt, vram_mib: { baseline, peak, used: peak - baseline }, rows };
writeFileSync(join(config.root, "runs", "tts-ttfa.json"), JSON.stringify(out, null, 2));
console.log(`VRAM baseline ${baseline} MiB, peak ${peak} MiB`);
stopEngines();
process.exit(0);
