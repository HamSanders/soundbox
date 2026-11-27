/**
 * The trash: deleting a sound, a session or an audiobook moves it here, and
 * it can come back for `TRASH_DAYS` days before it is deleted for good.
 *
 * Why: a confirmation shown before every delete stops being read, and the
 * guidance from Apple and NN/g is to make the action undoable instead
 * (docs/redesign-2026-11/dialogs-and-forms-audit.md, §4.1). Two deletes could
 * not be undone at all: a session with all its sounds, and a book with hours
 * of voiced audio. And an agent deleting over MCP never sees a toast, so the
 * person needs somewhere to get it back from.
 *
 * How: a `deleted_at` column on the top-level row (sounds, sessions, books).
 * Nothing it owns is touched, files included; every list leaves it out (see
 * `Database.visibleSound`, `visibleStory`, `BookStore.listBooks`), and
 * restoring clears the column. Purging runs the ordinary hard delete, so
 * "really gone" is the code that always did it.
 */

import { audiobooks } from "./audiobook/service.js";
import { TRASH_DAYS } from "./db.js";
import type { MirliService } from "./service.js";

export { TRASH_DAYS };

export type TrashKind = "sound" | "session" | "book";

export interface TrashItem {
  kind: TrashKind;
  id: string;
  /** What it is called. */
  name: string;
  /** A line about what goes with it: "12 sounds", "4 chapters". */
  detail: string | null;
  deleted_at: string;
  /** When it will be deleted for good. */
  purge_at: string;
  size_bytes: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function purgeAt(deletedAt: string): string {
  return new Date(Date.parse(deletedAt) + TRASH_DAYS * DAY_MS).toISOString();
}

/** Move to the trash. False when there is no such thing (or it is already
 *  there). */
export async function trashItem(svc: MirliService, kind: TrashKind, id: string): Promise<boolean> {
  const now = new Date().toISOString();
  switch (kind) {
    case "sound":
      return svc.db.getSound(id) !== null && svc.db.setTrashed("sound", id, now);
    case "session":
      return svc.db.getSession(id) !== null && svc.db.setTrashed("session", id, now);
    case "book":
      return await audiobooks(svc).trashBook(id);
  }
}

/** Take out of the trash. False when it isn't there. */
export function restoreItem(svc: MirliService, kind: TrashKind, id: string): boolean {
  switch (kind) {
    case "sound":
      return svc.db.setTrashed("sound", id, null);
    case "session":
      return svc.db.setTrashed("session", id, null);
    case "book":
      return audiobooks(svc).restoreBook(id) !== null;
  }
}

export function listTrash(svc: MirliService): TrashItem[] {
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const items: TrashItem[] = [
    ...svc.db.listTrashedSounds().map((s) => ({
      kind: "sound" as const,
      id: s.id,
      name: s.name,
      detail: null,
      deleted_at: s.deleted_at,
      purge_at: purgeAt(s.deleted_at),
      size_bytes: s.size_bytes,
    })),
    ...svc.db.listTrashedSessions().map((s) => ({
      kind: "session" as const,
      id: s.id,
      name: s.title,
      detail: plural(s.sounds, "sound"),
      deleted_at: s.deleted_at,
      purge_at: purgeAt(s.deleted_at),
      size_bytes: s.size_bytes,
    })),
    ...audiobooks(svc)
      .listTrashedBooks()
      .map((b) => ({
        kind: "book" as const,
        id: b.id,
        name: b.title,
        detail: [b.author, plural(b.chapters, "chapter")].filter(Boolean).join(" · "),
        deleted_at: b.deleted_at,
        purge_at: purgeAt(b.deleted_at),
        size_bytes: null,
      })),
  ];
  return items.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}

/** Delete one thing in the trash for good. False when it isn't in the trash:
 *  this never deletes something that wasn't trashed first. */
export async function purgeItem(svc: MirliService, kind: TrashKind, id: string): Promise<boolean> {
  if (!listTrash(svc).some((i) => i.kind === kind && i.id === id)) return false;
  switch (kind) {
    case "sound":
      return await svc.deleteSound(id);
    case "session":
      return await svc.deleteSession(id);
    case "book":
      return await audiobooks(svc).deleteBook(id);
  }
}

/** Delete for good everything trashed before `before` (default: the trash's
 *  limit ago), or everything when `all`. Returns how many. Books first, then
 *  sessions, then sounds, so nothing is deleted twice. */
export async function purgeTrash(svc: MirliService, opts: { all?: boolean; before?: Date } = {}): Promise<number> {
  const cutoff = opts.all
    ? new Date(Date.now() + DAY_MS).toISOString()
    : (opts.before ?? new Date(Date.now() - TRASH_DAYS * DAY_MS)).toISOString();
  let n = 0;
  for (const id of audiobooks(svc).trashedBooksBefore(cutoff)) if (await audiobooks(svc).deleteBook(id)) n++;
  for (const id of svc.db.trashedBefore("session", cutoff)) if (await svc.deleteSession(id)) n++;
  for (const id of svc.db.trashedBefore("sound", cutoff)) if (await svc.deleteSound(id)) n++;
  return n;
}

/** Purge what is past its time now and every six hours. Returns the stop
 *  function. The timer doesn't keep the process alive. */
export function startTrashPurge(svc: MirliService): () => void {
  const run = () =>
    void purgeTrash(svc).then(
      (n) => n && console.info(`Trash: deleted ${n} item${n === 1 ? "" : "s"} older than ${TRASH_DAYS} days`),
      (err: unknown) => console.warn("Trash purge failed:", err),
    );
  run();
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
