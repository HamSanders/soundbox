/**
 * Calls: the call registry, call tokens, the character store (Santa built in)
 * and the /api/calls + /api/characters routes, against stand-in workers.
 */

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { CharacterStore, SANTA_PERSONA } from "../src/calls/characters.js";
import { packSpec } from "../src/calls/packs.js";
import { CallBusyError, CallRegistry } from "../src/calls/registry.js";
import { signCallToken, verifyCallToken } from "../src/calls/token.js";
import { Config } from "../src/config.js";

const SECRET = "calls-test-secret";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");

describe("call registry", () => {
  it("one call at a time; a lapsed call frees the slot and is counted to its last beat plus grace", () => {
    const clock = { t: 1000 };
    const reg = new CallRegistry({ heartbeatTimeoutS: 30, now: () => clock.t });
    const a = reg.create("video", "santa");
    expect(() => reg.create("voice", null)).toThrow(CallBusyError);
    clock.t += 20;
    reg.heartbeat(a.id);
    clock.t += 100;
    expect(reg.create("voice", null).id).toMatch(/^c_/);
    expect(reg.ledger()[0]).toMatchObject({ call: a.id, reason: "lapsed", seconds: 50 });
  });
});

describe("call tokens", () => {
  it("verify, expire, and refuse a wrong audience or secret", () => {
    const t = signCallToken({ call: "c_1", aud: ["face"] }, SECRET, 10, 1000);
    expect(verifyCallToken(t, SECRET, "face", 1005).call).toBe("c_1");
    expect(() => verifyCallToken(t, SECRET, "voice", 1005)).toThrow(/audience/);
    expect(() => verifyCallToken(t, "other", "face", 1005)).toThrow(/signature/);
    expect(() => verifyCallToken(t, SECRET, "face", 1020)).toThrow(/expired/);
  });

  it("match the face worker's Python implementation", () => {
    const faceDir = resolve(__dirname, "..", "..", "spikes", "realtime-face");
    const t = signCallToken({ call: "c_py", aud: ["face"] }, SECRET, 60);
    const out = execFileSync(process.env.PYTHON || "python", ["-c",
      `import sys; sys.path.insert(0, ${JSON.stringify(faceDir)}); import call_token as c; print(c.verify(${JSON.stringify(t)}, ${JSON.stringify(SECRET)}, aud="face")["call"])`,
    ], { encoding: "utf8" }).trim();
    expect(out).toBe("c_py");
  });
});

describe("character store", () => {
  it("has Santa built in, with his persona and portrait, and can't delete him", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mirli-chars-"));
    const store = new CharacterStore(dir);
    const list = await store.list();
    expect(list[0]).toMatchObject({ id: "santa", name: "Santa", builtin: true });
    expect(list[0]!.persona).toBe(SANTA_PERSONA);
    expect(store.portraitPath("santa")).toMatch(/portrait\.jpg$/);
    await expect(store.remove("santa")).rejects.toThrow(/Built-in/);
    await rm(dir, { recursive: true, force: true });
  });

  it("finds a pack copied into the folder, and refuses paths that escape it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mirli-chars-"));
    const store = new CharacterStore(dir);
    const c = await store.create({ name: "Rosa", portrait: { bytes: PNG, ext: "png" } });
    expect(c.id).toMatch(/^rosa-[0-9a-f]{6}$/);
    expect(c.persona).toMatch(/You are Rosa/);
    await mkdir(join(store.folder(c.id), "pack"), { recursive: true });
    await writeFile(join(store.folder(c.id), "pack", "manifest.json"), JSON.stringify({ poses: {}, clips: [] }));
    expect((await store.get(c.id)).pack.status).toBe("ready");
    expect(() => store.packFile(c.id, "../character.json")).toThrow();
    expect(() => store.folder("../x")).toThrow();
    await rm(dir, { recursive: true, force: true });
  });

  it("builds an avatar-creator spec from a character", async () => {
    const spec = packSpec({ id: "rosa-1", name: "Rosa", persona: "p", voice_id: null, builtin: false, created_at: "", pack: { status: "none", provider: null, clips: 0, error: null, progress: null } }, "portrait.png");
    expect(spec.portrait.image).toBe("portrait.png");
    expect(spec.poses.talk.edit).toBeNull();
    expect(spec.clips.every((c) => spec.poses[c.from as keyof typeof spec.poses] && spec.poses[c.to as keyof typeof spec.poses])).toBe(true);
    expect(spec.clips.some((c) => c.kind === "reaction" && (c as { tags?: string[] }).tags?.includes("thinking"))).toBe(true);
  });
});

/** Stand-in voice and face workers: just the HTTP endpoints the server calls. */
function fakeWorkers() {
  const seen: { path: string; method: string; auth?: string; crop?: string }[] = [];
  const srv = http.createServer((req, res) => {
    seen.push({ path: req.url!, method: req.method!, auth: req.headers.authorization, crop: req.headers["x-crop"] as string | undefined });
    req.resume();
    const json = (b: unknown) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(b));
    if (req.url === "/voices") return json([{ id: "v1", name: "Voice one" }, { id: "v-santa", name: "Santa" }]);
    if (req.url === "/stats") return json({ engine: "fake", ready: true });
    if (req.url === "/faces" && req.method === "POST") return json({ id: "santa-abc" });
    if (req.url === "/face") return json({ current: "santa-abc" });
    if (req.url === "/engine") return json({ current: "musetalk", switching: null, available: [{ id: "musetalk", name: "MuseTalk 1.5", installed: true }, { id: "lite", name: "x", installed: true }] });
    if (req.url?.startsWith("/internal/calls/")) return json({ ended: true });
    res.writeHead(404).end();
  });
  return { srv, seen };
}

