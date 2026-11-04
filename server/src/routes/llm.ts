/**
 * Prompt-assistant routes: enhance a prompt, and manage the engine/model the
 * same way `/api/models/*` manages audio.cpp models.
 */

import type { FastifyInstance } from "fastify";

import {
  assistantChatRequestSchema,
  assistantOpenersRequestSchema,
  enhanceLyricsRequestSchema,
  enhanceRequestSchema,
  studioCommandRequestSchema,
} from "../schemas.js";
import { engineInstallRequestSchema } from "../models/releaseInstall.js";
import type { KonchiService } from "../service.js";

type ModelParams = { Params: { model_id: string } };

export function registerLlm(app: FastifyInstance, svc: KonchiService): void {
  app.post("/api/enhance", async (request) => {
    const req = enhanceRequestSchema.parse(request.body ?? {});
    const result = await svc.enhancePrompt({
      prompt: req.prompt,
      n: req.n,
      category: req.category ?? undefined,
      lyrics: req.lyrics ?? undefined,
      model: req.model ?? undefined,
    });
    return result;
  });

  app.post("/api/enhance/lyrics", async (request) => {
    const req = enhanceLyricsRequestSchema.parse(request.body ?? {});
    const lyrics = await svc.enhanceLyrics(req.theme, req.style ?? undefined);
    return { lyrics };
  });

  /**
   * An instruction about the timeline, answered with edits.
   *
   * The whole studio state travels in the request rather than being read from
   * the database here, because the question is about what the user is looking
   * at — including the playhead and the selection, which live in the page and
   * were never persisted anywhere for this route to find.
   */
  app.post("/api/studio/command", async (request) => {
    const req = studioCommandRequestSchema.parse(request.body ?? {});
    return await svc.studioCommand(req.instruction, {
      tracks: req.context.tracks,
      clips: req.context.clips,
      playhead_s: req.context.playhead_s,
      selected_ids: req.context.selected_ids,
      voices: req.context.voices,
    });
  });

  /**
   * One turn of the studio assistant. Stateless on purpose: the thread is the
   * page's, sent whole each time, so a reload or a second window never
   * finds a conversation the server remembers differently from the one on
   * screen.
   */
  app.post("/api/assistant/chat", async (request) => {
    const req = assistantChatRequestSchema.parse(request.body ?? {});
    return await svc.assistantChat(req.messages, req.draft ?? null, req.studio ?? null);
  });

  /**
   * Conversation starters for an empty assistant thread. The catalogue and
   * (when present) the studio snapshot go in so the chips are about this
   * machine and this arrangement, not generic copy.
   */
  app.post("/api/assistant/openers", async (request) => {
    const req = assistantOpenersRequestSchema.parse(request.body ?? {});
    const openers = await svc.assistantOpeners(req.studio ?? null);
    return { openers };
  });

  app.get("/api/llm/status", async () => svc.llmStatus());

  app.post("/api/llm/engine/install", async (request, reply) => {
    // Validated rather than cast, for the reason routes/models.ts gives.
    const body = engineInstallRequestSchema.parse(request.body ?? {});
    const job = svc.submitLlmEngineInstall(body.version);
    return reply.code(202).send({ job_id: job.id });
  });

  app.post<ModelParams>("/api/llm/models/:model_id/download", async (request, reply) => {
    const job = svc.submitLlmModelDownload(request.params.model_id);
    return reply.code(202).send({ job_id: job.id });
  });

  app.delete<ModelParams>("/api/llm/models/:model_id", async (request, reply) => {
    await svc.deleteLlmModel(request.params.model_id);
    return reply.code(204).send();
  });
}
