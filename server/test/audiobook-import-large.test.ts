/**
 * splitManuscriptText, and big books: a 1,000-page PDF and a 300,000-word
 * EPUB generated in memory (nothing large is committed). Each test logs its
 * time and heap growth and fails only past a generous ceiling, so a slow CI
 * runner doesn't flake but an accidental quadratic does.
 */

import { strToU8, zipSync, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";

import { parseEpub } from "../src/audiobook/import/epub.js";
import { splitManuscriptText } from "../src/audiobook/import/index.js";
import { parsePdf } from "../src/audiobook/import/pdf.js";
import { CH1, CH2, makePdf, wrap, type PdfText } from "./fixtures/audiobook/make.js";

const ascii = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
const PROSE = [...CH1, ...CH2];

function measure<T>(fn: () => T): { result: T; ms: number; heapMb: number } {
  const before = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const result = fn();
  return { result, ms: performance.now() - t0, heapMb: (process.memoryUsage().heapUsed - before) / 1048576 };
}

async function measureAsync<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number; heapMb: number; rssMb: number }> {
  const before = process.memoryUsage();
  const t0 = performance.now();
  const result = await fn();
  const after = process.memoryUsage();
  return {
    result,
    ms: performance.now() - t0,
    heapMb: (after.heapUsed - before.heapUsed) / 1048576,
    rssMb: (after.rss - before.rss) / 1048576,
  };
}

describe("splitManuscriptText", () => {
  it("joins wrapped lines, cleans and splits long paragraphs", () => {
    const text = `Chapter 3\n\n${wrap(CH1[1]!, 60).join("\n")}\n\nIt was a neigh-\nbourhood thing.[4]\n\n* * *\n\n${Array.from({ length: 15 }, () => CH1[0]).join(" ")}`;
    const out = splitManuscriptText(text, { maxChars: 400 });
    expect(out[0]).toBe("Chapter 3");
    expect(out[1]).toBe(CH1[1]);
    expect(out[2]).toBe("It was a neighbourhood thing.");
    expect(out.slice(3).every((p) => p.length <= 400 && p.endsWith("wife."))).toBe(true);
    expect(out.slice(3).join(" ")).toBe(Array.from({ length: 15 }, () => CH1[0]).join(" "));
    expect(splitManuscriptText("  \n\n ")).toEqual([]);
    expect(splitManuscriptText("**Bold** and [a link](https://x.example).", { markdown: true })).toEqual(["Bold and a link."]);
  });
});

describe("large books", () => {
  it("parses a 300,000-word EPUB", () => {
    const CHAPTERS = 60;
    const words = (s: string) => s.split(/\s+/).length;
    const perPara = PROSE.map(words);
    const files: Zippable = {
      mimetype: [strToU8("application/epub+zip"), { level: 0 }],
      "META-INF/container.xml": strToU8(
        `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
      ),
    };
    let total = 0;
    const manifest: string[] = [];
    const spine: string[] = [];
    const nav: string[] = [];
    for (let c = 1; c <= CHAPTERS; c++) {
      const paras: string[] = [];
      let n = 0;
      for (let i = 0; n < 5000; i++) {
        paras.push(`<p>${PROSE[i % PROSE.length]}</p>`);
        n += perPara[i % PROSE.length]!;
      }
      total += n;
      files[`OEBPS/c${c}.xhtml`] = strToU8(`<html><body><h2>Chapter ${c}</h2>${paras.join("\n")}</body></html>`);
      manifest.push(`<item id="c${c}" href="c${c}.xhtml" media-type="application/xhtml+xml"/>`);
      spine.push(`<itemref idref="c${c}"/>`);
      nav.push(`<li><a href="c${c}.xhtml">Chapter ${c}</a></li>`);
    }
    files["OEBPS/nav.xhtml"] = strToU8(`<html><body><nav epub:type="toc"><ol>${nav.join("")}</ol></nav></body></html>`);
    manifest.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
    files["OEBPS/content.opf"] = strToU8(
      `<package><metadata><dc:title>Big Book</dc:title></metadata><manifest>${manifest.join("")}</manifest><spine>${spine.join("")}</spine></package>`,
    );
    const bytes = zipSync(files);
    expect(total).toBeGreaterThanOrEqual(300_000);

    const { result: m, ms, heapMb } = measure(() => parseEpub(bytes));
    console.log(
      `EPUB ${total.toLocaleString()} words, ${(bytes.byteLength / 1048576).toFixed(1)} MB zipped: ${ms.toFixed(0)} ms, heap +${heapMb.toFixed(0)} MB, ` +
        `${m.sections.length} sections, ${m.sections.reduce((n, s) => n + s.paragraphs.length, 0).toLocaleString()} paragraphs`,
    );
    expect(m.sections).toHaveLength(CHAPTERS);
    expect(m.sections[59]!.title).toBe("Chapter 60");
    expect(ms).toBeLessThan(20_000);
  }, 60_000);

  it("parses a 1,000-page PDF", async () => {
    const PAGES = 1000;
    const lines = PROSE.flatMap((p) => wrap(ascii(p), 70).map((l, i) => ({ l, first: i === 0 })));
    const pages: PdfText[][] = [];
    let li = 0;
    for (let p = 1; p <= PAGES; p++) {
      const page: PdfText[] = [
        { x: 250, y: 760, size: 9, text: "BIG BOOK" },
        { x: 300, y: 40, size: 9, text: String(p) },
      ];
      let y = 700;
      if (p % 20 === 1) {
        page.push({ x: 72, y, size: 18, text: `Chapter ${Math.ceil(p / 20)}` });
        y -= 36;
      }
      for (; y >= 80; y -= 14) {
        const { l, first } = lines[li++ % lines.length]!;
        page.push({ x: first ? 90 : 72, y, size: 11, text: l });
      }
      pages.push(page);
    }
    const bytes = makePdf(pages, { title: "Big Book" });
    const { result: m, ms, heapMb, rssMb } = await measureAsync(() => parsePdf(bytes));
    console.log(
      `PDF ${PAGES} pages, ${(bytes.byteLength / 1048576).toFixed(1)} MB: ${ms.toFixed(0)} ms, heap +${heapMb.toFixed(0)} MB, rss +${rssMb.toFixed(0)} MB, ` +
        `${m.sections.length} sections, ${m.sections.reduce((n, s) => n + s.paragraphs.length, 0).toLocaleString()} paragraphs`,
    );
    expect(m.sections).toHaveLength(PAGES / 20);
    expect(m.sections[49]!.title).toBe("Chapter 50");
    expect(JSON.stringify(m.sections)).not.toContain("BIG BOOK");
    expect(ms).toBeLessThan(60_000);
  }, 120_000);
});
