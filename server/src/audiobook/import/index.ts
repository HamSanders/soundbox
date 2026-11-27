/**
 * Manuscript import: any supported file in, a `Manuscript` out.
 *
 * Formats: EPUB, PDF, DOCX, ODT, RTF, FB2 (and .fb2.zip), TXT, Markdown,
 * HTML, pasted text, and web pages (through `url.ts`). The format is sniffed
 * from the bytes first and the file name second, so a mislabelled upload
 * still parses. Kindle files (MOBI/AZW/AZW3/KFX) are recognised and refused
 * with the reason: DRM, or not supported (see `drm.ts`).
 */

import type { Manuscript } from "../types.js";
import { parseDocx } from "./docx.js";
import { kindleMessage, sniffKindle } from "./drm.js";
import { decodeBytes } from "./encoding.js";
import { parseEpub } from "./epub.js";
import { parseFb2 } from "./fb2.js";
import { parseHtml } from "./html.js";
import type { ParseOptions } from "./manuscript.js";
import { parseOdt } from "./odt.js";
import { parsePdf } from "./pdf.js";
import { parsePlainText } from "./plain.js";
import { parseRtf } from "./rtf.js";

export type { ParseOptions } from "./manuscript.js";
export { DEFAULT_MAX_CHARS } from "./text.js";
export { splitManuscriptText, type SplitTextOptions } from "./split.js";

export type ManuscriptFormat = "epub" | "pdf" | "docx" | "odt" | "rtf" | "fb2" | "html" | "markdown" | "text";

export const SUPPORTED_EXTENSIONS = [
  ".epub", ".pdf", ".docx", ".odt", ".rtf", ".fb2", ".txt", ".md", ".markdown", ".html", ".htm", ".xhtml",
];

export class ImportError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

/** Text with its encoding guessed: BOMs, then strict UTF-8, then Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (startsWith(bytes, [0xff, 0xfe])) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (startsWith(bytes, [0xfe, 0xff])) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return decodeBytes(bytes);
}

function extension(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return m ? m[1]!.toLowerCase() : "";
}

export function detectFormat(bytes: Uint8Array, filename = "", contentType = ""): ManuscriptFormat {
  const ext = extension(filename);
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  const kindle = sniffKindle(bytes);
  if (kindle) throw new ImportError(415, kindleMessage(kindle));
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // ZIP. EPUB and ODF declare themselves in an uncompressed "mimetype" first entry.
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
    if (head.includes("application/epub+zip") || ext === "epub") return "epub";
    if (head.includes("application/vnd.oasis.opendocument.text") || ext === "odt") return "odt";
    if (head.includes("application/vnd.oasis.opendocument")) {
      throw new ImportError(415, "That OpenDocument file isn't a text document. Use a .odt file.");
    }
    if (ext === "docx" || head.includes("[Content_Types].xml") || head.includes("word/")) return "docx";
    if (/\.fb2\.zip$/i.test(filename) || /\.fb2/i.test(head)) return "fb2";
    if (/\.kfx/i.test(head)) throw new ImportError(415, kindleMessage({ kind: "kfx", encrypted: true }));
    throw new ImportError(415, "This archive isn't an EPUB, OpenDocument, Word or FB2 document.");
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    throw new ImportError(415, "Old Word (.doc) files aren't supported. Save it as .docx and import that.");
  }
  const head = decodeText(bytes.subarray(0, 2048)).trimStart().slice(0, 500);
  if (head.startsWith("{\\rtf")) return "rtf";
  if (/^(?:<\?xml[^>]*>\s*)?<FictionBook\b/.test(head) || ext === "fb2") return "fb2";
  if (ext === "md" || ext === "markdown" || contentType.includes("markdown")) return "markdown";
  if (ext === "html" || ext === "htm" || ext === "xhtml" || /html/.test(contentType)) return "html";
  if (ext === "txt" || contentType.startsWith("text/plain")) return "text";
  const lower = head.toLowerCase();
  if (lower.startsWith("<!doctype html") || lower.startsWith("<html") || /<(?:body|p|div|h1)[\s>]/.test(lower)) return "html";
  if (ext && !["txt", "text", ""].includes(ext) && /[\x00-\x08\x0e-\x1f]/.test(head)) {
    throw new ImportError(415, `.${ext} files aren't supported. Use EPUB, PDF, DOCX, ODT, RTF, FB2, TXT, Markdown or HTML.`);
  }
  if (/^#{1,6}\s/m.test(head)) return "markdown";
  return "text";
}

export interface ManuscriptInput {
  bytes: Uint8Array;
  filename?: string;
  contentType?: string;
}

function baseName(filename: string): string | null {
  const name = filename
    .replace(/^.*[\\/]/, "")
    .replace(/(?:\.fb2)?\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return name || null;
}

export async function parseManuscript(input: ManuscriptInput, opts: ParseOptions = {}): Promise<Manuscript> {
  if (!input.bytes.length) throw new ImportError(400, "The file is empty.");
  const format = detectFormat(input.bytes, input.filename, input.contentType);
  const titleHint = baseName(input.filename ?? "");
  let m: Manuscript;
  try {
    switch (format) {
      case "epub":
        m = parseEpub(input.bytes, opts);
        break;
      case "pdf":
        m = await parsePdf(input.bytes, opts);
        break;
      case "docx":
        m = parseDocx(input.bytes, opts);
        break;
      case "odt":
        m = parseOdt(input.bytes, opts);
        break;
      case "rtf":
        m = parseRtf(input.bytes, opts);
        break;
      case "fb2":
        m = parseFb2(input.bytes, opts);
        break;
      case "html":
        m = parseHtml(decodeText(input.bytes), { ...opts, extractMain: true, titleHint });
        break;
      case "markdown":
        m = parsePlainText(decodeText(input.bytes), { ...opts, markdown: true, titleHint });
        break;
      default:
        m = parsePlainText(decodeText(input.bytes), { ...opts, titleHint });
    }
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError(422, err instanceof Error ? err.message : String(err));
  }
  m.title ??= titleHint;
  if (!m.sections.length) throw new ImportError(422, m.warnings[0] ?? "No readable text was found.");
  return m;
}

/** Pasted text: Markdown when it looks like Markdown, otherwise plain. */
export function parsePasted(text: string, opts: ParseOptions & { title?: string | null } = {}): Manuscript {
  const markdown = /^#{1,6}\s/m.test(text);
  const m = parsePlainText(text, { ...opts, markdown, titleHint: opts.title ?? null });
  if (opts.title) m.title = opts.title;
  if (!m.sections.length) throw new ImportError(422, "There's no text to import.");
  return m;
}

export { parseDocx, parseEpub, parseFb2, parseHtml, parseOdt, parsePdf, parsePlainText, parseRtf };
