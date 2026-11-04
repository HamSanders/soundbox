/**
 * Shared route plumbing: the HTTP error type, query-parameter coercion and the
 * SSE writer.
 *
 * Fastify does not supply these (an HTTP exception type, bounded query
 * coercion, a streaming SSE response), so they live here and every route module uses them.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

import type { AsyncQueue } from "../jobs.js";
import { isTrustedOrigin } from "../origins.js";

/** Cross-origin callers that are allowed: our own origin, the Vite dev
 *  server, and hosts named in KONCHI_ALLOWED_HOSTS — see `origins.ts` for
 *  why it is that list and not "anything on localhost". The server binds
 *  127.0.0.1 by default but can be told to listen elsewhere (`--host`), so
 *  "only local pages can reach it" is not something this check may assume. */
export function isAllowedOrigin(origin: string, hostHeader?: string): boolean {
  return isTrustedOrigin(origin, hostHeader);
}

/** Refuse anything implausible as an uploaded audio body before it hits the
 *  disk. Well past any real clip (a few seconds of speech), small enough that
 *  a mis-posted file can't fill the data directory.
 *
 *  Also passed to Fastify as the global `bodyLimit`: its default is 1 MB, which
 *  rejected every real WAV upload at the parser — before the route's own size
 *  check could run — by destroying the connection, which the UI could only
 *  report as "could not reach the backend". */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/** Set when an mp3 was asked for but a WAV was served instead. */
export const FORMAT_FALLBACK_HEADER = "X-Konchi-Format-Fallback";

/** Ports FastAPI's `HTTPException`: the error handler in `app.ts` turns this
 *  into `{"detail": ...}` with the given status. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "HttpError";
    this.status = status;
  }
}

/** A query value as Fastify hands it over: absent, a string, or repeated. */
type RawQuery = string | string[] | undefined;

function single(value: RawQuery): string | undefined {
  if (Array.isArray(value)) return value[value.length - 1];
  return value;
}

/** FastAPI rejects an out-of-range or unparseable query param with 422 rather
 *  than silently clamping, so these do too. */
export function intQuery(
  raw: RawQuery,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = single(raw);
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new HttpError(422, `Query parameter '${name}' must be an integer`);
  }
  if (parsed < min || parsed > max) {
    throw new HttpError(422, `Query parameter '${name}' must be between ${min} and ${max}`);
  }
  return parsed;
}

export function strQuery(raw: RawQuery): string | null {
  const value = single(raw);
  return value === undefined || value === "" ? null : value;
}

/** A comma-separated list query param, e.g. `?models=a,b,c`. */
export function listQuery(raw: RawQuery): string[] | null {
  const value = single(raw);
  if (value === undefined || value === "") return null;
  const items = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length ? items : null;
}

const TRUE = new Set(["true", "1", "yes", "y", "on"]);
const FALSE = new Set(["false", "0", "no", "n", "off"]);

/** Same spellings Pydantic accepts for a `bool` query parameter. */
export function boolQuery(raw: RawQuery, name: string): boolean | null {
  const value = single(raw);
  if (value === undefined || value === "") return null;
  const lowered = value.toLowerCase();
  if (TRUE.has(lowered)) return true;
  if (FALSE.has(lowered)) return false;
  throw new HttpError(422, `Query parameter '${name}' must be a boolean`);
}

export function enumQuery<T extends string>(
  raw: RawQuery,
  name: string,
  allowed: readonly T[],
): T | null {
  const value = strQuery(raw);
  if (value === null) return null;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new HttpError(422, `Query parameter '${name}' must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

/* ------------------------------------------------------------------- SSE */

/** Idle gap after which a comment is written to keep proxies from closing the
 *  pipe. Matches the Python's 15s `asyncio.wait_for` timeout. */
const KEEPALIVE_MS = 15_000;

/**
 * Take over the socket and write SSE headers.
 *
 * `reply.hijack()` skips Fastify's serialisation *and* its onSend hooks, so the
 * CORS headers @fastify/cors would have added are re-applied here by hand —
 * without them an EventSource opened from the Vite dev server is rejected.
 */
function startSse(request: FastifyRequest, reply: FastifyReply): void {
  reply.hijack();
  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  };
  const origin = request.headers.origin;
  if (origin && isAllowedOrigin(origin, request.headers.host)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Expose-Headers"] = FORMAT_FALLBACK_HEADER;
  }
  reply.raw.writeHead(200, headers);
  reply.raw.flushHeaders();
}

/**
 * Stream `queue` as SSE until the client disconnects, the queue closes, or
 * `onItem` returns "stop" (the job stream ends on a terminal status).
 *
 * `initial` is written before the first await so a late subscriber isn't stuck
 * waiting for a change that already happened.
 */
export async function streamSse<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  queue: AsyncQueue<T>,
  options: {
    initial?: () => T[];
    /** Return "stop" to close the stream after writing this item. */
    onItem?: (item: T) => "continue" | "stop";
    /** Called once the stream is finished, disconnects included. */
    cleanup: () => void;
  },
): Promise<void> {
  startSse(request, reply);
  const res = reply.raw;
  let open = true;
  res.on("close", () => {
    open = false;
    queue.close();
  });

  try {
    for (const item of options.initial?.() ?? []) {
      res.write(`data: ${JSON.stringify(item)}\n\n`);
      if (options.onItem?.(item) === "stop") return;
    }
    // One long-lived pending read: re-calling next() per loop would queue a
    // second waiter and the value handed to the abandoned one would be lost.
    let pending: Promise<IteratorResult<T>> | null = null;
    while (open) {
      pending ??= queue.next();
      let timer: NodeJS.Timeout | undefined;
      const keepalive = new Promise<"keepalive">((resolve) => {
        timer = setTimeout(() => resolve("keepalive"), KEEPALIVE_MS);
        timer.unref();
      });
      const winner = await Promise.race([pending, keepalive]);
      clearTimeout(timer);
      if (winner === "keepalive") {
        res.write(": keepalive\n\n");
        continue;
      }
      pending = null;
      if (winner.done) break;
      res.write(`data: ${JSON.stringify(winner.value)}\n\n`);
      if (options.onItem?.(winner.value) === "stop") break;
    }
  } finally {
    options.cleanup();
    if (open) res.end();
  }
}
