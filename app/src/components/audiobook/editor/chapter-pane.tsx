/**
 * The editor's centre: one chapter's paragraphs.
 *
 * Keyboard (when not typing): j / k move, Enter edits, Space plays or stops,
 * L locks, G generates, M merges with the next paragraph, P inserts a pause,
 * Shift+Enter adds a paragraph after the selected one, Delete removes it,
 * Ctrl/Cmd+F opens find and replace, Escape clears the selection. While
 * editing, Alt+Enter splits at the cursor. Every edit here can be undone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ExternalLinkIcon,
  ListMusicIcon,
  LockIcon,
  PlayIcon,
  PlusIcon,
  SquareIcon,
  Trash2Icon,
  UnlockIcon,
  UserRoundPenIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import type { BookDetail, BookNote, ChapterWithStats, Paragraph } from "@/lib/audiobook-api";
import { abk, useParagraphs } from "@/lib/audiobook-queries";

import { characterById } from "./cast-colors";
import { CharacterMenuItems } from "./character-chip";
import { announce } from "./announce";
import { FindReplaceBar } from "./find-replace-bar";
import { NotesButton } from "./notes";
import { ParagraphRow, type RowActions } from "./paragraph-row";
import { useWindowedList } from "./use-windowed-list";
import type { BookOps } from "./use-book-ops";
import { useParagraphPlayer } from "./use-paragraph-player";
import { resolveModel, useTts } from "./use-tts";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable ||
    el.closest("[role=menu],[role=listbox],[role=dialog]") !== null
  );
}

export function ChapterPane({
  book,
  chapter,
  ops,
  selectedId,
  onSelect,
  checked,
  onChecked,
  findOpen,
  onFindOpen,
  notes,
  openNotesOnly = false,
  toolbar,
}: {
  book: BookDetail;
  chapter: ChapterWithStats;
  ops: BookOps;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  checked: Set<string>;
  onChecked: (next: Set<string>) => void;
  findOpen: boolean;
  onFindOpen: (open: boolean) => void;
  /** The book's review notes. */
  notes?: BookNote[];
  /** Show only paragraphs with an open note. */
  openNotesOnly?: boolean;
  /** Extra controls at the end of the chapter toolbar. */
  toolbar?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const paragraphs = useParagraphs(book.id, chapter.id);
  const tts = useTts();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<RegExp | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const player = useParagraphPlayer(onSelect);

  const all = useMemo(() => paragraphs.data ?? [], [paragraphs.data]);
  const notesBySegment = useMemo(() => {
    const m = new Map<string, BookNote[]>();
    for (const n of notes ?? []) {
      if (n.chapter_id !== chapter.id) continue;
      m.set(n.segment_id, [...(m.get(n.segment_id) ?? []), n]);
    }
    return m;
  }, [notes, chapter.id]);
  const filter = openNotesOnly
    ? (p: Paragraph) => (notesBySegment.get(p.id) ?? []).some((n) => !n.resolved)
    : null;
  const list = useMemo(
    () =>
      openNotesOnly
        ? all.filter((p) => (notesBySegment.get(p.id) ?? []).some((n) => !n.resolved))
        : all,
    [all, notesBySegment, openNotesOnly],
  );
  const lines = useMemo(() => list.filter((p) => p.kind === "line"), [list]);

  // Only rows near the viewport are mounted (a long chapter is thousands of
  // DOM nodes otherwise). The row being edited always stays mounted.
  const scrollRef = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => list.map((p) => p.id), [list]);
  const indexOf = useMemo(() => new Map(all.map((p, i) => [p.id, i])), [all]);
  const selected = list.find((p) => p.id === selectedId) ?? null;
  const win = useWindowedList({
    keys,
    scrollRef,
    keep: [editingId, selectedId].filter((x): x is string => !!x).map((id) => keys.indexOf(id)),
  });
  // A selection off screen (j/k, play to end) scrolls into view; the row's
  // own scrollIntoView handles the fine adjustment once it is mounted.
  // Keyed on the selection only: re-running when rows are measured would
  // pull the view back while someone scrolls away from it.
  const scrollTo = useRef(win.scrollToIndex);
  const keyList = useRef(keys);
  useEffect(() => {
    scrollTo.current = win.scrollToIndex;
    keyList.current = keys;
  });
  useEffect(() => {
    if (selectedId) scrollTo.current(keyList.current.indexOf(selectedId));
  }, [selectedId]);

  const generate = useCallback(
    (targets: Paragraph[]) => {
      for (const p of targets) {
        if (p.locked || !p.text.trim() || p.kind !== "line") continue;
        const character = characterById(book.characters, p.character_id);
        const model = resolveModel({
          paragraphModel: p.model_id,
          characterModel: character?.model_id ?? null,
          multiCast: book.settings.cast_mode === "multi",
          bookModel: book.settings.model_id,
          voiceId: p.voice_id,
          voices: tts.allVoices,
          models: tts.models,
        });
        if (!model) {
          toast.error("No text-to-speech model is installed.", {
            description: "Install one from the Models page to voice paragraphs.",
          });
          return;
        }
        setGenerating((s) => new Set(s).add(p.id));
        const done = () =>
          setGenerating((s) => {
            const next = new Set(s);
            next.delete(p.id);
            return next;
          });
        api
          .generateSegment(chapter.story_id, p.id, { model })
          .then(({ job_id }) => {
            const unsubscribe = api.subscribeJob(
              job_id,
              (job) => {
                if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
                  unsubscribe();
                  done();
                  if (job.status === "error") toast.error(job.error || "The read failed");
                  void qc.invalidateQueries({ queryKey: abk.paragraphs(book.id, chapter.id) });
                  void qc.invalidateQueries({ queryKey: abk.book(book.id), exact: true });
                }
              },
              (err) => {
                done();
                toast.error("The read failed", { description: errorMessage(err) });
              },
            );
          })
          .catch((err: unknown) => {
            done();
            toast.error("Could not start the read", { description: errorMessage(err) });
          });
      }
    },
    [book, chapter.id, chapter.story_id, qc, tts.allVoices, tts.models],
  );

  // Latest values for the stable row actions below.
  const latest = useRef({ all, checked, anchor, dragId, drop, chapter, ops, player, generate, onSelect, onChecked });
  useEffect(() => {
    latest.current = { all, checked, anchor, dragId, drop, chapter, ops, player, generate, onSelect, onChecked };
  });

  const byId = (id: string) => latest.current.all.find((p) => p.id === id) ?? null;

  const insertAfter = useCallback(async (after: Paragraph | null, kind: "line" | "pause") => {
    const { ops, chapter, onSelect } = latest.current;
    const made = await ops.insert(chapter.id, after, kind);
    if (made) {
      onSelect(made.id);
      if (kind === "line") setEditingId(made.id);
    }
  }, []);

  const actions = useMemo<RowActions>(
    () => ({
      select: (id) => latest.current.onSelect(id),
      check: (id, range) => {
        const { checked, anchor, all, onChecked } = latest.current;
        const next = new Set(checked);
        if (range && anchor) {
          const a = all.findIndex((p) => p.id === anchor);
          const b = all.findIndex((p) => p.id === id);
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (const p of all.slice(lo, hi + 1)) if (p.kind === "line") next.add(p.id);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        setAnchor(id);
        onChecked(next);
      },
      edit: setEditingId,
      commit: (id, text) => {
        const p = byId(id);
        if (p) void latest.current.ops.setText(p, text);
      },
      split: (id, text, at) => {
        const p = byId(id);
        if (!p) return;
        void latest.current.ops.split(p, text, at).then((second) => {
          if (second) latest.current.onSelect(second.id);
        });
      },
      mergeNext: (id) => {
        const p = byId(id);
        if (p) void latest.current.ops.mergeNext(p);
      },
      insertAfter: (id, kind) => void insertAfter(byId(id), kind),
      remove: (id) => {
        const p = byId(id);
        if (p) void latest.current.ops.remove([p]);
      },
      play: (p) => latest.current.player.toggle(p),
      lock: (p) => void latest.current.ops.setLocked([p], !p.locked),
      generate: (p) => latest.current.generate([p]),
      cast: (id, characterId) => {
        const p = byId(id);
        if (p) void latest.current.ops.cast([p], characterId);
      },
      dragStart: (id) => setDragId(id),
      dragOver: (id, after) =>
        setDrop((d) => (d?.id === id && d.after === after ? d : { id, after })),
      drop: () => {
        const { dragId, drop, all, ops, chapter } = latest.current;
        setDragId(null);
        setDrop(null);
        if (!dragId || !drop || dragId === drop.id) return;
        const before = all.map((p) => p.id);
        const after = before.filter((id) => id !== dragId);
        const at = after.indexOf(drop.id) + (drop.after ? 1 : 0);
        after.splice(at, 0, dragId);
        if (after.join() !== before.join()) void ops.reorderParagraphs(chapter.id, before, after);
      },
      dragEnd: () => {
        setDragId(null);
        setDrop(null);
      },
      move: (id, by) => {
        const { all, ops, chapter } = latest.current;
        const before = all.map((p) => p.id);
        const i = before.indexOf(id);
        const j = i + by;
        if (i < 0 || j < 0 || j >= before.length) {
          announce(by < 0 ? "Already the first paragraph" : "Already the last paragraph");
          return;
        }
        const after = [...before];
        [after[i], after[j]] = [after[j]!, after[i]!];
        void ops.reorderParagraphs(chapter.id, before, after).then(() =>
          announce(`Moved to position ${j + 1} of ${after.length}`),
        );
      },
    }),
    [insertAfter],
  );

  const playAt = player.playAt;
  const position = player.position;
  const playingId = player.playingId;
  const rowActions = useMemo<RowActions>(
    () => ({
      ...actions,
      extra: (p) =>
        p.kind === "line" ? (
          <NotesButton
            bookId={book.id}
            paragraph={p}
            notes={notesBySegment.get(p.id) ?? []}
            position={() => (playingId === p.id ? position() : null)}
            onPlayAt={(t) => playAt(p, t)}
          />
        ) : null,
    }),
    [actions, book.id, notesBySegment, playAt, playingId, position],
  );

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A control that handled the key itself (a chapter's Alt+arrow, a menu)
      // has claimed it.
      if (e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        onFindOpen(true);
        return;
      }
      // Alt+Up/Down moves the selected paragraph: the keyboard way to do
      // what the drag handle does.
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && selected && !isTyping(e.target)) {
        e.preventDefault();
        actions.move(selected.id, e.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const i = selected ? lines.findIndex((p) => p.id === selected.id) : -1;
      const targets = checked.size > 0 ? all.filter((p) => checked.has(p.id)) : selected ? [selected] : [];
      switch (e.key) {
        case "j":
        case "ArrowDown": {
          const next = lines[Math.min(lines.length - 1, i + 1)];
          if (next) {
            e.preventDefault();
            onSelect(next.id);
          }
          break;
        }
        case "k":
        case "ArrowUp": {
          const prev = lines[Math.max(0, i - 1)];
          if (prev) {
            e.preventDefault();
            onSelect(prev.id);
          }
          break;
        }
        case "Enter":
          if (selected && e.shiftKey) {
            e.preventDefault();
            void insertAfter(selected, "line");
          } else if (selected && !selected.locked && selected.kind === "line") {
            e.preventDefault();
            setEditingId(selected.id);
          }
          break;
        case " ":
          if (selected) {
            e.preventDefault();
            player.toggle(selected);
          }
          break;
        case "l":
        case "L":
          if (targets.length) {
            e.preventDefault();
            void ops.setLocked(targets, !targets.every((p) => p.locked));
          }
          break;
        case "g":
        case "G":
          if (targets.length) {
            e.preventDefault();
            generate(targets);
          }
          break;
        case "m":
        case "M":
          if (selected) {
            e.preventDefault();
            void ops.mergeNext(selected);
          }
          break;
        case "p":
        case "P":
          if (selected) {
            e.preventDefault();
            void insertAfter(selected, "pause");
          }
          break;
        case "Delete":
          if (targets.length) {
            e.preventDefault();
            void ops.remove(targets);
            onChecked(new Set());
          }
          break;
        case "Escape":
          if (findOpen) onFindOpen(false);
          else if (checked.size) onChecked(new Set());
          else onSelect(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, all, checked, findOpen, generate, insertAfter, lines, onChecked, onFindOpen, onSelect, ops, player, selected]);

  // Status changes that arrive from elsewhere (a render run, a regenerate),
  // read out once per refresh rather than per paragraph.
  const lastStatus = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const prev = lastStatus.current;
    const next = new Map(all.map((p) => [p.id, p.status]));
    lastStatus.current = next;
    if (!prev) return;
    let voiced = 0;
    let stale = 0;
    for (const [id, status] of next) {
      const was = prev.get(id);
      if (!was || was === status) continue;
      // Only voicing changes: a new take, or a take going stale. Locking
      // and unlocking announce themselves.
      if (status === "voiced" && (was === "unvoiced" || was === "stale")) voiced++;
      else if (status === "stale" && was === "voiced") stale++;
    }
    const parts = [];
    if (voiced) parts.push(`${voiced} paragraph${voiced === 1 ? "" : "s"} voiced`);
    if (stale) parts.push(`${stale} now stale`);
    if (parts.length) announce(parts.join(", "));
  }, [all]);

  const checkedList = all.filter((p) => checked.has(p.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {findOpen && (
        <FindReplaceBar
          bookId={book.id}
          chapterId={chapter.id}
          onChange={setHighlight}
          onClose={() => onFindOpen(false)}
        />
      )}

      <div className="border-border/60 flex flex-wrap items-center gap-2 border-b px-4 py-2">
        {checked.size > 0 ? (
          <>
            <span className="text-sm font-medium">{checked.size} selected</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <UserRoundPenIcon />
                  Assign character
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <CharacterMenuItems
                  characters={book.characters}
                  value={undefined}
                  onSelect={(id) => void ops.cast(checkedList, id)}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="outline" onClick={() => generate(checkedList)}>
              Generate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void ops.setLocked(checkedList, true)}>
              <LockIcon />
              Lock
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void ops.setLocked(checkedList, false)}>
              <UnlockIcon />
              Unlock
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                void ops.remove(checkedList);
                onChecked(new Set());
              }}
            >
              <Trash2Icon />
              Delete
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label="Clear selection" onClick={() => onChecked(new Set())}>
              <XIcon />
            </Button>
          </>
        ) : (
          <>
            <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{chapter.title}</h2>
            {toolbar}
            {player.continuous ? (
              <Button size="sm" variant="outline" onClick={player.stop}>
                <SquareIcon />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={!lines.some((p) => p.sound)}
                title="Play from the selected paragraph to the end of the chapter"
                onClick={() => player.playFrom(lines, selected?.id ?? lines[0]?.id ?? "")}
              >
                <PlayIcon />
                Play to end
              </Button>
            )}
            <Button size="sm" variant="ghost" asChild>
              <Link to={`/studio/script/${chapter.story_id}`}>
                <ListMusicIcon />
                Open in timeline
                <ExternalLinkIcon className="text-muted-foreground" />
              </Link>
            </Button>
          </>
        )}
      </div>

      <div
        ref={scrollRef}
        id="audiobook-paragraphs"
        tabIndex={-1}
        aria-describedby="audiobook-paragraph-keys"
        className="min-h-0 flex-1 overflow-y-auto py-2 outline-none"
        role="list"
        aria-label={`${chapter.title} paragraphs`}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
        }}
      >
        {paragraphs.isLoading ? (
          <div className="space-y-2 px-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            size="sm"
            className="mx-4"
            action={
              !filter && (
                <Button size="sm" variant="outline" onClick={() => void insertAfter(null, "line")}>
                  <PlusIcon />
                  Add paragraph
                </Button>
              )
            }
          >
            {filter ? "No paragraphs match the filter in this chapter." : "This chapter has no paragraphs yet."}
          </EmptyState>
        ) : (
          <>
          <div aria-hidden="true" style={{ height: win.padTop }} />
          {list.slice(win.start, win.end).map((p) => (
            <div key={p.id} ref={win.measure(p.id)}>
            <ParagraphRow
              bookId={book.id}
              paragraph={p}
              index={indexOf.get(p.id) ?? 0}
              isLast={all[all.length - 1]?.id === p.id}
              character={characterById(book.characters, p.character_id)}
              characters={book.characters}
              selected={p.id === selectedId}
              checked={checked.has(p.id)}
              editing={p.id === editingId}
              playing={p.id === player.playingId}
              generating={generating.has(p.id)}
              dragging={p.id === dragId}
              dropEdge={drop?.id === p.id && dragId !== p.id ? (drop.after ? "after" : "before") : null}
              highlight={highlight}
              anySelected={selectedId !== null && keys.includes(selectedId)}
              actions={rowActions}
            />
            </div>
          ))}
          <div aria-hidden="true" style={{ height: win.padBottom }} />
          </>
        )}
        {all.length > 0 && !filter && (
          <div className="flex gap-1 px-4 pt-2 pb-6">
            <Button size="sm" variant="ghost" onClick={() => void insertAfter(all[all.length - 1] ?? null, "line")}>
              <PlusIcon />
              Add paragraph
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void insertAfter(all[all.length - 1] ?? null, "pause")}>
              <PlusIcon />
              Add pause
            </Button>
          </div>
        )}
      </div>

      <div
        id="audiobook-paragraph-keys"
        className="border-border/60 text-muted-foreground hidden flex-wrap gap-x-3 gap-y-1 border-t px-4 py-1.5 text-[0.7rem] lg:flex"
      >
        <span><Kbd>j</Kbd>/<Kbd>k</Kbd> move</span>
        <span><Kbd>Enter</Kbd> edit</span>
        <span><Kbd>Alt</Kbd>+<Kbd>Enter</Kbd> split</span>
        <span><Kbd>M</Kbd> merge</span>
        <span><Kbd>P</Kbd> pause</span>
        <span><Kbd>Space</Kbd> play</span>
        <span><Kbd>L</Kbd> lock</span>
        <span><Kbd>G</Kbd> generate</span>
        <span><Kbd>Alt</Kbd>+<Kbd>↑</Kbd>/<Kbd>↓</Kbd> move</span>
        <span><Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> undo</span>
        <span><Kbd>Ctrl</Kbd>+<Kbd>F</Kbd> find</span>
      </div>
    </div>
  );
}
