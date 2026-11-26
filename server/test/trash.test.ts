import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as dsp from "../src/audio/dsp.js";
import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import type { MirliService } from "../src/service.js";
import { purgeTrash } from "../src/trash.js";

/**
 * The trash: deleting a sound, a session or a book moves it there; it is
 * hidden everywhere, comes back as it was, and is deleted for good (files
 * too) after its days are up or when the trash is emptied.
 */

let app: FastifyInstance;
let svc: MirliService;
let dataDir: string;
let wav: Buffer;

const H = { "x-soundbox": "1" };

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-trash-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
  svc = (app as unknown as { soundbox: MirliService }).soundbox;
  const tmp = await mkdtemp(join(tmpdir(), "mirli-trash-wav-"));
  const path = join(tmp, "clip.wav");
  dsp.writeWav(path, [new Float32Array(4410)], 44100);
  wav = await readFile(path);
  await rm(tmp, { recursive: true, force: true });
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function upload(name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/sounds/upload?name=${encodeURIComponent(name)}`,
    headers: { "content-type": "audio/wav" },
    payload: wav,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

const listed = async () =>
  ((await app.inject({ method: "GET", url: "/api/sounds?limit=500" })).json().items as { id: string }[]).map((s) => s.id);
const trash = async () => (await app.inject({ method: "GET", url: "/api/trash" })).json() as {
  days: number;
  items: { kind: string; id: string; name: string; detail: string | null; purge_at: string; deleted_at: string }[];
};
const fileOf = (id: string) => join(svc.config.paths.sounds, svc.db.getFilename(id)!);

describe("the trash", () => {
  it("hides a deleted sound, keeps its file, and restores it", async () => {
    const id = await upload("Door slam");
    const file = fileOf(id);
    expect((await app.inject({ method: "DELETE", url: `/api/sounds/${id}`, headers: H })).statusCode).toBe(204);
    expect(await listed()).not.toContain(id);
    expect(existsSync(file)).toBe(true);
    // Still there by id, saying so: a timeline using it keeps working.
    expect((await app.inject({ method: "GET", url: `/api/sounds/${id}` })).json().deleted_at).toEqual(expect.any(String));
    const t = await trash();
    expect(t.days).toBe(30);
    const item = t.items.find((i) => i.id === id)!;
    expect(item).toMatchObject({ kind: "sound", name: "Door slam" });
    expect(Date.parse(item.purge_at) - Date.parse(item.deleted_at)).toBe(30 * 24 * 3600 * 1000);

    expect((await app.inject({ method: "POST", url: `/api/trash/sound/${id}/restore`, headers: H })).statusCode).toBe(200);
    expect(await listed()).toContain(id);
    expect((await trash()).items.some((i) => i.id === id)).toBe(false);
  });

  it("deletes for good with ?permanent=true, and from the trash, files included", async () => {
    const a = await upload("Gone now");
    const fa = fileOf(a);
    await app.inject({ method: "DELETE", url: `/api/sounds/${a}?permanent=true`, headers: H });
    expect(existsSync(fa)).toBe(false);
    expect((await app.inject({ method: "GET", url: `/api/sounds/${a}` })).statusCode).toBe(404);

    const b = await upload("Gone later");
    const fb = fileOf(b);
    await app.inject({ method: "DELETE", url: `/api/sounds/${b}`, headers: H });
    expect((await app.inject({ method: "DELETE", url: `/api/trash/sound/${b}`, headers: H })).statusCode).toBe(204);
    expect(existsSync(fb)).toBe(false);
  });

  it("never purges something that wasn't trashed", async () => {
    const id = await upload("Keep me");
    expect((await app.inject({ method: "DELETE", url: `/api/trash/sound/${id}`, headers: H })).statusCode).toBe(404);
    expect(await listed()).toContain(id);
  });

  it("trashes a session with its sounds, leaves its sounds out of lists, and starts a new session after", async () => {
    const session = svc.createSession("Rain takes");
    const ids = [await upload("Rain 1"), await upload("Rain 2")];
    for (const id of ids) svc.db.sqlite.prepare("UPDATE sounds SET session_id=? WHERE id=?").run(session.id, id);

    expect((await app.inject({ method: "DELETE", url: `/api/sessions/${session.id}`, headers: H })).statusCode).toBe(204);
    const sessions = (await app.inject({ method: "GET", url: "/api/sessions" })).json() as { id: string }[];
    expect(sessions.some((s) => s.id === session.id)).toBe(false);
    expect((await listed()).filter((id) => ids.includes(id))).toEqual([]);
    expect((await trash()).items.find((i) => i.id === session.id)).toMatchObject({ kind: "session", name: "Rain takes", detail: "2 sounds" });
    // A generation aimed at the trashed session gets a new one, not the hidden one.
    expect(svc.ensureSession({ session_id: session.id, title: "x" })).not.toBe(session.id);

    await app.inject({ method: "POST", url: `/api/trash/session/${session.id}/restore`, headers: H });
    expect((await listed()).filter((id) => ids.includes(id)).sort()).toEqual([...ids].sort());
  });

  it("trashes a book: off the shelf and the studio list, its takes out of the library, and back on restore", async () => {
    const book = (await app.inject({ method: "POST", url: "/api/audiobooks", headers: H, payload: { title: "Rain Book" } })).json();
    const storyId = book.chapters[0].story_id;
    const take = await upload("Paragraph take");
    svc.createSegment(storyId, {
      text: "Hello.",
      speaker: null,
      voice_id: null,
      kind: "line",
      duration_s: null,
      sound_id: take,
      track_index: 0,
      start_s: null,
      language: null,
    } as never);
    const stories = async () => ((await app.inject({ method: "GET", url: "/api/stories" })).json() as { id: string }[]).map((s) => s.id);
    const shelf = async () => ((await app.inject({ method: "GET", url: "/api/audiobooks" })).json() as { id: string }[]).map((b) => b.id);
    expect(await stories()).toContain(storyId);
    expect(await listed()).toContain(take);

    expect((await app.inject({ method: "DELETE", url: `/api/audiobooks/${book.id}`, headers: H })).statusCode).toBe(204);
    expect(await shelf()).not.toContain(book.id);
    expect(await stories()).not.toContain(storyId);
    expect(await listed()).not.toContain(take);
    expect((await trash()).items.find((i) => i.id === book.id)).toMatchObject({ kind: "book", name: "Rain Book", detail: "1 chapter" });

    await app.inject({ method: "POST", url: `/api/trash/book/${book.id}/restore`, headers: H });
    expect(await shelf()).toContain(book.id);
    expect(await stories()).toContain(storyId);
    expect(await listed()).toContain(take);
  });

  it("purges only what is past its days, unless emptied", async () => {
    const old = await upload("Old");
    const fresh = await upload("Fresh");
    for (const id of [old, fresh]) await app.inject({ method: "DELETE", url: `/api/sounds/${id}`, headers: H });
    svc.db.sqlite.prepare("UPDATE sounds SET deleted_at=? WHERE id=?").run(new Date(Date.now() - 31 * 864e5).toISOString(), old);

    expect(await purgeTrash(svc)).toBe(1);
    expect((await app.inject({ method: "GET", url: `/api/sounds/${old}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/sounds/${fresh}` })).statusCode).toBe(200);

    const emptied = (await app.inject({ method: "DELETE", url: "/api/trash", headers: H })).json();
    expect(emptied.deleted).toBeGreaterThanOrEqual(1);
    expect((await trash()).items).toEqual([]);
  });

  it("lets an agent delete to the trash, list it, and undo through restore_from_trash", async () => {
    const run = async (tool: string, args: Record<string, unknown>) =>
      (await app.inject({ method: "POST", url: "/api/agent/run", headers: H, payload: { tool, arguments: args } })).json() as {
        result: any;
        undo: { tool: string; arguments: Record<string, unknown> }[] | null;
      };
    const id = await upload("Agent deleted");
    const del = await run("soundbox.delete_sound", { sound_id: id });
    expect(del.result.trashed).toBe(id);
    expect(await listed()).not.toContain(id);
    const listedTrash = await run("soundbox.list_trash", {});
    expect(listedTrash.result.items.some((i: { id: string }) => i.id === id)).toBe(true);
    for (const c of del.undo!) await run(c.tool, c.arguments);
    expect(await listed()).toContain(id);

    const book = (await app.inject({ method: "POST", url: "/api/audiobooks", headers: H, payload: { title: "Agent Book" } })).json();
    const gone = await run("soundbox.delete_audiobook", { book_id: book.id });
    expect(gone.result).toMatchObject({ trashed: book.id, title: "Agent Book" });
    expect((await app.inject({ method: "GET", url: `/api/audiobooks/${book.id}` })).statusCode).toBe(404);
    for (const c of gone.undo!) await run(c.tool, c.arguments);
    expect((await app.inject({ method: "GET", url: `/api/audiobooks/${book.id}` })).statusCode).toBe(200);
  });
});
