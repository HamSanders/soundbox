/**
 * Client for the import routes (`server/src/routes/audiobook-import.ts`).
 * Local to the import wizard; core's `audiobook-api.ts` covers the rest.
 * Under `VITE_MOCK=1` every call goes to `mock.ts`, which parses a bundled
 * sample instead of the user's file.
 */

import { IS_MOCK, request } from "@/lib/api";
import type { BookDetail, SettingsPatch } from "@/lib/audiobook-api";
import type { ChapterKind } from "@/lib/audiobook-types";

import { mockImportApi } from "./mock";

export interface ImportSection {
  title: string;
  kind: ChapterKind;
  included: boolean;
  paragraphs: string[];
  /** Scene breaks: a pause before paragraphs[i] (ascending, 0 < i < length). */
  breaks?: number[];
  characters: number;
}

export interface ImportMetadata {
  title: string | null;
  subtitle: string | null;
  author: string | null;
  language: string | null;
  description: string | null;
  isbn: string | null;
  publisher: string | null;
  publication_date: string | null;
}

export interface ImportPreview {
  id: string;
  expires_at: string;
  source: { filename: string | null; format: string; url: string | null };
  max_chars: number;
  metadata: ImportMetadata;
  cover: { token: string; mime: string; bytes: number } | null;
  sections: ImportSection[];
  warnings: string[];
  stats: { sections: number; paragraphs: number; characters: number };
}

export interface SectionPart {
  section: number;
  start?: number;
  end?: number;
}

export interface ImportEdits {
  metadata?: Partial<ImportMetadata>;
  cover?: "keep" | "remove";
  sections?: { title: string; kind: ChapterKind; included: boolean; parts: SectionPart[] }[];
}

export interface CommitRequest {
  preview_id: string;
  edits?: ImportEdits;
  settings?: SettingsPatch;
  project_id?: string | null;
  headings?: boolean;
}

/** One work in the bundled public-domain library (no text). */
export interface ClassicSummary {
  id: string;
  title: string;
  subtitle?: string;
  author: string;
  life: string;
  translator?: string;
  translator_life?: string;
  year: number;
  form: "story" | "poem" | "novella" | "children";
  genres: string[];
  description: string;
  language: string;
  words: number;
  chapters: number;
  minutes: number;
  source: { name: string; url: string };
}

export interface ClassicsLibrary {
  works: ClassicSummary[];
  /** Where the rights stand, for the footer of the library. */
  rights: string;
}

export interface ImportApi {
  listClassics(): Promise<ClassicsLibrary>;
  parseClassic(id: string, maxChars?: number): Promise<ImportPreview>;
  parseFile(file: File, maxChars?: number): Promise<ImportPreview>;
  parseText(text: string, title?: string | null, maxChars?: number): Promise<ImportPreview>;
  parseUrl(url: string, maxChars?: number): Promise<ImportPreview>;
  replaceCover(previewId: string, file: File): Promise<ImportPreview>;
  removeCover(previewId: string): Promise<ImportPreview>;
  discard(previewId: string): Promise<void>;
  commit(req: CommitRequest): Promise<BookDetail>;
  coverUrl(preview: ImportPreview): string | null;
}

const BASE = "/api/audiobooks/import";
const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const charsQuery = (maxChars?: number) => (maxChars ? `&max_chars=${maxChars}` : "");

const httpImportApi: ImportApi = {
  listClassics: () => request<ClassicsLibrary>("/api/audiobooks/classics"),
  parseClassic: (id, maxChars) => request<ImportPreview>(`${BASE}/classic`, json({ id, max_chars: maxChars })),
  parseFile: (file, maxChars) =>
    request<ImportPreview>(`${BASE}/parse?filename=${encodeURIComponent(file.name)}${charsQuery(maxChars)}`, {
      method: "POST",
      body: file,
      headers: { "Content-Type": "application/octet-stream" },
    }),
  parseText: (text, title, maxChars) =>
    request<ImportPreview>(`${BASE}/text`, json({ text, title: title || null, max_chars: maxChars })),
  parseUrl: (url, maxChars) => request<ImportPreview>(`${BASE}/url`, json({ url, max_chars: maxChars })),
  replaceCover: (previewId, file) =>
    request<ImportPreview>(`${BASE}/${encodeURIComponent(previewId)}/cover`, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "image/png" },
    }),
  removeCover: (previewId) =>
    request<ImportPreview>(`${BASE}/${encodeURIComponent(previewId)}/cover`, { method: "DELETE" }),
  discard: (previewId) => request<void>(`${BASE}/${encodeURIComponent(previewId)}`, { method: "DELETE" }),
  commit: (req) => request<BookDetail>(`${BASE}/commit`, json(req)),
  coverUrl: (preview) => (preview.cover ? `${BASE}/cover/${preview.cover.token}` : null),
};

export const importApi: ImportApi = IS_MOCK ? mockImportApi : httpImportApi;

/** Accepted by the file picker; the server sniffs the bytes either way. */
export const ACCEPT = ".epub,.pdf,.docx,.odt,.rtf,.fb2,.zip,.txt,.md,.markdown,.html,.htm,.xhtml";
