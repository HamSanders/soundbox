import { describe, expect, it } from "vitest";

import { parseDocx } from "../src/audiobook/import/docx.js";
import { parseEpub } from "../src/audiobook/import/epub.js";
import { parseHtml } from "../src/audiobook/import/html.js";
import { decodeText, detectFormat, ImportError, parseManuscript, parsePasted } from "../src/audiobook/import/index.js";
import { manuscriptFromPdfPages, parsePdf, type PdfItem } from "../src/audiobook/import/pdf.js";
import { parsePlainText } from "../src/audiobook/import/plain.js";
import {
  classifySection,
  cleanParagraph,
  cleanParagraphs,
  isHeadingLine,
  splitLongParagraph,
  tidyTitle,
} from "../src/audiobook/import/text.js";
import { CH1, CH2, CH3, makeDocx, makeEpub, makePdf, PNG_1PX, wrap, type PdfText } from "./fixtures/audiobook/make.js";

const titles = (m: { sections: { title: string }[] }) => m.sections.map((s) => s.title);

describe("text helpers", () => {
  it("recognises headings", () => {
    for (const h of ["Chapter 1", "CHAPTER XII. The Ball", "Part Two", "Book III", "Prologue", "EPILOGUE", "IV", "Chapter the First", "About the Author", "Acknowledgements"]) {
      expect(isHeadingLine(h), h).toBe(true);
    }
    for (const t of ["I", "It is a truth universally acknowledged.", "Chapter and verse were quoted at length by the vicar, who had read them all before, and more besides."]) {
      expect(isHeadingLine(t), t).toBe(false);
    }
  });

  it("classifies sections and sets include defaults", () => {
    expect(classifySection("Copyright", [])).toEqual({ kind: "front_matter", included: false });
    expect(classifySection("Contents", [])).toEqual({ kind: "front_matter", included: false });
    expect(classifySection("Dedication", [])).toEqual({ kind: "front_matter", included: true });
    expect(classifySection("Epigraph", [])).toEqual({ kind: "front_matter", included: true });
    expect(classifySection("Foreword", [])).toEqual({ kind: "front_matter", included: true });
    expect(classifySection("Prologue", [])).toEqual({ kind: "chapter", included: true });
    expect(classifySection("Chapter 3", CH3)).toEqual({ kind: "chapter", included: true });
    expect(classifySection("Epilogue", [])).toEqual({ kind: "chapter", included: true });
    expect(classifySection("Afterword", [])).toEqual({ kind: "back_matter", included: true });
    expect(classifySection("Acknowledgments", [])).toEqual({ kind: "back_matter", included: true });
    expect(classifySection("About the Author", [])).toEqual({ kind: "back_matter", included: true });
    expect(classifySection("Index", [])).toEqual({ kind: "back_matter", included: false });
    // By content.
    expect(classifySection("", ["Copyright © 1813 Someone. All rights reserved.", "ISBN 978-0-00-000000-2"]).included).toBe(false);
    expect(classifySection("", ["Chapter I 1", "Chapter II 9", "Chapter III 14", "Chapter IV 20", "Chapter V 27"]).included).toBe(false);
    expect(classifySection("", ["For my sister Cassandra"])).toEqual({ kind: "front_matter", included: true });
  });

  it("cleans text for speech", () => {
    expect(cleanParagraph("said Mr. Bennet.12 Then")).toBe("said Mr. Bennet. Then");
    expect(cleanParagraph("a fortune[3] and a wife¹")).toBe("a fortune and a wife");
    expect(cleanParagraph("“Quoted,” she said softly​.")).toBe("“Quoted,” she said softly.");
    expect(cleanParagraph("* * *")).toBe("");
    expect(cleanParagraph("In 1813, 42 people came.")).toBe("In 1813, 42 people came.");
  });

  it("splits long paragraphs at sentence boundaries under maxChars", () => {
    const long = Array.from({ length: 12 }, () => CH1[0]).join(" ");
    const parts = splitLongParagraph(long, 300);
    expect(parts.length).toBeGreaterThan(3);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(300);
      expect(p).toMatch(/wife\.$/);
    }
    expect(parts.join(" ")).toBe(long);
    expect(cleanParagraphs([long]).every((p) => p.length <= 1000)).toBe(true);
    // Mr. stays with its name.
    expect(splitLongParagraph("Mr. Bennet was there. ".repeat(20).trim(), 100).every((p) => /there\.$/.test(p))).toBe(true);
  });

  it("title-cases all-caps headings", () => {
    expect(tidyTitle("CHAPTER XII. THE BALL")).toBe("Chapter XII. The Ball");
    expect(tidyTitle("Chapter 1:")).toBe("Chapter 1");
  });
});

