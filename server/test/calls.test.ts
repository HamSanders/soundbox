/**
 * Live voice calls: the call registry, call tokens, the character store (Santa
 * built in) and the /api/calls + /api/characters routes, against a stand-in
 * voice worker.
 */

import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { CharacterStore, SANTA_PERSONA, SPOKEN, callPersona } from "../src/calls/characters.js";
import { CallBusyError, CallRegistry } from "../src/calls/registry.js";
import { signCallToken, verifyCallToken } from "../src/calls/token.js";
import { Config } from "../src/config.js";

const SECRET = "calls-test-secret";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const h = { "x-soundbox": "1" };

describe("call registry", () => {
  it("one call at a time; a lapsed call frees the slot and is counted to its last beat plus grace", () => {
    const clock = { t: 1000 };
    const reg = new CallRegistry({ heartbeatTimeoutS: 30, now: () => clock.t });
    const a = reg.create("voice", "santa");
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
    const t = signCallToken({ call: "c_1", aud: ["voice"] }, SECRET, 10, 1000);
    expect(verifyCallToken(t, SECRET, "voice", 1005).call).toBe("c_1");
    expect(() => verifyCallToken(t, SECRET, "tap", 1005)).toThrow(/audience/);
    expect(() => verifyCallToken(t, "other", "voice", 1005)).toThrow(/signature/);
    expect(() => verifyCallToken(t, SECRET, "voice", 1020)).toThrow(/expired/);
  });

  it("match the voice worker's implementation (live/voice/lib/call-token.mjs)", async () => {
    // @ts-expect-error plain JS module of the worker
    const worker = await import("../../live/voice/lib/call-token.mjs");
    const t = signCallToken({ call: "c_js", aud: ["voice"] }, SECRET, 60);
    expect(worker.verify(t, SECRET, { aud: "voice" }).call).toBe("c_js");
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

  it("creates a character without a portrait, finds it by name, and refuses bad ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mirli-chars-"));
    const store = new CharacterStore(dir);
    const c = await store.create({ name: "Dale" });
    expect(c.id).toMatch(/^dale-[0-9a-f]{6}$/);
    expect(c.persona).toMatch(/You are Dale/);
    expect(store.view(c).portrait_url).toBeNull();
    expect((await store.find("DALE")).id).toBe(c.id);
    expect((await store.find(c.id)).name).toBe("Dale");
    expect(() => store.folder("../x")).toThrow();
    await rm(dir, { recursive: true, force: true });
  });

  it("adds the spoken rule to a persona once", () => {
    expect(callPersona("You are X.")).toBe(`You are X.\n\n${SPOKEN}`);
    expect(callPersona(callPersona("You are X."))).toBe(`You are X.\n\n${SPOKEN}`);
  });
});

/** A stand-in voice worker: just the HTTP endpoints the server calls. */
function fakeWorker() {
  const seen: { path: string; method: string; auth?: string }[] = [];
  const srv = http.createServer((req, res) => {
    seen.push({ path: req.url!, method: req.method!, auth: req.headers.authorization });
    req.resume();
    const json = (b: unknown) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(b));
    if (req.url === "/voices") return json([{ id: "v1", name: "Voice one" }, { id: "v-santa", name: "Santa" }]);
    if (req.url === "/readyz") return json({ ready: true });
    if (req.url?.startsWith("/internal/calls/")) return json({ ended: true });
    res.writeHead(404).end();
  });
  return { srv, seen };
}

