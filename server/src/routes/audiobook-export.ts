/**
 * Audiobook export routes: QC, credits and samples, exports and their
 * history, downloads, paragraph timings and ffmpeg status. All under
 * `/api/audiobooks`.
 */

import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { audiobookExports } from "../audiobook/export.js";
import { audiobooks } from "../audiobook/service.js";
import type { MirliService } from "../service.js";
import { HttpError } from "./helpers.js";

type BookParams = { Params: { id: string } };
type ChapterParams = { Params: { id: string; cid: string } };
type ExportParams = { Params: { id: string; eid: string } };

const preset = z.enum(["acx", "podcast", "none"]);

const analyzeSchema = z
  .object({
    mastering: preset.optional(),
    chapter_ids: z.array(z.string()).max(2000).optional(),
    include_beds: z.boolean().optional(),
  })
  .default({});

const exportSchema = z.object({
  format: z.enum(["mp3", "wav", "flac", "m4b"]),
  bitrate_kbps: z.number().int().min(32).max(320).optional(),
  layout: z.enum(["files", "single"]),
  chapter_ids: z.array(z.string()).max(2000).optional(),
  mastering: preset,
  include_cover: z.boolean().default(true),
  include_transcripts: z.boolean().default(false),
  include_beds: z.boolean().optional(),
});

const creditsSchema = z.object({
  opening: z.boolean().optional(),
  closing: z.boolean().optional(),
  replace: z.boolean().optional(),
  sample: z
    .union([
      z.literal(false),
      z.object({
        chapter_id: z.string().optional(),
        target_s: z.number().min(60).max(290).optional(),
        format: z.enum(["mp3", "wav"]).optional(),
      }),
    ])
    .optional(),
});

/** ASCII fallback plus RFC 5987 UTF-8 name for Content-Disposition. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  m4b: "audio/mp4",
  zip: "application/zip",
};

export function registerAudiobookExport(app: FastifyInstance, svc: MirliService): void {
  const exports = () => audiobookExports(svc);
  /** The book's own id, as stored: what the exporter is given to build
   *  folder names from, never the raw URL parameter. */
  const requireBook = (id: string): string => {
    const book = audiobooks(svc).getBook(id);
    if (!book) throw new HttpError(404, "Book not found.");
    return book.id;
  };
  // Build the store (and its tables) at startup, so interrupted exports are
  // marked failed before anyone lists them.
  exports();

  app.get("/api/audiobooks/ffmpeg", async (request) => {
    const refresh = (request.query as { refresh?: string }).refresh === "1";
    return exports().ffmpeg(refresh);
  });

  app.post<BookParams>("/api/audiobooks/:id/master/analyze", async (request) => {
    const bookId = requireBook(request.params.id);
    return exports().analyze(bookId, analyzeSchema.parse(request.body ?? {}));
  });

  app.post<BookParams>("/api/audiobooks/:id/credits", async (request) => {
    const bookId = requireBook(request.params.id);
    return exports().credits(bookId, creditsSchema.parse(request.body ?? {}));
  });

  app.post<BookParams>("/api/audiobooks/:id/exports", async (request, reply) => {
    const bookId = requireBook(request.params.id);
    const record = await exports().start(bookId, exportSchema.parse(request.body));
    return reply.code(202).send(record);
  });

  app.get<BookParams>("/api/audiobooks/:id/exports", async (request) => {
    const bookId = requireBook(request.params.id);
    return exports().list(bookId);
  });

  app.get<ExportParams>("/api/audiobooks/:id/exports/:eid", async (request) => {
    const e = exports().get(request.params.eid);
    if (!e || e.book_id !== request.params.id) throw new HttpError(404, "Export not found.");
    return e;
  });

  app.delete<ExportParams>("/api/audiobooks/:id/exports/:eid", async (request, reply) => {
    const e = exports().get(request.params.eid);
    if (!e || e.book_id !== request.params.id) throw new HttpError(404, "Export not found.");
    exports().deleteExport(e.id);
    return reply.code(204).send();
  });

  app.get<ExportParams>("/api/audiobooks/:id/exports/:eid/download", async (request, reply) => {
    const e = exports().get(request.params.eid);
    if (!e || e.book_id !== request.params.id) throw new HttpError(404, "Export not found.");
    const path = exports().downloadPath(e.id);
    if (!path) throw new HttpError(409, e.status === "done" ? "The export's file is gone." : "The export is not finished.");
    const name = basename(path);
    return reply
      .header("Content-Type", MIME[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream")
      .header("Content-Length", statSync(path).size)
      .header("Content-Disposition", disposition(name))
      .send(createReadStream(path));
  });

  app.get<ChapterParams>("/api/audiobooks/:id/chapters/:cid/timings", async (request) => {
    const chapter = audiobooks(svc).getChapter(request.params.cid);
    if (!chapter || chapter.book_id !== request.params.id) throw new HttpError(404, "Chapter not found.");
    return exports().timings(chapter.id) ?? [];
  });
}
