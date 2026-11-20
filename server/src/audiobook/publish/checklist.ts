/**
 * Store readiness: what each distribution route asks for, checked against
 * the book as it stands. Mirli does not upload anywhere; this tells you what
 * is missing before you do.
 *
 * Requirements and their sources (see docs/audiobooks/research-elevenlabs.md §4, §7, §8):
 *  - Spotify for Authors: MP3, WAV or FLAC plus a sample file; cover PNG or
 *    JPG, 1:1, 3000×3000 recommended.
 *    https://support.spotify.com/us/authors/article/uploading-audiobooks/
 *  - Apple Books: at most 25 tracks, each under 23 hours; artwork at least
 *    3000×3000. https://help.apple.com/itc/audiobooksspec/en.lproj/static.html
 *  - Podcast feeds (Apple Podcasts): square cover, 1400×1400 to 3000×3000,
 *    PNG or JPG; at least one episode.
 *    https://podcasters.apple.com/support/823-podcast-requirements
 *    https://podcasters.apple.com/support/5514-show-cover-template
 *  - Read-along apps (text with audio, research §7.5): title, subtitle,
 *    author, cover, description, genres, language, chapters as headings.
 *  - Retail sample: 5 minutes or less, starts with narration (ACX, §8).
 */

import { readFileSync } from "node:fs";

import type { MirliService } from "../../service.js";
import { audiobooks, type BookDetail } from "../service.js";
import { listenableChapters } from "./manifest.js";

export type ChecklistLevel = "required" | "recommended";

export interface ChecklistItem {
  id: string;
  label: string;
  level: ChecklistLevel;
  pass: boolean;
  detail: string;
}

export type ChecklistTargetId = "spotify" | "apple_books" | "read_along" | "podcast_rss" | "web_player";

export interface ChecklistTarget {
  id: ChecklistTargetId;
  name: string;
  source_url: string | null;
  /** Every required item passes. */
  ready: boolean;
  items: ChecklistItem[];
}

export interface CoverInfo {
  width: number;
  height: number;
  format: "png" | "jpeg" | "webp" | "gif" | "unknown";
}

/** Pixel size from a PNG, JPEG, GIF or WebP header; null if unreadable. */
export function imageInfo(bytes: Uint8Array): CoverInfo | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), format: "png" };
  }
  if (b.length >= 10 && b.toString("ascii", 0, 3) === "GIF") {
    return { width: b.readUInt16LE(6), height: b.readUInt16LE(8), format: "gif" };
  }
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), format: "webp" };
    if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, format: "webp" };
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: "webp" };
    }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      const length = b.readUInt16BE(i + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7), format: "jpeg" };
      }
      i += 2 + length;
    }
    return { width: 0, height: 0, format: "jpeg" };
  }
  return null;
}

export function coverInfo(svc: MirliService, bookId: string): CoverInfo | null {
  const file = audiobooks(svc).coverFile(bookId);
  if (!file) return null;
  try {
    return imageInfo(readFileSync(file.path)) ?? { width: 0, height: 0, format: "unknown" };
  } catch {
    return null;
  }
}

function item(id: string, label: string, level: ChecklistLevel, pass: boolean, detail: string): ChecklistItem {
  return { id, label, level, pass, detail };
}

const filled = (s: string | null | undefined): boolean => Boolean(s && s.trim());

/** The facts every target draws on, computed once. */
interface Facts {
  book: BookDetail;
  cover: CoverInfo | null;
  chapters: number;
  voicedChapters: number;
  unvoiced: number;
  stale: number;
  sample: "retail_sample" | "first_chapter" | null;
  sampleTooLong: boolean;
}

function facts(svc: MirliService, book: BookDetail): Facts {
  const listenable = listenableChapters(book.chapters);
  const byId = new Map(book.chapters.map((c) => [c.id, c]));
  const voicedChapters = listenable.filter((c) => (byId.get(c.id)?.stats.voiced ?? 0) > 0).length;
  const unvoiced = listenable.reduce((n, c) => {
    const s = byId.get(c.id)!.stats;
    return n + Math.max(0, s.paragraphs - s.voiced);
  }, 0);
  const retail = book.chapters.find((c) => c.kind === "retail_sample" && c.included);
  const retailVoiced = retail ? retail.stats.voiced > 0 : false;
  return {
    book,
    cover: coverInfo(svc, book.id),
    chapters: listenable.length,
    voicedChapters,
    unvoiced,
    stale: book.stats.stale,
    sample: retailVoiced ? "retail_sample" : voicedChapters > 0 ? "first_chapter" : null,
    sampleTooLong: retailVoiced ? retail!.stats.duration_s > 5 * 60 : false,
  };
}

