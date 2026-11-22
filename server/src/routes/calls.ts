/**
 * Calls: real-time voice and video calls with characters.
 *
 * The Call API contract (live/README.md) served by the Mirli server itself,
 * so the app's Calls area talks to its own backend. The cloud gateway serves
 * the same contract; the app only changes its base URL.
 *
 *   POST   /api/calls                     { mode, character? } -> CallGrant
 *   POST   /api/calls/:id/heartbeat       -> { expires, token }
 *   POST   /api/calls/:id/character       { character } -> { character, name, persona, voice_id }
 *   DELETE /api/calls/:id                 -> ledger row
 *   GET    /api/calls/status | voices | history, GET|POST /api/calls/face-models
 *
 *   GET|POST /api/characters, GET|PATCH|DELETE /api/characters/:id,
 *   GET /api/characters/:id/portrait, GET /api/characters/:id/pack/<file>,
 *   POST /api/characters/:id/pack { provider: "local" | "cloud", comfy_url? },
 *   POST /api/characters/:id/pack/import { dir }
 *
 * Errors are `{ error: { code, message } }`, as in the contract.
 */

import { createReadStream, existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import type { FastifyInstance, FastifyReply } from "fastify";

import { CharacterNotFound, CharacterStore, MIRLI_PERSONA, type Character } from "../calls/characters.js";
import { CloudPackRenderer, PackError, PackRenderer, packSettingsFromEnv } from "../calls/packs.js";
import { BackendStore, CloudCalls, CloudError, type CloudGrant } from "../calls/cloud.js";
import { CallBusyError, CallNotFoundError, CallRegistry, type CallMode } from "../calls/registry.js";
import { callSecret, signCallToken } from "../calls/token.js";
import { CallWorkers, WorkerError, workerConfigFromEnv, type PortraitSource } from "../calls/workers.js";
import type { MirliService } from "../service.js";

const TOKEN_TTL_S = 120;
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4", ".json": "application/json", ".webm": "video/webm" };

export interface CallsDeps {
  store?: CharacterStore;
  workers?: CallWorkers;
  registry?: CallRegistry;
  packs?: PackRenderer;
  backend?: BackendStore;
  cloudCalls?: CloudCalls;
  heartbeatS?: number;
}

const fail = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });

/** `data:image/png;base64,...` -> bytes. */
function decodeImage(dataUrl: unknown): { bytes: Buffer; ext: "png" | "jpg" } | null {
  if (typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!m) return null;
  return { bytes: Buffer.from(m[2]!, "base64"), ext: m[1] === "png" ? "png" : "jpg" };
}

