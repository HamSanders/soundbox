/**
 * Word documents (.docx, Office Open XML).
 *
 * Reads `word/document.xml` paragraph by paragraph. A paragraph is a heading
 * when its style is a heading style ("Heading 1", "heading 2", localised
 * style ids resolved through `word/styles.xml`) or carries an outline level;
 * the "Title" and "Subtitle" styles feed metadata. Deleted revisions,
 * footnote references, field codes and tables are skipped.
 * Metadata comes from `docProps/core.xml` (Dublin Core).
 *
 * Spec: ECMA-376 Part 1, §17 (WordprocessingML).
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

interface StyleInfo {
  name: string;
  basedOn: string | null;
  outline: number | null;
}

function child(el: Element, name: string): Element | undefined {
  return el.children.find((c): c is Element => c.type === "tag" && c.name === name);
}

function readStyles(xml: string | null): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>();
  if (!xml) return styles;
  const doc = parseHtmlDocument(xml, true);
  for (const s of DomUtils.getElementsByTagName("w:style", doc, true)) {
    const id = s.attribs["w:styleId"];
    if (!id) continue;
    const ppr = child(s, "w:pPr");
    const lvl = ppr ? child(ppr, "w:outlineLvl")?.attribs["w:val"] : undefined;
    styles.set(id, {
      name: (child(s, "w:name")?.attribs["w:val"] ?? id).toLowerCase(),
      basedOn: child(s, "w:basedOn")?.attribs["w:val"] ?? null,
      outline: lvl !== undefined ? Number(lvl) : null,
    });
  }
  return styles;
}

/** "heading" level (1-based), "title", "subtitle" or null for body text. */
function styleRole(id: string | null, styles: Map<string, StyleInfo>): number | "title" | "subtitle" | null {
  let current = id;
  for (let depth = 0; current && depth < 10; depth++) {
    const info = styles.get(current);
    const name = info?.name ?? current.toLowerCase();
    if (name === "title") return "title";
    if (name === "subtitle") return "subtitle";
    const m = /^heading\s*(\d)$/.exec(name);
    if (m) return Number(m[1]);
    if (info?.outline !== null && info?.outline !== undefined && info.outline < 9) return info.outline + 1;
    current = info?.basedOn ?? null;
  }
  return null;
}

/** The text of a `w:p`, skipping deletions, field instructions and notes. */
function paragraphText(p: Element): string {
  let out = "";
  const walk = (nodes: Element["children"]) => {
    for (const n of nodes) {
      if (n.type !== "tag") continue;
      const el = n as Element;
      switch (el.name) {
        case "w:t":
          out += DomUtils.textContent(el);
          break;
        case "w:tab":
          out += " ";
          break;
        case "w:br":
        case "w:cr":
          out += " ";
          break;
        case "w:noBreakHyphen":
          out += "-";
          break;
        case "w:del":
        case "w:instrText":
        case "w:footnoteReference":
        case "w:endnoteReference":
        case "w:commentReference":
        case "w:pPr":
        case "w:rPr":
          break;
        default:
          walk(el.children);
      }
    }
  };
  walk(p.children);
  return normaliseWhitespace(out);
}

export function parseDocx(bytes: Uint8Array, opts: ParseOptions = {}): Manuscript {
  const m = emptyManuscript();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("This Word document could not be opened; the file may be damaged.");
  }
  const read = (name: string) => (files[name] ? decoder.decode(files[name]) : null);
  const documentXml = read("word/document.xml");
  if (!documentXml) throw new Error("This file has no Word document body (word/document.xml).");
  const styles = readStyles(read("word/styles.xml"));

  const core = read("docProps/core.xml");
  if (core) {
    const doc = parseHtmlDocument(core, true);
    const get = (tag: string) => {
      const el = DomUtils.getElementsByTagName(tag, doc, true, 1)[0];
      return el ? normaliseWhitespace(DomUtils.textContent(el)) || null : null;
    };
    m.title = get("dc:title");
    m.author = get("dc:creator");
    m.language = languageCode(get("dc:language"));
    m.description = get("dc:description") ?? get("dc:subject");
  }

  const doc = parseHtmlDocument(documentXml, true);
  const body = DomUtils.getElementsByTagName("w:body", doc, true, 1)[0];
  if (!body) throw new Error("This Word document has no body.");
  const blocks: Block[] = [];
  let sawTable = false;
  for (const node of body.children) {
    if (node.type !== "tag") continue;
    const el = node as Element;
    if (el.name === "w:tbl") {
      sawTable = true;
      continue;
    }
    // Paragraphs can sit inside content controls (w:sdt).
    const paragraphs = el.name === "w:p" ? [el] : DomUtils.getElementsByTagName("w:p", el, true);
    for (const p of paragraphs) {
      const text = paragraphText(p);
      if (!text) continue;
      const ppr = child(p, "w:pPr");
      const styleId = ppr ? child(ppr, "w:pStyle")?.attribs["w:val"] ?? null : null;
      const outline = ppr ? child(ppr, "w:outlineLvl")?.attribs["w:val"] : undefined;
      let role = styleRole(styleId, styles);
      if (role === null && outline !== undefined && Number(outline) < 9) role = Number(outline) + 1;
      if (role === "title") {
        m.title ??= text;
        continue;
      }
      if (role === "subtitle") {
        m.subtitle ??= text;
        continue;
      }
      if (typeof role === "number") blocks.push({ type: "heading", level: role, text });
      else blocks.push({ type: "para", text });
    }
  }
  if (sawTable) m.warnings.push("Tables were skipped; their text is not in the book.");
  if (!blocks.some((b) => b.type === "heading")) {
    m.warnings.push("No Heading styles were found, so the document is one section. Split it on the review screen.");
  }
  const { sections, firstHeading } = blocksToSections(blocks, { ...opts, fallbackTitle: m.title ?? "Opening" });
  m.title ??= firstHeading;
  m.sections = sections;
  return finishManuscript(m);
}
