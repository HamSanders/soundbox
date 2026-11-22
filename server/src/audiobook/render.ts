/**
 * Audiobooks: voicing paragraphs and render runs.
 *
 * `voiceParagraph` is the one path every audiobook generation takes: it picks
 * the model and voice, applies pronunciation, and generates through the
 * existing segment path inside a queued "segment" job, so book renders share
 * the GPU queue with everything else and show in the jobs list.
 *
 * A render run walks paragraphs in reading order and voices each that needs
 * it, with QC and up to two retries. The run's state is in `book_renders`, so
 * a restart resumes it, and progress goes out on the book's event stream.
 *
 * Model choice for a paragraph, first that applies:
 *   1. the paragraph's own model override;
 *   2. its character's model (multi cast);
 *   3. the model its voice was made on, when installed (a clone read on
 *      another family does not sound like the voice);
 *   4. the book's default model;
 *   5. a ready TTS model, preferring the loaded one.
 * The voice is the segment's (core writes character, then narrator, onto it),
 * else the book's answer for the paragraph's character.
 */

import { randomInt } from "node:crypto";
import { join } from "node:path";

import * as dsp from "../audio/dsp.js";
import { ModelError } from "../errors.js";
import type { Job } from "../schemas.js";
import type { JobHandle } from "../jobs.js";
import type { MirliService } from "../service.js";
import { dialogueParts, type SpokenPart } from "./dialogue-parts.js";
import { applyPronunciations, type PronounceResult } from "./pronounce.js";
import type { BookAccess, BookParagraph } from "./render-access.js";
import { voiceStores } from "./render-access.js";
import { estimate, layoutChapter, qcClip, type Estimate, type EstimateParagraph, type QcResult } from "./render-qc.js";
import type { RenderOptions, RenderRunDetail } from "./render-store.js";
import type { TakeOrigin } from "./takes-store.js";
import type { RenderScope } from "./types.js";

export interface VoiceChoice {
  model: string;
  voice_id: string | null;
  /** Why this model, for the UI. */
  source: "paragraph" | "character" | "voice" | "book" | "fallback";
  notes: string[];
}

export interface VoicedParagraph {
  sound_id: string;
  take_id: string | null;
  model: string;
  spoken_text: string;
  warnings: string[];
  gen_ms: number;
}

/** Run `work` as a queued job of `kind` and wait for it. */
export async function runAsJob<T>(
  svc: MirliService,
  kind: Job["kind"],
  request: Record<string, unknown>,
  work: (handle: JobHandle) => Promise<T>,
  onJob?: (jobId: string) => void,
): Promise<T> {
  let out: { value: T } | null = null;
  const job = svc.jobs.submit(kind, request, async (handle) => {
    const value = await work(handle);
    out = { value };
    const sound = (value as { sound_id?: string } | null)?.sound_id;
    return { sounds: sound ? [sound] : [], segment_id: request.segment_id ?? null };
  });
  onJob?.(job.id);
  const q = svc.jobs.subscribe(job.id);
  try {
    for await (const j of q) {
      if (j.status === "done") return (out as { value: T } | null)!.value;
      if (j.status === "error") throw new ModelError(j.error ?? "Generation failed.");
      if (j.status === "cancelled") throw new RenderCancelled();
    }
  } finally {
    svc.jobs.unsubscribe(job.id, q);
  }
  throw new ModelError("The job ended without a result.");
}

export class RenderCancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

/** Retries are capped at two, as ElevenLabs' Auto-Regenerate does. */
export const MAX_RETRIES = 2;

export class RenderService {
  /** Runs this process is driving. */
  private readonly driving = new Set<string>();
  /** The job currently voicing for a run, so cancel can stop it. */
  private readonly currentJob = new Map<string, string>();

  constructor(
    private readonly svc: MirliService,
    private readonly book: BookAccess,
  ) {}

  private get stores() {
    return voiceStores(this.svc.db);
  }

