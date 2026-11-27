/**
 * Listen → Explore: the browse-and-discover view, modelled on ElevenReader's
 * Explore page (https://elevenreader.io/explore, read 2026-11-21). That page
 * has a featured cover carousel, curated collections, rows with "View all",
 * and filter chips (tags, genre, rating, narrated by, language, sort).
 *
 * Here the catalogue is two sources: your own books from the shelf, and the
 * bundled public-domain classics you haven't added yet. This module is the
 * pure part (merging, collections, rows, filters, sorting) so it can be tested
 * without React. Mirli has no store, so there is no price filter, and no
 * ratings yet, so no rating filter.
 */

import type { ClassicSummary } from "@/components/audiobook/import/api";

import type { ShelfBook } from "./listen-types";

export type ClassicForm = ClassicSummary["form"];

/** Where an item stands: rendered audio, a book of yours with none yet, or a classic to add. */
export type ExploreStatus = "voiced" | "unvoiced" | "classic";

export interface ExploreItem {
  /** "book:<id>" or "classic:<id>". */
  key: string;
  kind: "book" | "classic";
  title: string;
  author: string | null;
  description: string | null;
  genres: string[];
  tags: string[];
  language: string;
  /** Rendered length, or the estimate for text that isn't voiced. */
  length_s: number;
  status: ExploreStatus;
  /** The classic's form, for books started from one too. */
  form: ClassicForm | null;
  series: string | null;
  series_index: number | null;
  added_at: string | null;
  listened_at: string | null;
  book: ShelfBook | null;
  work: ClassicSummary | null;
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** The classic a book came from: its recorded id, or for a book added before
 *  that was recorded, a classic with the same title whose author the book's
 *  author line starts with. */
export function classicOf(
  b: { classic_id?: string | null; title: string; author: string | null },
  classics: ClassicSummary[],
  byId: Map<string, ClassicSummary> = new Map(classics.map((w) => [w.id, w])),
): ClassicSummary | null {
  if (b.classic_id) return byId.get(b.classic_id) ?? null;
  return classics.find((w) => norm(w.title) === norm(b.title) && norm(b.author).startsWith(norm(w.author))) ?? null;
}

/** Your books plus the classics you don't own yet. A book started from a
 *  classic takes the classic's form and replaces it in the catalogue. */
export function mergeExplore(books: ShelfBook[], classics: ClassicSummary[]): ExploreItem[] {
  const byId = new Map(classics.map((w) => [w.id, w]));
  const works = new Map(books.map((b) => [b.id, classicOf(b, classics, byId)]));
  const owned = new Set([...works.values()].filter((w): w is ClassicSummary => !!w).map((w) => w.id));
  const mine: ExploreItem[] = books.map((b) => {
    const work = works.get(b.id) ?? null;
    const voiced = b.playable_chapters > 0;
    return {
      key: `book:${b.id}`,
      kind: "book",
      title: b.title,
      author: b.author,
      description: b.description,
      genres: b.genres.length ? b.genres : (work?.genres ?? []),
      tags: b.tags,
      language: b.language,
      length_s: voiced ? b.duration_s : b.estimated_s,
      status: voiced ? "voiced" : "unvoiced",
      form: work?.form ?? null,
      series: b.series,
      series_index: b.series_index,
      added_at: b.created_at,
      listened_at: b.progress?.updated_at ?? null,
      book: b,
      work,
    };
  });
  const toAdd: ExploreItem[] = classics
    .filter((w) => !owned.has(w.id))
    .map((w) => ({
      key: `classic:${w.id}`,
      kind: "classic",
      title: w.title,
      author: w.translator ? `${w.author}, tr. ${w.translator}` : w.author,
      description: w.description,
      genres: w.genres,
      tags: [],
      language: w.language,
      length_s: w.minutes * 60,
      status: "classic",
      form: w.form,
      series: null,
      series_index: null,
      added_at: null,
      listened_at: null,
      book: null,
      work: w,
    }));
  return [...mine, ...toAdd];
}

/* ------------------------------------------------------------- featured */

/** Classics to feature when your own books don't fill the carousel. Our
 *  picks: well-known titles across the forms, short and long. */
export const FEATURED_CLASSICS = [
  "christmas-carol",
  "the-raven",
  "alice-in-wonderland",
  "telltale-heart",
  "goblin-market",
  "gift-of-the-magi",
  "jekyll-and-hyde",
  "hansel-and-grethel",
  "yellow-wallpaper",
];

/** The carousel: what you've been listening to, then your newest voiced
 *  books, then featured classics, up to `n`. */
export function featured(items: ExploreItem[], n = 7): ExploreItem[] {
  const out: ExploreItem[] = [];
  const push = (it: ExploreItem | undefined) => {
    if (it && out.length < n && !out.includes(it)) out.push(it);
  };
  const recent = (it: ExploreItem) => it.listened_at ?? it.added_at ?? "";
  items
    .filter((it) => it.kind === "book" && it.status === "voiced")
    .sort((a, b) => recent(b).localeCompare(recent(a)))
    .forEach(push);
  for (const id of FEATURED_CLASSICS) push(items.find((it) => it.work?.id === id && it.kind === "classic"));
  items.forEach(push);
  return out;
}

/* ---------------------------------------------------------- collections */

export interface Collection {
  id: string;
  title: string;
  blurb: string;
  test: (it: ExploreItem) => boolean;
}

const hasGenre = (it: ExploreItem, g: string) => it.genres.some((x) => x.toLowerCase() === g.toLowerCase());

/** Collections built from the catalogue, never a hand-kept list: a card is
 *  shown only when at least two items fall in it. Blurbs are our own. */
export function collections(items: ExploreItem[]): Collection[] {
  const fixed: Collection[] = [
    { id: "short", title: "Short listens", blurb: "Under half an hour: one sitting, one cup of tea.", test: (it) => it.length_s > 0 && it.length_s < 30 * 60 },
    { id: "poems", title: "Poems aloud", blurb: "Verse read stanza by stanza, line breaks kept.", test: (it) => it.form === "poem" || hasGenre(it, "Poetry") },
    { id: "children", title: "Fairy tales and fables", blurb: "Grimm, Aesop, Wilde and Kipling for bedtime.", test: (it) => it.form === "children" || hasGenre(it, "Children") },
    { id: "dark", title: "Something dark for tonight", blurb: "Horror and the uncanny, from Poe to Jacobs.", test: (it) => hasGenre(it, "Horror") },
    { id: "mystery", title: "Mysteries", blurb: "Detectives, secrets and locked rooms.", test: (it) => hasGenre(it, "Mystery") },
    { id: "novellas", title: "Novellas in chapters", blurb: "Longer reads, split into chapters to listen through.", test: (it) => it.form === "novella" },
    { id: "unvoiced", title: "Ready to voice", blurb: "Your books with text but no audio yet.", test: (it) => it.status === "unvoiced" },
  ];
  const series = [...new Set(items.map((it) => it.series).filter((s): s is string => !!s))].sort().map<Collection>((s) => ({
    id: `series:${s}`,
    title: s,
    blurb: "A series, in order.",
    test: (it) => it.series === s,
  }));
  return [...series, ...fixed].filter((c) => items.filter(c.test).length >= 2);
}

/* ----------------------------------------------------------------- rows */

export interface Row {
  /** Also the "View all" key, e.g. "library", "classics", "genre:Horror". */
  id: string;
  title: string;
  subtitle?: string;
  items: ExploreItem[];
}

/** Rows under the carousel: your books, classics to add, then a row per
 *  genre with at least three items, biggest first. */
export function rows(items: ExploreItem[]): Row[] {
  const out: Row[] = [];
  const library = items.filter((it) => it.kind === "book").sort((a, b) => (b.added_at ?? "").localeCompare(a.added_at ?? ""));
  if (library.length) out.push({ id: "library", title: "Your books", subtitle: "Newest first", items: library });
  const classics = items.filter((it) => it.kind === "classic");
  if (classics.length) out.push({ id: "classics", title: "Classics to add", subtitle: "Public domain, free to voice", items: classics });
  const counts = new Map<string, number>();
  for (const it of items) for (const g of it.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
  [...counts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([g]) => out.push({ id: `genre:${g}`, title: g, items: items.filter((it) => it.genres.includes(g)) }));
  return out;
}

/** What a "View all" key shows: a row, a collection, or nothing. */
export function resolveView(key: string, items: ExploreItem[]): { title: string; items: ExploreItem[] } | null {
  if (key.startsWith("collection:")) {
    const c = collections(items).find((c) => c.id === key.slice("collection:".length));
    return c ? { title: c.title, items: items.filter(c.test) } : null;
  }
  const row = rows(items).find((r) => r.id === key);
  return row ? { title: row.title, items: row.items } : null;
}

/* -------------------------------------------------------------- filters */

export const ANY = "__any";

export type Narration = typeof ANY | "voiced" | "unvoiced";
export type SortKey = "recommended" | "added" | "listened" | "title" | "author" | "length";

export interface ExploreFilters {
  search: string;
  genre: string;
  tag: string;
  language: string;
  /** ElevenReader's "Narrated by": here, rendered audio or not voiced yet. */
  narration: Narration;
  length: string;
  sort: SortKey;
}

export const NO_FILTERS: ExploreFilters = { search: "", genre: ANY, tag: ANY, language: ANY, narration: ANY, length: ANY, sort: "recommended" };

export const LENGTHS = [
  { id: "short", label: "Under 30 min", test: (s: number) => s < 30 * 60 },
  { id: "hour", label: "30 min – 1 hour", test: (s: number) => s >= 30 * 60 && s < 3600 },
  { id: "medium", label: "1–5 hours", test: (s: number) => s >= 3600 && s < 5 * 3600 },
  { id: "long", label: "Over 5 hours", test: (s: number) => s >= 5 * 3600 },
] as const;

export const SORTS: { id: SortKey; label: string }[] = [
  { id: "recommended", label: "Recommended" },
  { id: "added", label: "Recently added" },
  { id: "listened", label: "Recently listened" },
  { id: "title", label: "Title" },
  { id: "author", label: "Author" },
  { id: "length", label: "Shortest first" },
];

export function isFiltering(f: ExploreFilters): boolean {
  return f.search.trim() !== "" || f.genre !== ANY || f.tag !== ANY || f.language !== ANY || f.narration !== ANY || f.length !== ANY || f.sort !== "recommended";
}

/** Facets for the chips, from what's in the catalogue. */
export function facets(items: ExploreItem[]) {
  const genres = new Map<string, number>();
  const tags = new Set<string>();
  const languages = new Set<string>();
  for (const it of items) {
    it.genres.forEach((g) => genres.set(g, (genres.get(g) ?? 0) + 1));
    it.tags.forEach((t) => tags.add(t));
    languages.add(it.language);
  }
  return {
    genres: [...genres.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    tags: [...tags].sort(),
    languages: [...languages].sort(),
  };
}

/** Surname-ish sort key: the last word of the first credited name. */
const authorKey = (a: string | null) => (a ?? "").split(/,| and /)[0]!.trim().split(/\s+/).pop()?.toLowerCase() ?? "";

export function applyFilters(items: ExploreItem[], f: ExploreFilters): ExploreItem[] {
  const q = f.search.trim().toLowerCase();
  const lengthTest = LENGTHS.find((l) => l.id === f.length)?.test;
  const scored = items
    .filter((it) => f.genre === ANY || it.genres.includes(f.genre))
    .filter((it) => f.tag === ANY || it.tags.includes(f.tag))
    .filter((it) => f.language === ANY || it.language === f.language)
    .filter((it) => f.narration === ANY || (f.narration === "voiced" ? it.status === "voiced" : it.status !== "voiced"))
    .filter((it) => !lengthTest || (it.length_s > 0 && lengthTest(it.length_s)))
    .map((it) => {
      if (!q) return { it, score: 1 };
      // Title first, then author and series, then everything else.
      const score = it.title.toLowerCase().includes(q)
        ? 3
        : [it.author, it.series, it.book?.narrator].some((s) => s?.toLowerCase().includes(q))
          ? 2
          : [it.description, it.work?.subtitle, ...it.genres, ...it.tags].some((s) => s?.toLowerCase().includes(q))
            ? 1
            : 0;
      return { it, score };
    })
    .filter((x) => x.score > 0);
  const order = (a: ExploreItem, b: ExploreItem): number => {
    switch (f.sort) {
      case "added":
        return (b.added_at ?? "").localeCompare(a.added_at ?? "");
      case "listened":
        return (b.listened_at ?? "").localeCompare(a.listened_at ?? "");
      case "title":
        return a.title.localeCompare(b.title);
      case "author":
        return authorKey(a.author).localeCompare(authorKey(b.author)) || a.title.localeCompare(b.title);
      case "length":
        return a.length_s - b.length_s;
      default:
        return 0;
    }
  };
  return scored
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => b.score - a.score || order(a.it, b.it) || a.i - b.i)
    .map((x) => x.it);
}