describe("/api/calls and /api/characters", () => {
  let app: FastifyInstance;
  let dataDir: string;
  const w = fakeWorkers();

  beforeAll(async () => {
    await new Promise<void>((r) => w.srv.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(w.srv.address() as AddressInfo).port}`;
    Object.assign(process.env, { MIRLI_CALL_SECRET: SECRET, MIRLI_CALL_VOICE_URL: url, MIRLI_CALL_FACE_URL: url });
    dataDir = await mkdtemp(join(tmpdir(), "mirli-calls-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    w.srv.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("lists Santa and serves his portrait", async () => {
    const r = await app.inject({ method: "GET", url: "/api/characters" });
    const santa = r.json().characters[0];
    expect(santa).toMatchObject({ id: "santa", portrait_url: "/api/characters/santa/portrait", pack_url: null });
    const img = await app.inject({ method: "GET", url: santa.portrait_url });
    expect(img.headers["content-type"]).toBe("image/jpeg");
  });

  it("a video call with Santa: puts his portrait on the face, hands out signed socket URLs, and ends on both workers", async () => {
    const r = await app.inject({ method: "POST", url: "/api/calls", payload: { mode: "video", character: "santa" } });
    expect(r.statusCode).toBe(201);
    const g = r.json();
    expect(g.ws_url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/ws$/);
    expect(g.face_ws_url).toMatch(/\/ws$/);
    expect(g.persona).toBe(SANTA_PERSONA);
    expect(g.voice_id).toBe("v-santa"); // built-in Santa picks up a voice called "Santa"
    expect(verifyCallToken(g.token, SECRET, "face").call).toBe(g.call_id);
    expect(w.seen.some((s) => s.path === "/faces" && s.method === "POST" && s.auth?.startsWith("Bearer "))).toBe(true);

    expect((await app.inject({ method: "POST", url: "/api/calls", payload: { mode: "voice" } })).statusCode).toBe(409);
    const beat = await app.inject({ method: "POST", url: `/api/calls/${g.call_id}/heartbeat`, headers: { "x-soundbox": "1" } });
    expect(beat.json(), beat.body).toHaveProperty("token");
    const end = await app.inject({ method: "DELETE", url: `/api/calls/${g.call_id}`, headers: { "x-soundbox": "1" } });
    expect(end.json()).toMatchObject({ call: g.call_id, character: "santa", reason: "hangup" });
    expect(w.seen.filter((s) => s.path === `/internal/calls/${g.call_id}/end`)).toHaveLength(2);
    expect((await app.inject({ method: "DELETE", url: `/api/calls/${g.call_id}`, headers: { "x-soundbox": "1" } })).statusCode).toBe(404);
  });

  it("creates a character from an upload, calls it by voice with its persona, and uses a pack's talk-still crop for video", async () => {
    const created = await app.inject({ method: "POST", url: "/api/characters", payload: {
      name: "Rosa", persona: "You are Rosa.", voice_id: "v1", image: `data:image/png;base64,${PNG.toString("base64")}`,
    } });
    expect(created.statusCode).toBe(201);
    const rosa = created.json();
    const v = (await app.inject({ method: "POST", url: "/api/calls", payload: { mode: "voice", character: rosa.id } })).json();
    expect(v).toMatchObject({ face_ws_url: null, persona: "You are Rosa.", voice_id: "v1" });
    await app.inject({ method: "DELETE", url: `/api/calls/${v.call_id}`, headers: { "x-soundbox": "1" } });

    const folder = join(dataDir, "characters", rosa.id, "pack");
    await mkdir(join(folder, "stills"), { recursive: true });
    await writeFile(join(folder, "stills", "talk.png"), PNG);
    await writeFile(join(folder, "manifest.json"), JSON.stringify({ talkPose: "talk", poses: { talk: { still: "stills/talk.png", faceBox: { x: 10, y: 20, size: 300 } } }, clips: [] }));
    const got = (await app.inject({ method: "GET", url: `/api/characters/${rosa.id}` })).json();
    expect(got.pack.status).toBe("ready");
    expect(got.pack_url).toBe(`/api/characters/${rosa.id}/pack/manifest.json`);
    const vid = (await app.inject({ method: "POST", url: "/api/calls", payload: { mode: "video", character: rosa.id } })).json();
    expect(w.seen.filter((s) => s.path === "/faces").pop()?.crop).toBe("10,20,300");
    await app.inject({ method: "DELETE", url: `/api/calls/${vid.call_id}`, headers: { "x-soundbox": "1" } });
    expect((await app.inject({ method: "GET", url: `/api/characters/${rosa.id}/pack/..%2Fcharacter.json` })).statusCode).toBe(404);
  });

  it("refuses cloud pack rendering without spending, and says when ComfyUI isn't there", async () => {
    const c = await app.inject({ method: "POST", url: "/api/characters/santa/pack", payload: { provider: "cloud" } });
    expect(c.statusCode).toBe(501);
    const l = await app.inject({ method: "POST", url: "/api/characters/santa/pack", payload: { provider: "local", comfy_url: "http://127.0.0.1:9" } });
    expect(l.statusCode).toBe(503);
    expect(l.json().error.message).toMatch(/ComfyUI/);
  });

  it("hides the face model alias", async () => {
    const m = (await app.inject({ method: "GET", url: "/api/calls/face-models" })).json();
    expect(m.available.map((x: { id: string }) => x.id)).toEqual(["musetalk"]);
  });
});