  /* --------------------------------------------------------- one paragraph */

  async chooseVoice(p: BookParagraph, bookId: string): Promise<VoiceChoice> {
    const notes: string[] = [];
    const book = this.book.getBook(bookId);
    const character = p.character_id ? this.book.getCharacter(p.character_id) : null;
    const voiceId = p.voice_id ?? this.book.voiceFor(bookId, p.character_id) ?? null;
    const voice = voiceId ? this.svc.getVoice(voiceId) : null;
    const models = await this.svc.listModels();
    const ready = models.filter((m) => m.task === "tts" && (m.status === "loaded" || m.status === "installed"));
    const isReady = (id: string | null | undefined) => Boolean(id && ready.some((m) => m.id === id));

    // The voice decides: a voice is made on a model, and read on another it
    // stops sounding like itself. Only a paragraph's own override beats it;
    // the older character and book settings are fallbacks for a voice whose
    // model isn't installed (or that has none).
    if (p.model_id) return { model: p.model_id, voice_id: voiceId, source: "paragraph", notes };
    if (voice?.model_id) {
      if (isReady(voice.model_id)) return { model: voice.model_id, voice_id: voiceId, source: "voice", notes };
      notes.push(`${voice.name} was made on ${voice.model_id}, which is not installed.`);
    }
    if (book?.settings.cast_mode === "multi" && character?.model_id) {
      return { model: character.model_id, voice_id: voiceId, source: "character", notes };
    }
    if (book?.settings.model_id) return { model: book.settings.model_id, voice_id: voiceId, source: "book", notes };
    if (!ready.length) throw new ModelError("No text-to-speech model is installed. Download one from the Models page.");
    // Never fall back onto a model that may charge per render: that has to
    // be chosen, by the voice or the paragraph.
    const free = ready.filter((m) => !m.metered);
    if (!free.length) {
      throw new ModelError("Only metered models are ready. Give this voice a model in Voice Lab, or pick one for the paragraph under Advanced.");
    }
    return { model: (free.find((m) => m.status === "loaded") ?? free[0]!).id, voice_id: voiceId, source: "fallback", notes };
  }

  /** The text a model should read for a paragraph, pronunciation applied. */
  pronounced(bookId: string, text: string, model: string): PronounceResult {
    return applyPronunciations(text, this.stores.pronunciations.rulesFor(bookId), model);
  }

