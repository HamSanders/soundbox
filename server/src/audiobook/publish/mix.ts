/**
 * The live mix: one chapter's story rendered to a single WAV, for a player
 * to seek through and a web-player export to ship.
 *
 * Follows the story export's rules (`exportStory`): each clip at its own
 * `start_s`, trimmed, with its gain and fades; gaps are silence; a track's
 * mute, solo and gain apply on top of the clip's. Every track is mixed, so
 * music and effect beds on tracks 1+ are heard under the narration on track
 * 0, ducked the way the soundscape module says (`duckChapterLanes`). Overlap
 * crossfades between clips on one lane are left to the clips' own fades.
 *
 * The result is cached under `<data>/cache/listen/`, keyed by a hash of every
 * clip and track property that changes the sound, so replaying a chapter is
 * free and re-voicing a paragraph or moving a fader produces a fresh file.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import * as dsp from "../../audio/dsp.js";
import type { StorySegment, StoryTrack } from "../../schemas.js";
import type { MirliService } from "../../service.js";
import { beds } from "../beds.js";
import type { Chapter } from "../types.js";
import { audible, clipLength } from "./manifest.js";

export function listenCacheDir(svc: MirliService): string {
  return join(svc.config.paths.cache, "listen");
}

/**
 * Each track's gain in dB, or null when the track is not heard. Same rule as
 * the studio and the story export: with any track soloed only soloed tracks
 * play; otherwise muted tracks are silent. A track with no row is at unity.
 */
export function trackGains(tracks: StoryTrack[]): (lane: number) => number | null {
  const soloing = tracks.some((t) => t.soloed);
  const byLane = new Map(tracks.map((t) => [t.track_index, t]));
  return (lane) => {
    const t = byLane.get(lane);
    if (!t) return soloing ? null : 0;
    const heard = soloing ? t.soloed : !t.muted;
    return heard ? t.gain_db : null;
  };
}

/** The clips that make it into the mix, with their effective gain. */
export function mixPlan(segments: StorySegment[], tracks: StoryTrack[]): { segment: StorySegment; gainDb: number }[] {
  const gain = trackGains(tracks);
  const out: { segment: StorySegment; gainDb: number }[] = [];
  for (const segment of segments) {
    if (!audible(segment)) continue;
    const track = gain(segment.track_index);
    if (track === null) continue;
    out.push({ segment, gainDb: segment.gain_db + track });
  }
  return out;
}

/** The cached chapter mix, rendering it first if it is missing or stale.
 *  Null when the chapter has no audible clips. */
export function chapterMix(svc: MirliService, chapter: Chapter): string | null {
  const tracks = svc.listTracks(chapter.story_id);
  const plan = mixPlan(svc.listSegments(chapter.story_id), tracks);
  if (plan.length === 0) return null;

  let ducks: [number, unknown][] = [];
  try {
    ducks = [...beds(svc).bedTracks(chapter.story_id).entries()];
  } catch {
    ducks = [];
  }
  const key = createHash("sha1")
    .update(
      JSON.stringify({
        clips: plan.map(({ segment: s, gainDb }) => [
          s.id,
          s.sound_id,
          s.track_index,
          s.start_s,
          s.trim_start_s,
          s.duration_s,
          gainDb,
          s.fade_in_s,
          s.fade_out_s,
        ]),
        ducks,
      }),
    )
    .digest("hex")
    .slice(0, 16);
  const dir = listenCacheDir(svc);
  const path = join(dir, `${chapter.id}-${key}.wav`);
  if (existsSync(path)) return path;

  // Mix each lane on its own first, so beds can be ducked under lane 0.
  const lanes = new Map<number, { audio: dsp.Audio; startS: number }[]>();
  let sampleRate = 0;
  for (const { segment, gainDb } of plan) {
    const filename = svc.db.getFilename(segment.sound_id!);
    if (filename === null) continue;
    const file = join(svc.config.paths.sounds, filename);
    if (!existsSync(file)) continue;
    const clip = dsp.readWav(file);
    if (sampleRate === 0) sampleRate = clip.sampleRate;
    let audio =
      clip.sampleRate === sampleRate ? clip.audio : dsp.resampleAudio(clip.audio, clip.sampleRate, sampleRate);
    const from = segment.trim_start_s ?? 0;
    const full = dsp.frameCount(audio) / sampleRate;
    const to = Math.min(full, from + clipLength(segment));
    if (to <= from) continue;
    if (from > 0 || to < full) audio = dsp.trimRange(audio, sampleRate, from, to);
    if (gainDb) audio = dsp.applyGainDb(audio, gainDb);
    if (segment.fade_in_s > 0 || segment.fade_out_s > 0) {
      audio = dsp.applyFades(audio, sampleRate, segment.fade_in_s, segment.fade_out_s);
    }
    const lane = lanes.get(segment.track_index) ?? [];
    lane.push({ audio, startS: segment.start_s });
    lanes.set(segment.track_index, lane);
  }
  if (lanes.size === 0 || sampleRate === 0) return null;

  let mixed = new Map<number, dsp.Audio>([...lanes].map(([lane, clips]) => [lane, dsp.mixTimeline(clips, sampleRate)]));
  try {
    mixed = beds(svc).duckChapterLanes(chapter.story_id, mixed, sampleRate, true);
  } catch {
    /* no bed rows for this story: lanes as they are */
  }
  const out = dsp.mixTimeline(
    [...mixed.values()].map((audio) => ({ audio, startS: 0 })),
    sampleRate,
  );

  mkdirSync(dir, { recursive: true });
  // One file per chapter: drop older mixes of this chapter before writing.
  for (const name of readdirSync(dir)) {
    if (name.startsWith(`${chapter.id}-`)) rmSync(join(dir, name), { force: true });
  }
  dsp.writeWav(path, out, sampleRate);
  return path;
}
