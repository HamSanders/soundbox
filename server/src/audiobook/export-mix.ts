/**
 * The story mixdown as a plan plus a pure renderer, so the expensive half can
 * run on the export worker.
 *
 * `MirliService.planMix` reads the database: which clips are audible, their
 * files, trims, gains, fades and crossfades, and which lanes are beds and how
 * they duck. `renderMixLanes` then does the file reading and DSP with no
 * database at all. `MirliService.mixStory` (and through it `exportStory`)
 * runs both in-process; audiobook export runs the renderer on the worker.
 *
 * Reading clips was the slow part: wavefile's float conversion took about a
 * quarter of a second per 9-second clip, a minute and a half for an hour-long
 * chapter. `readWavFast` decodes plain PCM and float WAV directly, with the
 * same scaling wavefile uses (checked sample for sample in the tests), and
 * hands anything else to wavefile.
 */

import { readFileSync } from "node:fs";

import { type DuckOptions, applyDucking } from "../audio/duck.js";
import * as dsp from "../audio/dsp.js";

/** One audible clip, everything the renderer needs to place it. */
export interface PlannedClip {
  path: string;
  start_s: number;
  lane: number;
  /** Seconds into the source where the clip starts. */
  trim_start_s: number;
  /** Seconds the clip plays, or null for the rest of the file. */
  length_s: number | null;
  fade_in_s: number;
  fade_out_s: number;
  /** Clip gain plus track gain. */
  gain_db: number;
}

export interface MixPlan {
  clips: PlannedClip[];
  /** Bed lanes and their ducking (null = not ducked). Empty when the story
   *  is not an audiobook chapter or has no beds. */
  beds: [lane: number, duck: DuckOptions | null][];
  includeBeds: boolean;
}

/* ------------------------------------------------------------- decoding */

/**
 * Decode a WAV file to channels-first float32, scaled like wavefile's
 * `toBitDepth("32f")`: negative integers over 2^(n-1), positive over
 * 2^(n-1) - 1. Handles 8/16/24/32-bit PCM and 32/64-bit float, plain or
 * WAVE_FORMAT_EXTENSIBLE; anything else goes to `dsp.decodeWav`.
 */
export function decodeWavFast(bytes: Buffer): { audio: dsp.Audio; sampleRate: number } {
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    return dsp.decodeWav(bytes);
  }
  let o = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: { start: number; size: number } | null = null;
  while (o + 8 <= bytes.length) {
    const id = bytes.toString("ascii", o, o + 4);
    const size = bytes.readUInt32LE(o + 4);
    const body = o + 8;
    if (id === "fmt ") {
      let format = bytes.readUInt16LE(body);
      if (format === 0xfffe && size >= 26) format = bytes.readUInt16LE(body + 24);
      fmt = {
        format,
        channels: bytes.readUInt16LE(body + 2),
        rate: bytes.readUInt32LE(body + 4),
        bits: bytes.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = { start: body, size: Math.min(size, bytes.length - body) };
      break;
    }
    o = body + size + (size & 1);
  }
  if (!fmt || !data) return dsp.decodeWav(bytes);
  const { format, channels, bits } = fmt;
  const width = bits / 8;
  const known = (format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && (bits === 32 || bits === 64));
  if (!known || channels < 1) return dsp.decodeWav(bytes);
  const frames = Math.floor(data.size / (width * channels));
  const audio: dsp.Audio = Array.from({ length: channels }, () => new Float32Array(frames));
  let p = data.start;
  const half = 2 ** (bits - 1);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      let v: number;
      if (format === 3) v = bits === 32 ? bytes.readFloatLE(p) : bytes.readDoubleLE(p);
      else if (bits === 8) {
        const u = bytes[p] - 128;
        v = u < 0 ? u / 128 : u / 127;
      } else {
        const n = bits === 16 ? bytes.readInt16LE(p) : bits === 24 ? bytes.readIntLE(p, 3) : bytes.readInt32LE(p);
        v = n < 0 ? n / half : n / (half - 1);
      }
      audio[c][i] = v;
      p += width;
    }
  }
  return { audio, sampleRate: fmt.rate };
}

export function readWavFast(path: string): { audio: dsp.Audio; sampleRate: number } {
  return decodeWavFast(readFileSync(path));
}

/* ---------------------------------------------------------------- lanes */

/**
 * Lay placed clips into one buffer per track, every lane the same length and
 * channel count, unclipped.
 */
