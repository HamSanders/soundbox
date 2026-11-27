/**
 * ODT, RTF, FB2 and Kindle fixtures built in memory, with public-domain text
 * (Pride and Prejudice, and Anna Karenina for the Cyrillic FB2).
 */

import { strToU8, zipSync } from "fflate";

import { CH1, CH2, PNG_1PX } from "./make.js";

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------------------------------------------------------------- ODT */

export function makeOdt(): Uint8Array {
  const p = (t: string) => `<text:p text:style-name="Text_20_body">${xmlEsc(t)}</text:p>`;
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.3">
<office:body><office:text>
<text:sequence-decls><text:sequence-decl text:display-outline-level="0" text:name="Table"/></text:sequence-decls>
<text:p text:style-name="Title">Pride and Prejudice</text:p>
<text:table-of-content><text:index-body><text:p>Chapter 1 ....... 1</text:p></text:index-body></text:table-of-content>
<text:h text:outline-level="1">Chapter 1</text:h>
${p(CH1[0]!)}
<text:p text:style-name="Text_20_body">Mr.<text:s/>Bennet replied<text:s text:c="2"/>that he had<text:tab/>not.<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>A footnote.</text:p></text:note-body></text:note></text:p>
<text:list><text:list-item><text:p>A list item is read too.</text:p></text:list-item></text:list>
<table:table><table:table-row><table:table-cell><text:p>Table text is skipped.</text:p></table:table-cell></table:table-row></table:table>
<text:h text:outline-level="2">A scene</text:h>
<text:section text:name="S1"><text:p>Text inside a section.</text:p></text:section>
<text:h text:outline-level="1">Chapter 2</text:h>
${CH2.map(p).join("\n")}
</office:text></office:body></office:document-content>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0">
<office:meta><meta:initial-creator>Jane Austen</meta:initial-creator><dc:language>en-GB</dc:language></office:meta></office:document-meta>`;
  return zipSync({
    mimetype: [strToU8("application/vnd.oasis.opendocument.text"), { level: 0 }],
    "content.xml": strToU8(content),
    "meta.xml": strToU8(meta),
    "META-INF/manifest.xml": strToU8(`<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`),
  });
}

/* ---------------------------------------------------------------- RTF */

/** RTF escapes: non-ASCII as \uN with a "?" fallback (what Word writes). */
function rtfText(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "\\" || ch === "{" || ch === "}") out += `\\${ch}`;
    else if (c > 127) out += `\\u${c > 32767 ? c - 65536 : c}?`;
    else out += ch;
  }
  return out;
}

export function makeRtf(opts: { styles?: boolean } = {}): string {
  const styles = opts.styles !== false;
  const heading = (t: string) =>
    styles ? `\\pard\\s1\\outlinelevel0\\b ${rtfText(t)}\\b0\\par\n` : `\\pard ${rtfText(t)}\\par\n`;
  const para = (t: string) => `\\pard\\s0 ${rtfText(t)}\\par\n`;
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0
{\\fonttbl{\\f0\\froman Times New Roman;}{\\f1\\fswiss Arial;}}
{\\colortbl;\\red0\\green0\\blue0;}
{\\stylesheet{\\s0 Normal;}{\\s1\\outlinelevel0 heading 1;}}
{\\info{\\title Pride and Prejudice}{\\author Jane Austen}{\\subject A novel}}
{\\header \\pard Running header text\\par}
${heading("Chapter 1")}${para(CH1[0]!)}\\pard\\s0 \\'93My dear Mr. Bennet,\\'94 said his lady{\\footnote \\pard A footnote.\\par} to him one day.\\par
\\pard\\s0 A field: {\\field{\\*\\fldinst HYPERLINK "https://example.org"}{\\fldrslt Netherfield Park}} is let.\\par
{\\*\\bkmkstart b1}{\\*\\bkmkend b1}{\\pict\\pngblip 89504e47}
${heading("Chapter 2")}${CH2.map(para).join("")}}`;
}

/* ---------------------------------------------------------------- FB2 */

export const RU_PARAS = [
  "Все счастливые семьи похожи друг на друга, каждая несчастливая семья несчастлива по-своему.",
  "Все смешалось в доме Облонских. Жена узнала, что муж был в связи с бывшею в их доме француженкою-гувернанткой.",
];

export function makeFb2(opts: { encoding?: "utf-8" | "windows-1251"; zipped?: boolean } = {}): Uint8Array {
  const encoding = opts.encoding ?? "utf-8";
  const cover = Buffer.from(PNG_1PX).toString("base64");
  const xml = `<?xml version="1.0" encoding="${encoding}"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
  <title-info>
    <genre>prose_classic</genre>
    <author><first-name>Лев</first-name><middle-name>Николаевич</middle-name><last-name>Толстой</last-name></author>
    <book-title>Анна Каренина</book-title>
    <annotation><p>Роман о любви и семье.</p></annotation>
    <lang>ru</lang>
    <coverpage><image l:href="#cover.png"/></coverpage>
  </title-info>
  <publish-info><publisher>Общественное достояние</publisher><year>1878</year><isbn>978-0-00-000000-2</isbn></publish-info>
</description>
<body>
  <title><p>Лев Толстой</p><p>Анна Каренина</p></title>
  <section>
    <title><p>Часть первая</p></title>
    <section>
      <title><p>Глава I</p></title>
      ${RU_PARAS.map((p) => `<p>${p}</p>`).join("\n")}
      <empty-line/>
      <poem><stanza><v>Строка первая</v><v>строка вторая</v></stanza></poem>
      <p>Сноска<a l:href="#n1" type="note">1</a> здесь.</p>
    </section>
    <section>
      <title><p>Глава II</p></title>
      <p>Степан Аркадьич был человек правдивый в отношении к себе самому.</p>
    </section>
  </section>
</body>
<body name="notes"><section id="n1"><title><p>1</p></title><p>Текст сноски.</p></section></body>
<binary id="cover.png" content-type="image/png">${cover}</binary>
</FictionBook>`;
  const bytes = encoding === "utf-8" ? strToU8(xml) : new Uint8Array(Buffer.from(encodeCp1251(xml)));
  return opts.zipped ? zipSync({ "anna.fb2": bytes }) : bytes;
}

/** Encode Cyrillic text as Windows-1251 (А–я at 0xC0–0xFF, Ё/ё at 0xA8/0xB8). */
function encodeCp1251(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 128) out.push(c);
    else if (c >= 0x410 && c <= 0x44f) out.push(c - 0x410 + 0xc0);
    else if (c === 0x401) out.push(0xa8);
    else if (c === 0x451) out.push(0xb8);
    else out.push(0x3f);
  }
  return out;
}

/* ------------------------------------------------------------- Kindle */

/** A minimal Palm database with a MOBI record 0; `encryption` is the
 *  PalmDOC header's encryption field (0 none, 2 Mobipocket DRM). */
export function makeMobi(encryption: 0 | 1 | 2): Uint8Array {
  const header = new Uint8Array(78 + 8 + 2 + 32);
  const view = new DataView(header.buffer);
  header.set(strToU8("Book Title"), 0);
  header.set(strToU8("BOOKMOBI"), 60);
  view.setUint16(76, 1); // one record
  const record0 = 78 + 8 + 2;
  view.setUint32(78, record0);
  view.setUint16(record0 + 0, 2); // PalmDOC compression
  view.setUint16(record0 + 12, encryption);
  header.set(strToU8("MOBI"), record0 + 16);
  return header;
}

export function makeKfx(): Uint8Array {
  const b = new Uint8Array(64);
  b.set(strToU8("CONT"), 0);
  return b;
}
