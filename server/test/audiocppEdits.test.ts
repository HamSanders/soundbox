import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AudioCppModel, modelSpecs, type EditSpec } from "../src/models/audiocpp.js";
import { ModelError } from "../src/errors.js";

/**
 * The argv `command()` builds for the audio-to-audio edit routes, checked
 * without a real audiocpp_cli: a stand-in file satisfies `findBinary()`'s
 * env override, and `command()` itself never spawns anything.
 */

let tmp: string;
const previousBin = process.env.KONCHI_AUDIOCPP_BIN;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "konchi-audiocpp-edits-"));
  const fake = join(tmp, "audiocpp_cli");
  await writeFile(fake, "");
  process.env.KONCHI_AUDIOCPP_BIN = fake;
});

afterAll(async () => {
  if (previousBin === undefined) delete process.env.KONCHI_AUDIOCPP_BIN;
  else process.env.KONCHI_AUDIOCPP_BIN = previousBin;
  await rm(tmp, { recursive: true, force: true });
});

function modelFor(id: string): AudioCppModel {
  const spec = modelSpecs().find((s) => s.id === id);
  if (!spec) throw new Error(`no catalog entry ${id}`);
  return new AudioCppModel(spec, tmp);
}

/** `command()` is private; the test reaches in deliberately. */
async function argv(
  model: AudioCppModel,
  edit: EditSpec | null,
  durationS = 45,
): Promise<string[]> {
  const fn = (model as unknown as { command: (...a: unknown[]) => Promise<string[]> }).command;
  return await fn.call(
    model,
    "weights.gguf",
    "out.wav",
    "late night rap",
    durationS,
    null, // negative prompt
    7, // seed
    null, // steps
    null, // cfg
    "[verse]\nwords",
    "Night",
    edit,
  );
}

/** Value following a flag, or undefined when the flag is absent. */
const after = (cmd: string[], flag: string) => {
  const i = cmd.indexOf(flag);
  return i === -1 ? undefined : cmd[i + 1];
};

describe("ACE-Step edit routes", () => {
  it("declares extend/cover/repaint and MiniMax Music 3 declares none", () => {
    const ace = modelFor("audiocpp-ace-step").describe();
    expect(ace.supports).toMatchObject({ extend: true, cover: true, repaint: true });
    const minimax = modelFor("audiocpp-minimax-music3").describe();
    expect(minimax.supports).toMatchObject({ extend: false, cover: false, repaint: false });
  });

  it("extend repaints from the source's end to the requested total length", async () => {
    const cmd = await argv(modelFor("audiocpp-ace-step"), {
      kind: "extend",
      sourceAudioPath: "src.wav",
      sourceDurationS: 21.197,
      options: {},
    });
    expect(after(cmd, "--task-route")).toBe("repaint");
    expect(after(cmd, "--audio")).toBe("src.wav");
    expect(after(cmd, "--repaint-start")).toBe("21.197");
    expect(after(cmd, "--repaint-end")).toBe("45.000");
    expect(after(cmd, "--duration-seconds")).toBe("45.000");
    // the lyrics still ride along so the continuation keeps singing them
    expect(after(cmd, "--lyrics")).toBe("[verse]\nwords");
  });

  it("extend never repaints past the model's own ceiling", async () => {
    const cmd = await argv(
      modelFor("audiocpp-ace-step"),
      { kind: "extend", sourceAudioPath: "src.wav", sourceDurationS: 20, options: {} },
      600,
    );
    expect(after(cmd, "--repaint-end")).toBe("60.000");
    expect(after(cmd, "--duration-seconds")).toBe("60.000");
  });

  // This test used to assert the opposite — that a cover omits
  // `--duration-seconds` because audio.cpp locks the route to the source.
  // Measured against ACE-Step 1.5 turbo on audio.cpp 0.6.1, it does not:
  // without the flag a 7.70s source came back as 3.93s (and 3.6s as 2.35s,
  // 13.1s as 5.34s — not even a constant ratio). With it, 7.68s.
  it("cover asks for the source's own length and passes the strength", async () => {
    const cmd = await argv(modelFor("audiocpp-ace-step"), {
      kind: "cover",
      sourceAudioPath: "src.wav",
      sourceDurationS: 21,
      options: { cover_strength: 0.6 },
    });
    expect(after(cmd, "--task-route")).toBe("cover");
    expect(after(cmd, "--duration-seconds")).toBe("21.000");
    expect(cmd).toContain("audio_cover_strength=0.600");
  });

  // The length of a cover is the clip being covered, not something the
  // request gets a say in — so a caller asking for a different duration is
  // overridden rather than obeyed.
  it("cover ignores a requested duration in favour of the source's", async () => {
    const cmd = await argv(
      modelFor("audiocpp-ace-step"),
      {
        kind: "cover",
        sourceAudioPath: "src.wav",
        sourceDurationS: 12,
        options: {},
      },
      45,
    );
    expect(after(cmd, "--duration-seconds")).toBe("12.000");
  });

  it("repaint passes its window and policy", async () => {
    const cmd = await argv(modelFor("audiocpp-ace-step"), {
      kind: "repaint",
      sourceAudioPath: "src.wav",
      sourceDurationS: 30,
      options: { repaint_start_s: 10, repaint_end_s: 20, repaint_mode: "aggressive", repaint_strength: 0.8 },
    });
    expect(after(cmd, "--task-route")).toBe("repaint");
    expect(after(cmd, "--repaint-start")).toBe("10");
    expect(after(cmd, "--repaint-end")).toBe("20");
    expect(after(cmd, "--repaint-mode")).toBe("aggressive");
    expect(after(cmd, "--repaint-strength")).toBe("0.800");
  });

  it("a plain render carries no route or source", async () => {
    const cmd = await argv(modelFor("audiocpp-ace-step"), null);
    expect(cmd).not.toContain("--task-route");
    expect(cmd).not.toContain("--audio");
    expect(after(cmd, "--duration-seconds")).toBe("45.000");
  });

  it("refuses an edit the family has no route for", async () => {
    await expect(
      argv(modelFor("audiocpp-minimax-music3"), {
        kind: "extend",
        sourceAudioPath: "src.wav",
        sourceDurationS: 20,
        options: {},
      }),
    ).rejects.toThrow(ModelError);
  });
});
