// PCM helpers between Discord (48 kHz stereo) and the Mirli live socket (16 kHz mono in, 48 kHz mono out).

export const MIC_RATE = 16000;
export const FRAME_SAMPLES = 512; // 32 ms at 16 kHz, what the live socket's VAD expects
export const FRAME_MS = 32;

/** 48 kHz interleaved stereo s16 -> 16 kHz mono s16: average the channels, then average each group of 3 samples. */
export function stereo48kToMono16k(stereo) {
  const groups = Math.floor(stereo.length / 6);
  const out = new Int16Array(groups);
  for (let i = 0; i < groups; i++) {
    let sum = 0;
    for (let k = 0; k < 6; k++) sum += stereo[i * 6 + k];
    out[i] = Math.round(sum / 6);
  }
  return out;
}

/** 48 kHz mono s16le bytes -> 48 kHz stereo s16le bytes (what Discord's raw input wants). */
export function mono48kToStereoBytes(monoBytes) {
  const n = Math.floor(monoBytes.length / 2);
  const out = Buffer.allocUnsafe(n * 4);
  for (let i = 0; i < n; i++) {
    const lo = monoBytes[i * 2];
    const hi = monoBytes[i * 2 + 1];
    out[i * 4] = lo; out[i * 4 + 1] = hi; out[i * 4 + 2] = lo; out[i * 4 + 3] = hi;
  }
  return out;
}

/** Bytes from a socket can sit at any offset; copy before viewing them as Int16. */
export function bytesToInt16(buf) {
  const n = Math.floor(buf.length / 2);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

/** A queue of mono samples that hands out fixed-size frames. */
export class SampleQueue {
  #chunks = [];
  #length = 0;
  constructor(maxSamples = MIC_RATE) { this.max = maxSamples; }
  get length() { return this.#length; }
  push(samples) {
    this.#chunks.push(samples);
    this.#length += samples.length;
    // Keep latency bounded: if we fall a second behind, drop the oldest audio.
    while (this.#length > this.max && this.#chunks.length > 1) this.#length -= this.#chunks.shift().length;
  }
  /** Exactly `size` samples, or null if fewer are queued. */
  take(size) {
    if (this.#length < size) return null;
    const out = new Int16Array(size);
    let filled = 0;
    while (filled < size) {
      const head = this.#chunks[0];
      const need = size - filled;
      if (head.length <= need) { out.set(head, filled); filled += head.length; this.#chunks.shift(); }
      else { out.set(head.subarray(0, need), filled); filled += need; this.#chunks[0] = head.subarray(need); }
    }
    this.#length -= size;
    return out;
  }
  /** Whatever is left, zero-padded to `size` (used when a speaker lets go of the floor). */
  drainPadded(size) {
    if (this.#length === 0) return null;
    const out = new Int16Array(size);
    let at = 0;
    for (const c of this.#chunks) { const room = size - at; if (room <= 0) break; out.set(c.subarray(0, room), at); at += Math.min(c.length, room); }
    this.#chunks = []; this.#length = 0;
    return out;
  }
  clear() { this.#chunks = []; this.#length = 0; }
}
