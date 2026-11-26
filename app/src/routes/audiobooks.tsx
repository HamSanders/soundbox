/**
 * The audiobook shelf: every book as a cover, with how much of it is voiced.
 * Start a blank book or import a manuscript from here; open one to edit it.
 * One row of filters (status, type, genre, length, language) and a sort;
 * the rules live in `lib/audiobook-shelf-filters.ts`.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepDetail } from "@/lib/dock";
import { BookOpenIcon, FileUpIcon, FolderIcon, LibraryIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";

import { ImportWizard } from "@/components/audiobook/import";
import { importApi } from "@/components/audiobook/import/api";
import { BookCard } from "@/components/audiobook/shelf/book-card";
import { EmptyState } from "@/components/empty-state";
import { FilterChip } from "@/components/filter-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { audiobookApi } from "@/lib/audiobook-api";
import {
  useBooks,
  useCreateBook,
  useDeleteBook,
  useDuplicateBook,
  useMoveBookToProject,
} from "@/lib/audiobook-queries";
import { useProjects } from "@/lib/queries";
import {
  ANY,
  apply,
  entries,
  facets as deriveFacets,
  isFiltering,
  LENGTHS,
  NO_FILTERS,
  SORTS,
  type BookType,
  type ShelfFilters,
  type SortKey,
  type Status,
} from "@/lib/audiobook-shelf-filters";
import { formatDuration, languageName } from "@/lib/format";

/** Below this many books the filter row would only be noise. */
const FILTER_THRESHOLD = 4;

