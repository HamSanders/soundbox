/**
 * Podcast RSS export: the book as a serial podcast, one episode per chapter.
 *
 * Writes a folder with `feed.xml`, `audio/` and the cover, ready to upload to
 * any static host at `base_url`. Enclosures must be absolute URLs, so the
 * caller says where the folder will live.
 *
 * Tags follow Apple Podcasts' requirements
 * (https://podcasters.apple.com/support/823-podcast-requirements): RSS 2.0
 * with the itunes namespace, an enclosure with url, length and type, a GUID
 * that never changes, RFC 2822 pubDates and ASCII file names. Episodes carry
 * `itunes:episode` and the channel is `itunes:type` serial, so apps play them
 * in book order.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { ModelError } from "../../errors.js";
import type { MirliService } from "../../service.js";
import { audiobooks, type BookDetail } from "../service.js";
import {
  copyCover,
  gatherChapters,
  listFiles,
  newPublishDir,
  type AudioEncoding,
  type PublishedChapter,
  type PublishResult,
} from "./common.js";
import { writeZip } from "./zip.js";

export interface RssOptions {
  /** Absolute http(s) URL the published folder will be served from. */
  base_url: string;
  encoding?: AudioEncoding;
  explicit?: boolean;
  /** Feed owner e-mail (itunes:owner); optional. */
  owner_email?: string | null;
  zip?: boolean;
}

export function xml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** RFC 2822 date, as RSS `pubDate` requires. */
export function rfc2822(date: Date): string {
  return date.toUTCString().replace("GMT", "+0000");
}

function normaliseBase(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ModelError("base_url must be an absolute http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ModelError("base_url must be an absolute http(s) URL");
  }
  return parsed.toString().replace(/\/?$/, "/");
}

export function rssFeed(
  book: BookDetail,
  chapters: PublishedChapter[],
  cover: string | null,
  options: RssOptions,
): string {
  const base = normaliseBase(options.base_url);
  const first = book.publication_date ? new Date(book.publication_date) : new Date(book.created_at);
  const start = Number.isNaN(first.getTime()) ? new Date(book.created_at) : first;
  const author = book.author ?? "Unknown";
  const description = book.description ?? book.title;
  const explicit = options.explicit ? "true" : "false";
  const items = chapters
    .map((c, i) => {
      // One minute apart, so apps that sort by date keep book order too.
      const date = new Date(start.getTime() + i * 60_000);
      return `    <item>
      <title>${xml(c.chapter.title)}</title>
      <itunes:title>${xml(c.chapter.title)}</itunes:title>
      <itunes:episode>${i + 1}</itunes:episode>
      <itunes:episodeType>full</itunes:episodeType>
      <guid isPermaLink="false">mirli:${xml(book.id)}:${xml(c.chapter.id)}</guid>
      <pubDate>${rfc2822(date)}</pubDate>
      <enclosure url="${xml(base + "audio/" + encodeURIComponent(c.file))}" length="${c.size_bytes}" type="${c.mime}"/>
      <itunes:duration>${Math.round(c.chapter.duration_s)}</itunes:duration>
      <itunes:explicit>${explicit}</itunes:explicit>
      <description>${xml(`${book.title}: ${c.chapter.title}`)}</description>
    </item>`;
    })
    .join("\n");
  const owner = options.owner_email
    ? `\n    <itunes:owner><itunes:name>${xml(author)}</itunes:name><itunes:email>${xml(options.owner_email)}</itunes:email></itunes:owner>`
    : "";
  const image = cover
    ? `\n    <itunes:image href="${xml(base + cover)}"/>\n    <image><url>${xml(base + cover)}</url><title>${xml(book.title)}</title><link>${xml(base)}</link></image>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(book.title)}</title>
    <link>${xml(base)}</link>
    <atom:link href="${xml(base + "feed.xml")}" rel="self" type="application/rss+xml"/>
    <language>${xml(book.language)}</language>
    <description>${xml(description)}</description>
    <itunes:summary>${xml(description)}</itunes:summary>
    <itunes:author>${xml(author)}</itunes:author>
    <itunes:type>serial</itunes:type>
    <itunes:explicit>${explicit}</itunes:explicit>
    <itunes:category text="Arts"><itunes:category text="Books"/></itunes:category>${owner}${image}
    <generator>Mirli</generator>
${items}
  </channel>
</rss>
`;
}

export async function publishRss(svc: MirliService, bookId: string, options: RssOptions): Promise<PublishResult> {
  const book = audiobooks(svc).getBook(bookId);
  if (!book) throw new ModelError("Book not found");
  normaliseBase(options.base_url);
  const warnings: string[] = [];
  const { name, dir } = newPublishDir(svc, book, "rss");
  const chapters = await gatherChapters(svc, book, dir, options.encoding ?? "auto", warnings);
  if (chapters.some((c) => c.mime === "audio/wav")) {
    warnings.push("Podcast apps expect MP3 or M4A; WAV enclosures may not play everywhere.");
  }
  const cover = copyCover(svc, bookId, dir);
  if (!cover) warnings.push("Podcast directories require cover art (square, 1400–3000 px).");
  writeFileSync(join(dir, "feed.xml"), rssFeed(book, chapters, cover, options));
  const files = listFiles(dir);
  let zipPath: string | null = null;
  if (options.zip !== false) {
    zipPath = `${dir}.zip`;
    writeZip(
      zipPath,
      files.map((f) => ({ name: `${name}/${f}`, source: join(dir, f) })),
    );
  }
  return {
    kind: "rss",
    name,
    dir,
    zip_path: zipPath,
    download_url: zipPath ? `/api/audiobooks/${encodeURIComponent(bookId)}/publish/files/${encodeURIComponent(name)}.zip` : null,
    files,
    chapters: chapters.length,
    warnings,
    created_at: new Date().toISOString(),
  };
}
