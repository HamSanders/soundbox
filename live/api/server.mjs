// Mirli Live Call API, local mode. `node live/api/server.mjs`
//
// The same contract the cloud gateway serves (see live/README.md), in front of
// the workers on this machine: the voice server (17650) and the face server
// (17680 MuseTalk, or 17660). The web app only ever talks to this API and to
// the two WebSocket URLs it hands out.

import http from "node:http";

import { BusyError, CallRegistry, NotFoundError } from "./calls.mjs";
import { toCharacters, VOICE_PERSONA } from "./characters.mjs";
import { allowedOrigins, localSecret, sign } from "./token.mjs";

const env = process.env;
const PORT = Number(env.MIRLI_LIVE_PORT || 17690);
const HOST = env.MIRLI_LIVE_HOST || "127.0.0.1";
const VOICE = (env.MIRLI_VOICE_URL || "http://127.0.0.1:17650").replace(/\/$/, "");
const FACE_CANDIDATES = (env.MIRLI_FACE_URL || "http://127.0.0.1:17680,http://127.0.0.1:17660").split(",").map((s) => s.trim().replace(/\/$/, ""));
const TOKEN_TTL_S = Number(env.MIRLI_TOKEN_TTL_S || 120);
const HEARTBEAT_S = Number(env.MIRLI_HEARTBEAT_S || 10);
// Web app origins allowed to call this API. The Vite dev server, the built app
// served by `vite preview`, and the desktop shell.
const ORIGINS = allowedOrigins().length ? allowedOrigins()
  : ["http://127.0.0.1:5191", "http://localhost:5191", "http://127.0.0.1:5174", "http://localhost:5174", "http://127.0.0.1:4174", "http://localhost:4174", "tauri://localhost", "http://tauri.localhost"];

const secret = localSecret({ create: true });
const calls = new CallRegistry({ maxCalls: Number(env.MIRLI_MAX_CALLS || 1), heartbeatTimeoutS: HEARTBEAT_S * 3 });
const wsOf = (u) => u.replace(/^http/, "ws");
const adminToken = (call = "admin") => sign({ call, aud: ["admin"] }, secret, 30);

// ---- Workers ----------------------------------------------------------------
async function fetchJson(url, opts = {}, timeoutMs = 2500) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw Object.assign(new Error(`${url}: ${r.status} ${await r.text().catch(() => "")}`.trim()), { status: r.status });
  return r.json();
}
let faceUrl = null;
/** The face worker that answers, preferring the first candidate. Re-probed when it stops answering. */
async function face() {
  if (faceUrl) {
    try { await fetchJson(`${faceUrl}/stats`, {}, 1500); return faceUrl; } catch { faceUrl = null; }
  }
  for (const u of FACE_CANDIDATES) {
    try { await fetchJson(`${u}/stats`, {}, 1500); return (faceUrl = u); } catch {}
  }
  return null;
}
const authed = (call) => ({ Authorization: `Bearer ${adminToken(call)}` });

/** Tell both workers a call is over. Old workers without the endpoint just 404. */
async function endOnWorkers(id) {
  const f = faceUrl;
  await Promise.allSettled([
    fetch(`${VOICE}/internal/calls/${id}/end`, { method: "POST", headers: authed(id), signal: AbortSignal.timeout(2000) }),
    f && fetch(`${f}/internal/calls/${id}/end`, { method: "POST", headers: authed(id), signal: AbortSignal.timeout(2000) }),
  ]);
}

async function characters() {
  const f = await face();
  if (!f) return { characters: [], current: null, face: false };
  const d = await fetchJson(`${f}/faces`);
  return { characters: toCharacters(d.faces), current: d.current, face: true };
}

async function setPortrait(id) {
  const f = await face();
  if (!f) throw Object.assign(new Error("face server is not running"), { status: 503 });
  return fetchJson(`${f}/face`, { method: "POST", headers: { "Content-Type": "application/json", ...authed("admin") }, body: JSON.stringify({ id }) });
}

// ---- HTTP -------------------------------------------------------------------
const json = (res, status, body) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
const fail = (res, status, code, message) => json(res, status, { error: { code, message } });
async function body(req, limit = 1 << 20) {
  const chunks = [];
  let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error("body too large"), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks);
}
const jsonBody = async (req) => { const b = await body(req); try { return b.length ? JSON.parse(b) : {}; } catch { throw Object.assign(new Error("invalid JSON"), { status: 400 }); } };

function callView(c, extra = {}) {
  return { call_id: c.id, mode: c.mode, character: c.character, started: c.started, expires: calls.expiresAt(c), heartbeat_s: HEARTBEAT_S, ...extra };
}

