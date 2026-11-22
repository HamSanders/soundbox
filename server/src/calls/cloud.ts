/**
 * Calls on Mirli Cloud. The app keeps talking to this server's /api/calls; with the cloud back end picked,
 * this server forwards each call to the gateway's Call API (POST/DELETE /v1/calls, heartbeat, with the
 * user's Mirli Cloud device token), then puts the character's portrait on the call pod using the call's own
 * token. Characters stay on this machine; the gateway gets the persona and voice with the call.
 *
 * The choice is stored in `<root>/calls-backend.json` (`{ mode, url, token }`); the token is the device
 * token from signing in to Mirli Cloud. MIRLI_CLOUD_URL / MIRLI_CLOUD_TOKEN override the file.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PortraitSource } from "./workers.js";

export interface BackendChoice {
  mode: "local" | "cloud";
  url: string;
  token: string | null;
}

export const DEFAULT_CLOUD_URL = "https://api.mirli.app";

export class BackendStore {
  #file: string;
  constructor(root: string, private env: NodeJS.ProcessEnv = process.env) {
    this.#file = join(root, "calls-backend.json");
  }
  get(): BackendChoice {
    let saved: Partial<BackendChoice> = {};
    try {
      if (existsSync(this.#file)) saved = JSON.parse(readFileSync(this.#file, "utf8"));
    } catch { /* a broken file means local */ }
    return {
      mode: saved.mode === "cloud" ? "cloud" : "local",
      url: (this.env.MIRLI_CLOUD_URL || saved.url || DEFAULT_CLOUD_URL).replace(/\/$/, ""),
      token: this.env.MIRLI_CLOUD_TOKEN || saved.token || null,
    };
  }
  set(patch: Partial<BackendChoice>): BackendChoice {
    const next = { ...this.get(), ...patch };
    writeFileSync(this.#file, JSON.stringify(next, null, 2), { mode: 0o600 });
    return next;
  }
  /** What the app may see: never the token itself. */
  view() {
    const b = this.get();
    return { mode: b.mode, url: b.url, signed_in: !!b.token };
  }
}

export class CloudError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface CloudGrant {
  call_id: string;
  mode: "video" | "voice";
  ws_url: string;
  face_ws_url: string | null;
  token: string;
  expires: number;
  heartbeat_s: number;
  persona: string;
  voice_id: string | null;
  minutes_left_s?: number | null;
}

export class CloudCalls {
  constructor(private backend: () => BackendChoice, private fetchImpl: typeof fetch = fetch) {}

  async #req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const b = this.backend();
    if (!b.token) throw new CloudError(401, "unauthorized", "Sign in to Mirli Cloud first (Calls > Back end).");
    let r: Response;
    try {
      r = await this.fetchImpl(`${b.url}${path}`, {
        method,
        headers: { Authorization: `Bearer ${b.token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new CloudError(503, "unreachable", `Can't reach Mirli Cloud at ${b.url}.`);
    }
    const data = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (!r.ok) throw new CloudError(r.status, data.error?.code ?? "cloud", data.error?.message ?? `Mirli Cloud: HTTP ${r.status}`);
    return data as T;
  }

  start(mode: "video" | "voice", character: string | null, persona: string, voiceId: string | null) {
    return this.#req<CloudGrant>("POST", "/v1/calls", { mode, character, persona, voice_id: voiceId });
  }
  heartbeat(id: string) {
    return this.#req<{ expires: number; token: string; minutes_left_s?: number | null }>("POST", `/v1/calls/${id}/heartbeat`, {});
  }
  end(id: string) {
    return this.#req<{ minutes: number; credits: number }>("DELETE", `/v1/calls/${id}`);
  }

  /** Put the portrait on the call's pod (face worker behind /facesrv), with the call's own token. */
  async showPortrait(grant: CloudGrant, src: PortraitSource): Promise<void> {
    if (!grant.face_ws_url) return;
    const base = grant.face_ws_url.replace(/^ws/, "http").replace(/\/ws$/, "");
    const auth = { Authorization: `Bearer ${grant.token}` };
    const headers: Record<string, string> = { ...auth, "X-Name": src.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 24) || "character" };
    if (src.crop) headers["X-Crop"] = `${src.crop.x},${src.crop.y},${src.crop.size}`;
    const up = await this.fetchImpl(`${base}/faces`, { method: "POST", headers, body: await readFile(src.path), signal: AbortSignal.timeout(30_000) });
    if (!up.ok) throw new CloudError(502, "pod", `The call pod refused the portrait (HTTP ${up.status}).`);
    const { id } = (await up.json()) as { id: string };
    const pick = await this.fetchImpl(`${base}/face`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(10_000) });
    if (!pick.ok) throw new CloudError(502, "pod", `The call pod couldn't switch to the portrait (HTTP ${pick.status}).`);
  }
}
