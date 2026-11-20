// Your saved Mirli clone voices, read-only from Mirli's database, so the page
// can offer them. VoxCPM2 clones from the voice's reference clip.
// Mirli resolves a clip the same way: `<data dir>/sounds/<voices.filename>`.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dataDir = process.env.MIRLI_DATA_DIR ?? process.env.SOUNDBOX_DATA_DIR ??
  (existsSync(join(homedir(), ".mirli")) ? join(homedir(), ".mirli") : join(homedir(), ".soundbox"));

/** @returns {{ id: string, name: string, path: string, model: string | null }[]} */
export async function listVoices() {
  const db = join(dataDir, "soundbox.db");
  if (!existsSync(db)) return [];
  const { DatabaseSync } = await import("node:sqlite");
  const conn = new DatabaseSync(db, { readOnly: true });
  try {
    return conn
      .prepare("SELECT id, name, filename, model_id FROM voices WHERE kind = 'clone' AND filename IS NOT NULL ORDER BY name COLLATE NOCASE")
      .all()
      .map((r) => ({ id: r.id, name: r.name, path: join(dataDir, "sounds", r.filename), model: r.model_id }))
      .filter((v) => existsSync(v.path));
  } finally {
    conn.close();
  }
}
