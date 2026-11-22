/**
 * Call tokens: short-lived, HMAC-SHA256 signed. The same format the call
 * workers verify (live/api/token.mjs for the voice worker,
 * spikes/realtime-face/call_token.py for the face worker) and the cloud
 * gateway signs:
 *
 *   base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, first part))
 *   payload = { v: 1, call, aud: ["voice", "face"], iat, exp }
 *
 * Locally the Mirli server and the workers share one secret file
 * (`~/.mirli-live/call-secret`, made on first use).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Audience = "voice" | "face" | "tap" | "admin";
export interface CallClaims { v: 1; call: string; aud: Audience[]; iat: number; exp: number; mode?: string }

const mac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest();

export function signCallToken(
  claims: { call: string; aud: Audience[]; mode?: string },
  secret: string,
  ttlS = 120,
  now = Date.now() / 1000,
): string {
  const iat = Math.floor(now);
  const head = Buffer.from(JSON.stringify({ v: 1, iat, exp: iat + ttlS, ...claims })).toString("base64url");
  return `${head}.${mac(secret, head).toString("base64url")}`;
}

export function verifyCallToken(token: string, secret: string, aud?: Audience, now = Date.now() / 1000): CallClaims {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("malformed token");
  const want = mac(secret, parts[0]);
  const got = Buffer.from(parts[1], "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new Error("bad signature");
  const p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as CallClaims;
  if (p.v !== 1 || !p.call) throw new Error("malformed token");
  if (p.exp + 5 < now) throw new Error("expired");
  if (aud && !p.aud.includes(aud) && !p.aud.includes("admin")) throw new Error("wrong audience");
  return p;
}

/** MIRLI_CALL_SECRET, else the shared file (created when missing). */
export function callSecret(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MIRLI_CALL_SECRET) return env.MIRLI_CALL_SECRET;
  const file = env.MIRLI_CALL_SECRET_FILE ?? join(homedir(), ".mirli-live", "call-secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dirname(file), { recursive: true });
  const s = randomBytes(32).toString("base64url");
  writeFileSync(file, s, { mode: 0o600 });
  return s;
}
