// The call pod's front door: the one port RunPod exposes (POD_PORT, default 8080).
//
//   app ──HTTPS/WSS── RunPod proxy ── :8080 pod.mjs ─┬─ /ws, /voices  → voice server 127.0.0.1:17650
//                                                    └─ /facesrv/*    → face server  127.0.0.1:17660
//
// API only: no pages. Callers carry the Mirli call token (live/README.md) as the WebSocket subprotocol
// "bearer.<token>" or an Authorization header; the gateway signs it with this pod's POD_SECRET, which the
// workers also get (as MIRLI_CALL_SECRET), so they check it a second time.
//
// It adds what the spike servers don't have: one call at a time, a busy/free state a router can read,
// health and readiness, a per-call token, and a record of how long each call was connected.
// No dependencies beyond Node's standard library. See README.md for the endpoint reference.

import { timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
import net from "node:net";

import { tokenFromRequest, verify } from "../realtime-voice/lib/call-token.mjs";

const env = process.env;
const PORT = Number(env.POD_PORT ?? 8080);
const VOICE = { host: "127.0.0.1", port: Number(env.SPIKE_PORT ?? 17650) };
const FACE = { host: "127.0.0.1", port: Number(env.FACE_HTTP_PORT ?? 17660) };
const FACE_ON = env.FACE !== "0";
// Signs call tokens. Set per pod by the gateway at create time; never baked into the image.
const SECRET = env.POD_SECRET ?? "";
// Bearer token for the router-only endpoints (/state, /claim, /release, /drain).
const ADMIN = env.POD_ADMIN_TOKEN ?? "";
const CLAIM_TTL_S = Number(env.POD_CLAIM_TTL_S ?? 90); // a claim nobody joins within this goes back to free
const MAX_CALL_S = Number(env.POD_MAX_CALL_S ?? 3600); // hard cap per call
const GRACE_S = Number(env.POD_RECONNECT_GRACE_S ?? 15); // a dropped socket may rejoin the same call this long
const LEDGER = env.POD_LEDGER ?? "/tmp/mirli-calls.jsonl";
// Portraits a caller uploaded land in the face server's dir; anything not baked into the image is removed
// when a call ends, so the next caller on this pod never sees the last one's photo.
const FACES_DIR = env.MIRLI_FACE_HOME ? join(env.MIRLI_FACE_HOME, "faces") : null;
const BAKED_FACES = env.POD_BAKED_FACES ?? "/opt/faces";
const DEV = !SECRET;
if (DEV) console.warn("POD_SECRET is not set: dev mode, every request is let in. Never run a public pod like this.");

const now = () => Date.now();
const bootAt = now();

// ---------- state ----------
// starting → free → reserved (claimed by the router) → busy (caller's /ws open) → free
// draining: finish the current call, then refuse new ones (the router is about to stop this pod).
const pod = {
  engines: { voice: false, face: !FACE_ON, checkedAt: 0, detail: {} },
  draining: false,
  call: null, // { id, claimedAt, expiresAt, connectedAt, sockets:Set, disconnectedAt, connectedMs }
  lastCall: null,
  calls: 0,
  freeSince: null,
};

const GPU_FAILED = env.POD_GPU_FAILED_FILE ?? "/tmp/logs/GPU_FAILED";
function state() {
  if (existsSync(GPU_FAILED)) return "failed"; // broken host: the router should terminate this pod
  if (!pod.engines.voice || !pod.engines.face) return "starting";
  if (pod.call?.connectedAt) return "busy";
  if (pod.call) return "reserved";
  return pod.draining ? "draining" : "free";
}

function connectedMs(c) {
  return c.connectedMs + (c.connectedAt && !c.disconnectedAt ? now() - c.connectedAt : 0);
}

function endCall(reason) {
  const c = pod.call;
  if (!c) return;
  pod.call = null;
  for (const s of c.sockets) s.destroy();
  const rec = {
    call_id: c.id,
    reason,
    claimed_at: new Date(c.claimedAt).toISOString(),
    first_connected_at: c.firstConnectedAt ? new Date(c.firstConnectedAt).toISOString() : null,
    ended_at: new Date().toISOString(),
    connected_s: Math.round(connectedMs(c) / 100) / 10,
    pod_id: env.RUNPOD_POD_ID ?? null,
  };
  pod.lastCall = rec;
  pod.calls++;
  pod.freeSince = now();
  try {
    appendFileSync(LEDGER, JSON.stringify(rec) + "\n");
  } catch {}
  console.log("call ended", rec);
  // Barge-in the face so the next caller doesn't see the tail of this one.
  if (FACE_ON) internal(FACE, "POST", "/flush").catch(() => {});
  // Put the starting portrait back, then delete uploads once the face server has switched (it applies a
  // new face between steps, well under a second).
  if (FACE_ON && env.POD_DEFAULT_FACE) internal(FACE, "POST", "/face", { id: env.POD_DEFAULT_FACE }).catch(() => {});
  setTimeout(removeUploads, Number(env.POD_UPLOAD_CLEANUP_MS ?? 3000)).unref();
}

function removeUploads() {
  if (!FACES_DIR || !existsSync(FACES_DIR)) return;
  const keep = new Set(existsSync(BAKED_FACES) ? readdirSync(BAKED_FACES) : []);
  for (const f of readdirSync(FACES_DIR)) if (!keep.has(f)) rmSync(join(FACES_DIR, f), { force: true });
}

setInterval(() => {
  const c = pod.call;
  if (!c) return;
  const t = now();
  if (!c.firstConnectedAt && t > c.expiresAt) endCall("claim_expired");
  else if (c.disconnectedAt && c.sockets.size === 0 && t - c.disconnectedAt > GRACE_S * 1000) endCall("caller_left");
  else if (c.firstConnectedAt && t - c.firstConnectedAt > MAX_CALL_S * 1000) endCall("max_call_length");
}, 1000).unref();

// ---------- tokens ----------
// The Mirli call token: base64url(payload).base64url(HMAC-SHA256(POD_SECRET, payload)), payload
// { v: 1, call, aud, iat, exp }. The gateway mints it, so the pod never calls home.
function verifyCall(token, aud) {
  if (DEV) return { id: "dev", admin: true };
  try {
    const p = verify(token, SECRET, { aud });
    if (!/^[\w-]{1,64}$/.test(p.call)) return null;
    return { id: p.call, admin: (Array.isArray(p.aud) ? p.aud : [p.aud]).includes("admin") };
  } catch {
    return null;
  }
}

/** The router (POD_ADMIN_TOKEN) or the gateway (a call token with the admin audience). */
function isAdmin(req) {
  if (DEV && !ADMIN) return true;
  const got = Buffer.from(req.headers.authorization ?? "");
  const want = Buffer.from(`Bearer ${ADMIN}`);
  if (ADMIN && got.length === want.length && timingSafeEqual(got, want)) return true;
  return !!verifyCall(tokenFromRequest(req), "admin")?.admin;
}

/** May this request act for a call? Binds a free pod to the token's call (direct join without /claim). */
function admit(req, aud) {
  const tok = verifyCall(tokenFromRequest(req), aud);
  if (!tok) return { ok: false, code: 401, why: "missing or bad call token" };
  const s = state();
  if (s === "starting") return { ok: false, code: 503, why: "engines still loading" };
  if (pod.call && pod.call.id !== tok.id) return { ok: false, code: 409, why: "pod is in another call" };
  if (!pod.call) {
    if (pod.draining) return { ok: false, code: 409, why: "pod is draining" };
    pod.call = newCall(tok.id);
  }
  return { ok: true, call: pod.call };
}

function newCall(id) {
  return { id, claimedAt: now(), expiresAt: now() + CLAIM_TTL_S * 1000, sockets: new Set(), connectedMs: 0 };
}

// ---------- engine readiness ----------
function internal(target, method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...(body ? { "Content-Type": "application/json" } : {}), ...extraHeaders };
    const req = http.request({ ...target, method, path, timeout: 2000, headers }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, json: null });
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function checkEngines() {
  const e = pod.engines;
  try {
    // The voice server only starts listening after STT, TTS and the LLM check have all loaded.
    const r = await internal(VOICE, "GET", "/metrics");
    e.voice = r.status === 200;
    if (r.json) e.detail.voice_vram_mib = r.json.vram;
  } catch {
    e.voice = false;
  }
  if (FACE_ON) {
    try {
      const r = await internal(FACE, "GET", "/stats");
      e.face = r.status === 200 && r.json?.ready === true;
      if (r.json) e.detail.face = { engine: r.json.engine, gen_fps: r.json.gen_fps, vram_mib_now: r.json.vram_mib_now, vram_mib_peak: r.json.vram_mib_peak };
    } catch {
      e.face = false;
    }
  }
  if (e.voice && e.face && !e.readyAt) {
    e.readyAt = now();
    pod.freeSince = now();
    console.log(`ready in ${((e.readyAt - bootAt) / 1000).toFixed(1)} s after pod.mjs start`);
  }
  e.checkedAt = now();
}
setInterval(checkEngines, 1000).unref();
checkEngines();

