/**
 * Live voice calls with characters: the Call API, served by the Mirli server.
 * The app's Calls page and integrations (the Discord bot) both use it; the
 * contract is documented in live/README.md.
 *
 *   POST   /api/calls                     { character? } -> CallGrant
 *   POST   /api/calls/:id/heartbeat       -> { expires, token }
 *   POST   /api/calls/:id/character       { character } -> { character, name, persona, voice_id }
 *   DELETE /api/calls/:id                 -> ledger row
 *   GET    /api/calls/status | voices | history
 *
 *   GET|POST /api/characters, GET|PATCH|DELETE /api/characters/:id,
 *   GET /api/characters/:id/portrait
 *
 * `character` may be an id or a name. Errors are `{ error: { code, message } }`.
 */

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import type { FastifyInstance, FastifyReply } from "fastify";

import { CharacterNotFound, CharacterStore, MIRLI_PERSONA, callPersona, type Character, type Portrait } from "../calls/characters.js";
import { CallBusyError, CallNotFoundError, CallRegistry } from "../calls/registry.js";
import { callSecret, signCallToken } from "../calls/token.js";
import { CallWorkers, WorkerError, workerConfigFromEnv } from "../calls/workers.js";
import type { MirliService } from "../service.js";

const TOKEN_TTL_S = 120;
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

export interface CallsDeps {
  store?: CharacterStore;
  workers?: CallWorkers;
  registry?: CallRegistry;
  heartbeatS?: number;
  secret?: string;
}

const fail = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });

/** `data:image/png;base64,...` -> bytes. */
function decodeImage(dataUrl: unknown): Portrait | null {
  if (typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!m) return null;
  return { bytes: Buffer.from(m[2]!, "base64"), ext: m[1] === "png" ? "png" : "jpg" };
}

