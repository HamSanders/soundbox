import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { Config } from "../src/config.js";
import { MCP_TOOLS } from "../src/mcp/server.js";

/**
 * The book-editing MCP tools: paragraphs (edit, cast, lock, split, merge,
 * find and replace) and chapters (add, edit, move, delete).
 *
 * Driven through `POST /api/agent/run`, which calls them on the app's own
 * MCP server, so each test checks the tool and the undo the assistant is
 * handed for it: run, check the book, run the undo, check it is back.
 */

let app: FastifyInstance;
let dataDir: string;
let bookId: string;
let chapterId: string;
let ids: string[];

const H = { "x-soundbox": "1" };

async function run(tool: string, args: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: "/api/agent/run", headers: H, payload: { tool, arguments: args } });
  return { status: res.statusCode, body: res.json() as { result: any; undo: { tool: string; arguments: Record<string, unknown> }[] | null; detail?: string } };
}

async function undo(calls: { tool: string; arguments: Record<string, unknown> }[] | null) {
  expect(calls).not.toBeNull();
  for (const c of calls!) expect((await run(c.tool, c.arguments)).status).toBe(200);
}

async function paragraphs(cid = chapterId): Promise<{ id: string; text: string; character_id: string | null; locked: boolean }[]> {
  return (await app.inject({ method: "GET", url: `/api/audiobooks/${bookId}/chapters/${cid}/paragraphs` })).json();
}

