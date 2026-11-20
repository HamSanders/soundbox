/**
 * Shared pieces of the publish exports: where they are written, how chapter
 * audio is gathered and named, and the schema.org description of the book.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import { transcodeMp3 } from "../../audio/dsp.js";
import { ModelError } from "../../errors.js";
import type { MirliService } from "../../service.js";
import { audiobooks, type BookDetail } from "../service.js";
import type { ParagraphTiming } from "../types.js";
import { buildChapter, castOf, exportedAudio, listenableChapters, type ListenChapter } from "./manifest.js";
import { chapterMix } from "./mix.js";

export type PublishKind = "webplayer" | "rss";
export type AudioEncoding = "auto" | "mp3" | "wav";

export interface PublishedChapter {
  chapter: ListenChapter;
  timings: ParagraphTiming[];
  /** File name inside the published `audio/` folder. */
  file: string;
  mime: string;
  size_bytes: number;
}

export interface PublishResult {
  kind: PublishKind;
  /** Folder name under `<data>/publish/`; also the zip's name. */
  name: string;
  dir: string;
  zip_path: string | null;
  download_url: string | null;
  files: string[];
  chapters: number;
  warnings: string[];
  created_at: string;
}

export function publishRoot(svc: MirliService): string {
  return join(svc.config.paths.root, "publish");
}

/** Lower-case ASCII, digits and dashes: safe in URLs and on every filesystem
 *  (Apple Podcasts asks for ASCII-only file names and URLs). */
export function slug(text: string, fallback = "book"): string {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || fallback;
}

/** ISO 8601 duration, as schema.org's `duration` expects. */
export function isoDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}

/** A fresh, timestamped output folder for one publish run. */
export function newPublishDir(svc: MirliService, book: BookDetail, kind: PublishKind): { name: string; dir: string } {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  const base = `${slug(book.title)}-${kind}-${stamp}`;
  const root = publishRoot(svc);
  let name = base;
  for (let n = 2; existsSync(join(root, name)); n++) name = `${base}-${n}`;
  const dir = join(root, name);
  mkdirSync(join(dir, "audio"), { recursive: true });
  return { name, dir };
}

/**
 * Every listenable chapter's audio, copied (or encoded) into `<dir>/audio/`,
 * named `NN-title.ext`. Chapters with no audio are skipped with a warning.
 */
export async function gatherChapters(
  svc: MirliService,
  book: BookDetail,
  dir: string,
  encoding: AudioEncoding,
  warnings: string[],
): Promise<PublishedChapter[]> {
  const exports = exportedAudio(svc, book.id);
  const out: PublishedChapter[] = [];
  let index = 0;
  let mp3Failed = false;
  for (const chapter of listenableChapters(book.chapters)) {
    const exported = exports.get(chapter.id) ?? null;
    const built = buildChapter(svc, book.id, chapter, exported);
    const src = exported?.path ?? chapterMix(svc, chapter);
    if (!src || built.chapter.duration_s <= 0) {
      warnings.push(`"${chapter.title}" has no audio yet and was left out.`);
      continue;
    }
    index++;
    const stem = `${String(index).padStart(2, "0")}-${slug(chapter.title, "chapter")}`;
    const srcExt = extname(src).toLowerCase() || ".wav";
    let file = `${stem}${srcExt}`;
    let mime = mimeFor(srcExt);
    const wantMp3 = encoding !== "wav" && srcExt === ".wav" && !mp3Failed;
    if (wantMp3 && (await transcodeMp3(src, join(dir, "audio", `${stem}.mp3`)))) {
      file = `${stem}.mp3`;
      mime = "audio/mpeg";
    } else {
      if (wantMp3) {
        mp3Failed = true;
        const msg = "ffmpeg was not found, so chapters were written as WAV instead of MP3.";
        if (encoding === "mp3") throw new ModelError(msg);
        warnings.push(msg);
      }
      copyFileSync(src, join(dir, "audio", file));
    }
    out.push({
      chapter: { ...built.chapter, audio_url: `audio/${file}` },
      timings: built.timings,
      file,
      mime,
      size_bytes: statSync(join(dir, "audio", file)).size,
    });
  }
  if (out.length === 0) throw new ModelError("Nothing to publish: no chapter has audio yet.");
  return out;
}

export function mimeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
    case ".m4b":
      return "audio/mp4";
    case ".flac":
      return "audio/flac";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "audio/wav";
  }
}

/** Copy the cover into `dir` as `cover.<ext>`; returns its file name. */
export function copyCover(svc: MirliService, bookId: string, dir: string): string | null {
  const cover = audiobooks(svc).coverFile(bookId);
  if (!cover) return null;
  const ext = extname(cover.path) || ".jpg";
  const name = `cover${ext.toLowerCase()}`;
  copyFileSync(cover.path, join(dir, name));
  return name;
}

/** Every file under `dir`, relative, with forward slashes. */
export function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, `${prefix}${name}/`));
    else out.push(`${prefix}${name}`);
  }
  return out;
}

/** schema.org `Audiobook` JSON-LD (https://schema.org/Audiobook). */
export function audiobookJsonLd(
  svc: MirliService,
  book: BookDetail,
  chapters: PublishedChapter[],
  cover: string | null,
): Record<string, unknown> {
  const duration = chapters.reduce((sum, c) => sum + c.chapter.duration_s, 0);
  const readers = castOf(svc, book, book.characters)
    .map((c) => c.voice_name)
    .filter((n): n is string => Boolean(n));
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Audiobook",
    name: book.title,
    bookFormat: "https://schema.org/AudiobookFormat",
    duration: isoDuration(duration),
    inLanguage: book.language,
  };
  if (book.subtitle) ld.alternativeHeadline = book.subtitle;
  if (book.author) ld.author = { "@type": "Person", name: book.author };
  if (readers.length) ld.readBy = [...new Set(readers)].map((name) => ({ "@type": "Person", name }));
  if (book.description) ld.description = book.description;
  if (book.genres.length) ld.genre = book.genres;
  if (book.publication_date) ld.datePublished = book.publication_date;
  if (book.publisher) ld.publisher = { "@type": "Organization", name: book.publisher };
  if (book.isbn) ld.isbn = book.isbn;
  if (cover) ld.image = cover;
  if (book.series) {
    ld.isPartOf = { "@type": "BookSeries", name: book.series };
    if (book.series_index != null) ld.position = book.series_index;
  }
  ld.hasPart = chapters.map((c, i) => ({
    "@type": "Chapter",
    name: c.chapter.title,
    position: i + 1,
    associatedMedia: { "@type": "AudioObject", contentUrl: c.chapter.audio_url, encodingFormat: c.mime, duration: isoDuration(c.chapter.duration_s) },
  }));
  return ld;
}
