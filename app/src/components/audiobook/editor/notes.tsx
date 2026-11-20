/**
 * Review notes on a paragraph: a button with the open count, and a popover
 * to read, add, resolve and delete them. A note added while the paragraph
 * plays is pinned to that moment; clicking its time plays from there.
 */

import { useState } from "react";
import { CheckIcon, MessageSquarePlusIcon, MessageSquareTextIcon, PlayIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import type { BookNote, Paragraph } from "@/lib/audiobook-api";
import { useNoteOps } from "@/lib/audiobook-queries";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

function clock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

export function NotesButton({
  bookId,
  paragraph,
  notes,
  position,
  onPlayAt,
}: {
  bookId: string;
  paragraph: Paragraph;
  notes: BookNote[];
  /** Seconds into this paragraph's audio if it is playing now. */
  position: () => number | null;
  onPlayAt: (t: number) => void;
}) {
  const ops = useNoteOps(bookId);
  const [draft, setDraft] = useState("");
  const [atS, setAtS] = useState<number | null>(null);
  const open = notes.filter((n) => !n.resolved).length;

  const add = () => {
    const body = draft.trim();
    if (!body) return;
    ops.add.mutate(
      { segmentId: paragraph.id, body, atS },
      {
        onSuccess: () => {
          setDraft("");
          setAtS(null);
        },
      },
    );
  };

  return (
    <Popover
      onOpenChange={(o) => {
        // Pin a new note to where playback is when the popover opens.
        if (o) setAtS(position());
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={
            notes.length ? `${notes.length} notes, ${open} open` : "Add a review note"
          }
          title={notes.length ? `${open} open of ${notes.length} notes` : "Add a review note"}
          className={cn(
            "focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[0.7rem] outline-none focus-visible:ring-2",
            open
              ? "bg-warn/15 text-warn"
              : notes.length
                ? "text-muted-foreground"
                : "text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          {notes.length ? <MessageSquareTextIcon className="size-3" /> : <MessageSquarePlusIcon className="size-3" />}
          {notes.length ? (open || notes.length) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="start" onClick={(e) => e.stopPropagation()}>
        <h4 className="text-sm font-medium">Review notes</h4>
        {notes.length > 0 && (
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {notes.map((n) => (
              <li
                key={n.id}
                className={cn("border-border/70 rounded-md border p-2 text-sm", n.resolved && "opacity-60")}
              >
                <p className={cn("break-words whitespace-pre-wrap", n.resolved && "line-through")}>{n.body}</p>
                <div className="text-muted-foreground mt-1 flex items-center gap-1 text-[0.7rem]">
                  {n.at_s !== null && (
                    <button
                      type="button"
                      className="hover:text-foreground inline-flex items-center gap-0.5 tabular-nums"
                      disabled={!paragraph.sound}
                      onClick={() => onPlayAt(n.at_s!)}
                      title="Play from here"
                    >
                      <PlayIcon className="size-2.5" />
                      {clock(n.at_s)}
                    </button>
                  )}
                  <span className="flex-1">{formatRelative(n.created_at)}</span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={n.resolved ? "Reopen note" : "Resolve note"}
                    title={n.resolved ? "Reopen" : "Resolve"}
                    aria-pressed={n.resolved}
                    onClick={() => ops.update.mutate({ id: n.id, patch: { resolved: !n.resolved } })}
                  >
                    <CheckIcon />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Delete note"
                    onClick={() => ops.remove.mutate(n.id)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2">
          <Textarea
            value={draft}
            rows={2}
            placeholder="What needs another look?"
            aria-label="New note"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                add();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-[0.7rem]">
              {atS !== null ? (
                <>
                  At {clock(atS)}{" "}
                  <button type="button" className="underline" onClick={() => setAtS(null)}>
                    clear
                  </button>
                </>
              ) : (
                "Whole paragraph"
              )}
            </span>
            <Button size="sm" disabled={!draft.trim() || ops.add.isPending} onClick={add}>
              Add note
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
