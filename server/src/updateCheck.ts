/**
 * "Is there a newer version?" — the one request Mirli makes on its own.
 *
 * Once a day (at most) a running server asks the project's update endpoint for
 * the latest release. The request is a GET carrying two things in the query:
 * the version this server is, and the platform it runs on (`win32-x64`). There
 * is no install id, no account, no machine name and no cookie. The endpoint
 * adds one to a per-day, per-version counter, which is how the project learns
 * roughly how many installs are running and on which versions. Your address is
 * visible to the host, as it is to any web server, and is not stored.
 *
 * It can be turned off in Settings → Updates, or with `MIRLI_UPDATE_CHECK=0`
 * (the env var wins, for Docker and managed installs). Off means no request.
 *
 * Why a throttle file rather than a timer alone: the endpoint counts requests,
 * so a server restarted five times in an afternoon would be counted five times.
 * The time of the last answer is kept beside the data directory's other
 * install-wide files, which keeps it to about one count per install per day
 * without giving the install an identity.
 *
 * Every failure is swallowed and logged: offline, a slow network or a down
 * endpoint must never reach the person using the app.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Config } from "./config.js";
import { VERSION } from "./config.js";
import { getLogger } from "./logging.js";
import { envVar } from "./env.js";

const _logger = getLogger("mirli.update");
const log = { info: (m: string) => _logger.info(m), warn: (m: string) => _logger.warning(m) };

/** Where the question goes. Overridable for tests and for a fork's own host. */
export const DEFAULT_UPDATE_URL = "https://mirli.app/api/update";
/** Ask again no sooner than this after a good answer. A little under a day so
 *  a server left running does not drift past 24 h between asks. */
export const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;
/** Wait this long after startup before the first ask: it is not worth slowing
 *  a launch for, and a server that dies in its first minute never asks. */
const FIRST_CHECK_DELAY_MS = 30_000;
/** How often to look at the clock while running. */
const TICK_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 8_000;
const THROTTLE_FILE = "update-check.json";

export interface UpdateStatus {
  /** Whether a check will happen: the setting is on and nothing forces it off. */
  enabled: boolean;
  /** `"env"` when MIRLI_UPDATE_CHECK=0 is what turned it off. */
  disabled_by: "env" | "setting" | null;
  current: string;
  latest: string | null;
  /** True when `latest` is newer than `current`. */
  available: boolean;
  /** Release page for `latest`. */
  url: string | null;
  /** ISO time of the last answer, or null if there has not been one. */
  checked_at: string | null;
  /** The endpoint asked, so the Settings page can say where the request goes. */
  endpoint: string;
  error: string | null;
}

interface Saved {
  checked_at: string;
  latest: string | null;
  url: string | null;
}

/** `1.10.0` > `1.9.2`. Prereleases compare by their numeric core only; the
 *  endpoint reports published releases, so a prerelease tag does not arise. */
