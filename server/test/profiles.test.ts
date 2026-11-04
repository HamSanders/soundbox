import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Config } from "../src/config.js";
import {
  DEFAULT_PROFILE_ID,
  profileRoot,
  readRegistry,
  slugify,
  uniqueId,
  writeRegistry,
} from "../src/profiles.js";

/**
 * Profiles: several libraries in one install (`src/profiles.ts`).
 *
 * These cover the config half — the directory layout and the registry — not
 * the live switch, which needs a database and the model manager. The layout is
 * the part with a backwards-compatibility promise attached: the default
 * profile *is* the data directory, and the weights never move.
 */

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "konchi-profiles-"));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("ids", () => {
  it("slugifies a display name into something usable as a directory", () => {
    expect(slugify("Demo Library")).toBe("demo-library");
    expect(slugify("  STG!! ")).toBe("stg");
    expect(slugify("日本語")).toBe("profile");
  });

  it("numbers a collision rather than overwriting the profile that has it", () => {
    expect(uniqueId("Demo", ["demo"])).toBe("demo-2");
    expect(uniqueId("Demo", ["demo", "demo-2"])).toBe("demo-3");
  });

  it("never hands out the default id, which owns the data directory itself", () => {
    expect(uniqueId("Default", [])).toBe("default-2");
  });
});

describe("registry", () => {
  it("reports the default profile before anything has been created", () => {
    const registry = readRegistry(base);
    expect(registry.active).toBe(DEFAULT_PROFILE_ID);
    expect(registry.profiles.map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID]);
  });

  it("falls back to default when the active id names a profile that is gone", () => {
    writeRegistry(base, {
      active: "deleted-somehow",
      profiles: [{ id: "demo", name: "Demo", created_at: "" }],
    });
    expect(readRegistry(base).active).toBe(DEFAULT_PROFILE_ID);
  });

  it("survives a corrupt file rather than stopping the server from starting", async () => {
    await writeFile(join(base, "profiles.json"), "{ not json", "utf-8");
    expect(readRegistry(base).profiles.map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID]);
  });
});

describe("layout", () => {
  it("puts the default profile at the data directory, so an old install is untouched", () => {
    expect(profileRoot(base, DEFAULT_PROFILE_ID)).toBe(base);
    expect(profileRoot(base, "demo")).toBe(join(base, "profiles", "demo"));
  });

  it("keeps weights and runtimes shared, and the library per-profile", () => {
    writeRegistry(base, {
      active: DEFAULT_PROFILE_ID,
      profiles: [{ id: "demo", name: "Demo", created_at: "" }],
    });
    const config = new Config(base);
    const sharedModels = config.paths.models;
    const defaultDb = config.paths.db;

    config.useProfile("demo");

    // The library moved…
    expect(config.paths.root).toBe(join(base, "profiles", "demo"));
    expect(config.paths.db).not.toBe(defaultDb);
    expect(existsSync(config.paths.sounds)).toBe(true);
    // …the gigabytes did not.
    expect(config.paths.models).toBe(sharedModels);
    expect(config.paths.base).toBe(base);
  });

  it("persists the switch, so the next start opens the same profile", () => {
    writeRegistry(base, {
      active: DEFAULT_PROFILE_ID,
      profiles: [{ id: "demo", name: "Demo", created_at: "" }],
    });
    new Config(base).useProfile("demo");
    expect(new Config(base).profile).toBe("demo");
    // …and an explicit --profile still outranks it.
    expect(new Config(base, DEFAULT_PROFILE_ID).profile).toBe(DEFAULT_PROFILE_ID);
  });

  it("refuses a profile that does not exist", () => {
    expect(() => new Config(base).useProfile("nope")).toThrow(/no such profile/);
  });

  it("keeps settings separate", () => {
    writeRegistry(base, {
      active: DEFAULT_PROFILE_ID,
      profiles: [{ id: "demo", name: "Demo", created_at: "" }],
    });
    const config = new Config(base);
    config.updateSettings({ output_format: "mp3" });
    config.useProfile("demo");
    expect(config.settings.output_format).toBe("wav");
    config.useProfile(DEFAULT_PROFILE_ID);
    expect(config.settings.output_format).toBe("mp3");
  });
});
