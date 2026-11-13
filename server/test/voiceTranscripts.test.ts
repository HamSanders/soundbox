import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import * as dsp from "../src/audio/dsp.js";
import { JOIN_GAP_S } from "../src/audio/reference.js";
import { Config } from "../src/config.js";
import { Database } from "../src/db.js";
import { buildMcp } from "../src/mcp/server.js";
import type { Voice } from "../src/schemas.js";
import { voiceReferenceError } from "../../app/src/lib/voice-reference.js";

const FISH = "audiocpp-fish-audio";
const OTHER = "audiocpp-chatterbox";
const SR = 16000;
let app: FastifyInstance;
let dir: string;
let client: Client;

function clip(seconds = 2, frequency = 220) {
  return { audio: [Float32Array.from({ length: SR * seconds }, (_, i) =>
    0.3 * Math.sin(2 * Math.PI * frequency * i / SR))], sampleRate: SR };
}

function clone(referenceText?: string | null, model = FISH): Voice {
  return app.soundbox.createVoice({ name: "Narrator", kind: "clone", model_id: model,
    reference_text: referenceText }, clip());
}

async function speak(voice: Voice, model = FISH, options: Record<string, string> = {}) {
  const res = await app.inject({ method: "POST", url: "/api/speak", payload: {
    model, lines: [{ text: "New words.", voice_id: voice.id }], request_options: options,
  } });
  expect(res.statusCode, res.body).toBe(202);
  await vi.waitFor(() => expect(app.soundbox.jobs.get(res.json().job_id)?.status).toBe("done"));
}

const fish = () => vi.mocked(app.soundbox.models.get(FISH).speak);
const other = () => vi.mocked(app.soundbox.models.get(OTHER).speak);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "soundbox-transcripts-"));
  app = buildApp(new Config(dir), { serveUi: false });
  await app.ready();
  await app.soundbox.models.setAudiocppEnabled([FISH, OTHER]);
  vi.spyOn(app.soundbox.models, "load").mockResolvedValue({} as never);
  for (const id of [FISH, OTHER]) {
    vi.spyOn(app.soundbox.models.get(id), "speak").mockResolvedValue(clip());
  }
  const server = buildMcp(() => app.soundbox);
  client = new Client({ name: "transcript-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
});

