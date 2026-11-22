// Smoke test for pod.mjs with stub engines (no GPU, no models): node smoke.mjs
// Checks readiness, admin auth, claim → join → busy → second caller refused → leave → grace → ledger.
// Uses the `ws` package already installed for the voice spike (npm ci in ../realtime-voice first).

import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WebSocket, WebSocketServer } from "../realtime-voice/node_modules/ws/wrapper.mjs";

const VOICE = 18650, FACE = 18660, POD = 18680, SECRET = "smoke-secret", ADMIN = "smoke-admin";
const LEDGER = join(tmpdir(), `pod-smoke-${process.pid}.jsonl`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let faceReady = false;
// A face dir with one baked portrait and one caller upload: the upload must be gone after the call.
const FACE_HOME = join(tmpdir(), `pod-smoke-face-${process.pid}`), BAKED = join(FACE_HOME, "baked");
mkdirSync(join(FACE_HOME, "faces"), { recursive: true });
mkdirSync(BAKED, { recursive: true });
for (const f of ["faces/default.png", "baked/default.png", "faces/upload-1.png"]) writeFileSync(join(FACE_HOME, f), "x");

function stub(port, routes, onWs) {
  const s = http.createServer((req, res) => {
    const r = routes[new URL(req.url, "http://x").pathname];
    if (!r) return res.writeHead(404).end();
    const [type, body] = r();
    res.writeHead(200, { "Content-Type": type }).end(body);
  });
  const wss = new WebSocketServer({ server: s });
  wss.on("connection", onWs);
  return new Promise((r) => s.listen(port, "127.0.0.1", r));
}
await stub(VOICE, { "/metrics": () => ["application/json", "{}"], "/index.html": () => ["text/html", "<p>call page</p>"] },
  (ws) => ws.on("message", (d, bin) => ws.send(d, { binary: bin }))); // echo, like mic in → audio out
await stub(FACE, { "/stats": () => ["application/json", JSON.stringify({ ready: faceReady, engine: "stub" })], "/flush": () => ["application/json", "{}"] },
  (ws) => ws.send("frame"));

const pod = spawn(process.execPath, ["pod.mjs"], {
  cwd: import.meta.dirname,
  env: { ...process.env, POD_PORT: POD, SPIKE_PORT: VOICE, FACE_HTTP_PORT: FACE, POD_SECRET: SECRET, POD_ADMIN_TOKEN: ADMIN,
    POD_LEDGER: LEDGER, POD_RECONNECT_GRACE_S: "2", POD_CLAIM_TTL_S: "3",
    MIRLI_FACE_HOME: FACE_HOME, POD_BAKED_FACES: BAKED, POD_UPLOAD_CLEANUP_MS: "100" },
  stdio: ["ignore", "inherit", "inherit"],
});
process.on("exit", () => pod.kill());

const base = `http://127.0.0.1:${POD}`;
const get = async (path, opts = {}) => {
  const r = await fetch(base + path, opts);
  const text = await r.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, headers: r.headers };
};
const admin = (path, body) => get(path, { method: "POST", headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
const token = (id, ttl = 600) => {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return `v1.${id}.${exp}.${createHmac("sha256", SECRET).update(`mirli-call:${id}:${exp}`).digest("base64url")}`;
};
const wsOpen = (path, t) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${POD}${path}${t ? `?t=${t}` : ""}`);
  ws.once("open", () => resolve({ ws, ok: true }));
  ws.once("unexpected-response", (_req, res) => resolve({ ok: false, status: res.statusCode }));
  ws.once("error", () => resolve({ ok: false }));
});

let failed = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? `  (${extra})` : ""}`);
  if (!cond) failed++;
};

await sleep(1500);
check("healthz up while engines load", (await get("/healthz")).status === 200);
check("readyz 503 while the face loads", (await get("/readyz")).status === 503);
faceReady = true;
await sleep(1500);
let r = await get("/readyz");
check("readyz 200 when free", r.status === 200 && r.body.state === "free", JSON.stringify(r.body));
check("/state needs the admin token", (await get("/state")).status === 401);
check("page refused without a token", (await get("/")).status === 401);
check("bad token refused", (await get("/?t=v1.x.9999999999.AAAA")).status === 401);
check("expired token refused", (await get(`/?t=${token("old", -10)}`)).status === 401);

r = await admin("/claim", { call_id: "call-a" });
check("claim free pod", r.status === 200 && r.body.state === "reserved");
check("claim is idempotent", (await admin("/claim", { call_id: "call-a" })).status === 200);
check("second claim refused", (await admin("/claim", { call_id: "call-b" })).status === 409);
check("readyz 503 when reserved", (await get("/readyz")).status === 503);
check("other call's token refused", (await get(`/?t=${token("call-b")}`)).status === 409);

r = await get(`/?t=${token("call-a")}`);
check("caller gets the page and a cookie", r.status === 200 && /call page/.test(r.body) && /mirli_call=/.test(r.headers.get("set-cookie") ?? ""));
const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
check("cookie alone is enough afterwards", (await get("/index.html", { headers: { cookie } })).status === 200);

const a = await wsOpen("/ws", token("call-a"));
check("conversation socket opens", a.ok);
const echoed = await new Promise((res) => { a.ws.once("message", (d) => res(String(d))); a.ws.send("mic"); });
check("frames pass through the proxy", echoed === "mic");
const f = await wsOpen("/facesrv/ws", token("call-a"));
check("face socket opens", f.ok);
r = await get("/readyz");
check("busy while connected", r.status === 503 && r.body.state === "busy", JSON.stringify(r.body));
const dup = await wsOpen("/ws", token("call-a"));
check("second conversation socket refused", !dup.ok && dup.status === 409, `status ${dup.status}`);
check("engine switching not offered", (await get("/facesrv/engine", { method: "POST", headers: { cookie } })).status === 404);

await sleep(1200);
a.ws.close(); f.ws.close();
await sleep(500);
check("still busy in the reconnect grace", (await get("/readyz")).body.state === "busy");
await sleep(3000);
r = await get("/readyz");
check("free after the grace period", r.status === 200 && r.body.state === "free", JSON.stringify(r.body));
const led = readFileSync(LEDGER, "utf8").trim().split("\n").map((l) => JSON.parse(l));
check("ledger row written", led.length === 1 && led[0].call_id === "call-a" && led[0].reason === "caller_left" && led[0].connected_s >= 1, JSON.stringify(led[0]));

check("caller upload deleted, baked portrait kept", !existsSync(join(FACE_HOME, "faces/upload-1.png")) && existsSync(join(FACE_HOME, "faces/default.png")));

r = await admin("/claim", { call_id: "call-c" });
await sleep(4500);
check("unused claim expires", (await get("/readyz")).body.state === "free");

const d = await get(`/?t=${token("call-d")}`);
check("direct join binds a free pod", d.status === 200 && (await get("/readyz")).body.state === "reserved");
r = await admin("/release", { call_id: "call-d", reason: "gateway_ended" });
check("release frees it", r.body.state === "free" && r.body.last_call?.reason === "gateway_ended");
await admin("/drain", {});
check("draining pod is not ready", (await get("/readyz")).body.state === "draining");
check("draining pod refuses new callers", (await get(`/?t=${token("call-e")}`)).status === 409);

rmSync(LEDGER, { force: true });
rmSync(FACE_HOME, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
