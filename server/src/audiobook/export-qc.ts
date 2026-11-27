/**
 * Pass/fail checks on a chapter's loudness report.
 *
 * ACX figures (research §8): RMS -23 to -18 dB, peak at most -3 dB, noise
 * floor at most -60 dB RMS, room tone 0.5-1 s at the head and 1-5 s at the
 * tail, 44.1 kHz, at most 120 minutes per file, all files mono or all
 * stereo. Room tone must be real tone, not digital zero (see master.ts).
 * The podcast preset is judged against its own targets instead: -16 LUFS
 * (within 1 LU) and -1 dBTP.
 *
 * `none` is checked against ACX, so an unmastered export still shows how far
 * it is from a submission.
 */

import { FLOOR_DB } from "../audio/meter.js";
import type { ChapterQc, LoudnessReport, MasteringPresetId, QcCheck } from "./types.js";

export const ACX = {
  rms: [-23, -18] as const,
  peak: -3,
  floor: -60,
  head: [0.5, 1] as const,
  tail: [1, 5] as const,
  rate: 44_100,
  maxMinutes: 120,
};

export const PODCAST = { lufs: -16, tolerance: 1, peak: -1 };

const db = (v: number) => (v <= FLOOR_DB ? "-inf" : `${v.toFixed(1)} dB`);
const sec = (v: number) => `${v.toFixed(2)} s`;

export function checkReport(
  report: LoudnessReport,
  preset: MasteringPresetId,
  context: { bookChannels?: number } = {},
): QcCheck[] {
  const checks: QcCheck[] = [];
  const add = (id: string, pass: boolean, message: string) => checks.push({ id, pass, message });

  if (preset === "podcast") {
    const off = report.integrated_lufs - PODCAST.lufs;
    add(
      "loudness",
      Math.abs(off) <= PODCAST.tolerance,
      `Integrated loudness ${report.integrated_lufs.toFixed(1)} LUFS (target ${PODCAST.lufs} ±${PODCAST.tolerance}).`,
    );
    add("peak", report.peak_dbfs <= PODCAST.peak, `True peak ${db(report.peak_dbfs)}TP (at most ${PODCAST.peak}).`);
  } else {
    const [lo, hi] = ACX.rms;
    add(
      "rms",
      report.rms_db >= lo && report.rms_db <= hi,
      `RMS ${db(report.rms_db)} (ACX: ${lo} to ${hi} dB).`,
    );
    add("peak", report.peak_dbfs <= ACX.peak, `True peak ${db(report.peak_dbfs)} (ACX: at most ${ACX.peak} dB).`);
    add(
      "noise_floor",
      report.noise_floor_db <= ACX.floor,
      `Noise floor ${db(report.noise_floor_db)} (ACX: at most ${ACX.floor} dB).`,
    );
    add(
      "digital_silence",
      report.noise_floor_db > -100,
      report.noise_floor_db > -100
        ? "Pauses carry room tone."
        : "Pauses are digital silence; ACX can reject that as over-processed. Add room tone.",
    );
    add(
      "room_tone_head",
      report.head_silence_s >= ACX.head[0] && report.head_silence_s <= ACX.head[1] + 0.05,
      `Head room tone ${sec(report.head_silence_s)} (ACX: ${ACX.head[0]}–${ACX.head[1]} s).`,
    );
    add(
      "room_tone_tail",
      report.tail_silence_s >= ACX.tail[0] && report.tail_silence_s <= ACX.tail[1] + 0.05,
      `Tail room tone ${sec(report.tail_silence_s)} (ACX: ${ACX.tail[0]}–${ACX.tail[1]} s).`,
    );
  }
  add(
    "sample_rate",
    report.sample_rate === ACX.rate,
    `Sample rate ${report.sample_rate} Hz (${ACX.rate} Hz required).`,
  );
  add(
    "max_length",
    report.duration_s <= ACX.maxMinutes * 60,
    `Length ${(report.duration_s / 60).toFixed(1)} min (at most ${ACX.maxMinutes} per file).`,
  );
  if (context.bookChannels !== undefined) {
    const name = (n: number) => (n === 1 ? "mono" : n === 2 ? "stereo" : `${n}-channel`);
    add(
      "channels",
      report.channels === context.bookChannels,
      report.channels === context.bookChannels
        ? `${name(report.channels)}, like the rest of the book.`
        : `${name(report.channels)}, but the book is ${name(context.bookChannels)}; files must not mix mono and stereo.`,
    );
  }
  return checks;
}

/** The channel count most of the book uses, for the `channels` check. */
export function majorityChannels(reports: LoudnessReport[]): number | undefined {
  const counts = new Map<number, number>();
  for (const r of reports) counts.set(r.channels, (counts.get(r.channels) ?? 0) + 1);
  let best: number | undefined;
  let n = 0;
  for (const [ch, c] of counts) if (c > n) [best, n] = [ch, c];
  return best;
}

/** Checks for a whole book: each chapter judged, plus the shared channel rule. */
export function checkBook(
  reports: { chapter_id: string; report: LoudnessReport }[],
  preset: MasteringPresetId,
): ChapterQc[] {
  const bookChannels = reports.length > 1 ? majorityChannels(reports.map((r) => r.report)) : undefined;
  return reports.map((r) => ({ chapter_id: r.chapter_id, report: r.report, checks: checkReport(r.report, preset, { bookChannels }) }));
}

export const qcPassed = (qc: ChapterQc[]): boolean => qc.every((c) => c.checks.every((k) => k.pass));

const clock = (s: number) => {
  const m = Math.floor(s / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

/**
 * Checks for a chapter the export splits into several files at ACX's
 * 120-minute limit: `max_length` is judged per file, and `secondary_header`
 * fails when a later file doesn't open on a heading paragraph.
 */
export function splitChecks(
  checks: QcCheck[],
  parts: { duration_s: number; header: boolean; from_s: number }[],
  title: string,
): QcCheck[] {
  if (parts.length < 2) return checks;
  const longest = Math.max(...parts.map((p) => p.duration_s));
  const out = checks.map((c) =>
    c.id === "max_length"
      ? {
          id: c.id,
          pass: longest <= ACX.maxMinutes * 60,
          message: `Split into ${parts.length} files (${parts.map((p) => `${(p.duration_s / 60).toFixed(0)} min`).join(", ")}); at most ${ACX.maxMinutes} min each.`,
        }
      : c,
  );
  const missing = parts.map((p, i) => ({ ...p, n: i + 1 })).filter((p, i) => i > 0 && !p.header);
  out.push({
    id: "secondary_header",
    pass: missing.length === 0,
    message: missing.length
      ? `${missing.map((p) => `Part ${p.n} (from ${clock(p.from_s)})`).join(", ")} starts without a spoken header. Add a heading paragraph such as "${title}, continued" near there and voice it; the export splits at it.`
      : "Each part starts with a spoken header.",
  });
  return out;
}
