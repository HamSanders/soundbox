/**
 * Audiobook beds: music, ambience and SFX under a chapter's narration.
 *
 *   GET    /api/audiobooks/:id/beds[?chapter_id=]          beds (+ stale flag)
 *   GET    /api/audiobooks/:id/beds/export-info[?chapter_ids=a,b]
 *                                                        warnings + include-beds default
 *   POST   /api/audiobooks/:id/chapters/:cid/beds          add {sound_id|prompt, ...}
 *   POST   /api/audiobooks/:id/chapters/:cid/beds/layout   fit every bed to the narration
 *   POST   /api/audiobooks/:id/chapters/:cid/beds/suggest  propose beds from the text (nothing is created)
 *   PATCH  /api/audiobooks/:id/beds/:bid                   gain, fades, mode, duck...
 *   POST   /api/audiobooks/:id/beds/:bid/layout            fit one bed
 *   DELETE /api/audiobooks/:id/beds/:bid
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { BED_KINDS, BED_MODES, beds, type BedKind, type BedMode } from "../audiobook/beds.js";
import { audiobooks } from "../audiobook/service.js";
import { setAudiobookRoutes } from "../mcp/audiobook.js";
import type { MirliService } from "../service.js";
import { HttpError } from "./helpers.js";

type BookParams = { Params: { id: string } };
type ChapterParams = { Params: { id: string; cid: string } };
type BedParams = { Params: { id: string; bid: string } };

const duckSchema = z
  .object({
    depth_db: z.number().min(0).max(40),
    attack_ms: z.number().min(0).max(5000),
    release_ms: z.number().min(0).max(10000),
    lookahead_ms: z.number().min(0).max(5000),
    hold_ms: z.number().min(0).max(5000),
    threshold_db: z.number().min(-90).max(0),
  })
  .partial();

const bedFields = {
  label: z.string().max(80).nullish(),
  sound_id: z.string().max(200).nullish(),
  gain_db: z.number().min(-40).max(24).optional(),
  fade_in_s: z.number().min(0).max(60).optional(),
  fade_out_s: z.number().min(0).max(60).optional(),
  loop: z.boolean().optional(),
  mode: z.enum(BED_MODES as [BedMode, ...BedMode[]]).optional(),
  intro_s: z.number().min(0.5).max(600).nullish(),
  anchor_segment_id: z.string().max(200).nullish(),
  end_segment_id: z.string().max(200).nullish(),
  offset_s: z.number().min(-600).max(600).optional(),
  /** false or null turns ducking off. */
  duck: z.union([duckSchema, z.literal(false), z.null()]).optional(),
};

export const bedCreateSchema = z
  .object({
    ...bedFields,
    kind: z.enum(BED_KINDS as [BedKind, ...BedKind[]]).default("music"),
    prompt: z.string().max(2000).nullish(),
    model_id: z.string().max(200).nullish(),
    duration_s: z.number().gt(0).max(300).nullish(),
  })
  .refine((b) => !!b.sound_id || !!b.prompt?.trim(), { message: "Give a sound_id or a prompt." });

export const bedPatchSchema = z.object(bedFields);

export function registerAudiobookBeds(app: FastifyInstance, svc: MirliService): void {
  // The audiobook MCP tools call the audiobook routes through this app.
  setAudiobookRoutes(svc, app);
  const service = () => beds(svc);
  const requireBook = (id: string) => {
    if (!audiobooks(svc).getBook(id)) throw new HttpError(404, "Book not found");
  };

  app.get<BookParams>("/api/audiobooks/:id/beds", async (request) => {
    requireBook(request.params.id);
    const chapterId = (request.query as Record<string, string | undefined>).chapter_id ?? null;
    return service().list(request.params.id, chapterId);
  });

  app.get<BookParams>("/api/audiobooks/:id/beds/export-info", async (request) => {
    requireBook(request.params.id);
    const raw = (request.query as Record<string, string | undefined>).chapter_ids;
    const ids = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : null;
    return service().exportInfo(request.params.id, ids);
  });

  app.post<ChapterParams>("/api/audiobooks/:id/chapters/:cid/beds", async (request, reply) => {
    requireBook(request.params.id);
    const body = bedCreateSchema.parse(request.body ?? {});
    const bed = await service().create(request.params.id, request.params.cid, body);
    return reply.code(201).send(bed);
  });

  app.post<ChapterParams>("/api/audiobooks/:id/chapters/:cid/beds/layout", async (request) => {
    requireBook(request.params.id);
    return service().layoutChapter(request.params.id, request.params.cid);
  });

  app.post<ChapterParams>("/api/audiobooks/:id/chapters/:cid/beds/suggest", async (request) => {
    requireBook(request.params.id);
    return service().suggest(request.params.id, request.params.cid);
  });

  app.patch<BedParams>("/api/audiobooks/:id/beds/:bid", async (request) => {
    const body = bedPatchSchema.parse(request.body ?? {});
    const bed = await service().update(request.params.id, request.params.bid, body);
    if (!bed) throw new HttpError(404, "Bed not found");
    return bed;
  });

  app.post<BedParams>("/api/audiobooks/:id/beds/:bid/layout", async (request) => {
    if (!service().get(request.params.id, request.params.bid)) throw new HttpError(404, "Bed not found");
    return service().layout(request.params.id, request.params.bid);
  });

  app.delete<BedParams>("/api/audiobooks/:id/beds/:bid", async (request, reply) => {
    const ok = await service().remove(request.params.id, request.params.bid);
    if (!ok) throw new HttpError(404, "Bed not found");
    return reply.code(204).send();
  });
}
