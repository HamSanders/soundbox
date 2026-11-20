/**
 * Bookmarks and notes for one book, in book order. Jump to one, write or edit
 * its note, or delete it (with undo).
 */

import { useState } from "react";
import { BookmarkIcon, StickyNoteIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { clock } from "@/lib/listen-api";
import { useBookmarkMutations } from "@/lib/listen-queries";
import type { Bookmark, ListenManifest } from "@/lib/listen-types";

export function BookmarkList({
  manifest,
  onJump,
  compact = false,
}: {
  manifest: ListenManifest;
  onJump: (b: Bookmark) => void;
  compact?: boolean;
}) {
  const { add, update, remove } = useBookmarkMutations(manifest.book.id);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const order = new Map(manifest.chapters.map((c, i) => [c.id, i]));
  const marks = [...manifest.bookmarks].sort(
    (a, b) => (order.get(a.chapter_id) ?? 0) - (order.get(b.chapter_id) ?? 0) || a.position_s - b.position_s,
  );

  const del = (b: Bookmark) =>
    remove.mutate(b.id, {
      onSuccess: () =>
        toast("Bookmark deleted", {
          action: {
            label: "Undo",
            onClick: () =>
              add.mutate({ chapter_id: b.chapter_id, position_s: b.position_s, segment_id: b.segment_id, note: b.note }),
          },
        }),
    });

  if (marks.length === 0) {
    return <p className="text-muted-foreground text-sm">No bookmarks yet. Add one from the player.</p>;
  }

  return (
    <ul className="space-y-2">
      {marks.map((b) => {
        const chapter = manifest.chapters.find((c) => c.id === b.chapter_id);
        const paragraph = chapter?.paragraphs.find((p) => p.segment_id === b.segment_id);
        return (
          <li key={b.id} className="border-border rounded-md border p-2.5">
            <div className="flex items-start gap-2">
              {b.note ? (
                <StickyNoteIcon className="text-primary mt-0.5 size-4 shrink-0" />
              ) : (
                <BookmarkIcon className="text-primary mt-0.5 size-4 shrink-0" />
              )}
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onJump(b)}>
                <p className="truncate text-sm font-medium">
                  {chapter?.title ?? "Chapter"} · <span className="tabular-nums">{clock(b.position_s)}</span>
                </p>
                {!compact && paragraph && (
                  <p className="text-muted-foreground line-clamp-2 text-xs">{paragraph.text}</p>
                )}
                {b.note && editing !== b.id && <p className="mt-1 text-sm whitespace-pre-line">{b.note}</p>}
              </button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={b.note ? "Edit note" : "Add note"}
                onClick={() => {
                  setEditing(b.id);
                  setDraft(b.note);
                }}
              >
                <StickyNoteIcon />
              </Button>
              <Button size="icon-xs" variant="ghost" aria-label="Delete bookmark" onClick={() => del(b)}>
                <Trash2Icon />
              </Button>
            </div>
            {editing === b.id && (
              <div className="mt-2 space-y-2">
                <Textarea
                  autoFocus
                  value={draft}
                  placeholder="Write a note…"
                  onChange={(e) => setDraft(e.target.value)}
                  className="min-h-16 text-sm"
                />
                <div className="flex justify-end gap-2">
                  <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="xs"
                    onClick={() => update.mutate({ id: b.id, note: draft.trim() }, { onSuccess: () => setEditing(null) })}
                  >
                    Save note
                  </Button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
