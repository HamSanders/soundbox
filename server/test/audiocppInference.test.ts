/**
 * Inference against a resident model, and the CLI fallback behind it.
 *
 * The point of routing generation through the runtime is that a one-shot
 * `audiocpp_cli` reloaded the weights every time — measured at ~8.5s of an
 * ~8.8s invocation for Stable Audio Small, against ~190ms for the same request
 * once resident. What matters in tests is not the speed but the equivalence:
 * whichever path a request takes it has to mean the same thing, and a host
 * without management has to fall back rather than fail.
 *
 * A stub host stands in for the real runtime; none of this needs a process.
 */

import { WaveFile } from "wavefile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AudioCppModel,
  BIN_ENV,
  catalogById,
  type PackageInstaller,
} from "../src/models/audiocpp.js";

const ROOT = "/models/audiocpp";

/** A one-sample stereo WAV, base64 — enough for decodeWav to accept it. */
function wavBase64(sampleRate = 44100): string {
  const wav = new WaveFile();
  wav.fromScratch(2, sampleRate, "16", [
    [0, 1000, -1000, 0],
    [0, -1000, 1000, 0],
  ]);
  return Buffer.from(wav.toBuffer()).toString("base64");
}

interface Recorded {
  loads: { id: string; path: string; family: string; task: string }[];
  runs: Record<string, unknown>[];
  unloads: string[];
}

/** `management: false` is a build with no package manager — the fallback case. */
function stubHost(
  management: boolean,
  result?: Record<string, unknown> | null,
): PackageInstaller & Recorded {
  const rec: Recorded = { loads: [], runs: [], unloads: [] };
  return {
    ...rec,
    async installPackage() {
      return management;
    },
    async deletePackage() {
      return management;
    },
    async loadModel(req) {
      rec.loads.push(req);
      return management;
    },
    async unloadModel(id) {
      rec.unloads.push(id);
    },
    async runTask(body) {
      rec.runs.push(body);
      if (!management) return null;
      return (result ?? { audio: wavBase64(), sample_rate: 44100, channels: 2 }) as never;
    },
    get loads() {
      return rec.loads;
    },
    get runs() {
      return rec.runs;
    },
    get unloads() {
      return rec.unloads;
    },
  } as PackageInstaller & Recorded;
}

function model(id: string, host: PackageInstaller | null): AudioCppModel {
  const spec = catalogById().get(id);
  if (!spec) throw new Error(`no catalog entry ${id}`);
  const m = new AudioCppModel(spec, "/models", null, ROOT, host);
  // Skip the on-disk checks: these tests are about the request, not the files.
  vi.spyOn(m, "weightsFile").mockResolvedValue(`${ROOT}/fake/weights.gguf`);
  vi.spyOn(m, "depsInstalled").mockResolvedValue(true);
  vi.spyOn(m, "requireDeps").mockResolvedValue(undefined);
  return m;
}

beforeEach(() => vi.restoreAllMocks());

describe("residency", () => {
  it("registers the model with the runtime under its own id and path", async () => {
    const host = stubHost(true);
    const m = model("audiocpp-stable-audio-3-sfx", host);

    await m.load();

    expect(host.loads).toEqual([
      {
        id: "audiocpp-stable-audio-3-sfx",
        path: `${ROOT}/fake/weights.gguf`,
        family: "stable_audio",
        task: "gen",
      },
    ]);
    expect(m.loaded).toBe(true);
  });

  it("releases it on unload", async () => {
    const host = stubHost(true);
    const m = model("audiocpp-stable-audio-3-sfx", host);
    await m.load();
    await m.unload();
    expect(host.unloads).toEqual(["audiocpp-stable-audio-3-sfx"]);
    expect(m.loaded).toBe(false);
  });

  it("still counts as loaded when the runtime cannot hold it", async () => {
    // No management: the old meaning of load() — a resolved path — still
    // applies, and generation goes through the CLI.
    const m = model("audiocpp-stable-audio-3-sfx", stubHost(false));
    await m.load();
    expect(m.loaded).toBe(true);
  });
});

