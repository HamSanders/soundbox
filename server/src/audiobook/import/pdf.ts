/**
 * PDF, from its text layer (pdf.js through `unpdf`).
 *
 * A PDF has no paragraphs, only positioned runs of text, so this rebuilds
 * them:
 *  1. runs on the same baseline become a line;
 *  2. lines that repeat at the top or bottom of most pages (running heads,
 *     footers) and bare page numbers are dropped;
 *  3. a line set clearly larger than the body text, or a "Chapter 1"-style
 *     line standing alone, is a heading; bigger type is a higher level;
 *  4. remaining lines join into paragraphs, breaking at a wider gap, an
 *     indent, or a short line that ends a sentence; a hyphen at a line end
 *     before a lower-case word is mended.
 * Pages with no text at all are scans; the parser says how many.
 */

import type { Manuscript } from "../types.js";
import { blocksToSections, emptyManuscript, finishManuscript, type Block, type ParseOptions } from "./manuscript.js";
import { languageCode } from "./plain.js";
import { isHeadingLine } from "./text.js";

/** One positioned text run, as pdf.js reports it (y grows upwards). */
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  hasEOL?: boolean;
}

export interface PdfLine {
  text: string;
  x: number;
  y: number;
  right: number;
  size: number;
  page: number;
}

/** Runs into lines, top to bottom. */
export function itemsToLines(items: PdfItem[], page: number): PdfLine[] {
  const runs = items.filter((i) => i.str.trim() || i.str === " ");
  const lines: { items: PdfItem[]; y: number; size: number }[] = [];
  for (const item of runs) {
    const size = Math.abs(item.fontSize) || 10;
    const line = lines.find((l) => Math.abs(l.y - item.y) <= Math.max(l.size, size) * 0.4);
    if (line) {
      line.items.push(item);
      line.size = Math.max(line.size, size);
    } else {
      lines.push({ items: [item], y: item.y, size });
    }
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      const sorted = l.items.sort((a, b) => a.x - b.x);
      let text = "";
      let lastRight = -Infinity;
      for (const it of sorted) {
        const gap = it.x - lastRight;
        if (text && !text.endsWith(" ") && !it.str.startsWith(" ") && gap > l.size * 0.15) text += " ";
        text += it.str;
        lastRight = it.x + it.width;
      }
      // Body size is the size most of the line's characters use.
      const sizes = new Map<number, number>();
      for (const it of sorted) {
        const s = Math.round(Math.abs(it.fontSize) * 2) / 2;
        sizes.set(s, (sizes.get(s) ?? 0) + it.str.length);
      }
      const size = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? l.size;
      return {
        text: text.replace(/\s+/g, " ").trim(),
        x: sorted[0]!.x,
        y: l.y,
        right: lastRight,
        size,
        page,
      };
    })
    .filter((l) => l.text);
}

const PAGE_NUMBER = /^(?:page\s+)?(?:\d{1,4}|[ivxlcdm]{1,7})(?:\s*(?:of|\/)\s*\d{1,4})?$|^[-–—]\s*\d{1,4}\s*[-–—]$/i;

function shape(text: string): string {
  return text.toLowerCase().replace(/\d+|\b[ivxlcdm]+\b/g, "#").replace(/\s+/g, " ").trim();
}

