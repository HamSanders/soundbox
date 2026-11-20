/**
 * Rich Text Format (.rtf), with a small tokenizer instead of a dependency.
 *
 * RTF is groups (`{…}`), control words (`\par`, `\b0`, `舠`), control
 * symbols (`\'93`, `\~`, `\{`) and text. This reader keeps the text,
 * paragraph breaks and headings, and drops everything else:
 *  - destinations that aren't body text (font, colour and list tables,
 *    pictures, objects, headers, footers, footnotes, annotations, field
 *    instructions, any `{\*…}` group) are skipped;
 *  - `\'hh` bytes decode in the document's code page (`\ansicpgN`, default
 *    1252) and `\uN` is a Unicode character followed by `\ucN` fallback
 *    characters to skip;
 *  - a paragraph is a heading when it carries `\outlinelevelN`, or a style
 *    (`\sN`) the stylesheet names "heading N" or gives an outline level;
 *  - `{\info…}` gives title, author and subject.
 *
 * Reference: Rich Text Format (RTF) Specification, version 1.9.1 (Microsoft, 2008).
 */

import type { Manuscript } from "../types.js";
import { decodeBytes } from "./encoding.js";
import { blocksToSections, emptyManuscript, finishManuscript, type Block, type ParseOptions } from "./manuscript.js";
import { isHeadingLine, normaliseWhitespace } from "./text.js";

/** Destinations whose content is never body text. */
const SKIP_DESTINATIONS = new Set([
  "fonttbl", "colortbl", "stylesheet", "listtable", "listoverridetable", "revtbl", "rsidtbl", "generator",
  "pict", "object", "objdata", "shppict", "nonshppict", "header", "headerl", "headerr", "headerf", "footer",
  "footerl", "footerr", "footerf", "footnote", "annotation", "atnid", "atnauthor", "fldinst", "xmlnstbl",
  "themedata", "colorschememapping", "latentstyles", "datastore", "pntext", "pntxta", "pntxtb", "listtext",
  "bkmkstart", "bkmkend", "info", "filetbl", "private", "mmathPr", "wgrffmtfilter", "pgdsctbl",
]);
const INFO_FIELDS = new Set(["title", "author", "subject", "doccomm"]);

interface GroupState {
  /** Inside a destination whose text is dropped. */
  skip: boolean;
  /** The destination this group opened, if any. */
  dest: string | null;
  /** Fallback characters after \uN. */
  uc: number;
}

export interface RtfResult {
  blocks: Block[];
  info: Record<string, string>;
}