describe("generate", () => {
  it("sends the same choices the CLI would, as a task body", async () => {
    const host = stubHost(true);
    const m = model("audiocpp-stable-audio-3-sfx", host);
    await m.load();

    await m.generate("glass breaking", 5, { seed: 42, steps: 8, cfg: 1.5 });

    expect(host.runs).toHaveLength(1);
    expect(host.runs[0]).toMatchObject({
      task: "gen",
      family: "stable_audio",
      model: "audiocpp-stable-audio-3-sfx",
      text: "glass breaking",
      duration_seconds: 5,
      num_inference_steps: 8,
      guidance_scale: 1.5,
      seed: 42,
    });
  });

  it("clamps duration to the model's maximum, as the CLI path does", async () => {
    const host = stubHost(true);
    const m = model("audiocpp-stable-audio-3-sfx", host);
    await m.load();

    await m.generate("x", 10_000, {});

    const spec = catalogById().get("audiocpp-stable-audio-3-sfx")!;
    expect(host.runs[0]!["duration_seconds"]).toBe(spec.max_duration_s);
  });

  it("decodes the audio the runtime returns", async () => {
    const m = model("audiocpp-stable-audio-3-sfx", stubHost(true));
    await m.load();

    const out = await m.generate("x", 1, {});

    expect(out.sampleRate).toBe(44100);
    expect(out.audio).toHaveLength(2); // stereo, channels-first
    expect(out.audio[0]).toBeInstanceOf(Float32Array);
  });

  it("omits duration on a cover, which locks it to the source", async () => {
    const host = stubHost(true);
    const m = model("audiocpp-ace-step", host);
    await m.load();

    await m.generate("x", 30, {
      edit: {
        kind: "cover",
        sourceAudioPath: "/tmp/src.wav",
        sourceDurationS: 12,
        options: { cover_strength: 0.5 },
      },
    });

    const body = host.runs[0]!;
    expect(body).not.toHaveProperty("duration_seconds");
    expect(body["audio"]).toBe("/tmp/src.wav");
    expect(body["task_route"]).toBeTruthy();
    expect(body["request_options"]).toMatchObject({ audio_cover_strength: "0.500" });
  });

  it("turns extend into a repaint window past the source's end", async () => {
    const host = stubHost(true);
    const m = model("audiocpp-ace-step", host);
    await m.load();

    await m.generate("x", 40, {
      edit: {
        kind: "extend",
        sourceAudioPath: "/tmp/src.wav",
        sourceDurationS: 12,
        options: {},
      },
    });

    expect(host.runs[0]).toMatchObject({ repaint_start: 12, repaint_end: 40 });
  });

  it("refuses an edit the model has no route for", async () => {
    const m = model("audiocpp-stable-audio-3-sfx", stubHost(true));
    await m.load();

    await expect(
      m.generate("x", 5, {
        edit: { kind: "cover", sourceAudioPath: "/tmp/s.wav", sourceDurationS: 2, options: {} },
      }),
    ).rejects.toThrow(/cannot cover/);
  });

  it("sends a family's own duration option, and no step count it would reject", async () => {
    // audio.cpp 0.9.x rejects undeclared request options outright; measured
    // against MiDashengLM-Gen: "unknown request option: duration_seconds".
    const host = stubHost(true);
    const m = model("audiocpp-midashenglm-gen", host);
    await m.load();

    await m.generate("a door slams", 6, { seed: 7, steps: 30, cfg: 2 });

    const body = host.runs[0]!;
    expect(body).not.toHaveProperty("duration_seconds");
    expect(body).not.toHaveProperty("num_inference_steps");
    expect(body).toMatchObject({ guidance_scale: 2, seed: 7 });
    expect(body["request_options"]).toEqual({ duration_sec: "6.000" });
  });
});

