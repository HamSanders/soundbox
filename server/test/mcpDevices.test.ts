/**
 * Agents can put devices on a track, turn them and take them off.
 *
 * Driven through a real MCP client like mcpVoiceModel.test.ts, and checked
 * from the other side too: what the tools write is what the studio reads back
 * from GET /api/stories/:id/tracks, every write announces a change (that is
 * what makes the open studio redraw its rack), the studio's own PATCH is
 * normalised the same way, and a chain moves with its lane when a lane below
 * it is removed.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import { defaultParams } from "../src/devices.js";
import { buildMcp } from "../src/mcp/server.js";
import type { SoundboxService } from "../src/service.js";

let app: FastifyInstance;
let svc: SoundboxService;
let client: Client;
let dataDir: string;

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = res.content.map((c) => c.text).join("");
  if (res.isError) throw new Error(text);
  return JSON.parse(text);
}

async function tracks(storyId: string): Promise<any[]> {
  const res = await app.inject({ method: "GET", url: `/api/stories/${storyId}/tracks` });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function newStory(): Promise<string> {
  return (await call("soundbox.create_story", { title: "Devices" })).story_id;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "soundbox-mcp-devices-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
  svc = (app as unknown as { soundbox: SoundboxService }).soundbox;
  const server = buildMcp(() => svc);
  client = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterAll(async () => {
  await client.close();
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("the tools are listed", () => {
  it("advertises add, set and remove", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["soundbox.add_device", "soundbox.set_device", "soundbox.remove_device"]) {
      expect(names).toContain(n);
    }
    const add = tools.find((t) => t.name === "soundbox.add_device")!;
    // The ranges travel with the schema, so an agent never has to guess a key.
    expect(JSON.stringify(add.inputSchema)).toContain("highFrequency");
  });
});

describe("soundbox.add_device", () => {
  it("adds at its defaults, persists, and the studio reads it back", async () => {
    const id = await newStory();
    const changed = vi.spyOn(svc.stories, "changed");
    const res = await call("soundbox.add_device", { story_id: id, track_index: 0, kind: "eq" });

    expect(res.devices).toHaveLength(1);
    expect(res.devices[0]).toMatchObject({ kind: "eq", bypassed: false, params: defaultParams("eq") });
    expect(res.device).toBe(res.devices[0].id);
    expect(res.note).toMatch(/export_story mixes dry/);
    expect(changed).toHaveBeenCalledWith(id);
    changed.mockRestore();

    const [row] = await tracks(id);
    expect(row.devices).toEqual(res.devices);
  });

  it("sets knobs as it goes on, clamping and reporting over-reach", async () => {
    const id = await newStory();
    const res = await call("soundbox.add_device", {
      story_id: id,
      track_index: 1,
      kind: "reverb",
      params: { wet: 2, decay: 3 },
    });
    expect(res.devices[0].params).toMatchObject({ wet: 1, decay: 3 });
    expect(res.clamped).toEqual([{ key: "wet", asked: 2, set: 1 }]);
  });

  it("inserts at a position", async () => {
    const id = await newStory();
    await call("soundbox.add_device", { story_id: id, track_index: 0, kind: "compressor" });
    await call("soundbox.add_device", { story_id: id, track_index: 0, kind: "limiter" });
    const res = await call("soundbox.add_device", {
      story_id: id,
      track_index: 0,
      kind: "eq",
      position: 0,
    });
    expect(res.devices.map((d: any) => d.kind)).toEqual(["eq", "compressor", "limiter"]);
  });

  it("rejects a knob the device does not have", async () => {
    const id = await newStory();
    await expect(
      call("soundbox.add_device", { story_id: id, track_index: 0, kind: "eq", params: { treble: 2 } }),
    ).rejects.toThrow(/no knob "treble".*low, mid, high/);
    expect((await tracks(id)).length).toBe(0);
  });

  it("rejects an unknown kind and an unknown story", async () => {
    const id = await newStory();
    await expect(
      call("soundbox.add_device", { story_id: id, track_index: 0, kind: "flanger" }),
    ).rejects.toThrow();
    await expect(
      call("soundbox.add_device", { story_id: "nope", track_index: 0, kind: "eq" }),
    ).rejects.toThrow(/No story/);
  });

  it("leaves the rest of the track alone", async () => {
    const id = await newStory();
    await call("soundbox.mix_track", { story_id: id, track_index: 0, name: "Narrator", gain_db: -3 });
    await call("soundbox.add_device", { story_id: id, track_index: 0, kind: "gate" });
    const [row] = await tracks(id);
    expect(row).toMatchObject({ name: "Narrator", gain_db: -3 });
    expect(row.devices).toHaveLength(1);
  });
});

describe("soundbox.set_device", () => {
  it("turns knobs by kind, keeping the others", async () => {
    const id = await newStory();
    await call("soundbox.add_device", { story_id: id, track_index: 0, kind: "eq" });
    const res = await call("soundbox.set_device", {
      story_id: id,
      track_index: 0,
      device: "eq",
      params: { low: 3, high: -5 },
    });
    expect(res.devices[0].params).toEqual({ ...defaultParams("eq"), low: 3, high: -5 });
    expect((await tracks(id))[0].devices[0].params.high).toBe(-5);
  });

  it("bypasses and re-enables without losing settings", async () => {
    const id = await newStory();
    const added = await call("soundbox.add_device", {
      story_id: id,
      track_index: 0,
      kind: "compressor",
      params: { ratio: 6 },
    });
    const off = await call("soundbox.set_device", {
      story_id: id,
      track_index: 0,
      device: added.device,
      bypassed: true,
    });
    expect(off.devices[0]).toMatchObject({ bypassed: true, params: { ratio: 6 } });
    const on = await call("soundbox.set_device", {
      story_id: id,
      track_index: 0,
      device: added.device,
      bypassed: false,
    });
    expect(on.devices[0]).toMatchObject({ bypassed: false, params: { ratio: 6 } });
  });

  it("asks for an id when the kind is ambiguous", async () => {
    const id = await newStory();
    const a = await call("soundbox.add_device", { story_id: id, track_index: 0, kind: "eq" });
    await call("soundbox.add_device", { story_id: id, track_index: 0, kind: "eq" });
    await expect(
      call("soundbox.set_device", { story_id: id, track_index: 0, device: "eq", params: { low: 1 } }),
    ).rejects.toThrow(/2 eq devices; pass one id/);
    const res = await call("soundbox.set_device", {
      story_id: id,
      track_index: 0,
      device: a.device,
      params: { low: 1 },
    });
    expect(res.devices[0].params.low).toBe(1);
    expect(res.devices[1].params.low).toBe(0);
  });

  it("says what is on the track when the device is not", async () => {
    const id = await newStory();
    await call("soundbox.add_device", { story_id: id, track_index: 0, kind: "gate" });
    await expect(
      call("soundbox.set_device", { story_id: id, track_index: 0, device: "reverb", params: { wet: 1 } }),
    ).rejects.toThrow(/no device "reverb".*\(gate\)/);
  });

  it("needs something to change", async () => {
    const id = await newStory();
    await call("soundbox.add_device", { story_id: id, track_index: 0, kind: "gate" });
    await expect(
      call("soundbox.set_device", { story_id: id, track_index: 0, device: "gate" }),
    ).rejects.toThrow(/Nothing to change/);
  });
});

describe("soundbox.remove_device", () => {
  it("removes one device and empties the stored chain at the end", async () => {
    const id = await newStory();
    await call("soundbox.add_device", { story_id: id, track_index: 0, kind: "eq" });
    await call("soundbox.add_device", { story_id: id, track_index: 0, kind: "reverb" });
    const res = await call("soundbox.remove_device", { story_id: id, track_index: 0, device: "eq" });
    expect(res.devices.map((d: any) => d.kind)).toEqual(["reverb"]);
    const empty = await call("soundbox.remove_device", {
      story_id: id,
      track_index: 0,
      device: "reverb",
    });
    expect(empty.devices).toEqual([]);
    expect((await tracks(id))[0].devices).toEqual([]);
  });
});

describe("soundbox.get_story", () => {
  it("returns each touched track with its chain", async () => {
    const id = await newStory();
    await call("soundbox.add_device", { story_id: id, track_index: 2, kind: "delay" });
    const story = await call("soundbox.get_story", { story_id: id });
    expect(story.tracks).toHaveLength(1);
    expect(story.tracks[0]).toMatchObject({ track_index: 2, devices: [{ kind: "delay" }] });
  });
});

describe("the studio's PATCH", () => {
  it("normalises a chain the same way", async () => {
    const id = await newStory();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/stories/${id}/tracks/0`,
      payload: { devices: [{ kind: "reverb", params: { wet: 5, bogus: 1 } }] },
    });
    expect(res.statusCode).toBe(200);
    const [device] = res.json().devices;
    expect(device.params).toEqual({ ...defaultParams("reverb"), wet: 1 });
    expect(device.id).toMatch(/^reverb-/);
  });

  it("refuses an unknown kind", async () => {
    const id = await newStory();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/stories/${id}/tracks/0`,
      payload: { devices: [{ kind: "flanger" }] },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("leaves the chain alone when a patch does not mention it", async () => {
    const id = await newStory();
    await call("soundbox.add_device", { story_id: id, track_index: 0, kind: "eq" });
    await app.inject({
      method: "PATCH",
      url: `/api/stories/${id}/tracks/0`,
      payload: { muted: true },
    });
    const [row] = await tracks(id);
    expect(row.muted).toBe(true);
    expect(row.devices).toHaveLength(1);
  });
});

describe("removing a lane", () => {
  it("moves the chains above it down with their lanes", async () => {
    const id = await newStory();
    await call("soundbox.add_device", { story_id: id, track_index: 1, kind: "gate" });
    await call("soundbox.add_device", { story_id: id, track_index: 2, kind: "reverb" });
    await call("soundbox.remove_track", { story_id: id, track_index: 1 });
    const rows = await tracks(id);
    expect(rows.map((r) => [r.track_index, r.devices.map((d: any) => d.kind)])).toEqual([
      [1, ["reverb"]],
    ]);
  });
});
