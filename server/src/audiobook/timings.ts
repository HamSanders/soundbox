/**
 * Paragraph timings for read-along and captions.
 *
 * A chapter's paragraphs sit on its story timeline at `start_s` for
 * `duration_s`, and the mixdown keeps timeline second t at file second t
 * (`MirliService.mixStory`). Mastering may then move the content to fit the
 * head room tone (`MasterResult.shiftS`), and a single-file export puts each
 * chapter after the ones before it. So a paragraph's time in the delivered
 * file is `start_s + shift + chapter offset`, and that is all this does.
 */

import type { ParagraphTiming } from "./types.js";

/** The fields of a paragraph (core's `Paragraph`) that timing needs. */
export interface TimedParagraph {
  id: string;
  kind?: string | null;
  text: string;
  start_s: number;
  duration_s: number | null;
  sound_id: string | null;
  muted?: boolean | number | null;
  character_id: string | null;
}

/** Timings of every audible spoken paragraph, in file seconds, in order. */
export function paragraphTimings(paragraphs: TimedParagraph[], offsetS = 0, fileDurationS?: number): ParagraphTiming[] {
  const out = paragraphs
    .filter((p) => p.kind !== "pause" && !p.muted && p.sound_id && (p.duration_s ?? 0) > 0 && p.text.trim())
    .map((p) => ({
      segment_id: p.id,
      start_s: round(Math.max(0, p.start_s + offsetS)),
      end_s: round(Math.max(0, p.start_s + (p.duration_s ?? 0) + offsetS)),
      text: p.text.trim(),
      character_id: p.character_id,
    }))
    .sort((a, b) => a.start_s - b.start_s);
  if (fileDurationS !== undefined) {
    for (const t of out) t.end_s = Math.min(t.end_s, round(fileDurationS));
  }
  return out;
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

/* -------------------------------------------------------------- captions */

export interface Cue {
  start_s: number;
  end_s: number;
  text: string;
}

/** Longest caption line, the usual broadcast limit of about 42 characters. */
const LINE = 42;

/**
 * Split each paragraph into caption cues of at most two lines, giving each
 * cue a share of the paragraph's time in proportion to its length. TTS
 * reads at a steady rate, so that lands close to the spoken words.
 */
export function cues(timings: ParagraphTiming[], maxChars = LINE * 2): Cue[] {
  const out: Cue[] = [];
  for (const t of timings) {
    const parts = splitText(t.text, maxChars);
    const total = parts.reduce((n, p) => n + p.length, 0) || 1;
    let at = t.start_s;
    for (const part of parts) {
      const end = at + ((t.end_s - t.start_s) * part.length) / total;
      out.push({ start_s: round(at), end_s: round(end), text: wrap(part, LINE) });
      at = end;
    }
  }
  return out;
}

/** Break text into pieces of at most `max` chars at sentence, then word, ends. */
export function splitText(text: string, max: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > max) {
      out.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
      // End a cue at a sentence end once it has some length.
      if (/[.!?]["')\]]?$/.test(w) && cur.length > max / 2) {
        out.push(cur);
        cur = "";
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

function wrap(text: string, width: number): string {
  if (text.length <= width) return text;
  const mid = text.lastIndexOf(" ", Math.min(width, Math.ceil(text.length / 2) + 6));
  return mid > 0 ? `${text.slice(0, mid)}\n${text.slice(mid + 1)}` : text;
}

function stamp(s: number, sep: "," | "."): string {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSrt(list: Cue[]): string {
  return list.map((c, i) => `${i + 1}\n${stamp(c.start_s, ",")} --> ${stamp(c.end_s, ",")}\n${c.text}\n`).join("\n");
}

export function toVtt(list: Cue[]): string {
  return `WEBVTT\n\n${list.map((c) => `${stamp(c.start_s, ".")} --> ${stamp(c.end_s, ".")}\n${c.text}\n`).join("\n")}`;
}

/* ------------------------------------------------------------ read-along */

export interface ReadAlongChapter {
  chapter_id: string;
  title: string;
  /** File inside the export this chapter is in. */
  file: string;
  /** Where the chapter starts inside `file` (non-zero in single-file exports). */
  start_s: number;
  duration_s: number;
  paragraphs: ParagraphTiming[];
}

export interface ReadAlong {
  version: 1;
  book_id: string;
  title: string;
  chapters: ReadAlongChapter[];
}

export function readAlong(bookId: string, title: string, chapters: ReadAlongChapter[]): ReadAlong {
  return { version: 1, book_id: bookId, title, chapters };
}
