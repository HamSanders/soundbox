// Plays queued Float32 chunks at the context rate (the page creates the
// context at the TTS rate, so there is no resampling). "flush" empties the
// queue at once: that is what makes barge-in feel instant.
class Playback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.off = 0;
    this.playing = false;
    this.port.onmessage = (e) => {
      if (e.data === "flush") {
        this.queue = [];
        this.off = 0;
      } else this.queue.push(new Float32Array(e.data));
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    let i = 0;
    while (i < out.length && this.queue.length) {
      const head = this.queue[0];
      const n = Math.min(out.length - i, head.length - this.off);
      out.set(head.subarray(this.off, this.off + n), i);
      i += n;
      this.off += n;
      if (this.off >= head.length) {
        this.queue.shift();
        this.off = 0;
      }
    }
    const playing = i > 0;
    if (playing !== this.playing) {
      this.playing = playing;
      this.port.postMessage({ playing, at: currentTime });
    }
    return true;
  }
}
registerProcessor("playback", Playback);
