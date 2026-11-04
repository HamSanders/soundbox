import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AudioCppModel, catalogById } from "../src/models/audiocpp.js";

/**
 * "Incomplete" means this entry's own weights are partly on disk. It must
 * stay distinct from "not installed", and must not be triggered by another
 * entry's files in a shared package folder.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "konchi-incomplete-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function model(id: string): AudioCppModel {
  const spec = catalogById().get(id);
  if (!spec) throw new Error(`no catalog entry ${id}`);
  return new AudioCppModel(spec, join(root, "unused"), null, root);
}

/** Where `model`'s single weights file would land, relative to its folder. */
function fileTarget(m: AudioCppModel): string {
  const spec = catalogById().get(m.describe().id)!;
  const glob = spec.weights_glob[0]!;
  const prefix = spec.audiocpp_strip_prefix;
  return prefix && glob.startsWith(`${prefix}/`) ? glob.slice(prefix.length + 1) : glob;
}

describe("incomplete weights", () => {
  it("reports not_installed with no package folder", async () => {
    expect((await model("audiocpp-stable-audio-3-sfx").status()).status).toBe("not_installed");
  });

  it("reports not_installed for an empty package folder", async () => {
    const m = model("audiocpp-stable-audio-3-sfx");
    await mkdir(m.weightsDir(), { recursive: true });
    expect((await m.status()).status).toBe("not_installed");
  });

  it("reports incomplete when its own file was left as a .part", async () => {
    const m = model("audiocpp-stable-audio-3-sfx");
    const target = join(m.weightsDir(), ...fileTarget(m).split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(`${target}.part`, "x");
    expect((await m.status()).status).toBe("incomplete");
  });

  it("ignores another entry's files in a shared package folder", async () => {
    const turbo = model("audiocpp-ace-step");
    const base = model("audiocpp-ace-step-base");
    expect(turbo.weightsDir()).toBe(base.weightsDir());
    const target = join(turbo.weightsDir(), ...fileTarget(turbo).split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, "x");
    expect((await base.status()).status).toBe("not_installed");
  });
});
