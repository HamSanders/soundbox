// An OpenAI-shaped /v1/chat/completions endpoint backed by one kept-open signed-in `claude` process.
// The live voice server resends the whole conversation every turn; Claude keeps its own history, so only the newest
// user message is sent. If the system prompt (the persona) changes, or the history no longer lines up (a reset), the
// process is replaced and seeded with the transcript so far.

import { createHash } from "node:crypto";

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const text = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p?.text ?? "").join("") : "");
const chunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

export function createBrain({ open, key = "", log = () => {}, settleMs = 4000 }) {
  let proc = null;
  let sysHash = "";
  let userSeen = 0;
  let turn = 0;
  let inflight = Promise.resolve();

  const ensure = async (system, userCount, history) => {
    const hash = createHash("sha1").update(system).digest("hex");
    if (proc?.alive()) {
      // A turn cut short by a barge-in must finish unwinding before the next one is sent.
      const settled = await Promise.race([proc.idle().then(() => true), new Promise((r) => setTimeout(() => r(false), settleMs))]);
      if (!settled) { log("previous turn did not settle; restarting claude"); proc.close(); }
    }
    const inSync = proc?.alive() && hash === sysHash && userCount === userSeen + 1;
    if (inSync) return "";
    proc?.close();
    proc = open({ systemPrompt: system });
    sysHash = hash;
    userSeen = 0;
    log(proc ? "started a claude process" : "no claude process");
    // Seed a fresh process with what was said before this message.
    const before = history.slice(0, -1).map((m) => `${m.role === "user" ? "Caller" : "You"}: ${text(m.content)}`).join("\n");
    return before ? `Earlier in this conversation:\n${before.slice(-8000)}\n\nThe caller now says: ` : "";
  };

  async function chat(body, res, req) {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = messages.filter((m) => m.role === "system").map((m) => text(m.content)).join("\n\n");
    const history = messages.filter((m) => m.role === "user" || m.role === "assistant");
    const last = history.at(-1);
    if (!last || last.role !== "user") return json(res, 400, { error: "the last message must be from the user" });
    const userCount = history.filter((m) => m.role === "user").length;

    const prefix = await ensure(system, userCount, history);
    userSeen = userCount;
    if (res.destroyed) return log("caller was already gone; skipping the turn");
    const id = ++turn;
    const t0 = Date.now();
    let first = 0;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    let done = false;
    res.on("close", () => { if (!done) { log(`turn ${id}: caller cut it off`); proc?.interrupt(); } });
    const out = await proc.send(prefix + text(last.content), (d) => {
      if (!first) first = Date.now() - t0;
      if (!res.writableEnded) res.write(chunk({ content: d }));
    });
    done = true;
    log(`turn ${id}: first token ${first || "-"} ms, total ${Date.now() - t0} ms${out.error ? `, error: ${out.error}` : ""}`);
    if (out.error) {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ error: { message: out.error } })}\n\n`);
      proc?.close();
    } else if (!res.writableEnded) res.write(chunk({}, "stop"));
    if (!res.writableEnded) res.end("data: [DONE]\n\n");
  }

  function json(res, code, obj) {
    res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(obj));
  }

  /** node:http request handler. */
  const handler = (req, res) => {
    // Loopback only, and never from a web page: no Host spoofing, no browser Origin.
    if (!LOCAL_HOST.test(req.headers.host ?? "") || req.headers.origin) return json(res, 403, { error: "forbidden" });
    if (key && req.headers.authorization !== `Bearer ${key}`) return json(res, 401, { error: "bad key" });
    const path = new URL(req.url, "http://x").pathname;
    if (req.method === "GET" && path === "/health") return json(res, 200, { ok: true, running: !!proc?.alive() });
    if (req.method === "GET" && path === "/v1/models") return json(res, 200, { data: [{ id: "claude-brain", object: "model" }] });
    if (req.method !== "POST" || path !== "/v1/chat/completions") return json(res, 404, { error: "not found" });
    let raw = "";
    req.on("data", (d) => { raw += d; if (raw.length > 1_000_000) req.destroy(); });
    req.on("end", () => {
      let body;
      try { body = JSON.parse(raw); } catch { return json(res, 400, { error: "bad json" }); }
      // One turn at a time: a request waits for the one before it (which the caller has already abandoned).
      inflight = inflight.then(() => chat(body, res, req)).catch((e) => {
        log(`error: ${e.message}`);
        if (!res.headersSent) json(res, 500, { error: e.message });
        else if (!res.writableEnded) res.end("data: [DONE]\n\n");
      });
    });
  };

  return { handler, close: () => proc?.close() };
}
