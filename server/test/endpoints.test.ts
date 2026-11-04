import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { WaveFile } from "wavefile";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import { decodePcm16, requestAudio } from "../src/endpoints/client.js";
import { ENDPOINT_PRESETS } from "../src/endpoints/presets.js";
import {
  bpmFromPrompt,
  keyFromPrompt,
  renderTemplate,
  templateVariables,
  validateTemplate,
} from "../src/endpoints/template.js";
import { isLocalUrl } from "../src/endpoints/types.js";
import { ModelError } from "../src/errors.js";

/** A short 16-bit mono WAV, as an endpoint would send it. */
function wavBytes(seconds = 0.5, rate = 22_050): Buffer {
  const n = Math.round(seconds * rate);
  const samples = Array.from({ length: n }, (_, i) => Math.round(Math.sin(i / 10) * 8000));
  const wav = new WaveFile();
  wav.fromScratch(1, rate, "16", samples);
  return Buffer.from(wav.toBuffer());
}

describe("renderTemplate", () => {
  it("types bare and whole-string placeholders, and interpolates inside strings", () => {
    const body = renderTemplate(
      '{"bpm": {{bpm}}, "dur": "{{duration}}", "caption": "a {{key}} loop", "inst": {{instrumental}}}',
      { bpm: 90, duration: 12.5, key: "A minor", instrumental: true },
    );
    expect(body).toEqual({ bpm: 90, dur: 12.5, caption: "a A minor loop", inst: true });
  });

  it("drops fields whose value is null, at any depth", () => {
    const body = renderTemplate('{"a": "{{lyrics}}", "b": {"c": {{bpm}}, "d": 1}, "e": "{{prompt}}"}', {
      lyrics: null,
      bpm: null,
      prompt: "x",
    });
    expect(body).toEqual({ b: { d: 1 }, e: "x" });
  });

  it("keeps a prompt with quotes and braces inside its string", () => {
    const prompt = 'say "hi" }, "evil": true, {';
    expect(renderTemplate('{"p": "{{prompt}}"}', { prompt })).toEqual({ p: prompt });
    expect(renderTemplate('{"p": "pre {{prompt}}"}', { prompt })).toEqual({ p: `pre ${prompt}` });
  });

  it("leaves escaped quotes in the template alone", () => {
    expect(renderTemplate('{"p": "a \\"{{prompt}}\\""}', { prompt: "b" })).toEqual({ p: 'a "b"' });
  });
});

describe("validateTemplate", () => {
  it("accepts every shipped preset", () => {
    for (const preset of ENDPOINT_PRESETS) {
      expect(() => validateTemplate(preset.endpoint.body_template), preset.id).not.toThrow();
    }
  });

  it("names an unknown variable", () => {
    expect(() => validateTemplate('{"p": "{{promt}}"}')).toThrow(/promt/);
  });

  it("rejects a template that is not JSON once filled", () => {
    expect(() => validateTemplate('{"p": {{prompt}} ')).toThrow(ModelError);
  });

  it("rejects a body that is not an object", () => {
    expect(() => validateTemplate('["{{prompt}}"]')).toThrow(/object/);
  });

  it("lists variables in order of first use", () => {
    expect(templateVariables('{"a": "{{prompt}}", "b": {{ bpm }}, "c": "{{prompt}}"}')).toEqual([
      "prompt",
      "bpm",
    ]);
  });
});

describe("reading the prompt", () => {
  it("finds a tempo", () => {
    expect(bpmFromPrompt("boom bap, 90 BPM, dusty")).toBe(90);
    expect(bpmFromPrompt("128bpm house")).toBe(128);
    expect(bpmFromPrompt("a slow song")).toBeNull();
  });

  it("finds a key, and normalises it", () => {
    expect(keyFromPrompt("piano in A minor")).toBe("A minor");
    expect(keyFromPrompt("Ebm pad")).toBe("Eb minor");
    expect(keyFromPrompt("F# maj7 chords")).toBe("F# major");
    expect(keyFromPrompt("C major scale")).toBe("C major");
  });

  it("does not read ordinary words as keys", () => {
    expect(keyFromPrompt("a major hit, a minimal beat")).toBeNull();
    expect(keyFromPrompt("A mellow guitar")).toBeNull();
    expect(keyFromPrompt("Add more bass")).toBeNull();
  });
});

