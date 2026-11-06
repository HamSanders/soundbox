/**
 * One request to a custom audio endpoint, and turning whatever comes back
 * into samples.
 *
 * Sibling of `image/client.ts`: nothing here writes to the library or knows
 * about jobs. It takes a filled-in body and returns `{ audio, sampleRate }`.
 *
 * What comes back varies more than what goes out. All three of the APIs this
 * was written against answer with raw audio bytes, but not the same bytes:
 * LocalAI defaults to WAV, Inference Gateway's music route refuses WAV and
 * defaults to MP3, and Privateer's sound effects are MP3 only. So:
 *
 *   - WAV (by its RIFF header, not its Content-Type) is decoded in-process.
 *   - `audio/pcm` / `audio/L16` is read as 16-bit little-endian mono at the
 *     endpoint's declared rate — PCM has no header to say otherwise.
 *   - Anything else goes through ffmpeg, the same optional dependency MP3
 *     export already uses. Without ffmpeg the error says so and names the
 *     fix, rather than handing an MP3 to a WAV parser.
 *
 * A JSON response is supported too, for servers that wrap the audio: set
 * `responsePath` to where the base64 string lives (`data.0.b64_json`). Hosted
 * APIs such as fal and Replicate answer with a link instead (`audio.url`);
 * when the value at the path is an http(s) URL, or an object with a `url`,
 * the audio is downloaded from it. That second request carries no key: the
 * link is usually on a CDN, a different host from the one the key is for.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Audio, decodeWav } from "../audio/dsp.js";
import { CancelledJob, ModelError } from "../errors.js";
import { getLogger } from "../logging.js";

const log = getLogger("soundbox.endpoints");

/** Long: Privateer's docs warn that a 60s client default abandons a track
 *  already paid for, and a long ACE-Step render on a homelab GPU takes minutes. */
export const DEFAULT_TIMEOUT_MS = 600_000;
const CANCEL_POLL_MS = 500;
const FFMPEG_TIMEOUT_MS = 120_000;

export interface EndpointRequest {
  url: string;
  apiKey?: string | null;
  /** Where the key goes. Defaults to `Authorization: Bearer <key>`. */
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  headers?: Record<string, string>;
  body: unknown;
  /** Dotted path to base64 audio, or a link to it, in a JSON response; empty
   *  for a response whose body *is* the audio. */
  responsePath?: string;
  /** Rate to read a headerless PCM response at. */
  pcmSampleRate?: number;
  timeoutMs?: number;
  /** Polled while the request is in flight; true aborts it. */
  isCancelled?: () => boolean;
}

export type FetchFn = typeof fetch;

export interface EndpointAudio {
  audio: Audio;
  sampleRate: number;
}

export async function requestAudio(
  req: EndpointRequest,
  fetchImpl: FetchFn = fetch,
): Promise<EndpointAudio> {
  const { bytes, contentType } = await post(req, fetchImpl);
  if (req.responsePath) {
    const found = audioFromJson(bytes, req.responsePath);
    if (found.kind === "url") {
      const file = await fetchBytes(req, fetchImpl, found.url, { method: "GET" }, "the audio link");
      return await decodeAudio(file.bytes, file.contentType, req.pcmSampleRate ?? 24_000);
    }
    return await decodeAudio(found.bytes, contentType, req.pcmSampleRate ?? 24_000);
  }
  if (contentType.includes("json")) {
    // A 200 with JSON where audio was expected is usually a wrapped error or
    // a server that wraps its audio. Either way the body is the best clue.
    throw new ModelError(
      `The endpoint answered with JSON rather than audio: ` +
        `${bytes.toString("utf-8").slice(0, 300)}\n\n` +
        `If it wraps the audio in JSON, set the response path to where the audio, or a link to it, is.`,
    );
  }
  return await decodeAudio(bytes, contentType, req.pcmSampleRate ?? 24_000);
}

async function post(
  req: EndpointRequest,
  fetchImpl: FetchFn,
): Promise<{ bytes: Buffer; contentType: string }> {
  // The body's field names, not their values: the names are what a template
  // gets wrong (`model` vs `model_id`), and the values are the user's prompt
  // and lyrics. Never the key or the headers.
  const fields =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? Object.keys(req.body as Record<string, unknown>).join(", ")
      : typeof req.body;
  log.debug(`POST ${req.url} fields: ${fields}`);
  return await fetchBytes(
    req,
    fetchImpl,
    req.url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.apiKey
          ? { [req.apiKeyHeader || "Authorization"]: `${req.apiKeyPrefix ?? "Bearer "}${req.apiKey}` }
          : {}),
        ...(req.headers ?? {}),
      },
      body: JSON.stringify(req.body),
    },
    "the endpoint",
  );
}

/**
 * One request under the endpoint's timeout and cancel flag, with the error
 * text people need: the status and the server's own words.
 */
