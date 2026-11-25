// Silero VAD v5 (MIT) on CPU through onnxruntime-node.
// One call per 512-sample frame of 16 kHz audio (32 ms); returns P(speech).

import { join } from "node:path";

import * as ort from "onnxruntime-node";

import { config } from "./config.mjs";

export const VAD_RATE = 16000;
export const VAD_FRAME = 512;
const CONTEXT = 64; // v5 wants the previous frame's last 64 samples prepended

let sessionPromise = null;
function session() {
  sessionPromise ??= ort.InferenceSession.create(join(config.modelsDir, config.vadModel), {
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
  });
  return sessionPromise;
}

export class Vad {
  #state = new ort.Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
  #sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(VAD_RATE)]), []);
  #input = new Float32Array(CONTEXT + VAD_FRAME);

  static async create() {
    await session();
    return new Vad();
  }

  /** @param {Int16Array} frame exactly 512 samples */
  async process(frame) {
    const inp = this.#input;
    inp.copyWithin(0, VAD_FRAME, VAD_FRAME + CONTEXT);
    for (let i = 0; i < VAD_FRAME; i++) inp[CONTEXT + i] = frame[i] / 32768;
    const s = await session();
    const out = await s.run({
      input: new ort.Tensor("float32", inp.slice(), [1, CONTEXT + VAD_FRAME]),
      state: this.#state,
      sr: this.#sr,
    });
    this.#state = out.stateN;
    return out.output.data[0];
  }
}
