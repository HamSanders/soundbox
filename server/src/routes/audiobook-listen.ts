/**
 * Listening and publishing routes (the `listen` area), under `/api/audiobooks`.
 *
 *   GET    /listen/shelf                      every book with progress, for the shelf
 *   GET    /:id/listen                        playable manifest (chapters, audio, timings)
 *   GET    /:id/listen/chapters/:cid/audio    one chapter's audio (export file or live mix), Range-aware
 *   GET    /:id/progress ; PUT /:id/progress ; DELETE /:id/progress
 *   GET    /:id/bookmarks ; POST ; PATCH /:id/bookmarks/:bid ; DELETE
 *   PUT    /:id/tags                          shelf tags
 *   GET    /:id/publish/checklist             store readiness per target
 *   POST   /:id/publish/webplayer             self-contained web player folder + zip
 *   POST   /:id/publish/rss                   podcast feed folder + zip
 *   GET    /:id/publish/files/:name           download a published zip
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { buildChecklist } from "../audiobook/publish/checklist.js";
import { mimeFor, publishRoot } from "../audiobook/publish/common.js";
import { buildManifest, coverUrl, exportedAudio, listenableChapters, liveTimings } from "../audiobook/publish/manifest.js";
import { chapterMix } from "../audiobook/publish/mix.js";
import { publishRss } from "../audiobook/publish/rss.js";
import { listenStore } from "../audiobook/publish/store.js";
import { publishWebPlayer } from "../audiobook/publish/webplayer.js";
import { audiobooks } from "../audiobook/service.js";
import type { MirliService } from "../service.js";
import { HttpError } from "./helpers.js";

type BookParams = { Params: { id: string } };
type ChapterParams = { Params: { id: string; cid: string } };
type BookmarkParams = { Params: { id: string; bid: string } };

const progressSchema = z.object({
  chapter_id: z.string().max(200).nullable(),
  position_s: z.number().min(0).max(1e7),
  speed: z.number().min(0.25).max(4).optional(),
  book_position_s: z.number().min(0).max(1e8).optional(),
  finished: z.boolean().optional(),
});

const bookmarkCreateSchema = z.object({
  chapter_id: z.string().max(200),
  position_s: z.number().min(0).max(1e7),
  segment_id: z.string().max(200).nullish(),
  note: z.string().max(10000).optional(),
});

const bookmarkPatchSchema = z.object({
  note: z.string().max(10000).optional(),
  position_s: z.number().min(0).max(1e7).optional(),
});

const tagsSchema = z.object({ tags: z.array(z.string().max(80)).max(50) });

/** Characters read aloud per second, for a length estimate of unvoiced text:
 *  about 155 words a minute at roughly six characters a word with the space.
 *  Our own round figure, the same pace the classics library uses. */
const CHARS_PER_S = 15.5;

const encodingSchema = z.enum(["auto", "mp3", "wav"]).optional();

const webPlayerSchema = z.object({ encoding: encodingSchema, zip: z.boolean().optional() });

const rssSchema = z.object({
  base_url: z.string().url().max(2000),
  encoding: encodingSchema,
  explicit: z.boolean().optional(),
  owner_email: z.string().email().max(300).nullish(),
  zip: z.boolean().optional(),
});

/** A book on the listening shelf. */
export interface ShelfBook {
  id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  description: string | null;
  language: string;
  genres: string[];
  tags: string[];
  series: string | null;
  series_index: number | null;
  publication_date: string | null;
  cover_url: string | null;
  duration_s: number;
  /** Rough length of the whole text when read aloud, voiced or not. */
  estimated_s: number;
  chapters: number;
  /** Chapters with any audio: a book with none is not playable yet. */
  playable_chapters: number;
  /** The bundled classic this book was started from, if any. */
  classic_id: string | null;
  progress: import("../audiobook/publish/store.js").ListenProgress | null;
  created_at: string;
  updated_at: string;
}

