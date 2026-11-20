/**
 * One paragraph in the editor: its voice chip, its text (double-click or
 * Enter to edit), its status, and play / generate / lock controls. The grip
 * drags it to a new place; the menu splits, merges, inserts and deletes.
 */

import { memo, useEffect, useRef, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  HeadingIcon,
  Loader2Icon,
  LockIcon,
  MergeIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ScissorsIcon,
  SparklesIcon,
  TimerIcon,
  Trash2Icon,
  UnlockIcon,
} from "lucide-react";

import { TakesPopover } from "@/components/audiobook/takes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { Paragraph, ParagraphStatus } from "@/lib/audiobook-api";
import type { Character } from "@/lib/audiobook-types";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

import { NARRATOR_COLOR, castColor } from "./cast-colors";
import { CharacterChip } from "./character-chip";

const STATUS_LABEL: Record<ParagraphStatus, string> = {
  unvoiced: "Unvoiced",
  voiced: "Voiced",
  stale: "Stale",
  locked: "Locked",
};

const STATUS_CLASS: Record<ParagraphStatus, string> = {
  unvoiced: "text-muted-foreground border-border",
  voiced: "text-ok border-ok/40 bg-ok/10",
  stale: "text-warn border-warn/50 bg-warn/10",
  locked: "text-foreground border-border-strong/60 bg-muted",
};

export function StatusBadge({ status }: { status: ParagraphStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[0.65rem] font-medium tracking-wide uppercase",
        STATUS_CLASS[status],
      )}
    >
      {status === "locked" && <LockIcon className="size-2.5" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Everything a row can ask the chapter to do. One stable object, so rows
 *  re-render only when their own paragraph or state changes. */
export interface RowActions {
  select: (id: string) => void;
  check: (id: string, range: boolean) => void;
  edit: (id: string | null) => void;
  commit: (id: string, text: string) => void;
  /** Save `text` (if it changed), then split it at `at`. */
  split: (id: string, text: string, at: number) => void;
  mergeNext: (id: string) => void;
  insertAfter: (id: string, kind: "line" | "pause") => void;
  remove: (id: string) => void;
  play: (paragraph: Paragraph) => void;
  lock: (paragraph: Paragraph) => void;
  generate: (paragraph: Paragraph) => void;
  cast: (id: string, characterId: string | null) => void;
  dragStart: (id: string) => void;
  dragOver: (id: string, after: boolean) => void;
  drop: () => void;
  dragEnd: () => void;
  /** Move a paragraph up (-1) or down (1): the keyboard alternative to drag. */
  move: (id: string, by: -1 | 1) => void;
  /** Extra controls for a row, from other features (notes). */
  extra?: (paragraph: Paragraph) => React.ReactNode;
}

export interface ParagraphRowProps {
  bookId: string;
  paragraph: Paragraph;
  index: number;
  isLast: boolean;
  character: Character | null;
  characters: Character[];
  selected: boolean;
  checked: boolean;
  editing: boolean;
  playing: boolean;
  generating: boolean;
  dragging: boolean;
  /** Where a dragged paragraph would land relative to this one. */
  dropEdge: "before" | "after" | null;
  highlight: RegExp | null;
  /** Whether any paragraph is selected; with none, the first row takes Tab. */
  anySelected?: boolean;
  actions: RowActions;
}

function Highlighted({ text, pattern }: { text: string; pattern: RegExp | null }) {
  if (!pattern) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index === undefined || m[0].length === 0) continue;
    parts.push(text.slice(last, m.index));
    parts.push(
      <mark key={m.index} className="bg-primary/25 text-foreground rounded-sm">
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

/** The text box while editing. Mounted fresh per edit, so it starts from
 *  the paragraph's current text. Blur or Ctrl/Cmd+Enter saves; Escape
 *  cancels; Alt+Enter splits at the cursor. */
function EditBox({
  text,
  onDone,
  onSplit,
}: {
  text: string;
  onDone: (text: string | null) => void;
  onSplit: (text: string, at: number) => void;
}) {
  const [draft, setDraft] = useState(text);
  const splitting = useRef(false);
  return (
    <Textarea
      autoFocus
      value={draft}
      aria-label="Paragraph text"
      aria-description="Alt+Enter splits at the cursor"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!splitting.current) onDone(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onDone(null);
        } else if (e.key === "Enter" && e.altKey) {
          e.preventDefault();
          splitting.current = true;
          onSplit(draft, e.currentTarget.selectionStart);
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onDone(draft);
        }
      }}
      className="min-h-16 text-[0.95rem] leading-relaxed"
    />
  );
}

