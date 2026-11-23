/**
 * `metered` and `downloadable` on ModelInfo, and the rule they exist for: a
 * model that costs the user money per render is never the default.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { Config } from "../src/config.js";
import { EndpointModel } from "../src/endpoints/model.js";
import type { AudioEndpoint } from "../src/endpoints/types.js";
import { buildMcp } from "../src/mcp/server.js";
import type { ModelInfo } from "../src/models/types.js";
import { MirliService } from "../src/service.js";

function endpoint(url: string): AudioEndpoint {
  return {
    id: "ep",
    name: "ep",
    task: "sfx",
    url,
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
  };
}

describe("ModelInfo.metered / downloadable", () => {
  it("marks an endpoint outside this machine and its network as metered", () => {
    const remote = new EndpointModel(endpoint("https://api.example.com/v1/sound")).describe();
    const lan = new EndpointModel(endpoint("http://192.168.1.20:8080/v1/sound")).describe();
    expect(remote).toMatchObject({ metered: true, downloadable: false });
    expect(lan).toMatchObject({ metered: false, downloadable: false });
  });

  it("treats a private overlay network (Tailscale) as local", () => {
    for (const url of ["http://100.101.102.103:8080/v1/sound", "https://gpu-box.tail1234.ts.net/v1/sound"]) {
      expect(new EndpointModel(endpoint(url)).describe().metered).toBe(false);
    }
    // 100.128.0.0 is just past the shared range, so a public address.
    expect(new EndpointModel(endpoint("http://100.128.0.1/v1/sound")).describe().metered).toBe(true);
  });
});

describe("MCP default model", () => {
  let dataDir: string;
  let svc: MirliService;
  let client: Client;
  let listed: ModelInfo[] = [];

  async function generate(): Promise<{ text: string; isError: boolean }> {
    const res = (await client.callTool({ name: "soundbox.generate", arguments: { prompt: "a door" } })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    return { text: res.content.map((c) => c.text).join(""), isError: Boolean(res.isError) };
  }

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mirli-metered-"));
    svc = new MirliService(new Config(dataDir));
    vi.spyOn(svc, "listModels").mockImplementation(async () => listed);
    // Reaching submit is all that matters here: record the model and stop.
    vi.spyOn(svc, "submitGenerate").mockImplementation((req: { model: string }) => {
      throw new Error(`submitted ${req.model}`);
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildMcp(() => svc).connect(a);
    client = new Client({ name: "test", version: "0" });
    await client.connect(b);
  });

  afterAll(async () => {
    await client.close();
    await svc.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const base = (id: string, metered: boolean): ModelInfo =>
    ({ id, status: "installed", metered, downloadable: !metered, task: "gen", category: "sfx" }) as ModelInfo;

  it("skips a metered model even when it is listed first", async () => {
    listed = [base("endpoint:paid", true), base("audiocpp-free", false)];
    const res = await generate();
    expect(res.text).toContain("submitted audiocpp-free");
  });

  it("refuses to pick when only metered models are ready, and says how to name one", async () => {
    listed = [base("endpoint:paid", true)];
    const res = await generate();
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/never picked by default/);
  });

  describe("soundbox.speak", () => {
    const tts = (id: string, metered: boolean): ModelInfo =>
      ({ ...base(id, metered), task: "tts", category: "speech" }) as ModelInfo;

    async function speak(voiceId?: string): Promise<string> {
      const res = (await client.callTool({
        name: "soundbox.speak",
        arguments: { lines: [{ text: "hello", ...(voiceId ? { voice_id: voiceId } : {}) }] },
      })) as { content: { text: string }[] };
      return res.content.map((c) => c.text).join("");
    }

    beforeAll(() => {
      vi.spyOn(svc, "submitSpeak").mockImplementation((req: { model: string }) => {
        throw new Error(`submitted ${req.model}`);
      });
      vi.spyOn(svc, "getVoice").mockImplementation(
        (id: string) => ({ id, name: "Narrator", model_id: "endpoint:paid-tts" }) as ReturnType<MirliService["getVoice"]>,
      );
    });

    it("reads a voice on its own metered model: naming the voice names the model", async () => {
      listed = [tts("audiocpp-tts", false), tts("endpoint:paid-tts", true)];
      expect(await speak("v1")).toContain("submitted endpoint:paid-tts");
    });

    it("never picks the metered model for a line without a voice", async () => {
      listed = [tts("endpoint:paid-tts", true), tts("audiocpp-tts", false)];
      expect(await speak()).toContain("submitted audiocpp-tts");
    });
  });
});
