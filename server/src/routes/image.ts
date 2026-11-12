/**
 * Artwork routes: the engine's status and installation, and the two things
 * artwork actually gets attached to — a sound's cover and a voice's avatar.
 *
 * Shaped after `routes/llm.ts`, including the job-returning installs: a
 * multi-gigabyte checkpoint download belongs in the job system with the rest
 * of them, not held open on an HTTP request.
 *
 * Generation itself is synchronous here rather than a job. A turbo render is
 * seconds, the caller has nothing else to do while it happens, and a job for
 * every cover would bury the download jobs people actually watch.
 */

import type { FastifyInstance } from "fastify";

import { engineInstallRequestSchema } from "../models/releaseInstall.js";
import type { KonchiService } from "../service.js";

type ModelParams = { Params: { model_id: string } };
type SoundParams = { Params: { sound_id: string } };
type VoiceParams = { Params: { voice_id: string } };

export function registerImage(app: FastifyInstance, svc: KonchiService): void {
  app.get("/api/image/status", async () => svc.imageStatus());

  app.post("/api/image/engine/install", async (request, reply) => {
    // Validated rather than cast, for the reason routes/models.ts gives.
    const body = engineInstallRequestSchema.parse(request.body ?? {});
    const job = svc.submitImageEngineInstall(body.version);
    return reply.code(202).send({ job_id: job.id });
  });

  app.post<ModelParams>("/api/image/models/:model_id/download", async (request, reply) => {
    const job = svc.submitImageModelDownload(request.params.model_id);
    return reply.code(202).send({ job_id: job.id });
  });

  app.delete<ModelParams>("/api/image/models/:model_id", async (request, reply) => {
    await svc.deleteImageModel(request.params.model_id);
    return reply.code(204).send();
  });

  /** Draw (or redraw) a sound's cover art. Returns the updated Sound, so the
   *  caller replaces one object rather than refetching the library. */
  app.post<SoundParams>("/api/sounds/:sound_id/artwork", async (request) => {
    return await svc.generateSoundArtwork(request.params.sound_id);
  });

  app.delete<SoundParams>("/api/sounds/:sound_id/artwork", async (request, reply) => {
    await svc.clearSoundArtwork(request.params.sound_id);
    return reply.code(204).send();
  });

  app.post<VoiceParams>("/api/voices/:voice_id/artwork", async (request) => {
    return await svc.generateVoiceArtwork(request.params.voice_id);
  });

  app.delete<VoiceParams>("/api/voices/:voice_id/artwork", async (request, reply) => {
    await svc.clearVoiceArtwork(request.params.voice_id);
    return reply.code(204).send();
  });
}
