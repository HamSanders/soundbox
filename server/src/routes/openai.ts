/**
 * OpenAI-compatible audio routes, so a program with an "OpenAI base URL"
 * setting can use this server for speech:
 *
 *   POST /v1/audio/speech          text to speech
 *   POST /v1/audio/transcriptions  speech to text
 *   GET  /v1/models                the speech and transcription models ready here
 *   GET  /v1/audio/voices          saved voices and the models' own voices
 *
 * These are a second door onto what `/api/speak`, `/api/speak/stream` and
 * `/api/transcribe` already do. Nothing is synthesised differently: a request
 * is mapped to a Mirli model and voice, run through the same queue or the
 * same streaming path, and the audio is sent back in the shape an OpenAI
 * client expects.
 *
 * The request and response shapes follow OpenAI's public API reference. What
 * the reference does not define is marked as ours where it appears: the
 * `/v1/audio/voices` listing, the `keep` field, and the `X-Soundbox-*`
 * response headers.
 *
 * Errors use OpenAI's envelope, `{ error: { message, type, param, code } }`,
 * on every answer from these routes, including the ones the server-wide
 * checks send (a refused Host, a missing access token).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";

import * as dsp from "../audio/dsp.js";
import { decodeAudio } from "../endpoints/client.js";
import { CancelledJob, GpuBusy, ModelError, QueueFull, StreamUnsupported } from "../errors.js";
import { buildFailure, classify } from "../failure.js";
import { getLogger } from "../logging.js";
import {
  speakRequestSchema,
  speakStreamRequestSchema,
  type Failure,
  type Job,
  type ModelInfo,
} from "../schemas.js";
import { BUILTIN_VOICE_PREFIX, toPcm16, type MirliService, type SpeakStreamEvent } from "../service.js";
import { HttpError, isAllowedOrigin } from "./helpers.js";
import { waitFor } from "./render.js";
import { baseHeaders } from "./speakStream.js";

const log = getLogger("mirli.openai");

/** What OpenAI documents `response_format: "pcm"` as: 24 kHz, 16-bit signed
 *  little-endian, no header. Clients hard-code that rate, so PCM is always
 *  resampled to it (and mixed to one channel) whatever the model produces. */
export const PCM_RATE = 24_000;

/** The formats OpenAI's reference lists for speech. */
const KNOWN_FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm"] as const;
/** The ones this server can answer with. `mp3` also needs ffmpeg. */
const SPEECH_FORMATS = ["wav", "pcm", "mp3"] as const;
type SpeechFormat = (typeof SPEECH_FORMATS)[number];

const TRANSCRIPT_FORMATS = ["json", "text", "verbose_json"] as const;
type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];

/** A voice name that always means "the model's own default voice". Ours:
 *  OpenAI clients must send some voice, and a model may have none to name. */
export const DEFAULT_VOICE = "default";

/** Longest text the streaming path takes (`speakStreamRequestSchema`). */
const STREAM_MAX_CHARS = 5000;

const READY = new Set(["loaded", "installed"]);

/* ------------------------------------------------------------------ errors */

export interface OpenAiError {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
    /** Ours: the raw text of a failed job, when `message` is the worded
     *  explanation instead (what the app shows under Details). */
    detail?: string;
  };
}

/** An error to answer in OpenAI's envelope. `code` is a short stable name. */
export class OpenAiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
    readonly param: string | null = null,
  ) {
    super(message);
    this.name = "OpenAiHttpError";
  }
}

/** The `type` for a status. OpenAI's SDKs pick their error class from the
 *  HTTP status, so this is for a person reading the body. */
function typeFor(status: number): string {
  if (status === 429) return "rate_limit_error";
  if (status >= 500) return "server_error";
  return "invalid_request_error";
}

export function openAiError(
  status: number,
  message: string,
  code: string | null = null,
  param: string | null = null,
): OpenAiError {
  // OpenAI's spec types `code` as a free string and lists no values, so these
  // two are the names its API is known to answer with, not ones it documents.
  const fallback = status === 401 ? "invalid_api_key" : status === 429 ? "rate_limit_exceeded" : null;
  return { error: { message, type: typeFor(status), param, code: code ?? fallback } };
}

/** What to say about a failure: the taxonomy's title and hint when it has
 *  them (failure.ts), otherwise the raw text. */
export function failureMessage(failure: Failure): string {
  if (!failure.hint) return failure.detail || failure.title;
  return `${failure.title}. ${failure.hint}`;
}

