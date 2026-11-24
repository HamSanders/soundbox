/**
 * Mirli Cloud routes. See `cloud/service.ts`. All of them answer 404-style
 * errors when cloud is off (no MIRLI_CLOUD=1), except GET, which says so.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { MirliService } from "../service.js";

export function registerCloud(app: FastifyInstance, svc: MirliService): void {
  app.get("/api/cloud", async () => svc.cloud.status());

  /** Start the device-code sign-in. Returns the code and the URL to open. */
  app.post("/api/cloud/sign-in", async () => svc.cloud.startSignIn());

  app.delete("/api/cloud/sign-in", async (_request, reply) => {
    svc.cloud.cancelSignIn();
    return reply.code(204).send();
  });

  app.post("/api/cloud/sign-out", async (_request, reply) => {
    await svc.cloud.signOut();
    return reply.code(204).send();
  });

  /** The user looks about to use this cloud model: start its GPU line now (a hint, never an error). */
  app.post("/api/cloud/warm", async (request) => {
    const { model } = z.object({ model: z.string().min(1).max(200) }).parse(request.body ?? {});
    return svc.cloud.warm(model);
  });
}
