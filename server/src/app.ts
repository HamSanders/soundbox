/**
 * The Fastify application: HTTP routes + SSE, and the place the MCP endpoint
 * gets mounted onto.
 *
 * Routes live in
 * `src/routes/*`; this module owns the wiring — CORS, the error envelope, the
 * service lifecycle and the static UI.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { VERSION, type Config } from "./config.js";
import { ModelError, QueueFull } from "./errors.js";
import { buildFailure } from "./failure.js";
import { registerModels } from "./routes/models.js";
import { registerFiles } from "./routes/files.js";
import { registerFs } from "./routes/fs.js";
import {
  FORMAT_FALLBACK_HEADER,
  HttpError,
  MAX_UPLOAD_BYTES,
  isAllowedOrigin,
} from "./routes/helpers.js";
import { registerJobs } from "./routes/jobs.js";
import { registerLlm } from "./routes/llm.js";
import { registerImage } from "./routes/image.js";
import { registerEndpoints } from "./routes/endpoints.js";
import { AccessGuard, registerAuth } from "./auth.js";
import { mountMcp, toolInfos } from "./mcp/server.js";
import { hostnameOf, isListedHost } from "./origins.js";
import { registerMcp, type McpToolsProvider } from "./routes/mcp.js";
import { registerHistory } from "./routes/history.js";
import { registerSessions } from "./routes/sessions.js";
import { registerStories } from "./routes/stories.js";
import { registerProfiles } from "./routes/profiles.js";
import { registerSettings } from "./routes/settings.js";
import { registerSounds } from "./routes/sounds.js";
import { registerVoices } from "./routes/voices.js";
import { SoundboxService } from "./service.js";

declare module "fastify" {
  interface FastifyInstance {
    /** The one service instance every route and the MCP layer share. */
    soundbox: SoundboxService;
  }
}

export interface BuildAppOptions {
  serveUi?: boolean;
  /**
   * Tools of the mounted MCP server, for `GET /api/mcp/status`.
   *
   * Deviation: the Python reached into `app.state.mcp` and mounted MCP from
   * inside `create_app()`. Here the MCP layer is a separate module that
   * registers itself against the returned instance, so it hands its tool list
   * in through this callback instead — and an absent MCP just means no tools,
   * exactly as the Python's `getattr(..., None)` fallback did.
   */
  mcpTools?: McpToolsProvider;
  /**
   * Extra hostnames the Host header may carry besides the loopback names — the
   * CLI passes its `--host` here when bound to a specific non-loopback address.
   * SOUNDBOX_ALLOWED_HOSTS is accepted on top of these either way.
   * `"any"` disables the check (wildcard binds like 0.0.0.0).
   */
  allowedHosts?: string[] | "any";
  /**
   * The access token every API, MCP and file request must carry, or null for
   * none (the default, and right for loopback). See `auth.ts`.
   */
  apiToken?: string | null;
}

/** Loopback names that are always accepted in the Host header. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Content types a browser can send cross-site without a CORS preflight. */
const SIMPLE_CONTENT_TYPES = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);

/** Custom header marking a request as a deliberate API call. Any custom
 *  header forces a preflight, which the CORS policy then refuses for
 *  foreign origins. */
export const CSRF_HEADER = "x-soundbox";

export { hostnameOf };

const HERE = dirname(fileURLToPath(import.meta.url));

/** The built UI, if it was bundled. `HERE` is `server/src` in dev and
 *  `server/dist` when built, so `server/web` is one level up from either —
 *  in a checkout and in the desktop app's installed copy alike. */
function uiDir(): string | null {
  const candidates = [resolve(HERE, "..", "web")];
  for (const dir of candidates) {
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
  }
  return null;
}

