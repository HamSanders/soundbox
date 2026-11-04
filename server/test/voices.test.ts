import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import * as dsp from "../src/audio/dsp.js";
import {
  JOIN_GAP_S,
  MAX_SAMPLES,
  checkReference,
  combineReferences,
  rms,
  tidyReference,
} from "../src/audio/reference.js";
import { Config } from "../src/config.js";
import { Database } from "../src/db.js";
import type { Sound, Voice } from "../src/schemas.js";

const SR = 16000;

/** A tone standing in for speech: what the checks look at is length and
 *  level, and a sine has both without a fixture file. */
function tone(seconds: number, amp = 0.3, freq = 220): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

function withSilence(lead: number, body: Float32Array, tail: number): Float32Array {
  const out = new Float32Array(Math.round(lead * SR) + body.length + Math.round(tail * SR));
  out.set(body, Math.round(lead * SR));
  return out;
}

let scratch: string;

/** WAV bytes for an upload body, written by the same encoder the server uses. */
function wavBytes(samples: Float32Array, rate = SR): Buffer {
  const path = join(scratch, `clip-${Math.random().toString(36).slice(2)}.wav`);
  dsp.writeWav(path, [samples], rate);
  return readFileSync(path);
}

describe("reference clips", () => {
  it("refuses a clip that is too short, too long or silent", () => {
    expect(() => checkReference([tone(0.5)], SR)).toThrow(/at least 1s/);
    expect(() => checkReference([tone(61)], SR)).toThrow(/under 60s/);
    expect(() => checkReference([tone(3, 0.001)], SR)).toThrow(/almost silent/);
    expect(() => checkReference([tone(3)], SR)).not.toThrow();
  });

  it("tidy cuts silence off the ends but keeps some padding", () => {
    const clip = withSilence(2, tone(3), 2);
    const [out] = tidyReference([clip], SR);
    const seconds = out!.length / SR;
    expect(seconds).toBeGreaterThan(3);
    expect(seconds).toBeLessThan(3.5);
  });

  it("tidy pulls a hot peak down and never boosts a quiet clip", () => {
    const hot = tone(2, 1.4);
    const [tamed] = tidyReference([hot], SR);
    expect(Math.max(...tamed!.map(Math.abs))).toBeLessThanOrEqual(0.98);

    const quiet = tone(2, 0.05);
    const [same] = tidyReference([quiet], SR);
    expect(rms(same!)).toBeCloseTo(rms(quiet), 3);
  });

  it("tidy takes DC offset out and returns mono", () => {
    const left = tone(2).map((v) => v + 0.2);
    const right = tone(2).map((v) => v + 0.2);
    const out = tidyReference([left, right], SR);
    expect(out).toHaveLength(1);
    const mean = out[0]!.reduce((a, b) => a + b, 0) / out[0]!.length;
    expect(Math.abs(mean)).toBeLessThan(0.01);
  });

  it("joins clips with a pause, levelled to the median and resampled", () => {
    const joined = combineReferences([
      { audio: [tone(2, 0.05)], sampleRate: SR },
      { audio: [tone(2, 0.3)], sampleRate: SR },
      // 32000 samples labelled 32 kHz: one second, resampled down to SR.
      { audio: [tone(2, 0.3, 150)], sampleRate: SR * 2 },
    ]);
    expect(joined.sampleRate).toBe(SR);
    const mono = joined.audio[0]!;
    expect(mono.length).toBe(5 * SR + 2 * Math.round(JOIN_GAP_S * SR));
    // The quiet first clip comes up to the median (0.3 amplitude) level.
    const first = mono.slice(0, 2 * SR);
    expect(rms(first)).toBeCloseTo(rms(tone(2, 0.3)), 2);
    // The pause between is silence.
    const gap = mono.slice(2 * SR + 10, 2 * SR + Math.round(JOIN_GAP_S * SR) - 10);
    expect(rms(gap)).toBe(0);
  });
});

