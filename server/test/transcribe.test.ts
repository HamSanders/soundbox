/**
 * Speech to text for voice clips: `POST /api/transcribe`.
 *
 * No real recogniser runs here. The route is driven against a fake "asr"
 * model swapped into the manager, which is enough to pin down the parts that
 * can be wrong without a GPU: the "none installed" answer, that the clip
 * reaches the model as 16 kHz mono, that the job runs through the queue, and
 * the shape of what comes back.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { WaveFile } from "wavefile";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import * as dsp from "../src/audio/dsp.js";
import { Config } from "../src/config.js";
import { asrLanguage, transcriptFrom } from "../src/models/audiocpp.js";

const ASR_ID = "audiocpp-qwen3-asr-0-6b";

/** A short stereo 44.1 kHz sine, the kind of thing an upload would be. */
function wavBytes(seconds = 0.5, rate = 44_100): Buffer {
  const n = Math.round(seconds * rate);
  const ch = Array.from({ length: n }, (_, i) => Math.round(Math.sin(i / 10) * 8000));
  const wav = new WaveFile();
  wav.fromScratch(2, rate, "16", [ch, ch]);
  return Buffer.from(wav.toBuffer());
}

describe("POST /api/transcribe", () => {
  let app: FastifyInstance;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "soundbox-transcribe-test-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("says no transcription model is installed, as a 409 with a code", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      payload: wavBytes(),
      headers: { "content-type": "audio/wav" },
    });
    expect(resp.statusCode).toBe(409);
    expect(resp.json()).toMatchObject({ code: "no_transcription_model" });
    expect(resp.json().detail).toMatch(/No transcription model is installed/);
  });

  it("rejects a body that is not a WAV", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      payload: Buffer.from("not audio at all"),
      headers: { "content-type": "audio/wav" },
    });
    expect(resp.statusCode).toBe(400);
  });

  it("refuses a model that does not transcribe", async () => {
    const svc = app.soundbox;
    const gen = (await svc.listModels()).find((m) => m.task === "gen")!;
    const resp = await app.inject({
      method: "POST",
      url: `/api/transcribe?model=${gen.id}`,
      payload: wavBytes(),
      headers: { "content-type": "audio/wav" },
    });
    expect(resp.statusCode).toBe(400);
    expect(resp.json().detail).toMatch(/does not transcribe/);
  });

  it("runs a ready asr model as a queued job and returns text and language", async () => {
    const svc = app.soundbox;
    await svc.updateSettings({ enabled_audiocpp_models: [ASR_ID] });
    const real = svc.models.get(ASR_ID);
    expect(real.describe().task).toBe("asr");

    const seen: { rate: number; channels: number; language: string | null }[] = [];
    const fake = Object.create(real) as typeof real;
    Object.defineProperty(fake, "loaded", { get: () => true });
    fake.transcribe = async (path, options) => {
      const { audio, sampleRate } = dsp.readWav(path);
      seen.push({ rate: sampleRate, channels: audio.length, language: options?.language ?? null });
      return { text: "hello there", language: "English" };
    };
    const get = vi.spyOn(svc.models, "get").mockImplementation((id) => (id === ASR_ID ? fake : real));
    const pick = vi.spyOn(svc, "pickTranscriber").mockResolvedValue(ASR_ID);
    try {
      const resp = await app.inject({
        method: "POST",
        url: "/api/transcribe?language=en",
        payload: wavBytes(),
        headers: { "content-type": "audio/wav" },
      });
      expect(resp.statusCode).toBe(200);
      expect(resp.json()).toEqual({ text: "hello there", language: "English", model: ASR_ID });
      expect(seen).toEqual([{ rate: 16000, channels: 1, language: "en" }]);
      const jobs = svc.jobs.list().filter((j) => j.kind === "transcribe");
      expect(jobs.length).toBe(1);
      expect(jobs[0]!.status).toBe("done");
    } finally {
      get.mockRestore();
      pick.mockRestore();
    }
  });

  it("reports a model failure as a 500 with its message", async () => {
    const svc = app.soundbox;
    const real = svc.models.get(ASR_ID);
    const fake = Object.create(real) as typeof real;
    Object.defineProperty(fake, "loaded", { get: () => true });
    fake.transcribe = async () => {
      throw new Error("audio.cpp crashed");
    };
    const get = vi.spyOn(svc.models, "get").mockImplementation((id) => (id === ASR_ID ? fake : real));
    try {
      const resp = await app.inject({
        method: "POST",
        url: `/api/transcribe?model=${ASR_ID}`,
        payload: wavBytes(),
        headers: { "content-type": "audio/wav" },
      });
      expect(resp.statusCode).toBe(500);
      expect(resp.json().detail).toMatch(/audio.cpp crashed/);
    } finally {
      get.mockRestore();
    }
  });

  it("answers 404 for an unknown library sound", async () => {
    const resp = await app.inject({
      method: "POST",
      url: "/api/transcribe?sound_id=nope",
      headers: { "x-soundbox": "1" },
    });
    expect(resp.statusCode).toBe(404);
  });
});

describe("transcriptFrom", () => {
  it("trims plain text and leaves the language unknown", () => {
    expect(transcriptFrom("  The quick brown fox.\n", null, null)).toEqual({
      text: "The quick brown fox.",
      language: null,
    });
  });

  it("strips Qwen3-ASR's raw language prefix and keeps the language", () => {
    expect(transcriptFrom("language English<asr_text>Hello world.", null, null)).toEqual({
      text: "Hello world.",
      language: "English",
    });
  });

  it("prefers the runtime's own language and reads one from segments", () => {
    expect(transcriptFrom("Hi", "fr", null).language).toBe("fr");
    expect(transcriptFrom("Hi", null, { segments: [{ language: "de" }] }).language).toBe("de");
  });
});

describe("asrLanguage", () => {
  it("maps codes and names to a constant code, and refuses anything else", () => {
    expect(asrLanguage(null)).toBeNull();
    expect(asrLanguage("  ")).toBeNull();
    expect(asrLanguage("EN")).toBe("en");
    expect(asrLanguage("English")).toBe("en");
    expect(() => asrLanguage("en --out x")).toThrow(/not a supported/);
    expect(() => asrLanguage("constructor")).toThrow(/not a supported/);
  });
});
