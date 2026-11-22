// Per-call routing in the voice worker (lib/calls.mjs, lib/tap.mjs). `node --test test/`
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { sign } from "../../../live/api/token.mjs";
import { AuthError, CallGate, CallRoutes } from "../lib/calls.mjs";
import { PcmTap } from "../lib/tap.mjs";

/** Enough of a ws socket for the routing code. */
class FakeWs extends EventEmitter {
  readyState = 1;
  sent = [];
  closed = null;
  send(d) { this.sent.push(d); }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; this.emit("close"); }
  pcm() { return this.sent.filter((d) => Buffer.isBuffer(d)); }
}

test("each call's tap carries only that call's speech; the server-wide tap carries all", () => {
  const root = new PcmTap();
  const routes = new CallRoutes(root);
  const a = new FakeWs(), b = new FakeWs(), all = new FakeWs();
  routes.subscribe("A", a);
  routes.subscribe("B", b);
  root.addWs(all);
  routes.tap("A").pcm(Buffer.from([1, 1]));
  routes.tap("B").pcm(Buffer.from([2, 2]));
  assert.deepEqual(a.pcm(), [Buffer.from([1, 1])]);
  assert.deepEqual(b.pcm(), [Buffer.from([2, 2])]);
  assert.equal(all.pcm().length, 2);
});

test("barge-in on one call flushes only that call's subscribers", () => {
  const routes = new CallRoutes(new PcmTap());
  const a = new FakeWs(), b = new FakeWs();
  routes.subscribe("A", a);
  routes.subscribe("B", b);
  routes.tap("A").flush();
  const flushes = (ws) => ws.sent.filter((d) => typeof d === "string" && JSON.parse(d).type === "flush").length;
  assert.equal(flushes(a), 1);
  assert.equal(flushes(b), 0);
});

test("a second socket for the same call replaces the first (no doubled audio)", () => {
  const routes = new CallRoutes(new PcmTap());
  const first = new FakeWs(), second = new FakeWs();
  routes.attach("A", first);
  assert.equal(routes.attach("A", second), first);
  assert.equal(first.closed.code, 4000);
  assert.equal(routes.socket("A"), second);
  // The old socket's close must not unregister the new one.
  assert.deepEqual(routes.calls, ["A"]);
});

test("ending a call closes its socket and drops its tap once nobody listens", () => {
  const routes = new CallRoutes(new PcmTap());
  const ws = new FakeWs(), sub = new FakeWs();
  routes.attach("A", ws);
  routes.subscribe("A", sub);
  assert.equal(routes.end("A"), true);
  assert.equal(ws.closed.code, 4001);
  sub.close();
  return new Promise((r) => setTimeout(() => { assert.equal(routes.hasTap("A"), false); r(); }, 5));
});

const req = (headers = {}, url = "/ws") => ({ headers, url });

test("gate: with a secret, a valid token for the right audience is required", () => {
  const gate = new CallGate({ secret: "s", origins: [] });
  const tok = sign({ call: "c_9", aud: ["voice"] }, "s");
  assert.equal(gate.check(req({ "sec-websocket-protocol": `mirli.v1, bearer.${tok}` }), "voice").call, "c_9");
  assert.throws(() => gate.check(req(), "voice"), AuthError);
  assert.throws(() => gate.check(req({ "sec-websocket-protocol": `bearer.${tok}` }), "tap"), /wrong audience/);
  assert.throws(() => gate.check(req({ "sec-websocket-protocol": `bearer.${sign({ call: "x", aud: ["voice"] }, "other")}` }), "voice"), /bad signature/);
});

test("gate: admin tokens pass any audience", () => {
  const gate = new CallGate({ secret: "s", origins: [] });
  const tok = sign({ call: "c_1", aud: ["admin"] }, "s");
  assert.equal(gate.check(req({ authorization: `Bearer ${tok}` }), "tap").admin, true);
});

test("gate: origins are checked when a list is set", () => {
  const gate = new CallGate({ secret: null, origins: ["https://live.mirli.ai"] });
  assert.throws(() => gate.check(req({ origin: "https://evil.example" }), "voice"), /origin/);
  assert.ok(gate.check(req({ origin: "https://live.mirli.ai" }), "voice"));
});

test("gate: without a secret every socket is its own call (old spike pages keep working)", () => {
  const gate = new CallGate({ secret: null, origins: [] });
  const a = gate.check(req(), "voice"), b = gate.check(req(), "voice");
  assert.notEqual(a.call, b.call);
  assert.equal(gate.check(req({}, "/ws?call=fixed"), "voice").call, "fixed");
});