/** The envelope for anything thrown inside these routes. */
export function errorResponse(exc: unknown): { status: number; body: OpenAiError } {
  if (exc instanceof OpenAiHttpError) {
    return { status: exc.status, body: openAiError(exc.status, exc.message, exc.code, exc.param) };
  }
  if (exc instanceof ZodError) {
    const issue = exc.issues[0];
    const param = issue?.path.length ? issue.path.map(String).join(".") : null;
    const message = issue ? (param ? `${param}: ${issue.message}` : issue.message) : "Invalid request";
    return { status: 400, body: openAiError(400, message, "invalid_request", param) };
  }
  if (exc instanceof QueueFull) {
    return { status: 429, body: openAiError(429, exc.message, "queue_full") };
  }
  if (exc instanceof GpuBusy) {
    return { status: 429, body: openAiError(429, exc.message, "gpu_busy") };
  }
  if (exc instanceof ModelError) {
    const failure = buildFailure(exc);
    return { status: 400, body: openAiError(400, failureMessage(failure), failure.topic ?? "model_error") };
  }
  if (exc instanceof HttpError) {
    return { status: exc.status, body: openAiError(exc.status, exc.message) };
  }
  const err = exc as { statusCode?: number; message?: string; stack?: string };
  const status = typeof err?.statusCode === "number" ? err.statusCode : 500;
  if (status >= 500) {
    log.error(`unhandled error on an OpenAI route: ${err?.stack ?? err?.message ?? String(exc)}`);
    return { status, body: openAiError(status, "Internal Server Error") };
  }
  return { status, body: openAiError(status, err.message ?? "Request failed") };
}

/** A job that ended in `error`, as an envelope. */
function jobFailure(job: Job, fallback: string): OpenAiError {
  const failure = job.failure ?? (job.error ? buildFailure(job.error) : null);
  const body = openAiError(500, failure ? failureMessage(failure) : fallback, failure?.topic ?? "generation_failed");
  if (failure?.detail && failure.detail !== body.error.message) body.error.detail = failure.detail;
  return body;
}

/** The server's usual `{ detail }` body as text, for the envelope. */
function detailText(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : String(d)))
      .join("; ");
  }
  return "Request failed";
}

/* ------------------------------------------------------- the request guard */

/** Whether a URL is one of these routes, by the path the router will match
 *  (it percent-decodes first, so `/%761/models` is `/v1/models`). */
export function isOpenAiPath(url: string): boolean {
  const raw = url.split("?")[0]!.split("#")[0]!;
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return false;
  }
  return path === "/v1" || path.startsWith("/v1/");
}

const SIMPLE_CONTENT_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"]);

/**
 * Whether a mutating request to these routes is a web page on another site
 * driving the server through the browser, which is refused.
 *
 * `/api/` answers this by demanding an `X-Soundbox` header or a non-"simple"
 * content type, either of which a browser may only send across sites after a
 * preflight this server's CORS policy refuses. An OpenAI client can do
 * neither for a transcription: the SDKs send no custom header, and the upload
 * is `multipart/form-data`, which a plain cross-site `<form>` can post too.
 *
 * So the two are told apart by what only a browser adds. A browser puts an
 * `Origin` header on every cross-site POST, and `Sec-Fetch-Site` on every
 * request; a script, an SDK or curl sends neither. A "simple" request is
 * therefore let through unless it names an origin this server does not trust
 * (origins.ts) or says it is cross-site. JSON bodies and requests with
 * `X-Soundbox` pass as they do under `/api/`. The access token is a separate
 * check (auth.ts) and applies to these routes as well.
 */
