/**
 * The audiobook MCP tools, over an in-memory MCP client against a temp data
 * directory. They call the audiobook HTTP API in-process; these tests cover
 * the parts that exist without the import, voice and export areas, and the
 * guards that run before any route is called.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

import { buildApp } from "../src/app.js";
import { readWav, writeWav } from "../src/audio/dsp.js";
import { audiobookExports } from "../src/audiobook/export.js";
import { audiobooks } from "../src/audiobook/service.js";
import { Config } from "../src/config.js";
import { call as routeCall } from "../src/mcp/audiobook.js";
import { MCP_TOOLS, buildMcp } from "../src/mcp/server.js";
import type { Sound } from "../src/schemas.js";
import type { MirliService } from "../src/service.js";

let app: FastifyInstance;
let svc: MirliService;
let client: Client;
let dataDir: string;

async function tool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = res.content.map((c) => c.text).join("");
  if (res.isError) throw new Error(text);
  return JSON.parse(text);
}

function fakeSound(duration: number): string {
  const id = randomUUID();
  svc.db.insertSound(
    {
      id,
      created_at: new Date().toISOString(),
      model: "test",
      prompt: "",
      duration_s: duration,
      sample_rate: 24000,
      channels: 1,
      file: "",
      peaks: [],
      favorite: false,
      tags: [],
      name: "bed",
      size_bytes: 0,
      source: "api",
    } as Sound,
    `${id}.wav`,
  );
  return id;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-audiobook-mcp-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
  svc = (app as unknown as { soundbox: MirliService }).soundbox;
  const server = buildMcp(() => svc);
  client = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterAll(async () => {
  await audiobookExports(svc).idle();
  await client.close();
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

/** A real WAV in the library: a quiet tone, or `amp` 0 for silence. */
function wavSound(seconds: number, hz: number, amp: number): string {
  const rate = 24000;
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  const id = randomUUID();
  writeWav(join(svc.config.paths.sounds, `${id}.wav`), [out], rate);
  svc.db.insertSound(
    {
      id,
      created_at: new Date().toISOString(),
      model: "test",
      prompt: "",
      duration_s: seconds,
      sample_rate: rate,
      channels: 1,
      file: "",
      peaks: [],
      favorite: false,
      tags: [],
      name: "wav",
      size_bytes: 0,
      source: "api",
    } as Sound,
    `${id}.wav`,
  );
  return id;
}

const AUDIOBOOK_TOOLS = [
  "soundbox.create_audiobook",
  "soundbox.import_manuscript",
  "soundbox.list_audiobooks",
  "soundbox.get_audiobook",
  "soundbox.set_character_voice",
  "soundbox.add_pronunciation",
  "soundbox.render_audiobook",
  "soundbox.master_and_export_audiobook",
  "soundbox.add_bed",
];

