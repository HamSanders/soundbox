/**
 * A minimal ZIP writer: enough to bundle a published folder into one file.
 *
 * Text entries are deflated; audio and images are stored, since they are
 * already compressed or barely compress. No ZIP64, so the archive is limited
 * to 4 GB, which is checked rather than silently corrupting the file.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** Path inside the archive, with forward slashes. */
  name: string;
  /** File on disk, or the bytes themselves. */
  source: string | Uint8Array;
}

const STORE_EXT = /\.(wav|mp3|m4a|m4b|flac|ogg|png|jpe?g|webp|gif|zip)$/i;
const LIMIT = 0xffffffff;

function dosTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function buildZip(entries: ZipEntry[], date = new Date()): Buffer {
  const { time, day } = dosTime(date);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = typeof entry.source === "string" ? readFileSync(entry.source) : Buffer.from(entry.source);
    const store = STORE_EXT.test(entry.name);
    const data = store ? raw : deflateRawSync(raw);
    const method = store ? 0 : 8;
    const crc = crc32(raw);
    const name = Buffer.from(entry.name, "utf8");
    if (offset + data.length > LIMIT) throw new Error("Archive is over 4 GB; publish as a folder instead.");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function writeZip(path: string, entries: ZipEntry[]): number {
  const buf = buildZip(entries);
  writeFileSync(path, buf);
  return buf.length;
}
