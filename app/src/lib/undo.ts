/**
 * Act now, offer Undo: the replacement for "Are you sure?" dialogs.
 *
 * Apple's guidance is to "avoid displaying alerts for common, undoable
 * actions, even when they're destructive", and NN/g's is that confirmations
 * shown too often stop being read, so go to great lengths to provide undo
 * instead (https://developer.apple.com/design/human-interface-guidelines/alerts,
 * https://www.nngroup.com/articles/confirmation-dialog/). Gmail's Undo Send
 * holds the send for a few seconds the same way `undoable` holds a delete
 * (https://support.google.com/mail/answer/2819488).
 *
 * Two shapes, one toast:
 *   - `undoable`: delete-style. The thing disappears at once, the request is
 *     sent when the toast closes, and Undo before then means it never was.
 *   - `reversible`: create-style. The request runs now, and Undo runs its
 *     inverse.
 *
 * Ctrl+Z (Cmd+Z) undoes the newest toast, unless focus is in a text field
 * or the page has its own undo (the studio timeline and the book editor
 * claim the key first). A page with its own undo can still reach its own
 * toasts through `undoPending(scope)`: the book editor does, so Ctrl+Z
 * brings back a chapter deleted a moment ago.
 */

import { toast } from "sonner";
import { create } from "zustand";

import { errorMessage } from "./api";

/* --------------------------------------------------------- hidden items */

/** Things deleted but not sent yet, so every list can leave them out. */
export type HiddenKind = "sound" | "project" | "voice" | "endpoint" | "chapter" | "session" | "book";

interface HiddenState {
  ids: Record<string, true>;
  hide: (kind: HiddenKind, id: string) => void;
  show: (kind: HiddenKind, id: string) => void;
}

const key = (kind: HiddenKind, id: string) => `${kind}:${id}`;

export const useHiddenStore = create<HiddenState>((set) => ({
  ids: {},
  hide: (kind, id) => set((s) => ({ ids: { ...s.ids, [key(kind, id)]: true } })),
  show: (kind, id) =>
    set((s) => {
      const { [key(kind, id)]: _gone, ...rest } = s.ids;
      return { ids: rest };
    }),
}));

/**
 * A filter that leaves out items of `kind` waiting to be deleted, for a
 * query's `select`. Undefined while nothing is hidden, so the query keeps
 * its data as it came.
 */
export function useHiddenFilter(kind: HiddenKind): (<T extends { id: string }>(items: T[]) => T[]) | undefined {
  const ids = useHiddenStore((s) => s.ids);
  const prefix = `${kind}:`;
  if (!Object.keys(ids).some((k) => k.startsWith(prefix))) return undefined;
  return (items) => items.filter((it) => !ids[key(kind, it.id)]);
}

/* ------------------------------------------------------------- pending */

interface Pending {
  undo: () => void;
  flush: () => Promise<void>;
  /** Which page's undo may take this one, e.g. `book:<id>`. */
  scope?: string;
  message: string;
}

const pending: Pending[] = [];

const drop = (p: Pending) => {
  const i = pending.indexOf(p);
  if (i >= 0) pending.splice(i, 1);
};

/**
 * Undo the newest toast in `scope`, for a page whose own Ctrl+Z handler
 * claims the key. Returns what was undone, or null when nothing in that
 * scope is waiting.
 */
export function undoPending(scope: string): string | null {
  const entry = pending.findLast((p) => p.scope === scope);
  if (!entry) return null;
  entry.undo();
  return entry.message;
}

/** Send every delete still waiting on its toast. */
export function flushPending(): Promise<void[]> {
  return Promise.all([...pending].map((p) => p.flush()));
}

if (typeof window !== "undefined") {
  // Closing or reloading the window mid-toast still deletes.
  window.addEventListener("pagehide", () => void flushPending());
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    // Let any later handler (the timeline, the book editor) take the key
    // first; it marks the event handled with preventDefault.
    setTimeout(() => {
      if (!e.defaultPrevented) pending.at(-1)?.undo();
    }, 0);
  });
}

const WINDOW_MS = 8000;

/** Delete-style: change the page now, send the request when the toast closes. */
export function undoable(opts: {
  /** In the object's own name: Deleted “Rain on tin roof”. */
  message: string;
  description?: string;
  /** The local change, e.g. hide the row. */
  apply: () => void;
  /** Put it back. Runs on Undo, or if the request fails. */
  revert: () => void;
  /** The real request. Runs once, when the toast closes. */
  commit: () => Promise<unknown>;
  /** After the request succeeds, e.g. refetch and un-hide. */
  done?: () => void;
  /** Error toast title if the request fails. */
  failure?: string;
  windowMs?: number;
  /** See `undoPending`. */
  scope?: string;
}): void {
  let settled = false;
  const entry: Pending = {
    scope: opts.scope,
    message: opts.message,
    undo: () => {
      if (settled) return;
      settled = true;
      drop(entry);
      toast.dismiss(id);
      opts.revert();
    },
    flush: async () => {
      if (settled) return;
      settled = true;
      drop(entry);
      // Sent early (a reorder that needs the full list, say): the toast's
      // Undo would no longer mean anything.
      toast.dismiss(id);
      try {
        await opts.commit();
        opts.done?.();
      } catch (err) {
        opts.revert();
        toast.error(opts.failure ?? "That didn't go through", { description: errorMessage(err) });
      }
    },
  };
  opts.apply();
  pending.push(entry);
  const id = toast(opts.message, {
    description: opts.description,
    duration: opts.windowMs ?? WINDOW_MS,
    action: { label: "Undo", onClick: entry.undo },
    onAutoClose: () => void entry.flush(),
    onDismiss: () => void entry.flush(),
  });
}

/** Create-style: run now, and Undo runs the inverse. */
export async function reversible<T>(opts: {
  run: () => Promise<T>;
  message: string | ((result: T) => string);
  description?: string | ((result: T) => string);
  undo: (result: T) => Promise<unknown>;
  /** Toast after Undo; leave out for none. */
  undone?: string;
  /** A second button, e.g. Open. */
  open?: { label: string; onClick: (result: T) => void };
  failure?: string;
  windowMs?: number;
}): Promise<T> {
  const result = await opts.run();
  let settled = false;
  const entry: Pending = {
    message: typeof opts.message === "function" ? opts.message(result) : opts.message,
    undo: () => {
      if (settled) return;
      settled = true;
      drop(entry);
      toast.dismiss(id);
      opts.undo(result).then(
        () => opts.undone && toast(opts.undone),
        (err) => toast.error(opts.failure ?? "Couldn't undo that", { description: errorMessage(err) }),
      );
    },
    flush: async () => {
      settled = true;
      drop(entry);
    },
  };
  pending.push(entry);
  const message = typeof opts.message === "function" ? opts.message(result) : opts.message;
  const description = typeof opts.description === "function" ? opts.description(result) : opts.description;
  const id = toast.success(message, {
    description,
    duration: opts.windowMs ?? WINDOW_MS,
    action: opts.open
      ? { label: opts.open.label, onClick: () => opts.open!.onClick(result) }
      : { label: "Undo", onClick: entry.undo },
    cancel: opts.open ? { label: "Undo", onClick: entry.undo } : undefined,
    onAutoClose: () => void entry.flush(),
    onDismiss: () => void entry.flush(),
  });
  return result;
}
