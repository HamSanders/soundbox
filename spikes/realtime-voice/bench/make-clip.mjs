// dev helper: synthesize a line and write it as raw 16 kHz s16le
import { writeFileSync } from "node:fs";
import { config } from "../lib/config.mjs";
import { speak } from "../lib/tts.mjs";
const tts = { baseUrl: `http://127.0.0.1:${config.ttsPort}`, model: config.tts.id };
const parts = [];
for await (const ev of speak(tts, process.argv[3])) if (ev.pcm) parts.push(ev.pcm);
const buf = Buffer.concat(parts);
const src = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
const out = new Int16Array(Math.floor(src.length / 3));
for (let i = 0; i < out.length; i++) out[i] = (src[3 * i] + src[3 * i + 1] + src[3 * i + 2]) / 3;
writeFileSync(process.argv[2], Buffer.from(out.buffer));
