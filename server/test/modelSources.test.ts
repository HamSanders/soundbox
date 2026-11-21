import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EndpointModel } from "../src/endpoints/model.js";
import { EndpointSource } from "../src/endpoints/source.js";
import type { AudioEndpoint } from "../src/endpoints/types.js";
import { ModelError } from "../src/errors.js";
import { ModelManager } from "../src/models/manager.js";
import type { ModelSource } from "../src/models/source.js";
import type { GenerationModel } from "../src/models/types.js";

/** A source whose ids can be changed, building stand-in models that only know their id. */
class FakeSource implements ModelSource {
  created = 0;
  constructor(
    readonly name: string,
    public list: string[],
  ) {}
  ids(): string[] {
    return this.list;
  }
  create(id: string): GenerationModel {
    this.created++;
    return { id, provider: "endpoint", loaded: true, unload() {} } as unknown as GenerationModel;
  }
}

function endpoint(id: string, enabled = true): AudioEndpoint {
  return {
    id,
    name: id,
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
    enabled,
  };
}

describe("ModelManager sources", () => {
  let dir: string;
  let localIds: string[];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "mirli-sources-"));
    localIds = new ModelManager(dir).ids();
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lists local models first, then each source in the order given", () => {
    const a = new FakeSource("a", ["a:1", "a:2"]);
    const b = new FakeSource("b", ["b:1"]);
    const m = new ModelManager(dir, null, [], undefined, [a, b]);
    expect(m.ids()).toEqual([...localIds, "a:1", "a:2", "b:1"]);
  });

  it("never lets a source shadow a local model or an earlier source", () => {
    expect(localIds.length).toBeGreaterThan(0);
    const local = localIds[0]!;
    const a = new FakeSource("a", [local, "dup"]);
    const b = new FakeSource("b", ["dup"]);
    const m = new ModelManager(dir, null, [], undefined, [a, b]);
    expect(m.ids().filter((id) => id === local)).toHaveLength(1);
    expect(m.get(local).provider).toBe("local");
    expect(m.get("dup")).toBe(m.get("dup"));
    expect(a.created).toBe(1);
    expect(b.created).toBe(0);
  });

  it("caches instances, and refreshSource rebuilds only that source's", async () => {
    const a = new FakeSource("a", ["a:1"]);
    const b = new FakeSource("b", ["b:1"]);
    const m = new ModelManager(dir, null, [], undefined, [a, b]);
    const a1 = m.get("a:1");
    const b1 = m.get("b:1");
    expect(m.get("a:1")).toBe(a1);

    await m.refreshSource(a);
    expect(m.get("a:1")).not.toBe(a1);
    expect(m.get("b:1")).toBe(b1);
  });

  it("picks up added and removed ids on refresh", async () => {
    const a = new FakeSource("a", ["a:1"]);
    const m = new ModelManager(dir, null, [], undefined, [a]);
    a.list = ["a:2"];
    expect(m.ids()).toContain("a:1");
    await m.refreshSource(a);
    expect(m.ids()).toContain("a:2");
    expect(m.ids()).not.toContain("a:1");
    expect(() => m.get("a:1")).toThrow(ModelError);
  });
});

describe("EndpointSource", () => {
  it("offers enabled endpoints as endpoint: models", () => {
    const source = new EndpointSource([endpoint("one"), endpoint("off", false)]);
    expect(source.ids()).toEqual(["endpoint:one"]);
    expect(source.create("endpoint:one")).toBeInstanceOf(EndpointModel);
    expect(() => source.create("endpoint:off")).toThrow(ModelError);
  });

  it("reaches the manager through refreshSource after set()", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mirli-sources-"));
    try {
      const source = new EndpointSource([endpoint("one")]);
      const m = new ModelManager(dir, null, [], undefined, [source]);
      const before = m.get("endpoint:one");
      source.set([endpoint("one"), endpoint("two")]);
      await m.refreshSource(source);
      expect(m.ids()).toContain("endpoint:two");
      expect(m.get("endpoint:one")).not.toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