export function crossSiteRefusal(request: FastifyRequest): string | null {
  if (request.headers["x-soundbox"] !== undefined) return null;
  const ct = (request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (ct && !SIMPLE_CONTENT_TYPES.has(ct)) return null;
  const origin = request.headers.origin;
  const foreignOrigin = typeof origin === "string" && !isAllowedOrigin(origin, request.headers.host);
  if (foreignOrigin || request.headers["sec-fetch-site"] === "cross-site") {
    return "This request came from a web page on another site, which this server does not accept.";
  }
  return null;
}

/* ------------------------------------------------------------- multipart */

export interface MultipartFile {
  filename: string | null;
  contentType: string;
  data: Buffer;
}

export interface MultipartForm {
  fields: Map<string, string>;
  files: Map<string, MultipartFile>;
}

/**
 * The `; name=value` parameters of a header value such as
 * `form-data; name="file"; filename="a.wav"`, keyed by lower-cased name.
 *
 * One pass over the characters, with no regular expression: the text comes
 * straight from the request, and a pattern with two adjacent wildcards over
 * it can be made to take quadratic time by a long run of spaces.
 */
export function headerParams(value: string): Map<string, string> {
  const params = new Map<string, string>();
  let i = value.indexOf(";");
  while (i !== -1 && i < value.length) {
    i++; // past the ';'
    const eq = value.indexOf("=", i);
    const semi = value.indexOf(";", i);
    // A parameter with no '=' (or none before the next ';') has no value.
    if (eq === -1 || (semi !== -1 && semi < eq)) {
      i = semi;
      continue;
    }
    const name = value.slice(i, eq).trim().toLowerCase();
    let at = eq + 1;
    let text: string;
    if (value[at] === '"') {
      const close = value.indexOf('"', at + 1);
      text = value.slice(at + 1, close === -1 ? value.length : close);
      at = close === -1 ? value.length : close + 1;
      i = value.indexOf(";", at);
    } else {
      const end = value.indexOf(";", at);
      text = value.slice(at, end === -1 ? value.length : end).trim();
      i = end;
    }
    if (name && !params.has(name)) params.set(name, text);
  }
  return params;
}

/** A part's header block as a map of lower-cased name to trimmed value. */
function partHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of block.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

/**
 * Parse a buffered `multipart/form-data` body.
 *
 * By hand rather than a dependency: the body is already in memory (Fastify's
 * `bodyLimit` caps it), there is one small form to read, and all it takes is
 * splitting on the boundary. A repeated field keeps its last value.
 */
export function parseMultipart(body: Buffer, contentType: string): MultipartForm {
  const boundary = headerParams(contentType).get("boundary");
  if (!boundary) throw new OpenAiHttpError(400, "The multipart body has no boundary in its Content-Type.");
  const delimiter = Buffer.from(`--${boundary}`);
  const form: MultipartForm = { fields: new Map(), files: new Map() };

  let at = body.indexOf(delimiter);
  while (at !== -1) {
    let start = at + delimiter.length;
    // "--" straight after a delimiter closes the body.
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break;
    if (body[start] === 0x0d) start++;
    if (body[start] === 0x0a) start++;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const headerEnd = body.indexOf("\r\n\r\n", start);
    if (headerEnd !== -1 && headerEnd < next) {
      const headers = partHeaders(body.toString("utf8", start, headerEnd));
      // The CRLF before the next delimiter belongs to the delimiter.
      let end = next;
      if (body[end - 1] === 0x0a) end--;
      if (body[end - 1] === 0x0d) end--;
      const data = body.subarray(headerEnd + 4, Math.max(end, headerEnd + 4));
      const disposition = headerParams(headers.get("content-disposition") ?? "");
      const name = disposition.get("name");
      const filename = disposition.get("filename");
      if (name !== undefined) {
        if (filename !== undefined) {
          const type = headers.get("content-type") || "application/octet-stream";
          form.files.set(name, { filename: filename || null, contentType: type, data });
        } else {
          form.fields.set(name, data.toString("utf8"));
        }
      }
    }
    at = next;
  }
  return form;
}

/* --------------------------------------------------------------- PCM tools */

function mono(audio: dsp.Audio): Float32Array {
  if (audio.length === 0) return new Float32Array(0);
  if (audio.length === 1) return audio[0]!;
  const n = dsp.frameCount(audio);
  const out = new Float32Array(n);
  for (const ch of audio) for (let i = 0; i < n; i++) out[i]! += ch[i]! / audio.length;
  return out;
}

/** Interleaved 16-bit little-endian PCM to one float channel. */
function monoFromPcm16(pcm: Buffer, channels: number): Float32Array {
  const frames = Math.floor(pcm.length / (2 * channels));
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += pcm.readInt16LE((f * channels + c) * 2);
    out[f] = sum / channels / 32768;
  }
  return out;
}

