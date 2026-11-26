import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import type { MirliService } from "../src/service.js";

/**
 * The assistant's agent routes: a plan written against the book as the
 * server has it, and accepted calls run through the app's own MCP tools,
 * with the call that undoes them.
 */

let app: FastifyInstance;
let svc: MirliService;
let dataDir: string;
let bookId: string;
let chapterId: string;
let storyId: string;
let paragraphId: string;

const H = { "x-soundbox": "1" };

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-agent-routes-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
  svc = (app as unknown as { soundbox: MirliService }).soundbox;

  const book = await app.inject({ method: "POST", url: "/api/audiobooks", payload: { title: "The Raven" } });
  expect(book.statusCode).toBeLessThan(300);
  bookId = book.json().id;
  const detail = (await app.inject({ method: "GET", url: `/api/audiobooks/${bookId}` })).json();
  chapterId = detail.chapters[0].id;
  storyId = detail.chapters[0].story_id;
  const para = await app.inject({
    method: "POST",
    url: `/api/audiobooks/${bookId}/chapters/${chapterId}/paragraphs`,
    payload: { text: "Once upon a midnight dreary." },
  });
  expect(para.statusCode).toBeLessThan(300);
  paragraphId = para.json().id;
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("POST /api/agent/plan", () => {
  it("routes, then plans with the routed tools and short names, and keeps only valid calls", async () => {
    const llm = svc.llm as unknown as {
      resolveEndpoint: () => Promise<unknown>;
      complete: (e: unknown, messages: { content: string }[]) => Promise<string>;
    };
    let seen: { content: string }[] = [];
    let turn = 0;
    const endpoint = vi.spyOn(llm, "resolveEndpoint").mockResolvedValue({ baseUrl: "x", apiKey: null, model: "m" });
    const complete = vi.spyOn(llm, "complete").mockImplementation(async (_e, messages) => {
      // First the router, then the planner.
      if (turn++ === 0) return "sound, text";
      seen = messages;
      return JSON.stringify({
        reply: "Muting the beds lane and fixing the first line.",
        calls: [
          { tool: "soundbox.mix_track", arguments: { story_id: "C1", track_index: 1, muted: true } },
          { tool: "soundbox.update_line", arguments: { line_id: "P1", text: "Once upon a midnight dreary, while I pondered." } },
          // Not offered for a text-and-sound request.
          { tool: "soundbox.render_audiobook", arguments: { book_id: "B" } },
        ],
      });
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/agent/plan",
        headers: H,
        payload: { instruction: "mute the beds lane and lengthen the first paragraph", scope: { book_id: bookId, chapter_id: chapterId } },
      });
      expect(res.statusCode).toBe(200);
      const plan = res.json();
      expect(plan.groups).toEqual(["text", "sound"]);
      expect(plan.calls[0].arguments.story_id).toBe(storyId);
      expect(plan.calls[1].arguments.line_id).toBe(paragraphId);
      expect(plan.calls.map((c: { tool: string; risk: string }) => [c.tool, c.risk])).toEqual([
        ["soundbox.mix_track", "write"],
        ["soundbox.update_line", "write"],
      ]);
      expect(plan.dropped).toHaveLength(1);
      const system = seen[0]!.content;
      expect(system).toContain("soundbox.mix_track(");
      expect(system).toContain("soundbox.update_line(");
      expect(system).not.toContain("soundbox.render_audiobook(");
      const user = seen.at(-1)!.content;
      expect(user).toContain('Book B: "The Raven"');
      expect(user).toContain("P1 (unvoiced): Once upon a midnight dreary.");
      expect(user).not.toContain(bookId);
    } finally {
      endpoint.mockRestore();
      complete.mockRestore();
    }
  });

  it("says when the book does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agent/plan",
      headers: H,
      payload: { instruction: "hello", scope: { book_id: "nope" } },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/agent/run", () => {
  const run = (tool: string, args: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/agent/run", headers: H, payload: { tool, arguments: args } });

  it("runs a tool and hands back the call that undoes it", async () => {
    const res = await run("soundbox.mix_track", { story_id: storyId, track_index: 1, name: "Beds", gain_db: -6 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(svc.listTracks(storyId).find((t) => t.track_index === 1)).toMatchObject({ name: "Beds", gain_db: -6 });
    expect(body.undo).toEqual([
      { tool: "soundbox.mix_track", arguments: { story_id: storyId, track_index: 1, name: null, gain_db: 0 } },
    ]);
    const back = await run(body.undo[0].tool, body.undo[0].arguments);
    expect(back.statusCode).toBe(200);
    expect(svc.listTracks(storyId).find((t) => t.track_index === 1)).toMatchObject({ name: null, gain_db: 0 });
  });

  it("undoes a paragraph's text edit", async () => {
    const res = await run("soundbox.update_line", { line_id: paragraphId, text: "Changed." });
    expect(res.statusCode).toBe(200);
    expect(res.json().undo).toEqual([
      { tool: "soundbox.update_line", arguments: { line_id: paragraphId, text: "Once upon a midnight dreary." } },
    ]);
  });

  it("undoes an added device by removing it", async () => {
    const res = await run("soundbox.add_device", { story_id: storyId, track_index: 1, kind: "reverb" });
    expect(res.statusCode).toBe(200);
    const [undo] = res.json().undo;
    expect(undo.tool).toBe("soundbox.remove_device");
    expect((await run(undo.tool, undo.arguments)).statusCode).toBe(200);
    expect(svc.listTracks(storyId).find((t) => t.track_index === 1)?.devices ?? []).toEqual([]);
  });

  it("offers no undo where MCP has no inverse, and passes a tool's refusal on", async () => {
    const ok = await run("soundbox.add_pronunciation", { book_id: bookId, term: "Lenore", replacement: "leh-NOR" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().undo).toBeNull();
    const bad = await run("soundbox.get_audiobook", { book_id: "nope" });
    expect(bad.statusCode).toBe(422);
  });

  it("refuses a manuscript path on a server that may not read its disk", async () => {
    const caps = svc.capabilities as { filesystem: boolean };
    const was = caps.filesystem;
    caps.filesystem = false;
    try {
      const res = await run("soundbox.import_manuscript", { path: "C:/Windows/win.ini" });
      expect(res.statusCode).toBe(403);
    } finally {
      caps.filesystem = was;
    }
  });
});