export function isNewer(latest: string, current: string): boolean {
  const parts = (v: string) =>
    v
      .replace(/^v/i, "")
      .split("-")[0]!
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export interface UpdateCheckerOptions {
  fetch?: typeof fetch;
  now?: () => number;
  /** Defaults to this server's own version. */
  version?: string;
  /** Defaults to `process.platform-process.arch`. */
  platform?: string;
}

export class UpdateChecker {
  private readonly config: Config;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly version: string;
  private readonly platform: string;
  private saved: Saved | null = null;
  private error: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<UpdateStatus> | null = null;

  constructor(config: Config, opts: UpdateCheckerOptions = {}) {
    this.config = config;
    this.fetchFn = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.version = opts.version ?? VERSION;
    this.platform = opts.platform ?? `${process.platform}-${process.arch}`;
    this.saved = this.load();
  }

  private get file(): string {
    // `base`, not the profile directory: one install is one count, however many
    // profiles it has.
    return join(this.config.paths.base, THROTTLE_FILE);
  }

  private load(): Saved | null {
    try {
      if (!existsSync(this.file)) return null;
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Saved>;
      if (typeof raw.checked_at !== "string") return null;
      return {
        checked_at: raw.checked_at,
        latest: typeof raw.latest === "string" ? raw.latest : null,
        url: typeof raw.url === "string" ? raw.url : null,
      };
    } catch {
      return null;
    }
  }

  private persist(): void {
    if (!this.saved) return;
    try {
      writeFileSync(this.file, JSON.stringify(this.saved), "utf8");
    } catch (exc) {
      log.warn(`could not save the update check time: ${exc instanceof Error ? exc.message : exc}`);
    }
  }

  endpoint(): string {
    return envVar("MIRLI_UPDATE_URL") || DEFAULT_UPDATE_URL;
  }

  /** Why no check will happen, or null when one will. */
  private disabledBy(): "env" | "setting" | null {
    const env = envVar("MIRLI_UPDATE_CHECK");
    if (env !== undefined && /^(0|false|off|no)$/i.test(env.trim())) return "env";
    if (!this.config.settings.update_check) return "setting";
    return null;
  }

  status(): UpdateStatus {
    const disabledBy = this.disabledBy();
    const latest = this.saved?.latest ?? null;
    return {
      enabled: disabledBy === null,
      disabled_by: disabledBy,
      current: this.version,
      latest,
      // A turned-off check shows nothing, even from an older answer: the page
      // must not nag someone who said no.
      available: disabledBy === null && latest !== null && isNewer(latest, this.version),
      url: disabledBy === null ? (this.saved?.url ?? null) : null,
      checked_at: this.saved?.checked_at ?? null,
      endpoint: this.endpoint(),
      error: this.error,
    };
  }

  /** Begin the background schedule. Safe to call when disabled: the setting is
   *  read at each tick, so turning it on later takes effect without a restart. */
  start(): void {
    if (this.timer) return;
    const first = setTimeout(() => void this.tick(), FIRST_CHECK_DELAY_MS);
    first.unref();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    this.firstTimer = first;
  }

  private firstTimer: NodeJS.Timeout | null = null;

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstTimer) clearTimeout(this.firstTimer);
    this.timer = null;
    this.firstTimer = null;
  }

  private async tick(): Promise<void> {
    if (this.disabledBy() !== null) return;
    if (this.saved) {
      const age = this.now() - Date.parse(this.saved.checked_at);
      if (Number.isFinite(age) && age >= 0 && age < MIN_INTERVAL_MS) return;
    }
    await this.check();
  }

  /**
   * Ask now, whatever the throttle says. This is what the "Check now" button
   * calls, and it is still refused when the check is turned off.
   */
  check(): Promise<UpdateStatus> {
    if (this.disabledBy() !== null) return Promise.resolve(this.status());
    // One request at a time: a double-click must not be counted twice.
    this.inFlight ??= this.ask().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async ask(): Promise<UpdateStatus> {
    const url = new URL(this.endpoint());
    url.searchParams.set("v", this.version);
    url.searchParams.set("p", this.platform);
    try {
      const res = await this.fetchFn(url, {
        method: "GET",
        redirect: "follow",
        headers: { accept: "application/json", "user-agent": `Soundbox/${this.version}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`the update endpoint answered ${res.status}`);
      const body = (await res.json()) as { latest?: unknown; url?: unknown };
      const latest = typeof body.latest === "string" && /^\d+(\.\d+){1,3}$/.test(body.latest) ? body.latest : null;
      const page =
        typeof body.url === "string" && body.url.startsWith("https://github.com/") ? body.url : null;
      this.saved = { checked_at: new Date(this.now()).toISOString(), latest, url: page };
      this.error = null;
      this.persist();
      log.info(
        `update check: running ${this.version}, latest ${latest ?? "unknown"}` +
          (latest && isNewer(latest, this.version) ? " (newer available)" : ""),
      );
    } catch (exc) {
      this.error = exc instanceof Error ? exc.message : String(exc);
      log.info(`update check failed: ${this.error}`);
    }
    return this.status();
  }
}
