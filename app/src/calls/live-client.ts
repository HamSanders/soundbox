/**
 * The Call API client. The Calls area talks to the back end only through
 * this module (plus the voice worker's WebSocket URL a call hands out).
 *
 * Contract (server/src/routes/calls.ts), relative to the base:
 *   POST   /calls                 { character? } -> CallGrant
 *   POST   /calls/:id/heartbeat   -> { expires, token }
 *   POST   /calls/:id/character   { character } -> { character, name, persona, voice_id }
 *   DELETE /calls/:id             -> ledger row
 *   GET    /calls/status, /calls/voices, /calls/history
 *   GET|POST /characters, GET|PATCH|DELETE /characters/:id, GET /characters/:id/portrait
 */

import { IS_MOCK } from "@/lib/api";
import { mockCallsFetch } from "@/lib/mock";

export type CallMode = "voice";

export interface CallGrant {
  call_id: string;
  mode: CallMode;
  character: string | null;
  /** Who is on the call: the character's name, or "Mirli". */
  name: string;
  /** Voice worker WebSocket: mic in, events and speech out. */
  ws_url: string;
  /** Signed, short-lived. Sent as the WebSocket subprotocol `bearer.<token>`. */
  token: string;
  expires: number;
  heartbeat_s: number;
  /** The LLM's system prompt for this call (the spoken-sentences rule is already on it). */
  persona: string;
  /** The character's voice, if it has one. */
  voice_id: string | null;
}

/** What switching character mid-call hands back; the persona and voice then go out on the socket. */
export interface CallCharacter { character: string; name: string; persona: string; voice_id: string | null }

export interface Character {
  id: string;
  name: string;
  persona: string;
  voice_id: string | null;
  builtin: boolean;
  created_at: string;
  /** Null when the character has no portrait. */
  portrait_url: string | null;
}

export interface CallVoice { id: string; name: string; model?: string }

export interface CallStatus {
  /** The live voice worker is up. */
  voice: boolean;
  url?: string;
  active_calls: number;
}

export interface CallHistory {
  used_seconds: number;
  recent_calls: { call: string; mode: CallMode; character: string | null; seconds: number; started: number; reason: string }[];
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

/** URLs from the API (portraits) resolved against the API's base. */
export function assetUrl(base: string, path: string): string {
  if (/^(https?|data|blob):/.test(path)) return path;
  const origin = /^https?:/.test(base) ? new URL(base).origin : typeof location !== "undefined" ? location.origin : "";
  return origin + path;
}

export function createCallsClient(baseUrl = "/api", opts: { fetch?: typeof fetch } = {}) {
  const base = baseUrl.replace(/\/$/, "");
  const send = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    // X-Soundbox: the Mirli server refuses mutating requests a cross-site page could send without a preflight.
    const headers: Record<string, string> = { Accept: "application/json", "X-Soundbox": "1" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let r: Response;
    try {
      r = await send(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new CallApiError(0, "unreachable", "Can't reach the Mirli server.");
    }
    if (r.status === 204) return undefined as T;
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const d = data as { error?: { code?: string; message?: string }; detail?: string };
      throw new CallApiError(r.status, d.error?.code ?? "error", d.error?.message ?? d.detail ?? `HTTP ${r.status}`);
    }
    return data as T;
  }

  const enc = encodeURIComponent;
  return {
    baseUrl: base,
    url: (path: string) => assetUrl(base, path),
    status: () => req<CallStatus>("GET", "/calls/status"),
    history: () => req<CallHistory>("GET", "/calls/history"),
    voices: () => req<{ voices: CallVoice[] }>("GET", "/calls/voices").then((d) => d.voices),

    characters: () => req<{ characters: Character[] }>("GET", "/characters").then((d) => d.characters),
    character: (id: string) => req<Character>("GET", `/characters/${enc(id)}`),
    /** `image` is a data URL; `prompt` has Mirli's image engine draw one. Both optional. */
    createCharacter: (c: { name: string; persona?: string; voice_id?: string | null; image?: string; prompt?: string }) =>
      req<Character>("POST", "/characters", c),
    updateCharacter: (id: string, c: { name?: string; persona?: string; voice_id?: string | null; image?: string; prompt?: string }) =>
      req<Character>("PATCH", `/characters/${enc(id)}`, c),
    deleteCharacter: (id: string) => req<void>("DELETE", `/characters/${enc(id)}`),

    startCall: (character?: string | null) => req<CallGrant>("POST", "/calls", { character: character ?? null }),
    heartbeat: (id: string) => req<{ call_id: string; expires: number; token: string }>("POST", `/calls/${enc(id)}/heartbeat`, {}),
    /** Switch who is on the call; the session then sends the persona and voice on its socket. */
    setCharacter: (id: string, character: string) => req<CallCharacter>("POST", `/calls/${enc(id)}/character`, { character }),
    endCall: (id: string) => req<{ seconds: number }>("DELETE", `/calls/${enc(id)}`),
  };
}

export type CallsClient = ReturnType<typeof createCallsClient>;

/** The one the app uses: the Mirli server it was served by, or the in-memory mock. */
export const calls = createCallsClient("/api", IS_MOCK ? { fetch: mockCallsFetch } : {});

/** A file to a data URL, for portrait uploads. */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    r.readAsDataURL(file);
  });
}