function RowMenu({ p, isLast, actions }: { p: Paragraph; isLast: boolean; actions: RowActions }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label="More paragraph actions">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {p.kind === "line" && (
          <>
            <DropdownMenuItem
              disabled={p.locked}
              onSelect={() => {
                actions.select(p.id);
                actions.edit(p.id);
              }}
            >
              <ScissorsIcon />
              Split at cursor…
              <DropdownMenuShortcut>Alt+Enter</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={p.locked || isLast} onSelect={() => actions.mergeNext(p.id)}>
              <MergeIcon />
              Merge with next
              <DropdownMenuShortcut>M</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => actions.move(p.id, -1)}>
          <ArrowUpIcon />
          Move up
          <DropdownMenuShortcut>Alt+↑</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isLast} onSelect={() => actions.move(p.id, 1)}>
          <ArrowDownIcon />
          Move down
          <DropdownMenuShortcut>Alt+↓</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => actions.insertAfter(p.id, "line")}>
          <PlusIcon />
          Paragraph after
          <DropdownMenuShortcut>Shift+Enter</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.insertAfter(p.id, "pause")}>
          <TimerIcon />
          Pause after
          <DropdownMenuShortcut>P</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={p.locked} onSelect={() => actions.remove(p.id)}>
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Grip({ id, actions }: { id: string; actions: RowActions }) {
  return (
    <span
      draggable
      aria-hidden="true"
      title="Drag to reorder (or Alt+↑/↓)"
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        const row = (e.currentTarget as HTMLElement).closest("[data-paragraph-id]");
        if (row) e.dataTransfer.setDragImage(row, 16, 16);
        actions.dragStart(id);
      }}
      onDragEnd={actions.dragEnd}
      className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab opacity-0 group-hover:opacity-100 active:cursor-grabbing"
    >
      <GripVerticalIcon className="size-3.5" />
    </span>
  );
}

