/**
 * SQLite persistence for the sound library.
 *
 * Deliberately small: one table plus a tag
 * join table. Jobs are *not* persisted — they are in-memory and die with the
 * process, which is the honest model for work that cannot survive a restart
 * anyway.
 *
 * The Python file carried a `_migrate()` that additively added columns to older
 * databases. This port declares the final shape directly; a database written by
 * the Python server has already been migrated to it, so the two agree on disk.
 */

import { randomUUID } from "node:crypto";

import BetterSqlite3 from "better-sqlite3";
import type { Database as Sqlite, Statement } from "better-sqlite3";

import type { DeviceSpec } from "./devices.js";
import { catalogById } from "./models/audiocpp.js";
import { HistoryStore } from "./history.js";

import type {
  McpCall,
  McpClient,
  Project,
  SegmentPatch,
  Session,
  Sound,
  Source,
  Story,
  StoryBuilder,
  StorySegment,
  StoryTrack,
  TimelineClip,
  TrackPatch,
  TagCount,
  Voice,
  VoiceSample,
  EditKind,
  EditOptions,
} from "./schemas.js";

/**
 * Sentinel distinguishing "leave this field alone" (the default) from
 * "explicitly set it to null" — needed for project_id, where null is itself a
 * meaningful target state (unfiled), unlike the other patchable fields.
 */
export const UNSET = Symbol("unset");
export type Unset = typeof UNSET;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sounds (
    id            TEXT PRIMARY KEY,
    created_at    TEXT NOT NULL,
    model        TEXT NOT NULL,
    prompt        TEXT NOT NULL,
    negative_prompt TEXT,
    lyrics        TEXT,
    track_name    TEXT,
    edit          TEXT,
    edit_options  TEXT,
    duration_s    REAL NOT NULL,
    seed          INTEGER,
    steps         INTEGER,
    cfg           REAL,
    sample_rate   INTEGER NOT NULL,
    channels      INTEGER NOT NULL,
    filename      TEXT NOT NULL,
    peaks         TEXT NOT NULL DEFAULT '[]',
    favorite      INTEGER NOT NULL DEFAULT 0,
    name          TEXT NOT NULL DEFAULT '',
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    session_id    TEXT REFERENCES sessions(id),
    project_id    TEXT REFERENCES projects(id),
    parent_id     TEXT REFERENCES sounds(id),
    source        TEXT NOT NULL DEFAULT 'app',
    client        TEXT
);
CREATE INDEX IF NOT EXISTS idx_sounds_created ON sounds(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sounds_model  ON sounds(model);
CREATE INDEX IF NOT EXISTS idx_sounds_session ON sounds(session_id);
CREATE INDEX IF NOT EXISTS idx_sounds_project ON sounds(project_id);
CREATE INDEX IF NOT EXISTS idx_sounds_parent  ON sounds(parent_id);
CREATE INDEX IF NOT EXISTS idx_sounds_source  ON sounds(source);

CREATE TABLE IF NOT EXISTS sound_tags (
    sound_id TEXT NOT NULL REFERENCES sounds(id) ON DELETE CASCADE,
    tag      TEXT NOT NULL,
    PRIMARY KEY (sound_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON sound_tags(tag);

-- A session is one working thread: a run of related generations you can come
-- back to, the way a chat app groups messages into a conversation. Sounds can
-- exist without one — everything made before sessions existed, and anything
-- generated straight through the API or MCP — so \`sounds.session_id\` is
-- nullable by design and the Library stays a flat view across all of them.
CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);

-- A project is a folder: a way to group sounds you consider part of one thing
-- (a game's footstep set, a client's brief) that outlives any one session.
-- Unlike sessions, projects are never created implicitly — only by name, from
-- the sidebar's "New project" — and deleting one only unfiles its sounds
-- rather than deleting them, since the whole point is organisation, not history.
CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at DESC);

-- A saved voice: what makes a TTS model speak as a particular character.
-- Either a reference clip on disk to clone (kind='clone', filename set) or a
-- name from one family's built-in voice list (kind='builtin', voice_id and
-- model_id set). Kept as its own table rather than a column on sounds because
-- a voice is reused across many generations — that reuse is the whole point.
CREATE TABLE IF NOT EXISTS voices (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'clone',
    created_at TEXT NOT NULL,
    filename   TEXT,
    voice_id   TEXT,
    model_id   TEXT,
    notes      TEXT
);
CREATE INDEX IF NOT EXISTS idx_voices_created ON voices(created_at DESC);

-- The clips a clone voice is made from. voices.filename stays the one file a
-- model is handed as --voice-ref: a voice's only clip, or all of its clips
-- joined (see audio/reference.ts). Kept as rows rather than a JSON column so
-- one clip can be removed without rewriting the others.
CREATE TABLE IF NOT EXISTS voice_samples (
    id         TEXT PRIMARY KEY,
    voice_id   TEXT NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
    filename   TEXT NOT NULL,
    duration_s REAL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_samples_voice ON voice_samples(voice_id, created_at);

-- A story is a script that stays: ordered lines that each know both their
-- place in the reading order and their place in time. A session is a log of
-- independent generations; a story is a document you keep arranging, which is
-- why it gets its own tables rather than nullable columns bolted onto
-- sessions that no other session would ever use.
CREATE TABLE IF NOT EXISTS stories (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id),
    -- Which of the two builders opens this story: 'script' or 'music'. Stored
    -- rather than guessed, because it is the choice made at the "new sound"
    -- door and a brand-new story has no clips to guess from. Null on rows
    -- written before the split; those fall back to the guess, see
    -- storyBuilders().
    builder    TEXT
);
CREATE INDEX IF NOT EXISTS idx_stories_updated ON stories(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_project ON stories(project_id);

-- One line of a story, and one clip on its timeline. \`position\` is where it
-- reads in the script; \`start_s\`/\`track_index\` are where it sits on the
-- timeline. Both are stored because they answer different questions, but the
-- placement decides the order: dragging a clip re-numbers position to match,
-- since the order things happen in is the order they are read in.
-- \`sound_id\` is null until the line has actually been spoken.
CREATE TABLE IF NOT EXISTS story_segments (
    id          TEXT PRIMARY KEY,
    story_id    TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    track_index INTEGER NOT NULL DEFAULT 0,
    speaker     TEXT,
    voice_id    TEXT REFERENCES voices(id),
    text        TEXT NOT NULL DEFAULT '',
    language    TEXT,
    sound_id    TEXT REFERENCES sounds(id),
    -- 'line' is something spoken; 'pause' is a deliberate beat of silence,
    -- written as its own entry so the script reads the way it sounds and the
    -- gap survives everything after it being re-timed.
    kind        TEXT NOT NULL DEFAULT 'line',
    -- How far into the source sound this clip starts. Paired with duration_s
    -- (how much of it plays) this trims a clip without touching its audio, so
    -- shortening is reversible and lengthening is just giving the duration
    -- back — the same bargain editSound makes by deriving a new sound.
    trim_start_s REAL NOT NULL DEFAULT 0,
    start_s     REAL NOT NULL DEFAULT 0,
    duration_s  REAL,
    -- Seconds of fade at each end of the clip, applied on playback and baked
    -- into the export. Zero means a hard edge, which is what a cut sounds like
    -- when it lands anywhere but a zero crossing: a click.
    fade_in_s   REAL NOT NULL DEFAULT 0,
    fade_out_s  REAL NOT NULL DEFAULT 0,
    muted       INTEGER NOT NULL DEFAULT 0,
    gain_db     REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segments_story ON story_segments(story_id, position);
CREATE INDEX IF NOT EXISTS idx_segments_sound ON story_segments(sound_id);


-- A track is a lane and the controls that belong to it. Mute, solo and volume
-- are properties of the lane rather than of the clips on it — muting a track
-- must not forget which of its clips you had muted individually, and unmuting
-- must give them back exactly as they were. Rows are created on demand: a
-- track with default settings is the absence of a row, so an untouched story
-- carries no track state at all.
CREATE TABLE IF NOT EXISTS story_tracks (
    story_id    TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    track_index INTEGER NOT NULL,
    name        TEXT,
    muted       INTEGER NOT NULL DEFAULT 0,
    soloed      INTEGER NOT NULL DEFAULT 0,
    gain_db     REAL NOT NULL DEFAULT 0,
    devices     TEXT,
    PRIMARY KEY (story_id, track_index)
);

-- Every MCP tool invocation the server has handled. This is what the Agents
-- page shows: which agent (clientInfo name/version) called which tool, with
-- what, how long it took, and what it produced. Persisted rather than kept in
-- memory because "what did my agent do overnight" is the whole question, and
-- the answer has to survive a restart. Bounded by \`pruneMcpCalls\`.
CREATE TABLE IF NOT EXISTS mcp_calls (
    id             TEXT PRIMARY KEY,
    ts             TEXT NOT NULL,
    tool           TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'running',
    client_name    TEXT,
    client_version TEXT,
    session_id     TEXT,
    transport      TEXT NOT NULL DEFAULT 'http',
    args           TEXT NOT NULL DEFAULT '{}',
    duration_ms    INTEGER,
    error          TEXT,
    job_id         TEXT,
    sound_ids      TEXT NOT NULL DEFAULT '[]',
    trace_id       TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_ts ON mcp_calls(ts DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_client ON mcp_calls(client_name, client_version);
`;

/**
 * A sound's *effective* project is its own project_id if set directly (an
 * individual override), else the project_id of the session it belongs to
 * (inherited) — override beats inheritance, same rule `listSounds`'s project
 * filter uses. Counting membership has to use the same formula or the sidebar's
 * counts and the Library's filter would disagree.
 */
const EFFECTIVE_PROJECT_COUNT =
  "(SELECT COUNT(*) FROM sounds x WHERE" +
  " COALESCE(x.project_id, (SELECT project_id FROM sessions WHERE id = x.session_id))" +
  " = p.id) n";

/**
 * Shared by getSound and listSounds so both compute effective project the same
 * way: a sound's own project_id if it has one (an explicit override), else its
 * session's — the override-beats-inheritance rule from EFFECTIVE_PROJECT_COUNT,
 * expressed per-row instead of per-count.
 */
const SOUND_SELECT =
  "s.*, (SELECT project_id FROM sessions WHERE id = s.session_id) AS session_project_id";

/** GROUP_CONCAT separator for mcpClients — a control character no UUID contains. */
const CONCAT_SEP = "\u001f";

interface SoundRow {
  id: string;
  created_at: string;
  model: string;
  prompt: string;
  negative_prompt: string | null;
  lyrics: string | null;
  track_name: string | null;
  edit: string | null;
  edit_options: string | null;
  duration_s: number;
  seed: number | null;
  steps: number | null;
  cfg: number | null;
  sample_rate: number;
  channels: number;
  filename: string;
  peaks: string;
  favorite: number;
  name: string;
  size_bytes: number;
  session_id: string | null;
  project_id: string | null;
  parent_id: string | null;
  source: string | null;
  client: string | null;
  session_project_id: string | null;
  /** Bare filename of generated cover art in `<data dir>/artwork/`, or
   *  null. A URL is built at the boundary, same as `filename`. */
  artwork: string | null;
  /** The saved Voice that read this sound, or null — see `Sound.voice_id`. */
  voice_id: string | null;
}

interface SessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  project_id: string | null;
  n: number;
}

interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
  n: number;
}

interface StoryRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  project_id: string | null;
  request_options: string | null;
  builder: string | null;
  n: number;
}

