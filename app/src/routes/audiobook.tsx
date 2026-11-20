/**
 * The book editor, full-bleed: chapters on the left, the open chapter's
 * paragraphs in the centre, the inspector on the right, and the book's
 * settings across the top. The render bar (from the voice area) sits under
 * the header. `?chapter=` keeps the open chapter in the URL.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquareTextIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { BookHeader } from "@/components/audiobook/editor/book-header";
import { ChapterList } from "@/components/audiobook/editor/chapter-list";
import { ChapterPane } from "@/components/audiobook/editor/chapter-pane";
import { Inspector } from "@/components/audiobook/editor/inspector";
import { useBookOps } from "@/components/audiobook/editor/use-book-ops";
import { RenderBar } from "@/components/audiobook/render";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useEditHistory } from "@/hooks/use-edit-history";
import { useBook, useBookEvents, useNotes, useParagraphs } from "@/lib/audiobook-queries";

export function AudiobookPage() {
  const { id = "" } = useParams();
  const book = useBook(id);
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [findOpen, setFindOpen] = useState(false);
  const [openNotesOnly, setOpenNotesOnly] = useState(false);
  const notes = useNotes(id);
  useBookEvents(id);
  const history = useEditHistory();
  const ops = useBookOps(id, history);

  // Undo and redo, unless a text field has its own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        history.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history]);

  const chapters = useMemo(() => book.data?.chapters ?? [], [book.data]);
  const chapterId = params.get("chapter");
  const chapter =
    chapters.find((c) => c.id === chapterId) ??
    chapters.find((c) => c.kind === "chapter") ??
    chapters[0] ??
    null;

  const paragraphs = useParagraphs(id, chapter?.id ?? null);
  const paragraph = paragraphs.data?.find((p) => p.id === selectedId) ?? null;

  const selectChapter = useCallback(
    (cid: string) => {
      setParams({ chapter: cid }, { replace: true });
      setSelectedId(null);
      setChecked(new Set());
    },
    [setParams],
  );

  if (book.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 gap-2 p-4">
        <Skeleton className="w-60 rounded-xl" />
        <Skeleton className="flex-1 rounded-xl" />
        <Skeleton className="w-80 rounded-xl" />
      </div>
    );
  }
  if (book.isError || !book.data) {
    return (
      <div className="p-6">
        <EmptyState
          tone="error"
          title="Book not found"
          action={
            <Button variant="outline" asChild>
              <Link to="/audiobooks">Back to the shelf</Link>
            </Button>
          }
        >
          {book.error?.message ?? "It may have been deleted."}
        </EmptyState>
      </div>
    );
  }

  const data = book.data;
  const panel = "bg-card border-border/70 flex min-h-0 flex-col overflow-hidden rounded-xl border";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 md:pr-2 md:pb-2">
      <div className={panel}>
        <BookHeader book={data} findOpen={findOpen} onToggleFind={() => setFindOpen((o) => !o)} />
        <RenderBar bookId={data.id} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row">
        <aside className={`${panel} md:w-60 md:shrink-0`} aria-label="Chapters">
          <ChapterList
            book={data}
            selectedId={chapter?.id ?? null}
            onSelect={selectChapter}
            onReorder={(before, after) => void ops.reorderChapters(before, after)}
            noteCounts={Object.fromEntries(data.chapters.map((c) => [c.id, c.open_notes]))}
          />
        </aside>
        <section className={`${panel} min-h-[50vh] flex-1 md:min-h-0`} aria-label="Paragraphs">
          {chapter ? (
            <ChapterPane
              // Remounted per chapter: a switch stops playback and editing.
              key={chapter.id}
              book={data}
              chapter={chapter}
              ops={ops}
              notes={notes.data}
              openNotesOnly={openNotesOnly}
              toolbar={
                <>
                  {(data.stats.open_notes > 0 || openNotesOnly) && (
                    <Button
                      size="sm"
                      variant={openNotesOnly ? "secondary" : "ghost"}
                      aria-pressed={openNotesOnly}
                      title="Show only paragraphs with open review notes"
                      onClick={() => setOpenNotesOnly((v) => !v)}
                    >
                      <MessageSquareTextIcon />
                      Open notes ({chapter.open_notes})
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Undo"
                    title={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : "Undo (Ctrl+Z)"}
                    disabled={!history.canUndo}
                    onClick={history.undo}
                  >
                    <Undo2Icon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Redo"
                    title="Redo (Ctrl+Shift+Z)"
                    disabled={!history.canRedo}
                    onClick={history.redo}
                  >
                    <Redo2Icon />
                  </Button>
                </>
              }
              selectedId={selectedId}
              onSelect={setSelectedId}
              checked={checked}
              onChecked={setChecked}
              findOpen={findOpen}
              onFindOpen={setFindOpen}
            />
          ) : (
            <EmptyState className="m-4">This book has no chapters. Add one on the left.</EmptyState>
          )}
        </section>
        <aside className={`${panel} md:w-80 md:shrink-0`} aria-label="Inspector">
          <Inspector
            book={data}
            chapter={chapter}
            paragraph={paragraph}
            selectedCount={checked.size}
            ops={ops}
            onLockSelection={(locked) =>
              void ops.setLocked((paragraphs.data ?? []).filter((p) => checked.has(p.id)), locked)
            }
          />
        </aside>
      </div>
    </div>
  );
}
