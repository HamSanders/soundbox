// Shared by the gen-*-tracks.mjs / gen-sfx-samples.ts renderers: the site
// ships MP3, not the WAV Konchi writes, so each render is encoded before it
// lands in site/public. VBR quality 2 (~190 kb/s), sample rate and channel
// count left as rendered. Needs `ffmpeg` with libmp3lame on PATH.

import { spawn } from "node:child_process";

/** @param {Buffer} wav @returns {Promise<Buffer>} */
export function wavToMp3(wav) {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      ["-v", "error", "-i", "pipe:0", "-map_metadata", "-1", "-c:a", "libmp3lame", "-q:a", "2", "-f", "mp3", "pipe:1"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const out = [];
    let err = "";
    ff.stdout.on("data", (c) => out.push(c));
    ff.stderr.on("data", (c) => (err += c));
    ff.on("error", (e) => reject(new Error(`ffmpeg not runnable (is it on PATH?): ${e.message}`)));
    ff.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`)),
    );
    ff.stdin.end(wav);
  });
}
