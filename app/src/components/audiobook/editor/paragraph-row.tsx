/**
 * One paragraph in the editor: its voice chip, its text (click or Enter to
 * edit), its status, and play / lock / generate controls.
 */

import { memo, useEffect, useRef, useState } from "react";
import {
  HeadingIcon,
  Loader2Icon,
  LockIcon,
  PauseIcon,
  PlayIcon,
  SparklesIcon,
  UnlockIcon,
} from "lucide-react";

import { TakesPopover } from "@/components/audiobook/takes";
import { Button } from "@/components/ui/button";
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

export interface ParagraphRowProps {
  bookId: string;
  paragraph: Paragraph;
  index: number;
  character: Character | null;
  characters: Character[];
  selected: boolean;
  checked: boolean;
  editing: boolean;
  playing: boolean;
  generating: boolean;
  highlight: RegExp | null;
  onSelect: (id: string) => void;
  onCheck: (id: string, range: boolean) => void;
  onEdit: (id: string | null) => void;
  onCommit: (id: string, text: string) => void;
  onPlay: (paragraph: Paragraph) => void;
  onLock: (paragraph: Paragraph) => void;
  onGenerate: (paragraph: Paragraph) => void;
  onCast: (id: string, characterId: string | null) => void;
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
 *  cancels. */
function EditBox({ text, onDone }: { text: string; onDone: (text: string | null) => void }) {
  const [draft, setDraft] = useState(text);
  return (
    <Textarea
      autoFocus
      value={draft}
      aria-label="Paragraph text"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onDone(draft)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onDone(null);
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onDone(draft);
        }
      }}
      className="min-h-16 text-[0.95rem] leading-relaxed"
    />
  );
}

export const ParagraphRow = memo(function ParagraphRow({
  bookId,
  paragraph: p,
  index,
  character,
  characters,
  selected,
  checked,
  editing,
  playing,
  generating,
  highlight,
  onSelect,
  onCheck,
  onEdit,
  onCommit,
  onPlay,
  onLock,
  onGenerate,
  onCast,
}: ParagraphRowProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (p.kind === "pause") {
    return (
      <div
        ref={ref}
        data-paragraph-id={p.id}
        onClick={() => onSelect(p.id)}
        className={cn(
          "text-muted-foreground mx-2 flex items-center gap-2 rounded-md px-3 py-1 text-xs",
          selected && "bg-accent",
        )}
      >
        <span className="bg-border h-px flex-1" />
        Pause {p.duration_s ? `${p.duration_s.toFixed(1)}s` : ""}
        <span className="bg-border h-px flex-1" />
      </div>
    );
  }

  const color = character?.color ?? NARRATOR_COLOR;

  return (
    <div
      ref={ref}
      data-paragraph-id={p.id}
      role="listitem"
      aria-selected={selected}
      onClick={() => onSelect(p.id)}
      className={cn(
        "group relative mx-2 flex gap-3 rounded-lg border border-transparent py-2.5 pr-2 pl-3 transition-colors",
        selected ? "bg-accent/60 border-border" : "hover:bg-accent/30",
        checked && "bg-primary/5 border-primary/30",
        playing && "border-primary/50",
      )}
    >
      {/* The voice's colour, as a rail, so a page of dialogue reads at a glance. */}
      <span
        aria-hidden="true"
        className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full"
        style={{ background: castColor(color, character ? 0.9 : 0.35) }}
      />
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
            onCheck(p.id, e.shiftKey);
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
            onChange={(id) => onCast(p.id, id)}
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
        </div>
        {editing ? (
          <EditBox
            text={p.text}
            onDone={(text) => {
              if (text !== null && text !== p.text) onCommit(p.id, text);
              onEdit(null);
            }}
          />
        ) : (
          <p
            onDoubleClick={() => !p.locked && onEdit(p.id)}
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
          onClick={() => onPlay(p)}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={p.sound ? "Regenerate paragraph" : "Generate paragraph"}
          title={p.locked ? "Unlock to regenerate" : "Generate (G)"}
          disabled={p.locked || generating || !p.text.trim()}
          onClick={() => onGenerate(p)}
        >
          {generating ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={p.locked ? "Unlock paragraph" : "Lock paragraph"}
          aria-pressed={p.locked}
          title={p.locked ? "Unlock (L)" : "Lock (L)"}
          onClick={() => onLock(p)}
        >
          {p.locked ? <LockIcon /> : <UnlockIcon />}
        </Button>
        <TakesPopover bookId={bookId} segmentId={p.id} />
      </div>
    </div>
  );
});
