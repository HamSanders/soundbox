/**
 * Plain text, Markdown and pasted text.
 *
 * Paragraphs are separated by blank lines. A heading is a Markdown `#` line,
 * a setext underline (`===` / `---`), or a line that reads as one on its own
 * ("Chapter 1", "CHAPTER XII. The Ball", "Prologue", a bare roman numeral)
 * with a blank line or the start of the text before it.
 *
 * Hard-wrapped text (Project Gutenberg style, ~70 columns) is joined back
 * into paragraphs, and a hyphen at the end of a wrapped line is mended.
 */

import type { Manuscript } from "../types.js";
import { blocksToSections, emptyManuscript, finishManuscript, type Block, type ParseOptions } from "./manuscript.js";
import { isHeadingLine, SCENE_BREAK, tidyTitle } from "./text.js";

/** Strip inline Markdown so it is not read aloud. */
export function stripMarkdownInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links
    .replace(/\[\^[^\]]+\]/g, "") // footnote refs
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~(.+?)~~/g, "$1");
}

/** Join a hard-wrapped paragraph's lines, mending end-of-line hyphenation. */
export function joinLines(lines: string[]): string {
  let out = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) out = line;
    else if (/[a-z]-$/.test(out) && /^[a-z]/.test(line)) out = out.slice(0, -1) + line;
    else out = `${out} ${line}`;
  }
  return out;
}

export function textToBlocks(text: string, markdown: boolean): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let inFence = false;
  const flush = () => {
    if (para.length) {
      const joined = joinLines(para);
      if (joined) blocks.push({ type: "para", text: markdown ? stripMarkdownInline(joined) : joined });
    }
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (markdown && /^(```|~~~)/.test(trimmed)) {
      // Code blocks aren't narration.
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!trimmed) {
      flush();
      continue;
    }
    if (markdown) {
      const atx = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
      if (atx) {
        flush();
        blocks.push({ type: "heading", level: atx[1]!.length, text: stripMarkdownInline(atx[2]!) });
        continue;
      }
      if (/^(?:[-*_]\s*){3,}$/.test(trimmed) && !para.length) {
        // A thematic break is a scene break.
        blocks.push({ type: "para", text: SCENE_BREAK });
        continue;
      }
      if (/^(?:<!--.*-->|<\/?[a-z][^>]*>)$/i.test(trimmed)) continue; // stray HTML
      if (/^\|.*\|$/.test(trimmed)) continue; // tables
    }
    // Setext heading: a single line underlined by === or ---.
    const next = lines[i + 1]?.trim() ?? "";
    if (para.length === 0 && /^(=+|-+)$/.test(next) && next.length >= 3 && trimmed.length <= 100) {
      blocks.push({ type: "heading", level: next.startsWith("=") ? 1 : 2, text: markdown ? stripMarkdownInline(trimmed) : trimmed });
      i++;
      continue;
    }
    if (para.length === 0 && isHeadingLine(trimmed)) {
      // Plain-text heading: alone on its line, so the next line is blank or
      // another short line ("CHAPTER I." then "The Ball." on the next).
      const after = lines[i + 1]?.trim() ?? "";
      const after2 = lines[i + 2]?.trim() ?? "";
      if (!after) {
        blocks.push({ type: "heading", level: 1, text: trimmed });
        continue;
      }
      if (after.length <= 80 && !after2 && !/[a-z]$/.test(after) && !isHeadingLine(after)) {
        blocks.push({ type: "heading", level: 1, text: `${tidyTitle(trimmed)}: ${tidyTitle(after)}` });
        i++;
        continue;
      }
    }
    // Markdown list items and block quotes: keep the words.
    const item = markdown ? trimmed.replace(/^(?:[-*+]|\d+[.)])\s+/, "").replace(/^>\s?/, "") : trimmed;
    if (markdown && item !== trimmed && para.length) {
      flush();
    }
    para.push(item);
  }
  flush();
  return blocks;
}

/** Leading Markdown front matter (`---` YAML) as simple key: value pairs. */
function frontMatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]!.toLowerCase()] = kv[2]!.replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

export function parsePlainText(
  text: string,
  opts: ParseOptions & { markdown?: boolean; titleHint?: string | null } = {},
): Manuscript {
  const m = emptyManuscript();
  let body = text.replace(/^﻿/, "");
  if (opts.markdown) {
    const fm = frontMatter(body);
    body = fm.body;
    m.title = fm.meta.title ?? null;
    m.author = fm.meta.author ?? null;
    m.language = fm.meta.lang ?? fm.meta.language ?? null;
    m.description = fm.meta.description ?? null;
    m.subtitle = fm.meta.subtitle ?? null;
  } else {
    // Project Gutenberg header lines, when present.
    m.title = /^Title:\s*(.+)$/m.exec(body.slice(0, 4000))?.[1]?.trim() ?? null;
    m.author = /^Author:\s*(.+)$/m.exec(body.slice(0, 4000))?.[1]?.trim() ?? null;
    m.language = languageCode(/^Language:\s*(.+)$/m.exec(body.slice(0, 4000))?.[1]?.trim() ?? null);
    const start = /^\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG.*$/im.exec(body);
    if (start) body = body.slice(start.index + start[0].length);
    const end = /^\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG.*$/im.exec(body);
    if (end) body = body.slice(0, end.index);
  }
  const blocks = textToBlocks(body, opts.markdown === true);
  const { sections, firstHeading } = blocksToSections(blocks, { ...opts, fallbackTitle: "Opening" });
  m.title ??= firstHeading ?? opts.titleHint ?? null;
  m.sections = sections;
  return finishManuscript(m);
}

const LANGUAGE_NAMES: Record<string, string> = {
  english: "en", french: "fr", german: "de", spanish: "es", italian: "it", portuguese: "pt",
  dutch: "nl", latin: "la", finnish: "fi", swedish: "sv", danish: "da", norwegian: "no",
  russian: "ru", chinese: "zh", japanese: "ja", greek: "el", polish: "pl",
};

/** A BCP-47 code from a code or an English language name. */
export function languageCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/i.test(v)) return v.split("-")[0]!.toLowerCase() + v.slice(v.indexOf("-") === -1 ? v.length : v.indexOf("-"));
  return LANGUAGE_NAMES[v.toLowerCase()] ?? null;
}
