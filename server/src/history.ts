/**
 * What happened in a studio, in order, and who caused it.
 *
 * The History panel used to be the prompt box's own render log: a
 * `localStorage` array, one browser, one studio, and only the things that
 * panel generated. Everything else a person did — every question asked, every
 * edit the assistant applied, every line it wrote — left no trace at all.
 *
 * This is the other thing. Not the server log next door in Activity, which
 * answers "what is the backend doing" and is a rotating diagnostic tail with
 * levels and job ids; this answers "what did *I* do", survives a reload and a
 * different browser, and reads as a story rather than a trace. The two are
 * complementary and deliberately separate: an entry here can name the job
 * that carried it out, and the logs page is where you go when you want to
 * know why that job went wrong.
 *
 * An entry is one turn of cause and effect:
 *
 *   - what was said (`role`, `content`) — the conversation
 *   - what it did (`actions`) — the edits that were applied
 *   - what came of it (`sound_ids`) — the audio that now exists
 *
 * All three are optional because not every turn has all three. A question has
 * words and no effect. A render from the prompt panel has an effect and no
 * words. Keeping them in one table rather than three is the point: "what
 * happened here" is one list, in one order, or it is not history.
 */

import type { Database } from "better-sqlite3";

export interface HistoryEntry {
  id: string;
  conversation_id: string;
  position: number;
  /** "user" for something a person typed or clicked, "assistant" for the
   *  reply or the action taken on their behalf. */
  role: "user" | "assistant";
  content: string;
  /** One line per edit, already in the user's words — the same strings the
   *  chat showed when it applied them. Stored as text rather than as the
   *  action objects, because an action refers to clip ids that may not exist
   *  tomorrow and "Rename track 0 to Kick" is true forever. */
  actions: string[];
  /** Sounds this turn produced, so the entry can play them back. */
  sound_ids: string[];
  /** The job that carried it out, when one did — the bridge to the logs. */
  job_id: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  /** The studio this happened in. Null for a thread held outside one. */
  story_id: string | null;
  created_at: string;
  updated_at: string;
  entry_count: number;
}

interface ConversationRow {
  id: string;
  title: string;
  story_id: string | null;
  created_at: string;
  updated_at: string;
  n: number;
}

interface EntryRow {
  id: string;
  conversation_id: string;
  position: number;
  role: string;
  content: string;
  actions: string | null;
  sound_ids: string | null;
  job_id: string | null;
  created_at: string;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    story_id   TEXT REFERENCES stories(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_story ON conversations(story_id);

CREATE TABLE IF NOT EXISTS conversation_entries (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL DEFAULT '',
    -- JSON arrays. Null and '[]' mean the same thing; null is what a row
    -- written before the column existed would have.
    actions         TEXT,
    sound_ids       TEXT,
    job_id          TEXT,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_conversation
    ON conversation_entries(conversation_id, position);
`;

/** JSON that came out of our own column, defended anyway: a row hand-edited
 *  or written by a newer build should cost its extras, not the whole entry. */
function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    story_id: row.story_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    entry_count: row.n,
  };
}

function toEntry(row: EntryRow): HistoryEntry {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    position: row.position,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    actions: parseList(row.actions),
    sound_ids: parseList(row.sound_ids),
    job_id: row.job_id,
    created_at: row.created_at,
  };
}

/** What a caller adds. `position` and `id` are ours to assign. */
export interface NewEntry {
  role: "user" | "assistant";
  content?: string;
  actions?: string[];
  sound_ids?: string[];
  job_id?: string | null;
}

/**
 * The history store.
 *
 * A class over the shared connection rather than more methods on `KonchiDb`,
 * because history is self-contained — two tables nothing else joins against —
 * and `db.ts` is already two thousand lines of everything.
 */
export class HistoryStore {
  constructor(
    private readonly conn: Database,
    private readonly newId: () => string,
    private readonly now: () => string,
  ) {
    this.conn.exec(SCHEMA);
    this.onePerStory();
  }

  /**
   * One conversation per studio, enforced by the database.
   *
   * The studio creates its thread lazily, on the first write, by asking "is
   * there one?" and making one if not. Two first writes close together — a
   * render settling as you send a question — both heard "no", and the studio
   * ended up with two threads, only the newer of which the History panel
   * shows. A unique index turns the second create into a no-op (see `create`).
   *
   * A database that already raced has duplicates the index cannot be built
   * over, so those are folded together first: every entry moves into the
   * thread `forStory` would have picked, in the order they happened, and the
   * emptied threads go. Nothing is lost, and the panel finally shows it all.
   */
  private onePerStory(): void {
    const stories = this.conn
      .prepare(
        `SELECT story_id FROM conversations WHERE story_id IS NOT NULL
         GROUP BY story_id HAVING COUNT(*) > 1`,
      )
      .all() as { story_id: string }[];
    if (stories.length > 0) {
      const merge = this.conn.transaction(() => {
        for (const { story_id } of stories) {
          const threads = this.conn
            .prepare(
              `SELECT id FROM conversations WHERE story_id = ?
               ORDER BY updated_at DESC, created_at DESC, id DESC`,
            )
            .all(story_id) as { id: string }[];
          const keep = threads[0]!.id;
          const entries = this.conn
            .prepare(
              `SELECT e.id FROM conversation_entries e
                 JOIN conversations c ON c.id = e.conversation_id
                WHERE c.story_id = ?
                ORDER BY e.created_at, c.created_at, e.position`,
            )
            .all(story_id) as { id: string }[];
          const move = this.conn.prepare(
            "UPDATE conversation_entries SET conversation_id = ?, position = ? WHERE id = ?",
          );
          entries.forEach((e, i) => move.run(keep, i, e.id));
          const drop = this.conn.prepare("DELETE FROM conversations WHERE id = ?");
          for (const { id } of threads.slice(1)) drop.run(id);
        }
      });
      merge();
    }
    this.conn.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_one_per_story
         ON conversations(story_id) WHERE story_id IS NOT NULL`,
    );
  }

