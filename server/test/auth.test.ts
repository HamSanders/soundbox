import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { bearerHeaders, isProtectedPath, MIN_TOKEN_LENGTH, tokenFromEnv } from "../src/auth.js";
import { Config } from "../src/config.js";

const TOKEN = "correct-horse-battery-staple-42";

describe("tokenFromEnv", () => {
  it("is null when unset or blank", () => {
    expect(tokenFromEnv({})).toBeNull();
    expect(tokenFromEnv({ SOUNDBOX_API_TOKEN: "   " })).toBeNull();
  });

  it("trims, and refuses one too short to protect anything", () => {
    expect(tokenFromEnv({ SOUNDBOX_API_TOKEN: `  ${TOKEN} ` })).toBe(TOKEN);
    expect(() => tokenFromEnv({ SOUNDBOX_API_TOKEN: "x".repeat(MIN_TOKEN_LENGTH - 1) })).toThrow(
      /at least 16/,
    );
  });

  it("gives the CLI and bridge a bearer header only when set", () => {
    expect(bearerHeaders({})).toEqual({});
    expect(bearerHeaders({ SOUNDBOX_API_TOKEN: TOKEN })).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });
});

describe("isProtectedPath", () => {
  it("covers the API, MCP and served files, not the UI", () => {
    for (const p of ["/api/settings", "/api/jobs/1/events?x=1", "/mcp", "/mcp/", "/files/a.wav", "/artwork/a.png"]) {
      expect(isProtectedPath(p)).toBe(true);
    }
    for (const p of ["/", "/index.html", "/assets/app.js", "/mcpx", "/apiary"]) {
      expect(isProtectedPath(p)).toBe(false);
    }
  });
});

describe("a server without a token", () => {
  let app: FastifyInstance;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "soundbox-auth-open-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("serves the API as before, and says no sign-in is needed", async () => {
    expect((await app.inject({ method: "GET", url: "/api/settings" })).statusCode).toBe(200);
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json()).toEqual({ required: false, signed_in: true });
  });
});

describe("a server with a token", () => {
  let app: FastifyInstance;
  let dataDir: string;
  const bearer = { authorization: `Bearer ${TOKEN}` };

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "soundbox-auth-token-"));
    app = buildApp(new Config(dataDir), { serveUi: false, apiToken: TOKEN });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("refuses the API, MCP and files without it", async () => {
    const api = await app.inject({ method: "GET", url: "/api/settings" });
    expect(api.statusCode).toBe(401);
    expect(api.headers["www-authenticate"]).toMatch(/^Bearer/);
    expect(api.json().detail).toMatch(/access token/);
    const mcp = await app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(mcp.statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/files/x.wav" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/artwork/x.png" })).statusCode).toBe(401);
  });

  it("refuses a wrong bearer token", async () => {
    const resp = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { authorization: `Bearer ${TOKEN}x` },
    });
    expect(resp.statusCode).toBe(401);
  });

  it("serves the API with the bearer token", async () => {
    expect((await app.inject({ method: "GET", url: "/api/settings", headers: bearer })).statusCode).toBe(200);
  });

  it("keeps the health check and sign-in status open", async () => {
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json()).toEqual({ required: true, signed_in: false });
    const withToken = await app.inject({ method: "GET", url: "/api/auth/status", headers: bearer });
    expect(withToken.json()).toEqual({ required: true, signed_in: true });
  });

  it("still answers a foreign Host header with forbidden host, not a sign-in prompt", async () => {
    const resp = await app.inject({ method: "GET", url: "/api/settings", headers: { host: "evil.example" } });
    expect(resp.statusCode).toBe(403);
  });

  it("signs a browser in with a cookie that is not the token", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { token: TOKEN } });
    expect(login.statusCode).toBe(204);
    const setCookie = String(login.headers["set-cookie"]);
    expect(setCookie).toMatch(/^soundbox_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
    expect(setCookie).not.toContain(TOKEN);
    expect(setCookie).not.toContain("Secure");

    const cookie = setCookie.split(";")[0]!;
    const resp = await app.inject({ method: "GET", url: "/api/settings", headers: { cookie } });
    expect(resp.statusCode).toBe(200);
    const status = await app.inject({ method: "GET", url: "/api/auth/status", headers: { cookie } });
    expect(status.json().signed_in).toBe(true);

    // The cookie value is no good as a bearer token.
    const value = cookie.split("=")[1]!;
    const asBearer = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { authorization: `Bearer ${value}` },
    });
    expect(asBearer.statusCode).toBe(401);
  });

  it("marks the cookie Secure behind an HTTPS proxy", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { token: TOKEN },
      headers: { "x-forwarded-proto": "https" },
    });
    expect(String(login.headers["set-cookie"])).toMatch(/; Secure$/);
  });

  it("signs out by expiring the cookie", async () => {
    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { "x-soundbox": "1" } });
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers["set-cookie"])).toMatch(/^soundbox_session=; .*Max-Age=0/);
  });

  it("refuses a wrong token at sign-in, then slows down a guesser", async () => {
    const wrong = await app.inject({ method: "POST", url: "/api/auth/login", payload: { token: "nope" } });
    expect(wrong.statusCode).toBe(401);
    for (let i = 0; i < 9; i++) {
      await app.inject({ method: "POST", url: "/api/auth/login", payload: { token: `nope${i}` } });
    }
    // Even the right token waits out the window once the limit is hit.
    const blocked = await app.inject({ method: "POST", url: "/api/auth/login", payload: { token: TOKEN } });
    expect(blocked.statusCode).toBe(429);
    // A bearer token is not a sign-in, and is not held up by it.
    expect((await app.inject({ method: "GET", url: "/api/settings", headers: bearer })).statusCode).toBe(200);
  });
});
