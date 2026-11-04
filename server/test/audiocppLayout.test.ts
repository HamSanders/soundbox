/**
 * The on-disk layout Konchi shares with a standalone audio.cpp.
 *
 * These cover the change that made sharing possible at all: weights used to
 * live one level deeper, under Konchi's own model id, where audio.cpp never
 * looked. The migration below is the reason nobody has to re-download because
 * of it, so it gets the most attention.
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AudioCppModel, catalog, catalogById, modelSpecs } from "../src/models/audiocpp.js";
import { migrateLayout } from "../src/models/audiocppMigrate.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "konchi-layout-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A model built against `root` as its audio.cpp packages folder. */
function model(id: string): AudioCppModel {
  const spec = catalogById().get(id);
  if (!spec) throw new Error(`no catalog entry ${id}`);
  return new AudioCppModel(spec, join(root, "unused"), null, root);
}

async function writeFileAt(path: string, contents = "x"): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents);
}

describe("catalog layout fields", () => {
  it("gives every built-in entry an audio.cpp package id and target directory", () => {
    const entries = catalog().filter((s) => s.source === "builtin");
    expect(entries.length).toBeGreaterThan(40);
    for (const spec of entries) {
      expect(spec.audiocpp_package_id, `${spec.id} package id`).toBeTruthy();
      expect(spec.audiocpp_target_dir, `${spec.id} target dir`).toBeTruthy();
    }
  });

  it("never maps two entries onto the same package id", () => {
    const ids = catalog()
      .filter((s) => s.audiocpp_package_id)
      .map((s) => s.audiocpp_package_id!);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts distinct entries that share a package into one directory", () => {
    // ACE-Step turbo and base are two catalog entries of one upstream package.
    // Sharing the directory is the point: it is what stops us downloading the
    // common components twice.
    const turbo = catalogById().get("audiocpp-ace-step");
    const base = catalogById().get("audiocpp-ace-step-base");
    expect(turbo?.audiocpp_target_dir).toBe("ACE-Step1.5-GGUF");
    expect(base?.audiocpp_target_dir).toBe("ACE-Step1.5-GGUF");
  });
});

describe("weightsDir", () => {
  it("uses audio.cpp's target directory, not the Konchi model id", () => {
    expect(model("audiocpp-stable-audio-3-sfx").weightsDir()).toBe(
      join(root, "Stable-Audio-3-Small-SFX-GGUF"),
    );
  });

  it("handles a multi-segment target directory", () => {
    expect(model("audiocpp-pocket-tts").weightsDir()).toBe(
      join(root, "PocketTTS-GGUF", "english"),
    );
  });
});

describe("weightsFile", () => {
  it("finds a package stored the way audio.cpp stores it", async () => {
    // Repo path is Stable-Audio-3-Small-SFX-GGUF/…q8_0.gguf; on disk the
    // prefix is stripped, so the file sits directly in the target directory.
    await writeFileAt(
      join(root, "Stable-Audio-3-Small-SFX-GGUF", "stable-audio-3-small-sfx-q8_0.gguf"),
    );
    expect(await model("audiocpp-stable-audio-3-sfx").isDownloaded()).toBe(true);
  });

  it("does not find one left in the old nested layout", async () => {
    await writeFileAt(
      join(
        root,
        "audiocpp-stable-audio-3-sfx",
        "Stable-Audio-3-Small-SFX-GGUF",
        "stable-audio-3-small-sfx-q8_0.gguf",
      ),
    );
    expect(await model("audiocpp-stable-audio-3-sfx").isDownloaded()).toBe(false);
  });

  it("keeps a subdirectory below the stripped prefix", async () => {
    // ACE-Step's file is ACE-Step1.5-GGUF/turbo/…; only the first segment is
    // the prefix, so `turbo/` has to survive.
    await writeFileAt(
      join(root, "ACE-Step1.5-GGUF", "turbo", "ace-step-1.5-turbo-q8_0.gguf"),
    );
    const found = await model("audiocpp-ace-step").weightsFile();
    expect(found).toBe(join(root, "ACE-Step1.5-GGUF", "turbo", "ace-step-1.5-turbo-q8_0.gguf"));
  });
});

