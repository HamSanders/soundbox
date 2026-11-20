/**
 * OpenDocument Text (.odt), as written by LibreOffice and others.
 *
 * `content.xml` holds the body: `text:h` (with `text:outline-level`) are
 * headings, `text:p` paragraphs, list items' paragraphs are paragraphs too.
 * Notes (`text:note`), tables, frames, tracked deletions and the table of
 * contents are skipped. A paragraph in the "Title"/"Subtitle" style feeds
 * metadata, and `meta.xml` gives title, author, language and description.
 *
 * Spec: OASIS OpenDocument 1.3, part 3 (schema), §5 (text content).
 */

import type { Element } from "domhandler";
import { unzipSync } from "fflate";
import { DomUtils } from "htmlparser2";

import type { Manuscript } from "../types.js";
import { parseHtmlDocument } from "./html.js";
import { blocksToSections, emptyManuscript, finishManuscript, type Block, type ParseOptions } from "./manuscript.js";
import { languageCode } from "./plain.js";
import { normaliseWhitespace } from "./text.js";

const decoder = new TextDecoder("utf-8");

/** Elements whose text is never read: notes, tables, drawings, change records, TOC. */
const SKIP = new Set([
  "text:note", "text:tracked-changes", "text:deletion", "table:table", "draw:frame", "draw:custom-shape",
  "text:table-of-content", "text:alphabetical-index", "text:bibliography", "office:annotation",
  "text:sequence-decls", "office:forms",
]);

function inlineText(el: Element): string {
  let out = "";
  const walk = (nodes: Element["children"]) => {
    for (const n of nodes) {
      if (n.type === "text") {
        out += (n as unknown as { data: string }).data;
        continue;
      }
      if (n.type !== "tag") continue;
      const e = n as Element;
      if (SKIP.has(e.name)) continue;
      if (e.name === "text:s") out += " ".repeat(Math.max(1, Number(e.attribs["text:c"] ?? 1)));
      else if (e.name === "text:tab" || e.name === "text:line-break") out += " ";
      else walk(e.children);
    }
  };
  walk(el.children);
  return normaliseWhitespace(out);
}

export function parseOdt(bytes: Uint8Array, opts: ParseOptions = {}): Manuscript {
  const m = emptyManuscript();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("This OpenDocument file could not be opened; it may be damaged.");
  }
  const read = (name: string) => (files[name] ? decoder.decode(files[name]) : null);
  const content = read("content.xml");
  if (!content) throw new Error("This file has no OpenDocument body (content.xml).");
  if (read("META-INF/manifest.xml")?.includes("manifest:encryption-data")) {
    throw new Error("This document is password-protected. Save it without a password and import it again.");
  }

  const meta = read("meta.xml");
  if (meta) {
    const doc = parseHtmlDocument(meta, true);
    const get = (...tags: string[]) => {
      for (const tag of tags) {
        const el = DomUtils.getElementsByTagName(tag, doc, true, 1)[0];
        const v = el ? normaliseWhitespace(DomUtils.textContent(el)) : "";
        if (v) return v;
      }
      return null;
    };
    m.title = get("dc:title");
    m.author = get("dc:creator", "meta:initial-creator");
    m.language = languageCode(get("dc:language"));
    m.description = get("dc:description", "dc:subject");
  }

  const doc = parseHtmlDocument(content, true);
  const body = DomUtils.getElementsByTagName("office:text", doc, true, 1)[0];
  if (!body) throw new Error("This OpenDocument file has no text body; is it a spreadsheet or presentation?");

  const blocks: Block[] = [];
  let sawTable = false;
  const walk = (nodes: Element["children"]) => {
    for (const n of nodes) {
      if (n.type !== "tag") continue;
      const el = n as Element;
      if (el.name === "table:table") {
        sawTable = true;
        continue;
      }
      if (SKIP.has(el.name)) continue;
      if (el.name === "text:h") {
        const text = inlineText(el);
        if (text) blocks.push({ type: "heading", level: Math.max(1, Number(el.attribs["text:outline-level"] ?? 1)), text });
      } else if (el.name === "text:p") {
        const text = inlineText(el);
        if (!text) continue;
        const style = (el.attribs["text:style-name"] ?? "").toLowerCase();
        if (style === "title") m.title ??= text;
        else if (style === "subtitle") m.subtitle ??= text;
        else blocks.push({ type: "para", text });
      } else {
        // Sections, lists, list items and other containers: descend.
        walk(el.children);
      }
    }
  };
  walk(body.children);
  if (sawTable) m.warnings.push("Tables were skipped; their text is not in the book.");
  if (!blocks.some((b) => b.type === "heading")) {
    m.warnings.push("No headings were found, so the document is one section. Split it on the review screen.");
  }
  const { sections, firstHeading } = blocksToSections(blocks, { ...opts, fallbackTitle: m.title ?? "Opening" });
  m.title ??= firstHeading;
  m.sections = sections;
  return finishManuscript(m);
}
