/**
 * Listen → Explore: the app's pure catalogue logic (merging your books with
 * the bundled classics, collections, rows, "View all", filters, sorting), and
 * the server side that lets it tell which classics you already own.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ClassicSummary } from "@/components/audiobook/import/api";
import {
  ANY,
  applyFilters,
  collections,
  featured,
  mergeExplore,
  NO_FILTERS,
  resolveView,
  rows,
} from "@/lib/listen-explore";
import type { ShelfBook } from "@/lib/listen-types";

import { buildApp } from "../src/app.js";
import { listClassics } from "../src/audiobook/classics/index.js";
import { Config } from "../src/config.js";

function book(over: Partial<ShelfBook> & { id: string; title: string }): ShelfBook {
  return {
    subtitle: null,
    author: "Someone",
    narrator: null,
    description: null,
    language: "en",
    genres: [],
    tags: [],
    series: null,
    series_index: null,
    publication_date: null,
    cover_url: null,
    duration_s: 0,
    estimated_s: 0,
    chapters: 1,
    playable_chapters: 0,
    classic_id: null,
    progress: null,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

const classics = listClassics() as unknown as ClassicSummary[];

describe("Explore catalogue", () => {
  const lighthouse = book({ id: "b1", title: "The Lighthouse Keeper", genres: ["Mystery"], playable_chapters: 2, duration_s: 56, created_at: "2026-11-20T00:00:00.000Z" });
  // A classic you already added: it must show once, as your book.
  const raven = book({ id: "b2", title: "The Raven", author: "Edgar Allan Poe", classic_id: "the-raven", estimated_s: 410, created_at: "2026-11-21T00:00:00.000Z" });
  const items = mergeExplore([lighthouse, raven], classics);

  it("lists each classic once: an owned one as your book, with the classic's form", () => {
    expect(items.filter((it) => it.title === "The Raven")).toHaveLength(1);
    const r = items.find((it) => it.title === "The Raven")!;
    expect(r).toMatchObject({ kind: "book", status: "unvoiced", form: "poem", length_s: 410 });
    expect(r.genres).toContain("Poetry"); // a book with no genres borrows the classic's
    expect(items.filter((it) => it.kind === "classic")).toHaveLength(classics.length - 1);
    expect(items.find((it) => it.key === "book:b1")).toMatchObject({ status: "voiced", length_s: 56 });
  });

  it("features your voiced books first, then picked classics, without repeats", () => {
    const top = featured(items, 5);
    expect(top).toHaveLength(5);
    expect(top[0]!.key).toBe("book:b1");
    expect(top[1]!.work?.id).toBe("christmas-carol");
    expect(new Set(top.map((t) => t.key)).size).toBe(5);
    // An empty library still gets a carousel.
    expect(featured(mergeExplore([], classics), 3).map((t) => t.work?.id)).toEqual(["christmas-carol", "the-raven", "alice-in-wonderland"]);
  });

  it("derives collections from the data and hides ones with fewer than two items", () => {
    const ids = collections(items).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["short", "poems", "children", "dark", "novellas"]));
    const poems = items.filter(collections(items).find((c) => c.id === "poems")!.test);
    expect(poems.some((p) => p.key === "book:b2")).toBe(true);
    // A series collection appears once two books share it.
    const withSeries = mergeExplore([book({ id: "s1", title: "One", series: "Saga" }), book({ id: "s2", title: "Two", series: "Saga" })], []);
    expect(collections(withSeries).map((c) => c.id)).toContain("series:Saga");
  });

  it("builds rows: your books newest first, classics to add, then genres with three or more", () => {
    const r = rows(items);
    expect(r[0]).toMatchObject({ id: "library", title: "Your books" });
    expect(r[0]!.items.map((it) => it.key)).toEqual(["book:b2", "book:b1"]);
    expect(r[1]!.id).toBe("classics");
    const genreRows = r.filter((x) => x.id.startsWith("genre:"));
    expect(genreRows.length).toBeGreaterThan(2);
    for (const g of genreRows) expect(g.items.length).toBeGreaterThanOrEqual(3);
  });

  it("resolves View all keys for rows and collections", () => {
    expect(resolveView("library", items)?.items).toHaveLength(2);
    expect(resolveView("genre:Horror", items)?.title).toBe("Horror");
    expect(resolveView("collection:poems", items)?.title).toBe("Poems aloud");
    expect(resolveView("collection:nope", items)).toBeNull();
    expect(resolveView("genre:Nope", items)).toBeNull();
  });

  it("filters by narration, genre, length and search, and sorts", () => {
    const voiced = applyFilters(items, { ...NO_FILTERS, narration: "voiced" });
    expect(voiced.map((it) => it.key)).toEqual(["book:b1"]);
    const notYet = applyFilters(items, { ...NO_FILTERS, narration: "unvoiced" });
    expect(notYet.every((it) => it.status !== "voiced")).toBe(true);
    expect(applyFilters(items, { ...NO_FILTERS, genre: "Fairy tales" }).every((it) => it.genres.includes("Fairy tales"))).toBe(true);
    const short = applyFilters(items, { ...NO_FILTERS, length: "short" });
    expect(short.length).toBeGreaterThan(0);
    expect(short.every((it) => it.length_s > 0 && it.length_s < 1800)).toBe(true);
    // Title matches rank above author matches.
    const poe = applyFilters(items, { ...NO_FILTERS, search: "raven" });
    expect(poe[0]!.title).toBe("The Raven");
    const byLength = applyFilters(items, { ...NO_FILTERS, sort: "length" });
    for (let i = 1; i < byLength.length; i++) expect(byLength[i]!.length_s).toBeGreaterThanOrEqual(byLength[i - 1]!.length_s);
    const byTitle = applyFilters(items, { ...NO_FILTERS, sort: "title" }).map((it) => it.title);
    expect(byTitle).toEqual([...byTitle].sort((a, b) => a.localeCompare(b)));
    expect(applyFilters(items, { ...NO_FILTERS, tag: ANY, language: "fr" })).toHaveLength(0);
  });
});

describe("Explore on the server", () => {
  let app: FastifyInstance;
  let dataDir: string;
  const H = { "x-soundbox": "1" };

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mirli-explore-"));
    app = buildApp(new Config(dataDir), { serveUi: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("remembers the classic a book came from and puts it on the shelf with an estimated length", async () => {
    const pre = (await app.inject({ method: "POST", url: "/api/audiobooks/import/classic", headers: H, payload: { id: "ozymandias" } })).json();
    expect(pre.source.classic_id).toBe("ozymandias");
    const commit = await app.inject({ method: "POST", url: "/api/audiobooks/import/commit", headers: H, payload: { preview_id: pre.id } });
    expect(commit.statusCode, commit.body).toBe(201);
    const created = commit.json();
    expect(created.settings.classic_id).toBe("ozymandias");

    const shelf = (await app.inject({ method: "GET", url: "/api/audiobooks/listen/shelf" })).json() as ShelfBook[];
    const entry = shelf.find((b) => b.id === created.id)!;
    expect(entry.classic_id).toBe("ozymandias");
    expect(entry.playable_chapters).toBe(0);
    // 110 words of poem plus its heading: well under two minutes, more than twenty seconds.
    expect(entry.estimated_s).toBeGreaterThan(20);
    expect(entry.estimated_s).toBeLessThan(120);
  });

  it("leaves classic_id empty for an ordinary import", async () => {
    const pre = (
      await app.inject({ method: "POST", url: "/api/audiobooks/import/text", headers: H, payload: { text: "# One\n\nHello there.", title: "Plain" } })
    ).json();
    const created = (await app.inject({ method: "POST", url: "/api/audiobooks/import/commit", headers: H, payload: { preview_id: pre.id } })).json();
    expect(created.settings.classic_id ?? null).toBeNull();
  });
});

describe("Explore: books added before classic_id was recorded", () => {
  it("matches a classic by title and author so it isn't offered twice", () => {
    const old = book({ id: "o1", title: "The Raven", author: "Edgar Allan Poe" });
    const items = mergeExplore([old], classics);
    expect(items.filter((it) => it.title === "The Raven")).toHaveLength(1);
    expect(items.find((it) => it.key === "book:o1")!.form).toBe("poem");
    // Same title, different author: a different book.
    const other = mergeExplore([book({ id: "o2", title: "The Raven", author: "A. N. Other" })], classics);
    expect(other.filter((it) => it.title === "The Raven")).toHaveLength(2);
  });
});
