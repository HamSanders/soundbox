/**
 * The OpenAI-compatible routes: `/v1/audio/speech`, `/v1/audio/transcriptions`,
 * `/v1/models` and `/v1/audio/voices`.
 *
 * No model runs. Speech goes to a custom endpoint backed by a stub HTTP
 * server (as render.test.ts does), the streaming path is a scripted
 * generator swapped into the service, and transcription is a fake recogniser
 * swapped into the model manager. What is under test is the mapping of an
 * OpenAI request onto a Mirli model and voice, the wire formats, the error
 * envelope, and the two checks that sit in front of the routes.
 */

import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { WaveFile } from "wavefile";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import * as dsp from "../src/audio/dsp.js";
import { Config } from "../src/config.js";
import { GpuBusy, ModelError, StreamUnsupported } from "../src/errors.js";
import {
  PCM_RATE,
  StreamResampler,
  errorResponse,
  headerParams,
  isOpenAiPath,
  parseMultipart,
  streamingWavHeader,
} from "../src/routes/openai.js";
import { toPcm16, type SpeakStreamEvent } from "../src/service.js";

const ASR_ID = "audiocpp-qwen3-asr-0-6b";
const TALK = "endpoint:talk";
const STUB_RATE = 22_050;

function wavBytes(seconds = 1, rate = STUB_RATE, channels = 1): Buffer {
  const n = Math.round(seconds * rate);
  const ch = Array.from({ length: n }, (_, i) => Math.round(Math.sin(i / 10) * 8000));
  const wav = new WaveFile();
  wav.fromScratch(channels, rate, "16", channels === 1 ? ch : Array.from({ length: channels }, () => ch));
  return Buffer.from(wav.toBuffer());
}

function urlOf(server: Server): string {
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

/** A multipart body as an OpenAI SDK would build it. */
function multipart(
  fields: Record<string, string>,
  file?: { name?: string; filename?: string; type?: string; data: Buffer },
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----testboundary7MA4YWxkTrZu0gW";
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name ?? "file"}"; ` +
          `filename="${file.filename ?? "clip.wav"}"\r\nContent-Type: ${file.type ?? "audio/wav"}\r\n\r\n`,
      ),
      file.data,
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

/** The events of an SSE body, parsed. */
function events(body: string): Record<string, unknown>[] {
  return body
    .split("\n\n")
    .map((block) => block.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => l !== undefined)
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
}

/** One second of 24 kHz 16-bit mono, give or take the resampler's last frame. */
function isOneSecondOfPcm(bytes: number): boolean {
  return Math.abs(bytes - PCM_RATE * 2) <= 4 && bytes % 2 === 0;
}

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

/* ------------------------------------------------------------- pure parts */

describe("isOpenAiPath", () => {
  it("matches /v1 by the path the router will see", () => {
    for (const p of ["/v1/models", "/v1/audio/speech?x=1", "/%761/models", "/v1"]) {
      expect(isOpenAiPath(p)).toBe(true);
    }
    for (const p of ["/api/models", "/v10/models", "/", "/v1x"]) expect(isOpenAiPath(p)).toBe(false);
  });
});

