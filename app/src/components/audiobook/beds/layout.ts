/**
 * Bed layout and ducking automation, for the mock and the Web Audio preview.
 *
 * Mirrors `layoutBed`/`narrationLength` in `server/src/audiobook/beds.ts` and
 * `duckAutomation` in `server/src/audio/duck.ts`, which the server tests
 * cover. Change them together.
 */

import type { StorySegment } from "@/lib/api";

import type { BedKind, BedMode, DuckOptions } from "./types";

export const DEFAULT_DUCK: DuckOptions = {
  depth_db: 12,
  attack_ms: 250,
  release_ms: 600,
  lookahead_ms: 250,
  hold_ms: 400,
  threshold_db: -45,
};

export interface ClipPlan {
  start_s: number;
  trim_start_s: number;
  duration_s: number;
  fade_in_s: number;
  fade_out_s: number;
}

export interface LayoutInput {
  kind: BedKind;
  mode: BedMode;
  loop: boolean;
  sound_s: number;
  chapter_s: number;
  intro_s: number | null;
  fade_in_s: number;
  fade_out_s: number;
  anchor_s: number;
  offset_s: number;
  end_s?: number | null;
}

const MAX_CLIP_S = 600;
const round = (s: number) => Math.round(s * 1000) / 1000;

function fill(from: number, to: number, input: LayoutInput): ClipPlan[] {
  const span = to - from;
  if (span <= 0 || input.sound_s <= 0) return [];
  const unit = Math.min(input.sound_s, MAX_CLIP_S);
  const clips: ClipPlan[] = [];
  if (!input.loop || unit >= span) {
    clips.push({ start_s: from, trim_start_s: 0, duration_s: Math.min(unit, span), fade_in_s: 0, fade_out_s: 0 });
  } else {
    const step = unit - Math.min(2, unit / 4);
    for (let start = from; start < to - 1e-6 && clips.length < 2000; start += step) {
      const duration = Math.min(unit, to - start);
      clips.push({ start_s: start, trim_start_s: 0, duration_s: duration, fade_in_s: 0, fade_out_s: 0 });
      if (start + duration >= to - 1e-6) break;
    }
  }
  const first = clips[0];
  const last = clips[clips.length - 1];
  first.fade_in_s = Math.min(input.fade_in_s, 60, first.duration_s);
  last.fade_out_s = Math.min(input.fade_out_s, 60, last.duration_s - (clips.length === 1 ? first.fade_in_s : 0));
  return clips.map((c) => ({
    start_s: round(c.start_s),
    trim_start_s: c.trim_start_s,
    duration_s: round(c.duration_s),
    fade_in_s: round(Math.max(0, c.fade_in_s)),
    fade_out_s: round(Math.max(0, c.fade_out_s)),
  }));
}

export function layoutBed(input: LayoutInput): ClipPlan[] {
  if (input.kind === "sfx") {
    const at = Math.max(0, input.anchor_s + input.offset_s);
    return fill(at, at + input.sound_s, { ...input, loop: false });
  }
  const length = input.chapter_s > 0 ? input.chapter_s : input.sound_s;
  const piece = Math.min(input.intro_s ?? input.sound_s, length);
  switch (input.mode) {
    case "full":
      return fill(0, length, input);
    case "intro":
      return fill(0, piece, input);
    case "outro":
      return fill(length - piece, length, input);
    case "scene": {
      const from = Math.max(0, input.anchor_s + input.offset_s);
      const to = input.end_s ?? length;
      return fill(from, to > from ? to : from + input.sound_s, input);
    }
    case "intro_outro":
      if (piece * 2 >= length) return fill(0, length, input);
      return [...fill(0, piece, input), ...fill(length - piece, length, input)];
  }
}

export function narrationLength(segments: StorySegment[]): number {
  let end = 0;
  for (const s of segments) {
    if (s.track_index !== 0) continue;
    if (!s.sound_id && s.kind !== "pause") continue;
    end = Math.max(end, s.start_s + (s.duration_s ?? 0));
  }
  return round(end);
}

export interface DuckPoint {
  time_s: number;
  gain_db: number;
}

export function duckAutomation(
  intervals: { start_s: number; end_s: number }[],
  duck: DuckOptions,
): DuckPoint[] {
  if (duck.depth_db <= 0) return [];
  const look = duck.lookahead_ms / 1000;
  const attack = duck.attack_ms / 1000;
  const release = duck.release_ms / 1000;
  const hold = duck.hold_ms / 1000;
  const sorted = intervals.filter((i) => i.end_s > i.start_s).sort((a, b) => a.start_s - b.start_s);
  const merged: { start_s: number; end_s: number }[] = [];
  for (const i of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && (i.start_s - prev.end_s <= hold || i.start_s - look <= prev.end_s + release)) {
      prev.end_s = Math.max(prev.end_s, i.end_s);
    } else {
      merged.push({ ...i });
    }
  }
  const points: DuckPoint[] = [];
  for (const m of merged) {
    const begin = Math.max(0, m.start_s - look);
    const reached = Math.max(begin, m.start_s - look + attack);
    points.push({ time_s: begin, gain_db: 0 });
    points.push({ time_s: reached, gain_db: -duck.depth_db });
    points.push({ time_s: Math.max(reached, m.end_s), gain_db: -duck.depth_db });
    points.push({ time_s: Math.max(reached, m.end_s) + release, gain_db: 0 });
  }
  return points;
}