describe("isLocalUrl", () => {
  it("treats this machine and the LAN as local", () => {
    for (const url of [
      "http://localhost:8080/v1/x",
      "http://127.0.0.1:8080",
      "http://192.168.1.20:8080",
      "http://10.0.0.5",
      "http://172.20.0.2",
      "http://homeserver:8080",
      "http://nas.local",
      "http://box.home.arpa",
      "http://[::1]:8080",
      "http://[fd12:3456::1]",
    ]) {
      expect(isLocalUrl(url), url).toBe(true);
    }
  });

  it("treats everything else as off-network", () => {
    for (const url of [
      "https://api.privateer.pro/v1/audio/music",
      "https://example.com",
      "http://8.8.8.8",
      "http://172.32.0.1",
      "not a url",
    ]) {
      expect(isLocalUrl(url), url).toBe(false);
    }
  });
});

describe("requestAudio", () => {
  const audioResponse = (bytes: Buffer, type: string) =>
    new Response(bytes, { status: 200, headers: { "Content-Type": type } });

  it("decodes a WAV body by its header, whatever the Content-Type says", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(wavBytes(), "application/octet-stream"));
    const out = await requestAudio({ url: "http://x/y", body: { a: 1 }, apiKey: "k" }, fetchMock as never);
    expect(out.sampleRate).toBe(22_050);
    expect(out.audio[0]!.length).toBe(11_025);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body)).toEqual({ a: 1 });
  });

  it("reads audio/pcm as 16-bit mono at the declared rate", async () => {
    const pcm = Buffer.alloc(4800);
    const fetchMock = vi.fn().mockResolvedValue(audioResponse(pcm, "audio/pcm"));
    const out = await requestAudio({ url: "http://x", body: {}, pcmSampleRate: 24_000 }, fetchMock as never);
    expect(out.sampleRate).toBe(24_000);
    expect(out.audio[0]!.length).toBe(2400);
  });

  it("pulls base64 audio out of a JSON response by path", async () => {
    const b64 = `data:audio/wav;base64,${wavBytes().toString("base64")}`;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ audio: b64 }] }), { status: 200 }));
    const out = await requestAudio({ url: "http://x", body: {}, responsePath: "data.0.audio" }, fetchMock as never);
    expect(out.audio[0]!.length).toBe(11_025);
  });

  it("says so when JSON arrives where audio was expected", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"error":"no"}', { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await expect(requestAudio({ url: "http://x", body: {} }, fetchMock as never)).rejects.toThrow(
      /response path/,
    );
  });

  it("puts the server's error text in the message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("model not found", { status: 400 }));
    await expect(requestAudio({ url: "http://x", body: {} }, fetchMock as never)).rejects.toThrow(
      /HTTP 400: model not found/,
    );
  });

  it("decodePcm16 scales to [-1, 1)", () => {
    const b = Buffer.alloc(4);
    b.writeInt16LE(-32768, 0);
    b.writeInt16LE(16384, 2);
    const { audio } = decodePcm16(b, 8000);
    expect(Array.from(audio[0]!)).toEqual([-1, 0.5]);
  });
});

/* ---------------------------------------------------------- end to end */

