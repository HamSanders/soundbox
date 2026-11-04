/**
 * The Agents page API.
 *
 * The `/api/mcp/*` routes. Everything
 * here is *about* the MCP surface — the endpoint itself is mounted at /mcp by
 * the MCP layer.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { McpCall, McpToolInfo } from "../schemas.js";
import { skillInstallRequestSchema } from "../schemas.js";
import type { KonchiService } from "../service.js";
import * as skillsMod from "../skills.js";
import { HttpError, intQuery, strQuery, streamSse } from "./helpers.js";

/** Provided by the app: the tools the mounted MCP server exposes, or none when
 *  MCP failed to mount. */
export type McpToolsProvider = () => Promise<McpToolInfo[]>;

/** Schemas.ts carries the `McpCall` *type* but no validator — only this route
 *  and the stdio bridge ever send one — so the Pydantic model's defaults are
 *  reproduced here. */
const mcpCallSchema = z.object({
  id: z.string(),
  ts: z.string(),
  tool: z.string(),
  status: z.enum(["running", "ok", "error"]).default("running"),
  client_name: z.string().nullish(),
  client_version: z.string().nullish(),
  session_id: z.string().nullish(),
  transport: z.enum(["http", "stdio"]).default("http"),
  args: z.record(z.string(), z.unknown()).default({}),
  duration_ms: z.number().int().nullish(),
  error: z.string().nullish(),
  job_id: z.string().nullish(),
  sound_ids: z.array(z.string()).default([]),
  trace_id: z.string().nullish(),
});

export function registerMcp(
  app: FastifyInstance,
  svc: KonchiService,
  tools: McpToolsProvider,
): void {
  /** Connection details, connected agents, totals, telemetry and skills — one
   *  call, so the page renders from a single fetch. */
  app.get("/api/mcp/status", async (request) => {
    // FastAPI's `request.base_url`; Fastify exposes the pieces separately.
    const baseUrl = `${request.protocol}://${request.headers.host ?? ""}/`;
    return svc.mcpStatus(baseUrl, await tools());
  });

  /** Recent MCP tool calls, newest first. */
  app.get("/api/mcp/calls", async (request) => {
    const q = request.query as Record<string, string | string[] | undefined>;
    return svc.db.listMcpCalls({
      limit: intQuery(q.limit, "limit", 100, 1, 1000),
      client_name: strQuery(q.client),
      tool: strQuery(q.tool),
      status: strQuery(q.status),
      since: strQuery(q.since),
    });
  });

  /** Used by the stdio bridge (`konchi-mcp`) to report a call it is proxying,
   *  so it appears alongside HTTP calls on the Agents page. */
  app.post("/api/mcp/calls", async (request, reply) => {
    const call = mcpCallSchema.parse(request.body) as McpCall;
    return reply.code(201).send(svc.telemetry.recordExternal(call));
  });

  app.patch<{ Params: { call_id: string } }>("/api/mcp/calls/:call_id", async (request) => {
    const patch = (request.body ?? {}) as Partial<McpCall>;
    const call = svc.telemetry.finishExternal(request.params.call_id, patch);
    if (call === null) throw new HttpError(404, "Call not found");
    return call;
  });

  /** SSE feed of call records — one event when a call starts (status
   *  `running`) and one when it settles. Same shape as `GET /api/mcp/calls`. */
  app.get("/api/mcp/calls/events", async (request, reply) => {
    const queue = svc.telemetry.subscribe();
    await streamSse(request, reply, queue, {
      initial: () => svc.telemetry.running(),
      cleanup: () => svc.telemetry.unsubscribe(queue),
    });
  });

  /** Copy the bundled agent skills into a client's skills directory. */
  app.post("/api/mcp/skills/install", async (request) => {
    const req = skillInstallRequestSchema.parse(request.body ?? {});
    try {
      return skillsMod.install(req.target, req.path, req.skills);
    } catch (exc) {
      // Unknown target, or the copy failed — both are the caller's problem.
      throw new HttpError(400, exc instanceof Error ? exc.message : String(exc));
    }
  });
}
