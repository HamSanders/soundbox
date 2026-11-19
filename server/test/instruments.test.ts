import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import type { downloadToFile } from "../src/download.js";
import { InstrumentLibrary, sampleUrl } from "../src/instruments/index.js";
import { parseSfz } from "../src/instruments/sfz.js";
import { VSCO2CE_COMMIT, VSCO2CE_INSTRUMENTS } from "../src/instruments/vsco2ce.js";

/**
 * Sampled instruments for the MIDI dry render.
 *
 * The fixture is VSCO 2 CE's own ClarinetSus.sfz (CC0), so the parser is
 * tested on the file it has to read rather than on a hand-written stand-in.
 * Nothing downloads: the install runs against a fake fetch that writes the
 * fixture for the .sfz and zero-filled files of the manifest's size for the
 * samples.
 */

const here = dirname(fileURLToPath(import.meta.url));
const CLARINET_SFZ = readFileSync(join(here, "fixtures", "vsco2ce", "ClarinetSus.sfz"), "utf-8");

describe("parseSfz", () => {
  it("reads VSCO's clarinet into regions with its default_path applied", () => {
    const { regions, ignored } = parseSfz(CLARINET_SFZ);
    expect(regions).toHaveLength(33);
    expect(regions[0]).toEqual({
      sample: "Woodwinds/Clarinet/susLong/DCClar_susLong_A#2_v1_rr1_sum.wav",
      lokey: 56,
      hikey: 59,
      pitchKeycenter: 58,
      lovel: 0,
      hivel: 41,
      volume: 20,
      tune: 0,
      ampegAttack: 0.001,
      ampegRelease: 0.7,
    });
    // The opcodes the library uses that change nothing offline — and nothing
    // else. A new opcode turning up here means the player is missing it.
    expect(ignored).toEqual(["ampeg_dynamic", "group_label", "seq_length", "seq_position"]);
  });

  it("names every sample the manifest downloads, and nothing it doesn't", () => {
    const { regions } = parseSfz(CLARINET_SFZ);
    const clarinet = VSCO2CE_INSTRUMENTS.find((i) => i.id === "clarinet")!;
    const wavs = clarinet.files.slice(1).map(([p]) => p);
    expect(new Set(regions.map((r) => r.sample))).toEqual(new Set(wavs));
  });

  it("lets a region override its group, and keeps values with spaces", () => {
    const { regions } = parseSfz(
      [
        "<control> default_path=Strings\\Solo Violin\\",
        "<global> ampeg_release=0.8 // a comment",
        "<group> volume=3 tune=-20",
        "<region> sample=a b.wav lokey=60 hikey=62 pitch_keycenter=61",
        "<region> sample=c.wav volume=6",
      ].join("\n"),
    );
    expect(regions.map((r) => [r.sample, r.volume, r.tune, r.ampegRelease])).toEqual([
      ["Strings/Solo Violin/a b.wav", 3, -20, 0.8],
      ["Strings/Solo Violin/c.wav", 6, -20, 0.8],
    ]);
    expect(regions[1]!.lokey).toBe(0);
    expect(regions[1]!.pitchKeycenter).toBe(60);
  });
});

describe("the VSCO 2 CE manifest", () => {
  it("pins downloads to one commit and encodes # and spaces", () => {
    expect(sampleUrl("Woodwinds/Clarinet/susLong/DCClar_susLong_A#2_v1_rr1_sum.wav")).toBe(
      `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/${VSCO2CE_COMMIT}/Woodwinds/Clarinet/susLong/DCClar_susLong_A%232_v1_rr1_sum.wav`,
    );
    expect(sampleUrl("Strings/Solo Violin/x.wav")).toContain("/Strings/Solo%20Violin/x.wav");
  });

  it("lists each instrument's .sfz first and keeps every instrument small", () => {
    for (const inst of VSCO2CE_INSTRUMENTS) {
      expect(inst.files[0]![0]).toBe(inst.sfz);
      const bytes = inst.files.reduce((sum, [, b]) => sum + b, 0);
      // The point of a curated subset: no single download near the library's 2.3 GB.
      expect(bytes).toBeLessThan(100e6);
    }
  });
});

