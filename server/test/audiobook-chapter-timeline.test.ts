/**
 * The docked chapter timeline's ripple rules: where the narration should
 * start when packed (the same rule as the server's `layoutChapter`), and how
 * a dragged narration clip reorders the paragraphs.
 */

import { describe, expect, it } from "vitest";

import { orderAfterDrop, packedStarts, placeholderSeconds } from "@/components/audiobook/editor/chapter-timeline";

type P = {
  id: string;
  position: number;
  start_s: number;
  kind: "line" | "pause";
  sound_id: string | null;
  duration_s: number | null;
  is_heading: boolean;
  text: string;
};
/** Five words: a 2 s placeholder while unvoiced. */
const FIVE = "one two three four five";
const line = (id: string, position: number, start_s: number, duration_s: number | null, is_heading = false): P => ({
  id,
  position,
  start_s,
  kind: "line",
  sound_id: duration_s === null ? null : `snd-${id}`,
  duration_s,
  is_heading,
  text: FIVE,
});
const pause = (id: string, position: number, start_s: number, duration_s: number): P => ({
  id,
  position,
  start_s,
  kind: "pause",
  sound_id: null,
  duration_s,
  is_heading: false,
  text: "",
});

describe("placeholderSeconds", () => {
  it("is 0.4 s a word, at least 0.8 s", () => {
    expect(placeholderSeconds(FIVE)).toBe(2);
    expect(placeholderSeconds("Hi.")).toBe(0.8);
  });
});

describe("packedStarts", () => {
  it("packs every paragraph in reading order, unvoiced ones at their placeholder length", () => {
    const starts = packedStarts(
      [line("h", 0, 0, 2, true), line("a", 1, 0, 10), line("u", 2, 0, null), pause("p", 3, 0, 1), line("b", 4, 0, 5)],
      { paragraph_gap_s: 0.5, heading_gap_s: 1.5 },
    );
    // h 0–2 (+0.5 +1.5), a 4–14 (+0.5), u 14.5–16.5 (+0.5), p 17–18, b 18.
    expect(Object.fromEntries(starts)).toEqual({ h: 0, a: 4, u: 14.5, p: 17, b: 18 });
  });

  it("never puts two paragraphs at the same start", () => {
    const starts = packedStarts([line("u1", 0, 0, null), line("u2", 1, 0, null), line("u3", 2, 0, null)], {
      paragraph_gap_s: 0.5,
      heading_gap_s: 1.5,
    });
    expect(new Set(starts.values()).size).toBe(3);
  });
});

describe("orderAfterDrop", () => {
  // Packed with a 0.5 s gap: u1 0–2, a 2.5–12.5, b 13–18, u2 18.5–20.5, c 21–25.
  const ps = [
    line("u1", 0, 0, null),
    line("a", 1, 2.5, 10),
    line("b", 2, 13, 5),
    line("u2", 3, 18.5, null),
    line("c", 4, 21, 4),
  ];

  it("moves a clip before the first clip whose middle is past the drop", () => {
    expect(orderAfterDrop(ps, [{ id: "c", start_s: 0.5 }])).toEqual(["c", "u1", "a", "b", "u2"]);
    expect(orderAfterDrop(ps, [{ id: "a", start_s: 17 }])).toEqual(["u1", "b", "a", "u2", "c"]);
  });

  it("moves a clip after the last one when dropped past the end", () => {
    expect(orderAfterDrop(ps, [{ id: "a", start_s: 60 }])).toEqual(["u1", "b", "u2", "c", "a"]);
  });

  it("leaves the order alone for a drop back in its own slot", () => {
    expect(orderAfterDrop(ps, [{ id: "b", start_s: 13.5 }])).toEqual(["u1", "a", "b", "u2", "c"]);
  });

  it("moves an unvoiced paragraph like any other, now that it has a place", () => {
    expect(orderAfterDrop(ps, [{ id: "u2", start_s: 3 }])).toEqual(["u1", "u2", "a", "b", "c"]);
  });
});
