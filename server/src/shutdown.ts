/**
 * Close the server properly and exit, whatever asked for it: a signal (see
 * cli.ts) or the idle timer (see idle.ts).
 *
 * `app.close()` runs every onClose hook: the audio.cpp, llama-server and
 * sd-server children are stopped, MCP streams are ended rather than cut, and
 * SQLite gets its close. If something in it hangs, the grace timer makes sure
 * the process still goes.
 */

import { getLogger } from "./logging.js";

const log = getLogger("mirli.shutdown");

/** How long a graceful shutdown may take before the process exits anyway. */
export const SHUTDOWN_GRACE_MS = 10_000;

export function closeAndExit(
  app: { close(): Promise<unknown> },
  reason: string,
  exit: (code: number) => void = (code) => process.exit(code),
  graceMs: number = SHUTDOWN_GRACE_MS,
): void {
  log.info(`${reason}, shutting down`);
  const force = setTimeout(() => {
    log.warning(`shutdown took over ${graceMs / 1000}s; exiting anyway`);
    exit(1);
  }, graceMs);
  force.unref();
  app.close().then(
    () => {
      clearTimeout(force);
      exit(0);
    },
    (exc: unknown) => {
      clearTimeout(force);
      log.warning(`error during shutdown: ${exc instanceof Error ? exc.message : String(exc)}`);
      exit(1);
    },
  );
}