  /**
   * Voice one paragraph (or `spoken`, already-pronounced text for part of it)
   * through the job queue. Records the take's timing and marks the paragraph
   * voiced, unless this is a selection fragment.
   */
  async voiceParagraph(
    segmentId: string,
    opts: { spoken?: string; origin?: TakeOrigin; seed?: number | null; onJob?: (id: string) => void; cancelled?: () => boolean } = {},
  ): Promise<VoicedParagraph> {
    const p = this.book.getParagraph(segmentId);
    const chapter = this.book.chapterForSegment(segmentId);
    if (!p || !chapter) throw new ModelError("Paragraph not found.");
    if (p.locked) throw new ModelError("This paragraph is locked.");
    if (p.kind === "pause") throw new ModelError("A pause has nothing to voice.");
    const choice = await this.chooseVoice(p, chapter.book_id);
    const pr = opts.spoken !== undefined
      ? { text: opts.spoken, warnings: [] as string[], applied: [] }
      : this.pronounced(chapter.book_id, p.text, choice.model);
    // Dialogue-only casting: a character reads the quoted words, the narrator
    // the rest ("she said"). Not for selection fragments, which are already
    // a piece of one voice's take.
    const book = this.book.getBook(chapter.book_id);
    const pieces = opts.spoken === undefined && p.character_id && book?.settings.dialogue_only !== false
      ? dialogueParts(p.text)
      : null;
    let parts: SpokenPart[] | undefined;
    if (pieces) {
      const narrator = await this.chooseVoice({ ...p, character_id: null, voice_id: null }, chapter.book_id);
      parts = pieces.map((piece) => {
        const c = piece.quote ? choice : narrator;
        const said = this.pronounced(chapter.book_id, piece.text, c.model);
        pr.warnings.push(...said.warnings.filter((w) => !pr.warnings.includes(w)));
        return { text: said.text, voice_id: c.voice_id, model: c.model };
      });
    }
    const spokenText = parts ? parts.map((x) => x.text).join(" ") : pr.text;
    const seed = opts.seed === undefined ? randomInt(0, 2 ** 31 - 1) : opts.seed;
    const origin = opts.origin ?? "generate";

    const result = await runAsJob(
      this.svc,
      "segment",
      { model: choice.model, segment_id: segmentId, audiobook: origin },
      async (handle) => {
        // The run may have been cancelled (or its book deleted) while queued.
        if (opts.cancelled?.()) {
          handle.cancel();
          handle.checkCancelled();
        }
        const t0 = performance.now();
        const seg = await this.svc.generateSegment(
          segmentId,
          { model: choice.model, seed, load_options: {}, text: spokenText },
          handle,
          parts,
        );
        if (!seg?.sound_id) throw new ModelError("No audio was written.");
        return { sound_id: seg.sound_id, gen_ms: performance.now() - t0, duration_s: seg.duration_s ?? 0 };
      },
      opts.onJob,
    );

    let takeId: string | null = null;
    if (origin !== "selection") {
      const take = this.stores.takes.forSound(result.sound_id);
      if (take) {
        this.stores.takes.setTiming(take.id, result.gen_ms, result.duration_s, origin);
        takeId = take.id;
      }
      this.book.markVoiced(segmentId, p.text);
    }
    return {
      sound_id: result.sound_id,
      take_id: takeId,
      model: choice.model,
      spoken_text: spokenText,
      warnings: [...choice.notes, ...pr.warnings],
      gen_ms: result.gen_ms,
    };
  }

  /** QC a voiced paragraph's audio. `transcript` comes from ASR when used. */
  qc(soundId: string, text: string, model: string, transcript?: string | null): QcResult {
    const file = this.svc.db.getFilename(soundId);
    if (!file) throw new ModelError("The paragraph's audio is missing.");
    const { audio, sampleRate } = dsp.readWav(join(this.svc.config.paths.sounds, file));
    const rate = this.stores.takes.realTimeFactors().get(model);
    return qcClip(audio, sampleRate, text, {
      charsPerS: rate && rate.samples >= 5 ? rate.chars_per_s : undefined,
      transcript,
    });
  }

  /** What an installed ASR model hears in a sound, via the transcribe job. */
  async transcribe(soundId: string, asrModel: string, language: string | null): Promise<string> {
    const file = this.svc.db.getFilename(soundId);
    if (!file) throw new ModelError("The paragraph's audio is missing.");
    const clip = dsp.readWav(join(this.svc.config.paths.sounds, file));
    const job = this.svc.submitTranscribe(clip, asrModel, language);
    const q = this.svc.jobs.subscribe(job.id);
    try {
      const now = this.svc.jobs.get(job.id);
      if (now?.status === "done") return String(now.result?.text ?? "");
      for await (const j of q) {
        if (j.status === "done") return String(j.result?.text ?? "");
        if (j.status === "error" || j.status === "cancelled") throw new ModelError(j.error ?? "Transcription failed.");
      }
    } finally {
      this.svc.jobs.unsubscribe(job.id, q);
    }
    throw new ModelError("Transcription ended without a result.");
  }

  /** An installed ASR model, preferring Qwen3-ASR. */
  async asrModel(): Promise<string | null> {
    const asr = (await this.svc.listModels()).filter(
      (m) => m.task === "asr" && (m.status === "loaded" || m.status === "installed"),
    );
    return (asr.find((m) => /qwen3.?asr/i.test(m.id)) ?? asr[0])?.id ?? null;
  }

