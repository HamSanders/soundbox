/**
 * The book editor, full-bleed: chapters on the left, the open chapter's
 * paragraphs in the centre, the inspector on the right, and the book's
 * settings across the top. The render bar (from the voice area) sits under
 * the header. `?chapter=` keeps the open chapter in the URL.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquareTextIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { keepDetail } from "@/lib/dock";

import { BookHeader } from "@/components/audiobook/editor/book-header";
import { ChapterList } from "@/components/audiobook/editor/chapter-list";
import { ChapterPane } from "@/components/audiobook/editor/chapter-pane";
import { ChapterTimeline } from "@/components/audiobook/editor/chapter-timeline";
import { TimelineDock } from "@/components/audiobook/editor/timeline-dock";
import { Inspector } from "@/components/audiobook/editor/inspector";
import { announce } from "@/components/audiobook/editor/announce";
import { LiveRegion } from "@/components/audiobook/editor/announcer";
import { useBookOps } from "@/components/audiobook/editor/use-book-ops";
import { RenderBar } from "@/components/audiobook/render";
import { AssistantChat } from "@/components/assistant-chat";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useEditHistory } from "@/hooks/use-edit-history";
import { useAgentScope } from "@/lib/agent-scope";
import { bookThread } from "@/lib/assistant-store";
import { useBook, useBookEvents, useNotes, useParagraphs } from "@/lib/audiobook-queries";
import { useAssistantEnabled, useVoices } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { flushPending, undoPending, useHiddenStore } from "@/lib/undo";

export function AudiobookPage() {
  const { id = "" } = useParams();
  const book = useBook(id);
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [findOpen, setFindOpen] = useState(false);
  const [openNotesOnly, setOpenNotesOnly] = useState(false);
  /** The paragraph under the docked timeline's playhead. */
  const [followId, setFollowId] = useState<string | null>(null);
  const notes = useNotes(id);
  useBookEvents(id);
  const history = useEditHistory();
  const ops = useBookOps(id, history);

  const undo = useCallback(() => {
    // A chapter deleted a moment ago is still on its toast, and newer than
    // anything on the history: put it back first.
    const pending = undoPending(`book:${id}`);
    if (pending) return announce(`Undid: ${pending}`);
    if (!history.canUndo) return announce("Nothing to undo");
    announce(`Undid ${history.undoLabel ?? "the last edit"}`);
    history.undo();
  }, [history, id]);
  const redo = useCallback(() => {
    if (!history.canRedo) return announce("Nothing to redo");
    announce("Redone");
    history.redo();
  }, [history]);

  // Undo and redo, unless a text field has its own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [redo, undo]);

  // A chapter deleted but still on its Undo toast is left out everywhere.
  const hidden = useHiddenStore((s) => s.ids);
  const visible = useMemo(
    () => (book.data ? { ...book.data, chapters: book.data.chapters.filter((c) => !hidden[`chapter:${c.id}`]) } : undefined),
    [book.data, hidden],
  );
  const chapters = useMemo(() => visible?.chapters ?? [], [visible]);
  const chapterId = params.get("chapter");
  const chapter =
    chapters.find((c) => c.id === chapterId) ??
    chapters.find((c) => c.kind === "chapter") ??
    chapters[0] ??
    null;

  const paragraphs = useParagraphs(id, chapter?.id ?? null);
  const paragraph = paragraphs.data?.find((p) => p.id === selectedId) ?? null;

  /**
   * The assistant beside the book. It works through the MCP toolkit (see
   * `lib/agent-scope.ts`), so this page lends it what is open, read fresh on
   * each turn, and names for the ids its proposals mention.
   */
  const [side, setSide] = useState<"inspector" | "assistant">("inspector");
  const assistantOn = useAssistantEnabled();
  const voices = useVoices();
  const qc = useQueryClient();
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of book.data?.chapters ?? []) map.set(c.id, `“${c.title}”`);
    for (const c of book.data?.characters ?? []) map.set(c.id, c.name);
    for (const v of voices.data ?? []) map.set(v.id, v.name);
    for (const p of paragraphs.data ?? []) {
      const words = p.text.trim().split(/\s+/).slice(0, 6).join(" ");
      map.set(p.id, words ? `“${words}…”` : "an empty paragraph");
    }
    return map;
  }, [book.data, voices.data, paragraphs.data]);
  const live = useRef({ chapterId: null as string | null, selected: [] as string[], names });
  useEffect(() => {
    live.current = {
      chapterId: chapter?.id ?? null,
      selected: checked.size ? [...checked] : selectedId ? [selectedId] : [],
      names,
    };
  });
  const lendScope = useAgentScope((s) => s.lend);
  const reclaimScope = useAgentScope((s) => s.reclaim);
  useEffect(() => {
    lendScope({
      bookId: id,
      chapterId: () => live.current.chapterId,
      selectedIds: () => live.current.selected,
      nameOf: (x) => live.current.names.get(x),
      // A tool may have changed anything in the book, its stories or the
      // library: refetch what this page shows. The editor's own undo steps
      // were written against the book as it was.
      changed: () => {
        void qc.invalidateQueries({ queryKey: ["audiobook", id] });
        void qc.invalidateQueries({ queryKey: ["audiobooks"] });
        void qc.invalidateQueries({ queryKey: ["stories"] });
        void qc.invalidateQueries({ queryKey: ["story"] });
      },
    });
    return () => reclaimScope(id);
  }, [id, lendScope, qc, reclaimScope]);

  const selectChapter = useCallback(
    (cid: string) => {
      setParams(keepDetail({ chapter: cid }), { replace: true });
      setSelectedId(null);
      setChecked(new Set());
      setFollowId(null);
    },
    [setParams],
  );

  // Stable props for the memoised header and chapter list, so moving the
  // paragraph selection re-renders neither.
  const toggleFind = useCallback(() => setFindOpen((o) => !o), []);
  const onRestored = useCallback(() => {
    history.clear();
    setSelectedId(null);
    setChecked(new Set());
  }, [history]);
  const reorderChapters = useCallback(
    // The server checks the order names every chapter, so a delete still
    // on its toast is sent first rather than left out of the list.
    (before: string[], after: string[]) =>
      void flushPending().then(() => ops.reorderChapters(before, after)),
    [ops],
  );
  const noteCounts = useMemo(
    () => Object.fromEntries((book.data?.chapters ?? []).map((c) => [c.id, c.open_notes])),
    [book.data],
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
  if (book.isError || !visible) {
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

  const data = visible;
  const panel = "bg-card border-border/70 flex min-h-0 flex-col overflow-hidden rounded-xl border";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 md:pr-2 md:pb-2">
      <LiveRegion />
      <a
        href="#audiobook-paragraphs"
        onClick={(e) => {
          e.preventDefault();
          const row = document.querySelector<HTMLElement>("#audiobook-paragraphs [role=listitem][tabindex='0']");
          (row ?? document.getElementById("audiobook-paragraphs"))?.focus();
        }}
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-1.5 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to paragraphs
      </a>
      <div className={panel}>
        <BookHeader
          book={data}
          findOpen={findOpen}
          onToggleFind={toggleFind}
          onRestored={onRestored}
        />
        <RenderBar bookId={data.id} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row">
        <nav className={`${panel} md:w-60 md:shrink-0`} aria-label="Chapters">
          <ChapterList
            book={data}
            selectedId={chapter?.id ?? null}
            onSelect={selectChapter}
            onReorder={reorderChapters}
            noteCounts={noteCounts}
          />
        </nav>
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
                    onClick={undo}
                  >
                    <Undo2Icon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Redo"
                    title="Redo (Ctrl+Shift+Z)"
                    disabled={!history.canRedo}
                    onClick={redo}
                  >
                    <Redo2Icon />
                  </Button>
                </>
              }
              selectedId={selectedId}
              onSelect={setSelectedId}
              followId={followId}
              checked={checked}
              onChecked={setChecked}
              findOpen={findOpen}
              onFindOpen={setFindOpen}
            />
          ) : (
            <EmptyState className="m-4">This book has no chapters. Add one on the left.</EmptyState>
          )}
        </section>
        <aside className={`${panel} md:w-80 md:shrink-0`} aria-label={side === "assistant" && assistantOn ? "Assistant" : "Inspector"}>
          {assistantOn && (
            <div role="tablist" aria-label="Side panel" className="border-border/60 flex shrink-0 gap-1 border-b px-2 pt-2">
              {(["inspector", "assistant"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={side === tab}
                  className={cn(
                    "-mb-px border-b-2 px-2.5 pb-1.5 text-xs font-medium capitalize transition-colors",
                    side === tab
                      ? "border-primary text-foreground"
                      : "text-muted-foreground hover:text-foreground border-transparent",
                  )}
                  onClick={() => setSide(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}
          {side === "assistant" && assistantOn ? (
            <AssistantChat threadKey={bookThread(data.id)} className="min-h-0 flex-1" inset />
          ) : (
            <Inspector
              book={data}
              chapter={chapter}
              paragraph={paragraph}
              selectedCount={checked.size}
              ops={ops}
              paragraphNumber={(paragraphs.data ?? []).findIndex((p) => p.id === selectedId) + 1}
              onLockSelection={(locked) =>
                void ops.setLocked((paragraphs.data ?? []).filter((p) => checked.has(p.id)), locked)
              }
            />
          )}
        </aside>
      </div>
      {chapter && (
        <TimelineDock title={chapter.title}>
          <ChapterTimeline
            key={chapter.id}
            book={data}
            chapter={chapter}
            paragraphs={paragraphs.data ?? []}
            ops={ops}
            history={history}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onActiveParagraph={setFollowId}
          />
        </TimelineDock>
      )}
    </div>
  );
}
