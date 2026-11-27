/**
 * The import API for `VITE_MOCK=1`: no server, so any file or URL "parses" to
 * a bundled sample (the opening of Pride and Prejudice, public domain), and
 * pasted text is split in the browser at blank lines and "Chapter" headings.
 * Commit builds the book through the audiobook mock, so it opens in the
 * editor like a real import.
 */

import { mockAudiobookApi } from "@/lib/audiobook-mock";
import type { ChapterKind } from "@/lib/audiobook-types";

import type { ClassicSummary, ImportApi, ImportPreview, ImportSection } from "./api";
import { paragraphsFor } from "./sections";

const S = (title: string, kind: ChapterKind, included: boolean, paragraphs: string[], breaks?: number[]): ImportSection => ({
  title,
  kind,
  included,
  paragraphs,
  ...(breaks ? { breaks } : {}),
  characters: paragraphs.reduce((n, p) => n + p.length, 0),
});

export const SAMPLE_SECTIONS: ImportSection[] = [
  S("Copyright", "front_matter", false, [
    "This edition of Pride and Prejudice is in the public domain.",
    "ISBN 978-0-00-000000-2",
  ]),
  S("Contents", "front_matter", false, ["Chapter I", "Chapter II", "Chapter III", "About the Author"]),
  S("Dedication", "front_matter", true, ["For every reader who loves a long walk and a good argument."]),
  S("Chapter I", "chapter", true, [
    "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
    "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
    "“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”",
    "Mr. Bennet replied that he had not.",
    "“But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.”",
    "Mr. Bennet made no answer.",
  ], [4]),
  S("Chapter II", "chapter", true, [
    "Mr. Bennet was among the earliest of those who waited on Mr. Bingley. He had always intended to visit him, though to the last always assuring his wife that he should not go; and till the evening after the visit was paid she had no knowledge of it.",
    "“I hope Mr. Bingley will like it, Lizzy.”",
  ]),
  S("Chapter III", "chapter", true, [
    "Not all that Mrs. Bennet, however, with the assistance of her five daughters, could ask on the subject, was sufficient to draw from her husband any satisfactory description of Mr. Bingley.",
  ]),
  S("About the Author", "back_matter", true, [
    "Jane Austen was an English novelist, born in 1775, known for her wit and her close observation of manners.",
  ]),
];

const previews = new Map<string, ImportPreview>();
const covers = new Map<string, string>();
let seq = 0;

function build(sections: ImportSection[], meta: Partial<ImportPreview["metadata"]>, source: ImportPreview["source"], maxChars = 1000): ImportPreview {
  const id = `mock-import-${++seq}`;
  const preview: ImportPreview = {
    id,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    source,
    max_chars: maxChars,
    metadata: {
      title: null,
      subtitle: null,
      author: null,
      language: "en",
      description: null,
      isbn: null,
      publisher: null,
      publication_date: null,
      ...meta,
    },
    cover: null,
    sections,
    warnings: [],
    stats: {
      sections: sections.length,
      paragraphs: sections.reduce((n, s) => n + s.paragraphs.length, 0),
      characters: sections.reduce((n, s) => n + s.characters, 0),
    },
  };
  previews.set(id, preview);
  return preview;
}

const SAMPLE_META = {
  title: "Pride and Prejudice",
  subtitle: "A Novel",
  author: "Jane Austen",
  description: "A sample manuscript bundled with the mock preview.",
  publisher: "Public Domain",
  publication_date: "1813-01-28",
  isbn: "9780000000002",
};

const delay = () => new Promise((r) => setTimeout(r, 350));

function need(id: string): ImportPreview {
  const p = previews.get(id);
  if (!p) throw new Error("That import has expired. Add the file again.");
  return p;
}

