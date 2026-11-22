/**
 * Stream an HTTP download to disk.
 *
 * Every large download in the server — model weights, engine archives — goes
 * through here rather than collecting chunks in an array and writing them at
 * the end. A 5 GB checkpoint held in memory is a 5 GB heap, and on a machine
 * that is about to load that same checkpoint into a model it is the
 * difference between finishing and being killed.
 *
 * The bytes land in `<dest>.part` and are renamed into place only after they
 * add up, so a half-finished file never sits at the path that "is it
 * downloaded?" checks look at. A server that stops sending for a minute is
 * treated as dead rather than waited on forever, which is what an unbounded
 * `for await` over a stalled socket otherwise does.
 *
 * An interrupted transfer is picked up rather than started again:
 *
 * - Resume. A `.part` left by an earlier attempt is continued with an HTTP
 *   Range request (RFC 9110 section 14). Beside it sits `<dest>.part.meta`,
 *   which records the validator the first response carried (ETag or
 *   Last-Modified) and the size. The validator goes back as If-Range, so a
 *   server whose file changed answers 200 with the whole new file instead of
 *   the tail of a different one. A 200, a 416, or a 206 that does not line up
 *   with what is on disk all mean the same thing: start again from byte 0.
 *   The SHA-256 covers the whole file either way, the kept part included.
 * - Retry. A dropped connection, a stall, a 5xx or a 429 is retried a few
 *   times with exponential backoff (a 429 or 503 waits for its Retry-After).
 *   A 401, 403 or 404 is not: nothing about asking again changes the answer.
 * - Disk guard. Before a byte is asked for, the bytes still to come plus a
 *   margin are compared with the free space where the file will land.
 *
 * What is kept after a failure: a connectivity failure keeps the `.part` so
 * the next try continues from it. A cancel, a full disk and a file that turns
 * out to be the wrong size or checksum remove it.
 */

