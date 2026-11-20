/**
 * Exit when idle (`MIRLI_IDLE_EXIT_MINUTES`).
 *
 * For a server that is started on demand and needn't keep running between
 * uses: after this many minutes with no requests, none still being answered,
 * and no queued or running jobs, the server closes and the process exits with
 * status 0. Whatever started it (a scale-to-zero platform, socket activation,
 * a supervisor) starts it again on the next request. Off unless the variable
 * is set to a positive number.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";

import { envVar } from "./env.js";
import { closeAndExit } from "./shutdown.js";

export interface IdleExitOptions {
  /** True while a job is queued or running: never idle then. */
  busy: () => boolean;
  /** Minutes without requests; defaults to `MIRLI_IDLE_EXIT_MINUTES`. 0 or unset: off. */
  minutes?: number;
  /** What to do when idle; defaults to closing the server and exiting. */
  onIdle?: () => void;
  /** Check interval, for tests. */
  checkEveryMs?: number;
}

export function idleExitMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(envVar("MIRLI_IDLE_EXIT_MINUTES", env) ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A health probe is a platform checking on us, not someone using it. */
function isProbe(request: FastifyRequest): boolean {
  return request.routeOptions.url === "/api/health";
}

export function registerIdleExit(app: FastifyInstance, opts: IdleExitOptions): void {
  const minutes = opts.minutes ?? idleExitMinutes();
  if (minutes <= 0) return;
  let last = Date.now();
  // Requests still being answered. A long one (a streamed read, a render, an
  // export) is work even though no new request has come in for a while.
  const inFlight = new Set<FastifyRequest>();
  app.addHook("onRequest", async (request) => {
    if (isProbe(request)) return;
    last = Date.now();
    inFlight.add(request);
  });
  const done = async (request: FastifyRequest): Promise<void> => {
    if (inFlight.delete(request)) last = Date.now();
  };
  app.addHook("onResponse", done);
  app.addHook("onRequestAbort", done);
  const timer = setInterval(() => {
    if (opts.busy() || inFlight.size > 0) {
      last = Date.now();
      return;
    }
    if (Date.now() - last > minutes * 60_000) {
      clearInterval(timer);
      (opts.onIdle ?? (() => closeAndExit(app, `idle for ${minutes} min`)))();
    }
  }, opts.checkEveryMs ?? 30_000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
}
