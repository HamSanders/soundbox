/**
 * Filters and sorting for the Audiobooks library page, kept pure so they can
 * be tested without React.
 *
 * The choices follow what reading and listening apps offer on a shelf:
 *   - Libby filters a shelf by subject, format, audience, language and
 *     audiobook duration in hour buckets (https://help.libbyapp.com/6066.htm,
 *     https://www.libbylife.com/blog/2023-01-12-new-updated-filtering-system-in-the-libby-app).
 *   - Audible splits a library by genre and by started, not started and
 *     finished (https://help.audible.com/s/article/manage-your-library).
 * Here "finished" means voiced, since this is the page where books are made.
 *
 * A book's type comes from real metadata only: the form of the classic it was
 * started from, else a form genre it carries ("Novels", "Poetry"...). A book
 * with neither has no type and only shows under "All types".
 */

import type { ClassicSummary } from "@/components/audiobook/import/api";

import { bookProgress, type BookSummary } from "./audiobook-api";
import { ANY, classicOf, LENGTHS } from "./listen-explore";

export { ANY, LENGTHS };

export type BookType = "novel" | "novella" | "story" | "poem" | "children";

export const TYPES: { id: BookType; label: string }[] = [
  { id: "novel", label: "Novels" },
  { id: "novella", label: "Novellas" },
  { id: "story", label: "Short stories" },
  { id: "poem", label: "Poetry" },
  { id: "children", label: "Children's" },
];

/** Genres that name a form rather than a subject. */
const FORM_GENRES: [string, BookType][] = [
  ["novels", "novel"],
  ["novel", "novel"],
  ["novellas", "novella"],
  ["novella", "novella"],
  ["short stories", "story"],
  ["poetry", "poem"],
  ["poems", "poem"],
  ["children", "children"],
  ["fairy tales", "children"],
  ["fables", "children"],
];

export type Status = typeof ANY | "new" | "progress" | "voiced";
export const STATUSES: { id: Exclude<Status, typeof ANY>; label: string }[] = [
  { id: "new", label: "Not started" },
  { id: "progress", label: "In progress" },
  { id: "voiced", label: "Voiced" },
];

export type SortKey = "edited" | "added" | "title" | "author" | "length" | "year" | "voiced";
export const SORTS: { id: SortKey; label: string }[] = [
  { id: "edited", label: "Recently edited" },
  { id: "added", label: "Recently added" },
  { id: "title", label: "Title" },
  { id: "author", label: "Author" },
  { id: "length", label: "Shortest first" },
  { id: "year", label: "Oldest first" },
  { id: "voiced", label: "Most voiced" },
];

export interface ShelfFilters {
  search: string;
  status: Status;
  type: BookType | typeof ANY;
  genre: string;
  length: string;
  language: string;
  sort: SortKey;
}

export const NO_FILTERS: ShelfFilters = {
  search: "",
  status: ANY,
  type: ANY,
  genre: ANY,
  length: ANY,
  language: ANY,
  sort: "edited",
};

/** Reading speed for books not voiced yet; the same estimate Listen uses. */
const CHARS_PER_S = 15.5;

/** A book plus what the filters need, derived once. */
export interface ShelfEntry {
  book: BookSummary;
  type: BookType | null;
  genres: string[];
  /** Voiced length when fully voiced, else the reading estimate. */
  length_s: number;
  status: Exclude<Status, typeof ANY>;
  year: number | null;
}

export function entries(books: BookSummary[], classics: ClassicSummary[]): ShelfEntry[] {
  const byId = new Map(classics.map((w) => [w.id, w]));
  return books.map((book) => {
    const work = classicOf({ classic_id: book.settings.classic_id, title: book.title, author: book.author }, classics, byId);
    const genres = book.genres.length ? book.genres : (work?.genres ?? []);
    const pct = bookProgress(book);
    const status = book.stats.voiced === 0 ? "new" : book.stats.paragraphs > 0 && pct === 100 ? "voiced" : "progress";
    const year = Number.parseInt((book.publication_date ?? "").slice(0, 4), 10);
    return {
      book,
      type: typeOf(genres, work?.form ?? null),
      genres,
      length_s: status === "voiced" ? book.stats.duration_s : Math.round(book.stats.characters / CHARS_PER_S),
      status,
      year: Number.isFinite(year) ? year : (work?.year ?? null),
    };
  });
}

export function typeOf(genres: string[], form: ClassicSummary["form"] | null): BookType | null {
  if (form) return form;
  const lower = genres.map((g) => g.toLowerCase());
  for (const [g, t] of FORM_GENRES) if (lower.includes(g)) return t;
  return null;
}

export function facets(list: ShelfEntry[]) {
  const genres = new Map<string, number>();
  const types = new Map<BookType, number>();
  const statuses = new Map<string, number>();
  const languages = new Set<string>();
  const formGenres = new Set(FORM_GENRES.map(([g]) => g));
  for (const e of list) {
    // Form genres are the Type filter; Genre is for subjects.
    for (const g of e.genres) if (!formGenres.has(g.toLowerCase())) genres.set(g, (genres.get(g) ?? 0) + 1);
    if (e.type) types.set(e.type, (types.get(e.type) ?? 0) + 1);
    statuses.set(e.status, (statuses.get(e.status) ?? 0) + 1);
    languages.add(e.book.language.split("-")[0]!);
  }
  return {
    genres: [...genres.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    types: TYPES.filter((t) => types.has(t.id)).map((t) => ({ ...t, count: types.get(t.id)! })),
    statuses: STATUSES.map((s) => ({ ...s, count: statuses.get(s.id) ?? 0 })),
    languages: [...languages].sort(),
  };
}

export function isFiltering(f: ShelfFilters): boolean {
  return (
    f.search.trim() !== "" || f.status !== ANY || f.type !== ANY || f.genre !== ANY || f.length !== ANY || f.language !== ANY
  );
}

const byTitle = (a: ShelfEntry, b: ShelfEntry) => a.book.title.localeCompare(b.book.title);

export function apply(list: ShelfEntry[], f: ShelfFilters): BookSummary[] {
  const q = f.search.trim().toLowerCase();
  const lengthTest = LENGTHS.find((l) => l.id === f.length)?.test;
  const out = list.filter(
    (e) =>
      (f.status === ANY || e.status === f.status) &&
      (f.type === ANY || e.type === f.type) &&
      (f.genre === ANY || e.genres.includes(f.genre)) &&
      (f.language === ANY || e.book.language.split("-")[0] === f.language) &&
      (!lengthTest || (e.length_s > 0 && lengthTest(e.length_s))) &&
      (!q ||
        [e.book.title, e.book.author ?? "", e.book.narrator ?? "", e.book.series ?? "", ...e.genres].some((s) =>
          s.toLowerCase().includes(q),
        )),
  );
  const sorted = [...out].sort((a, b) => {
    switch (f.sort) {
      case "added":
        return b.book.created_at.localeCompare(a.book.created_at);
      case "title":
        return byTitle(a, b);
      case "author":
        return (a.book.author ?? "￿").localeCompare(b.book.author ?? "￿") || byTitle(a, b);
      case "length":
        return a.length_s - b.length_s || byTitle(a, b);
      case "year":
        return (a.year ?? Infinity) - (b.year ?? Infinity) || byTitle(a, b);
      case "voiced":
        return bookProgress(b.book) - bookProgress(a.book) || byTitle(a, b);
      default:
        return b.book.updated_at.localeCompare(a.book.updated_at);
    }
  });
  return sorted.map((e) => e.book);
}
