import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { WaveFile } from "wavefile";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import { ENDPOINT_PRESETS } from "../src/endpoints/presets.js";

/** A short 16-bit mono WAV, as an endpoint would send it. */
function wavBytes(seconds = 0.5, rate = 22_050): Buffer {
  const n = Math.round(seconds * rate);
  const samples = Array.from({ length: n }, (_, i) => Math.round(Math.sin(i / 10) * 8000));
  const wav = new WaveFile();
  wav.fromScratch(1, rate, "16", samples);
  return Buffer.from(wav.toBuffer());
}

function urlOf(server: Server | FastifyInstance["server"]): string {
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

type Job = { id: string; status: string; kind: string };

async function settled(app: FastifyInstance, jobId: string): Promise<Job> {
  let job: Job = { id: jobId, status: "queued", kind: "" };
  for (let i = 0; i < 100 && !["done", "error", "cancelled"].includes(job.status); i++) {
    await new Promise((r) => setTimeout(r, 30));
    job = (await app.inject({ method: "GET", url: `/api/jobs/${jobId}` })).json();
  }
  return job;
}

/**
 * The "GPU box": a Soundbox whose models are custom endpoints pointing at a
 * stub, so a render costs nothing and the stub records what it was sent.
 */
describe("POST /api/render", () => {
  let app: FastifyInstance;
  let dataDir: string;
  let stub: Server;
  /** What the stub should do with the next request. */
  let mode: "ok" | "fail" | "slow" = "ok";
  const received: { url: string; body: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "soundbox-render-test-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
    stub = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ url: req.url ?? "", body: JSON.parse(body) });
        if (mode === "fail") {
          res.statusCode = 500;
          res.end("out of VRAM");
          return;
        }
        const send = () => {
          if (res.destroyed) return;
          res.setHeader("Content-Type", "audio/wav");
          res.end(wavBytes(1));
        };
        if (mode === "slow") setTimeout(send, 3000);
        else send();
      });
    });
    await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));

    const put = async (id: string, payload: Record<string, unknown>) => {
      const resp = await app.inject({ method: "PUT", url: `/api/endpoints/${id}`, payload });
      expect(resp.statusCode).toBe(200);
    };
    await put("fx", {
      name: "Stub SFX",
      task: "sfx",
      url: `${urlOf(stub)}/sfx`,
      body_template: '{"text": "{{prompt}}", "seconds": {{duration}}}',
      max_duration_s: 30,
    });
    await put("talk", {
      name: "Stub speech",
      task: "speech",
      url: `${urlOf(stub)}/speech`,
      body_template: '{"input": "{{text}}", "voice": "{{voice}}"}',
      voices: ["alloy", "nova"],
    });
    const voice = await app.inject({
      method: "POST",
      url: "/api/voices",
      payload: { name: "Nova", kind: "builtin", voice_id: "nova", model_id: "endpoint:talk" },
    });
    expect(voice.statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
    await new Promise((r) => stub.close(r));
    await rm(dataDir, { recursive: true, force: true });
  });

  it("runs a generation and answers with the WAV, keeping it in the library", async () => {
    mode = "ok";
    received.length = 0;
    const resp = await app.inject({
      method: "POST",
      url: "/api/render",
      payload: { model: "endpoint:fx", prompt: "door slam", duration_s: 2 },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["content-type"]).toBe("audio/wav");
    expect(resp.rawPayload.subarray(0, 4).toString()).toBe("RIFF");
    expect(received.map((r) => r.body)).toEqual([{ text: "door slam", seconds: 2 }]);

    const soundId = String(resp.headers["x-soundbox-sound-id"]);
    expect(soundId).not.toBe("");
    expect((await app.inject({ method: "GET", url: `/api/sounds/${soundId}` })).statusCode).toBe(200);
    const job = (await app.inject({ method: "GET", url: `/api/jobs/${resp.headers["x-soundbox-job-id"]}` })).json();
    expect(job.kind).toBe("generate");
  });

  it("deletes the sound after sending it when keep is false", async () => {
    mode = "ok";
    const before = (await app.inject({ method: "GET", url: "/api/sounds" })).json().total;
    const resp = await app.inject({
      method: "POST",
      url: "/api/render",
      payload: { model: "endpoint:fx", prompt: "glass", duration_s: 1, keep: false },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.rawPayload.length).toBeGreaterThan(44);
    expect(resp.headers["x-soundbox-sound-id"]).toBe("");
    expect((await app.inject({ method: "GET", url: "/api/sounds" })).json().total).toBe(before);
  });

  it("speaks a line, finding a saved voice by its name", async () => {
    mode = "ok";
    received.length = 0;
    const resp = await app.inject({
      method: "POST",
      url: "/api/render",
      payload: { model: "endpoint:talk", text: "Hello there.", voice: "nova" },
    });
    expect(resp.statusCode).toBe(200);
    expect(received.map((r) => r.body)).toEqual([{ input: "Hello there.", voice: "nova" }]);
    const job = (await app.inject({ method: "GET", url: `/api/jobs/${resp.headers["x-soundbox-job-id"]}` })).json();
    expect(job.kind).toBe("speak");
  });

  it("takes /api/speak's own body too", async () => {
    mode = "ok";
    const resp = await app.inject({
      method: "POST",
      url: "/api/render",
      payload: { model: "endpoint:talk", lines: [{ text: "One." }, { text: "Two." }] },
    });
    expect(resp.statusCode).toBe(200);
  });

  it("refuses what cannot come back as one file, and names an unknown voice", async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ model: "endpoint:fx", prompt: "x", variations: 2 }, /variations must be 1/],
      [{ model: "endpoint:fx", prompt: "x", separate: { model: "m" } }, /stems/],
      [{ model: "endpoint:talk", text: "Hi", voice: "Nobody" }, /No saved voice is called 'Nobody'.*Nova/],
      [{ model: "endpoint:talk", text: "Hi", lines: [{ text: "Hi" }] }, /either text or lines/],
      [{ model: "no-such-model", prompt: "x" }, /./],
    ];
    for (const [payload, detail] of cases) {
      const resp = await app.inject({ method: "POST", url: "/api/render", payload });
      expect(resp.statusCode, JSON.stringify(payload)).toBe(400);
      expect(resp.json().detail).toMatch(detail);
    }
  });

  it("passes a failed render on as a 500 with the reason", async () => {
    mode = "fail";
    const resp = await app.inject({
      method: "POST",
      url: "/api/render",
      payload: { model: "endpoint:fx", prompt: "boom", duration_s: 1 },
    });
    expect(resp.statusCode).toBe(500);
    expect(resp.json().detail).toMatch(/out of VRAM/);
    expect(resp.json().job_id).toBeTruthy();
  });

  it("cancels the job when the caller hangs up", async () => {
    mode = "slow";
    await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const controller = new AbortController();
      const pending = fetch(`${urlOf(app.server)}/api/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "endpoint:fx", prompt: "a long one", duration_s: 1 }),
        signal: controller.signal,
      }).catch((e: unknown) => e);
      // Wait for the job to be running, then hang up.
      let running: Job | undefined;
      for (let i = 0; i < 100 && !running; i++) {
        await new Promise((r) => setTimeout(r, 20));
        const jobs = (await app.inject({ method: "GET", url: "/api/jobs" })).json() as Job[];
        running = jobs.find((j) => j.status === "running");
      }
      expect(running).toBeTruthy();
      controller.abort();
      await pending;
      expect((await settled(app, running!.id)).status).toBe("cancelled");
    } finally {
      mode = "ok";
    }
  });
});

/**
 * The case the route is for: a laptop's Soundbox using a GPU box's Soundbox
 * as a custom endpoint, through the shipped preset, over a real socket.
 */
describe("one Soundbox rendering through another", () => {
  let gpu: FastifyInstance;
  let laptop: FastifyInstance;
  let stub: Server;
  const dirs: string[] = [];

  beforeAll(async () => {
    stub = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.setHeader("Content-Type", "audio/wav");
        res.end(wavBytes(1.5));
      });
    });
    await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));

    for (let i = 0; i < 2; i++) dirs.push(await mkdtemp(join(tmpdir(), "soundbox-render-pair-")));
    gpu = buildApp(new Config(dirs[0]!), { serveUi: false });
    laptop = buildApp(new Config(dirs[1]!), { serveUi: false });
    await gpu.ready();
    await laptop.ready();
    await gpu.listen({ port: 0, host: "127.0.0.1" });

    // On the GPU box, the "model" is the stub.
    await gpu.inject({
      method: "PUT",
      url: "/api/endpoints/engine",
      payload: { name: "Engine", task: "sfx", url: `${urlOf(stub)}/x`, body_template: '{"p": "{{prompt}}"}' },
    });
  });

  afterAll(async () => {
    await laptop.close();
    await gpu.close();
    await new Promise((r) => stub.close(r));
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it("generates on the far side and lands in the near library", async () => {
    const preset = ENDPOINT_PRESETS.find((p) => p.id === "soundbox-sfx")!;
    const put = await laptop.inject({
      method: "PUT",
      url: "/api/endpoints/gpu",
      payload: {
        ...preset.endpoint,
        name: "GPU box",
        url: `${urlOf(gpu.server)}/api/render`,
        body_template: preset.endpoint.body_template.replace("audiocpp-stable-audio-3-sfx", "endpoint:engine"),
      },
    });
    expect(put.statusCode).toBe(200);

    const submit = await laptop.inject({
      method: "POST",
      url: "/api/generate",
      payload: { model: "endpoint:gpu", prompt: "thunder", duration_s: 2 },
    });
    expect(submit.statusCode).toBe(202);
    const job = await settled(laptop, submit.json().job_id);
    expect(job.status).toBe("done");

    const near = (await laptop.inject({ method: "GET", url: "/api/sounds" })).json();
    expect(near.total).toBe(1);
    expect(near.items[0].model).toBe("endpoint:gpu");
    expect(near.items[0].duration_s).toBeCloseTo(1.5, 1);
    // The preset sends keep: false, so the GPU box does not fill up.
    expect((await gpu.inject({ method: "GET", url: "/api/sounds" })).json().total).toBe(0);
  });
});
