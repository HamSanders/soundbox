import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BINARY_NAME,
  assetScore,
  companionAsset,
  status,
} from "../src/models/llamaServerBinary.js";

describe("assetScore", () => {
  it("scores a Windows CUDA asset highest on a CUDA Windows machine", () => {
    const names = [
      "llama-b4831-bin-win-cuda-12.4-x64.zip",
      "llama-b4831-bin-win-vulkan-x64.zip",
      "llama-b4831-bin-win-cpu-x64.zip",
      "llama-b4831-bin-macos-arm64.zip",
      "llama-b4831-bin-ubuntu-x64.zip",
      "cudart-llama-bin-win-cuda-12.4-x64.zip",
    ];
    const scored = names.map((n) => ({ n, s: assetScore(n, "win", "cuda", "x64") }));
    const best = scored.reduce((a, b) => (b.s > a.s ? b : a));
    expect(best.n).toBe("llama-b4831-bin-win-cuda-12.4-x64.zip");
  });

  it("scores vulkan highest when the backend is vulkan", () => {
    const scored = [
      "llama-b4831-bin-win-cuda-12.4-x64.zip",
      "llama-b4831-bin-win-vulkan-x64.zip",
      "llama-b4831-bin-win-cpu-x64.zip",
    ].map((n) => ({ n, s: assetScore(n, "win", "vulkan", "x64") }));
    const best = scored.reduce((a, b) => (b.s > a.s ? b : a));
    expect(best.n).toBe("llama-b4831-bin-win-vulkan-x64.zip");
  });

  it("rejects the wrong platform outright", () => {
    expect(assetScore("llama-b4831-bin-macos-arm64.zip", "win", "cpu", "x64")).toBe(0);
    expect(assetScore("llama-b4831-bin-ubuntu-x64.zip", "win", "cpu", "x64")).toBe(0);
  });

  it("never scores a cudart runtime-only package as a primary asset", () => {
    expect(assetScore("cudart-llama-bin-win-cuda-12.4-x64.zip", "win", "cuda", "x64")).toBe(0);
  });

  it("picks the arm64 macOS asset over x64 on an arm64 mac", () => {
    const scored = [
      "llama-b4831-bin-macos-arm64.zip",
      "llama-b4831-bin-macos-x64.zip",
    ].map((n) => ({ n, s: assetScore(n, "macos", "metal", "arm64") }));
    const best = scored.reduce((a, b) => (b.s > a.s ? b : a));
    expect(best.n).toBe("llama-b4831-bin-macos-arm64.zip");
  });

  it("scores the ubuntu asset for a linux CPU machine", () => {
    expect(assetScore("llama-b4831-bin-ubuntu-x64.zip", "ubuntu", "cpu", "x64")).toBeGreaterThan(0);
    expect(assetScore("llama-b4831-bin-win-cpu-x64.zip", "ubuntu", "cpu", "x64")).toBe(0);
  });
});

describe("companionAsset", () => {
  const release = {
    tag_name: "b4831",
    assets: [
      { name: "llama-b4831-bin-win-cuda-12.4-x64.zip", browser_download_url: "https://x/1" },
      { name: "cudart-llama-bin-win-cuda-12.4-x64.zip", browser_download_url: "https://x/2" },
      { name: "llama-b4831-bin-win-vulkan-x64.zip", browser_download_url: "https://x/3" },
    ],
  };

  it("finds the cudart companion for a CUDA primary asset", () => {
    const primary = release.assets[0]!;
    const companion = companionAsset(release, primary);
    expect(companion?.name).toBe("cudart-llama-bin-win-cuda-12.4-x64.zip");
  });

  it("returns null for a non-CUDA primary asset", () => {
    const primary = release.assets[2]!;
    expect(companionAsset(release, primary)).toBeNull();
  });
});

/**
 * The bring-your-own-binary route. Only the env case is asserted: with no
 * override, `status()` legitimately depends on what the machine running the
 * suite has installed, and a test that fails on a developer who happens to
 * have llama.cpp on PATH would be testing the wrong thing.
 */
describe("status with a user-supplied binary", () => {
  let tmp: string;
  const previous = process.env.KONCHI_LLAMA_SERVER_BIN;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "konchi-llama-bin-"));
  });

  afterAll(async () => {
    if (previous === undefined) delete process.env.KONCHI_LLAMA_SERVER_BIN;
    else process.env.KONCHI_LLAMA_SERVER_BIN = previous;
    await rm(tmp, { recursive: true, force: true });
  });

  it("reports an env-supplied binary as installed, with no invented version", async () => {
    const fake = join(tmp, BINARY_NAME);
    await writeFile(fake, "");
    process.env.KONCHI_LLAMA_SERVER_BIN = fake;

    const s = await status();
    expect(s.installed).toBe(true);
    expect(s.source).toBe("env");
    expect(s.path).toBe(fake);
    expect(s.version).toBeNull();
  });

  it("reports nothing installed when the override points at a missing file", async () => {
    process.env.KONCHI_LLAMA_SERVER_BIN = join(tmp, "not-there");
    const s = await status();
    expect(s.installed).toBe(false);
    expect(s.source).toBeNull();
  });
});
