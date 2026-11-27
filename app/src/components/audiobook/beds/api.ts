/**
 * Beds client. HTTP against `server/src/routes/audiobook-beds.ts`, or under
 * `VITE_MOCK=1` an in-memory version that lays clips onto the mock chapter
 * story through `mockApi`, so the timeline shows them offline too.
 */

import { IS_MOCK, api, request, type GenerateRequest, type Model } from "@/lib/api";
import { audiobookApi } from "@/lib/audiobook-api";

import { DEFAULT_DUCK, layoutBed, narrationLength } from "./layout";
import type { Bed, BedExportInfo, BedInput, BedKind, BedPatch, DuckOptions, SoundscapeResult, SoundscapeSuggestion } from "./types";

export interface BedsApi {
  list(bookId: string, chapterId?: string | null): Promise<Bed[]>;
  create(bookId: string, chapterId: string, input: BedInput): Promise<Bed>;
  update(bookId: string, bedId: string, patch: BedPatch): Promise<Bed>;
  remove(bookId: string, bedId: string): Promise<void>;
  layoutChapter(bookId: string, chapterId: string): Promise<Bed[]>;
  exportInfo(bookId: string, chapterIds?: string[] | null): Promise<BedExportInfo>;
  /** Propose beds from the chapter's text. Creates nothing. */
  suggest(bookId: string, chapterId: string): Promise<SoundscapeResult>;
}

/** react-query keys. Exported for the export dialog and anyone else that shows beds. */
export const bedKeys = {
  list: (bookId: string, chapterId: string) => ["audiobook", bookId, "beds", chapterId] as const,
  all: (bookId: string) => ["audiobook", bookId, "beds"] as const,
  exportInfo: (bookId: string) => ["audiobook", bookId, "beds", "export-info"] as const,
};

const base = (id: string) => `/api/audiobooks/${encodeURIComponent(id)}`;
const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

const httpBedsApi: BedsApi = {
  list: (bookId, chapterId) =>
    request<Bed[]>(`${base(bookId)}/beds${chapterId ? `?chapter_id=${encodeURIComponent(chapterId)}` : ""}`),
  create: (bookId, chapterId, input) =>
    request<Bed>(`${base(bookId)}/chapters/${encodeURIComponent(chapterId)}/beds`, {
      method: "POST",
      ...json(input),
    }),
  update: (bookId, bedId, patch) =>
    request<Bed>(`${base(bookId)}/beds/${encodeURIComponent(bedId)}`, { method: "PATCH", ...json(patch) }),
  remove: (bookId, bedId) =>
    request<void>(`${base(bookId)}/beds/${encodeURIComponent(bedId)}`, { method: "DELETE" }),
  layoutChapter: (bookId, chapterId) =>
    request<Bed[]>(`${base(bookId)}/chapters/${encodeURIComponent(chapterId)}/beds/layout`, { method: "POST" }),
  suggest: (bookId, chapterId) =>
    request<SoundscapeResult>(`${base(bookId)}/chapters/${encodeURIComponent(chapterId)}/beds/suggest`, {
      method: "POST",
    }),
  exportInfo: (bookId, chapterIds) =>
    request<BedExportInfo>(
      `${base(bookId)}/beds/export-info${chapterIds?.length ? `?chapter_ids=${chapterIds.map(encodeURIComponent).join(",")}` : ""}`,
    ),
};

/* ------------------------------------------------------------------- mock */

const DEFAULTS: Record<BedKind, Required<Pick<BedInput, "gain_db" | "fade_in_s" | "fade_out_s" | "loop">> & { duck: Partial<DuckOptions> | null; duration_s: number }> = {
  music: { gain_db: -18, fade_in_s: 3, fade_out_s: 5, loop: true, duck: {}, duration_s: 60 },
  ambience: { gain_db: -24, fade_in_s: 4, fade_out_s: 4, loop: true, duck: { depth_db: 6 }, duration_s: 30 },
  sfx: { gain_db: -6, fade_in_s: 0, fade_out_s: 0, loop: false, duck: null, duration_s: 4 },
};

const mockBeds = new Map<string, Bed>();
let seq = 0;

async function storyOf(bookId: string, chapterId: string): Promise<string> {
  const book = await audiobookApi.getBook(bookId);
  const chapter = book.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error("Chapter not found");
  return chapter.story_id;
}

