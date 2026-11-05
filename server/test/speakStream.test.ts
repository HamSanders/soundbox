/**
 * Streaming speech: the SSE reader, the model's streaming entry, the GPU lock
 * and the `/api/speak/stream` wire formats.
 *
 * No audio.cpp process anywhere: the model tests use a stub host, and the
 * route tests swap the service's generator for a scripted one, so what's
 * under test is framing, status codes and cleanup — not a real model.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { WaveFile } from "wavefile";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { sseData } from "../src/audio/sse.js";
import { Config } from "../src/config.js";
import { GpuBusy, StreamUnsupported } from "../src/errors.js";
import { JobManager } from "../src/jobs.js";
import { AudioCppModel, catalogById, type PackageInstaller } from "../src/models/audiocpp.js";
import { setStreamingFamiliesForTest } from "../src/models/audiocppModes.js";
import { eventAudio, streamBody, type StreamTaskEvent } from "../src/models/audiocppRuntime.js";
import { toPcm16, type SpeakStreamEvent } from "../src/service.js";

const enc = new TextEncoder();

async function* bytes(...chunks: string[]): AsyncGenerator<Uint8Array> {
  for (const c of chunks) yield enc.encode(c);
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("sseData", () => {
  it("joins events split across chunk boundaries", async () => {
    const got = await collect(sseData(bytes('data: {"a"', ":1}\n", "\ndata: [DONE]\n\n")));
    expect(got).toEqual(['{"a":1}', "[DONE]"]);
  });

  it("handles CRLF, comments, other fields and multi-line data", async () => {
    const got = await collect(
      sseData(bytes(": keepalive\r\n\r\nevent: x\r\ndata: one\r\ndata: two\r\n\r\n")),
    );
    expect(got).toEqual(["one\ntwo"]);
  });

  it("delivers a final event with no trailing blank line", async () => {
    expect(await collect(sseData(bytes("data: last")))).toEqual(["last"]);
  });

  it("decodes a multi-byte character split between chunks", async () => {
    const all = enc.encode("data: é\n\n");
    async function* split() {
      yield all.slice(0, 7);
      yield all.slice(7);
    }
    expect(await collect(sseData(split()))).toEqual(["é"]);
  });
});

describe("streamBody", () => {
  it("puts the task fields under request, as upstream documents", () => {
    expect(streamBody({ model: "m::stream", family: "f", task: "tts", text: "hi", seed: 1 })).toEqual({
      model: "m::stream",
      stream_format: "sse",
      request: { task: "tts", text: "hi", seed: 1 },
    });
  });
});

describe("eventAudio", () => {
  it("reads top-level audio and named chunks", () => {
    expect(eventAudio({ audio: "A" })).toEqual(["A"]);
    // Supertonic on audio.cpp's current Windows build answers this way.
    expect(
      eventAudio({ named_audio_outputs: [{ id: "chunk_0", audio: "B" }, { id: "x" }], is_final: true }),
    ).toEqual(["B"]);
    expect(eventAudio({ is_final: false })).toEqual([]);
  });
});

describe("toPcm16", () => {
  it("interleaves channels and clamps to the 16-bit range", () => {
    const pcm = toPcm16([new Float32Array([0, 1, -1]), new Float32Array([0.5, 2, -2])]);
    expect(pcm.length).toBe(12);
    const v = [0, 1, 2, 3, 4, 5].map((i) => pcm.readInt16LE(i * 2));
    expect(v).toEqual([0, 16384, 32767, 32767, -32768, -32768]);
  });
});

/* --------------------------------------------------------- model streaming */

function wavBase64(samples: number[], sampleRate = 24000): string {
  const wav = new WaveFile();
  wav.fromScratch(1, sampleRate, "16", samples);
  return Buffer.from(wav.toBuffer()).toString("base64");
}

function ttsModel(host: PackageInstaller): AudioCppModel {
  const base = catalogById().get("audiocpp-stable-audio-3-sfx")!;
  const spec = { ...base, id: "test-tts", name: "Test TTS", task: "tts", cli_task: "tts", family: "kokoro_tts" };
  const m = new AudioCppModel(spec as typeof base, "/models", null, "/models/audiocpp", host);
  vi.spyOn(m, "weightsFile").mockResolvedValue("/models/audiocpp/fake/weights.gguf");
  vi.spyOn(m, "depsInstalled").mockResolvedValue(true);
  vi.spyOn(m, "requireDeps").mockResolvedValue(undefined);
  return m;
}

