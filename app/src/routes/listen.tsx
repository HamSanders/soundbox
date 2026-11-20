/**
 * The listening shelf: every book you can play, arranged the way a reading
 * app arranges a catalogue. Continue listening first, then what you finished,
 * then a shelf per genre and per series. Search and filters (genre, tag,
 * language, length) switch to a single grid of matches.
 */

import { useMemo, useState } from "react";
import { HeadphonesIcon, SearchIcon, XIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { BookTile } from "@/components/listen/book-tile";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { ShelfBook } from "@/lib/listen-types";
import { useShelf } from "@/lib/listen-queries";
import { cn } from "@/lib/utils";

const ANY = "__any";

const LENGTHS = [
  { id: "short", label: "Under 1 hour", test: (s: number) => s < 3600 },
  { id: "medium", label: "1–5 hours", test: (s: number) => s >= 3600 && s < 5 * 3600 },
  { id: "long", label: "5–10 hours", test: (s: number) => s >= 5 * 3600 && s < 10 * 3600 },
  { id: "epic", label: "Over 10 hours", test: (s: number) => s >= 10 * 3600 },
] as const;

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function Shelf({ title, books, action }: { title: string; books: ShelfBook[]; action?: React.ReactNode }) {
  if (books.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
        {books.map((b) => (
          <BookTile key={b.id} book={b} className="w-36 shrink-0 snap-start sm:w-40" />
        ))}
      </div>
    </section>
  );
}

export function ListenPage() {
  const shelf = useShelf();
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState(ANY);
  const [language, setLanguage] = useState(ANY);
  const [length, setLength] = useState(ANY);
  const [tags, setTags] = useState<string[]>([]);

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

  const filtering = search.trim() !== "" || genre !== ANY || language !== ANY || length !== ANY || tags.length > 0;
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const lengthTest = LENGTHS.find((l) => l.id === length)?.test;
    const scored = all
      .filter((b) => genre === ANY || b.genres.includes(genre))
      .filter((b) => language === ANY || b.language === language)
      .filter((b) => !lengthTest || lengthTest(b.duration_s))
      .filter((b) => tags.every((t) => b.tags.includes(t)))
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
  }, [all, search, genre, language, length, tags]);

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
    setTags([]);
  };
  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Listen</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Your audiobooks, with read-along text. Pick up where you left off.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
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
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={genre} onValueChange={setGenre}>
              <SelectTrigger size="sm" className="w-44" aria-label="Genre">
                <SelectValue placeholder="Genre" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All genres</SelectItem>
                {facets.genres.map(([g, n]) => (
                  <SelectItem key={g} value={g}>
                    {g} ({n})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger size="sm" className="w-36" aria-label="Language">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All languages</SelectItem>
                {facets.languages.map((l) => (
                  <SelectItem key={l} value={l}>
                    {languageName(l)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={length} onValueChange={setLength}>
              <SelectTrigger size="sm" className="w-36" aria-label="Length">
                <SelectValue placeholder="Length" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any length</SelectItem>
                {LENGTHS.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtering && (
              <Button variant="ghost" size="sm" onClick={clear}>
                <XIcon /> Clear
              </Button>
            )}
          </div>
          {facets.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tags">
              {facets.tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tags.includes(t)}
                  onClick={() => toggleTag(t)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    tags.includes(t)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
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
