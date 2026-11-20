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
      // Mirli doesn't bundle ffmpeg — that erroring here would make "set
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

/**
 * The byte range a `Range: bytes=…` header asks for, clamped to the file, or
 * `"unsatisfiable"`, or null for "send the whole file" (no header, a form we
 * don't serve such as several ranges, or garbage, which RFC 9110 says to
 * ignore).
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    // "bytes=-500": the last 500 bytes.
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

function send(
  reply: import("fastify").FastifyReply,
  path: string,
  contentType: string,
  downloadName: string,
) {
  const size = statSync(path).size;
  // Range support is what lets a player seek: without `Accept-Ranges` and a
  // 206 for a range, Chromium (the desktop app's WebView2 included) treats the
  // audio as unseekable and every scrub snaps back to where it was.
  reply
    .header("Content-Type", contentType)
    .header("Accept-Ranges", "bytes")
    .header("Content-Disposition", `attachment; filename="${downloadName}"`);
  const range = parseRange(reply.request.headers.range, size);
  if (range === "unsatisfiable") {
    return reply.code(416).header("Content-Range", `bytes */${size}`).send();
  }
  if (range) {
    return reply
      .code(206)
      .header("Content-Range", `bytes ${range.start}-${range.end}/${size}`)
      .header("Content-Length", range.end - range.start + 1)
      .send(createReadStream(path, { start: range.start, end: range.end }));
  }
  return reply.header("Content-Length", size).send(createReadStream(path));
}