describe("speak reference transcripts", () => {
  it("sends Fish reference_text inside request_options alongside voice_ref", async () => {
    const host = stubHost(true);
    const m = model("audiocpp-fish-audio", host);
    await m.speak("New speech.", { voiceRefPath: "/tmp/reference.wav",
      requestOptions: { reference_text: "Exact reference speech.", temperature: "0.8" } });
    expect(host.runs[0]).toMatchObject({ voice_ref: "/tmp/reference.wav",
      request_options: { reference_text: "Exact reference speech.", temperature: "0.8" } });
    expect(host.runs[0]).not.toHaveProperty("reference_text");
  });

  it("rejects Fish reference audio without a caller's transcript before loading", async () => {
    const host = stubHost(true);
    const m = model("audiocpp-fish-audio", host);
    await expect(m.speak("Hello", { voiceRefPath: "/tmp/reference.wav" }))
      .rejects.toThrow(/Reference Transcript/);
    expect(host.loads).toHaveLength(0);
    expect(host.runs).toHaveLength(0);
  });

  it("does not require or inject transcripts for other cloning models", async () => {
    const host = stubHost(true);
    const m = model("audiocpp-chatterbox", host);
    await m.speak("Hello", { voiceRefPath: "/tmp/reference.wav" });
    expect(host.runs[0]).toHaveProperty("voice_ref", "/tmp/reference.wav");
    expect(host.runs[0]?.["request_options"] ?? {}).not.toHaveProperty("reference_text");
  });
});

describe("catalog", () => {
  const specs = [...catalogById().values()];

  it("gives every entry a licence with a commercial verdict", () => {
    for (const s of specs) {
      expect(["yes", "conditional", "no"], s.id).toContain(s.license.commercial);
      expect(s.license.name, s.id).toBeTruthy();
    }
  });

  it("names an audio.cpp package for every shipped entry", () => {
    for (const s of specs.filter((x) => x.source === "builtin")) {
      expect(s.audiocpp_package_id, s.id).toBeTruthy();
      expect(s.audiocpp_target_dir, s.id).toBeTruthy();
    }
  });

  it("names duration_option as a bare request-option key", () => {
    for (const s of specs.filter((x) => x.task === "gen" && x.duration_option)) {
      expect(s.duration_option, s.id).toMatch(/^[a-z_]+$/);
    }
  });
});

/**
 * A stub host that behaves like one server process at a time: what it holds
 * resident is per process, `restart()` swaps in a fresh one, and a run against
 * an id the current process never loaded fails the way audiocpp_server does.
 * `track: false` hides `isResident`, like a host that can't say.
 */
function processHost(track = true) {
  const host = stubHost(true);
  let resident = new Set<string>();
  const loadModel = host.loadModel!.bind(host);
  const runTask = host.runTask!.bind(host);
  let dieOnNextRun = false;
  Object.assign(host, {
    async loadModel(req: Parameters<NonNullable<PackageInstaller["loadModel"]>>[0], ...rest: [string, string | null]) {
      const ok = await loadModel(req, ...rest);
      resident.add(req.id);
      return ok;
    },
    async runTask(body: Record<string, unknown>, ...rest: [string, string | null]) {
      if (dieOnNextRun) {
        // The settings change lands mid-request: the process is replaced and
        // the in-flight fetch dies with it.
        dieOnNextRun = false;
        resident = new Set();
        throw new TypeError("fetch failed");
      }
      if (!resident.has(String(body["model"]))) {
        throw new Error(
          `audio.cpp could not run this request (HTTP 500): unknown model id: ${String(body["model"])}`,
        );
      }
      return runTask(body, ...rest);
    },
  });
  if (track) Object.assign(host, { isResident: (id: string) => resident.has(id) });
  return Object.assign(host, {
    restart() {
      resident = new Set();
    },
    dieDuringNextRun() {
      dieOnNextRun = true;
    },
  });
}

