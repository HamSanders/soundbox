/**
 * Text helpers shared by every manuscript parser: heading recognition,
 * section kind detection, and cleanup that suits text-to-speech.
 *
 * Pure functions, no I/O. The sentence splitter and the clause-boundary
 * cutter follow `app/src/lib/script-parse.ts` (`splitSentences`,
 * `limitLength`); they are restated here because the server cannot import
 * from the app.
 */

import type { ManuscriptSection } from "../types.js";
import { isMultilingualHeading, matterFromTitle } from "./lang.js";

/** Default ceiling on characters per paragraph. Most local TTS models read a
 *  paragraph this long in one pass without rushing or truncating it. */
export const DEFAULT_MAX_CHARS = 1000;

/* ------------------------------------------------------------- headings */

const ROMAN = "(?:[IVXLCDM]+|[ivxlcdm]+)";
const NUMBER_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|" +
  "sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|first|second|third";
const NUMBERING = `(?:\\d{1,4}|${ROMAN}|(?:(?:${NUMBER_WORDS})[- ]?)+)`;

/** "Chapter 1", "CHAPTER XII. The Ball", "Part Two", "Book III", "Chapter the First". */
const NUMBERED_HEADING = new RegExp(
  `^(?:chapter|part|book|volume|act|letter)\\s+(?:the\\s+)?${NUMBERING}\\b[.:—–-]?\\s*.{0,80}$`,
  "i",
);
/** Named front and back matter that stands alone on a line. */
const NAMED_HEADING =
  /^(?:prologue|epilogue|preface|foreword|introduction|afterword|interlude|dedication|epigraph|acknowledg(?:e)?ments?|about the author|author'?s note|a note (?:from|on) the (?:author|text)|copyright|contents|table of contents|glossary|appendix(?:\s+\w+)?|notes|bibliography|index|also by .{1,60}|postscript|coda)\s*[.:]?\s*(?:[—–:-]\s*.{0,60})?$/i;
/** A bare roman numeral or number on its own line: "IV", "12.". */
const BARE_NUMBER = new RegExp(`^(?:${ROMAN}|\\d{1,3})\\.?$`);

/** True when a single line of plain text reads as a section heading. */
export function isHeadingLine(line: string): boolean {
  const s = line.trim();
  if (!s || s.length > 100) return false;
  if (NUMBERED_HEADING.test(s) || NAMED_HEADING.test(s) || isMultilingualHeading(s)) return true;
  // A lone roman numeral counts; a lone "I" is almost always the pronoun.
  if (BARE_NUMBER.test(s) && s !== "I" && s !== "I.") return true;
  return false;
}

/* ----------------------------------------------------- section kinds */

/** "All rights reserved" in the supported languages: an untitled copyright page. */
const RIGHTS_RESERVED =
  /all rights reserved|alle rechte vorbehalten|tous droits réservés|todos los derechos reservados|tutti i diritti riservati|todos os direitos reservados|alle rechten voorbehouden|wszelkie prawa zastrzeżone|все права защищены|版权所有|版權所有|無断転載|無断複製/i;
/** A dedication's opening word: For, To, Für, Pour, À, Para, Per, Voor, Dla, Для, 献给. */
const DEDICATION_START = /^(?:for|to|für|pour|à|para|per|voor|dla|для)\s|^(?:献给|獻給)/iu;

/** Detect a section's kind from its title (any supported language; see
 *  `lang.ts`), falling back to its text. Excluded by default: pages a
 *  listener doesn't want read aloud (copyright, contents, index). */
export function classifySection(
  title: string,
  paragraphs: string[],
): Pick<ManuscriptSection, "kind" | "included"> {
  const matter = matterFromTitle(title);
  if (matter) return { kind: matter.kind, included: matter.included };
  const body = paragraphs.join("\n");
  const head = body.slice(0, 1500);
  // Untitled copyright pages: "All rights reserved", "ISBN", a © line.
  if (
    body.length < 3000 &&
    (RIGHTS_RESERVED.test(head) || /\bISBN[- :]/.test(head) || /(?:©|\(c\)|copyright)\s*\d{4}/i.test(head))
  ) {
    return { kind: "front_matter", included: false };
  }
  if (looksLikeContents(paragraphs)) return { kind: "front_matter", included: false };
  // A dedication: one or two short lines ("For Cassandra", "Für Anna").
  if (paragraphs.length <= 2 && body.length < 200 && DEDICATION_START.test(body.trim())) {
    return { kind: "front_matter", included: true };
  }
  return { kind: "chapter", included: true };
}

/** A table of contents: mostly short lines that look like headings or end in
 *  page numbers. */
export function looksLikeContents(paragraphs: string[]): boolean {
  if (paragraphs.length < 4) return false;
  const lines = paragraphs.flatMap((p) => p.split(/\n/)).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return false;
  const tocish = lines.filter(
    (l) => l.length < 90 && (isHeadingLine(l) || /(?:\.{2,}|\s)\d{1,4}$/.test(l)),
  ).length;
  return tocish / lines.length >= 0.6;
}

/* ------------------------------------------------------------ cleanup */

/** Footnote markers that would be read aloud as numbers: superscript digits,
 *  "[12]", "[a]", and a digit glued to the end of a word or sentence ("said.3"). */
export function stripFootnoteMarkers(text: string): string {
  return text
    .replace(/[¹²³⁰-⁹]+/g, "")
    .replace(/\[(?:\d{1,3}|[a-z]|[ivx]{1,4})\]/gi, "")
    .replace(/(?<=[a-z][.,;:!?"”’)])\d{1,3}(?=\s|$)/g, "")
    .replace(/(?<=[a-z]{2})\*+(?=[\s.,;:!?]|$)/g, "");
}

/** Normalise whitespace and invisible characters. Smart quotes, dashes and
 *  ellipses are kept: models read them better than their ASCII stand-ins. */
export function normaliseWhitespace(text: string): string {
  return text
    .replace(/[­​‌‍⁠﻿]/g, "") // soft hyphen, zero-width
    .replace(/[  -   　]/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/** Clean one paragraph for TTS. Returns "" when nothing speakable is left. */
export function cleanParagraph(text: string): string {
  const s = normaliseWhitespace(stripFootnoteMarkers(text));
  // Separator rows ("* * *", "###", "~~~") carry no words.
  if (/^[\s*#~=_\-–—•·.]+$/.test(s)) return "";
  return s;
}

/** Prose into sentences. Abbreviations, initials and decimals stay whole. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g;
  const normalised = text.replace(/\s+/g, " ").trim();
  if (!normalised) return out;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalised)) !== null) {
    const s = m[0].trim();
    if (!s) continue;
    const last = out[out.length - 1];
    if (
      last &&
      (/\b(?:[A-Z][a-z]?|Mr|Mrs|Ms|Dr|St|No|vs|etc|Prof|Gen|Col|Capt|Lt|Sgt|Rev|Jr|Sr)\.$/.test(last) ||
        /\d\.$/.test(last) && /^\d/.test(s) ||
        /^[a-z]/.test(s))
    ) {
      out[out.length - 1] = `${last} ${s}`;
    } else {
      out.push(s);
    }
  }
  return out;
}

/** Cut a line longer than `maxChars` at the clause boundary nearest the
 *  middle, then at the space nearest the middle. */
export function limitLength(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line];
  const cut = /[,;:—–]\s|\s[—–-]\s/g;
  let best = -1;
  let m: RegExpExecArray | null;
  const target = line.length / 2;
  while ((m = cut.exec(line)) !== null) {
    const at = m.index + 1;
    if (best === -1 || Math.abs(at - target) < Math.abs(best - target)) best = at;
  }
  if (best <= 0) {
    const space = line.lastIndexOf(" ", Math.floor(target));
    if (space <= 0) return [line];
    best = space;
  }
  const head = line.slice(0, best).trim();
  const tail = line.slice(best).trim();
  if (!head || !tail) return [line];
  return [...limitLength(head, maxChars), ...limitLength(tail, maxChars)];
}

/** Split a paragraph longer than `maxChars` at sentence boundaries, packing
 *  whole sentences greedily; a single sentence over the limit is cut at a
 *  clause boundary. */
export function splitLongParagraph(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const out: string[] = [];
  let current = "";
  for (const sentence of splitSentences(text)) {
    for (const piece of limitLength(sentence, maxChars)) {
      if (!current) current = piece;
      else if (current.length + 1 + piece.length <= maxChars) current = `${current} ${piece}`;
      else {
        out.push(current);
        current = piece;
      }
    }
  }
  if (current) out.push(current);
  return out;
}

export interface CleanOptions {
  /** Ceiling on characters per paragraph; longer ones split at sentences. */
  maxChars?: number;
}

/** Clean, drop empties and split long paragraphs. */
export function cleanParagraphs(paragraphs: string[], opts: CleanOptions = {}): string[] {
  const max = Math.max(80, opts.maxChars ?? DEFAULT_MAX_CHARS);
  const out: string[] = [];
  for (const p of paragraphs) {
    const cleaned = cleanParagraph(p);
    if (cleaned) out.push(...splitLongParagraph(cleaned, max));
  }
  return out;
}

/** Title case an ALL CAPS heading ("CHAPTER ONE" → "Chapter One"). Mixed case
 *  is left as written. */
export function tidyTitle(title: string): string {
  const s = normaliseWhitespace(title).replace(/[.:]+$/, "");
  if (s !== s.toUpperCase() || !/\p{Lu}/u.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s(“"'«-])(\p{Ll})/gu, (_m, pre: string, c: string) => pre + c.toUpperCase())
    .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii|Xiii|Xiv|Xv|Xvi|Xvii|Xviii|Xix|Xx)\b/g, (r) => r.toUpperCase());
}
