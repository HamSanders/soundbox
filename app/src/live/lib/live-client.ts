/**
 * The Mirli Live Call API client. The web app talks to the back end only
 * through this module (plus the two WebSocket URLs a call hands out), so the
 * same front end runs against the local API on this machine and the cloud
 * gateway: only `baseUrl` changes.
 *
 * Contract (live/README.md):
 *   POST   /v1/calls                 -> CallGrant
 *   POST   /v1/calls/:id/heartbeat   -> { expires, token }
 *   POST   /v1/calls/:id/character   -> { character, name, persona }
 *   DELETE /v1/calls/:id             -> { seconds, ... }
 *   GET    /v1/characters, /v1/voices, /v1/account, /v1/health, /v1/face-models
 */

export type CallMode = "video" | "voice";

export interface CallGrant {
  call_id: string;
  mode: CallMode;
  character: string | null;
  /** Voice worker WebSocket: mic in, events and speech out. */
  ws_url: string;
  /** Face worker WebSocket: audio + frames out. Null for a voice call. */
  face_ws_url: string | null;
  /** Signed, short-lived. Sent as the WebSocket subprotocol `bearer.<token>`. */
  token: string;
  /** When the call lapses without a heartbeat (unix seconds). */
  expires: number;
  heartbeat_s: number;
  /** The LLM's system prompt for this call. */
  persona: string;
}

export interface Character {
  id: string;
  name: string;
  kind: "character" | "upload" | "sample";
  persona: string;
}

export interface Voice { id: string; name: string; model?: string }

export interface Health {
  ok: boolean;
  mode: "local" | "cloud";
  voice: boolean;
  face: { url?: string; engine: string; ready: boolean } | null;
  active_calls: number;
}

export interface Account {
  plan: string;
  name: string;
  minutes: { unlimited: boolean; used_seconds: number; included_seconds?: number; left_seconds?: number };
  recent_calls: { call: string; mode: CallMode; seconds: number; started: number; reason: string }[];
}

export interface FaceModels {
  current: string | null;
  switching?: string | null;
  available: { id: string; name: string; installed: boolean }[];
}

export class LiveApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The WebSocket subprotocols that carry a call token. */
export const wsProtocols = (token: string) => ["mirli.v1", `bearer.${token}`];

export function createLiveClient(baseUrl: string, opts: { authToken?: () => string | null } = {}) {
  const base = baseUrl.replace(/\/$/, "");

  async function req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const auth = opts.authToken?.();
    const init: RequestInit = { method, headers: { ...headers, ...(auth ? { Authorization: `Bearer ${auth}` } : {}) } };
    if (body instanceof Blob) init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    }
    let r: Response;
    try {
      r = await fetch(base + path, init);
    } catch {
      throw new LiveApiError(0, "unreachable", "Can't reach the Mirli Live service.");
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = (data as { error?: { code?: string; message?: string } }).error ?? {};
      throw new LiveApiError(r.status, e.code ?? "error", e.message ?? `HTTP ${r.status}`);
    }
    return data as T;
  }

  return {
    baseUrl: base,
    health: () => req<Health>("GET", "/v1/health"),
    account: () => req<Account>("GET", "/v1/account"),
    voices: () => req<{ voices: Voice[] }>("GET", "/v1/voices").then((d) => d.voices),
    characters: () => req<{ characters: Character[]; current: string | null; face: boolean }>("GET", "/v1/characters"),
    portraitUrl: (id: string) => `${base}/v1/characters/${encodeURIComponent(id)}/portrait`,
    uploadCharacter: (file: File) =>
      req<{ id: string }>("POST", "/v1/characters", file, { "X-Name": file.name.replace(/\.[^.]+$/, "").replace(/[^\w]/g, "") || "photo" }),
    faceModels: () => req<FaceModels>("GET", "/v1/face-models"),
    switchFaceModel: (name: string) => req<FaceModels>("POST", "/v1/face-models", { name }),

    startCall: (mode: CallMode, character?: string | null) => req<CallGrant>("POST", "/v1/calls", { mode, character: character ?? null }),
    heartbeat: (id: string) => req<{ expires: number; token: string }>("POST", `/v1/calls/${id}/heartbeat`),
    setCharacter: (id: string, character: string) =>
      req<{ character: string; name: string; persona: string }>("POST", `/v1/calls/${id}/character`, { character }),
    endCall: (id: string) => req<{ seconds: number }>("DELETE", `/v1/calls/${id}`),
  };
}

export type LiveClient = ReturnType<typeof createLiveClient>;

/** The API this build talks to: `?api=` wins, then VITE_LIVE_API, then the local API. */
export function defaultApiBase(): string {
  const q = new URLSearchParams(location.search).get("api");
  return q || (import.meta.env.VITE_LIVE_API as string | undefined) || "http://127.0.0.1:17690";
}
