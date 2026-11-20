/**
 * EPUB 2 and 3.
 *
 * - `META-INF/container.xml` names the package document (OPF).
 * - OPF `<metadata>`: Dublin Core title, creator, language, identifier (ISBN),
 *   publisher, date and description; EPUB 3 `refines` for a subtitle.
 * - OPF `<spine>` gives reading order; the manifest maps ids to files.
 * - Chapter titles come from the EPUB 3 nav document (`epub:type="toc"`) or
 *   the EPUB 2 NCX. A TOC entry with a fragment (`ch.xhtml#c3`) starts a
 *   section at that anchor, so several chapters in one file split correctly.
 * - Cover: the `cover-image` manifest property (EPUB 3), the
 *   `<meta name="cover">` item (EPUB 2), or an image item named "cover".
 *
 * Spec: https://www.w3.org/TR/epub-33/
 */

import { posix } from "node:path";

import type { Document, Element } from "domhandler";
import { unzipSync } from "fflate";
import { DomUtils } from "htmlparser2";

import type { Manuscript, ManuscriptSection } from "../types.js";
import { parseHtmlDocument, htmlToBlocks } from "./html.js";
import { blocksToSections, emptyManuscript, finishManuscript, makeSection, type Block, type ParseOptions } from "./manuscript.js";
import { languageCode } from "./plain.js";
import { normaliseWhitespace } from "./text.js";

const decoder = new TextDecoder("utf-8");

interface ManifestItem {
  id: string;
  href: string; // resolved, zip-relative
  mediaType: string;
  properties: string[];
}

interface TocEntry {
  file: string;
  fragment: string | null;
  title: string;
}

class Zip {
  private readonly files: Record<string, Uint8Array>;
  private readonly lower = new Map<string, string>();

  constructor(bytes: Uint8Array) {
    this.files = unzipSync(bytes);
    for (const name of Object.keys(this.files)) this.lower.set(name.toLowerCase(), name);
  }

  names(): string[] {
    return Object.keys(this.files);
  }

  get(path: string): Uint8Array | null {
    return this.files[path] ?? this.files[this.lower.get(path.toLowerCase()) ?? ""] ?? null;
  }

  text(path: string): string | null {
    const b = this.get(path);
    return b ? decoder.decode(b) : null;
  }
}

/** Local name of a possibly prefixed tag ("dc:title" → "title"). */
function local(el: Element): string {
  return el.name.toLowerCase().replace(/^[^:]+:/, "");
}

function findAllLocal(name: string, root: Document | Element): Element[] {
  return DomUtils.findAll((el) => local(el) === name, root.children);
}

function text(el: Element | undefined | null): string {
  return el ? normaliseWhitespace(DomUtils.textContent(el)) : "";
}

