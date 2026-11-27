/**
 * The Audiobooks library page's filters and sort: a book's type comes from
 * real metadata only, status from how much is voiced, and the sort orders.
 */

import { describe, expect, it } from "vitest";

import type { ClassicSummary } from "@/components/audiobook/import/api";
import type { BookSummary } from "@/lib/audiobook-api";
import { apply, entries, facets, NO_FILTERS, typeOf } from "@/lib/audiobook-shelf-filters";

let n = 0;
function book(over: Partial<BookSummary> & { voiced?: number; paragraphs?: number; chars?: number; duration?: number }): BookSummary {
  n += 1;
  const { voiced = 0, paragraphs = 10, chars = 15_500, duration = 0, ...rest } = over;
  return {
    id: `b${n}`,
    project_id: null,
    title: `Book ${n}`,
    subtitle: null,
    author: null,
    narrator: null,
    description: null,
    language: "en",
    genres: [],
    series: null,
    series_index: null,
    isbn: null,
    publisher: null,
    publication_date: null,
    cover_path: null,
    settings: {} as BookSummary["settings"],
    created_at: `2026-11-0${n}T00:00:00Z`,
    updated_at: `2026-11-0${n}T00:00:00Z`,
    stats: { chapters: 1, paragraphs, voiced, stale: 0, locked: 0, characters: chars, duration_s: duration, open_notes: 0 },
    ...rest,
  };
}

const raven = { id: "the-raven", title: "The Raven", author: "Edgar Allan Poe", form: "poem", genres: ["Poetry", "Horror"], year: 1845 } as ClassicSummary;

describe("audiobook shelf filters", () => {
  it("takes a type from the classic, else a form genre, else none", () => {
    expect(typeOf([], "poem")).toBe("poem");
    expect(typeOf(["Romance", "Novels"], null)).toBe("novel");
    expect(typeOf(["Romance"], null)).toBeNull();
  });

  it("fills an older classic book's genres and type from the catalogue", () => {
    const [e] = entries([book({ title: "The Raven", author: "Edgar Allan Poe" })], [raven]);
    expect(e!.type).toBe("poem");
    expect(e!.genres).toEqual(["Poetry", "Horror"]);
    expect(e!.year).toBe(1845);
  });

  it("keeps form genres out of the Genre list and counts statuses", () => {
    const list = entries(
      [book({ genres: ["Romance", "Novels"] }), book({ voiced: 4 }), book({ voiced: 10, duration: 600 })],
      [],
    );
    const f = facets(list);
    expect(f.genres).toEqual([["Romance", 1]]);
    expect(f.types).toEqual([{ id: "novel", label: "Novels", count: 1 }]);
    expect(Object.fromEntries(f.statuses.map((s) => [s.id, s.count]))).toEqual({ new: 1, progress: 1, voiced: 1 });
  });

  it("filters by status, type and length, and sorts", () => {
    const novel = book({ title: "Zed", genres: ["Novels"], chars: 15.5 * 7200 });
    const poem = book({ title: "Alpha", genres: ["Poetry"], chars: 155 });
    const done = book({ title: "Mid", voiced: 10, duration: 1200 });
    const list = entries([novel, poem, done], []);
    expect(apply(list, { ...NO_FILTERS, type: "poem" }).map((b) => b.title)).toEqual(["Alpha"]);
    expect(apply(list, { ...NO_FILTERS, status: "voiced" }).map((b) => b.title)).toEqual(["Mid"]);
    expect(apply(list, { ...NO_FILTERS, length: "medium" }).map((b) => b.title)).toEqual(["Zed"]);
    expect(apply(list, { ...NO_FILTERS, sort: "title" }).map((b) => b.title)).toEqual(["Alpha", "Mid", "Zed"]);
    expect(apply(list, { ...NO_FILTERS, sort: "length" }).map((b) => b.title)).toEqual(["Alpha", "Mid", "Zed"]);
    expect(apply(list, { ...NO_FILTERS, search: "zed" }).map((b) => b.title)).toEqual(["Zed"]);
  });
});
