/**
 * Audiobooks: the `book_renders` table. A render run is persisted as it goes
 * (status, counters, the paragraph list and every QC retry), so a server
 * restart picks it up where it stopped.
 */

import type { Database } from "better-sqlite3";

import type { RenderRun, RenderScope, RenderStatus } from "./types.js";

export const RENDER_SCHEMA = `
CREATE TABLE IF NOT EXISTS book_renders (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  overwrite INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  current_segment_id TEXT,
  error TEXT,
  queue TEXT NOT NULL DEFAULT '[]',
  log TEXT NOT NULL DEFAULT '[]',
  options TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS book_renders_book ON book_renders(book_id, created_at);
`;

/** One QC outcome worth showing: a retry, a final failure, or a warning. */
export interface RenderLogEntry {
  segment_id: string;
  attempt: number;
  /** "retry": QC failed and the paragraph was voiced again. "failed": gave
   *  up. "warning": kept, but something is worth a listen. */
  outcome: "retry" | "failed" | "warning";
  checks: string[];
  message: string;
  at: string;
}

export interface RenderOptions {
  /** Retries after a failed QC check (0–2). */
  max_retries: number;
  /** ASR model used for the word check, when one is installed. */
  asr_model: string | null;
}

export interface RenderRunDetail extends RenderRun {
  skipped: number;
  /** Paragraph ids still to voice, in order. */
  queue: string[];
  log: RenderLogEntry[];
  options: RenderOptions;
}

interface Row {
  id: string;
  book_id: string;
  scope: string;
  overwrite: number;
  status: string;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  current_segment_id: string | null;
  error: string | null;
  queue: string;
  log: string;
  options: string;
  created_at: string;
  updated_at: string;
}

const LOG_CAP = 500;

function parse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function toRun(r: Row): RenderRunDetail {
  return {
    id: r.id,
    book_id: r.book_id,
    scope: parse<RenderScope>(r.scope, { kind: "book" }),
    overwrite: r.overwrite === 1,
    status: r.status as RenderStatus,
    total: r.total,
    done: r.done,
    failed: r.failed,
    skipped: r.skipped,
    current_segment_id: r.current_segment_id,
    error: r.error,
    queue: parse<string[]>(r.queue, []),
    log: parse<RenderLogEntry[]>(r.log, []),
    options: { max_retries: 2, asr_model: null, ...parse<Partial<RenderOptions>>(r.options, {}) },
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export type RunPatch = Partial<
  Pick<RenderRunDetail, "status" | "total" | "done" | "failed" | "skipped" | "current_segment_id" | "error" | "queue">
>;

export class RenderStore {
  constructor(
    private readonly conn: Database,
    private readonly newId: () => string,
    private readonly now: () => string,
  ) {
    conn.exec(RENDER_SCHEMA);
  }

  create(bookId: string, scope: RenderScope, overwrite: boolean, queue: string[], options: RenderOptions): RenderRunDetail {
    const id = this.newId();
    const at = this.now();
    this.conn
      .prepare(
        `INSERT INTO book_renders (id, book_id, scope, overwrite, status, total, queue, options, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
      )
      .run(id, bookId, JSON.stringify(scope), overwrite ? 1 : 0, queue.length, JSON.stringify(queue), JSON.stringify(options), at, at);
    return this.get(id)!;
  }

  get(id: string): RenderRunDetail | null {
    const r = this.conn.prepare("SELECT * FROM book_renders WHERE id = ?").get(id) as Row | undefined;
    return r ? toRun(r) : null;
  }

  list(bookId: string, limit = 20): RenderRunDetail[] {
    return (this.conn
      .prepare("SELECT * FROM book_renders WHERE book_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(bookId, limit) as Row[]).map(toRun);
  }

  /** Runs that were active when the server stopped. */
  unfinished(): RenderRunDetail[] {
    return (this.conn
      .prepare("SELECT * FROM book_renders WHERE status IN ('queued','running') ORDER BY created_at")
      .all() as Row[]).map(toRun);
  }

  update(id: string, patch: RunPatch): RenderRunDetail | null {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${k} = ?`);
      vals.push(k === "queue" ? JSON.stringify(v) : v);
    }
    sets.push("updated_at = ?");
    vals.push(this.now());
    this.conn.prepare(`UPDATE book_renders SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    return this.get(id);
  }

  appendLog(id: string, entry: RenderLogEntry): void {
    const run = this.get(id);
    if (!run) return;
    const log = [...run.log, entry].slice(-LOG_CAP);
    this.conn.prepare("UPDATE book_renders SET log = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(log), this.now(), id);
  }

  deleteBook(bookId: string): number {
    return this.conn.prepare("DELETE FROM book_renders WHERE book_id = ?").run(bookId).changes;
  }
}
