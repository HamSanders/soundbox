/**
 * Library routes: sounds, non-destructive edits and the tag index.
 */

import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import * as dsp from "../audio/dsp.js";
import { UNSET, type UpdateSoundPatch } from "../db.js";
import type { Source } from "../schemas.js";
import { soundEditRequestSchema, soundPatchSchema } from "../schemas.js";
import type { KonchiService } from "../service.js";
import { HttpError, boolQuery, enumQuery, intQuery, listQuery, strQuery } from "./helpers.js";

/** Open the OS file manager with `path` selected, one spawn per platform.
 *  Konchi is local-only by design — the server and the browser hitting it
 *  always share a machine — so shelling out here is the same trust boundary
 *  as reading the file off disk in the first place. */
function revealInFileManager(path: string): void {
  const child =
    process.platform === "win32"
      ? spawn("explorer.exe", [`/select,${path}`], { detached: true, stdio: "ignore" })
      : process.platform === "darwin"
        ? spawn("open", ["-R", path], { detached: true, stdio: "ignore" })
        : spawn("xdg-open", [dirname(path)], { detached: true, stdio: "ignore" });
  child.unref();
}

type IdParams = { Params: { sound_id: string } };

/** Refuse anything implausible before it hits the disk. Well past any real
 *  take, small enough that a mis-posted file cannot fill the data directory.
 *
 *  Larger than the server-wide body limit (`helpers.MAX_UPLOAD_BYTES`, sized
 *  for a voice clip) because an imported track or a long take is legitimately
 *  bigger than that. It is applied as this route's own `bodyLimit` — a check
 *  in the handler alone never ran, since the global limit had already
 *  refused anything over it at the parser. */
const MAX_SOUND_UPLOAD_BYTES = 256 * 1024 * 1024;

/** What put a sound in the library via upload. Stored as the sound's `model`,
 *  which the UI reads as a label, so it is a closed set rather than whatever
 *  string a caller sends. */
const uploadSourceSchema = z.enum(["recording", "import", "midi"]).default("recording");

const SOURCES: readonly Source[] = ["app", "api", "mcp"];

export function registerSounds(app: FastifyInstance, svc: KonchiService): void {
  app.get("/api/sounds", async (request) => {
    const q = request.query as Record<string, string | string[] | undefined>;
    return svc.listSounds({
      limit: intQuery(q.limit, "limit", 100, 1, 500),
      offset: intQuery(q.offset, "offset", 0, 0, Number.MAX_SAFE_INTEGER),
      q: strQuery(q.q),
      tag: strQuery(q.tag),
      model: strQuery(q.model),
      models: listQuery(q.models),
      favorite: boolQuery(q.favorite, "favorite"),
      session_id: strQuery(q.session_id),
      project_id: strQuery(q.project_id),
      parent_id: strQuery(q.parent_id),
      voice_id: strQuery(q.voice_id),
      source: enumQuery(q.source, "source", SOURCES),
    });
  });

  app.get<IdParams>("/api/sounds/:sound_id", async (request) => {
    const sound = svc.getSound(request.params.sound_id);
    if (sound === null) throw new HttpError(404, "Sound not found");
    return sound;
  });

  app.patch<IdParams>("/api/sounds/:sound_id", async (request) => {
    const parsed = soundPatchSchema.parse(request.body);
    const patch: UpdateSoundPatch = {
      name: parsed.name,
      favorite: parsed.favorite,
      tags: parsed.tags,
      // project_id=null is a real target state (unfile it), so it is only
      // forwarded when the client actually sent the field — otherwise a plain
      // rename would silently unfile the sound. Zod collapses "absent" and
      // "explicitly undefined" into the same value, hence the raw-body probe.
      project_id: hasKey(request.body, "project_id") ? parsed.project_id ?? null : UNSET,
    };
    const sound = svc.updateSound(request.params.sound_id, patch);
    if (sound === null) throw new HttpError(404, "Sound not found");
    return sound;
  });

  app.delete<IdParams>("/api/sounds/:sound_id", async (request, reply) => {
    if (!(await svc.deleteSound(request.params.sound_id))) {
      throw new HttpError(404, "Sound not found");
    }
    return reply.code(204).send();
  });

  /** Non-destructive: always creates and returns a new derived sound (see
   *  `Sound.parent_id`) rather than modifying `sound_id`'s audio in place. */
  /**
   * Take audio recorded in the browser into the library — the microphone, on
   * its way to a timeline track.
   *
   * The body is the file itself, as with `/api/voices/upload`, and the WAV
   * parsers registered there cover this route too: content type parsers are
   * per-instance, not per-plugin. Decoded here rather than in the service so a
   * corrupt upload fails as a 400 at the boundary, where the caller can still
   * do something about it.
   */
  app.post("/api/sounds/upload", { bodyLimit: MAX_SOUND_UPLOAD_BYTES }, async (request, reply) => {
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new HttpError(400, "Expected a WAV file as the request body");
    }
    if (body.length > MAX_SOUND_UPLOAD_BYTES) {
      throw new HttpError(413, "That recording is too large");
    }
    const query = request.query as Record<string, string | string[] | undefined>;
    const name = strQuery(query.name) ?? "Recording";
    const source = uploadSourceSchema.safeParse(strQuery(query.source) ?? undefined);
    if (!source.success) {
      throw new HttpError(422, "Query parameter 'source' must be one of recording, import, midi");
    }

    // `readWav` takes a path, so the bytes land in a temp file first and only
    // reach the library once they have decoded cleanly.
    const tmp = await mkdtemp(join(tmpdir(), "konchi-upload-"));
    try {
      const path = join(tmp, "upload.wav");
      await writeFile(path, body);
      let decoded;
      try {
        decoded = dsp.readWav(path);
      } catch {
        throw new HttpError(400, "That file isn't readable as a WAV.");
      }
      const sound = svc.importSound(decoded.audio, decoded.sampleRate, {
        name,
        source: source.data,
        projectId: strQuery(query.project_id) ?? null,
      });
      return reply.code(201).send(sound);
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  });

  app.post<IdParams>("/api/sounds/:sound_id/edit", async (request, reply) => {
    const req = soundEditRequestSchema.parse(request.body);
    const sound = svc.editSound(request.params.sound_id, req);
    if (sound === null) throw new HttpError(404, "Sound not found");
    return reply.code(201).send(sound);
  });

  /** Reveal the WAV on disk in the OS file manager — Explorer, Finder, or
   *  whatever the desktop's default is on Linux. Only meaningful because
   *  Konchi never leaves the machine it runs on. */
  app.post<IdParams>("/api/sounds/:sound_id/reveal", async (request, reply) => {
    const path = svc.absolutePath(request.params.sound_id);
    if (path === null) throw new HttpError(404, "Sound not found");
    revealInFileManager(path);
    return reply.code(204).send();
  });

  app.get("/api/tags", async () => svc.listTags());
}

function hasKey(body: unknown, key: string): boolean {
  return typeof body === "object" && body !== null && key in body;
}
