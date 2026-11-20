/**
 * Small manuscript fixtures built in memory, so no binary files are committed.
 * Text is from Pride and Prejudice (Jane Austen, 1813), which is in the
 * public domain.
 */

import { strToU8, zipSync, type Zippable } from "fflate";

export const CH1 = [
  "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
  "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
  "“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”",
  "Mr. Bennet replied that he had not.",
];

export const CH2 = [
  "Mr. Bennet was among the earliest of those who waited on Mr. Bingley. He had always intended to visit him, though to the last always assuring his wife that he should not go; and till the evening after the visit was paid she had no knowledge of it.",
  "“I hope Mr. Bingley will like it, Lizzy.”",
];

export const CH3 = [
  "Not all that Mrs. Bennet, however, with the assistance of her five daughters, could ask on the subject, was sufficient to draw from her husband any satisfactory description of Mr. Bingley.",
];

/* --------------------------------------------------------------- EPUB */

function xhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>${title}</title></head>
<body>${body}</body>
</html>`;
}

const paras = (ps: string[]) => ps.map((p) => `<p>${p}</p>`).join("\n");

/** A 1x1 PNG. */
export const PNG_1PX = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

export interface EpubOptions {
  /** "nav" (EPUB 3), "ncx" (EPUB 2) or "none". */
  toc?: "nav" | "ncx" | "none";
  /** Put chapters 2 and 3 in one file, split by anchors. */
  sharedFile?: boolean;
  cover?: boolean;
}

export function makeEpub(opts: EpubOptions = {}): Uint8Array {
  const toc = opts.toc ?? "nav";
  const files: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
  };
  const docs: { id: string; href: string; body: string; title: string; linear?: boolean }[] = [
    { id: "titlepage", href: "text/title.xhtml", title: "Title", body: `<h1>Pride and Prejudice</h1><p>Jane Austen</p>` },
    {
      id: "copyright",
      href: "text/copyright.xhtml",
      title: "Copyright",
      body: `<p>This edition is in the public domain. All rights reserved for this formatting only.</p><p>ISBN 978-0-00-000000-2</p>`,
    },
    {
      id: "ch1",
      href: "text/ch1.xhtml",
      title: "Chapter I",
      body: `<h2>Chapter I</h2>\n${paras(CH1)}<p>A note<sup><a epub:type="noteref" href="#n1">1</a></sup> here.</p><aside epub:type="footnote" id="n1"><p>The footnote text.</p></aside>`,
    },
  ];
  if (opts.sharedFile) {
    docs.push({
      id: "ch23",
      href: "text/ch2%20and%203.xhtml",
      title: "Chapters II and III",
      body: `<h2 id="c2">Chapter II</h2>\n${paras(CH2)}\n<h2 id="c3">Chapter III</h2>\n${paras(CH3)}`,
    });
  } else {
    docs.push(
      { id: "ch2", href: "text/ch2.xhtml", title: "Chapter II", body: `<h2>Chapter II</h2>\n${paras(CH2)}` },
      { id: "ch3", href: "text/ch3.xhtml", title: "Chapter III", body: `<h2>Chapter III</h2>\n${paras(CH3)}` },
    );
  }
  docs.push({
    id: "about",
    href: "text/about.xhtml",
    title: "About the Author",
    body: `<h2>About the Author</h2><p>Jane Austen was an English novelist born in 1775.</p>`,
  });
  for (const d of docs) files[`OEBPS/${decodeURIComponent(d.href)}`] = strToU8(xhtml(d.title, d.body));

  const tocEntries = opts.sharedFile
    ? [
        ["text/ch1.xhtml", "Chapter I"],
        ["text/ch2%20and%203.xhtml#c2", "Chapter II"],
        ["text/ch2%20and%203.xhtml#c3", "Chapter III"],
        ["text/about.xhtml", "About the Author"],
      ]
    : [
        ["text/copyright.xhtml", "Copyright"],
        ["text/ch1.xhtml", "Chapter I"],
        ["text/ch2.xhtml", "Chapter II"],
        ["text/ch3.xhtml", "Chapter III"],
        ["text/about.xhtml", "About the Author"],
      ];

  const manifest: string[] = docs.map(
    (d) => `<item id="${d.id}" href="${d.href}" media-type="application/xhtml+xml"/>`,
  );
  if (toc === "nav") {
    files["OEBPS/nav.xhtml"] = strToU8(
      xhtml(
        "Contents",
        `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${tocEntries
          .map(([href, t]) => `<li><a href="${href!.replace(/^/, "")}">${t}</a></li>`)
          .join("")}</ol></nav>`,
      ),
    );
    manifest.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
  } else if (toc === "ncx") {
    files["OEBPS/toc.ncx"] = strToU8(`<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${tocEntries
      .map(
        ([href, t], i) =>
          `<navPoint id="np${i}" playOrder="${i + 1}"><navLabel><text>${t}</text></navLabel><content src="${href}"/></navPoint>`,
      )
      .join("")}</navMap></ncx>`);
    manifest.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);
  }
  if (opts.cover !== false) {
    files["OEBPS/images/cover.png"] = PNG_1PX;
    manifest.push(
      toc === "nav"
        ? `<item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>`
        : `<item id="cover-img" href="images/cover.png" media-type="image/png"/>`,
    );
  }
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${toc === "nav" ? "3.0" : "2.0"}" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title id="t1">Pride and Prejudice</dc:title>
    <dc:title id="t2">A Novel</dc:title>
    <meta refines="#t2" property="title-type">subtitle</meta>
    <dc:creator id="a1" opf:role="aut">Jane Austen</dc:creator>
    <dc:creator id="e1" opf:role="edt">An Editor</dc:creator>
    <dc:language>en-GB</dc:language>
    <dc:identifier id="uid">urn:isbn:9780000000002</dc:identifier>
    <dc:publisher>Public Domain Press</dc:publisher>
    <dc:date>1813-01-28</dc:date>
    <dc:description>&lt;p&gt;A novel of &lt;i&gt;manners&lt;/i&gt;.&lt;/p&gt;</dc:description>
    ${toc !== "nav" && opts.cover !== false ? `<meta name="cover" content="cover-img"/>` : ""}
  </metadata>
  <manifest>${manifest.join("\n")}</manifest>
  <spine${toc === "ncx" ? ` toc="ncx"` : ""}>${docs
    .map((d) => `<itemref idref="${d.id}"${d.id === "titlepage" ? ` linear="no"` : ""}/>`)
    .join("")}</spine>
</package>`;
  files["OEBPS/content.opf"] = strToU8(opf);
  return zipSync(files);
}

