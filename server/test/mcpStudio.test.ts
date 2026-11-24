/**
 * Agents can read and edit the studio that is open in the app.
 *
 * There is no browser here, so a fake studio stands in for one: it subscribes
 * to its story's events the way the page does with `?answer=1`, and answers
 * each request by POSTing to the same reply route the page uses. Everything
 * between the MCP client and that route is the real code.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import { buildMcp } from "../src/mcp/server.js";
import type { MirliService } from "../src/service.js";
import { StudioNotOpenError, StudioRequestError, type StoryEvent } from "../src/story-hub.js";

let app: FastifyInstance;
let svc: MirliService;
let client: Client;
let dataDir: string;

async function callRaw(name: string, args: Record<string, unknown>) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  return { text: res.content.map((c) => c.text).join(""), isError: !!res.isError };
}

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await callRaw(name, args);
  if (res.isError) throw new Error(res.text);
  return JSON.parse(res.text);
}

async function newStory(title = "Studio"): Promise<string> {
  return (await call("soundbox.create_story", { title })).story_id;
}

/** A live studio snapshot, in the shape the page's `studioContext()` sends. */
function snapshot() {
  return {
    tracks: [
      { track_index: 0, name: "Drums", muted: false, soloed: false, devices: ["eq"] },
      { track_index: 1, name: null, muted: false, soloed: false, devices: [] },
    ],
    clips: [
      { id: "c-kick", track_index: 0, start_s: 0, duration_s: 4, label: "four on the floor kick" },
      { id: "c-vox1", track_index: 1, start_s: 0, duration_s: 2, label: "breathy vocal hook" },
      { id: "c-vox2", track_index: 1, start_s: 4, duration_s: 2, label: "vocal hook reprise" },
    ],
    playhead_s: 3.5,
    selected_ids: ["c-vox2"],
    voices: [{ id: "v-mara", name: "Mara", kind: "clone", notes: null }],
  };
}

interface FakeStudio {
  applied: { actions: any[]; summary: string }[];
  received: StoryEvent[];
  close: () => void;
}

/**
 * Subscribe as the page does and answer requests through the HTTP reply
 * route. `silent` never answers, for the timeout path.
 */
function openStudio(
  storyId: string,
  options: { answers?: boolean; silent?: boolean } = {},
): FakeStudio {
  const queue = svc.stories.subscribe(storyId, { answers: options.answers ?? true });
  const studio: FakeStudio = {
    applied: [],
    received: [],
    close: () => svc.stories.unsubscribe(storyId, queue),
  };
  void (async () => {
    for await (const event of queue) {
      studio.received.push(event);
      if (event.type !== "request" || options.silent) continue;
      let body: Record<string, unknown>;
      if (event.op === "context") body = { ok: true, result: snapshot() };
      else {
        const payload = event.payload as { actions: any[]; summary: string };
        studio.applied.push(payload);
        body = { ok: true, result: { applied: payload.actions.length } };
      }
      await app.inject({
        method: "POST",
        url: `/api/stories/${storyId}/studio/replies/${event.id}`,
        payload: body,
      });
    }
  })();
  return studio;
}

