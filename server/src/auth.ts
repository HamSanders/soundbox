/**
 * An optional access token for a Soundbox reachable from other machines.
 *
 * Off by default: on a desktop the server listens on loopback only, and the
 * Host and CSRF checks in app.ts are what keep a web page from driving it. On
 * a rented GPU, a LAN box or anything behind a public address those checks are
 * not enough, because anyone who can reach the port is a legitimate client as
 * far as they can tell. `SOUNDBOX_API_TOKEN` closes that gap.
 *
 * With a token set, every request to `/api/`, `/mcp`, `/files/` and
 * `/artwork/` must prove it knows the token, one of two ways:
 *
 *   - `Authorization: Bearer <token>`, for scripts, MCP clients, the stdio
 *     bridge and another Soundbox using this one as a custom endpoint.
 *   - A session cookie, for the browser UI. The sign-in screen posts the token
 *     once to `/api/auth/login`, which sets an HttpOnly, SameSite=Strict
 *     cookie. A cookie is the only thing EventSource, `<audio src>` and plain
 *     fetches all carry without each call site having to add a header.
 *
 * The cookie holds an HMAC of the token, not the token: a cookie read off disk
 * cannot be replayed as a bearer token, and changing the token signs every
 * browser out.
 *
 * Left open on purpose: `GET /api/health` (the Docker health check and the
 * desktop app's startup probe call it, and it says nothing about the library),
 * the auth routes themselves, and the static UI, which is the same public
 * bundle anyone can download.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export const TOKEN_ENV = "SOUNDBOX_API_TOKEN";
export const SESSION_COOKIE = "soundbox_session";
/** Long enough that guessing it over the network is hopeless. */
export const MIN_TOKEN_LENGTH = 16;
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

/** Failed sign-ins allowed per client address in one window, before 429. */
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

export class TokenError extends Error {}

/**
 * The token from the environment, or null when none is set. Throws a
 * `TokenError` for one too short to be worth having, rather than starting a
 * server that looks protected and is not.
 */
export function tokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[TOKEN_ENV]?.trim();
  if (!raw) return null;
  if (raw.length < MIN_TOKEN_LENGTH) {
    throw new TokenError(
      `${TOKEN_ENV} is ${raw.length} characters; it needs at least ${MIN_TOKEN_LENGTH}. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return raw;
}

/** Paths that need the token when one is set. */
export function isProtectedPath(url: string): boolean {
  const path = url.split("?")[0]!;
  return (
    path.startsWith("/api/") ||
    path === "/mcp" ||
    path.startsWith("/mcp/") ||
    path.startsWith("/files/") ||
    path.startsWith("/artwork/")
  );
}

/** The few protected-prefix routes that stay open with a token set. */
function isOpenRoute(method: string, path: string): boolean {
  if (method === "GET" && path === "/api/health") return true;
  if (method === "GET" && path === "/api/auth/status") return true;
  if (method === "POST" && (path === "/api/auth/login" || path === "/api/auth/logout")) return true;
  return false;
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export class AccessGuard {
  private readonly session: string;
  private readonly failures = new Map<string, { count: number; since: number }>();

  constructor(private readonly token: string) {
    this.session = createHmac("sha256", token).update("soundbox-session-v1").digest("base64url");
  }

  /** True when the request carries the token or a valid session cookie. */
  authorised(request: FastifyRequest): boolean {
    const auth = request.headers.authorization;
    if (auth?.toLowerCase().startsWith("bearer ")) {
      return sameSecret(auth.slice(7).trim(), this.token);
    }
    const cookie = readCookie(request.headers.cookie, SESSION_COOKIE);
    return cookie !== null && sameSecret(cookie, this.session);
  }

  /** The onRequest check. Returns a reply when the request is refused. */
  check(request: FastifyRequest, reply: FastifyReply): FastifyReply | undefined {
    if (!isProtectedPath(request.url)) return undefined;
    if (isOpenRoute(request.method, request.url.split("?")[0]!)) return undefined;
    if (this.authorised(request)) return undefined;
    return reply
      .code(401)
      .header("WWW-Authenticate", 'Bearer realm="soundbox"')
      .send({
        detail:
          "This Soundbox needs its access token. Sign in from the app, or send " +
          "Authorization: Bearer <token>.",
      });
  }

  /** Too many wrong tokens from this address recently. */
  private limited(ip: string, now: number): boolean {
    const f = this.failures.get(ip);
    if (!f) return false;
    if (now - f.since > FAILURE_WINDOW_MS) {
      this.failures.delete(ip);
      return false;
    }
    return f.count >= MAX_FAILURES;
  }

  private recordFailure(ip: string, now: number): void {
    const f = this.failures.get(ip);
    if (!f || now - f.since > FAILURE_WINDOW_MS) this.failures.set(ip, { count: 1, since: now });
    else f.count += 1;
  }

  /** Sign in: the token for a session cookie. */
  login(request: FastifyRequest, reply: FastifyReply, given: unknown): FastifyReply {
    const now = Date.now();
    if (this.limited(request.ip, now)) {
      return reply.code(429).send({ detail: "Too many wrong tokens. Wait ten minutes and try again." });
    }
    if (typeof given !== "string" || !sameSecret(given.trim(), this.token)) {
      this.recordFailure(request.ip, now);
      return reply.code(401).send({ detail: "That is not this Soundbox's access token." });
    }
    this.failures.delete(request.ip);
    return reply
      .header("Set-Cookie", this.cookie(request, this.session, SESSION_MAX_AGE_S))
      .code(204)
      .send();
  }

  logout(request: FastifyRequest, reply: FastifyReply): FastifyReply {
    return reply.header("Set-Cookie", this.cookie(request, "", 0)).code(204).send();
  }

  private cookie(request: FastifyRequest, value: string, maxAge: number): string {
    // Secure only when the browser reached us over HTTPS, directly or through
    // a proxy that says so. A Secure cookie on plain http://<lan-ip> would be
    // dropped by the browser, and sign-in would silently never stick.
    const https =
      request.protocol === "https" ||
      String(request.headers["x-forwarded-proto"] ?? "").split(",")[0]!.trim() === "https";
    return [
      `${SESSION_COOKIE}=${value}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${maxAge}`,
      ...(https ? ["Secure"] : []),
    ].join("; ");
  }
}

/** The auth routes. `required: false` means no token is configured. */
export function registerAuth(app: FastifyInstance, guard: AccessGuard | null): void {
  app.get("/api/auth/status", async (request) => ({
    required: guard !== null,
    signed_in: guard === null ? true : guard.authorised(request),
  }));
  app.post("/api/auth/login", async (request, reply) => {
    if (!guard) return reply.code(204).send();
    return guard.login(request, reply, (request.body as { token?: unknown } | undefined)?.token);
  });
  app.post("/api/auth/logout", async (request, reply) => {
    if (!guard) return reply.code(204).send();
    return guard.logout(request, reply);
  });
}

/**
 * Headers for this machine's own calls to a running server (the CLI's `ps`
 * and `enhance`, the stdio MCP bridge): the bearer token when one is set in
 * the environment, nothing otherwise.
 */
export function bearerHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = env[TOKEN_ENV]?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
