/**
 * Web Audio preview of one bed under its chapter's narration.
 *
 * Plays a window of the chapter: the narration clips on track 0 and the bed's
 * own clips, with each clip's gain, trim and fades, and the bed's ducking as
 * gain automation on a bus (`duckAutomation`, the clip-position equivalent of
 * the envelope the export applies to the audio). Close enough to judge
 * levels and ducking without a mixdown.
 */

import { api, type StorySegment } from "@/lib/api";

import { duckAutomation } from "./layout";
import type { Bed } from "./types";

const buffers = new Map<string, Promise<AudioBuffer>>();

async function bufferFor(ctx: AudioContext, soundId: string): Promise<AudioBuffer> {
  let p = buffers.get(soundId);
  if (!p) {
    p = (async () => {
      const sound = await api.getSound(soundId);
      const res = await fetch(sound.file);
      if (!res.ok) throw new Error(`Could not load ${sound.name}`);
      return ctx.decodeAudioData(await res.arrayBuffer());
    })();
    // A failed load is retried next time rather than cached.
    p.catch(() => buffers.delete(soundId));
    buffers.set(soundId, p);
    if (buffers.size > 64) buffers.delete(buffers.keys().next().value!);
  }
  return p;
}

type Point = { t: number; v: number };

function valueAt(points: Point[], t: number): number {
  if (!points.length) return 1;
  if (t <= points[0].t) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.t) return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  }
  return points[points.length - 1].v;
}

/** Schedule `points` (chapter time) onto `param` for the window [from, to). */
function automate(param: AudioParam, points: Point[], from: number, to: number, t0: number): void {
  param.setValueAtTime(valueAt(points, from), t0);
  for (const p of points) {
    if (p.t > from && p.t < to) param.linearRampToValueAtTime(p.v, t0 + (p.t - from));
  }
}

const lin = (db: number) => Math.pow(10, db / 20);

export class BedPreview {
  private ctx: AudioContext | null = null;
  private nodes: AudioScheduledSourceNode[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Play [from, from + length) seconds of the chapter. Resolves once started. */
  async play(opts: {
    bed: Bed;
    segments: StorySegment[];
    from: number;
    length: number;
    onEnd: () => void;
  }): Promise<void> {
    this.stop();
    const ctx = new AudioContext();
    this.ctx = ctx;
    const { bed, segments, from } = opts;
    const to = from + opts.length;
    const narration = segments.filter((s) => s.track_index === 0 && s.sound_id && !s.muted);
    const bedClips = segments.filter((s) => bed.segment_ids.includes(s.id) && s.sound_id && !s.muted);
    const inWindow = (s: StorySegment) => s.start_s < to && s.start_s + (s.duration_s ?? 0) > from;
    const wanted = [...narration, ...bedClips].filter(inWindow);
    const loaded = new Map<string, AudioBuffer>();
    await Promise.all(
      [...new Set(wanted.map((s) => s.sound_id!))].map(async (id) => loaded.set(id, await bufferFor(ctx, id))),
    );
    if (this.ctx !== ctx) return; // stopped while loading

    const t0 = ctx.currentTime + 0.05;
    const bus = ctx.createGain();
    bus.connect(ctx.destination);
    if (bed.duck) {
      const points = duckAutomation(
        narration.map((s) => ({ start_s: s.start_s, end_s: s.start_s + (s.duration_s ?? 0) })),
        bed.duck,
      ).map((p) => ({ t: p.time_s, v: lin(p.gain_db) }));
      automate(bus.gain, points, from, to, t0);
    }

    for (const s of wanted) {
      const buffer = loaded.get(s.sound_id!);
      if (!buffer) continue;
      const start = s.start_s;
      const end = start + (s.duration_s ?? buffer.duration);
      const playFrom = Math.max(start, from);
      const playTo = Math.min(end, to);
      if (playTo <= playFrom) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      const level = lin(s.gain_db ?? 0);
      const fi = Math.min(s.fade_in_s ?? 0, end - start);
      const fo = Math.min(s.fade_out_s ?? 0, end - start - fi);
      const env: Point[] = [
        { t: start, v: fi > 0 ? 0 : level },
        { t: start + fi, v: level },
        { t: end - fo, v: level },
        { t: end, v: fo > 0 ? 0 : level },
      ];
      automate(gain.gain, env, from, to, t0);
      src.connect(gain);
      gain.connect(s.track_index === 0 ? ctx.destination : bus);
      src.start(t0 + (playFrom - from), (s.trim_start_s ?? 0) + (playFrom - start), playTo - playFrom);
      this.nodes.push(src);
    }
    this.timer = setTimeout(() => {
      this.stop();
      opts.onEnd();
    }, opts.length * 1000 + 100);
  }

  stop(): void {
    clearTimeout(this.timer);
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* never started */
      }
    }
    this.nodes = [];
    void this.ctx?.close();
    this.ctx = null;
  }
}