async function fetchBytes(
  req: EndpointRequest,
  fetchImpl: FetchFn,
  url: string,
  init: RequestInit,
  what: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const controller = new AbortController();
  let cancelled = false;
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const poll = req.isCancelled
    ? setInterval(() => {
        if (req.isCancelled!()) {
          cancelled = true;
          controller.abort();
        }
      }, CANCEL_POLL_MS)
    : null;
  const started = Date.now();
  const method = init.method ?? "GET";
  try {
    const resp = await fetchImpl(url, { ...init, signal: controller.signal });
    log.debug(
      `${method} ${url} -> HTTP ${resp.status} ${resp.headers.get("content-type") ?? "(no content-type)"} ` +
        `in ${Date.now() - started}ms`,
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new ModelError(
        `${capitalise(what)} at ${url} returned HTTP ${resp.status}` + `${text ? `: ${text.slice(0, 500)}` : ""}`,
      );
    }
    const bytes = Buffer.from(await resp.arrayBuffer());
    if (bytes.length === 0) throw new ModelError(`${capitalise(what)} returned an empty response.`);
    return { bytes, contentType: (resp.headers.get("content-type") ?? "").toLowerCase() };
  } catch (exc) {
    if (cancelled) throw new CancelledJob();
    if (exc instanceof ModelError) throw exc;
    const aborted = exc instanceof Error && exc.name === "AbortError";
    throw new ModelError(
      aborted
        ? `${capitalise(what)} at ${url} did not answer within ${Math.round((req.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s.`
        : `Could not reach ${what} at ${url}: ${exc instanceof Error ? exc.message : String(exc)}`,
    );
  } finally {
    clearTimeout(timer);
    if (poll) clearInterval(poll);
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type FoundAudio = { kind: "bytes"; bytes: Buffer } | { kind: "url"; url: string };

/**
 * Follow `a.b.0.c` into parsed JSON. A string there is base64 audio (with or
 * without a `data:` prefix) or an http(s) link to the file; an object with a
 * string `url` is a link too, so `audio` works as well as `audio.url` for fal.
 */
function audioFromJson(bytes: Buffer, path: string): FoundAudio {
  let node: unknown;
  try {
    node = JSON.parse(bytes.toString("utf-8"));
  } catch {
    throw new ModelError(
      `The response path is set to "${path}", but the endpoint did not answer with JSON.`,
    );
  }
  for (const part of path.split(".").filter(Boolean)) {
    if (node === null || typeof node !== "object") {
      node = undefined;
      break;
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (node && typeof node === "object" && typeof (node as { url?: unknown }).url === "string") {
    node = (node as { url: string }).url;
  }
  if (typeof node !== "string" || !node) {
    throw new ModelError(
      `The endpoint's JSON has no audio or audio link at "${path}". ` +
        `It answered: ${bytes.toString("utf-8").slice(0, 300)}`,
    );
  }
  if (/^https?:\/\//i.test(node)) return { kind: "url", url: node };
  const decoded = Buffer.from(node.replace(/^data:[^;,]+;base64,/, ""), "base64");
  if (decoded.length === 0) throw new ModelError(`The audio at "${path}" decoded to nothing.`);
  return { kind: "bytes", bytes: decoded };
}

/* ------------------------------------------------------------- decoding */

function isWav(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WAVE"
  );
}

export async function decodeAudio(
  bytes: Buffer,
  contentType: string,
  pcmSampleRate: number,
): Promise<EndpointAudio> {
  if (isWav(bytes)) return decodeWav(bytes);
  if (/audio\/(pcm|l16)/.test(contentType)) return decodePcm16(bytes, pcmSampleRate);
  const wav = await ffmpegToWav(bytes);
  return decodeWav(wav);
}

/** Signed 16-bit little-endian mono — what `response_format: "pcm"` means for
 *  OpenAI-shaped speech endpoints. */
export function decodePcm16(bytes: Buffer, sampleRate: number): EndpointAudio {
  const frames = Math.floor(bytes.length / 2);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = bytes.readInt16LE(i * 2) / 32768;
  return { audio: [out], sampleRate };
}

/**
 * Decode anything ffmpeg can read into a WAV buffer.
 *
 * Through temp files rather than pipes: MP4/AAC containers often need to seek
 * to find their index, which a pipe cannot do.
 */
async function ffmpegToWav(bytes: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "soundbox-endpoint-"));
  const src = join(dir, "in");
  const dst = join(dir, "out.wav");
  try {
    await writeFile(src, bytes);
    const result = await new Promise<"ok" | "missing" | string>((resolve) => {
      let stderr = "";
      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-c:a", "pcm_s16le", dst], {
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        });
      } catch {
        resolve("missing");
        return;
      }
      const timer = setTimeout(() => proc.kill("SIGKILL"), FFMPEG_TIMEOUT_MS);
      proc.stderr?.on("data", (c: Buffer) => (stderr += c.toString("utf-8")));
      proc.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        resolve(err.code === "ENOENT" ? "missing" : err.message);
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? "ok" : stderr.trim() || `ffmpeg exited with code ${code}`);
      });
    });
    if (result === "missing") {
      throw new ModelError(
        `The endpoint sent audio that is not WAV, and decoding it needs ffmpeg, which ` +
          `is not on this machine's PATH. Install ffmpeg, or ask the endpoint for WAV ` +
          `(or "pcm") in its body template if it offers that.`,
      );
    }
    if (result !== "ok") {
      throw new ModelError(`Could not decode the endpoint's audio: ${result.slice(0, 500)}`);
    }
    return await readFile(dst);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
