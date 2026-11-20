/**
 * The editor's left column: chapters in book order. Add, rename (double
 * click), drag to reorder, set kind, include or exclude, delete. The dot is
 * the chapter's voicing status.
 */

import { memo, useState, type DragEvent } from "react";
import {
  ClipboardPasteIcon,
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { CHAPTER_KIND_LABELS, type BookDetail, type ChapterWithStats } from "@/lib/audiobook-api";
import {
  useAddChapter,
  useDeleteChapter,
  useUpdateChapter,
} from "@/lib/audiobook-queries";
import type { ChapterKind, ChapterStatus } from "@/lib/audiobook-types";
import { formatDuration } from "@/lib/format";

import { announce } from "./announce";
import { ChapterFromTextDialog } from "./chapter-from-text";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<ChapterStatus, { className: string; label: string }> = {
  empty: { className: "bg-muted-foreground/30", label: "Not voiced" },
  partial: { className: "bg-warn", label: "Partly voiced" },
  voiced: { className: "bg-ok", label: "Voiced" },
  mastered: { className: "bg-primary", label: "Mastered" },
};

function ChapterListView({
  book,
  selectedId,
  onSelect,
  onReorder,
  noteCounts,
}: {
  book: BookDetail;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Undoable reorder: the order before and after. */
  onReorder: (before: string[], after: string[]) => void;
  /** Open review notes per chapter id. */
  noteCounts?: Record<string, number>;
}) {
  const add = useAddChapter(book.id);
  const update = useUpdateChapter(book.id);
  const reorder = (ids: string[]) => onReorder(chapters.map((c) => c.id), ids);
  const remove = useDeleteChapter(book.id);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [fromText, setFromText] = useState(false);

  const chapters = book.chapters;

  const commitRename = (chapter: ChapterWithStats) => {
    const title = draft.trim();
    setRenaming(null);
    if (title && title !== chapter.title) update.mutate({ id: chapter.id, patch: { title } });
  };

  const onDrop = (event: DragEvent, target: ChapterWithStats) => {
    event.preventDefault();
    setOverId(null);
    if (!dragId || dragId === target.id) return;
    const ids = chapters.map((c) => c.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(target.id) + (chapters.findIndex((c) => c.id === dragId) < chapters.findIndex((c) => c.id === target.id) ? 1 : 0), 0, dragId);
    reorder(ids);
    setDragId(null);
  };

  const addChapter = () =>
    add.mutate(
      { title: `Chapter ${chapters.filter((c) => c.kind === "chapter").length + 1}` },
      { onSuccess: (c) => onSelect(c.id) },
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Chapters
        </h2>
        <Button size="icon-xs" variant="ghost" aria-label="Add chapter" onClick={addChapter}>
          <PlusIcon />
        </Button>
      </div>
      <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-3" aria-label="Chapters">
        {chapters.map((chapter, i) => {
          const dot = STATUS_DOT[chapter.status];
          const selected = chapter.id === selectedId;
          return (
            <li
              key={chapter.id}
              draggable={renaming !== chapter.id}
              onDragStart={(e) => {
                setDragId(chapter.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverId(chapter.id);
              }}
              onDragLeave={() => setOverId((id) => (id === chapter.id ? null : id))}
              onDrop={(e) => onDrop(e, chapter)}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              className={cn(
                "group relative flex items-center gap-1 rounded-md pr-1 text-sm",
                selected ? "bg-accent text-foreground" : "hover:bg-accent/50",
                overId === chapter.id && dragId !== chapter.id && "ring-primary/60 ring-1",
                dragId === chapter.id && "opacity-50",
                !chapter.included && "text-muted-foreground",
              )}
            >
              <GripVerticalIcon
                aria-hidden="true"
                className="text-muted-foreground/50 size-3.5 shrink-0 cursor-grab opacity-0 group-hover:opacity-100"
              />
              {renaming === chapter.id ? (
                <Input
                  autoFocus
                  value={draft}
                  aria-label="Chapter title"
                  className="h-7 text-sm"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(chapter)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(chapter);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
                  onClick={() => onSelect(chapter.id)}
                  onKeyDown={(e) => {
                    // Alt+Up/Down: the keyboard way to drag a chapter.
                    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                    e.preventDefault();
                    const j = i + (e.key === "ArrowUp" ? -1 : 1);
                    if (j < 0 || j >= chapters.length) return;
                    const ids = chapters.map((c) => c.id);
                    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
                    reorder(ids);
                    announce(`${chapter.title} moved to position ${j + 1} of ${ids.length}`);
                  }}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onDoubleClick={() => {
                    setDraft(chapter.title);
                    setRenaming(chapter.id);
                  }}
                  aria-current={selected ? "true" : undefined}
                >
                  <span
                    aria-hidden="true"
                    className={cn("size-2 shrink-0 rounded-full", dot.className)}
                    title={dot.label}
                  />
                  <span className="sr-only">{dot.label}: </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate", !chapter.included && "line-through")}>
                      {chapter.title}
                    </span>
                    <span className="text-muted-foreground block truncate text-[0.7rem]">
                      {chapter.kind !== "chapter" ? `${CHAPTER_KIND_LABELS[chapter.kind]} · ` : ""}
                      {chapter.stats.voiced}/{chapter.stats.paragraphs}
                      {chapter.stats.duration_s > 0 ? ` · ${formatDuration(chapter.stats.duration_s)}` : ""}
                      {noteCounts?.[chapter.id] ? (
                        <span className="text-warn" title="Open review notes">
                          {" · "}
                          {noteCounts[chapter.id]} note{noteCounts[chapter.id] === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              )}
              <Button
                size="icon-xs"
                variant="ghost"
                className={cn("opacity-0 group-hover:opacity-100 focus-visible:opacity-100", !chapter.included && "opacity-100")}
                aria-label={chapter.included ? `Exclude ${chapter.title}` : `Include ${chapter.title}`}
                title={chapter.included ? "Included in render and export" : "Excluded from render and export"}
                onClick={() => update.mutate({ id: chapter.id, patch: { included: !chapter.included } })}
              >
                {chapter.included ? <EyeIcon /> : <EyeOffIcon />}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`More for ${chapter.title}`}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                  >
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem
                    onSelect={() => {
                      setDraft(chapter.title);
                      setRenaming(chapter.id);
                    }}
                  >
                    <PencilIcon />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Kind</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={chapter.kind}
                    onValueChange={(kind) =>
                      update.mutate({ id: chapter.id, patch: { kind: kind as ChapterKind } })
                    }
                  >
                    {(Object.keys(CHAPTER_KIND_LABELS) as ChapterKind[]).map((kind) => (
                      <DropdownMenuRadioItem key={kind} value={kind}>
                        {CHAPTER_KIND_LABELS[kind]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={i === 0}
                    onSelect={() => {
                      const ids = chapters.map((c) => c.id);
                      [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!];
                      reorder(ids);
                    }}
                  >
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={i === chapters.length - 1}
                    onSelect={() => {
                      const ids = chapters.map((c) => c.id);
                      [ids[i + 1], ids[i]] = [ids[i]!, ids[i + 1]!];
                      reorder(ids);
                    }}
                  >
                    Move down
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={chapters.length <= 1}
                    onSelect={() => {
                      if (window.confirm(`Delete “${chapter.title}” and its audio?`)) {
                        remove.mutate(chapter.id, {
                          onSuccess: () => {
                            const next = chapters[i + 1] ?? chapters[i - 1];
                            if (selected && next) onSelect(next.id);
                          },
                        });
                      }
                    }}
                  >
                    <Trash2Icon />
                    Delete chapter
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ol>
      <div className="border-border/60 space-y-0.5 border-t p-2">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={addChapter}>
          <PlusIcon />
          Add chapter
        </Button>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setFromText(true)}>
          <ClipboardPasteIcon />
          Chapter from text…
        </Button>
      </div>
      <ChapterFromTextDialog
        bookId={book.id}
        open={fromText}
        onOpenChange={setFromText}
        onCreated={onSelect}
      />
    </div>
  );
}

/** Memoised: the editor re-renders on every paragraph selection, and the
 *  chapter list only changes with the book. */
export const ChapterList = memo(ChapterListView);