export function registerCalls(app: FastifyInstance, svc: MirliService, deps: CallsDeps = {}): void {
  const secret = callSecret();
  const store = deps.store ?? new CharacterStore(svc.config.paths.root);
  const workers = deps.workers ?? new CallWorkers(workerConfigFromEnv(secret));
  const hb = deps.heartbeatS ?? Number(process.env.MIRLI_CALL_HEARTBEAT_S || 10);
  const registry = deps.registry ?? new CallRegistry({ heartbeatTimeoutS: hb * 3 });
  const packs = deps.packs ?? new PackRenderer(store, packSettingsFromEnv());
  const cloud = new CloudPackRenderer();
  const ws = (u: string) => u.replace(/^http/, "ws");
  // Local GPU or Mirli Cloud: the app's client and these routes are the same either way.
  const backend = deps.backend ?? new BackendStore(svc.config.paths.root);
  const cloudCalls = deps.cloudCalls ?? new CloudCalls(() => backend.get());
  const onCloud = new Map<string, CloudGrant>(); // calls running on Mirli Cloud, by id

  const endAnywhere = async (id: string) => {
    if (onCloud.has(id)) {
      onCloud.delete(id);
      await cloudCalls.end(id).catch(() => {});
    } else await workers.end(id);
  };
  const reaper = setInterval(() => { for (const row of registry.reap()) void endAnywhere(row.call); }, 5000);
  reaper.unref();
  app.addHook("onClose", async () => { clearInterval(reaper); packs.stopAll(); });

  /** What the face worker should animate: a pack's talk-still crop, else the portrait. */
  async function portraitFor(c: Character): Promise<PortraitSource> {
    const m = c.pack.status === "ready" ? await store.packManifest(c.id) : null;
    const talk = m?.poses[m.talkPose ?? "talk"];
    if (talk?.still && talk.faceBox) {
      const still = store.packFile(c.id, talk.still);
      if (existsSync(still)) return { path: still, name: c.id, crop: talk.faceBox };
    }
    return { path: store.portraitPath(c.id), name: c.id };
  }

  /** A built-in character with no voice picked uses a voice of the same name, if the user has one (a "Santa" clone). */
  async function builtinVoice(name: string): Promise<string | null> {
    try {
      return (await workers.voices()).find((v) => v.name.toLowerCase() === name.toLowerCase())?.id ?? null;
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
      if (e instanceof PackError) return fail(reply, e.status, "pack", e.message);
      if (e instanceof CloudError) return fail(reply, e.status, e.code, e.message);
      throw e;
    }
  };

  // ---- Calls ----------------------------------------------------------------
  app.get("/api/calls/status", handle(async () => {
    const b = backend.get();
    if (b.mode === "cloud") {
      // The cloud has the workers; what matters here is reaching the gateway, signed in.
      let up = false;
      try { up = (await fetch(`${b.url}/v1/health`, { signal: AbortSignal.timeout(3000) })).ok; } catch { /* down */ }
      return { mode: "cloud", url: b.url, signed_in: !!b.token, voice: up && !!b.token, face: up && b.token ? { url: b.url, engine: "musetalk", ready: true } : null, active_calls: registry.active().length };
    }
    return { mode: "local", ...(await workers.status()), active_calls: registry.active().length };
  }));
  app.get("/api/calls/backend", async () => backend.view());
  app.put("/api/calls/backend", async (req: any, reply) => {
    const b = req.body ?? {};
    if (b.mode !== undefined && b.mode !== "local" && b.mode !== "cloud") return fail(reply, 400, "bad_request", "mode is local or cloud");
    if (b.url !== undefined && !/^https?:\/\/[^\s]+$/.test(String(b.url))) return fail(reply, 400, "bad_request", "url must be http(s)");
    backend.set({
      ...(b.mode ? { mode: b.mode } : {}),
      ...(b.url ? { url: String(b.url).replace(/\/$/, "") } : {}),
      ...(typeof b.token === "string" ? { token: b.token.trim() || null } : {}),
    });
    return backend.view();
  });
  app.get("/api/calls/voices", handle(async () => ({ voices: backend.get().mode === "cloud" ? [] : await workers.voices() })));
  app.get("/api/calls/history", async () => ({ unlimited: true, used_seconds: registry.secondsUsed(), recent_calls: registry.ledger().slice(-20).reverse() }));
  app.get("/api/calls/face-models", handle(async () => workers.faceModels()));
  app.post("/api/calls/face-models", handle(async (req, reply) => reply.code(202).send(await workers.switchFaceModel(String(req.body?.name ?? "")))));

  app.post("/api/calls", handle(async (req, reply) => {
    const mode: CallMode = req.body?.mode === "voice" ? "voice" : "video";
    const charId: string | null = typeof req.body?.character === "string" && req.body.character ? req.body.character : null;
    const c = charId ? await store.get(charId) : null;
    if (mode === "video" && !c) return fail(reply, 400, "bad_request", "A video call needs a character.");
    if (backend.get().mode === "cloud") {
      registry.assertFree();
      const grant = await cloudCalls.start(mode, c?.id ?? null, c?.persona ?? MIRLI_PERSONA, c?.voice_id ?? null);
      const call = registry.create(mode, c?.id ?? null, grant.call_id);
      onCloud.set(call.id, grant);
      try {
        if (mode === "video" && c) await cloudCalls.showPortrait(grant, await portraitFor(c));
      } catch (e) {
        registry.end(call.id, "failed");
        await endAnywhere(call.id);
        throw e;
      }
      return reply.code(201).send({ ...grant, character: call.character });
    }
    let faceUrl: string | null = null;
    if (mode === "video") {
      faceUrl = await workers.face();
      if (!faceUrl) return fail(reply, 503, "no_face", "The face server isn't running. Try a voice call.");
    }
    const call = registry.create(mode, c?.id ?? null);
    try {
      if (mode === "video" && c) await workers.showPortrait(await portraitFor(c));
    } catch (e) {
      registry.end(call.id, "failed");
      throw e;
    }
    const token = signCallToken({ call: call.id, aud: mode === "video" ? ["voice", "face"] : ["voice"], mode }, secret, TOKEN_TTL_S);
    return reply.code(201).send({
      call_id: call.id, mode, character: call.character,
      ws_url: `${ws(workers.voiceUrl)}/ws`,
      face_ws_url: faceUrl ? `${ws(faceUrl)}/ws` : null,
      token, expires: registry.expiresAt(call), heartbeat_s: hb,
      persona: c?.persona ?? MIRLI_PERSONA,
      voice_id: c?.voice_id ?? (c?.builtin ? await builtinVoice(c.name) : null),
    });
  }));

  app.post("/api/calls/:id/heartbeat", handle(async (req) => {
    const expires = registry.heartbeat(req.params.id);
    const call = registry.get(req.params.id);
    const g = onCloud.get(call.id);
    if (g) {
      const beat = await cloudCalls.heartbeat(call.id);
      g.token = beat.token;
      return { call_id: call.id, expires: beat.expires, token: beat.token, minutes_left_s: beat.minutes_left_s ?? null };
    }
    const token = signCallToken({ call: call.id, aud: call.mode === "video" ? ["voice", "face"] : ["voice"], mode: call.mode }, secret, TOKEN_TTL_S);
    return { call_id: call.id, expires, token };
  }));

  app.post("/api/calls/:id/character", handle(async (req, reply) => {
    const call = registry.get(req.params.id);
    if (call.mode !== "video") return fail(reply, 409, "voice_call", "A voice call has no face.");
    const c = await store.get(String(req.body?.character ?? ""));
    const g = onCloud.get(call.id);
    if (g) await cloudCalls.showPortrait(g, await portraitFor(c));
    else await workers.showPortrait(await portraitFor(c));
    registry.setCharacter(call.id, c.id);
    return { character: c.id, name: c.name, persona: c.persona, voice_id: c.voice_id };
  }));

  app.delete("/api/calls/:id", handle(async (req) => {
    const row = registry.end(req.params.id);
    await endAnywhere(row.call);
    return row;
  }));

  // ---- Characters -------------------------------------------------------------
  app.get("/api/characters", handle(async () => ({ characters: (await store.list()).map((c) => store.view(c)) })));
  app.get("/api/characters/:id", handle(async (req) => store.view(await store.get(req.params.id))));

  app.post("/api/characters", handle(async (req, reply) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return fail(reply, 400, "bad_request", "Give the character a name.");
    let portrait = decodeImage(req.body?.image);
    if (!portrait && typeof req.body?.prompt === "string" && req.body.prompt.trim()) {
      // Drawn by Mirli's own image engine (Settings > Artwork), like voice avatars.
      try {
        const art = await svc.image.generate({ prompt: req.body.prompt.trim(), kind: "avatar" });
        portrait = { bytes: await readFile(join(svc.config.paths.artwork, art.filename)), ext: "png" };
      } catch (e) {
        return fail(reply, 503, "image", `Couldn't draw the portrait: ${e instanceof Error ? e.message : e}. Upload a photo instead, or set up Artwork in Settings.`);
      }
    }
    if (!portrait) return fail(reply, 400, "bad_request", "Upload a portrait, or describe one to draw.");
    const c = await store.create({ name, persona: req.body?.persona, voice_id: req.body?.voice_id ?? null, portrait });
    return reply.code(201).send(store.view(c));
  }));

  app.patch("/api/characters/:id", handle(async (req) => {
    const b = req.body ?? {};
    const c = await store.update(req.params.id, {
      name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : undefined,
      persona: typeof b.persona === "string" ? b.persona : undefined,
      voice_id: b.voice_id === null || typeof b.voice_id === "string" ? b.voice_id : undefined,
    });
    const portrait = decodeImage(b.image);
    if (portrait) {
      for (const ext of ["png", "jpg"]) await rm(join(store.folder(c.id), `portrait.${ext}`), { force: true });
      await writeFile(join(store.folder(c.id), `portrait.${portrait.ext}`), portrait.bytes);
    }
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

  const sendFile = (reply: FastifyReply, path: string) => {
    if (!existsSync(path)) return fail(reply, 404, "not_found", "No such file.");
    return reply.type(MIME[extname(path).toLowerCase()] ?? "application/octet-stream").header("Cache-Control", "no-cache").send(createReadStream(path));
  };
  app.get("/api/characters/:id/portrait", handle(async (req, reply) => sendFile(reply, store.portraitPath(req.params.id))));
  app.get("/api/characters/:id/pack/*", handle(async (req, reply) => sendFile(reply, store.packFile(req.params.id, req.params["*"]))));

  app.post("/api/characters/:id/pack", handle(async (req, reply) => {
    const provider = req.body?.provider === "cloud" ? "cloud" : "local";
    if (provider === "cloud") await cloud.render(await store.get(req.params.id));
    const c = await packs.renderLocal(req.params.id, typeof req.body?.comfy_url === "string" && req.body.comfy_url ? req.body.comfy_url.replace(/\/$/, "") : undefined);
    return reply.code(202).send(store.view(c));
  }));

  app.post("/api/characters/:id/pack/import", handle(async (req, reply) => {
    const dir = String(req.body?.dir ?? "");
    if (!dir) return fail(reply, 400, "bad_request", "Give the folder that holds the pack's manifest.json.");
    return store.view(await packs.importFolder(req.params.id, dir));
  }));
}
