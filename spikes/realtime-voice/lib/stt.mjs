// Speech-to-text through audio.cpp's `/v1/audio/transcriptions`, with the
// model loaded in *offline* mode and the utterance-so-far sent as one WAV.
//
// Why not the streaming route (`/v1/audio/transcriptions/live`)? Measured on
// the 0.6.x Windows build: it accepts PCM while the user talks but sends no
// text until the request body ends, then decodes the lot (250-400 ms for a
// 3 s utterance). An offline pass over the same audio takes 15-40 ms, so
// re-decoding the growing buffer is both the faster final transcript and a
// cheap source of partials. `bench/stt-live.mjs` reproduces the comparison.

import http from "node:http";

import { config } from "./config.mjs";
import { sseJson } from "./tts.mjs";

function wav(pcm16) {
  const data = Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Transcribe 16 kHz mono s16 audio. Returns `{ text, wallMs }`. */
export async function transcribe(engine, pcm16, signal) {
  const form = new FormData();
  form.set("model", engine.model);
  form.set("language", config.stt.language);
  form.set("file", new Blob([wav(pcm16)], { type: "audio/wav" }), "utterance.wav");
  const resp = await fetch(`${engine.baseUrl}/v1/audio/transcriptions`, { method: "POST", body: form, signal });
  if (!resp.ok) throw new Error(`STT HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const out = await resp.json();
  return { text: String(out.text ?? "").trim(), wallMs: out.timing?.wall_ms ?? null };
}

/** The audio of one user turn, growing frame by frame. */
export class Utterance {
  #frames = [];
  #samples = 0;

  push(frame) {
    this.#frames.push(frame);
    this.#samples += frame.length;
  }

  get ms() {
    return this.#samples / 16;
  }

  pcm() {
    const out = new Int16Array(this.#samples);
    let off = 0;
    for (const f of this.#frames) {
      out.set(f, off);
      off += f.length;
    }
    return out;
  }
}

/**
 * The streaming route, kept only for `bench/stt-live.mjs`: raw PCM up in a
 * chunked request body, transcript deltas back as SSE on the same connection.
 * Needs the model loaded with `mode: "streaming"`. node:http because fetch's
 * request streaming is half-duplex.
 */
export class LiveSttSession {
  text = "";
  firstDeltaAt = null;
  #req;
  #done;

  constructor(engine, onPartial = () => {}) {
    const q = new URLSearchParams({
      model: engine.model,
      sample_rate: "16000",
      channels: "1",
      sample_format: "s16le",
      language: config.stt.language,
    });
    this.#req = http.request(`${engine.baseUrl}/v1/audio/transcriptions/live?${q}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", accept: "text/event-stream" },
    });
    this.#req.setNoDelay(true);
    this.#req.flushHeaders();
    this.#done = new Promise((resolve, reject) => {
      this.#req.on("error", reject);
      this.#req.on("response", async (res) => {
        try {
          if (res.statusCode !== 200) throw new Error(`STT HTTP ${res.statusCode}`);
          let final = null;
          for await (const msg of sseJson(res)) {
            if (msg.type === "transcript.text.delta" && typeof msg.delta === "string") {
              this.firstDeltaAt ??= performance.now();
              this.text += msg.delta;
              onPartial(this.text);
            } else if (msg.type === "transcript.text.done") {
              final = typeof msg.text === "string" ? msg.text : this.text;
            }
          }
          resolve((final ?? this.text).trim());
        } catch (e) {
          reject(e);
        }
      });
    });
    this.#done.catch(() => {});
  }

  write(frame) {
    this.#req.write(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
  }

  finish() {
    this.#req.end();
    return this.#done;
  }
}
