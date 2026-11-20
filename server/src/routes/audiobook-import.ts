/**
 * Manuscript import routes, under `/api/audiobooks/import`.
 *
 *   POST   /parse?filename=&max_chars=   raw file body -> ImportPreview
 *   POST   /text   {text, title?, max_chars?}         -> ImportPreview (pasted text)
 *   POST   /url    {url, max_chars?}                  -> ImportPreview
 *   GET    /:preview_id                              -> ImportPreview
 *   PUT    /:preview_id/cover   raw image body       -> ImportPreview (replace cover)
 *   DELETE /:preview_id/cover                        -> ImportPreview (remove cover)
 *   DELETE /:preview_id                              discard
 *   GET    /cover/:token                             the preview's cover image
 *   POST   /commit {preview_id, edits?, settings?, project_id?} -> BookDetail
 *
 * A preview lives in memory for an hour (see `preview.ts`), so the review
 * screen can edit sections without re-uploading. Registered in its own plugin
 * scope so the document and image body parsers stay local to these routes.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { audiobooks, type BookDetail } from "../audiobook/service.js";
import type { BookSettings, Manuscript, PacingSettings } from "../audiobook/types.js";
import { DEFAULT_MAX_CHARS, ImportError, parseManuscript, parsePasted } from "../audiobook/import/index.js";
import { detectFormat } from "../audiobook/import/index.js";
import {
  applyEdits,
  EditError,
  importEditsSchema,
  PreviewStore,
  toPreview,
} from "../audiobook/import/preview.js";
import { fetchDocument, UrlImportError } from "../audiobook/import/url.js";
import type { MirliService } from "../service.js";
import { HttpError } from "./helpers.js";

/** Largest manuscript upload. Image-heavy EPUBs and scanned PDFs run large. */
export const MAX_MANUSCRIPT_BYTES = 256 * 1024 * 1024;
const MAX_COVER_BYTES = 16 * 1024 * 1024;
const MAX_PASTE_CHARS = 20_000_000;

const DOCUMENT_TYPES = [
  "application/epub+zip",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/x-markdown",
  "text/html",
  "application/xhtml+xml",
];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const maxCharsSchema = z.coerce.number().int().min(100).max(20_000).optional();

const settingsSchema = z
  .object({
    model_id: z.string().max(200).nullable(),
    narrator_voice_id: z.string().max(200).nullable(),
    request_options: z.record(z.string(), z.unknown()),
    pacing: z
      .object({
        paragraph_gap_s: z.number().min(0).max(30),
        heading_gap_s: z.number().min(0).max(30),
        head_room_tone_s: z.number().min(0).max(10),
        tail_room_tone_s: z.number().min(0).max(10),
      })
      .partial(),
    mastering: z.enum(["acx", "podcast", "none"]),
    cast_mode: z.enum(["single", "multi"]),
  })
  .partial();

const commitSchema = z.object({
  preview_id: z.string().min(1),
  edits: importEditsSchema.optional(),
  settings: settingsSchema.optional(),
  project_id: z.string().max(200).nullish(),
  /** Speak each chapter's title as its first paragraph (default on). */
  headings: z.boolean().optional(),
});

type SettingsPatch = Partial<Omit<BookSettings, "pacing">> & { pacing?: Partial<PacingSettings> };

/**
 * The one call into core. Kept as a seam so the route doesn't depend on the
 * book store's internals, and so tests can see exactly what is handed over.
 */
export async function commitManuscript(
  svc: MirliService,
  manuscript: Manuscript,
  settings: SettingsPatch,
  opts: { headings?: boolean; project_id?: string | null },
): Promise<BookDetail> {
  return audiobooks(svc).createBookFromManuscript(manuscript, settings, opts);
}

function queryString(value: unknown): string | undefined {
  if (Array.isArray(value)) return queryString(value[value.length - 1]);
  return typeof value === "string" ? value : undefined;
}

function toHttp(err: unknown): never {
  if (err instanceof ImportError || err instanceof UrlImportError) throw new HttpError(err.status, err.message);
  if (err instanceof EditError) throw new HttpError(422, err.message);
  throw err;
}

/** One store per server process; previews are throwaway. */
const store = new PreviewStore();

