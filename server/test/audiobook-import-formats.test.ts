import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { epubDrm, sniffKindle } from "../src/audiobook/import/drm.js";
import { decodeBytes } from "../src/audiobook/import/encoding.js";
import { parseEpub } from "../src/audiobook/import/epub.js";
import { parseFb2 } from "../src/audiobook/import/fb2.js";
import { detectFormat, ImportError, parseManuscript } from "../src/audiobook/import/index.js";
import { parseOdt } from "../src/audiobook/import/odt.js";
import { parseRtf, rtfToBlocks } from "../src/audiobook/import/rtf.js";
import { makeFb2, makeKfx, makeMobi, makeOdt, makeRtf, RU_PARAS } from "./fixtures/audiobook/formats.js";
import { CH1, CH2, makeEpub, PNG_1PX } from "./fixtures/audiobook/make.js";

const titles = (m: { sections: { title: string }[] }) => m.sections.map((s) => s.title);
const enc = (s: string) => new TextEncoder().encode(s);

describe("ODT", () => {
  it("reads headings, paragraphs, lists and metadata; skips notes, tables and the TOC", () => {
    const bytes = makeOdt();
    expect(detectFormat(bytes, "book.zip")).toBe("odt");
    const m = parseOdt(bytes);
    expect(m.title).toBe("Pride and Prejudice");
    expect(m.author).toBe("Jane Austen");
    expect(m.language).toBe("en-GB");
    expect(titles(m)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(m.sections[0]!.paragraphs).toEqual([
      CH1[0],
      "Mr. Bennet replied that he had not.",
      "A list item is read too.",
      "A scene",
      "Text inside a section.",
    ]);
    expect(m.sections[1]!.paragraphs).toEqual(CH2);
    const all = JSON.stringify(m.sections);
    expect(all).not.toMatch(/footnote|Table text|\.\.\.\.\.\.\./);
    expect(m.warnings.join(" ")).toMatch(/Tables were skipped/);
  });
});

describe("RTF", () => {
  it("reads heading styles, escapes, fields and info; skips tables, headers and notes", () => {
    const bytes = enc(makeRtf());
    expect(detectFormat(bytes, "book.bin")).toBe("rtf");
    const m = parseRtf(bytes);
    expect(m).toMatchObject({ title: "Pride and Prejudice", author: "Jane Austen", description: "A novel" });
    expect(titles(m)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(m.sections[0]!.paragraphs).toEqual([
      CH1[0],
      "“My dear Mr. Bennet,” said his lady to him one day.",
      "A field: Netherfield Park is let.",
    ]);
    // \uN with a "?" fallback: the curly quotes in CH2 come through once, without "?".
    expect(m.sections[1]!.paragraphs).toEqual(CH2);
    const all = JSON.stringify(m);
    expect(all).not.toMatch(/Times New Roman|Running header|footnote|HYPERLINK|89504e47|bkmk/);
  });

  it("falls back to text heading rules without heading styles", () => {
    const m = parseRtf(enc(makeRtf({ styles: false })));
    expect(titles(m)).toEqual(["Chapter 1", "Chapter 2"]);
    expect(m.warnings.join(" ")).toMatch(/No heading styles/);
  });

  it("decodes \\'hh in the document code page", () => {
    const { blocks } = rtfToBlocks("{\\rtf1\\ansi\\ansicpg1251 \\'c3\\'eb\\'e0\\'e2\\'e0 1\\par}");
    expect(blocks[0]).toEqual({ type: "para", text: "Глава 1" });
    expect(() => rtfToBlocks("not rtf")).toThrow(/isn't RTF/);
  });
});

describe("FB2", () => {
  for (const variant of [{}, { encoding: "windows-1251" as const }, { zipped: true }]) {
    it(`reads nested sections, metadata and cover (${JSON.stringify(variant)})`, () => {
      const bytes = makeFb2(variant);
      expect(detectFormat(bytes, variant.zipped ? "anna.fb2.zip" : "anna.fb2")).toBe("fb2");
      const m = parseFb2(bytes);
      expect(m).toMatchObject({
        title: "Анна Каренина",
        author: "Лев Николаевич Толстой",
        language: "ru",
        description: "Роман о любви и семье.",
        publisher: "Общественное достояние",
        isbn: "9780000000002",
        publication_date: "1878",
      });
      expect(m.cover?.mime).toBe("image/png");
      expect(m.cover?.bytes).toEqual(PNG_1PX);
      // "Часть первая" has no text of its own; its chapters keep their titles.
      expect(titles(m)).toEqual(["Глава I", "Глава II"]);
      expect(m.sections[0]!.paragraphs.slice(0, 2)).toEqual(RU_PARAS);
      expect(m.sections[0]!.paragraphs).toContain("Строка первая / строка вторая");
      expect(JSON.stringify(m.sections)).not.toContain("Текст сноски");
    });
  }
});

describe("DRM and Kindle files", () => {
  it("recognises MOBI/AZW and KFX, and refuses them with the reason", async () => {
    expect(sniffKindle(makeMobi(0))).toEqual({ kind: "mobi", encrypted: false });
    expect(sniffKindle(makeMobi(2))).toEqual({ kind: "mobi", encrypted: true });
    expect(sniffKindle(makeKfx())).toEqual({ kind: "kfx", encrypted: true });
    expect(sniffKindle(enc("plain text"))).toBeNull();
    await expect(parseManuscript({ bytes: makeMobi(2), filename: "book.azw" })).rejects.toThrow(/DRM-protected/);
    await expect(parseManuscript({ bytes: makeMobi(0), filename: "book.azw3" })).rejects.toThrow(/Convert the book to EPUB/);
    await expect(parseManuscript({ bytes: makeKfx(), filename: "book.kfx" })).rejects.toMatchObject({ status: 415 });
  });

  it("refuses Adobe, Apple, LCP and content-encrypted EPUBs, and allows font obfuscation", () => {
    const withMeta = (files: Record<string, string>) => {
      const base = makeEpub();
      // Rebuild the zip with extra META-INF entries.
      const unzipped = unzipSync(base);
      for (const [k, v] of Object.entries(files)) unzipped[k] = strToU8(v);
      return zipSync(unzipped);
    };
    const enc = (algorithm: string, uri: string) =>
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData></encryption>`;
    expect(() => parseEpub(withMeta({ "META-INF/rights.xml": "<rights/>" }))).toThrow(/Adobe DRM/);
    expect(() => parseEpub(withMeta({ "META-INF/sinf.xml": "<sinf/>" }))).toThrow(/Apple FairPlay/);
    expect(() => parseEpub(withMeta({ "META-INF/license.lcpl": "{}" }))).toThrow(/Readium LCP/);
    expect(() =>
      parseEpub(withMeta({ "META-INF/encryption.xml": enc("http://www.w3.org/2001/04/xmlenc#aes256-cbc", "OEBPS/text/ch1.xhtml") })),
    ).toThrow(/DRM-protected/);
    expect(() =>
      parseEpub(withMeta({ "META-INF/encryption.xml": enc("http://www.idpf.org/2008/embedding", "OEBPS/fonts/a.otf") })),
    ).not.toThrow();
    expect(epubDrm(() => null)).toBeNull();
  });

  it("other archives and unknown binaries get a clear 415", async () => {
    await expect(parseManuscript({ bytes: zipSync({ "a.bin": new Uint8Array(3) }), filename: "x.zip" })).rejects.toMatchObject({ status: 415 });
    const ods = zipSync({ mimetype: [strToU8("application/vnd.oasis.opendocument.spreadsheet"), { level: 0 }] });
    await expect(parseManuscript({ bytes: ods, filename: "x.ods" })).rejects.toThrow(/isn't a text document/);
    await expect(parseManuscript({ bytes: new Uint8Array([1, 2, 3, 0, 5]), filename: "x.lit" })).rejects.toBeInstanceOf(ImportError);
  });
});

describe("code pages", () => {
  it("decodes named code pages, with 1252 mapped by hand", () => {
    expect(decodeBytes(Uint8Array.from([0xc3, 0xeb]), "windows-1251")).toBe("Гл");
    expect(decodeBytes(Uint8Array.from([0x93, 0x41, 0x94]), "cp1252")).toBe("“A”");
    expect(decodeBytes(Uint8Array.from([0x93, 0x41, 0x94]), "ansicpg1252")).toBe("“A”");
    expect(decodeBytes(enc("plain"), "made-up")).toBe("plain");
  });
});

