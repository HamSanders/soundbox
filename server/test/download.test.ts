import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertDiskSpace,
  DownloadError,
  downloadToFile,
  fmtDuration,
  MODEL_HEADROOM_BYTES,
  parseRetryAfter,
  TransferRate,
  type DownloadOptions,
} from "../src/download.js";
import { classify } from "../src/failure.js";

/**
 * A local HTTP server that misbehaves on request.
 *
 * Each incoming request takes the next step off `script`; once the script is
 * used up it serves the file properly, honouring Range and If-Range.
 */
type Step =
  | "ok"
  /** Send this many bytes of the body, then cut the connection. */
  | { drop: number }
  /** Send this many bytes, then say nothing more and keep the socket open. */
  | { stall: number }
  /** Answer with this status and no file. */
  | { status: number; headers?: Record<string, string> }
  /** Answer 200 with the whole file whatever Range says. */
  | "ignore-range"
  /** Honour Range but not If-Range: the tail of whatever the file is now. */
  | "ignore-if-range";

interface Seen {
  range: string | null;
  ifRange: string | null;
  status: number;
}

class TestServer {
  file: Buffer = Buffer.alloc(0);
  etag: string | null = '"v1"';
  lastModified: string | null = null;
  /** Leave Content-Length off full responses, as a chunked server does. */
  chunked = false;
  script: Step[] = [];
  seen: Seen[] = [];
  private server: Server;
  private open = new Set<ServerResponse>();

