import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { voiceLock, wav } from "../lib/voice-lock.mjs";

test("wav wraps mono s16le with the right header", () => {
  const w = wav(Buffer.alloc(8), 48000);
  assert.equal(w.length, 52);
  assert.equal(w.toString("ascii", 0, 4), "RIFF");
  assert.equal(w.readUInt32LE(24), 48000);
  assert.equal(w.readUInt32LE(40), 8);
});

test("a sentence long enough becomes a clip; a short one or an unknown rate does not", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "lock-")), "clips");
  const lock = voiceLock(dir, () => 1000);
  assert.equal(lock.save(Buffer.alloc(1000)), ""); // half a second
  const path = lock.save(Buffer.alloc(4000)); // two seconds
  assert.ok(path && existsSync(path));
  assert.equal(readFileSync(path).length, 44 + 4000);
  lock.drop(path);
  assert.ok(!existsSync(path));
  assert.equal(voiceLock(dir, () => 0).save(Buffer.alloc(4000)), "");
});