async function mockLayout(bed: Bed): Promise<Bed> {
  const story = await storyOf(bed.book_id, bed.chapter_id);
  for (const sid of bed.segment_ids) await api.deleteSegment(story, sid).catch(() => undefined);
  bed.segment_ids = [];
  const segments = await api.listSegments(story);
  const length = narrationLength(segments);
  if (bed.status === "ready" && bed.sound_id) {
    const sound = await api.getSound(bed.sound_id);
    const anchor = bed.anchor_segment_id ? (segments.find((s) => s.id === bed.anchor_segment_id)?.start_s ?? 0) : 0;
    const endSeg = bed.mode === "scene" && bed.end_segment_id ? segments.find((s) => s.id === bed.end_segment_id) : null;
    const end_s = endSeg ? endSeg.start_s + (endSeg.duration_s ?? 0) : null;
    const plan = layoutBed({ ...bed, sound_s: sound.duration_s, chapter_s: length, anchor_s: anchor, end_s });
    for (const clip of plan) {
      const seg = await api.createSegment(story, {
        text: "",
        speaker: bed.label,
        sound_id: bed.sound_id,
        track_index: bed.track_index,
        ...clip,
        gain_db: bed.gain_db,
      });
      bed.segment_ids.push(seg.id);
    }
  }
  bed.laid_out_s = length;
  bed.stale = false;
  bed.updated_at = new Date().toISOString();
  return { ...bed };
}

async function mockView(bed: Bed): Promise<Bed> {
  const story = await storyOf(bed.book_id, bed.chapter_id);
  const length = narrationLength(await api.listSegments(story));
  bed.stale = bed.kind !== "sfx" && bed.status === "ready" && length > 0 && Math.abs(length - bed.laid_out_s) > 0.05;
  return { ...bed };
}

async function pickModel(kind: BedKind, requested: string | null | undefined): Promise<Model> {
  const models = await api.listModels();
  const ready = (m: Model) => m.task === "gen" && (m.status === "installed" || m.status === "loaded");
  const category = kind === "music" ? "music" : "sfx";
  const pick = requested
    ? models.find((m) => m.id === requested)
    : (models.find((m) => ready(m) && m.category === category) ?? models.find((m) => ready(m) && m.category !== "voice"));
  if (!pick) throw new Error(`No ${category} model is installed. Install one from Models, or pick a sound from the library.`);
  return pick;
}

async function watchMock(bed: Bed): Promise<void> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 400));
    if (!mockBeds.has(bed.id) || !bed.job_id) return;
    const job = await api.getJob(bed.job_id);
    if (job.status === "done") {
      bed.sound_id = job.result?.sounds[0] ?? null;
      bed.status = bed.sound_id ? "ready" : "failed";
      if (bed.sound_id) await mockLayout(bed);
      return;
    }
    if (job.status === "error" || job.status === "cancelled") {
      bed.status = "failed";
      bed.error = job.error ?? `Generation ${job.status}.`;
      return;
    }
  }
}

