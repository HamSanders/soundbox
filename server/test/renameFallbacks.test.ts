import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateLegacyStorage } from "@/lib/legacy-storage";
import { defaultDataDir } from "../src/config.js";
import { envVar } from "../src/env.js";

/**
 * The rename from Soundbox to Mirli must not strand an existing install:
 * its `SOUNDBOX_*` env vars, its `~/.soundbox` and its browser storage all
 * keep working (src/env.ts, config.defaultDataDir, app lib/legacy-storage).
 */

afterEach(() => vi.unstubAllEnvs());

describe("envVar", () => {
  it("reads the MIRLI_ name", () => {
    vi.stubEnv("MIRLI_PORT", "1234");
    expect(envVar("MIRLI_PORT")).toBe("1234");
  });

  it("falls back to the pre-rename SOUNDBOX_ name", () => {
    vi.stubEnv("SOUNDBOX_AUDIOCPP_BIN", "/old/audiocpp_cli");
    expect(envVar("MIRLI_AUDIOCPP_BIN")).toBe("/old/audiocpp_cli");
  });

  it("prefers the new name when both are set", () => {
    vi.stubEnv("SOUNDBOX_LOG_LEVEL", "debug");
    vi.stubEnv("MIRLI_LOG_LEVEL", "error");
    expect(envVar("MIRLI_LOG_LEVEL")).toBe("error");
  });

  it("is undefined when neither is set", () => {
    expect(envVar("MIRLI_NOT_A_REAL_SETTING")).toBeUndefined();
  });
});

describe("defaultDataDir", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "mirli-home-"));
    vi.stubEnv("MIRLI_DATA_DIR", "");
  });
  afterEach(() => rm(home, { recursive: true, force: true }));

  it("is ~/.mirli on a fresh machine", () => {
    expect(defaultDataDir(home)).toBe(join(home, ".mirli"));
  });

  it("keeps using ~/.soundbox from before the rename", () => {
    mkdirSync(join(home, ".soundbox"));
    expect(defaultDataDir(home)).toBe(join(home, ".soundbox"));
  });

  it("prefers ~/.mirli once it exists", () => {
    mkdirSync(join(home, ".soundbox"));
    mkdirSync(join(home, ".mirli"));
    expect(defaultDataDir(home)).toBe(join(home, ".mirli"));
  });

  it("honours MIRLI_DATA_DIR, then SOUNDBOX_DATA_DIR, over both", () => {
    mkdirSync(join(home, ".soundbox"));
    vi.stubEnv("MIRLI_DATA_DIR", undefined as unknown as string);
    vi.stubEnv("SOUNDBOX_DATA_DIR", "/legacy/data");
    expect(defaultDataDir(home)).toBe("/legacy/data");
    vi.stubEnv("MIRLI_DATA_DIR", "/new/data");
    expect(defaultDataDir(home)).toBe("/new/data");
  });
});

describe("migrateLegacyStorage", () => {
  /** Just enough of `Storage` for the migration. */
  function fakeStorage(init: Record<string, string>): Storage {
    const m = new Map(Object.entries(init));
    return {
      get length() {
        return m.size;
      },
      key: (i: number) => [...m.keys()][i] ?? null,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
    };
  }

  it("copies soundbox.* keys to mirli.* and keeps the originals", () => {
    const s = fakeStorage({ "soundbox.ui-prefs": '{"a":1}', "other.key": "x" });
    expect(migrateLegacyStorage(s)).toBe(1);
    expect(s.getItem("mirli.ui-prefs")).toBe('{"a":1}');
    expect(s.getItem("soundbox.ui-prefs")).toBe('{"a":1}');
    expect(s.getItem("mirli.key")).toBeNull();
  });

  it("never overwrites a mirli.* key that is already set", () => {
    const s = fakeStorage({ "soundbox.ui-prefs": "old", "mirli.ui-prefs": "new" });
    expect(migrateLegacyStorage(s)).toBe(0);
    expect(s.getItem("mirli.ui-prefs")).toBe("new");
  });
});
