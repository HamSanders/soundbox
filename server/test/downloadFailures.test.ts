import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import { CancelledJob, ModelError } from "../src/errors.js";
import { buildFailure } from "../src/failure.js";
import { AudioCppRuntime } from "../src/models/audiocppRuntime.js";
import { DOWNLOAD_FAILURES_FILE, DownloadFailureStore } from "../src/models/downloadFailures.js";
import type { ModelInfo } from "../src/schemas.js";

const MODEL = "audiocpp-stable-audio-3-sfx";
const CSRF = { "x-soundbox": "1" };
const NO_SPACE =
  "Not enough disk space at /data/models: 4.0 GB still to download, plus 2.0 GB to keep free, " +
  "and 5.0 GB is free.";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mirli-dlfail-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("DownloadFailureStore", () => {
  it("remembers a failure across instances and forgets it when cleared", () => {
    const path = join(dir, "models", DOWNLOAD_FAILURES_FILE);
    const store = new DownloadFailureStore(path);
    expect(store.get(MODEL)).toBeNull();

    const at = new Date("2026-11-22T10:00:00Z");
    store.record(MODEL, buildFailure(new Error(NO_SPACE), { stage: "downloading" }), at);

    const reopened = new DownloadFailureStore(path);
    expect(reopened.get(MODEL)).toMatchObject({
      topic: "disk_full",
      stage: "downloading",
      detail: NO_SPACE,
      at: "2026-11-22T10:00:00.000Z",
    });
    expect(reopened.get("another-model")).toBeNull();

    expect(reopened.clear(MODEL)).toBe(true);
    expect(reopened.clear(MODEL)).toBe(false);
    expect(new DownloadFailureStore(path).get(MODEL)).toBeNull();
  });

  it("reads a damaged file as empty and can still write", async () => {
    const path = join(dir, DOWNLOAD_FAILURES_FILE);
    await writeFile(path, "{ not json");
    const store = new DownloadFailureStore(path);
    expect(store.get(MODEL)).toBeNull();
    store.record(MODEL, buildFailure("boom"));
    expect(JSON.parse(await readFile(path, "utf8")).models[MODEL].title).toBe("boom");
  });

  it("drops entries that are not failures", async () => {
    const path = join(dir, DOWNLOAD_FAILURES_FILE);
    await writeFile(path, JSON.stringify({ version: 1, models: { a: { title: 3 }, b: null } }));
    const store = new DownloadFailureStore(path);
    expect(store.get("a")).toBeNull();
    expect(store.get("b")).toBeNull();
  });
});

