/**
 * Live book events, streamed at `GET /api/audiobooks/:id/events`.
 *
 * Every audiobook module publishes here: core when the book, its chapters or
 * paragraphs change, and the render, export and other modules for their own
 * progress. In-memory like `StoryHub`: it is "what is happening now" and does
 * not survive a restart.
 *
 * Core's events:
 *   { type: "book" }                          metadata or settings changed
 *   { type: "chapters" }                      chapters added, removed, reordered, renamed
 *   { type: "paragraphs", chapter_id }        a chapter's paragraphs changed
 *   { type: "characters" }                    the cast changed
 *   { type: "notes", chapter_id }             review notes changed
 *   { type: "snapshots" }                     a version was saved or deleted
 *   { type: "deleted" }                       the book is gone; the stream ends
 *
 * Other modules use their own `type` (e.g. "render", "export") and any extra
 * fields they need. Clients ignore types they don't know.
 */

import { AsyncQueue } from "../jobs.js";

export type AudiobookEvent =
  | { type: "book" }
  | { type: "chapters" }
  | { type: "paragraphs"; chapter_id: string; segment_ids?: string[] }
  | { type: "characters" }
  | { type: "deleted" }
  | { type: "hello" }
  | ({ type: string } & Record<string, unknown>);

export class AudiobookHub {
  private readonly subscribers = new Map<string, AsyncQueue<AudiobookEvent>[]>();

  subscribe(bookId: string): AsyncQueue<AudiobookEvent> {
    const q = new AsyncQueue<AudiobookEvent>();
    const subs = this.subscribers.get(bookId);
    if (subs) subs.push(q);
    else this.subscribers.set(bookId, [q]);
    return q;
  }

  unsubscribe(bookId: string, q: AsyncQueue<AudiobookEvent>): void {
    const subs = this.subscribers.get(bookId);
    if (!subs) return;
    const i = subs.indexOf(q);
    if (i !== -1) subs.splice(i, 1);
    if (!subs.length) this.subscribers.delete(bookId);
    q.close();
  }

  /** Send `event` to everyone watching `bookId`. Free with nobody watching. */
  publish(bookId: string, event: AudiobookEvent): void {
    for (const q of this.subscribers.get(bookId) ?? []) q.push(event);
  }

  /** Number of open streams on a book, for tests. */
  watchers(bookId: string): number {
    return this.subscribers.get(bookId)?.length ?? 0;
  }
}
