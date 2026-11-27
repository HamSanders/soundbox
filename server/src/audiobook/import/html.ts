/**
 * HTML to blocks, for EPUB chapters, `.html` files and web pages.
 *
 * `htmlToBlocks` walks a document (or a subtree) and emits headings and
 * paragraphs. `mainContent` is a readability-style pick of a web page's
 * article: the `<article>`/`<main>` element when it holds most of the text,
 * otherwise the container whose paragraphs score highest after discounting
 * link-heavy boilerplate.
 */

import type { ChildNode, Document, Element } from "domhandler";
import { DomUtils, parseDocument } from "htmlparser2";

import type { Manuscript } from "../types.js";
import { blocksToSections, emptyManuscript, finishManuscript, type Block, type ParseOptions } from "./manuscript.js";
import { languageCode } from "./plain.js";
import { SCENE_BREAK } from "./text.js";

/** Elements whose text is never narration. */
const SKIP = new Set([
  "script", "style", "noscript", "template", "svg", "math", "head", "nav", "form",
  "button", "select", "textarea", "iframe", "object", "video", "audio", "canvas", "img",
  "figure", "table", "pre", "code",
]);

/** Elements that end a paragraph. */
const BLOCK = new Set([
  "p", "div", "section", "article", "main", "blockquote", "li", "ul", "ol", "dl", "dd", "dt",
  "header", "footer", "aside", "body", "html", "hr", "address", "center", "figcaption",
  "h1", "h2", "h3", "h4", "h5", "h6", "tr", "td", "th",
]);

export function parseHtmlDocument(html: string, xml = false): Document {
  return parseDocument(html, { xmlMode: xml, decodeEntities: true, lowerCaseTags: !xml });
}

function attr(el: Element, name: string): string {
  return el.attribs[name] ?? "";
}

/** Footnote references, page-break markers and similar: dropped with their text. */
function isNoise(el: Element): boolean {
  const type = `${attr(el, "epub:type")} ${attr(el, "role")}`.toLowerCase();
  if (/\b(?:noteref|pagebreak|doc-noteref|doc-pagebreak|doc-backlink)\b/.test(type)) return true;
  if (/\b(?:footnotes?|endnotes?|rearnotes?|doc-endnotes|doc-footnotes)\b/.test(type)) return true;
  if (attr(el, "aria-hidden") === "true" || "hidden" in el.attribs) return true;
  const style = attr(el, "style").replace(/\s+/g, "");
  if (/display:none|visibility:hidden/i.test(style)) return true;
  if (el.name === "sup") {
    // A superscript holding only a link or a short number is a note marker.
    const text = DomUtils.textContent(el).trim();
    if (/^[\[(]?(?:\d{1,3}|[a-z*†‡§])[\])]?$/i.test(text)) return true;
  }
  if (el.name === "a" && /^#/.test(attr(el, "href"))) {
    const text = DomUtils.textContent(el).trim();
    if (/^[\[(]?\d{1,3}[\])]?$/.test(text)) return true;
  }
  return false;
}

/** Walk `root` and emit blocks. */
export function htmlToBlocks(root: Document | Element | ChildNode[]): Block[] {
  const blocks: Block[] = [];
  let text = "";
  const flush = () => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t) blocks.push({ type: "para", text: t });
    text = "";
  };
  const walk = (nodes: ChildNode[]) => {
    for (const node of nodes) {
      if (node.type === "text") {
        text += (node as unknown as { data: string }).data;
        continue;
      }
      if (node.type !== "tag" && node.type !== "script" && node.type !== "style") continue;
      const el = node as Element;
      const name = el.name.toLowerCase().replace(/^[a-z]+:/, "");
      if (SKIP.has(name) || isNoise(el)) continue;
      const heading = /^h([1-6])$/.exec(name);
      if (heading) {
        flush();
        const t = DomUtils.textContent(el).replace(/\s+/g, " ").trim();
        if (t) blocks.push({ type: "heading", level: Number(heading[1]), text: t });
        continue;
      }
      if (name === "br") {
        text += "\n";
        continue;
      }
      if (name === "hr") {
        // A horizontal rule between paragraphs is a scene break.
        flush();
        blocks.push({ type: "para", text: SCENE_BREAK });
        continue;
      }
      if (BLOCK.has(name)) {
        flush();
        walk(el.children);
        flush();
      } else {
        walk(el.children);
      }
    }
  };
  walk(Array.isArray(root) ? root : root.children);
  flush();
  return blocks;
}

/* ------------------------------------------------------- main content */

const BOILERPLATE =
  /\b(?:comment|sidebar|footer|foot|nav|menu|share|social|related|advert|ad-|ads|promo|cookie|banner|breadcrumb|subscribe|newsletter|masthead|popup|modal|widget|signup|byline-share)\b/i;

function textLength(el: Element): number {
  return DomUtils.textContent(el).replace(/\s+/g, " ").trim().length;
}

function linkDensity(el: Element): number {
  const total = textLength(el);
  if (!total) return 1;
  const links = DomUtils.getElementsByTagName("a", el, true).reduce((n, a) => n + textLength(a), 0);
  return links / total;
}

