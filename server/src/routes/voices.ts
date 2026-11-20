/**
 * Saved voices — the library the Voice studio picks from.
 *
 * A voice is either a reference clip to clone (`kind: "clone"`) or a name from
 * one model family's built-in list (`kind: "builtin"`); see `Voice` in
 * schemas.ts for why those can't be collapsed into one shape.
 *
 * Reference clips arrive as a raw WAV body rather than multipart/form-data:
 * one file with no other fields is the whole payload, so multipart would mean
 * a new dependency to parse an envelope carrying nothing. The clip's metadata
 * (name, notes, model_id) rides along as query parameters instead.
 */

import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";

import * as dsp from "../audio/dsp.js";
import {
  voiceCreateSchema,
  voiceExportSchema,
  voicePatchSchema,
  voiceSampleCreateSchema,
} from "../schemas.js";
import type { MirliService } from "../service.js";
import { HttpError, MAX_UPLOAD_BYTES, boolQuery, strQuery, type RawQuery } from "./helpers.js";
import { waitFor } from "./render.js";

type IdParams = { Params: { voice_id: string } };
type SampleParams = { Params: { voice_id: string; sample_id: string } };

/** Decode an uploaded WAV body, or fail as a 400 at the boundary — a corrupt
 *  upload should not surface later as a confusing generation error. readWav
 *  takes a path, so the bytes land in a temp file first. */