function resolveHref(base: string, href: string): { file: string; fragment: string | null } {
  const [path, fragment] = href.split("#", 2) as [string, string | undefined];
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    /* keep it as written */
  }
  const file = decoded ? posix.normalize(posix.join(posix.dirname(base), decoded)) : base;
  return { file: file.replace(/^\.\//, ""), fragment: fragment || null };
}

function readIsbn(identifiers: Element[]): string | null {
  for (const el of identifiers) {
    const scheme = (el.attribs["opf:scheme"] ?? el.attribs["scheme"] ?? "").toLowerCase();
    const value = text(el);
    const m = /(?:urn:isbn:|isbn[:\s]*)?((?:97[89][- ]?)?\d[\d -]{8,}[\dXx])/i.exec(value);
    if (scheme === "isbn" || /isbn/i.test(value)) return m ? m[1]!.replace(/[- ]/g, "") : value;
    if (m && /^(?:97[89])?\d{9}[\dXx]$/.test(m[1]!.replace(/[- ]/g, "")) && value.replace(/[- ]/g, "").length <= 17) {
      return m[1]!.replace(/[- ]/g, "");
    }
  }
  return null;
}

/** EPUB 3 nav document: `<nav epub:type="toc">` → ordered entries. */
function navToc(zip: Zip, navPath: string): TocEntry[] {
  const html = zip.text(navPath);
  if (!html) return [];
  const doc = parseHtmlDocument(html);
  const navs = DomUtils.findAll((el) => local(el) === "nav", doc.children);
  const toc =
    navs.find((n) => /\btoc\b/.test(n.attribs["epub:type"] ?? "") || /\bdoc-toc\b/.test(n.attribs["role"] ?? "")) ??
    navs[0];
  if (!toc) return [];
  return DomUtils.findAll((el) => local(el) === "a" && !!el.attribs.href, toc.children)
    .map((a) => ({ ...resolveHref(navPath, a.attribs.href!), title: text(a) }))
    .filter((e) => e.title);
}

/** EPUB 2 NCX: `<navPoint>` in document order. */
function ncxToc(zip: Zip, ncxPath: string): TocEntry[] {
  const xml = zip.text(ncxPath);
  if (!xml) return [];
  const doc = parseHtmlDocument(xml, true);
  return findAllLocal("navpoint", doc).flatMap((np) => {
    const label = np.children.find((c): c is Element => c.type === "tag" && local(c) === "navlabel");
    const content = np.children.find((c): c is Element => c.type === "tag" && local(c) === "content");
    const src = content?.attribs.src;
    const title = label ? text(label) : "";
    return src && title ? [{ ...resolveHref(ncxPath, src), title }] : [];
  });
}

/** Blocks for one spine document, with an anchor marker wherever an element
 *  carries an id that a TOC entry points at. */
function fileBlocks(html: string, anchors: Set<string>): (Block | { type: "anchor"; id: string })[] {
  const doc = parseHtmlDocument(html);
  if (anchors.size) {
    // Insert a marker element before every anchored element; htmlToBlocks
    // skips unknown empty tags, so the markers are found by a second walk.
    for (const el of DomUtils.findAll((e) => anchors.has(e.attribs.id ?? "") || anchors.has(e.attribs.name ?? ""), doc.children)) {
      const marker = parseHtmlDocument(`<mirli-anchor data-id="${encodeURIComponent(el.attribs.id ?? el.attribs.name!)}"></mirli-anchor>`).children[0] as Element;
      DomUtils.prepend(el, marker);
    }
  }
  const out: (Block | { type: "anchor"; id: string })[] = [];
  const body = DomUtils.findOne((e) => local(e) === "body", doc.children, true) ?? doc;
  // Split the walk at markers: walk siblings in order, emitting anchors.
  const markers = DomUtils.findAll((e) => e.name === "mirli-anchor", body.children);
  if (!markers.length) return htmlToBlocks(body);
  const ids = new Map(markers.map((m) => [m, decodeURIComponent(m.attribs["data-id"] ?? "")]));
  // Replace each marker by a heading-less sentinel paragraph, then map back.
  for (const m of markers) {
    m.name = "p";
    m.children = [];
    DomUtils.appendChild(m, parseHtmlDocument(`⁣ANCHOR:${ids.get(m)}⁣`).children[0]!);
  }
  for (const b of htmlToBlocks(body)) {
    const a = b.type === "para" ? /^⁣ANCHOR:(.*)⁣$/.exec(b.text) : null;
    out.push(a ? { type: "anchor", id: a[1]! } : b);
  }
  return out;
}

/** A TOC label that is only a number ("IV", "12") is a weaker title than the
 *  chapter's own heading. */
function bareLabel(title: string): boolean {
  return /^(?:[IVXLCDM]+|\d{1,4})\.?$/i.test(title.trim());
}

export function parseEpub(bytes: Uint8Array, opts: ParseOptions = {}): Manuscript {
  const m = emptyManuscript();
  let zip: Zip;
  try {
    zip = new Zip(bytes);
  } catch {
    throw new Error("This EPUB could not be opened; the file may be damaged.");
  }
  const container = zip.text("META-INF/container.xml");
  const rootPath = container
    ? /full-path\s*=\s*["']([^"']+)["']/.exec(container)?.[1]
    : undefined;
  const opfPath = rootPath ?? zip.names().find((n) => n.toLowerCase().endsWith(".opf"));
  const opfXml = opfPath ? zip.text(opfPath) : null;
  if (!opfPath || !opfXml) throw new Error("This EPUB has no package document (OPF).");
  if (zip.get("META-INF/encryption.xml") && /EncryptedData/.test(zip.text("META-INF/encryption.xml") ?? "")) {
    const enc = zip.text("META-INF/encryption.xml") ?? "";
    // Font obfuscation is harmless; anything else is DRM.
    if (/<(?:enc:)?CipherReference[^>]*URI="[^"]*\.(?:x?html?|xml)"/i.test(enc)) {
      throw new Error("This EPUB is DRM-protected, so its text can't be read.");
    }
  }
  const opf = parseHtmlDocument(opfXml, true);

  /* metadata */
  const metadata = findAllLocal("metadata", opf)[0];
  if (metadata) {
    const titles = findAllLocal("title", metadata);
    const subtitleId = findAllLocal("meta", metadata).find(
      (el) => el.attribs.property === "title-type" && text(el) === "subtitle",
    )?.attribs.refines?.replace(/^#/, "");
    const mainTitle = titles.find((t) => t.attribs.id !== subtitleId) ?? titles[0];
    m.title = text(mainTitle) || null;
    if (subtitleId) m.subtitle = text(titles.find((t) => t.attribs.id === subtitleId)) || null;
    const creators = findAllLocal("creator", metadata);
    const authors = creators.filter((c) => {
      const role = c.attribs["opf:role"] ?? findAllLocal("meta", metadata).find(
        (meta) => meta.attribs.property === "role" && meta.attribs.refines === `#${c.attribs.id}`,
      )?.children.map((n) => (n as unknown as { data?: string }).data ?? "").join("").trim();
      return !role || role === "aut";
    });
    m.author = authors.map((a) => text(a)).filter(Boolean).join(", ") || null;
    m.language = languageCode(text(findAllLocal("language", metadata)[0]));
    m.publisher = text(findAllLocal("publisher", metadata)[0]) || null;
    const date = text(findAllLocal("date", metadata)[0]);
    m.publication_date = date ? date.slice(0, 10) : null;
    const desc = text(findAllLocal("description", metadata)[0]);
    // Descriptions are often escaped HTML.
    m.description = desc ? normaliseWhitespace(DomUtils.textContent(parseHtmlDocument(desc))) || null : null;
    m.isbn = readIsbn(findAllLocal("identifier", metadata));
  }

  /* manifest and spine */
  const manifest = new Map<string, ManifestItem>();
  for (const item of findAllLocal("item", opf)) {
    const id = item.attribs.id;
    const href = item.attribs.href;
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href: resolveHref(opfPath, href).file,
      mediaType: (item.attribs["media-type"] ?? "").toLowerCase(),
      properties: (item.attribs.properties ?? "").split(/\s+/).filter(Boolean),
    });
  }
  const spineEl = findAllLocal("spine", opf)[0];
  const spine = findAllLocal("itemref", opf)
    .map((ref) => ({ item: manifest.get(ref.attribs.idref ?? ""), linear: ref.attribs.linear !== "no" }))
    .filter((s): s is { item: ManifestItem; linear: boolean } => !!s.item && /html|xml/.test(s.item.mediaType));

  /* cover */
  const items = [...manifest.values()];
  const coverId = metadata ? findAllLocal("meta", metadata).find((el) => el.attribs.name === "cover")?.attribs.content : undefined;
  const coverItem =
    items.find((i) => i.properties.includes("cover-image")) ??
    (coverId ? manifest.get(coverId) : undefined) ??
    items.find((i) => i.mediaType.startsWith("image/") && /cover/i.test(`${i.id} ${i.href}`));
  if (coverItem && coverItem.mediaType.startsWith("image/")) {
    const b = zip.get(coverItem.href);
    if (b) m.cover = { bytes: b, mime: coverItem.mediaType };
  }

  /* table of contents */
  const navItem = items.find((i) => i.properties.includes("nav"));
  let toc = navItem ? navToc(zip, navItem.href) : [];
  if (!toc.length) {
    const ncx = manifest.get(spineEl?.attribs.toc ?? "") ?? items.find((i) => i.mediaType === "application/x-dtbncx+xml");
    if (ncx) toc = ncxToc(zip, ncx.href);
  }
  // The nav document itself, when it's in the spine, is the contents page.
  const navHref = navItem?.href ?? null;

  /* sections */
  const sections: ManuscriptSection[] = [];
  const spineFiles = new Set(spine.map((s) => s.item.href));
  const tocByFile = new Map<string, TocEntry[]>();
  for (const e of toc) {
    if (!spineFiles.has(e.file)) continue;
    const list = tocByFile.get(e.file) ?? [];
    // One section per anchor; repeated links to the same place keep the first title.
    if (!list.some((x) => x.fragment === e.fragment)) list.push(e);
    tocByFile.set(e.file, list);
  }

  let current: { title: string; raw: Block[]; linear: boolean; tocTitled: boolean } | null = null;
  const flush = () => {
    if (!current) return;
    const blocks = current.raw;
    // Leading headings repeat the title (core speaks the title itself).
    const leading: string[] = [];
    while (blocks[0]?.type === "heading") leading.push(blocks.shift()!.text);
    let title = current.title;
    // "CHAPTER I." + "The Ball" as two headings make one title. A TOC label
    // wins unless it is only a number.
    if (leading.length && (!current.tocTitled || !title || bareLabel(title))) title = leading.join(": ");
    const raw = blocks.map((b) => b.text);
    const section = makeSection(title || "Untitled", raw, opts);
    if (section) {
      if (!current.linear) section.included = false;
      sections.push(section);
    }
    current = null;
  };

  if (!toc.length) {
    m.warnings.push("This EPUB has no table of contents; chapters were split at headings.");
  }

  for (const { item, linear } of spine) {
    const html = zip.text(item.href);
    if (!html) {
      m.warnings.push(`A file listed in the spine is missing: ${item.href}`);
      continue;
    }
    const entries = tocByFile.get(item.href) ?? [];
    const anchors = new Set(entries.map((e) => e.fragment).filter((f): f is string => !!f));
    const blocks = fileBlocks(html, anchors);
    const isNav = item.href === navHref;

    if (!toc.length) {
      // No TOC: each file, split further at its own headings.
      flush();
      const split = blocksToSections(blocks.filter((b): b is Block => b.type !== "anchor"), { ...opts, fallbackTitle: "Untitled" });
      for (const s of split.sections) {
        if (!linear) s.included = false;
        sections.push(s);
      }
      continue;
    }

    const wholeFile = entries.find((e) => !e.fragment);
    const startsNew =
      !!wholeFile ||
      isNav ||
      current === null ||
      // A file the TOC skips but that opens with its own heading.
      (!entries.length && blocks.find((b) => b.type !== "anchor")?.type === "heading");
    if (startsNew) {
      flush();
      const firstHeading = blocks.find((b) => b.type === "heading") as Extract<Block, { type: "heading" }> | undefined;
      const title = isNav ? "Contents" : wholeFile?.title ?? firstHeading?.text ?? "";
      current = { title, raw: [], linear: linear && !isNav, tocTitled: !!wholeFile || isNav };
    }
    for (const b of blocks) {
      if (b.type === "anchor") {
        const entry = entries.find((e) => e.fragment === b.id);
        if (!entry) continue;
        // An anchor at the very top of a section that has no text yet just names it.
        if (current && current.raw.every((x) => x.type === "heading") && !current.tocTitled) {
          current.title = entry.title;
          current.tocTitled = true;
          continue;
        }
        flush();
        current = { title: entry.title, raw: [], linear, tocTitled: true };
        continue;
      }
      current!.raw.push(b);
    }
  }
  flush();

  m.sections = sections;
  if (!spine.length) m.warnings.push("This EPUB's spine lists no readable documents.");
  return finishManuscript(m);
}
