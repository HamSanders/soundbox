/**
 * Undo/redo for timeline edits.
 *
 * Inverse operations rather than snapshots: the story lives on the server, so
 * "restore the previous state" would mean diffing and replaying whole
 * collections. Every edit already knows how to undo itself — a move knows
 * where the clip was, a delete knows what it deleted — so each one contributes
 * its own inverse and this only has to remember the order.
 *
 * Scoped to the page, not persisted. Undo is about the last few minutes of
 * work; an undo stack that survived a reload would offer to reverse edits
 * whose context is long gone, and would have to reason about everything an
 * agent changed in between.
 */

import { useCallback, useMemo, useRef, useState } from "react";

export interface EditStep {
  /** Human-readable, for a tooltip: "move", "trim", "delete". */
  label: string;
  undo: () => void;
  redo: () => void;
  /** Steps sharing a key, pushed moments apart, are one edit: a volume
   *  slider dragged from -3 to -12 is a dozen writes and one decision, and
   *  undo should take it back to -3 rather than to -11. */
  merge?: string;
}

export interface EditHistory {
  /** Record an edit the server has already taken. Not before: a step for a
   *  write that then failed would offer to undo something that never
   *  happened, and its inverse would make a change nobody asked for. */
  push: (step: EditStep) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** What the next undo would reverse, or null. */
  undoLabel: string | null;
  /** The step the next undo would reverse. A toast's Undo checks it is
   *  still its own step before undoing, so a later edit isn't taken back
   *  in its place. */
  peek: () => EditStep | undefined;
  /** Wipe both stacks — used when the ground shifts under them, e.g. an agent
   *  rewrites the story and our inverses no longer describe anything real. */
  clear: () => void;
  /** Record that a clip came back under a new id. Undoing a delete recreates
   *  the row (ids are the server's to hand out), and every older step that
   *  names the old id has to find the new one or it edits nothing. */
  remap: (from: string, to: string) => void;
  /** The id a step should act on now, following any remaps. Steps call this
   *  when they run, not when they are recorded. */
  resolve: (id: string) => string;
}

/** Deep enough for a working session, shallow enough that a stale inverse
 *  cannot lurk for hours. */
const LIMIT = 50;

/** How close together two steps with the same `merge` key have to land to
 *  count as one gesture. Longer than the gap between a slider's writes,
 *  shorter than deciding to have another go. */
const MERGE_MS = 1000;

export function useEditHistory(): EditHistory {
  const past = useRef<EditStep[]>([]);
  const future = useRef<EditStep[]>([]);
  const aliases = useRef(new Map<string, string>());
  // The step `push` last added and when, so the next can merge into it. Only
  // that one: after an undo or redo the top of the stack is a step from
  // another time, and folding a new edit into it would rewrite history.
  const lastPushed = useRef<{ step: EditStep; at: number } | null>(null);
  // Stacks live in refs so pushing does not re-render; this mirrors just
  // enough of them for the buttons to enable and disable.
  const [state, setState] = useState({ canUndo: false, canRedo: false, undoLabel: null as string | null });

  const sync = useCallback(() => {
    const next = {
      canUndo: past.current.length > 0,
      canRedo: future.current.length > 0,
      undoLabel: past.current[past.current.length - 1]?.label ?? null,
    };
    // Bail out when nothing visible changed. `clear()` runs from an effect
    // whenever an agent is active; a fresh object every time would re-render
    // the studio, which re-runs the effect, which clears again — forever.
    setState((prev) =>
      prev.canUndo === next.canUndo && prev.canRedo === next.canRedo && prev.undoLabel === next.undoLabel
        ? prev
        : next,
    );
  }, []);

  const push = useCallback(
    (step: EditStep) => {
      const now = Date.now();
      const last = lastPushed.current;
      const top = past.current[past.current.length - 1];
      if (
        step.merge !== undefined &&
        last !== null &&
        last.step === top &&
        top.merge === step.merge &&
        now - last.at < MERGE_MS
      ) {
        // Where the gesture started, and where it has got to.
        const merged = { ...step, undo: top.undo };
        past.current[past.current.length - 1] = merged;
        lastPushed.current = { step: merged, at: now };
        sync();
        return;
      }
      lastPushed.current = { step, at: now };
      past.current.push(step);
      if (past.current.length > LIMIT) past.current.shift();
      // A new edit makes the redo branch unreachable, as in every editor.
      future.current = [];
      sync();
    },
    [sync],
  );

  const undo = useCallback(() => {
    const step = past.current.pop();
    if (!step) return;
    lastPushed.current = null;
    step.undo();
    future.current.push(step);
    sync();
  }, [sync]);

  const redo = useCallback(() => {
    const step = future.current.pop();
    if (!step) return;
    lastPushed.current = null;
    step.redo();
    past.current.push(step);
    sync();
  }, [sync]);

  const clear = useCallback(() => {
    aliases.current.clear();
    lastPushed.current = null;
    if (past.current.length === 0 && future.current.length === 0) return;
    past.current = [];
    future.current = [];
    sync();
  }, [sync]);

  const remap = useCallback((from: string, to: string) => {
    if (from !== to) aliases.current.set(from, to);
  }, []);

  const resolve = useCallback((id: string) => {
    let current = id;
    // Bounded: a delete undone and redone repeatedly chains a → b → c, and a
    // cycle would be a bug elsewhere, not a reason to hang.
    for (let i = 0; i < LIMIT * 2; i++) {
      const next = aliases.current.get(current);
      if (!next) break;
      current = next;
    }
    return current;
  }, []);

  // Stable while nothing changes, so callers can list it as an effect dep.
  const peek = useCallback(() => past.current[past.current.length - 1], []);

  return useMemo(
    () => ({ push, undo, redo, clear, remap, resolve, peek, ...state }),
    [push, undo, redo, clear, remap, resolve, peek, state],
  );
}
