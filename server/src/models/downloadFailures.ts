/**
 * The last failed download of each model, kept on disk.
 *
 * A download job lives in memory, so its failure used to be gone the moment
 * the server restarted, and with it the reason a model is sitting there
 * "incomplete". This file is what lets the Models page still say why, and
 * offer Retry, the next day.
 *
 * One small JSON file in the models folder, next to the weights it is about
 * and shared by every profile for the same reason they are. An entry is
 * written when a download fails, and removed when one succeeds, when the
 * weights are deleted, or when the user dismisses it. Reading and writing are
 * best effort: a models folder that is read-only loses the memory, not the
 * download.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { DownloadFailure, Failure } from "../schemas.js";

const FILE_VERSION = 1;

/** The file's name inside the models folder. */
export const DOWNLOAD_FAILURES_FILE = "download-failures.json";

function isFailure(value: unknown): value is DownloadFailure {
  if (!value || typeof value !== "object") return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.title === "string" &&
    typeof f.detail === "string" &&
    typeof f.at === "string" &&
    Array.isArray(f.fixes) &&
    typeof f.terminal === "boolean"
  );
}

export class DownloadFailureStore {
  private entries: Map<string, DownloadFailure> | null = null;

  constructor(private readonly path: string) {}

  private load(): Map<string, DownloadFailure> {
    if (this.entries) return this.entries;
    const entries = new Map<string, DownloadFailure>();
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as { models?: unknown };
      if (raw.models && typeof raw.models === "object") {
        for (const [id, value] of Object.entries(raw.models as Record<string, unknown>)) {
          if (isFailure(value)) entries.set(id, value);
        }
      }
    } catch {
      // Missing or unreadable: nothing is remembered, which is the safe reading.
    }
    this.entries = entries;
    return entries;
  }

  private save(): void {
    const models = Object.fromEntries(this.load());
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      // Written beside and renamed over, so a crash mid-write cannot leave
      // half a JSON document where the next start will read it.
      const tmp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, models }, null, 2));
      renameSync(tmp, this.path);
    } catch {
      // Best effort; the entry is still held in memory for this run.
    }
  }

  get(modelId: string): DownloadFailure | null {
    return this.load().get(modelId) ?? null;
  }

  record(modelId: string, failure: Failure, at: Date = new Date()): DownloadFailure {
    const entry: DownloadFailure = { ...failure, at: at.toISOString() };
    this.load().set(modelId, entry);
    this.save();
    return entry;
  }

  /** Forget a model's failure. Returns whether there was one. */
  clear(modelId: string): boolean {
    if (!this.load().delete(modelId)) return false;
    this.save();
    return true;
  }
}
