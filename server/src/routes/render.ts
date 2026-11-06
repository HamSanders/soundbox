/**
 * `POST /api/render`: run one generation, wait for it, answer with the WAV.
 *
 * The job routes return a job id at once and leave the caller to follow it.
 * That suits the app, which shows progress, but not a client that wants a
 * file back from one request: a script, a render farm, or another Soundbox
 * that has this one set up as a custom endpoint (endpoints/). This route
 * holds the request open until the job finishes, so this server's models
 * become a single URL that any HTTP client can call.
 *
 * The render goes through the same queue as everything else, so a waiting
 * request waits its turn behind the app's own jobs. If the caller hangs up
 * first, the job is cancelled: nobody is left to receive it.
 */

import { readFile } from "node:fs/promises";

import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import {
  generateRequestSchema,
  type Job,
  scriptLineSchema,
  speakRequestSchema,
  type GenerateRequest,
  type SpeakRequest,
} from "../schemas.js";
import type { SoundboxService } from "../service.js";
import { HttpError } from "./helpers.js";

const TERMINAL = new Set(["done", "error", "cancelled"]);

/** Fields only the render route reads. Everything else is the body of
 *  `/api/generate` or `/api/speak`, unchanged. */
const renderOptionsSchema = z.object({
  /** Which job to run. Omit to let the body decide: `text` or `lines` means
   *  speech, anything else a generation. */
  task: z.enum(["generate", "speak"]).nullish(),
  /** false deletes the sound from this library once it has been sent, for a
   *  server that only renders for others. Default true: it stays, like any
   *  other render. */
  keep: z.boolean().default(true),
});

/** The speech shorthand: one line and a voice, the shape an endpoint
 *  template (`"text": "{{text}}", "voice": "{{voice}}"`) produces. */
const speakShorthandSchema = z.object({
  text: z.string().min(1).max(20000).nullish(),
  /** A saved voice, by id or by name. */
  voice: z.string().max(120).nullish(),
  lines: z.array(scriptLineSchema).min(1).max(200).nullish(),
});

export function registerRender(app: FastifyInstance, svc: SoundboxService): void {
  app.post("/api/render", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Expected a JSON object");
    }
    const { task, keep } = renderOptionsSchema.parse(body);
    const { task: _t, keep: _k, ...rest } = body;
    const speak = task ? task === "speak" : rest.text != null || rest.lines != null;

    const job = speak
      ? svc.submitSpeak(speakRequest(svc, rest))
      : svc.submitGenerate(generateRequest(rest));

    const finished = await waitFor(svc, job.id, reply);
    // The caller hung up. The socket is gone, so this goes nowhere, but it
    // closes the request out cleanly in the log.
    if (finished === null) return reply.code(499).send({ detail: "The caller disconnected; the render was cancelled." });

    if (finished.status === "cancelled") {
      throw new HttpError(409, "The render was cancelled on the server before it finished.");
    }
    if (finished.status === "error") {
      return reply.code(500).send({
        detail: finished.error ?? "The render failed.",
        failure: finished.failure ?? null,
        job_id: finished.id,
      });
    }

    const soundId = soundOf(finished);
    const path = soundId ? svc.absolutePath(soundId) : null;
    if (!soundId || !path) {
      return reply.code(500).send({ detail: "The render finished without a sound.", job_id: finished.id });
    }
    // Read whole before any delete. A render is at most a few minutes of
    // audio, which fits in memory comfortably.
    const wav = await readFile(path);
    if (!keep) await svc.deleteSound(soundId);

    return reply
      .header("Content-Type", "audio/wav")
      .header("Content-Disposition", `inline; filename="${soundId}.wav"`)
      .header("X-Soundbox-Job-Id", finished.id)
      .header("X-Soundbox-Sound-Id", keep ? soundId : "")
      .send(wav);
  });
}

/** A generation, held to one file: the response is one WAV, so there is
 *  nothing to put a second variation or a set of stems in. */
function generateRequest(body: Record<string, unknown>): GenerateRequest {
  const req = generateRequestSchema.parse(body);
  if (req.variations > 1) {
    throw new HttpError(400, "A render returns one file, so variations must be 1. Call it once per variation.");
  }
  if (req.separate) {
    throw new HttpError(400, "A render returns one file, so it cannot split into stems. Use /api/generate.");
  }
  return req;
}

/** `/api/speak`'s body, or the `text` + `voice` shorthand for one line. */
function speakRequest(svc: SoundboxService, body: Record<string, unknown>): SpeakRequest {
  const short = speakShorthandSchema.parse(body);
  if (short.lines && short.text) {
    throw new HttpError(400, "Send either text or lines, not both.");
  }
  if (!short.lines && !short.text) {
    throw new HttpError(400, "A speech render needs text (or lines).");
  }
  const { text: _text, voice: _voice, ...rest } = body;
  const lines = short.lines ?? [{ text: short.text!, voice_id: resolveVoice(svc, short.voice ?? null) }];
  return speakRequestSchema.parse({ ...rest, lines });
}

/** A voice named by id or by name (case-insensitive), so an endpoint's voice
 *  list can carry the names people see in the Voice Lab. */
function resolveVoice(svc: SoundboxService, voice: string | null): string | null {
  if (!voice) return null;
  const voices = svc.listVoices();
  const found =
    voices.find((v) => v.id === voice) ??
    voices.find((v) => v.name.toLowerCase() === voice.toLowerCase());
  if (!found) {
    const names = voices.map((v) => v.name).join(", ") || "none saved";
    throw new HttpError(400, `No saved voice is called '${voice}'. Voices on this server: ${names}.`);
  }
  return found.id;
}

function soundOf(job: Job): string | null {
  const sounds = (job.result as { sounds?: unknown } | null)?.sounds;
  return Array.isArray(sounds) && typeof sounds[0] === "string" ? sounds[0] : null;
}

/**
 * Wait for a job to reach a terminal state.
 *
 * Returns null if the caller disconnects first, after cancelling the job:
 * a GPU on a rented box should not keep rendering for nobody.
 */
async function waitFor(svc: SoundboxService, jobId: string, reply: FastifyReply): Promise<Job | null> {
  const queue = svc.jobs.subscribe(jobId);
  let gone = false;
  const onClose = () => {
    if (reply.raw.writableEnded) return;
    gone = true;
    svc.jobs.cancel(jobId);
    queue.close();
  };
  reply.raw.on("close", onClose);
  try {
    // Subscribed before this first read, so a job that finishes in between is
    // seen either here or on the queue.
    const current = svc.jobs.get(jobId);
    if (current && TERMINAL.has(current.status)) return current;
    for await (const job of queue) {
      if (TERMINAL.has(job.status)) return job;
    }
    if (gone) return null;
    // The queue closed without a terminal event; trust the store.
    return svc.jobs.get(jobId);
  } finally {
    reply.raw.off("close", onClose);
    svc.jobs.unsubscribe(jobId, queue);
  }
}
