import { describe, expect, it } from "vitest";

import { Database, type SoundSort } from "../src/db.js";
import type { Sound } from "../src/schemas.js";

function sound(id: string, name: string, duration_s: number, created_at: string): Sound {
  return {
    id,
    created_at,
    model: "sfx",
    prompt: "a door",
    duration_s,
    sample_rate: 44100,
    channels: 1,
    file: `/files/${id}.wav`,
    peaks: [],
    favorite: false,
    tags: [],
    name,
    size_bytes: 1,
    source: "app",
  };
}

describe("listSounds sort", () => {
  const db = new Database(":memory:");
  db.insertSound(sound("a", "banjo", 4, "2026-01-01T00:00:00Z"), "a.wav");
  db.insertSound(sound("b", "accordion", 9, "2026-01-03T00:00:00Z"), "b.wav");
  db.insertSound(sound("c", "Cello", 1, "2026-01-02T00:00:00Z"), "c.wav");
  const ids = (sort?: SoundSort) => db.listSounds({ sort })[0].map((s) => s.id);

  it("defaults to newest first", () => {
    expect(ids()).toEqual(["b", "c", "a"]);
  });

  it("sorts by date, length and name", () => {
    expect(ids("oldest")).toEqual(["a", "c", "b"]);
    expect(ids("longest")).toEqual(["b", "a", "c"]);
    expect(ids("shortest")).toEqual(["c", "a", "b"]);
    // Case-insensitive: a plain byte sort would put "Cello" first.
    expect(ids("name")).toEqual(["b", "a", "c"]);
  });
});
