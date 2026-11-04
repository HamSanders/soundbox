/**
 * The release-hardening fixes, each pinned to the failure it closes:
 *
 *   - an engine install whose `version` (or whose release response) could
 *     walk out of the intended GitHub repo or the install directory;
 *   - an engine archive installed with nothing to verify it against;
 *   - origins trusted because they were "on localhost", whatever they were;
 *   - downloads held whole in memory, and ones that stall forever;
 *   - a CLI child that goes silent and so never notices it was cancelled;
 *   - MCP sessions that are never DELETEd and so never go away.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import { DownloadError, downloadToFile } from "../src/download.js";
import { CancelledJob, ModelError } from "../src/errors.js";
import { McpEndpoint, isOriginAllowed } from "../src/mcp/server.js";
import { runChild } from "../src/models/audiocpp.js";
import {
  ALLOW_UNVERIFIED_ENV,
  checkRelease,
  isRepoAssetUrl,
  isSafeReleaseTag,
  releaseApiUrl,
  verifyAsset,
} from "../src/models/releaseInstall.js";
import { isTrustedOrigin } from "../src/origins.js";

const REPO = "ggml-org/llama.cpp";
const err = (m: string) => new Error(m);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("release tags", () => {
  it("accepts real tag shapes", () => {
    for (const tag of ["latest", "b4831", "v1.2.3", "master-827-97d2990", "v0.1.0-rc.1"]) {
      expect(isSafeReleaseTag(tag)).toBe(true);
    }
  });

  it("refuses anything that could become a path", () => {
    for (const tag of ["../../evil/repo/releases/latest", "a/b", "a\\b", "..", "v1..2", "", ".x"]) {
      expect(isSafeReleaseTag(tag)).toBe(false);
    }
    expect(() => releaseApiUrl(REPO, "../../other/repo", err)).toThrow(/not a release tag/);
  });

  it("builds the API URL only for this installer's repo", () => {
    expect(releaseApiUrl(REPO, "b4831", err)).toBe(
      "https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b4831",
    );
  });
});

describe("checkRelease", () => {
  const asset = (name: string, url = `https://github.com/${REPO}/releases/download/b1/${name}`) => ({
    name,
    browser_download_url: url,
  });

  it("returns the vetted tag for a well-formed release", () => {
    expect(checkRelease(REPO, { tag_name: "b1", assets: [asset("x.zip")] }, err)).toBe("b1");
  });

  it("refuses a tag that would escape the install directory", () => {
    expect(() => checkRelease(REPO, { tag_name: "../../bin", assets: [] }, err)).toThrow();
    expect(() => checkRelease(REPO, { assets: [] }, err)).toThrow();
  });

  it("refuses an asset hosted anywhere but this repo's release downloads", () => {
    for (const url of [
      "https://github.com/someone-else/llama.cpp/releases/download/b1/x.zip",
      "https://evil.example/ggml-org/llama.cpp/releases/download/b1/x.zip",
      "http://github.com/ggml-org/llama.cpp/releases/download/b1/x.zip",
      "https://github.com/ggml-org/llama.cpp/releases/download/../../../x/y.zip",
    ]) {
      expect(isRepoAssetUrl(REPO, url)).toBe(false);
      expect(() => checkRelease(REPO, { tag_name: "b1", assets: [asset("x.zip", url)] }, err)).toThrow();
    }
  });

  it("refuses an asset name that is a path", () => {
    expect(() => checkRelease(REPO, { tag_name: "b1", assets: [asset("../x.zip")] }, err)).toThrow();
  });
});

describe("verifyAsset", () => {
  afterEach(() => {
    delete process.env[ALLOW_UNVERIFIED_ENV];
  });
  const base = { name: "x.zip", browser_download_url: "" };

  it("accepts a matching GitHub digest or manifest entry", () => {
    expect(() =>
      verifyAsset(REPO, { ...base, digest: `sha256:${sha("hi")}` }, sha("hi"), null, err),
    ).not.toThrow();
    expect(() =>
      verifyAsset(REPO, base, sha("hi"), `${sha("hi")}  x.zip\n`, err),
    ).not.toThrow();
  });

  it("throws on a mismatch from either source", () => {
    expect(() =>
      verifyAsset(REPO, { ...base, digest: `sha256:${sha("no")}` }, sha("hi"), null, err),
    ).toThrow(/mismatch/i);
    expect(() => verifyAsset(REPO, base, sha("hi"), `${sha("no")}  x.zip`, err)).toThrow(
      /mismatch/i,
    );
  });

  it("refuses to install when nothing covers the asset", () => {
    expect(() => verifyAsset(REPO, base, sha("hi"), "abc  other.zip", err)).toThrow(
      new RegExp(ALLOW_UNVERIFIED_ENV),
    );
    expect(() => verifyAsset(REPO, base, sha("hi"), null, err)).toThrow();
  });

  it("installs unverified only when explicitly opted in", () => {
    process.env[ALLOW_UNVERIFIED_ENV] = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => verifyAsset(REPO, base, sha("hi"), null, err)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("trusted origins", () => {
  it("trusts the server's own origin and the Vite dev server", () => {
    expect(isTrustedOrigin("http://127.0.0.1:17494", "127.0.0.1:17494")).toBe(true);
    expect(isTrustedOrigin("http://localhost:5174")).toBe(true);
    expect(isTrustedOrigin("http://127.0.0.1:5174")).toBe(true);
  });

  it("no longer trusts any page just because it is on localhost", () => {
    expect(isTrustedOrigin("http://localhost:3000", "127.0.0.1:17494")).toBe(false);
    expect(isTrustedOrigin("http://127.0.0.1:8080", "127.0.0.1:17494")).toBe(false);
    expect(isTrustedOrigin("null")).toBe(false);
  });

  it("matches KONCHI_ALLOWED_HOSTS on the parsed host, not a suffix", () => {
    process.env.KONCHI_ALLOWED_HOSTS = "example.com";
    try {
      expect(isOriginAllowed("https://example.com")).toBe(true);
      expect(isOriginAllowed("https://evil-example.com")).toBe(false);
      expect(isOriginAllowed("https://example.com.evil.net")).toBe(false);
    } finally {
      delete process.env.KONCHI_ALLOWED_HOSTS;
    }
  });

  it("holds a host:port entry in KONCHI_ALLOWED_HOSTS to that port", () => {
    process.env.KONCHI_ALLOWED_HOSTS = "example.com:8443";
    try {
      expect(isTrustedOrigin("https://example.com:8443")).toBe(true);
      expect(isTrustedOrigin("https://example.com")).toBe(false);
    } finally {
      delete process.env.KONCHI_ALLOWED_HOSTS;
    }
  });
});

describe("routes", () => {
  let app: FastifyInstance;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "konchi-hardening-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("only sends CORS headers to trusted origins", async () => {
    const ok = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:5174" },
    });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5174");
    const no = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:3000" },
    });
    expect(no.headers["access-control-allow-origin"]).toBeUndefined();
  });

  for (const url of [
    "/api/llm/engine/install",
    "/api/image/engine/install",
    "/api/models/audiocpp/engine/install",
  ]) {
    it(`${url} validates the version before it reaches a URL`, async () => {
      const res = await app.inject({
        method: "POST",
        url,
        payload: { version: "../../someone/else/releases/latest" },
      });
      expect(res.statusCode).toBe(422);
    });
  }

  it("refuses an unknown upload source rather than storing it as the model", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sounds/upload?source=whatever",
      headers: { "content-type": "audio/wav" },
      payload: Buffer.from("RIFF"),
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("downloadToFile", () => {
  let server: Server;
  let base: string;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "konchi-download-"));
    server = createServer((req, res) => {
      if (req.url === "/ok") {
        res.writeHead(200, { "content-length": "5" });
        res.end("hello");
      } else if (req.url === "/stall") {
        res.writeHead(200, { "content-length": "100" });
        res.write("partial"); // and then nothing, ever
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  it("streams to disk, reports progress and hashes on the way", async () => {
    const dest = join(dir, "a", "ok.bin");
    const seen: number[] = [];
    const result = await downloadToFile(`${base}/ok`, dest, {
      expectedBytes: 5,
      onProgress: (done) => seen.push(done),
    });
    expect(await readFile(dest, "utf-8")).toBe("hello");
    expect(result).toEqual({ bytes: 5, sha256: sha("hello") });
    expect(seen.at(-1)).toBe(5);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("refuses a file of the wrong size and leaves nothing behind", async () => {
    const dest = join(dir, "wrong.bin");
    await expect(downloadToFile(`${base}/ok`, dest, { expectedBytes: 6 })).rejects.toThrow(
      DownloadError,
    );
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("gives up on a server that stops sending", async () => {
    const dest = join(dir, "stall.bin");
    await expect(
      downloadToFile(`${base}/stall`, dest, { idleTimeoutMs: 300 }),
    ).rejects.toThrow(/stalled/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("surfaces an HTTP error with its status", async () => {
    await expect(downloadToFile(`${base}/missing`, join(dir, "m.bin"))).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("runChild watchdog", () => {
  // A child that prints nothing at all — the case a line-driven check never
  // gets a turn on.
  const silent = [process.execPath, "-e", "setInterval(() => {}, 1000)"];

  it("kills a silent child when the job is cancelled", async () => {
    const handle = { cancelled: false };
    const progress = Object.assign(() => {}, { handle });
    const run = runChild(silent, progress, 60);
    setTimeout(() => (handle.cancelled = true), 200);
    await expect(run).rejects.toBeInstanceOf(CancelledJob);
  });

  it("kills a silent child at its deadline", async () => {
    await expect(runChild(silent, undefined, 1)).rejects.toBeInstanceOf(ModelError);
  });
});

describe("MCP session sweep", () => {
  it("closes sessions idle past the TTL and keeps busy ones", async () => {
    const endpoint = new McpEndpoint(() => {
      throw new Error("unused");
    }, 1000);
    const closed: string[] = [];
    const fake = (id: string, lastSeen: number, inFlight: number) => ({
      server: {},
      transport: { close: async () => void closed.push(id) },
      lastSeen,
      inFlight,
    });
    const sessions = (endpoint as unknown as { sessions: Map<string, unknown> }).sessions;
    const now = Date.now();
    sessions.set("idle", fake("idle", now - 5000, 0));
    sessions.set("busy", fake("busy", now - 5000, 1));
    sessions.set("fresh", fake("fresh", now, 0));

    expect(await endpoint.sweep(now)).toBe(1);
    expect(closed).toEqual(["idle"]);
    expect(endpoint.sessionCount).toBe(2);
    await endpoint.close();
  });
});
