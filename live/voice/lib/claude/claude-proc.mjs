// A signed-in `claude -p` kept open across turns, the same technique Botswain's openClaude() uses:
// stream-json on stdin, stream-json on stdout, no tools, no MCP, an empty folder. The CLI's multi-second start-up is
// paid once per call. Differences from Botswain, each measured against the real CLI:
//   - --system-prompt replaces Claude Code's default prompt (the persona is the whole prompt, no coding-agent habits);
//   - the user's CLAUDE.md and auto-memory are switched off, so nothing private reaches strangers in a Discord channel;
//   - a turn can be interrupted over stdin (control_request) and the process stays alive, which a barge-in needs.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
};

/** Something spawnable without a shell, so the system prompt passes through untouched. npm's .cmd shim is swapped for the claude.exe it wraps. */
export function findClaude(env = process.env, platform = process.platform) {
  if (env.CLAUDE_BIN) return env.CLAUDE_BIN;
  if (platform !== "win32") return run("which", ["claude"])[0] ?? null;
  const hits = run("where.exe", ["claude"]);
  const exe = hits.find((p) => /\.exe$/i.test(p));
  if (exe) return exe;
  for (const p of hits) {
    const wrapped = join(dirname(p), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (existsSync(wrapped)) return wrapped;
  }
  return null;
}

/**
 * Children get a clean environment: inherited CLAUDE_* markers go (a bridge started from inside a Claude Code session
 * would otherwise inherit its flags), and so do API keys, so the call uses the user's signed-in login as intended.
 */
export function cleanEnv(base = process.env) {
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^(CLAUDE_|CLAUDECODE$)/.test(k) && k !== "CLAUDE_CONFIG_DIR") continue;
    if (k === "ANTHROPIC_API_KEY" || k === "ANTHROPIC_AUTH_TOKEN") continue;
    env[k] = v;
  }
  return { ...env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };
}

const MODEL_RE = /^[\w.:\-[\]/]+$/;

/**
 * @returns {{ send(text, onDelta): Promise<{error: string}|{}>, interrupt(): void, idle(): Promise<void>, alive(): boolean, close(): void }}
 */
export function openClaude({ bin, model = "haiku", effort = "low", systemPrompt, cwd, spawnFn = spawn }) {
  if (!bin) throw new Error("Claude Code was not found. Install it and sign in, or set CLAUDE_BIN.");
  if (model.startsWith("-") || !MODEL_RE.test(model)) throw new Error(`Not a model id: ${model}`);
  const dir = cwd ?? mkdtempSync(join(tmpdir(), "mirli-claude-brain-"));
  const args = [
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--model", model, "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence",
    "--permission-mode", "plan",
  ];
  if (effort) args.push("--effort", effort);
  if (systemPrompt) args.push("--system-prompt", systemPrompt);

  const child = spawnFn(bin, args, { cwd: dir, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  let buf = "";
  let closed = false;
  let cur = null; // { onDelta, resolve }
  const idleWaiters = [];
  const finish = (r) => {
    const c = cur;
    cur = null;
    c?.resolve(r);
    for (const w of idleWaiters.splice(0)) w();
  };

  child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-2000); });
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.type === "stream_event") {
        const delta = m.event?.delta;
        if (delta?.type === "text_delta" && delta.text && cur && !cur.interrupted) cur.onDelta(delta.text);
      } else if (m.type === "result") {
        // An interrupted turn ends in a result with no text; that is expected, not an error.
        finish(m.is_error && !cur?.interrupted ? { error: String(m.result || m.subtype || "Claude failed") } : {});
      }
    }
  });
  const died = (msg) => { closed = true; finish({ error: msg || stderr.trim() || "the claude process exited" }); };
  child.on("close", (code) => died(code ? stderr.trim() || `claude exited with ${code}` : "the claude process exited"));
  child.on("error", (e) => died(e.message));

  const write = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);
  return {
    send(text, onDelta) {
      if (closed) return Promise.resolve({ error: "the claude process has exited" });
      if (cur) return Promise.reject(new Error("a turn is already running"));
      return new Promise((resolve) => {
        cur = { onDelta, resolve, interrupted: false };
        write({ type: "user", message: { role: "user", content: text } });
      });
    },
    /** Stop the turn in progress; the process and its context stay. */
    interrupt() {
      if (!cur || cur.interrupted || closed) return;
      cur.interrupted = true;
      write({ type: "control_request", request_id: `int-${Date.now()}`, request: { subtype: "interrupt" } });
    },
    idle: () => (cur ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve()),
    alive: () => !closed,
    close() {
      if (closed) return;
      closed = true;
      try { child.stdin.end(); } catch { /* already gone */ }
      child.kill();
      finish({ error: "closed" });
    },
  };
}
