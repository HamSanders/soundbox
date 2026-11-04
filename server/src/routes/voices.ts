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
import type { KonchiService } from "../service.js";
import { HttpError, MAX_UPLOAD_BYTES, boolQuery, strQuery } from "./helpers.js";

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
  const tmp = await mkdtemp(join(tmpdir(), "konchi-voice-"));
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

export function registerVoices(app: FastifyInstance, svc: KonchiService): void {
  // Buffer raw audio bodies for the upload route below. Registered here rather
  // than in app.ts because this is the only route that takes one.
  for (const mime of ["audio/wav", "audio/x-wav", "audio/wave", "application/octet-stream"]) {
    app.addContentTypeParser(mime, { parseAs: "buffer" }, (_req, body, done) => {
      done(null, body);
    });
  }

  app.get("/api/voices", async () => svc.listVoices());

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
      );
    } else {
      const req = voiceSampleCreateSchema.parse(request.body);
      voice = svc.addVoiceSample(
        request.params.voice_id,
        { source_sound_id: req.source_sound_id },
        req.tidy,
      );
    }
    return reply.code(201).send(voice);
  });

  app.delete<SampleParams>("/api/voices/:voice_id/samples/:sample_id", async (request) => {
    const voice = await svc.deleteVoiceSample(request.params.voice_id, request.params.sample_id);
    if (voice === null) throw new HttpError(404, "Voice or clip not found");
    return voice;
  });

  /** The voice as a `.konchi-voice.json` download — see `voiceExportSchema`. */
  app.get<IdParams>("/api/voices/:voice_id/export", async (request, reply) => {
    const file = svc.exportVoice(request.params.voice_id);
    if (file === null) throw new HttpError(404, "Voice not found");
    // ASCII-only filename: a header can't carry the rest, and the voice's
    // real name is inside the file anyway.
    const stem = file.voice.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim() || "voice";
    return reply
      .header("Content-Disposition", `attachment; filename="${stem}.konchi-voice.json"`)
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
