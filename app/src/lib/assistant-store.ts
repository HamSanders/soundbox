/**
 * The studio assistant's threads — one per conversation, not one in total.
 *
 * A store rather than component state for the same reason the Generate
 * session is one: the conversation is the work. Building a prompt takes a few
 * turns, and bouncing to Models to check a licence — or to the studio to
 * load what was proposed — unmounts the page. Losing the thread to that
 * round trip would make the assistant a thing you use once, carefully.
 *
 * It used to be a single `messages` array, which meant every studio showed
 * the same conversation: open one story, ask for a bassline, open another,
 * and the thread beside the second timeline was talking about the first.
 * Worse, the edits card under a turn describes a plan written against *that*
 * story's tracks, so a shared thread offered Apply buttons for an arrangement
 * that was no longer on screen. Threads are keyed now — a studio passes its
 * story id, the Chat page uses {@link DEFAULT_THREAD} — and the assistant
 * beside a timeline is the conversation about that timeline.
 *
 * Threads persist, because "what did I ask it to do here" is a question you
 * have on the second visit rather than the first. What does not persist is
 * `pending`: a reload during a request would otherwise come back with the
 * input locked against an answer that is never arriving.
 *
 * Nothing here talks to the server. The page sends the thread and folds the
 * reply back in, so the store is only ever a record of what was said and
 * what came of it.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AssistantLink, AssistantTurn } from "./api";
import type { StudioAction, StudioContext } from "./studio-command";

/** The thread that belongs to no story: the Chat page's own. */
export const DEFAULT_THREAD = "chat";

/** The thread key for one studio. Prefixed so a story id can never collide
 *  with {@link DEFAULT_THREAD} or anything keyed later. */
export function studioThread(storyId: string): string {
  return `story:${storyId}`;
}

/** How many threads to keep on disk, newest first, and how much of each. A
 *  conversation you have not touched in twenty studios is not what
 *  localStorage is for — and neither is the first turn of a long one. */
const MAX_THREADS = 24;
const MAX_MESSAGES = 100;

/** One message on screen. Assistant turns can carry the proposal they came
 *  with, which is what the thread renders as a card under the reply. */
export interface AssistantMessage extends AssistantTurn {
  id: string;
  /** Places this answer pointed at, and the documentation it came from. The
   *  guide proposes no work, so a turn carries directions rather than a
   *  request to run. */
  links?: AssistantLink[];
  sources?: string[];
  /**
   * Edits this turn made (or wants to make) to the studio beside the chat.
   * `applied` is false while a destructive plan waits for the person to
   * confirm it. The context is the snapshot the plan was written against,
   * so the edits can be described in the user's own words.
   */
  edits?: { actions: StudioAction[]; context: StudioContext; applied: boolean } | null;
  /**
   * What the assistant worked out on the way to this turn.
   *
   * Not the model's chain-of-thought — that is switched off server-side on
   * purpose — but the decisions the pipeline actually made: which planner the
   * request was routed to, and what came back. Kept per message so it stays
   * attached to the answer it explains.
   */
  thinking?: { classified?: string; actions?: number; dropped?: number } | null;
  /** A turn that never got its answer — shown in place, with a retry. */
  error?: string | null;
}

interface Thread {
  messages: AssistantMessage[];
  /** Not persisted; see the note at the top of the file. */
  pending: boolean;
  /** When this thread was last spoken in, for deciding what to keep. */
  at: number;
}

interface AssistantState {
  threads: Record<string, Thread>;
  append: (key: string, message: Omit<AssistantMessage, "id">) => string;
  /** Fill in the reply for a pending turn — or mark it failed. */
  settle: (
    key: string,
    id: string,
    result:
      | {
          content: string;
          links?: AssistantLink[];
          sources?: string[];
          edits?: AssistantMessage["edits"];
          thinking?: AssistantMessage["thinking"];
        }
      | { error: string },
  ) => void;
  /** A waiting plan was applied (or thrown away). */
  markEdits: (key: string, id: string, applied: boolean | null) => void;
  setPending: (key: string, pending: boolean) => void;
  /** Drop this message and everything after it. What a retry does before it
   *  asks the question again, so the failed pair is replaced rather than
   *  repeated. */
  dropFrom: (key: string, id: string) => void;
  /** Empty one thread. Other conversations are untouched. */
  reset: (key: string) => void;
}

