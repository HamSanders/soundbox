/**
 * Audiobooks voice routes: cast, pronunciation, takes and render runs.
 * Every path is under `/api/audiobooks/:id`, except the global pronunciation
 * dictionary at `/api/pronunciations`. See docs/audiobooks/PLAN.md.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { CastService } from "../audiobook/cast.js";
import { PronounceService } from "../audiobook/pronounce-service.js";
import type { BookAccess } from "../audiobook/render-access.js";
import { voiceStores } from "../audiobook/render-access.js";
import { MAX_RETRIES, RenderService } from "../audiobook/render.js";
import { audiobooks } from "../audiobook/service.js";
import { recordTakes, TakesService } from "../audiobook/takes.js";
import type { MirliService } from "../service.js";
import { HttpError } from "./helpers.js";

type BookParams = { Params: { id: string } };
type CharParams = { Params: { id: string; chid: string } };
type RuleParams = { Params: { id: string; rid: string } };
type GlobalRuleParams = { Params: { rid: string } };
type ParaParams = { Params: { id: string; sid: string } };
type TakeParams = { Params: { id: string; sid: string; tid: string } };
type RunParams = { Params: { id: string; rid: string } };

const characterSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    aliases: z.array(z.string().max(200)).max(50),
    description: z.string().max(2000).nullable(),
    voice_id: z.string().max(200).nullable(),
    model_id: z.string().max(200).nullable(),
    request_options: z.record(z.string(), z.unknown()),
    color: z.number().int().min(0).max(63),
  })
  .partial();

const ruleSchema = z.object({
  term: z.string().max(200),
  kind: z.enum(["alias", "ipa", "cmu"]).default("alias"),
  replacement: z.string().max(500),
  case_sensitive: z.boolean().optional(),
  whole_word: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("book") }),
  z.object({ kind: z.literal("chapter"), chapter_id: z.string() }),
  z.object({ kind: z.literal("paragraphs"), segment_ids: z.array(z.string()).min(1).max(5000) }),
]);

const renderSchema = z.object({
  scope: scopeSchema.default({ kind: "book" }),
  overwrite: z.boolean().default(false),
  max_retries: z.number().int().min(0).max(MAX_RETRIES).optional(),
  /** Check words with an installed ASR model. Slower: the TTS and ASR models swap per paragraph. */
  asr_check: z.boolean().default(false),
});

export interface VoiceServices {
  book: ReturnType<typeof audiobooks>;
  render: RenderService;
  takes: TakesService;
  cast: CastService;
  pronounce: PronounceService;
}

const services = new WeakMap<MirliService, VoiceServices>();

/** The voice area's services for this server. */
export function voiceServices(svc: MirliService): VoiceServices {
  let s = services.get(svc);
  if (!s) {
    const book = audiobooks(svc);
    const access: BookAccess = book;
    const render = new RenderService(svc, access);
    s = {
      book,
      render,
      takes: new TakesService(svc, access),
      cast: new CastService(svc, access, render),
      pronounce: new PronounceService(svc, book, render),
    };
    services.set(svc, s);
    recordTakes(svc);
    // Rows that point at a deleted book's or chapter's segments go with it.
    book.onDelete((scope) => {
      const stores = voiceStores(svc.db);
      const ids = scope.story_ids.flatMap((sid) => svc.db.listSegments(sid).map((x) => x.id));
      stores.takes.deleteForSegments(ids);
      if (!book.getBook(scope.book_id) || scope.chapter_ids.length === book.getBook(scope.book_id)!.chapters.length) {
        for (const run of render.list(scope.book_id)) {
          if (["queued", "running", "paused"].includes(run.status)) render.cancel(run.id);
        }
        stores.renders.deleteBook(scope.book_id);
        stores.pronunciations.deleteBook(scope.book_id);
      }
    });
  }
  return s;
}

export function registerAudiobookVoice(app: FastifyInstance, svc: MirliService): void {
  void app.register(async (scope) => {
    for (const mime of ["text/plain", "application/xml", "text/xml", "application/pls+xml", "application/octet-stream"]) {
      if (scope.hasContentTypeParser(mime)) scope.removeContentTypeParser(mime);
      scope.addContentTypeParser(mime, { parseAs: "string" }, (_req, body, done) => done(null, body));
    }
    routes(scope, svc);
  });
  // Pick up render runs that were going when the server last stopped.
  app.addHook("onReady", async () => {
    try {
      voiceServices(svc).render.resumeUnfinished();
    } catch {
      /* a fresh database has nothing to resume */
    }
  });
}

