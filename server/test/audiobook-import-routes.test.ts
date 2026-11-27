/**
 * Import routes end to end: parse → preview → edit → commit into a real book
 * store in a temp data directory. URL import runs against a stubbed fetch;
 * nothing leaves the machine.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { applyEdits, PREVIEW_TTL_MS, PreviewStore, type ImportPreview } from "../src/audiobook/import/preview.js";
import { checkUrl, fetchDocument } from "../src/audiobook/import/url.js";
import { Config } from "../src/config.js";
import { setImportFetch } from "../src/routes/audiobook-import.js";
import { CH1, CH2, CH3, makeDocx, makeEpub, PNG_1PX } from "./fixtures/audiobook/make.js";

let app: FastifyInstance;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "mirli-audiobook-import-"));
  app = buildApp(new Config(dataDir), { serveUi: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

afterEach(() => setImportFetch(undefined));

const H = { "x-soundbox": "1" };

async function upload(bytes: Uint8Array, filename: string, query = ""): Promise<ImportPreview> {
  const res = await app.inject({
    method: "POST",
    url: `/api/audiobooks/import/parse?filename=${encodeURIComponent(filename)}${query}`,
    headers: { ...H, "content-type": "application/octet-stream" },
    payload: Buffer.from(bytes),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

describe("parse", () => {
  it("returns a preview for an EPUB with a cover served by token", async () => {
    const p = await upload(makeEpub(), "pride.epub");
    expect(p.source).toMatchObject({ filename: "pride.epub", format: "epub" });
    expect(p.metadata).toMatchObject({ title: "Pride and Prejudice", author: "Jane Austen", isbn: "9780000000002" });
    expect(p.sections.map((s) => s.title)).toContain("Chapter II");
    expect(p.stats.paragraphs).toBeGreaterThan(5);
    expect(p.cover).toMatchObject({ mime: "image/png", bytes: PNG_1PX.byteLength });
    expect(JSON.stringify(p)).not.toContain('"bytes":{'); // no cover bytes in the preview

    const cover = await app.inject({ method: "GET", url: `/api/audiobooks/import/cover/${p.cover!.token}` });
    expect(cover.statusCode).toBe(200);
    expect(cover.headers["content-type"]).toBe("image/png");
    expect(new Uint8Array(cover.rawPayload)).toEqual(PNG_1PX);
    expect((await app.inject({ method: "GET", url: "/api/audiobooks/import/cover/nope" })).statusCode).toBe(404);

    const again = await app.inject({ method: "GET", url: `/api/audiobooks/import/${p.id}` });
    expect(again.json().id).toBe(p.id);
  });

  it("parses DOCX, text and Markdown uploads, honouring max_chars", async () => {
    const docx = await upload(makeDocx([{ style: "Heading1", text: "Chapter 1" }, { text: CH1[1]! }]), "book.docx");
    expect(docx.source.format).toBe("docx");
    const txt = await upload(new TextEncoder().encode(`Chapter 1\n\n${CH1.join(" ")}`), "book.txt", "&max_chars=150");
    expect(txt.max_chars).toBe(150);
    expect(txt.sections[0]!.paragraphs.every((p) => p.length <= 150)).toBe(true);
    const md = await upload(new TextEncoder().encode("## One\n\nText one.\n\n## Two\n\nText two."), "notes.md");
    expect(md.sections.map((s) => s.title)).toEqual(["One", "Two"]);
  });

  it("explains unsupported and empty uploads", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/api/audiobooks/import/parse?filename=x.txt",
      headers: { ...H, "content-type": "application/octet-stream" },
      payload: Buffer.alloc(0),
    });
    expect(empty.statusCode).toBe(400);
    const doc = await app.inject({
      method: "POST",
      url: "/api/audiobooks/import/parse?filename=old.doc",
      headers: { ...H, "content-type": "application/octet-stream" },
      payload: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]),
    });
    expect(doc.statusCode).toBe(415);
    expect(doc.json().detail).toMatch(/\.docx/);
  });

  it("takes a document content type as well as octet-stream", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/audiobooks/import/parse?filename=b.epub",
      headers: { ...H, "content-type": "application/epub+zip" },
      payload: Buffer.from(makeEpub()),
    });
    expect(res.statusCode).toBe(201);
  });

  it("imports pasted text", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/audiobooks/import/text",
      headers: H,
      payload: { text: `Chapter 1\n\n${CH1.join("\n\n")}\n\nChapter 2\n\n${CH2.join("\n\n")}`, title: "Pasted book" },
    });
    expect(res.statusCode).toBe(201);
    const p: ImportPreview = res.json();
    expect(p.metadata.title).toBe("Pasted book");
    expect(p.source.format).toBe("pasted");
    expect(p.sections.map((s) => s.title)).toEqual(["Chapter 1", "Chapter 2"]);
  });
});

describe("url", () => {
  const page = `<!doctype html><html lang="en"><head><title>Chapter 1 | Library</title></head>
<body><nav><a href="/">Home</a></nav><article><h1>Chapter 1</h1>${CH1.map((p) => `<p>${p}</p>`).join("")}</article></body></html>`;

  it("fetches a page through the injected fetch and extracts the article", async () => {
    let asked = "";
    setImportFetch((async (url: string | URL) => {
      asked = String(url);
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    }) as typeof fetch);
    const res = await app.inject({
      method: "POST",
      url: "/api/audiobooks/import/url",
      headers: H,
      payload: { url: "https://books.example/pride/chapter-1" },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(asked).toBe("https://books.example/pride/chapter-1");
    const p: ImportPreview = res.json();
    expect(p.source).toMatchObject({ format: "html", url: "https://books.example/pride/chapter-1" });
    expect(p.sections).toHaveLength(1);
    expect(p.sections[0]!.paragraphs).toEqual(CH1);
  });

  it("refuses non-http schemes before fetching", async () => {
    let called = false;
    setImportFetch((async () => {
      called = true;
      return new Response("");
    }) as typeof fetch);
    for (const url of ["file:///etc/passwd", "ftp://x.example/a", "javascript:alert(1)", "not a url"]) {
      const res = await app.inject({ method: "POST", url: "/api/audiobooks/import/url", headers: H, payload: { url } });
      expect(res.statusCode, url).toBe(422);
    }
    expect(called).toBe(false);
  });

  it("caps size and time", async () => {
    const big = new Uint8Array(2048).fill(65);
    const stream = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < 4; i++) c.enqueue(big);
          c.close();
        },
      });
    // No Content-Length: the running total still stops it.
    await expect(
      fetchDocument("https://x.example/a.txt", { fetch: (async () => new Response(stream())) as typeof fetch, maxBytes: 4096 }),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      fetchDocument("https://x.example/a.txt", {
        fetch: ((_u: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          })) as typeof fetch,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ status: 504 });
    await expect(
      fetchDocument("https://x.example/a.txt", { fetch: (async () => new Response("no", { status: 404 })) as typeof fetch }),
    ).rejects.toMatchObject({ status: 502 });
    expect(() => checkUrl("https://user:pw@x.example/")).toThrow();
  });
});

describe("commit", () => {
  it("applies edits and creates the book through core", async () => {
    const p = await upload(makeEpub(), "pride.epub");
    const idx = (title: string) => p.sections.findIndex((s) => s.title === title);
    const ch1 = idx("Chapter I");
    const ch2 = idx("Chapter II");
    const ch3 = idx("Chapter III");
    const about = idx("About the Author");
    const res = await app.inject({
      method: "POST",
      url: "/api/audiobooks/import/commit",
      headers: H,
      payload: {
        preview_id: p.id,
        edits: {
          metadata: { title: "Pride and Prejudice (Abridged)", narrator: undefined, publisher: "" },
          cover: "remove",
          sections: [
            // Split Chapter I in two.
            { title: "Chapter I, part one", kind: "chapter", included: true, parts: [{ section: ch1, end: 2 }] },
            { title: "Chapter I, part two", kind: "chapter", included: true, parts: [{ section: ch1, start: 2 }] },
            // Merge II and III.
            { title: "Chapters II and III", kind: "chapter", included: true, parts: [{ section: ch2 }, { section: ch3 }] },
            { title: "About the Author", kind: "back_matter", included: false, parts: [{ section: about }] },
          ],
        },
        settings: { cast_mode: "single" },
        headings: false,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const book = res.json();
    expect(book.title).toBe("Pride and Prejudice (Abridged)");
    expect(book.author).toBe("Jane Austen");
    expect(book.publisher).toBeNull();
    expect(book.cover_path).toBeNull();
    expect(book.chapters.map((c: { title: string }) => c.title)).toEqual([
      "Chapter I, part one",
      "Chapter I, part two",
      "Chapters II and III",
      "About the Author",
    ]);
    expect(book.chapters[3].included).toBe(false);
    expect(book.chapters[3].kind).toBe("back_matter");
    const paras = await app.inject({
      method: "GET",
      url: `/api/audiobooks/${book.id}/chapters/${book.chapters[2].id}/paragraphs`,
    });
    expect(paras.json().map((s: { text: string }) => s.text)).toEqual([...CH2, ...CH3]);

    // The preview is spent.
    const gone = await app.inject({ method: "GET", url: `/api/audiobooks/import/${p.id}` });
    expect(gone.statusCode).toBe(404);
  });

  it("keeps a replaced cover", async () => {
    const p = await upload(makeEpub({ cover: false }), "pride.epub");
    expect(p.cover).toBeNull();
    const put = await app.inject({
      method: "PUT",
      url: `/api/audiobooks/import/${p.id}/cover`,
      headers: { ...H, "content-type": "image/png" },
      payload: Buffer.from(PNG_1PX),
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json().cover.mime).toBe("image/png");
    const res = await app.inject({ method: "POST", url: "/api/audiobooks/import/commit", headers: H, payload: { preview_id: p.id } });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().cover_path).toBeTruthy();
    // Detected defaults when no edits: the copyright page stays excluded.
    const copyright = res.json().chapters.find((c: { title: string }) => c.title === "Copyright");
    expect(copyright.included).toBe(false);
  });

  it("rejects bad edits and unknown previews", async () => {
    const p = await upload(new TextEncoder().encode("Chapter 1\n\nSome text."), "a.txt");
    const bad = await app.inject({
      method: "POST",
      url: "/api/audiobooks/import/commit",
      headers: H,
      payload: { preview_id: p.id, edits: { sections: [{ title: "X", kind: "chapter", included: true, parts: [{ section: 9 }] }] } },
    });
    expect(bad.statusCode).toBe(422);
    const missing = await app.inject({ method: "POST", url: "/api/audiobooks/import/commit", headers: H, payload: { preview_id: "nope" } });
    expect(missing.statusCode).toBe(404);
  });
});

describe("preview store", () => {
  const m = () => ({
    title: "T", subtitle: null, author: null, language: null, description: null, isbn: null, publisher: null,
    publication_date: null, cover: null, warnings: [], sections: [{ title: "A", kind: "chapter" as const, included: true, paragraphs: ["x"] }],
  });

  it("expires previews and caps how many are kept", () => {
    let now = 0;
    const store = new PreviewStore(() => now);
    const first = store.add(m(), { filename: null, format: "pasted", url: null }, 1000);
    now = PREVIEW_TTL_MS - 1;
    expect(store.get(first.id)).not.toBeNull(); // reading extends it
    now += PREVIEW_TTL_MS - 1;
    expect(store.get(first.id)).not.toBeNull();
    now += PREVIEW_TTL_MS + 1;
    expect(store.get(first.id)).toBeNull();
    const ids = Array.from({ length: 10 }, () => store.add(m(), { filename: null, format: "pasted", url: null }, 1000).id);
    expect(store.get(ids[0]!)).toBeNull();
    expect(store.get(ids[9]!)).not.toBeNull();
  });

  it("applyEdits keeps detected sections when none are given", () => {
    const out = applyEdits(m(), { metadata: { author: "Someone" } });
    expect(out.author).toBe("Someone");
    expect(out.sections).toEqual(m().sections);
  });
});
