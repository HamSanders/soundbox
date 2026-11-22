// Tiny local token endpoint for santa-liveavatar.html: keeps LIVEAVATAR_API_KEY server-side.
// Reads the key from the env, or from C:\Users\antho\soundbox\.env.local (LIVEAVATAR_API_KEY=...). Never logs it.
//   node liveavatar-proxy.mjs                 serve on 17680
//   node liveavatar-proxy.mjs avatar talk.png  make the custom image avatar (prints its id; set LIVEAVATAR_AVATAR_ID)
// POST /session -> {session_id, livekit_url, livekit_client_token, ws_url}; POST /stop {session_id}.
// Docs: https://docs.liveavatar.com/docs/lite-mode/lifecycle.md, /api-reference/sessions/*.md
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const envFile = process.env.LIVEAVATAR_ENV_FILE || path.join(os.homedir(), "soundbox", ".env.local");
const fileEnv = {};
try { for (const l of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/); if (m) fileEnv[m[1]] = m[2]; } } catch {}
const get = (k) => process.env[k] || fileEnv[k] || "";
const KEY = get("LIVEAVATAR_API_KEY"), API = "https://api.liveavatar.com";
if (!KEY) { console.error("LIVEAVATAR_API_KEY is not set (env or " + envFile + ")"); process.exit(1); }

async function la(p, { body, token, form } = {}) {
  const headers = token ? { authorization: "Bearer " + token } : { "X-API-KEY": KEY };
  if (body) headers["content-type"] = "application/json";
  const r = await fetch(API + p, { method: body || form || token ? "POST" : "GET", headers, body: form || (body && JSON.stringify(body)) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p} ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j.data ?? j;
}

if (process.argv[2] === "avatar") {
  const file = process.argv[3], form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: file.endsWith(".png") ? "image/png" : "image/jpeg" }), path.basename(file));
  form.append("resolution", "720");
  const a = await la("/v1-alpha/avatars/image", { form });
  console.log("avatar", a.id ?? a.avatar_id, a.status);
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const s = await la("/v1/avatars/" + (a.id ?? a.avatar_id));
    console.log(s.status);
    if (s.status !== "INIT" && s.status !== "DEPLOYING") break;
  }
  process.exit(0);
}

const AVATAR = get("LIVEAVATAR_AVATAR_ID"), SANDBOX = get("LIVEAVATAR_SANDBOX") === "1", MAXS = +(get("LIVEAVATAR_MAX_S") || 120);
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" }); res.end(JSON.stringify(obj)); };
http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  let raw = ""; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  try {
    if (req.url === "/session") {
      const avatar_id = body.avatar_id || AVATAR;
      if (!avatar_id) throw new Error("no avatar: set LIVEAVATAR_AVATAR_ID");
      const t = await la("/v1/sessions/token", { body: { mode: "LITE", avatar_id, is_sandbox: SANDBOX, max_session_duration: MAXS } });
      const s = await la("/v1/sessions/start", { token: t.session_token });
      console.log("session", t.session_id, "sandbox", SANDBOX, "max", MAXS, "s; ws_url", s.ws_url ? "yes" : "NO");
      return send(res, 200, { session_id: t.session_id, livekit_url: s.livekit_url, livekit_client_token: s.livekit_client_token, ws_url: s.ws_url, max_session_duration: s.max_session_duration });
    }
    if (req.url === "/stop") { await la("/v1/sessions/stop", { body: { session_id: body.session_id, reason: "USER_CLOSED" } }); console.log("stopped", body.session_id); return send(res, 200, { ok: true }); }
    send(res, 404, { error: "not found" });
  } catch (e) { console.warn(e.message); send(res, 500, { error: e.message }); }
}).listen(17680, "127.0.0.1", () => console.log("liveavatar proxy on http://127.0.0.1:17680 (avatar " + (AVATAR ? "set" : "NOT set") + ")"));