/** Stream a file, honouring a single `Range: bytes=a-b` so players can seek. */
export function sendRange(
  request: FastifyRequest,
  reply: FastifyReply,
  path: string,
  contentType: string,
): FastifyReply {
  const size = statSync(path).size;
  reply.header("Accept-Ranges", "bytes").header("Content-Type", contentType).header("Cache-Control", "no-cache");
  const range = request.headers.range;
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) {
      return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    }
    return reply
      .code(206)
      .header("Content-Range", `bytes ${start}-${end}/${size}`)
      .header("Content-Length", end - start + 1)
      .send(createReadStream(path, { start, end }));
  }
  return reply.header("Content-Length", size).send(createReadStream(path));
}

export function registerAudiobookListen(app: FastifyInstance, svc: MirliService): void {
  const books = () => audiobooks(svc);
  const store = () => listenStore(svc);

  const requireBook = (id: string) => {
    const book = books().getBook(id);
    if (!book) throw new HttpError(404, "Book not found");
    return book;
  };

  /* ------------------------------------------------------------------ shelf */

  app.get("/api/audiobooks/listen/shelf", async (): Promise<ShelfBook[]> => {
    const progress = store().allProgress();
    const tags = store().allTags();
    return books()
      .listBooks()
      .map((summary) => {
        const detail = books().getBook(summary.id);
        const listenable = detail ? listenableChapters(detail.chapters) : [];
        const byId = new Map(detail?.chapters.map((c) => [c.id, c]) ?? []);
        const exports = exportedAudio(svc, summary.id);
        const playable = listenable.filter((c) => exports.has(c.id) || (byId.get(c.id)?.stats.voiced ?? 0) > 0);
        // Timeline length, gaps included, like the manifest; only chapters
        // with audio are read.
        const duration = playable.reduce((sum, c) => {
          const exported = exports.get(c.id);
          if (exported) return sum + exported.duration_s;
          const timings = liveTimings(books().getParagraphs(c.id) ?? []);
          return sum + timings.reduce((max, t) => Math.max(max, t.end_s), 0);
        }, 0);
        return {
          id: summary.id,
          title: summary.title,
          subtitle: summary.subtitle,
          author: summary.author,
          narrator: summary.narrator,
          description: summary.description,
          language: summary.language,
          genres: summary.genres,
          tags: tags.get(summary.id) ?? [],
          series: summary.series,
          series_index: summary.series_index,
          publication_date: summary.publication_date,
          cover_url: coverUrl(summary),
          duration_s: Math.round(duration * 100) / 100,
          estimated_s: Math.round(listenable.reduce((n, c) => n + (byId.get(c.id)?.stats.characters ?? 0), 0) / CHARS_PER_S),
          chapters: listenable.length,
          playable_chapters: playable.length,
          classic_id: detail?.settings.classic_id ?? null,
          progress: progress.get(summary.id) ?? null,
          created_at: summary.created_at,
          updated_at: summary.updated_at,
        };
      });
  });

  /* --------------------------------------------------------------- manifest */

  app.get<BookParams>("/api/audiobooks/:id/listen", async (request) => {
    const manifest = buildManifest(svc, request.params.id);
    if (!manifest) throw new HttpError(404, "Book not found");
    return manifest;
  });

  app.get<ChapterParams>("/api/audiobooks/:id/listen/chapters/:cid/audio", async (request, reply) => {
    const { id, cid } = request.params;
    const chapter = books().getChapter(cid);
    if (!chapter || chapter.book_id !== id) throw new HttpError(404, "Chapter not found");
    const exported = exportedAudio(svc, id).get(cid);
    if (exported && existsSync(exported.path)) return sendRange(request, reply, exported.path, exported.mime);
    const path = chapterMix(svc, chapter);
    if (!path) throw new HttpError(404, "This chapter has no audio yet");
    return sendRange(request, reply, path, mimeFor(".wav"));
  });

  /* --------------------------------------------------------------- progress */

  app.get<BookParams>("/api/audiobooks/:id/progress", async (request) => {
    requireBook(request.params.id);
    return store().getProgress(request.params.id);
  });

  app.put<BookParams>("/api/audiobooks/:id/progress", async (request) => {
    const book = requireBook(request.params.id);
    const body = progressSchema.parse(request.body);
    if (body.chapter_id && !book.chapters.some((c) => c.id === body.chapter_id)) {
      throw new HttpError(404, "Chapter not found");
    }
    return store().setProgress(book.id, body);
  });

  app.delete<BookParams>("/api/audiobooks/:id/progress", async (request, reply) => {
    requireBook(request.params.id);
    store().clearProgress(request.params.id);
    return reply.code(204).send();
  });

  /* -------------------------------------------------------------- bookmarks */

  app.get<BookParams>("/api/audiobooks/:id/bookmarks", async (request) => {
    requireBook(request.params.id);
    return store().listBookmarks(request.params.id);
  });

  app.post<BookParams>("/api/audiobooks/:id/bookmarks", async (request, reply) => {
    const book = requireBook(request.params.id);
    const body = bookmarkCreateSchema.parse(request.body);
    if (!book.chapters.some((c) => c.id === body.chapter_id)) throw new HttpError(404, "Chapter not found");
    return reply.code(201).send(store().addBookmark(book.id, body));
  });

  const requireBookmark = (bookId: string, id: string) => {
    const bookmark = store().getBookmark(id);
    if (!bookmark || bookmark.book_id !== bookId) throw new HttpError(404, "Bookmark not found");
    return bookmark;
  };

  app.patch<BookmarkParams>("/api/audiobooks/:id/bookmarks/:bid", async (request) => {
    requireBookmark(request.params.id, request.params.bid);
    return store().updateBookmark(request.params.bid, bookmarkPatchSchema.parse(request.body));
  });

  app.delete<BookmarkParams>("/api/audiobooks/:id/bookmarks/:bid", async (request, reply) => {
    requireBookmark(request.params.id, request.params.bid);
    store().deleteBookmark(request.params.bid);
    return reply.code(204).send();
  });

  /* ------------------------------------------------------------------- tags */

  app.put<BookParams>("/api/audiobooks/:id/tags", async (request) => {
    requireBook(request.params.id);
    return { tags: store().setTags(request.params.id, tagsSchema.parse(request.body).tags) };
  });

  /* ---------------------------------------------------------------- publish */

  app.get<BookParams>("/api/audiobooks/:id/publish/checklist", async (request) => {
    const checklist = buildChecklist(svc, request.params.id);
    if (!checklist) throw new HttpError(404, "Book not found");
    return checklist;
  });

  app.post<BookParams>("/api/audiobooks/:id/publish/webplayer", async (request) => {
    requireBook(request.params.id);
    return publishWebPlayer(svc, request.params.id, webPlayerSchema.parse(request.body ?? {}));
  });

  app.post<BookParams>("/api/audiobooks/:id/publish/rss", async (request) => {
    requireBook(request.params.id);
    return publishRss(svc, request.params.id, rssSchema.parse(request.body ?? {}));
  });

  app.get<{ Params: { id: string; name: string } }>(
    "/api/audiobooks/:id/publish/files/:name",
    async (request, reply) => {
      const { id, name } = request.params;
      requireBook(id);
      // Only a zip a publish run wrote: no separators, no dot-dot.
      if (!/^[a-z0-9][a-z0-9-]*-(webplayer|rss)-[0-9-]+\.zip$/.test(name)) {
        throw new HttpError(400, "Invalid file name");
      }
      const path = join(publishRoot(svc), name);
      if (!existsSync(path)) throw new HttpError(404, "File not found");
      reply.header("Content-Disposition", `attachment; filename="${name}"`);
      return sendRange(request, reply, path, "application/zip");
    },
  );
}
