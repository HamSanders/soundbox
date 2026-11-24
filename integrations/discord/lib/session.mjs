// One call: Discord users' audio in, the character's audio out. No Discord imports here, so it can be tested.
//   out: { write(stereo48kBytes), flush() }   (the bot backs it with an AudioPlayer)

import { FRAME_SAMPLES, SampleQueue, mono48kToStereoBytes, stereo48kToMono16k } from "./audio.mjs";

export class CallSession {
  #queue = new SampleQueue();
  #playing = false;

  constructor({ live, floor, out }) {
    this.live = live;
    this.floor = floor;
    this.out = out;
    live.on("pcm", (bytes) => {
      out.write(mono48kToStereoBytes(bytes));
      this.#setPlaying(true);
    });
    live.on("flush", () => {
      out.flush();
      this.#setPlaying(false);
    });
  }

  /** Decoded audio from one user: 48 kHz interleaved stereo s16. */
  onUserAudio(userId, stereo) {
    if (this.floor.hear(userId)) this.#queue.push(stereo48kToMono16k(stereo));
  }

  /** Called every 32 ms by the socket: the next mic frame, or null for silence. */
  source = () => {
    if (this.floor.tick() !== null) return this.#queue.drainPadded(FRAME_SAMPLES);
    return this.#queue.take(FRAME_SAMPLES);
  };

  /** The player ran dry: whatever was playing has been heard. */
  playbackEnded() {
    this.#setPlaying(false);
  }

  #setPlaying(playing) {
    if (playing === this.#playing) return;
    this.#playing = playing;
    this.live.control({ type: "playback", playing });
  }
}
