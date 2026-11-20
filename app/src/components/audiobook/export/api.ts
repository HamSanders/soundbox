/**
 * Client for the export area's routes (`server/src/routes/audiobook-export.ts`):
 * ffmpeg status, QC analysis, credits and samples, exports and their history.
 *
 * Under `VITE_MOCK=1` an in-memory fake answers instead, built on core's
 * mock book so chapter ids line up. Setting `localStorage["mirli.mock.ffmpeg"]`
 * to "missing" makes the fake report no ffmpeg, to preview that state.
 */

import { IS_MOCK, request } from "@/lib/api";
import { audiobookApi } from "@/lib/audiobook-api";
import type {
  BookExport,
  Chapter,
  ChapterQc,
  ExportRequest,
  LoudnessReport,
  MasteringPresetId,
  ParagraphTiming,
  QcCheck,
} from "@/lib/audiobook-types";

export interface FfmpegInfo {
  available: boolean;
  version: string | null;
  encoders: { mp3: boolean; aac: boolean; flac: boolean };
  message: string | null;
}

export interface BookExportRecord extends BookExport {
  kind: "book" | "sample";
  progress: number;
  message: string | null;
  size_bytes: number | null;
  filename: string | null;
  updated_at: string;
}

export interface AnalyzeRequest {
  mastering?: MasteringPresetId;
  chapter_ids?: string[];
  include_beds?: boolean;
}

export interface CreditsRequest {
  opening?: boolean;
  closing?: boolean;
  replace?: boolean;
  sample?: { chapter_id?: string; target_s?: number; format?: "mp3" | "wav" } | false;
}

export interface CreditsResult {
  opening: Chapter | null;
  closing: Chapter | null;
  sample: BookExportRecord | null;
}

/** Soundscape's `GET /:id/beds/export-info`. */
export interface BedsExportInfo {
  has_beds: boolean;
  include_beds_default: boolean;
  warnings: string[];
}

export interface ExportApi {
  /** Null when the beds area isn't installed (route missing). */
  bedsInfo(bookId: string, chapterIds: string[]): Promise<BedsExportInfo | null>;
  ffmpeg(refresh?: boolean): Promise<FfmpegInfo>;
  analyze(bookId: string, req: AnalyzeRequest): Promise<ChapterQc[]>;
  credits(bookId: string, req: CreditsRequest): Promise<CreditsResult>;
  startExport(bookId: string, req: ExportRequest): Promise<BookExportRecord>;
  listExports(bookId: string): Promise<BookExportRecord[]>;
  deleteExport(bookId: string, exportId: string): Promise<void>;
  downloadUrl(bookId: string, exportId: string): string | null;
  timings(bookId: string, chapterId: string): Promise<ParagraphTiming[]>;
}

const base = (id: string) => `/api/audiobooks/${encodeURIComponent(id)}`;
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

const httpExportApi: ExportApi = {
  bedsInfo: (bookId, chapterIds) =>
    request<BedsExportInfo>(
      `${base(bookId)}/beds/export-info?chapter_ids=${chapterIds.map(encodeURIComponent).join(",")}`,
    ).catch(() => null),
  ffmpeg: (refresh) => request(`/api/audiobooks/ffmpeg${refresh ? "?refresh=1" : ""}`),
  analyze: (bookId, req) => request(`${base(bookId)}/master/analyze`, post(req)),
  credits: (bookId, req) => request(`${base(bookId)}/credits`, post(req)),
  startExport: (bookId, req) => request(`${base(bookId)}/exports`, post(req)),
  listExports: (bookId) => request(`${base(bookId)}/exports`),
  deleteExport: (bookId, exportId) =>
    request(`${base(bookId)}/exports/${encodeURIComponent(exportId)}`, { method: "DELETE" }),
  downloadUrl: (bookId, exportId) => `${base(bookId)}/exports/${encodeURIComponent(exportId)}/download`,
  timings: (bookId, chapterId) => request(`${base(bookId)}/chapters/${encodeURIComponent(chapterId)}/timings`),
};

/* ------------------------------------------------------------------ mock */

const mockExports = new Map<string, BookExportRecord[]>();

function mockReport(i: number, preset: MasteringPresetId): LoudnessReport {
  const raw = preset === "none";
  return {
    rms_db: raw ? -26.4 + i * 0.3 : -20.1 + (i % 3) * 0.2,
    peak_dbfs: raw ? -1.2 : -3.6,
    noise_floor_db: raw ? -120 : -68.9 + (i % 2),
    integrated_lufs: raw ? -24.8 : -19.2,
    duration_s: 600 + i * 137,
    head_silence_s: raw ? 0.05 : 0.75,
    tail_silence_s: raw ? 0.3 : 2,
    sample_rate: raw ? 24_000 : 44_100,
    channels: 1,
  };
}