describe("audiobook MCP tools", () => {
  it("are in the table and registered", async () => {
    const listed = (await client.listTools()).tools.map((t) => t.name);
    for (const name of AUDIOBOOK_TOOLS) {
      expect(MCP_TOOLS.some((t) => t.name === name)).toBe(true);
      expect(listed).toContain(name);
    }
  });

  it("create, list, get, cast the narrator, and add a bed", async () => {
    const created = await tool("soundbox.create_audiobook", {
      title: "Agent Book",
      author: "A. Writer",
      cast_mode: "multi",
    });
    expect(created.title).toBe("Agent Book");
    expect(created.settings.cast_mode).toBe("multi");
    expect(created.chapters).toHaveLength(1);
    expect(created.open_in_app).toContain(`/audiobooks/${created.book_id}`);

    const { books } = await tool("soundbox.list_audiobooks");
    expect(books.some((b: any) => b.book_id === created.book_id)).toBe(true);

    const chapterId = created.chapters[0].chapter_id;
    await app.inject({
      method: "POST",
      url: `/api/audiobooks/${created.book_id}/chapters/${chapterId}/paragraphs`,
      headers: { "x-soundbox": "1" },
      payload: { text: "It was a quiet night." },
    });
    const got = await tool("soundbox.get_audiobook", { book_id: created.book_id, chapter_id: chapterId });
    expect(got.total_paragraphs).toBeGreaterThan(0);
    expect(got.paragraphs.some((p: any) => p.text === "It was a quiet night.")).toBe(true);
    const p = got.paragraphs.find((x: any) => x.text === "It was a quiet night.");
    svc.updateSegment(p.paragraph_id, { sound_id: fakeSound(12), start_s: 0, duration_s: 12 });

    const voiceId = randomUUID();
    svc.db.createVoice(
      { id: voiceId, name: "Reader", kind: "builtin", created_at: new Date().toISOString(), voice_id: "reader", model_id: "test" },
      null,
    );
    const cast = await tool("soundbox.set_character_voice", {
      book_id: created.book_id,
      character: "Narrator",
      voice_id: voiceId,
    });
    expect(cast.book.settings.narrator_voice_id).toBe(voiceId);

    const bed = await tool("soundbox.add_bed", {
      book_id: created.book_id,
      chapter_id: chapterId,
      kind: "ambience",
      sound_id: fakeSound(5),
      duck_db: 8,
    });
    expect(bed.bed.status).toBe("ready");
    expect(bed.bed.duck.depth_db).toBe(8);
    expect(bed.clips).toBeGreaterThan(1);
    expect(bed.open_in_studio).toContain("/studio/script/");

    // The bed does not show up as a paragraph.
    const after = await tool("soundbox.get_audiobook", { book_id: created.book_id, chapter_id: chapterId });
    expect(after.total_paragraphs).toBe(got.total_paragraphs);
  });

  it("imports a manuscript file and pasted text through the real import routes", async () => {
    const file = join(dataDir, "lighthouse.md");
    await writeFile(
      file,
      [
        "# The Lighthouse",
        "## Chapter One",
        "The lamp turned all night.",
        "Nobody answered.",
        "## Chapter Two",
        "Morning came.",
      ].join("\n\n"),
    );
    const fromFile = await tool("soundbox.import_manuscript", { path: file, author: "A. Writer", cast_mode: "multi" });
    expect(fromFile.author).toBe("A. Writer");
    expect(fromFile.settings.cast_mode).toBe("multi");
    expect(fromFile.chapters.length).toBeGreaterThanOrEqual(2);
    expect(fromFile.chapters.map((c: any) => c.title)).toEqual(expect.arrayContaining(["Chapter One", "Chapter Two"]));
    expect(Array.isArray(fromFile.warnings)).toBe(true);

    const pasted = await tool("soundbox.import_manuscript", {
      text: ["Chapter 1", "It was dark.", "Chapter 2", "It was light."].join("\n\n"),
      title: "Pasted Book",
    });
    expect(pasted.title).toBe("Pasted Book");
    expect(pasted.chapters.length).toBeGreaterThanOrEqual(1);
    const got = await tool("soundbox.get_audiobook", { book_id: pasted.book_id, chapter_id: pasted.chapters[0].chapter_id });
    expect(got.paragraphs.some((p: any) => /dark/.test(p.text))).toBe(true);
  });

  it("refuses manuscript paths it should not read, before calling the importer", async () => {
    await expect(tool("soundbox.import_manuscript", { path: "relative/book.epub" })).rejects.toThrow(/absolute/);
    await expect(tool("soundbox.import_manuscript", { path: join(dataDir, "secrets.json") })).rejects.toThrow(
      /imports/,
    );
    await expect(tool("soundbox.import_manuscript", { path: join(dataDir, "missing.txt") })).rejects.toThrow(
      /No file/,
    );
    await expect(tool("soundbox.import_manuscript", { text: "a", url: "https://example.com/" })).rejects.toThrow(
      /exactly one/,
    );
  });

  it("says plainly when a route is missing", async () => {
    await expect(routeCall(svc, "GET", "/api/audiobooks/x/not-a-route")).rejects.toThrow(
      /not available in this version/,
    );
    await expect(routeCall(svc, "GET", "/api/audiobooks/nope")).rejects.toThrow(/Book not found/);
  });

  it("masters and exports through the real export routes, with the bed mixed in", async () => {
    const created = await tool("soundbox.create_audiobook", { title: "Export Book" });
    const chapterId = created.chapters[0].chapter_id;
    for (const text of ["First line.", "Second line."]) {
      await app.inject({
        method: "POST",
        url: `/api/audiobooks/${created.book_id}/chapters/${chapterId}/paragraphs`,
        headers: { "x-soundbox": "1" },
        payload: { text },
      });
    }
    const ps = audiobooks(svc).getParagraphs(chapterId)!.filter((p) => p.kind === "line" && p.text.trim());
    ps.forEach((p, i) => svc.updateSegment(p.id, { sound_id: wavSound(4, 220, 0.1), start_s: i * 4.5, duration_s: 4 }));
    const bed = await tool("soundbox.add_bed", {
      book_id: created.book_id,
      chapter_id: chapterId,
      kind: "ambience",
      sound_id: wavSound(3, 90, 0.05),
    });
    expect(bed.bed.status).toBe("ready");

    const out = await tool("soundbox.master_and_export_audiobook", {
      book_id: created.book_id,
      format: "wav",
      layout: "single",
      mastering: "none",
      include_cover: false,
    });
    expect(out.status).toBe("done");
    expect(out.request).toMatchObject({ format: "wav", layout: "single", include_beds: true });
    expect(existsSync(out.path)).toBe(true);
    expect(out.download_url).toContain(`/exports/${out.export_id}/download`);
    expect(out.bed_warnings.length).toBeGreaterThan(0);
    expect(Array.isArray(out.qc_failures)).toBe(true);

    const dl = await app.inject({ method: "GET", url: `/api/audiobooks/${created.book_id}/exports/${out.export_id}/download` });
    expect(dl.statusCode).toBe(200);

    // The same export without beds: the gap between paragraphs is quieter.
    const dry = await tool("soundbox.master_and_export_audiobook", {
      book_id: created.book_id,
      format: "wav",
      layout: "single",
      mastering: "none",
      include_cover: false,
      include_beds: false,
    });
    expect(dry.request.include_beds).toBe(false);
    expect(dry.bed_warnings).toEqual([]);
    const gapEnergy = (path: string) => {
      const { audio, sampleRate } = readWav(path);
      let peak = 0;
      // Narration ends at 8.5 s; the bed (3 s long, looped over 8.5 s) is the
      // only thing in the gap at 4.0–4.5 s.
      for (let i = Math.round(4.1 * sampleRate); i < Math.round(4.4 * sampleRate); i++) {
        peak = Math.max(peak, Math.abs(audio[0]![i] ?? 0));
      }
      return peak;
    };
    expect(gapEnergy(out.path)).toBeGreaterThan(gapEnergy(dry.path));
  });
});
