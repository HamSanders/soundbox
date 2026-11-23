/**
 * HTTP client for the Mirli Cloud gateway. Every response is parsed against
 * `contract.ts`, so a gateway that drifts fails loudly here rather than as a
 * confusing undefined three calls later.
 */

import { z } from "zod";

import {
  CONTRACT_VERSION,
  accountResponse,
  checkoutResponse,
  deviceCodeResponse,
  type ErrorCode,
  errorBody,
  type JobParams,
  jobResponse,
  modelsResponse,
  type PackId,
  quoteResponse,
  type Task,
  uploadResponse,
  warmResponse,
} from "./contract.js";

export type FetchFn = typeof fetch;

/** A gateway error, carrying its code so callers can branch on it. */
export class CloudError extends Error {
  constructor(
    readonly code: ErrorCode | "network",
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CloudError";
  }
}

const TIMEOUT_MS = 30_000;

export class CloudClient {
  constructor(
    readonly baseUrl: string,
    private readonly token: string | null,
    private readonly fetchImpl: FetchFn = fetch,
  ) {}

  private async call<T>(
    schema: z.ZodType<T>,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          accept: "application/json",
          "x-mirli-contract": String(CONTRACT_VERSION),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new CloudError("network", `Couldn't reach Mirli Cloud (${(e as Error).message}).`, 0);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: a proxy error page, say. Handled below.
    }
    if (!res.ok) {
      const err = errorBody.safeParse(json);
      if (err.success) {
        throw new CloudError(err.data.error.code, err.data.error.message, res.status, err.data.error.details ?? {});
      }
      throw new CloudError("backend_error", `Mirli Cloud answered ${res.status}.`, res.status);
    }
    return schema.parse(json);
  }

  models() {
    return this.call(modelsResponse, "GET", "/v1/models");
  }

  account() {
    return this.call(accountResponse, "GET", "/v1/account");
  }

  /** Start the GPU line `model` runs on (the user picked it, or is typing a prompt for it). */
  warm(model: string) {
    return this.call(warmResponse, "POST", "/v1/warm", { model });
  }

  quote(model: string, task: Task, params: JobParams) {
    return this.call(quoteResponse, "POST", "/v1/quote", { model, task, params });
  }

  createJob(
    model: string,
    task: Task,
    params: JobParams,
    maxCredits: number,
    idempotencyKey: string,
    consent?: "own_voice_or_permission",
  ) {
    return this.call(
      jobResponse,
      "POST",
      "/v1/jobs",
      { model, task, params, max_credits: maxCredits, ...(consent ? { consent } : {}) },
      { "idempotency-key": idempotencyKey },
    );
  }

  /** The words in an upload, once the gateway has transcribed it. */
  getUpload(id: string) {
    return this.call(uploadResponse, "GET", `/v1/uploads/${encodeURIComponent(id)}`);
  }

  /**
   * Send a WAV clip (a voice reference, or a recording to re-voice). With
   * purpose "voice" the gateway also transcribes it (a clip of 40 s or less).
   */
  async upload(wav: Buffer, purpose: "voice" | null = null) {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/uploads${purpose ? `?purpose=${purpose}` : ""}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "audio/wav",
          "x-mirli-contract": String(CONTRACT_VERSION),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: new Uint8Array(wav),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      throw new CloudError("network", `Couldn't reach Mirli Cloud (${(e as Error).message}).`, 0);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Handled below.
    }
    if (!res.ok) {
      const err = errorBody.safeParse(json);
      if (err.success) throw new CloudError(err.data.error.code, err.data.error.message, res.status, err.data.error.details ?? {});
      throw new CloudError("backend_error", `Mirli Cloud answered ${res.status} to the upload.`, res.status);
    }
    return uploadResponse.parse(json);
  }

  job(id: string) {
    return this.call(jobResponse, "GET", `/v1/jobs/${encodeURIComponent(id)}`);
  }

  cancel(id: string) {
    return this.call(jobResponse, "POST", `/v1/jobs/${encodeURIComponent(id)}/cancel`, {});
  }

  deviceCode(deviceName: string) {
    return this.call(deviceCodeResponse, "POST", "/v1/device/code", { device_name: deviceName });
  }

  deviceToken(deviceCode: string) {
    return this.call(z.object({ token: z.string() }), "POST", "/v1/device/token", { device_code: deviceCode });
  }

  async signOut(): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/device`, {
      method: "DELETE",
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok && res.status !== 401) throw new CloudError("backend_error", `Mirli Cloud answered ${res.status}.`, res.status);
  }

  checkout(pack: PackId) {
    return this.call(checkoutResponse, "POST", "/v1/checkout", { pack });
  }

  /** Download one output. The link is on a CDN, so no token goes with it. */
  async download(url: string): Promise<{ bytes: Buffer; contentType: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      throw new CloudError("network", `Couldn't download the result (${(e as Error).message}).`, 0);
    }
    if (!res.ok) throw new CloudError("backend_error", `Downloading the result failed (${res.status}).`, res.status);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "" };
  }
}
