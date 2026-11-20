/**
 * Audiobook takes: splice planning on synthetic audio, and the takes service
 * on a real MirliService with a stubbed TTS model.
 */

import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as dsp from "../src/audio/dsp.js";
import { voiceStores } from "../src/audiobook/render-access.js";
import { RenderService } from "../src/audiobook/render.js";
import { expandToSentence, expandToWords, planSelection, spliceAudio } from "../src/audiobook/takes-splice.js";
import { recordTakes, TakesService } from "../src/audiobook/takes.js";
import { fakeSpeech, harness, SR, type Harness } from "./audiobook-voice-helpers.js";

describe("selection planning", () => {
  const text = "The fox ran home. Then it slept soundly, dreaming of hens.";

  it("expands to whole words and sentences", () => {
    expect(text.slice(...Object.values(expandToWords(text, { start: 5, end: 9 })) as [number, number])).toBe("fox ran");
    const s = expandToSentence(text, { start: 23, end: 25 });
    expect(text.slice(s.start, s.end)).toBe("Then it slept soundly, dreaming of hens.");
  });

  it("cuts at pauses when the selection sits between punctuation", () => {
    const audio = [fakeSpeech(text)];
    // "Then it slept soundly," is bounded by pauses on both sides.
    const plan = planSelection(text, { start: 18, end: 40 }, audio, SR);
    expect(plan.mode).toBe("words");
    expect(plan.cut_start_s).toBeGreaterThan(1);
    expect(plan.cut_end_s!).toBeGreaterThan(plan.cut_start_s!);
  });

  it("widens to the sentence when a word has no pause around it", () => {
    const plan = planSelection(text, { start: 27, end: 32 }, [fakeSpeech(text)], SR);
    expect(plan.mode).toBe("sentence");
    expect(plan.reason).toMatch(/sentence/);
    expect(text.slice(plan.start, plan.end)).toBe("Then it slept soundly, dreaming of hens.");
  });

  it("falls back to the paragraph when nothing can be cut", () => {
    const flat = [new Float32Array(SR * 3).fill(0.2)];
    const plan = planSelection("One two three four five.", { start: 4, end: 7 }, flat, SR);
    expect(plan.mode).toBe("paragraph");
    expect(plan.reason).toMatch(/paragraph/);
  });

  it("splices with crossfades and keeps length arithmetic", () => {
    const base = [new Float32Array(SR).fill(0.5)];
    const ins = [new Float32Array(SR / 2).fill(-0.5)];
    const out = spliceAudio(base, ins, SR, 0.25, 0.75, 0.01);
    const x = Math.round(0.01 * SR);
    expect(out[0]!.length).toBe(SR - SR / 2 + SR / 2 - 2 * x);
    expect(out[0]![0]).toBe(0.5);
    expect(out[0]![out[0]!.length - 1]).toBe(0.5);
    expect(out[0]![Math.round(0.5 * SR)]).toBe(-0.5);
  });
});

describe("TakesService", () => {
  let h: Harness;
  let takes: TakesService;
  let render: RenderService;
  let segId: string;

  beforeEach(async () => {
    h = await harness();
    recordTakes(h.svc);
    takes = new TakesService(h.svc, h.book);
    render = new RenderService(h.svc, h.book);
    const ch = h.book.addChapter("One", ["The fox ran home. Then it slept soundly, dreaming of hens."]);
    segId = h.book.getParagraphs(ch.id)![0]!.id;
  });
  afterEach(async () => h.close());

  it("records a take per generation and restores an older one", async () => {
    const a = await render.voiceParagraph(segId);
    const b = await render.voiceParagraph(segId);
    const list = takes.list(segId);
    expect(list.map((t) => t.sound_id)).toEqual([b.sound_id, a.sound_id]);
    expect(list[0]!.selected).toBe(true);
    expect(list[0]!.gen_ms).not.toBeNull();
    expect(list[0]!.seed).not.toBeNull();

    takes.select(segId, list[1]!.id);
    expect(h.svc.getSegment(segId)!.sound_id).toBe(a.sound_id);
    expect(takes.list(segId).find((t) => t.selected)!.id).toBe(list[1]!.id);
    // The old sound survives a regenerate; nothing was orphaned or deleted.
    expect(h.svc.getSound(b.sound_id)).not.toBeNull();
  });

  it("records takes for segments voiced outside the audiobook path", async () => {
    await h.svc.generateSegment(segId, { model: "audiocpp-kokoro", load_options: {} });
    expect(takes.list(segId)).toHaveLength(1);
    expect(takes.list(segId)[0]!.origin).toBe("generate");
  });

  it("won't delete the selected take, and deletes others with their sound", async () => {
    const a = await render.voiceParagraph(segId);
    await render.voiceParagraph(segId);
    const [current, old] = takes.list(segId);
    await expect(takes.delete(segId, current!.id)).rejects.toThrow(/Select another/);
    await takes.delete(segId, old!.id);
    expect(takes.list(segId)).toHaveLength(1);
    expect(h.svc.getSound(a.sound_id)).toBeNull();
  });

  it("refuses to change a locked paragraph's take", async () => {
    await render.voiceParagraph(segId);
    await render.voiceParagraph(segId);
    h.book.setMeta(segId, { locked: true });
    await expect(async () => takes.select(segId, takes.list(segId)[1]!.id)).rejects.toThrow(/locked/);
  });

  it("regenerates a selection by splicing only those words", async () => {
    await render.voiceParagraph(segId);
    const before = h.svc.getSegment(segId)!;
    h.spoken.length = 0;
    const { plan, take } = await takes.regenerateSelection(
      segId,
      { start: 18, end: 40 },
      (id, o) => render.voiceParagraph(id, { spoken: o.text, origin: o.origin }).then((v) => v.sound_id),
      (t) => t,
    );
    expect(plan.mode).toBe("words");
    expect(h.spoken).toEqual(["Then it slept soundly,"]);
    const after = h.svc.getSegment(segId)!;
    expect(after.sound_id).not.toBe(before.sound_id);
    expect(take.origin).toBe("selection");
    expect(take.selected).toBe(true);
    // Two takes: the original and the spliced one. The fragment is not a take.
    expect(takes.list(segId)).toHaveLength(2);
    const wav = dsp.readWav(join(h.svc.config.paths.sounds, h.svc.db.getFilename(after.sound_id!)!));
    const len = wav.audio[0]!.length / wav.sampleRate;
    expect(Math.abs(len - before.duration_s!)).toBeLessThan(0.6);
  });

  it("widens a mid-sentence selection to the sentence and says so", async () => {
    await render.voiceParagraph(segId);
    h.spoken.length = 0;
    const { plan } = await takes.regenerateSelection(
      segId,
      { start: 27, end: 32 },
      (id, o) => render.voiceParagraph(id, { spoken: o.text, origin: o.origin }).then((v) => v.sound_id),
      (t) => t,
    );
    expect(plan.mode).toBe("sentence");
    expect(h.spoken).toEqual(["Then it slept soundly, dreaming of hens."]);
  });

  it("keeps takes in its own table on the shared connection", () => {
    expect(voiceStores(h.svc.db).takes.list("nope")).toEqual([]);
    const row = h.svc.db.conn.prepare("SELECT name FROM sqlite_master WHERE name = 'segment_takes'").get();
    expect(row).toBeTruthy();
  });
});
