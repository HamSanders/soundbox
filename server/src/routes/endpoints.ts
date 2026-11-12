/**
 * Custom audio endpoint routes. See `endpoints/service.ts`.
 *
 * A test render is synchronous rather than a job, like artwork: it is one
 * short clip, the form is waiting on the answer, and a job for it would sit in
 * the queue view looking like a real generation.
 */

import type { FastifyInstance } from "fastify";

import type { KonchiService } from "../service.js";

type EndpointParams = { Params: { id: string } };

export function registerEndpoints(app: FastifyInstance, svc: KonchiService): void {
  app.get("/api/endpoints", async () => svc.endpoints.list());

  app.put<EndpointParams>("/api/endpoints/:id", async (request) => {
    return await svc.endpoints.save(request.params.id, request.body ?? {});
  });

  app.delete<EndpointParams>("/api/endpoints/:id", async (request, reply) => {
    await svc.endpoints.remove(request.params.id);
    return reply.code(204).send();
  });

  app.post("/api/endpoints/test", async (request) => {
    return await svc.endpoints.test(request.body ?? {});
  });
}
