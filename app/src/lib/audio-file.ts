/**
 * Turn whatever audio the user hands us into the WAV the server expects.
 *
 * `POST /api/voices/upload` decodes with `wavefile`, which reads WAV and
 * nothing else, and Konchi does not bundle ffmpeg — so the server cannot be
 * taught m4a without a new dependency the user would have to install. The
 * browser already ships a decoder for every format it can play (m4a/aac, mp3,
 * ogg, opus, flac, and the webm the recorder produces), so the conversion
 * happens here instead: decode with Web Audio, re-encode as PCM, upload that.
 *
 * WAV files are passed through untouched rather than round-tripped, so a
 * 24-bit or float clip keeps its depth instead of being quietly flattened to
 * 16-bit on its way in.
 */

/** What the file picker offers. `audio/*` is the real filter — the extension
 *  list is for platforms that match on suffix and would otherwise grey out
 *  perfectly valid files. */
export const AUDIO_ACCEPT =
  "audio/*,.wav,.m4a,.mp4,.aac,.mp3,.ogg,.oga,.opus,.flac,.webm";

/** Every extension AUDIO_ACCEPT admits, for stripping a display name. */
const EXT_RE = /\.(wav|wave|m4a|mp4|aac|mp3|ogg|oga|opus|flac|webm)$/i;

/** A picked file's name with its extension removed, for prefilling a form. */
export function stemOf(filename: string): string {
  return filename.replace(EXT_RE, "");
}

function isWav(blob: Blob, filename?: string): boolean {
  if (/^audio\/(x-)?wave?$/i.test(blob.type)) return true;
  // Some pickers hand back an empty type; fall back to the name.
  return !blob.type && /\.wave?$/i.test(filename ?? "");
}

/**
 * Decode `blob` and re-encode it as a 16-bit PCM WAV.
 *
 * Throws a message worth showing the user — the browser's own decode failure
 * is a bare `EncodingError` with no detail, which tells nobody anything.
 */
export async function toWav(blob: Blob, filename?: string): Promise<Blob> {
  if (isWav(blob, filename)) return blob;

  const bytes = await blob.arrayBuffer();
  // Constructed per call and closed after: a page that opens the dialog
  // repeatedly would otherwise pile up contexts, and browsers cap how many
  // can exist at once.
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } catch {
    throw new Error(
      "That file couldn't be decoded as audio. Try a WAV, MP3 or M4A.",
    );
  } finally {
    void ctx.close();
  }
  return encodeWav(decoded);
}

/**
 * Interleave an AudioBuffer into a 16-bit PCM WAV.
 *
 * 16-bit is what the reference clip is used for — a few seconds of speech fed
 * to a cloning model — so the extra depth of float32 buys nothing and doubles
 * the upload against the server's 64 MB cap.
 */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;

  const out = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(out);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // format: uncompressed PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  // Read each channel once rather than per frame: getChannelData copies on
  // some engines, and doing that inside the sample loop is the difference
  // between instant and visibly slow on a long clip.
  const source: Float32Array[] = [];
  for (let c = 0; c < channels; c++) source.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      // Clamped before scaling: decoded audio can exceed ±1, and letting it
      // wrap turns a hot clip into a burst of noise instead of clipping.
      const sample = Math.max(-1, Math.min(1, source[c]![i]!));
      view.setInt16(offset, Math.round(sample * 0x7fff), true);
      offset += bytesPerSample;
    }
  }
  return new Blob([out], { type: "audio/wav" });
}
