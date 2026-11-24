import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { createBrain } from "../lib/claude/brain.mjs";
import { cleanEnv, openClaude } from "../lib/claude/claude-proc.mjs";

/** A fake `claude` child speaking stream-json. `script(line, out)` reacts to each stdin line. */
function fakeChild(script) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit("close", 0);
  let buf = "";
  child.stdin.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      script(line, (o) => child.stdout.write(`${JSON.stringify(o)}\n`));
    }
  });
  return child;
}
const delta = (t) => ({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: t } } });

test("cleanEnv drops API keys and CLAUDE_ markers, keeps the config dir, switches CLAUDE.md off", () => {
  const e = cleanEnv({ ANTHROPIC_API_KEY: "k", CLAUDE_CODE_CHILD_SESSION: "1", CLAUDECODE: "1", CLAUDE_CONFIG_DIR: "/c", PATH: "/p" });
  assert.equal(e.ANTHROPIC_API_KEY, undefined);
  assert.equal(e.CLAUDE_CODE_CHILD_SESSION, undefined);
  assert.equal(e.CLAUDECODE, undefined);
  assert.equal(e.CLAUDE_CONFIG_DIR, "/c");
  assert.equal(e.PATH, "/p");
  assert.equal(e.CLAUDE_CODE_DISABLE_CLAUDE_MDS, "1");
});

test("openClaude: safe args, streams deltas, resolves at result, interrupt keeps the process", async () => {
  let seenArgs;
  const writes = [];
  const proc = openClaude({
    bin: "claude", systemPrompt: "You are Pip.", cwd: process.cwd(),
    spawnFn: (bin, args) => {
      seenArgs = args;
      return fakeChild((line, out) => {
        writes.push(line);
        if (line.type === "user") { out(delta("Hel")); out(delta("lo.")); if (line.message.content !== "long") out({ type: "result", is_error: false, result: "Hello." }); }
        if (line.type === "control_request") out({ type: "result", is_error: false, subtype: "error_during_execution" });
      });
    },
  });
  assert.ok(seenArgs.includes("--tools") && seenArgs[seenArgs.indexOf("--tools") + 1] === "");
  assert.ok(seenArgs.includes("--strict-mcp-config") && seenArgs.includes("--no-session-persistence"));
  assert.equal(seenArgs[seenArgs.indexOf("--system-prompt") + 1], "You are Pip.");
  const got = [];
  assert.deepEqual(await proc.send("hi", (d) => got.push(d)), {});
  assert.equal(got.join(""), "Hello.");

  const cut = [];
  const p2 = proc.send("long", (d) => cut.push(d));
  await new Promise((r) => setTimeout(r, 20));
  proc.interrupt();
  assert.deepEqual(await p2, {}); // interrupted turn is not an error
  assert.ok(proc.alive());
  assert.equal(writes.at(-1).request.subtype, "interrupt");
  const p3 = proc.send("long", () => {});
  await assert.rejects(proc.send("overlap", () => {}), /already running/);
  proc.interrupt();
  await p3;
  proc.close();
});

test("openClaude surfaces a failed turn", async () => {
  const proc = openClaude({
    bin: "claude", cwd: process.cwd(),
    spawnFn: () => fakeChild((line, out) => out({ type: "result", is_error: true, result: "Not logged in" })),
  });
  assert.deepEqual(await proc.send("hi", () => {}), { error: "Not logged in" });
});

/** Boots the brain's handler on a random port with a scripted fake proc; returns helpers. */
async function boot(onSend) {
  const opened = [];
  const brain = createBrain({
    settleMs: 300,
    open: ({ systemPrompt }) => {
      const p = {
        systemPrompt, sent: [], closed: false, interrupted: 0,
        alive: () => !p.closed, idle: () => Promise.resolve(), close: () => { p.closed = true; },
        interrupt: () => { p.interrupted++; },
        send: async (t, onDelta) => { p.sent.push(t); return onSend(t, onDelta, p); },
      };
      opened.push(p);
      return p;
    },
  });
  const server = createServer(brain.handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const ask = async (messages, init = {}) => {
    const r = await fetch(`${url}/v1/chat/completions`, { method: "POST", body: JSON.stringify({ stream: true, messages }), ...init });
    return { status: r.status, text: await r.text() };
  };
  return { opened, url, ask, stop: () => { brain.close(); server.close(); } };
}
const sys = { role: "system", content: "You are Pip." };
const contentOf = (sse) => sse.split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)).choices?.[0]?.delta?.content ?? "").join("");

