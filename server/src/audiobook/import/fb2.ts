/**
 * FictionBook 2 (.fb2, and .fb2.zip), common for Russian and East European
 * e-books.
 *
 * An FB2 file is one XML document:
 *  - `<description><title-info>`: book-title, author (first/middle/last
 *    name), annotation, lang, coverpage → `<binary>`;
 *  - `<publish-info>`: publisher, year, isbn;
 *  - `<body>`: nested `<section>`s, each with an optional `<title>`, then
 *    `<p>`, `<subtitle>`, `<poem>` (stanzas of `<v>` lines), `<cite>`,
 *    `<epigraph>`, `<empty-line/>`;
 *  - a second `<body name="notes">` holds footnotes (skipped) and `<binary>`
 *    elements hold base64 images.
 * The XML prolog often declares windows-1251, so bytes are decoded by it.
 *
 * Reference: FictionBook 2.0 schema (FictionBook.xsd), https://github.com/gribuser/fb2
 */

import type { Element } from "domhandler";
import { unzipSync } from "fflate";
import { DomUtils } from "htmlparser2";

import type { Manuscript, ManuscriptSection } from "../types.js";
import { decodeBytes } from "./encoding.js";
import { parseHtmlDocument } from "./html.js";
import { emptyManuscript, finishManuscript, makeSection, type ParseOptions } from "./manuscript.js";
import { languageCode } from "./plain.js";
import { normaliseWhitespace } from "./text.js";

const local = (el: Element) => el.name.toLowerCase().replace(/^[^:]+:/, "");
const kids = (el: Element) => el.children.filter((c): c is Element => c.type === "tag");
const child = (el: Element | undefined, name: string) => (el ? kids(el).find((c) => local(c) === name) : undefined);
const text = (el: Element | undefined) => (el ? normaliseWhitespace(DomUtils.textContent(el)) : "");

/** The XML text of an FB2 file: unzipped if zipped, decoded per its prolog. */
export function fb2Xml(bytes: Uint8Array): string {
  let data = bytes;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes);
    const name = Object.keys(files).find((n) => n.toLowerCase().endsWith(".fb2"));
    if (!name) throw new Error("This archive has no .fb2 file in it.");
    data = files[name]!;
  }
  const head = new TextDecoder("latin1").decode(data.subarray(0, 200));
  const declared = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1] ?? null;
  return decodeBytes(data, declared);
}

/** One `<section>` (or a body) into sections: its own text, then its children. */
function walkSection(el: Element, depth: number, out: { title: string; raw: string[]; depth: number }[]): void {
  const titleEl = child(el, "title");
  const title = titleEl ? kids(titleEl).map(text).filter(Boolean).join(": ") || text(titleEl) : "";
  const current = { title, raw: [] as string[], depth };
  out.push(current);
  for (const c of kids(el)) {
    switch (local(c)) {
      case "title":
      case "image":
      case "annotation":
        break;
      case "section":
        walkSection(c, depth + 1, out);
        break;
      case "poem":
        // Stanzas become paragraphs; lines join with " / " so a reader hears the breaks.
        for (const stanza of DomUtils.findAll((e) => local(e) === "stanza", [c])) {
          const lines = kids(stanza).filter((v) => local(v) === "v").map(text).filter(Boolean);
          if (lines.length) current.raw.push(lines.join(" / "));
        }
        break;
      case "epigraph":
      case "cite":
        for (const p of kids(c)) {
          const t = text(p);
          if (t) current.raw.push(t);
        }
        break;
      default: {
        // p, subtitle, empty-line, table…
        if (local(c) === "table") break;
        const t = text(c);
        if (t) current.raw.push(t);
      }
    }
  }
}

export function parseFb2(bytes: Uint8Array, opts: ParseOptions = {}): Manuscript {
  const m = emptyManuscript();
  const doc = parseHtmlDocument(fb2Xml(bytes), true);
  const root = DomUtils.findOne((e) => local(e) === "fictionbook", doc.children, false);
  if (!root) throw new Error("This file isn't a FictionBook (FB2) document.");

  const desc = child(root, "description");
  const info = child(desc, "title-info");
  const publish = child(desc, "publish-info");
  m.title = text(child(info, "book-title")) || null;
  const authors = info
    ? kids(info)
        .filter((a) => local(a) === "author")
        .map((a) =>
          ["first-name", "middle-name", "last-name"].map((n) => text(child(a, n))).filter(Boolean).join(" ") ||
          text(child(a, "nickname")),
        )
        .filter(Boolean)
    : [];
  m.author = authors.join(", ") || null;
  m.language = languageCode(text(child(info, "lang")) || null);
  m.description = text(child(info, "annotation")) || null;
  m.publisher = text(child(publish, "publisher")) || null;
  m.isbn = text(child(publish, "isbn")).replace(/[- ]/g, "") || null;
  const year = text(child(publish, "year")) || text(child(info, "date"));
  m.publication_date = /\d{4}/.exec(year)?.[0] ?? null;

  // Cover: coverpage → <image l:href="#id"> → <binary id="id">.
  const coverRef = child(child(info, "coverpage"), "image");
  const href = coverRef ? Object.entries(coverRef.attribs).find(([k]) => /(^|:)href$/.test(k))?.[1] : undefined;
  if (href?.startsWith("#")) {
    const bin = kids(root).find((b) => local(b) === "binary" && b.attribs.id === href.slice(1));
    if (bin) {
      try {
        const data = Buffer.from(DomUtils.textContent(bin).replace(/\s+/g, ""), "base64");
        if (data.length) m.cover = { bytes: new Uint8Array(data), mime: bin.attribs["content-type"] ?? "image/jpeg" };
      } catch {
        /* a broken cover isn't worth failing the import over */
      }
    }
  }

  // Main bodies only; notes and comments bodies are footnotes.
  const bodies = kids(root).filter((b) => local(b) === "body" && !/^(?:notes|comments|footnotes)$/i.test(b.attribs.name ?? ""));
  const flat: { title: string; raw: string[]; depth: number }[] = [];
  for (const body of bodies) {
    // The body's own title is the book's title page; its text before the
    // first section (often an epigraph) is front matter.
    walkSection(body, 0, flat);
    const top = flat.find((s) => s.depth === 0);
    if (top && !top.raw.length) top.title = "";
  }
  const sections: ManuscriptSection[] = [];
  for (const s of flat) {
    if (!s.raw.length) continue;
    // A part with only a title ("Part One") and no text of its own is
    // dropped; its chapters keep their own titles.
    const section = makeSection(s.title || (s.depth === 0 ? "Opening" : "Untitled"), s.raw, opts);
    if (section) sections.push(section);
  }
  m.sections = sections;
  return finishManuscript(m);
}
