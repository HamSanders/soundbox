/**
 * Sampled instruments for the MIDI dry render: list, download, remove, and
 * the files the browser plays. See `instruments/index.ts`.
 */

import { createReadStream, statSync } from "node:fs";

import type { FastifyInstance } from "fastify";

import { instrumentManifest } from "../instruments/index.js";
import type { MirliService } from "../service.js";
import { HttpError } from "./helpers.js";

type IdParams = { Params: { id: string } };
type FileParams = { Params: { id: string; "*": string } };

export function registerInstruments(app: FastifyInstance, svc: MirliService): void {
  app.get("/api/instruments", async () => svc.instruments.list());

  app.get<IdParams>("/api/instruments/:id", async (request) => {
    const { id } = request.params;
    const filesUrl = `/api/instruments/${encodeURIComponent(id)}/files`;
    // ModelError (an unknown id) already maps to 400 in the global handler.
    const regions = await svc.instruments.regions(id, filesUrl);
    if (!regions) {
      const label = instrumentManifest(id)?.label ?? id;
      throw new HttpError(404, `The ${label} samples are not installed`);
    }
    return regions;
  });

  app.post<IdParams>("/api/instruments/:id/download", async (request, reply) => {
    const job = svc.submitInstrumentDownload(request.params.id);
    return reply.code(202).send({ job_id: job.id });
  });

  app.delete<IdParams>("/api/instruments/:id", async (request, reply) => {
    await svc.instruments.remove(request.params.id);
    return reply.code(204).send();
  });

  /** One sample. The path is checked against the instrument's manifest, not
   *  just joined, so nothing outside its folder can be named. */
  app.get<FileParams>("/api/instruments/:id/files/*", async (request, reply) => {
    const abs = svc.instruments.filePath(request.params.id, request.params["*"]);
    if (!abs) throw new HttpError(404, "No such sample");
    return reply
      .header("Content-Type", abs.endsWith(".sfz") ? "text/plain; charset=utf-8" : "audio/wav")
      .header("Content-Length", statSync(abs).size)
      // The manifest is pinned to one upstream commit, so a path's bytes
      // never change while it is installed.
      .header("Cache-Control", "private, max-age=86400")
      .send(createReadStream(abs));
  });
}
