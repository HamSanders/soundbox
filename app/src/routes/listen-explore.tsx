/**
 * Listen → Explore: find your next listen among your own books and the
 * bundled public-domain classics. Laid out after ElevenReader's Explore page
 * (https://elevenreader.io/explore): a featured carousel, collections, rows
 * with "View all", and a row of filter chips. The pure parts live in
 * `lib/listen-explore.ts`.
 *
 * `?view=<row or collection:id>` shows one row or collection in full, so
 * "View all" is a link and the back button returns to Explore.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, CompassIcon, SearchIcon, XIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { importApi } from "@/components/audiobook/import/api";
import { EmptyState } from "@/components/empty-state";
import { ClassicDialog } from "@/components/listen/classic-dialog";
import { ExploreCard } from "@/components/listen/explore-card";
import { ExploreCarousel } from "@/components/listen/explore-carousel";
import { ListenTabs } from "@/components/listen/listen-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ANY,
  applyFilters,
  collections as deriveCollections,
  facets as deriveFacets,
  featured,
  isFiltering,
  LENGTHS,
  mergeExplore,
  NO_FILTERS,
  resolveView,
  rows as deriveRows,
  SORTS,
  type ExploreFilters,
  type ExploreItem,
  type Narration,
  type SortKey,
} from "@/lib/listen-explore";
import { useShelf } from "@/lib/listen-queries";

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function Chip<T extends string>({
  label,
  value,
  onChange,
  options,
  width = "w-40",
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  width?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger size="sm" className={`${width} rounded-full`} aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Grid({ items, onPick }: { items: ExploreItem[]; onPick: (it: ExploreItem) => void }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((it) => (
        <ExploreCard key={it.key} item={it} onPickClassic={onPick} />
      ))}
    </div>
  );
}

export function ListenExplorePage() {
  const shelf = useShelf();
  const library = useQuery({ queryKey: ["audiobooks", "classics"], queryFn: () => importApi.listClassics(), staleTime: Infinity });
  const [params, setParams] = useSearchParams();
  const view = params.get("view");
  const [f, setF] = useState<ExploreFilters>(NO_FILTERS);
  const [picked, setPicked] = useState<ExploreItem | null>(null);
  const set = <K extends keyof ExploreFilters>(k: K, v: ExploreFilters[K]) => setF((cur) => ({ ...cur, [k]: v }));

  const items = useMemo(() => mergeExplore(shelf.data ?? [], library.data?.works ?? []), [shelf.data, library.data]);
  const facets = useMemo(() => deriveFacets(items), [items]);
  const top = useMemo(() => featured(items), [items]);
  const cols = useMemo(() => deriveCollections(items), [items]);
  const rows = useMemo(() => deriveRows(items), [items]);
  const viewing = useMemo(() => (view ? resolveView(view, items) : null), [view, items]);
  const filtering = isFiltering(f);
  const results = useMemo(() => applyFilters(viewing?.items ?? items, f), [viewing, items, f]);

  const loading = shelf.isLoading || library.isLoading;
  const failed = shelf.isError && library.isError;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <ListenTabs />
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Find your next listen</h1>
          <p className="text-muted-foreground text-sm">Your books and public-domain classics, ready to voice.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            className="pl-8"
            value={f.search}
            placeholder="Search title, author, genre…"
            aria-label="Search Explore"
            onChange={(e) => set("search", e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        {facets.tags.length > 0 && (
          <Chip label="Tags" value={f.tag} onChange={(v) => set("tag", v)} width="w-32" options={[{ value: ANY, label: "Any tag" }, ...facets.tags.map((t) => ({ value: t, label: t }))]} />
        )}
        <Chip
          label="Genre"
          value={f.genre}
          onChange={(v) => set("genre", v)}
          options={[{ value: ANY, label: "All genres" }, ...facets.genres.map(([g, n]) => ({ value: g, label: `${g} (${n})` }))]}
        />
        <Chip<Narration>
          label="Narrated by"
          value={f.narration}
          onChange={(v) => set("narration", v)}
          options={[
            { value: ANY, label: "Any narration" },
            { value: "voiced", label: "Voiced" },
            { value: "unvoiced", label: "Not voiced yet" },
          ]}
        />
        {facets.languages.length > 1 && (
          <Chip
            label="Language"
            value={f.language}
            onChange={(v) => set("language", v)}
            width="w-36"
            options={[{ value: ANY, label: "All languages" }, ...facets.languages.map((l) => ({ value: l, label: languageName(l) }))]}
          />
        )}
        <Chip
          label="Length"
          value={f.length}
          onChange={(v) => set("length", v)}
          width="w-36"
          options={[{ value: ANY, label: "Any length" }, ...LENGTHS.map((l) => ({ value: l.id as string, label: l.label }))]}
        />
        <Chip<SortKey> label="Sort by" value={f.sort} onChange={(v) => set("sort", v)} options={SORTS.map((s) => ({ value: s.id, label: s.label }))} />
        {filtering && (
          <Button variant="ghost" size="sm" onClick={() => setF(NO_FILTERS)}>
            <XIcon /> Clear
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="mx-auto h-64 w-52 rounded-md" />
          <div className="flex gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-40 rounded-md" />
            ))}
          </div>
        </div>
      ) : failed ? (
        <EmptyState tone="error" title="Could not load Explore">
          {shelf.error?.message}
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState icon={CompassIcon} title="Nothing to explore yet">
          Books you make in Audiobooks and the bundled classics appear here.
        </EmptyState>
      ) : view ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setParams({})}>
              <ArrowLeftIcon /> Explore
            </Button>
            <h2 className="font-heading text-lg font-semibold">{viewing?.title ?? "Not found"}</h2>
            <span className="text-muted-foreground text-sm">{results.length}</span>
          </div>
          {!viewing ? (
            <EmptyState title="That list is gone">It may have emptied since you opened it.</EmptyState>
          ) : results.length === 0 ? (
            <EmptyState title="No matches">Nothing here matches those filters.</EmptyState>
          ) : (
            <Grid items={results} onPick={setPicked} />
          )}
        </section>
      ) : filtering ? (
        <section className="space-y-3">
          <h2 className="text-muted-foreground text-sm">
            {results.length} {results.length === 1 ? "match" : "matches"}
          </h2>
          {results.length === 0 ? <EmptyState title="No matches">Nothing matches those filters.</EmptyState> : <Grid items={results} onPick={setPicked} />}
        </section>
      ) : (
        <div className="space-y-10">
          <section className="space-y-2">
            <h2 className="font-heading text-lg font-semibold tracking-tight">Top picks</h2>
            <ExploreCarousel items={top} onPickClassic={setPicked} />
          </section>

          {cols.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="font-heading text-lg font-semibold tracking-tight">Collections</h2>
                <p className="text-muted-foreground text-xs">Browse by form, mood and length</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cols.map((c) => (
                  <Link
                    key={c.id}
                    to={`?view=${encodeURIComponent(`collection:${c.id}`)}`}
                    className="hover:bg-muted/50 rounded-lg border p-4 transition-colors"
                  >
                    <p className="font-heading font-semibold">{c.title}</p>
                    <p className="text-muted-foreground text-sm">{c.blurb}</p>
                    <p className="text-muted-foreground mt-2 text-xs">{items.filter(c.test).length} to listen to</p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {rows.map((r) => (
            <section key={r.id} className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <h2 className="font-heading text-lg font-semibold tracking-tight">{r.title}</h2>
                  {r.subtitle && <p className="text-muted-foreground text-xs">{r.subtitle}</p>}
                </div>
                <Button variant="ghost" size="xs" asChild>
                  <Link to={`?view=${encodeURIComponent(r.id)}`}>View all</Link>
                </Button>
              </div>
              <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
                {r.items.slice(0, 12).map((it) => (
                  <ExploreCard key={it.key} item={it} onPickClassic={setPicked} className="w-36 shrink-0 snap-start sm:w-40" />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ClassicDialog item={picked} rights={library.data?.rights ?? null} onClose={() => setPicked(null)} />
    </div>
  );
}
