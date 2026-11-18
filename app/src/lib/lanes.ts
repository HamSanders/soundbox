/**
 * A colour per track.
 *
 * Once a timeline has five lanes of near-identical grey waveforms, "which one
 * was the drums" costs a read of the gutter every time. A hue per lane makes
 * that a glance, and it has to be the *same* hue everywhere the lane appears —
 * the clip, the track header, the device rack's lane buttons — or it is
 * decoration rather than identity.
 *
 * Hues rather than a palette of finished colours: lightness and chroma come
 * from `--lane-l` and `--lane-c` in `index.css`, which the light and dark
 * themes each set for themselves. So one hue number produces a colour that is
 * legible on white and on near-black without this file knowing which is on.
 *
 * Eight of them, evenly spaced across the arc that is left once the teal
 * accent's neighbourhood (hue 195, give or take) is excluded — a lane the
 * colour of the accent reads as "selected". The order then steps half way
 * round the ramp each time rather than walking it, so lanes 0 and 1 are
 * opposites instead of neighbours; adjacent tracks are what you most need to
 * tell apart.
 *
 * Lanes past the eighth repeat, which is a real limit: a story with nine
 * tracks has two lanes the same colour, and that is still better than nine
 * that all match.
 */

// 75, not the evenly spaced 55: 55 is the beak yellow, which is reserved
// for "sound is happening here".
const LANE_HUES = [225, 17, 263, 75, 301, 93, 339, 131];

export function laneHue(lane: number): number {
  // Negative lanes cannot happen, but a modulo that returns -1 would produce
  // `undefined` and a colour of "oklch(... NaN)", which paints nothing.
  return LANE_HUES[((lane % LANE_HUES.length) + LANE_HUES.length) % LANE_HUES.length];
}

/** `oklch()` in this lane's hue, at the given alpha. */
export function laneColor(lane: number, alpha = 1): string {
  return `oklch(var(--lane-l) var(--lane-c) ${laneHue(lane)} / ${alpha})`;
}

/**
 * The lane a new piece of audio should land on: one below everything that
 * exists.
 *
 * New audio never lands on top of old audio. Two clips sharing a lane and a
 * moment now crossfade rather than sum (see `lib/fades`), which is the right
 * behaviour when you meant it and a silent edit to your arrangement when you
 * did not — and a track that arrives from a generator or a microphone was
 * never aimed anywhere in particular. Its own lane is the only placement that
 * cannot be wrong; moving it down onto another is one drag away.
 */
export function nextFreeTrack(clips: { track_index: number }[]): number {
  return clips.reduce((highest, clip) => Math.max(highest, clip.track_index), -1) + 1;
}

/**
 * Which lanes exist.
 *
 * A lane is real if something is on it *or* someone made it — a track row
 * with no clips is an empty track you asked for, and it has to stay on
 * screen or "add track" would appear to do nothing. One spare lane below
 * everything else so there is always somewhere to drag a clip down to.
 *
 * Derived here, from the story itself, so the timeline and the panels
 * around it agree — including when the Timeline panel is closed.
 */
export function lanesFor(
  clips: readonly { track_index: number }[],
  tracks: readonly { track_index: number }[],
): number[] {
  const used = [...clips.map((c) => c.track_index), ...tracks.map((t) => t.track_index)];
  const min = Math.min(0, ...used);
  const max = Math.max(0, ...used) + 1;
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** Whether anything already occupies `[startS, startS + lengthS)` on a lane. */
export function laneIsFree(
  clips: { track_index: number; start_s: number; duration_s?: number | null }[],
  lane: number,
  startS: number,
  lengthS: number,
): boolean {
  return !clips.some(
    (clip) =>
      clip.track_index === lane &&
      clip.start_s < startS + lengthS &&
      startS < clip.start_s + (clip.duration_s ?? 0),
  );
}
