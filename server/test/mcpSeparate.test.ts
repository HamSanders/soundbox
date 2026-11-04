/**
 * Stem separation as an agent sees it.
 *
 * Driven through a real MCP client, like the delivery tests, because what is
 * most likely to be wrong here is the surface rather than the split: the
 * splitting rules already have their own tests in `stems.test.ts`, and what
 * this file pins down is that separation is reachable at all, that a model an
 * agent cannot generate with says so in the listing, and that "no separator
 * installed" arrives as a sentence rather than as a failed job.
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
  dataDir = await mkdtemp(join(tmpdir(), "konchi-mcp-separate-"));
  svc = new KonchiService(new Config(dataDir));
  const server = buildMcp(() => svc);
  client = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterAll(async () => {
  await client.close();
  await svc.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("konchi.separate", () => {
  it("is offered, and takes a selection rather than only all-or-nothing", async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === "konchi.separate");
    expect(tool).toBeDefined();
    const props = tool!.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(["model", "rest", "sound_id", "stems"]);
    // Required-ness is the part an agent gets wrong: everything but the sound
    // has a sensible answer without being asked.
    expect(tool!.inputSchema.required).toEqual(["sound_id"]);
  });

  it("says which model to install rather than failing a job", async () => {
    // A fresh profile has no separator, which is also the state most users
    // are in the first time an agent reaches for this.
    await expect(call("konchi.separate", { sound_id: "nope" })).rejects.toThrow(
      /No stem-separation model is installed/i,
    );
  });

});

/** Separators are opt-in catalog entries, like the speech families: a default
 *  install genuinely has none, which is what the test above relies on. */
describe("with a separator enabled", () => {
  beforeAll(() => {
    svc.updateSettings({ enabled_audiocpp_models: ["audiocpp-htdemucs-sep"] });
  });

  it("reports a missing sound as a missing sound", async () => {
    await expect(
      call("konchi.separate", { sound_id: "nope", model: "audiocpp-htdemucs-sep" }),
    ).rejects.toThrow(/not found/i);
  });

  it("refuses a model that does not separate", async () => {
    const gen = (await svc.listModels()).find((m) => m.task === "gen");
    await expect(
      call("konchi.separate", { sound_id: "nope", model: gen!.id }),
    ).rejects.toThrow(/does not support stem separation/i);
  });

  it("says on konchi.list_models which surface each model belongs to", async () => {
    const models = await call("konchi.list_models", {});
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) expect(typeof m.task).toBe("string");
    // The point of the field: a separator sits in this same list and is not
    // something konchi.generate can be called with.
    expect(models.some((m: { task: string }) => m.task === "sep")).toBe(true);
  });
});
