/**
 * Audiobooks: the bundled library of public-domain classics.
 *
 * `classics.json` is built by `scripts/build-classics.mjs` from Standard
 * Ebooks editions (US public domain texts; the editors' work under CC0 1.0).
 * It ships with the server, so "Start from a classic" works offline. A work
 * becomes an ordinary import preview, so the review screen, edits and commit
 * are the same as for any manuscript.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ManuscriptSection, Manuscript } from "../types.js";

export type ClassicForm = "story" | "poem" | "novella" | "children";

export interface ClassicWork {
  id: string;
  title: string;
  subtitle?: string;
  author: string;
  /** Author's birth–death years, e.g. "1809–1849". */
  life: string;
  translator?: string;
  translator_life?: string;
  /** Year of first publication. */
  year: number;
  form: ClassicForm;
  genres: string[];
  description: string;
  language: string;
  words: number;
  source: { name: string; url: string };
  sections: ManuscriptSection[];
}

/** A catalogue entry: everything but the text. */
export type ClassicSummary = Omit<ClassicWork, "sections"> & {
  chapters: number;
  /** Listening time at an audiobook pace of 155 words a minute. */
  minutes: number;
};

/** Words a minute for the length estimate. Our own round figure: the real
 *  length depends on the voice, the speed setting and the pacing. */
const WPM = 155;

/** Where people outside the US should look before using a work. */
export const RIGHTS_NOTE =
  "Public domain in the United States. Every author and translator here died more than 70 years ago, so these works " +
  "are also out of copyright in countries with a life-plus-70 term. Some countries have longer terms: if you're outside " +
  "the US, check your local law before publishing a recording.";

function catalogPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const local = join(here, "classics.json");
  if (existsSync(local)) return local;
  // Built server without a copied asset: read it from src/.
  return join(here, "..", "..", "..", "src", "audiobook", "classics", "classics.json");
}

let cache: ClassicWork[] | null = null;

export function classicWorks(): ClassicWork[] {
  if (!cache) {
    const raw = JSON.parse(readFileSync(catalogPath(), "utf8")) as { works: ClassicWork[] };
    cache = raw.works;
  }
  return cache;
}

export function listClassics(): ClassicSummary[] {
  return classicWorks().map(({ sections, ...w }) => ({
    ...w,
    chapters: sections.length,
    minutes: Math.max(1, Math.round(w.words / WPM)),
  }));
}

export function getClassic(id: string): ClassicWork | null {
  return classicWorks().find((w) => w.id === id) ?? null;
}

/** A work as a manuscript for the import preview. */
export function classicManuscript(work: ClassicWork): Manuscript {
  const credit = work.translator ? `${work.author}, translated by ${work.translator}` : work.author;
  return {
    title: work.title,
    subtitle: work.subtitle ?? null,
    author: credit,
    language: work.language,
    description: work.description,
    isbn: null,
    publisher: null,
    publication_date: String(work.year),
    cover: null,
    sections: work.sections.map((s) => ({
      ...s,
      paragraphs: [...s.paragraphs],
      ...(s.breaks ? { breaks: [...s.breaks] } : {}),
    })),
    warnings: [],
  };
}
