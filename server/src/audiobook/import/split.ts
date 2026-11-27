/**
 * Raw text into speakable paragraphs, for callers outside the importer
 * (core's "chapter from text", for instance).
 *
 * Same rules as an imported manuscript: blank lines separate paragraphs,
 * hard-wrapped lines are joined and end-of-line hyphens mended, footnote
 * markers and invisible characters removed, separator rows dropped, and a
 * paragraph longer than `maxChars` split at sentence boundaries (then clause
 * boundaries). Heading lines ("Chapter 3") stay as their own paragraph.
 * Pure; no I/O.
 */

import { textToBlocks } from "./plain.js";
import { cleanParagraphs, DEFAULT_MAX_CHARS } from "./text.js";

export interface SplitTextOptions {
  /** Ceiling on characters per paragraph (default 1000, minimum 80). */
  maxChars?: number;
  /** Treat the text as Markdown: strip inline syntax and skip code blocks. */
  markdown?: boolean;
}

export function splitManuscriptText(text: string, opts: SplitTextOptions = {}): string[] {
  const blocks = textToBlocks(text.replace(/^﻿/, ""), opts.markdown === true);
  return cleanParagraphs(
    blocks.map((b) => b.text),
    { maxChars: opts.maxChars ?? DEFAULT_MAX_CHARS },
  );
}
