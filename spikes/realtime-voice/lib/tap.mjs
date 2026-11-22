// The TTS output, fanned out to anything that wants to follow it (the face
// renderer). See "PCM tap" in the README for the wire format.

import { EventEmitter } from "node:events";

export class PcmTap extends EventEmitter {
  format = { sample_rate: 48000, channels: 1, encoding: "pcm_s16le", chunk_samples: 7680 };
  #parent = null;

  /** A per-call tap passes `parent` (the server-wide tap): it shares its format and forwards everything to it. */
  constructor(parent = null) {
    super();
    if (parent) {
      this.#parent = parent;
      this.format = parent.format;
    }
  }

  get subscribers() { return this.#http.size + this.#ws.size; }
  #samples = 0; // samples emitted since the server started
  #http = new Set();
  #ws = new Set();

  /** Raw PCM over a never-ending chunked HTTP response. */
  addHttp(res) {
    const f = this.format;
    res.writeHead(200, {
      "Content-Type": `audio/L16; rate=${f.sample_rate}; channels=${f.channels}`,
      "X-Sample-Rate": String(f.sample_rate),
      "X-Channels": String(f.channels),
      "X-Encoding": f.encoding,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.flushHeaders();
    this.#http.add(res);
    res.on("close", () => this.#http.delete(res));
  }

  /** Binary PCM frames plus JSON text frames for start / end / flush. */
  addWs(ws) {
    this.#ws.add(ws);
    ws.on("close", () => this.#ws.delete(ws));
    ws.on("error", () => this.#ws.delete(ws));
    ws.send(JSON.stringify({ type: "format", ...this.format }));
  }

  #json(msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.#ws) if (ws.readyState === 1) ws.send(s);
    this.emit(msg.type, msg);
  }

  // Forwarded to the server-wide tap as they are (its own sample_index aside).
  #up(fn) { if (this.#parent) fn(this.#parent); }

  start(meta) {
    this.#up((p) => p.start(meta));
    this.#json({ type: "start", ...meta, sample_index: this.#samples, server_ms: Date.now() });
  }

  pcm(buf) {
    this.#up((p) => p.pcm(buf));
    this.#samples += buf.length / 2 / this.format.channels;
    for (const res of this.#http) res.write(buf);
    for (const ws of this.#ws) if (ws.readyState === 1) ws.send(buf, { binary: true });
    this.emit("pcm", buf);
  }

  end(meta) {
    this.#up((p) => p.end(meta));
    this.#json({ type: "end", ...meta, sample_index: this.#samples });
  }

  /** Barge-in: everything sent and not yet played should be dropped. */
  flush() {
    this.#up((p) => p.flush());
    this.#json({ type: "flush", sample_index: this.#samples, server_ms: Date.now() });
  }
}
