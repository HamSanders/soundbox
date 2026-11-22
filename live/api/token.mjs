// Call tokens: short-lived, HMAC-SHA256 signed, the same format in Node
// (this file) and Python (spikes/realtime-face/call_token.py).
//
//   token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, first part))
//   payload = { v: 1, call: "c_…", aud: ["voice", "face"], iat, exp }   (seconds)
//
// The Call API signs one per call; the voice and face workers verify it on
// connect. Locally the API and workers share a secret file; in the cloud the
// gateway holds the secret and hands it to each pod it starts.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const mac = (secret, data) => createHmac("sha256", secret).update(data).digest();

/** WebSocket subprotocols carry the token (browsers can't set headers on a WebSocket). */
export const WS_PROTOCOL = "mirli.v1";
export const TOKEN_PREFIX = "bearer.";

export function sign(payload, secret, ttlS = 120, now = Date.now() / 1000) {
  if (!secret) throw new Error("no call secret");
  const iat = Math.floor(now);
  const body = { v: 1, iat, exp: iat + ttlS, ...payload };
  const head = b64u(JSON.stringify(body));
  return `${head}.${b64u(mac(secret, head))}`;
}

/** Returns the payload, or throws with a short reason ("expired", "bad signature", "wrong audience"). */
export function verify(token, secret, { aud, now = Date.now() / 1000, leewayS = 5 } = {}) {
  if (typeof token !== "string") throw new Error("no token");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("malformed token");
  const want = mac(secret, parts[0]);
  const got = Buffer.from(parts[1], "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new Error("bad signature");
  let p;
  try { p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { throw new Error("malformed token"); }
  if (p.v !== 1 || typeof p.call !== "string" || !p.call) throw new Error("malformed token");
  if (typeof p.exp !== "number" || p.exp + leewayS < now) throw new Error("expired");
  if (aud && !(Array.isArray(p.aud) ? p.aud : [p.aud]).includes(aud)) throw new Error("wrong audience");
  return p;
}

/** The token from a WebSocket upgrade's Sec-WebSocket-Protocol header, or from Authorization: Bearer. */
export function tokenFromRequest(req) {
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const protos = String(req.headers["sec-websocket-protocol"] ?? "").split(",").map((s) => s.trim());
  const t = protos.find((p) => p.startsWith(TOKEN_PREFIX));
  return t ? t.slice(TOKEN_PREFIX.length) : null;
}

/** The local secret: env MIRLI_CALL_SECRET, else ~/.mirli-live/call-secret (created on first use when `create`). */
export function localSecret({ create = false } = {}) {
  if (process.env.MIRLI_CALL_SECRET) return process.env.MIRLI_CALL_SECRET;
  const file = process.env.MIRLI_CALL_SECRET_FILE ?? join(homedir(), ".mirli-live", "call-secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  if (!create) return null;
  mkdirSync(dirname(file), { recursive: true });
  const s = randomBytes(32).toString("base64url");
  writeFileSync(file, s, { mode: 0o600 });
  return s;
}

/** Origin allow-list: MIRLI_ALLOWED_ORIGINS (comma separated). Empty list = any origin (dev). */
export function allowedOrigins(env = process.env) {
  return (env.MIRLI_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
export function originAllowed(origin, list) {
  if (!list.length) return true;
  return !!origin && list.includes(origin);
}