function coverItems(f: Facts, min: number, max: number | null, level: ChecklistLevel): ChecklistItem[] {
  const c = f.cover;
  const size = c && c.width > 0 ? `${c.width}×${c.height}` : "unknown size";
  return [
    item("cover", "Cover image", "required", c !== null, c ? `${c.format.toUpperCase()}, ${size}` : "No cover yet"),
    item(
      "cover_format",
      "Cover is PNG or JPG",
      "required",
      c !== null && (c.format === "png" || c.format === "jpeg"),
      c ? `Cover is ${c.format.toUpperCase()}` : "No cover yet",
    ),
    item("cover_square", "Cover is square (1:1)", "required", c !== null && c.width > 0 && c.width === c.height, size),
    item(
      "cover_size",
      max ? `Cover is ${min}×${min} to ${max}×${max}` : `Cover is at least ${min}×${min}`,
      level,
      c !== null && c.width >= min && c.height >= min && (max === null || (c.width <= max && c.height <= max)),
      size,
    ),
  ];
}

function metadataItems(f: Facts): ChecklistItem[] {
  const b = f.book;
  return [
    item("title", "Title", "required", filled(b.title), b.title),
    item("author", "Author", "required", filled(b.author), b.author ?? "Not set"),
    item("narrator", "Narrator credit", "required", filled(b.narrator), b.narrator ?? "Not set"),
    item("description", "Description", "required", filled(b.description), filled(b.description) ? `${b.description!.trim().length} characters` : "Not set"),
    item("genres", "At least one genre", "required", b.genres.length > 0, b.genres.join(", ") || "None"),
    item("language", "Language", "required", filled(b.language), b.language),
    item("publication_date", "Publication date", "recommended", filled(b.publication_date), b.publication_date ?? "Not set"),
  ];
}

function audioItems(f: Facts): ChecklistItem[] {
  return [
    item("chapters_voiced", "Every chapter has audio", "required", f.chapters > 0 && f.voicedChapters === f.chapters, `${f.voicedChapters} of ${f.chapters} chapters`),
    item("paragraphs_voiced", "No unvoiced paragraphs", "required", f.unvoiced === 0, f.unvoiced === 0 ? "All voiced" : `${f.unvoiced} unvoiced`),
    item("stale", "No stale paragraphs", "recommended", f.stale === 0, f.stale === 0 ? "None" : `${f.stale} edited since voicing`),
  ];
}

function sampleItem(f: Facts, level: ChecklistLevel): ChecklistItem {
  const detail =
    f.sample === "retail_sample"
      ? f.sampleTooLong
        ? "Retail sample is longer than 5 minutes"
        : "Retail sample chapter"
      : f.sample === "first_chapter"
        ? "No retail sample chapter; the first 5 minutes of chapter one will be used"
        : "Nothing voiced yet";
  return item("sample", "Sample (5 minutes or less)", level, f.sample === "retail_sample" && !f.sampleTooLong, detail);
}

function target(id: ChecklistTargetId, name: string, source: string | null, items: ChecklistItem[]): ChecklistTarget {
  return { id, name, source_url: source, items, ready: items.every((i) => i.level !== "required" || i.pass) };
}

export function buildChecklist(svc: MirliService, bookId: string): ChecklistTarget[] | null {
  const book = audiobooks(svc).getBook(bookId);
  if (!book) return null;
  const f = facts(svc, book);
  const meta = metadataItems(f);
  const audio = audioItems(f);
  return [
    target("spotify", "Spotify for Authors", "https://support.spotify.com/us/authors/article/uploading-audiobooks/", [
      ...meta,
      ...coverItems(f, 3000, null, "recommended"),
      ...audio,
      sampleItem(f, "required"),
    ]),
    target("apple_books", "Apple Books", "https://help.apple.com/itc/audiobooksspec/en.lproj/static.html", [
      ...meta,
      ...coverItems(f, 3000, null, "required"),
      ...audio,
      item("tracks", "25 tracks or fewer", "required", f.chapters <= 25, `${f.chapters} chapter files (or export one M4B)`),
      sampleItem(f, "recommended"),
    ]),
    target("read_along", "Read-along apps (text with audio)", null, [
      ...meta,
      item("subtitle", "Subtitle", "recommended", filled(book.subtitle), book.subtitle ?? "Not set"),
      ...coverItems(f, 3000, null, "recommended"),
      item("chapters", "Chapters", "required", f.chapters > 0, `${f.chapters} chapters`),
      ...audio,
    ]),
    target("podcast_rss", "Podcast feed (RSS)", "https://podcasters.apple.com/support/823-podcast-requirements", [
      item("title", "Title", "required", filled(book.title), book.title),
      item("author", "Author", "required", filled(book.author), book.author ?? "Not set"),
      item("description", "Description", "required", filled(book.description), filled(book.description) ? "Set" : "Not set"),
      item("genres", "Category (from the first genre)", "recommended", book.genres.length > 0, book.genres[0] ?? "None"),
      ...coverItems(f, 1400, 3000, "required"),
      item("episodes", "At least one chapter with audio", "required", f.voicedChapters > 0, `${f.voicedChapters} chapters with audio`),
    ]),
    target("web_player", "Web player", null, [
      item("title", "Title", "required", filled(book.title), book.title),
      item("episodes", "At least one chapter with audio", "required", f.voicedChapters > 0, `${f.voicedChapters} chapters with audio`),
      item("cover", "Cover image", "recommended", f.cover !== null, f.cover ? "Set" : "A placeholder is drawn"),
      item("description", "Description", "recommended", filled(book.description), filled(book.description) ? "Set" : "Not set"),
    ]),
  ];
}
