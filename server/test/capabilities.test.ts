/**
 * GET /api/capabilities and sandboxed mode (MIRLI_SANDBOXED=1): host-touching
 * routes refused, host settings locked, no local models or custom endpoints.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import {
  CAPABILITY_KEYS,
  GUARDED_ROUTES,
  UNGUARDED_ROUTES,
  capabilitiesFromEnv,
  refusedBy,
  withSetup,
} from "../src/capabilities.js";
import { Config } from "../src/config.js";
import { MirliService } from "../src/service.js";

describe("capabilitiesFromEnv", () => {
  it("turns everything on for a desktop", () => {
    const caps = capabilitiesFromEnv({});
    for (const key of CAPABILITY_KEYS) expect(caps[key]).toBe(true);
    expect(caps).toMatchObject({ sandboxed: false, settings_locked: [] });
  });

  it("turns off everything that touches the host when sandboxed", () => {
    const caps = capabilitiesFromEnv({ MIRLI_SANDBOXED: "1" });
    for (const key of CAPABILITY_KEYS) expect(caps[key]).toBe(false);
    expect(caps.sandboxed).toBe(true);
    expect(caps.settings_locked).toContain("sounds_dir");
  });

  it("turns off single capabilities with MIRLI_DISABLE", () => {
    const caps = capabilitiesFromEnv({ MIRLI_DISABLE: "reveal, updates" });
    expect(caps.reveal).toBe(false);
    expect(caps.updates).toBe(false);
    expect(caps.downloads).toBe(true);
  });

  it("locks the URL settings with custom endpoints off, even when not sandboxed", () => {
    const caps = capabilitiesFromEnv({ MIRLI_DISABLE: "custom_endpoints" });
    expect(caps.settings_locked).toEqual(
      expect.arrayContaining(["audio_endpoints", "llm_external_base_url", "image_external_base_url", "otel_endpoint"]),
    );
    expect(caps.settings_locked).not.toContain("sounds_dir");
  });
});

describe("refusedBy", () => {
  const sandboxed = capabilitiesFromEnv({ MIRLI_SANDBOXED: "1" });
  const desktop = capabilitiesFromEnv({});

  it.each(Object.entries(GUARDED_ROUTES))("refuses %s when sandboxed (%s)", (key, cap) => {
    const [method, route] = key.split(" ") as [string, string];
    expect(refusedBy(sandboxed, method, route)).toBe(cap);
    expect(refusedBy(desktop, method, route)).toBeNull();
  });

  it("checks HEAD as GET", () => {
    expect(refusedBy(sandboxed, "HEAD", "/api/fs/dirs")).toBe("filesystem");
  });

  it.each(UNGUARDED_ROUTES)("allows %s when sandboxed", (key) => {
    const [method, route] = key.split(" ") as [string, string];
    expect(refusedBy(sandboxed, method, route)).toBeNull();
  });
});

describe("route coverage", () => {
  afterAll(() => {
    vi.doUnmock("fastify");
    vi.resetModules();
  });

  it("has every registered route either guarded or listed as open", async () => {
    // Record each route as Fastify registers it: wrap the factory so an
    // onRoute hook is in place before buildApp adds the first one.
    const routes: string[] = [];
    vi.resetModules();
    vi.doMock("fastify", async (importOriginal) => {
      const real = (await importOriginal<typeof import("fastify")>()).default;
      const wrapped = ((opts?: Parameters<typeof real>[0]) => {
        const app = real(opts);
        app.addHook("onRoute", (r) => {
          for (const m of [r.method].flat()) {
            // HEAD is checked as GET, and OPTIONS is the CORS preflight.
            if (m !== "HEAD" && m !== "OPTIONS") routes.push(`${m} ${r.url}`);
          }
        });
        return app;
      }) as unknown as typeof real;
      return { default: wrapped };
    });
    const { buildApp: build } = await import("../src/app.js");
    const { Config: Cfg } = await import("../src/config.js");
    const dataDir = await mkdtemp(join(tmpdir(), "mirli-routes-test-"));
    const app = build(new Cfg(dataDir), { serveUi: false });
    await app.ready();
    try {
      expect(routes.length).toBeGreaterThan(100);
      const known = new Set([...Object.keys(GUARDED_ROUTES), ...UNGUARDED_ROUTES]);
      expect(routes.filter((r) => !known.has(r))).toEqual([]);
      // And nothing listed that no longer exists, so the lists stay honest.
      expect([...known].filter((r) => !routes.includes(r))).toEqual([]);
    } finally {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

describe("a sandboxed server", () => {
  let dataDir: string;
  let app: FastifyInstance;
  let saved: string | undefined;

  beforeAll(async () => {
    saved = process.env.MIRLI_SANDBOXED;
    process.env.MIRLI_SANDBOXED = "1";
    dataDir = await mkdtemp(join(tmpdir(), "mirli-sandboxed-test-"));
    const config = new Config(dataDir);
    // An endpoint saved before the server was sandboxed must not be offered.
    config.updateSettings({
      audio_endpoints: [
        {
          id: "old",
          name: "Old",
          task: "sfx",
          url: "http://127.0.0.1:9/render",
          api_key: null,
          api_key_header: "Authorization",
          api_key_prefix: "Bearer ",
          headers: {},
          body_template: '{"prompt": "{{prompt}}"}',
          response_path: "",
          pcm_sample_rate: 24_000,
          max_duration_s: 30,
          voices: [],
          enabled: true,
        },
      ],
    });
    app = buildApp(config, { serveUi: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (saved === undefined) delete process.env.MIRLI_SANDBOXED;
    else process.env.MIRLI_SANDBOXED = saved;
    await rm(dataDir, { recursive: true, force: true });
  });

  it("reports its capabilities", async () => {
    const caps = (await app.inject({ method: "GET", url: "/api/capabilities" })).json();
    expect(caps).toMatchObject({ sandboxed: true, filesystem: false, local_models: false });
  });

  it("refuses folder browsing and model downloads", async () => {
    const fs = await app.inject({ method: "GET", url: "/api/fs/dirs" });
    expect(fs.statusCode).toBe(403);
    expect(fs.json().detail).toBe("This server doesn't allow that.");
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
    expect(s.sounds_dir ?? "").not.toContain("Windows");
    expect(s.trim_silence).toBe(false);
  });

  // The router decodes the path before it matches, so each of these reaches
  // the handler it spells; the guard has to see the same route.
  it.each([
    ["GET", "/api/%66s/dirs"],
    ["GET", "/api/%65ndpoints"],
    ["POST", "/api/models/audiocpp/engine/%69nstall"],
    ["POST", "/api/mcp/skills/%69nstall"],
    ["POST", "/api/update/%63heck"],
    ["POST", "/api/%6dodels/x/load"],
    ["POST", "/api/models/x/%64ownload"],
    ["POST", "/api/sounds/x/%72eveal"],
  ])("refuses %s %s, a percent-encoded guarded route", async (method, url) => {
    const r = await app.inject({ method: method as "GET", url, headers: { "x-soundbox": "1" } });
    expect(r.statusCode).toBe(403);
  });

  it.each([
    ["DELETE", "/api/instruments/vsco-violin"],
    ["GET", "/api/logs"],
    ["POST", "/api/profiles"],
    ["DELETE", "/api/profiles/default?delete_data=1"],
  ])("refuses %s %s", async (method, url) => {
    const r = await app.inject({
      method: method as "GET",
      url,
      headers: { "x-soundbox": "1", "content-type": "application/json" },
      payload: method === "POST" ? { name: "x" } : undefined,
    });
    expect(r.statusCode).toBe(403);
  });

  it("ignores custom endpoints sent through settings", async () => {
    await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { "content-type": "application/json" },
      payload: { audio_endpoints: [], llm_external_base_url: "http://169.254.169.254/" },
    });
    const s = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(s.llm_external_base_url ?? "").not.toContain("169.254");
  });

  it("leaves the GPU out of /api/health", async () => {
    const h = (await app.inject({ method: "GET", url: "/api/health" })).json();
    expect(h).toMatchObject({ status: "ok", gpu_name: null, vram_total_mb: null });
  });

  it("lists no local models and no custom endpoints", async () => {
    const models = (await app.inject({ method: "GET", url: "/api/models" })).json() as unknown[];
    expect(models).toEqual([]);
  });
});

describe("withSetup: the two paths", () => {
  const desktop = capabilitiesFromEnv({});

  it("leaves a full setup as the server allows it", () => {
    expect(withSetup(desktop, { setup: "full", setup_include_local: false })).toEqual(desktop);
  });

  it("switches the local half off in the simple setup", () => {
    const simple = withSetup(desktop, { setup: "simple", setup_include_local: false });
    expect(simple).toMatchObject({ setup: "simple", downloads: false, gpu_status: false, local_models: false });
    expect(simple.custom_endpoints).toBe(true);
  });

  it("keeps installed local models in the simple setup only when asked", () => {
    expect(withSetup(desktop, { setup: "simple", setup_include_local: true }).local_models).toBe(true);
  });

  it("is simple and locked on a server that can't run models itself", () => {
    const sandboxed = capabilitiesFromEnv({ MIRLI_SANDBOXED: "1" });
    expect(sandboxed).toMatchObject({ setup: "simple", setup_locked: true });
    expect(withSetup(sandboxed, { setup: "full", setup_include_local: true })).toEqual(sandboxed);
  });
});

describe("a desktop server switching setup", () => {
  let dataDir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mirli-setup-test-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: "PATCH", url: "/api/settings", headers: { "content-type": "application/json" }, payload });
  const caps = async () => (await app.inject({ method: "GET", url: "/api/capabilities" })).json();
  const providers = async () =>
    ((await app.inject({ method: "GET", url: "/api/models" })).json() as { provider: string }[]).map((m) => m.provider);

  it("lists local models and allows downloads in the full setup", async () => {
    expect(await caps()).toMatchObject({ setup: "full", downloads: true });
    expect(await providers()).toContain("local");
  });

  it("drops local models and refuses downloads in the simple setup", async () => {
    expect((await patch({ setup: "simple" })).statusCode).toBe(200);
    expect(await caps()).toMatchObject({ setup: "simple", downloads: false, local_models: false });
    expect(await providers()).not.toContain("local");
    const dl = await app.inject({ method: "POST", url: "/api/models/x/download", headers: { "x-soundbox": "1" } });
    expect(dl.statusCode).toBe(403);
  });

  it("brings installed local models back only when asked", async () => {
    await patch({ setup_include_local: true });
    expect((await caps()).local_models).toBe(true);
    await patch({ setup: "full", setup_include_local: false });
    expect(await caps()).toMatchObject({ setup: "full", downloads: true });
  });

  it("unloads a resident local model on switching to the simple setup", async () => {
    // Out of reach once switched (hidden, and unload refused), so it must not
    // be left holding VRAM.
    const config = new Config(await mkdtemp(join(tmpdir(), "mirli-setup-unload-")));
    const svc = new MirliService(config);
    try {
      const manager = svc.models;
      vi.spyOn(manager, "resident", "get").mockReturnValue("acestep");
      vi.spyOn(manager, "get").mockReturnValue({
        status: async () => ({ provider: "local" }),
      } as unknown as ReturnType<typeof manager.get>);
      const unload = vi.spyOn(manager, "unload").mockResolvedValue(null);
      await svc.updateSettings({ setup: "simple" });
      expect(unload).toHaveBeenCalledWith("acestep");
    } finally {
      await svc.close();
      await rm(config.base, { recursive: true, force: true });
    }
  });
});