const routes = [
  ["GET", /^\/v1\/health$/, async () => {
    const f = await face();
    let voice = false, faceInfo = null;
    try { await fetchJson(`${VOICE}/voices`, {}, 1500); voice = true; } catch {}
    if (f) try { const s = await fetchJson(`${f}/stats`); faceInfo = { url: f, engine: s.engine, ready: s.ready }; } catch {}
    return [200, { ok: voice, mode: "local", voice, face: faceInfo, active_calls: calls.active().length }];
  }],
  ["GET", /^\/v1\/account$/, async () => [200, {
    plan: "local", name: "This computer",
    minutes: { unlimited: true, used_seconds: calls.secondsUsed() },
    recent_calls: calls.ledger().slice(-20).reverse(),
  }]],
  ["GET", /^\/v1\/voices$/, async () => [200, { voices: await fetchJson(`${VOICE}/voices`) }]],
  ["GET", /^\/v1\/characters$/, async () => [200, await characters()]],
  ["GET", /^\/v1\/characters\/([\w.-]+)\/portrait$/, async (_req, res, [id]) => {
    const f = await face();
    if (!f) return [404, { error: { code: "no_face", message: "face server is not running" } }];
    const r = await fetch(`${f}/faces/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return [404, { error: { code: "not_found", message: "no such character" } }];
    res.writeHead(200, { "Content-Type": r.headers.get("content-type") || "image/png", "Cache-Control": "public, max-age=3600" });
    res.end(Buffer.from(await r.arrayBuffer()));
    return null;
  }],
  ["POST", /^\/v1\/characters$/, async (req) => {
    const f = await face();
    if (!f) return [503, { error: { code: "no_face", message: "face server is not running" } }];
    const img = await body(req, 15 * 1024 * 1024);
    const name = String(req.headers["x-name"] || "photo");
    const d = await fetchJson(`${f}/faces`, { method: "POST", headers: { "X-Name": name, ...authed("admin") }, body: img }, 20000);
    return [201, { id: d.id }];
  }],
  ["GET", /^\/v1\/face-models$/, async () => {
    const f = await face();
    if (!f) return [200, { current: null, available: [] }];
    const d = await fetchJson(`${f}/engine`);
    // "lite" is an old alias of "flashhead"; the test pattern only shows when it is the one running.
    d.available = d.available.filter((m) => m.id !== "lite" && (m.id !== "fake" || d.current === "fake"));
    return [200, d];
  }],
  ["POST", /^\/v1\/face-models$/, async (req) => {
    const f = await face();
    if (!f) return [503, { error: { code: "no_face", message: "face server is not running" } }];
    const { name } = await jsonBody(req);
    const d = await fetchJson(`${f}/engine`, { method: "POST", headers: { "Content-Type": "application/json", ...authed("admin") }, body: JSON.stringify({ name }) });
    faceUrl = null;
    return [202, d];
  }],
  ["POST", /^\/v1\/calls$/, async (req) => {
    const { mode = "video", character = null } = await jsonBody(req);
    let f = null, persona = VOICE_PERSONA;
    if (mode === "video") {
      f = await face();
      if (!f) return [503, { error: { code: "no_face", message: "The face server isn't running. Try a voice call." } }];
      if (character) {
        const list = (await characters()).characters;
        const ch = list.find((c) => c.id === character);
        if (!ch) return [404, { error: { code: "not_found", message: "no such character" } }];
        persona = ch.persona;
      }
    }
    const c = calls.create({ mode, character });
    try {
      if (mode === "video" && character) await setPortrait(character);
    } catch (e) {
      calls.end(c.id, "failed");
      throw e;
    }
    const token = sign({ call: c.id, aud: mode === "video" ? ["voice", "face"] : ["voice"], mode }, secret, TOKEN_TTL_S);
    return [201, callView(c, {
      ws_url: `${wsOf(VOICE)}/ws`,
      face_ws_url: mode === "video" ? `${wsOf(f)}/ws` : null,
      token, token_expires: Math.floor(Date.now() / 1000) + TOKEN_TTL_S, persona,
    })];
  }],
  ["GET", /^\/v1\/calls\/([\w-]+)$/, async (_req, _res, [id]) => [200, callView(calls.get(id))]],
  // A beat also hands out a fresh token, so a socket that drops mid-call can reconnect after the first one expired.
  ["POST", /^\/v1\/calls\/([\w-]+)\/heartbeat$/, async (_req, _res, [id]) => {
    const beat = calls.heartbeat(id);
    const c = calls.get(id);
    const token = sign({ call: id, aud: c.mode === "video" ? ["voice", "face"] : ["voice"], mode: c.mode }, secret, TOKEN_TTL_S);
    return [200, { call_id: id, ...beat, token }];
  }],
  ["POST", /^\/v1\/calls\/([\w-]+)\/character$/, async (req, _res, [id]) => {
    const c = calls.get(id);
    if (c.mode !== "video") return [409, { error: { code: "voice_call", message: "a voice call has no face" } }];
    const { character } = await jsonBody(req);
    const ch = (await characters()).characters.find((x) => x.id === character);
    if (!ch) return [404, { error: { code: "not_found", message: "no such character" } }];
    await setPortrait(character);
    calls.setCharacter(id, character);
    return [200, { character: ch.id, name: ch.name, persona: ch.persona }];
  }],
  ["DELETE", /^\/v1\/calls\/([\w-]+)$/, async (_req, _res, [id]) => {
    const row = calls.end(id);
    await endOnWorkers(id);
    return [200, row];
  }],
];

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Name");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  } else if (origin) {
    return fail(res, 403, "origin", `origin ${origin} is not allowed`);
  }
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  const path = new URL(req.url, "http://x").pathname;
  for (const [method, re, handler] of routes) {
    const m = path.match(re);
    if (!m || method !== req.method) continue;
    try {
      const out = await handler(req, res, m.slice(1));
      if (out) json(res, out[0], out[1]);
    } catch (e) {
      if (e instanceof BusyError) return fail(res, 409, "busy", "A call is already running on this machine. End it first.");
      if (e instanceof NotFoundError) return fail(res, 404, "not_found", e.message);
      if (e instanceof TypeError && /mode/.test(e.message)) return fail(res, 400, "bad_request", e.message);
      const status = e.status && e.status < 500 ? e.status : 502;
      return fail(res, status, status === 502 ? "worker" : "bad_request", e.message);
    }
    return;
  }
  fail(res, 404, "not_found", "no such endpoint");
});

setInterval(() => { for (const row of calls.reap()) endOnWorkers(row.call); }, 5000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Mirli Live API (local) on http://${HOST}:${PORT}  voice ${VOICE}  face ${FACE_CANDIDATES.join(" | ")}`);
  console.log(`origins: ${ORIGINS.join(", ")}`);
});