describe("plain text and Markdown", () => {
  const gutenberg = `Title: Pride and Prejudice
Author: Jane Austen
Language: English

*** START OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***

PRIDE AND PREJUDICE

Chapter 1

${CH1.map((p) => wrap(p, 70).join("\n")).join("\n\n")}

Chapter 2

${CH2.map((p) => wrap(p, 70).join("\n")).join("\n\n")}

CHAPTER III.
Mrs. Bennet's Enquiries.

${CH3.join("\n")}

*** END OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***
licence text that must not appear`;

  it("splits chapters, joins wrapped lines and reads the header", () => {
    const m = parsePlainText(gutenberg);
    expect(m.title).toBe("Pride and Prejudice");
    expect(m.author).toBe("Jane Austen");
    expect(m.language).toBe("en");
    expect(titles(m)).toEqual(["Opening", "Chapter 1", "Chapter 2", "Chapter III: Mrs. Bennet's Enquiries"]);
    expect(m.sections[1]!.paragraphs).toEqual(CH1);
    expect(m.sections[3]!.paragraphs).toEqual(CH3);
    expect(JSON.stringify(m)).not.toContain("licence text");
  });

  it("mends hyphenation across wrapped lines", () => {
    const m = parsePlainText("Chapter 1\n\nthe neigh-\nbourhood was well-\nknown\n");
    expect(m.sections[0]!.paragraphs[0]).toBe("the neighbourhood was wellknown");
  });

  it("parses Markdown headings and strips inline syntax", () => {
    const md = `---
title: Pride and Prejudice
author: Jane Austen
---

# Pride and Prejudice

## Chapter 1

It is a **truth** universally [acknowledged](https://example.org)[^1].

\`\`\`
code is not read
\`\`\`

## Chapter 2

- Mr. Bennet was *among* the earliest.
`;
    const m = parsePlainText(md, { markdown: true });
    expect(m.title).toBe("Pride and Prejudice");
    expect(titles(m)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(m.sections[0]!.paragraphs).toEqual(["It is a truth universally acknowledged."]);
    expect(m.sections[1]!.paragraphs).toEqual(["Mr. Bennet was among the earliest."]);
  });

  it("pasted text becomes one section without headings", () => {
    const m = parsePasted(CH1.join("\n\n"), { title: "Pasted" });
    expect(m.title).toBe("Pasted");
    expect(m.sections).toHaveLength(1);
    expect(m.sections[0]!.paragraphs).toEqual(CH1);
    expect(() => parsePasted("   ")).toThrow(ImportError);
  });

  it("respects maxChars", () => {
    const m = parsePasted(Array.from({ length: 10 }, () => CH1[1]).join(" "), { maxChars: 400 });
    expect(m.sections[0]!.paragraphs.every((p) => p.length <= 400)).toBe(true);
  });
});

describe("EPUB", () => {
  it("reads metadata, cover, spine order and nav titles", () => {
    const m = parseEpub(makeEpub());
    expect(m).toMatchObject({
      title: "Pride and Prejudice",
      subtitle: "A Novel",
      author: "Jane Austen",
      language: "en-GB",
      isbn: "9780000000002",
      publisher: "Public Domain Press",
      publication_date: "1813-01-28",
      description: "A novel of manners.",
    });
    expect(m.cover?.mime).toBe("image/png");
    expect(m.cover?.bytes).toEqual(PNG_1PX);
    expect(titles(m)).toEqual(["Pride and Prejudice", "Copyright", "Chapter I", "Chapter II", "Chapter III", "About the Author", "Contents"].filter((t) => t !== "Contents"));
    const byTitle = Object.fromEntries(m.sections.map((s) => [s.title, s]));
    // linear="no" title page and the copyright page are excluded.
    expect(byTitle["Pride and Prejudice"]!.included).toBe(false);
    expect(byTitle["Copyright"]).toMatchObject({ kind: "front_matter", included: false });
    expect(byTitle["About the Author"]).toMatchObject({ kind: "back_matter", included: true });
    // Heading not repeated as a paragraph; footnote marker and footnote dropped.
    expect(byTitle["Chapter I"]!.paragraphs.slice(0, 4)).toEqual(CH1);
    expect(byTitle["Chapter I"]!.paragraphs[4]).toBe("A note here.");
    expect(JSON.stringify(m.sections)).not.toContain("footnote text");
  });

  it("splits a file at TOC anchors", () => {
    const m = parseEpub(makeEpub({ sharedFile: true }));
    const ch2 = m.sections.find((s) => s.title === "Chapter II")!;
    const ch3 = m.sections.find((s) => s.title === "Chapter III")!;
    expect(ch2.paragraphs).toEqual(CH2);
    expect(ch3.paragraphs).toEqual(CH3);
  });

  it("reads an EPUB 2 NCX and meta cover", () => {
    const m = parseEpub(makeEpub({ toc: "ncx" }));
    expect(titles(m)).toContain("Chapter III");
    expect(m.cover?.mime).toBe("image/png");
    expect(m.language).toBe("en-GB");
  });

  it("falls back to headings without a TOC and warns", () => {
    const m = parseEpub(makeEpub({ toc: "none", cover: false }));
    expect(m.cover).toBeNull();
    expect(titles(m)).toEqual(expect.arrayContaining(["Chapter I", "Chapter II", "Chapter III"]));
    expect(m.warnings.join(" ")).toMatch(/no table of contents/);
  });

  it("rejects a broken archive", async () => {
    await expect(parseManuscript({ bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), filename: "x.epub" })).rejects.toThrow(ImportError);
  });
});