import { createHash, type Hash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

/** How long the server may go without sending a byte — before the response
 *  headers as well as between chunks — before the download is abandoned. */
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

/** Tries per file, the first one included. */
export const DEFAULT_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_BASE_MS = 1_000;
/** The longest single wait, and the longest Retry-After that is honoured. A
 *  server asking for more than this is reported instead of waited on. */
export const DEFAULT_BACKOFF_MAX_MS = 60_000;

/** Free space to leave after a model download: weights are loaded straight
 *  after, and a system drive with nothing left misbehaves in ways that look
 *  nothing like "the disk is full". */
export const MODEL_HEADROOM_BYTES = 2 * 1024 ** 3;

/** Statuses worth asking again for. Everything else in 4xx is an answer. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** How many times one call may throw its `.part` away and start from byte 0
 *  because the server would not continue it. */
const MAX_RESTARTS = 2;

/** A download that failed for a reason worth telling a person. Callers wrap it
 *  in their own error type (InstallError, ModelError) so the message reaches
 *  the UI the same way their other failures do. */
export class DownloadError extends Error {
  constructor(
    message: string,
    /** The HTTP status when the server answered with an error, else null. */
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "DownloadError";
  }
}

/** Free bytes available to this process on the volume holding `path`, or null
 *  when the platform cannot say. */
export type FreeBytesFn = (path: string) => Promise<number | null>;

export interface RetryOptions {
  /** Tries in total, the first one included. 1 turns retrying off. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface RetryNotice {
  /** The try that is about to start, counted from 1. */
  attempt: number;
  attempts: number;
  /** Milliseconds left before it starts. Called about once a second while
   *  waiting, so a caller can show a countdown and notice a cancel. */
  waitMs: number;
  /** Why the last try ended, as a clause: "the connection dropped". */
  reason: string;
}

export interface DownloadOptions {
  headers?: Record<string, string>;
  /** The size the file should be, when the catalog knows it. A mismatch fails
   *  the download instead of installing a truncated or substituted file. 0 or
   *  absent means unknown. */
  expectedBytes?: number;
  /** The hex SHA-256 the file should have, when the catalog knows it. Checked
   *  before the file is renamed into place. */
  expectedSha256?: string | null;
  /** Called per chunk. `done` counts the whole file, so it starts at the size
   *  of the kept part on a resume. `total` is the size the server declared
   *  (falling back to `expectedBytes`), or 0 when neither is known. */
  onProgress?: (done: number, total: number) => void;
  idleTimeoutMs?: number;
  /** Cancels the download from outside, e.g. a job being cancelled. */
  signal?: AbortSignal;
  /** Inspect the response before any bytes are written — the place a caller
   *  turns a 401 into "add a token in Settings". Throwing aborts the download.
   *  The default rejects any non-2xx status. Not called for a status that is
   *  retried until the retries run out. */
  checkResponse?: (resp: Response) => void;
  /** Continue a `.part` left by an earlier attempt. Default true. */
  resume?: boolean;
  retry?: RetryOptions;
  /** Called while waiting to retry. Throwing cancels the download. */
  onRetry?: (notice: RetryNotice) => void;
  /** Free space to leave on the volume after the file is written. Default 0;
   *  model downloads pass `MODEL_HEADROOM_BYTES`. */
  headroomBytes?: number;
  /** How free space is measured. Injected by tests. */
  freeBytes?: FreeBytesFn;
}

export interface DownloadResult {
  bytes: number;
  /** Hex SHA-256 of what was written, computed on the way through so a
   *  checksum check never needs to read the file back into memory. */
  sha256: string;
  /** Bytes that were already on disk and were not fetched again. */
  resumedFrom: number;
  /** Tries it took, 1 when nothing went wrong. */
  attempts: number;
}

/* ------------------------------------------------------------------ format */

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** "40 s", "3 min", "1 h 20 min": coarse on purpose, since the estimate is. */
export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${Math.floor(minutes / 60)} h`;
}

/**
 * Transfer speed over the last few seconds, from the byte counts a progress
 * callback already sees.
 *
 * A window rather than an average since the start: a download that slowed to
 * a crawl ten minutes in should say so, and a resumed one should not count
 * the bytes it found on disk as speed.
 */
export class TransferRate {
  private samples: { at: number; bytes: number }[] = [];

  constructor(
    private readonly windowMs = 8_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Record the running byte count. A count that went down (a restart from
   *  byte 0) clears the window. */
  add(bytes: number): void {
    const at = this.now();
    const last = this.samples[this.samples.length - 1];
    if (last && bytes < last.bytes) this.samples = [];
    // Chunks arrive thousands of times a second; a sample every 250 ms is
    // plenty, and keeps the window a few dozen entries long.
    if (last && bytes >= last.bytes && at - last.at < 250) return;
    this.samples.push({ at, bytes });
    while (this.samples.length > 2 && at - this.samples[0]!.at > this.windowMs) this.samples.shift();
  }

  /** Bytes per second, or null until there is a second of data to judge by. */
  bytesPerSecond(): number | null {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last.at - first.at < 1_000) return null;
    return ((last.bytes - first.bytes) * 1000) / (last.at - first.at);
  }

  /** Seconds until `total`, or null when the rate or the total is unknown. */
  secondsLeft(done: number, total: number): number | null {
    const rate = this.bytesPerSecond();
    if (!rate || rate <= 0 || !total || done >= total) return null;
    return (total - done) / rate;
  }

  /** The progress line: "1.2 GB of 4.0 GB · 12.3 MB/s · 4 min left". The rate
   *  and the time are left off until they are known. */
  line(done: number, total: number): string {
    this.add(done);
    const parts = [total ? `${fmtBytes(done)} of ${fmtBytes(total)}` : fmtBytes(done)];
    const rate = this.bytesPerSecond();
    if (rate !== null && rate > 0) {
      parts.push(`${fmtBytes(rate)}/s`);
      const left = this.secondsLeft(done, total);
      if (left !== null) parts.push(`${fmtDuration(left)} left`);
    }
    return parts.join(" · ");
  }
}

/** The message a caller shows while a download waits to retry. */
export function retryLine(notice: RetryNotice): string {
  const wait = Math.max(1, Math.ceil(notice.waitMs / 1000));
  return (
    `Download interrupted (${notice.reason}). Retrying in ${wait} s, ` +
    `attempt ${notice.attempt} of ${notice.attempts}`
  );
}

/* -------------------------------------------------------------- disk guard */

/** Free space on the volume that holds `path`, measured at the nearest
 *  ancestor that exists (the models folder may not have been created yet). */
export const freeBytesAt: FreeBytesFn = async (path) => {
  let dir = path;
  for (;;) {
    try {
      const fs = await statfs(dir);
      const free = Number(fs.bavail) * Number(fs.bsize);
      return Number.isFinite(free) ? free : null;
    } catch (exc) {
      if ((exc as NodeJS.ErrnoException).code !== "ENOENT") return null;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
};

export interface DiskSpaceCheck {
  /** Where the bytes will be written. Named in the message. */
  path: string;
  /** The full size of what is being downloaded. */
  neededBytes: number;
  /** What is already on disk and will not be fetched again. */
  alreadyBytes?: number;
  headroomBytes?: number;
  freeBytes?: FreeBytesFn;
}

/**
 * Refuse a download that will not fit, before it starts.
 *
 * Needed is what is still to come plus the headroom. Skipped when the size is
 * unknown or the platform cannot report free space: a guard that guesses is
 * worse than the ENOSPC it stands in for.
 */
export async function assertDiskSpace(check: DiskSpaceCheck): Promise<void> {
  if (!check.neededBytes || check.neededBytes <= 0) return;
  const remaining = Math.max(0, check.neededBytes - (check.alreadyBytes ?? 0));
  if (remaining === 0) return;
  const headroom = Math.max(0, check.headroomBytes ?? 0);
  const free = await (check.freeBytes ?? freeBytesAt)(check.path);
  if (free === null || free >= remaining + headroom) return;
  throw new DownloadError(
    `Not enough disk space at ${check.path}: ${fmtBytes(remaining)} still to download` +
      (headroom ? `, plus ${fmtBytes(headroom)} to keep free` : "") +
      `, and ${fmtBytes(free)} is free. Free up space on that drive or move the ` +
      `models folder to another one, then try again. Nothing was downloaded this time.`,
  );
}

/* ------------------------------------------------------------ resume state */

/** What `<dest>.part.meta` records about the response a `.part` came from. */
interface PartMeta {
  url: string;
  etag: string | null;
  lastModified: string | null;
  /** The full size the server declared, or null when it did not say. */
  total: number | null;
}

async function readMeta(path: string): Promise<PartMeta | null> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<PartMeta>;
    if (typeof raw.url !== "string") return null;
    return {
      url: raw.url,
      etag: typeof raw.etag === "string" ? raw.etag : null,
      lastModified: typeof raw.lastModified === "string" ? raw.lastModified : null,
      total: typeof raw.total === "number" && raw.total > 0 ? raw.total : null,
    };
  } catch {
    return null;
  }
}

/** A weak validator cannot be used with If-Range (RFC 9110 section 13.1.5). */
function isStrongEtag(etag: string | null): etag is string {
  return !!etag && !etag.startsWith("W/");
}

/** `bytes 100-199/200` → { start: 100, end: 199, total: 200 }. Total is null
 *  for `/*`. Null when the header is missing or not a satisfied byte range. */
function parseContentRange(value: string | null): { start: number; end: number; total: number | null } | null {
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value?.trim() ?? "");
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), total: m[3] === "*" ? null : Number(m[3]) };
}

