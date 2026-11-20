/**
 * Audiobook encoders: WAV in-process, MP3 / FLAC / M4B through ffmpeg.
 *
 * ffmpeg is optional (the desktop app does not bundle it), the same as for
 * `transcodeMp3` in dsp.ts: its absence is a normal state that the API and UI
 * report, not a crash. Everything that decides *what* ffmpeg is asked to do
 * (arguments, tags, the FFMETADATA chapter file, file names) is a pure
 * function here, so the tests check it without ffmpeg installed; only
 * `runFfmpeg` and `detectFfmpeg` touch a process.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Audio } from "./dsp.js";
import { ditherTo16 } from "./master.js";
import type { ExportFormat } from "../audiobook/types.js";

/* ---------------------------------------------------------------- ffmpeg */

export interface FfmpegInfo {
  available: boolean;
  version: string | null;
  /** Encoders this build has, of the ones exports need. */
  encoders: { mp3: boolean; aac: boolean; flac: boolean };
  /** Shown to the user when something is missing. */
  message: string | null;
}

export const FFMPEG_MISSING =
  "ffmpeg was not found on PATH. WAV export works without it; MP3, FLAC and M4B need it. " +
  "Install ffmpeg (https://ffmpeg.org/download.html) and restart Mirli.";

/** Which formats need ffmpeg, and which encoder each one uses. */
export const FORMAT_ENCODER: Record<ExportFormat, keyof FfmpegInfo["encoders"] | null> = {
  wav: null,
  mp3: "mp3",
  flac: "flac",
  m4b: "aac",
};

function capture(args: string[], timeoutMs = 10_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn("ffmpeg", args, { windowsHide: true });
    } catch {
      resolve({ code: null, out: "" });
      return;
    }
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stdout?.on("data", (b: Buffer) => (out += b.toString()));
    proc.stderr?.on("data", (b: Buffer) => (out += b.toString()));
    // ENOENT: ffmpeg is not on PATH.
    proc.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, out });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** Parse `ffmpeg -version` and `ffmpeg -encoders` output. Pure. */
export function parseFfmpegInfo(versionOut: string | null, encodersOut: string): FfmpegInfo {
  if (versionOut === null) {
    return { available: false, version: null, encoders: { mp3: false, aac: false, flac: false }, message: FFMPEG_MISSING };
  }
  const version = /ffmpeg version (\S+)/.exec(versionOut)?.[1] ?? "unknown";
  const has = (name: string) => new RegExp(`^\\s*A\\S*\\s+${name}\\b`, "m").test(encodersOut);
  const encoders = { mp3: has("libmp3lame"), aac: has("aac") || has("libfdk_aac"), flac: has("flac") };
  const missing = Object.entries(encoders).filter(([, ok]) => !ok).map(([k]) => k);
  return {
    available: true,
    version,
    encoders,
    message: missing.length ? `This ffmpeg build lacks the ${missing.join(", ")} encoder(s).` : null,
  };
}

let cached: Promise<FfmpegInfo> | null = null;

/** Probe ffmpeg once per process. `refresh` re-probes (after an install). */
export function detectFfmpeg(refresh = false): Promise<FfmpegInfo> {
  if (!cached || refresh) {
    cached = (async () => {
      const v = await capture(["-hide_banner", "-version"]);
      if (v.code !== 0) return parseFfmpegInfo(null, "");
      const e = await capture(["-hide_banner", "-encoders"]);
      return parseFfmpegInfo(v.out, e.out);
    })();
  }
  return cached;
}

/** Can this format be written with what is installed? Null when yes. */
export function formatUnavailable(format: ExportFormat, info: FfmpegInfo): string | null {
  const encoder = FORMAT_ENCODER[format];
  if (encoder === null) return null;
  if (!info.available) return FFMPEG_MISSING;
  if (!info.encoders[encoder]) return `The installed ffmpeg has no ${encoder} encoder, which ${format.toUpperCase()} needs.`;
  return null;
}

export const ENCODE_TIMEOUT_MS = 30 * 60_000;

/** Run ffmpeg. Resolves with ok=false (never throws) on absence or failure. */
export async function runFfmpeg(args: string[], timeoutMs = ENCODE_TIMEOUT_MS): Promise<{ ok: boolean; error: string }> {
  const r = await capture(args, timeoutMs);
  if (r.code === 0) return { ok: true, error: "" };
  if (r.code === null && r.out === "") return { ok: false, error: FFMPEG_MISSING };
  return { ok: false, error: r.out.trim().split("\n").slice(-4).join("\n") || `ffmpeg exited with ${r.code}` };
}

/* ------------------------------------------------------------------ tags */

export interface AudiobookTags {
  title: string;
  /** Book title: the album every chapter file belongs to. */
  album: string;
  author: string | null;
  narrator: string | null;
  track?: number;
  totalTracks?: number;
  year?: string | null;
  genre?: string | null;
  comment?: string | null;
  publisher?: string | null;
  language?: string | null;
}

/**
 * ffmpeg `-metadata` keys. ffmpeg maps these generic keys onto ID3v2 frames
 * (title TIT2, album TALB, artist TPE1, album_artist TPE2, composer TCOM,
 * track TRCK, date TDRC, genre TCON) and onto the MP4 atoms for M4B.
 * Narrator goes in composer, the field audiobook players such as Apple
 * Books and Audiobookshelf read it from by convention; it is also spelled out
 * in the comment.
 */