/**
 * Message ids are per-load unique and that is enough — they key React lists
 * and address one turn within one thread. A counter alone is not, once
 * threads outlive the tab that made them: after a reload it would start again
 * at 1 and a `settle` could land on a persisted message. The load prefix is
 * what keeps a fresh session's ids clear of an old session's.
 */
const LOAD = Math.random().toString(36).slice(2, 8);
let seq = 0;
const nextId = (): string => `msg-${LOAD}-${++seq}`;

const EMPTY: Thread = { messages: [], pending: false, at: 0 };

/** Read-modify-write one thread, creating it if this is its first turn. */
function edit(
  state: AssistantState,
  key: string,
  change: (thread: Thread) => Thread,
): Pick<AssistantState, "threads"> {
  const thread = state.threads[key] ?? EMPTY;
  return { threads: { ...state.threads, [key]: change(thread) } };
}

export const useAssistantStore = create<AssistantState>()(
  persist(
    (set) => ({
      threads: {},

      append: (key, message) => {
        const id = nextId();
        set((s) =>
          edit(s, key, (t) => ({
            ...t,
            messages: [...t.messages, { ...message, id }],
            at: Date.now(),
          })),
        );
        return id;
      },

      settle: (key, id, result) =>
        set((s) =>
          edit(s, key, (t) => ({
            ...t,
            at: Date.now(),
            messages: t.messages.map((m) =>
              m.id !== id
                ? m
                : "error" in result
                  ? { ...m, error: result.error }
                  : {
                      ...m,
                      content: result.content,
                      links: result.links ?? [],
                      sources: result.sources ?? [],
                      edits: result.edits ?? null,
                      thinking: result.thinking ?? null,
                      error: null,
                    },
            ),
          })),
        ),

      markEdits: (key, id, applied) =>
        set((s) =>
          edit(s, key, (t) => ({
            ...t,
            messages: t.messages.map((m) =>
              m.id !== id || !m.edits
                ? m
                : applied === null
                  ? { ...m, edits: null }
                  : { ...m, edits: { ...m.edits, applied } },
            ),
          })),
        ),

      setPending: (key, pending) => set((s) => edit(s, key, (t) => ({ ...t, pending }))),

      dropFrom: (key, id) =>
        set((s) =>
          edit(s, key, (t) => {
            const at = t.messages.findIndex((m) => m.id === id);
            return at === -1 ? t : { ...t, messages: t.messages.slice(0, at) };
          }),
        ),

      reset: (key) =>
        set((s) => ({ threads: { ...s.threads, [key]: { ...EMPTY, at: Date.now() } } })),
    }),
    {
      name: "konchi.assistant-threads",
      partialize: (state) => ({
        threads: Object.fromEntries(
          Object.entries(state.threads)
            .filter(([, t]) => t.messages.length > 0)
            .sort((a, b) => b[1].at - a[1].at)
            .slice(0, MAX_THREADS)
            .map(([key, t]) => [
              key,
              {
                ...t,
                pending: false,
                messages: t.messages.slice(-MAX_MESSAGES),
              },
            ]),
        ),
      }),
    },
  ),
);

/** One thread, or an empty one. The same object every time for a thread that
 *  does not exist yet, so a selector on it does not re-render on every store
 *  write elsewhere. */
export function useThread(key: string): Thread {
  return useAssistantStore((s) => s.threads[key] ?? EMPTY);
}

/** The messages of one thread as they stand right now, outside React — what
 *  `send` reads to build the request body. */
export function threadMessages(key: string): AssistantMessage[] {
  return useAssistantStore.getState().threads[key]?.messages ?? [];
}

/** Strip the screen-only fields before the thread goes to the server. A
 *  failed turn is left out: its question was never answered, and replaying
 *  it would have the model answer a message the user has already retried. */
export function threadForServer(messages: AssistantMessage[]): AssistantTurn[] {
  return messages
    .filter((m) => !m.error && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
}
