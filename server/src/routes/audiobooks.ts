/**
 * Audiobook routes owned by core: books, chapters, paragraphs, find/replace,
 * cover and the live events stream. Everything is under `/api/audiobooks`.
 *
 * Registered in their own plugin scope so the image body parsers for the
 * cover upload stay local to these routes.
 */

import { createReadStream, statSync } from "node:fs";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AudiobookEvent } from "../audiobook/hub.js";
import { audiobooks } from "../audiobook/service.js";
import { CHAPTER_KINDS } from "../audiobook/store.js";
import type { ChapterKind } from "../audiobook/types.js";
import type { MirliService } from "../service.js";
import { HttpError, streamSse } from "./helpers.js";

type BookParams = { Params: { id: string } };
type ChapterParams = { Params: { id: string; cid: string } };
type ParagraphParams = { Params: { id: string; sid: string } };

const MAX_COVER_BYTES = 16 * 1024 * 1024;

const kindSchema = z.enum(CHAPTER_KINDS as [ChapterKind, ...ChapterKind[]]);
const nullableText = (max: number) => z.string().max(max).nullish();

const pacingSchema = z
  .object({
    paragraph_gap_s: z.number().min(0).max(30),
    heading_gap_s: z.number().min(0).max(30),
    head_room_tone_s: z.number().min(0).max(10),
    tail_room_tone_s: z.number().min(0).max(10),
  })
  .partial();

const settingsSchema = z
  .object({
    model_id: z.string().max(200).nullable(),
    narrator_voice_id: z.string().max(200).nullable(),
    request_options: z.record(z.string(), z.unknown()),
    pacing: pacingSchema,
    mastering: z.enum(["acx", "podcast", "none"]),
    cast_mode: z.enum(["single", "multi"]),
  })
  .partial();

const bookSchema = z
  .object({
    project_id: z.string().max(200).nullable(),
    title: z.string().trim().min(1).max(300),
    subtitle: nullableText(300),
    author: nullableText(300),
    narrator: nullableText(300),
    description: nullableText(20000),
    language: z.string().min(1).max(35),
    genres: z.array(z.string().max(80)).max(30),
    series: nullableText(300),
    series_index: z.number().nullish(),
    isbn: nullableText(40),
    publisher: nullableText(300),
    publication_date: nullableText(40),
    settings: settingsSchema,
  })
  .partial();

const chapterCreateSchema = z.object({
  title: z.string().max(300).default("New chapter"),
  kind: kindSchema.optional(),
  included: z.boolean().optional(),
  position: z.number().int().min(0).nullish(),
  /** Optional starting text, one string per paragraph. */
  paragraphs: z.array(z.string().max(20000)).max(5000).optional(),
});

const chapterPatchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  kind: kindSchema.optional(),
  included: z.boolean().optional(),
});

const reorderSchema = z.object({ ids: z.array(z.string()).min(1) });

const paragraphCreateSchema = z.object({
  text: z.string().max(20000).default(""),
  position: z.number().int().min(0).nullish(),
  character_id: z.string().nullish(),
  is_heading: z.boolean().optional(),
});

const paragraphPatchSchema = z.object({
  text: z.string().max(20000).optional(),
  character_id: z.string().nullish(),
  locked: z.boolean().optional(),
  is_heading: z.boolean().optional(),
  model_id: z.string().max(200).nullish(),
});

const castSchema = z.object({
  segment_ids: z.array(z.string()).min(1).max(5000),
  character_id: z.string().nullable(),
});

const replaceSchema = z.object({
  find: z.string().min(1).max(1000),
  replace: z.string().max(1000).default(""),
  case_sensitive: z.boolean().optional(),
  whole_word: z.boolean().optional(),
  regex: z.boolean().optional(),
  chapter_ids: z.array(z.string()).optional(),
  dry_run: z.boolean().optional(),
});

function deleteSoundsQuery(query: unknown): boolean {
  const raw = (query as Record<string, string | undefined>).delete_sounds;
  // Default on: a book's clips belong to the book.
  return !(raw === "false" || raw === "0");
}

export function registerAudiobooks(app: FastifyInstance, svc: MirliService): void {
  void app.register(async (scope) => {
    for (const mime of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      scope.addContentTypeParser(mime, { parseAs: "buffer" }, (_req, body, done) => {
        done(null, body);
      });
    }
    routes(scope, svc);
  });
}

