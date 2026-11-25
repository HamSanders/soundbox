/**
 * Who is doing what to a story, and telling everyone watching.
 *
 * A story is not a single-player document any more: an agent can be writing
 * lines over MCP while a person has the studio open on the same timeline. That
 * is fine — it is the point — but only if the studio can see it happening.
 * Otherwise the page silently drifts out of date, and the user edits a script
 * that no longer looks like what they are looking at.
 *
 * So two things are published here. `changed` says the story's contents moved
 * and anyone holding a copy should refetch. `agent` says a tool is mid-work,
 * which is what lets the studio say so and stop taking edits that would race
 * it. Both go out over the same per-story stream.
 *
 * Deliberately in-memory and not persisted: this is "what is happening right
 * now", which cannot survive a restart and should not pretend to. A process
 * that dies mid-agent-call leaves no work in flight to report.
 */

import { randomUUID } from "node:crypto";

import { AsyncQueue } from "./jobs.js";
import { getLogger } from "./logging.js";

const log = getLogger("mirli.stories");

export type StoryEvent =
  | { type: "changed" }
  /** `label` is what the agent is doing, in words a person can read. */
  | { type: "agent"; active: boolean; label: string; count: number }
  /**
   * A question for the open studio, answered by POSTing to
   * `/api/stories/:id/studio/replies/:request_id`. Only sent to a stream that
   * said it can answer (`?answer=1`), and only to one of them.
   */
  | { type: "request"; id: string; op: StudioOp; payload?: unknown };

/**
 * What an agent can ask the open studio for.
 *
 * - `context`: the live snapshot the command bar plans against — lanes, clips,
 *   playhead, selection, voices, each lane's rack.
 * - `apply`: run a list of already-validated `StudioAction`s through the
 *   studio's own handlers, so they land on its undo stack like clicks.
 */
export type StudioOp = "context" | "apply";

/** No studio has this story open, so there is nobody to ask. */
export class StudioNotOpenError extends Error {}

/** The studio was asked and did not answer in time, or said no. */
export class StudioRequestError extends Error {}

export interface StudioReply {
  ok: boolean;
  result?: unknown;
  error?: string | null;
}

interface PendingRequest {
  storyId: string;
  queue: AsyncQueue<StoryEvent>;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** How long a studio gets to answer. Context is instant; apply only starts the
 *  studio's mutations, it does not wait for them, so a few seconds is plenty
 *  and anything longer means the tab is asleep or gone. */
export const STUDIO_REQUEST_TIMEOUT_MS = 8_000;

/** One agent's claim on a story. */
interface Claim {
  label: string;
}

export class StoryHub {
  private readonly subscribers = new Map<string, AsyncQueue<StoryEvent>[]>();
  /** Claims per story, keyed by an opaque token so overlapping calls from the
   *  same agent release independently. */
  private readonly claims = new Map<string, Map<symbol, Claim>>();
  /**
   * Streams that belong to a mounted studio and will answer requests, in the
   * order they connected. A subset of `subscribers`: other watchers of a
   * story only refetch and must never be asked to apply anything.
   */
  private readonly answerers = new Map<string, AsyncQueue<StoryEvent>[]>();
  private readonly pending = new Map<string, PendingRequest>();

  /**
   * Watch a story. `answers` marks the stream as a mounted studio that can be
   * asked for its live state and to apply edits — see `ask`.
   */
  subscribe(storyId: string, options: { answers?: boolean } = {}): AsyncQueue<StoryEvent> {
    const q = new AsyncQueue<StoryEvent>();
    const subs = this.subscribers.get(storyId);
    if (subs) subs.push(q);
    else this.subscribers.set(storyId, [q]);
    if (options.answers) {
      const list = this.answerers.get(storyId);
      if (list) list.push(q);
      else this.answerers.set(storyId, [q]);
    }
    return q;
  }