export function rtfToBlocks(src: string): RtfResult {
  if (!src.startsWith("{\\rtf")) throw new Error("This file isn't RTF (it should start with {\\rtf).");
  let codepage = "windows-1252";
  const blocks: Block[] = [];
  const info: Record<string, string> = {};
  /** Style number → heading level, from the stylesheet. */
  const headingStyles = new Map<number, number>();

  const stack: GroupState[] = [];
  let state: GroupState = { skip: false, dest: null, uc: 1 };
  let para = "";
  let outline: number | null = null;
  let style: number | null = null;
  let skipChars = 0; // fallback chars still to drop after \uN
  let bytes: number[] = []; // pending \'hh bytes, decoded together (DBCS)
  let infoText = "";
  // Stylesheet entry being read.
  let sheet: { style: number | null; outline: number | null; text: string } | null = null;

  const flushBytes = () => {
    if (!bytes.length) return;
    const t = decodeBytes(Uint8Array.from(bytes), codepage);
    bytes = [];
    emitText(t);
  };
  const emitText = (t: string) => {
    if (state.dest === "stylesheet-entry" && sheet) {
      sheet.text += t;
      return;
    }
    if (state.dest && INFO_FIELDS.has(state.dest)) {
      infoText += t;
      return;
    }
    if (state.skip) return;
    para += t;
  };
  const endParagraph = () => {
    flushBytes();
    const t = normaliseWhitespace(para);
    para = "";
    if (!t) return;
    const level =
      outline !== null && outline < 9 ? outline + 1 : style !== null ? (headingStyles.get(style) ?? null) : null;
    blocks.push(level ? { type: "heading", level, text: t } : { type: "para", text: t });
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i]!;
    if (ch === "{") {
      flushBytes();
      stack.push(state);
      state = { ...state, dest: state.dest === "stylesheet" ? "stylesheet-entry" : null };
      if (state.dest === "stylesheet-entry") sheet = { style: null, outline: null, text: "" };
      i++;
      continue;
    }
    if (ch === "}") {
      flushBytes();
      if (state.dest && INFO_FIELDS.has(state.dest)) {
        info[state.dest] = normaliseWhitespace(infoText);
        infoText = "";
      }
      if (state.dest === "stylesheet-entry" && sheet && sheet.style !== null) {
        const name = sheet.text.replace(/;$/, "").trim().toLowerCase();
        const named = /^heading\s*(\d)$/.exec(name);
        const level = named ? Number(named[1]) : sheet.outline !== null && sheet.outline < 9 ? sheet.outline + 1 : null;
        if (level) headingStyles.set(sheet.style, level);
      }
      state = stack.pop() ?? { skip: false, dest: null, uc: 1 };
      i++;
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1] ?? "";
      if (/[a-zA-Z]/.test(next)) {
        const m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(src.slice(i + 1, i + 50))!;
        i += 1 + m[0].length;
        const word = m[1]!;
        const param = m[2] !== undefined ? Number(m[2]) : null;
        if (word !== "u") flushBytes();
        switch (word) {
          case "ansicpg":
            if (param) codepage = `windows-${param}`;
            break;
          case "u": {
            flushBytes();
            const code = param === null ? 0 : param < 0 ? param + 65536 : param;
            emitText(String.fromCharCode(code));
            skipChars = state.uc;
            break;
          }
          case "uc":
            state.uc = param ?? 1;
            break;
          case "par":
          case "sect":
          case "page":
            if (!state.skip) endParagraph();
            break;
          case "line":
          case "tab":
          case "cell":
            emitText(" ");
            break;
          case "emdash":
            emitText("—");
            break;
          case "endash":
            emitText("–");
            break;
          case "lquote":
            emitText("‘");
            break;
          case "rquote":
            emitText("’");
            break;
          case "ldblquote":
            emitText("“");
            break;
          case "rdblquote":
            emitText("”");
            break;
          case "bullet":
            emitText("•");
            break;
          case "pard":
            outline = null;
            style = null;
            break;
          case "outlinelevel":
            if (state.dest === "stylesheet-entry" && sheet) sheet.outline = param;
            else outline = param;
            break;
          case "s":
            if (state.dest === "stylesheet-entry" && sheet) sheet.style = param;
            else style = param;
            break;
          default:
            if (SKIP_DESTINATIONS.has(word) || INFO_FIELDS.has(word)) {
              state.dest = word;
              state.skip = true;
            } else if (word === "fldrslt") {
              // A field's displayed result is text, even inside a skipped field.
              state.skip = false;
            }
        }
        continue;
      }
      // Control symbols.
      i += 2;
      switch (next) {
        case "'": {
          const hex = src.slice(i, i + 2);
          i += 2;
          if (skipChars > 0) {
            skipChars--;
            break;
          }
          if (/^[0-9a-fA-F]{2}$/.test(hex)) bytes.push(parseInt(hex, 16));
          break;
        }
        case "*":
          // An ignorable destination: skip the whole group unless we know it.
          state.skip = true;
          state.dest ??= "*";
          break;
        case "~":
          emitText(" ");
          break;
        case "_":
          emitText("-");
          break;
        case "-":
          break; // optional hyphen
        case "\n":
        case "\r":
          if (!state.skip) endParagraph();
          break;
        default:
          // \\, \{, \} and anything else literal.
          emitText(next);
      }
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      i++;
      continue; // raw newlines carry no meaning in RTF
    }
    flushBytes();
    if (skipChars > 0) {
      // The fallback text after a Unicode escape: one character per count.
      skipChars--;
      i++;
      continue;
    }
    // Plain text run up to the next special character.
    let j = i;
    while (j < n && !"{}\\\r\n".includes(src[j]!)) j++;
    emitText(src.slice(i, j));
    i = j;
  }
  endParagraph();
  return { blocks, info };
}

export function parseRtf(bytes: Uint8Array, opts: ParseOptions = {}): Manuscript {
  const m = emptyManuscript();
  // RTF is 7-bit ASCII by design; non-ASCII arrives escaped.
  const { blocks, info } = rtfToBlocks(new TextDecoder("latin1").decode(bytes));
  m.title = info.title || null;
  m.author = info.author || null;
  m.description = info.subject || info.doccomm || null;
  if (!blocks.some((b) => b.type === "heading")) {
    m.warnings.push("No heading styles were found, so headings were guessed from the text.");
    // Fall back to plain-text heading rules on each paragraph.
    for (const b of blocks) if (b.type === "para" && b.text.length <= 100 && isHeadingLine(b.text)) Object.assign(b, { type: "heading", level: 1 });
  }
  const { sections, firstHeading } = blocksToSections(blocks, { ...opts, fallbackTitle: m.title ?? "Opening" });
  m.title ??= firstHeading;
  m.sections = sections;
  return finishManuscript(m);
}
