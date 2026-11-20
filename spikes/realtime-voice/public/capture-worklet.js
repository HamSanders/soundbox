// Mic -> 16 kHz mono s16le, posted in 512-sample frames (32 ms).
// Box-filter downsample from the context rate; crude but enough for ASR.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0;
    this.n = 0;
    this.pos = 0;
    this.out = new Int16Array(512);
    this.fill = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.n++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.n));
        this.out[this.fill++] = v * 32767;
        this.acc = 0;
        this.n = 0;
        if (this.fill === 512) {
          this.port.postMessage(this.out.buffer.slice(0));
          this.fill = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("capture", Capture);
