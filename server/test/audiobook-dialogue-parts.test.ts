/**
 * Dialogue-only casting: a paragraph cast to a character is voiced as
 * narration and dialogue pieces, the character reading only the quoted words.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dialogueParts, partGapS } from "../src/audiobook/dialogue-parts.js";
import { RenderService } from "../src/audiobook/render.js";
import type { Voice } from "../src/schemas.js";
import { harness, SR, TTS, type Harness } from "./audiobook-voice-helpers.js";

describe("dialogueParts", () => {
  it("gives the attribution to the narrator and the quotes to the character", () => {
    expect(dialogueParts(`"The oil delivery was late," she said. "Blame the boat, not me."`)).toEqual([
      { text: "The oil delivery was late,", quote: true },
      { text: "she said.", quote: false },
      { text: "Blame the boat, not me.", quote: true },
    ]);
  });

  it("handles narration first, curly quotes and a name after the quote", () => {
    expect(dialogueParts("He laughed, a short dry sound. “Everyone blames the boat.”")).toEqual([
      { text: "He laughed, a short dry sound.", quote: false },
      { text: "Everyone blames the boat.", quote: true },
    ]);
    expect(dialogueParts(`"You're late," said Tobias from the gallery door.`)).toEqual([
      { text: "You're late,", quote: true },
      { text: "said Tobias from the gallery door.", quote: false },
    ]);
  });

  it("leaves all-dialogue and all-narration paragraphs alone", () => {
    expect(dialogueParts(`"Then who is it?"`)).toBeNull();
    expect(dialogueParts("He didn't answer.")).toBeNull();
  });

  it("drops a narration piece that is only punctuation", () => {
    expect(dialogueParts(`"Wait" — "No."`)).toBeNull();
  });

  it("pauses longer after a sentence than after a comma", () => {
    expect(partGapS("she said.")).toBeGreaterThan(partGapS("The oil delivery was late,"));
    expect(partGapS(`late."`)).toBe(partGapS("late."));
  });
});

describe("render with dialogue-only casting", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    const db = (h.svc as unknown as { db: { createVoice(v: Voice, f: null): Voice } }).db;
    for (const vid of ["bf_emma", "af_heart"]) {
      db.createVoice({ id: vid, name: vid, kind: "builtin", created_at: "", voice_id: vid, model_id: TTS } as Voice, null);
    }
    h.book.book.settings.narrator_voice_id = "bf_emma";
  });
  afterEach(async () => {
    await h.close();
  });

  const LINE = `"The oil delivery was late," she said. "Blame the boat, not me."`;

  function setup() {
    const mara = h.book.createCharacter("book1", { name: "Mara", voice_id: "af_heart" });
    const ch = h.book.addChapter("One", [LINE]);
    const seg = h.svc.listSegments(ch.story_id)[0]!;
    h.book.setMeta(seg.id, { character_id: mara.id });
    // core writes the character's voice onto the segment
    h.svc.updateSegment(seg.id, { voice_id: "af_heart" });
    return seg;
  }

  function voicesHeard(): { text: string; voice: string | null }[] {
    const speak = vi.mocked(h.svc.models.get(TTS).speak);
    return speak.mock.calls.map(([text, o]) => ({ text, voice: (o as { voiceId?: string | null }).voiceId ?? null }));
  }

  it("speaks the quotes in the character's voice and the attribution in the narrator's", async () => {
    const seg = setup();
    const r = await new RenderService(h.svc, h.book).voiceParagraph(seg.id);
    expect(voicesHeard()).toEqual([
      { text: "The oil delivery was late,", voice: "af_heart" },
      { text: "she said.", voice: "bf_emma" },
      { text: "Blame the boat, not me.", voice: "af_heart" },
    ]);
    // One clip for the paragraph, and the take records what was read.
    expect(h.svc.getSegment(seg.id)!.sound_id).toBe(r.sound_id);
    expect(r.spoken_text).toBe("The oil delivery was late, she said. Blame the boat, not me.");
    const dur = h.svc.getSegment(seg.id)!.duration_s!;
    expect(dur).toBeGreaterThan(2);
    expect(dur).toBeLessThan(12);
    expect(SR).toBe(24000);
  });

  it("reads the whole paragraph in the character's voice when dialogue_only is off", async () => {
    h.book.book.settings.dialogue_only = false;
    const seg = setup();
    await new RenderService(h.svc, h.book).voiceParagraph(seg.id);
    expect(voicesHeard()).toEqual([{ text: LINE, voice: "af_heart" }]);
  });
});