describe("parseMultipart", () => {
  it("reads fields and a binary file, byte for byte", () => {
    const data = Buffer.from([0, 1, 2, 13, 10, 45, 45, 255, 13, 10]);
    const { payload, headers } = multipart({ model: "whisper-1", language: "en" }, { data, filename: "a.wav" });
    const form = parseMultipart(payload, headers["content-type"]!);
    expect(Object.fromEntries(form.fields)).toEqual({ model: "whisper-1", language: "en" });
    const file = form.files.get("file")!;
    expect(file.filename).toBe("a.wav");
    expect(file.contentType).toBe("audio/wav");
    expect(file.data.equals(data)).toBe(true);
  });

  it("reads header parameters, quoted or bare, in one pass", () => {
    expect(Object.fromEntries(headerParams('form-data; name="file"; filename="a;b.wav"'))).toEqual({
      name: "file",
      filename: "a;b.wav",
    });
    expect(headerParams("multipart/form-data;  Boundary = abc ; x").get("boundary")).toBe("abc");
    expect(headerParams("multipart/form-data").size).toBe(0);
    expect(headerParams('form-data; name="unterminated').get("name")).toBe("unterminated");
  });

  it("stays fast on headers padded with a long run of spaces", () => {
    // A pattern like /content-type:\s*(.*)$/ goes quadratic on this.
    const spaces = " ".repeat(200_000);
    const boundary = "pad";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition:${spaces}form-data;${spaces}name="file";${spaces}filename="a.wav"\r\n` +
        `content-type:${spaces}\r\nContent-Type:${spaces}audio/wav${spaces}\r\n\r\nDATA\r\n--${boundary}--\r\n`,
    );
    const started = performance.now();
    const form = parseMultipart(body, `multipart/form-data;${spaces}boundary=${boundary}`);
    const elapsed = performance.now() - started;
    const file = form.files.get("file")!;
    expect(file.filename).toBe("a.wav");
    expect(file.contentType).toBe("audio/wav");
    expect(file.data.toString()).toBe("DATA");
    expect(elapsed).toBeLessThan(500);
  });

  it("takes a quoted boundary, and refuses a body with none", () => {
    const { payload } = multipart({ a: "1" });
    const quoted = 'multipart/form-data; boundary="----testboundary7MA4YWxkTrZu0gW"';
    expect(parseMultipart(payload, quoted).fields.get("a")).toBe("1");
    expect(() => parseMultipart(payload, "multipart/form-data")).toThrow(/boundary/);
  });
});

describe("StreamResampler", () => {
  it("gives the same samples in chunks as the whole clip resampled at once", () => {
    for (const rate of [44_100, 48_000, 16_000, 22_050]) {
      const input = Float32Array.from({ length: rate }, (_, i) => Math.sin(i / 7) * 0.5);
      const whole = dsp.resampleAudio([input], rate, PCM_RATE)[0]!;
      const r = new StreamResampler(rate, PCM_RATE);
      const parts: Float32Array[] = [];
      // Uneven chunks, some shorter than the resampler's kernel.
      for (let at = 0, size = 37; at < input.length; at += size, size = (size * 3) % 4099 || 37) {
        parts.push(r.push(input.subarray(at, at + size)));
      }
      parts.push(r.flush());
      const got = Float32Array.from(parts.flatMap((p) => [...p]));
      expect(got.length, `rate ${rate}`).toBe(whole.length);
      let worst = 0;
      for (let i = 0; i < got.length; i++) worst = Math.max(worst, Math.abs(got[i]! - whole[i]!));
      expect(worst, `rate ${rate}`).toBeLessThan(1e-6);
    }
  });

  it("passes audio already at the target rate straight through", () => {
    const r = new StreamResampler(PCM_RATE, PCM_RATE);
    const chunk = Float32Array.from([0.1, -0.2, 0.3]);
    expect(r.push(chunk)).toBe(chunk);
    expect(r.flush().length).toBe(0);
  });
});

describe("streamingWavHeader", () => {
  it("is a 16-bit PCM header with open-ended sizes", () => {
    const h = streamingWavHeader(44_100, 2);
    expect(h.length).toBe(44);
    expect(h.toString("ascii", 0, 4) + h.toString("ascii", 8, 16)).toBe("RIFFWAVEfmt ");
    expect([h.readUInt16LE(20), h.readUInt16LE(22), h.readUInt32LE(24), h.readUInt16LE(34)]).toEqual([1, 2, 44_100, 16]);
    expect(h.readUInt32LE(40)).toBe(0xffffffff);
  });
});

describe("errorResponse", () => {
  it("words a classified failure with the taxonomy's title and hint, and codes it by topic", () => {
    const { status, body } = errorResponse(new ModelError("CUDA error: out of memory"));
    expect(status).toBe(400);
    expect(body.error.code).toBe("gpu_oom");
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toMatch(/^The GPU ran out of memory\. This is video memory/);
  });

  it("keeps an unclassified message as it is, and hides the text of a crash", () => {
    expect(errorResponse(new ModelError("Voice 'x' not found.")).body.error).toEqual({
      message: "Voice 'x' not found.",
      type: "invalid_request_error",
      param: null,
      code: "model_error",
    });
    const crash = errorResponse(new Error("secret path C:/x"));
    expect(crash.status).toBe(500);
    expect(crash.body.error).toMatchObject({ message: "Internal Server Error", type: "server_error" });
  });
});

/* ------------------------------------------------------------ the routes */

describe("OpenAI-compatible routes", () => {
  let app: FastifyInstance;
  let dataDir: string;
  let stub: Server;
  let mode: "ok" | "fail" = "ok";
  const received: Record<string, unknown>[] = [];

  const speech = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: "/v1/audio/speech", payload, headers });
  const soundCount = async () => (await app.inject({ method: "GET", url: "/api/sounds" })).json().total as number;
  const sessionCount = async () =>
    ((await app.inject({ method: "GET", url: "/api/sessions" })).json() as unknown[]).length;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "soundbox-openai-test-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
    stub = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push(JSON.parse(body));
        if (mode === "fail") {
          res.statusCode = 500;
          res.end("CUDA error: out of memory");
          return;
        }
        res.setHeader("Content-Type", "audio/wav");
        res.end(wavBytes(1));
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
      body_template: '{"text": "{{prompt}}"}',
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
      payload: { name: "Narrator", kind: "builtin", voice_id: "nova", model_id: TALK },
    });
    expect(voice.statusCode).toBe(201);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mode = "ok";
    received.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await new Promise((r) => stub.close(r));
    await rm(dataDir, { recursive: true, force: true });
  });

  /* ------------------------------------------------------------- listings */

  it("lists the ready speech models in OpenAI's list shape, and nothing else", async () => {
    const resp = await app.inject({ method: "GET", url: "/v1/models" });
    expect(resp.statusCode).toBe(200);
    const body = resp.json();
    expect(body.object).toBe("list");
    expect(body.data).toEqual([
      { id: TALK, object: "model", created: 0, owned_by: expect.any(String), name: "Stub speech", task: "speech" },
    ]);
  });

  it("lists saved voices, the models' own voices and the default", async () => {
    const body = (await app.inject({ method: "GET", url: "/v1/audio/voices" })).json();
    expect(body.object).toBe("list");
    expect(body.voices).toEqual(body.data);
    const byName = Object.fromEntries(body.data.map((v: { name: string; kind: string }) => [v.name, v.kind]));
    expect(byName).toEqual({ Narrator: "builtin", alloy: "builtin", nova: "builtin", "Model default": "default" });
    const alloy = body.data.find((v: { id: string }) => v.id === "alloy");
    expect(alloy).toEqual({ id: "alloy", object: "audio.voice", name: "alloy", kind: "builtin", model: TALK });
  });

  /* ------------------------------------------------------- voice and model */

  it("maps a voice by saved name whatever the case, and a model it has never heard of to the voice's own", async () => {
    const resp = await speech({ model: "tts-1", input: "Hello there.", voice: "NARRATOR", response_format: "wav" });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["x-soundbox-model"]).toBe(TALK);
    expect(resp.headers["x-soundbox-voice"]).toBe("Narrator");
    expect(received).toEqual([{ input: "Hello there.", voice: "nova" }]);
  });

  it("maps a voice by saved id, and by OpenAI's { id } form", async () => {
    const id = (await app.inject({ method: "GET", url: "/api/voices" })).json()[0].id as string;
    expect((await speech({ input: "One.", voice: id, response_format: "wav" })).statusCode).toBe(200);
    expect((await speech({ input: "Two.", voice: { id }, response_format: "wav" })).statusCode).toBe(200);
    expect(received.map((r) => r["voice"])).toEqual(["nova", "nova"]);
  });

  it("maps a model's own voice by name, with no saved voice for it", async () => {
    const resp = await speech({ model: TALK, input: "Hi.", voice: "Alloy", response_format: "wav" });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["x-soundbox-voice"]).toBe("alloy");
    expect(received).toEqual([{ input: "Hi.", voice: "alloy" }]);
  });

  it("reads 'default', or no voice at all, on a ready model's default voice", async () => {
    for (const voice of ["default", undefined]) {
      const resp = await speech({ input: "Hi.", voice, response_format: "wav" });
      expect(resp.statusCode).toBe(200);
      expect(resp.headers["x-soundbox-model"]).toBe(TALK);
    }
  });

  it("takes a model by its display name", async () => {
    const resp = await speech({ model: "stub SPEECH", input: "Hi.", voice: "alloy", response_format: "wav" });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["x-soundbox-model"]).toBe(TALK);
  });

  it("names the voices it has when asked for one it has not", async () => {
    const resp = await speech({ input: "Hi.", voice: "shimmer", response_format: "wav" });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().error).toMatchObject({ type: "invalid_request_error", code: "voice_not_found", param: "voice" });
    expect(resp.json().error.message).toMatch(/No voice is called 'shimmer'.*Narrator.*alloy.*'default'/);
    expect(received).toEqual([]);
  });

  it("refuses a model that is here but does not speak", async () => {
    const resp = await speech({ model: "endpoint:fx", input: "Hi.", voice: "alloy" });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().error).toMatchObject({ code: "model_not_found", param: "model" });
    expect(resp.json().error.message).toMatch(/not a text-to-speech model/);
  });

  it("refuses a speech model that is not downloaded, and says which are ready", async () => {
    const model = (await app.soundbox.listModels()).find((m) => m.task === "tts" && m.status === "not_installed");
    if (!model) return; // every catalogue speech model enabled by default is on this disk
    const resp = await speech({ model: model.id, input: "Hi." });
    expect(resp.statusCode).toBe(404);
    expect(resp.json().error.code).toBe("model_not_installed");
    expect(resp.json().error.message).toContain(TALK);
  });

  /* --------------------------------------------------------------- formats */

  it("answers wav with the file, and leaves the library as it found it", async () => {
    const [sounds, sessions] = [await soundCount(), await sessionCount()];
    const resp = await speech({ input: "Hi.", voice: "alloy", response_format: "wav" });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["content-type"]).toBe("audio/wav");
    expect(resp.rawPayload.subarray(0, 4).toString()).toBe("RIFF");
    expect(resp.headers["x-soundbox-sound-id"]).toBe("");
    expect(await soundCount()).toBe(sounds);
    expect(await sessionCount()).toBe(sessions);
  });

  it("keeps the read in the library when asked to", async () => {
    const before = await soundCount();
    const resp = await speech({ input: "Keep me.", voice: "alloy", response_format: "wav", keep: true });
    const soundId = String(resp.headers["x-soundbox-sound-id"]);
    expect(soundId).not.toBe("");
    expect(await soundCount()).toBe(before + 1);
    const sound = (await app.inject({ method: "GET", url: `/api/sounds/${soundId}` })).json();
    // A model's own voice named directly has no saved voice to point at.
    expect(sound.voice_id ?? null).toBeNull();
    await app.inject({ method: "DELETE", url: `/api/sounds/${soundId}` });
  });

  it("answers pcm as 24 kHz mono 16-bit, whatever rate the model made", async () => {
    const resp = await speech({ input: "Hi.", voice: "alloy", response_format: "pcm" });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["content-type"]).toBe("audio/pcm");
    expect(resp.headers["x-soundbox-sample-rate"]).toBe("24000");
    // One second from the stub at 22.05 kHz is one second at 24 kHz.
    expect(isOneSecondOfPcm(resp.rawPayload.length)).toBe(true);
    expect(resp.rawPayload.subarray(0, 4).toString()).not.toBe("RIFF");
  });

  it("refuses mp3 by name when ffmpeg is missing, naming what works", async () => {
    const path = process.env["PATH"];
    process.env["PATH"] = "";
    try {
      const before = await soundCount();
      const resp = await speech({ input: "Hi.", voice: "alloy", response_format: "mp3" });
      expect(resp.statusCode).toBe(400);
      expect(resp.json().error).toMatchObject({ code: "unsupported_format", param: "response_format" });
      expect(resp.json().error.message).toMatch(/ffmpeg.*wav, pcm/);
      expect(await soundCount()).toBe(before);
    } finally {
      process.env["PATH"] = path;
    }
  });

  it("falls back to wav, and says so, when no format was named and ffmpeg is missing", async () => {
    const path = process.env["PATH"];
    process.env["PATH"] = "";
    try {
      const resp = await speech({ input: "Hi.", voice: "alloy" });
      expect(resp.statusCode).toBe(200);
      expect(resp.headers["content-type"]).toBe("audio/wav");
      expect(resp.headers["x-soundbox-format-fallback"]).toBe("wav");
      expect(resp.rawPayload.subarray(0, 4).toString()).toBe("RIFF");
    } finally {
      process.env["PATH"] = path;
    }
  });

  it.skipIf(!hasFfmpeg)("answers mp3, the default, when ffmpeg is installed", async () => {
    const resp = await speech({ input: "Hi.", voice: "alloy" });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["content-type"]).toBe("audio/mpeg");
    expect(resp.headers["x-soundbox-format-fallback"]).toBeUndefined();
    const head = resp.rawPayload.subarray(0, 3);
    expect(head.toString("latin1") === "ID3" || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0)).toBe(true);
  });

  it("refuses the formats it cannot make, before anything runs", async () => {
    for (const format of ["opus", "aac", "flac", "ogg"]) {
      const resp = await speech({ input: "Hi.", voice: "alloy", response_format: format });
      expect(resp.statusCode, format).toBe(400);
      expect(resp.json().error.code).toBe("unsupported_format");
      expect(resp.json().error.message).toMatch(/wav, pcm, and mp3 when ffmpeg is installed/);
    }
    expect(received).toEqual([]);
  });

  /* ---------------------------------------------------------------- errors */

  it("answers bad input in the envelope, naming the field", async () => {
    const empty = await speech({ voice: "alloy" });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toMatchObject({ type: "invalid_request_error", param: "input" });
    expect(Object.keys(empty.json())).toEqual(["error"]);
    const fast = await speech({ input: "Hi.", speed: 9 });
    expect(fast.json().error.param).toBe("speed");
  });

  it("passes a failed read on as a 500, worded by the failure taxonomy", async () => {
    mode = "fail";
    const before = await sessionCount();
    const resp = await speech({ input: "Boom.", voice: "alloy", response_format: "wav" });
    expect(resp.statusCode).toBe(500);
    const { error } = resp.json();
    expect(error.type).toBe("server_error");
    expect(error.code).toBe("gpu_oom");
    expect(error.message).toMatch(/^The GPU ran out of memory\./);
    expect(error.detail).toMatch(/returned HTTP 500: CUDA error: out of memory/);
    expect(await sessionCount()).toBe(before);
  });

  it("answers a refused Host in the envelope too", async () => {
    const resp = await app.inject({ method: "GET", url: "/v1/models", headers: { host: "evil.example" } });
    expect(resp.statusCode).toBe(403);
    expect(resp.json()).toEqual({
      error: { message: "Forbidden host", type: "invalid_request_error", param: null, code: null },
    });
  });

  /* ------------------------------------------------------------- streaming */

  /** Mark the stub model as one that streams, and script what it streams. */
  function streaming(script: () => AsyncGenerator<SpeakStreamEvent>) {
    const svc = app.soundbox;
    const real = svc.listModels.bind(svc);
    vi.spyOn(svc, "listModels").mockImplementation(async () =>
      (await real()).map((m) => (m.id === TALK ? { ...m, supports: { ...m.supports, streaming: true } } : m)),
    );
    return vi.spyOn(svc, "speakStream").mockImplementation(script as typeof svc.speakStream);
  }

  /** One second of 48 kHz stereo in ten chunks. */
  async function* stereo48k(): AsyncGenerator<SpeakStreamEvent> {
    yield { kind: "start", sampleRate: 48_000, channels: 2 };
    for (let c = 0; c < 10; c++) {
      const ch = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((c * 4800 + i) / 9) * 0.4);
      yield { kind: "audio", pcm: toPcm16([ch, ch]), frames: 4800 };
    }
    yield { kind: "done", durationS: 1, ttftMs: 5, modelTtftMs: null, soundId: null };
  }

  it("sends events as speech.audio.delta and speech.audio.done when the model does not stream", async () => {
    const resp = await speech({ input: "Hi.", voice: "alloy", stream_format: "sse" });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["content-type"]).toBe("text/event-stream");
    expect(resp.headers["x-soundbox-model"]).toBe(TALK);
    const got = events(resp.body);
    expect(got.at(-1)).toEqual({
      type: "speech.audio.done",
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    });
    const deltas = got.slice(0, -1);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.every((e) => e["type"] === "speech.audio.delta")).toBe(true);
    const pcm = Buffer.concat(deltas.map((e) => Buffer.from(String(e["audio"]), "base64")));
    expect(isOneSecondOfPcm(pcm.length)).toBe(true);
    expect(resp.body).toContain("event: speech.audio.delta\ndata: ");
  });

  it("only sends events as pcm", async () => {
    const resp = await speech({ input: "Hi.", voice: "alloy", stream_format: "sse", response_format: "wav" });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().error.code).toBe("unsupported_format");
  });

  it("streams pcm from a model that streams, resampled to 24 kHz mono", async () => {
    const spy = streaming(stereo48k);
    const resp = await speech({ input: "Hi.", voice: "Narrator", response_format: "pcm", speed: 1 });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["content-type"]).toBe("audio/pcm");
    expect(resp.headers["x-soundbox-sample-rate"]).toBe("24000");
    expect(resp.headers["x-soundbox-voice"]).toBe("Narrator");
    expect(resp.rawPayload.length).toBe(PCM_RATE * 2);
    // Nothing went through the queue, and the read was not saved.
    expect(received).toEqual([]);
    expect(spy.mock.calls[0]![0]).toMatchObject({ model: TALK, text: "Hi.", format: "pcm", save: false });
  });

  it("streams wav at the model's own rate behind an open-ended header", async () => {
    streaming(stereo48k);
    const resp = await speech({ input: "Hi.", voice: "alloy", response_format: "wav" });
    expect(resp.headers["content-type"]).toBe("audio/wav");
    expect(resp.headers["x-soundbox-sample-rate"]).toBe("48000");
    expect(resp.rawPayload.subarray(0, 44).equals(streamingWavHeader(48_000, 2))).toBe(true);
    expect(resp.rawPayload.length).toBe(44 + 48_000 * 2 * 2);
  });

  it("streams events from a model that streams", async () => {
    streaming(stereo48k);
    const resp = await speech({ input: "Hi.", voice: "alloy", stream_format: "sse" });
    const got = events(resp.body);
    expect(got.at(-1)!["type"]).toBe("speech.audio.done");
    const pcm = Buffer.concat(got.slice(0, -1).map((e) => Buffer.from(String(e["audio"]), "base64")));
    expect(pcm.length).toBe(PCM_RATE * 2);
  });

  it("reports a failure after audio has started as an error event", async () => {
    streaming(async function* () {
      yield { kind: "start", sampleRate: PCM_RATE, channels: 1 };
      yield { kind: "audio", pcm: Buffer.alloc(480), frames: 240 };
      throw new Error("CUDA error: out of memory");
    });
    const resp = await speech({ input: "Hi.", voice: "alloy", stream_format: "sse" });
    const last = events(resp.body).at(-1) as { error: { message: string; code: string } };
    expect(last.error.code).toBe("gpu_oom");
    expect(last.error.message).toMatch(/GPU ran out of memory/);
  });

  it("goes through the queue instead when the model can't stream after all, or the GPU is busy", async () => {
    for (const exc of [new StreamUnsupported("nope"), new GpuBusy("busy", 5)]) {
      // eslint-disable-next-line require-yield
      streaming(async function* () {
        throw exc;
      });
      const resp = await speech({ input: "Hi.", voice: "alloy", response_format: "pcm" });
      expect(resp.statusCode).toBe(200);
      expect(isOneSecondOfPcm(resp.rawPayload.length)).toBe(true);
      expect(received.length).toBe(1);
      received.length = 0;
      vi.restoreAllMocks();
    }
  });

  it("answers a refusal from the streaming path in the envelope", async () => {
    // eslint-disable-next-line require-yield
    streaming(async function* () {
      throw new ModelError("Voice 'gone' not found.");
    });
    const resp = await speech({ input: "Hi.", voice: "alloy", response_format: "pcm" });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().error).toMatchObject({ message: "Voice 'gone' not found.", code: "model_error" });
  });

  /* --------------------------------------------------------- transcription */

  const transcribe = (fields: Record<string, string>, file: Buffer | null = wavBytes(0.5, 44_100, 2)) => {
    const { payload, headers } = multipart(fields, file ? { data: file } : undefined);
    return app.inject({ method: "POST", url: "/v1/audio/transcriptions", payload, headers });
  };

  it("says no transcription model is installed, in the envelope", async () => {
    const resp = await transcribe({ model: "whisper-1" });
    expect(resp.statusCode).toBe(404);
    expect(resp.json().error).toMatchObject({ code: "model_not_installed", param: "model" });
    expect(resp.json().error.message).toMatch(/No transcription model is installed/);
  });

  it("refuses a form with no file, a file that is not audio, and formats it cannot make", async () => {
    const none = await transcribe({ model: "whisper-1" }, null);
    expect(none.statusCode).toBe(400);
    expect(none.json().error.param).toBe("file");

    const path = process.env["PATH"];
    process.env["PATH"] = ""; // no ffmpeg to try the bytes on
    try {
      const junk = await transcribe({ model: "whisper-1" }, Buffer.from("not audio at all"));
      expect(junk.statusCode).toBe(400);
      expect(junk.json().error).toMatchObject({ code: "invalid_audio", param: "file" });
    } finally {
      process.env["PATH"] = path;
    }

    const srt = await transcribe({ model: "whisper-1", response_format: "srt" });
    expect(srt.statusCode).toBe(400);
    expect(srt.json().error.message).toMatch(/json, text, verbose_json/);

    const json = await app.inject({ method: "POST", url: "/v1/audio/transcriptions", payload: { file: "x" } });
    expect(json.statusCode).toBe(400);
    expect(json.json().error.message).toMatch(/multipart\/form-data/);
  });

  describe("with a recogniser", () => {
    const seen: { rate: number; channels: number; language: string | null }[] = [];
    let fail = false;

    beforeAll(async () => {
      await app.soundbox.updateSettings({ enabled_audiocpp_models: [ASR_ID] });
    });

    /** Swap a fake recogniser in for the catalogue's, as transcribe.test.ts does. */
    function recogniser() {
      const svc = app.soundbox;
      const real = svc.models.get(ASR_ID);
      const fake = Object.create(real) as typeof real;
      Object.defineProperty(fake, "loaded", { get: () => true });
      fake.transcribe = async (path, options) => {
        if (fail) throw new Error("audio.cpp crashed");
        const { audio, sampleRate } = dsp.readWav(path);
        seen.push({ rate: sampleRate, channels: audio.length, language: options?.language ?? null });
        return { text: "hello there", language: "English" };
      };
      const get = svc.models.get.bind(svc.models);
      vi.spyOn(svc.models, "get").mockImplementation((id) => (id === ASR_ID ? fake : get(id)));
      vi.spyOn(svc, "pickTranscriber").mockResolvedValue(ASR_ID);
      seen.length = 0;
      fail = false;
    }

    it("answers json by default, on a ready model when the one named is not here", async () => {
      recogniser();
      const resp = await transcribe({ model: "whisper-1", language: "en" });
      expect(resp.statusCode).toBe(200);
      expect(resp.json()).toEqual({ text: "hello there" });
      expect(resp.headers["x-soundbox-model"]).toBe(ASR_ID);
      expect(seen).toEqual([{ rate: 16000, channels: 1, language: "en" }]);
    });

    it("answers text as plain text", async () => {
      recogniser();
      const resp = await transcribe({ model: "whisper-1", response_format: "text" });
      expect(resp.statusCode).toBe(200);
      expect(resp.headers["content-type"]).toMatch(/^text\/plain/);
      expect(resp.body).toBe("hello there\n");
    });

    it("answers verbose_json with the language and the clip's length", async () => {
      recogniser();
      const resp = await transcribe({ model: ASR_ID, response_format: "verbose_json" });
      expect(resp.json()).toEqual({ task: "transcribe", language: "English", duration: 0.5, text: "hello there" });
    });

    it("refuses a model that is here but does not transcribe, and a streamed answer", async () => {
      recogniser();
      const wrong = await transcribe({ model: TALK });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().error.message).toMatch(/does not transcribe/);
      const stream = await transcribe({ model: "whisper-1", stream: "true" });
      expect(stream.statusCode).toBe(400);
      expect(stream.json().error.param).toBe("stream");
    });

    it("passes a failed transcription on as a 500 in the envelope", async () => {
      recogniser();
      fail = true;
      const resp = await transcribe({ model: "whisper-1" });
      expect(resp.statusCode).toBe(500);
      expect(resp.json().error).toMatchObject({ type: "server_error", message: "audio.cpp crashed" });
    });
  });

  /* ------------------------------------------------------------- the guard */

  describe("requests a web page could send", () => {
    const upload = (headers: Record<string, string>) => {
      const form = multipart({ model: "whisper-1" }, { data: wavBytes(0.2) });
      return app.inject({
        method: "POST",
        url: "/v1/audio/transcriptions",
        payload: form.payload,
        headers: { ...form.headers, ...headers },
      });
    };

    it("lets a multipart upload through with no X-Soundbox header, as an SDK sends it", async () => {
      // /api/ would refuse this content type outright; here it reaches the route.
      const resp = await upload({});
      expect(resp.statusCode).not.toBe(403);
    });

    it("refuses a multipart upload a page on another site posted", async () => {
      for (const headers of [
        { origin: "https://evil.example" },
        { origin: "null" },
        { "sec-fetch-site": "cross-site" },
      ]) {
        const resp = await upload(headers);
        expect(resp.statusCode, JSON.stringify(headers)).toBe(403);
        expect(resp.json().error).toMatchObject({ type: "invalid_request_error", code: "cross_site_request" });
      }
    });

    it("lets the same upload through from the app's own origin, or with X-Soundbox", async () => {
      expect((await upload({ origin: "http://localhost:17494", host: "localhost:17494" })).statusCode).not.toBe(403);
      expect((await upload({ origin: "https://evil.example", "x-soundbox": "1" })).statusCode).not.toBe(403);
    });

    it("refuses a body-less or text/plain POST from another site as well", async () => {
      const bare = await app.inject({
        method: "POST",
        url: "/v1/audio/speech",
        headers: { origin: "https://evil.example" },
      });
      expect(bare.statusCode).toBe(403);
      const text = await app.inject({
        method: "POST",
        url: "/%761/audio/speech",
        payload: '{"input":"hi"}',
        headers: { origin: "https://evil.example", "content-type": "text/plain" },
      });
      expect(text.statusCode).toBe(403);
    });

    it("does not treat a JSON request as cross-site: a browser has to preflight it, and CORS refuses that", async () => {
      const resp = await speech(
        { input: "Hi.", voice: "alloy", response_format: "wav" },
        { origin: "https://evil.example" },
      );
      expect(resp.statusCode).toBe(200);
      expect(resp.headers["access-control-allow-origin"]).toBeUndefined();
      const preflight = await app.inject({
        method: "OPTIONS",
        url: "/v1/audio/speech",
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });
});

/* ------------------------------------------------------------ access token */

describe("OpenAI-compatible routes on a server with an access token", () => {
  const TOKEN = "correct-horse-battery-staple-42";
  let app: FastifyInstance;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "soundbox-openai-token-"));
    app = buildApp(new Config(dataDir), { serveUi: false, apiToken: TOKEN });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("refuses every route without the token, as OpenAI refuses a missing key", async () => {
    const form = multipart({ model: "whisper-1" }, { data: wavBytes(0.2) });
    const calls = [
      app.inject({ method: "GET", url: "/v1/models" }),
      app.inject({ method: "GET", url: "/v1/audio/voices" }),
      app.inject({ method: "GET", url: "/%761/models" }),
      app.inject({ method: "POST", url: "/v1/audio/speech", payload: { input: "Hi." } }),
      app.inject({ method: "POST", url: "/v1/audio/transcriptions", payload: form.payload, headers: form.headers }),
    ];
    for (const resp of await Promise.all(calls)) {
      expect(resp.statusCode).toBe(401);
      expect(resp.headers["www-authenticate"]).toMatch(/^Bearer/);
      expect(resp.json().error).toMatchObject({ type: "invalid_request_error", code: "invalid_api_key" });
      expect(resp.json().error.message).toMatch(/access token/);
    }
  });

  it("refuses a wrong key", async () => {
    const resp = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${TOKEN}x` },
    });
    expect(resp.statusCode).toBe(401);
    expect(resp.json().error.code).toBe("invalid_api_key");
  });

  it("takes the token as the API key, the way an OpenAI client sends it", async () => {
    const bearer = { authorization: `Bearer ${TOKEN}` };
    const models = await app.inject({ method: "GET", url: "/v1/models", headers: bearer });
    expect(models.statusCode).toBe(200);
    expect(models.json().object).toBe("list");
    // Past the token, an upload is still an upload: no model here, so a 404.
    const form = multipart({ model: "whisper-1" }, { data: wavBytes(0.2) });
    const resp = await app.inject({
      method: "POST",
      url: "/v1/audio/transcriptions",
      payload: form.payload,
      headers: { ...form.headers, ...bearer },
    });
    expect(resp.statusCode).toBe(404);
  });

  it("still refuses a cross-site upload that carries the token", async () => {
    const form = multipart({ model: "whisper-1" }, { data: wavBytes(0.2) });
    const resp = await app.inject({
      method: "POST",
      url: "/v1/audio/transcriptions",
      payload: form.payload,
      headers: { ...form.headers, authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" },
    });
    expect(resp.statusCode).toBe(403);
  });
});

describe("OpenAI-compatible routes on a server without a token", () => {
  it("are open, like the rest of the API on loopback", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "soundbox-openai-open-"));
    const app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
    try {
      const resp = await app.inject({ method: "GET", url: "/v1/models" });
      expect(resp.statusCode).toBe(200);
      expect(resp.json()).toEqual({ object: "list", data: [] });
    } finally {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
