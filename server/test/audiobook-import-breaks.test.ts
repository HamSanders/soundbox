/**
 * Scene breaks: every parser reports where "* * *", "#", "⁂" or a rule sits
 * between paragraphs as `breaks` (a pause before paragraphs[i]), and the
 * review screen's merge and split edits keep them in the right place.
 */

import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseDocx } from "../src/audiobook/import/docx.js";
import { parseEpub } from "../src/audiobook/import/epub.js";
import { parseFb2 } from "../src/audiobook/import/fb2.js";
import { parseHtml } from "../src/audiobook/import/html.js";
import { applyEdits, remapBreaks } from "../src/audiobook/import/preview.js";
import { parsePlainText } from "../src/audiobook/import/plain.js";
import { parseRtf } from "../src/audiobook/import/rtf.js";
import { cleanParagraphs, cleanSection, isSceneBreak } from "../src/audiobook/import/text.js";
import type { Manuscript } from "../src/audiobook/types.js";
import { CH1, CH2, makeDocx } from "./fixtures/audiobook/make.js";

const [A, B, C, D] = CH1 as [string, string, string, string];

describe("cleanSection", () => {
  it("records breaks between paragraphs and drops the separator text", () => {
    expect(cleanSection([A, "* * *", B, "⁂", C, "#", D])).toEqual({ paragraphs: [A, B, C, D], breaks: [1, 2, 3] });
  });

  it("drops breaks at the start or end and collapses runs", () => {
    expect(cleanSection(["* * *", A, "~~~", "***", B, "* * *"])).toEqual({ paragraphs: [A, B], breaks: [1] });
    expect(cleanSection(["* * *"])).toEqual({ paragraphs: [], breaks: [] });
  });

  it("counts after long paragraphs are split", () => {
    const long = Array.from({ length: 6 }, () => A).join(" ");
    const { paragraphs, breaks } = cleanSection([long, "* * *", B], { maxChars: 300 });
    expect(paragraphs.at(-1)).toBe(B);
    expect(breaks).toEqual([paragraphs.length - 1]);
  });

  it("recognises separators, not words", () => {
    for (const s of ["* * *", "***", "#", "⁂", "~ ~ ~", "———", "• • •", "❧"]) expect(isSceneBreak(s), s).toBe(true);
    for (const s of ["", "A", "* Note *", "1."]) expect(isSceneBreak(s), s).toBe(false);
    // cleanParagraphs (used by core) still just drops them.
    expect(cleanParagraphs([A, "* * *", B])).toEqual([A, B]);
  });
});

describe("parsers report breaks", () => {
  it("plain text and Markdown", () => {
    const plain = parsePlainText(`Chapter 1\n\n${A}\n\n* * *\n\n${B}\n\n⁂\n\n${C}`);
    expect(plain.sections[0]).toMatchObject({ paragraphs: [A, B, C], breaks: [1, 2] });
    const md = parsePlainText(`## One\n\n${A}\n\n---\n\n${B}\n\n#\n\n${C}`, { markdown: true });
    expect(md.sections[0]).toMatchObject({ paragraphs: [A, B, C], breaks: [1, 2] });
  });

  it("HTML and EPUB: <hr> and a centred asterism paragraph", () => {
    const html = `<html><body><h1>Chapter 1</h1><p>${A}</p><hr class="transition"/><p>${B}</p><p class="center">* * *</p><p>${C}</p></body></html>`;
    expect(parseHtml(html).sections[0]).toMatchObject({ paragraphs: [A, B, C], breaks: [1, 2] });
    // parseEpub shares htmlToBlocks + makeSection; build a one-chapter EPUB inline.
    const epub = zipSync({
      mimetype: [strToU8("application/epub+zip"), { level: 0 }],
      "META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>`),
      "c.opf": strToU8(`<package><metadata/><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>`),
      "a.xhtml": strToU8(`<html><body><h2>Chapter 1</h2><p>${A}</p><hr/><p>${B}</p></body></html>`),
    });
    expect(parseEpub(epub).sections[0]).toMatchObject({ paragraphs: [A, B], breaks: [1] });
  });

  it("DOCX, RTF and FB2: separator paragraphs", () => {
    const docx = parseDocx(makeDocx([{ style: "Heading1", text: "Chapter 1" }, { text: A }, { text: "* * *" }, { text: B }]));
    expect(docx.sections[0]!.breaks).toEqual([1]);
    const rtf = parseRtf(new TextEncoder().encode(`{\\rtf1\\ansi{\\stylesheet{\\s1\\outlinelevel0 heading 1;}}\\pard\\s1 Chapter 1\\par\\pard ${A}\\par\\pard * * *\\par\\pard ${B}\\par}`));
    expect(rtf.sections[0]).toMatchObject({ paragraphs: [A, B], breaks: [1] });
    const fb2 = parseFb2(
      new TextEncoder().encode(
        `<?xml version="1.0" encoding="utf-8"?><FictionBook><description><title-info><book-title>T</book-title><lang>en</lang></title-info></description><body><section><title><p>Chapter 1</p></title><p>${A}</p><subtitle>* * *</subtitle><p>${B}</p></section></body></FictionBook>`,
      ),
    );
    expect(fb2.sections[0]).toMatchObject({ paragraphs: [A, B], breaks: [1] });
  });

  it("sections without breaks don't carry an empty list", () => {
    expect(parsePlainText(`Chapter 1\n\n${A}\n\n${B}`).sections[0]!.breaks).toBeUndefined();
  });
});

describe("edits keep breaks in place", () => {
  const source = (): Manuscript => ({
    title: "T", subtitle: null, author: null, language: "en", description: null, isbn: null, publisher: null,
    publication_date: null, cover: null, warnings: [],
    sections: [
      { title: "One", kind: "chapter", included: true, paragraphs: [A, B, C, D], breaks: [2] },
      { title: "Two", kind: "chapter", included: true, paragraphs: CH2, breaks: [1] },
    ],
  });
  const S = (parts: { section: number; start?: number; end?: number }[]) => ({ title: "X", kind: "chapter" as const, included: true, parts });

  it("no edits: breaks pass through", () => {
    expect(applyEdits(source(), {}).sections.map((s) => s.breaks)).toEqual([[2], [1]]);
  });

  it("split at a break drops it; split elsewhere moves it", () => {
    const atBreak = applyEdits(source(), { sections: [S([{ section: 0, end: 2 }]), S([{ section: 0, start: 2 }])] });
    expect(atBreak.sections.map((s) => s.breaks)).toEqual([undefined, undefined]);
    const before = applyEdits(source(), { sections: [S([{ section: 0, end: 1 }]), S([{ section: 0, start: 1 }])] });
    expect(before.sections[1]).toMatchObject({ paragraphs: [B, C, D], breaks: [1] });
  });

  it("merge offsets the second section's breaks; re-merging a split restores the break", () => {
    const merged = applyEdits(source(), { sections: [S([{ section: 0 }, { section: 1 }])] });
    expect(merged.sections[0]!.breaks).toEqual([2, 5]);
    const rejoined = applyEdits(source(), { sections: [S([{ section: 0, end: 2 }, { section: 0, start: 2 }])] });
    expect(rejoined.sections[0]!.breaks).toEqual([2]);
  });

  it("remapBreaks keeps only breaks inside the range", () => {
    expect(remapBreaks([1, 3, 5], 2, 5, 10)).toEqual([11]);
    expect(remapBreaks([2], 2, 4, 0)).toEqual([]);
    expect(remapBreaks([2], 2, 4, 3)).toEqual([3]);
    expect(remapBreaks(undefined, 0, 4, 0)).toEqual([]);
  });
});