export function AudiobooksPage() {
  const navigate = useNavigate();
  // `?project=<id>` scopes the shelf to one project, the way the library
  // does (Projects links there). New and imported books land in it.
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project");
  const projects = useProjects();
  const project = projectId ? projects.data?.find((p) => p.id === projectId) : undefined;
  const books = useBooks(true, projectId ?? undefined);
  const move = useMoveBookToProject();
  const create = useCreateBook();
  const remove = useDeleteBook();
  const duplicate = useDuplicateBook();
  const classics = useQuery({ queryKey: ["audiobooks", "classics"], queryFn: () => importApi.listClassics(), staleTime: Infinity });
  const [f, setF] = useState<ShelfFilters>(NO_FILTERS);
  const set = <K extends keyof ShelfFilters>(k: K, v: ShelfFilters[K]) => setF((cur) => ({ ...cur, [k]: v }));
  // `?import=1` opens the wizard (the command palette links here).
  const importing = params.get("import") === "1" || params.get("import") === "classics";
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(keepDetail(next), { replace: true });
  };
  const setImporting = (open: boolean) => setParam("import", open ? "1" : null);
  const openClassics = () => setParam("import", "classics");

  const all = useMemo(() => books.data ?? [], [books.data]);
  const list = useMemo(() => entries(all, classics.data?.works ?? []), [all, classics.data]);
  const facets = useMemo(() => deriveFacets(list), [list]);
  const filtering = isFiltering(f);
  const items = useMemo(() => apply(list, f), [list, f]);

  const totalVoiced = all.reduce((n, b) => n + b.stats.duration_s, 0);

  const newBook = () =>
    create.mutate(
      { project_id: projectId ?? null },
      { onSuccess: (book) => navigate(`/audiobooks/${book.id}`) },
    );

  return (
    <div className="space-y-5">
      <ImportWizard
        open={importing}
        onOpenChange={setImporting}
        initialSource={params.get("import") === "classics" ? "classics" : "file"}
        onImported={(id) => {
          // The wizard commits with no project; file the book here.
          if (projectId) void audiobookApi.updateBook(id, { project_id: projectId });
          navigate(`/audiobooks/${id}`);
        }}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {project ? project.name : "Audiobooks"}
          </h1>
          {projectId && (
            <span className="bg-muted text-foreground mt-2 inline-flex h-7 items-center gap-1 rounded-full pr-1 pl-2.5 text-xs">
              <FolderIcon className="size-3" />
              Project: {project?.name ?? "…"}
              <button
                type="button"
                onClick={() => setParam("project", null)}
                aria-label="Show books from every project"
                className="text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-full p-0.5"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          )}
          <p className="text-muted-foreground mt-1 text-sm">
            Turn a manuscript into a narrated book, chapter by chapter, with a voice for every
            character.
            {totalVoiced > 0 ? ` ${formatDuration(totalVoiced)} voiced so far.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={openClassics}>
            <LibraryIcon />
            Classics
          </Button>
          <Button variant="outline" onClick={() => setImporting(true)}>
            <FileUpIcon />
            Import manuscript
          </Button>
          <Button onClick={newBook} disabled={create.isPending}>
            <PlusIcon />
            New book
          </Button>
        </div>
      </div>

      {all.length >= FILTER_THRESHOLD && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
          <FilterChip<Status>
            label="Status"
            value={f.status}
            onChange={(v) => set("status", v)}
            width="w-36"
            options={[
              { value: ANY, label: `All books (${all.length})` },
              ...facets.statuses.filter((s) => s.count > 0).map((s) => ({ value: s.id, label: `${s.label} (${s.count})` })),
            ]}
          />
          {facets.types.length > 0 && (
            <FilterChip<BookType | typeof ANY>
              label="Type"
              value={f.type}
              onChange={(v) => set("type", v)}
              width="w-40"
              options={[{ value: ANY, label: "All types" }, ...facets.types.map((t) => ({ value: t.id, label: `${t.label} (${t.count})` }))]}
            />
          )}
          {facets.genres.length > 0 && (
            <FilterChip
              label="Genre"
              value={f.genre}
              onChange={(v) => set("genre", v)}
              options={[{ value: ANY, label: "All genres" }, ...facets.genres.map(([g, n]) => ({ value: g, label: `${g} (${n})` }))]}
            />
          )}
          <FilterChip
            label="Length"
            value={f.length}
            onChange={(v) => set("length", v)}
            width="w-36"
            options={[{ value: ANY, label: "Any length" }, ...LENGTHS.map((l) => ({ value: l.id as string, label: l.label }))]}
          />
          {facets.languages.length > 1 && (
            <FilterChip
              label="Language"
              value={f.language}
              onChange={(v) => set("language", v)}
              width="w-36"
              options={[{ value: ANY, label: "All languages" }, ...facets.languages.map((l) => ({ value: l, label: languageName(l) }))]}
            />
          )}
          {filtering && (
            <Button variant="ghost" size="sm" onClick={() => setF((cur) => ({ ...NO_FILTERS, sort: cur.sort }))}>
              <XIcon /> Clear
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <FilterChip<SortKey>
              label="Sort by"
              value={f.sort}
              onChange={(v) => set("sort", v)}
              width="w-40"
              options={SORTS.map((s) => ({ value: s.id, label: s.label }))}
            />
            <div className="relative w-full sm:w-56">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                className="h-7 rounded-full pl-8"
                value={f.search}
                aria-label="Search books"
                placeholder="Search title, author, genre…"
                onChange={(e) => set("search", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {filtering && items.length > 0 && (
        <p className="text-muted-foreground -mt-2 text-xs">
          {items.length} of {all.length} books
        </p>
      )}

      {books.isLoading ? (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-md" />
          ))}
        </div>
      ) : books.isError ? (
        <EmptyState tone="error" title="Could not load the shelf">
          {books.error.message}
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState
          icon={BookOpenIcon}
          title={filtering ? "No matches" : "No books yet"}
          action={
            filtering ? (
              <Button variant="outline" onClick={() => setF((cur) => ({ ...NO_FILTERS, sort: cur.sort }))}>
                <XIcon />
                Clear filters
              </Button>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={openClassics}>
                  <LibraryIcon />
                  Start from a classic
                </Button>
                <Button variant="outline" onClick={() => setImporting(true)}>
                  <FileUpIcon />
                  Import manuscript
                </Button>
                <Button onClick={newBook}>
                  <PlusIcon />
                  New book
                </Button>
              </div>
            )
          }
        >
          {filtering
            ? "No book matches those filters."
            : "Import an EPUB, DOCX, PDF or text file, start from a public-domain classic, or start a blank book and write it here."}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((book, i) => (
            <BookCard
              key={book.id}
              book={book}
              index={i}
              // To the trash, with Undo: no "are you sure".
              onDelete={(b) =>
                remove(
                  { id: b.id, name: b.title },
                  { description: "With its chapters and voiced audio. In the trash for 30 days." },
                )
              }
              onDuplicate={(b) => duplicate.mutate({ id: b.id })}
              onMove={(b, p) => move.mutate({ id: b.id, project: p })}
              projects={projects.data}
            />
          ))}
        </div>
      )}

    </div>
  );
}
