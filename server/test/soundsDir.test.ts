/**
 * The sounds folder, chosen independently of everything else.
 *
 * The setting is one string, but the thing that makes it safe is the move:
 * the database stores bare filenames and joins them onto whatever
 * `paths.sounds` currently is, so changing the folder without carrying the
 * files across would leave every row in the library pointing at nothing.
 * These cover that, plus the two conventions borrowed from
 * `audiocpp_models_dir` — "" means "back to the default", and the API always
 * answers with the path actually in force rather than a nullable override.
 */

import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";

let app: FastifyInstance;
let dataDir: string;
let elsewhere: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "konchi-sounds-dir-"));
  elsewhere = await mkdtemp(join(tmpdir(), "konchi-sounds-elsewhere-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
  await rm(elsewhere, { recursive: true, force: true });
});

async function patch(body: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: "/api/settings", payload: body });
}

/** Put a file in the library: on disk in the current sounds folder, and named
 *  by a row. A clone voice is the lightest row that owns a file there. */
async function libraryFile(name: string, body = "RIFFfake"): Promise<void> {
  await writeFile(join(app.konchi.config.paths.sounds, name), body, "utf-8");
  app.konchi.db.createVoice(
    { id: `v-${name}`, name, kind: "clone", created_at: new Date().toISOString() },
    name,
  );
}

describe("sounds folder", () => {
  it("defaults to the profile's own sounds/ and says so", async () => {
    const settings = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(settings.sounds_dir).toBe(join(dataDir, "sounds"));
    // The point of the setting: it is not the models folder, and moving one
    // must not move the other.
    expect(settings.audiocpp_models_dir).toBe(join(dataDir, "models", "audiocpp"));
  });

  it("writes new audio to the chosen folder and leaves the models folder alone", async () => {
    const before = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    const after = (await patch({ sounds_dir: elsewhere })).json();

    expect(after.sounds_dir).toBe(elsewhere);
    expect(after.audiocpp_models_dir).toBe(before.audiocpp_models_dir);
    expect(existsSync(elsewhere)).toBe(true);
  });

  it("carries the existing library across, because the database only stores names", async () => {
    const original = join(dataDir, "sounds", "abc.wav");
    await libraryFile("abc.wav");

    await patch({ sounds_dir: elsewhere });

    expect(existsSync(original)).toBe(false);
    expect(await readFile(join(elsewhere, "abc.wav"), "utf-8")).toBe("RIFFfake");
  });

  it("moves only what the library references, leaving everything else in the folder", async () => {
    await libraryFile("abc.wav");
    const stranger = join(dataDir, "sounds", "not-ours.txt");
    await writeFile(stranger, "keep me", "utf-8");

    await patch({ sounds_dir: elsewhere });

    expect(existsSync(join(elsewhere, "abc.wav"))).toBe(true);
    expect(existsSync(stranger)).toBe(true);
    expect(existsSync(join(elsewhere, "not-ours.txt"))).toBe(false);
  });

  it("never overwrites a same-named file already in the new folder", async () => {
    await libraryFile("abc.wav", "ours");
    await writeFile(join(elsewhere, "abc.wav"), "theirs", "utf-8");

    const res = await patch({ sounds_dir: elsewhere });

    // The change itself stands, but the clash is reported rather than hidden.
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toMatch(/already had a same-named file/);
    expect(await readFile(join(elsewhere, "abc.wav"), "utf-8")).toBe("theirs");
    expect(await readFile(join(dataDir, "sounds", "abc.wav"), "utf-8")).toBe("ours");
  });

  it("refuses a folder inside the current one, or one that contains it", async () => {
    const inside = await patch({ sounds_dir: join(dataDir, "sounds", "nested") });
    expect(inside.statusCode).toBe(400);
    const around = await patch({ sounds_dir: dataDir });
    expect(around.statusCode).toBe(400);

    const settings = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(settings.sounds_dir).toBe(join(dataDir, "sounds"));
  });

  it.runIf(process.platform === "win32")("refuses a network share", async () => {
    const res = await patch({ sounds_dir: "\\\\some-host\\share\\sounds" });
    expect(res.statusCode).toBe(400);
  });

  it("serves the moved file from its new home", async () => {
    await libraryFile("abc.wav");
    await patch({ sounds_dir: elsewhere });

    const res = await app.inject({ method: "GET", url: "/files/abc.wav" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("RIFFfake");
  });

  it("treats an empty string as 'back to the default', and moves the files home", async () => {
    await patch({ sounds_dir: elsewhere });
    await libraryFile("abc.wav");

    const back = (await patch({ sounds_dir: "" })).json();

    expect(back.sounds_dir).toBe(join(dataDir, "sounds"));
    expect(existsSync(join(dataDir, "sounds", "abc.wav"))).toBe(true);
    expect(existsSync(join(elsewhere, "abc.wav"))).toBe(false);
  });

  it("persists, so the next start writes to the same place", async () => {
    await patch({ sounds_dir: elsewhere });
    await app.close();

    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
    const settings = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(settings.sounds_dir).toBe(elsewhere);
  });

  it("never stores a blank path, so a reset reads as a genuine default", async () => {
    await patch({ sounds_dir: elsewhere });
    await patch({ sounds_dir: "   " });
    const raw = JSON.parse(await readFile(join(dataDir, "settings.json"), "utf-8"));
    expect(raw.sounds_dir).toBeNull();
  });

  it("refuses a path it cannot create rather than persisting one that is not there", async () => {
    // A file, not a directory — mkdir of a child of it cannot succeed on any
    // platform, which is what makes this a portable "unusable path".
    const blocker = join(elsewhere, "not-a-dir");
    await writeFile(blocker, "x", "utf-8");

    const res = await patch({ sounds_dir: join(blocker, "sounds") });
    expect(res.statusCode).toBe(400);

    const settings = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(settings.sounds_dir).toBe(join(dataDir, "sounds"));
  });
});