interface SegmentRow {
  id: string;
  story_id: string;
  position: number;
  track_index: number;
  speaker: string | null;
  voice_id: string | null;
  text: string;
  language: string | null;
  sound_id: string | null;
  kind: string;
  trim_start_s: number;
  start_s: number;
  duration_s: number | null;
  fade_in_s: number;
  fade_out_s: number;
  request_options: string | null;
  muted: number;
  gain_db: number;
  created_at: string;
  updated_at: string;
}

interface TrackRow {
  story_id: string;
  track_index: number;
  name: string | null;
  muted: number;
  soloed: number;
  gain_db: number;
  devices: string | null;
}

interface VoiceRow {
  id: string;
  name: string;
  kind: string;
  created_at: string;
  filename: string | null;
  voice_id: string | null;
  model_id: string | null;
  notes: string | null;
  /** Bare filename of a generated avatar in `<data dir>/artwork/`, or null.
   *  Stored as a filename, not a URL, for the same reason `filename` is: the
   *  route prefix is the API's business, not the database's. */
  artwork: string | null;
  /** Computed, not stored: how many library sounds were read in this voice.
   *  See VOICE_SELECT. */
  read_count?: number;
}

/** Every voice read carries its library count along — the Voice Lab shows it
 *  on each card, and a correlated COUNT on an indexed column is cheaper than
 *  a second round trip per voice. */
const VOICE_SELECT =
  "SELECT v.*, (SELECT COUNT(*) FROM sounds s WHERE s.voice_id = v.id) AS read_count FROM voices v";

interface McpCallRow {
  id: string;
  ts: string;
  tool: string;
  status: string;
  client_name: string | null;
  client_version: string | null;
  session_id: string | null;
  transport: string;
  args: string | null;
  duration_ms: number | null;
  error: string | null;
  job_id: string | null;
  sound_ids: string | null;
  trace_id: string | null;
}

export interface ListSoundsOptions {
  limit?: number;
  offset?: number;
  q?: string | null;
  tag?: string | null;
  model?: string | null;
  /** Match any of these model ids — how the library's category pages (SFX,
   *  Music, Text to Speech) filter without a round trip per model, since a
   *  sound only carries its model id, not a category of its own. */
  models?: string[] | null;
  favorite?: boolean | null;
  session_id?: string | null;
  project_id?: string | null;
  source?: string | null;
  /** Sounds derived from a given parent (edits, stems) — the sibling group
   *  a stem-view or an edit-history panel wants, not a recursive tree. */
  parent_id?: string | null;
  /** Sounds read in one saved voice — the Voice Lab's per-voice history.
   *  Only single-voice reads carry a voice (see `Sound.voice_id`), so a
   *  mixed dialogue never shows up under any one of its speakers. */
  voice_id?: string | null;
}

export interface ListMcpCallsOptions {
  limit?: number;
  client_name?: string | null;
  tool?: string | null;
  status?: string | null;
  since?: string | null;
}

export interface McpCallTotals {
  calls: number;
  errors: number;
  calls_24h: number;
  last_call_at: string | null;
  per_tool: Record<string, number>;
}

export interface UpdateSoundPatch {
  name?: string | null;
  favorite?: boolean | null;
  tags?: string[] | null;
  project_id?: string | null | Unset;
}

type SqlParam = string | number | null;

export class Database {
  readonly path: string;
  /** What happened in each studio, and who caused it - see `history.ts`.
   *  Its own store rather than more methods here: two tables nothing else
   *  joins against, and this file is long enough already. */
  readonly history: HistoryStore;
  private readonly conn: Sqlite;
  /** Statement cache keyed by SQL text — the filter combinations in listSounds
   *  and listMcpCalls generate a small, bounded set of distinct queries. */
  private readonly stmts = new Map<string, Statement>();

  constructor(path: string) {
    this.path = path;
    this.conn = new BetterSqlite3(path);
    this.conn.pragma("journal_mode = WAL");
    this.conn.pragma("foreign_keys = ON");
    // Must run before SCHEMA: SCHEMA's CREATE INDEX ... ON sounds(model) would
    // fail against a pre-rename database that still has the old column, since
    // CREATE TABLE IF NOT EXISTS leaves an existing table's columns untouched.
    this.renameEngineColumn();
    this.setAsideLegacyVoiceSamples();
    this.conn.exec(SCHEMA);
    this.migrate();
    // After SCHEMA: `conversations.story_id` references `stories`, and SCHEMA
    // is what creates that table.
    this.history = new HistoryStore(
      this.conn,
      () => randomUUID(),
      () => new Date().toISOString(),
    );
  }

  /** Databases written before the engine->model rename still have the old
   *  `engine` column on `sounds`. No-op on a fresh database (table doesn't
   *  exist yet) or one already migrated. */
  private renameEngineColumn(): void {
    const exists = this.conn
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sounds'")
      .get();
    if (!exists) return;
    const columns = this.conn.prepare("PRAGMA table_info(sounds)").all() as { name: string }[];
    if (columns.some((c) => c.name === "engine") && !columns.some((c) => c.name === "model")) {
      this.conn.exec("ALTER TABLE sounds RENAME COLUMN engine TO model");
    }
  }

  /** Libraries from the voice-profiles era have a `voice_samples` table keyed
   *  by `profile_id`, not `voice_id`. CREATE TABLE IF NOT EXISTS keeps it, and
   *  SCHEMA's index on voice_samples(voice_id) then fails, so the server never
   *  starts. It is renamed to `voice_samples_legacy` rather than dropped, and
   *  migrate() gives every clone voice a sample row again from voices.filename. */
  private setAsideLegacyVoiceSamples(): void {
    const columns = this.conn.prepare("PRAGMA table_info(voice_samples)").all() as { name: string }[];
    if (columns.length === 0 || columns.some((c) => c.name === "voice_id")) return;
    this.conn.exec("ALTER TABLE voice_samples RENAME TO voice_samples_legacy");
  }

