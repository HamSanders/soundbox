// A call with no voice picked still needs one steady voice. VoxCPM2 with no
// reference clip invents a speaker per request, and a reply is spoken one
// sentence per request, so the voice would change mid-reply. The first sentence
// of the call is saved as a WAV and used as the reference from then on.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

/** Shorter than this and VoxCPM2 has too little to clone from. */
const MIN_SECONDS = 1;

/** A mono s16le WAV around `pcm`. */
export function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * @param dir where the clips go (cleared of this worker's clips on drop)
 * @param rate () => the TTS sample rate, known once the engine is up
 */
export function voiceLock(dir, rate) {
  return {
    /** Saves `pcm` as a clip and returns its path, or "" when it's too short. */
    save(pcm) {
      const r = rate();
      if (!r || pcm.length < r * 2 * MIN_SECONDS) return "";
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${randomBytes(6).toString("hex")}.wav`);
      writeFileSync(path, wav(pcm, r));
      return path;
    },
    drop(path) {
      rmSync(path, { force: true });
    },
  };
}