export function registerCalls(app: FastifyInstance, svc: MirliService, deps: CallsDeps = {}): void {
  const secret = deps.secret ?? callSecret();
  const store = deps.store ?? new CharacterStore(svc.config.paths.root);
  const workers = deps.workers ?? new CallWorkers(workerConfigFromEnv(secret));
  const hb = deps.heartbeatS ?? Number(process.env.MIRLI_CALL_HEARTBEAT_S || 10);
  const registry = deps.registry ?? new CallRegistry({ heartbeatTimeoutS: hb * 3 });
  const ws = (u: string) => u.replace(/^http/, "ws");
  const voiceToken = (call: string) => signCallToken({ call, aud: ["voice"], mode: "voice" }, secret, TOKEN_TTL_S);

  const reaper = setInterval(() => { for (const row of registry.reap()) void workers.end(row.call); }, 5000);
  reaper.unref();
  app.addHook("onClose", async () => clearInterval(reaper));

  /** A character with no voice picked uses a saved voice of the same name, if there is one (a "Santa" clone). */
  async function voiceFor(c: Character | null): Promise<string | null> {
    if (!c) return null;
    if (c.voice_id) return c.voice_id;
    try {
      return (await workers.voices()).find((v) => v.name.toLowerCase() === c.name.toLowerCase())?.id ?? null;
    } catch {
      return null;
    }
  }

  const handle = (fn: (req: any, reply: FastifyReply) => Promise<unknown>) => async (req: any, reply: FastifyReply) => {
    try {
      return await fn(req, reply);
    } catch (e) {
      if (e instanceof CallBusyError) return fail(reply, 409, "busy", e.message);
      if (e instanceof CallNotFoundError || e instanceof CharacterNotFound) return fail(reply, 404, "not_found", e.message);
      if (e instanceof WorkerError) return fail(reply, e.status, "worker", e.message);
      throw e;
    }
  };

  // ---- Calls ----------------------------------------------------------------
  app.get("/api/calls/status", handle(async () => ({ ...(await workers.status()), active_calls: registry.active().length })));
  app.get("/api/calls/voices", handle(async () => ({ voices: await workers.voices() })));
  app.get("/api/calls/history", async () => ({ used_seconds: registry.secondsUsed(), recent_calls: registry.ledger().slice(-20).reverse() }));

  app.post("/api/calls", handle(async (req, reply) => {
    const wanted: string | null = typeof req.body?.character === "string" && req.body.character.trim() ? req.body.character : null;
    const c = wanted ? await store.find(wanted) : null;
    registry.assertFree();
    const call = registry.create("voice", c?.id ?? null);
    return reply.code(201).send({
      call_id: call.id, mode: "voice", character: call.character, name: c?.name ?? "Mirli",
      ws_url: `${ws(workers.voiceUrl)}/ws`,
      token: voiceToken(call.id), expires: registry.expiresAt(call), heartbeat_s: hb,
      persona: callPersona(c?.persona ?? MIRLI_PERSONA),
      voice_id: await voiceFor(c),
    });
  }));

  app.post("/api/calls/:id/heartbeat", handle(async (req) => {
    const expires = registry.heartbeat(req.params.id);
    return { call_id: req.params.id, expires, token: voiceToken(req.params.id) };
  }));

  // Switch character mid-call. The client then sends the persona and voice on its socket (the worker starts a fresh conversation).
  app.post("/api/calls/:id/character", handle(async (req) => {
    registry.get(req.params.id);
    const c = await store.find(String(req.body?.character ?? ""));
    registry.setCharacter(req.params.id, c.id);
    return { character: c.id, name: c.name, persona: callPersona(c.persona), voice_id: await voiceFor(c) };
  }));

  app.delete("/api/calls/:id", handle(async (req) => {
    const row = registry.end(req.params.id);
    await workers.end(row.call);
    return row;
  }));

  // ---- Characters -------------------------------------------------------------
  app.get("/api/characters", handle(async () => ({ characters: (await store.list()).map((c) => store.view(c)) })));
  app.get("/api/characters/:id", handle(async (req) => store.view(await store.get(req.params.id))));

  /** An uploaded portrait, or one drawn by Mirli's image engine from `prompt`; null when neither was given. */
  async function portraitFrom(body: any, reply: FastifyReply): Promise<Portrait | null | "failed"> {
    const up = decodeImage(body?.image);
    if (up) return up;
    if (typeof body?.prompt !== "string" || !body.prompt.trim()) return null;
    try {
      const art = await svc.image.generate({ prompt: body.prompt.trim(), kind: "avatar" });
      return { bytes: await readFile(join(svc.config.paths.artwork, art.filename)), ext: "png" };
    } catch (e) {
      fail(reply, 503, "image", `Couldn't draw the portrait: ${e instanceof Error ? e.message : e}. Upload a picture instead, or set up Artwork in Settings.`);
      return "failed";
    }
  }

  app.post("/api/characters", handle(async (req, reply) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return fail(reply, 400, "bad_request", "Give the character a name.");
    const portrait = await portraitFrom(req.body, reply);
    if (portrait === "failed") return reply;
    const c = await store.create({ name, persona: req.body?.persona, voice_id: req.body?.voice_id ?? null, portrait });
    return reply.code(201).send(store.view(c));
  }));

  app.patch("/api/characters/:id", handle(async (req, reply) => {
    const b = req.body ?? {};
    const c = await store.update(req.params.id, {
      name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : undefined,
      persona: typeof b.persona === "string" ? b.persona : undefined,
      voice_id: b.voice_id === null || typeof b.voice_id === "string" ? b.voice_id : undefined,
    });
    const portrait = await portraitFrom(b, reply);
    if (portrait === "failed") return reply;
    if (portrait) await store.setPortrait(c.id, portrait);
    return store.view(c);
  }));

  app.delete("/api/characters/:id", handle(async (req, reply) => {
    try {
      await store.remove(req.params.id);
    } catch (e) {
      if (e instanceof CharacterNotFound) throw e;
      return fail(reply, 409, "builtin", e instanceof Error ? e.message : String(e));
    }
    return reply.code(204).send();
  }));

  app.get("/api/characters/:id/portrait", handle(async (req, reply) => {
    const p = store.portraitPath(req.params.id);
    if (!p) return fail(reply, 404, "not_found", "This character has no portrait.");
    return reply.type(MIME[extname(p).toLowerCase()] ?? "application/octet-stream").header("Cache-Control", "no-cache").send(createReadStream(p));
  }));
}
