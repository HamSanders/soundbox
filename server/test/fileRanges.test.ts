/**
 * `/files/{name}` answers byte-range requests. A player can only seek in a
 * file whose server does: without `Accept-Ranges` and 206 replies, Chromium
 * (and so the desktop app's WebView2) marks the audio unseekable and every
 * scrub of the player's timeline snaps back.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import { parseRange } from "../src/routes/files.js";

let app: FastifyInstance;
let dataDir: string;
const BODY = "0123456789abcdefghij"; // 20 bytes

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-file-ranges-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
  await writeFile(join(app.soundbox.config.paths.sounds, "take.wav"), BODY, "utf-8");
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

const get = (range?: string) =>
  app.inject({ method: "GET", url: "/files/take.wav", headers: range ? { range } : {} });

describe("GET /files ranges", () => {
  it("says it takes ranges, and sends the whole file without one", async () => {
    const r = await get();
    expect(r.statusCode).toBe(200);
    expect(r.headers["accept-ranges"]).toBe("bytes");
    expect(r.headers["content-length"]).toBe("20");
    expect(r.body).toBe(BODY);
  });

  it("sends the asked-for bytes as a 206", async () => {
    const r = await get("bytes=5-9");
    expect(r.statusCode).toBe(206);
    expect(r.headers["content-range"]).toBe("bytes 5-9/20");
    expect(r.headers["content-length"]).toBe("5");
    expect(r.body).toBe("56789");
  });

  it("handles an open end and a suffix", async () => {
    const open = await get("bytes=15-");
    expect(open.statusCode).toBe(206);
    expect(open.body).toBe("fghij");
    const suffix = await get("bytes=-3");
    expect(suffix.headers["content-range"]).toBe("bytes 17-19/20");
    expect(suffix.body).toBe("hij");
  });

  it("clamps an end past the file", async () => {
    const r = await get("bytes=18-999");
    expect(r.headers["content-range"]).toBe("bytes 18-19/20");
    expect(r.body).toBe("ij");
  });

  it("refuses a range that starts past the end", async () => {
    const r = await get("bytes=20-");
    expect(r.statusCode).toBe(416);
    expect(r.headers["content-range"]).toBe("bytes */20");
  });

  it("ignores ranges it doesn't serve and sends the whole file", async () => {
    for (const h of ["bytes=0-1,5-6", "items=0-1", "bytes=-", "garbage"]) {
      const r = await get(h);
      expect(r.statusCode, h).toBe(200);
      expect(r.body, h).toBe(BODY);
    }
  });
});

describe("parseRange", () => {
  it("reads the forms a browser sends", () => {
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=5-2", 100)).toBe("unsatisfiable");
    expect(parseRange(undefined, 100)).toBeNull();
  });
});