export function buildApp(config: Config, options: BuildAppOptions = {}): FastifyInstance {
  const { serveUi = true, mcpTools, allowedHosts = [], apiToken = null } = options;
  const guard = apiToken ? new AccessGuard(apiToken) : null;
  // bodyLimit, not Fastify's 1 MB default: the audio upload routes take the
  // file as the raw request body, and anything longer than a few seconds of
  // speech is past 1 MB. Over the limit Fastify tears down the connection at
  // the parser, so the caller sees a bare network error rather than a 413 —
  // the routes enforce the real per-upload cap themselves.
  //
  // forceCloseConnections: an open UI keeps SSE streams (job progress, story
  // updates) and MCP clients keep event streams, none of which ever end on
  // their own. With Fastify's default of closing only idle connections,
  // `app.close()` waited on those forever and the onClose hook below — the
  // one that stops the engine child processes — never ran.
  const app = Fastify({
    logger: false,
    bodyLimit: MAX_UPLOAD_BYTES,
    forceCloseConnections: true,
  });
  const svc = new SoundboxService(config);
  svc.start();
  app.decorate("soundbox", svc);

  // DNS-rebinding defence: a hostile page whose domain re-resolves to
  // 127.0.0.1 reaches this server same-origin, but its Host header still
  // names the hostile domain. Only loopback names (any port), a host the user
  // deliberately bound to, and the names in SOUNDBOX_ALLOWED_HOSTS (what a
  // reverse proxy forwards as Host) are served.
  const extraHosts = new Set(
    allowedHosts === "any" ? [] : allowedHosts.map((h) => hostnameOf(h)),
  );
  // CSRF defence: a cross-site form or no-cors fetch can POST to localhost
  // without a preflight only with no body or a "simple" content type. Mutating
  // /api requests must therefore carry a non-simple Content-Type (JSON, the
  // raw audio upload types) or the X-Soundbox header.
  const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  app.addHook("onRequest", async (request, reply) => {
    if (allowedHosts !== "any") {
      const host = request.headers.host ?? "";
      const name = hostnameOf(host);
      if (!LOOPBACK_HOSTS.has(name) && !extraHosts.has(name) && !isListedHost(host)) {
        return reply.code(403).send({ detail: "Forbidden host" });
      }
    }
    // After the Host check, so a rebinding page is still told "forbidden
    // host" rather than learning that a token would get it in.
    if (guard) {
      const refused = guard.check(request, reply);
      if (refused) return refused;
    }
    if (MUTATING.has(request.method) && request.url.startsWith("/api/")) {
      if (request.headers[CSRF_HEADER] !== undefined) return;
      const ct = (request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (!ct || SIMPLE_CONTENT_TYPES.has(ct)) {
        return reply.code(403).send({
          detail:
            "Mutating API requests need Content-Type: application/json (or an audio upload type) " +
            "or an X-Soundbox header",
        });
      }
    }
  });

  // FastAPI treats a body-less POST to an endpoint with an optional model as
  // "no body"; Fastify's JSON parser rejects it outright. POST /api/sessions
  // and the parameterless POSTs rely on this.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body: string, done) => {
      if (!body) return done(null, undefined);
      try {
        done(null, JSON.parse(body));
      } catch (exc) {
        done(new HttpError(400, exc instanceof Error ? exc.message : String(exc)), undefined);
      }
    },
  );

  // Only the origins in origins.ts get CORS headers; every other page can
  // still send a simple request (the CSRF hook above handles that) but can't
  // read the answer. A delegator rather than an `origin` callback because
  // "is this our own origin" needs the request's Host header, which the
  // plain callback is never given.
  void app.register(fastifyCors, {
    delegator: (request, cb) => {
      const origin = request.headers.origin;
      cb(null, {
        origin: !origin || isAllowedOrigin(origin, request.headers.host),
        credentials: false,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"],
        allowedHeaders: "*",
        // Custom response headers are invisible to browser JS across origins
        // unless explicitly exposed — CORS default is deny. A dev UI calling
        // this backend directly rather than through Vite's proxy is that case.
        exposedHeaders: [FORMAT_FALLBACK_HEADER],
      });
    },
  });

  registerAuth(app, guard);
  registerModels(app, svc);
  registerJobs(app, svc);
  registerSounds(app, svc);
  registerVoices(app, svc);
  registerSessions(app, svc);
  registerHistory(app, svc);
  registerStories(app, svc);
  registerSettings(app, svc);
  registerProfiles(app, svc);
  registerLlm(app, svc);
  registerImage(app, svc);
  registerEndpoints(app, svc);
  // Default to the server's own tool list (routes/mcp.ts uses this for
  // GET /api/mcp/status) rather than an empty array — the caller only needs
  // to override this for tests that stub the MCP layer out entirely.
  registerMcp(app, svc, mcpTools ?? (async () => toolInfos()));
  registerFiles(app, config);
  registerFs(app);

  // The actual MCP transport, mounted at exactly "/mcp" (see mountMcp's own
  // doc comment for why both "/mcp" and "/mcp/" are registered). This is
  // separate from registerMcp above, which only serves the JSON status/calls
  // routes under /api/mcp/* — easy to conflate since both files are named
  // "mcp", but they are the transport and the telemetry dashboard respectively.
  const mcpEndpoint = mountMcp(app, () => app.soundbox);

  app.setErrorHandler((error, _request, reply) => {
    // Any ModelError that reaches the boundary is something the user can act
    // on, so it is a 400 with its own message rather than a 500.
    if (error instanceof ModelError) {
      return reply.code(400).send({ detail: error.message, failure: buildFailure(error) });
    }
    // 429 rather than 400: nothing about the request was wrong, there is just
    // no room in the queue this second.
    if (error instanceof QueueFull) {
      return reply.code(429).send({ detail: error.message });
    }
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ detail: error.message });
    }
    if (error instanceof ZodError) {
      // Same envelope FastAPI uses for a request-validation failure.
      return reply.code(422).send({
        detail: error.issues.map((issue) => ({
          loc: ["body", ...issue.path.map(String)],
          msg: issue.message,
          type: issue.code,
        })),
      });
    }
    const err = error as { statusCode?: number; message: string; stack?: string };
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      console.error(
        `unhandled error on ${_request.method} ${_request.url}: ${err.stack ?? err.message}`,
      );
      return reply.code(status).send({ detail: "Internal Server Error" });
    }
    return reply.code(status).send({ detail: err.message });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ detail: "Not Found" });
  });

  if (serveUi) {
    const dir = uiDir();
    if (dir) {
      void app.register(fastifyStatic, { root: dir, prefix: "/", index: ["index.html"] });
    } else {
      app.get("/", async () => ({
        name: "Soundbox",
        version: VERSION,
        ui: "not bundled — run `npm run dev` in app/ and open http://localhost:5174",
        docs: "/docs",
        mcp: "/mcp",
      }));
    }
  }

  // Free VRAM after a period of inactivity so the GPU is usable for other
  // things between bursts of generation.
  const idle = setInterval(() => {
    void svc.models.maybeAutoUnload(config.settings.auto_unload_minutes);
    // audio.cpp's package manager only runs during a download, so it is idle
    // almost always — this is what actually stops it again afterwards.
    void svc.models.runtime.maybeAutoStop(config.settings.auto_unload_minutes);
    void svc.llm.maybeAutoStop(config.settings.auto_unload_minutes);
    // The artwork engine holds VRAM the audio model wants, so it gets the
    // same idle treatment rather than sitting there between covers.
    void svc.image.maybeAutoStop(config.settings.auto_unload_minutes);
  }, 30_000);
  idle.unref();

  app.addHook("onReady", async () => {
    // Before anything asks whether a model is downloaded: weights installed
    // under the old per-model-id layout have to be moved to the one audio.cpp
    // uses, or they would read as missing. Non-fatal by construction.
    await svc.migrateAudiocppLayout();
    // Then, with the layout settled, adopt whatever is already downloaded —
    // the weights are shared across profiles even though the enable list is
    // not, so a model on this disk belongs in this profile's list.
    await svc.adoptDownloadedModels();
    console.info(
      `Soundbox ${VERSION} ready — profile ${config.profile}, data dir ${config.paths.root}`,
    );
  });
  app.addHook("onClose", async () => {
    clearInterval(idle);
    // MCP sessions first: their transports hold open streams, and a tool call
    // still in flight should end before the service it calls is torn down.
    await mcpEndpoint.close();
    await svc.close();
  });

  return app;
}