  /** Re-lay a chapter's timeline with the book's pacing. */
  layout(chapterId: string): number {
    const chapter = this.book.getChapter(chapterId);
    const book = chapter ? this.book.getBook(chapter.book_id) : null;
    const paragraphs = this.book.getParagraphs(chapterId);
    if (!chapter || !book || !paragraphs) return 0;
    const ordered = [...paragraphs].sort((a, b) => a.position - b.position);
    const moves = layoutChapter(
      ordered.map((p) => ({
        id: p.id,
        kind: p.kind,
        start_s: p.start_s,
        duration_s: p.kind === "pause" ? (p.duration_s ?? 0) : p.sound_id ? (p.duration_s ?? 0) : null,
        is_heading: p.is_heading,
      })),
      book.settings.pacing,
    );
    for (const [id, start] of moves) this.svc.db.updateSegment(id, { start_s: start });
    if (moves.size) this.svc.stories.changed(chapter.story_id);
    return moves.size;
  }

  /* ------------------------------------------------------------------ runs */

  /** Paragraph ids a scope covers, in reading order. */
  scopeSegments(bookId: string, scope: RenderScope): { chapter_id: string; ids: string[] }[] {
    const book = this.book.getBook(bookId);
    if (!book) throw new ModelError("Book not found.");
    if (scope.kind === "paragraphs") {
      const out = new Map<string, string[]>();
      for (const id of scope.segment_ids) {
        const c = this.book.chapterForSegment(id);
        if (!c || c.book_id !== bookId) continue;
        out.set(c.id, [...(out.get(c.id) ?? []), id]);
      }
      return [...out].map(([chapter_id, ids]) => ({ chapter_id, ids }));
    }
    const chapters = [...book.chapters]
      .sort((a, b) => a.position - b.position)
      .filter((c) => (scope.kind === "chapter" ? c.id === scope.chapter_id : c.included));
    return chapters.map((c) => ({
      chapter_id: c.id,
      ids: [...(this.book.getParagraphs(c.id) ?? [])].sort((a, b) => a.position - b.position).map((p) => p.id),
    }));
  }

  /** Does a render with `overwrite` voice this paragraph? Stale counts as
   *  needing a voice: its audio no longer matches its text or voice. */
  needsVoice(p: BookParagraph, overwrite: boolean): boolean {
    if (p.kind === "pause" || p.locked || !p.text.trim()) return false;
    return overwrite || !p.sound_id || p.status === "stale";
  }

  start(bookId: string, scope: RenderScope, overwrite: boolean, options: Partial<RenderOptions> = {}): RenderRunDetail {
    const queue = this.scopeSegments(bookId, scope).flatMap((c) => c.ids);
    const opts: RenderOptions = {
      max_retries: Math.max(0, Math.min(MAX_RETRIES, options.max_retries ?? MAX_RETRIES)),
      asr_model: options.asr_model ?? null,
    };
    const run = this.stores.renders.create(bookId, scope, overwrite, queue, opts);
    this.stores.renders.update(run.id, { status: "running" });
    this.drive(run.id);
    return this.stores.renders.get(run.id)!;
  }

  list(bookId: string): RenderRunDetail[] {
    return this.stores.renders.list(bookId);
  }

  get(runId: string): RenderRunDetail | null {
    return this.stores.renders.get(runId);
  }

  /** Stop after the paragraph in progress. */
  pause(runId: string): RenderRunDetail | null {
    const run = this.stores.renders.get(runId);
    if (!run) return null;
    if (run.status === "running" || run.status === "queued") {
      this.stores.renders.update(runId, { status: "paused" });
      this.publish(runId);
    }
    return this.stores.renders.get(runId);
  }

  resume(runId: string): RenderRunDetail | null {
    const run = this.stores.renders.get(runId);
    if (!run) return null;
    if (run.status === "paused" || run.status === "failed") {
      this.stores.renders.update(runId, { status: "running", error: null });
      this.drive(runId);
      this.publish(runId);
    }
    return this.stores.renders.get(runId);
  }