test("brain: streams OpenAI chunks, sends only the newest user message, reuses the process", async () => {
  const b = await boot(async (t, onDelta) => { onDelta("Hi "); onDelta("there."); return {}; });
  const r1 = await b.ask([sys, { role: "user", content: "hello" }]);
  assert.equal(r1.status, 200);
  assert.equal(contentOf(r1.text), "Hi there.");
  assert.ok(r1.text.trimEnd().endsWith("data: [DONE]"));
  await b.ask([sys, { role: "user", content: "hello" }, { role: "assistant", content: "Hi there." }, { role: "user", content: "and you?" }]);
  assert.equal(b.opened.length, 1);
  assert.deepEqual(b.opened[0].sent, ["hello", "and you?"]);
  assert.equal(b.opened[0].systemPrompt, "You are Pip.");
  b.stop();
});

test("brain: a changed persona or a reset restarts claude, and a mid-conversation restart is seeded with the transcript", async () => {
  const b = await boot(async (t, onDelta) => { onDelta("ok."); return {}; });
  await b.ask([sys, { role: "user", content: "one" }]);
  await b.ask([{ role: "system", content: "You are Zed." }, { role: "user", content: "one" }, { role: "assistant", content: "ok." }, { role: "user", content: "two" }]);
  assert.equal(b.opened.length, 2);
  assert.equal(b.opened[1].systemPrompt, "You are Zed.");
  assert.match(b.opened[1].sent[0], /Earlier in this conversation:\nCaller: one\nYou: ok\./);
  assert.match(b.opened[1].sent[0], /The caller now says: two$/);
  await b.ask([{ role: "system", content: "You are Zed." }, { role: "user", content: "fresh" }]); // history reset
  assert.equal(b.opened.length, 3);
  assert.equal(b.opened[2].sent[0], "fresh");
  assert.ok(b.opened[0].closed && b.opened[1].closed);
  b.stop();
});

test("brain: a caller who disconnects mid-reply interrupts the turn", async () => {
  let release;
  const b = await boot((t, onDelta, p) => { onDelta("Once upon "); return new Promise((r) => { release = r; }); });
  const ac = new AbortController();
  const req = b.ask([sys, { role: "user", content: "story" }], { signal: ac.signal }).catch(() => {});
  await new Promise((r) => setTimeout(r, 100));
  ac.abort();
  await req;
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(b.opened[0].interrupted, 1);
  release({});
  b.stop();
});

test("brain: errors surface, remote hosts and browser origins are refused, keys are checked", async () => {
  const b = await boot(async () => ({ error: "Not logged in" }));
  const r = await b.ask([sys, { role: "user", content: "hi" }]);
  assert.match(r.text, /Not logged in/);
  assert.ok(b.opened[0].closed); // a failed process is replaced next time
  const origin = await fetch(`${b.url}/health`, { headers: { origin: "https://evil.example" } });
  assert.equal(origin.status, 403);
  assert.equal((await fetch(`${b.url}/health`)).status, 200);
  assert.equal((await b.ask([sys, { role: "assistant", content: "x" }])).status, 400);
  b.stop();

  const keyed = createBrain({ key: "s3cret", open: () => { throw new Error("unused"); } });
  const server = createServer(keyed.handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const u = `http://127.0.0.1:${server.address().port}/health`;
  assert.equal((await fetch(u)).status, 401);
  assert.equal((await fetch(u, { headers: { authorization: "Bearer s3cret" } })).status, 200);
  server.close();
});
