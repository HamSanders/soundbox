// Client for the live voice worker's socket (live/voice, /ws), with the call token the Mirli server granted.
// Mic in: binary 16 kHz mono s16le, 512-sample frames paced at 32 ms. Out: binary PCM plus JSON events.

import { EventEmitter } from "node:events";
import WebSocket from "ws";

import { FRAME_MS, FRAME_SAMPLES, bytesToInt16 } from "./audio.mjs";

export class LiveSocket extends EventEmitter {
  #ws = null;
  #timer = null;
  #next = 0;
  /**
   * `source()` is called every 32 ms and returns a 512-sample Int16Array, or null for silence.
   * `token` is the call token from POST /api/calls; it rides in the WebSocket subprotocols, as the app sends it.
   */
  constructor(url, source, { token } = {}) {
    super();
    this.url = url;
    this.source = source;
    this.token = token ?? null;
    this.hello = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const protocols = this.token ? ["mirli.v1", `bearer.${this.token}`] : undefined;
      const ws = new WebSocket(this.url, protocols, { headers: { "User-Agent": "mirli-discord" } });
      ws.binaryType = "nodebuffer";
      this.#ws = ws;
      ws.once("unexpected-response", (_q, r) => reject(new Error(`live socket refused: HTTP ${r.statusCode}`)));
      ws.once("error", (e) => { reject(e); this.emit("error", e); });
      ws.on("message", (data, isBinary) => {
        if (isBinary) return this.emit("pcm", data);
        let m; try { m = JSON.parse(data.toString()); } catch { return; }
        if (m.type === "hello") { this.hello = m; this.#start(); resolve(m); }
        this.emit("event", m);
        this.emit(m.type, m);
      });
      ws.on("close", (code) => { this.#stop(); this.emit("close", code); });
    });
  }

  get open() { return this.#ws?.readyState === WebSocket.OPEN; }

  control(msg) { if (this.open) this.#ws.send(JSON.stringify(msg)); }

  #start() {
    const silence = new Int16Array(FRAME_SAMPLES);
    this.#next = Date.now();
    const step = () => {
      if (!this.open) return;
      const frame = this.source() ?? silence;
      this.#ws.send(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength), { binary: true });
      this.#next += FRAME_MS;
      this.#timer = setTimeout(step, Math.max(0, this.#next - Date.now()));
    };
    step();
  }

  #stop() { clearTimeout(this.#timer); this.#timer = null; }

  close() { this.#stop(); this.#ws?.close(); }
}

export { bytesToInt16 };
