/**
 * Mirli Cloud: sign-in, account, and the cloud models in the pickers.
 *
 * Off unless `MIRLI_CLOUD=1`. When on:
 *
 *  - Sign-in is the device-code flow (RFC 8628). `startSignIn()` asks the
 *    gateway for a code, returns the URL to open, and polls in the background
 *    until the person approves it in the browser. The token it gets is stored
 *    in the profile's settings.json (`cloud_token`) and is never sent back out
 *    of the API, the same as `hf_token`.
 *  - The catalog comes from the gateway's public `/v1/models`, fetched at
 *    start and on each sign-in, and registered with `ModelManager` so cloud
 *    models sit in the same pickers as local ones, each with its price.
 *  - The caps (credits per render, per day) live here, in the app, so a
 *    runaway agent is stopped before a request leaves the machine.
 */

import { hostname } from "node:os";

import type { Config } from "../config.js";
import { envVar } from "../env.js";
import { hostedMode } from "../hosted.js";
import { ModelError } from "../errors.js";
import { getLogger } from "../logging.js";
import type { ModelManager } from "../models/manager.js";
import { CloudClient, CloudError, type FetchFn } from "./client.js";
import type { CloudModel as CloudModelInfo, PackId } from "./contract.js";
import { type CloudCaps, type CloudContext, TRANSCRIBER } from "./model.js";

const log = getLogger("mirli.cloud");

export const DEFAULT_CLOUD_URL = "https://cloud.mirli.app";

export function cloudEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envVar("MIRLI_CLOUD", env) === "1" || hostedMode(env);
}

export type SignInState =
  | { state: "idle" }
  | { state: "pending"; user_code: string; verification_uri: string; verification_uri_complete: string; expires_at: string }
  | { state: "denied" | "expired" | "error"; message: string };

export interface CloudStatus {
  enabled: boolean;
  /** Mirli on the web: signed in by the host, so no sign-in or sign-out here. */
  hosted: boolean;
  base_url: string;
  signed_in: boolean;
  sign_in: SignInState;
  account: { email: string; balance: number; held: number; spent_today: number } | null;
  /** Set when the account could not be read (offline, signed out elsewhere). */
  account_error: string | null;
  caps: { per_call: number; per_day: number };
  models: number;
}