describe("a model's last download failure", () => {
  let app: FastifyInstance;

  async function open(): Promise<FastifyInstance> {
    app = buildApp(new Config(dir), { serveUi: false });
    await app.ready();
    // The runtime check is not what is under test, and must not depend on
    // whether this machine has audio.cpp installed.
    vi.spyOn(app.soundbox.models.get(MODEL), "requireDeps").mockResolvedValue();
    return app;
  }

  async function runDownload(): Promise<string> {
    const res = await app.inject({ method: "POST", url: `/api/models/${MODEL}/download`, headers: CSRF });
    expect(res.statusCode, res.body).toBe(202);
    const id = res.json().job_id as string;
    await vi.waitFor(() =>
      expect(["done", "error", "cancelled"]).toContain(app.soundbox.jobs.get(id)?.status),
    );
    return id;
  }

  const model = async (): Promise<ModelInfo> =>
    (await app.inject({ method: "GET", url: `/api/models/${MODEL}` })).json();

  afterEach(async () => {
    await app.close();
  });

  it("is returned on the model record and survives a restart", async () => {
    await open();
    expect((await model()).download_failure ?? null).toBeNull();
    vi.spyOn(app.soundbox.models.get(MODEL), "download").mockRejectedValue(new ModelError(NO_SPACE));

    const jobId = await runDownload();
    expect(app.soundbox.jobs.get(jobId)?.status).toBe("error");
    const failed = await model();
    expect(failed.status).toBe("not_installed");
    expect(failed.download_failure).toMatchObject({ topic: "disk_full", detail: NO_SPACE, stage: "downloading" });
    expect(Date.parse(failed.download_failure!.at)).not.toBeNaN();
    const listed = (await app.inject({ method: "GET", url: "/api/models" })).json() as ModelInfo[];
    expect(listed.find((m) => m.id === MODEL)?.download_failure?.topic).toBe("disk_full");
    expect(listed.find((m) => m.id !== MODEL)?.download_failure ?? null).toBeNull();

    // A new server over the same data directory.
    await app.close();
    await open();
    expect((await model()).download_failure).toMatchObject({ topic: "disk_full", detail: NO_SPACE });
  });

  it("is cleared by a download that succeeds", async () => {
    await open();
    const download = vi.spyOn(app.soundbox.models.get(MODEL), "download");
    download.mockRejectedValueOnce(new ModelError("Download of https://x stalled — no data for 60s."));
    await runDownload();
    expect((await model()).download_failure?.topic).toBe("download_stalled");

    download.mockResolvedValueOnce();
    const jobId = await runDownload();
    expect(app.soundbox.jobs.get(jobId)?.status).toBe("done");
    expect((await model()).download_failure ?? null).toBeNull();
    expect(new DownloadFailureStore(join(dir, "models", DOWNLOAD_FAILURES_FILE)).get(MODEL)).toBeNull();
  });

  it("is not recorded for a cancelled download", async () => {
    await open();
    vi.spyOn(app.soundbox.models.get(MODEL), "download").mockRejectedValue(new CancelledJob());
    await runDownload();
    expect((await model()).download_failure ?? null).toBeNull();
    expect(existsSync(join(dir, "models", DOWNLOAD_FAILURES_FILE))).toBe(false);
  });

  it("can be dismissed", async () => {
    await open();
    vi.spyOn(app.soundbox.models.get(MODEL), "download").mockRejectedValue(new ModelError(NO_SPACE));
    await runDownload();

    const gone = await app.inject({
      method: "DELETE",
      url: `/api/models/${MODEL}/download-failure`,
      headers: CSRF,
    });
    expect(gone.statusCode).toBe(204);
    expect((await model()).download_failure ?? null).toBeNull();
    const unknown = await app.inject({
      method: "DELETE",
      url: "/api/models/no-such-model/download-failure",
      headers: CSRF,
    });
    expect(unknown.statusCode).toBe(404);
  });
});

describe("audio.cpp package install", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  });

  /** A stand-in for audio.cpp's install endpoints that reports one size. */
  async function runtime(totalBytes: number): Promise<{ rt: AudioCppRuntime; calls: string[] }> {
    const calls: string[] = [];
    server = createServer((req, res) => {
      calls.push(`${req.method} ${req.url?.split("?")[0]}`);
      req.resume();
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "pkg",
          state: "running",
          message: "",
          exit_code: -1,
          downloaded_bytes: 1024 ** 3,
          total_bytes: totalBytes,
          progress_percent: 10,
          started_at_ms: 1,
          finished_at_ms: 0,
        }),
      );
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing port");
    const rt = new AudioCppRuntime();
    // The private step every management call goes through. Stubbed there, so
    // no real audio.cpp is looked for or started.
    vi.spyOn(rt as unknown as { ensureServer: () => Promise<unknown> }, "ensureServer").mockResolvedValue({
      baseUrl: `http://127.0.0.1:${address.port}`,
    });
    return { rt, calls };
  }

  it("stops the install when the package will not fit", async () => {
    const GB = 1024 ** 3;
    const { rt, calls } = await runtime(5 * GB);
    rt.freeBytes = async () => 5 * GB;

    const failed = await rt.installPackage("pkg", "/data/models/audiocpp", "cpu").catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ModelError);
    const message = (failed as Error).message;
    // 5 GB package with 1 GB already there: 4 GB to come, 2 GB kept free.
    expect(message).toContain("/data/models/audiocpp");
    expect(message).toContain("4.0 GB still to download");
    expect(message).toContain("2.0 GB to keep free");
    expect(message).toContain("5.0 GB is free");
    expect(buildFailure(failed).topic).toBe("disk_full");
    expect(calls.at(-1)).toBe("POST /v1/ui/models/install/stop");
  });
});