function streamingHost(opts: { streamLoadFails?: boolean } = {}) {
  const loads: { id: string; mode?: string }[] = [];
  const bodies: Record<string, unknown>[] = [];
  const unloads: string[] = [];
  const host: PackageInstaller = {
    async installPackage() {
      return true;
    },
    async deletePackage() {
      return true;
    },
    async loadModel(req) {
      if (req.mode === "streaming" && opts.streamLoadFails) {
        throw new Error("kokoro_tts has no streaming session");
      }
      loads.push({ id: req.id, mode: req.mode });
      return true;
    },
    async unloadModel(id) {
      unloads.push(id);
    },
    async runTask() {
      return null;
    },
    isResident: (id) => loads.some((l) => l.id === id),
    async streamTask(body) {
      bodies.push(body);
      return (async function* (): AsyncGenerator<StreamTaskEvent> {
        yield { kind: "audio", audio: wavBase64([0, 1000, 2000]), isFinal: false };
        yield { kind: "audio", audio: null, isFinal: false };
        yield { kind: "audio", audio: wavBase64([3000]), isFinal: true };
        yield { kind: "done", ttftMs: 120 };
      })();
    },
  };
  return { host, loads, bodies, unloads };
}

beforeEach(() => vi.restoreAllMocks());

describe("AudioCppModel.speakStream", () => {
  it("loads a separate streaming entry and yields each chunk decoded", async () => {
    const { host, loads, bodies } = streamingHost();
    const m = ttsModel(host);
    const chunks = await collect(
      m.speakStream("Halt!", { voiceId: "af_heart", seed: 3, signal: new AbortController().signal }),
    );

    expect(loads).toEqual([
      { id: "test-tts", mode: undefined },
      { id: "test-tts::stream", mode: "streaming" },
    ]);
    expect(bodies[0]).toMatchObject({
      model: "test-tts::stream",
      task: "tts",
      text: "Halt!",
      voice_id: "af_heart",
      seed: 3,
    });
    const audio = chunks.filter((c) => c.kind === "audio");
    expect(audio).toHaveLength(2); // the empty event is skipped
    expect(audio.map((c) => (c.kind === "audio" ? c.audio[0]!.length : 0))).toEqual([3, 1]);
    expect(chunks.at(-1)).toEqual({ kind: "done", ttftMs: 120 });
  });

  it("reuses the streaming entry for the next line", async () => {
    const { host, loads } = streamingHost();
    const m = ttsModel(host);
    const signal = new AbortController().signal;
    await collect(m.speakStream("one", { signal }));
    await collect(m.speakStream("two", { signal }));
    expect(loads.filter((l) => l.mode === "streaming")).toHaveLength(1);
  });

  it("unloads both entries", async () => {
    const { host, unloads } = streamingHost();
    const m = ttsModel(host);
    await collect(m.speakStream("one", { signal: new AbortController().signal }));
    await m.unload();
    expect(unloads).toEqual(["test-tts", "test-tts::stream"]);
  });

  it("reports a family with no streaming session as unsupported", async () => {
    const { host } = streamingHost({ streamLoadFails: true });
    const m = ttsModel(host);
    await expect(
      collect(m.speakStream("x", { signal: new AbortController().signal })),
    ).rejects.toBeInstanceOf(StreamUnsupported);
  });

  it("reports supports.streaming from the binary's model specs", () => {
    const { host } = streamingHost();
    setStreamingFamiliesForTest(["kokoro_tts"]);
    expect(ttsModel(host).describe().supports.streaming).toBe(true);
    setStreamingFamiliesForTest([]);
    expect(ttsModel(host).describe().supports.streaming).toBe(false);
  });

  it("refuses load options rather than ignoring them", async () => {
    const { host } = streamingHost();
    const m = ttsModel(host);
    await expect(
      collect(
        m.speakStream("x", { loadOptions: { language: "spanish" }, signal: new AbortController().signal }),
      ),
    ).rejects.toBeInstanceOf(StreamUnsupported);
  });
});

/* --------------------------------------------------------------- GPU lock */

describe("JobManager.acquireExclusive", () => {
  it("refuses a second stream, and frees on release", () => {
    const jobs = new JobManager();
    const release = jobs.acquireExclusive();
    expect(() => jobs.acquireExclusive()).toThrow(GpuBusy);
    release();
    release(); // harmless twice
    expect(jobs.streaming).toBe(false);
    jobs.acquireExclusive()();
  });

  it("refuses while a generation is running", async () => {
    const jobs = new JobManager();
    let finish!: () => void;
    jobs.submit("speak", { model: "m" }, () => new Promise<null>((r) => (finish = () => r(null))));
    await vi.waitFor(() => expect(jobs.list(10)[0]!.status).toBe("running"));
    expect(() => jobs.acquireExclusive()).toThrow(GpuBusy);
    finish();
    await vi.waitFor(() => expect(jobs.list(10)[0]!.status).toBe("done"));
    jobs.acquireExclusive()();
  });

  it("holds queued generation until the stream ends", async () => {
    const jobs = new JobManager();
    const release = jobs.acquireExclusive();
    const ran = vi.fn(() => null);
    jobs.submit("speak", { model: "m" }, ran);
    await new Promise((r) => setTimeout(r, 30));
    expect(ran).not.toHaveBeenCalled();
    expect(jobs.list(10)[0]!.status).toBe("queued");
    release();
    await vi.waitFor(() => expect(ran).toHaveBeenCalledOnce());
  });
});