/* --------------------------------------------------------------- DOCX */

export interface DocxParagraph {
  style?: string;
  text: string;
}

export function makeDocx(paragraphs: DocxParagraph[], opts: { localisedHeadings?: boolean } = {}): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = paragraphs
    .map((p) => {
      const ppr = p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : "";
      // Split the text across two runs to check runs are joined.
      const mid = Math.floor(p.text.length / 2);
      return `<w:p>${ppr}<w:r><w:t xml:space="preserve">${esc(p.text.slice(0, mid))}</w:t></w:r><w:r><w:t xml:space="preserve">${esc(p.text.slice(mid))}</w:t></w:r></w:p>`;
    })
    .join("");
  const extras = `<w:p><w:r><w:t>Deleted </w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:t>text kept.</w:t><w:footnoteReference w:id="1"/></w:r></w:p>`;
  const h = opts.localisedHeadings
    ? [
        ["berschrift1", "heading 1"],
        ["berschrift2", "heading 2"],
      ]
    : [
        ["Heading1", "heading 1"],
        ["Heading2", "heading 2"],
      ];
  const styles = `<?xml version="1.0"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${h.map(([id, name]) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`).join("")}
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="ChapterHead"><w:name w:val="Chapter Head"/><w:basedOn w:val="${h[0]![0]}"/></w:style>
</w:styles>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`),
    "word/document.xml": strToU8(`<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${extras}<w:sectPr/></w:body></w:document>`),
    "word/styles.xml": strToU8(styles),
    "docProps/core.xml": strToU8(`<?xml version="1.0"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Pride and Prejudice</dc:title><dc:creator>Jane Austen</dc:creator><dc:language>en-US</dc:language></cp:coreProperties>`),
  });
}

/* ---------------------------------------------------------------- PDF */

export interface PdfText {
  x: number;
  y: number;
  size: number;
  text: string;
}

/** A minimal PDF 1.4 with Helvetica text at the given positions. Pages with
 *  no runs have no text layer (they stand in for scans). */
export function makePdf(pages: PdfText[][], info: { title?: string; author?: string } = {}): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const infoObj = add(
    `<< ${info.title ? `/Title (${esc(info.title)})` : ""} ${info.author ? `/Author (${esc(info.author)})` : ""} >>`,
  );
  const kids: number[] = [];
  for (const runs of pages) {
    const stream = runs.map((r) => `BT /F1 ${r.size} Tf ${r.x} ${r.y} Td (${esc(r.text)}) Tj ET`).join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** Lay prose out as wrapped PDF lines, ~`width` characters each. */
export function wrap(text: string, width = 80): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines;
}
