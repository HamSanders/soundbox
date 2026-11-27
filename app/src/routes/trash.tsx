/**
 * The trash: sounds, sessions and audiobooks you deleted, for 30 days.
 *
 * Deleting never asks first (an Undo toast does the asking afterwards), so
 * this is where something comes back from once the toast has gone, or after
 * an agent deleted it over MCP and nobody saw a toast at all. Gmail keeps its
 * trash the same way, for 30 days (https://support.google.com/mail/answer/7401).
 *
 * The only things here that can't be undone are Delete forever and Empty
 * trash, and those ask: in place, on the button itself (the audit's
 * `InlineConfirm`, §6.5), not in a dialog over the page.
 */

import { useEffect, useRef, useState } from "react";
import { BookOpenIcon, FolderClockIcon, Loader2Icon, MusicIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { TrashItem, TrashKind } from "@/lib/api";
import { formatBytes, formatRelative } from "@/lib/format";
import { useEmptyTrash, usePurgeTrashItem, useRestoreFromTrash, useTrash } from "@/lib/queries";

const KIND: Record<TrashKind, { label: string; icon: typeof MusicIcon }> = {
  sound: { label: "Sound", icon: MusicIcon },
  session: { label: "Session", icon: FolderClockIcon },
  book: { label: "Audiobook", icon: BookOpenIcon },
};

/**
 * A button that asks once, in place: the first press turns it into the
 * question with the doing button beside a Keep, focused, and it goes back on
 * its own after a few seconds or when focus leaves.
 */
function InlineConfirm({
  label,
  question,
  confirmLabel,
  onConfirm,
  busy,
  size = "sm",
}: {
  label: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  size?: "sm" | "default";
}) {
  const [asking, setAsking] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!asking) return;
    keep.current?.focus();
    const t = setTimeout(() => setAsking(false), 5000);
    return () => clearTimeout(t);
  }, [asking]);
  if (!asking) {
    return (
      <Button size={size} variant="ghost" disabled={busy} onClick={() => setAsking(true)}>
        {busy ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
        {label}
      </Button>
    );
  }
  return (
    <span
      className="flex items-center gap-1.5"
      role="group"
      aria-label={question}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAsking(false);
      }}
    >
      <span className="text-muted-foreground text-xs">{question}</span>
      <Button
        size={size}
        variant="destructive"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button ref={keep} size={size} variant="outline" onClick={() => setAsking(false)}>
        Keep
      </Button>
    </span>
  );
}

function daysLeft(item: TrashItem): string {
  const days = Math.max(0, Math.ceil((Date.parse(item.purge_at) - Date.now()) / 864e5));
  return days === 0 ? "deleted for good today" : `deleted for good in ${days} day${days === 1 ? "" : "s"}`;
}

function Row({ item }: { item: TrashItem }) {
  const restore = useRestoreFromTrash();
  const purge = usePurgeTrashItem();
  const { icon: Icon, label } = KIND[item.kind];
  return (
    <li className="border-border/60 flex flex-wrap items-center gap-3 border-b px-1 py-3 last:border-b-0">
      <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg" aria-hidden="true">
        <Icon className="text-muted-foreground size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.name}</p>
        <p className="text-muted-foreground truncate text-xs">
          {[label, item.detail, item.size_bytes ? formatBytes(item.size_bytes) : null].filter(Boolean).join(" · ")}
          {" · "}deleted {formatRelative(item.deleted_at)}, {daysLeft(item)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={restore.isPending}
          onClick={() => restore.mutate({ kind: item.kind, id: item.id, name: item.name })}
        >
          {restore.isPending ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />}
          Restore
        </Button>
        <InlineConfirm
          label="Delete forever"
          question="Can't be undone."
          confirmLabel="Delete"
          busy={purge.isPending}
          onConfirm={() => purge.mutate({ kind: item.kind, id: item.id })}
        />
      </div>
    </li>
  );
}

export function TrashPage() {
  const trash = useTrash();
  const empty = useEmptyTrash();
  const items = trash.data?.items ?? [];
  const days = trash.data?.days ?? 30;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Trash</h1>
          <p className="text-muted-foreground text-sm">
            Sounds, sessions and audiobooks you delete stay here for {days} days, then are deleted for good.
          </p>
        </div>
        {items.length > 0 && (
          <InlineConfirm
            size="default"
            label="Empty trash"
            question={`Delete all ${items.length} for good?`}
            confirmLabel="Empty trash"
            busy={empty.isPending}
            onConfirm={() => empty.mutate()}
          />
        )}
      </div>

      {trash.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : trash.isError ? (
        <EmptyState tone="error" title="Couldn't read the trash">
          {trash.error.message}
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState icon={Trash2Icon} title="The trash is empty">
          Things you delete come here first, so you can bring them back.
        </EmptyState>
      ) : (
        <ul className="bg-card border-border/70 rounded-xl border px-3" aria-label="Deleted items">
          {items.map((item) => (
            <Row key={`${item.kind}:${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
