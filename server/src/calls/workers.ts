/**
 * The call workers on this machine: the voice worker (VAD, ASR, LLM, TTS) and
 * the face worker (MuseTalk, FlashHead or Ditto). Both live in
 * `spikes/realtime-*` for now and are started on their own; the Mirli server
 * only talks to them over HTTP and hands their WebSocket URLs to the app.
 *
 * In the cloud the same role is played by a call pod; see the Call API
 * contract in live/README.md.
 */

import { readFile } from "node:fs/promises";

import { signCallToken } from "./token.js";

export interface WorkerConfig {
  voiceUrl: string;
  /** Tried in order; the first that answers is used (MuseTalk on 17680, else 17660). */
  faceUrls: string[];
  secret: string;
}

export function workerConfigFromEnv(secret: string, env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const trim = (u: string) => u.trim().replace(/\/$/, "");
  return {
    voiceUrl: trim(env.MIRLI_CALL_VOICE_URL || "http://127.0.0.1:17650"),
    faceUrls: (env.MIRLI_CALL_FACE_URL || "http://127.0.0.1:17680,http://127.0.0.1:17660").split(",").map(trim).filter(Boolean),
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

export interface PortraitSource {
  path: string;
  name: string;
  /** Square crop for the face model (a pack's talk still faceBox). */
  crop?: { x: number; y: number; size: number };
}

export class CallWorkers {
  #faceUrl: string | null = null;
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
      throw new WorkerError(503, `Can't reach ${new URL(url).host}.`);
    }
    if (!r.ok) throw new WorkerError(r.status >= 500 ? 502 : r.status, (await r.text().catch(() => "")) || `HTTP ${r.status}`);
    return (await r.json()) as T;
  }

  /** The face worker that answers, or null. */
  async face(): Promise<string | null> {
    const ok = async (u: string) => { try { await this.#json(`${u}/stats`, {}, 1500); return true; } catch { return false; } };
    if (this.#faceUrl && (await ok(this.#faceUrl))) return this.#faceUrl;
    this.#faceUrl = null;
    for (const u of this.cfg.faceUrls) if (await ok(u)) return (this.#faceUrl = u);
    return null;
  }

  async status() {
    const [voice, faceUrl] = await Promise.all([
      this.#json(`${this.cfg.voiceUrl}/voices`, {}, 1500).then(() => true, () => false),
      this.face(),
    ]);
    let face: { url: string; engine: string; ready: boolean } | null = null;
    if (faceUrl) {
      try {
        const s = await this.#json<{ engine: string; ready: boolean }>(`${faceUrl}/stats`);
        face = { url: faceUrl, engine: s.engine, ready: s.ready };
      } catch { /* went away */ }
    }
    return { voice, face };
  }

  voices() {
    return this.#json<{ id: string; name: string; model?: string }[]>(`${this.cfg.voiceUrl}/voices`);
  }

  /** Put this portrait on the face worker and switch to it. */
  async showPortrait(src: PortraitSource): Promise<string> {
    const f = await this.face();
    if (!f) throw new WorkerError(503, "The face server isn't running. Try a voice call.");
    const headers: Record<string, string> = { "X-Name": src.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 24) || "character", ...this.#admin() };
    if (src.crop) headers["X-Crop"] = `${src.crop.x},${src.crop.y},${src.crop.size}`;
    const up = await this.#json<{ id: string }>(`${f}/faces`, { method: "POST", headers, body: await readFile(src.path) }, 20_000);
    await this.#json(`${f}/face`, { method: "POST", headers: { "Content-Type": "application/json", ...this.#admin() }, body: JSON.stringify({ id: up.id }) });
    return up.id;
  }

  /** Both workers drop the call. Old workers without the endpoint just 404. */
  async end(callId: string): Promise<void> {
    const opts = { method: "POST", headers: this.#admin(callId), signal: AbortSignal.timeout(2000) };
    await Promise.allSettled([
      this.fetchImpl(`${this.cfg.voiceUrl}/internal/calls/${callId}/end`, opts),
      this.#faceUrl ? this.fetchImpl(`${this.#faceUrl}/internal/calls/${callId}/end`, opts) : Promise.resolve(),
    ]);
  }

  async faceModels() {
    const f = await this.face();
    if (!f) return { current: null, switching: null, available: [] as { id: string; name: string; installed: boolean }[] };
    const d = await this.#json<{ current: string; switching: string | null; available: { id: string; name: string; installed: boolean }[] }>(`${f}/engine`);
    // "lite" is an old alias of "flashhead"; the test pattern shows only when it is the one running.
    d.available = d.available.filter((m) => m.id !== "lite" && (m.id !== "fake" || d.current === "fake"));
    return d;
  }

  async switchFaceModel(name: string) {
    const f = await this.face();
    if (!f) throw new WorkerError(503, "The face server isn't running.");
    const d = await this.#json(`${f}/engine`, { method: "POST", headers: { "Content-Type": "application/json", ...this.#admin() }, body: JSON.stringify({ name }) });
    this.#faceUrl = null;
    return d;
  }
}