describe("voice routes", () => {
  let app: FastifyInstance;
  let dataDir: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "konchi-voices-scratch-"));
    dataDir = await mkdtemp(join(tmpdir(), "konchi-voices-test-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  });

  const soundsDir = () => app.konchi.config.paths.sounds;
  const onDisk = (served: string) => join(soundsDir(), served.replace(/^\/files\//, ""));

  async function upload(name: string, clip: Float32Array, tidy = false): Promise<Voice> {
    const res = await app.inject({
      method: "POST",
      url: `/api/voices/upload?name=${encodeURIComponent(name)}${tidy ? "&tidy=true" : ""}`,
      headers: { "content-type": "audio/wav" },
      payload: wavBytes(clip),
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as Voice;
  }

  async function addSample(voiceId: string, clip: Float32Array) {
    return app.inject({
      method: "POST",
      url: `/api/voices/${voiceId}/samples`,
      headers: { "content-type": "audio/wav" },
      payload: wavBytes(clip),
    });
  }

  it("saves a new clone with one clip, which is its reference", async () => {
    const voice = await upload("Ada", tone(3));
    expect(voice.samples).toHaveLength(1);
    expect(voice.reference_file).toBe(voice.samples![0]!.file);
    expect(voice.samples![0]!.duration_s).toBeCloseTo(3, 2);
    expect(voice.read_count).toBe(0);
  });

  it("refuses a silent upload with a reason", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/voices/upload?name=Silent",
      headers: { "content-type": "audio/wav" },
      payload: wavBytes(new Float32Array(3 * SR)),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toMatch(/almost silent/);
  });

  it("tidies an upload when asked", async () => {
    const voice = await upload("Tidy", withSilence(2, tone(3), 2), true);
    expect(voice.samples![0]!.duration_s!).toBeLessThan(3.5);
    const untidy = await upload("Untidy", withSilence(2, tone(3), 2));
    expect(untidy.samples![0]!.duration_s!).toBeCloseTo(7, 2);
  });

  it("joins a second clip into a new reference, and unjoins on removal", async () => {
    const voice = await upload("Bea", tone(3));
    const added = await addSample(voice.id, tone(2, 0.3, 330));
    expect(added.statusCode, added.body).toBe(201);
    const two = added.json() as Voice;
    expect(two.samples).toHaveLength(2);
    expect(two.reference_file).not.toBe(two.samples![0]!.file);
    const joined = dsp.readWav(onDisk(two.reference_file!));
    expect(dsp.frameCount(joined.audio)).toBe(5 * SR + Math.round(JOIN_GAP_S * SR));

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/voices/${voice.id}/samples/${two.samples![1]!.id}`,
      headers: { "x-konchi": "1" },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    const one = removed.json() as Voice;
    expect(one.samples).toHaveLength(1);
    expect(one.reference_file).toBe(one.samples![0]!.file);
    // The joined file and the removed clip's file are both gone.
    expect(existsSync(onDisk(two.reference_file!))).toBe(false);
    expect(existsSync(onDisk(two.samples![1]!.file))).toBe(false);
  });

  it("refuses to remove a voice's only clip", async () => {
    const voice = await upload("Cy", tone(3));
    const res = await app.inject({
      method: "DELETE",
      url: `/api/voices/${voice.id}/samples/${voice.samples![0]!.id}`,
      headers: { "x-konchi": "1" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toMatch(/only clip/);
  });

  it(`stops at ${MAX_SAMPLES} clips`, async () => {
    const voice = await upload("Dee", tone(2));
    for (let i = 1; i < MAX_SAMPLES; i++) {
      expect((await addSample(voice.id, tone(2))).statusCode).toBe(201);
    }
    const res = await addSample(voice.id, tone(2));
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toMatch(/already has/);
  });

  it("adds a clip from a library sound by id", async () => {
    const voice = await upload("Eve", tone(3));
    const sound = await app.inject({
      method: "POST",
      url: "/api/sounds/upload?name=take",
      headers: { "content-type": "audio/wav" },
      payload: wavBytes(tone(2)),
    });
    expect(sound.statusCode, sound.body).toBe(201);
    const res = await app.inject({
      method: "POST",
      url: `/api/voices/${voice.id}/samples`,
      payload: { source_sound_id: (sound.json() as Sound).id },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as Voice).samples).toHaveLength(2);
  });

  it("will not add clips to a built-in", async () => {
    // A builtin with no model_id skips the catalogue check — enough to have
    // one to refuse.
    const created = await app.inject({
      method: "POST",
      url: "/api/voices",
      payload: { name: "Peter", kind: "builtin", voice_id: "peter" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const res = await addSample((created.json() as Voice).id, tone(2));
    expect(res.statusCode).toBe(400);
  });

  it("deletes every clip file with the voice", async () => {
    const voice = await upload("Fen", tone(3));
    const two = (await addSample(voice.id, tone(2))).json() as Voice;
    const files = [two.reference_file!, ...two.samples!.map((s) => s.file)].map(onDisk);
    files.forEach((f) => expect(existsSync(f)).toBe(true));
    const res = await app.inject({
      method: "DELETE",
      url: `/api/voices/${voice.id}`,
      headers: { "x-konchi": "1" },
    });
    expect(res.statusCode).toBe(204);
    files.forEach((f) => expect(existsSync(f)).toBe(false));
  });

  it("exports a voice and imports it back as a copy", async () => {
    const voice = await upload("Gus", tone(3));
    await app.inject({
      method: "PATCH",
      url: `/api/voices/${voice.id}`,
      payload: { notes: "My own voice, recorded at home" },
    });
    await addSample(voice.id, tone(2));

    const exported = await app.inject({ method: "GET", url: `/api/voices/${voice.id}/export` });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-disposition"]).toContain("Gus.konchi-voice.json");
    const file = exported.json();
    expect(file.format).toBe("konchi-voice");
    expect(file.samples).toHaveLength(2);

    const imported = await app.inject({ method: "POST", url: "/api/voices/import", payload: file });
    expect(imported.statusCode, imported.body).toBe(201);
    const copy = imported.json() as Voice;
    expect(copy.id).not.toBe(voice.id);
    expect(copy.name).toBe("Gus (2)");
    expect(copy.notes).toBe("My own voice, recorded at home");
    expect(copy.samples).toHaveLength(2);
    expect(copy.samples!.map((s) => Math.round(s.duration_s!))).toEqual([3, 2]);
  });

  it("imports a voice whose model this library doesn't know, without the model", async () => {
    const file = {
      format: "konchi-voice",
      version: 1,
      voice: { name: "Hal", kind: "clone", model_id: "no-such-model" },
      samples: [{ wav_base64: wavBytes(tone(2)).toString("base64") }],
    };
    const res = await app.inject({ method: "POST", url: "/api/voices/import", payload: file });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as Voice).model_id).toBeNull();
  });

  it("rejects a file that isn't a voice export", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/voices/import",
      payload: { format: "something-else" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("filters the library by voice", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sounds?voice_id=nobody" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
  });
});

describe("per-voice history", () => {
  function sound(id: string, voiceId: string | null): Sound {
    return {
      id,
      created_at: new Date().toISOString(),
      model: "tts",
      prompt: "hello",
      duration_s: 1,
      sample_rate: SR,
      channels: 1,
      file: `/files/${id}.wav`,
      peaks: [],
      favorite: false,
      tags: [],
      name: id,
      size_bytes: 1,
      source: "app",
      voice_id: voiceId,
    };
  }

  it("lists and counts only the sounds read in one voice", () => {
    const db = new Database(":memory:");
    for (const id of ["v1", "v2"]) {
      db.createVoice({ id, name: id, kind: "builtin", created_at: "2026-01-01", voice_id: id }, null);
    }
    db.insertSound(sound("a", "v1"), "a.wav");
    db.insertSound(sound("b", "v1"), "b.wav");
    db.insertSound(sound("c", "v2"), "c.wav");
    db.insertSound(sound("d", null), "d.wav");

    const [items, total] = db.listSounds({ voice_id: "v1" });
    expect(total).toBe(2);
    expect(items.map((s) => s.id).sort()).toEqual(["a", "b"]);
    expect(db.getVoice("v1")!.read_count).toBe(2);
    expect(db.listVoices().find((v) => v.id === "v2")!.read_count).toBe(1);
  });

  it("gives a clone saved before voices held several clips its one sample", () => {
    const db = new Database(":memory:");
    db.createVoice(
      { id: "old", name: "Old", kind: "clone", created_at: "2026-01-01" },
      "voice-old.wav",
    );
    // A fresh connection on the same file is what runs the migration on a
    // real library; :memory: can't be reopened, so call through to it.
    (db as unknown as { migrate(): void }).migrate();
    const voice = db.getVoice("old")!;
    expect(voice.samples).toHaveLength(1);
    expect(voice.samples![0]!.file).toBe("/files/voice-old.wav");
    expect(voice.samples![0]!.duration_s).toBeNull();
  });
});
