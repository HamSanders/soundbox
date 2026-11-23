/**
 * Hosted mode: Mirli running for one person on a server, behind a proxy that
 * signs them in (`MIRLI_HOSTED=1`).
 *
 * The proxy authenticates the browser and adds this server's access token
 * (`MIRLI_API_TOKEN`), so the existing token guard is the lock on the door.
 * The rest comes from pieces that already exist:
 *
 *  - Hosted implies sandboxed (capabilities.ts): nothing in the UI may touch
 *    the host, there are no local models, and the app runs its simple setup.
 *  - Generation goes through Mirli Cloud, signed in with the token the host
 *    provides (`MIRLI_CLOUD_TOKEN`); see cloud/service.ts.
 *  - `MIRLI_IDLE_EXIT_MINUTES` (idle.ts) lets the machine stop between visits.
 */

import { envVar } from "./env.js";

export function hostedMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return envVar("MIRLI_HOSTED", env) === "1";
}
