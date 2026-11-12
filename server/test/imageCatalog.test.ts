import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Multi-file image models, and the ones you add yourself.
 *
 * `KONCHI_DATA_DIR` is set before the module loads so `customCatalogPath()`
 * resolves into a temp tree; the loader re-reads on mtime, so writing the file
 * mid-test is the point rather than a hazard.
 */

let tmp: string;
let modelsDir: string;
let customPath: string;
const previousDataDir = process.env.KONCHI_DATA_DIR;

let catalog: typeof import("../src/image/catalog.js");

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "konchi-image-catalog-"));
  modelsDir = join(tmp, "models");
  await mkdir(modelsDir, { recursive: true });
  customPath = join(modelsDir, "custom.json");
  process.env.KONCHI_DATA_DIR = tmp;
  catalog = await import("../src/image/catalog.js");
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

function captureWarnings(): string[] {
  const seen: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    seen.push(args.join(" "));
  });
  return seen;
}

async function writeCustom(models: unknown[]): Promise<void> {
  // Written alongside an audio `models` key, because both live in one file and
  // neither loader may choke on the other's.
  await writeFile(
    customPath,
    JSON.stringify({ models: [{ id: "some-audio-model" }], image_models: models }),
    "utf-8",
  );
}

describe("the shipped catalog", () => {
  it("carries SD 3.5 Medium as four files under the flags sd-server expects", () => {
    const spec = catalog.imageModelSpec("sd35-medium")!;
    expect(spec.files.map((f) => f.flag)).toEqual(["-m", "--clip_l", "--clip_g", "--t5xxl"]);
    // The fp8 T5, not the 9.8 GB fp16 — halving a text encoder that mostly
    // matters for rendering text, which cover art avoids.
    expect(spec.files[3]!.path).toContain("fp8");
  });

  it("keeps the turbo models single-file", () => {
    for (const id of ["sd-turbo", "sdxl-turbo"]) {
      expect(catalog.imageModelSpec(id)!.files).toHaveLength(1);
    }
  });

  it("totals the download across every file", () => {
    const spec = catalog.imageModelSpec("sd35-medium")!;
    expect(catalog.totalBytes(spec)).toBe(spec.files.reduce((sum, f) => sum + f.size_bytes, 0));
    expect(catalog.totalBytes(spec)).toBeGreaterThan(11_000_000_000);
  });

  it("keeps SD 3.5's sampler and CPU-offload flags with the model", () => {
    const spec = catalog.imageModelSpec("sd35-medium")!;
    expect(spec.extra_args).toContain("--clip-on-cpu");
    expect(spec.steps).toBe(28);
    expect(spec.cfg).toBe(4.5);
  });
});

describe("loadArgs", () => {
  it("emits flag/path pairs in order, then the extra flags", () => {
    const spec = catalog.imageModelSpec("sd35-medium")!;
    const args = catalog.loadArgs(modelsDir, spec);
    expect(args[0]).toBe("-m");
    expect(args[1]).toBe(join(modelsDir, "image", "sd35-medium", "sd3.5_medium.safetensors"));
    expect(args[2]).toBe("--clip_l");
    expect(args[3]).toBe(
      join(modelsDir, "image", "sd35-medium", "text_encoders", "clip_l.safetensors"),
    );
    expect(args.slice(-3)).toEqual(["--sampling-method", "euler", "--clip-on-cpu"]);
  });

  it("passes an absolute path through untouched", async () => {
    const mine = join(tmp, "my-model.safetensors");
    await writeCustom([{ id: "mine", name: "Mine", files: [{ flag: "-m", path: mine }] }]);
    const spec = catalog.imageModelSpec("mine")!;
    expect(catalog.loadArgs(modelsDir, spec)).toEqual(["-m", mine]);
  });
});

