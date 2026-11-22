/**
 * The Call API client. The Calls area talks to the back end only through
 * this module (plus the two WebSocket URLs a call hands out), so the same
 * screens run against the Mirli server on this machine (`/api`) and, later,
 * Mirli Cloud: only `baseUrl` changes.
 *
 * Contract (live/README.md), relative to the base:
 *   POST   /calls                 { mode, character? } -> CallGrant
 *   POST   /calls/:id/heartbeat   -> { expires, token }
 *   POST   /calls/:id/character   -> { character, name, persona, voice_id }
 *   DELETE /calls/:id             -> ledger row
 *   GET    /calls/status, /calls/voices, /calls/history, /calls/face-models
 *   GET|POST /characters, GET|PATCH|DELETE /characters/:id, POST /characters/:id/pack[/import]
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
  expires: number;
  heartbeat_s: number;
  /** The LLM's system prompt for this call. */
  persona: string;
  /** The character's voice, if it has one. */
  voice_id: string | null;
}

export type PackStatus = "none" | "rendering" | "ready" | "failed";

export interface Character {
  id: string;
  name: string;
  persona: string;
  voice_id: string | null;
  builtin: boolean;
  created_at: string;
  portrait_url: string;
  /** The avatar pack's manifest, when it has one. */
  pack_url: string | null;
  pack: { status: PackStatus; provider: "local" | "cloud" | "import" | null; clips: number; error: string | null; progress: string | null };
}

export interface CallVoice { id: string; name: string; model?: string }

/** Where calls run: this computer's GPU, or Mirli Cloud. The token itself never comes back. */
export interface CallBackend { mode: "local" | "cloud"; url: string; signed_in: boolean }

export interface CallStatus {
  mode: "local" | "cloud";
  signed_in?: boolean;
  voice: boolean;
  face: { url: string; engine: string; ready: boolean } | null;
  active_calls: number;
}

export interface CallHistory {
  unlimited: boolean;
  used_seconds: number;
  recent_calls: { call: string; mode: CallMode; character: string | null; seconds: number; started: number; reason: string }[];
}

export interface FaceModels {
  current: string | null;
  switching?: string | null;
  available: { id: string; name: string; installed: boolean }[];
}

export class CallApiError extends Error {
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

/** URLs from the API (portraits, pack files) resolved against the API's base. */
export function assetUrl(base: string, path: string): string {
  if (/^https?:/.test(path)) return path;
  // Absolute, so relative paths inside a pack's manifest resolve against it (new URL needs an absolute base).
  const origin = /^https?:/.test(base) ? new URL(base).origin : typeof location !== "undefined" ? location.origin : "";
  return origin + path;
}

export function createCallsClient(baseUrl = "/api", opts: { authToken?: () => string | null } = {}) {
  const base = baseUrl.replace(/\/$/, "");

  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const auth = opts.authToken?.();
    // X-Soundbox: the Mirli server refuses mutating requests a cross-site page could send without a preflight.
    const headers: Record<string, string> = { Accept: "application/json", "X-Soundbox": "1" };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let r: Response;
    try {
      r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new CallApiError(0, "unreachable", "Can't reach the call service.");
    }
    if (r.status === 204) return undefined as T;
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const d = data as { error?: { code?: string; message?: string }; detail?: string };
      throw new CallApiError(r.status, d.error?.code ?? "error", d.error?.message ?? d.detail ?? `HTTP ${r.status}`);
    }
    return data as T;
  }

  return {
    baseUrl: base,
    url: (path: string) => assetUrl(base, path),
    status: () => req<CallStatus>("GET", "/calls/status"),
    backend: () => req<CallBackend>("GET", "/calls/backend"),
    setBackend: (b: { mode?: "local" | "cloud"; url?: string; token?: string }) => req<CallBackend>("PUT", "/calls/backend", b),
    history: () => req<CallHistory>("GET", "/calls/history"),
    voices: () => req<{ voices: CallVoice[] }>("GET", "/calls/voices").then((d) => d.voices),
    faceModels: () => req<FaceModels>("GET", "/calls/face-models"),
    switchFaceModel: (name: string) => req<FaceModels>("POST", "/calls/face-models", { name }),

    characters: () => req<{ characters: Character[] }>("GET", "/characters").then((d) => d.characters),
    character: (id: string) => req<Character>("GET", `/characters/${encodeURIComponent(id)}`),
    createCharacter: (c: { name: string; persona?: string; voice_id?: string | null; image?: string; prompt?: string }) => req<Character>("POST", "/characters", c),
    updateCharacter: (id: string, c: { name?: string; persona?: string; voice_id?: string | null; image?: string }) => req<Character>("PATCH", `/characters/${encodeURIComponent(id)}`, c),
    deleteCharacter: (id: string) => req<void>("DELETE", `/characters/${encodeURIComponent(id)}`),
    renderPack: (id: string, provider: "local" | "cloud", comfy_url?: string) => req<Character>("POST", `/characters/${encodeURIComponent(id)}/pack`, { provider, comfy_url }),
    importPack: (id: string, dir: string) => req<Character>("POST", `/characters/${encodeURIComponent(id)}/pack/import`, { dir }),

    startCall: (mode: CallMode, character?: string | null) => req<CallGrant>("POST", "/calls", { mode, character: character ?? null }),
    heartbeat: (id: string) => req<{ expires: number; token: string }>("POST", `/calls/${id}/heartbeat`, {}),
    setCharacter: (id: string, character: string) => req<{ character: string; name: string; persona: string; voice_id: string | null }>("POST", `/calls/${id}/character`, { character }),
    endCall: (id: string) => req<{ seconds: number }>("DELETE", `/calls/${id}`),
  };
}

export type CallsClient = ReturnType<typeof createCallsClient>;

/** The one the app uses: the Mirli server it was served by. */
export const calls = createCallsClient("/api");

/** A file to a data URL, for portrait uploads. */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    r.readAsDataURL(file);
  });
}