export class CloudService implements CloudContext {
  private catalog: CloudModelInfo[] = [];
  private signIn: SignInState = { state: "idle" };
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: Config,
    private readonly models: ModelManager,
    private readonly fetchImpl: FetchFn = fetch,
    readonly enabled = cloudEnabled(),
  ) {}

  get baseUrl(): string {
    return (envVar("MIRLI_CLOUD_URL") || DEFAULT_CLOUD_URL).replace(/\/+$/, "");
  }

  /** Hosted mode's sign-in comes from the host and wins over a stored one. */
  private get token(): string | null {
    if (hostedMode()) return envVar("MIRLI_CLOUD_TOKEN") || null;
    return this.config.settings.cloud_token;
  }

  client(): CloudClient | null {
    return this.enabled && this.token ? new CloudClient(this.baseUrl, this.token, this.fetchImpl) : null;
  }

  caps(): CloudCaps {
    return {
      perCall: this.config.settings.cloud_max_credits_per_call,
      perDay: this.config.settings.cloud_max_credits_per_day,
    };
  }

  private retry: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 5_000;
  /** When the catalog was last fetched; 0 until the first success. */
  private fetchedAt = 0;
  private inflight: Promise<void> | null = null;

  /** How often a running Mirli re-reads the catalog on its own. */
  static readonly REFRESH_EVERY_MS = 5 * 60_000;
  /** A model list older than this is re-read when someone opens a picker. */
  static readonly STALE_AFTER_MS = 60_000;

  /**
   * Fetch the catalog and register it. Offline is fine: the last catalog
   * stays, and a failed fetch is tried again with backoff (5 s doubling to
   * 2 min), so a Mirli that started before the gateway was reachable gets its
   * cloud models without a restart.
   */
  async refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchCatalog().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /**
   * Re-read the catalog if it is older than `maxAgeMs`, so models the gateway
   * adds show up in a running Mirli (a studio on the web runs for days) the
   * next time a picker opens, without a restart. Waits at most `waitMs`; a
   * slower gateway finishes in the background and the next list has it.
   */
  async refreshIfStale(maxAgeMs = CloudService.STALE_AFTER_MS, waitMs = 3_000): Promise<void> {
    if (!this.enabled || Date.now() - this.fetchedAt < maxAgeMs) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.refresh(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
  }

  private async fetchCatalog(): Promise<void> {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    if (!this.enabled) {
      await this.models.setCloudModels([], this);
      return;
    }
    const before = JSON.stringify(this.catalog);
    try {
      const { models } = await new CloudClient(this.baseUrl, null, this.fetchImpl).models();
      this.catalog = models;
      this.fetchedAt = Date.now();
      this.retryMs = 5_000;
      this.retry = setTimeout(() => void this.refresh(), CloudService.REFRESH_EVERY_MS);
      this.retry.unref?.();
    } catch (e) {
      log.warning(`Mirli Cloud catalog unavailable, trying again in ${this.retryMs / 1000} s: ${(e as Error).message}`);
      this.retry = setTimeout(() => void this.refresh(), this.retryMs);
      this.retry.unref?.();
      this.retryMs = Math.min(this.retryMs * 2, 120_000);
    }
    // Re-registering drops live cloud model instances, so only when it changed
    // (or on the first call, which registers even an empty catalog).
    if (!this.registered || JSON.stringify(this.catalog) !== before) {
      this.registered = true;
      await this.models.setCloudModels(this.offered(), this);
    }
  }

  private registered = false;

  /** Stop the background re-reads (shutdown, tests). */
  stop(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.cancelPoll();
  }

  /** Re-read after a profile switch: each profile has its own sign-in. */
  async reload(): Promise<void> {
    this.cancelPoll();
    this.signIn = { state: "idle" };
    await this.models.setCloudModels(this.offered(), this);
  }

  /** The catalog plus the voice-clip transcriber, which the gateway serves outside it. */
  private offered() {
    return this.catalog.length ? [...this.catalog, TRANSCRIBER] : this.catalog;
  }

  async status(): Promise<CloudStatus> {
    const client = this.client();
    let account: CloudStatus["account"] = null;
    let accountError: string | null = null;
    if (client) {
      try {
        const a = await client.account();
        account = { email: a.email, balance: a.balance, held: a.held, spent_today: a.spent_today };
      } catch (e) {
        accountError = e instanceof Error ? e.message : String(e);
        if (e instanceof CloudError && e.code === "unauthorized") await this.forget();
      }
    }
    const caps = this.caps();
    return {
      enabled: this.enabled,
      hosted: hostedMode(),
      base_url: this.baseUrl,
      signed_in: Boolean(this.client()),
      sign_in: this.signIn,
      account,
      account_error: accountError,
      caps: { per_call: caps.perCall, per_day: caps.perDay },
      models: this.catalog.length,
    };
  }

  /* -------------------------------------------------------------- sign-in */

  async startSignIn(): Promise<SignInState> {
    this.requireEnabled();
    if (hostedMode()) throw new ModelError("Mirli on the web is already signed in.");
    this.cancelPoll();
    const anon = new CloudClient(this.baseUrl, null, this.fetchImpl);
    const name = `Mirli on ${hostname()}`.slice(0, 80);
    let code;
    try {
      code = await anon.deviceCode(name);
    } catch (e) {
      throw new ModelError(e instanceof Error ? e.message : String(e));
    }
    this.signIn = {
      state: "pending",
      user_code: code.user_code,
      verification_uri: code.verification_uri,
      verification_uri_complete: code.verification_uri_complete,
      expires_at: new Date(Date.now() + code.expires_in * 1000).toISOString(),
    };
    this.schedulePoll(anon, code.device_code, code.interval);
    return this.signIn;
  }

  cancelSignIn(): void {
    this.cancelPoll();
    this.signIn = { state: "idle" };
  }

  private schedulePoll(anon: CloudClient, deviceCode: string, intervalS: number): void {
    this.pollTimer = setTimeout(() => void this.poll(anon, deviceCode, intervalS), intervalS * 1000);
    this.pollTimer.unref?.();
  }

  /** One RFC 8628 poll. Exposed for tests, which drive it without timers. */
  async poll(anon: CloudClient, deviceCode: string, intervalS: number): Promise<void> {
    this.pollTimer = null;
    if (this.signIn.state !== "pending") return;
    try {
      const { token } = await anon.deviceToken(deviceCode);
      this.config.updateSettings({ cloud_token: token });
      this.signIn = { state: "idle" };
      log.info("Signed in to Mirli Cloud");
      await this.refresh();
    } catch (e) {
      if (e instanceof CloudError) {
        if (e.code === "authorization_pending") return this.schedulePoll(anon, deviceCode, intervalS);
        if (e.code === "slow_down") return this.schedulePoll(anon, deviceCode, intervalS + 5);
        if (e.code === "network") return this.schedulePoll(anon, deviceCode, intervalS * 2);
        if (e.code === "access_denied") {
          this.signIn = { state: "denied", message: "Sign-in was refused in the browser." };
          return;
        }
        if (e.code === "expired_token") {
          this.signIn = { state: "expired", message: "The sign-in code expired. Start again." };
          return;
        }
      }
      this.signIn = { state: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }

  private cancelPoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  async signOut(): Promise<void> {
    if (hostedMode()) throw new ModelError("Sign out of Mirli on the web from your account page.");
    const client = this.client();
    if (client) await client.signOut().catch((e) => log.warning(`Mirli Cloud sign-out: ${(e as Error).message}`));
    await this.forget();
  }

  private async forget(): Promise<void> {
    this.config.updateSettings({ cloud_token: "" });
    await this.models.setCloudModels(this.offered(), this);
  }

  /* -------------------------------------------------------------- buying */

  async checkout(pack: PackId): Promise<{ url: string }> {
    const client = this.client();
    if (!client) throw new ModelError("Sign in to Mirli Cloud first.");
    try {
      return await client.checkout(pack);
    } catch (e) {
      throw new ModelError(e instanceof Error ? e.message : String(e));
    }
  }

  private requireEnabled(): void {
    if (!this.enabled) throw new ModelError("Mirli Cloud is not turned on in this build.");
  }
}