describe("installing and serving an instrument", () => {
  let dataDir: string;
  let config: Config;
  let app: FastifyInstance;
  let lib: InstrumentLibrary;
  const fetched: string[] = [];

  const fakeFetch = (async (url: string, dest: string, opts?: { expectedBytes?: number }) => {
    fetched.push(url);
    await mkdir(dirname(dest), { recursive: true });
    if (url.endsWith("ClarinetSus.sfz")) await writeFile(dest, CLARINET_SFZ, "utf-8");
    else await writeFile(dest, Buffer.alloc(opts?.expectedBytes ?? 0));
    return { bytes: opts?.expectedBytes ?? 0, sha256: "" };
  }) as unknown as typeof downloadToFile;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "soundbox-instruments-"));
    config = new Config(dataDir);
    app = buildApp(config, { serveUi: false });
    await app.ready();
    lib = new InstrumentLibrary(() => config.paths.models);
  });

  afterAll(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("lists every instrument as not installed at first", async () => {
    const res = await app.inject({ method: "GET", url: "/api/instruments" });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { id: string; installed: boolean; license: string }[];
    expect(rows.map((r) => r.id)).toEqual(VSCO2CE_INSTRUMENTS.map((i) => i.id));
    expect(rows.every((r) => !r.installed && r.license === "CC0-1.0")).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/instruments/clarinet" })).statusCode).toBe(
      404,
    );
  });

  it("refuses an unknown instrument", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/instruments/kazoo/download",
      headers: { "x-soundbox": "1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("installs, then serves regions and only the manifest's files", async () => {
    const progress: number[] = [];
    await lib.install("clarinet", (f) => progress.push(f), fakeFetch);
    expect(fetched).toHaveLength(34);
    expect(progress.at(-1)).toBe(1);

    const rows = (await app.inject({ method: "GET", url: "/api/instruments" })).json() as {
      id: string;
      installed: boolean;
    }[];
    expect(rows.find((r) => r.id === "clarinet")!.installed).toBe(true);

    const res = await app.inject({ method: "GET", url: "/api/instruments/clarinet" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { files_url: string; regions: { sample: string }[] };
    expect(body.files_url).toBe("/api/instruments/clarinet/files");
    expect(body.regions).toHaveLength(33);

    const sample = body.regions[0]!.sample;
    const url = `${body.files_url}/${sample.split("/").map(encodeURIComponent).join("/")}`;
    const wav = await app.inject({ method: "GET", url });
    expect(wav.statusCode).toBe(200);
    expect(wav.headers["content-type"]).toBe("audio/wav");

    for (const bad of [
      "..%2F..%2F..%2Fsettings.json",
      "installed.json",
      "Woodwinds%2F..%2F..%2Finstalled.json",
      "ClarinetSus.sfz.part",
    ]) {
      const r = await app.inject({ method: "GET", url: `/api/instruments/clarinet/files/${bad}` });
      // 400 when the server's own traversal guard sees the `..` first.
      expect([400, 404]).toContain(r.statusCode);
    }
  });

  it("skips files already on disk at the right size", async () => {
    fetched.length = 0;
    await lib.install("clarinet", () => {}, fakeFetch);
    // The .sfz fixture is the upstream file byte for byte, so nothing refetches.
    expect(fetched.filter((u) => u.endsWith(".wav"))).toHaveLength(0);
  });

  it("removes an instrument", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/instruments/clarinet",
      headers: { "x-soundbox": "1" },
    });
    expect(res.statusCode).toBe(204);
    expect(lib.isInstalled("clarinet")).toBe(false);
  });
});
