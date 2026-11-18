/**
 * `POST /api/speak/stream` — one line of speech, sent as it is generated.
 *
 * The service's generator is advanced once *before* the socket is taken over:
 * everything that can fail cheaply (unknown model, a model that can't stream,
 * a busy GPU, a load error) fails before the first chunk, so it still reaches
 * the client as an ordinary status code with a JSON body. Only once audio
 * exists does the response commit to 200 and a streaming body.
 *
 * See docs/STREAMING.md for the wire formats.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";

import { CancelledJob, GpuBusy, StreamUnsupported } from "../errors.js";
import { getLogger } from "../logging.js";
import { speakStreamRequestSchema } from "../schemas.js";
import type { SoundboxService, SpeakStreamEvent } from "../service.js";
import { isAllowedOrigin } from "./helpers.js";

const log = getLogger("soundbox.stream");

const FORMAT_HEADERS = ["X-Soundbox-Sample-Rate", "X-Soundbox-Channels", "X-Soundbox-Stream-Id"];

export function registerSpeakStream(app: FastifyInstance, svc: SoundboxService): void {
  app.post("/api/speak/stream", async (request, reply) => {
    const req = speakStreamRequestSchema.parse(request.body);

    // The client hanging up is the cancel button. 'close' on the response
    // fires for that and for a normal finish; `finished` tells them apart.
    const abort = new AbortController();
    let finished = false;
    reply.raw.on("close", () => {
      if (!finished) abort.abort();
    });

    const events = svc.speakStream(req, abort.signal);
    let first: IteratorResult<SpeakStreamEvent>;
    try {
      first = await events.next();
    } catch (exc) {
      finished = true;
      if (exc instanceof StreamUnsupported) {
        return reply.code(409).send({ detail: exc.message, reason: "unsupported" });
      }
      if (exc instanceof GpuBusy) {
        if (exc.retryAfterS !== null) reply.header("Retry-After", String(exc.retryAfterS));
        return reply
          .code(409)
          .send({ detail: exc.message, reason: "busy", retry_after_s: exc.retryAfterS });
      }
      if (exc instanceof CancelledJob) return reply.code(499).send({ detail: "Client closed" });
      throw exc; // ModelError → 400, anything else → 500, via the app handler.
    }
    if (first.done || first.value.kind !== "start") {
      finished = true;
      throw new Error("speak stream produced no start event");
    }
    const { sampleRate, channels } = first.value;
    const streamId = request.id;

    reply.hijack();
    const res = reply.raw;
    const headers = baseHeaders(request);
    if (req.format === "pcm") {
      headers["Content-Type"] = `audio/L16; rate=${sampleRate}; channels=${channels}`;
    } else {
      headers["Content-Type"] = "text/event-stream";
      headers["Cache-Control"] = "no-cache";
      headers["X-Accel-Buffering"] = "no";
    }
    headers["X-Soundbox-Sample-Rate"] = String(sampleRate);
    headers["X-Soundbox-Channels"] = String(channels);
    headers["X-Soundbox-Stream-Id"] = streamId;
    res.writeHead(200, headers);
    res.flushHeaders();

    const sse = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    if (req.format === "sse") {
      sse("start", {
        stream_id: streamId,
        model: req.model,
        sample_rate: sampleRate,
        channels,
        encoding: "pcm_s16le",
      });
    }

    let seq = 0;
    try {
      for await (const event of events) {
        if (abort.signal.aborted) break;
        if (event.kind === "audio") {
          if (req.format === "pcm") res.write(event.pcm);
          else sse("audio", { seq: seq++, pcm: event.pcm.toString("base64"), frames: event.frames });
        } else if (event.kind === "done") {
          if (req.format === "sse") {
            sse("done", {
              duration_s: event.durationS,
              ttft_ms: event.ttftMs,
              model_ttft_ms: event.modelTtftMs,
              sound_id: event.soundId,
            });
          }
        }
      }
    } catch (exc) {
      if (!(exc instanceof CancelledJob) && !abort.signal.aborted) {
        const message = exc instanceof Error ? exc.message : String(exc);
        log.warning(`stream ${streamId} failed mid-read: ${message}`);
        // SSE has an in-band channel for it; raw PCM can only stop.
        if (req.format === "sse") sse("error", { message });
      }
    } finally {
      finished = true;
      res.end();
    }
  });
}

/** CORS by hand, as `startSse` does: `hijack()` skips @fastify/cors. */
function baseHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const origin = request.headers.origin;
  if (origin && isAllowedOrigin(origin, request.headers.host)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Expose-Headers"] = FORMAT_HEADERS.join(", ");
  }
  return headers;
}

