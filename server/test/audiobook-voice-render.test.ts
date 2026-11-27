/**
 * Audiobook render: QC checks and estimates on synthetic audio, pacing
 * layout, and render runs on a real MirliService with a stubbed TTS model.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { voiceStores } from "../src/audiobook/render-access.js";
import { estimate, layoutChapter, qcClip, wordErrorRate, placeholderSeconds } from "../src/audiobook/render-qc.js";
import { RenderService } from "../src/audiobook/render.js";
import { recordTakes } from "../src/audiobook/takes.js";
import { fakeSpeech, harness, SR, type Harness } from "./audiobook-voice-helpers.js";

const LINE = "The fox ran home through the long grass, and the hens all watched it go.";

describe("qcClip", () => {
  it("passes ordinary speech", () => {
    const r = qcClip([fakeSpeech(LINE)], SR, LINE);
    expect(r.failed).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it("fails silence", () => {
    const r = qcClip([new Float32Array(SR * 4)], SR, LINE);
    expect(r.failed).toEqual(["silence"]);
  });

  it("fails clipping", () => {
    const a = fakeSpeech(LINE, 1.6).map((x) => Math.max(-1, Math.min(1, x)));
    expect(qcClip([a], SR, LINE).failed).toContain("clipping");
  });

  it("fails a length far from the text", () => {
    const short = fakeSpeech("Fox ran far.");
    expect(qcClip([short], SR, LINE.repeat(3)).failed).toContain("length");
    const long = fakeSpeech(LINE.repeat(6));
    expect(qcClip([long], SR, "Fox ran.").failed).toContain("length");
  });

  it("checks words against an ASR transcript", () => {
    expect(wordErrorRate("The fox ran home.", "the fox ran home")).toBe(0);
    expect(wordErrorRate("The fox ran home.", "a box ran")).toBe(0.75);
    const bad = qcClip([fakeSpeech(LINE)], SR, LINE, { transcript: "completely different words were heard here" });
    expect(bad.failed).toEqual(["words"]);
    const close = qcClip([fakeSpeech(LINE)], SR, LINE, { transcript: LINE.replace("long", "tall").replace("hens", "hen").replace("watched", "saw") });
    expect(close.pass).toBe(true);
    expect(close.warnings).toEqual(["words"]);
  });
});

describe("estimate", () => {
  it("uses measured rates where there is history and defaults elsewhere", () => {
    const e = estimate(
      [{ id: "a", title: "A" }, { id: "b", title: "B" }],
      [
        { chapter_id: "a", text: "x".repeat(140), kind: "line", to_voice: true, duration_s: null, model_id: "m1" },
        { chapter_id: "a", text: "", kind: "pause", to_voice: false, duration_s: 2, model_id: null },
        { chapter_id: "b", text: "y".repeat(140), kind: "line", to_voice: false, duration_s: 9, model_id: "m2" },
      ],
      new Map([["m1", { rtf: 0.5, chars_per_s: 20, samples: 10 }]]),
      { paragraph_gap_s: 1 },
    );
    expect(e.chapters[0]).toMatchObject({ to_voice: 1, characters: 140, audio_s: 7 + 2 + 1, render_s: 4 });
    expect(e.chapters[1]).toMatchObject({ to_voice: 0, audio_s: 10, render_s: 0 });
    expect(e.basis.find((b) => b.model_id === "m1")!.measured).toBe(true);
    expect(e.total.render_s).toBe(4);
  });
});

describe("layoutChapter", () => {
  it("lays paragraphs end to end with gaps, headings and pauses", () => {
    const moves = layoutChapter(
      [
        { id: "h", kind: "line", start_s: 0, duration_s: 2, is_heading: true },
        { id: "a", kind: "line", start_s: 0, duration_s: 3, is_heading: false },
        { id: "u", kind: "line", start_s: 0, duration_s: null, is_heading: false, placeholder_s: 1 },
        { id: "p", kind: "pause", start_s: 0, duration_s: 1, is_heading: false },
        { id: "b", kind: "line", start_s: 0, duration_s: 1, is_heading: false },
      ],
      { paragraph_gap_s: 0.5, heading_gap_s: 1.5 },
    );
    // h 0–2, a 4–7, u 7.5–8.5 (unvoiced, its placeholder), p 9–10, b 10.
    expect(Object.fromEntries(moves)).toEqual({ a: 4, u: 7.5, p: 9, b: 10 });
  });

  it("gives an unvoiced paragraph its placeholder length, so nothing stacks", () => {
    const moves = layoutChapter(
      [
        { id: "a", kind: "line", start_s: 0, duration_s: 3, is_heading: false },
        { id: "u", kind: "line", start_s: 0, duration_s: null, is_heading: false, placeholder_s: 2 },
        { id: "v", kind: "line", start_s: 0, duration_s: null, is_heading: false, placeholder_s: 1 },
        { id: "b", kind: "line", start_s: 0, duration_s: 1, is_heading: false },
      ],
      { paragraph_gap_s: 0.5, heading_gap_s: 1.5 },
    );
    expect(Object.fromEntries(moves)).toEqual({ u: 3.5, v: 6, b: 7.5 });
  });

  it("estimates a placeholder at 0.4 s a word, at least 0.8 s", () => {
    expect(placeholderSeconds("one two three four five")).toBe(2);
    expect(placeholderSeconds("Hi.")).toBe(0.8);
  });
});

describe("RenderService", { timeout: 30_000 }, () => {
  let h: Harness;
  let render: RenderService;
  let chapterId: string;

  beforeEach(async () => {
    h = await harness();
    recordTakes(h.svc);
    render = new RenderService(h.svc, h.book);
    const ch = h.book.addChapter("Chapter One", [
      { text: "Chapter One", heading: true },
      "Tamsin climbed aboard.",
      { pause: 1.5 },
      { text: "This one is locked.", locked: true },
      "The ship left at dawn.",
    ]);
    chapterId = ch.id;
    h.book.addChapter("Chapter Two", ["Second chapter text."]);
  });
  afterEach(async () => h.close());

  const paras = () => h.book.getParagraphs(chapterId)!;

  it("voices a chapter in order, skipping pauses and locked paragraphs, and paces the timeline", async () => {
    voiceStores(h.svc.db).pronunciations.create("book1", { term: "Tamsin", replacement: "TAM-sin" });
    const run = render.start("book1", { kind: "chapter", chapter_id: chapterId }, false);
    const done = await render.settled(run.id);
    expect(done.status).toBe("done");
    expect(done.done).toBe(3);
    expect(done.skipped).toBe(2);
    expect(h.spoken).toEqual(["Chapter One", "TAM-sin climbed aboard.", "The ship left at dawn."]);
    const p = paras();
    const [head, a, pause, , b] = p;
    expect(head!.start_s).toBe(0);
    expect(a!.start_s).toBeCloseTo(head!.duration_s! + 0.5 + 1.5, 2);
    expect(pause!.start_s).toBeCloseTo(a!.start_s + a!.duration_s! + 0.5, 2);
    // The locked paragraph between them is unvoiced, so it holds its
    // placeholder (four words, 1.6 s) and its gap rather than taking no time.
    expect(p[3]!.sound_id).toBeFalsy();
    expect(p[3]!.start_s).toBeCloseTo(pause!.start_s + 1.5, 2);
    expect(b!.start_s).toBeCloseTo(p[3]!.start_s + 1.6 + 0.5, 2);
    // Core was told what each take was voiced from (unpronounced text).
    expect(h.book.voiced.map((v) => v.text)).toContain("Tamsin climbed aboard.");
    expect(h.book.events.some((e) => e.event.type === "render")).toBe(true);
  });

  it("skips voiced paragraphs unless overwrite is set", async () => {
    await render.settled(render.start("book1", { kind: "chapter", chapter_id: chapterId }, false).id);
    h.spoken.length = 0;
    const again = await render.settled(render.start("book1", { kind: "chapter", chapter_id: chapterId }, false).id);
    expect(again.done).toBe(0);
    expect(h.spoken).toEqual([]);
    const over = await render.settled(render.start("book1", { kind: "chapter", chapter_id: chapterId }, true).id);
    expect(over.done).toBe(3);
  });

  it("renders the whole book across included chapters only", async () => {
    h.book.chapters[1]!.included = false;
    const run = await render.settled(render.start("book1", { kind: "book" }, false).id);
    expect(run.total).toBe(5);
    expect(h.spoken).not.toContain("Second chapter text.");
  });

  it("retries a paragraph that fails QC and logs why", async () => {
    h.failNext(1);
    const id = paras()[1]!.id;
    const run = await render.settled(render.start("book1", { kind: "paragraphs", segment_ids: [id] }, false).id);
    expect(run.done).toBe(1);
    expect(run.log).toHaveLength(1);
    expect(run.log[0]).toMatchObject({ segment_id: id, outcome: "retry", checks: ["silence"] });
    // Both attempts are takes; the good one is on the timeline.
    const takes = voiceStores(h.svc.db).takes.list(id);
    expect(takes).toHaveLength(2);
    expect(takes.find((t) => t.selected)!.id).toBe(takes[0]!.id);
  });

  it("gives up after two retries, keeps the best attempt and counts a failure", async () => {
    h.failNext(3);
    const id = paras()[1]!.id;
    const run = await render.settled(render.start("book1", { kind: "paragraphs", segment_ids: [id] }, false).id);
    expect(run.failed).toBe(1);
    expect(run.log.map((l) => l.outcome)).toEqual(["retry", "retry", "failed"]);
    expect(h.spoken).toHaveLength(3);
  });

  it("pauses, resumes and cancels", async () => {
    const run = render.start("book1", { kind: "chapter", chapter_id: chapterId }, false);
    render.pause(run.id);
    const paused = await render.settled(run.id);
    expect(paused.status).toBe("paused");
    expect(paused.done).toBeLessThan(3);
    render.resume(run.id);
    const done = await render.settled(run.id);
    expect(done.status).toBe("done");
    expect(done.done + done.failed).toBe(3);

    const second = render.start("book1", { kind: "chapter", chapter_id: chapterId }, true);
    render.cancel(second.id);
    expect((await render.settled(second.id)).status).toBe("cancelled");
  });

  it("resumes unfinished runs after a restart", async () => {
    const stores = voiceStores(h.svc.db);
    const ids = paras().map((p) => p.id);
    const run = stores.renders.create("book1", { kind: "chapter", chapter_id: chapterId }, false, ids, { max_retries: 2, asr_model: null });
    stores.renders.update(run.id, { status: "running", queue: ids.slice(2), done: 2 });
    // A fresh service, as after a restart.
    const again = new RenderService(h.svc, h.book);
    expect(again.resumeUnfinished()).toEqual([run.id]);
    const done = await again.settled(run.id);
    expect(done.status).toBe("done");
    expect(h.spoken).toEqual(["The ship left at dawn."]);
  });

  it("estimates a chapter before rendering", async () => {
    const e = await render.estimate("book1", { kind: "chapter", chapter_id: chapterId });
    expect(e.chapters).toHaveLength(1);
    expect(e.chapters[0]).toMatchObject({ paragraphs: 5, to_voice: 3 });
    expect(e.total.audio_s).toBeGreaterThan(0);
    expect(e.basis[0]!.measured).toBe(false);
  });
});
