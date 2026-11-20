/**
 * The audiobook shelf: every book as a cover, with how much of it is voiced.
 * Start a blank book or import a manuscript from here; open one to edit it.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpenIcon, FileUpIcon, PlusIcon, SearchIcon } from "lucide-react";

import { ImportWizard } from "@/components/audiobook/import";
import { BookCard, bookProgress } from "@/components/audiobook/shelf/book-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BookSummary } from "@/lib/audiobook-api";
import { useBooks, useCreateBook, useDeleteBook } from "@/lib/audiobook-queries";
import { formatDuration } from "@/lib/format";

type Filter = "all" | "progress" | "done";

const SEARCH_THRESHOLD = 6;

export function AudiobooksPage() {
  const navigate = useNavigate();
  const books = useBooks();
  const create = useCreateBook();
  const remove = useDeleteBook();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [importing, setImporting] = useState(false);
  const [doomed, setDoomed] = useState<BookSummary | null>(null);

  const all = books.data ?? [];
  const counts = useMemo(() => {
    const done = all.filter((b) => b.stats.paragraphs > 0 && bookProgress(b) === 100).length;
    return { all: all.length, done, progress: all.length - done };
  }, [all]);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((b) => {
      const finished = b.stats.paragraphs > 0 && bookProgress(b) === 100;
      if (filter === "done" && !finished) return false;
      if (filter === "progress" && finished) return false;
      if (!q) return true;
      return [b.title, b.author ?? "", b.series ?? "", ...b.genres].some((s) =>
        s.toLowerCase().includes(q),
      );
    });
  }, [all, search, filter]);

  const totalVoiced = all.reduce((n, b) => n + b.stats.duration_s, 0);

  const newBook = () =>
    create.mutate({}, { onSuccess: (book) => navigate(`/audiobooks/${book.id}`) });

  return (
    <div className="space-y-5">
      <ImportWizard
        open={importing}
        onOpenChange={setImporting}
        onImported={(id) => navigate(`/audiobooks/${id}`)}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Audiobooks</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Turn a manuscript into a narrated book, chapter by chapter, with a voice for every
            character.
            {totalVoiced > 0 ? ` ${formatDuration(totalVoiced)} voiced so far.` : ""}
          </p>
        </div>
        <div className="flex gap-2">
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

      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {counts.done > 0 && counts.progress > 0 && (
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList>
                <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
                <TabsTrigger value="progress">In progress ({counts.progress})</TabsTrigger>
                <TabsTrigger value="done">Voiced ({counts.done})</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {all.length > SEARCH_THRESHOLD && (
            <div className="relative ml-auto w-full max-w-xs sm:w-64">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                className="pl-8"
                value={search}
                placeholder="Search title, author, genre…"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
        </div>
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
          title={search ? undefined : "No books yet"}
          action={
            !search && (
              <div className="flex gap-2">
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
          {search
            ? "Nothing matches that."
            : "Import an EPUB, DOCX, PDF or text file, or start a blank book and write it here."}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((book, i) => (
            <BookCard key={book.id} book={book} index={i} onDelete={setDoomed} />
          ))}
        </div>
      )}

      <Dialog open={doomed !== null} onOpenChange={(open) => !open && setDoomed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{doomed?.title}”?</DialogTitle>
            <DialogDescription>
              Its chapters, paragraphs and voiced audio are deleted too. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDoomed(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                doomed && remove.mutate(doomed.id, { onSuccess: () => setDoomed(null) })
              }
            >
              Delete book
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