/** Retry-After as milliseconds: delay-seconds or an HTTP-date (RFC 9110
 *  section 10.2.3). Null when absent or unreadable. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/* ----------------------------------------------------------------- retries */

/** One try ended in a way another try might not. */
class Transient extends Error {
  constructor(
    /** What to throw if the retries run out. */
    readonly error: unknown,
    /** A clause for the progress line. */
    readonly reason: string,
    readonly retryAfterMs: number | null = null,
    /** The response, when the server answered with a retryable status, so the
     *  caller's `checkResponse` words the final failure. */
    readonly response: Response | null = null,
  ) {
    super(reason);
  }
}

/** The `.part` could not be continued and has been removed: go again from 0. */
class Restart extends Error {}

/** A cancel, raised by the caller's own callback or signal. */
class Cancelled extends Error {
  constructor(readonly error: unknown) {
    super("cancelled");
  }
}

const CERT_ERROR = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL/;

/** Whether a rejected `fetch()` is a connectivity failure. undici reports
 *  those as a TypeError carrying the socket error as `cause`; a malformed URL
 *  or a bad header is a TypeError with none, and asking again will not help.
 *  Neither will a certificate that does not verify. */
function isNetworkError(exc: unknown): boolean {
  if (!(exc instanceof Error)) return false;
  const cause = (exc as { cause?: unknown }).cause;
  if (cause === undefined || cause === null) return false;
  const code = String((cause as { code?: unknown }).code ?? "");
  return !CERT_ERROR.test(code);
}