// ---------- HTTP ----------
const json = (res, code, obj, headers = {}) =>
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers }).end(JSON.stringify(obj));

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (d) => (b += d).length > 65536 && req.destroy());
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function publicState() {
  const c = pod.call;
  return {
    state: state(),
    ready: state() === "free",
    uptime_s: Math.round((now() - bootAt) / 1000),
    engines_ready_s: pod.engines.readyAt ? Math.round((pod.engines.readyAt - bootAt) / 100) / 10 : null,
    idle_s: state() === "free" && pod.freeSince ? Math.round((now() - pod.freeSince) / 1000) : 0,
    call: c && { id: c.id, connected: c.sockets.size > 0, connected_s: Math.round(connectedMs(c) / 1000) },
    ...(existsSync(GPU_FAILED) ? { failed: readFileSync(GPU_FAILED, "utf8").slice(0, 2000) } : {}),
  };
}

function proxyHttp(req, res, target, path) {
  const headers = { ...req.headers, host: `${target.host}:${target.port}` };
  delete headers.cookie; // the spike servers don't need the call token
  const up = http.request({ ...target, method: req.method, path, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", () => (res.headersSent ? res.destroy() : json(res, 502, { error: "engine not reachable" })));
  req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://pod");
  const p = url.pathname;

  // Liveness: the process is up. Never depends on the engines, so a slow model load isn't a restart loop.
  if (p === "/healthz") return json(res, 200, { ok: true, uptime_s: Math.round((now() - bootAt) / 1000) });
  // Readiness for a router: 200 only when a new caller can be assigned here right now.
  if (p === "/readyz") return json(res, state() === "free" ? 200 : 503, { ...publicState(), busy: !!pod.call });

  if (p === "/state") {
    if (!isAdmin(req)) return json(res, 401, { error: "admin token required" });
    return json(res, 200, { ...publicState(), engines: pod.engines, draining: pod.draining, calls_served: pod.calls, last_call: pod.lastCall, pod_id: env.RUNPOD_POD_ID ?? null });
  }
  if (p === "/logs") {
    if (!isAdmin(req)) return json(res, 401, { error: "admin token required" });
    const name = url.searchParams.get("name") ?? "voice";
    const file = name === "start" ? "/workspace/start.log" : `/tmp/logs/${name}.log`;
    if (!/^(voice|face|pod|start)$/.test(name) || !existsSync(file)) return json(res, 404, { error: "no such log" });
    const lines = readFileSync(file, "utf8").split("\n");
    return res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end(lines.slice(-Number(url.searchParams.get("n") ?? 200)).join("\n"));
  }
  if (p === "/claim" && req.method === "POST") {
    if (!isAdmin(req)) return json(res, 401, { error: "admin token required" });
    const { call_id } = await readBody(req);
    if (!/^[\w-]{1,64}$/.test(call_id ?? "")) return json(res, 400, { error: "call_id: 1-64 of [A-Za-z0-9_-]" });
    if (pod.call?.id === call_id) return json(res, 200, publicState()); // idempotent retry
    if (state() !== "free") return json(res, 409, publicState());
    pod.call = newCall(call_id);
    return json(res, 200, publicState());
  }
  if (p === "/release" && req.method === "POST") {
    if (!isAdmin(req)) return json(res, 401, { error: "admin token required" });
    const { call_id, reason } = await readBody(req);
    if (pod.call && (!call_id || pod.call.id === call_id)) endCall(reason ?? "released");
    return json(res, 200, { ...publicState(), last_call: pod.lastCall });
  }
  // The gateway hung up: drop the call on both workers and free the pod.
  const endM = /^\/internal\/calls\/([\w-]{1,64})\/end$/.exec(p);
  if (endM && req.method === "POST") {
    if (!isAdmin(req)) return json(res, 401, { error: "admin token required" });
    const auth = req.headers.authorization ? { authorization: req.headers.authorization } : {};
    await Promise.allSettled([internal(VOICE, "POST", p, null, auth), FACE_ON && internal(FACE, "POST", p, null, auth)]);
    if (pod.call?.id === endM[1]) endCall("ended_by_gateway");
    return json(res, 200, { ...publicState(), last_call: pod.lastCall });
  }
  if (p === "/drain" && req.method === "POST") {
    if (!isAdmin(req)) return json(res, 401, { error: "admin token required" });
    pod.draining = (await readBody(req)).draining !== false;
    return json(res, 200, publicState());
  }

  // Everything below is the caller's. Preflights pass straight to the workers, which answer CORS for our origins.
  const sub = p.startsWith("/facesrv/") ? p.slice("/facesrv".length) : null;
  if (req.method === "OPTIONS") return proxyHttp(req, res, sub ? FACE : VOICE, (sub ?? p) + url.search);
  const a = admit(req, sub ? "face" : "voice");
  if (!a.ok) return json(res, a.code, { error: a.why, state: state() });
  if (sub !== null) {
    if (!FACE_ON) return json(res, 404, { error: "no face on this pod" });
    // The portrait for this call (upload with X-Crop, then pick it) and what a call screen reads.
    // Engine switching restarts the face server, so it's not offered.
    const allowed = (req.method === "GET" && /^\/(faces(\/[\w.-]+)?|face|stats|engine)$/.test(sub)) || (req.method === "POST" && /^\/(face|faces|flush)$/.test(sub));
    if (!allowed) return json(res, 404, { error: "not offered on the pod" });
    return proxyHttp(req, res, FACE, sub + url.search);
  }
  if (p !== "/voices") return json(res, 404, { error: "not found" });
  return proxyHttp(req, res, VOICE, p);
});

// ---------- WebSockets ----------
// Piped as raw TCP after the handshake is forwarded, so frames pass through untouched.
// /ws = the conversation (mic in, TTS out, events). /facesrv/ws = face video + its own audio.
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://pod");
  const p = url.pathname;
  const deny = (code, why) => {
    socket.end(`HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${why}`);
  };
  let target, path;
  if (p === "/ws") [target, path] = [VOICE, "/ws"];
  else if (p === "/facesrv/ws" && FACE_ON) [target, path] = [FACE, "/ws"];
  else return deny(404, "no such socket");
  const a = admit(req, p === "/ws" ? "voice" : "face");
  if (!a.ok) return deny(a.code, a.why);
  const c = a.call;
  // One conversation socket per call: a second tab would talk over the first.
  if (p === "/ws" && [...c.sockets].some((s) => s.kind === "ws")) return deny(409, "this call already has a conversation open");

  const up = net.connect(target.port, target.host);
  socket.kind = p === "/ws" ? "ws" : "face";
  socket.setNoDelay(true);
  up.setNoDelay(true);
  up.on("connect", () => {
    const headers = { ...req.headers, host: `${target.host}:${target.port}` };
    delete headers.cookie;
    const lines = [`GET ${path} HTTP/1.1`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), "", ""];
    up.write(lines.join("\r\n"));
    if (head?.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  c.sockets.add(socket);
  if (socket.kind === "ws") {
    if (!c.firstConnectedAt) c.firstConnectedAt = now();
    if (!c.connectedAt || c.disconnectedAt) {
      c.connectedAt = now();
      c.disconnectedAt = null;
    }
  }
  const close = () => {
    up.destroy();
    socket.destroy();
    if (!c.sockets.delete(socket)) return;
    if (socket.kind === "ws" && pod.call === c) {
      c.connectedMs += now() - c.connectedAt;
      c.disconnectedAt = now(); // connectedAt stays set, so state() says busy through the grace period
    }
  };
  socket.on("close", close);
  socket.on("error", close);
  up.on("close", close);
  up.on("error", close);
});

server.listen(PORT, "0.0.0.0", () => console.log(`pod front on :${PORT} → voice :${VOICE.port}${FACE_ON ? `, face :${FACE.port}` : ""}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => (endCall("pod_stopped"), process.exit(0)));