describe("migrateLayout", () => {
  const specs = () => catalog();

  it("moves a prefixed package up out of the legacy folder", async () => {
    const legacy = join(
      root,
      "audiocpp-stable-audio-3-sfx",
      "Stable-Audio-3-Small-SFX-GGUF",
      "stable-audio-3-small-sfx-q8_0.gguf",
    );
    await writeFileAt(legacy, "weights");

    const result = await migrateLayout(root, specs());

    expect(result.moved).toContain("audiocpp-stable-audio-3-sfx");
    expect(result.failed).toEqual([]);
    const moved = join(root, "Stable-Audio-3-Small-SFX-GGUF", "stable-audio-3-small-sfx-q8_0.gguf");
    expect(await readFile(moved, "utf-8")).toBe("weights");
    // The husk is gone, not left behind to confuse the next scan.
    expect(existsSync(join(root, "audiocpp-stable-audio-3-sfx"))).toBe(false);
  });

  it("makes previously-invisible weights readable again", async () => {
    await writeFileAt(
      join(
        root,
        "audiocpp-stable-audio-3-sfx",
        "Stable-Audio-3-Small-SFX-GGUF",
        "stable-audio-3-small-sfx-q8_0.gguf",
      ),
    );
    expect(await model("audiocpp-stable-audio-3-sfx").isDownloaded()).toBe(false);
    await migrateLayout(root, specs());
    expect(await model("audiocpp-stable-audio-3-sfx").isDownloaded()).toBe(true);
  });

  it("moves a package that has no prefix to strip", async () => {
    // minimax_music3 ships its files bare in a dedicated repo, so the legacy
    // folder *is* the package and moves whole.
    await writeFileAt(join(root, "audiocpp-minimax-music3", "config.json"), "{}");
    await writeFileAt(join(root, "audiocpp-minimax-music3", "vocoder.gguf"));

    const result = await migrateLayout(root, specs());

    expect(result.moved).toContain("audiocpp-minimax-music3");
    expect(await readFile(join(root, "MiniMax-Music3-GGUF", "config.json"), "utf-8")).toBe("{}");
    expect(existsSync(join(root, "MiniMax-Music3-GGUF", "vocoder.gguf"))).toBe(true);
  });

  it("merges two legacy folders that share one package directory", async () => {
    await writeFileAt(
      join(root, "audiocpp-ace-step", "ACE-Step1.5-GGUF", "turbo", "ace-step-1.5-turbo-q8_0.gguf"),
      "turbo",
    );
    await writeFileAt(
      join(root, "audiocpp-ace-step-base", "ACE-Step1.5-GGUF", "base", "ace-step-1.5-base-q8_0.gguf"),
      "base",
    );

    const result = await migrateLayout(root, specs());

    expect(result.failed).toEqual([]);
    const dir = join(root, "ACE-Step1.5-GGUF");
    expect(await readFile(join(dir, "turbo", "ace-step-1.5-turbo-q8_0.gguf"), "utf-8")).toBe("turbo");
    expect(await readFile(join(dir, "base", "ace-step-1.5-base-q8_0.gguf"), "utf-8")).toBe("base");
    expect(existsSync(join(root, "audiocpp-ace-step"))).toBe(false);
    expect(existsSync(join(root, "audiocpp-ace-step-base"))).toBe(false);
  });

  it("is idempotent", async () => {
    await writeFileAt(
      join(
        root,
        "audiocpp-stable-audio-3-sfx",
        "Stable-Audio-3-Small-SFX-GGUF",
        "stable-audio-3-small-sfx-q8_0.gguf",
      ),
      "weights",
    );
    await migrateLayout(root, specs());
    const second = await migrateLayout(root, specs());

    expect(second.moved).toEqual([]);
    expect(second.failed).toEqual([]);
    const moved = join(root, "Stable-Audio-3-Small-SFX-GGUF", "stable-audio-3-small-sfx-q8_0.gguf");
    expect(await readFile(moved, "utf-8")).toBe("weights");
  });

  it("prefers the destination when the same file exists in both layouts", async () => {
    const rel = join("Stable-Audio-3-Small-SFX-GGUF", "stable-audio-3-small-sfx-q8_0.gguf");
    await writeFileAt(join(root, "audiocpp-stable-audio-3-sfx", rel), "old");
    await writeFileAt(join(root, rel), "already-installed");

    await migrateLayout(root, specs());

    // The copy audio.cpp itself would have written wins; we do not clobber a
    // real install with a stale one.
    expect(await readFile(join(root, rel), "utf-8")).toBe("already-installed");
  });

  it("leaves directories it does not recognise alone", async () => {
    await writeFileAt(join(root, "something-else", "file.bin"));
    await migrateLayout(root, specs());
    expect(existsSync(join(root, "something-else", "file.bin"))).toBe(true);
  });

  it("does nothing when the models root does not exist", async () => {
    const result = await migrateLayout(join(root, "nope"), specs());
    expect(result).toEqual({ moved: [], skipped: [], failed: [] });
  });

  it("does not touch a bring-your-own model's weights", async () => {
    // Custom entries point at paths the user owns; moving those would be
    // rearranging somebody else's disk.
    const specsWithPath = modelSpecs(new Set()).filter((s) => s.weights_path);
    for (const spec of specsWithPath) {
      expect(spec.audiocpp_target_dir).toBeNull();
    }
  });
});
