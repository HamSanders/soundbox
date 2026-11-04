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

import { AsyncQueue } from "./jobs.js";
import { getLogger } from "./logging.js";

const log = getLogger("konchi.stories");

export type StoryEvent =
  | { type: "changed" }
  /** `label` is what the agent is doing, in words a person can read. */
  | { type: "agent"; active: boolean; label: string; count: number };

/** One agent's claim on a story. */
interface Claim {
  label: string;
}

export class StoryHub {
  private readonly subscribers = new Map<string, AsyncQueue<StoryEvent>[]>();
  /** Claims per story, keyed by an opaque token so overlapping calls from the
   *  same agent release independently. */
  private readonly claims = new Map<string, Map<symbol, Claim>>();

  subscribe(storyId: string): AsyncQueue<StoryEvent> {
    const q = new AsyncQueue<StoryEvent>();
    const subs = this.subscribers.get(storyId);
    if (subs) subs.push(q);
    else this.subscribers.set(storyId, [q]);
    return q;
  }

  unsubscribe(storyId: string, q: AsyncQueue<StoryEvent>): void {
    const subs = this.subscribers.get(storyId);
    if (!subs) return;
    const i = subs.indexOf(q);
    if (i !== -1) subs.splice(i, 1);
    if (!subs.length) this.subscribers.delete(storyId);
    q.close();
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
