/**
 * Patch memory — eight slots of console settings in localStorage.
 *
 * A "patch" is every control on the panel, prompt included: that is what a
 * hardware memory slot holds, and it's the whole point — dial in a footstep
 * chain you like on Tuesday, recall it Friday. Local only, deliberately: it
 * is a front-panel convenience, not a data model, and the durable record of
 * what was actually generated is still the Library.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { ComposerSettings } from "@/lib/session-store";

export interface Patch {
  name: string;
  savedAt: string;
  settings: ComposerSettings;
}

export const PATCH_SLOTS = 8;
const KEY = "konchi.console.patches.v1";

type Slots = (Patch | null)[];

const listeners = new Set<() => void>();
let cache: Slots | null = null;

function read(): Slots {
  if (cache) return cache;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    parsed = null;
  }
  const arr = Array.isArray(parsed) ? (parsed as Slots) : [];
  cache = Array.from({ length: PATCH_SLOTS }, (_, i) => arr[i] ?? null);
  return cache;
}

function write(next: Slots) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota or private mode: the in-memory copy still works for the visit */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function patchName(s: ComposerSettings): string {
  const p = s.prompt.trim();
  if (p) return p.length > 28 ? `${p.slice(0, 27)}…` : p;
  return s.modelId || "empty";
}

export function usePatches() {
  const slots = useSyncExternalStore(subscribe, read, read);
  const store = useCallback((i: number, settings: ComposerSettings) => {
    const next = [...read()];
    next[i] = { name: patchName(settings), savedAt: new Date().toISOString(), settings };
    write(next);
  }, []);
  const clear = useCallback((i: number) => {
    const next = [...read()];
    next[i] = null;
    write(next);
  }, []);
  return { slots, store, clear };
}