async function chapters(): Promise<{ id: string; title: string; included: boolean }[]> {
  return (await app.inject({ method: "GET", url: `/api/audiobooks/${bookId}` })).json().chapters;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-edit-mcp-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
  bookId = (await app.inject({ method: "POST", url: "/api/audiobooks", headers: H, payload: { title: "Rain" } })).json().id;
  chapterId = (await chapters())[0]!.id;
  for (const text of ["It was dark. However, it rained.", "Second.", "Third."]) {
    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/chapters/${chapterId}/paragraphs`,
      headers: H,
      payload: { text },
    });
    expect(res.statusCode).toBeLessThan(300);
  }
  ids = (await paragraphs()).map((p) => p.id);
  const ann = await app.inject({ method: "POST", url: `/api/audiobooks/${bookId}/characters`, headers: H, payload: { name: "Ann" } });
  expect(ann.statusCode).toBe(201);
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("book-editing MCP tools", () => {
  it("are all in the tool table", () => {
    for (const name of [
      "edit_paragraph",
      "cast_paragraphs",
      "lock_paragraphs",
      "split_paragraph",
      "merge_paragraphs",
      "find_replace",
      "add_chapter",
      "edit_chapter",
      "move_chapter",
      "delete_chapter",
    ]) {
      expect(MCP_TOOLS.some((t) => t.name === `soundbox.${name}`)).toBe(true);
    }
  });

  it("edit_paragraph changes text and reader, and undoes", async () => {
    const r = await run("soundbox.edit_paragraph", { book_id: bookId, paragraph_id: ids[1], text: "Changed.", character: "Ann" });
    expect(r.status).toBe(200);
    expect((await paragraphs())[1]).toMatchObject({ text: "Changed.", character_id: expect.any(String) });
    await undo(r.body.undo);
    expect((await paragraphs())[1]).toMatchObject({ text: "Second.", character_id: null });
  });

  it("cast_paragraphs and lock_paragraphs, and their undo", async () => {
    const cast = await run("soundbox.cast_paragraphs", { book_id: bookId, paragraph_ids: [ids[1], ids[2]], character: "ann" });
    expect(cast.body.result.changed).toBe(2);
    expect((await paragraphs()).slice(1).every((p) => p.character_id !== null)).toBe(true);
    await undo(cast.body.undo);
    expect((await paragraphs()).every((p) => p.character_id === null)).toBe(true);

    const lock = await run("soundbox.lock_paragraphs", { book_id: bookId, paragraph_ids: [ids[0]], locked: true });
    expect((await paragraphs())[0]!.locked).toBe(true);
    await undo(lock.body.undo);
    expect((await paragraphs())[0]!.locked).toBe(false);
  });

  it("refuses a character the book doesn't have, with the names it does", async () => {
    const r = await run("soundbox.cast_paragraphs", { book_id: bookId, paragraph_ids: [ids[1]], character: "Zed" });
    expect(r.status).toBe(422);
    expect(r.body.detail).toMatch(/No character 'Zed'.*Known: Ann/);
  });

  it("split_paragraph before some text, and merge undoes it; merge, and split undoes it", async () => {
    const split = await run("soundbox.split_paragraph", { book_id: bookId, paragraph_id: ids[0], before: "However" });
    expect(split.status).toBe(200);
    expect((await paragraphs()).map((p) => p.text).slice(0, 2)).toEqual(["It was dark.", "However, it rained."]);
    await undo(split.body.undo);
    expect((await paragraphs()).map((p) => p.text)).toEqual(["It was dark. However, it rained.", "Second.", "Third."]);

    const merge = await run("soundbox.merge_paragraphs", { book_id: bookId, paragraph_id: ids[1] });
    expect(merge.status).toBe(200);
    expect((await paragraphs()).map((p) => p.text)).toEqual(["It was dark. However, it rained.", "Second. Third."]);
    await undo(merge.body.undo);
    expect((await paragraphs()).map((p) => p.text)).toEqual(["It was dark. However, it rained.", "Second.", "Third."]);
    ids = (await paragraphs()).map((p) => p.id);
  });

  it("split_paragraph says what the paragraph reads when the text isn't in it", async () => {
    const r = await run("soundbox.split_paragraph", { book_id: bookId, paragraph_id: ids[0], before: "snow" });
    expect(r.status).toBe(422);
    expect(r.body.detail).toMatch(/'snow' isn't in the paragraph\. It reads: It was dark/);
  });

  it("find_replace, and its undo puts each paragraph's text back", async () => {
    const r = await run("soundbox.find_replace", { book_id: bookId, find: "rained", replace: "poured" });
    expect(r.body.result.matches).toBe(1);
    expect((await paragraphs())[0]!.text).toBe("It was dark. However, it poured.");
    await undo(r.body.undo);
    expect((await paragraphs())[0]!.text).toBe("It was dark. However, it rained.");
  });

  it("add, edit and move chapters, each undone", async () => {
    const add = await run("soundbox.add_chapter", { book_id: bookId, title: "Two", text: "One line.\n\nAnother line." });
    expect(add.status).toBe(200);
    const added = add.body.result.chapter_id as string;
    // The title becomes its heading, as "Chapter from text" does in the app.
    expect((await paragraphs(added)).map((p) => p.text)).toEqual(["Two", "One line.", "Another line."]);

    const edit = await run("soundbox.edit_chapter", { book_id: bookId, chapter_id: added, title: "The Second", included: false });
    expect((await chapters()).find((c) => c.id === added)).toMatchObject({ title: "The Second", included: false });
    await undo(edit.body.undo);
    expect((await chapters()).find((c) => c.id === added)).toMatchObject({ title: "Two", included: true });

    const move = await run("soundbox.move_chapter", { book_id: bookId, chapter_id: added, position: 0 });
    expect((await chapters()).map((c) => c.id)[0]).toBe(added);
    await undo(move.body.undo);
    expect((await chapters()).map((c) => c.id)).toEqual([chapterId, added]);

    await undo(add.body.undo);
    expect((await chapters()).map((c) => c.id)).toEqual([chapterId]);
  });

  it("delete_chapter has no undo, and a book keeps one chapter", async () => {
    const add = await run("soundbox.add_chapter", { book_id: bookId, title: "Doomed" });
    const del = await run("soundbox.delete_chapter", { book_id: bookId, chapter_id: add.body.result.chapter_id });
    expect(del.status).toBe(200);
    expect(del.body.undo).toBeNull();
    const last = await run("soundbox.delete_chapter", { book_id: bookId, chapter_id: chapterId });
    expect(last.status).toBe(422);
    expect(last.body.detail).toMatch(/at least one chapter/);
  });
});