  /**
   * Additive column migrations for databases created before a given column
   * existed. `CREATE TABLE IF NOT EXISTS` above only shapes a *new* database —
   * an existing sounds table needs each new column added explicitly. Adding a
   * column that already exists throws "duplicate column name", so each ALTER
   * is tried and swallowed rather than guarded with a schema-version table,
   * which is overkill for two nullable text columns.
   */
  private migrate(): void {
    for (const ddl of [
      "ALTER TABLE sounds ADD COLUMN lyrics TEXT",
      "ALTER TABLE sounds ADD COLUMN track_name TEXT",
      "ALTER TABLE sounds ADD COLUMN edit TEXT",
      "ALTER TABLE sounds ADD COLUMN edit_options TEXT",
      "ALTER TABLE sounds ADD COLUMN artwork TEXT",
      "ALTER TABLE sounds ADD COLUMN voice_id TEXT",
      "ALTER TABLE voices ADD COLUMN artwork TEXT",
      "ALTER TABLE story_segments ADD COLUMN kind TEXT NOT NULL DEFAULT 'line'",
      "ALTER TABLE story_segments ADD COLUMN trim_start_s REAL NOT NULL DEFAULT 0",
      "ALTER TABLE story_segments ADD COLUMN fade_in_s REAL NOT NULL DEFAULT 0",
      "ALTER TABLE story_segments ADD COLUMN fade_out_s REAL NOT NULL DEFAULT 0",
      // How this line should be read: the model-family knobs chosen for it, as
      // a JSON object of request options. On the segment rather than only on
      // the generation request because a delivery is a property of the line —
      // re-reading it, or re-reading the whole story, should sound the way you
      // last set it rather than reverting to the model's defaults.
      "ALTER TABLE story_segments ADD COLUMN request_options TEXT",
      // The story's own defaults, applied to every line that has not overridden
      // them. Most scripts want one delivery throughout and an exception on two
      // lines, not the same decision made forty times.
      "ALTER TABLE stories ADD COLUMN request_options TEXT",
      // Which builder the story was started in. Null for everything written
      // before the Script and Music builders were separate tools — those are
      // sorted by `storyStudios`'s guess instead, which is exactly what they
      // were being sorted by all along.
      "ALTER TABLE stories ADD COLUMN builder TEXT",
      // The track's insert chain, as JSON (see ../devices.ts). Null and "[]"
      // both mean no devices. On the track row so it moves with the lane when
      // lanes are renumbered, which is what keeps a reverb on the part it was
      // put on.
      "ALTER TABLE story_tracks ADD COLUMN devices TEXT",
    ]) {
      try {
        this.conn.exec(ddl);
      } catch (err) {
        if (!(err instanceof Error) || !/duplicate column/i.test(err.message)) throw err;
      }
    }

    // Reads rendered before sounds carried voice_id can be recovered: the
    // story segment that produced one still records both the sound and the
    // voice. One-off speaks have no such trail and stay null. Idempotent —
    // it only ever fills nulls, so re-running on every start is free.
    this.conn.exec(
      `UPDATE sounds SET voice_id = (
         SELECT ss.voice_id FROM story_segments ss
          WHERE ss.sound_id = sounds.id AND ss.voice_id IS NOT NULL LIMIT 1)
        WHERE voice_id IS NULL AND EXISTS (
         SELECT 1 FROM story_segments ss
          WHERE ss.sound_id = sounds.id AND ss.voice_id IS NOT NULL)`,
    );
    // After the ALTER above, since on an old library the column only exists
    // from there on. Backs the per-voice history filter in listSounds.
    this.conn.exec("CREATE INDEX IF NOT EXISTS idx_sounds_voice ON sounds(voice_id)");

    // A clone saved before voices held several clips has one file and no
    // sample row; give it one, pointing at that same file, so every clone has
    // at least one. The sample id reuses the voice id — there is exactly one
    // such sample per voice. Duration is left null; nothing reads it back
    // except the Voice Lab's label, which copes.
    this.conn.exec(
      `INSERT INTO voice_samples (id, voice_id, filename, duration_s, created_at)
       SELECT v.id, v.id, v.filename, NULL, v.created_at FROM voices v
        WHERE v.kind = 'clone' AND v.filename IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM voice_samples vs WHERE vs.voice_id = v.id)`,
    );
  }

  private prep(sql: string): Statement {
    let stmt = this.stmts.get(sql);
    if (stmt === undefined) {
      stmt = this.conn.prepare(sql);
      this.stmts.set(sql, stmt);
    }
    return stmt;
  }

  close(): void {
    this.conn.close();
  }

  /* ------------------------------------------------------------------ writes */

