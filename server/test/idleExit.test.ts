import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { idleExitMinutes, registerIdleExit } from "../src/idle.js";
import { closeAndExit } from "../src/shutdown.js";

describe("idle exit", () => {
  it("reads MIRLI_IDLE_EXIT_MINUTES, off unless positive", () => {
    expect(idleExitMinutes({})).toBe(0);
    expect(idleExitMinutes({ MIRLI_IDLE_EXIT_MINUTES: "15" })).toBe(15);
    expect(idleExitMinutes({ MIRLI_IDLE_EXIT_MINUTES: "-1" })).toBe(0);
    expect(idleExitMinutes({ MIRLI_IDLE_EXIT_MINUTES: "soon" })).toBe(0);
  });

  it("fires after the idle time when nothing is running, not while busy", async () => {
    const app = Fastify();
    let busy = true;
    let fired = 0;
    registerIdleExit(app, {
      busy: () => busy,
      minutes: 0.0005, // 30 ms
      checkEveryMs: 10,
      onIdle: () => fired++,
    });
    await app.ready();
    await new Promise((r) => setTimeout(r, 80));
    expect(fired).toBe(0);
    busy = false;
    await new Promise((r) => setTimeout(r, 120));
    expect(fired).toBe(1);
    await app.close();
  });

  it("does nothing when off", async () => {
    const app = Fastify();
    let fired = 0;
    registerIdleExit(app, { busy: () => false, minutes: 0, checkEveryMs: 5, onIdle: () => fired++ });
    await app.ready();
    await new Promise((r) => setTimeout(r, 40));
    expect(fired).toBe(0);
    await app.close();
  });

  it("does not fire while a long request is still being answered", async () => {
    const app = Fastify();
    let fired = 0;
    let finish!: () => void;
    // Reported busy until the handler has the request, so the idle clock
    // can't run out while a cold fetch is still connecting. From then on only
    // the request being in flight keeps the server up.
    let seen = false;
    let markSeen!: () => void;
    const arrived = new Promise<void>((r) => (markSeen = r));
    app.get("/slow", () =>
      new Promise<string>((r) => {
        seen = true;
        markSeen();
        finish = () => r("done");
      }),
    );
    registerIdleExit(app, { busy: () => !seen, minutes: 0.0005, checkEveryMs: 10, onIdle: () => fired++ });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as { port: number };
    const pending = fetch(`http://127.0.0.1:${port}/slow`);
    await arrived;
    // Several idle windows (30 ms each) pass with the request still open.
    await new Promise((r) => setTimeout(r, 150));
    expect(fired).toBe(0);
    finish();
    expect(await (await pending).text()).toBe("done");
    await new Promise((r) => setTimeout(r, 120));
    expect(fired).toBe(1);
    await app.close();
  });

  it("doesn't count health probes as use", async () => {
    const app = Fastify();
    let fired = 0;
    app.get("/api/health", async () => ({ status: "ok" }));
    registerIdleExit(app, { busy: () => false, minutes: 0.0005, checkEveryMs: 10, onIdle: () => fired++ });
    await app.ready();
    const probes = setInterval(() => void app.inject({ method: "GET", url: "/api/health" }), 5);
    await new Promise((r) => setTimeout(r, 120));
    clearInterval(probes);
    expect(fired).toBe(1);
    await app.close();
  });
});

describe("closeAndExit", () => {
  it("exits 0 once the server has closed", async () => {
    const exit = vi.fn();
    closeAndExit({ close: async () => undefined }, "test", exit, 1000);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it("exits 1 when closing fails", async () => {
    const exit = vi.fn();
    closeAndExit({ close: async () => Promise.reject(new Error("stuck")) }, "test", exit, 1000);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it("exits 1 when closing hangs past the grace time", async () => {
    const exit = vi.fn();
    closeAndExit({ close: () => new Promise(() => {}) }, "test", exit, 30);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});