  /** A studio's thread, if it already has one, is the answer to creating
   *  another: the caller wanted somewhere to write, and that is it. */
  create(title: string, storyId: string | null = null): Conversation {
    const id = this.newId();
    const at = this.now();
    const inserted = this.conn
      .prepare(
        "INSERT OR IGNORE INTO conversations (id, title, story_id, created_at, updated_at)" +
          " VALUES (?,?,?,?,?)",
      )
      .run(id, title, storyId, at, at);
    if (inserted.changes === 0 && storyId !== null) {
      const existing = this.forStory(storyId);
      if (existing) return existing;
    }
    return { id, title, story_id: storyId, created_at: at, updated_at: at, entry_count: 0 };
  }

  list(limit = 50): Conversation[] {
    return (
      this.conn
        .prepare(
          `SELECT c.*, (SELECT COUNT(*) FROM conversation_entries e
                        WHERE e.conversation_id = c.id) n
           FROM conversations c ORDER BY c.updated_at DESC LIMIT ?`,
        )
        .all(limit) as ConversationRow[]
    ).map(toConversation);
  }

  get(id: string): Conversation | null {
    const row = this.conn
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM conversation_entries e
                      WHERE e.conversation_id = c.id) n
         FROM conversations c WHERE c.id = ?`,
      )
      .get(id) as ConversationRow | undefined;
    return row ? toConversation(row) : null;
  }

  /** The conversation held in a studio, if there is one. What lets opening a
   *  timeline bring back the history of how it got that way. */
  forStory(storyId: string): Conversation | null {
    const row = this.conn
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM conversation_entries e
                      WHERE e.conversation_id = c.id) n
         FROM conversations c WHERE c.story_id = ?
         ORDER BY c.updated_at DESC LIMIT 1`,
      )
      .get(storyId) as ConversationRow | undefined;
    return row ? toConversation(row) : null;
  }

  entries(conversationId: string): HistoryEntry[] {
    return (
      this.conn
        .prepare(
          "SELECT * FROM conversation_entries WHERE conversation_id = ? ORDER BY position",
        )
        .all(conversationId) as EntryRow[]
    ).map(toEntry);
  }

  /**
   * Append entries and touch the conversation, together.
   *
   * One transaction because a question without its answer, or an answer
   * without the question, reads as the app talking to itself — and because
   * `position` is derived from what is already there, which two concurrent
   * appends would otherwise both read as the same number.
   */
  append(conversationId: string, entries: NewEntry[]): HistoryEntry[] {
    if (!entries.length) return this.entries(conversationId);
    const at = this.now();
    const write = this.conn.transaction(() => {
      const row = this.conn
        .prepare(
          "SELECT COALESCE(MAX(position), -1) p FROM conversation_entries WHERE conversation_id = ?",
        )
        .get(conversationId) as { p: number } | undefined;
      let next = (row?.p ?? -1) + 1;
      const insert = this.conn.prepare(
        "INSERT INTO conversation_entries" +
          " (id, conversation_id, position, role, content, actions, sound_ids, job_id, created_at)" +
          " VALUES (?,?,?,?,?,?,?,?,?)",
      );
      for (const e of entries) {
        insert.run(
          this.newId(),
          conversationId,
          next++,
          e.role,
          e.content ?? "",
          e.actions?.length ? JSON.stringify(e.actions) : null,
          e.sound_ids?.length ? JSON.stringify(e.sound_ids) : null,
          e.job_id ?? null,
          at,
        );
      }
      this.conn
        .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(at, conversationId);
    });
    write();
    return this.entries(conversationId);
  }

  rename(id: string, title: string): Conversation | null {
    this.conn
      .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, this.now(), id);
    return this.get(id);
  }

  /** Entries go with it, through ON DELETE CASCADE. A conversation with no
   *  entries is not something anyone wants kept. */
  remove(id: string): boolean {
    return this.conn.prepare("DELETE FROM conversations WHERE id = ?").run(id).changes > 0;
  }

  /**
   * A title from the first thing said, the way a session titles itself from
   * its first prompt. Trimmed at a word boundary so it does not stop
   * mid-syllable, and never empty — an untitled row in a list is a row you
   * cannot choose between.
   */
  static titleFrom(text: string): string {
    const clean = text.trim().replace(/\s+/g, " ");
    if (!clean) return "New conversation";
    if (clean.length <= 48) return clean;
    const cut = clean.slice(0, 48);
    const space = cut.lastIndexOf(" ");
    return `${(space > 24 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }
}
