/**
 * A minimal image-generation client, in the two shapes worth supporting.
 *
 * Sibling of `llm/client.ts` and the same idea: the managed engine and
 * somebody's existing install differ only in how the base URL is obtained, so
 * there is one request path and two ways of picking a `baseUrl`. Unlike chat,
 * though, there is no single de-facto API — so the *shape* is a setting:
 *
 *   "a1111"  — POST /sdapi/v1/txt2img (Automatic1111, Forge, SD.Next, and
 *              stable-diffusion.cpp's own sd-server, which serves this path
 *              alongside the OpenAI one). Carries steps, cfg and size, which
 *              is why the managed engine uses it: a turbo checkpoint rendered
 *              at somebody else's default 20 steps / cfg 7.5 comes out as
 *              mush, and the OpenAI shape has nowhere to say otherwise.
 *   "openai"  — POST /v1/images/generations (OpenAI, LocalAI, most proxies).
 *              Size is the only knob it carries; the rest is the endpoint's
 *              business.
 *
 * Both return raw PNG bytes to the caller. Nothing here writes to disk.
 */

import { apiUrl, NOT_FOUND_HINT } from "../apiUrl.js";
import { ModelError } from "../errors.js";
import type { ImageApiKind } from "../config.js";
import { getLogger } from "../logging.js";

const log = getLogger("konchi.image");

/** Generous: a cold managed engine loads the checkpoint on the first request,
 *  and a CPU-only machine rendering four steps is slow but not broken. */
const REQUEST_TIMEOUT_MS = 300_000;

export interface ImageRequest {
  baseUrl: string;
  kind: ImageApiKind;
  apiKey?: string | null;
  /** Model name to ask for. Empty is legitimate for an endpoint serving one
   *  checkpoint — it is omitted from the body rather than sent blank. */
  model?: string | null;
  prompt: string;
  negativePrompt?: string | null;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed?: number | null;
}

export type FetchFn = typeof fetch;

export async function generateImage(
  req: ImageRequest,
  fetchImpl: FetchFn = fetch,
): Promise<Buffer> {
  const url = apiUrl(req.baseUrl, req.kind === "a1111" ? "/sdapi/v1/txt2img" : "/v1/images/generations");
  const body =
    req.kind === "a1111"
      ? {
          prompt: req.prompt,
          negative_prompt: req.negativePrompt ?? "",
          steps: req.steps,
          cfg_scale: req.cfg,
          width: req.width,
          height: req.height,
          batch_size: 1,
          n_iter: 1,
          // -1 is A1111's "pick one for me". Sending null would be rejected.
          seed: req.seed ?? -1,
          ...(req.model ? { override_settings: { sd_model_checkpoint: req.model } } : {}),
        }
      : {
          ...(req.model ? { model: req.model } : {}),
          prompt: req.prompt,
          n: 1,
          size: `${req.width}x${req.height}`,
          // Asking for base64 keeps this one request: the URL form would mean
          // a second fetch against a host we were never configured to trust.
          response_format: "b64_json",
        };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  const started = Date.now();
  // URL, API kind, model and size only. Never the key or the prompt.
  log.debug(
    `POST ${url} kind=${req.kind} model=${req.model || "(default)"} size=${req.width}x${req.height}`,
  );
  try {
    resp = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (exc) {
    const aborted = exc instanceof Error && exc.name === "AbortError";
    log.debug(`POST ${url} failed after ${Date.now() - started}ms: ${aborted ? "timeout" : String(exc)}`);
    throw new ModelError(
      aborted
        ? `The image endpoint at ${url} did not respond in time.`
        : `Could not reach the image endpoint at ${url}: ${String(exc)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  log.debug(`POST ${url} -> HTTP ${resp.status} in ${Date.now() - started}ms`);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new ModelError(
      `Image endpoint ${url} returned HTTP ${resp.status}` +
        `${text ? `: ${text.slice(0, 500)}` : ""}` +
        (resp.status === 404 ? `\n\n${NOT_FOUND_HINT}` : ""),
    );
  }

  const data = (await resp.json()) as {
    images?: unknown[];
    data?: { b64_json?: unknown; url?: unknown }[];
  };
  const encoded =
    req.kind === "a1111"
      ? typeof data.images?.[0] === "string"
        ? (data.images[0] as string)
        : null
      : typeof data.data?.[0]?.b64_json === "string"
        ? (data.data[0]!.b64_json as string)
        : null;

  if (encoded === null) {
    // An endpoint that answered 200 with a URL instead of base64 is the most
    // likely way to land here, and saying so beats "unexpected shape".
    const gotUrl = req.kind === "openai" && typeof data.data?.[0]?.url === "string";
    throw new ModelError(
      gotUrl
        ? `The image endpoint returned a URL rather than image data. Konchi only ` +
          `accepts inline base64 (\`response_format: "b64_json"\`), so it never fetches ` +
          `from a host it wasn't pointed at.`
        : `The image endpoint returned an unexpected response shape. Check that ` +
          `${req.baseUrl} really speaks the "${req.kind}" API.`,
    );
  }

  // Data URLs are legal here and some servers send them; strip the prefix.
  const base64 = encoded.replace(/^data:image\/\w+;base64,/, "");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) {
    throw new ModelError("The image endpoint returned an empty image.");
  }
  return bytes;
}