  unsubscribe(storyId: string, q: AsyncQueue<StoryEvent>): void {
    const subs = this.subscribers.get(storyId);
    if (subs) {
      const i = subs.indexOf(q);
      if (i !== -1) subs.splice(i, 1);
      if (!subs.length) this.subscribers.delete(storyId);
    }
    const list = this.answerers.get(storyId);
    if (list) {
      const i = list.indexOf(q);
      if (i !== -1) list.splice(i, 1);
      if (!list.length) this.answerers.delete(storyId);
    }
    // A question put to a tab that has just closed will never be answered;
    // say so now rather than when the timer runs out.
    for (const [id, req] of this.pending) {
      if (req.queue !== q) continue;
      this.pending.delete(id);
      clearTimeout(req.timer);
      req.reject(new StudioNotOpenError("The studio was closed before it answered."));
    }
    q.close();
  }

  /** Stories that have a studio open right now and can be asked things. */
  openStudios(): string[] {
    return [...this.answerers.keys()];
  }

  /**
   * Ask the open studio for something and wait for its answer.
   *
   * Sent to one studio only — the most recently opened — because `apply` is
   * not idempotent: two tabs on the same story would each run the edits. The
   * newest tab is the likeliest to be the one in front of the person.
   */
  ask(
    storyId: string,
    op: StudioOp,
    payload?: unknown,
    timeoutMs: number = STUDIO_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const list = this.answerers.get(storyId);
    const queue = list?.[list.length - 1];
    if (!queue) {
      return Promise.reject(
        new StudioNotOpenError(`No studio has story ${storyId} open.`),
      );
    }
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(
          new StudioRequestError(
            "The studio did not answer. Its tab may be asleep in the background; " +
              "ask the user to bring it forward.",
          ),
        );
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { storyId, queue, resolve, reject, timer });
      queue.push({ type: "request", id, op, payload });
    });
  }

  /**
   * The studio's answer to `ask`. False when there is no such request — it
   * timed out, was answered already, or belongs to another story.
   */
  answer(storyId: string, requestId: string, reply: StudioReply): boolean {
    const req = this.pending.get(requestId);
    if (!req || req.storyId !== storyId) return false;
    this.pending.delete(requestId);
    clearTimeout(req.timer);
    if (reply.ok) req.resolve(reply.result);
    else req.reject(new StudioRequestError(reply.error || "The studio refused the request."));
    return true;
  }

  /** The story's contents moved. Cheap enough to call from every mutation —
   *  with nobody watching it does nothing at all. */
  changed(storyId: string): void {
    this.publish(storyId, { type: "changed" });
  }

  /**
   * Claim a story for the duration of some agent work. Returns the release.
   *
   * A token rather than a boolean because two tools can be working on one
   * story at once — speaking it while a second call adds lines — and the first
   * to finish must not declare the story free.
   */
  claim(storyId: string, label: string): () => void {
    const token = Symbol(label);
    let claims = this.claims.get(storyId);
    if (!claims) {
      claims = new Map();
      this.claims.set(storyId, claims);
    }
    claims.set(token, { label });
    log.info(`agent working on story ${storyId}: ${label}`);
    this.publish(storyId, { type: "agent", active: true, label, count: claims.size });

    let released = false;
    return () => {
      // Idempotent: a caller that releases in both a success path and a
      // `finally` should not double-count.
      if (released) return;
      released = true;
      const current = this.claims.get(storyId);
      if (!current) return;
      current.delete(token);
      if (current.size === 0) this.claims.delete(storyId);
      this.publish(storyId, {
        type: "agent",
        active: current.size > 0,
        label,
        count: current.size,
      });
      // The work is what changed the story; say so once it has finished, so a
      // watcher refetches the finished state rather than a half-written one.
      this.changed(storyId);
    };
  }

  /** What an agent is doing to this story right now, for a client that has
   *  just connected and missed the event. */
  activity(storyId: string): { active: boolean; label: string | null; count: number } {
    const claims = this.claims.get(storyId);
    if (!claims || claims.size === 0) return { active: false, label: null, count: 0 };
    // The most recent claim is the most informative thing to show.
    const labels = [...claims.values()];
    return { active: true, label: labels[labels.length - 1].label, count: claims.size };
  }

  private publish(storyId: string, event: StoryEvent): void {
    for (const q of this.subscribers.get(storyId) ?? []) q.push(event);
  }
}