export function layLanes(
  placed: { audio: dsp.Audio; startS: number; lane: number }[],
  sampleRate: number,
): Map<number, dsp.Audio> {
  const present = placed.filter((c) => c.audio.length > 0 && dsp.frameCount(c.audio) > 0);
  const lanes = new Map<number, dsp.Audio>();
  if (present.length === 0) return lanes;
  const channels = Math.max(...present.map((c) => c.audio.length));
  const offsets = present.map((c) => Math.max(0, Math.round(c.startS * sampleRate)));
  const total = Math.max(...present.map((c, i) => offsets[i] + dsp.frameCount(c.audio)));
  present.forEach((c, i) => {
    let lane = lanes.get(c.lane);
    if (!lane) {
      lane = Array.from({ length: channels }, () => new Float32Array(total));
      lanes.set(c.lane, lane);
    }
    const frames = dsp.frameCount(c.audio);
    for (let ch = 0; ch < channels; ch++) {
      // Mono into stereo duplicates channel 0, as mixTimeline does.
      const src = c.audio[Math.min(ch, c.audio.length - 1)];
      const dst = lane[ch];
      for (let f = 0; f < frames; f++) dst[offsets[i] + f] += src[f];
    }
  });
  return lanes;
}

/** Sum lane buffers in track order and clip, as `mixTimeline` does. */
export function sumLanes(lanes: Map<number, dsp.Audio>): dsp.Audio {
  const list = [...lanes.entries()].sort((a, b) => a[0] - b[0]).map(([, a]) => a);
  if (list.length === 0) return [new Float32Array(0)];
  const channels = Math.max(...list.map((a) => a.length));
  const frames = Math.max(...list.map((a) => dsp.frameCount(a)));
  const out: dsp.Audio = Array.from({ length: channels }, () => new Float32Array(frames));
  for (const lane of list) {
    for (let ch = 0; ch < channels; ch++) {
      const src = lane[Math.min(ch, lane.length - 1)];
      const dst = out[ch];
      for (let f = 0; f < src.length; f++) dst[f] += src[f];
    }
  }
  return dsp.clip(out);
}

/**
 * Duck bed lanes under lane 0, or drop them. The same rule as soundscape's
 * `BedService.duckChapterLanes`, taking the bed list as data so it can run
 * without the database.
 */
export function duckLanes(
  lanes: Map<number, dsp.Audio>,
  beds: MixPlan["beds"],
  sampleRate: number,
  includeBeds: boolean,
): Map<number, dsp.Audio> {
  if (beds.length === 0) return lanes;
  const bedMap = new Map(beds);
  const narration = lanes.get(0) ?? [new Float32Array(0)];
  const out = new Map<number, dsp.Audio>();
  for (const [lane, audio] of lanes) {
    if (!bedMap.has(lane)) {
      out.set(lane, audio);
      continue;
    }
    if (!includeBeds) continue;
    const duck = bedMap.get(lane);
    out.set(lane, duck ? applyDucking(audio, narration, { ...duck, sampleRate }) : audio);
  }
  return out;
}

/* --------------------------------------------------------------- render */

export class EmptyMixError extends Error {}

/**
 * Read, trim, fade and place every planned clip. Everything mixes at the
 * first clip's rate, as `exportStory` always has.
 */
export function renderMixLanes(
  plan: Pick<MixPlan, "clips">,
  read: (path: string) => { audio: dsp.Audio; sampleRate: number } = readWavFast,
): { lanes: Map<number, dsp.Audio>; sampleRate: number } {
  const placed: { audio: dsp.Audio; startS: number; lane: number }[] = [];
  let sampleRate = 0;
  for (const c of plan.clips) {
    const clip = read(c.path);
    if (sampleRate === 0) sampleRate = clip.sampleRate;
    let audio = clip.sampleRate === sampleRate ? clip.audio : dsp.resampleAudio(clip.audio, clip.sampleRate, sampleRate);
    // What plays is `length_s` of the source from `trim_start_s`; a trim
    // that leaves nothing drops the clip.
    const from = c.trim_start_s;
    if (from > 0 || c.length_s !== null) {
      const full = dsp.frameCount(audio) / sampleRate;
      const to = c.length_s === null ? full : Math.min(full, from + c.length_s);
      if (to <= from) continue;
      if (from > 0 || to < full) audio = dsp.trimRange(audio, sampleRate, from, to);
    }
    const faded = c.fade_in_s > 0 || c.fade_out_s > 0 ? dsp.applyFades(audio, sampleRate, c.fade_in_s, c.fade_out_s) : audio;
    placed.push({ audio: c.gain_db ? dsp.applyGainDb(faded, c.gain_db) : faded, startS: c.start_s, lane: c.lane });
  }
  if (placed.length === 0) throw new EmptyMixError("Nothing to export: every line's audio is missing from disk.");
  return { lanes: layLanes(placed, sampleRate), sampleRate };
}

/** The whole mixdown from a plan, beds ducked: what the worker runs. */
export function renderMix(plan: MixPlan, read = readWavFast): { audio: dsp.Audio; sampleRate: number } {
  const { lanes, sampleRate } = renderMixLanes(plan, read);
  return { audio: sumLanes(duckLanes(lanes, plan.beds, sampleRate, plan.includeBeds)), sampleRate };
}
