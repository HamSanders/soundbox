import assert from "node:assert/strict";
import { test } from "node:test";

import { BusyError, CallRegistry, NotFoundError } from "../calls.mjs";
import { toCharacters, SANTA_ID } from "../characters.mjs";

const clock = (t = 1000) => { const c = { t, now: () => c.t }; return c; };

test("one call at a time locally; the second is refused as busy", () => {
  const reg = new CallRegistry({ maxCalls: 1, now: clock().now });
  const a = reg.create({ mode: "video" });
  assert.match(a.id, /^c_/);
  assert.throws(() => reg.create({ mode: "voice" }), BusyError);
  reg.end(a.id);
  assert.ok(reg.create({ mode: "voice" }).id);
});

test("a call without heartbeats lapses and frees the slot; seconds are billed to the last beat", () => {
  const c = clock();
  const reg = new CallRegistry({ maxCalls: 1, heartbeatTimeoutS: 30, now: c.now });
  const a = reg.create();
  c.t += 20; reg.heartbeat(a.id);
  c.t += 100; // the tab vanished at t=1020
  const b = reg.create(); // reaps a, then succeeds
  assert.ok(b.id);
  const row = reg.ledger().find((r) => r.call === a.id);
  assert.equal(row.reason, "lapsed");
  assert.equal(row.seconds, 50); // 20 s talking + the 30 s grace, not the 120 s until someone noticed
});

test("calls are capped at maxCallS even with heartbeats", () => {
  const c = clock();
  const reg = new CallRegistry({ heartbeatTimeoutS: 30, maxCallS: 60, now: c.now });
  const a = reg.create();
  for (let i = 0; i < 10; i++) { c.t += 10; if (i < 5) reg.heartbeat(a.id); }
  assert.equal(reg.reap().length, 1);
  assert.throws(() => reg.get(a.id), NotFoundError);
});

test("hang up books the seconds used", () => {
  const c = clock();
  const reg = new CallRegistry({ now: c.now });
  const a = reg.create({ mode: "voice" });
  c.t += 42;
  assert.equal(reg.end(a.id).seconds, 42);
  assert.equal(reg.secondsUsed(), 42);
  assert.throws(() => reg.end(a.id), NotFoundError);
});

test("bad mode is a TypeError", () => {
  assert.throws(() => new CallRegistry().create({ mode: "hologram" }), TypeError);
});

test("characters: named first, uploads next, the sample last; Santa gets his persona", () => {
  const list = toCharacters([{ id: "girl", name: "girl" }, { id: "image3-abc", name: "image3" }, { id: SANTA_ID, name: "0fea" }, { id: "Mei-1", name: "Mei" }]);
  assert.deepEqual(list.map((c) => c.name), ["Santa", "Mei", "Mirli", "Mirli"]);
  assert.deepEqual(list.map((c) => c.kind), ["character", "character", "upload", "sample"]);
  assert.match(list[0].persona, /Santa Claus/);
  assert.match(list[1].persona, /You are Mei/);
});
