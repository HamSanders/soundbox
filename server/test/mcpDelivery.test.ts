/**
 * The delivery surface as an agent actually sees it.
 *
 * Driven through a real MCP client over an in-memory transport rather than by
 * calling the handlers directly, because the things most likely to be wrong
 * here are the schema and the naming: `delivery` is this surface's name for
 * what the HTTP API calls `request_options`, and a rename that only half
 * happens is invisible until an agent's setting silently does nothing —
 * exactly the failure mode audio.cpp's silent-ignore already hands us.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Config } from "../src/config.js";
import { buildMcp } from "../src/mcp/server.js";
import { KonchiService } from "../src/service.js";

let client: Client;
let svc: KonchiService;
let dataDir: string;

/** The tool's structured payload, which the SDK returns as JSON text. */
async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = res.content.map((c) => c.text).join("");
  if (res.isError) throw new Error(text);
  return JSON.parse(text);
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "konchi-mcp-delivery-"));
  svc = new KonchiService(new Config(dataDir));
  // Every speech family is an opt-in catalog entry — a default install has no
  // TTS model at all — so enable the two this file reasons about.
  svc.updateSettings({
    enabled_audiocpp_models: ["audiocpp-chatterbox", "audiocpp-fish-audio"],
  });
  const server = buildMcp(() => svc);
  client = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterAll(async () => {
  await client.close();
  // Closing the service releases the SQLite handle; on Windows the temp dir
  // cannot be removed while it is open.
  await svc.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("discovery", () => {
  it("offers delivery on the four tools that can set it", async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    const props = (name: string) =>
      (byName[name]!.inputSchema as { properties: Record<string, unknown> }).properties;

    expect(props("konchi.speak")).toHaveProperty("delivery");
    expect(props("konchi.create_story")).toHaveProperty("delivery");
    expect(props("konchi.update_line")).toHaveProperty("delivery");
    // add_lines carries it per line rather than per call.
    const lines = (props("konchi.add_lines") as { lines: { items: { properties: object } } })
      .lines;
    expect(lines.items.properties).toHaveProperty("delivery");
  });

  it("tells an agent which knobs a speech model has, with their ranges", async () => {
    const models = await call("konchi.list_models", {});
    const chatterbox = models.find((m: { id: string }) => m.id === "audiocpp-chatterbox");
    expect(chatterbox.delivery).toBeDefined();

    const exaggeration = chatterbox.delivery.find(
      (d: { name: string }) => d.name === "exaggeration",
    );
    expect(exaggeration).toMatchObject({ group: "delivery", default: 0.5, minimum: 0, maximum: 2 });

    // The names measured as dead on this family must not be advertised.
    const names = chatterbox.delivery.map((d: { name: string }) => d.name);
    expect(names).not.toContain("instruct");
    expect(names).not.toContain("emotion");
    expect(names).not.toContain("speaking_rate");
  });

  it("says nothing at all for a family with no knobs, rather than an empty list", async () => {
    const models = await call("konchi.list_models", {});
    const fish = models.find((m: { id: string }) => m.id === "audiocpp-fish-audio");
    // Present, and deliberately silent: Fish Audio has no row upstream, so the
    // words and the voice are its only controls.
    expect(fish).toBeDefined();
    expect(fish.delivery).toBeUndefined();
  });
});

describe("setting a delivery", () => {
  it("stores the story's default from create_story", async () => {
    const story = await call("konchi.create_story", {
      title: "Interrogation",
      delivery: { exaggeration: "1.4" },
    });
    expect(story.delivery).toEqual({ exaggeration: "1.4" });
    expect(svc.getStory(story.story_id)!.request_options).toEqual({ exaggeration: "1.4" });
  });

  it("stores a line's own from add_lines, and leaves the others following", async () => {
    const story = await call("konchi.create_story", { delivery: { exaggeration: "0.5" } });
    await call("konchi.add_lines", {
      story_id: story.story_id,
      lines: [
        { text: "Ordinary line." },
        { text: "The angry one.", delivery: { exaggeration: "1.8" } },
      ],
    });

    const read = await call("konchi.get_story", { story_id: story.story_id });
    const [first, second] = read.lines;
    // The first line carries nothing of its own — it follows the story's
    // default, which get_story reports separately.
    expect(first.delivery).toBeUndefined();
    expect(second.delivery).toEqual({ exaggeration: "1.8" });
    expect(read.request_options).toEqual({ exaggeration: "0.5" });
  });

  it("sets and clears a line's delivery through update_line", async () => {
    const story = await call("konchi.create_story", {});
    const added = await call("konchi.add_lines", {
      story_id: story.story_id,
      lines: [{ text: "Say it again." }],
    });
    expect(added.added).toBe(1);
    const segments = svc.listSegments(story.story_id);
    const lineId = segments[0]!.id;

    const set = await call("konchi.update_line", {
      line_id: lineId,
      delivery: { exaggeration: "1.1", temperature: "0.9" },
    });
    expect(set.delivery).toEqual({ exaggeration: "1.1", temperature: "0.9" });

    const cleared = await call("konchi.update_line", { line_id: lineId, delivery: {} });
    expect(cleared.delivery).toBeUndefined();
    expect(svc.getSegment(lineId)!.request_options).toEqual({});
  });

  it("does not disturb a stored delivery when editing something else", async () => {
    const story = await call("konchi.create_story", {});
    await call("konchi.add_lines", {
      story_id: story.story_id,
      lines: [{ text: "First draft.", delivery: { exaggeration: "1.2" } }],
    });
    const lineId = svc.listSegments(story.story_id)[0]!.id;

    const moved = await call("konchi.update_line", { line_id: lineId, text: "Second draft." });
    expect(moved.text).toBe("Second draft.");
    expect(moved.delivery).toEqual({ exaggeration: "1.2" });
  });
});
