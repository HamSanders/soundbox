/**
 * The live mix: one chapter's story rendered to a single WAV, for a player
 * to seek through and a web-player export to ship.
 *
 * Follows the same placement rule as the story export (`exportStory`): each
 * clip at its own `start_s`, trimmed, with its gain and fades; gaps are
 * silence. Track-level mute and gain are not applied here, and overlap
 * crossfades are left to the clip's own fades. When the export module factors
 * the story mixdown out of `service.ts`, this should call that instead.
 *
 * The result is cached under `<data>/cache/listen/`, keyed by a hash of every
 * clip property that changes the sound, so replaying a chapter is free and
 * re-voicing a paragraph produces a fresh file.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import * as dsp from "../../audio/dsp.js";
import type { MirliService } from "../../service.js";
import type { Chapter } from "../types.js";
import { audible, clipLength } from "./manifest.js";

export function listenCacheDir(svc: MirliService): string {
  return join(svc.config.paths.cache, "listen");
}

/** The cached chapter mix, rendering it first if it is missing or stale.
 *  Null when the chapter has no audible clips. */
export function chapterMix(svc: MirliService, chapter: Chapter): string | null {
  // Every track, so beds under the narration are heard too.
  const segments = svc.listSegments(chapter.story_id).filter(audible);
  if (segments.length === 0) return null;

  const key = createHash("sha1")
    .update(
      JSON.stringify(
        segments.map((s) => [
          s.id,
          s.sound_id,
          s.start_s,
          s.trim_start_s,
          s.duration_s,
          s.gain_db,
          s.fade_in_s,
          s.fade_out_s,
        ]),
      ),
    )
    .digest("hex")
    .slice(0, 16);
  const dir = listenCacheDir(svc);
  const path = join(dir, `${chapter.id}-${key}.wav`);
  if (existsSync(path)) return path;

  const placed: { audio: dsp.Audio; startS: number }[] = [];
  let sampleRate = 0;
  for (const segment of segments) {
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
    if (segment.gain_db) audio = dsp.applyGainDb(audio, segment.gain_db);
    if (segment.fade_in_s > 0 || segment.fade_out_s > 0) {
      audio = dsp.applyFades(audio, sampleRate, segment.fade_in_s, segment.fade_out_s);
    }
    placed.push({ audio, startS: segment.start_s });
  }
  if (placed.length === 0 || sampleRate === 0) return null;

  mkdirSync(dir, { recursive: true });
  // One file per chapter: drop older mixes of this chapter before writing.
  for (const name of readdirSync(dir)) {
    if (name.startsWith(`${chapter.id}-`)) rmSync(join(dir, name), { force: true });
  }
  dsp.writeWav(path, dsp.mixTimeline(placed, sampleRate), sampleRate);
  return path;
}