function mockChecks(r: LoudnessReport, preset: MasteringPresetId): QcCheck[] {
  if (preset === "podcast") {
    return [
      { id: "loudness", pass: true, message: "Integrated loudness -16.0 LUFS (target -16 ±1)." },
      { id: "peak", pass: true, message: "True peak -1.1 dBTP (at most -1)." },
      { id: "sample_rate", pass: true, message: "Sample rate 44100 Hz (44100 Hz required)." },
    ];
  }
  return [
    { id: "rms", pass: r.rms_db >= -23 && r.rms_db <= -18, message: `RMS ${r.rms_db.toFixed(1)} dB (ACX: -23 to -18 dB).` },
    { id: "peak", pass: r.peak_dbfs <= -3, message: `True peak ${r.peak_dbfs.toFixed(1)} dB (ACX: at most -3 dB).` },
    { id: "noise_floor", pass: r.noise_floor_db <= -60, message: `Noise floor ${r.noise_floor_db <= -120 ? "-inf" : `${r.noise_floor_db.toFixed(1)} dB`} (ACX: at most -60 dB).` },
    {
      id: "digital_silence",
      pass: r.noise_floor_db > -100,
      message: r.noise_floor_db > -100 ? "Pauses carry room tone." : "Pauses are digital silence; ACX can reject that as over-processed. Add room tone.",
    },
    { id: "room_tone_head", pass: r.head_silence_s >= 0.5, message: `Head room tone ${r.head_silence_s.toFixed(2)} s (ACX: 0.5–1 s).` },
    { id: "room_tone_tail", pass: r.tail_silence_s >= 1, message: `Tail room tone ${r.tail_silence_s.toFixed(2)} s (ACX: 1–5 s).` },
    { id: "sample_rate", pass: r.sample_rate === 44_100, message: `Sample rate ${r.sample_rate} Hz (44100 Hz required).` },
    { id: "max_length", pass: true, message: `Length ${(r.duration_s / 60).toFixed(1)} min (at most 120 per file).` },
  ];
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mockExportApi: ExportApi = {
  async bedsInfo() {
    return null;
  },
  async ffmpeg() {
    let missing = false;
    try {
      missing = localStorage.getItem("mirli.mock.ffmpeg") === "missing";
    } catch {
      // storage blocked: report ffmpeg present
    }
    return missing
      ? {
          available: false,
          version: null,
          encoders: { mp3: false, aac: false, flac: false },
          message:
            "ffmpeg was not found on PATH. WAV export works without it; MP3, FLAC and M4B need it. Install ffmpeg (https://ffmpeg.org/download.html) and restart Mirli.",
        }
      : { available: true, version: "7.1", encoders: { mp3: true, aac: true, flac: true }, message: null };
  },
  async analyze(bookId, req) {
    await delay(500);
    const book = await audiobookApi.getBook(bookId);
    const preset = req.mastering ?? book.settings.mastering;
    const ids = req.chapter_ids?.length ? new Set(req.chapter_ids) : null;
    const chapters = book.chapters.filter((c) => (ids ? ids.has(c.id) : c.included));
    return chapters.map((c, i) => {
      if (c.stats.voiced === 0) {
        return {
          chapter_id: c.id,
          report: { ...mockReport(i, preset), duration_s: 0 },
          checks: [{ id: "audio", pass: false, message: `${c.title}: Nothing to export: no line in this story has audio yet.` }],
        };
      }
      const report = mockReport(i, preset);
      return { chapter_id: c.id, report, checks: mockChecks(report, preset) };
    });
  },
  async credits(bookId, req) {
    const result: CreditsResult = { opening: null, closing: null, sample: null };
    const book = await audiobookApi.getBook(bookId);
    if (req.opening) {
      result.opening =
        book.chapters.find((c) => c.kind === "opening_credits") ??
        (await audiobookApi.addChapter(bookId, {
          title: "Opening Credits",
          kind: "opening_credits",
          position: 0,
          paragraphs: [`${book.title}.`, ...(book.author ? [`Written by ${book.author}.`] : []), "Narrated by a digital voice."],
        }));
    }
    if (req.closing) {
      const fresh = await audiobookApi.getBook(bookId);
      result.closing =
        fresh.chapters.find((c) => c.kind === "closing_credits") ??
        (await audiobookApi.addChapter(bookId, {
          title: "Closing Credits",
          kind: "closing_credits",
          paragraphs: ["The End.", `You have been listening to ${book.title}.`, "Narrated by a digital voice."],
        }));
    }
    if (req.sample) {
      result.sample = await mockExportApi.startExport(bookId, {
        format: req.sample.format ?? "mp3",
        layout: "single",
        mastering: "acx",
        include_cover: false,
        include_transcripts: false,
      });
      result.sample.kind = "sample";
    }
    return result;
  },
  async startExport(bookId, req) {
    const now = new Date().toISOString();
    const record: BookExportRecord = {
      id: `export-${Math.random().toString(36).slice(2, 10)}`,
      book_id: bookId,
      kind: "book",
      request: { ...req, layout: req.format === "m4b" ? "single" : req.layout },
      status: "running",
      path: null,
      qc: [],
      error: null,
      created_at: now,
      updated_at: now,
      progress: 0,
      message: "Mastering",
      size_bytes: null,
      filename: null,
    };
    mockExports.set(bookId, [record, ...(mockExports.get(bookId) ?? [])]);
    void (async () => {
      for (let p = 0.2; p < 1; p += 0.2) {
        await delay(400);
        record.progress = p;
        record.message = p < 0.6 ? "Mastering" : "Encoding";
      }
      record.qc = await mockExportApi.analyze(bookId, { mastering: req.mastering, chapter_ids: req.chapter_ids });
      record.status = "done";
      record.progress = 1;
      record.message = null;
      const ext = record.request.layout === "files" || req.include_transcripts ? "zip" : req.format;
      record.filename = `${record.kind === "sample" ? "Sample" : "Book"}.${ext}`;
      record.path = `/mock/${record.filename}`;
      record.size_bytes = 48_000_000;
    })();
    return { ...record };
  },
  async listExports(bookId) {
    return (mockExports.get(bookId) ?? []).map((r) => ({ ...r }));
  },
  async deleteExport(bookId, exportId) {
    mockExports.set(bookId, (mockExports.get(bookId) ?? []).filter((r) => r.id !== exportId));
  },
  downloadUrl: () => null,
  async timings() {
    return [];
  },
};

export const exportApi: ExportApi = IS_MOCK ? mockExportApi : httpExportApi;
