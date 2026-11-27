/**
 * Worker-thread entry for audiobook mastering.
 *
 * Mastering, metering and writing the 16-bit WAV are pure CPU over large
 * buffers: an hour-long chapter blocked the event loop for over 30 s, and
 * with it every request, SSE stream and playback range. This runs them on a
 * worker thread. Audio comes in and goes back as transferred ArrayBuffers,
 * so nothing is copied across the boundary.
 *
 * The client side is `export-runner.ts`; it can also run the same function
 * inline (`runMasterJob`), which is what it falls back to if a worker can't
 * start.
 */

import { parentPort } from "node:worker_threads";

import { type Audio, frameCount } from "../audio/dsp.js";
import { writeWav16 } from "../audio/encode.js";
import { downmixMono, fitEdges, master, resampleFast } from "../audio/master.js";
import { measure } from "../audio/meter.js";
import { type MixPlan, renderMix } from "./export-mix.js";
import { type SplitCut, type SplitParagraph, planSplit } from "./export-split.js";
import type { LoudnessReport, MasteringPresetId, PacingSettings } from "./types.js";

export interface MasterJob {
  /** The mixdown to master, or `mix` to have the worker mix it. */
  audio?: Audio;
  rate?: number;
  /** A story's mix plan (`MirliService.planMix`): reading and mixing the
   *  clips is the slowest part of a chapter, so it happens here too. */
  mix?: MixPlan;
  preset: MasteringPresetId;
  pacing?: Pick<PacingSettings, "head_room_tone_s" | "tail_room_tone_s">;
  /** Write the mastered audio as dithered 16-bit WAV; part n > 0 gets
   *  `.partN` before the extension. */
  wavPath?: string | null;
  /** Split files longer than ACX's 120 minutes at these paragraphs
   *  (timeline seconds, before mastering moves them). */
  split?: { paragraphs: SplitParagraph[]; maxS?: number } | null;
  /** Bring the result to this rate and layout first (joining chapters). */
  conform?: { rate?: number; channels: number } | null;
  /** Send the mastered audio back (otherwise only the numbers). */
  returnAudio?: boolean;
}

export interface MasterPart {
  /** Where this part starts in the whole mastered chapter, seconds. */
  from_s: number;
  /** Seconds this part's content moved when its room tone was fitted. */
  shift_s: number;
  frames: number;
  /** Starts on a heading paragraph (always true for the first part). */
  header: boolean;
  report: LoudnessReport;
  wav: string | null;
}

export interface MasterJobResult {
  sampleRate: number;
  channels: number;
  /** Whole mastered chapter, before any split. */
  frames: number;
  shiftS: number;
  gainDb: number;
  /** Report on the whole chapter. */
  report: LoudnessReport;
  parts: MasterPart[];
  /** The whole chapter, when asked for. */
  audio: Audio | null;
}

export function partPath(wavPath: string, n: number): string {
  return n === 0 ? wavPath : wavPath.replace(/(\.[^.\/]+)?$/, `.part${n + 1}$1`);
}

function conformTo(audio: Audio, rate: number, want: { rate?: number; channels: number }): Audio {
  let a = !want.rate || rate === want.rate ? audio : resampleFast(audio, rate, want.rate);
  if (a.length === want.channels) return a;
  if (want.channels === 1) return downmixMono(a);
  const mono = a.length === 1 ? a[0] : downmixMono(a)[0];
  a = Array.from({ length: want.channels }, () => mono.slice());
  return a;
}

export function runMasterJob(job: MasterJob): MasterJobResult {
  const source = job.mix ? renderMix(job.mix) : { audio: job.audio!, sampleRate: job.rate! };
  const m = master(source.audio, source.sampleRate, job.preset, job.pacing);
  let audio = m.audio;
  let rate = m.sampleRate;
  if (job.conform) {
    audio = conformTo(audio, rate, job.conform);
    rate = job.conform.rate ?? rate;
  }
  const frames = frameCount(audio);
  const report = measure(audio, rate);

  let cuts: SplitCut[] = [];
  if (job.split) {
    const shifted = job.split.paragraphs.map((p) => ({ ...p, start_s: p.start_s + m.shiftS, end_s: p.end_s + m.shiftS }));
    cuts = planSplit(shifted, frames / rate, job.split.maxS);
  }
  const parts: MasterPart[] = [];
  if (cuts.length === 0) {
    if (job.wavPath) writeWav16(job.wavPath, audio, rate);
    parts.push({ from_s: 0, shift_s: 0, frames, header: true, report, wav: job.wavPath ?? null });
  } else {
    const bounds = [0, ...cuts.map((c) => Math.round(c.at_s * rate)), frames];
    const head = job.pacing?.head_room_tone_s ?? 0.75;
    const tail = job.pacing?.tail_room_tone_s ?? 2;
    for (let n = 0; n < bounds.length - 1; n++) {
      const slice = audio.map((ch) => ch.subarray(bounds[n], bounds[n + 1]));
      // Every file gets its own room tone at both ends, as ACX asks.
      const fitted = fitEdges(slice, rate, head, tail, "tone");
      const wav = job.wavPath ? partPath(job.wavPath, n) : null;
      if (wav) writeWav16(wav, fitted.audio, rate);
      parts.push({
        from_s: bounds[n] / rate,
        shift_s: fitted.shiftS,
        frames: frameCount(fitted.audio),
        header: n === 0 || cuts[n - 1].header,
        report: measure(fitted.audio, rate),
        wav,
      });
    }
  }
  return {
    sampleRate: rate,
    channels: audio.length,
    frames,
    shiftS: m.shiftS,
    gainDb: m.gainDb,
    report,
    parts,
    audio: job.returnAudio ? audio : null,
  };
}

if (parentPort) {
  const port = parentPort;
  port.on("message", (msg: { id: number; job: MasterJob }) => {
    try {
      const result = runMasterJob(msg.job);
      const transfer = result.audio ? result.audio.map((ch) => ch.buffer as ArrayBuffer) : [];
      port.postMessage({ id: msg.id, ok: true, result }, transfer);
    } catch (exc) {
      port.postMessage({ id: msg.id, ok: false, error: exc instanceof Error ? exc.message : String(exc) });
    }
  });
}