/** Pasted text: chapters at "Chapter …" / "#" lines, paragraphs at blank lines. */
function splitPasted(text: string): ImportSection[] {
  const sections: { title: string; paragraphs: string[] }[] = [];
  let current: { title: string; paragraphs: string[] } = { title: "Opening", paragraphs: [] };
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const t = block.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const heading = /^(?:#{1,6}\s+)?((?:chapter|part|prologue|epilogue)\b.{0,80})$/i.exec(t);
    if (heading || /^#{1,6}\s/.test(t)) {
      if (current.paragraphs.length) sections.push(current);
      current = { title: (heading?.[1] ?? t).replace(/^#+\s*/, ""), paragraphs: [] };
    } else current.paragraphs.push(t);
  }
  if (current.paragraphs.length) sections.push(current);
  return sections.map((s) => S(s.title, "chapter", true, s.paragraphs));
}

const MOCK_CLASSICS: ClassicSummary[] = [
  { id: "gift-of-the-magi", title: "The Gift of the Magi", author: "O. Henry", life: "1862–1910", year: 1905, form: "story",
    genres: ["Short stories", "Holiday"], language: "en", words: 2061, chapters: 1, minutes: 13,
    description: "A young couple with almost no money each give up their most treasured possession to buy the other a Christmas present.",
    source: { name: "Standard Ebooks", url: "https://standardebooks.org/ebooks/o-henry/short-fiction" } },
  { id: "the-raven", title: "The Raven", author: "Edgar Allan Poe", life: "1809–1849", year: 1845, form: "poem",
    genres: ["Poetry", "Horror"], language: "en", words: 1069, chapters: 1, minutes: 7,
    description: "On a December midnight, a grieving student is visited by a raven that answers every question with one word.",
    source: { name: "Standard Ebooks", url: "https://standardebooks.org/ebooks/edgar-allan-poe/poetry" } },
];

export const mockImportApi: ImportApi = {
  async listClassics() {
    await delay();
    return { works: MOCK_CLASSICS, rights: "Public domain in the United States. (Mock data.)" };
  },
  async parseClassic(id, maxChars) {
    await delay();
    const w = MOCK_CLASSICS.find((x) => x.id === id);
    if (!w) throw new Error("That classic isn't in the library.");
    return build(SAMPLE_SECTIONS.slice(3, 5), { title: w.title, author: w.author, description: w.description }, { filename: null, format: "classic", url: w.source.url }, maxChars);
  },
  async parseFile(file, maxChars) {
    await delay();
    return build(SAMPLE_SECTIONS, SAMPLE_META, { filename: file.name, format: "epub", url: null }, maxChars);
  },
  async parseText(text, title, maxChars) {
    await delay();
    const sections = splitPasted(text);
    if (!sections.length) throw new Error("There's no text to import.");
    return build(sections, { title: title || "Pasted text" }, { filename: null, format: "pasted", url: null }, maxChars);
  },
  async parseUrl(url, maxChars) {
    await delay();
    if (!/^https?:\/\//i.test(url.trim())) throw new Error("Only http and https addresses can be imported.");
    return build(SAMPLE_SECTIONS.slice(3, 4), { title: "Chapter I" }, { filename: null, format: "html", url }, maxChars);
  },
  async replaceCover(previewId, file) {
    const p = need(previewId);
    covers.set(previewId, URL.createObjectURL(file));
    p.cover = { token: `mock-${++seq}`, mime: file.type || "image/png", bytes: file.size };
    return { ...p };
  },
  async removeCover(previewId) {
    const p = need(previewId);
    covers.delete(previewId);
    p.cover = null;
    return { ...p };
  },
  async discard(previewId) {
    previews.delete(previewId);
  },
  async commit(req) {
    const p = need(req.preview_id);
    const meta = { ...p.metadata, ...req.edits?.metadata };
    const sections = req.edits?.sections
      ? req.edits.sections.map((s) => ({ ...s, paragraphs: paragraphsFor(s.parts, p.sections) }))
      : p.sections;
    const book = await mockAudiobookApi.createBook({
      title: meta.title || "Untitled book",
      subtitle: meta.subtitle,
      author: meta.author,
      description: meta.description,
      language: meta.language || "en",
      isbn: meta.isbn,
      publisher: meta.publisher,
      publication_date: meta.publication_date,
      settings: req.settings,
    });
    // createBook seeds an empty first chapter; the import replaces it.
    for (const c of book.chapters) await mockAudiobookApi.deleteChapter(book.id, c.id);
    for (const s of sections) {
      if (!s.paragraphs.length) continue;
      await mockAudiobookApi.addChapter(book.id, { title: s.title, kind: s.kind, included: s.included, paragraphs: s.paragraphs });
    }
    const cover = covers.get(p.id);
    if (cover && req.edits?.cover !== "remove") {
      const blob = await fetch(cover).then((r) => r.blob());
      await mockAudiobookApi.uploadCover(book.id, blob);
    }
    previews.delete(p.id);
    return mockAudiobookApi.getBook(book.id);
  },
  coverUrl: (preview) => (preview.cover ? (covers.get(preview.id) ?? null) : null),
};