const open: FakeStudio[] = [];
function track(studio: FakeStudio): FakeStudio {
  open.push(studio);
  return studio;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "soundbox-mcp-studio-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
  svc = (app as unknown as { soundbox: MirliService }).soundbox;
  const server = buildMcp(() => svc);
  client = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

afterAll(async () => {
  await client.close();
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("the tools are listed", () => {
  it("advertises studio_context, studio_apply and search_docs", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["soundbox.studio_context", "soundbox.studio_apply", "soundbox.search_docs"]) {
      expect(names).toContain(n);
    }
    const apply = tools.find((t) => t.name === "soundbox.studio_apply")!;
    // The vocabulary travels in the description, so an agent never guesses a shape.
    expect(apply.description).toContain('"type":"generate_clip"');
    expect(apply.description).toContain("select");
  });
});

describe("soundbox.studio_context", () => {
  it("says so when no studio is open", async () => {
    const res = await callRaw("soundbox.studio_context", {});
    expect(res.isError).toBe(true);
    expect(res.text).toContain("No studio is open");
  });

  it("reads the one open studio without being told which", async () => {
    const storyId = await newStory();
    track(openStudio(storyId));
    const ctx = await call("soundbox.studio_context", {});
    expect(ctx.story_id).toBe(storyId);
    expect(ctx.clips.map((c: any) => c.id)).toEqual(["c-kick", "c-vox1", "c-vox2"]);
    expect(ctx.tracks[0].devices).toEqual(["eq"]);
    expect(ctx.playhead_s).toBe(3.5);
    expect(ctx.selected_ids).toEqual(["c-vox2"]);
    expect(ctx.open_in_studio).toContain(storyId);
  });

  it("asks which when several are open, and refuses a story that is not open", async () => {
    const a = await newStory("First");
    const b = await newStory("Second");
    const closed = await newStory("Closed");
    track(openStudio(a));
    track(openStudio(b));
    const res = await callRaw("soundbox.studio_context", {});
    expect(res.isError).toBe(true);
    expect(res.text).toContain("2 studios are open");
    expect((await call("soundbox.studio_context", { story_id: b })).story_id).toBe(b);
    const notOpen = await callRaw("soundbox.studio_context", { story_id: closed });
    expect(notOpen.isError).toBe(true);
    expect(notOpen.text).toContain("not open in a studio");
  });

  it("ignores watchers that did not offer to answer", async () => {
    const storyId = await newStory();
    const watcher = track(openStudio(storyId, { answers: false }));
    const res = await callRaw("soundbox.studio_context", {});
    expect(res.isError).toBe(true);
    expect(watcher.received.some((e) => e.type === "request")).toBe(false);
  });
});

describe("soundbox.studio_apply", () => {
  it("sends only what refers to something real, expanding selectors", async () => {
    const storyId = await newStory();
    const studio = track(openStudio(storyId));
    const out = await call("soundbox.studio_apply", {
      summary: "Tidy the mix",
      actions: [
        { type: "set_track", track_index: 0, muted: true },
        { type: "set_clip", select: { matching: "vocal" }, fade_in_s: 0.5 },
        { type: "move_clip", clip_id: "c-invented", start_s: 1 },
        { type: "rename_track", track_index: 9, name: "Nope" },
      ],
    });
    expect(out.applied).toBe(3);
    expect(out.dropped).toBe(2);
    expect(out.notes.join(" ")).toContain("dropped");
    expect(studio.applied).toHaveLength(1);
    expect(studio.applied[0]!.summary).toBe("Tidy the mix");
    expect(studio.applied[0]!.actions).toEqual([
      { type: "set_track", track_index: 0, muted: true },
      { type: "set_clip", clip_id: "c-vox1", fade_in_s: 0.5 },
      { type: "set_clip", clip_id: "c-vox2", fade_in_s: 0.5 },
    ]);
  });

  it("holds deletes unless allow_delete is set", async () => {
    const storyId = await newStory();
    const studio = track(openStudio(storyId));
    const held = await call("soundbox.studio_apply", {
      actions: [{ type: "delete_clip", select: { scope: "selected" } }],
    });
    expect(held.applied).toBe(0);
    expect(held.held_deletes).toBe(1);
    expect(studio.applied).toHaveLength(0);

    const done = await call("soundbox.studio_apply", {
      actions: [{ type: "delete_clip", select: { scope: "selected" } }],
      allow_delete: true,
    });
    expect(done.applied).toBe(1);
    expect(studio.applied[0]!.actions).toEqual([{ type: "delete_clip", clip_id: "c-vox2" }]);
  });

  it("casts only to voices the studio has, and notes background work", async () => {
    const storyId = await newStory();
    const studio = track(openStudio(storyId));
    const out = await call("soundbox.studio_apply", {
      actions: [
        {
          type: "add_lines",
          lines: [
            { text: "Hello.", speaker: "Mara", voice_id: "v-mara" },
            { text: "Who's there?", speaker: "Guard", voice_id: "v-made-up" },
          ],
        },
        { type: "generate_clip", track_index: 1, start_s: 2, prompt: "rain on a window" },
      ],
    });
    expect(out.applied).toBe(2);
    const [lines, gen] = studio.applied[0]!.actions;
    expect(lines.lines[0].voice_id).toBe("v-mara");
    expect(lines.lines[1].voice_id).toBeUndefined();
    expect(gen).toEqual({ type: "generate_clip", track_index: 1, start_s: 2, prompt: "rain on a window" });
    expect(out.notes.join(" ")).toContain("background");
  });
});

describe("the request channel", () => {
  it("asks only the newest studio on a story", async () => {
    const storyId = await newStory();
    const older = track(openStudio(storyId));
    const newer = track(openStudio(storyId));
    await call("soundbox.studio_context", {});
    expect(newer.received.some((e) => e.type === "request")).toBe(true);
    expect(older.received.some((e) => e.type === "request")).toBe(false);
  });

  it("times out on a studio that never answers", async () => {
    const storyId = await newStory();
    track(openStudio(storyId, { silent: true }));
    await expect(svc.stories.ask(storyId, "context", undefined, 50)).rejects.toBeInstanceOf(
      StudioRequestError,
    );
  });

  it("fails a pending request at once when its studio closes", async () => {
    const storyId = await newStory();
    const studio = openStudio(storyId, { silent: true });
    const pending = svc.stories.ask(storyId, "context");
    studio.close();
    await expect(pending).rejects.toBeInstanceOf(StudioNotOpenError);
  });

  it("passes a studio's refusal on as an error", async () => {
    const storyId = await newStory();
    const queue = svc.stories.subscribe(storyId, { answers: true });
    const asked = svc.stories.ask(storyId, "apply", { actions: [] });
    const { value } = await queue.next();
    const res = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/studio/replies/${(value as any).id}`,
      payload: { ok: false, error: "This studio is still loading." },
    });
    expect(res.statusCode).toBe(204);
    await expect(asked).rejects.toThrow("still loading");
    svc.stories.unsubscribe(storyId, queue);
  });

  it("404s a reply nobody is waiting for", async () => {
    const storyId = await newStory();
    const res = await app.inject({
      method: "POST",
      url: `/api/stories/${storyId}/studio/replies/not-a-request`,
      payload: { ok: true },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("soundbox.search_docs", () => {
  it("returns sections with their source", async () => {
    const out = await call("soundbox.search_docs", { query: "connect an MCP agent", limit: 3 });
    expect(out.sections.length).toBeGreaterThan(0);
    expect(out.sections.length).toBeLessThanOrEqual(3);
    for (const s of out.sections) {
      expect(typeof s.source).toBe("string");
      expect(typeof s.heading).toBe("string");
      expect(s.text.length).toBeGreaterThan(0);
    }
  });
});