/* ------------------------------------------------------------------ route */

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "soundbox-stream-test-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

function scripted(events: SpeakStreamEvent[], failAfter?: Error) {
  return vi
    .spyOn(app.soundbox, "speakStream")
    .mockImplementation(async function* () {
      for (const e of events) yield e;
      if (failAfter) throw failAfter;
    } as typeof app.soundbox.speakStream);
}

const EVENTS: SpeakStreamEvent[] = [
  { kind: "start", sampleRate: 24000, channels: 1 },
  { kind: "audio", pcm: Buffer.from([1, 0, 2, 0]), frames: 2 },
  { kind: "audio", pcm: Buffer.from([3, 0]), frames: 1 },
  { kind: "done", durationS: 0.0, ttftMs: 50, modelTtftMs: 40, soundId: null },
];

describe("POST /api/speak/stream", () => {
  it("streams SSE: start, audio chunks, done", async () => {
    scripted(EVENTS);
    const resp = await app.inject({
      method: "POST",
      url: "/api/speak/stream",
      payload: { model: "m", text: "hi" },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["content-type"]).toBe("text/event-stream");
    const events = resp.body
      .trim()
      .split("\n\n")
      .map((block) => {
        const [ev, data] = block.split("\n");
        return { event: ev!.slice(7), data: JSON.parse(data!.slice(6)) };
      });
    expect(events.map((e) => e.event)).toEqual(["start", "audio", "audio", "done"]);
    expect(events[0]!.data).toMatchObject({ sample_rate: 24000, channels: 1, encoding: "pcm_s16le" });
    expect(events[1]!.data).toEqual({ seq: 0, pcm: "AQACAA==", frames: 2 });
    expect(events[3]!.data).toEqual({ duration_s: 0, ttft_ms: 50, model_ttft_ms: 40, sound_id: null });
  });

  it("streams raw PCM with the format in the headers", async () => {
    scripted(EVENTS);
    const resp = await app.inject({
      method: "POST",
      url: "/api/speak/stream",
      payload: { model: "m", text: "hi", format: "pcm" },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers["content-type"]).toBe("audio/L16; rate=24000; channels=1");
    expect(resp.headers["x-soundbox-sample-rate"]).toBe("24000");
    expect([...resp.rawPayload]).toEqual([1, 0, 2, 0, 3, 0]);
  });

  it("sends an error event when the model fails mid-stream", async () => {
    scripted(EVENTS.slice(0, 2), new Error("boom"));
    const resp = await app.inject({
      method: "POST",
      url: "/api/speak/stream",
      payload: { model: "m", text: "hi" },
    });
    expect(resp.body).toContain('event: error\ndata: {"message":"boom"}');
  });

  it("answers 409 for a model that can't stream", async () => {
    vi.spyOn(app.soundbox, "speakStream").mockImplementation(async function* () {
      throw new StreamUnsupported("nope");
    } as typeof app.soundbox.speakStream);
    const resp = await app.inject({
      method: "POST",
      url: "/api/speak/stream",
      payload: { model: "m", text: "hi" },
    });
    expect(resp.statusCode).toBe(409);
    expect(resp.json()).toMatchObject({ reason: "unsupported", detail: "nope" });
  });

  it("answers 409 with Retry-After when the GPU is busy", async () => {
    vi.spyOn(app.soundbox, "speakStream").mockImplementation(async function* () {
      throw new GpuBusy("busy", 12);
    } as typeof app.soundbox.speakStream);
    const resp = await app.inject({
      method: "POST",
      url: "/api/speak/stream",
      payload: { model: "m", text: "hi" },
    });
    expect(resp.statusCode).toBe(409);
    expect(resp.headers["retry-after"]).toBe("12");
    expect(resp.json()).toMatchObject({ reason: "busy", retry_after_s: 12 });
  });

  it("422s an empty text", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/speak/stream",
      payload: { model: "m", text: "" },
    });
    expect(resp.statusCode).toBe(422);
  });
});