function routes(app: FastifyInstance, svc: MirliService): void {
  const books = () => audiobooks(svc);

  const requireBook = (id: string) => {
    const book = books().getBook(id);
    if (!book) throw new HttpError(404, "Book not found");
    return book;
  };
  const requireChapter = (bookId: string, chapterId: string) => {
    const chapter = books().getChapter(chapterId);
    if (!chapter || chapter.book_id !== bookId) throw new HttpError(404, "Chapter not found");
    return chapter;
  };
  const requireParagraph = (bookId: string, segmentId: string) => {
    const chapter = books().chapterForSegment(segmentId);
    if (!chapter || chapter.book_id !== bookId) throw new HttpError(404, "Paragraph not found");
    return chapter;
  };

  /* ------------------------------------------------------------------ books */

  app.get("/api/audiobooks", async () => books().listBooks());

  app.post("/api/audiobooks", async (request, reply) => {
    const body = bookSchema.parse(request.body ?? {});
    return reply.code(201).send(books().createBook(body));
  });

  app.get<BookParams>("/api/audiobooks/:id", async (request) => requireBook(request.params.id));

  app.patch<BookParams>("/api/audiobooks/:id", async (request) => {
    const body = bookSchema.parse(request.body ?? {});
    const book = books().updateBook(request.params.id, body);
    if (!book) throw new HttpError(404, "Book not found");
    return book;
  });

  app.delete<BookParams>("/api/audiobooks/:id", async (request, reply) => {
    const ok = await books().deleteBook(request.params.id, deleteSoundsQuery(request.query));
    if (!ok) throw new HttpError(404, "Book not found");
    return reply.code(204).send();
  });

  app.put<BookParams>("/api/audiobooks/:id/cover", async (request) => {
    requireBook(request.params.id);
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new HttpError(400, "Send the image as the request body (PNG, JPEG, WebP or GIF).");
    }
    if (body.length > MAX_COVER_BYTES) throw new HttpError(413, "Cover image is too large.");
    const mime = (request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    return books().setCover(request.params.id, body, mime);
  });

  app.get<BookParams>("/api/audiobooks/:id/cover", async (request, reply) => {
    const file = books().coverFile(request.params.id);
    let size = 0;
    try {
      size = file ? statSync(file.path).size : 0;
    } catch {
      size = 0;
    }
    if (!file || size === 0) throw new HttpError(404, "No cover");
    return reply
      .header("Content-Type", file.mime)
      .header("Content-Length", size)
      .header("Cache-Control", "no-cache")
      .send(createReadStream(file.path));
  });

  app.get<BookParams>("/api/audiobooks/:id/events", async (request, reply) => {
    const id = request.params.id;
    requireBook(id);
    const hub = books().hub;
    const queue = hub.subscribe(id);
    await streamSse(request, reply, queue, {
      initial: (): AudiobookEvent[] => [{ type: "hello" }],
      onItem: (event) => (event.type === "deleted" ? "stop" : "continue"),
      cleanup: () => hub.unsubscribe(id, queue),
    });
  });

  /* --------------------------------------------------------------- chapters */

  app.post<BookParams>("/api/audiobooks/:id/chapters", async (request, reply) => {
    requireBook(request.params.id);
    const body = chapterCreateSchema.parse(request.body ?? {});
    return reply.code(201).send(books().addChapter(request.params.id, body));
  });

  /** Registered before `:cid` so "reorder" is not read as a chapter id. */
  app.post<BookParams>("/api/audiobooks/:id/chapters/reorder", async (request) => {
    requireBook(request.params.id);
    const body = reorderSchema.parse(request.body);
    if (!books().reorderChapters(request.params.id, body.ids)) {
      throw new HttpError(422, "ids must list every chapter of the book exactly once");
    }
    return requireBook(request.params.id).chapters;
  });

  app.patch<ChapterParams>("/api/audiobooks/:id/chapters/:cid", async (request) => {
    requireChapter(request.params.id, request.params.cid);
    const body = chapterPatchSchema.parse(request.body ?? {});
    const chapter = books().updateChapter(request.params.cid, body);
    if (!chapter) throw new HttpError(404, "Chapter not found");
    return requireBook(request.params.id).chapters.find((c) => c.id === chapter.id);
  });

  app.delete<ChapterParams>("/api/audiobooks/:id/chapters/:cid", async (request, reply) => {
    requireChapter(request.params.id, request.params.cid);
    await books().deleteChapter(request.params.cid, deleteSoundsQuery(request.query));
    return reply.code(204).send();
  });

  /* ------------------------------------------------------------- paragraphs */

  app.get<ChapterParams>("/api/audiobooks/:id/chapters/:cid/paragraphs", async (request) => {
    requireChapter(request.params.id, request.params.cid);
    return books().getParagraphs(request.params.cid);
  });

  app.post<ChapterParams>(
    "/api/audiobooks/:id/chapters/:cid/paragraphs",
    async (request, reply) => {
      requireChapter(request.params.id, request.params.cid);
      const body = paragraphCreateSchema.parse(request.body ?? {});
      return reply.code(201).send(books().addParagraph(request.params.cid, body));
    },
  );

  /** Cast many paragraphs at once (multi-select). Registered before `:sid`. */
  app.post<BookParams>("/api/audiobooks/:id/paragraphs/cast", async (request) => {
    requireBook(request.params.id);
    const body = castSchema.parse(request.body);
    for (const sid of body.segment_ids) requireParagraph(request.params.id, sid);
    return { changed: books().setParagraphCharacter(body.segment_ids, body.character_id) };
  });

  app.patch<ParagraphParams>("/api/audiobooks/:id/paragraphs/:sid", async (request) => {
    requireParagraph(request.params.id, request.params.sid);
    const body = paragraphPatchSchema.parse(request.body ?? {});
    const fields: Parameters<ReturnType<typeof books>["updateParagraph"]>[1] = {};
    if (body.text !== undefined) fields.text = body.text;
    if (body.locked !== undefined) fields.locked = body.locked;
    if (body.is_heading !== undefined) fields.is_heading = body.is_heading;
    if (request.body && typeof request.body === "object" && "character_id" in request.body) {
      fields.character_id = body.character_id ?? null;
    }
    if (request.body && typeof request.body === "object" && "model_id" in request.body) {
      fields.model_id = body.model_id ?? null;
    }
    if (Object.keys(fields).length === 0) throw new HttpError(422, "Nothing to update");
    return books().updateParagraph(request.params.sid, fields);
  });

  app.delete<ParagraphParams>("/api/audiobooks/:id/paragraphs/:sid", async (request, reply) => {
    requireParagraph(request.params.id, request.params.sid);
    books().deleteParagraph(request.params.sid);
    return reply.code(204).send();
  });

  app.post<BookParams>("/api/audiobooks/:id/replace", async (request) => {
    const body = replaceSchema.parse(request.body);
    const result = books().replace(request.params.id, body);
    if (!result) throw new HttpError(404, "Book not found");
    return result;
  });
}