/** A whole clip as OpenAI's PCM: 24 kHz, mono, 16-bit. */
export function toOpenAiPcm(audio: dsp.Audio, sampleRate: number): Buffer {
  return toPcm16(dsp.resampleAudio([mono(audio)], sampleRate, PCM_RATE));
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Resample a stream of mono chunks to another rate, with the same result as
 * resampling the whole thing at once.
 *
 * Resampling each chunk on its own would treat every chunk edge as silence
 * and click there. This keeps a margin of input either side of what it emits:
 * an output sample is released only once the input it leans on has arrived,
 * and enough of the past is kept for the next ones. The kept window always
 * starts on an input frame that lands exactly on an output frame, so the
 * window's output lines up with the stream's.
 */
export class StreamResampler {
  /** Input frames of context either side; wider than the resampler's kernel
   *  (16 zero crossings, stretched when downsampling). */
  private readonly margin: number;
  /** Input frames per step that land on a whole output frame. */
  private readonly step: number;
  private readonly ratio: number;
  private buf = new Float32Array(0);
  /** Absolute input index of `buf[0]`; always a multiple of `step`. */
  private base = 0;
  /** Absolute index of the next output frame to emit. */
  private outNext = 0;
  private total = 0;

  constructor(
    private readonly fromRate: number,
    private readonly toRate: number,
  ) {
    this.ratio = toRate / fromRate;
    this.step = fromRate / gcd(fromRate, toRate);
    this.margin = Math.ceil(16 / Math.min(1, this.ratio)) + 8;
  }

  /** Feed input; returns the output that is now final (possibly empty). */
  push(chunk: Float32Array): Float32Array {
    if (this.fromRate === this.toRate) return chunk;
    const joined = new Float32Array(this.buf.length + chunk.length);
    joined.set(this.buf);
    joined.set(chunk, this.buf.length);
    this.buf = joined;
    this.total += chunk.length;
    return this.emit(Math.floor((this.total - this.margin) * this.ratio));
  }

  /** The tail, once the input has ended. */
  flush(): Float32Array {
    if (this.fromRate === this.toRate) return new Float32Array(0);
    return this.emit(Math.ceil(this.total * this.ratio));
  }

  private emit(until: number): Float32Array {
    if (until <= this.outNext) return new Float32Array(0);
    const resampled = dsp.resampleAudio([this.buf], this.fromRate, this.toRate)[0]!;
    const offset = Math.round(this.base * this.ratio);
    const out = resampled.slice(this.outNext - offset, until - offset);
    this.outNext = until;
    // Drop the input nothing later will lean on.
    const keepFrom = Math.floor((this.outNext / this.ratio - this.margin) / this.step) * this.step;
    if (keepFrom > this.base) {
      this.buf = this.buf.slice(keepFrom - this.base);
      this.base = keepFrom;
    }
    return out;
  }
}

/** A WAV header for a stream whose length isn't known yet: the sizes are
 *  left at their maximum, which players read as "until the data ends". */
export function streamingWavHeader(sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(0xffffffff, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(0xffffffff, 40);
  return header;
}

/* -------------------------------------------------------- model and voice */

export interface SpeechChoice {
  model: ModelInfo;
  /** What `/api/speak` takes as `voice_id`: a saved voice's id, a
   *  `builtin:<name>`, or null for the model's default voice. */
  voiceId: string | null;
  /** The voice's name, for the response header. */
  voiceName: string;
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** A model named by id or by display name, case-insensitively. */
function findModel(models: ModelInfo[], name: string): ModelInfo | null {
  return (
    models.find((m) => m.id === name) ??
    models.find((m) => sameName(m.id, name)) ??
    models.find((m) => sameName(m.name, name)) ??
    null
  );
}

/**
 * Which Mirli model and voice an OpenAI speech request means.
 *
 * The voice is a saved voice by id or by name (case does not matter), then
 * one of a model's own built-in voice names, or `default` for the model's
 * default voice.
 *
 * The model is, in order: the `model` field when it names a speech model on
 * this server; the model the voice was made on, when that is ready; a ready
 * speech model, preferring the one in memory and never a metered one. A
 * `model` this server has never heard of (`tts-1`, which clients send
 * unasked) falls through to the rest, so a client with a hard-coded model
 * name still works.
 */
export async function resolveSpeech(
  svc: MirliService,
  modelName: string | null,
  voiceName: string | null,
): Promise<SpeechChoice> {
  const models = await svc.listModels();
  const tts = models.filter((m) => m.task === "tts");
  const ready = tts.filter((m) => READY.has(m.status));

  let requested: ModelInfo | null = null;
  if (modelName) {
    requested = findModel(tts, modelName);
    if (requested === null) {
      const other = findModel(models, modelName);
      if (other) {
        throw new OpenAiHttpError(400, `${other.name} is not a text-to-speech model.`, "model_not_found", "model");
      }
    } else if (!READY.has(requested.status)) {
      const names = ready.map((m) => m.id).join(", ") || "none";
      throw new OpenAiHttpError(
        404,
        `${requested.name} is not downloaded on this server. Download it from the Models page, ` +
          `or use a speech model that is ready: ${names}.`,
        "model_not_installed",
        "model",
      );
    }
  }

  const fallback = (): ModelInfo => {
    // A metered model can charge per read, so it is used only when named.
    const free = ready.filter((m) => !m.metered);
    const chosen = free.find((m) => m.status === "loaded") ?? free[0];
    if (!chosen) {
      throw new OpenAiHttpError(
        404,
        "No text-to-speech model is installed. Open the Mirli app and download one from the Models page.",
        "model_not_installed",
        "model",
      );
    }
    return chosen;
  };

  if (!voiceName || sameName(voiceName, DEFAULT_VOICE)) {
    const model = requested ?? fallback();
    return { model, voiceId: null, voiceName: DEFAULT_VOICE };
  }

  const voices = svc.listVoices();
  const saved = voices.find((v) => v.id === voiceName) ?? voices.find((v) => sameName(v.name, voiceName));
  if (saved) {
    const own = saved.model_id ? ready.find((m) => m.id === saved.model_id) : undefined;
    return { model: requested ?? own ?? fallback(), voiceId: saved.id, voiceName: saved.name };
  }

  // A model's own voice, named directly. With no model asked for, the first
  // ready one that has a voice of that name; the one in memory is tried first.
  const candidates = requested
    ? [requested]
    : ready.filter((m) => !m.metered).sort((a, b) => Number(b.status === "loaded") - Number(a.status === "loaded"));
  for (const model of candidates) {
    const builtin = model.voice_ids.find((id) => sameName(id, voiceName));
    if (builtin) return { model, voiceId: `${BUILTIN_VOICE_PREFIX}${builtin}`, voiceName: builtin };
  }

  const known = [
    ...voices.map((v) => v.name),
    ...new Set(candidates.flatMap((m) => m.voice_ids)),
  ];
  const listed = known.length > 12 ? `${known.slice(0, 12).join(", ")} and ${known.length - 12} more` : known.join(", ");
  throw new OpenAiHttpError(
    400,
    `No voice is called '${voiceName}'. ` +
      (known.length ? `Voices on this server: ${listed}. ` : "This server has no saved voices. ") +
      `Use '${DEFAULT_VOICE}' for the model's own default voice. GET /v1/audio/voices lists them all.`,
    "voice_not_found",
    "voice",
  );
}

/**
 * `speed` and `instructions` as the model's own request options, where the
 * model has a knob for them. A model with no `speed` parameter reads at its
 * own pace: there is nothing to pass it.
 */
export function deliveryOptions(
  model: ModelInfo,
  speed: number,
  instructions: string | null,
): Record<string, string> {
  const options: Record<string, string> = {};
  const param = model.params.find((p) => p.name === "speed") as
    | { minimum?: number | null; maximum?: number | null }
    | undefined;
  if (param && speed !== 1) {
    const clamped = Math.min(param.maximum ?? speed, Math.max(param.minimum ?? speed, speed));
    options["speed"] = String(clamped);
  }
  if (instructions && model.params.some((p) => p.name === "instruct")) {
    options["instruct"] = instructions.slice(0, 2000);
  }
  return options;
}

/* ----------------------------------------------------------------- schemas */

const speechSchema = z.object({
  model: z.string().max(200).nullish(),
  input: z.string().min(1).max(20000),
  /** A name or id, or OpenAI's `{ id }` form for a custom voice. */
  voice: z.union([z.string().max(200), z.object({ id: z.string().max(200) })]).nullish(),
  instructions: z.string().max(4096).nullish(),
  response_format: z.string().max(40).nullish(),
  speed: z.number().min(0.25).max(4).default(1),
  stream_format: z.enum(["audio", "sse"]).default("audio"),
  /** Ours: true keeps the read in this server's library. Off by default,
   *  because a chat client reads hundreds of lines nobody means to keep. */
  keep: z.boolean().default(false),
});

function speechFormat(raw: string | null | undefined, sse: boolean): SpeechFormat | null {
  // With no format given OpenAI means mp3. Events carry PCM here, so an
  // event stream with no format named is PCM.
  if (!raw) return sse ? "pcm" : null;
  const format = raw.toLowerCase();
  if ((SPEECH_FORMATS as readonly string[]).includes(format)) return format as SpeechFormat;
  const known = (KNOWN_FORMATS as readonly string[]).includes(format);
  throw new OpenAiHttpError(
    400,
    `response_format '${raw}' is not ${known ? "supported by this server" : "an audio format"}. ` +
      "Formats that work: wav, pcm, and mp3 when ffmpeg is installed.",
    "unsupported_format",
    "response_format",
  );
}

const CONTENT_TYPES: Record<SpeechFormat, string> = {
  wav: "audio/wav",
  pcm: "audio/pcm",
  mp3: "audio/mpeg",
};

/* ------------------------------------------------------------------ routes */

export function registerOpenAi(app: FastifyInstance, svc: MirliService): void {
  // Its own plugin scope, so the multipart parser, the error handler and the
  // envelope hook below apply to these routes and nothing else.
  void app.register(async (scope) => {
    scope.addContentTypeParser("multipart/form-data", { parseAs: "buffer" }, (_req, body, done) => {
      done(null, body);
    });

    scope.setErrorHandler((error, _request, reply) => {
      const { status, body } = errorResponse(error);
      if (error instanceof GpuBusy && error.retryAfterS !== null) {
        reply.header("Retry-After", String(error.retryAfterS));
      }
      return reply.code(status).send(body);
    });

    // The server-wide checks (Host, access token, capabilities) answer with
    // `{ detail }` before a handler runs. On these routes that becomes the
    // envelope too, so a client never has to parse two error shapes.
    scope.addHook("preSerialization", async (_request, reply, payload) => {
      if (reply.statusCode < 400 || payload === null || typeof payload !== "object") return payload;
      const body = payload as Record<string, unknown>;
      if ("error" in body || !("detail" in body)) return payload;
      return openAiError(reply.statusCode, detailText(body["detail"]));
    });

    registerSpeech(scope, svc);
    registerTranscriptions(scope, svc);

    scope.get("/v1/models", async () => {
      const models = (await svc.listModels()).filter(
        (m) => (m.task === "tts" || m.task === "asr") && READY.has(m.status),
      );
      return {
        object: "list",
        data: models.map((m) => ({
          id: m.id,
          object: "model",
          // Mirli keeps no creation date for a model; the field must be a number.
          created: 0,
          owned_by: m.vendor || "mirli",
          // Ours, beyond OpenAI's four fields.
          name: m.name,
          task: m.task === "tts" ? "speech" : "transcription",
        })),
      };
    });

    /**
     * Ours: OpenAI's `/audio/voices` creates and deletes custom voices but
     * has no GET that lists them, and clients that offer a voice picker ask
     * for one here. Entries use OpenAI's `object: "audio.voice"`. Both shapes in use are
     * answered at once: an OpenAI-style list under `data`, and the same
     * entries under `voices`.
     */
    scope.get("/v1/audio/voices", async () => {
      const ready = (await svc.listModels()).filter((m) => m.task === "tts" && READY.has(m.status));
      const voices: Record<string, unknown>[] = [];
      for (const v of svc.listVoices()) {
        voices.push({ id: v.id, object: "audio.voice", name: v.name, kind: v.kind, model: v.model_id ?? null });
      }
      const savedNames = new Set(svc.listVoices().map((v) => v.name.toLowerCase()));
      for (const m of ready) {
        for (const id of m.voice_ids) {
          // A saved voice of the same name wins when it is asked for, so the
          // built-in one under it would be a second entry nobody can reach.
          if (savedNames.has(id.toLowerCase())) continue;
          voices.push({ id, object: "audio.voice", name: id, kind: "builtin", model: m.id });
        }
      }
      if (ready.some((m) => !m.requires_voice_reference)) {
        voices.push({ id: DEFAULT_VOICE, object: "audio.voice", name: "Model default", kind: "default", model: null });
      }
      return { object: "list", data: voices, voices };
    });
  });
}

/* ------------------------------------------------------------------ speech */

function registerSpeech(app: FastifyInstance, svc: MirliService): void {
  app.post("/v1/audio/speech", async (request, reply) => {
    const body = speechSchema.parse(request.body ?? {});
    const sse = body.stream_format === "sse";
    const asked = speechFormat(body.response_format, sse);
    if (sse && asked !== "pcm") {
      throw new OpenAiHttpError(
        400,
        "With stream_format 'sse' the audio is sent as PCM, so response_format must be 'pcm' or left out.",
        "unsupported_format",
        "response_format",
      );
    }
    const voiceName = typeof body.voice === "string" ? body.voice : body.voice?.id ?? null;
    const choice = await resolveSpeech(svc, body.model ?? null, voiceName);
    const requestOptions = deliveryOptions(choice.model, body.speed, body.instructions ?? null);
    reply.header("X-Soundbox-Model", choice.model.id).header("X-Soundbox-Voice", headerSafe(choice.voiceName));

    // Audio as it is generated, where the model can and the answer has a
    // shape that can be sent in pieces. A model that can't stream, or a GPU
    // that is busy, is not an error here: the read goes through the queue
    // instead and arrives whole.
    const streamable =
      (sse || asked === "pcm" || asked === "wav") &&
      choice.model.supports.streaming &&
      body.input.length <= STREAM_MAX_CHARS;
    if (streamable) {
      const abort = new AbortController();
      const state = { finished: false };
      reply.raw.on("close", () => {
        if (!state.finished) abort.abort();
      });
      const events = svc.speakStream(
        speakStreamRequestSchema.parse({
          model: choice.model.id,
          text: body.input,
          voice_id: choice.voiceId,
          format: "pcm",
          request_options: requestOptions,
          save: body.keep,
        }),
        abort.signal,
      );
      let first: IteratorResult<SpeakStreamEvent> | null = null;
      try {
        first = await events.next();
      } catch (exc) {
        if (exc instanceof CancelledJob) {
          state.finished = true;
          return reply.code(499).send(openAiError(499, "The caller disconnected."));
        }
        if (!(exc instanceof StreamUnsupported) && !(exc instanceof GpuBusy)) {
          state.finished = true;
          throw exc;
        }
      }
      if (first !== null) {
        if (first.done || first.value.kind !== "start") {
          state.finished = true;
          throw new Error("speak stream produced no start event");
        }
        const { sampleRate, channels } = first.value;
        return sendStream(request, reply, events, state, abort.signal, {
          sse,
          format: asked === "wav" ? "wav" : "pcm",
          sampleRate,
          channels,
          model: choice.model.id,
          voice: choice.voiceName,
        });
      }
      state.finished = true;
    }

    // The queue: the same job `/api/speak` runs, waited for.
    const job = svc.submitSpeak(
      speakRequestSchema.parse({
        model: choice.model.id,
        lines: [{ text: body.input, voice_id: choice.voiceId }],
        request_options: requestOptions,
        origin: { source: "api", client_name: "OpenAI-compatible API" },
      }),
    );
    const finished = await waitFor(svc, job.id, reply);
    if (finished === null) return reply.code(499).send(openAiError(499, "The caller disconnected; the read was cancelled."));
    if (finished.status === "cancelled") {
      throw new OpenAiHttpError(409, "The read was cancelled on the server before it finished.", "cancelled");
    }
    if (finished.status === "error") {
      return reply.code(500).send(jobFailure(finished, "The read failed."));
    }
    const sounds = (finished.result as { sounds?: unknown } | null)?.sounds;
    const soundId = Array.isArray(sounds) && typeof sounds[0] === "string" ? sounds[0] : null;
    const path = soundId ? svc.absolutePath(soundId) : null;
    if (!soundId || !path) {
      return reply.code(500).send(openAiError(500, "The read finished without a sound.", "generation_failed"));
    }

    // Everything is read into memory and the sound discarded before the
    // answer goes out, so a caller that asks again at once finds the library
    // already as it was.
    let format: SpeechFormat = asked ?? "mp3";
    let bytes: Buffer;
    try {
      if (format === "mp3") {
        const mp3 = await encodeMp3(svc, path, soundId);
        if (mp3) {
          bytes = mp3;
        } else if (asked === "mp3") {
          throw new OpenAiHttpError(
            400,
            "This server can't make MP3: that needs ffmpeg, which is not on its PATH. " +
              "Formats that work without it: wav, pcm.",
            "unsupported_format",
            "response_format",
          );
        } else {
          // No format was named, so nothing was promised: send the WAV and
          // say so, as the file route does for the same case.
          format = "wav";
          bytes = await readFile(path);
          reply.header("X-Soundbox-Format-Fallback", "wav");
        }
      } else if (format === "pcm") {
        const clip = dsp.readWav(path);
        bytes = toOpenAiPcm(clip.audio, clip.sampleRate);
      } else {
        bytes = await readFile(path);
      }
    } finally {
      if (!body.keep) await svc.discardSound(soundId).catch(() => {});
    }
    if (format === "pcm") reply.header("X-Soundbox-Sample-Rate", String(PCM_RATE));
    reply.header("X-Soundbox-Sound-Id", body.keep ? soundId : "");

    if (sse) {
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, { ...sseHeaders(request), ...soundboxHeaders(reply) });
      // About half a second of audio per event.
      for (let at = 0; at < bytes.length; at += PCM_RATE) {
        writeEvent(res, { type: "speech.audio.delta", audio: bytes.subarray(at, at + PCM_RATE).toString("base64") });
      }
      writeEvent(res, DONE_EVENT);
      res.end();
      return reply;
    }
    return reply.header("Content-Type", CONTENT_TYPES[format]).send(bytes);
  });
}

/** Header values are Latin-1; a voice can be named anything. */
function headerSafe(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "?");
}

/** The `X-Soundbox-*` headers set so far, for a response written by hand. */
function soundboxHeaders(reply: FastifyReply): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (name.toLowerCase().startsWith("x-soundbox-") && value !== undefined) out[name] = String(value);
  }
  return out;
}