export function registerAudiobookImport(app: FastifyInstance, svc: MirliService): void {
  void app.register(async (scope) => {
    for (const mime of [...DOCUMENT_TYPES, ...IMAGE_TYPES, "text/plain", "application/octet-stream"]) {
      // Plugin scopes inherit the root's parsers (octet-stream is registered
      // there for audio uploads); replace them here so every body is bytes.
      if (scope.hasContentTypeParser(mime)) scope.removeContentTypeParser(mime);
      scope.addContentTypeParser(mime, { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    }
    routes(scope, svc);
  });
}

function routes(app: FastifyInstance, svc: MirliService): void {
  const requirePreview = (id: string) => {
    const p = store.get(id);
    if (!p) throw new HttpError(404, "That import has expired. Add the file again.");
    return p;
  };

  app.post("/api/audiobooks/import/parse", { bodyLimit: MAX_MANUSCRIPT_BYTES }, async (request, reply) => {
    const body = request.body;
    const bytes = Buffer.isBuffer(body) ? body : typeof body === "string" ? Buffer.from(body, "utf8") : null;
    if (!bytes || bytes.length === 0) throw new HttpError(400, "Send the manuscript file as the request body.");
    const query = request.query as Record<string, unknown>;
    const filename = queryString(query.filename) ?? "";
    const maxChars = maxCharsSchema.parse(queryString(query.max_chars)) ?? DEFAULT_MAX_CHARS;
    const contentType = (request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let manuscript: Manuscript;
    let format;
    try {
      format = detectFormat(data, filename, contentType);
      manuscript = await parseManuscript({ bytes: data, filename, contentType }, { maxChars });
    } catch (err) {
      toHttp(err);
    }
    const preview = store.add(manuscript, { filename: filename || null, format, url: null }, maxChars);
    return reply.code(201).send(toPreview(preview));
  });

  app.post("/api/audiobooks/import/text", async (request, reply) => {
    const body = z
      .object({ text: z.string().max(MAX_PASTE_CHARS), title: z.string().trim().max(300).nullish(), max_chars: maxCharsSchema })
      .parse(request.body ?? {});
    const maxChars = body.max_chars ?? DEFAULT_MAX_CHARS;
    let manuscript: Manuscript;
    try {
      manuscript = parsePasted(body.text, { maxChars, title: body.title ?? null });
    } catch (err) {
      toHttp(err);
    }
    const preview = store.add(manuscript, { filename: null, format: "pasted", url: null }, maxChars);
    return reply.code(201).send(toPreview(preview));
  });

  app.post("/api/audiobooks/import/url", async (request, reply) => {
    const body = z.object({ url: z.string().min(1).max(4000), max_chars: maxCharsSchema }).parse(request.body ?? {});
    const maxChars = body.max_chars ?? DEFAULT_MAX_CHARS;
    let manuscript: Manuscript;
    let format;
    let finalUrl: string;
    let filename: string;
    try {
      const doc = await fetchDocument(body.url, { fetch: urlFetcher });
      finalUrl = doc.url;
      filename = doc.filename;
      format = detectFormat(doc.bytes, doc.filename, doc.contentType);
      manuscript = await parseManuscript({ bytes: doc.bytes, filename: doc.filename, contentType: doc.contentType }, { maxChars });
    } catch (err) {
      toHttp(err);
    }
    const preview = store.add(manuscript, { filename, format, url: finalUrl }, maxChars);
    return reply.code(201).send(toPreview(preview));
  });

  app.get<{ Params: { token: string } }>("/api/audiobooks/import/cover/:token", async (request, reply) => {
    const p = store.byCoverToken(request.params.token);
    const cover = p?.manuscript.cover;
    if (!cover) throw new HttpError(404, "No cover");
    return reply
      .header("Content-Type", cover.mime)
      .header("Cache-Control", "private, max-age=3600")
      .send(Buffer.from(cover.bytes));
  });

  app.get<{ Params: { preview_id: string } }>("/api/audiobooks/import/:preview_id", async (request) =>
    toPreview(requirePreview(request.params.preview_id)),
  );

  app.put<{ Params: { preview_id: string } }>("/api/audiobooks/import/:preview_id/cover", async (request) => {
    requirePreview(request.params.preview_id);
    const body = request.body;
    const mime = (request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (!IMAGE_TYPES.includes(mime) || !Buffer.isBuffer(body) || body.length === 0) {
      throw new HttpError(400, "Send the cover as a PNG, JPEG, WebP or GIF request body.");
    }
    if (body.length > MAX_COVER_BYTES) throw new HttpError(413, "That cover image is too large.");
    const p = store.setCover(request.params.preview_id, { bytes: new Uint8Array(body), mime })!;
    return toPreview(p);
  });

  app.delete<{ Params: { preview_id: string } }>("/api/audiobooks/import/:preview_id/cover", async (request) => {
    requirePreview(request.params.preview_id);
    return toPreview(store.setCover(request.params.preview_id, null)!);
  });

  app.delete<{ Params: { preview_id: string } }>("/api/audiobooks/import/:preview_id", async (request, reply) => {
    store.delete(request.params.preview_id);
    return reply.code(204).send();
  });

  app.post("/api/audiobooks/import/commit", async (request, reply) => {
    const body = commitSchema.parse(request.body ?? {});
    const preview = requirePreview(body.preview_id);
    let manuscript: Manuscript;
    try {
      manuscript = applyEdits(preview.manuscript, body.edits ?? {});
    } catch (err) {
      toHttp(err);
    }
    const book = await commitManuscript(svc, manuscript, (body.settings ?? {}) as SettingsPatch, {
      headings: body.headings,
      project_id: body.project_id ?? null,
    });
    store.delete(preview.id);
    return reply.code(201).send(book);
  });
}

/* ------------------------------------------------------------ test seams */

let urlFetcher: typeof fetch | undefined;

/** Tests swap the URL fetcher so no request leaves the machine. */
export function setImportFetch(fn: typeof fetch | undefined): void {
  urlFetcher = fn;
}
