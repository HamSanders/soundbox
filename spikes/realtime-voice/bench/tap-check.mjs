// Example subscriber for the PCM tap, and a check that both transports carry
// the same audio. Run it, then have a conversation (or run bench/turns.mjs).
//   node bench/tap-check.mjs [seconds]

import WebSocket from "ws";

import { config } from "../lib/config.mjs";

const seconds = Number(process.argv[2] ?? 30);
const base = `127.0.0.1:${config.port}`;
const ws = new WebSocket(`ws://${base}/tap`);
const stats = { ws_bytes: 0, ws_chunks: 0, http_bytes: 0, starts: 0, ends: 0, flushes: 0, chunk_bytes: new Set() };
let format = null;

ws.on("message", (data, isBinary) => {
  if (isBinary) {
    stats.ws_bytes += data.length;
    stats.ws_chunks++;
    stats.chunk_bytes.add(data.length);
    return;
  }
  const m = JSON.parse(data.toString());
  if (m.type === "format") format = m;
  else if (m.type === "start") stats.starts++;
  else if (m.type === "end") stats.ends++;
  else if (m.type === "flush") stats.flushes++;
  if (m.type !== "format") console.log(JSON.stringify(m));
});

const ac = new AbortController();
const resp = await fetch(`http://${base}/tts.pcm`, { signal: ac.signal });
console.log("http headers:", resp.headers.get("content-type"), "| X-Sample-Rate", resp.headers.get("x-sample-rate"));
(async () => {
  try {
    for await (const chunk of resp.body) stats.http_bytes += chunk.length;
  } catch {}
})();

setTimeout(() => {
  ac.abort();
  ws.close();
  const secs = format ? stats.ws_bytes / 2 / format.channels / format.sample_rate : 0;
  console.log("format:", JSON.stringify(format));
  console.log(JSON.stringify({ ...stats, chunk_bytes: [...stats.chunk_bytes], audio_s: +secs.toFixed(2), transports_match: stats.ws_bytes === stats.http_bytes }));
  process.exit(0);
}, seconds * 1000);
