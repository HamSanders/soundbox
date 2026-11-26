/**
 * The trash's routes: what is in it, take something out, delete for good.
 * Deleting goes through each thing's own DELETE route, which moves it here
 * (see `../trash.ts`).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { MirliService } from "../service.js";
import { listTrash, purgeItem, purgeTrash, restoreItem, TRASH_DAYS } from "../trash.js";
import { HttpError } from "./helpers.js";

const kindSchema = z.enum(["sound", "session", "book"]);

interface ItemParams {
  Params: { kind: string; id: string };
}

export function registerTrash(app: FastifyInstance, svc: MirliService): void {
  app.get("/api/trash", async () => ({ days: TRASH_DAYS, items: listTrash(svc) }));

  app.post<ItemParams>("/api/trash/:kind/:id/restore", async (request) => {
    const kind = kindSchema.parse(request.params.kind);
    if (!restoreItem(svc, kind, request.params.id)) throw new HttpError(404, "Not in the trash");
    return { restored: true, kind, id: request.params.id };
  });

  app.delete<ItemParams>("/api/trash/:kind/:id", async (request, reply) => {
    const kind = kindSchema.parse(request.params.kind);
    if (!(await purgeItem(svc, kind, request.params.id))) throw new HttpError(404, "Not in the trash");
    return reply.code(204).send();
  });

  /** Empty the trash. */
  app.delete("/api/trash", async () => ({ deleted: await purgeTrash(svc, { all: true }) }));
}
