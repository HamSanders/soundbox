/**
 * Hosted mode (MIRLI_HOSTED=1): sandboxed (host-touching routes refused, host
 * settings locked, simple setup) and signed in to Mirli Cloud from the
 * environment. The idle exit is idle.ts, tested in idleExit.test.ts.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";

const ENV = { MIRLI_HOSTED: "1", MIRLI_CLOUD_TOKEN: "mirli_dev_hosted", MIRLI_CLOUD_URL: "http://127.0.0.1:9" };

describe("hosted app", () => {
  let dataDir: string;
  let app: FastifyInstance;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    dataDir = await mkdtemp(join(tmpdir(), "mirli-hosted-test-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  it("refuses folder browsing and model downloads", async () => {
    const fs = await app.inject({ method: "GET", url: "/api/fs/dirs" });
    expect(fs.statusCode).toBe(403);
    const dl = await app.inject({ method: "POST", url: "/api/models/x/download", headers: { "x-soundbox": "1" } });
    expect(dl.statusCode).toBe(403);
  });

  it("ignores attempts to change host settings, keeps the rest", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { "content-type": "application/json" },
      payload: { sounds_dir: "C:/Windows", trim_silence: false },
    });
    expect(r.statusCode).toBe(200);
    const s = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(s.sounds_dir).not.toContain("Windows");
    expect(s.trim_silence).toBe(false);
    expect(s.onboarded_at).toBeTruthy();
    expect(s.cloud_signed_in).toBe(true);
    const caps = (await app.inject({ method: "GET", url: "/api/capabilities" })).json();
    expect(caps).toMatchObject({ sandboxed: true, setup: "simple", setup_locked: true, local_models: false });
  });

  it("keeps setup done even when \"Run setup again\" clears it", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { "content-type": "application/json" },
      payload: { onboarded_at: "" },
    });
    expect(r.statusCode).toBe(200);
    const s = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(s.onboarded_at).toBeTruthy();
  });

  it("lists no local models: there is nothing to run them on", async () => {
    const models = (await app.inject({ method: "GET", url: "/api/models" })).json() as { provider: string }[];
    expect(models.every((m) => m.provider === "cloud")).toBe(true);
  });

  it("is signed in to Mirli Cloud by the host and cannot sign out", async () => {
    const status = (await app.inject({ method: "GET", url: "/api/cloud" })).json();
    expect(status).toMatchObject({ enabled: true, hosted: true, signed_in: true });
    const out = await app.inject({ method: "POST", url: "/api/cloud/sign-out", headers: { "x-soundbox": "1" } });
    expect(out.statusCode).toBeGreaterThanOrEqual(400);
  });
});
