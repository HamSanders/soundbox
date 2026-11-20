/**
 * Import previews: a parsed manuscript held in memory between "parse" and
 * "commit", so the review screen can edit it without re-uploading the file.
 * Previews expire after `PREVIEW_TTL_MS`; only the newest `MAX_PREVIEWS` are
 * kept, since each holds a whole book's text and cover.
 *
 * `applyEdits` turns a preview plus the review screen's edits into the final
 * `Manuscript` handed to the book store. It is pure and tested on its own.
 */

import { randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import { CHAPTER_KINDS } from "../store.js";
import type { ChapterKind, Manuscript, ManuscriptSection } from "../types.js";
import type { ManuscriptFormat } from "./index.js";

export const PREVIEW_TTL_MS = 60 * 60 * 1000;
export const MAX_PREVIEWS = 8;

export interface StoredPreview {
  id: string;
  cover_token: string | null;
  manuscript: Manuscript;
  source: { filename: string | null; format: ManuscriptFormat | "pasted"; url: string | null };
  max_chars: number;
  created_at: number;
  expires_at: number;
}

export type ManuscriptMetadata = Pick<
  Manuscript,
  "title" | "subtitle" | "author" | "language" | "description" | "isbn" | "publisher" | "publication_date"
>;

/** What the client sees: everything but the cover bytes. */
export interface ImportPreview {
  id: string;
  expires_at: string;
  source: StoredPreview["source"];
  max_chars: number;
  metadata: ManuscriptMetadata;
  cover: { token: string; mime: string; bytes: number } | null;
  sections: (ManuscriptSection & { characters: number })[];
  warnings: string[];
  stats: { sections: number; paragraphs: number; characters: number };
}

export class PreviewStore {
  private readonly previews = new Map<string, StoredPreview>();

  constructor(private readonly now: () => number = Date.now) {}

  private sweep(): void {
    const t = this.now();
    for (const [id, p] of this.previews) if (p.expires_at <= t) this.previews.delete(id);
    while (this.previews.size > MAX_PREVIEWS) {
      const oldest = this.previews.keys().next().value as string;
      this.previews.delete(oldest);
    }
  }

  add(manuscript: Manuscript, source: StoredPreview["source"], maxChars: number): StoredPreview {
    const t = this.now();
    const preview: StoredPreview = {
      id: randomUUID(),
      cover_token: manuscript.cover ? randomBytes(16).toString("hex") : null,
      manuscript,
      source,
      max_chars: maxChars,
      created_at: t,
      expires_at: t + PREVIEW_TTL_MS,
    };
    this.previews.set(preview.id, preview);
    this.sweep();
    return preview;
  }

  get(id: string): StoredPreview | null {
    this.sweep();
    const p = this.previews.get(id) ?? null;
    // Reading a preview keeps it alive while the user works on the review screen.
    if (p) p.expires_at = this.now() + PREVIEW_TTL_MS;
    return p;
  }

  byCoverToken(token: string): StoredPreview | null {
    this.sweep();
    for (const p of this.previews.values()) if (p.cover_token && p.cover_token === token) return p;
    return null;
  }

  setCover(id: string, cover: { bytes: Uint8Array; mime: string } | null): StoredPreview | null {
    const p = this.get(id);
    if (!p) return null;
    p.manuscript.cover = cover;
    p.cover_token = cover ? randomBytes(16).toString("hex") : null;
    return p;
  }

  delete(id: string): boolean {
    return this.previews.delete(id);
  }
}

export function toPreview(p: StoredPreview): ImportPreview {
  const m = p.manuscript;
  const sections = m.sections.map((s) => ({
    ...s,
    characters: s.paragraphs.reduce((n, para) => n + para.length, 0),
  }));
  return {
    id: p.id,
    expires_at: new Date(p.expires_at).toISOString(),
    source: p.source,
    max_chars: p.max_chars,
    metadata: {
      title: m.title,
      subtitle: m.subtitle,
      author: m.author,
      language: m.language,
      description: m.description,
      isbn: m.isbn,
      publisher: m.publisher,
      publication_date: m.publication_date,
    },
    cover: m.cover && p.cover_token ? { token: p.cover_token, mime: m.cover.mime, bytes: m.cover.bytes.byteLength } : null,
    sections,
    warnings: m.warnings,
    stats: {
      sections: sections.length,
      paragraphs: sections.reduce((n, s) => n + s.paragraphs.length, 0),
      characters: sections.reduce((n, s) => n + s.characters, 0),
    },
  };
}

/* ---------------------------------------------------------------- edits */

const kindSchema = z.enum(CHAPTER_KINDS as [ChapterKind, ...ChapterKind[]]);

const partSchema = z.object({
  /** Index into the preview's sections. */
  section: z.number().int().min(0),
  /** Paragraph range [start, end) within that section; defaults to all of it. */
  start: z.number().int().min(0).optional(),
  end: z.number().int().min(0).optional(),
});

const nullableText = (max: number) => z.string().trim().max(max).nullish();

export const importEditsSchema = z
  .object({
    metadata: z
      .object({
        title: nullableText(300),
        subtitle: nullableText(300),
        author: nullableText(300),
        language: nullableText(35),
        description: nullableText(20000),
        isbn: nullableText(40),
        publisher: nullableText(300),
        publication_date: nullableText(40),
      })
      .partial()
      .optional(),
    /**
     * The book's chapters in order. Each is built from one or more parts of
     * the preview's sections: two parts merge sections, a range splits one.
     * Omitted: the preview's sections as detected.
     */
    sections: z
      .array(
        z.object({
          title: z.string().trim().max(300),
          kind: kindSchema,
          included: z.boolean(),
          parts: z.array(partSchema).min(1).max(1000),
        }),
      )
      .max(2000)
      .optional(),
    /** "remove" drops the cover; a replaced cover is uploaded to the preview first. */
    cover: z.enum(["keep", "remove"]).optional(),
  })
  .default({});

export type ImportEdits = z.infer<typeof importEditsSchema>;

export class EditError extends Error {}

/** The final manuscript: the preview with the review screen's edits applied. */
export function applyEdits(source: Manuscript, edits: ImportEdits): Manuscript {
  const meta = edits.metadata ?? {};
  const pick = <K extends keyof ManuscriptMetadata>(key: K): Manuscript[K] =>
    meta[key] === undefined ? source[key] : ((meta[key] || null) as Manuscript[K]);
  const sections: ManuscriptSection[] = edits.sections
    ? edits.sections.map((s, i) => {
        const paragraphs = s.parts.flatMap((part) => {
          const from = source.sections[part.section];
          if (!from) throw new EditError(`Section ${i + 1} refers to a section that doesn't exist.`);
          const start = part.start ?? 0;
          const end = Math.min(part.end ?? from.paragraphs.length, from.paragraphs.length);
          if (start > end) throw new EditError(`Section ${i + 1} has an empty or reversed paragraph range.`);
          return from.paragraphs.slice(start, end);
        });
        return { title: s.title || `Chapter ${i + 1}`, kind: s.kind, included: s.included, paragraphs };
      })
    : source.sections.map((s) => ({ ...s, paragraphs: [...s.paragraphs] }));
  const result: Manuscript = {
    title: pick("title"),
    subtitle: pick("subtitle"),
    author: pick("author"),
    language: pick("language"),
    description: pick("description"),
    isbn: pick("isbn"),
    publisher: pick("publisher"),
    publication_date: pick("publication_date"),
    cover: edits.cover === "remove" ? null : source.cover,
    sections: sections.filter((s) => s.paragraphs.length > 0),
    warnings: [...source.warnings],
  };
  if (!result.sections.length) throw new EditError("The book has no sections with text.");
  return result;
}
