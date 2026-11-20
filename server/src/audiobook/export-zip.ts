/**
 * A store-only (uncompressed) zip writer for export bundles.
 *
 * Audio is already compressed (MP3, M4B, FLAC) or barely compresses (WAV),
 * so deflate would cost time for nothing and a dependency for less. Files
 * are streamed from disk in chunks; ZIP64 records are written whenever a
 * size or offset passes 4 GiB, which a WAV book easily does.
 * Format: PKWARE APPNOTE 6.3.x (https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT).
 */

import { open, stat } from "node:fs/promises";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const CHUNK = 1 << 20;
const MAX32 = 0xffffffff;

export interface ZipEntry {
  /** Name inside the zip, forward slashes. */
  name: string;
  /** File on disk, or bytes in memory. */
  source: string | Uint8Array;
}

/** DOS date/time for "now"; zip has no time zone. */
function dosTime(d = new Date()): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

async function* chunks(source: string | Uint8Array): AsyncGenerator<Uint8Array> {
  if (typeof source !== "string") {
    yield source;
    return;
  }
  const fh = await open(source, "r");
  try {
    const buf = Buffer.alloc(CHUNK);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK, null);
      if (bytesRead === 0) break;
      yield buf.subarray(0, bytesRead);
    }
  } finally {
    await fh.close();
  }
}

/** Write `entries` to a new zip at `path`. */
export async function writeZip(path: string, entries: ZipEntry[]): Promise<number> {
  const out = await open(path, "w");
  let offset = 0;
  const write = async (b: Uint8Array) => {
    await out.write(b);
    offset += b.length;
  };
  const central: Buffer[] = [];
  const { time, date } = dosTime();
  try {
    for (const entry of entries) {
      const name = Buffer.from(entry.name, "utf8");
      const size = typeof entry.source === "string" ? (await stat(entry.source)).size : entry.source.length;
      let crc = 0;
      for await (const c of chunks(entry.source)) crc = crc32(c, crc);
      const big = size >= MAX32;
      const localOffset = offset;

      const localExtra = big ? zip64Extra([size, size]) : Buffer.alloc(0);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(big ? 45 : 20, 4); // version needed
      local.writeUInt16LE(0x0800, 6); // UTF-8 names
      local.writeUInt16LE(0, 8); // stored
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(big ? MAX32 : size, 18);
      local.writeUInt32LE(big ? MAX32 : size, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(localExtra.length, 28);
      await write(Buffer.concat([local, name, localExtra]));
      for await (const c of chunks(entry.source)) await write(c);

      const farOffset = localOffset >= MAX32;
      const cextraFields: number[] = [];
      if (big) cextraFields.push(size, size);
      if (farOffset) cextraFields.push(localOffset);
      const cextra = cextraFields.length ? zip64Extra(cextraFields) : Buffer.alloc(0);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(0x031e, 4); // made by: unix, 3.0
      cd.writeUInt16LE(big || farOffset ? 45 : 20, 6);
      cd.writeUInt16LE(0x0800, 8);
      cd.writeUInt16LE(0, 10);
      cd.writeUInt16LE(time, 12);
      cd.writeUInt16LE(date, 14);
      cd.writeUInt32LE(crc, 16);
      cd.writeUInt32LE(big ? MAX32 : size, 20);
      cd.writeUInt32LE(big ? MAX32 : size, 24);
      cd.writeUInt16LE(name.length, 28);
      cd.writeUInt16LE(cextra.length, 30);
      cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
      cd.writeUInt32LE(farOffset ? MAX32 : localOffset, 42);
      central.push(Buffer.concat([cd, name, cextra]));
    }

    const cdOffset = offset;
    const cdBytes = Buffer.concat(central);
    await write(cdBytes);
    const needs64 = cdOffset >= MAX32 || entries.length >= 0xffff;
    if (needs64) {
      const eocd64Offset = offset;
      const z = Buffer.alloc(56);
      z.writeUInt32LE(0x06064b50, 0);
      z.writeBigUInt64LE(44n, 4);
      z.writeUInt16LE(45, 12);
      z.writeUInt16LE(45, 14);
      z.writeBigUInt64LE(BigInt(entries.length), 24);
      z.writeBigUInt64LE(BigInt(entries.length), 32);
      z.writeBigUInt64LE(BigInt(cdBytes.length), 40);
      z.writeBigUInt64LE(BigInt(cdOffset), 48);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0);
      loc.writeBigUInt64LE(BigInt(eocd64Offset), 8);
      loc.writeUInt32LE(1, 16);
      await write(Buffer.concat([z, loc]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(needs64 ? 0xffff : entries.length, 8);
    end.writeUInt16LE(needs64 ? 0xffff : entries.length, 10);
    end.writeUInt32LE(cdBytes.length, 12);
    end.writeUInt32LE(needs64 ? MAX32 : cdOffset, 16);
    await write(end);
    return offset;
  } finally {
    await out.close();
  }
}

function zip64Extra(values: number[]): Buffer {
  const b = Buffer.alloc(4 + values.length * 8);
  b.writeUInt16LE(0x0001, 0);
  b.writeUInt16LE(values.length * 8, 2);
  values.forEach((v, i) => b.writeBigUInt64LE(BigInt(v), 4 + i * 8));
  return b;
}
