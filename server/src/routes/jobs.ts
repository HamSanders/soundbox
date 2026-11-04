/**
 * Generation submission and the job queue, including the job SSE stream.
 */

import type { FastifyInstance } from "fastify";

import {
  convertRequestSchema,
  generateRequestSchema,
  repaintRequestSchema,
  separateRequestSchema,
  speakRequestSchema,
} from "../schemas.js";
import type { KonchiService } from "../service.js";
import { HttpError, intQuery, streamSse } from "./helpers.js";

type IdParams = { Params: { job_id: string } };

const TERMINAL = new Set(["done", "error", "cancelled"]);

export function registerJobs(app: FastifyInstance, svc: KonchiService): void {
  app.post("/api/generate", async (request, reply) => {
    const req = generateRequestSchema.parse(request.body);
    // ModelError (unknown model, duration/cfg out of range) → 400 globally.
    const job = svc.submitGenerate(req);
    return reply.code(202).send({ job_id: job.id });
  });

  app.post("/api/separate", async (request, reply) => {
    const req = separateRequestSchema.parse(request.body);
    const job = svc.submitSeparate(req);
    return reply.code(202).send({ job_id: job.id });
  });

  /** Regenerate one window of an existing library sound, keeping the rest.
   *  `generate` with `edit: "repaint"` can do the same thing; this one takes
   *  only the window and inherits everything else from the source. */
  app.post("/api/repaint", async (request, reply) => {
    const req = repaintRequestSchema.parse(request.body);
    const job = await svc.submitRepaint(req);
    return reply.code(202).send({ job_id: job.id });
  });

  /** Speak a script through a TTS model. One line or many — a multi-speaker
   *  dialogue is just several lines with different voices. */
  app.post("/api/speak", async (request, reply) => {
    const req = speakRequestSchema.parse(request.body);
    const job = svc.submitSpeak(req);
    return reply.code(202).send({ job_id: job.id });
  });

  /** Re-voice an existing library sound through a voice-conversion model. */
  app.post("/api/convert", async (request, reply) => {
    const req = convertRequestSchema.parse(request.body);
    const job = svc.submitConvert(req);
    return reply.code(202).send({ job_id: job.id });
  });

  app.get("/api/jobs", async (request) => {
    const query = request.query as Record<string, string | string[] | undefined>;
    return svc.jobs.list(intQuery(query.limit, "limit", 50, 1, 200));
  });

  app.get<IdParams>("/api/jobs/:job_id", async (request) => {
    const job = svc.jobs.get(request.params.job_id);
    if (job === null) throw new HttpError(404, "Job not found");
    return job;
  });

  app.post<IdParams>("/api/jobs/:job_id/cancel", async (request) => {
    const job = svc.jobs.cancel(request.params.job_id);
    if (job === null) throw new HttpError(404, "Job not found");
    return job;
  });

  app.get<IdParams>("/api/jobs/:job_id/events", async (request, reply) => {
    const jobId = request.params.job_id;
    if (svc.jobs.get(jobId) === null) throw new HttpError(404, "Job not found");
    const queue = svc.jobs.subscribe(jobId);
    await streamSse(request, reply, queue, {
      initial: () => {
        const current = svc.jobs.get(jobId);
        return current ? [current] : [];
      },
      // A finished job will never publish again, so the stream closes rather
      // than holding a connection open forever.
      onItem: (job) => (TERMINAL.has(job.status) ? "stop" : "continue"),
      cleanup: () => svc.jobs.unsubscribe(jobId, queue),
    });
  });
}
