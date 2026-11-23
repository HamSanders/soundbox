/**
 * The docked chapter timeline's ripple rules: where the narration should
 * start when packed (the same rule as the server's `layoutChapter`), and how
 * a dragged narration clip reorders the paragraphs.
 */

import { describe, expect, it } from "vitest";

import { orderAfterDrop, packedStarts } from "@/components/audiobook/editor/chapter-timeline";

type P = { id: string; position: number; start_s: number; kind: "line" | "pause"; sound_id: string | null; duration_s: number | null; is_heading: boolean };
const line = (id: string, position: number, start_s: number, duration_s: number | null, is_heading = false): P => ({
  id,
  position,
  start_s,
  kind: "line",
  sound_id: duration_s === null ? null : `snd-${id}`,
  duration_s,
  is_heading,
});
const pause = (id: string, position: number, start_s: number, duration_s: number): P => ({
  id,
  position,
  start_s,
  kind: "pause",
  sound_id: null,
  duration_s,
  is_heading: false,
});

describe("packedStarts", () => {
  it("packs voiced lines and pauses with the book's gaps, skipping unvoiced lines", () => {
    const starts = packedStarts(
      [line("h", 0, 0, 2, true), line("a", 1, 0, 10), line("u", 2, 0, null), pause("p", 3, 0, 1), line("b", 4, 0, 5)],
      { paragraph_gap_s: 0.5, heading_gap_s: 1.5 },
    );
    expect(Object.fromEntries(starts)).toEqual({ h: 0, a: 4, p: 14.5, b: 15.5 });
    expect(starts.has("u")).toBe(false);
  });
});

describe("orderAfterDrop", () => {
  // Voiced a (0–10), b (10.5–15.5), c (16–20), with unvoiced u1 and u2 at 0.
  const ps = [line("u1", 0, 0, null), line("a", 1, 0, 10), line("b", 2, 10.5, 5), line("u2", 3, 0, null), line("c", 4, 16, 4)];

  it("moves a clip before the first clip whose middle is past the drop", () => {
    expect(orderAfterDrop(ps, [{ id: "c", start_s: 1 }])).toEqual(["u1", "c", "a", "b", "u2"]);
    expect(orderAfterDrop(ps, [{ id: "a", start_s: 14 }])).toEqual(["u1", "b", "u2", "a", "c"]);
  });

  it("moves a clip after the last one when dropped past the end", () => {
    expect(orderAfterDrop(ps, [{ id: "a", start_s: 60 }])).toEqual(["u1", "b", "u2", "c", "a"]);
  });

  it("leaves the order alone for a drop back in its own slot", () => {
    expect(orderAfterDrop(ps, [{ id: "b", start_s: 11 }])).toEqual(["u1", "a", "b", "u2", "c"]);
  });

  it("never moves an unvoiced paragraph, even though it sits at 0", () => {
    // The bug this guards against: every unvoiced clip starts at 0, so a
    // naive sort by start time sent a dragged one to the top of the chapter.
    expect(orderAfterDrop(ps, [{ id: "u2", start_s: 0 }])).toEqual(["u1", "a", "b", "u2", "c"]);
  });
});