export const ParagraphRow = memo(function ParagraphRow({
  bookId,
  paragraph: p,
  index,
  isLast,
  character,
  characters,
  selected,
  checked,
  editing,
  playing,
  generating,
  dragging,
  dropEdge,
  highlight,
  anySelected = false,
  actions,
}: ParagraphRowProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected || !ref.current) return;
    ref.current.scrollIntoView({ block: "nearest" });
    // Focus follows the selection while focus is in the list (j/k), so a
    // screen reader reads the new paragraph.
    const list = ref.current.closest("[role=list]");
    const active = document.activeElement;
    if (list && active && list.contains(active) && !ref.current.contains(active)) {
      ref.current.focus({ preventScroll: true });
    }
  }, [selected]);

  const focusProps = {
    tabIndex: selected || (index === 0 && !anySelected) ? 0 : -1,
    "aria-current": selected ? ("true" as const) : undefined,
    onFocus: (e: React.FocusEvent) => {
      if (e.target === e.currentTarget && !selected) actions.select(p.id);
    },
  };

  const dnd = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      const box = e.currentTarget.getBoundingClientRect();
      actions.dragOver(p.id, e.clientY > box.top + box.height / 2);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      actions.drop();
    },
  };
  const edge = dropEdge && (
    <span
      aria-hidden="true"
      className={cn(
        "bg-primary pointer-events-none absolute right-2 left-2 h-0.5 rounded-full",
        dropEdge === "before" ? "-top-px" : "-bottom-px",
      )}
    />
  );

  if (p.kind === "pause") {
    return (
      <div
        ref={ref}
        data-paragraph-id={p.id}
        role="listitem"
        aria-label={`Paragraph ${index + 1}: pause, ${p.duration_s ? `${p.duration_s.toFixed(1)} seconds` : "no length"}`}
        {...focusProps}
        onClick={() => actions.select(p.id)}
        {...dnd}
        className={cn(
          "group text-muted-foreground focus-visible:ring-ring/50 relative outline-none focus-visible:ring-2 mx-2 flex items-center gap-2 rounded-md py-1 pr-2 pl-3 text-xs",
          selected && "bg-accent",
          dragging && "opacity-40",
        )}
      >
        {edge}
        <Grip id={p.id} actions={actions} />
        <span className="bg-border h-px flex-1" />
        <TimerIcon className="size-3" />
        Pause {p.duration_s ? `${p.duration_s.toFixed(1)}s` : ""}
        <span className="bg-border h-px flex-1" />
        <span onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100">
          <RowMenu p={p} isLast={isLast} actions={actions} />
        </span>
      </div>
    );
  }

  const color = character?.color ?? NARRATOR_COLOR;

  return (
    <div
      ref={ref}
      data-paragraph-id={p.id}
      role="listitem"
      {...focusProps}
      onClick={() => actions.select(p.id)}
      {...dnd}
      className={cn(
        "group focus-visible:ring-ring/50 relative mx-2 flex gap-2 outline-none focus-visible:ring-2 rounded-lg border border-transparent py-2.5 pr-2 pl-2 transition-colors",
        selected ? "bg-accent/60 border-border" : "hover:bg-accent/30",
        checked && "bg-primary/5 border-primary/30",
        playing && "border-primary/50",
        dragging && "opacity-40",
      )}
    >
      {edge}
      {/* What a screen reader hears first on this row. */}
      <span className="sr-only">
        {`Paragraph ${index + 1}${p.is_heading ? ", heading" : ""}. Read by ${character?.name ?? "Narrator"}. ${STATUS_LABEL[p.status]}${p.locked && p.status !== "locked" ? ", locked" : ""}.`}
      </span>
      {/* The voice's colour, as a rail, so a page of dialogue reads at a glance. */}
      <span
        aria-hidden="true"
        className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full"
        style={{ background: castColor(color, character ? 0.9 : 0.35) }}
      />
      <div className="flex shrink-0 items-start pt-0.5">
        <Grip id={p.id} actions={actions} />
      </div>
      <div className="flex w-6 shrink-0 flex-col items-center gap-1 pt-0.5">
        <input
          type="checkbox"
          aria-label={`Select paragraph ${index + 1}`}
          checked={checked}
          // Shift-click picks a range; don't let it select text too.
          onMouseDown={(e) => {
            if (e.shiftKey) e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            actions.check(p.id, e.shiftKey);
          }}
          onChange={() => {}}
          className={cn(
            "accent-primary size-3.5 cursor-pointer",
            !checked && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        />
        <span className="text-muted-foreground/70 text-[0.65rem] tabular-nums">{index + 1}</span>
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <CharacterChip
            character={character}
            characters={characters}
            onChange={(id) => actions.cast(p.id, id)}
          />
          {p.is_heading && (
            <span className="text-muted-foreground inline-flex items-center gap-0.5 text-[0.65rem] tracking-wide uppercase">
              <HeadingIcon className="size-3" />
              Heading
            </span>
          )}
          <StatusBadge status={p.status} />
          {p.sound && p.duration_s ? (
            <span className="text-muted-foreground text-[0.7rem] tabular-nums">
              {formatDuration(p.duration_s)}
            </span>
          ) : null}
          {actions.extra?.(p)}
        </div>
        {editing ? (
          <EditBox
            text={p.text}
            onDone={(text) => {
              if (text !== null && text !== p.text) actions.commit(p.id, text);
              actions.edit(null);
            }}
            onSplit={(text, at) => {
              actions.edit(null);
              actions.split(p.id, text, at);
            }}
          />
        ) : (
          <p
            onDoubleClick={() => !p.locked && actions.edit(p.id)}
            className={cn(
              "text-[0.95rem] leading-relaxed break-words whitespace-pre-wrap",
              p.is_heading && "font-heading text-base font-semibold",
              !p.text && "text-muted-foreground italic",
              p.locked && "text-foreground/85",
            )}
          >
            {p.text ? <Highlighted text={p.text} pattern={highlight} /> : "Empty paragraph"}
          </p>
        )}
      </div>

      <div
        className={cn(
          "flex shrink-0 items-start gap-0.5 transition-opacity",
          selected || playing || generating ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={playing ? "Stop" : "Play paragraph"}
          title={p.sound ? "Play (Space)" : "Not voiced yet"}
          disabled={!p.sound && !playing}
          onClick={() => actions.play(p)}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={p.sound ? "Regenerate paragraph" : "Generate paragraph"}
          title={p.locked ? "Unlock to regenerate" : "Generate (G)"}
          disabled={p.locked || generating || !p.text.trim()}
          onClick={() => actions.generate(p)}
        >
          {generating ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={p.locked ? "Unlock paragraph" : "Lock paragraph"}
          aria-pressed={p.locked}
          title={p.locked ? "Unlock (L)" : "Lock (L)"}
          onClick={() => actions.lock(p)}
        >
          {p.locked ? <LockIcon /> : <UnlockIcon />}
        </Button>
        <TakesPopover bookId={bookId} segmentId={p.id} />
        <RowMenu p={p} isLast={isLast} actions={actions} />
      </div>
    </div>
  );
});
