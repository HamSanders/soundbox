/**
 * What the docked details panel is showing, app-wide: one item of a typed
 * kind, or nothing.
 *
 * One store for every kind replaces the three it grew from (one per sound,
 * voice and model, each closing the others by hand). `DetailDock` renders
 * the panel for the open item and keeps it in the URL as
 * `?detail=<kind>:<id>`, so Back closes it, Forward opens it again, and a
 * link can open it. See docs/redesign-2026-11/dialogs-and-forms-audit.md §6.3.
 *
 * Kept in a store as well as the URL so code outside the router (a delete's
 * undo toast, a mutation's success) can close or open it.
 */

import { create } from "zustand";

export type DockKind = "sound" | "voice" | "model" | "classic";

export interface DockItem {
  kind: DockKind;
  id: string;
}

/**
 * Where to start inside the panel, once: a field to edit, or a section to
 * scroll to. Set when a menu item opens the panel ("Rename", "Clips").
 */
export type DockIntent = "rename" | "model" | "clips" | "history";

const KINDS: readonly DockKind[] = ["sound", "voice", "model", "classic"];

/** The search parameter that holds the open item. */
export const DETAIL_PARAM = "detail";

export function dockKey(item: DockItem): string {
  return `${item.kind}:${item.id}`;
}

/** Reads `kind:id`. Only the first colon splits, so an id may hold one. */
export function parseDock(value: string | null): DockItem | null {
  if (!value) return null;
  const at = value.indexOf(":");
  if (at < 1 || at === value.length - 1) return null;
  const kind = value.slice(0, at) as DockKind;
  return KINDS.includes(kind) ? { kind, id: value.slice(at + 1) } : null;
}

interface DockState {
  item: DockItem | null;
  intent: DockIntent | null;
  /** What the opener already had (a sound's row has the whole sound), so
   *  the panel draws at once instead of waiting for its own fetch. */
  seed: unknown;
  /** What had focus when the panel opened, to go back to when it closes. */
  opener: HTMLElement | null;
  open: (item: DockItem, opts?: { intent?: DockIntent; seed?: unknown }) => void;
  close: () => void;
  /** Whether this item is the open one. */
  isOpen: (kind: DockKind, id: string) => boolean;
  setIntent: (intent: DockIntent | null) => void;
  /** The URL changed (Back, Forward, a link): follow it without writing back. */
  follow: (item: DockItem | null) => void;
}

export const useDock = create<DockState>((set, get) => ({
  item: null,
  intent: null,
  seed: null,
  opener: null,
  open: (item, opts) => {
    const active = document.activeElement;
    const inDock = active instanceof HTMLElement && active.closest("[data-detail-dock]");
    set((s) => ({
      item,
      intent: opts?.intent ?? null,
      seed: opts?.seed ?? null,
      // Swapping what the dock shows from inside it keeps the first opener.
      opener: inDock ? s.opener : active instanceof HTMLElement ? active : null,
    }));
  },
  close: () => set({ item: null, intent: null, seed: null }),
  isOpen: (kind, id) => {
    const item = get().item;
    return item?.kind === kind && item.id === id;
  },
  setIntent: (intent) => set({ intent }),
  follow: (item) => set({ item, intent: null, seed: null }),
}));

/** The open item's id when it is of this kind. */
export function useDockId(kind: DockKind): string | null {
  return useDock((s) => (s.item?.kind === kind ? s.item.id : null));
}

/**
 * For a page that rewrites its own search parameters (a filter, a chapter):
 * the same update, keeping the open panel's parameter.
 */
export function keepDetail(next: Record<string, string> | URLSearchParams) {
  return (prev: URLSearchParams): URLSearchParams => {
    const out = new URLSearchParams(next);
    const detail = prev.get(DETAIL_PARAM);
    if (detail && !out.has(DETAIL_PARAM)) out.set(DETAIL_PARAM, detail);
    return out;
  };
}