  cancel(runId: string): RenderRunDetail | null {
    const run = this.stores.renders.get(runId);
    if (!run) return null;
    if (!["done", "cancelled"].includes(run.status)) {
      this.stores.renders.update(runId, { status: "cancelled", current_segment_id: null });
      const job = this.currentJob.get(runId);
      if (job) this.svc.jobs.cancel(job);
      this.publish(runId);
    }
    return this.stores.renders.get(runId);
  }

  /** Pick up runs that were going when the server stopped. */
  resumeUnfinished(): string[] {
    const ids: string[] = [];
    for (const run of this.stores.renders.unfinished()) {
      this.stores.renders.update(run.id, { status: "running" });
      this.drive(run.id);
      ids.push(run.id);
    }
    return ids;
  }

  /** Resolves when the run stops (done, paused, cancelled or failed). For tests. */
  async settled(runId: string): Promise<RenderRunDetail> {
    while (this.driving.has(runId)) await new Promise((r) => setTimeout(r, 5));
    return this.stores.renders.get(runId)!;
  }

  private drive(runId: string): void {
    if (this.driving.has(runId)) return;
    this.driving.add(runId);
    void this.loop(runId)
      .catch((e: unknown) => {
        this.stores.renders.update(runId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
        this.publish(runId);
      })
      .finally(() => {
        this.driving.delete(runId);
        this.currentJob.delete(runId);
      });
  }

  private async loop(runId: string): Promise<void> {
    const renders = this.stores.renders;
    let failStreak = 0;
    for (;;) {
      const run = renders.get(runId);
      if (!run || run.status !== "running") return;
      const [next, ...rest] = run.queue;
      if (!next) {
        renders.update(runId, { status: "done", current_segment_id: null });
        this.publish(runId);
        return;
      }
      const p = this.book.getParagraph(next);
      const chapter = this.book.chapterForSegment(next);
      if (!p || !chapter || !this.needsVoice(p, run.overwrite)) {
        renders.update(runId, { queue: rest, skipped: run.skipped + 1 });
        continue;
      }
      renders.update(runId, { current_segment_id: next });
      this.publish(runId);

      const book = this.book.getBook(chapter.book_id);
      const attempts: { take_id: string | null; sound_id: string; qc: QcResult }[] = [];
      let lastError: string | null = null;
      for (let attempt = 0; attempt <= run.options.max_retries; attempt++) {
        if (renders.get(runId)?.status === "cancelled") return;
        try {
          const voiced = await this.voiceParagraph(next, {
            origin: "render",
            onJob: (id) => this.currentJob.set(runId, id),
            cancelled: () => renders.get(runId)?.status !== "running",
          });
          let transcript: string | null | undefined;
          if (run.options.asr_model) {
            try {
              transcript = await this.transcribe(voiced.sound_id, run.options.asr_model, book?.language ?? null);
            } catch (e) {
              transcript = undefined;
              renders.appendLog(runId, this.entry(next, attempt, "warning", ["words"], `Word check skipped: ${(e as Error).message}`));
            }
          }
          const qc = this.qc(voiced.sound_id, p.text, voiced.model, transcript);
          attempts.push({ take_id: voiced.take_id, sound_id: voiced.sound_id, qc });
          for (const w of voiced.warnings) renders.appendLog(runId, this.entry(next, attempt, "warning", [], w));
          if (qc.pass) {
            if (qc.warnings.length) renders.appendLog(runId, this.entry(next, attempt, "warning", qc.warnings, qc.message));
            break;
          }
          const last = attempt === run.options.max_retries;
          renders.appendLog(runId, this.entry(next, attempt + 1, last ? "failed" : "retry", qc.failed, qc.message));
        } catch (e) {
          if (e instanceof RenderCancelled || renders.get(runId)?.status === "cancelled") return;
          lastError = e instanceof Error ? e.message : String(e);
          const last = attempt === run.options.max_retries;
          renders.appendLog(runId, this.entry(next, attempt + 1, last ? "failed" : "retry", ["error"], lastError));
        }
      }

      const now = renders.get(runId)!;
      const best = attempts.reduce<(typeof attempts)[number] | null>(
        (b, a) => (b === null || a.qc.failed.length < b.qc.failed.length ? a : b),
        null,
      );
      // Keep the best attempt on the timeline; the others stay as takes.
      if (best && best.take_id && attempts[attempts.length - 1] !== best) {
        try {
          const sound = this.svc.getSound(best.sound_id);
          if (sound) this.svc.db.setSegmentSound(next, sound.id, sound.duration_s);
        } catch {
          /* keep the last attempt */
        }
      }
      const ok = Boolean(best?.qc.pass);
      if (ok) failStreak = 0;
      else failStreak++;
      renders.update(runId, {
        queue: rest,
        done: now.done + (ok ? 1 : 0),
        failed: now.failed + (ok ? 0 : 1),
        current_segment_id: null,
      });
      if (attempts.length) this.layout(chapter.id);
      this.book.hub.publish(chapter.book_id, { type: "paragraphs", chapter_id: chapter.id, segment_ids: [next] });
      this.publish(runId);

      // A run where nothing can be voiced (no model, model fails to load)
      // stops instead of burning through the whole book.
      if (failStreak >= 3 && attempts.length === 0 && lastError) {
        renders.update(runId, { status: "failed", error: lastError });
        this.publish(runId);
        return;
      }
    }
  }

  private entry(segmentId: string, attempt: number, outcome: "retry" | "failed" | "warning", checks: string[], message: string) {
    return { segment_id: segmentId, attempt, outcome, checks, message, at: new Date().toISOString() };
  }

  private publish(runId: string): void {
    const run = this.stores.renders.get(runId);
    if (!run) return;
    const { queue: _q, log, ...rest } = run;
    this.book.hub.publish(run.book_id, { type: "render", run: { ...rest, log: log.slice(-20) } });
  }

  /* -------------------------------------------------------------- estimate */

  async estimate(bookId: string, scope: RenderScope = { kind: "book" }, overwrite = false): Promise<Estimate> {
    const book = this.book.getBook(bookId);
    if (!book) throw new ModelError("Book not found.");
    const parts = this.scopeSegments(bookId, scope);
    const wanted = new Set(parts.flatMap((p) => p.ids));
    const paragraphs: EstimateParagraph[] = [];
    // Each line is estimated on the model it will actually be read on; one
    // lookup per distinct override / voice / character.
    const chosen = new Map<string, string | null>();
    for (const part of parts) {
      for (const p of this.book.getParagraphs(part.chapter_id) ?? []) {
        if (!wanted.has(p.id)) continue;
        let model: string | null = p.model_id ?? null;
        if (!model && p.kind === "line") {
          const key = `${p.voice_id ?? ""}|${p.character_id ?? ""}`;
          if (!chosen.has(key)) {
            try {
              chosen.set(key, (await this.chooseVoice(p, bookId)).model);
            } catch {
              chosen.set(key, null);
            }
          }
          model = chosen.get(key) ?? null;
        }
        paragraphs.push({
          chapter_id: part.chapter_id,
          text: p.text,
          kind: p.kind,
          to_voice: this.needsVoice(p, overwrite),
          duration_s: p.sound_id ? (p.duration_s ?? null) : p.kind === "pause" ? (p.duration_s ?? 0) : null,
          model_id: model,
        });
      }
    }
    const titles = new Map(book.chapters.map((c) => [c.id, c.title]));
    return estimate(
      parts.map((p) => ({ id: p.chapter_id, title: titles.get(p.chapter_id) ?? "" })),
      paragraphs,
      this.stores.takes.realTimeFactors(),
      book.settings.pacing,
    );
  }
}
