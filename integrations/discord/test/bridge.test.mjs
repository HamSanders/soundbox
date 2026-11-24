import assert from "node:assert/strict";
import { test } from "node:test";

import { WebSocketServer } from "ws";

import { SampleQueue, bytesToInt16, mono48kToStereoBytes, stereo48kToMono16k } from "../lib/audio.mjs";
import { Floor } from "../lib/floor.mjs";
import { LiveSocket } from "../lib/live.mjs";
import { CallSession } from "../lib/session.mjs";

test("stereo 48k -> mono 16k averages channels and groups of three", () => {
  // 3 stereo frames = 6 samples -> 1 output sample
  const out = stereo48kToMono16k(Int16Array.from([100, 200, 100, 200, 100, 200]));
  assert.deepEqual([...out], [150]);
  assert.equal(stereo48kToMono16k(new Int16Array(960 * 2)).length, 320); // one 20 ms Discord packet
});

test("mono -> stereo duplicates each sample and survives odd byte offsets", () => {
  const stereo = mono48kToStereoBytes(Buffer.from([1, 0, 2, 0]));
  assert.deepEqual([...stereo], [1, 0, 1, 0, 2, 0, 2, 0]);
  const odd = Buffer.concat([Buffer.from([9]), Buffer.from([5, 0, 6, 0])]).subarray(1);
  assert.deepEqual([...bytesToInt16(odd)], [5, 6]);
});

test("SampleQueue hands out exact frames, pads the tail, and bounds its length", () => {
  const q = new SampleQueue(1000);
  q.push(Int16Array.from({ length: 300 }, (_, i) => i));
  assert.equal(q.take(512), null);
  q.push(Int16Array.from({ length: 300 }, (_, i) => 300 + i));
  const f = q.take(512);
  assert.equal(f.length, 512);
  assert.equal(f[511], 511);
  const rest = q.drainPadded(512);
  assert.equal(rest[0], 512);
  assert.equal(rest[87], 599);
  assert.equal(rest[88], 0);
  assert.equal(q.length, 0);
  const b = new SampleQueue(500);
  b.push(new Int16Array(400));
  b.push(new Int16Array(400));
  assert.equal(b.length, 400); // oldest chunk dropped
});

test("Floor: first speaker holds it, others are ignored, it frees after the hold time", () => {
  let t = 0;
  const f = new Floor({ holdMs: 1000, now: () => t });
  assert.equal(f.hear("a"), true);
  t = 500;
  assert.equal(f.hear("b"), false);
  assert.equal(f.hear("a"), true);
  t = 1400; // 900 ms since a last spoke: still a's
  assert.equal(f.hear("b"), false);
  t = 2600; // freed
  assert.equal(f.hear("b"), true);
  assert.equal(new Floor({ allow: new Set(["x"]) }).hear("y"), false);
});

/** A fake live server speaking the spike's protocol: hello, then PCM + events. */
function fakeServer(onConn) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () =>
      resolve({ wss, url: `ws://127.0.0.1:${wss.address().port}/ws` }),
    );
    wss.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "hello", mic_rate: 16000, tts: { sample_rate: 48000, channels: 1 } }));
      onConn(ws);
    });
  });
}

test("session: mic frames are paced 512-sample frames, reply PCM reaches the player, flush and playback are reported", async () => {
  const mic = [];
  const controls = [];
  let serverWs;
  const { wss, url } = await fakeServer((ws) => {
    serverWs = ws;
    ws.on("message", (d, bin) => (bin ? mic.push(d) : controls.push(JSON.parse(d.toString()))));
  });
  const wrote = [];
  let flushed = 0;
  let session;
  const live = new LiveSocket(url, () => session.source());
  session = new CallSession({
    live,
    floor: new Floor({ holdMs: 200 }),
    out: { write: (b) => wrote.push(b), flush: () => flushed++ },
  });
  await live.connect();

  // 100 ms of a user talking: five 20 ms Discord packets (960 stereo frames each), constant value 3000
  for (let i = 0; i < 5; i++) session.onUserAudio("u1", new Int16Array(960 * 2).fill(3000));
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(mic.length >= 8, `expected paced frames, got ${mic.length}`);
  for (const f of mic) assert.equal(f.length, 1024); // 512 samples * 2 bytes
  const loud = mic.filter((f) => bytesToInt16(f).some((s) => s === 3000));
  assert.ok(loud.length >= 1 && loud.length <= 4, `speech frames: ${loud.length}`);

  serverWs.send(Buffer.alloc(7680 * 2)); // one 160 ms TTS chunk
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(wrote.length, 1);
  assert.equal(wrote[0].length, 7680 * 4);
  assert.deepEqual(controls.at(-1), { type: "playback", playing: true });

  serverWs.send(JSON.stringify({ type: "flush" }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(flushed, 1);
  assert.deepEqual(controls.at(-1), { type: "playback", playing: false });

  live.close();
  wss.close();
});

test("connect fails clearly when the server refuses", async () => {
  const live = new LiveSocket("ws://127.0.0.1:1/ws", () => null);
  live.on("error", () => {});
  await assert.rejects(live.connect());
});
