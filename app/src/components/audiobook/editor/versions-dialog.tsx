/**
 * Saved versions of a book: save one, compare it with the book as it is
 * now, restore it, or delete it. Restoring saves the current state as
 * "Before restoring …" first, so it can be undone from this same list.
 */

import { useMemo, useState } from "react";
import { ArrowLeftIcon, GitCompareArrowsIcon, RotateCcwIcon, SaveIcon, Trash2Icon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { SnapshotDiff, SnapshotInfo } from "@/lib/audiobook-api";
import { useSnapshotDiff, useSnapshotOps, useSnapshots } from "@/lib/audiobook-queries";
import { formatRelative } from "@/lib/format";
import { reversible } from "@/lib/undo";
import { cn } from "@/lib/utils";

type Token = { text: string; op: "same" | "add" | "del" };

/** Word-level diff (LCS over words and spaces). Falls back to a whole
 *  replacement for very long paragraphs, where the table would be large. */
function wordDiff(before: string, after: string): Token[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  if (a.length * b.length > 250_000) {
    return [
      { text: before, op: "del" },
      { text: after, op: "add" },
    ];
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: Token[] = [];
  const push = (text: string, op: Token["op"]) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ text, op });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(a[i]!, "same");
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) push(a[i++]!, "del");
    else push(b[j++]!, "add");
  }
  while (i < a.length) push(a[i++]!, "del");
  while (j < b.length) push(b[j++]!, "add");
  return out;
}

function DiffText({ before, after }: { before: string | null; after: string | null }) {
  const tokens = useMemo(() => wordDiff(before ?? "", after ?? ""), [before, after]);
  return (
    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
      {tokens.map((t, i) =>
        t.op === "same" ? (
          <span key={i}>{t.text}</span>
        ) : t.op === "del" ? (
          <del key={i} className="bg-danger/15 text-danger rounded-sm decoration-1">
            {t.text}
          </del>
        ) : (
          <ins key={i} className="bg-ok/15 text-ok rounded-sm no-underline">
            {t.text}
          </ins>
        ),
      )}
    </p>
  );
}

const STATUS_LABEL = { added: "Added since", removed: "Removed since", changed: "Changed" } as const;

function DiffView({ diff }: { diff: SnapshotDiff }) {
  const changed = diff.chapters.filter((c) => c.status !== "same");
  const { added, removed, changed: edited } = diff.summary;
  if (!changed.length && !diff.book.length) {
    return <EmptyState size="sm">The book matches this version.</EmptyState>;
  }
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        From “{diff.snapshot.label}” to now: {edited} changed, {added} added, {removed} removed paragraph
        {added + removed + edited === 1 ? "" : "s"}.
      </p>
      {diff.book.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-xs font-medium tracking-wide uppercase">Book details</h4>
          {diff.book.map((f) => (
            <div key={f.field} className="text-sm">
              <span className="text-muted-foreground">{f.field.replace(/_/g, " ")}: </span>
              {typeof f.before === "string" || typeof f.after === "string" ? (
                <DiffText before={String(f.before ?? "")} after={String(f.after ?? "")} />
              ) : (
                <span>changed</span>
              )}
            </div>
          ))}
        </section>
      )}
      {changed.map((c) => (
        <section key={c.chapter_id} className="space-y-2">
          <h4 className="text-sm font-medium">
            {c.title}
            {c.status === "added" && <span className="text-ok ml-2 text-xs">new chapter</span>}
            {c.status === "removed" && <span className="text-danger ml-2 text-xs">chapter removed</span>}
            {c.title_before && (
              <span className="text-muted-foreground ml-2 text-xs">was “{c.title_before}”</span>
            )}
          </h4>
          {c.paragraphs.map((p) => (
            <div
              key={p.segment_id + p.status}
              className={cn(
                "border-l-2 py-0.5 pl-3",
                p.status === "added" ? "border-ok" : p.status === "removed" ? "border-danger" : "border-warn",
              )}
            >
              <span className="text-muted-foreground text-[0.65rem] tracking-wide uppercase">
                {STATUS_LABEL[p.status]}
              </span>
              <DiffText before={p.before} after={p.after} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function VersionsDialog({
  bookId,
  open,
  onOpenChange,
  onRestored,
}: {
  bookId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a restore: the editor's undo history no longer describes the book. */
  onRestored: () => void;
}) {
  const list = useSnapshots(bookId, open);
  const ops = useSnapshotOps(bookId);
  const [label, setLabel] = useState("");
  const [comparing, setComparing] = useState<SnapshotInfo | null>(null);
  const diff = useSnapshotDiff(bookId, comparing?.id ?? null);

  // No "Are you sure?": the current state is saved as a version before
  // restoring, so Undo is restoring that one.
  const restore = (snap: SnapshotInfo) =>
    void reversible({
      run: () => ops.restore.mutateAsync(snap.id),
      message: `Restored “${snap.label}”`,
      description: ({ before }) => `Saved the previous state as “${before.label}”.`,
      undo: async ({ before }) => {
        await ops.restore.mutateAsync(before.id);
        onRestored();
      },
      undone: "Put the book back as it was",
    })
      .then(() => {
        onRestored();
        setComparing(null);
      })
      .catch(() => {}); // the mutation already showed why


  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setComparing(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{comparing ? `Compare with “${comparing.label}”` : "Versions"}</DialogTitle>
          <DialogDescription>
            {comparing
              ? "Changes since this version: removed words struck through, new words highlighted."
              : "Save the book's text, cast and chosen takes, and go back to them later."}
          </DialogDescription>
        </DialogHeader>

        {comparing ? (
          <div className="space-y-3">
            <div className="flex justify-between gap-2">
              <Button size="sm" variant="ghost" onClick={() => setComparing(null)}>
                <ArrowLeftIcon />
                All versions
              </Button>
              <Button size="sm" variant="outline" onClick={() => restore(comparing)} disabled={ops.restore.isPending}>
                <RotateCcwIcon />
                Restore this version
              </Button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto pr-1">
              {diff.isLoading ? (
                <Skeleton className="h-32 rounded-lg" />
              ) : diff.data ? (
                <DiffView diff={diff.data} />
              ) : (
                <EmptyState tone="error" size="sm">
                  {diff.error?.message ?? "Could not compare."}
                </EmptyState>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                ops.save.mutate(label.trim() || null, { onSuccess: () => setLabel("") });
              }}
            >
              <Input
                value={label}
                placeholder="Version name (optional)"
                aria-label="Version name"
                onChange={(e) => setLabel(e.target.value)}
              />
              <Button type="submit" disabled={ops.save.isPending}>
                <SaveIcon />
                Save version
              </Button>
            </form>
            <div className="max-h-[50vh] overflow-y-auto">
              {list.isLoading ? (
                <Skeleton className="h-24 rounded-lg" />
              ) : (list.data ?? []).length === 0 ? (
                <EmptyState size="sm">No saved versions yet.</EmptyState>
              ) : (
                <ul className="divide-border/70 divide-y">
                  {list.data!.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.label}</p>
                        <p className="text-muted-foreground text-xs">
                          {formatRelative(s.created_at)} · {s.chapters} chapters · {s.paragraphs} paragraphs
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setComparing(s)}>
                        <GitCompareArrowsIcon />
                        Compare
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => restore(s)} disabled={ops.restore.isPending}>
                        <RotateCcwIcon />
                        Restore
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Delete ${s.label}`}
                        onClick={() => ops.remove.mutate(s.id)}
                      >
                        <Trash2Icon />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