describe("readiness", () => {
  it("is not downloaded until every file is present", async () => {
    const spec = catalog.imageModelSpec("sd35-medium")!;
    const dir = join(modelsDir, "image", "sd35-medium");
    await mkdir(join(dir, "text_encoders"), { recursive: true });

    expect(await catalog.isDownloaded(modelsDir, spec)).toBe(false);
    for (const file of spec.files.slice(0, 3)) {
      await writeFile(catalog.filePath(modelsDir, spec, file), "x");
    }
    expect(await catalog.isDownloaded(modelsDir, spec)).toBe(false);
    expect(catalog.missingFiles(modelsDir, spec).map((f) => f.flag)).toEqual(["--t5xxl"]);

    await writeFile(catalog.filePath(modelsDir, spec, spec.files[3]!), "x");
    expect(await catalog.isDownloaded(modelsDir, spec)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("your own entries", () => {
  it("loads a local multi-file model", async () => {
    await writeCustom([
      {
        id: "sd35-mine",
        name: "SD 3.5 (my copy)",
        files: [
          { flag: "-m", path: join(tmp, "sd3.5.safetensors") },
          { flag: "--clip_l", path: join(tmp, "clip_l.safetensors") },
        ],
        resolution: 1024,
        steps: 28,
        cfg: 4.5,
        extra_args: ["--clip-on-cpu"],
      },
    ]);
    const spec = catalog.imageModelSpec("sd35-mine")!;
    expect(spec.source).toBe("custom");
    expect(spec.files).toHaveLength(2);
    expect(spec.extra_args).toEqual(["--clip-on-cpu"]);
    // Nothing to download — the size shown must not imply otherwise.
    expect(catalog.totalBytes(spec)).toBe(0);
  });

  it("falls back to an unspecified, non-commercial licence", async () => {
    await writeCustom([{ id: "mine", files: [{ flag: "-m", path: join(tmp, "x.safetensors") }] }]);
    expect(catalog.imageModelSpec("mine")!.license.commercial).toBe("no");
  });

  it("lets a custom entry shadow a shipped one, exactly once", async () => {
    const warnings = captureWarnings();
    await writeCustom([
      { id: "sd35-medium", name: "SD 3.5 (mine)", files: [{ flag: "-m", path: join(tmp, "x") }] },
    ]);
    const ids = catalog.imageCatalog().map((s) => s.id);
    expect(ids.filter((id) => id === "sd35-medium")).toHaveLength(1);
    expect(catalog.imageModelSpec("sd35-medium")!.name).toBe("SD 3.5 (mine)");
    expect(warnings.join("\n")).not.toContain("skipping");
  });

  it("rejects a relative path with no repo to resolve it against", async () => {
    const warnings = captureWarnings();
    await writeCustom([{ id: "mine", files: [{ flag: "-m", path: "model.safetensors" }] }]);
    expect(catalog.imageModelSpec("mine")).toBeNull();
    expect(warnings.join("\n")).toContain("relative");
  });

  it("rejects a file with no flag", async () => {
    captureWarnings();
    await writeCustom([{ id: "mine", files: [{ path: join(tmp, "x.safetensors") }] }]);
    expect(catalog.imageModelSpec("mine")).toBeNull();
  });

  it("rejects an entry with no files at all", async () => {
    captureWarnings();
    await writeCustom([{ id: "mine", name: "Mine" }]);
    expect(catalog.imageModelSpec("mine")).toBeNull();
  });

  it("ignores a malformed file rather than throwing", async () => {
    const warnings = captureWarnings();
    await writeFile(customPath, "{ not json", "utf-8");
    expect(catalog.userImageModels()).toEqual([]);
    expect(warnings.join("\n")).toContain("custom.json");
  });

  it("picks up edits without a restart", async () => {
    await writeCustom([{ id: "mine", files: [{ flag: "-m", path: join(tmp, "a") }] }]);
    expect(catalog.userImageModels()).toHaveLength(1);
    await writeCustom([
      { id: "mine", files: [{ flag: "-m", path: join(tmp, "a") }] },
      { id: "other", files: [{ flag: "-m", path: join(tmp, "b") }] },
    ]);
    expect(catalog.userImageModels().map((s) => s.id)).toEqual(["mine", "other"]);
  });
});

describe("deleteWeights", () => {
  it("refuses to delete files you supplied yourself", async () => {
    await writeCustom([{ id: "mine", files: [{ flag: "-m", path: join(tmp, "x.safetensors") }] }]);
    const spec = catalog.imageModelSpec("mine")!;
    await expect(catalog.deleteWeights(modelsDir, spec)).rejects.toThrow(/won't delete them/);
  });

  it("removes a downloaded model's own directory", async () => {
    const spec = catalog.imageModelSpec("sd-turbo")!;
    const dir = join(modelsDir, "image", "sd-turbo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "sd_turbo-f16-q8_0.gguf"), "x");
    expect(await catalog.isDownloaded(modelsDir, spec)).toBe(true);
    await catalog.deleteWeights(modelsDir, spec);
    expect(await catalog.isDownloaded(modelsDir, spec)).toBe(false);
  });
});
