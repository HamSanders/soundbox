import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The bring-your-own-model overlay: `<data dir>/models/custom.json`.
 *
 * `KONCHI_DATA_DIR` is set before the module is imported so `userCatalogPath()`
 * resolves into a temp tree — the module reads the file lazily on each call, so
 * writing it mid-test is the whole point rather than a hazard.
 */

let tmp: string;
let customPath: string;
const previousDataDir = process.env.KONCHI_DATA_DIR;

let audiocpp: typeof import("../src/models/audiocpp.js");

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "konchi-custom-catalog-"));
  await mkdir(join(tmp, "models"), { recursive: true });
  customPath = join(tmp, "models", "custom.json");
  process.env.KONCHI_DATA_DIR = tmp;
  audiocpp = await import("../src/models/audiocpp.js");
});

afterEach(async () => {
  await rm(customPath, { force: true });
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (previousDataDir === undefined) delete process.env.KONCHI_DATA_DIR;
  else process.env.KONCHI_DATA_DIR = previousDataDir;
  await rm(tmp, { recursive: true, force: true });
});

/** Silences the console.warn the skip/override paths emit, and hands back the
 *  messages so a test can assert one was written. */
function captureWarnings(): string[] {
  const seen: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    seen.push(args.join(" "));
  });
  return seen;
}

function entry(extra: Record<string, unknown> = {}) {
  return {
    id: "my-model",
    name: "My Model",
    vendor: "me",
    description: "a local gguf",
    family: "stable_audio",
    category: "sfx",
    weights_path: join(tmp, "weights.gguf"),
    max_duration_s: 30,
    sample_rate: 44100,
    channels: 2,
    vram_estimate_mb: 2000,
    ...extra,
  };
}

async function writeCatalog(models: unknown[]): Promise<void> {
  await writeFile(customPath, JSON.stringify({ models }), "utf-8");
}

describe("userModelSpecs", () => {
  it("returns nothing when the file doesn't exist", () => {
    expect(audiocpp.userModelSpecs()).toEqual([]);
  });

  it("loads an entry pointing at local weights", async () => {
    await writeCatalog([entry()]);
    const [spec, ...rest] = audiocpp.userModelSpecs();
    expect(rest).toEqual([]);
    expect(spec!.id).toBe("my-model");
    expect(spec!.weights_path).toBe(join(tmp, "weights.gguf"));
    expect(spec!.source).toBe("custom");
    expect(spec!.hf_repo).toBe("");
  });

  it("never lets a user entry call itself verified", async () => {
    await writeCatalog([entry({ verified: true })]);
    expect(audiocpp.userModelSpecs()[0]!.verified).toBe(false);
  });

  it("falls back to an unspecified, non-commercial licence", async () => {
    await writeCatalog([entry()]);
    const license = audiocpp.userModelSpecs()[0]!.license;
    expect(license.commercial).toBe("no");
    expect(license.name).toBe("Unspecified");
  });

  it("honours a licence declared inline", async () => {
    await writeCatalog([
      entry({ license: { name: "MIT", commercial: "yes", url: "https://x" } }),
    ]);
    expect(audiocpp.userModelSpecs()[0]!.license.commercial).toBe("yes");
  });

  it("picks up edits without a restart", async () => {
    await writeCatalog([entry()]);
    expect(audiocpp.userModelSpecs()).toHaveLength(1);
    await writeCatalog([entry(), entry({ id: "second", name: "Second" })]);
    expect(audiocpp.userModelSpecs().map((s) => s.id)).toEqual(["my-model", "second"]);
  });

  it("skips entries that name neither local weights nor a repo", async () => {
    const warnings = captureWarnings();
    await writeCatalog([entry({ weights_path: undefined })]);
    expect(audiocpp.userModelSpecs()).toEqual([]);
    expect(warnings.join("\n")).toContain("weights_path");
  });

  it("skips a relative weights_path", async () => {
    captureWarnings();
    await writeCatalog([entry({ weights_path: "weights.gguf" })]);
    expect(audiocpp.userModelSpecs()).toEqual([]);
  });

  it("skips a duplicate id but keeps the first", async () => {
    captureWarnings();
    await writeCatalog([entry(), entry({ name: "Shadow" })]);
    const specs = audiocpp.userModelSpecs();
    expect(specs).toHaveLength(1);
    expect(specs[0]!.name).toBe("My Model");
  });

  it("accepts an hf_repo entry with no local path", async () => {
    await writeCatalog([
      entry({ weights_path: undefined, hf_repo: "me/my-gguf", weights_glob: "*.gguf" }),
    ]);
    const spec = audiocpp.userModelSpecs()[0]!;
    expect(spec.weights_path).toBeNull();
    expect(spec.weights_glob).toEqual(["*.gguf"]);
  });

  it("ignores a malformed file rather than throwing", async () => {
    const warnings = captureWarnings();
    await writeFile(customPath, "{ not json", "utf-8");
    expect(audiocpp.userModelSpecs()).toEqual([]);
    expect(warnings.join("\n")).toContain("custom.json");
  });
});

describe("catalog composition", () => {
  it("adds user entries to modelSpecs() with no opt-in", async () => {
    await writeCatalog([entry()]);
    expect(audiocpp.modelSpecs().map((s) => s.id)).toContain("my-model");
  });

  it("lets a user entry shadow a built-in of the same id, exactly once", async () => {
    const warnings = captureWarnings();
    const builtin = audiocpp.MODELS[0]!;
    await writeCatalog([entry({ id: builtin.id, name: "Mine" })]);
    const ids = audiocpp.catalog().map((s) => s.id);
    expect(ids.filter((id) => id === builtin.id)).toHaveLength(1);
    expect(audiocpp.catalogById().get(builtin.id)!.name).toBe("Mine");
    expect(warnings.join("\n")).toContain("overrides the built-in");
  });
});

describe("weights resolution", () => {
  it("reports a local model as downloaded once the file is there", async () => {
    const weights = join(tmp, "weights.gguf");
    await writeCatalog([entry()]);
    const spec = audiocpp.userModelSpecs()[0]!;
    const model = new audiocpp.AudioCppModel(spec, join(tmp, "models"));

    expect(await model.isDownloaded()).toBe(false);
    await writeFile(weights, "gguf");
    expect(await model.weightsFile()).toBe(weights);
    expect(await model.isDownloaded()).toBe(true);
    await rm(weights, { force: true });
  });

  it("fails a download with the path to fix rather than hitting the network", async () => {
    await writeCatalog([entry({ weights_path: join(tmp, "missing.gguf") })]);
    const spec = audiocpp.userModelSpecs()[0]!;
    const model = new audiocpp.AudioCppModel(spec, join(tmp, "models"));
    await expect(model.download()).rejects.toThrow(/missing\.gguf is not a file/);
  });

  it("treats a directory-layout local model as its directory", async () => {
    const dir = join(tmp, "package");
    await mkdir(dir, { recursive: true });
    await writeCatalog([entry({ weights_path: dir, weights_layout: "directory" })]);
    const spec = audiocpp.userModelSpecs()[0]!;
    const model = new audiocpp.AudioCppModel(spec, join(tmp, "models"));
    expect(await model.weightsFile()).toBe(dir);
  });
});
