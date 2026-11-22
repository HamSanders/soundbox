// The Call API contract and per-call routing, at the protocol level (no browser).
import { expect, test } from "@playwright/test";
import WebSocket from "ws";

import { sign } from "../api/token.mjs";
import { PORTS, SECRET } from "./playwright.config.mjs";

const API = `http://127.0.0.1:${PORTS.api}`;
const ORIGIN = `http://127.0.0.1:${PORTS.web}`;
const api = (method, path, body) =>
  fetch(API + path, { method, headers: { Origin: ORIGIN, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body && JSON.stringify(body) });

/** Open a socket with the call token as subprotocol; collect what arrives. */
function connect(url, token) {
  const ws = new WebSocket(url, token ? ["mirli.v1", `bearer.${token}`] : []);
  const got = { json: [], chunks: [], close: null, error: null };
  ws.on("message", (d, bin) => {
    if (!bin) return got.json.push(JSON.parse(d.toString()));
    // Face chunks: u32 header length + JSON header + PCM + JPEGs. The voice worker's binary is raw PCM.
    if (d.length < 8) return;
    const hl = d.readUInt32LE(0);
    if (hl > 4096 || 4 + hl > d.length) return;
    try { got.chunks.push(JSON.parse(d.subarray(4, 4 + hl).toString())); } catch { /* raw PCM */ }
  });
  ws.on("close", (code) => (got.close = code));
  ws.on("error", (e) => (got.error = e.message));
  const open = new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); ws.once("unexpected-response", (_q, r) => rej(new Error(`HTTP ${r.statusCode}`))); });
  return { ws, got, open };
}
const until = async (fn, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 50)); } };
const speech = (got) => got.chunks.filter((c) => c.kind === "speech" && !c.cont).length;

test.afterEach(async () => {
  // Leave no call behind for the next test (the local API allows one at a time).
  const h = await (await api("GET", "/v1/health")).json();
  expect(h).toBeTruthy();
});

test("POST /v1/calls returns the contract; DELETE ends it on both workers", async () => {
  const r = await api("POST", "/v1/calls", { mode: "video", character: "Ben-e2e00002" });
  expect(r.status).toBe(201);
  const c = await r.json();
  expect(Object.keys(c)).toEqual(expect.arrayContaining(["call_id", "ws_url", "face_ws_url", "token", "expires", "heartbeat_s", "persona"]));
  expect(c.ws_url).toBe(`ws://127.0.0.1:${PORTS.voice}/ws`);
  expect(c.face_ws_url).toBe(`ws://127.0.0.1:${PORTS.face}/ws`);
  expect(c.persona).toContain("You are Ben");

  const voice = connect(c.ws_url, c.token), face = connect(c.face_ws_url, c.token);
  await Promise.all([voice.open, face.open]);
  await until(() => voice.got.json.some((m) => m.type === "hello"));
  expect(voice.got.json.find((m) => m.type === "hello").call).toBe(c.call_id);

  const beat = await (await api("POST", `/v1/calls/${c.call_id}/heartbeat`)).json();
  expect(beat.token).toBeTruthy();

  const end = await api("DELETE", `/v1/calls/${c.call_id}`);
  expect(end.status).toBe(200);
  await until(() => voice.got.close !== null && face.got.close !== null);
  expect(voice.got.close).toBe(4001);
  expect(face.got.close).toBe(4001);
  expect((await api("DELETE", `/v1/calls/${c.call_id}`)).status).toBe(404);
});

test("workers refuse sockets without a valid token", async () => {
  await expect(connect(`ws://127.0.0.1:${PORTS.voice}/ws`).open).rejects.toThrow(/401/);
  await expect(connect(`ws://127.0.0.1:${PORTS.face}/ws`).open).rejects.toThrow(/401/);
  await expect(connect(`ws://127.0.0.1:${PORTS.voice}/ws`, sign({ call: "x", aud: ["voice"] }, "wrong-secret")).open).rejects.toThrow(/401/);
  // A voice-only token does not open the face.
  await expect(connect(`ws://127.0.0.1:${PORTS.face}/ws`, sign({ call: "x", aud: ["voice"] }, SECRET)).open).rejects.toThrow(/401/);
});

test("one call at a time locally: a second POST is busy until the first ends", async () => {
  const a = await (await api("POST", "/v1/calls", { mode: "voice" })).json();
  const b = await api("POST", "/v1/calls", { mode: "voice" });
  expect(b.status).toBe(409);
  expect((await b.json()).error.code).toBe("busy");
  await api("DELETE", `/v1/calls/${a.call_id}`);
  const c = await api("POST", "/v1/calls", { mode: "voice" });
  expect(c.status).toBe(201);
  await api("DELETE", `/v1/calls/${(await c.json()).call_id}`);
});

test("the face sends a call's frames to that call only: no cross-talk, no doubled audio", async () => {
  const c = await (await api("POST", "/v1/calls", { mode: "video", character: "Ada-e2e00001" })).json();
  const voiceA = connect(c.ws_url, c.token);
  const faceA1 = connect(c.face_ws_url, c.token);
  await Promise.all([voiceA.open, faceA1.open]);
  await until(() => voiceA.got.json.some((m) => m.type === "hello"));

  // Another call (minted directly, as a second machine's gateway would) talks on the same voice worker.
  const other = sign({ call: "c_other", aud: ["voice", "face"] }, SECRET);
  const voiceB = connect(c.ws_url, other);
  await voiceB.open;
  await until(() => voiceB.got.json.some((m) => m.type === "hello"));

  // The face is busy with call A: B's face socket is refused with 4409.
  const faceB = connect(c.face_ws_url, other);
  await faceB.open;
  await until(() => faceB.got.close !== null);
  expect(faceB.got.close).toBe(4409);

  // B speaks: A's face must not lip-sync it.
  voiceB.ws.send(JSON.stringify({ type: "text", text: "this is call B" }));
  await until(() => voiceB.got.json.some((m) => m.type === "turn"));
  await new Promise((r) => setTimeout(r, 1500));
  expect(speech(faceA1.got)).toBe(0);

  // A speaks: A's face does.
  voiceA.ws.send(JSON.stringify({ type: "text", text: "this is call A" }));
  await until(() => speech(faceA1.got) > 0);

  // A second face socket for call A (a reload, a duplicate tab) replaces the first.
  const faceA2 = connect(c.face_ws_url, c.token);
  await faceA2.open;
  await until(() => faceA1.got.close !== null);
  expect(faceA1.got.close).toBe(4000);
  const before = faceA1.got.chunks.length;
  voiceA.ws.send(JSON.stringify({ type: "text", text: "again" }));
  await until(() => speech(faceA2.got) > 0);
  expect(faceA1.got.chunks.length).toBe(before); // the replaced socket hears nothing more: one copy of the audio

  voiceB.ws.close();
  await api("DELETE", `/v1/calls/${c.call_id}`);
});

test("CORS: only our web origin may call the API", async () => {
  const bad = await fetch(`${API}/v1/health`, { headers: { Origin: "https://evil.example" } });
  expect(bad.status).toBe(403);
  const good = await fetch(`${API}/v1/health`, { headers: { Origin: ORIGIN } });
  expect(good.headers.get("access-control-allow-origin")).toBe(ORIGIN);
});