async function decodeUpload(body: unknown): Promise<{ audio: dsp.Audio; sampleRate: number }> {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new HttpError(400, "Expected a WAV file as the request body");
  }
  if (body.length > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, "Reference clip is too large");
  }
  const tmp = await mkdtemp(join(tmpdir(), "soundbox-voice-"));
  try {
    const path = join(tmp, "upload.wav");
    await writeFile(path, body);
    try {
      return dsp.readWav(path);
    } catch {
      throw new HttpError(400, "That file isn't readable as a WAV.");
    }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

export function registerVoices(app: FastifyInstance, svc: MirliService): void {
  // Buffer raw audio bodies for the upload route below. Registered here rather
  // than in app.ts because this is the only route that takes one.
  for (const mime of ["audio/wav", "audio/x-wav", "audio/wave", "application/octet-stream"]) {
    app.addContentTypeParser(mime, { parseAs: "buffer" }, (_req, body, done) => {
      done(null, body);
    });
  }

  app.get("/api/voices", async () => svc.listVoices());

  /**
   * Transcribe a clip: the words in it and, when the model says, its language.
   *
   * The body is the WAV itself (an upload or a recording), or empty with
   * `?sound_id=` for a library sound. `?model=` picks the recogniser, else a
   * ready one; `?language=` is a hint. Waits for the queued job and answers
   * `{ text, language, model }`. With no transcription model installed it is
   * a 409 with `code: "no_transcription_model"`, so the UI can say so.
   */
  app.post("/api/transcribe", async (request, reply) => {
    const q = request.query as Record<string, RawQuery>;
    const soundId = strQuery(q["sound_id"]);
    let clip: { audio: dsp.Audio; sampleRate: number };
    if (soundId) {
      const path = svc.absolutePath(soundId);
      if (path === null) throw new HttpError(404, "Sound not found");
      clip = dsp.readWav(path);
    } else {
      clip = await decodeUpload(request.body);
    }
    let modelId = strQuery(q["model"]);
    if (!modelId) {
      try {
        modelId = await svc.pickTranscriber();
      } catch (exc) {
        return reply.code(409).send({
          detail: exc instanceof Error ? exc.message : String(exc),
          code: "no_transcription_model",
        });
      }
    }
    const job = svc.submitTranscribe(clip, modelId, strQuery(q["language"]) ?? null);
    const finished = await waitFor(svc, job.id, reply);
    if (finished === null) return reply.code(499).send({ detail: "The caller disconnected." });
    if (finished.status === "cancelled") throw new HttpError(409, "The transcription was cancelled.");
    if (finished.status === "error") {
      return reply.code(500).send({ detail: finished.error ?? "The transcription failed.", job_id: finished.id });
    }
    const r = finished.result ?? {};
    return { text: String(r["text"] ?? ""), language: (r["language"] as string | null) ?? null, model: modelId };
  });

  app.get<IdParams>("/api/voices/:voice_id", async (request) => {
    const voice = svc.getVoice(request.params.voice_id);
    if (voice === null) throw new HttpError(404, "Voice not found");
    return voice;
  });

  /**
   * Create a voice from JSON: either a builtin name, or a clone whose
   * reference clip is an existing library sound. The upload route below covers
   * the third case, a clip from the user's disk.
   */
  app.post("/api/voices", async (request, reply) => {
    const req = voiceCreateSchema.parse(request.body);
    return reply.code(201).send(svc.createVoice(req));
  });

  /**
   * Create a clone voice from an uploaded WAV — body is the file itself.
   *
   * Decoded here rather than in the service so a corrupt or non-WAV upload
   * fails as a 400 at the boundary, instead of surfacing later as a confusing
   * generation error.
   */
  app.post("/api/voices/upload", async (request, reply) => {
    const query = request.query as Record<string, string | string[] | undefined>;
    const name = strQuery(query.name);
    if (!name) throw new HttpError(422, "A voice needs a name (?name=...)");
    const decoded = await decodeUpload(request.body);
    const voice = svc.createVoice(
      {
        name,
        kind: "clone",
        notes: strQuery(query.notes) ?? null,
        voice_id: null,
        model_id: strQuery(query.model_id) ?? null,
        source_sound_id: null,
        reference_text: voiceCreateSchema.shape.reference_text.parse(strQuery(query.reference_text)),
        tidy: boolQuery(query.tidy, "tidy") ?? false,
      },
      decoded,
    );
    return reply.code(201).send(voice);
  });

  /**
   * Add a clip to a clone voice. Either a raw WAV body (`?tidy=true` to clean
   * it up) or JSON `{ source_sound_id, tidy? }` for a sound already in the
   * library — the same two doors a new voice has.
   */
  app.post<IdParams>("/api/voices/:voice_id/samples", async (request, reply) => {
    if (svc.getVoice(request.params.voice_id) === null) {
      throw new HttpError(404, "Voice not found");
    }
    let voice;
    if (Buffer.isBuffer(request.body)) {
      const query = request.query as Record<string, string | string[] | undefined>;
      const decoded = await decodeUpload(request.body);
      voice = svc.addVoiceSample(
        request.params.voice_id,
        decoded,
        boolQuery(query.tidy, "tidy") ?? false,
        voiceSampleCreateSchema.shape.reference_text.parse(strQuery(query.reference_text)),
      );
    } else {
      const req = voiceSampleCreateSchema.parse(request.body);
      voice = svc.addVoiceSample(
        request.params.voice_id,
        { source_sound_id: req.source_sound_id },
        req.tidy,
        req.reference_text,
      );
    }
    return reply.code(201).send(voice);
  });

  app.delete<SampleParams>("/api/voices/:voice_id/samples/:sample_id", async (request) => {
    const voice = await svc.deleteVoiceSample(request.params.voice_id, request.params.sample_id);
    if (voice === null) throw new HttpError(404, "Voice or clip not found");
    return voice;
  });

  /** The voice as a `.soundbox-voice.json` download — see `voiceExportSchema`. */
  app.get<IdParams>("/api/voices/:voice_id/export", async (request, reply) => {
    const file = svc.exportVoice(request.params.voice_id);
    if (file === null) throw new HttpError(404, "Voice not found");
    // ASCII-only filename: a header can't carry the rest, and the voice's
    // real name is inside the file anyway.
    const stem = file.voice.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim() || "voice";
    return reply
      .header("Content-Disposition", `attachment; filename="${stem}.soundbox-voice.json"`)
      .send(file);
  });

  /** Recreate a voice from an exported file, under a new id. */
  app.post("/api/voices/import", async (request, reply) => {
    const file = voiceExportSchema.parse(request.body);
    return reply.code(201).send(await svc.importVoice(file));
  });

  app.patch<IdParams>("/api/voices/:voice_id", async (request) => {
    const patch = voicePatchSchema.parse(request.body ?? {});
    const voice = svc.updateVoice(request.params.voice_id, patch);
    if (voice === null) throw new HttpError(404, "Voice not found");
    return voice;
  });

  app.delete<IdParams>("/api/voices/:voice_id", async (request, reply) => {
    if (!(await svc.deleteVoice(request.params.voice_id))) {
      throw new HttpError(404, "Voice not found");
    }
    return reply.code(204).send();
  });
}
