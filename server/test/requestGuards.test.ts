import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApp, hostnameOf } from "../src/app.js";
import { Config } from "../src/config.js";
import { isListedHost } from "../src/origins.js";

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "konchi-guards-test-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("hostnameOf", () => {
  it("strips ports and keeps IPv6 brackets", () => {
    expect(hostnameOf("localhost:17494")).toBe("localhost");
    expect(hostnameOf("127.0.0.1")).toBe("127.0.0.1");
    expect(hostnameOf("[::1]:17494")).toBe("[::1]");
    expect(hostnameOf("Evil.Example:80")).toBe("evil.example");
  });
});

describe("Host header allowlist (DNS rebinding)", () => {
  for (const host of ["localhost", "localhost:5174", "127.0.0.1:17494", "[::1]:17494"]) {
    it(`serves ${host}`, async () => {
      const res = await app.inject({ method: "GET", url: "/api/health", headers: { host } });
      expect(res.statusCode).not.toBe(403);
    });
  }

  for (const host of ["evil.example", "evil.example:17494", "127.0.0.1.evil.example"]) {
    it(`refuses ${JSON.stringify(host)}`, async () => {
      const res = await app.inject({ method: "GET", url: "/api/health", headers: { host } });
      expect(res.statusCode).toBe(403);
    });
  }

  it("also allows a host the server was deliberately bound to", async () => {
    const lan = buildApp(new Config(dataDir), { serveUi: false, allowedHosts: ["192.168.1.20"] });
    await lan.ready();
    try {
      const ok = await lan.inject({
        method: "GET",
        url: "/api/health",
        headers: { host: "192.168.1.20:17494" },
      });
      expect(ok.statusCode).not.toBe(403);
      const bad = await lan.inject({ method: "GET", url: "/api/health", headers: { host: "evil.example" } });
      expect(bad.statusCode).toBe(403);
    } finally {
      await lan.close();
    }
  });
});

describe("Host header allowlist: KONCHI_ALLOWED_HOSTS", () => {
  // Bound to loopback behind Caddy or nginx, which forward the name the
  // browser used as Host. Before, only --host fed this check and the env var
  // was read for CORS and /mcp alone, so every request here was a 403.
  const health = (host: string) =>
    app.inject({ method: "GET", url: "/api/health", headers: { host } });

  afterEach(() => {
    delete process.env.KONCHI_ALLOWED_HOSTS;
  });

  it("serves a host listed without a port, on any port", async () => {
    process.env.KONCHI_ALLOWED_HOSTS = "Konchi.Example.lan, other.lan";
    expect((await health("konchi.example.lan")).statusCode).not.toBe(403);
    expect((await health("konchi.example.lan:8443")).statusCode).not.toBe(403);
    expect((await health("other.lan")).statusCode).not.toBe(403);
  });

  it("serves a host:port entry only on that port", async () => {
    process.env.KONCHI_ALLOWED_HOSTS = "192.168.1.20:17494";
    expect((await health("192.168.1.20:17494")).statusCode).not.toBe(403);
    expect((await health("192.168.1.20:8080")).statusCode).toBe(403);
    expect((await health("192.168.1.20")).statusCode).toBe(403);
  });

  it("still refuses names that are not listed, or only resemble one", async () => {
    process.env.KONCHI_ALLOWED_HOSTS = "konchi.example.lan";
    for (const host of ["evil.example", "evil-konchi.example.lan", "konchi.example.lan.evil.net"]) {
      expect((await health(host)).statusCode).toBe(403);
    }
  });

  it("refuses everything but loopback when unset", async () => {
    expect((await health("konchi.example.lan")).statusCode).toBe(403);
  });

  it("lets the same name through to /mcp", async () => {
    // Past the Host check, a body that is not `initialize` is a 400.
    const mcp = (host: string) =>
      app.inject({
        method: "POST",
        url: "/mcp",
        headers: { host, "content-type": "application/json", accept: "application/json, text/event-stream" },
        payload: "{}",
      });
    expect((await mcp("konchi.example.lan")).statusCode).toBe(403);
    process.env.KONCHI_ALLOWED_HOSTS = "konchi.example.lan";
    expect((await mcp("konchi.example.lan")).statusCode).toBe(400);
  });
});

describe("isListedHost", () => {
  afterEach(() => {
    delete process.env.KONCHI_ALLOWED_HOSTS;
  });

  it("parses the list the same way for every check", () => {
    process.env.KONCHI_ALLOWED_HOSTS = " a.lan ,B.LAN:8080,,[fd00::1]";
    expect(isListedHost("a.lan")).toBe(true);
    expect(isListedHost("A.lan:443")).toBe(true);
    expect(isListedHost("b.lan:8080")).toBe(true);
    expect(isListedHost("b.lan")).toBe(false);
    expect(isListedHost("[fd00::1]:17494")).toBe(true);
    expect(isListedHost("")).toBe(false);
  });
});

describe("CSRF: mutating /api requests", () => {
  it("refuses a body-less POST without the header", async () => {
    const res = await app.inject({ method: "POST", url: "/api/sessions" });
    expect(res.statusCode).toBe(403);
  });

  for (const ct of [
    "text/plain",
    "text/plain;charset=UTF-8",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
  ]) {
    it(`refuses a simple ${ct} POST`, async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { "content-type": ct },
        payload: "{}",
      });
      expect(res.statusCode).toBe(403);
    });
  }

  it("refuses a body-less DELETE without the header", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/sounds/nope" });
    expect(res.statusCode).toBe(403);
  });

  it("accepts a JSON POST", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("accepts a body-less POST carrying X-Konchi", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { "x-konchi": "1" },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it("leaves GETs alone", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
  });
});
