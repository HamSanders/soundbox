/**
 * `/api/profiles` — several libraries in one install.
 *
 * A profile is a data directory (see `../profiles.ts`); these routes list
 * them, make them, and switch the running server from one to another without
 * a restart.
 */

import type { FastifyInstance } from "fastify";

import { profileNameSchema } from "../schemas.js";
import type { KonchiService } from "../service.js";
import { HttpError, strQuery } from "./helpers.js";

export function registerProfiles(app: FastifyInstance, svc: KonchiService): void {
  app.get("/api/profiles", async () => svc.listProfiles());

  app.post("/api/profiles", async (request, reply) => {
    const { name } = profileNameSchema.parse(request.body ?? {});
    reply.code(201);
    return svc.createProfile(name);
  });

  app.patch<{ Params: { id: string } }>("/api/profiles/:id", async (request) => {
    const { name } = profileNameSchema.parse(request.body ?? {});
    const profile = svc.renameProfile(request.params.id, name);
    if (!profile) throw new HttpError(404, "Profile not found");
    return profile;
  });

  /**
   * Switch to `id`. Returns the whole list rather than just the new active id,
   * because the client has to redraw every row's state anyway and a second
   * round-trip to learn what it already caused is waste.
   */
  app.post<{ Params: { id: string } }>("/api/profiles/:id/activate", async (request) =>
    svc.switchProfile(request.params.id),
  );

  /**
   * Forget a profile. `?delete_data=1` also removes its directory — off by
   * default, because that directory holds audio that exists nowhere else.
   */
  app.delete<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
    const query = request.query as Record<string, string | string[] | undefined>;
    const deleteData = strQuery(query.delete_data) === "1";
    const removed = await svc.deleteProfile(request.params.id, deleteData);
    if (!removed) throw new HttpError(404, "Profile not found");
    reply.code(204);
    return null;
  });
}