describe("a server process that went away", () => {
  it("reloads before running when the process it was loaded into is gone", async () => {
    const host = processHost();
    const m = model("audiocpp-stable-audio-3-sfx", host);
    await m.load();

    host.restart(); // idle stop, cancel, or a new models folder
    const out = await m.generate("x", 1, {});

    expect(out.sampleRate).toBe(44100);
    expect(host.loads).toHaveLength(2);
    expect(host.runs).toHaveLength(1);
  });

  it("reloads and retries once when the process dies under the request", async () => {
    const host = processHost();
    const m = model("audiocpp-stable-audio-3-sfx", host);
    await m.load();

    host.dieDuringNextRun();
    await m.generate("x", 1, {});
    // And it stays healed: the next one needs no reload.
    await m.generate("x", 1, {});

    expect(host.loads).toHaveLength(2);
    expect(host.runs).toHaveLength(2);
  });

  it("recovers from 'unknown model id' even when the host can't say what's resident", async () => {
    const host = processHost(false);
    const m = model("audiocpp-stable-audio-3-sfx", host);
    await m.load();

    host.restart();
    await m.generate("x", 1, {});

    expect(host.loads).toHaveLength(2);
    expect(host.runs).toHaveLength(1);
  });

  it("does not retry other failures", async () => {
    const host = processHost();
    const m = model("audiocpp-stable-audio-3-sfx", host);
    await m.load();
    host.runTask = async () => {
      throw new Error("audio.cpp could not run this request (HTTP 400): bad steps");
    };

    await expect(m.generate("x", 1, {})).rejects.toThrow(/bad steps/);
    expect(host.loads).toHaveLength(1);
  });
});

describe("separate", () => {
  it("maps named outputs to stems, keeping the loader's own names", async () => {
    const host = stubHost(true, {
      named_audio_outputs: [
        { id: "drums", audio: wavBase64() },
        { id: "bass", audio: wavBase64() },
        { id: "other", audio: wavBase64() },
        { id: "vocals", audio: wavBase64() },
      ],
    });
    const m = model("audiocpp-htdemucs-sep", host);
    await m.load();

    const stems = await m.separate("/tmp/song.wav");

    expect(stems.map((s) => s.stemName)).toEqual(["drums", "bass", "other", "vocals"]);
    expect(stems[0]!.audio.sampleRate).toBe(44100);
    expect(host.runs[0]).toMatchObject({ task: "sep", audio: "/tmp/song.wav" });
  });

  it("errors rather than returning nothing when a run produces no stems", async () => {
    const host = stubHost(true, { named_audio_outputs: [] });
    const m = model("audiocpp-htdemucs-sep", host);
    await m.load();
    await expect(m.separate("/tmp/song.wav")).rejects.toThrow(/no stems/i);
  });
});

describe("fallback to the CLI", () => {
  // Point the binary lookup at nothing, so the fallback fails fast instead of
  // finding — and running — a real audio.cpp install on the developer's machine.
  beforeEach(() => vi.stubEnv(BIN_ENV, "/nonexistent/audiocpp_cli"));
  afterEach(() => vi.unstubAllEnvs());

  it("does not use the runtime when it has no management", async () => {
    const host = stubHost(false);
    const m = model("audiocpp-stable-audio-3-sfx", host);
    await m.load();
    // findBinary resolves nothing, so the CLI path fails — the point is that it was *attempted* rather than the request
    // silently succeeding against a runtime that cannot serve it.
    await expect(m.generate("x", 1, {})).rejects.toThrow();
    expect(host.runs).toHaveLength(0);
  });

  it("does not use the runtime when no host is wired up", async () => {
    const m = model("audiocpp-stable-audio-3-sfx", null);
    await m.load();
    await expect(m.generate("x", 1, {})).rejects.toThrow();
  });
});
