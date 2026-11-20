/**
 * The common middle of every parser: a flat list of blocks (headings and
 * paragraphs), grouped into sections, cleaned and classified.
 */

import type { Manuscript, ManuscriptSection } from "../types.js";
import { detectLanguage } from "./lang.js";
import { classifySection, cleanParagraphs, tidyTitle, type CleanOptions } from "./text.js";

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "para"; text: string };

export interface ParseOptions extends CleanOptions {}

export function emptyManuscript(): Manuscript {
  return {
    title: null,
    subtitle: null,
    author: null,
    language: null,
    description: null,
    isbn: null,
    publisher: null,
    publication_date: null,
    cover: null,
    sections: [],
    warnings: [],
  };
}

/** Build one section from a title and raw paragraphs; null when no speakable
 *  text is left. */
export function makeSection(
  title: string,
  raw: string[],
  opts: ParseOptions = {},
): ManuscriptSection | null {
  const paragraphs = cleanParagraphs(raw, opts);
  if (!paragraphs.length) return null;
  const tidy = tidyTitle(title);
  return { title: tidy, ...classifySection(tidy, raw), paragraphs };
}

/**
 * Group blocks into sections. A section starts at every heading at or above
 * `splitLevel`; the chosen level is the shallowest heading level that occurs
 * more than once, so a book whose only H1 is its title splits on H2.
 * Text before the first heading becomes an untitled opening section.
 * Lower-level headings stay in the section as their own paragraph.
 */
export function blocksToSections(
  blocks: Block[],
  opts: ParseOptions & { fallbackTitle?: string } = {},
): { sections: ManuscriptSection[]; firstHeading: string | null } {
  const headings = blocks.filter((b): b is Extract<Block, { type: "heading" }> => b.type === "heading");
  let splitLevel = Infinity;
  const counts = new Map<number, number>();
  for (const h of headings) counts.set(h.level, (counts.get(h.level) ?? 0) + 1);
  for (const level of [...counts.keys()].sort((a, b) => a - b)) {
    if ((counts.get(level) ?? 0) > 1) {
      splitLevel = level;
      break;
    }
  }
  if (splitLevel === Infinity && headings.length === 1) splitLevel = headings[0]!.level;

  const sections: ManuscriptSection[] = [];
  let title: string | null = null;
  let raw: string[] = [];
  let index = 0;
  const flush = () => {
    const name = title ?? (index === 0 ? opts.fallbackTitle ?? "Opening" : `Section ${index + 1}`);
    const section = makeSection(name, raw, opts);
    if (section) sections.push(section);
    if (section || title) index++;
    raw = [];
  };
  for (const block of blocks) {
    if (block.type === "heading" && block.level <= splitLevel) {
      // A heading above the split level is the book's title: metadata, not a section.
      if (block.level < splitLevel) continue;
      if (raw.length || title !== null) flush();
      title = block.text;
    } else if (block.type === "heading") {
      raw.push(block.text);
    } else {
      raw.push(block.text);
    }
  }
  if (raw.length || title !== null) flush();
  const first = headings.find((h) => h.level < splitLevel)?.text ?? null;
  return { sections, firstHeading: first };
}

/** Drop empty sections, tidy metadata strings, and warn when nothing is left. */
export function finishManuscript(m: Manuscript): Manuscript {
  m.sections = m.sections.filter((s) => s.paragraphs.length > 0);
  if (!m.sections.length) m.warnings.push("No readable text was found.");
  for (const key of ["title", "subtitle", "author", "description", "publisher"] as const) {
    const v = m[key];
    if (typeof v === "string") m[key] = v.replace(/\s+/g, " ").trim() || null;
  }
  if (!m.language) {
    // No language in the metadata: guess from the included text.
    let sample = "";
    for (const s of m.sections) {
      if (!s.included) continue;
      sample += ` ${s.paragraphs.join(" ")}`;
      if (sample.length > 20_000) break;
    }
    m.language = detectLanguage(sample);
  }
  return m;
}
