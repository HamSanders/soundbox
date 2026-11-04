/**
 * Settings and log-tail routes.
 */

import type { FastifyInstance } from "fastify";

import type { SettingsData } from "../config.js";
import { settingsPatchSchema } from "../schemas.js";
import type { KonchiService } from "../service.js";
import { intQuery } from "./helpers.js";

export function registerSettings(app: FastifyInstance, svc: KonchiService): void {
  app.get("/api/settings", async () => svc.getSettings());

  app.patch("/api/settings", async (request) => {
    const parsed = settingsPatchSchema.parse(request.body ?? {});
    // `exclude_none=True` in the Python. The service keys its side effects off
    // `"x" in patch`, so an omitted field must not survive as an explicit null.
    const patch: Partial<SettingsData> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || value === undefined) continue;
      (patch as Record<string, unknown>)[key] = value;
    }
    return svc.updateSettings(patch);
  });

  /**
   * Tail of the persistent log file (see docs/INSTALL.md#troubleshooting).
   *
   * A convenience for the app/MCP to show recent server activity without
   * shelling in — not a substitute for the log file itself, which is the thing
   * to `grep` for a full per-job trail.
   */
  app.get("/api/logs", async (request) => {
    const query = request.query as Record<string, string | string[] | undefined>;
    return { lines: svc.tailLog(intQuery(query.lines, "lines", 200, 1, 5000)) };
  });
}
