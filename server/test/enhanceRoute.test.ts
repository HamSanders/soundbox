import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";

let app: FastifyInstance;
let dataDir: string;
let stub: Server;
let stubUrl: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "konchi-enhance-test-"));
  const config = new Config(dataDir);
  app = buildApp(config, { serveUi: false });
  await app.ready();

  // A minimal OpenAI-compatible stub — enough for the external-mode path.
  stub = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            { message: { content: '{"variations": ["a stub prompt"], "tags": ["door", "impact"]}' } },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const address = stub.address();
  const port = typeof address === "object" && address ? address.port : 0;
  stubUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app.close();
  await new Promise((resolve) => stub.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

afterEach(async () => {
  // Reset to "off" between tests so they don't leak state into each other.
  await app.inject({ method: "PATCH", url: "/api/settings", payload: { llm_mode: "off" } });
});

describe("POST /api/enhance", () => {
  it("400s when the assistant is off", async () => {
    const resp = await app.inject({ method: "POST", url: "/api/enhance", payload: { prompt: "x" } });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().detail).toMatch(/off/i);
  });

  it("422s on a missing prompt", async () => {
    const resp = await app.inject({ method: "POST", url: "/api/enhance", payload: {} });
    expect(resp.statusCode).toBe(422);
  });

  it("returns variations from an external endpoint", async () => {
    await app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: {
        llm_mode: "external",
        llm_external_base_url: stubUrl,
        llm_external_model: "stub-model",
      },
    });
    const resp = await app.inject({
      method: "POST",
      url: "/api/enhance",
      payload: { prompt: "scary sound" },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json()).toEqual({ variations: ["a stub prompt"], tags: ["door", "impact"] });
  });

  it("400s when external mode is on but unconfigured", async () => {
    await app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: { llm_mode: "external", llm_external_base_url: "", llm_external_model: "" },
    });
    const resp = await app.inject({ method: "POST", url: "/api/enhance", payload: { prompt: "x" } });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().detail).toMatch(/isn't configured/i);
  });
});

describe("GET /api/llm/status", () => {
  it("reports the catalog and current mode", async () => {
    const resp = await app.inject({ method: "GET", url: "/api/llm/status" });
    expect(resp.statusCode).toBe(200);
    const body = resp.json();
    expect(body.mode).toBe("off");
    expect(Array.isArray(body.catalog)).toBe(true);
    expect(body.catalog.length).toBeGreaterThan(0);
  });
});
