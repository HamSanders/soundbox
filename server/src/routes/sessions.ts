/**
 * Session and project routes.
 *
 * A session groups a run of related generations so the app can present them as
 * one thread. Sounds may have no session at all (anything predating this, and
 * anything made through the API or MCP directly), which is why the Library is
 * still the flat view over everything.
 *
 * A project is a folder: sounds you file into it stay filed until you move
 * them, unlike a session's flat "everything made in this thread". Deleting a
 * project only unfiles its sounds — they stay in the library.
 */

import type { FastifyInstance } from "fastify";

import { projectPatchSchema, sessionPatchSchema, type Session } from "../schemas.js";
import type { KonchiService } from "../service.js";
import { HttpError, intQuery } from "./helpers.js";

type SessionParams = { Params: { session_id: string } };
type ProjectParams = { Params: { project_id: string } };

function hasKey(body: unknown, key: string): boolean {
  return typeof body === "object" && body !== null && key in body;
}

export function registerSessions(app: FastifyInstance, svc: KonchiService): void {
  app.get("/api/sessions", async (request) => {
    const query = request.query as Record<string, string | string[] | undefined>;
    return svc.listSessions(intQuery(query.limit, "limit", 50, 1, 200));
  });

  app.post("/api/sessions", async (request, reply) => {
    // A session "created inside a project" (picked before the first
    // generation, e.g. from the composer's project picker) starts filed
    // there, rather than needing a second PATCH the instant it exists.
    const patch = request.body == null ? null : sessionPatchSchema.parse(request.body);
    const session = svc.createSession(patch?.title ?? null, patch?.project_id ?? null);
    return reply.code(201).send(session);
  });

  app.get<SessionParams>("/api/sessions/:session_id", async (request) => {
    const session = svc.getSession(request.params.session_id);
    if (session === null) throw new HttpError(404, "Session not found");
    return session;
  });

  app.patch<SessionParams>("/api/sessions/:session_id", async (request) => {
    const patch = sessionPatchSchema.parse(request.body ?? {});
    const hasTitle = hasKey(request.body, "title");
    const hasProject = hasKey(request.body, "project_id");
    if (!hasTitle && !hasProject) throw new HttpError(422, "Nothing to update");
    const id = request.params.session_id;
    let session: Session | null = null;
    if (hasTitle) {
      session = svc.renameSession(id, patch.title!); // min_length enforced by the schema
      if (session === null) throw new HttpError(404, "Session not found");
    }
    if (hasProject) {
      // project_id=null is a real target state (unassign), so this is gated on
      // the field having been sent at all, not on its value.
      session = svc.setSessionProject(id, patch.project_id ?? null);
      if (session === null) throw new HttpError(404, "Session not found");
    }
    return session!;
  });

  /** Deletes the session *and* the sounds generated in it, audio included. */
  app.delete<SessionParams>("/api/sessions/:session_id", async (request, reply) => {
    if (!(await svc.deleteSession(request.params.session_id))) {
      throw new HttpError(404, "Session not found");
    }
    return reply.code(204).send();
  });

  app.get("/api/projects", async () => svc.listProjects());

  app.post("/api/projects", async (request, reply) => {
    const patch = projectPatchSchema.parse(request.body);
    return reply.code(201).send(svc.createProject(patch.name));
  });

  app.delete<ProjectParams>("/api/projects/:project_id", async (request, reply) => {
    if (!svc.deleteProject(request.params.project_id)) {
      throw new HttpError(404, "Project not found");
    }
    return reply.code(204).send();
  });
}
