/**
 * The daily "is there a newer version?" check.
 *
 * What matters here is what it will not do: send anything but the version and
 * the platform, ask when it has been turned off (in Settings or by env), ask
 * twice in a day, or let a failure reach the caller. And the endpoint's half:
 * it counts only well-formed requests and still answers when the counter is
 * down.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handle, resetCache, type Deps } from "../../api/update.js";
import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import { isNewer, MIN_INTERVAL_MS, UpdateChecker } from "../src/updateCheck.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "soundbox-update-"));
  delete process.env.SOUNDBOX_UPDATE_CHECK;
  delete process.env.SOUNDBOX_UPDATE_URL;
});

afterEach(async () => {
  delete process.env.SOUNDBOX_UPDATE_CHECK;
  await rm(dataDir, { recursive: true, force: true });
});

function answer(latest: string | null, url = "https://github.com/HamSanders/soundbox/releases/tag/v9.9.9") {
  return vi.fn(async () => new Response(JSON.stringify({ latest, url }), { status: 200 }));
}

describe("isNewer", () => {
  it("compares numerically, not as text", () => {
    expect(isNewer("0.10.0", "0.9.2")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.4.1", "0.4.1")).toBe(false);
    expect(isNewer("0.4.0", "0.4.1")).toBe(false);
    expect(isNewer("v0.5.0", "0.4.9")).toBe(true);
  });
});

describe("UpdateChecker", () => {
  it("is on by default and sends only the version and the platform", async () => {
    const config = new Config(dataDir);
    expect(config.settings.update_check).toBe(true);
    const fetchFn = answer("9.9.9");
    const checker = new UpdateChecker(config, {
      fetch: fetchFn as unknown as typeof fetch,
      version: "0.4.1",
      platform: "win32-x64",
    });
    const status = await checker.check();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(Object.fromEntries(url.searchParams)).toEqual({ v: "0.4.1", p: "win32-x64" });
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(Object.keys(init.headers as Record<string, string>).sort()).toEqual(["accept", "user-agent"]);
    expect(status).toMatchObject({ enabled: true, available: true, latest: "9.9.9", error: null });
  });

  it("makes no request when the setting is off, even for Check now", async () => {
    const config = new Config(dataDir);
    config.updateSettings({ update_check: false });
    const fetchFn = answer("9.9.9");
    const checker = new UpdateChecker(config, { fetch: fetchFn as unknown as typeof fetch });
    const status = await checker.check();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(status).toMatchObject({ enabled: false, disabled_by: "setting", available: false });
  });

  it("makes no request when SOUNDBOX_UPDATE_CHECK=0, whatever the setting says", async () => {
    process.env.SOUNDBOX_UPDATE_CHECK = "0";
    const fetchFn = answer("9.9.9");
    const checker = new UpdateChecker(new Config(dataDir), { fetch: fetchFn as unknown as typeof fetch });
    const status = await checker.check();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(status.disabled_by).toBe("env");
  });

  it("hides an earlier answer once it is turned off", async () => {
    const config = new Config(dataDir);
    const checker = new UpdateChecker(config, {
      fetch: answer("9.9.9") as unknown as typeof fetch,
      version: "0.4.1",
    });
    expect((await checker.check()).available).toBe(true);
    config.updateSettings({ update_check: false });
    expect(checker.status()).toMatchObject({ available: false, url: null });
  });

  it("remembers the last answer across restarts, so a restart is not a second count", async () => {
    const config = new Config(dataDir);
    let t = Date.parse("2026-11-17T10:00:00Z");
    const first = new UpdateChecker(config, {
      fetch: answer("9.9.9") as unknown as typeof fetch,
      now: () => t,
    });
    await first.check();

    // A new process, an hour later: it loads the saved time and the saved answer.
    t += 60 * 60 * 1000;
    const second = new UpdateChecker(config, { now: () => t });
    expect(second.status()).toMatchObject({ latest: "9.9.9", checked_at: "2026-11-17T10:00:00.000Z" });
    expect(MIN_INTERVAL_MS).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it("swallows a failure and keeps the last answer", async () => {
    const checker = new UpdateChecker(new Config(dataDir), {
      fetch: vi.fn(async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    });
    const status = await checker.check();
    expect(status).toMatchObject({ available: false, latest: null, error: "offline" });
  });

  it("ignores a release page that is not on GitHub", async () => {
    const checker = new UpdateChecker(new Config(dataDir), {
      fetch: answer("9.9.9", "https://evil.example/download") as unknown as typeof fetch,
    });
    expect((await checker.check()).url).toBeNull();
  });

  it("counts a double click once", async () => {
    const fetchFn = answer("9.9.9");
    const checker = new UpdateChecker(new Config(dataDir), { fetch: fetchFn as unknown as typeof fetch });
    await Promise.all([checker.check(), checker.check()]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("the settings and routes", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  it("exposes update_check and saves a change to it", async () => {
    const before = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(before.update_check).toBe(true);
    const after = (
      await app.inject({ method: "PATCH", url: "/api/settings", payload: { update_check: false } })
    ).json();
    expect(after.update_check).toBe(false);
    const status = (await app.inject({ method: "GET", url: "/api/update" })).json();
    expect(status).toMatchObject({ enabled: false, disabled_by: "setting" });
  });

  it("does not phone out in the test run", async () => {
    // service.start() skips the schedule under Vitest; this would hang the
    // suite on a real request if it did not.
    const status = (await app.inject({ method: "GET", url: "/api/update" })).json();
    expect(status.checked_at).toBeNull();
  });
});

describe("the endpoint", () => {
  const NOW = Date.parse("2026-11-17T12:00:00Z");

  function deps(over: Partial<Deps> = {}): { deps: Deps; calls: { url: string; init?: RequestInit }[] } {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith("https://github.com/")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://github.com/HamSanders/soundbox/releases/tag/v0.5.1" },
        });
      }
      return new Response("[]", { status: 200 });
    }) as typeof fetch;
    return {
      deps: {
        fetch: f,
        now: () => NOW,
        env: { UPSTASH_REDIS_REST_URL: "https://redis.example", UPSTASH_REDIS_REST_TOKEN: "t" },
        ...over,
      },
      calls,
    };
  }

  beforeEach(() => resetCache());

  it("counts one per day, version and platform, and answers with the latest release", async () => {
    const { deps: d, calls } = deps();
    const res = await handle(new Request("https://mirli.app/api/update?v=0.4.1&p=win32-x64"), d);
    expect(await res.json()).toEqual({
      latest: "0.5.1",
      url: "https://github.com/HamSanders/soundbox/releases/tag/v0.5.1",
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const store = calls.find((c) => c.url.startsWith("https://redis.example"))!;
    expect(JSON.parse(String(store.init!.body))[0]).toEqual([
      "HINCRBY",
      "installs:2026-11-17",
      "0.4.1|win32-x64",
      1,
    ]);
  });

  it("rejects anything that is not a plain version and a known platform, counting nothing", async () => {
    for (const q of [
      "",
      "?v=0.4.1",
      "?v=0.4.1&p=plan9-mips",
      "?v=latest&p=win32-x64",
      "?v=0.4.1;DROP&p=win32-x64",
      `?v=${"9".repeat(40)}&p=win32-x64`,
    ]) {
      const { deps: d, calls } = deps();
      const res = await handle(new Request(`https://mirli.app/api/update${q}`), d);
      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
    }
  });

  it("still answers when no counter is configured or the counter is down", async () => {
    const none = deps({ env: {} });
    expect((await handle(new Request("https://mirli.app/api/update?v=0.4.1&p=darwin-arm64"), none.deps)).status).toBe(200);
    expect(none.calls.some((c) => c.url.includes("redis"))).toBe(false);

    resetCache();
    const down = deps();
    const base = down.deps.fetch;
    down.deps.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("redis")) throw new Error("down");
      return base(input, init);
    }) as typeof fetch;
    const res = await handle(new Request("https://mirli.app/api/update?v=0.4.1&p=darwin-arm64"), down.deps);
    expect(res.status).toBe(200);
    expect((await res.json()).latest).toBe("0.5.1");
  });
});