function describeError(exc: unknown): string {
  if (!(exc instanceof Error)) return String(exc);
  const cause = (exc as { cause?: unknown }).cause;
  const code = (cause as { code?: unknown } | undefined)?.code ?? (exc as { code?: unknown }).code;
  const inner = cause instanceof Error ? cause.message : "";
  return [exc.message, inner && inner !== exc.message ? inner : "", code ? String(code) : ""]
    .filter(Boolean)
    .join(": ");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function downloadToFile(
  url: string,
  dest: string,
  opts: DownloadOptions = {},
): Promise<DownloadResult> {
  const attempts = Math.max(1, Math.floor(opts.retry?.attempts ?? DEFAULT_ATTEMPTS));
  const baseDelay = opts.retry?.baseDelayMs ?? DEFAULT_BACKOFF_BASE_MS;
  const maxDelay = opts.retry?.maxDelayMs ?? DEFAULT_BACKOFF_MAX_MS;
  const part = `${dest}.part`;
  const metaPath = `${part}.meta`;
  const discard = async () => {
    await rm(part, { force: true }).catch(() => {});
    await rm(metaPath, { force: true }).catch(() => {});
  };

  await mkdir(dirname(dest), { recursive: true });
  let attempt = 1;
  let restarts = 0;
  for (;;) {
    try {
      const result = await attemptDownload(url, dest, part, metaPath, opts, discard);
      return { ...result, attempts: attempt };
    } catch (exc) {
      if (exc instanceof Cancelled) {
        await discard();
        throw exc.error;
      }
      if (exc instanceof Restart) {
        if (++restarts > MAX_RESTARTS) {
          throw new DownloadError(
            `Download of ${url} could not be continued or restarted: the server keeps ` +
              `answering a range request with something that does not match the file.`,
          );
        }
        continue;
      }
      if (!(exc instanceof Transient)) throw exc;

      // Honour Retry-After, but only up to the cap: a server asking for an
      // hour is telling the user to come back later, not this loop.
      const tooLong = exc.retryAfterMs !== null && exc.retryAfterMs > maxDelay;
      if (attempt >= attempts || tooLong) {
        if (exc.response) {
          // The caller's wording for a refused download, then the default.
          opts.checkResponse?.(exc.response);
          throw new DownloadError(`HTTP ${exc.response.status} fetching ${url}`, exc.response.status);
        }
        if (exc.error instanceof DownloadError && attempt > 1) {
          throw new DownloadError(
            `${exc.error.message} Gave up after ${attempt} attempts. What arrived is kept, ` +
              `so the next try continues from it where the server allows.`,
            exc.error.status,
          );
        }
        throw exc.error;
      }

      const backoff = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      // Jitter downwards only, so a Retry-After is never undercut.
      let remaining = exc.retryAfterMs ?? Math.round(backoff * (0.5 + Math.random() * 0.5));
      attempt += 1;
      try {
        while (remaining > 0) {
          opts.onRetry?.({ attempt, attempts, waitMs: remaining, reason: exc.reason });
          if (opts.signal?.aborted) throw opts.signal.reason ?? new Error("Download cancelled");
          const step = Math.min(1_000, remaining);
          await sleep(step, opts.signal);
          remaining -= step;
        }
        if (opts.signal?.aborted) throw opts.signal.reason ?? new Error("Download cancelled");
      } catch (cancel) {
        await discard();
        throw cancel;
      }
    }
  }
}

/** Feed what is already in the `.part` through the hash, so the digest at the
 *  end covers the whole file and not just the bytes fetched this time. */
async function hashFile(path: string, hash: Hash): Promise<void> {
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
}

async function attemptDownload(
  url: string,
  dest: string,
  part: string,
  metaPath: string,
  opts: DownloadOptions,
  discard: () => Promise<void>,
): Promise<Omit<DownloadResult, "attempts">> {
  const idleMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const expected = opts.expectedBytes && opts.expectedBytes > 0 ? opts.expectedBytes : 0;
  const guard = (neededBytes: number, alreadyBytes: number) =>
    assertDiskSpace({
      path: dirname(dest),
      neededBytes,
      alreadyBytes,
      headroomBytes: opts.headroomBytes,
      freeBytes: opts.freeBytes,
    });

  // What an earlier attempt left. It is only continued when this module wrote
  // it for this URL and there is something to hold the server to: a validator
  // for If-Range, or at least a size the result has to add up to.
  let offset = 0;
  let meta: PartMeta | null = null;
  if (opts.resume !== false) {
    const size = await stat(part).then((s) => s.size, () => 0);
    meta = size > 0 ? await readMeta(metaPath) : null;
    const known = expected || meta?.total || 0;
    const anchored = !!meta && (!!meta.etag || !!meta.lastModified || known > 0);
    if (meta && meta.url === url && anchored && (!known || size <= known)) offset = size;
  }
  if (offset === 0) meta = null;

  if (expected) await guard(expected, offset);

  const hash = createHash("sha256");
  if (offset > 0) await hashFile(part, hash);

  const finish = async (bytes: number, digest: Hash, resumedFrom: number) => {
    const sha256 = digest.digest("hex");
    const want = opts.expectedSha256?.trim().toLowerCase();
    if (want && sha256 !== want) {
      await discard();
      throw new DownloadError(
        `The model file downloaded from ${url} is corrupt: its SHA-256 is ${sha256}, ` +
          `expected ${want}. It was removed; download it again.`,
      );
    }
    await rename(part, dest);
    await rm(metaPath, { force: true }).catch(() => {});
    return { bytes, sha256, resumedFrom };
  };

  // Every byte is already here: the process stopped between the last write
  // and the rename. Nothing to ask the server for.
  const knownTotal = expected || meta?.total || 0;
  if (offset > 0 && knownTotal && offset === knownTotal) {
    opts.onProgress?.(offset, knownTotal);
    return await finish(offset, hash, offset);
  }

  const controller = new AbortController();
  let stalled = false;
  let idleTimer: NodeJS.Timeout | null = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, idleMs);
  };
  const onOuterAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onOuterAbort, { once: true });
  }
  const stalledError = () =>
    new DownloadError(
      `Download of ${url} stalled — no data for ${Math.round(idleMs / 1000)}s. ` +
        `Check your network and try again.`,
    );

  armIdle();
  try {
    const headers: Record<string, string> = { ...opts.headers };
    if (offset > 0) {
      headers.Range = `bytes=${offset}-`;
      // Offsets are into the stored bytes, so the range has to be of the
      // unencoded representation.
      headers["Accept-Encoding"] = "identity";
      const validator = isStrongEtag(meta!.etag) ? meta!.etag : meta!.lastModified;
      if (validator) headers["If-Range"] = validator;
    }

    let resp: Response;
    try {
      resp = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    } catch (exc) {
      if (opts.signal?.aborted) throw new Cancelled(exc);
      if (stalled) throw new Transient(stalledError(), "the server stopped answering");
      if (isNetworkError(exc)) throw new Transient(exc, "the server could not be reached");
      throw exc;
    }

    if (resp.status === 416 && offset > 0) {
      // The part is as long as, or longer than, what the server has now.
      await resp.body?.cancel().catch(() => {});
      await discard();
      throw new Restart();
    }
    if (RETRYABLE_STATUS.has(resp.status)) {
      await resp.body?.cancel().catch(() => {});
      throw new Transient(
        null,
        resp.status === 429 ? "the server asked us to slow down" : `the server answered ${resp.status}`,
        parseRetryAfter(resp.headers.get("retry-after")),
        resp,
      );
    }
    if (opts.checkResponse) opts.checkResponse(resp);
    else if (!resp.ok) throw new DownloadError(`HTTP ${resp.status} fetching ${url}`, resp.status);
    if (!resp.body) throw new DownloadError(`Empty response fetching ${url}`, resp.status);

    // Content-Length only describes the bytes we will count when nothing
    // decoded them on the way: fetch transparently gunzips, and then the
    // header is the compressed size.
    const encoded = (resp.headers.get("content-encoding") ?? "identity") !== "identity";
    const length = encoded ? 0 : Number(resp.headers.get("content-length") ?? 0);
    const etag = resp.headers.get("etag");
    const lastModified = resp.headers.get("last-modified");

    let done = 0;
    let total = 0;
    let digest = hash;
    if (resp.status === 206 && offset > 0) {
      // A continuation is only trusted when it says, in so many words, that
      // it starts where the part ends and belongs to the file the part came
      // from. Anything else and the part goes.
      const range = parseContentRange(resp.headers.get("content-range"));
      const sameFile =
        (!meta!.etag || !etag || etag === meta!.etag) &&
        (!meta!.total || !range?.total || range.total === meta!.total) &&
        (!expected || !range?.total || range.total === expected);
      if (encoded || !range || range.start !== offset || !sameFile) {
        await resp.body.cancel().catch(() => {});
        await discard();
        throw new Restart();
      }
      done = offset;
      total = range.total ?? (length ? offset + length : 0);
    } else if (resp.status === 206) {
      // A partial answer to a request that asked for the whole file.
      await resp.body.cancel().catch(() => {});
      throw new DownloadError(`Unexpected partial response (HTTP 206) fetching ${url}`, 206);
    } else {
      // 200: either a fresh start, or the server ignored the Range header, or
      // If-Range did not match because the file changed. In each case this is
      // the whole file and whatever was on disk is replaced by it.
      offset = 0;
      digest = createHash("sha256");
      total = length;
      await rm(metaPath, { force: true }).catch(() => {});
    }
    total ||= expected;
    if (!expected && total) await guard(total, done);

    if (done === 0 && !encoded) {
      const next: PartMeta = { url, etag, lastModified, total: total || null };
      // Best effort: without it the part simply is not resumable.
      await writeFile(metaPath, JSON.stringify(next)).catch(() => {});
    }

    const resumedFrom = done;
    let progressError: { error: unknown } | null = null;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, callback) {
        armIdle();
        digest.update(chunk);
        done += chunk.byteLength;
        try {
          opts.onProgress?.(done, total);
        } catch (exc) {
          progressError = { error: exc };
          callback(exc instanceof Error ? exc : new Error(String(exc)));
          return;
        }
        callback(null, chunk);
      },
    });
    const sink = createWriteStream(part, { flags: resumedFrom > 0 ? "a" : "w" });
    const body = Readable.fromWeb(resp.body as unknown as WebReadableStream<Uint8Array>);
    // `pipeline` rejects with whichever stream failed first and then destroys
    // the others with that same error, so the only way to tell a dead socket
    // from a full disk is to note which stream the error started on.
    let bodyError: unknown = null;
    body.once("error", (err) => {
      bodyError = err;
    });

    try {
      await pipeline(body, meter, sink);
    } catch (exc) {
      const cancelled = progressError as { error: unknown } | null;
      if (cancelled) throw new Cancelled(cancelled.error);
      if (opts.signal?.aborted) throw new Cancelled(exc);
      if (stalled) throw new Transient(stalledError(), "no data arrived");
      if (exc !== bodyError) {
        // A local failure (the disk filled, the folder went read-only). The
        // part is given back so it is not what keeps the disk full.
        await discard();
        throw exc;
      }
      throw new Transient(
        new DownloadError(
          total
            ? `Download of ${url} was cut short: got ${done} of ${total} bytes (${describeError(exc)}).`
            : `Download of ${url} was cut short after ${done} bytes (${describeError(exc)}).`,
        ),
        "the connection dropped",
      );
    }

    if (total && done < total) {
      throw new Transient(
        new DownloadError(`Download of ${url} ended early: got ${done} of ${total} bytes.`),
        "the connection closed early",
      );
    }
    if ((total && done > total) || (expected && done !== expected)) {
      await discard();
      throw new DownloadError(
        `Download of ${url} is ${done} bytes, expected ${expected || total}. The file ` +
          `upstream may have changed, or the transfer was cut short.`,
      );
    }
    return await finish(done, digest, resumedFrom);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}
