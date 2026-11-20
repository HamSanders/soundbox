/**
 * Audiobooks: the `pronunciations` table. Book rules (book_id set) and the
 * global dictionary (book_id null) share it; `rulesFor` returns both, book
 * first. Runs its own schema on the shared connection, like `HistoryStore`.
 */

import type { Database } from "better-sqlite3";

import type { PronunciationKind, PronunciationRule } from "./types.js";

export const PRONOUNCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS pronunciations (
  id TEXT PRIMARY KEY,
  book_id TEXT,
  term TEXT NOT NULL,
  kind TEXT NOT NULL,
  replacement TEXT NOT NULL,
  case_sensitive INTEGER NOT NULL DEFAULT 1,
  whole_word INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pronunciations_book ON pronunciations(book_id, position);
`;

interface Row {
  id: string;
  book_id: string | null;
  term: string;
  kind: string;
  replacement: string;
  case_sensitive: number;
  whole_word: number;
  position: number;
}

export type RuleFields = Partial<Pick<PronunciationRule, "term" | "kind" | "replacement" | "case_sensitive" | "whole_word" | "position">>;

const KINDS: readonly PronunciationKind[] = ["alias", "ipa", "cmu"];

function toRule(r: Row): PronunciationRule {
  return {
    id: r.id,
    book_id: r.book_id,
    term: r.term,
    kind: (KINDS as readonly string[]).includes(r.kind) ? (r.kind as PronunciationKind) : "alias",
    replacement: r.replacement,
    case_sensitive: r.case_sensitive === 1,
    whole_word: r.whole_word === 1,
    position: r.position,
  };
}

export class PronunciationStore {
  constructor(
    private readonly conn: Database,
    private readonly newId: () => string,
    private readonly now: () => string,
  ) {
    conn.exec(PRONOUNCE_SCHEMA);
  }

  /** One book's rules, or the global dictionary when `bookId` is null. */
  list(bookId: string | null): PronunciationRule[] {
    const rows = (bookId === null
      ? this.conn.prepare("SELECT * FROM pronunciations WHERE book_id IS NULL ORDER BY position, created_at").all()
      : this.conn.prepare("SELECT * FROM pronunciations WHERE book_id = ? ORDER BY position, created_at").all(bookId)) as Row[];
    return rows.map(toRule);
  }

  /** What a render applies: the book's rules, then the global dictionary. */
  rulesFor(bookId: string): PronunciationRule[] {
    return [...this.list(bookId), ...this.list(null)];
  }

  get(id: string): PronunciationRule | null {
    const row = this.conn.prepare("SELECT * FROM pronunciations WHERE id = ?").get(id) as Row | undefined;
    return row ? toRule(row) : null;
  }

  create(bookId: string | null, fields: RuleFields & { term: string; replacement: string }): PronunciationRule {
    const id = this.newId();
    const max = (bookId === null
      ? this.conn.prepare("SELECT MAX(position) AS m FROM pronunciations WHERE book_id IS NULL").get()
      : this.conn.prepare("SELECT MAX(position) AS m FROM pronunciations WHERE book_id = ?").get(bookId)) as { m: number | null };
    this.conn
      .prepare(
        `INSERT INTO pronunciations (id, book_id, term, kind, replacement, case_sensitive, whole_word, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        bookId,
        fields.term,
        fields.kind ?? "alias",
        fields.replacement,
        fields.case_sensitive === false ? 0 : 1,
        fields.whole_word === false ? 0 : 1,
        fields.position ?? (max.m ?? -1) + 1,
        this.now(),
      );
    return this.get(id)!;
  }

  update(id: string, fields: RuleFields): PronunciationRule | null {
    const cur = this.get(id);
    if (!cur) return null;
    const next = { ...cur, ...fields };
    this.conn
      .prepare(
        `UPDATE pronunciations SET term=?, kind=?, replacement=?, case_sensitive=?, whole_word=?, position=? WHERE id=?`,
      )
      .run(next.term, next.kind, next.replacement, next.case_sensitive ? 1 : 0, next.whole_word ? 1 : 0, next.position, id);
    return this.get(id);
  }

  delete(id: string): boolean {
    return this.conn.prepare("DELETE FROM pronunciations WHERE id = ?").run(id).changes > 0;
  }

  /** Set the order of a book's (or the global) rules to `ids`. */
  reorder(ids: string[]): void {
    const set = this.conn.prepare("UPDATE pronunciations SET position = ? WHERE id = ?");
    this.conn.transaction(() => ids.forEach((id, i) => set.run(i, id)))();
  }

  deleteBook(bookId: string): number {
    return this.conn.prepare("DELETE FROM pronunciations WHERE book_id = ?").run(bookId).changes;
  }
}