/** Drop running heads, running feet and page numbers. */
export function stripFurniture(pages: PdfLine[][]): PdfLine[][] {
  const withText = pages.filter((p) => p.length);
  const counts = new Map<string, number>();
  const edge = (p: PdfLine[]) => [...p.slice(0, 2), ...p.slice(-2)];
  for (const p of withText) {
    for (const s of new Set(edge(p).map((l) => shape(l.text)))) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  // Odd and even pages often carry different heads (author / title).
  const threshold = Math.max(2, Math.ceil(withText.length * 0.3));
  return pages.map((p) => {
    const edges = new Set(edge(p));
    return p.filter((l) => {
      if (!edges.has(l)) return true;
      if (PAGE_NUMBER.test(l.text)) return false;
      // "Chapter 3" at the top of a page shares a shape with "Chapter 4"; a
      // heading is never furniture.
      if (isHeadingLine(l.text)) return true;
      if (withText.length >= 3 && (counts.get(shape(l.text)) ?? 0) >= threshold && l.text.length < 120) return false;
      return true;
    });
  });
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Lines into heading and paragraph blocks. */
export function linesToBlocks(pages: PdfLine[][]): Block[] {
  const lines = pages.flat();
  if (!lines.length) return [];
  // Body size: the size carrying the most characters.
  const bySize = new Map<number, number>();
  for (const l of lines) bySize.set(l.size, (bySize.get(l.size) ?? 0) + l.text.length);
  const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const bodyLines = lines.filter((l) => Math.abs(l.size - body) < 0.6);
  const left = median(bodyLines.map((l) => l.x));
  const right = median(bodyLines.map((l) => l.right));
  const width = Math.max(1, right - left);
  // Typical gap between consecutive body lines on a page.
  const gaps: number[] = [];
  for (const page of pages) {
    for (let i = 1; i < page.length; i++) {
      const a = page[i - 1]!;
      const b = page[i]!;
      if (Math.abs(a.size - body) < 0.6 && Math.abs(b.size - body) < 0.6) gaps.push(a.y - b.y);
    }
  }
  const lineGap = median(gaps.filter((g) => g > 0)) || body * 1.2;
  const headingSizes = [...new Set(lines.filter((l) => l.size >= body * 1.2).map((l) => l.size))].sort((a, b) => b - a);
  const levelOf = (size: number) => Math.min(6, headingSizes.indexOf(size) + 1);

  const blocks: Block[] = [];
  let para = "";
  let paraSize = 0;
  const flush = () => {
    const t = para.trim();
    if (t) blocks.push({ type: "para", text: t });
    para = "";
  };
  let prev: PdfLine | null = null;
  for (const line of lines) {
    const big = line.size >= body * 1.2 && line.text.length <= 120;
    const standalone =
      !big && isHeadingLine(line.text) && (!prev || prev.page !== line.page || prev.y - line.y > lineGap * 1.6 || /[.!?:"”]$/.test(prev.text));
    if (big || standalone) {
      flush();
      const level = big ? levelOf(line.size) : Math.max(1, headingSizes.length + 1);
      const last = blocks[blocks.length - 1];
      // A heading set on two lines ("CHAPTER I" / "The Ball") is one heading.
      if (last?.type === "heading" && prev && prev.page === line.page && last.level === level && prev.y - line.y < line.size * 2) {
        last.text = `${last.text} ${line.text}`;
      } else {
        blocks.push({ type: "heading", level, text: line.text });
      }
      prev = line;
      continue;
    }
    if (prev && para) {
      const samePage = prev.page === line.page;
      const gap = samePage ? prev.y - line.y : 0;
      const indented = line.x - left > body * 0.8;
      const prevShort = prev.right < left + width * 0.75;
      const prevEnds = /[.!?:"”’)…]$/.test(prev.text);
      const newPara =
        (samePage && gap > lineGap * 1.45) ||
        (indented && prevEnds) ||
        (prevShort && prevEnds && samePage) ||
        Math.abs(line.size - paraSize) > 0.6;
      if (newPara) flush();
    }
    if (!para) {
      para = line.text;
      paraSize = line.size;
    } else if (/[A-Za-z]-$/.test(para) && /^[a-z]/.test(line.text)) {
      para = para.slice(0, -1) + line.text;
    } else {
      para = `${para} ${line.text}`;
    }
    prev = line;
  }
  flush();
  return blocks;
}

/** Build a manuscript from per-page items (separated out for tests). */
export function manuscriptFromPdfPages(
  pages: PdfItem[][],
  info: { Title?: string; Author?: string; Subject?: string; Language?: string | null },
  opts: ParseOptions = {},
): Manuscript {
  const m = emptyManuscript();
  m.title = info.Title?.trim() || null;
  m.author = info.Author?.trim() || null;
  m.description = info.Subject?.trim() || null;
  m.language = languageCode(info.Language ?? null);
  const lines = pages.map((items, i) => itemsToLines(items, i + 1));
  const blank = lines.filter((l) => !l.length).length;
  if (blank === pages.length && pages.length) {
    m.warnings.push(
      "This PDF has no text layer; it looks like scanned images. Run it through OCR first, then import it again.",
    );
  } else if (blank) {
    m.warnings.push(
      `${blank} of ${pages.length} pages had no text layer (scanned images or blank pages); any text on them is missing.`,
    );
  }
  const blocks = linesToBlocks(stripFurniture(lines));
  const { sections, firstHeading } = blocksToSections(blocks, { ...opts, fallbackTitle: m.title ?? "Opening" });
  m.title ??= firstHeading;
  m.sections = sections;
  return finishManuscript(m);
}

export async function parsePdf(bytes: Uint8Array, opts: ParseOptions = {}): Promise<Manuscript> {
  const { getDocumentProxy, extractTextItems, getMeta } = await import("unpdf");
  let pdf;
  try {
    // pdf.js may transfer the buffer; hand it a copy.
    pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 } as never);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/password/i.test(msg)) throw new Error("This PDF is password-protected. Remove the password and try again.");
    throw new Error("This PDF could not be opened; the file may be damaged.");
  }
  try {
    const [{ items }, meta] = await Promise.all([
      extractTextItems(pdf),
      getMeta(pdf).catch(() => ({ info: {} as Record<string, unknown> })),
    ]);
    const info = meta.info as { Title?: string; Author?: string; Subject?: string; Language?: string | null };
    return manuscriptFromPdfPages(items as PdfItem[][], info, opts);
  } finally {
    await pdf.loadingTask.destroy().catch(() => {});
  }
}
