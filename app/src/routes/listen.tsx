/**
 * The listening shelf: every book you can play, arranged the way a reading
 * app arranges a catalogue. Continue listening first, then what you finished,
 * then a shelf per genre and per series, each a row that pages sideways.
 * Search and filters (genre, tag, language, length) switch to a single grid
 * of matches.
 */

import { useMemo, useState } from "react";
import { HeadphonesIcon, SearchIcon, XIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { CoverRow } from "@/components/cover-row";
import { FilterChip } from "@/components/filter-chip";
import { languageName } from "@/lib/format";
import { BookTile } from "@/components/listen/book-tile";
import { ListenTabs } from "@/components/listen/listen-tabs";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { ShelfBook } from "@/lib/listen-types";
import { useShelf } from "@/lib/listen-queries";

const ANY = "__any";

const LENGTHS = [
  { id: "short", label: "Under 1 hour", test: (s: number) => s < 3600 },
  { id: "medium", label: "1–5 hours", test: (s: number) => s >= 3600 && s < 5 * 3600 },
  { id: "long", label: "5–10 hours", test: (s: number) => s >= 5 * 3600 && s < 10 * 3600 },
  { id: "epic", label: "Over 10 hours", test: (s: number) => s >= 10 * 3600 },
] as const;

function Shelf({ title, books, action }: { title: string; books: ShelfBook[]; action?: React.ReactNode }) {
  if (books.length === 0) return null;
  return (
    <CoverRow title={title} action={action}>
      {books.map((b) => (
        <BookTile key={b.id} book={b} className="w-36 shrink-0 snap-start sm:w-40" />
      ))}
    </CoverRow>
  );
}

export function ListenPage() {
  const shelf = useShelf();
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState(ANY);
  const [language, setLanguage] = useState(ANY);
  const [length, setLength] = useState(ANY);
  const [tag, setTag] = useState(ANY);

  const all = useMemo(() => shelf.data ?? [], [shelf.data]);
  const facets = useMemo(() => {
    const genres = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const languages = new Set<string>();
    for (const b of all) {
      b.genres.forEach((g) => genres.set(g, (genres.get(g) ?? 0) + 1));
      b.tags.forEach((t) => tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1));
      languages.add(b.language);
    }
    return {
      genres: [...genres.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      tags: [...tagCounts.keys()].sort(),
      languages: [...languages].sort(),
    };
  }, [all]);

  const filtering = search.trim() !== "" || genre !== ANY || language !== ANY || length !== ANY || tag !== ANY;
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const lengthTest = LENGTHS.find((l) => l.id === length)?.test;
    const scored = all
      .filter((b) => genre === ANY || b.genres.includes(genre))
      .filter((b) => language === ANY || b.language === language)
      .filter((b) => !lengthTest || lengthTest(b.duration_s))
      .filter((b) => tag === ANY || b.tags.includes(tag))
      .map((b) => {
        if (!q) return { b, score: 1 };
        // Title matches first, then author/series/narrator, then the rest.
        const score = b.title.toLowerCase().includes(q)
          ? 3
          : [b.author, b.series, b.narrator].some((s) => s?.toLowerCase().includes(q))
            ? 2
            : [b.subtitle, b.description, ...b.genres, ...b.tags].some((s) => s?.toLowerCase().includes(q))
              ? 1
              : 0;
        return { b, score };
      })
      .filter((x) => x.score > 0);
    return scored.sort((x, y) => y.score - x.score || x.b.title.localeCompare(y.b.title)).map((x) => x.b);
  }, [all, search, genre, language, length, tag]);

  const continuing = useMemo(
    () =>
      all
        .filter((b) => b.progress && !b.progress.finished_at && b.playable_chapters > 0)
        .sort((a, b) => b.progress!.updated_at.localeCompare(a.progress!.updated_at)),
    [all],
  );
  const finished = useMemo(
    () =>
      all
        .filter((b) => b.progress?.finished_at)
        .sort((a, b) => b.progress!.finished_at!.localeCompare(a.progress!.finished_at!)),
    [all],
  );
  const series = useMemo(() => {
    const by = new Map<string, ShelfBook[]>();
    for (const b of all) if (b.series) by.set(b.series, [...(by.get(b.series) ?? []), b]);
    return [...by.entries()]
      .map(([name, books]) => [name, books.sort((a, b) => (a.series_index ?? 0) - (b.series_index ?? 0))] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [all]);

  const clear = () => {
    setSearch("");
    setGenre(ANY);
    setLanguage(ANY);
    setLength(ANY);
    setTag(ANY);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-heading mr-auto text-2xl font-semibold tracking-tight">Listen</h1>
        <ListenTabs />
        <div className="relative w-full sm:w-64">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            className="pl-8"
            value={search}
            placeholder="Search title, author, series…"
            aria-label="Search books"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
          <FilterChip
            label="Genre"
            value={genre}
            onChange={setGenre}
            options={[{ value: ANY, label: "All genres" }, ...facets.genres.map(([g, n]) => ({ value: g, label: `${g} (${n})` }))]}
          />
          {facets.tags.length > 0 && (
            <FilterChip
              label="Tag"
              value={tag}
              onChange={setTag}
              width="w-32"
              options={[{ value: ANY, label: "Any tag" }, ...facets.tags.map((t) => ({ value: t, label: t }))]}
            />
          )}
          {facets.languages.length > 1 && (
            <FilterChip
              label="Language"
              value={language}
              onChange={setLanguage}
              width="w-36"
              options={[{ value: ANY, label: "All languages" }, ...facets.languages.map((l) => ({ value: l, label: languageName(l) }))]}
            />
          )}
          <FilterChip
            label="Length"
            value={length}
            onChange={setLength}
            width="w-36"
            options={[{ value: ANY, label: "Any length" }, ...LENGTHS.map((l) => ({ value: l.id as string, label: l.label }))]}
          />
          {filtering && (
            <Button variant="ghost" size="sm" onClick={clear}>
              <XIcon /> Clear
            </Button>
          )}
        </div>
      )}

      {shelf.isLoading ? (
        <div className="flex gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-40 rounded-md" />
          ))}
        </div>
      ) : shelf.isError ? (
        <EmptyState tone="error" title="Could not load the shelf">
          {shelf.error.message}
        </EmptyState>
      ) : all.length === 0 ? (
        <EmptyState
          icon={HeadphonesIcon}
          title="Nothing to listen to yet"
          action={
            <Button asChild>
              <Link to="/audiobooks">Open Audiobooks</Link>
            </Button>
          }
        >
          Books you make in Audiobooks appear here once a chapter is voiced.
        </EmptyState>
      ) : filtering ? (
        matches.length === 0 ? (
          <EmptyState title="No matches">Nothing on the shelf matches those filters.</EmptyState>
        ) : (
          <section className="space-y-3">
            <h2 className="text-muted-foreground text-sm">
              {matches.length} {matches.length === 1 ? "book" : "books"}
            </h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {matches.map((b) => (
                <BookTile key={b.id} book={b} />
              ))}
            </div>
          </section>
        )
      ) : (
        <div className="space-y-8">
          <Shelf title="Continue listening" books={continuing} />
          <Shelf title="Recently finished" books={finished} />
          {/* Every book, newest first, so one with no genre, series or progress still shows. */}
          <Shelf title="All books" books={[...all].sort((a, b) => b.updated_at.localeCompare(a.updated_at))} />
          {facets.genres.map(([g]) => (
            <Shelf
              key={g}
              title={g}
              books={all.filter((b) => b.genres.includes(g))}
              action={
                <Button variant="ghost" size="xs" onClick={() => setGenre(g)}>
                  See all
                </Button>
              }
            />
          ))}
          {series.map(([name, books]) => (
            <Shelf key={name} title={`Series: ${name}`} books={books} />
          ))}
        </div>
      )}
    </div>
  );
}