/** Remove chrome (nav, header, footer, asides, boilerplate-classed blocks). */
function stripChrome(doc: Document): void {
  const doomed = DomUtils.findAll((el) => {
    const n = el.name.toLowerCase();
    if (n === "nav" || n === "aside" || n === "footer" || n === "form") return true;
    if (n === "header") {
      // A page header (site banner) goes; an article's own header, with its
      // title heading and few links, stays.
      return !DomUtils.findOne((h) => /^h[1-3]$/.test(h.name), el.children, true) || linkDensity(el) > 0.5;
    }
    if (n === "body" || n === "html" || n === "article" || n === "main") return false;
    const marker = `${attr(el, "class")} ${attr(el, "id")} ${attr(el, "role")}`;
    return BOILERPLATE.test(marker) && linkDensity(el) > 0.25;
  }, doc.children);
  for (const el of doomed) DomUtils.removeElement(el);
}

/** The element holding a page's main text. */
export function mainContent(doc: Document): Element | Document {
  stripChrome(doc);
  const body = DomUtils.findOne((el) => el.name === "body", doc.children, true) ?? doc;
  const total = body.type === "root" ? DomUtils.textContent(body).length : textLength(body as Element);
  const explicit = DomUtils.findAll(
    (el) => el.name === "article" || el.name === "main" || attr(el, "role") === "main" || attr(el, "itemprop") === "articleBody",
    doc.children,
  ).sort((a, b) => textLength(b) - textLength(a))[0];
  if (explicit && textLength(explicit) >= total * 0.4) return explicit;

  // Score containers by the paragraphs they hold.
  const scores = new Map<Element, number>();
  for (const p of DomUtils.getElementsByTagName("p", doc, true)) {
    const len = textLength(p);
    if (len < 25) continue;
    const score = 1 + Math.min(len / 100, 3) + (DomUtils.textContent(p).match(/,/g)?.length ?? 0);
    const parent = p.parent as Element | null;
    if (parent && parent.type === "tag") scores.set(parent, (scores.get(parent) ?? 0) + score);
    const grand = parent?.parent as Element | null;
    if (grand && grand.type === "tag") scores.set(grand, (scores.get(grand) ?? 0) + score / 2);
  }
  let best: Element | null = null;
  let bestScore = 0;
  for (const [el, score] of scores) {
    const adjusted = score * (1 - linkDensity(el));
    if (adjusted > bestScore) {
      best = el;
      bestScore = adjusted;
    }
  }
  if (!best) return body;
  // A book saved as HTML keeps each chapter in its own container; climb to
  // the ancestor holding all of them, as long as it isn't link-heavy.
  const proseLength = (el: Element) =>
    DomUtils.getElementsByTagName("p", el, true).reduce((n, p) => {
      const len = textLength(p);
      return len >= 25 ? n + len : n;
    }, 0);
  for (;;) {
    const parent = best.parent;
    if (!parent || parent.type !== "tag") break;
    const up = parent as Element;
    if (proseLength(up) < proseLength(best) * 1.3 || linkDensity(up) > 0.35) break;
    best = up;
  }
  return best;
}

/* ------------------------------------------------------------ metadata */

function metaContent(doc: Document, ...keys: string[]): string | null {
  for (const key of keys) {
    const el = DomUtils.findOne(
      (e) => e.name === "meta" && (attr(e, "name").toLowerCase() === key || attr(e, "property").toLowerCase() === key),
      doc.children,
      true,
    );
    const v = el ? attr(el, "content").trim() : "";
    if (v) return v;
  }
  return null;
}

export function htmlTitle(doc: Document): string | null {
  const og = metaContent(doc, "og:title", "twitter:title");
  if (og) return og;
  const t = DomUtils.findOne((e) => e.name === "title", doc.children, true);
  const text = t ? DomUtils.textContent(t).trim() : "";
  // "Article title | Site name" → "Article title".
  return text ? text.split(/\s+[|–—·]\s+/)[0]!.trim() || text : null;
}

/** An HTML document or web page as a manuscript. */
export function parseHtml(
  html: string,
  opts: ParseOptions & { extractMain?: boolean; titleHint?: string | null } = {},
): Manuscript {
  const m = emptyManuscript();
  const doc = parseHtmlDocument(html);
  m.title = htmlTitle(doc);
  m.author = metaContent(doc, "author", "article:author", "dc.creator", "book:author");
  m.description = metaContent(doc, "description", "og:description");
  m.publisher = metaContent(doc, "og:site_name", "dc.publisher");
  m.publication_date = metaContent(doc, "article:published_time", "dc.date", "date")?.slice(0, 10) ?? null;
  const htmlEl = DomUtils.findOne((e) => e.name === "html", doc.children, false);
  m.language = languageCode(htmlEl ? attr(htmlEl, "lang") || attr(htmlEl, "xml:lang") : null);
  const root = opts.extractMain ? mainContent(doc) : doc;
  const blocks = htmlToBlocks(root);
  // A leading heading identical to the page title is the title, not a chapter.
  const first = blocks[0];
  if (first?.type === "heading" && m.title && first.text.toLowerCase() === m.title.toLowerCase()) {
    const secondLevel = blocks.slice(1).find((b) => b.type === "heading");
    if (!secondLevel || (secondLevel.type === "heading" && secondLevel.level <= first.level)) blocks.shift();
  }
  const { sections, firstHeading } = blocksToSections(blocks, { ...opts, fallbackTitle: m.title ?? opts.titleHint ?? "Opening" });
  m.title ??= firstHeading ?? opts.titleHint ?? null;
  m.sections = sections;
  return finishManuscript(m);
}