export function tagMetadata(t: AudiobookTags): Record<string, string> {
  const out: Record<string, string> = { title: t.title, album: t.album, genre: t.genre ?? "Audiobook" };
  if (t.author) {
    out.artist = t.author;
    out.album_artist = t.author;
  }
  if (t.narrator) out.composer = t.narrator;
  if (t.track !== undefined) out.track = t.totalTracks ? `${t.track}/${t.totalTracks}` : String(t.track);
  if (t.year) out.date = t.year;
  if (t.publisher) out.publisher = t.publisher;
  if (t.language) out.language = t.language;
  const comment = t.comment ?? (t.narrator ? `Narrated by ${t.narrator}` : null);
  if (comment) out.comment = comment;
  return out;
}

/* --------------------------------------------------------- FFMETADATA1 */

/** FFMETADATA escaping: `=`, `;`, `#`, `\` and newline take a backslash. */
export function escapeMeta(value: string): string {
  return value.replace(/[\\=;#\n]/g, (c) => `\\${c}`);
}

export interface ChapterMark {
  title: string;
  start_s: number;
  end_s: number;
}

/**
 * The FFMETADATA1 file ffmpeg reads chapters and global tags from
 * (https://ffmpeg.org/ffmpeg-formats.html#Metadata-1). Times are in ms.
 */
export function ffmetadata(tags: Record<string, string>, chapters: ChapterMark[]): string {
  const lines = [";FFMETADATA1"];
  for (const [k, v] of Object.entries(tags)) lines.push(`${k}=${escapeMeta(v)}`);
  for (const c of chapters) {
    lines.push(
      "",
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${Math.round(c.start_s * 1000)}`,
      `END=${Math.round(c.end_s * 1000)}`,
      `title=${escapeMeta(c.title)}`,
    );
  }
  return lines.join("\n") + "\n";
}

/* ------------------------------------------------------------------ args */

export interface EncodeJob {
  format: Exclude<ExportFormat, "wav">;
  input: string;
  output: string;
  /** MP3/M4B bitrate. ACX wants 192 kbps CBR MP3. */
  bitrateKbps?: number;
  tags: Record<string, string>;
  /** FFMETADATA file with chapters (M4B). */
  metadataFile?: string | null;
  cover?: string | null;
}

export const DEFAULT_BITRATE: Record<"mp3" | "m4b", number> = { mp3: 192, m4b: 128 };

/** ffmpeg arguments for one encode. Pure. */
export function buildEncodeArgs(job: EncodeJob): string[] {
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", job.input];
  let next = 1;
  const metaIndex = job.metadataFile ? next++ : null;
  if (job.metadataFile) args.push("-f", "ffmetadata", "-i", job.metadataFile);
  const coverIndex = job.cover ? next++ : null;
  if (job.cover) args.push("-i", job.cover);

  args.push("-map", "0:a");
  if (coverIndex !== null) args.push("-map", `${coverIndex}:v`);
  if (metaIndex !== null) args.push("-map_metadata", String(metaIndex), "-map_chapters", String(metaIndex));
  else args.push("-map_metadata", "-1");

  switch (job.format) {
    case "mp3": {
      const kbps = job.bitrateKbps ?? DEFAULT_BITRATE.mp3;
      // -b:a with libmp3lame is constant bitrate; ACX rejects VBR.
      args.push("-c:a", "libmp3lame", "-b:a", `${kbps}k`, "-ar", "44100", "-id3v2_version", "3");
      if (coverIndex !== null) {
        args.push("-c:v", "copy", "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)");
      }
      break;
    }
    case "flac":
      args.push("-c:a", "flac", "-sample_fmt", "s16");
      if (coverIndex !== null) args.push("-c:v", "copy", "-disposition:v", "attached_pic");
      break;
    case "m4b": {
      const kbps = job.bitrateKbps ?? DEFAULT_BITRATE.m4b;
      args.push("-c:a", "aac", "-b:a", `${kbps}k`, "-ar", "44100");
      if (coverIndex !== null) args.push("-c:v", "copy", "-disposition:v", "attached_pic");
      args.push("-movflags", "+faststart");
      break;
    }
  }
  for (const [k, v] of Object.entries(job.tags)) args.push("-metadata", `${k}=${v}`);
  if (job.format === "m4b") args.push("-f", "mp4");
  args.push(job.output);
  return args;
}

/* ------------------------------------------------------------- file names */

/**
 * ACX file naming: section number first, then the title, using only
 * letters, digits, spaces, dash and underscore ("00_Opening Credits",
 * "01_Chapter One"), per ACX's file-management guidance (research §8).
 * Spaces are kept because ACX's own examples use them.
 */
export function acxFileName(index: number, title: string, ext: string): string {
  const clean = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return `${String(index).padStart(2, "0")}_${clean || "Section"}.${ext}`;
}

/* -------------------------------------------------------------- WAV 16 */

/** 16-bit PCM WAV bytes, TPDF-dithered. Written without wavefile. */
export function wav16Bytes(audio: Audio, sampleRate: number): Buffer {
  const pcm = ditherTo16(audio);
  const channels = pcm.length;
  const frames = channels ? pcm[0].length : 0;
  const dataBytes = frames * channels * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      buf.writeInt16LE(pcm[c][i], o);
      o += 2;
    }
  }
  return buf;
}

export function writeWav16(path: string, audio: Audio, sampleRate: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, wav16Bytes(audio, sampleRate));
}
