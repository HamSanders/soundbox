import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { WebSocketServer } from "ws";

import { LiveSocket } from "../lib/live.mjs";
import { MirliError, applyGrant, cached, choices, mirliClient, resolveId, setVoice } from "../lib/mirli.mjs";

test("mirliClient calls the Call API with X-Soundbox and reports its errors", async () => {
  const seen = [];
  const fake = async (url, init) => {
    seen.push({ url: String(url), method: init.method, headers: init.headers, body: init.body && JSON.parse(init.body) });
    if (String(url).endsWith("/api/calls") && init.method === "POST") {
      return { ok: false, status: 409, json: async () => ({ error: { code: "busy", message: "A call is already running on this machine. End it first." } }) };
    }
    if (String(url).endsWith("/api/characters")) return { ok: true, status: 200, json: async () => ({ characters: [{ id: "santa", name: "Santa" }] }) };
    if (init.method === "DELETE") return { ok: true, status: 204, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ voices: [{ id: "v1", name: "Brit" }] }) };
  };
  const m = mirliClient("http://127.0.0.1:17494/", fake);
  assert.deepEqual((await m.characters()).map((c) => c.id), ["santa"]);
  assert.equal((await m.voices())[0].name, "Brit");
  await assert.rejects(m.startCall("Santa"), (e) => e instanceof MirliError && e.status === 409 && /already running/.test(e.message));
  assert.deepEqual(seen[2].body, { character: "Santa" });
  assert.equal(seen[2].headers["X-Soundbox"], "1");
  assert.equal(await m.endCall("c_1"), undefined);
  assert.equal(seen[3].url, "http://127.0.0.1:17494/api/calls/c_1");

  const down = mirliClient("http://127.0.0.1:1", async () => { throw new Error("ECONNREFUSED"); });
  await assert.rejects(down.status(), /Can't reach Mirli/);
});

test("choices filters by substring, sorts, and caps at 25", () => {
  const items = [{ id: "a", name: "pig" }, { id: "b", name: "Brit" }, { id: "c", name: "Big Bird" }, null];
  assert.deepEqual(choices(items, "bi").map((c) => c.name), ["Big Bird"]);
  assert.deepEqual(choices(items).map((c) => c.name), ["Big Bird", "Brit", "pig"]);
  assert.equal(choices(Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, name: `v${i}` }))).length, 25);
  assert.equal(choices([{ id: "x", name: "n".repeat(300) }])[0].name.length, 100);
});

test("resolveId takes an id or a typed name", () => {
  const v = [{ id: "abc", name: "Brit" }];
  assert.equal(resolveId(v, "abc"), "abc");
  assert.equal(resolveId(v, " brit "), "abc");
  assert.equal(resolveId(v, "nobody"), "nobody");
});

test("cached serves the stale list instantly and survives a failed refresh", async () => {
  let fail = false;
  let n = 0;
  const get = cached(async () => { n++; if (fail) throw new Error("down"); return [1]; }, 0);
  assert.deepEqual(await get(), [1]);
  fail = true;
  assert.deepEqual(await get(), [1]);
  const once = cached(async () => { n++; return [2]; }, 10_000);
  const before = n;
  await once();
  await once();
  assert.equal(n - before, 1);
});

test("setVoice resolves with the worker's answer, or the error, or times out", async () => {
  const live = Object.assign(new EventEmitter(), {
    control(m) { this.sent = m; queueMicrotask(() => (m.id === "ok" ? this.emit("voice", { id: "ok", name: "Brit" }) : m.id === "bad" ? this.emit("error", { message: "That voice is no longer in Mirli." }) : null)); },
  });
  assert.deepEqual(await setVoice(live, "ok"), { name: "Brit" });
  assert.deepEqual(await setVoice(live, "bad"), { error: "That voice is no longer in Mirli." });
  assert.deepEqual(await setVoice(live, "silent", 30), { error: "the live server did not answer" });
  assert.equal(live.listenerCount("voice") + live.listenerCount("error"), 0);
});

test("applyGrant sends the persona, then the granted voice or an override", async () => {
  const sent = [];
  const live = Object.assign(new EventEmitter(), {
    control(m) { sent.push(m); if (m.type === "voice") queueMicrotask(() => this.emit("voice", { id: m.id, name: m.id.toUpperCase() })); },
  });
  assert.deepEqual(await applyGrant(live, { persona: "You are Santa.", voice_id: "v-santa" }), { voiceName: "V-SANTA" });
  assert.deepEqual(sent.slice(0, 2), [{ type: "persona", text: "You are Santa." }, { type: "voice", id: "v-santa" }]);
  assert.deepEqual(await applyGrant(live, { persona: "p", voice_id: "v-santa" }, "brit"), { voiceName: "BRIT" });
  assert.deepEqual(await applyGrant(live, { persona: "p", voice_id: null }), {});
});

test("LiveSocket sends the call token as the worker's subprotocols", async () => {
  const wss = new WebSocketServer({ port: 0, handleProtocols: (set) => (set.has("mirli.v1") ? "mirli.v1" : false) });
  await new Promise((r) => wss.once("listening", r));
  let protocols;
  wss.on("connection", (ws, req) => {
    protocols = req.headers["sec-websocket-protocol"];
    ws.send(JSON.stringify({ type: "hello", tts: { sample_rate: 48000 } }));
  });
  const live = new LiveSocket(`ws://127.0.0.1:${wss.address().port}/ws`, () => null, { token: "abc.def" });
  try {
    const hello = await live.connect();
    assert.equal(hello.tts.sample_rate, 48000);
    assert.deepEqual(protocols.split(",").map((s) => s.trim()), ["mirli.v1", "bearer.abc.def"]);
  } finally {
    live.close();
    wss.close();
  }
});
