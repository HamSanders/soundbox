/**
 * Hosted mode: Mirli running for one person on a server, behind a proxy that
 * signs them in (`MIRLI_HOSTED=1`).
 *
 * The proxy authenticates the browser and adds this server's access token
 * (`MIRLI_API_TOKEN`), so the existing token guard is the lock on the door.
 * What hosted mode adds is about the machine underneath not being the user's:
 *
 *  - Nothing may touch the host: no folder browsing or folder settings, no
 *    engine installs or model downloads (there is no GPU to use them), and no
 *    custom endpoints, because a server must not fetch whatever URL a page
 *    hands it.
 *  - Generation goes through Mirli Cloud, signed in with the token the host
 *    provides (`MIRLI_CLOUD_TOKEN`), and the app runs in its simple setup.
 *  - With `MIRLI_IDLE_EXIT_MINUTES`, the process exits after that long with no
 *    requests and no jobs, so the machine it runs on can stop. The proxy starts
 *    it again on the next visit.
 */

import type { FastifyInstance } from "fastify";

import { envVar } from "./env.js";

export function hostedMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return envVar("MIRLI_HOSTED", env) === "1";
}

/** Method (or "*") and path pattern refused in hosted mode. */
const REFUSED: [string, RegExp][] = [
  ["*", /^\/api\/fs\//],
  ["*", /^\/api\/endpoints(\/|$|\?)/],
  ["POST", /^\/api\/models\/[^/]+\/(download|load|unload|selftest)(\?|$)/],
  ["DELETE", /^\/api\/models\/[^/]+\/weights(\?|$)/],
  ["POST", /^\/api\/models\/audiocpp\/engine\/install/],
  ["POST", /^\/api\/(llm|image)\/(engine\/install|models\/[^/]+\/download)/],
  ["DELETE", /^\/api\/(llm|image)\/models\//],
  ["POST", /^\/api\/instruments\/[^/]+\/download/],
  ["POST", /^\/api\/mcp\/skills\/install/],
  ["POST", /^\/api\/sounds\/[^/]+\/reveal/],
  ["POST", /^\/api\/update\/check/],
];

/** Settings a hosted user may not change: each names something on the host. */
export const HOSTED_LOCKED_SETTINGS: readonly string[] = [
  "sounds_dir",
  "audiocpp_mode",
  "audiocpp_models_dir",
  "hf_token",
  "device",
  "otel_endpoint",
  "llm_mode",
  "llm_model",
  "llm_external_base_url",
  "llm_external_model",
  "llm_external_api_key",
  "image_mode",
  "image_model",
  "image_external_kind",
  "image_external_base_url",
  "image_external_model",
  "image_external_api_key",
  "run_mode",
];

export function isRefused(method: string, url: string): boolean {
  return REFUSED.some(([m, re]) => (m === "*" || m === method) && re.test(url));
}

export interface HostedOptions {
  busy: () => boolean;
  idleExitMinutes?: number;
  /** What to do when idle; defaults to closing the server and exiting. */
  onIdle?: () => void;
  /** Check interval, for tests. */
  checkEveryMs?: number;
}

export function registerHostedGuards(app: FastifyInstance, opts: HostedOptions): void {
  let last = Date.now();
  app.addHook("onRequest", async (request, reply) => {
    // The proxy's own health probe must not count as someone using it.
    if (request.url !== "/api/health") last = Date.now();
    if (isRefused(request.method, request.url)) {
      return reply.code(403).send({ detail: "That isn't available in Mirli on the web." });
    }
  });
  const minutes = opts.idleExitMinutes ?? Number(envVar("MIRLI_IDLE_EXIT_MINUTES") ?? 0);
  if (minutes > 0) {
    const timer = setInterval(() => {
      if (opts.busy()) {
        last = Date.now();
        return;
      }
      if (Date.now() - last > minutes * 60_000) {
        clearInterval(timer);
        (opts.onIdle ?? (() => void app.close().then(() => process.exit(0))))();
      }
    }, opts.checkEveryMs ?? 30_000);
    timer.unref();
    app.addHook("onClose", async () => clearInterval(timer));
  }
}
