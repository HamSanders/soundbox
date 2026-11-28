import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ESPEAK_DATA_ENV,
  ESPEAK_LIBRARY_ENV,
  explainEspeakFailure,
  findEspeak,
  withEspeakEnv,
} from "../src/models/espeak.js";

const PF = "C:\\Program Files";
const DIR = join(PF, "eSpeak NG");
const LIB = join(DIR, "libespeak-ng.dll");
const DATA = join(DIR, "espeak-ng-data");
const installed = (path: string): boolean => path === LIB || path === join(DATA, "phontab");
const nothing = (): boolean => false;

describe("findEspeak", () => {
  it("finds the default Windows install", () => {
    expect(findEspeak({ ProgramFiles: PF }, "win32", installed)).toEqual({
      library: LIB,
      data: DATA,
    });
  });

  it("wants the data folder as well as the DLL", () => {
    expect(findEspeak({ ProgramFiles: PF }, "win32", (p) => p === LIB)).toBeNull();
  });

  it("returns null when nothing is installed", () => {
    expect(findEspeak({ ProgramFiles: PF }, "win32", nothing)).toBeNull();
  });

  it("leaves macOS and Linux to audio.cpp's own search", () => {
    expect(findEspeak({ ProgramFiles: PF }, "linux", installed)).toBeNull();
    expect(findEspeak({ ProgramFiles: PF }, "darwin", installed)).toBeNull();
  });
});

describe("withEspeakEnv", () => {
  it("adds both variables when an install is found", () => {
    const env = withEspeakEnv({ ProgramFiles: PF, PATH: "x" }, "win32", installed);
    expect(env[ESPEAK_LIBRARY_ENV]).toBe(LIB);
    expect(env[ESPEAK_DATA_ENV]).toBe(DATA);
    expect(env.PATH).toBe("x");
  });

  it("does not override a library the user set", () => {
    const base = { ProgramFiles: PF, [ESPEAK_LIBRARY_ENV]: "D:\\mine\\espeak.dll" };
    expect(withEspeakEnv(base, "win32", installed)).toBe(base);
  });

  it("keeps a data path the user set", () => {
    const env = withEspeakEnv(
      { ProgramFiles: PF, [ESPEAK_DATA_ENV]: "D:\\data" },
      "win32",
      installed,
    );
    expect(env[ESPEAK_LIBRARY_ENV]).toBe(LIB);
    expect(env[ESPEAK_DATA_ENV]).toBe("D:\\data");
  });

  it("returns the environment unchanged when nothing is found", () => {
    const base = { ProgramFiles: PF };
    expect(withEspeakEnv(base, "win32", nothing)).toBe(base);
  });
});

describe("explainEspeakFailure", () => {
  it("explains audio.cpp's missing-library error", () => {
    const tail =
      "audiocpp_cli failed: Could not load eSpeak-ng; install the shared library or provide its path";
    const windows = explainEspeakFailure(tail, "win32");
    expect(windows).toContain("espeak-ng/releases");
    expect(windows).toContain(ESPEAK_LIBRARY_ENV);
    expect(explainEspeakFailure(tail, "darwin")).toContain("brew install espeak-ng");
    expect(explainEspeakFailure(tail, "linux")).toContain("apt install espeak-ng");
  });

  it("explains a broken data folder", () => {
    expect(
      explainEspeakFailure("eSpeak-ng failed to initialize; check its data directory", "win32"),
    ).not.toBeNull();
  });

  it("says nothing about unrelated failures", () => {
    expect(explainEspeakFailure("CUDA error: out of memory", "win32")).toBeNull();
  });
});