function sseHeaders(request: FastifyRequest): Record<string, string> {
  return {
    ...baseHeaders(request),
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  };
}

/** The two events are `SpeechAudioDeltaEvent` and `SpeechAudioDoneEvent` in
 *  OpenAI's OpenAPI spec; `usage` is required on the second. Mirli counts no
 *  tokens, so it is zero. */
const DONE_EVENT = {
  type: "speech.audio.done",
  usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
};

function writeEvent(res: FastifyReply["raw"], data: { type: string; [key: string]: unknown } | OpenAiError): void {
  const name = "type" in data ? data.type : "error";
  res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** WAV to MP3 through ffmpeg (dsp.transcodeMp3), or null when it can't. The
 *  file lands in the cache folder under the sound's name, where the file
 *  route would put it, so a kept sound's MP3 is made once. */
async function encodeMp3(svc: MirliService, wavPath: string, soundId: string): Promise<Buffer | null> {
  const dst = join(svc.config.paths.cache, `${soundId}.mp3`);
  if (!(await dsp.transcodeMp3(wavPath, dst))) return null;
  return readFile(dst);
}

/** Send a streamed read: raw PCM, a WAV with an open-ended header, or events. */
async function sendStream(
  request: FastifyRequest,
  reply: FastifyReply,
  events: AsyncGenerator<SpeakStreamEvent>,
  state: { finished: boolean },
  signal: AbortSignal,
  opts: { sse: boolean; format: "wav" | "pcm"; sampleRate: number; channels: number; model: string; voice: string },
): Promise<FastifyReply> {
  const wav = opts.format === "wav";
  const headers: Record<string, string> = opts.sse
    ? sseHeaders(request)
    : { ...baseHeaders(request), "Content-Type": CONTENT_TYPES[opts.format] };
  Object.assign(headers, soundboxHeaders(reply));
  headers["X-Soundbox-Sample-Rate"] = String(wav ? opts.sampleRate : PCM_RATE);
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, headers);
  res.flushHeaders();

  // WAV goes out as the model made it. PCM is brought to 24 kHz mono.
  const passthrough = wav || (opts.sampleRate === PCM_RATE && opts.channels === 1);
  const resampler = passthrough ? null : new StreamResampler(opts.sampleRate, PCM_RATE);
  const write = (pcm: Buffer): void => {
    if (pcm.length === 0) return;
    if (opts.sse) writeEvent(res, { type: "speech.audio.delta", audio: pcm.toString("base64") });
    else res.write(pcm);
  };

  if (wav) res.write(streamingWavHeader(opts.sampleRate, opts.channels));
  try {
    for await (const event of events) {
      if (signal.aborted) break;
      if (event.kind !== "audio") continue;
      write(resampler ? toPcm16([resampler.push(monoFromPcm16(event.pcm, opts.channels))]) : event.pcm);
    }
    if (!signal.aborted) {
      if (resampler) write(toPcm16([resampler.flush()]));
      if (opts.sse) writeEvent(res, DONE_EVENT);
    }
  } catch (exc) {
    if (!(exc instanceof CancelledJob) && !signal.aborted) {
      const failure = buildFailure(exc);
      log.warning(`OpenAI speech stream ${request.id} failed mid-read: ${failure.detail}`);
      // Events have a channel for it; raw audio can only stop.
      if (opts.sse) writeEvent(res, openAiError(500, failureMessage(failure), classify(exc) ?? "generation_failed"));
    }
  } finally {
    state.finished = true;
    res.end();
  }
  return reply;
}