beforeEach(() => vi.clearAllMocks());
afterAll(async () => {
  await client.close();
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("voice transcripts", () => {
  it("stores an uploaded transcript and edits it through HTTP, surviving a DB reopen", async () => {
    const path = join(dir, "upload.wav");
    dsp.writeWav(path, clip().audio, SR);
    const text = "Точні слова. A & B?\nSecond line.";
    const res = await app.inject({ method: "POST",
      url: `/api/voices/upload?name=Uploaded&model_id=${FISH}&reference_text=${encodeURIComponent(text)}`,
      headers: { "content-type": "audio/wav" }, payload: readFileSync(path) });
    expect(res.statusCode).toBe(201);
    const v = res.json<Voice>();
    expect(v.samples?.[0]?.reference_text).toBe(text);
    const patched = await app.inject({ method: "PATCH", url: `/api/voices/${v.id}`,
      payload: { samples: [{ id: v.samples![0]!.id, reference_text: "Corrected." }] } });
    expect(patched.statusCode).toBe(200);
    const db = new Database(join(dir, "soundbox.db"));
    try { expect(db.getVoice(v.id)?.samples?.[0]?.reference_text).toBe("Corrected."); }
    finally { db.close(); }
  });

  it("passes the selected voice's transcript, overriding a shared request option", async () => {
    const v = clone("Actual reference words.");
    await speak(v, FISH, { reference_text: "Wrong global transcript", temperature: "0.7" });
    expect(fish()).toHaveBeenCalledWith("New words.", expect.objectContaining({
      voiceRefPath: expect.stringContaining(`voice-${v.id}.wav`),
      requestOptions: { reference_text: "Actual reference words.", temperature: "0.7" },
    }));
  });

  it("joins text in the same order as the combined audio, including rapid appends", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
    let v: Voice;
    try {
      v = clone("First.");
      v = app.soundbox.addVoiceSample(v.id, clip(3, 440), false, "Second.");
      v = app.soundbox.addVoiceSample(v.id, clip(1, 660), false, "Third.");
    } finally { clock.mockRestore(); }
    expect(v!.samples?.map((s) => s.reference_text)).toEqual(["First.", "Second.", "Third."]);
    const joined = dsp.readWav(join(app.soundbox.config.paths.sounds,
      v!.reference_file!.replace("/files/", "")));
    expect(dsp.frameCount(joined.audio) / joined.sampleRate).toBeCloseTo(6 + 2 * JOIN_GAP_S);
    // Distinct frequencies show which clip is actually first, second and third.
    const crossings = (start: number, length: number) => {
      const data = joined.audio[0]!.slice(Math.round(start * SR), Math.round((start + length) * SR));
      return data.reduce((n, value, i) => n + (i && data[i - 1]! <= 0 && value > 0 ? 1 : 0), 0);
    };
    expect(crossings(0, 1)).toBeCloseTo(220, -1);
    expect(crossings(2 + JOIN_GAP_S, 1)).toBeCloseTo(440, -1);
    expect(crossings(5 + 2 * JOIN_GAP_S, 1)).toBeCloseTo(660, -1);
    await speak(v!);
    expect(fish().mock.calls[0]?.[1]?.requestOptions?.reference_text).toBe("First. Second. Third.");
    v = (await app.soundbox.deleteVoiceSample(v!.id, v!.samples![1]!.id))!;
    await speak(v);
    expect(fish().mock.calls[1]?.[1]?.requestOptions?.reference_text).toBe("First. Third.");
  });

  it.each([undefined, null, "", " \n "])("rejects missing transcript %j before queueing/loading", async (text) => {
    const v = clone(text);
    const submit = vi.spyOn(app.soundbox.jobs, "submit");
    const res = await app.inject({ method: "POST", url: "/api/speak", payload: {
      model: FISH, lines: [{ text: "New words", voice_id: v.id }],
      request_options: { reference_text: "A model setting cannot repair missing data." },
    } });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toMatch(/Reference Transcript.*clip\(s\) 1/);
    expect(submit).not.toHaveBeenCalled();
    expect(app.soundbox.models.load).not.toHaveBeenCalled();
    expect(fish()).not.toHaveBeenCalled();
    submit.mockRestore();
  });

  it("rejects an incomplete second voice before any line is spoken", async () => {
    const a = clone("Complete.");
    const b = app.soundbox.addVoiceSample(clone("First.").id, clip(), false);
    const res = await app.inject({ method: "POST", url: "/api/speak", payload: {
      model: FISH, lines: [{ text: "A", voice_id: a.id }, { text: "B", voice_id: b.id }],
    } });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain("clip(s) 2");
    expect(fish()).not.toHaveBeenCalled();
  });

  it("keeps other models and legacy clones usable without injecting reference_text", async () => {
    await speak(clone(undefined, OTHER), OTHER, { exaggeration: "0.4" });
    expect(other().mock.calls[0]?.[1]?.requestOptions).toEqual({ exaggeration: "0.4" });
    await speak(clone("Stored for Fish.", OTHER), OTHER);
    expect(other().mock.calls[1]?.[1]?.requestOptions).not.toHaveProperty("reference_text");
  });

  it("uses each voice's own transcript in multi-voice and mixed-model Speak", async () => {
    const a = clone("Alpha.");
    const b = clone("Beta.");
    const c = clone(undefined, OTHER);
    const res = await app.inject({ method: "POST", url: "/api/speak", payload: {
      model: FISH, lines: [{ text: "A", voice_id: a.id }, { text: "B", voice_id: b.id },
        { text: "C", voice_id: c.id, model: OTHER }],
    } });
    expect(res.statusCode).toBe(202);
    await vi.waitFor(() => expect(app.soundbox.jobs.get(res.json().job_id)?.status).toBe("done"));
    expect(fish().mock.calls.map((c) => c[1]?.requestOptions?.reference_text)).toEqual(["Alpha.", "Beta."]);
    expect(other().mock.calls[0]?.[1]?.requestOptions).not.toHaveProperty("reference_text");
  });

  it("preserves transcripts on export/import and accepts older files without them", async () => {
    let v = clone("One.");
    v = app.soundbox.addVoiceSample(v.id, clip(), false, "Two.");
    const exported = (await app.inject({ url: `/api/voices/${v.id}/export` })).json();
    const imported = await app.inject({ method: "POST", url: "/api/voices/import", payload: exported });
    expect(imported.statusCode).toBe(201);
    expect(imported.json<Voice>().samples?.map((s) => s.reference_text)).toEqual(["One.", "Two."]);
    for (const sample of exported.samples) delete sample.reference_text;
    const legacy = await app.inject({ method: "POST", url: "/api/voices/import", payload: exported });
    expect(legacy.statusCode).toBe(201);
    expect(legacy.json<Voice>().samples?.every((s) => s.reference_text === null)).toBe(true);
  });

  it("refuses edits to another voice's samples before changing any fields", async () => {
    const a = clone("Alpha.");
    const b = clone("Beta.");
    const res = await app.inject({ method: "PATCH", url: `/api/voices/${a.id}`, payload: {
      name: "Changed", samples: [{ id: a.samples![0]!.id, reference_text: "Changed" },
        { id: b.samples![0]!.id, reference_text: "Changed" }],
    } });
    expect(res.statusCode).toBe(400);
    expect(app.soundbox.getVoice(a.id)?.samples?.[0]?.reference_text).toBe("Alpha.");
    expect(app.soundbox.getVoice(a.id)?.name).toBe("Narrator");
  });

  it("uses each transcript in Script Builder, overriding story/line/take settings", async () => {
    const story = app.soundbox.createStory("Test");
    app.soundbox.setStoryOptions(story.id, { reference_text: "Story" });
    for (const text of ["Alpha.", "Beta."]) {
      const v = clone(text);
      const line = app.soundbox.createSegment(story.id, { text: "Read", voice_id: v.id,
        request_options: { reference_text: "Line" } })!;
      await app.soundbox.generateSegment(line.id, { model: FISH,
        request_options: { reference_text: "Take" } });
    }
    expect(fish().mock.calls.map((c) => c[1]?.requestOptions?.reference_text)).toEqual(["Alpha.", "Beta."]);
    const missing = clone();
    const line = app.soundbox.createSegment(story.id, { text: "Read", voice_id: missing.id })!;
    vi.clearAllMocks();
    const res = await app.inject({ method: "POST",
      url: `/api/stories/${story.id}/segments/${line.id}/generate`, payload: { model: FISH } });
    expect(res.statusCode).toBe(400);
    await expect(app.soundbox.generateSegment(line.id, { model: FISH })).rejects.toThrow(/Reference Transcript/);
    expect(app.soundbox.models.load).not.toHaveBeenCalled();
  });

  it("passes saved transcripts through MCP Speak and speak_story", async () => {
    const a = clone("MCP Alpha.");
    const b = clone("MCP Beta.");
    const result = await client.callTool({ name: "soundbox.speak", arguments: {
      model: FISH, lines: [{ text: "A", voice_id: a.id }, { text: "B", voice_id: b.id }],
    } });
    expect(result.isError).not.toBe(true);
    const story = app.soundbox.createStory("MCP");
    app.soundbox.createSegment(story.id, { text: "B", voice_id: b.id });
    const read = await client.callTool({ name: "soundbox.speak_story",
      arguments: { model: FISH, story_id: story.id } });
    expect(read.isError).not.toBe(true);
    expect(fish().mock.calls.map((c) => c[1]?.requestOptions?.reference_text))
      .toEqual(["MCP Alpha.", "MCP Beta.", "MCP Beta."]);
    const missing = clone();
    const bad = await client.callTool({ name: "soundbox.speak", arguments: {
      model: FISH, lines: [{ text: "Bad", voice_id: missing.id }],
    } });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain("Reference Transcript");
  });

  it("shows a frontend validation error only for Fish clones with incomplete transcripts", () => {
    const missing = clone();
    expect(voiceReferenceError(missing, { family: "fish_audio" })).toContain("Reference Transcript");
    expect(voiceReferenceError(clone("Exact."), { family: "fish_audio" })).toBeNull();
    expect(voiceReferenceError(missing, { family: "chatterbox" })).toBeNull();
    expect(voiceReferenceError({ ...missing, kind: "builtin" }, { family: "fish_audio" })).toBeNull();
  });
});
