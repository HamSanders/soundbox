/**
 * The editor's centre: one chapter's paragraphs.
 *
 * Keyboard (when not typing): j / k move, Enter edits, Space plays or stops,
 * L locks, G generates, Shift+Enter adds a paragraph after the selected one,
 * Ctrl/Cmd+F opens find and replace, Escape clears the selection.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { BookDetail, ChapterWithStats, Paragraph } from "@/lib/audiobook-api";
import {
  abk,
  useAddParagraph,
  useCastParagraphs,
  useDeleteParagraph,
  useParagraphs,
  useUpdateParagraph,
} from "@/lib/audiobook-queries";

import { characterById } from "./cast-colors";
import { CharacterMenuItems } from "./character-chip";
import { FindReplaceBar } from "./find-replace-bar";
import { ParagraphRow } from "./paragraph-row";
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
  selectedId,
  onSelect,
  checked,
  onChecked,
  findOpen,
  onFindOpen,
}: {
  book: BookDetail;
  chapter: ChapterWithStats;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  checked: Set<string>;
  onChecked: (next: Set<string>) => void;
  findOpen: boolean;
  onFindOpen: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const paragraphs = useParagraphs(book.id, chapter.id);
  const update = useUpdateParagraph(book.id, chapter.id);
  const add = useAddParagraph(book.id, chapter.id);
  const remove = useDeleteParagraph(book.id, chapter.id);
  const cast = useCastParagraphs(book.id);
  const tts = useTts();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<RegExp | null>(null);
  const player = useParagraphPlayer(onSelect);

  const list = useMemo(() => paragraphs.data ?? [], [paragraphs.data]);
  const lines = useMemo(() => list.filter((p) => p.kind === "line"), [list]);
  const selected = list.find((p) => p.id === selectedId) ?? null;

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

  const toggleLock = useCallback(
    (p: Paragraph) => update.mutate({ id: p.id, patch: { locked: !p.locked } }),
    [update],
  );

  const onCheck = useCallback(
    (id: string, range: boolean) => {
      const next = new Set(checked);
      if (range && anchor) {
        const a = list.findIndex((p) => p.id === anchor);
        const b = list.findIndex((p) => p.id === id);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (const p of list.slice(lo, hi + 1)) if (p.kind === "line") next.add(p.id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      setAnchor(id);
      onChecked(next);
    },
    [anchor, checked, list, onChecked],
  );

  const addAfter = useCallback(
    (after: Paragraph | null) =>
      add.mutate(
        { text: "", position: after ? after.position + 1 : null },
        {
          onSuccess: (p) => {
            onSelect(p.id);
            setEditingId(p.id);
          },
        },
      ),
    [add, onSelect],
  );

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        onFindOpen(true);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const i = selected ? lines.findIndex((p) => p.id === selected.id) : -1;
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
            addAfter(selected);
          } else if (selected && !selected.locked) {
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
          if (selected) {
            e.preventDefault();
            toggleLock(selected);
          }
          break;
        case "g":
        case "G": {
          const targets = checked.size > 0 ? list.filter((p) => checked.has(p.id)) : selected ? [selected] : [];
          if (targets.length) {
            e.preventDefault();
            generate(targets);
          }
          break;
        }
        case "Escape":
          if (findOpen) onFindOpen(false);
          else if (checked.size) onChecked(new Set());
          else onSelect(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addAfter, checked, findOpen, generate, lines, list, onChecked, onFindOpen, onSelect, player, selected, toggleLock]);

  const checkedList = list.filter((p) => checked.has(p.id));

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
                  onSelect={(id) => cast.mutate({ ids: [...checked], characterId: id })}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="outline" onClick={() => generate(checkedList)}>
              Generate
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => checkedList.forEach((p) => !p.locked && update.mutate({ id: p.id, patch: { locked: true } }))}
            >
              <LockIcon />
              Lock
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => checkedList.forEach((p) => p.locked && update.mutate({ id: p.id, patch: { locked: false } }))}
            >
              <UnlockIcon />
              Unlock
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                if (window.confirm(`Delete ${checked.size} paragraph${checked.size === 1 ? "" : "s"}?`)) {
                  checkedList.forEach((p) => remove.mutate(p.id));
                  onChecked(new Set());
                }
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

      <div className="min-h-0 flex-1 overflow-y-auto py-2" role="list" aria-label={`${chapter.title} paragraphs`}>
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
              <Button size="sm" variant="outline" onClick={() => addAfter(null)}>
                <PlusIcon />
                Add paragraph
              </Button>
            }
          >
            This chapter has no paragraphs yet.
          </EmptyState>
        ) : (
          list.map((p, i) => (
            <ParagraphRow
              key={p.id}
              bookId={book.id}
              paragraph={p}
              index={i}
              character={characterById(book.characters, p.character_id)}
              characters={book.characters}
              selected={p.id === selectedId}
              checked={checked.has(p.id)}
              editing={p.id === editingId}
              playing={p.id === player.playingId}
              generating={generating.has(p.id)}
              highlight={highlight}
              onSelect={onSelect}
              onCheck={onCheck}
              onEdit={setEditingId}
              onCommit={(id, text) => update.mutate({ id, patch: { text } })}
              onPlay={player.toggle}
              onLock={toggleLock}
              onGenerate={(para) => generate([para])}
              onCast={(id, characterId) => update.mutate({ id, patch: { character_id: characterId } })}
            />
          ))
        )}
        {list.length > 0 && (
          <div className="px-4 pt-2 pb-6">
            <Button size="sm" variant="ghost" onClick={() => addAfter(list[list.length - 1] ?? null)}>
              <PlusIcon />
              Add paragraph
            </Button>
          </div>
        )}
      </div>

      <div className="border-border/60 text-muted-foreground hidden flex-wrap gap-x-3 gap-y-1 border-t px-4 py-1.5 text-[0.7rem] lg:flex">
        <span><Kbd>j</Kbd>/<Kbd>k</Kbd> move</span>
        <span><Kbd>Enter</Kbd> edit</span>
        <span><Kbd>Space</Kbd> play</span>
        <span><Kbd>L</Kbd> lock</span>
        <span><Kbd>G</Kbd> generate</span>
        <span><Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new paragraph</span>
        <span><Kbd>Ctrl</Kbd>+<Kbd>F</Kbd> find</span>
      </div>
    </div>
  );
}