describe("custom endpoints through the API", () => {
  let app: FastifyInstance;
  let dataDir: string;
  let stub: Server;
  let stubUrl: string;
  const received: { url: string; body: unknown; auth: string | undefined }[] = [];

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "konchi-endpoints-test-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
    stub = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ url: req.url ?? "", body: JSON.parse(body), auth: req.headers.authorization });
        res.setHeader("Content-Type", "audio/wav");
        res.end(wavBytes(1));
      });
    });
    await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
    const address = stub.address();
    stubUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await app.close();
    await new Promise((r) => stub.close(r));
    await rm(dataDir, { recursive: true, force: true });
  });

  const musicEndpoint = () => ({
    name: "Homelab ACE-Step",
    task: "music",
    url: `${stubUrl}/v1/sound-generation`,
    api_key: "secret",
    body_template: ENDPOINT_PRESETS.find((p) => p.id === "localai-ace-step")!.endpoint.body_template,
    max_duration_s: 120,
  });

  it("saves an endpoint without ever returning its key", async () => {
    const resp = await app.inject({ method: "PUT", url: "/api/endpoints/homelab", payload: musicEndpoint() });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().api_key_set).toBe(true);
    expect(JSON.stringify(resp.json())).not.toContain("secret");

    const list = (await app.inject({ method: "GET", url: "/api/endpoints" })).json();
    expect(list.endpoints.map((e: { id: string }) => e.id)).toEqual(["homelab"]);
    expect(list.presets.length).toBeGreaterThan(0);
    expect(JSON.stringify(list)).not.toContain("secret");
  });

  it("keeps the stored key when an edit omits it", async () => {
    const { api_key: _omit, ...rest } = musicEndpoint();
    await app.inject({ method: "PUT", url: "/api/endpoints/homelab", payload: { ...rest, name: "Renamed" } });
    const list = (await app.inject({ method: "GET", url: "/api/endpoints" })).json();
    expect(list.endpoints[0].name).toBe("Renamed");
    expect(list.endpoints[0].api_key_set).toBe(true);
  });

  it("refuses a bad id and a broken template", async () => {
    const badId = await app.inject({ method: "PUT", url: "/api/endpoints/Not%20OK", payload: musicEndpoint() });
    expect(badId.statusCode).toBe(400);
    const badTemplate = await app.inject({
      method: "PUT",
      url: "/api/endpoints/broken",
      payload: { ...musicEndpoint(), body_template: '{"p": "{{nope}}"}' },
    });
    expect(badTemplate.statusCode).toBe(400);
    expect(badTemplate.json().detail).toMatch(/nope/);
  });

  it("lists it as a model, after the local ones", async () => {
    const models = (await app.inject({ method: "GET", url: "/api/models" })).json() as {
      id: string;
      provider: string;
      status: string;
      category: string;
      supports: { lyrics: boolean; seed: boolean };
    }[];
    const ep = models.find((m) => m.id === "endpoint:homelab")!;
    expect(ep).toBeTruthy();
    expect(ep.provider).toBe("endpoint");
    expect(ep.status).toBe("installed");
    expect(ep.category).toBe("music");
    // Derived from the template: it sends lyrics, and has no {{seed}}.
    expect(ep.supports.lyrics).toBe(true);
    expect(ep.supports.seed).toBe(false);
    expect(models.at(-1)!.id).toBe("endpoint:homelab");
  });

  it("generates through it into the library", async () => {
    received.length = 0;
    const submit = await app.inject({
      method: "POST",
      url: "/api/generate",
      payload: { model: "endpoint:homelab", prompt: "lofi piano, 84 BPM, D minor", duration_s: 10 },
    });
    expect(submit.statusCode).toBe(202);
    const jobId = submit.json().job_id as string;

    let job: { status: string; error?: string; result?: { sounds: string[] } } = { status: "queued" };
    for (let i = 0; i < 100 && !["done", "error"].includes(job.status); i++) {
      await new Promise((r) => setTimeout(r, 50));
      job = (await app.inject({ method: "GET", url: `/api/jobs/${jobId}` })).json();
    }
    expect(job.error ?? null).toBeNull();
    expect(job.status).toBe("done");

    expect(received).toHaveLength(1);
    expect(received[0]!.url).toBe("/v1/sound-generation");
    expect(received[0]!.auth).toBe("Bearer secret");
    expect(received[0]!.body).toEqual({
      model_id: "ace-step-turbo",
      caption: "lofi piano, 84 BPM, D minor",
      instrumental: true,
      bpm: 84,
      keyscale: "D minor",
      duration_seconds: 10,
    });

    const sound = (await app.inject({ method: "GET", url: `/api/sounds/${job.result!.sounds[0]}` })).json();
    expect(sound.model).toBe("endpoint:homelab");
  });

  it("tests a configuration without saving anything", async () => {
    received.length = 0;
    const resp = await app.inject({
      method: "POST",
      url: "/api/endpoints/test",
      payload: { ...musicEndpoint(), api_key: undefined, id: "homelab" },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.json().duration_s).toBeCloseTo(1, 1);
    // The saved key is used when the form does not send one.
    expect(received[0]!.auth).toBe("Bearer secret");
  });

  it("removes it from the models list on delete", async () => {
    const del = await app.inject({
      method: "DELETE",
      url: "/api/endpoints/homelab",
      headers: { "x-konchi": "1" },
    });
    expect(del.statusCode).toBe(204);
    const models = (await app.inject({ method: "GET", url: "/api/models" })).json() as { id: string }[];
    expect(models.some((m) => m.id === "endpoint:homelab")).toBe(false);
  });
});
