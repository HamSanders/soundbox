/**
 * Tick marks for a time ruler that fits a whole clip into a given width.
 *
 * The labelled step is the smallest "round" interval that keeps labels far
 * enough apart to read; between them go unlabelled minor ticks, where there is
 * room. A 2-second effect gets a tick every 0.2s, a 4-minute song one every 30s,
 * and neither needs a zoom level to be legible.
 */

/** Labelled steps, in seconds, each with how many minor intervals divide it. */
const STEPS: readonly (readonly [number, number])[] = [
  [0.1, 2],
  [0.2, 2],
  [0.5, 5],
  [1, 5],
  [2, 4],
  [5, 5],
  [10, 5],
  [15, 3],
  [30, 3],
  [60, 4],
  [120, 4],
  [300, 5],
  [600, 5],
];

/** The least room, in pixels, between two labels. */
const LABEL_GAP_PX = 64;
/** The least room between two ticks of any kind. */
const TICK_GAP_PX = 7;

export interface RulerTick {
  /** Seconds from the start. */
  t: number;
  /** Labelled ticks are the major ones. */
  major: boolean;
}

export interface Ruler {
  ticks: RulerTick[];
  /** The labelled interval, so the caller knows whether labels need tenths. */
  step: number;
}

export function rulerTicks(durationS: number, widthPx: number): Ruler {
  if (!(durationS > 0) || !(widthPx > 0)) return { ticks: [], step: 1 };
  const pxPerSecond = widthPx / durationS;
  const [step, divisions] =
    STEPS.find(([s]) => s * pxPerSecond >= LABEL_GAP_PX) ?? STEPS[STEPS.length - 1]!;
  const minor = (step / divisions) * pxPerSecond >= TICK_GAP_PX ? step / divisions : step;
  const ticks: RulerTick[] = [];
  const count = Math.floor(durationS / minor + 1e-6);
  for (let i = 0; i <= count; i++) {
    // From the index, not accumulated: 0.1 added thirty times is not 3.
    const t = Math.round(i * minor * 1000) / 1000;
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    ticks.push({ t, major });
  }
  return { ticks, step };
}
