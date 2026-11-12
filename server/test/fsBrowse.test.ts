/**
 * `GET /api/fs/dirs` — the folder picker's view of the server's disk.
 *
 * The interesting cases are the ones a picker walks into constantly and a
 * naive listing gets wrong: a path that no longer exists, a folder full of
 * files and no subfolders, and the top of the tree, where "up" has to stop.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, parse, sep } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";

let app: FastifyInstance;
let dataDir: string;
let playground: string;

async function browse(path?: string) {
  const url = path === undefined ? "/api/fs/dirs" : `/api/fs/dirs?path=${encodeURIComponent(path)}`;
  return app.inject({ method: "GET", url });
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "konchi-fs-test-"));
  playground = await mkdtemp(join(tmpdir(), "konchi-fs-walk-"));
  await mkdir(join(playground, "renders"));
  await mkdir(join(playground, "Ambience"));
  await writeFile(join(playground, "notes.txt"), "not a folder", "utf-8");
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
  await rm(playground, { recursive: true, force: true });
});

describe("browsing folders", () => {
  it("lists subfolders and never files", async () => {
    const body = (await browse(playground)).json();
    expect(body.path).toBe(playground);
    expect(body.entries.map((e: { name: string }) => e.name)).toEqual(["Ambience", "renders"]);
  });

  it("hands back absolute paths, so the picker never has to join anything", async () => {
    const body = (await browse(playground)).json();
    const renders = body.entries.find((e: { name: string }) => e.name === "renders");
    expect(renders.path).toBe(join(playground, "renders"));
    expect(body.separator).toBe(sep);
  });

  it("walks up to the nearest folder that still exists", async () => {
    const gone = join(playground, "deleted", "long", "ago");
    const body = (await browse(gone)).json();
    // Not an error and not empty — the picker lands somewhere real.
    expect(body.path).toBe(playground);
  });

  it("starts at the home directory when asked for nothing", async () => {
    const body = (await browse()).json();
    expect(body.path).toBe(body.home);
  });

  it("stops at the top, so the picker's Up button has an end", async () => {
    const root = parse(playground).root;
    const body = (await browse(root)).json();
    expect(body.path).toBe(root);
    expect(body.parent).toBeNull();
  });

  it("offers a root to start from, which on Windows is how you change drive", async () => {
    const body = (await browse(playground)).json();
    expect(body.roots.length).toBeGreaterThan(0);
    expect(body.roots.map((r: { path: string }) => r.path)).toContain(parse(playground).root);
  });

  it("points parent at one level up", async () => {
    const body = (await browse(join(playground, "renders"))).json();
    expect(body.parent).toBe(playground);
    expect(dirname(body.path)).toBe(playground);
  });

  it("refuses a file, which is the one thing a folder picker must not accept", async () => {
    const res = await browse(join(playground, "notes.txt"));
    expect(res.statusCode).toBe(400);
  });

  // Merely stat-ing a UNC path makes Windows connect to that host with the
  // user's credentials, so these never reach the filesystem.
  it.runIf(process.platform === "win32")("refuses network paths in either slash style", async () => {
    expect((await browse("\\\\attacker.example\\share")).statusCode).toBe(400);
    expect((await browse("//attacker.example/share")).statusCode).toBe(400);
  });
});
