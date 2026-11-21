/**
 * The bundled public-domain classics: catalogue data checks, and the
 * classic → preview → commit path into a real book store.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { classicWorks, listClassics } from "../src/audiobook/classics/index.js";
import { Config } from "../src/config.js";

describe("classics catalogue", () => {
  const works = classicWorks();

  it("has unique ids and complete metadata", () => {
    expect(works.length).toBeGreaterThanOrEqual(25);
    expect(new Set(works.map((w) => w.id)).size).toBe(works.length);
    for (const w of works) {
      expect(w.title && w.author && w.description, w.id).toBeTruthy();
      expect(w.source.url, w.id).toMatch(/^https:\/\/standardebooks\.org\/ebooks\//);
      expect(["story", "poem", "novella", "children"], w.id).toContain(w.form);
      expect(w.sections.length, w.id).toBeGreaterThan(0);
    }
  });

  it("only lists authors and translators who died 70+ years before 2026", () => {
    const died = (life: string) => Number(life.split("–")[1]);
    for (const w of works) {
      expect(died(w.life), w.id).toBeLessThanOrEqual(1955);
      if (w.translator_life) expect(died(w.translator_life), w.id).toBeLessThanOrEqual(1955);
      expect(w.year, w.id).toBeLessThan(1930);
    }
  });

  it("holds clean text: no markup, entities or invisible characters", () => {
    for (const w of works) {
      for (const s of w.sections) {
        for (const p of s.paragraphs) {
          expect(p, w.id).not.toMatch(/<\/?[a-z]+[\s>]|&[a-z]+;|[­⁠​]/);
          expect(p.trim(), w.id).toBe(p);
        }
        for (const b of s.breaks ?? []) expect(b > 0 && b < s.paragraphs.length, w.id).toBe(true);
      }
    }
  });

  it("keeps a poem's line breaks and a novella's chapters", () => {
    const raven = works.find((w) => w.id === "the-raven")!;
    expect(raven.sections[0]!.paragraphs[0]!.split("\n")[0]).toBe("Once upon a midnight dreary, while I pondered, weak and weary,");
    const carol = works.find((w) => w.id === "christmas-carol")!;
    expect(carol.sections.map((s) => s.title)).toContain("Stave I: Marley’s Ghost");
    expect(carol.sections[0]!.kind).toBe("front_matter");
  });

  it("estimates listening time", () => {
    const magi = listClassics().find((w) => w.id === "gift-of-the-magi")!;
    expect(magi.minutes).toBeGreaterThan(8);
    expect(magi.minutes).toBeLessThan(20);
    expect("sections" in magi).toBe(false);
  });
});

describe("classic import routes", () => {
  let app: FastifyInstance;
  let dataDir: string;
  const H = { "x-soundbox": "1" };

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mirli-classics-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("lists the library with the rights note and no text", async () => {
    const res = await app.inject({ method: "GET", url: "/api/audiobooks/classics" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.works.length).toBe(classicWorks().length);
    expect(body.rights).toMatch(/United States/);
    expect(res.body.length).toBeLessThan(40_000);
  });

  it("turns a classic into a preview and a book", async () => {
    const pre = await app.inject({ method: "POST", url: "/api/audiobooks/import/classic", headers: H, payload: { id: "the-raven" } });
    expect(pre.statusCode, pre.body).toBe(201);
    const preview = pre.json();
    expect(preview.source).toMatchObject({ format: "classic", url: "https://standardebooks.org/ebooks/edgar-allan-poe/poetry" });
    expect(preview.metadata).toMatchObject({ title: "The Raven", author: "Edgar Allan Poe", publication_date: "1845" });

    const commit = await app.inject({ method: "POST", url: "/api/audiobooks/import/commit", headers: H, payload: { preview_id: preview.id } });
    expect(commit.statusCode, commit.body).toBe(201);
    const book = commit.json();
    const detail = (await app.inject({ method: "GET", url: `/api/audiobooks/${book.id ?? book.book.id}` })).json();
    const chapter = detail.chapters[0];
    const paras = (await app.inject({ method: "GET", url: `/api/audiobooks/${detail.id ?? detail.book.id}/chapters/${chapter.id}/paragraphs` })).json();
    const list = paras.paragraphs ?? paras;
    const stanza = list.find((p: { text: string }) => p.text.startsWith("Once upon a midnight"));
    expect(stanza.text.split("\n").length).toBeGreaterThan(4);
  });

  it("gives a 404 for an unknown id", async () => {
    const res = await app.inject({ method: "POST", url: "/api/audiobooks/import/classic", headers: H, payload: { id: "nope" } });
    expect(res.statusCode).toBe(404);
  });
});