  insertSound(sound: Sound, filename: string): void {
    const insert = this.conn.transaction((s: Sound, file: string) => {
      this.prep(
        `INSERT INTO sounds (id, created_at, model, prompt, negative_prompt,
             lyrics, track_name, edit, edit_options,
             duration_s, seed, steps, cfg, sample_rate, channels, filename,
             peaks, favorite, name, size_bytes, session_id, project_id,
             source, client, parent_id, voice_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        s.id,
        s.created_at,
        s.model,
        s.prompt,
        s.negative_prompt ?? null,
        s.lyrics ?? null,
        s.track_name ?? null,
        s.edit ?? null,
        s.edit_options ? JSON.stringify(s.edit_options) : null,
        s.duration_s,
        s.seed ?? null,
        s.steps ?? null,
        s.cfg ?? null,
        s.sample_rate,
        s.channels,
        file,
        JSON.stringify(s.peaks.map((p) => round4(p))),
        s.favorite ? 1 : 0,
        s.name,
        s.size_bytes,
        s.session_id ?? null,
        s.project_id ?? null,
        s.source,
        s.client ?? null,
        s.parent_id ?? null,
        s.voice_id ?? null,
      );
      this.setTags(s.id, s.tags);
      if (s.session_id) {
        // Ordering the sidebar by "last worked on" is the whole point of a
        // session list, so every generation has to bump it.
        this.prep("UPDATE sessions SET updated_at=? WHERE id=?").run(s.created_at, s.session_id);
      }
    });
    insert(sound, filename);
  }

  /* ---------------------------------------------------------------- sessions */

  createSession(
    sessionId: string,
    title: string,
    now: string,
    projectId: string | null = null,
  ): Session {
    this.prep(
      "INSERT INTO sessions (id, title, created_at, updated_at, project_id) VALUES (?,?,?,?,?)",
    ).run(sessionId, title, now, now, projectId);
    return {
      id: sessionId,
      title,
      created_at: now,
      updated_at: now,
      sound_count: 0,
      project_id: projectId,
    };
  }

  getSession(sessionId: string): Session | null {
    const row = this.prep(
      `SELECT s.*, (SELECT COUNT(*) FROM sounds x WHERE x.session_id=s.id) n
       FROM sessions s WHERE s.id=?`,
    ).get(sessionId) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  listSessions(limit = 50): Session[] {
    const rows = this.prep(
      `SELECT s.*, (SELECT COUNT(*) FROM sounds x WHERE x.session_id=s.id) n
       FROM sessions s ORDER BY s.updated_at DESC LIMIT ?`,
    ).all(limit) as SessionRow[];
    return rows.map(rowToSession);
  }

  /**
   * Drop a session that produced nothing.
   *
   * A session is created when a generation is *submitted*, so its title and
   * place in the sidebar exist while the job runs rather than appearing minutes
   * later. The cost is that a cancelled or failed job would strand an empty
   * session forever, so the caller prunes it once the job settles without
   * producing audio.
   */
  deleteIfEmpty(sessionId: string): boolean {
    const row = this.prep("SELECT COUNT(*) c FROM sounds WHERE session_id=?").get(sessionId) as
      | { c: number }
      | undefined;
    if (row && row.c) return false;
    this.prep("DELETE FROM sessions WHERE id=?").run(sessionId);
    return true;
  }

  /** Remove every session with no sounds. Used at startup to clear strays left
   *  by crashes, where the per-job cleanup never ran. */
  pruneEmptySessions(): number {
    const info = this.prep(
      "DELETE FROM sessions WHERE id NOT IN" +
        " (SELECT DISTINCT session_id FROM sounds WHERE session_id IS NOT NULL)",
    ).run();
    return info.changes;
  }

  renameSession(sessionId: string, title: string): Session | null {
    this.prep("UPDATE sessions SET title=? WHERE id=?").run(title, sessionId);
    return this.getSession(sessionId);
  }

  /** Assign or unassign this session's project. Every sound generated in it
   *  inherits the change immediately — effective project is computed from this
   *  column at read time, not stamped onto each sound. */
  setSessionProject(sessionId: string, projectId: string | null): Session | null {
    this.prep("UPDATE sessions SET project_id=? WHERE id=?").run(projectId, sessionId);
    return this.getSession(sessionId);
  }

  /** Delete a session and the sounds in it. Returns their filenames so the
   *  caller can unlink the audio — the rows going away does not free the disk,
   *  and a library of orphaned WAVs is the classic version of this bug. */
  deleteSession(sessionId: string): string[] {
    const del = this.conn.transaction((id: string) => {
      const rows = this.prep("SELECT filename FROM sounds WHERE session_id=?").all(id) as {
        filename: string;
      }[];
      this.prep("DELETE FROM sounds WHERE session_id=?").run(id);
      this.prep("DELETE FROM sessions WHERE id=?").run(id);
      return rows.map((r) => r.filename);
    });
    return del(sessionId);
  }

  /* ---------------------------------------------------------------- projects */

  createProject(projectId: string, name: string, now: string): Project {
    this.prep("INSERT INTO projects (id, name, created_at) VALUES (?,?,?)").run(
      projectId,
      name,
      now,
    );
    return { id: projectId, name, created_at: now, sound_count: 0 };
  }

  listProjects(): Project[] {
    const rows = this.prep(
      `SELECT p.*, ${EFFECTIVE_PROJECT_COUNT} FROM projects p ORDER BY p.created_at DESC`,
    ).all() as ProjectRow[];
    return rows.map(rowToProject);
  }

  getProject(projectId: string): Project | null {
    const row = this.prep(
      `SELECT p.*, ${EFFECTIVE_PROJECT_COUNT} FROM projects p WHERE p.id=?`,
    ).get(projectId) as ProjectRow | undefined;
    return row ? rowToProject(row) : null;
  }

  /** Delete the project itself. Its sounds are not touched — they stay in the
   *  library, just unfiled — so this only has to clear every reference to it
   *  before dropping the row: explicit overrides on sounds, and the sessions
   *  that filed into it (which would otherwise keep inheriting a project that
   *  no longer exists). */
  deleteProject(projectId: string): boolean {
    const del = this.conn.transaction((id: string) => {
      const row = this.prep("SELECT 1 FROM projects WHERE id=?").get(id);
      if (row === undefined) return false;
      this.prep("UPDATE sounds SET project_id=NULL WHERE project_id=?").run(id);
      this.prep("UPDATE sessions SET project_id=NULL WHERE project_id=?").run(id);
      this.prep("DELETE FROM projects WHERE id=?").run(id);
      return true;
    });
    return del(projectId);
  }

  /* ---------------------------------------------------------------- stories */

  createStory(
    storyId: string,
    title: string,
    now: string,
    projectId: string | null = null,
    builder: StoryBuilder = "script",
  ): Story {
    this.prep(
      "INSERT INTO stories (id, title, created_at, updated_at, project_id, builder) VALUES (?,?,?,?,?,?)",
    ).run(storyId, title, now, now, projectId, builder);
    return {
      id: storyId,
      title,
      created_at: now,
      updated_at: now,
      project_id: projectId,
      request_options: {},
      segment_count: 0,
      builder,
    };
  }

  getStory(storyId: string): Story | null {
    const row = this.prep(
      `SELECT s.*, (SELECT COUNT(*) FROM story_segments x WHERE x.story_id=s.id) n
       FROM stories s WHERE s.id=?`,
    ).get(storyId) as StoryRow | undefined;
    if (!row) return null;
    const story = rowToStory(row);
    story.studio = this.storyStudios([story.id]).get(story.id) ?? null;
    if (row.builder === null) story.builder = builderFromStudio(story.studio);
    return story;
  }

  /** `withTimeline` fills each story's clip placements in, for the shelf that
   *  draws them as thumbnails. Off by default: it is a second query, and the
   *  callers that hand a story to an agent want the document, not a picture
   *  of it. */
  listStories(limit = 50, withTimeline = false): Story[] {
    const rows = this.prep(
      `SELECT s.*, (SELECT COUNT(*) FROM story_segments x WHERE x.story_id=s.id) n
       FROM stories s ORDER BY s.updated_at DESC LIMIT ?`,
    ).all(limit) as StoryRow[];
    const stories = rows.map(rowToStory);
    const ids = stories.map((s) => s.id);
    const studios = this.storyStudios(ids);
    for (const [i, story] of stories.entries()) {
      story.studio = studios.get(story.id) ?? null;
      // Only rows written before the builder column existed need the guess;
      // `rowToStory` has already read the stored value for everything else.
      if (rows[i].builder === null) story.builder = builderFromStudio(story.studio);
    }
    if (withTimeline) {
      const timelines = this.storyTimelines(ids);
      for (const story of stories) story.timeline = timelines.get(story.id) ?? [];
    }
    return stories;
  }

  /**
   * Where every clip sits, for every story asked about, in one query.
   *
   * Batched across the whole page the same way `storyStudios` is, and for the
   * same reason: the shelf lists up to 200 stories, and a query per card is
   * not a thing to do to a list. Cheaper than that one, in fact — the picture
   * needs nothing from `sounds`, so there is nothing to join.
   *
   * A clip with no `duration_s` is a line typed but not yet spoken. It still
   * occupies the timeline, so it gets the same word-count estimate the studio
   * draws it with; a thumbnail that disagreed with the page it previews would
   * be worse than no thumbnail. Pauses are left out — written silence is real
   * on the timeline but has nothing to show at this size.
   */
  private storyTimelines(storyIds: string[]): Map<string, TimelineClip[]> {
    const result = new Map<string, TimelineClip[]>();
    const ids = [...new Set(storyIds)];
    if (ids.length === 0) return result;
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.prep(
      `SELECT story_id, track_index, start_s, duration_s, text
       FROM story_segments
       WHERE story_id IN (${placeholders}) AND kind != 'pause'
       ORDER BY start_s`,
    ).all(...ids) as {
      story_id: string;
      track_index: number;
      start_s: number;
      duration_s: number | null;
      text: string;
    }[];

    for (const row of rows) {
      const clips = result.get(row.story_id) ?? [];
      if (clips.length === 0) result.set(row.story_id, clips);
      // Ordered by start, so the clips that survive the cap are the story's
      // opening rather than an arbitrary handful of it.
      if (clips.length >= TIMELINE_PREVIEW_CLIPS) continue;
      clips.push({
        t: row.track_index,
        s: round2(row.start_s),
        d: round2(row.duration_s ?? estimateDuration(row.text)),
      });
    }
    return result;
  }

  /**
   * Guess which studio each story belongs to, from what its clips actually
   * are rather than any field on the story itself — a story is just a
   * timeline, reused by Voice for scripts, and by Music/SFX's "split into
   * stems" for arranging an existing sound's separated tracks.
   *
   * A spoken line (voice_id or real text) makes it "voice" outright. Failing
   * that, each clip's sound is asked for its generating model's category;
   * stem separation is a utility step rather than a source, so a stem looks
   * one hop up its `parent_id` for the sound it was split *from*. The
   * majority category among a story's clips wins ties go to whichever the SQL
   * driver returns first, which is fine — a story that is genuinely mixed has
   * no one right answer anyway.
   */
  private storyStudios(storyIds: string[]): Map<string, "voice" | "music" | "sfx"> {
    const result = new Map<string, "voice" | "music" | "sfx">();
    const ids = [...new Set(storyIds)];
    if (ids.length === 0) return result;
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.prep(
      `SELECT ss.story_id AS story_id, ss.voice_id AS voice_id, ss.text AS text,
              snd.model AS model, parent.model AS parent_model
       FROM story_segments ss
       LEFT JOIN sounds snd ON snd.id = ss.sound_id
       LEFT JOIN sounds parent ON parent.id = snd.parent_id
       WHERE ss.story_id IN (${placeholders})`,
    ).all(...ids) as {
      story_id: string;
      voice_id: string | null;
      text: string;
      model: string | null;
      parent_model: string | null;
    }[];

    const catalog = catalogById();
    const categoryOf = (modelId: string | null): string | undefined =>
      modelId ? catalog.get(modelId)?.category : undefined;

    const counts = new Map<string, { voice: number; music: number; sfx: number }>();
    for (const row of rows) {
      const bucket = counts.get(row.story_id) ?? { voice: 0, music: 0, sfx: 0 };
      counts.set(row.story_id, bucket);
      if (row.voice_id || row.text.trim() !== "") {
        bucket.voice++;
        continue;
      }
      let category = categoryOf(row.model);
      if (category === "utility" || category === undefined) {
        // A stem's own model is the separator, not the source — the sound it
        // was split from is what says whether this is music or sfx.
        category = categoryOf(row.parent_model) ?? category;
      }
      if (category === "music") bucket.music++;
      else if (category === "sfx") bucket.sfx++;
    }

    for (const [storyId, bucket] of counts) {
      if (bucket.voice > 0) result.set(storyId, "voice");
      else if (bucket.music >= bucket.sfx && bucket.music > 0) result.set(storyId, "music");
      else if (bucket.sfx > 0) result.set(storyId, "sfx");
    }
    return result;
  }

  renameStory(storyId: string, title: string): Story | null {
    this.prep("UPDATE stories SET title=?, updated_at=? WHERE id=?").run(title, isoNow(), storyId);
    return this.getStory(storyId);
  }

  /** The story's default delivery — what every line is read with unless it
   *  carries its own. Empty clears it, the same bargain the segment makes. */
  setStoryOptions(storyId: string, options: Record<string, string>): Story | null {
    this.prep("UPDATE stories SET request_options=?, updated_at=? WHERE id=?").run(
      Object.keys(options).length === 0 ? null : JSON.stringify(options),
      isoNow(),
      storyId,
    );
    return this.getStory(storyId);
  }

  setStoryProject(storyId: string, projectId: string | null): Story | null {
    this.prep("UPDATE stories SET project_id=?, updated_at=? WHERE id=?").run(
      projectId,
      isoNow(),
      storyId,
    );
    return this.getStory(storyId);
  }

  /**
   * Delete a story, optionally taking its generated audio with it.
   *
   * Which of those is right is a genuine judgement call — a story is a
   * document (its sounds may well be reused elsewhere, so unfiling them is
   * kinder) but it is also a body of work you may want gone entirely. So the
   * caller decides per deletion rather than the schema deciding forever.
   * Returns the filenames actually orphaned, for the caller to unlink.
   */
  deleteStory(storyId: string, deleteSounds: boolean): string[] {
    const del = this.conn.transaction((id: string) => {
      // Choose the doomed sounds *before* dropping the segments, since the
      // segments are what identify them — but delete them *after*, since those
      // same rows are the foreign keys pointing at them.
      const doomed = deleteSounds
        ? (this.prep(
            // Only sounds this story is the sole owner of: a clip also used by
            // another story is not this one's to destroy.
            `SELECT DISTINCT s.id, s.filename FROM sounds s
               JOIN story_segments seg ON seg.sound_id = s.id
              WHERE seg.story_id = ?
                AND NOT EXISTS (SELECT 1 FROM story_segments o
                                 WHERE o.sound_id = s.id AND o.story_id <> ?)`,
          ).all(id, id) as { id: string; filename: string }[])
        : [];

      this.prep("DELETE FROM story_segments WHERE story_id=?").run(id);
      this.prep("DELETE FROM stories WHERE id=?").run(id);

      for (const sound of doomed) {
        // A surviving edit or split-half still points back at this take; it
        // keeps its own audio, it just loses the provenance link rather than
        // blocking the delete on a foreign key.
        this.prep("UPDATE sounds SET parent_id=NULL WHERE parent_id=?").run(sound.id);
        this.prep("DELETE FROM sound_tags WHERE sound_id=?").run(sound.id);
        this.prep("DELETE FROM sounds WHERE id=?").run(sound.id);
      }
      return doomed.map((s) => s.filename);
    });
    return del(storyId);
  }

  /**
   * Remove untouched stories left behind by "New story".
   *
   * Creating the row up front is what lets the editor open on a real story
   * rather than a form, but the cost is that changing your mind and navigating
   * away strands an empty one. Sessions make the same trade and pay it the
   * same way — see `pruneEmptySessions`. Only stories with no lines *and* a
   * still-default title go: an empty story you bothered to name is one you
   * meant to keep.
   */
  pruneEmptyStories(defaultTitle: string): number {
    return this.prep(
      `DELETE FROM stories WHERE title = ? AND id NOT IN
         (SELECT DISTINCT story_id FROM story_segments)`,
    ).run(defaultTitle).changes;
  }

  /* --------------------------------------------------------------- segments */

  /** Segments in reading order, each with its generated Sound hydrated — the
   *  timeline needs every visible clip's peaks at once, and one request per
   *  clip to get them would be absurd. */
  listSegments(storyId: string): StorySegment[] {
    const rows = this.prep(
      "SELECT * FROM story_segments WHERE story_id=? ORDER BY position ASC",
    ).all(storyId) as SegmentRow[];
    return rows.map((row) => {
      const seg = rowToSegment(row);
      seg.sound = row.sound_id ? this.getSound(row.sound_id) : null;
      return seg;
    });
  }

  getSegment(segmentId: string): StorySegment | null {
    const row = this.prep("SELECT * FROM story_segments WHERE id=?").get(segmentId) as
      | SegmentRow
      | undefined;
    if (!row) return null;
    const seg = rowToSegment(row);
    seg.sound = row.sound_id ? this.getSound(row.sound_id) : null;
    return seg;
  }

  createSegment(
    segmentId: string,
    storyId: string,
    now: string,
    values: {
      speaker?: string | null;
      voice_id?: string | null;
      text?: string;
      language?: string | null;
      track_index?: number;
      position?: number | null;
      start_s?: number | null;
      /** How this line should be read, by the model family's own option
        *  names. Settable at creation because an agent writes a whole scene in
        *  one call and should not have to follow it with forty patches. */
      request_options?: Record<string, string> | null;
      /** An existing library sound to drop in, instead of a line to speak. */
      sound_id?: string | null;
      /** That sound's duration, resolved by the caller. */
      durationS?: number | null;
      kind?: "line" | "pause";
      /** Clip state, so a clip can be put back exactly as it was — an undone
       *  delete, a duplicate — rather than recreated and then patched. */
      trim_start_s?: number;
      fade_in_s?: number;
      fade_out_s?: number;
      gain_db?: number;
      muted?: boolean;
    },
  ): StorySegment {
    const create = this.conn.transaction(() => {
      const tail = this.prep(
        "SELECT COALESCE(MAX(position), -1) p FROM story_segments WHERE story_id=?",
      ).get(storyId) as { p: number };
      const position = values.position ?? tail.p + 1;
      // Appending is the common case and needs no shuffling; inserting into
      // the middle has to push everything at or after it down one.
      if (values.position != null) {
        this.prep(
          "UPDATE story_segments SET position = position + 1 WHERE story_id=? AND position >= ?",
        ).run(storyId, position);
      }
      const trackIndex = values.track_index ?? 0;
      // A new clip with no explicit placement lands after everything already
      // on its track, so "add another line" never silently stacks two clips
      // on top of each other at 0:00.
      const startS =
        values.start_s ??
        ((
          this.prep(
            `SELECT COALESCE(MAX(start_s + COALESCE(duration_s, 0)), 0) e
               FROM story_segments WHERE story_id=? AND track_index=?`,
          ).get(storyId, trackIndex) as { e: number }
        ).e);
      this.prep(
        `INSERT INTO story_segments (id, story_id, position, track_index, speaker, voice_id,
             text, language, sound_id, kind, start_s, duration_s, trim_start_s,
             fade_in_s, fade_out_s, muted, gain_db, request_options, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        segmentId,
        storyId,
        position,
        trackIndex,
        values.speaker ?? null,
        values.voice_id ?? null,
        values.text ?? "",
        values.language ?? null,
        values.sound_id ?? null,
        values.kind ?? "line",
        startS,
        values.durationS ?? null,
        values.trim_start_s ?? 0,
        values.fade_in_s ?? 0,
        values.fade_out_s ?? 0,
        values.muted ? 1 : 0,
        values.gain_db ?? 0,
        values.request_options && Object.keys(values.request_options).length > 0
          ? JSON.stringify(values.request_options)
          : null,
        now,
        now,
      );
      this.touchStory(storyId, now);
      return this.getSegment(segmentId)!;
    });
    return create();
  }

  /**
   * Edit a segment's fields.
   *
   * With `followPlacement`, a patch that moves the clip in time or between
   * lanes also moves it in the script, because the order things happen in is
   * the order they are read in (see the table). That used to be the studio's
   * job — a second, whole-list reorder after every drag — which meant an
   * agent's move left the script out of step, and an undone move put the
   * clip back without putting its line back. Off for the server's own
   * bookkeeping, like laying a freshly voiced line after its track's end,
   * which is placing a line the script already has in order.
   */
  updateSegment(
    segmentId: string,
    patch: SegmentPatch,
    opts: { followPlacement?: boolean } = {},
  ): StorySegment | null {
    const moves =
      opts.followPlacement === true &&
      (patch.start_s !== undefined || patch.track_index !== undefined);
    if (!moves) return this.writeSegment(segmentId, patch);
    const update = this.conn.transaction(() => {
      const before = this.prep(
        "SELECT start_s, track_index FROM story_segments WHERE id=?",
      ).get(segmentId) as { start_s: number; track_index: number } | undefined;
      const seg = this.writeSegment(segmentId, patch);
      if (
        seg === null ||
        before === undefined ||
        (seg.start_s === before.start_s && seg.track_index === before.track_index)
      ) {
        return seg;
      }
      this.placeInReadingOrder(seg);
      return this.getSegment(segmentId);
    });
    return update();
  }

  /**
   * Move one clip to where its placement says it reads: before the first
   * other clip that starts after it (or at the same moment on a lower lane),
   * everything else keeping its relative order.
   *
   * Only the moved clip moves. A script someone has ordered by hand is not
   * re-sorted wholesale because one clip was nudged, and a script already in
   * timeline order stays in it — a group drag applied one clip at a time ends
   * in the same order as sorting the lot.
   */
  private placeInReadingOrder(seg: StorySegment): void {
    const others = this.prep(
      `SELECT id, start_s, track_index FROM story_segments
        WHERE story_id=? AND id<>? ORDER BY position`,
    ).all(seg.story_id, seg.id) as { id: string; start_s: number; track_index: number }[];
    let at = others.findIndex(
      (o) =>
        o.start_s > seg.start_s || (o.start_s === seg.start_s && o.track_index > seg.track_index),
    );
    if (at < 0) at = others.length;
    const order = [...others.slice(0, at).map((o) => o.id), seg.id, ...others.slice(at).map((o) => o.id)];
    const stmt = this.prep("UPDATE story_segments SET position=? WHERE id=?");
    order.forEach((id, index) => stmt.run(index, id));
  }

  private writeSegment(segmentId: string, patch: SegmentPatch): StorySegment | null {
    const fields: string[] = [];
    const params: SqlParam[] = [];
    const set = (column: string, value: SqlParam): void => {
      fields.push(`${column}=?`);
      params.push(value);
    };
    // `undefined` means "not sent"; null is a real value for the nullable
    // columns (clearing a speaker, unassigning a voice), so the two cannot be
    // collapsed the way a `?? null` would.
    if (patch.speaker !== undefined) set("speaker", patch.speaker ?? null);
    if (patch.voice_id !== undefined) set("voice_id", patch.voice_id ?? null);
    if (patch.text !== undefined) set("text", patch.text);
    if (patch.language !== undefined) set("language", patch.language ?? null);
    if (patch.track_index !== undefined) set("track_index", patch.track_index);
    if (patch.start_s !== undefined) set("start_s", patch.start_s);
    if (patch.sound_id !== undefined) set("sound_id", patch.sound_id ?? null);
    if (patch.muted !== undefined) set("muted", patch.muted ? 1 : 0);
    if (patch.gain_db !== undefined) set("gain_db", patch.gain_db);
    // A pause's length is set directly; a spoken line's comes from its audio.
    if (patch.duration_s !== undefined) set("duration_s", patch.duration_s);
    if (patch.trim_start_s !== undefined) set("trim_start_s", patch.trim_start_s);
    if (patch.fade_in_s !== undefined) set("fade_in_s", patch.fade_in_s);
    if (patch.fade_out_s !== undefined) set("fade_out_s", patch.fade_out_s);
    // An empty object clears the override rather than storing "{}", so a line
    // reset to the story default reads back as one.
    if (patch.request_options !== undefined) {
      const options = patch.request_options ?? {};
      set("request_options", Object.keys(options).length === 0 ? null : JSON.stringify(options));
    }
    if (fields.length === 0) return this.getSegment(segmentId);

    const stamp = isoNow();
    set("updated_at", stamp);
    params.push(segmentId);
    const info = this.prep(`UPDATE story_segments SET ${fields.join(", ")} WHERE id=?`).run(
      ...params,
    );
    if (info.changes === 0) return null;
    const seg = this.getSegment(segmentId);
    if (seg) this.touchStory(seg.story_id, stamp);
    return seg;
  }

  /** Point a segment at freshly generated audio. Duration is denormalised off
   *  the sound so the timeline can size the clip without a join. */
  setSegmentSound(segmentId: string, soundId: string, durationS: number): StorySegment | null {
    const stamp = isoNow();
    this.prep(
      "UPDATE story_segments SET sound_id=?, duration_s=?, updated_at=? WHERE id=?",
    ).run(soundId, durationS, stamp, segmentId);
    const seg = this.getSegment(segmentId);
    if (seg) this.touchStory(seg.story_id, stamp);
    return seg;
  }

  /**
   * Rewrite the reading order from a full list of ids.
   *
   * All-or-nothing against the story's current set: a list that has gone stale
   * (a segment deleted in another tab, say) is rejected outright rather than
   * applied halfway, because a partially reordered script is worse than a
   * refused reorder.
   */
  reorderSegments(storyId: string, orderedIds: string[]): boolean {
    const reorder = this.conn.transaction((ids: string[]) => {
      const rows = this.prep("SELECT id FROM story_segments WHERE story_id=?").all(storyId) as {
        id: string;
      }[];
      const existing = new Set(rows.map((r) => r.id));
      if (existing.size !== ids.length || ids.some((id) => !existing.has(id))) return false;
      const stmt = this.prep("UPDATE story_segments SET position=? WHERE id=?");
      ids.forEach((id, index) => stmt.run(index, id));
      this.touchStory(storyId, isoNow());
      return true;
    });
    return reorder(orderedIds);
  }

  /** Delete a segment and close the gap it leaves in the reading order. The
   *  underlying Sound is left alone — it is library content in its own right,
   *  and may be referenced by another segment. */
  deleteSegment(segmentId: string): boolean {
    const del = this.conn.transaction((id: string) => {
      const row = this.prep("SELECT story_id, position FROM story_segments WHERE id=?").get(id) as
        | { story_id: string; position: number }
        | undefined;
      if (row === undefined) return false;
      this.prep("DELETE FROM story_segments WHERE id=?").run(id);
      this.prep(
        "UPDATE story_segments SET position = position - 1 WHERE story_id=? AND position > ?",
      ).run(row.story_id, row.position);
      this.touchStory(row.story_id, isoNow());
      return true;
    });
    return del(segmentId);
  }

  /** Ordering the sidebar by "last worked on" only works if every edit says
   *  so — the same bargain `insertSound` makes for sessions. */
  private touchStory(storyId: string, now: string): void {
    this.prep("UPDATE stories SET updated_at=? WHERE id=?").run(now, storyId);
  }


  /* ----------------------------------------------------------------- tracks */

  /** Only the tracks that have been touched; everything else is at defaults
   *  and needs no row. */
  listTracks(storyId: string): StoryTrack[] {
    const rows = this.prep(
      "SELECT * FROM story_tracks WHERE story_id=? ORDER BY track_index",
    ).all(storyId) as TrackRow[];
    return rows.map(rowToTrack);
  }

  /** Upsert, because a track's first setting is also the row's creation. */
  updateTrack(storyId: string, trackIndex: number, patch: TrackPatch): StoryTrack {
    const upsert = this.conn.transaction(() => {
      this.prep(
        "INSERT OR IGNORE INTO story_tracks (story_id, track_index) VALUES (?,?)",
      ).run(storyId, trackIndex);

      const fields: string[] = [];
      const params: SqlParam[] = [];
      if (patch.name !== undefined) {
        fields.push("name=?");
        params.push(patch.name ?? null);
      }
      if (patch.muted !== undefined) {
        fields.push("muted=?");
        params.push(patch.muted ? 1 : 0);
      }
      if (patch.soloed !== undefined) {
        fields.push("soloed=?");
        params.push(patch.soloed ? 1 : 0);
      }
      if (patch.gain_db !== undefined) {
        fields.push("gain_db=?");
        params.push(patch.gain_db);
      }
      if (patch.devices !== undefined) {
        fields.push("devices=?");
        params.push(patch.devices.length ? JSON.stringify(patch.devices) : null);
      }
      if (fields.length) {
        params.push(storyId, trackIndex);
        this.prep(
          `UPDATE story_tracks SET ${fields.join(", ")} WHERE story_id=? AND track_index=?`,
        ).run(...params);
      }
      this.touchStory(storyId, isoNow());
      const row = this.prep(
        "SELECT * FROM story_tracks WHERE story_id=? AND track_index=?",
      ).get(storyId, trackIndex) as TrackRow;
      return rowToTrack(row);
    });
    return upsert();
  }

  /**
   * Remove a lane and everything on it.
   *
   * Audacity's "remove track" takes the audio with it, and that is the honest
   * reading: a lane is not a container you empty, it is where those clips
   * live. Lanes above it slide down so the numbering stays contiguous —
   * otherwise deleting track 1 of three leaves a hole that nothing can fill.
   * Returns the ids of the segments that went, so the caller can say how many.
   */
  deleteTrack(storyId: string, trackIndex: number): string[] {
    const del = this.conn.transaction(() => {
      const rows = this.prep(
        "SELECT id FROM story_segments WHERE story_id=? AND track_index=?",
      ).all(storyId, trackIndex) as { id: string }[];
      this.prep("DELETE FROM story_segments WHERE story_id=? AND track_index=?").run(
        storyId,
        trackIndex,
      );
      this.prep("DELETE FROM story_tracks WHERE story_id=? AND track_index=?").run(
        storyId,
        trackIndex,
      );
      // Close the gap, clips and track rows alike.
      this.prep(
        "UPDATE story_segments SET track_index = track_index - 1 WHERE story_id=? AND track_index > ?",
      ).run(storyId, trackIndex);
      // Two phases, because (story_id, track_index) is the primary key: a
      // straight decrement can land on a row that has not moved yet, and
      // SQLite gives no ordering guarantee to avoid it. Parking the affected
      // rows far above any real lane vacates their targets first.
      const PARK = 100000;
      this.prep(
        "UPDATE story_tracks SET track_index = track_index + ? WHERE story_id=? AND track_index > ?",
      ).run(PARK, storyId, trackIndex);
      this.prep(
        "UPDATE story_tracks SET track_index = track_index - ? WHERE story_id=? AND track_index >= ?",
      ).run(PARK + 1, storyId, PARK);
      this.renumberPositions(storyId);
      this.touchStory(storyId, isoNow());
      return rows.map((r) => r.id);
    });
    return del();
  }

  /** Reading order has to stay 0..n-1 after clips are removed wholesale, or
   *  every later reorder is validating against a set with holes in it. */
  private renumberPositions(storyId: string): void {
    const rows = this.prep(
      "SELECT id FROM story_segments WHERE story_id=? ORDER BY position",
    ).all(storyId) as { id: string }[];
    const stmt = this.prep("UPDATE story_segments SET position=? WHERE id=?");
    rows.forEach((r, i) => stmt.run(i, r.id));
  }

  /* ----------------------------------------------------------------- voices */

  createVoice(voice: Voice, filename: string | null): Voice {
    this.prep(
      `INSERT INTO voices (id, name, kind, created_at, filename, voice_id, model_id, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      voice.id,
      voice.name,
      voice.kind,
      voice.created_at,
      filename,
      voice.voice_id ?? null,
      voice.model_id ?? null,
      voice.notes ?? null,
    );
    return voice;
  }

  listVoices(): Voice[] {
    const rows = this.prep(
      `${VOICE_SELECT} ORDER BY v.created_at DESC`,
    ).all() as VoiceRow[];
    const samples = new Map<string, VoiceSample[]>();
    const all = this.prep(
      "SELECT * FROM voice_samples ORDER BY created_at, id",
    ).all() as VoiceSampleRow[];
    for (const row of all) {
      const list = samples.get(row.voice_id) ?? [];
      list.push(rowToSample(row));
      samples.set(row.voice_id, list);
    }
    return rows.map((r) => rowToVoice(r, samples.get(r.id) ?? []));
  }

  getVoice(voiceId: string): Voice | null {
    const row = this.prep(`${VOICE_SELECT} WHERE v.id=?`).get(voiceId) as
      | VoiceRow
      | undefined;
    return row ? rowToVoice(row, this.listVoiceSamples(voiceId)) : null;
  }

  /** A clone voice's clips, oldest first — the order they are joined in. */
  listVoiceSamples(voiceId: string): VoiceSample[] {
    const rows = this.prep(
      "SELECT * FROM voice_samples WHERE voice_id=? ORDER BY created_at, id",
    ).all(voiceId) as VoiceSampleRow[];
    return rows.map(rowToSample);
  }

  /** Bare filenames of a voice's clips, in join order. */
  voiceSampleFilenames(voiceId: string): string[] {
    const rows = this.prep(
      "SELECT filename FROM voice_samples WHERE voice_id=? ORDER BY created_at, id",
    ).all(voiceId) as { filename: string }[];
    return rows.map((r) => r.filename);
  }

  addVoiceSample(sample: {
    id: string;
    voice_id: string;
    filename: string;
    duration_s: number;
    created_at: string;
  }): void {
    this.prep(
      `INSERT INTO voice_samples (id, voice_id, filename, duration_s, created_at)
       VALUES (?,?,?,?,?)`,
    ).run(sample.id, sample.voice_id, sample.filename, sample.duration_s, sample.created_at);
  }

  /** Removes one clip's row and returns its filename for the caller to
   *  delete, or null if no such clip belongs to that voice. */
  deleteVoiceSample(voiceId: string, sampleId: string): string | null {
    const row = this.prep(
      "SELECT filename FROM voice_samples WHERE id=? AND voice_id=?",
    ).get(sampleId, voiceId) as { filename: string } | undefined;
    if (row === undefined) return null;
    this.prep("DELETE FROM voice_samples WHERE id=?").run(sampleId);
    return row.filename;
  }

  /** Point a voice's `--voice-ref` at a different file, returning the one it
   *  replaced. */
  setVoiceFilename(voiceId: string, filename: string): string | null {
    const previous = this.voiceFilename(voiceId);
    this.prep("UPDATE voices SET filename=? WHERE id=?").run(filename, voiceId);
    return previous;
  }

  /** The on-disk filename of a clone voice's reference clip, or null for a
   *  builtin (which has no file) or a missing id. Separate from getVoice
   *  because the wire shape exposes a served `/files/...` URL, while the
   *  generation path needs the bare filename to build an absolute path. */
  voiceFilename(voiceId: string): string | null {
    const row = this.prep("SELECT filename FROM voices WHERE id=?").get(voiceId) as
      | { filename: string | null }
      | undefined;
    return row?.filename ?? null;
  }

  /**
   * Every file this library keeps in the sounds folder: each sound's audio
   * (stems and edits included — they are sounds too) and each clone voice's
   * reference clip. What a sounds-folder move carries across, and the only
   * things it may touch: the folder can be shared with other profiles or hold
   * files that were never ours.
   */
  soundsDirFilenames(): string[] {
    const rows = this.prep(
      `SELECT filename FROM sounds
       UNION
       SELECT filename FROM voices WHERE filename IS NOT NULL
       UNION
       SELECT filename FROM voice_samples`,
    ).all() as { filename: string }[];
    return rows.map((r) => r.filename);
  }

  updateVoice(voiceId: string, patch: { name?: string; notes?: string | null }): Voice | null {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (patch.name !== undefined) {
      sets.push("name=?");
      args.push(patch.name);
    }
    if (patch.notes !== undefined) {
      sets.push("notes=?");
      args.push(patch.notes ?? null);
    }
    if (sets.length) {
      args.push(voiceId);
      this.prep(`UPDATE voices SET ${sets.join(", ")} WHERE id=?`).run(...args);
    }
    return this.getVoice(voiceId);
  }

  /**
   * Attach (or clear) a voice's avatar, returning the filename it replaced so
   * the caller can delete that file. Returning the old name rather than
   * deleting here keeps the database layer off the filesystem, and makes
   * "replace an avatar" one statement instead of a read-then-write race.
   */
  setVoiceArtwork(voiceId: string, filename: string | null): string | null {
    const row = this.prep("SELECT artwork FROM voices WHERE id=?").get(voiceId) as
      | { artwork: string | null }
      | undefined;
    if (row === undefined) return null;
    this.prep("UPDATE voices SET artwork=? WHERE id=?").run(filename, voiceId);
    return row.artwork;
  }

  /** As `setVoiceArtwork`, for a sound's cover art. */
  setSoundArtwork(soundId: string, filename: string | null): string | null {
    const row = this.prep("SELECT artwork FROM sounds WHERE id=?").get(soundId) as
      | { artwork: string | null }
      | undefined;
    if (row === undefined) return null;
    this.prep("UPDATE sounds SET artwork=? WHERE id=?").run(filename, soundId);
    return row.artwork;
  }

  /** Every artwork filename still referenced by a sound or a voice — the
   *  keep-list for a sweep of the artwork directory. */
  referencedArtwork(): Set<string> {
    const rows = [
      ...(this.prep("SELECT artwork FROM sounds WHERE artwork IS NOT NULL").all() as {
        artwork: string;
      }[]),
      ...(this.prep("SELECT artwork FROM voices WHERE artwork IS NOT NULL").all() as {
        artwork: string;
      }[]),
    ];
    return new Set(rows.map((r) => r.artwork));
  }

  deleteVoice(voiceId: string): boolean {
    // Explicit rather than trusting ON DELETE CASCADE, which only fires when
    // the connection has foreign_keys switched on.
    this.prep("DELETE FROM voice_samples WHERE voice_id=?").run(voiceId);
    return this.prep("DELETE FROM voices WHERE id=?").run(voiceId).changes > 0;
  }

  /* ------------------------------------------------------------------- tags */

  private setTags(soundId: string, tags: Iterable<string>): void {
    this.prep("DELETE FROM sound_tags WHERE sound_id=?").run(soundId);
    const insert = this.prep("INSERT OR IGNORE INTO sound_tags (sound_id, tag) VALUES (?,?)");
    for (const tag of tags) insert.run(soundId, tag);
  }

  listTags(): TagCount[] {
    const rows = this.prep(
      "SELECT tag, COUNT(*) c FROM sound_tags GROUP BY tag ORDER BY c DESC, tag",
    ).all() as { tag: string; c: number }[];
    return rows.map((r) => ({ tag: r.tag, count: r.c }));
  }

  /* ------------------------------------------------------------ sound writes */

  updateSound(soundId: string, patch: UpdateSoundPatch): Sound | null {
    const apply = this.conn.transaction(() => {
      const sets: string[] = [];
      const params: SqlParam[] = [];
      if (patch.name !== undefined && patch.name !== null) {
        sets.push("name=?");
        params.push(patch.name);
      }
      if (patch.favorite !== undefined && patch.favorite !== null) {
        sets.push("favorite=?");
        params.push(patch.favorite ? 1 : 0);
      }
      if (patch.project_id !== UNSET && patch.project_id !== undefined) {
        // Unlike name/favorite, null here is a meaningful target state (move the
        // sound out of its project again), not "leave alone" — so this is gated
        // on the UNSET sentinel, not on project_id being non-null.
        sets.push("project_id=?");
        params.push(patch.project_id);
      }
      if (sets.length) {
        params.push(soundId);
        this.prep(`UPDATE sounds SET ${sets.join(", ")} WHERE id=?`).run(...params);
      }
      if (patch.tags !== undefined && patch.tags !== null) this.setTags(soundId, patch.tags);
    });
    apply();
    return this.getSound(soundId);
  }

  /** Returns the filename of the deleted row so the caller can unlink it. */
  deleteSound(soundId: string): string | null {
    const del = this.conn.transaction((id: string) => {
      const row = this.prep("SELECT filename FROM sounds WHERE id=?").get(id) as
        | { filename: string }
        | undefined;
      if (row === undefined) return null;
      this.prep("DELETE FROM sound_tags WHERE sound_id=?").run(id);
      this.prep("DELETE FROM sounds WHERE id=?").run(id);
      return row.filename;
    });
    return del(soundId);
  }

  /* ------------------------------------------------------------------ reads */

  private tagsFor(ids: string[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    if (!ids.length) return out;
    for (const id of ids) out.set(id, []);
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.prep(
      `SELECT sound_id, tag FROM sound_tags WHERE sound_id IN (${placeholders}) ORDER BY tag`,
    ).all(...ids) as { sound_id: string; tag: string }[];
    for (const r of rows) out.get(r.sound_id)?.push(r.tag);
    return out;
  }

  getSound(soundId: string): Sound | null {
    const row = this.prep(`SELECT ${SOUND_SELECT} FROM sounds s WHERE s.id=?`).get(soundId) as
      | SoundRow
      | undefined;
    if (row === undefined) return null;
    return rowToSound(row, this.tagsFor([soundId]).get(soundId) ?? []);
  }

  getFilename(soundId: string): string | null {
    const row = this.prep("SELECT filename FROM sounds WHERE id=?").get(soundId) as
      | { filename: string }
      | undefined;
    return row ? row.filename : null;
  }

  listSounds(options: ListSoundsOptions = {}): [Sound[], number] {
    const { limit = 100, offset = 0 } = options;
    const where: string[] = [];
    const params: SqlParam[] = [];
    if (options.q) {
      where.push("(s.prompt LIKE ? OR s.name LIKE ?)");
      params.push(`%${options.q}%`, `%${options.q}%`);
    }
    if (options.model) {
      where.push("s.model = ?");
      params.push(options.model);
    }
    if (options.models && options.models.length) {
      where.push(`s.model IN (${options.models.map(() => "?").join(",")})`);
      params.push(...options.models);
    }
    if (options.source) {
      where.push("s.source = ?");
      params.push(options.source);
    }
    if (options.favorite !== undefined && options.favorite !== null) {
      where.push("s.favorite = ?");
      params.push(options.favorite ? 1 : 0);
    }
    if (options.session_id) {
      where.push("s.session_id = ?");
      params.push(options.session_id);
    }
    if (options.parent_id) {
      where.push("s.parent_id = ?");
      params.push(options.parent_id);
    }
    if (options.voice_id) {
      where.push("s.voice_id = ?");
      params.push(options.voice_id);
    }
    if (options.project_id) {
      // Effective project: the sound's own project_id if it has one (an
      // explicit override), else its session's — so filtering by project
      // surfaces both sounds filed directly and everything inherited from a
      // session nested in it. Override beats inheritance, same as
      // EFFECTIVE_PROJECT_COUNT.
      where.push(
        "COALESCE(s.project_id, (SELECT project_id FROM sessions WHERE id = s.session_id)) = ?",
      );
      params.push(options.project_id);
    }
    if (options.tag) {
      where.push("EXISTS (SELECT 1 FROM sound_tags t WHERE t.sound_id=s.id AND t.tag=?)");
      params.push(options.tag.toLowerCase());
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = (
      this.prep(`SELECT COUNT(*) c FROM sounds s ${clause}`).get(...params) as { c: number }
    ).c;
    const rows = this.prep(
      `SELECT ${SOUND_SELECT} FROM sounds s ${clause} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as SoundRow[];
    const tags = this.tagsFor(rows.map((r) => r.id));
    return [rows.map((r) => rowToSound(r, tags.get(r.id) ?? [])), total];
  }

  countSoundsBySource(): Record<string, number> {
    const rows = this.prep("SELECT source, COUNT(*) c FROM sounds GROUP BY source").all() as {
      source: string;
      c: number;
    }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.source] = r.c;
    return out;
  }

  /* -------------------------------------------------------------- mcp calls */

  insertMcpCall(call: McpCall): void {
    this.prep(
      `INSERT INTO mcp_calls (id, ts, tool, status, client_name, client_version,
           session_id, transport, args, duration_ms, error, job_id, sound_ids,
           trace_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      call.id,
      call.ts,
      call.tool,
      call.status,
      call.client_name ?? null,
      call.client_version ?? null,
      call.session_id ?? null,
      call.transport,
      JSON.stringify(call.args),
      call.duration_ms ?? null,
      call.error ?? null,
      call.job_id ?? null,
      JSON.stringify(call.sound_ids),
      call.trace_id ?? null,
    );
  }

  finishMcpCall(call: McpCall): void {
    this.prep(
      "UPDATE mcp_calls SET status=?, duration_ms=?, error=?, job_id=?, sound_ids=? WHERE id=?",
    ).run(
      call.status,
      call.duration_ms ?? null,
      call.error ?? null,
      call.job_id ?? null,
      JSON.stringify(call.sound_ids),
      call.id,
    );
  }

  pruneMcpCalls(keep = 5000): number {
    const info = this.prep(
      "DELETE FROM mcp_calls WHERE id IN " +
        "(SELECT id FROM mcp_calls ORDER BY ts DESC LIMIT -1 OFFSET ?)",
    ).run(keep);
    return info.changes;
  }

  listMcpCalls(options: ListMcpCallsOptions = {}): McpCall[] {
    const { limit = 100 } = options;
    const where: string[] = [];
    const params: SqlParam[] = [];
    if (options.client_name) {
      where.push("client_name = ?");
      params.push(options.client_name);
    }
    if (options.tool) {
      where.push("tool = ?");
      params.push(options.tool);
    }
    if (options.status) {
      where.push("status = ?");
      params.push(options.status);
    }
    if (options.since) {
      where.push("ts >= ?");
      params.push(options.since);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.prep(
      `SELECT * FROM mcp_calls ${clause} ORDER BY ts DESC LIMIT ?`,
    ).all(...params, limit) as McpCallRow[];
    return rows.map(rowToCall);
  }

  mcpCallTotals(since24h: string): McpCallTotals {
    const row = this.prep(
      `SELECT COUNT(*) AS calls,
              SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
              SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS calls_24h,
              MAX(ts) AS last_call_at
       FROM mcp_calls`,
    ).get(since24h) as {
      calls: number | null;
      errors: number | null;
      calls_24h: number | null;
      last_call_at: string | null;
    };
    const perToolRows = this.prep("SELECT tool, COUNT(*) c FROM mcp_calls GROUP BY tool").all() as {
      tool: string;
      c: number;
    }[];
    const per_tool: Record<string, number> = {};
    for (const r of perToolRows) per_tool[r.tool] = r.c;
    return {
      calls: row.calls ?? 0,
      errors: row.errors ?? 0,
      calls_24h: row.calls_24h ?? 0,
      last_call_at: row.last_call_at,
      per_tool,
    };
  }

  /** One row per (client_name, client_version), newest activity first.
   *  Anonymous callers (no clientInfo) are grouped under "unknown". */
  mcpClients(activeSince: string): McpClient[] {
    const rows = this.prep(
      `SELECT COALESCE(client_name, 'unknown') AS name, client_version AS version,
              COUNT(*) AS calls,
              SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
              COUNT(DISTINCT session_id) AS sessions,
              MIN(ts) AS first_seen, MAX(ts) AS last_seen,
              SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS recent,
              GROUP_CONCAT(sound_ids, ?) AS sound_blob
       FROM mcp_calls
       GROUP BY name, version
       ORDER BY last_seen DESC`,
    ).all(activeSince, CONCAT_SEP) as {
      name: string;
      version: string | null;
      calls: number;
      errors: number | null;
      sessions: number | null;
      first_seen: string;
      last_seen: string;
      recent: number | null;
      sound_blob: string | null;
    }[];
    return rows.map((r) => ({
      name: r.name,
      version: r.version,
      calls: r.calls,
      errors: r.errors ?? 0,
      sounds: countSoundIds(r.sound_blob),
      sessions: r.sessions ?? 0,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      active: (r.recent ?? 0) > 0,
    }));
  }
}

/** Each concatenated segment is one call's JSON id array; a malformed segment
 *  contributes nothing rather than aborting the whole Agents page. */
function countSoundIds(blob: string | null): number {
  if (!blob) return 0;
  let total = 0;
  for (const segment of blob.split(CONCAT_SEP)) {
    try {
      const ids: unknown = JSON.parse(segment);
      if (Array.isArray(ids)) total += ids.length;
    } catch {
      /* ignore */
    }
  }
  return total;
}

/** Matches Python's `round(p, 4)` closely enough for peak data, and keeps the
 *  stored JSON compact. */
function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/** Centiseconds is finer than a thumbnail can draw, and keeps a story's
 *  preview to a few hundred bytes on the wire. */
function round2(value: number): number {
  return Math.round(value * 1e2) / 1e2;
}

/** How much of a story's arrangement a thumbnail carries. Past this the clips
 *  are thinner than a pixel anyway, so the cap costs nothing visible and
 *  bounds what the shelf downloads for a story with a thousand lines. */
const TIMELINE_PREVIEW_CLIPS = 64;

/** A line written but not yet spoken still occupies the timeline. This is the
 *  studio's own placeholder width — speech at roughly 0.4s a word — kept in
 *  step with `estimateDuration` in `story-timeline.tsx`, so the thumbnail and
 *  the page it previews draw the same clip. */
function estimateDuration(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(0.8, words * 0.4);
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    sound_count: row.n,
    project_id: row.project_id,
  };
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    sound_count: row.n,
  };
}

/**
 * Which builder a story written before the split belongs to.
 *
 * Only reached for rows with no stored `builder` — everything created since
 * the Script and Music builders became separate tools carries the choice the
 * user actually made. A spoken story is a script; anything else is clips to
 * arrange, which is the Music Builder's job. An empty untyped story could go
 * either way, and the Script Builder is the one that can also hold clips, so
 * it takes the tie.
 */
function builderFromStudio(studio: Story["studio"]): StoryBuilder {
  return studio === "music" || studio === "sfx" ? "music" : "script";
}

function rowToStory(row: StoryRow): Story {
  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    project_id: row.project_id,
    request_options: parseOptions(row.request_options),
    segment_count: row.n,
    studio: null,
    // Overwritten by `builderFromStudio` for rows that predate the column;
    // the callers that know the story's `studio` do that, because the guess
    // needs it.
    builder: row.builder === "music" ? "music" : "script",
  };
}

/** A stored options blob, tolerating a row written before the column existed
 *  or by a version that wrote something else. A malformed blob means "no
 *  overrides", never a failed read of the whole story. */
export function parseOptions(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    );
  } catch {
    return {};
  }
}

function rowToSegment(row: SegmentRow): StorySegment {
  return {
    id: row.id,
    story_id: row.story_id,
    position: row.position,
    track_index: row.track_index,
    speaker: row.speaker,
    voice_id: row.voice_id,
    text: row.text,
    language: row.language,
    sound_id: row.sound_id,
    kind: row.kind === "pause" ? "pause" : "line",
    trim_start_s: row.trim_start_s ?? 0,
    fade_in_s: row.fade_in_s ?? 0,
    fade_out_s: row.fade_out_s ?? 0,
    request_options: parseOptions(row.request_options),
    sound: null,
    start_s: row.start_s,
    duration_s: row.duration_s,
    muted: row.muted !== 0,
    gain_db: row.gain_db,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Timestamps in this file are written by the caller (`now()` in the service)
 *  everywhere the caller already has one; the story edits that don't take one
 *  stamp themselves in the same ISO shape. */
function isoNow(): string {
  return new Date().toISOString();
}

function rowToTrack(row: TrackRow): StoryTrack {
  return {
    story_id: row.story_id,
    track_index: row.track_index,
    name: row.name,
    muted: row.muted !== 0,
    soloed: row.soloed !== 0,
    gain_db: row.gain_db,
    devices: parseDevices(row.devices),
  };
}

/** A stored chain, or none. The server only ever writes normalised chains,
 *  so this is a parse, not a validation — a row that will not parse (edited
 *  by hand, say) reads as an empty rack rather than taking the story down. */
function parseDevices(raw: string | null): DeviceSpec[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DeviceSpec[]) : [];
  } catch {
    return [];
  }
}

interface VoiceSampleRow {
  id: string;
  voice_id: string;
  filename: string;
  duration_s: number | null;
  created_at: string;
}

function rowToSample(row: VoiceSampleRow): VoiceSample {
  return {
    id: row.id,
    file: `/files/${row.filename}`,
    duration_s: row.duration_s,
    created_at: row.created_at,
  };
}

function rowToVoice(row: VoiceRow, samples: VoiceSample[] = []): Voice {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "builtin" ? "builtin" : "clone",
    created_at: row.created_at,
    // Same `/files/<name>` convention sounds use, so the app can play a
    // reference clip back with the ordinary audio element.
    reference_file: row.filename ? `/files/${row.filename}` : null,
    voice_id: row.voice_id,
    model_id: row.model_id,
    notes: row.notes,
    artwork: row.artwork ? `/artwork/${row.artwork}` : null,
    read_count: row.read_count ?? 0,
    samples: row.kind === "builtin" ? [] : samples,
  };
}

function rowToSound(row: SoundRow, tags: string[]): Sound {
  return {
    id: row.id,
    created_at: row.created_at,
    model: row.model,
    prompt: row.prompt,
    negative_prompt: row.negative_prompt,
    lyrics: row.lyrics,
    track_name: row.track_name,
    edit: (row.edit as EditKind | null) ?? null,
    edit_options: row.edit_options ? (JSON.parse(row.edit_options) as EditOptions) : null,
    duration_s: row.duration_s,
    seed: row.seed,
    steps: row.steps,
    cfg: row.cfg,
    sample_rate: row.sample_rate,
    channels: row.channels,
    file: `/files/${row.filename}`,
    peaks: JSON.parse(row.peaks) as number[],
    favorite: Boolean(row.favorite),
    tags,
    name: row.name,
    size_bytes: row.size_bytes,
    session_id: row.session_id,
    project_id: row.project_id,
    effective_project_id: row.project_id || row.session_project_id,
    source: (row.source || "app") as Source,
    client: row.client,
    parent_id: row.parent_id,
    artwork: row.artwork ? `/artwork/${row.artwork}` : null,
    voice_id: row.voice_id,
  };
}

function rowToCall(row: McpCallRow): McpCall {
  return {
    id: row.id,
    ts: row.ts,
    tool: row.tool,
    status: row.status as McpCall["status"],
    client_name: row.client_name,
    client_version: row.client_version,
    session_id: row.session_id,
    transport: row.transport as McpCall["transport"],
    args: JSON.parse(row.args || "{}") as Record<string, unknown>,
    duration_ms: row.duration_ms,
    error: row.error,
    job_id: row.job_id,
    sound_ids: JSON.parse(row.sound_ids || "[]") as string[],
    trace_id: row.trace_id,
  };
}