function routes(app: FastifyInstance, svc: MirliService): void {
  const s = () => voiceServices(svc);
  const requireBook = (id: string) => {
    const b = s().book.getBook(id);
    if (!b) throw new HttpError(404, "Book not found");
    return b;
  };
  const requireCharacter = (bookId: string, chid: string) => {
    const c = s().book.getCharacter(chid);
    if (!c || c.book_id !== bookId) throw new HttpError(404, "Character not found");
    return c;
  };
  const requireParagraph = (bookId: string, sid: string) => {
    const chapter = s().book.chapterForSegment(sid);
    if (!chapter || chapter.book_id !== bookId) throw new HttpError(404, "Paragraph not found");
    return chapter;
  };
  const requireRule = (bookId: string | null, rid: string) => {
    const r = voiceStores(svc.db).pronunciations.get(rid);
    if (!r || r.book_id !== bookId) throw new HttpError(404, "Rule not found");
    return r;
  };
  const requireRun = (bookId: string, rid: string) => {
    const r = s().render.get(rid);
    if (!r || r.book_id !== bookId) throw new HttpError(404, "Render not found");
    return r;
  };

  /* ------------------------------------------------------------ characters */

  app.get<BookParams>("/api/audiobooks/:id/characters", async (req) => {
    requireBook(req.params.id);
    return s().book.listCharacters(req.params.id);
  });

  app.post<BookParams>("/api/audiobooks/:id/characters", async (req, reply) => {
    requireBook(req.params.id);
    const body = characterSchema.required({ name: true }).parse(req.body);
    reply.code(201);
    return s().book.createCharacter(req.params.id, body);
  });

  app.patch<CharParams>("/api/audiobooks/:id/characters/:chid", async (req) => {
    requireCharacter(req.params.id, req.params.chid);
    return s().book.updateCharacter(req.params.chid, characterSchema.parse(req.body ?? {}));
  });

  app.delete<CharParams>("/api/audiobooks/:id/characters/:chid", async (req, reply) => {
    requireCharacter(req.params.id, req.params.chid);
    s().book.deleteCharacter(req.params.chid);
    reply.code(204);
  });

  app.post<BookParams>("/api/audiobooks/:id/characters/detect", async (req) => {
    requireBook(req.params.id);
    const body = z
      .object({
        chapter_ids: z.array(z.string()).optional(),
        split_dialogue: z.boolean().default(false),
        heuristic_only: z.boolean().default(false),
        suggest_voices: z.boolean().default(true),
      })
      .parse(req.body ?? {});
    const result = await s().cast.detect(req.params.id, body);
    const applied = body.suggest_voices ? s().cast.applySuggestions(req.params.id) : 0;
    return { ...result, characters: s().book.listCharacters(req.params.id), voices_applied: applied };
  });

  app.post<BookParams>("/api/audiobooks/:id/characters/merge", async (req) => {
    requireBook(req.params.id);
    const body = z.object({ keep_id: z.string(), merge_ids: z.array(z.string()).min(1) }).parse(req.body);
    return s().cast.merge(req.params.id, body.keep_id, body.merge_ids);
  });

  app.post<BookParams>("/api/audiobooks/:id/characters/suggest-voices", async (req) => {
    requireBook(req.params.id);
    const body = z.object({ apply: z.boolean().default(false) }).parse(req.body ?? {});
    const suggestions = s().cast.suggest(req.params.id);
    const applied = body.apply ? s().cast.applySuggestions(req.params.id) : 0;
    return { suggestions, applied };
  });

  app.post<CharParams>("/api/audiobooks/:id/characters/:chid/suggest-voice", async (req) => {
    requireCharacter(req.params.id, req.params.chid);
    return s().cast.suggest(req.params.id, req.params.chid)[0] ?? null;
  });

  /** Preview a voice on a real line. `chid` "narrator" previews the narrator. */
  app.post<CharParams>("/api/audiobooks/:id/characters/:chid/preview", async (req) => {
    requireBook(req.params.id);
    const chid = req.params.chid === "narrator" ? null : req.params.chid;
    if (chid) requireCharacter(req.params.id, chid);
    const body = z.object({ voice_id: z.string().nullish(), text: z.string().max(2000).optional() }).parse(req.body ?? {});
    return s().cast.preview(req.params.id, chid, body.voice_id, body.text);
  });

  app.get<CharParams>("/api/audiobooks/:id/characters/:chid/sample", async (req) => {
    requireBook(req.params.id);
    return s().cast.sampleLine(req.params.id, req.params.chid === "narrator" ? null : req.params.chid);
  });

  app.post<BookParams>("/api/audiobooks/:id/voices/replace", async (req) => {
    requireBook(req.params.id);
    const body = z.object({ from: z.string(), to: z.string() }).parse(req.body);
    return s().cast.replaceVoice(req.params.id, body.from, body.to);
  });

  /* -------------------------------------------------------- pronunciation */

  const ruleRoutes = (prefix: string, bookOf: (params: Record<string, string>) => string | null) => {
    app.get(`${prefix}`, async (req) => s().pronounce.list(bookOf(req.params as Record<string, string>)));
    app.post(`${prefix}`, async (req, reply) => {
      const bookId = bookOf(req.params as Record<string, string>);
      reply.code(201);
      return s().pronounce.create(bookId, ruleSchema.parse(req.body));
    });
    app.post(`${prefix}/reorder`, async (req) => {
      const body = z.object({ ids: z.array(z.string()).min(1) }).parse(req.body);
      return s().pronounce.reorder(bookOf(req.params as Record<string, string>), body.ids);
    });
    app.post(`${prefix}/import`, async (req) => {
      const body = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
      if (!body.trim()) throw new HttpError(400, "Send the .pls or .txt file as the request body.");
      const filename = String((req.query as Record<string, unknown>).filename ?? "");
      try {
        return s().pronounce.import(bookOf(req.params as Record<string, string>), body, filename);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    });
    for (const format of ["pls", "txt"] as const) {
      app.get(`${prefix}/export.${format}`, async (req, reply) => {
        const params = req.params as Record<string, string>;
        const bookId = bookOf(params);
        const lang = bookId ? (s().book.getBook(bookId)?.language ?? "en") : "en";
        reply
          .header("content-type", format === "pls" ? "application/pls+xml; charset=utf-8" : "text/plain; charset=utf-8")
          .header("content-disposition", `attachment; filename="pronunciations.${format}"`);
        return s().pronounce.export(bookId, format, lang);
      });
    }
  };

  ruleRoutes("/api/audiobooks/:id/pronunciations", (p) => requireBook(p.id!).id);
  ruleRoutes("/api/pronunciations", () => null);

  app.patch<RuleParams>("/api/audiobooks/:id/pronunciations/:rid", async (req) => {
    requireRule(req.params.id, req.params.rid);
    return s().pronounce.update(req.params.rid, ruleSchema.partial().parse(req.body ?? {}));
  });
  app.delete<RuleParams>("/api/audiobooks/:id/pronunciations/:rid", async (req) => {
    requireRule(req.params.id, req.params.rid);
    return s().pronounce.delete(req.params.rid);
  });
  app.patch<GlobalRuleParams>("/api/pronunciations/:rid", async (req) => {
    requireRule(null, req.params.rid);
    return s().pronounce.update(req.params.rid, ruleSchema.partial().parse(req.body ?? {}));
  });
  app.delete<GlobalRuleParams>("/api/pronunciations/:rid", async (req) => {
    requireRule(null, req.params.rid);
    return s().pronounce.delete(req.params.rid);
  });

  app.post<BookParams>("/api/audiobooks/:id/pronunciations/suggest", async (req) => {
    requireBook(req.params.id);
    return s().pronounce.suggest(req.params.id);
  });

  /** Read a term in context. Body: {rule_id} or a draft rule, optional text. */
  app.post<BookParams>("/api/audiobooks/:id/pronunciations/play", async (req) => {
    requireBook(req.params.id);
    const body = z
      .object({
        rule_id: z.string().optional(),
        draft: ruleSchema.extend({ case_sensitive: z.boolean().default(true), whole_word: z.boolean().default(true) }).optional(),
        text: z.string().max(2000).optional(),
      })
      .parse(req.body ?? {});
    return s().pronounce.play(req.params.id, { ruleId: body.rule_id, draft: body.draft, text: body.text });
  });

  /* ---------------------------------------------------------------- layout */

  /**
   * Re-pack a chapter's narration with the book's pacing: each paragraph
   * starts where the one before it ends, plus the paragraph gap (and the
   * heading gap after a heading). The docked timeline calls it after a
   * paragraph is voiced in the editor or dragged to a new place, so the
   * narration ripples rather than overlapping or leaving holes.
   */
  app.post<{ Params: { id: string; cid: string } }>("/api/audiobooks/:id/chapters/:cid/layout", async (req) => {
    const chapter = s().book.getChapter(req.params.cid);
    if (!chapter || chapter.book_id !== req.params.id) throw new HttpError(404, "Chapter not found");
    return { moved: s().render.layout(chapter.id) };
  });

  /* ----------------------------------------------------------------- takes */

  app.get<ParaParams>("/api/audiobooks/:id/paragraphs/:sid/takes", async (req) => {
    requireParagraph(req.params.id, req.params.sid);
    return s().takes.list(req.params.sid);
  });

  app.post<TakeParams>("/api/audiobooks/:id/paragraphs/:sid/takes/:tid/select", async (req) => {
    requireParagraph(req.params.id, req.params.sid);
    return s().takes.select(req.params.sid, req.params.tid);
  });

  app.delete<TakeParams>("/api/audiobooks/:id/paragraphs/:sid/takes/:tid", async (req, reply) => {
    requireParagraph(req.params.id, req.params.sid);
    await s().takes.delete(req.params.sid, req.params.tid);
    reply.code(204);
  });

  /**
   * Voice one paragraph, or with `range` (character offsets into its text)
   * only the selected words. A whole paragraph answers with the queued job at
   * once; a selection waits and answers with the splice plan it used.
   */
  app.post<ParaParams>("/api/audiobooks/:id/paragraphs/:sid/generate", async (req, reply) => {
    const chapter = requireParagraph(req.params.id, req.params.sid);
    const body = z
      .object({ range: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).optional() })
      .parse(req.body ?? {});
    const { render, takes, book } = s();
    if (body.range) {
      const p = book.getParagraph(req.params.sid)!;
      const choice = await render.chooseVoice(p, req.params.id);
      const out = await takes.regenerateSelection(
        req.params.sid,
        body.range,
        (id, o) => render.voiceParagraph(id, { spoken: o.text, origin: o.origin }).then((v) => v.sound_id),
        (text) => render.pronounced(req.params.id, text, choice.model).text,
      );
      render.layout(chapter.id);
      return out;
    }
    const job = await new Promise<string>((resolve, reject) => {
      render
        .voiceParagraph(req.params.sid, { onJob: resolve })
        .then(() => render.layout(chapter.id))
        .catch((e: unknown) => {
          reject(e);
          book.hub.publish(req.params.id, { type: "voice_error", segment_id: req.params.sid, error: (e as Error).message });
        });
    });
    reply.code(202);
    return { job_id: job };
  });

  /* --------------------------------------------------------------- renders */

  app.post<BookParams>("/api/audiobooks/:id/render", async (req, reply) => {
    requireBook(req.params.id);
    const body = renderSchema.parse(req.body ?? {});
    const asr = body.asr_check ? await s().render.asrModel() : null;
    if (body.asr_check && !asr) throw new HttpError(409, "No speech-recognition model is installed for the word check.");
    reply.code(201);
    return s().render.start(req.params.id, body.scope, body.overwrite, { max_retries: body.max_retries, asr_model: asr });
  });

  app.get<BookParams>("/api/audiobooks/:id/renders", async (req) => {
    requireBook(req.params.id);
    return s().render.list(req.params.id).map(({ queue: _q, ...r }) => r);
  });

  app.get<RunParams>("/api/audiobooks/:id/renders/:rid", async (req) => {
    const { queue: _q, ...run } = requireRun(req.params.id, req.params.rid);
    return run;
  });

  for (const action of ["pause", "resume", "cancel"] as const) {
    app.post<RunParams>(`/api/audiobooks/:id/renders/:rid/${action}`, async (req) => {
      requireRun(req.params.id, req.params.rid);
      const { queue: _q, ...run } = s().render[action](req.params.rid)!;
      return run;
    });
  }

  app.get<BookParams>("/api/audiobooks/:id/estimate", async (req) => {
    requireBook(req.params.id);
    const q = req.query as Record<string, string | undefined>;
    const scope = q.chapter_id ? { kind: "chapter" as const, chapter_id: q.chapter_id } : { kind: "book" as const };
    const asr = await s().render.asrModel();
    return { ...(await s().render.estimate(req.params.id, scope, q.overwrite === "true")), asr_model: asr };
  });
}