/* ----------------------------------------------------------- transcription */

function registerTranscriptions(app: FastifyInstance, svc: MirliService): void {
  app.post("/v1/audio/transcriptions", async (request, reply) => {
    const contentType = String(request.headers["content-type"] ?? "");
    if (!Buffer.isBuffer(request.body) || !contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new OpenAiHttpError(400, "Send the audio as multipart/form-data with a 'file' field.", "invalid_request", "file");
    }
    const form = parseMultipart(request.body, contentType);
    const file = form.files.get("file");
    if (!file || file.data.length === 0) {
      throw new OpenAiHttpError(400, "The form has no 'file' field with audio in it.", "invalid_request", "file");
    }

    const format = (form.fields.get("response_format")?.trim().toLowerCase() || "json") as TranscriptFormat;
    if (!TRANSCRIPT_FORMATS.includes(format)) {
      throw new OpenAiHttpError(
        400,
        `response_format '${format}' is not supported by this server. Formats that work: ${TRANSCRIPT_FORMATS.join(", ")}.`,
        "unsupported_format",
        "response_format",
      );
    }
    if (["true", "1"].includes(form.fields.get("stream")?.trim().toLowerCase() ?? "")) {
      throw new OpenAiHttpError(400, "This server sends a transcription whole; 'stream' is not supported.", "unsupported_stream", "stream");
    }

    let clip: { audio: dsp.Audio; sampleRate: number };
    try {
      // WAV is read directly; anything else goes through ffmpeg when it is
      // installed. The content type is left out on purpose: decodeAudio reads
      // "audio/pcm" as headerless samples, which an upload never is.
      clip = await decodeAudio(file.data, "", PCM_RATE);
    } catch {
      throw new OpenAiHttpError(
        400,
        "That file could not be read as audio. WAV always works; other formats need ffmpeg on the server's PATH.",
        "invalid_audio",
        "file",
      );
    }

    // `model` when it names a transcription model here, else a ready one:
    // clients send `whisper-1` unasked.
    const models = await svc.listModels();
    const wanted = form.fields.get("model")?.trim() || null;
    const named = wanted ? findModel(models, wanted) : null;
    if (named && named.task !== "asr") {
      throw new OpenAiHttpError(400, `${named.name} does not transcribe speech.`, "model_not_found", "model");
    }
    let modelId: string;
    if (named && READY.has(named.status)) {
      modelId = named.id;
    } else {
      try {
        modelId = await svc.pickTranscriber();
      } catch (exc) {
        throw new OpenAiHttpError(404, exc instanceof Error ? exc.message : String(exc), "model_not_installed", "model");
      }
    }

    const language = form.fields.get("language")?.trim() || null;
    const job = svc.submitTranscribe(clip, modelId, language);
    const finished = await waitFor(svc, job.id, reply);
    if (finished === null) return reply.code(499).send(openAiError(499, "The caller disconnected."));
    if (finished.status === "cancelled") {
      throw new OpenAiHttpError(409, "The transcription was cancelled.", "cancelled");
    }
    if (finished.status === "error") {
      return reply.code(500).send(jobFailure(finished, "The transcription failed."));
    }
    const result = finished.result ?? {};
    const text = String(result["text"] ?? "");
    reply.header("X-Soundbox-Model", modelId);
    if (format === "text") {
      return reply.header("Content-Type", "text/plain; charset=utf-8").send(`${text}\n`);
    }
    if (format === "verbose_json") {
      return {
        task: "transcribe",
        language: (result["language"] as string | null) ?? language ?? "",
        duration: Math.round((dsp.frameCount(clip.audio) / clip.sampleRate) * 1000) / 1000,
        text,
      };
    }
    return { text };
  });
}
