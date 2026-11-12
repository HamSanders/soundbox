/**
 * Health and model routes.
 */

import type { FastifyInstance } from "fastify";

import { ModelError } from "../errors.js";
import { engineInstallRequestSchema } from "../models/releaseInstall.js";
import type { KonchiService } from "../service.js";
import { HttpError } from "./helpers.js";

type IdParams = { Params: { model_id: string } };

export function registerModels(app: FastifyInstance, svc: KonchiService): void {
  app.get("/api/health", async () => svc.health());

  app.get("/api/models", async () => svc.listModels());

  /** Every model the audio.cpp adapter could run, verified or not. Enable one
   *  via PATCH /settings {"enabled_audiocpp_models": [...]} — it then appears
   *  in GET /models without an app restart. */
  app.get("/api/models/audiocpp/catalog", async () => svc.audiocppCatalog());

  /** Which audio.cpp binary resolved, how, and where its weights live. The
   *  app had no way to see any of this before — it was CLI-only. */
  app.get("/api/models/audiocpp/runtime", async () => svc.audiocppRuntime());

  app.post("/api/models/audiocpp/engine/install", async (request, reply) => {
    // Validated, not cast: `version` ends up in a GitHub API path and the
    // release it names ends up as a directory — see releaseInstall.ts.
    const body = engineInstallRequestSchema.parse(request.body ?? {});
    const job = svc.submitAudiocppEngineInstall(body.version, body.backend);
    return reply.code(202).send({ job_id: job.id });
  });

  app.get<IdParams>("/api/models/:model_id", async (request) => {
    try {
      return await svc.getModel(request.params.model_id);
    } catch (exc) {
      if (exc instanceof ModelError) throw new HttpError(404, exc.message);
      throw exc;
    }
  });

  app.post<IdParams>("/api/models/:model_id/download", async (request, reply) => {
    // ModelError already maps to 400 in the global handler.
    const job = svc.submitDownload(request.params.model_id);
    return reply.code(202).send({ job_id: job.id });
  });

  app.post<IdParams>("/api/models/:model_id/selftest", async (request) =>
    svc.selfTestModel(request.params.model_id),
  );

  app.post<IdParams>("/api/models/:model_id/load", async (request) =>
    svc.loadModel(request.params.model_id),
  );

  app.post<IdParams>("/api/models/:model_id/unload", async (request) => {
    const info = await svc.unloadModel(request.params.model_id);
    if (info === null) {
      throw new HttpError(404, `Model ${request.params.model_id} is not loaded`);
    }
    return info;
  });

  app.delete<IdParams>("/api/models/:model_id/weights", async (request, reply) => {
    await svc.deleteWeights(request.params.model_id);
    return reply.code(204).send();
  });
}