describe("DOCX", () => {
  const doc = [
    { style: "Title", text: "Pride and Prejudice" },
    { style: "Heading1", text: "Chapter 1" },
    ...CH1.map((text) => ({ text })),
    { style: "Heading2", text: "A scene break" },
    { style: "Heading1", text: "Chapter 2" },
    ...CH2.map((text) => ({ text })),
  ];

  it("splits on Heading 1, keeps runs together and reads core properties", () => {
    const m = parseDocx(makeDocx(doc));
    expect(m.title).toBe("Pride and Prejudice");
    expect(m.author).toBe("Jane Austen");
    expect(m.language).toBe("en-US");
    expect(titles(m)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(m.sections[0]!.paragraphs).toEqual([...CH1, "A scene break"]);
    // Deleted revision text and the footnote reference are skipped.
    expect(m.sections[1]!.paragraphs.at(-1)).toBe("Deleted text kept.");
  });

  it("resolves localised and derived heading styles through styles.xml", () => {
    const m = parseDocx(
      makeDocx(
        [
          { style: "berschrift1", text: "Chapter 1" },
          { text: CH1[0]! },
          { style: "ChapterHead", text: "Chapter 2" },
          { text: CH2[1]! },
        ],
        { localisedHeadings: true },
      ),
    );
    expect(titles(m)).toEqual(["Chapter 1", "Chapter 2"]);
  });
});

describe("HTML", () => {
  const page = `<!doctype html><html lang="en"><head>
<title>Chapter 1 | Example Library</title>
<meta name="author" content="Jane Austen">
<meta name="description" content="The opening chapter.">
</head><body>
<header class="site-header"><a href="/">Home</a> <a href="/books">Books</a></header>
<nav><ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ul></nav>
<div class="layout">
  <div class="sidebar related"><p><a href="/x">Another book you might like to read today</a></p><p><a href="/y">And another popular title from the shop</a></p></div>
  <div class="content">
    ${CH1.map((p) => `<p>${p}</p>`).join("\n")}
    <p>Ending<sup>2</sup> here, with a <span style="display:none">hidden</span>sentence.</p>
  </div>
</div>
<footer><p>© Example Library. Terms, privacy and cookies apply to this website.</p></footer>
<script>var x = "not read";</script>
</body></html>`;

  it("extracts the main content and drops chrome", () => {
    const m = parseHtml(page, { extractMain: true });
    expect(m.title).toBe("Chapter 1");
    expect(m.author).toBe("Jane Austen");
    expect(m.description).toBe("The opening chapter.");
    expect(m.language).toBe("en");
    expect(m.sections).toHaveLength(1);
    expect(m.sections[0]!.paragraphs).toEqual([...CH1, "Ending here, with a sentence."]);
  });

  it("keeps every chapter of a book saved as HTML", () => {
    const book = `<html><head><title>Pride and Prejudice</title></head><body>
<h1>Pride and Prejudice</h1>
<div class="chapter"><h2>Chapter I</h2>${CH1.map((p) => `<p>${p}</p>`).join("")}</div>
<div class="chapter"><h2>Chapter II</h2>${CH2.map((p) => `<p>${p}</p>`).join("")}</div>
<div class="chapter"><h2>Chapter III</h2>${CH3.map((p) => `<p>${p}</p>`).join("")}</div>
</body></html>`;
    const m = parseHtml(book, { extractMain: true });
    expect(m.title).toBe("Pride and Prejudice");
    expect(titles(m)).toEqual(["Chapter I", "Chapter II", "Chapter III"]);
  });
});

describe("PDF", () => {
  const ascii = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  /** Lay chapters out on pages with a running head and a page number. */
  function layout(): PdfText[][] {
    const pages: PdfText[][] = [];
    let page: PdfText[] = [];
    let y = 700;
    const newPage = () => {
      if (page.length) pages.push(page);
      const n = pages.length + 1;
      page = [
        { x: 250, y: 760, size: 9, text: n % 2 ? "PRIDE AND PREJUDICE" : "JANE AUSTEN" },
        { x: 300, y: 40, size: 9, text: String(n) },
      ];
      y = 700;
    };
    newPage();
    const chapters: [string, string[]][] = [["Chapter 1", CH1], ["Chapter 2", CH2], ["Chapter 3", CH3]];
    for (const [title, paras] of chapters) {
      if (y < 600) newPage();
      page.push({ x: 72, y, size: 18, text: title });
      y -= 36;
      for (const p of paras) {
        const lines = wrap(ascii(p), 60);
        lines.forEach((line, i) => {
          if (y < 80) newPage();
          page.push({ x: i === 0 ? 90 : 72, y, size: 11, text: line });
          y -= 14;
        });
      }
    }
    // A hyphenated word across a page break.
    if (y < 120) newPage();
    page.push({ x: 90, y, size: 11, text: "She was in her neigh-" });
    newPage();
    page.push({ x: 72, y, size: 11, text: "bourhood again." });
    pages.push(page);
    return pages;
  }

  it("rebuilds paragraphs, headings and strips running heads", async () => {
    const pages = layout();
    pages.push([]); // a page with no text layer
    const bytes = makePdf(pages, { title: "Pride and Prejudice", author: "Jane Austen" });
    expect(detectFormat(bytes, "book.bin")).toBe("pdf");
    const m = await parsePdf(bytes);
    expect(m.title).toBe("Pride and Prejudice");
    expect(m.author).toBe("Jane Austen");
    expect(titles(m)).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"]);
    expect(m.sections[0]!.paragraphs).toEqual(CH1.map(ascii));
    expect(m.sections[1]!.paragraphs).toEqual(CH2.map(ascii));
    const text = JSON.stringify(m.sections);
    expect(text).not.toMatch(/PRIDE AND PREJUDICE|JANE AUSTEN/);
    expect(m.sections[2]!.paragraphs.at(-1)).toBe("She was in her neighbourhood again.");
    expect(m.warnings.join(" ")).toMatch(/1 of \d+ pages had no text layer/);
  }, 30_000);

  it("explains a PDF with no text layer", () => {
    const m = manuscriptFromPdfPages([[], []], {});
    expect(m.warnings[0]).toMatch(/no text layer/);
    expect(m.sections).toHaveLength(0);
  });

  it("detects body-size chapter headings standing alone", () => {
    const item = (str: string, y: number, x = 72): PdfItem => ({ str, x, y, width: str.length * 5, fontSize: 11 });
    const m = manuscriptFromPdfPages(
      [[item("CHAPTER I.", 700), item(ascii(CH1[3]!), 670, 90), item("CHAPTER II.", 640), item(ascii(CH2[1]!), 610, 90)]],
      {},
    );
    expect(titles(m)).toEqual(["Chapter I", "Chapter II"]);
  });
});

describe("format detection and decoding", () => {
  it("sniffs bytes before trusting the name", () => {
    expect(detectFormat(makeEpub(), "book.zip")).toBe("epub");
    expect(detectFormat(makeDocx([{ text: "x" }]), "book.docx")).toBe("docx");
    expect(detectFormat(new TextEncoder().encode("<!doctype html><p>x</p>"), "page")).toBe("html");
    expect(detectFormat(new TextEncoder().encode("# Title\n\ntext"), "")).toBe("markdown");
    expect(detectFormat(new TextEncoder().encode("plain"), "notes.txt")).toBe("text");
    expect(() => detectFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), "old.doc")).toThrow(/\.docx/);
  });

  it("decodes UTF-8, UTF-16 and Windows-1252", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe("hi");
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0, 0x69, 0]))).toBe("hi");
    expect(decodeText(new Uint8Array([0x93, 0x68, 0x69, 0x94]))).toBe("“hi”");
  });

  it("parseManuscript uses the file name as a title fallback", async () => {
    const m = await parseManuscript({ bytes: new TextEncoder().encode(CH1.join("\n\n")), filename: "my_book.txt" });
    expect(m.title).toBe("my book");
    await expect(parseManuscript({ bytes: new Uint8Array(), filename: "x.txt" })).rejects.toThrow(/empty/);
  });
});