const mockBedsApi: BedsApi = {
  suggest: (bookId, chapterId) => mockSuggest(bookId, chapterId),
  async list(bookId, chapterId) {
    const out: Bed[] = [];
    for (const bed of mockBeds.values()) {
      if (bed.book_id === bookId && (!chapterId || bed.chapter_id === chapterId)) out.push(await mockView(bed));
    }
    return out.sort((a, b) => a.track_index - b.track_index);
  },
  async create(bookId, chapterId, input) {
    const kind = input.kind ?? "music";
    const d = DEFAULTS[kind];
    if (!input.sound_id && !input.prompt?.trim()) throw new Error("A bed needs a sound_id or a prompt.");
    const story = await storyOf(bookId, chapterId);
    const used = new Set<number>([...mockBeds.values()].filter((b) => b.chapter_id === chapterId).map((b) => b.track_index));
    for (const s of await api.listSegments(story)) if (s.track_index > 0) used.add(s.track_index);
    let track = 1;
    while (used.has(track)) track++;
    if (track > 16) throw new Error("This chapter has no free track for another bed.");
    const sound = input.sound_id ? await api.getSound(input.sound_id) : null;
    const head = kind === "music" ? "Music" : kind === "ambience" ? "Ambience" : "SFX";
    const name = (input.prompt ?? sound?.name ?? "").trim();
    const duck = input.duck === false || input.duck === null || (input.duck === undefined && d.duck === null)
      ? null
      : { ...DEFAULT_DUCK, ...(d.duck ?? {}), ...(input.duck ?? {}) };
    const now = new Date().toISOString();
    const bed: Bed = {
      id: `bed-mock-${++seq}`,
      book_id: bookId,
      chapter_id: chapterId,
      kind,
      label: (input.label?.trim() || (name ? `${head}: ${name}` : head)).slice(0, 80),
      track_index: track,
      sound_id: sound?.id ?? null,
      prompt: input.prompt?.trim() || null,
      model_id: input.model_id ?? null,
      gain_db: input.gain_db ?? d.gain_db,
      fade_in_s: input.fade_in_s ?? d.fade_in_s,
      fade_out_s: input.fade_out_s ?? d.fade_out_s,
      loop: kind === "sfx" ? false : (input.loop ?? d.loop),
      mode: input.mode ?? "full",
      intro_s: input.intro_s ?? null,
      anchor_segment_id: input.anchor_segment_id ?? null,
      end_segment_id: input.end_segment_id ?? null,
      offset_s: input.offset_s ?? 0,
      duck,
      status: sound ? "ready" : "generating",
      job_id: null,
      error: null,
      segment_ids: [],
      laid_out_s: 0,
      created_at: now,
      updated_at: now,
      stale: false,
    };
    await api.updateTrack(story, track, { name: bed.label });
    mockBeds.set(bed.id, bed);
    if (!sound) {
      const model = await pickModel(kind, input.model_id);
      const req = {
        model: model.id,
        prompt: bed.prompt!,
        duration_s: Math.min(model.max_duration_s, input.duration_s ?? d.duration_s),
        variations: 1,
        tags: ["audiobook", kind],
      } as GenerateRequest;
      bed.model_id = model.id;
      bed.job_id = (await api.generate(req)).job_id;
      void watchMock(bed);
      return { ...bed };
    }
    return mockLayout(bed);
  },
  async update(_bookId, bedId, patch) {
    const bed = mockBeds.get(bedId);
    if (!bed) throw new Error("Bed not found");
    const { duck, label, ...rest } = patch;
    Object.assign(bed, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
    if (bed.kind === "sfx") bed.loop = false;
    if (patch.sound_id) bed.status = "ready";
    if (label?.trim()) {
      bed.label = label.trim().slice(0, 80);
      await api.updateTrack(await storyOf(bed.book_id, bed.chapter_id), bed.track_index, { name: bed.label });
    }
    if (duck !== undefined) bed.duck = duck === false || duck === null ? null : { ...DEFAULT_DUCK, ...(bed.duck ?? {}), ...duck };
    const onlyDuck = Object.keys(patch).every((k) => k === "duck" || k === "label");
    if (onlyDuck || bed.status !== "ready") return mockView(bed);
    return mockLayout(bed);
  },
  async remove(_bookId, bedId) {
    const bed = mockBeds.get(bedId);
    if (!bed) throw new Error("Bed not found");
    const story = await storyOf(bed.book_id, bed.chapter_id);
    for (const sid of bed.segment_ids) await api.deleteSegment(story, sid).catch(() => undefined);
    const left = await api.listSegments(story);
    if (!left.some((s) => s.track_index === bed.track_index)) await api.deleteTrack(story, bed.track_index).catch(() => undefined);
    mockBeds.delete(bedId);
  },
  async layoutChapter(_bookId, chapterId) {
    const out: Bed[] = [];
    for (const bed of mockBeds.values()) {
      if (bed.chapter_id !== chapterId) continue;
      out.push(bed.status === "ready" ? await mockLayout(bed) : await mockView(bed));
    }
    return out;
  },
  async exportInfo(bookId, chapterIds) {
    const book = await audiobookApi.getBook(bookId);
    const chosen = book.chapters.filter((c) => (chapterIds?.length ? chapterIds.includes(c.id) : c.included));
    const ready = [...mockBeds.values()].filter((b) => b.book_id === bookId && b.status === "ready");
    const withBeds = chosen.filter((c) => ready.some((b) => b.chapter_id === c.id));
    const samples = withBeds.filter((c) => c.kind === "retail_sample");
    const ambient = withBeds.filter((c) => ready.some((b) => b.chapter_id === c.id && b.kind !== "sfx" && b.mode === "full"));
    const warnings: BedExportInfo["warnings"] = [];
    if (withBeds.length) {
      warnings.push({
        id: "distribution",
        severity: "info",
        message:
          "Music and effects are mixed into this export. Some audiobook distributors accept narration only; check your distributor's audio requirements before including beds.",
        chapter_ids: withBeds.map((c) => c.id),
      });
      if (samples.length) {
        warnings.push({
          id: "retail_sample",
          severity: "warn",
          message: "ACX retail samples must not contain music. Leave beds out of this export.",
          chapter_ids: samples.map((c) => c.id),
        });
      }
      if (ambient.length) {
        warnings.push({
          id: "noise_floor",
          severity: "warn",
          message:
            "A bed that plays through a whole chapter fills the pauses, so the ACX noise-floor check (−60 dB) will measure the bed, not silence.",
          chapter_ids: ambient.map((c) => c.id),
        });
      }
    }
    return { has_beds: withBeds.length > 0, include_beds_default: samples.length === 0, warnings };
  },
};

/** The mock's stand-in for the server's keyword lexicon: a few rules, enough to
 *  exercise the review list offline. */
const MOCK_RULES: { kind: BedKind; label: string; test: RegExp; prompt: string }[] = [
  { kind: "ambience", label: "Night by the sea", test: /\b(night|lamp|bay|sea|waves?)\b/i, prompt: "calm sea waves at night, soft wind, no music" },
  { kind: "music", label: "Tense score", test: /\b(dark|afraid|nobody|shadow)\b/i, prompt: "sparse tense underscore, low strings, slow, instrumental" },
];
const MOCK_SFX: { label: string; test: RegExp; prompt: string }[] = [
  { label: "Door slam", test: /\bdoor\b[^.]{0,30}\bslamm?\w*|\bslamm?\w*\b[^.]{0,20}\bdoor\b/i, prompt: "heavy wooden door slamming shut" },
  { label: "Footsteps", test: /\bfootsteps?\b|\bstairs\b/i, prompt: "slow footsteps on wooden stairs" },
  { label: "Coat", test: /\bcoat\b/i, prompt: "rustle of a heavy coat being picked up" },
];

async function mockSuggest(bookId: string, chapterId: string): Promise<SoundscapeResult> {
  await new Promise((r) => setTimeout(r, 400));
  const lines = (await audiobookApi.listParagraphs(bookId, chapterId)).filter(
    (p) => p.track_index === 0 && p.kind === "line" && !p.is_heading && p.text.trim(),
  );
  if (!lines.length) return { source: "heuristic", suggestions: [], note: "This chapter has no text to read yet." };
  const all = lines.map((p) => p.text).join(" ");
  const out: SoundscapeSuggestion[] = [];
  const base = { mood: null, setting: null, source: "heuristic" as const };
  for (const r of MOCK_RULES) {
    if (!r.test.test(all)) continue;
    out.push({
      ...base,
      id: `mock-${r.kind}-${chapterId}`,
      kind: r.kind,
      label: r.label,
      prompt: r.prompt,
      start_paragraph_id: lines[0]!.id,
      end_paragraph_id: lines[lines.length - 1]!.id,
      reason: `Keywords across paragraphs 1–${lines.length}`,
      gain_db: r.kind === "music" ? -24 : -28,
      duck_db: r.kind === "music" ? 12 : 8,
      duration_s: 30,
    });
    break;
  }
  lines.forEach((p, i) => {
    const r = MOCK_SFX.find((x) => x.test.test(p.text));
    if (!r) return;
    out.push({
      ...base,
      id: `mock-sfx-${p.id}`,
      kind: "sfx",
      label: r.label,
      prompt: r.prompt,
      start_paragraph_id: p.id,
      end_paragraph_id: p.id,
      reason: `“${p.text.match(r.test)![0]}” (paragraph ${i + 1})`,
      gain_db: -12,
      duck_db: 0,
      duration_s: 4,
    });
  });
  return {
    source: "heuristic",
    suggestions: out,
    note: "Suggested from keywords in the text. Turn on the prompt assistant in Settings for suggestions that follow each scene.",
  };
}


export const bedsApi: BedsApi = IS_MOCK ? mockBedsApi : httpBedsApi;
