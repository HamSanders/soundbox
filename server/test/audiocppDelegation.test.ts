/**
 * Delegating installs to audio.cpp's own package manager.
 *
 * The point of the delegation is that audio.cpp owns the registry: it already
 * knows every package from `model_specs`, and letting it install means the
 * result is recognisable to any other audio.cpp sharing the folder. These
 * cover the handover and — more importantly — the fallback, because a user's
 * own `audiocpp_cli` may well ship without a package manager beside it.
 *
 * A stub installer stands in for the runtime throughout: the real one spawns a
 * child process, and none of the behaviour worth testing here needs that.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AudioCppModel,
  catalogById,
  type PackageInstaller,
  type ProgressFn,
} from "../src/models/audiocpp.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "konchi-delegate-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** An installer that records what it was asked for. `handled` false is how the
 *  real runtime says "this build has no package manager". */
function stubInstaller(
  handled: boolean,
  onInstall?: (packageId: string) => void | Promise<void>,
): PackageInstaller & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async installPackage(packageId) {
      calls.push(packageId);
      await onInstall?.(packageId);
      return handled;
    },
    async deletePackage(packageId) {
      calls.push(`delete:${packageId}`);
      return handled;
    },
  };
}

function model(id: string, installer: PackageInstaller | null): AudioCppModel {
  const spec = catalogById().get(id);
  if (!spec) throw new Error(`no catalog entry ${id}`);
  return new AudioCppModel(spec, join(root, "unused"), null, root, installer);
}

describe("download delegation", () => {
  it("asks audio.cpp for the package rather than fetching it itself", async () => {
    const installer = stubInstaller(true);
    const m = model("audiocpp-stable-audio-3-sfx", installer);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await m.download();

    expect(installer.calls).toEqual(["stable_audio_3_small_sfx_q8_0"]);
    // The delegated path must not reach Hugging Face at all — that duplication
    // is the whole thing being removed.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("passes the package id audio.cpp knows, not the Konchi model id", async () => {
    const installer = stubInstaller(true);
    await model("audiocpp-ace-step", installer).download();
    expect(installer.calls).toEqual(["ace_step_turbo_q8_0"]);
  });

  it("reports completion through the progress callback", async () => {
    const seen: [number, string][] = [];
    const progress: ProgressFn = (f, m) => seen.push([f, m ?? ""]);

    await model("audiocpp-stable-audio-3-sfx", stubInstaller(true)).download(progress);

    expect(seen.at(-1)?.[0]).toBe(1.0);
    expect(seen.at(0)?.[1]).toMatch(/audio\.cpp/i);
  });

  it("falls back to its own downloader when the runtime has no package manager", async () => {
    const installer = stubInstaller(false);
    const m = model("audiocpp-stable-audio-3-sfx", installer);
    // Fail the fallback fast: we only care that it was *attempted*.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network disabled in test"));

    await expect(m.download()).rejects.toThrow();

    expect(installer.calls).toEqual(["stable_audio_3_small_sfx_q8_0"]);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("uses its own downloader when no runtime is wired up at all", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network disabled in test"));

    await expect(model("audiocpp-stable-audio-3-sfx", null).download()).rejects.toThrow();

    expect(fetchSpy).toHaveBeenCalled();
  });

  it("propagates a runtime failure instead of quietly re-downloading", async () => {
    // Once delegation is the path taken, a failure there is the answer. Falling
    // back would just fetch the same broken package a second time.
    const installer = stubInstaller(true, () => {
      throw new Error("audio.cpp could not install stable_audio_3_small_sfx_q8_0: disk full");
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(model("audiocpp-stable-audio-3-sfx", installer).download()).rejects.toThrow(
      /disk full/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never delegates a bring-your-own model", async () => {
    // A custom entry names weights the user already has; there is no upstream
    // package to install and nothing to download.
    const spec = {
      ...catalogById().get("audiocpp-stable-audio-3-sfx")!,
      id: "mine",
      weights_path: join(root, "nope.gguf"),
      audiocpp_package_id: null,
      audiocpp_target_dir: null,
    };
    const installer = stubInstaller(true);
    const m = new AudioCppModel(spec, join(root, "unused"), null, root, installer);

    await expect(m.download()).rejects.toThrow(/not a file/);
    expect(installer.calls).toEqual([]);
  });
});
