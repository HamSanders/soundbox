/**
 * Opening a library from the voice-profiles era.
 *
 * Those libraries have a `voice_samples` table keyed by `profile_id`. Opening
 * one used to throw "no such column: voice_id" from SCHEMA's index, before any
 * migration ran, so the server never started.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { Database } from "../src/db.js";

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("legacy voice_samples table", () => {
  it("opens, keeps the old rows aside, and backfills clone samples", () => {
    dir = mkdtempSync(join(tmpdir(), "konchi-legacy-vs-"));
    const path = join(dir, "soundbox.db");

    const old = new BetterSqlite3(path);
    old.exec(`
      CREATE TABLE voices (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'clone',
        created_at TEXT NOT NULL, filename TEXT, voice_id TEXT, model_id TEXT, notes TEXT);
      CREATE TABLE voice_samples (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
        filename TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO voices (id, name, kind, created_at, filename) VALUES ('v1', 'Narrator', 'clone', '2026-09-01', 'v1.wav');
      INSERT INTO voice_samples VALUES ('s1', 'p1', 'p1.wav', '2026-09-01');
    `);
    old.close();

    const db = new Database(path);
    try {
      expect(db.listVoiceSamples("v1").map((s) => s.file)).toEqual(["/files/v1.wav"]);
    } finally {
      db.close();
    }

    const check = new BetterSqlite3(path, { readonly: true });
    const legacy = check.prepare("SELECT id, profile_id FROM voice_samples_legacy").all();
    check.close();
    expect(legacy).toEqual([{ id: "s1", profile_id: "p1" }]);
  });
});