describe("/api/calls and /api/characters", () => {
  let app: FastifyInstance;
  let dataDir: string;
  const w = fakeWorker();

  beforeAll(async () => {
    await new Promise<void>((r) => w.srv.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(w.srv.address() as AddressInfo).port}`;
    Object.assign(process.env, { MIRLI_CALL_SECRET: SECRET, MIRLI_CALL_VOICE_URL: url });
    dataDir = await mkdtemp(join(tmpdir(), "mirli-calls-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    w.srv.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("reports the worker and its voices", async () => {
    expect((await app.inject({ method: "GET", url: "/api/calls/status" })).json()).toMatchObject({ voice: true, active_calls: 0 });
    expect((await app.inject({ method: "GET", url: "/api/calls/voices" })).json().voices).toHaveLength(2);
  });

  it("lists Santa and serves his portrait", async () => {
    const r = await app.inject({ method: "GET", url: "/api/characters" });
    const santa = r.json().characters[0];
    expect(santa).toMatchObject({ id: "santa", portrait_url: "/api/characters/santa/portrait" });
    const img = await app.inject({ method: "GET", url: santa.portrait_url });
    expect(img.headers["content-type"]).toBe("image/jpeg");
  });

  it("a call with Santa: signed voice token, his persona with the spoken rule, a voice named after him, one at a time, ended on the worker", async () => {
    const r = await app.inject({ method: "POST", url: "/api/calls", headers: h, payload: { character: "Santa" } });
    expect(r.statusCode, r.body).toBe(201);
    const g = r.json();
    expect(g).toMatchObject({ mode: "voice", character: "santa", name: "Santa", voice_id: "v-santa" });
    expect(g.ws_url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/ws$/);
    expect(g.persona).toBe(callPersona(SANTA_PERSONA));
    expect(verifyCallToken(g.token, SECRET, "voice").call).toBe(g.call_id);

    expect((await app.inject({ method: "POST", url: "/api/calls", headers: h, payload: {} })).statusCode).toBe(409);
    const beat = await app.inject({ method: "POST", url: `/api/calls/${g.call_id}/heartbeat`, headers: h });
    expect(beat.json(), beat.body).toHaveProperty("token");
    const end = await app.inject({ method: "DELETE", url: `/api/calls/${g.call_id}`, headers: h });
    expect(end.json()).toMatchObject({ call: g.call_id, character: "santa", reason: "hangup" });
    expect(w.seen.find((s) => s.path === `/internal/calls/${g.call_id}/end`)?.auth).toMatch(/^Bearer /);
    expect((await app.inject({ method: "DELETE", url: `/api/calls/${g.call_id}`, headers: h })).statusCode).toBe(404);
  });

  it("a call with no character is Mirli", async () => {
    const g = (await app.inject({ method: "POST", url: "/api/calls", headers: h, payload: {} })).json();
    expect(g).toMatchObject({ character: null, name: "Mirli", voice_id: null });
    expect(g.persona).toMatch(/You are Mirli/);
    await app.inject({ method: "DELETE", url: `/api/calls/${g.call_id}`, headers: h });
  });

  it("creates, edits and switches to a character mid-call; deletes it after", async () => {
    const created = await app.inject({ method: "POST", url: "/api/characters", headers: h, payload: { name: "Dale", persona: "You are Dale.", voice_id: "v1" } });
    expect(created.statusCode).toBe(201);
    const dale = created.json();
    expect(dale.portrait_url).toBeNull();

    const withPic = await app.inject({ method: "PATCH", url: `/api/characters/${dale.id}`, headers: h, payload: { image: `data:image/png;base64,${PNG.toString("base64")}` } });
    expect(withPic.json().portrait_url).toBe(`/api/characters/${dale.id}/portrait`);

    const g = (await app.inject({ method: "POST", url: "/api/calls", headers: h, payload: {} })).json();
    const sw = await app.inject({ method: "POST", url: `/api/calls/${g.call_id}/character`, headers: h, payload: { character: "dale" } });
    expect(sw.json()).toMatchObject({ character: dale.id, name: "Dale", voice_id: "v1", persona: callPersona("You are Dale.") });
    expect((await app.inject({ method: "DELETE", url: `/api/calls/${g.call_id}`, headers: h })).json().character).toBe(dale.id);

    expect((await app.inject({ method: "POST", url: "/api/calls", headers: h, payload: { character: "nobody" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/characters/${dale.id}`, headers: h })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: "/api/characters/santa", headers: h })).statusCode).toBe(409);
  });
});