  constructor() {
    this.server = createServer((req, res) => this.handle(req, res));
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/weights.gguf`;
  }

  async stop(): Promise<void> {
    for (const res of this.open) res.destroy();
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const step = this.script.shift() ?? "ok";
    const range = (req.headers.range as string | undefined) ?? null;
    const ifRange = (req.headers["if-range"] as string | undefined) ?? null;
    const note = (status: number) => this.seen.push({ range, ifRange, status });
    this.open.add(res);
    res.on("close", () => this.open.delete(res));

    if (typeof step === "object" && "status" in step) {
      note(step.status);
      res.writeHead(step.status, step.headers ?? {});
      res.end();
      return;
    }

    const validators: Record<string, string> = {};
    if (this.etag) validators.ETag = this.etag;
    if (this.lastModified) validators["Last-Modified"] = this.lastModified;

    // Which bytes to send: the whole file, or the tail a Range asked for.
    let start = 0;
    const m = /^bytes=(\d+)-$/.exec(range ?? "");
    const validatorMatches =
      ifRange === null || step === "ignore-if-range" || ifRange === this.etag || ifRange === this.lastModified;
    if (m && step !== "ignore-range" && validatorMatches) {
      start = Number(m[1]);
      if (start >= this.file.length) {
        note(416);
        res.writeHead(416, { "Content-Range": `bytes */${this.file.length}` });
        res.end();
        return;
      }
    }
    const body = this.file.subarray(start);
    const status = start > 0 ? 206 : 200;
    note(status);
    const headers: Record<string, string> = { ...validators, "Accept-Ranges": "bytes" };
    if (status === 206) headers["Content-Range"] = `bytes ${start}-${this.file.length - 1}/${this.file.length}`;
    if (status === 206 || !this.chunked) headers["Content-Length"] = String(body.length);
    res.writeHead(status, headers);

    if (typeof step === "object" && ("drop" in step || "stall" in step)) {
      const n = "drop" in step ? step.drop : step.stall;
      res.write(body.subarray(0, n), () => {
        // Give the bytes time to reach the client before the line goes dead.
        if ("drop" in step) setTimeout(() => res.destroy(), 60);
      });
      return;
    }
    res.end(body);
  }
}

const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/** Fast retries, so a test of five attempts does not take fifteen seconds. */
const FAST: DownloadOptions = { retry: { baseDelayMs: 5, maxDelayMs: 2_000 } };

let dir: string;
let dest: string;
let server: TestServer;
let url: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mirli-download-"));
  dest = join(dir, "weights.gguf");
  server = new TestServer();
  server.file = randomBytes(300_000);
  url = await server.start();
});

afterEach(async () => {
  await server.stop();
  await rm(dir, { recursive: true, force: true });
});

describe("downloadToFile", () => {
  it("downloads a file, hashes it, and leaves no part behind", async () => {
    const result = await downloadToFile(url, dest, FAST);
    expect(result).toMatchObject({ bytes: 300_000, sha256: sha(server.file), resumedFrom: 0, attempts: 1 });
    expect(await readFile(dest)).toEqual(server.file);
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(existsSync(`${dest}.part.meta`)).toBe(false);
    expect(server.seen).toEqual([{ range: null, ifRange: null, status: 200 }]);
  });

  it("resumes with a Range request after the connection drops mid-file", async () => {
    server.script = [{ drop: 100_000 }];
    const progress: number[] = [];
    const result = await downloadToFile(url, dest, { ...FAST, onProgress: (done) => progress.push(done) });

    expect(result.attempts).toBe(2);
    expect(result.resumedFrom).toBeGreaterThan(0);
    expect(result.resumedFrom).toBeLessThanOrEqual(100_000);
    expect(result.sha256).toBe(sha(server.file));
    expect(await readFile(dest)).toEqual(server.file);

    expect(server.seen).toHaveLength(2);
    expect(server.seen[1]).toEqual({
      range: `bytes=${result.resumedFrom}-`,
      ifRange: '"v1"',
      status: 206,
    });
    // The count carries on from the kept part rather than starting over.
    expect(progress.at(-1)).toBe(300_000);
    expect(progress.every((n, i) => i === 0 || n >= progress[i - 1]!)).toBe(true);
  });

  it("keeps the part when it gives up, and a later call continues from it", async () => {
    server.script = [{ drop: 120_000 }];
    const failed = await downloadToFile(url, dest, { retry: { attempts: 1 } }).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(DownloadError);
    expect((failed as Error).message).toMatch(/cut short|ended early/);
    expect(classify(failed)).toBe("download_truncated");
    const kept = (await stat(`${dest}.part`)).size;
    expect(kept).toBeGreaterThan(0);
    expect(existsSync(`${dest}.part.meta`)).toBe(true);
    expect(existsSync(dest)).toBe(false);

    const result = await downloadToFile(url, dest, FAST);
    expect(result).toMatchObject({ resumedFrom: kept, attempts: 1, sha256: sha(server.file) });
    expect(server.seen[1]).toMatchObject({ range: `bytes=${kept}-`, status: 206 });
    expect(await readFile(dest)).toEqual(server.file);
  });

  it("falls back to the whole file when the server answers 200 to a Range request", async () => {
    server.script = [{ drop: 100_000 }, "ignore-range"];
    const result = await downloadToFile(url, dest, FAST);
    expect(server.seen.map((s) => s.status)).toEqual([200, 200]);
    expect(server.seen[1]!.range).toMatch(/^bytes=\d+-$/);
    expect(result).toMatchObject({ bytes: 300_000, resumedFrom: 0, sha256: sha(server.file) });
    expect(await readFile(dest)).toEqual(server.file);
  });

  it("restarts when the file changed upstream and the server honours If-Range", async () => {
    server.script = [{ drop: 100_000 }];
    const first = await downloadToFile(url, dest, { retry: { attempts: 1 } }).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(DownloadError);

    server.file = randomBytes(280_000);
    server.etag = '"v2"';
    const result = await downloadToFile(url, dest, FAST);
    // If-Range carried the old ETag, so the answer was the new file in full.
    expect(server.seen[1]).toMatchObject({ ifRange: '"v1"', status: 200 });
    expect(result).toMatchObject({ bytes: 280_000, resumedFrom: 0, sha256: sha(server.file) });
    expect(await readFile(dest)).toEqual(server.file);
  });

  it("restarts when a 206 comes back for a different file than the part", async () => {
    server.script = [{ drop: 100_000 }, "ignore-if-range"];
    await downloadToFile(url, dest, { retry: { attempts: 1 } }).catch(() => {});

    server.file = randomBytes(300_000);
    server.etag = '"v2"';
    const result = await downloadToFile(url, dest, FAST);
    // The 206 carried a new ETag: thrown away, then fetched whole.
    expect(server.seen.map((s) => s.status)).toEqual([200, 206, 200]);
    expect(server.seen[2]!.range).toBeNull();
    expect(result.sha256).toBe(sha(server.file));
    expect(await readFile(dest)).toEqual(server.file);
  });

  it("uses the stored size as the guard when the server sends no validator", async () => {
    server.etag = null;
    server.script = [{ drop: 100_000 }];
    await downloadToFile(url, dest, { retry: { attempts: 1 } }).catch(() => {});
    expect(existsSync(`${dest}.part`)).toBe(true);

    // Same length would be indistinguishable here; a different one is caught
    // by the total in Content-Range.
    server.file = randomBytes(310_000);
    const result = await downloadToFile(url, dest, FAST);
    expect(server.seen.map((s) => s.status)).toEqual([200, 206, 200]);
    expect(server.seen[1]!.ifRange).toBeNull();
    expect(result.sha256).toBe(sha(server.file));
  });

  it("sends Last-Modified as If-Range when the ETag is weak", async () => {
    server.etag = 'W/"v1"';
    server.lastModified = "Wed, 21 Oct 2026 07:28:00 GMT";
    server.script = [{ drop: 100_000 }];
    const result = await downloadToFile(url, dest, FAST);
    expect(server.seen[1]).toMatchObject({ ifRange: "Wed, 21 Oct 2026 07:28:00 GMT", status: 206 });
    expect(result.sha256).toBe(sha(server.file));
  });

  it("does not resume a part it has nothing to check against", async () => {
    server.etag = null;
    server.chunked = true;
    server.script = [{ drop: 100_000 }];
    const result = await downloadToFile(url, dest, FAST);
    expect(server.seen.map((s) => s.range)).toEqual([null, null]);
    expect(result).toMatchObject({ resumedFrom: 0, sha256: sha(server.file) });
  });

  it("ignores a stray part that it did not write", async () => {
    await writeFile(`${dest}.part`, randomBytes(50_000));
    const result = await downloadToFile(url, dest, { ...FAST, expectedBytes: 300_000 });
    expect(server.seen).toEqual([{ range: null, ifRange: null, status: 200 }]);
    expect(result.sha256).toBe(sha(server.file));
  });

  it("restarts from byte 0 on 416", async () => {
    // A part longer than the file the server has now.
    await writeFile(`${dest}.part`, randomBytes(400_000));
    await writeFile(
      `${dest}.part.meta`,
      JSON.stringify({ url, etag: '"v1"', lastModified: null, total: null }),
    );
    const result = await downloadToFile(url, dest, FAST);
    expect(server.seen.map((s) => s.status)).toEqual([416, 200]);
    expect(result).toMatchObject({ bytes: 300_000, resumedFrom: 0, sha256: sha(server.file) });
    expect(await readFile(dest)).toEqual(server.file);
  });

  it("finishes a complete part without asking the server for anything", async () => {
    await writeFile(`${dest}.part`, server.file);
    await writeFile(
      `${dest}.part.meta`,
      JSON.stringify({ url, etag: '"v1"', lastModified: null, total: 300_000 }),
    );
    const result = await downloadToFile(url, dest, { ...FAST, expectedBytes: 300_000 });
    expect(server.seen).toHaveLength(0);
    expect(result).toMatchObject({ bytes: 300_000, resumedFrom: 300_000, sha256: sha(server.file) });
    expect(existsSync(`${dest}.part.meta`)).toBe(false);
  });

  it("retries a stalled transfer and resumes it", async () => {
    server.script = [{ stall: 100_000 }];
    const result = await downloadToFile(url, dest, { ...FAST, idleTimeoutMs: 150 });
    expect(result.attempts).toBe(2);
    expect(server.seen[1]!.status).toBe(206);
    expect(result.sha256).toBe(sha(server.file));
  });

  it("reports a stall once the retries run out", async () => {
    server.script = [{ stall: 10 }, { stall: 0 }];
    const failed = await downloadToFile(url, dest, {
      idleTimeoutMs: 100,
      retry: { attempts: 2, baseDelayMs: 5 },
    }).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(DownloadError);
    expect(classify(failed)).toBe("download_stalled");
    expect((failed as Error).message).toContain("Gave up after 2 attempts");
  });

  it("retries 503 and then succeeds", async () => {
    server.script = [{ status: 503 }, { status: 503 }];
    const notices: string[] = [];
    const result = await downloadToFile(url, dest, {
      ...FAST,
      onRetry: (n) => notices.push(`${n.attempt}/${n.attempts} ${n.reason}`),
    });
    expect(server.seen.map((s) => s.status)).toEqual([503, 503, 200]);
    expect(result).toMatchObject({ attempts: 3, sha256: sha(server.file) });
    expect(notices[0]).toBe("2/5 the server answered 503");
  });

  it("gives up on a 503 that never clears, after the attempt cap", async () => {
    server.script = Array.from({ length: 10 }, () => ({ status: 503 }));
    const failed = await downloadToFile(url, dest, { retry: { attempts: 3, baseDelayMs: 5 } }).catch(
      (e: unknown) => e,
    );
    expect(failed).toBeInstanceOf(DownloadError);
    expect((failed as DownloadError).status).toBe(503);
    expect(server.seen).toHaveLength(3);
  });

  it("waits for Retry-After on 429", async () => {
    server.script = [{ status: 429, headers: { "Retry-After": "1" } }];
    const started = Date.now();
    const waits: number[] = [];
    const result = await downloadToFile(url, dest, { ...FAST, onRetry: (n) => waits.push(n.waitMs) });
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
    expect(waits[0]).toBe(1000);
    expect(server.seen.map((s) => s.status)).toEqual([429, 200]);
    expect(result.sha256).toBe(sha(server.file));
  });

  it("does not sit out a Retry-After longer than the cap", async () => {
    server.script = [{ status: 429, headers: { "Retry-After": "3600" } }];
    const failed = await downloadToFile(url, dest, FAST).catch((e: unknown) => e);
    expect((failed as DownloadError).status).toBe(429);
    expect(server.seen).toHaveLength(1);
  });

  it.each([401, 403, 404])("never retries %i", async (status) => {
    server.script = [{ status }];
    const failed = await downloadToFile(url, dest, FAST).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(DownloadError);
    expect((failed as DownloadError).status).toBe(status);
    expect(server.seen).toHaveLength(1);
  });

  it("lets checkResponse word the failure, for a refusal and for retries that ran out", async () => {
    const checkResponse = (resp: Response) => {
      if (!resp.ok) throw new Error(`custom ${resp.status}`);
    };
    server.script = [{ status: 403 }];
    await expect(downloadToFile(url, dest, { ...FAST, checkResponse })).rejects.toThrow("custom 403");
    expect(server.seen).toHaveLength(1);

    server.seen = [];
    server.script = [{ status: 500 }, { status: 500 }];
    await expect(
      downloadToFile(url, dest, { checkResponse, retry: { attempts: 2, baseDelayMs: 5 } }),
    ).rejects.toThrow("custom 500");
    expect(server.seen).toHaveLength(2);
  });

  it("does not retry a connection that was never a network problem", async () => {
    await expect(downloadToFile("not a url", dest, FAST)).rejects.toThrow();
  });

  it("retries a server that is not there, then reports the original error", async () => {
    await server.stop();
    const notices: number[] = [];
    const failed = await downloadToFile(url, dest, {
      retry: { attempts: 3, baseDelayMs: 5 },
      onRetry: (n) => notices.push(n.attempt),
    }).catch((e: unknown) => e);
    expect(String(failed)).toContain("fetch failed");
    expect(new Set(notices)).toEqual(new Set([2, 3]));
  });

  it("removes the part and does not retry when the caller cancels", async () => {
    class Cancel extends Error {}
    const failed = await downloadToFile(url, dest, {
      ...FAST,
      onProgress: () => {
        throw new Cancel("stop");
      },
    }).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(Cancel);
    expect(server.seen).toHaveLength(1);
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(existsSync(`${dest}.part.meta`)).toBe(false);
  });

  it("stops waiting to retry when the caller cancels", async () => {
    server.script = [{ status: 503 }];
    const failed = await downloadToFile(url, dest, {
      retry: { baseDelayMs: 60_000, maxDelayMs: 60_000 },
      onRetry: () => {
        throw new Error("cancelled by the job");
      },
    }).catch((e: unknown) => e);
    expect((failed as Error).message).toBe("cancelled by the job");
    expect(server.seen).toHaveLength(1);
  });

  it("stops on an abort signal and removes the part", async () => {
    server.script = [{ stall: 100_000 }];
    const controller = new AbortController();
    const pending = downloadToFile(url, dest, {
      ...FAST,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    await expect(pending).rejects.toThrow();
    expect(server.seen).toHaveLength(1);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("fails and removes the file when the size is not the expected one", async () => {
    const failed = await downloadToFile(url, dest, { ...FAST, expectedBytes: 300_001 }).catch(
      (e: unknown) => e,
    );
    expect(classify(failed)).toBe("download_truncated");
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("lets SHA-256 be the judge of a resumed file", async () => {
    // A part whose bytes are not the file's, with a validator that still
    // matches: every header check passes and only the digest can tell.
    await writeFile(`${dest}.part`, randomBytes(100_000));
    await writeFile(
      `${dest}.part.meta`,
      JSON.stringify({ url, etag: '"v1"', lastModified: null, total: 300_000 }),
    );
    const failed = await downloadToFile(url, dest, { ...FAST, expectedSha256: sha(server.file) }).catch(
      (e: unknown) => e,
    );
    expect(server.seen[0]!.status).toBe(206);
    expect(failed).toBeInstanceOf(DownloadError);
    expect(classify(failed)).toBe("model_file_corrupt");
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);

    const result = await downloadToFile(url, dest, { ...FAST, expectedSha256: sha(server.file).toUpperCase() });
    expect(result.sha256).toBe(sha(server.file));
  });
});

describe("disk guard", () => {
  const GB = 1024 ** 3;

  it("passes when the file and the headroom fit", async () => {
    await expect(
      assertDiskSpace({ path: "/models", neededBytes: 4 * GB, headroomBytes: 2 * GB, freeBytes: async () => 6 * GB }),
    ).resolves.toBeUndefined();
  });

  it("names the three numbers and the path, and maps to the disk topic", async () => {
    const failed = await assertDiskSpace({
      path: "/data/models",
      neededBytes: 4 * GB,
      headroomBytes: MODEL_HEADROOM_BYTES,
      freeBytes: async () => 5 * GB,
    }).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(DownloadError);
    const message = (failed as Error).message;
    expect(message).toContain("/data/models");
    expect(message).toContain("4.0 GB still to download");
    expect(message).toContain("2.0 GB to keep free");
    expect(message).toContain("5.0 GB is free");
    expect(classify(failed)).toBe("disk_full");
  });

  it("counts what is already in the part", async () => {
    const check = { path: "/models", neededBytes: 4 * GB, headroomBytes: 2 * GB, freeBytes: async () => 3.5 * GB };
    await expect(assertDiskSpace(check)).rejects.toThrow("4.0 GB still to download");
    await expect(assertDiskSpace({ ...check, alreadyBytes: 3 * GB })).resolves.toBeUndefined();
    await expect(assertDiskSpace({ ...check, alreadyBytes: 2 * GB })).rejects.toThrow(
      "2.0 GB still to download",
    );
  });

  it("stays out of the way when the size or the free space is unknown", async () => {
    await expect(assertDiskSpace({ path: "/m", neededBytes: 0, freeBytes: async () => 0 })).resolves.toBeUndefined();
    await expect(assertDiskSpace({ path: "/m", neededBytes: GB, freeBytes: async () => null })).resolves.toBeUndefined();
  });

  it("stops a download before any request when the expected size will not fit", async () => {
    const asked: string[] = [];
    const failed = await downloadToFile(url, dest, {
      ...FAST,
      expectedBytes: 300_000,
      headroomBytes: 1_000_000,
      freeBytes: async (path) => {
        asked.push(path);
        return 1_200_000;
      },
    }).catch((e: unknown) => e);
    expect(classify(failed)).toBe("disk_full");
    expect((failed as Error).message).toContain(dir);
    expect(asked).toEqual([dir]);
    expect(server.seen).toHaveLength(0);
  });

  it("uses the size the server declares when the caller knows none, before writing", async () => {
    const failed = await downloadToFile(url, dest, { ...FAST, freeBytes: async () => 1_000 }).catch(
      (e: unknown) => e,
    );
    expect(classify(failed)).toBe("disk_full");
    expect(server.seen).toHaveLength(1);
    expect(existsSync(dest)).toBe(false);
  });

  it("asks only for what a kept part still lacks", async () => {
    server.script = [{ drop: 150_000 }];
    await downloadToFile(url, dest, { retry: { attempts: 1 }, expectedBytes: 300_000 }).catch(() => {});
    const kept = (await stat(`${dest}.part`)).size;
    expect(kept).toBeGreaterThan(0);

    // Room for the rest, not for the whole file again.
    const result = await downloadToFile(url, dest, {
      ...FAST,
      expectedBytes: 300_000,
      freeBytes: async () => 300_000 - kept,
    });
    expect(result).toMatchObject({ resumedFrom: kept, sha256: sha(server.file) });
  });
});

describe("progress line", () => {
  it("reports rate and time left once there is a second of data", () => {
    let now = 0;
    const rate = new TransferRate(8_000, () => now);
    const MB = 1024 ** 2;
    expect(rate.line(0, 100 * MB)).toBe("0 B of 100.0 MB");
    now = 500;
    expect(rate.line(5 * MB, 100 * MB)).toBe("5.0 MB of 100.0 MB");
    now = 2_000;
    expect(rate.line(20 * MB, 100 * MB)).toBe("20.0 MB of 100.0 MB · 10.0 MB/s · 8 s left");
  });

  it("does not count a kept part as speed", () => {
    let now = 0;
    const rate = new TransferRate(8_000, () => now);
    const MB = 1024 ** 2;
    rate.add(900 * MB); // resumed here
    now = 2_000;
    rate.add(902 * MB);
    expect(rate.bytesPerSecond()).toBe(MB);
  });

  it("forgets old samples and resets on a restart", () => {
    let now = 0;
    const rate = new TransferRate(4_000, () => now);
    for (let s = 0; s <= 10; s++) {
      now = s * 1000;
      rate.add(s < 5 ? s * 1000 : 5000 + (s - 5) * 10);
    }
    // The fast first half has left the window.
    expect(rate.bytesPerSecond()).toBeLessThan(300);
    now += 1000;
    rate.add(0);
    expect(rate.bytesPerSecond()).toBeNull();
  });

  it("formats durations coarsely", () => {
    expect(fmtDuration(0.2)).toBe("1 s");
    expect(fmtDuration(45)).toBe("45 s");
    expect(fmtDuration(200)).toBe("3 min");
    expect(fmtDuration(3600)).toBe("1 h");
    expect(fmtDuration(4800)).toBe("1 h 20 min");
  });

  it("reads Retry-After as seconds or a date", () => {
    expect(parseRetryAfter("120")).toBe(120_000);
    const now = Date.parse("Wed, 21 Oct 2026 07:28:00 GMT");
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});
