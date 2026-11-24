/**
 * How the chat reaches a studio that is open beside it.
 *
 * The studio owns its timeline: which lanes exist, what is selected, where
 * the playhead is, and — more to the point — the handlers that change any
 * of it, every one of which is optimistic, invalidates the right queries and
 * lands on the undo stack. The assistant must not grow a second set. So the
 * studio *lends* the two things the command bar already uses (a context
 * snapshot and an apply function) to this store while it is mounted, and the
 * chat borrows them for the turns that turn out to be edits.
 *
 * Null when no studio is open, which is how the chat knows "rename track 1"
 * is a question about nothing rather than an instruction.
 */

import { create } from "zustand";

import { api } from "./api";
import type { StudioAction, StudioContext } from "./studio-command";

export interface StudioBridge {
  storyId: string;
  /** Built fresh on each call, never cached — the selection and the playhead
   *  move constantly. */
  context: () => StudioContext;
  apply: (actions: StudioAction[], summary: string) => void;
  /** Bring one of the studio's panels forward — how the chat shows its work,
   *  and how a card in the thread gets back to what it changed. */
  showPanel: (id: string) => void;
}

interface StudioBridgeState {
  bridge: StudioBridge | null;
  lend: (bridge: StudioBridge) => void;
  /** Only the lender may take it back: a second studio mounting and
   *  unmounting must not clear the first one's loan. */
  reclaim: (storyId: string) => void;
}

export const useStudioBridge = create<StudioBridgeState>((set) => ({
  bridge: null,
  lend: (bridge) => set({ bridge }),
  reclaim: (storyId) =>
    set((s) => (s.bridge?.storyId === storyId ? { bridge: null } : {})),
}));

/**
 * A question from an agent, sent down this studio's event stream by the
 * server (`StoryHub.ask`) on behalf of an MCP tool.
 *
 * - `context`: the same snapshot the chat plans against.
 * - `apply`: actions the server has already checked against that snapshot
 *   (`validateActions`), run through the same `apply` the chat's Apply button
 *   uses — so they are optimistic, undoable, and recorded in the history like
 *   any other edit.
 */
export interface StudioRequest {
  id: string;
  op: "context" | "apply";
  payload?: unknown;
}

/**
 * Answer one request from the bridge the studio has lent.
 *
 * The bridge rather than the page directly because it is the one handle on
 * the studio's handlers that is already shared: whatever the chat can do to
 * the timeline, an agent now can, through the same code.
 */
export async function answerStudioRequest(storyId: string, req: StudioRequest): Promise<void> {
  const bridge = useStudioBridge.getState().bridge;
  let reply: { ok: boolean; result?: unknown; error?: string };
  if (!bridge || bridge.storyId !== storyId) {
    reply = { ok: false, error: "This studio is still loading. Try again in a moment." };
  } else {
    try {
      if (req.op === "context") {
        reply = { ok: true, result: bridge.context() };
      } else if (req.op === "apply") {
        const payload = (req.payload ?? {}) as { actions?: StudioAction[]; summary?: string };
        const actions = Array.isArray(payload.actions) ? payload.actions : [];
        bridge.apply(actions, payload.summary ?? "");
        reply = { ok: true, result: { applied: actions.length } };
      } else {
        reply = { ok: false, error: `Unknown studio request '${String(req.op)}'.` };
      }
    } catch (err) {
      reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  try {
    await api.studioReply(storyId, req.id, reply);
  } catch {
    // The server gave up on this request (timeout, or another tab answered).
    // Nothing is waiting for it any more, so there is nothing to tell anyone.
  }
}
