/**
 * The voice worker on this machine (VAD, ASR, LLM, TTS): `live/voice/`, a
 * separate process the Mirli server talks to over HTTP. The server hands its
 * WebSocket URL and a signed call token to the app or an integration (such as
 * the Discord bot), which then streams audio to it directly.
 */

import { signCallToken } from "./token.js";

export interface WorkerConfig {
  voiceUrl: string;
  secret: string;
}

export function workerConfigFromEnv(secret: string, env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    voiceUrl: (env.MIRLI_CALL_VOICE_URL || "http://127.0.0.1:17650").trim().replace(/\/$/, ""),
    secret,
  };
}

export class WorkerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface WorkerVoice { id: string; name: string; model?: string | null }

export class CallWorkers {
  constructor(readonly cfg: WorkerConfig, private fetchImpl: typeof fetch = fetch) {}

  get voiceUrl() { return this.cfg.voiceUrl; }

  #admin(call = "admin") {
    return { Authorization: `Bearer ${signCallToken({ call, aud: ["admin"] }, this.cfg.secret, 30)}` };
  }

  async #json<T>(url: string, init: RequestInit = {}, timeoutMs = 2500): Promise<T> {
    let r: Response;
    try {
      r = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new WorkerError(503, `The live voice server isn't running at ${new URL(url).host}. Start it with: cd live/voice && npm start`);
    }
    if (!r.ok) throw new WorkerError(r.status >= 500 ? 502 : r.status, (await r.text().catch(() => "")) || `HTTP ${r.status}`);
    return (await r.json()) as T;
  }

  /** Whether the voice worker answers. */
  async status(): Promise<{ voice: boolean; url: string }> {
    const voice = await this.#json(`${this.cfg.voiceUrl}/readyz`, {}, 1500).then(() => true, () => false);
    return { voice, url: this.cfg.voiceUrl };
  }

  /** The saved Mirli voices the worker can speak with. */
  voices() {
    return this.#json<WorkerVoice[]>(`${this.cfg.voiceUrl}/voices`);
  }

  /** The worker drops the call's socket (close code 4001). */
  async end(callId: string): Promise<void> {
    await this.fetchImpl(`${this.cfg.voiceUrl}/internal/calls/${callId}/end`, {
      method: "POST", headers: this.#admin(callId), signal: AbortSignal.timeout(2000),
    }).catch(() => {});
  }
}
