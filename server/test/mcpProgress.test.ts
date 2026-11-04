/**
 * Progress notifications for tools that block on a job.
 *
 * A long render outlives some clients' tool-call timeouts (60 s is common),
 * and a call that is silent for a minute looks hung. A client that sends a
 * `progressToken` should hear `notifications/progress` while the job runs —
 * through the HTTP-transport server and through the stdio bridge alike — and
 * a client that sends none should hear nothing extra.
 *
 * The throttling rules are pinned on the reporter with a fake clock; the
 * end-to-end tests drive a real MCP client against a job with a scripted
 * runner, since no model is needed to prove the plumbing.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Progress } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { Config } from "../src/config.js";
import { ProgressReporter, type ProgressExtra } from "../src/mcp/progress.js";
import { buildMcp } from "../src/mcp/server.js";
import { build as buildStdio } from "../src/mcp/stdio.js";
import { KonchiService } from "../src/service.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ reporter */

function recorder(token: string | number | null = "tok") {
  const sent: { progress: number; total?: number; message?: string }[] = [];
  let t = 0;
  const extra: ProgressExtra = {
    _meta: token === null ? {} : { progressToken: token },
    sendNotification: async (n) => {
      expect(n.method).toBe("notifications/progress");
      expect(n.params.progressToken).toBe(token);
      const { progressToken: _, ...rest } = n.params;
      sent.push(rest);
    },
  };
  const reporter = new ProgressReporter(extra, {
    minIntervalMs: 1_000,
    heartbeatMs: 5_000,
    now: () => t,
  });
  return { sent, reporter, advance: (ms: number) => (t += ms) };
}

describe("ProgressReporter", () => {
  it("is silent without a progressToken", () => {
    const { sent, reporter } = recorder(null);
    reporter.update(0.5, "sampling");
    expect(reporter.active).toBe(false);
    expect(sent).toEqual([]);
  });

  it("sends the first report at once, then at most one change per interval", () => {
    const { sent, reporter, advance } = recorder();
    reporter.update(0, "loading model");
    expect(sent).toEqual([{ progress: 0, total: 1, message: "loading model" }]);

    advance(300);
    reporter.update(0.2, "sampling");
    expect(sent).toHaveLength(1); // changed, but too soon

    advance(800);
    reporter.update(0.3, "sampling");
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ progress: 0.3, message: "sampling" });
  });

  it("keeps a still job alive with heartbeats whose progress still increases", () => {
    const { sent, reporter, advance } = recorder();
    reporter.update(0, "loading model");
    for (let i = 0; i < 12; i++) {
      advance(1_000);
      reporter.update(0, "loading model"); // nothing moves while weights load
    }
    // t=0, then heartbeats at 5 s and 10 s.
    expect(sent).toHaveLength(3);
    for (let i = 1; i < sent.length; i++) {
      expect(sent[i].progress).toBeGreaterThan(sent[i - 1].progress);
      expect(sent[i].progress).toBeLessThan(0.001);
    }
  });

  it("never reports a fraction going backwards", () => {
    const { sent, reporter, advance } = recorder();
    reporter.update(0.6, "a");
    advance(2_000);
    reporter.update(0.4, "b");
    expect(sent[1].progress).toBeGreaterThan(0.6);
  });

  it("maps sequential jobs onto shares of one bar", () => {
    const { sent, reporter, advance } = recorder();
    reporter.step(1, 4, "line 2 of 4")({ status: "running", progress: 0.5, message: "reading" });
    expect(sent[0]).toMatchObject({ progress: 0.375, message: "line 2 of 4: reading" });
    advance(1_000);
    reporter.step(1, 4)({ status: "done", progress: 0, message: "" });
    expect(sent[1].progress).toBe(0.5);
  });

  it("does not fail the work when the client has gone away", async () => {
    const reporter = new ProgressReporter({
      _meta: { progressToken: 1 },
      sendNotification: () => Promise.reject(new Error("closed")),
    });
    expect(() => reporter.update(0.1)).not.toThrow();
    await sleep(0); // an unhandled rejection would fail the run here
  });
});

/* --------------------------------------------------- through the server */

async function connect(server: McpServer): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

describe("konchi.generate over MCP", () => {
  let svc: KonchiService;
  let dataDir: string;
  let client: Client;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "konchi-mcp-progress-"));
    svc = new KonchiService(new Config(dataDir));
    // A render that loads, samples and finishes over ~2.5 s, with no model.
    svc.submitGenerate = () =>
      svc.jobs.submit("generate", {}, async (h) => {
        h.progress(0, "loading model", "loading");
        await sleep(1_200);
        h.progress(0.5, "sampling");
        await sleep(1_200);
        h.progress(1, "writing");
        return { sounds: [] };
      });
    client = await connect(buildMcp(() => svc));
  });

  afterAll(async () => {
    await client.close();
    await svc.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("sends progress before the result when the call carries a progressToken", async () => {
    const events: (Progress | "result")[] = [];
    const res = await client.callTool(
      { name: "konchi.generate", arguments: { prompt: "door slam", model: "fake" } },
      undefined,
      { onprogress: (p) => events.push(p) },
    );
    events.push("result");
    expect(res.isError).toBeFalsy();

    const notes = events.filter((e): e is Progress => e !== "result");
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)).toBe("result");
    expect(notes.every((n) => n.total === 1)).toBe(true);
    expect(notes.map((n) => n.message)).toContain("loading model");
    expect(notes.map((n) => n.message)).toContain("sampling");
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i].progress).toBeGreaterThan(notes[i - 1].progress);
    }
  });

  it("sends nothing to a call without one", async () => {
    const seen = vi.fn();
    client.setNotificationHandler(
      (await import("@modelcontextprotocol/sdk/types.js")).ProgressNotificationSchema,
      seen,
    );
    const res = await client.callTool({
      name: "konchi.generate",
      arguments: { prompt: "door slam", model: "fake" },
    });
    expect(res.isError).toBeFalsy();
    expect(seen).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------- through the stdio bridge */

describe("konchi.generate over the stdio bridge", () => {
  let client: Client;

  beforeAll(async () => {
    // The bridge only talks HTTP to a running server; script that server.
    let polls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const reply = (body: unknown) =>
          new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
        if (url.pathname === "/api/generate" && method === "POST") return reply({ job_id: "j1" });
        if (url.pathname === "/api/jobs/j1") {
          polls += 1;
          if (polls <= 3) return reply({ status: "running", progress: 0, message: "loading model" });
          if (polls <= 6) return reply({ status: "running", progress: 0.5, message: "sampling" });
          return reply({ status: "done", progress: 1, message: "", result: { sounds: [] } });
        }
        return reply({}); // call reporting: best-effort, content irrelevant
      }),
    );
    client = await connect(buildStdio());
  });

  afterAll(async () => {
    await client.close();
    vi.unstubAllGlobals();
  });

  it("relays the server's job progress to the stdio client", async () => {
    const notes: Progress[] = [];
    const res = await client.callTool(
      { name: "konchi.generate", arguments: { prompt: "door slam", model: "fake" } },
      undefined,
      { onprogress: (p) => notes.push(p) },
    );
    expect(res.isError).toBeFalsy();
    expect(notes.map((n) => n.message)).toEqual(expect.arrayContaining(["loading model", "sampling"]));
  });
});
