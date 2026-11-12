/**
 * `GET /files/{filename}` — the generated audio itself.
 */

import { createReadStream, statSync } from "node:fs";
import { basename, join } from "node:path";

import type { FastifyInstance } from "fastify";

import { transcodeMp3 } from "../audio/dsp.js";
import type { Config } from "../config.js";
import { FORMAT_FALLBACK_HEADER, HttpError, strQuery } from "./helpers.js";

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function registerFiles(app: FastifyInstance, config: Config): void {
  app.get<{ Params: { filename: string } }>("/files/:filename", async (request, reply) => {
    const filename = request.params.filename;
    // Path traversal guard: only a bare filename inside sounds/ is servable.
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      throw new HttpError(400, "Invalid filename");
    }
    const src = join(config.paths.sounds, filename);
    if (!isFile(src)) throw new HttpError(404, "File not found");

    const format = strQuery((request.query as Record<string, string | undefined>).format);
    if (format === "mp3") {
      const stem = filename.replace(/\.[^.]*$/, "");
      const dst = join(config.paths.cache, `${stem}.mp3`);
      if (isFile(dst) || (await transcodeMp3(src, dst))) {
        return send(reply, dst, "audio/mpeg", basename(dst));
      }
      // ffmpeg missing (or the transcode itself failed) is common enough —
      // Konchi doesn't bundle ffmpeg — that erroring here would make "set
      // output format to mp3" break downloads outright. Falling back to the
      // WAV is the friendlier outcome, but doing that silently is its own bug:
      // a user who asked for mp3 and always gets a .wav with no explanation has
      // no way to tell the fallback from the setting simply not working. This
      // header lets the UI say which one actually happened.
      reply.header(FORMAT_FALLBACK_HEADER, "wav");
      return send(reply, src, "audio/wav", filename);
    }
    return send(reply, src, "audio/wav", filename);
  });

  /**
   * `GET /artwork/{filename}` — generated cover art and voice avatars.
   *
   * Inline rather than an attachment, unlike the audio above: these are shown
   * in an `<img>`, never downloaded. Cached hard because the filename is a
   * fresh UUID per render — a redraw produces a new name, so a stale cache
   * entry can never be served for new artwork.
   */
  app.get<{ Params: { filename: string } }>("/artwork/:filename", async (request, reply) => {
    const filename = request.params.filename;
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      throw new HttpError(400, "Invalid filename");
    }
    const src = join(config.paths.artwork, filename);
    if (!isFile(src)) throw new HttpError(404, "Artwork not found");
    return reply
      .header("Content-Type", "image/png")
      .header("Content-Length", statSync(src).size)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(createReadStream(src));
  });
}

function send(
  reply: import("fastify").FastifyReply,
  path: string,
  contentType: string,
  downloadName: string,
) {
  return reply
    .header("Content-Type", contentType)
    .header("Content-Length", statSync(path).size)
    .header("Content-Disposition", `attachment; filename="${downloadName}"`)
    .send(createReadStream(path));
}
