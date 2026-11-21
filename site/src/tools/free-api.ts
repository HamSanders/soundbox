/**
 * Client for Mirli Cloud's free-tools API (the vocal remover).
 *
 * The service decides what's allowed; this file only knows the shape of the
 * conversation: ask for an upload slot, PUT the file straight to storage,
 * start the job, poll until the stems are ready.
 *
 * VITE_FREE_API points at the service (default https://cloud.mirli.app).
 * VITE_TURNSTILE_SITE_KEY is Cloudflare Turnstile's public site key; without
 * one (local development) the page sends a placeholder token.
 */

export const FREE_API = ((import.meta.env.VITE_FREE_API as string | undefined) ?? "https://cloud.mirli.app").replace(/\/+$/, "");
export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? "";

/** What the page checks before uploading, so an obviously wrong file never leaves the computer. */
export const UPLOAD_HINTS = { maxBytes: 25_000_000, maxSeconds: 360 };

export class FreeError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${FREE_API}/v1/free${path}`, {
      ...init,
      headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
    });
  } catch {
    throw new FreeError("Couldn't reach the server. Check your connection and try again.", "network", 0);
  }
  const body = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!r.ok) {
    throw new FreeError(body.error?.message ?? "Something went wrong. Try again.", body.error?.code ?? "unknown", r.status);
  }
  return body as T;
}

export async function freeStatus(): Promise<{ open: boolean; reason?: string }> {
  const s = await call<{ tools: Record<string, { open: boolean; reason?: string }> }>("/status");
  return s.tools["vocal-remover"] ?? { open: false };
}

export interface Stems {
  status: "done";
  stems: Record<string, { url: string }>;
  expires_at: string;
}

/**
 * Upload `file` and wait for the stems. `onStage` reports progress for the UI:
 * "uploading" with a 0–1 fraction, then "queued", "running".
 */
export async function separate(
  file: File,
  seconds: number,
  turnstile: string,
  onStage: (stage: "uploading" | "queued" | "running", fraction?: number) => void,
  signal?: AbortSignal,
): Promise<Stems> {
  const mime = file.type || guessMime(file.name);
  const slot = await call<{ job_id: string; upload: { url: string; method: string; headers: Record<string, string> } }>(
    "/vocal-remover/uploads",
    { method: "POST", body: JSON.stringify({ turnstile, bytes: file.size, seconds, mime, rights: true, src: "site" }) },
  );

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(slot.upload.method, slot.upload.url);
    for (const [k, v] of Object.entries(slot.upload.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onStage("uploading", e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new FreeError("The upload failed. Try again.", "upload_failed", xhr.status)));
    xhr.onerror = () => reject(new FreeError("The upload failed. Check your connection and try again.", "upload_failed", 0));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });

  await call(`/vocal-remover/jobs/${slot.job_id}/start`, { method: "POST" });
  onStage("queued");
  for (;;) {
    if (signal?.aborted) throw new FreeError("Cancelled.", "cancelled", 0);
    await new Promise((r) => setTimeout(r, 1500));
    const s = await call<{ status: string; stems?: Stems["stems"]; expires_at?: string; error?: { message: string } }>(
      `/vocal-remover/jobs/${slot.job_id}`,
    );
    if (s.status === "done" && s.stems) return { status: "done", stems: s.stems, expires_at: s.expires_at! };
    if (s.status === "failed") throw new FreeError(s.error?.message ?? "The split failed. Try again.", "failed", 200);
    onStage(s.status === "running" ? "running" : "queued");
  }
}

export function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (
    { mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", webm: "audio/webm" }[ext] ??
    "application/octet-stream"
  );
}

/** Decode a file in the browser: its length, and its samples for analysis. */
export async function decodeFile(file: File): Promise<AudioBuffer> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } finally {
    void ctx.close();
  }
}

let turnstileLoading: Promise<void> | null = null;
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, o: { sitekey: string; callback: (t: string) => void; "expired-callback"?: () => void; appearance?: string }) => string;
      reset: (id?: string) => void;
    };
  }
}

/** Load Cloudflare Turnstile once and render it into `el`; resolves with each fresh token through `onToken`. */
export async function mountTurnstile(el: HTMLElement, onToken: (t: string | null) => void): Promise<() => void> {
  if (!TURNSTILE_SITE_KEY) {
    onToken("dev");
    return () => {};
  }
  turnstileLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile"));
    document.head.appendChild(s);
  });
  await turnstileLoading;
  const id = window.turnstile!.render(el, {
    sitekey: TURNSTILE_SITE_KEY,
    appearance: "interaction-only",
    callback: (t) => onToken(t),
    "expired-callback": () => onToken(null),
  });
  return () => window.turnstile?.reset(id);
}
