/**
 * Audiobooks: the `segment_takes` table. One row per generation of a
 * paragraph. `selected` is not stored: a take is selected when its sound is
 * the one the segment points at, so the two can never disagree.
 */

import type { Database } from "better-sqlite3";

import type { Take } from "./types.js";

export const TAKES_SCHEMA = `
CREATE TABLE IF NOT EXISTS segment_takes (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL,
  sound_id TEXT NOT NULL,
  spoken_text TEXT NOT NULL,
  source_text TEXT NOT NULL DEFAULT '',
  voice_id TEXT,
  model_id TEXT NOT NULL,
  request_options TEXT NOT NULL DEFAULT '{}',
  seed INTEGER,
  origin TEXT NOT NULL DEFAULT 'generate',
  gen_ms INTEGER,
  audio_s REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS segment_takes_segment ON segment_takes(segment_id, created_at);
CREATE INDEX IF NOT EXISTS segment_takes_sound ON segment_takes(sound_id);
`;

/** How a take came about. */
export type TakeOrigin = "generate" | "selection" | "render";

export interface TakeRow extends Take {
  origin: TakeOrigin;
  /** The paragraph text this take was voiced from, before pronunciation. */
  source_text: string;
  /** Wall time of the generation, when the caller measured it. */
  gen_ms: number | null;
  audio_s: number | null;
}

interface Row {
  id: string;
  segment_id: string;
  sound_id: string;
  spoken_text: string;
  source_text: string;
  voice_id: string | null;
  model_id: string;
  request_options: string;
  seed: number | null;
  origin: string;
  gen_ms: number | null;
  audio_s: number | null;
  created_at: string;
  current: string | null;
}

function toTake(r: Row): TakeRow {
  let opts: Record<string, unknown> = {};
  try {
    opts = JSON.parse(r.request_options) as Record<string, unknown>;
  } catch {
    /* keep {} */
  }
  return {
    id: r.id,
    segment_id: r.segment_id,
    sound_id: r.sound_id,
    spoken_text: r.spoken_text,
    voice_id: r.voice_id,
    model_id: r.model_id,
    request_options: opts,
    seed: r.seed,
    selected: r.current !== null && r.current === r.sound_id,
    created_at: r.created_at,
    origin: (r.origin as TakeOrigin) ?? "generate",
    source_text: r.source_text || r.spoken_text,
    gen_ms: r.gen_ms,
    audio_s: r.audio_s,
  };
}

const SELECT = `SELECT t.*, s.sound_id AS current FROM segment_takes t
  LEFT JOIN story_segments s ON s.id = t.segment_id`;

export class TakeStore {
  constructor(
    private readonly conn: Database,
    private readonly newId: () => string,
    private readonly now: () => string,
  ) {
    conn.exec(TAKES_SCHEMA);
  }

  /** Newest first. */
  list(segmentId: string): TakeRow[] {
    return (this.conn.prepare(`${SELECT} WHERE t.segment_id = ? ORDER BY t.created_at DESC, t.rowid DESC`).all(segmentId) as Row[]).map(toTake);
  }

  get(id: string): TakeRow | null {
    const r = this.conn.prepare(`${SELECT} WHERE t.id = ?`).get(id) as Row | undefined;
    return r ? toTake(r) : null;
  }

  record(t: Omit<TakeRow, "id" | "selected" | "created_at" | "origin" | "gen_ms" | "audio_s" | "source_text"> & Partial<Pick<TakeRow, "origin" | "gen_ms" | "audio_s" | "source_text">>): TakeRow {
    const id = this.newId();
    this.conn
      .prepare(
        `INSERT INTO segment_takes (id, segment_id, sound_id, spoken_text, source_text, voice_id, model_id, request_options, seed, origin, gen_ms, audio_s, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, t.segment_id, t.sound_id, t.spoken_text, t.source_text ?? t.spoken_text, t.voice_id, t.model_id,
        JSON.stringify(t.request_options ?? {}), t.seed, t.origin ?? "generate",
        t.gen_ms ?? null, t.audio_s ?? null, this.now(),
      );
    return this.get(id)!;
  }

  /** The take for a sound, if one exists (newest). */
  forSound(soundId: string): TakeRow | null {
    const r = this.conn.prepare(`${SELECT} WHERE t.sound_id = ? ORDER BY t.created_at DESC LIMIT 1`).get(soundId) as Row | undefined;
    return r ? toTake(r) : null;
  }

  setTiming(id: string, genMs: number, audioS: number, origin?: TakeOrigin): void {
    this.conn
      .prepare("UPDATE segment_takes SET gen_ms = ?, audio_s = ?, origin = COALESCE(?, origin) WHERE id = ?")
      .run(Math.round(genMs), audioS, origin ?? null, id);
  }

  delete(id: string): boolean {
    return this.conn.prepare("DELETE FROM segment_takes WHERE id = ?").run(id).changes > 0;
  }

  /** Other takes or segments still using a sound. */
  soundInUse(soundId: string, exceptTakeId?: string): boolean {
    const t = this.conn
      .prepare("SELECT 1 FROM segment_takes WHERE sound_id = ? AND id != ? LIMIT 1")
      .get(soundId, exceptTakeId ?? "");
    const s = this.conn.prepare("SELECT 1 FROM story_segments WHERE sound_id = ? LIMIT 1").get(soundId);
    return Boolean(t || s);
  }

  /**
   * Measured real-time factors (generation seconds per audio second) by
   * model, from takes with timings. Median, so one cold load does not skew it.
   */
  realTimeFactors(): Map<string, { rtf: number; chars_per_s: number; samples: number }> {
    const rows = this.conn
      .prepare(
        `SELECT model_id, gen_ms, audio_s, LENGTH(spoken_text) AS chars FROM segment_takes
          WHERE gen_ms IS NOT NULL AND audio_s > 0 ORDER BY created_at DESC LIMIT 2000`,
      )
      .all() as { model_id: string; gen_ms: number; audio_s: number; chars: number }[];
    const by = new Map<string, { rtf: number[]; cps: number[] }>();
    for (const r of rows) {
      const e = by.get(r.model_id) ?? { rtf: [], cps: [] };
      e.rtf.push(r.gen_ms / 1000 / r.audio_s);
      e.cps.push(r.chars / r.audio_s);
      by.set(r.model_id, e);
    }
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)]!;
    };
    const out = new Map<string, { rtf: number; chars_per_s: number; samples: number }>();
    for (const [k, v] of by) out.set(k, { rtf: median(v.rtf), chars_per_s: median(v.cps), samples: v.rtf.length });
    return out;
  }

  deleteForSegments(segmentIds: string[]): number {
    let n = 0;
    const del = this.conn.prepare("DELETE FROM segment_takes WHERE segment_id = ?");
    this.conn.transaction(() => segmentIds.forEach((id) => (n += del.run(id).changes)))();
    return n;
  }
}
