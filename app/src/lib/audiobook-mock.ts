/**
 * In-memory audiobooks for `VITE_MOCK=1`: one sample book with front matter,
 * three chapters and two characters, seeded on first use. Chapters are real
 * mock stories (through `mockApi`), so "Open in timeline" works offline too.
 * Like the rest of the mock, everything resets on reload.
 */

import type { SegmentPatch, StorySegment } from "./api";
import type {
  AudiobookApi,
  AudiobookEvent,
  BookDetail,
  BookNote,
  BookPatch,
  BookStats,
  BookSummary,
  ChapterWithStats,
  DiffStatus,
  SnapshotDiff,
  SnapshotInfo,
  Paragraph,
  ParagraphStatus,
  ReplaceResult,
} from "./audiobook-api";
import type { Book, BookSettings, Chapter, ChapterKind, ChapterStats, Character } from "./audiobook-types";
import { mockApi } from "./mock";

interface Meta {
  character_id: string | null;
  locked: boolean;
  is_heading: boolean;
  model_id: string | null;
  voiced_sound_id: string | null;
  voiced_text: string | null;
  stale_sound_id: string | null;
}

const DEFAULT_SETTINGS: BookSettings = {
  model_id: null,
  narrator_voice_id: null,
  request_options: {},
  pacing: { paragraph_gap_s: 0.5, heading_gap_s: 1.5, head_room_tone_s: 0.75, tail_room_tone_s: 2 },
  mastering: "acx",
  cast_mode: "single",
};

const books: Book[] = [];
const chapters: Chapter[] = [];
const characters: Character[] = [];
const meta = new Map<string, Meta>();
/** segment id -> chapter id, for paragraph routes that only carry the segment. */
const segmentChapter = new Map<string, string>();
const covers = new Map<string, string>();
const notes: BookNote[] = [];

interface MockSnapshot {
  info: SnapshotInfo;
  book: Book;
  characters: Character[];
  chapters: {
    id: string;
    title: string;
    kind: ChapterKind;
    included: boolean;
    paragraphs: Paragraph[];
  }[];
}
const snapshots: MockSnapshot[] = [];
const listeners = new Map<string, Set<(e: AudiobookEvent) => void>>();
let seq = 0;

const id = (prefix: string) => `${prefix}-mock-${++seq}`;
const now = () => new Date().toISOString();

function emit(bookId: string, event: AudiobookEvent): void {
  for (const fn of listeners.get(bookId) ?? []) setTimeout(() => fn(event), 0);
}

function metaOf(segmentId: string): Meta {
  let m = meta.get(segmentId);
  if (!m) {
    m = {
      character_id: null,
      locked: false,
      is_heading: false,
      model_id: null,
      voiced_sound_id: null,
      voiced_text: null,
      stale_sound_id: null,
    };
    meta.set(segmentId, m);
  }
  return m;
}

function touch(bookId: string): void {
  const book = books.find((b) => b.id === bookId);
  if (book) book.updated_at = now();
}

function requireBook(bookId: string): Book {
  const book = books.find((b) => b.id === bookId);
  if (!book) throw new Error("Book not found");
  return book;
}

function requireChapter(bookId: string, chapterId: string): Chapter {
  const chapter = chapters.find((c) => c.id === chapterId && c.book_id === bookId);
  if (!chapter) throw new Error("Chapter not found");
  return chapter;
}

function chapterOfSegment(bookId: string, segmentId: string): Chapter {
  const chapter = chapters.find((c) => c.id === segmentChapter.get(segmentId));
  if (!chapter || chapter.book_id !== bookId) throw new Error("Paragraph not found");
  return chapter;
}

function bookChapters(bookId: string): Chapter[] {
  return chapters.filter((c) => c.book_id === bookId).sort((a, b) => a.position - b.position);
}

function voiceFor(book: Book, characterId: string | null): string | null {
  const narrator = book.settings.narrator_voice_id;
  if (book.settings.cast_mode === "single" || !characterId) return narrator;
  return characters.find((c) => c.id === characterId)?.voice_id ?? narrator;
}

/** Same rule as the server: a new take records its text; a later edit, or a
 *  take marked stale, reads as stale until the next take. */
function statusOf(segment: StorySegment, m: Meta): ParagraphStatus {
  if (m.locked) return "locked";
  if (segment.kind === "pause") return "voiced";
  if (!segment.sound_id) return "unvoiced";
  if (m.voiced_sound_id !== segment.sound_id) {
    m.voiced_sound_id = segment.sound_id;
    m.voiced_text = segment.text;
  }
  if (m.stale_sound_id === segment.sound_id) return "stale";
  return m.voiced_text !== segment.text ? "stale" : "voiced";
}

async function paragraphsOf(chapter: Chapter): Promise<Paragraph[]> {
  const segments = await mockApi.listSegments(chapter.story_id);
  return segments.map((segment) => {
    segmentChapter.set(segment.id, chapter.id);
    const m = metaOf(segment.id);
    return {
      ...segment,
      segment_id: segment.id,
      chapter_id: chapter.id,
      character_id: m.character_id,
      locked: m.locked,
      is_heading: m.is_heading,
      model_id: m.model_id,
      status: statusOf(segment, m),
    };
  });
}

function openNotes(chapterId: string): number {
  return notes.filter((n) => n.chapter_id === chapterId && !n.resolved).length;
}

async function chapterWithStats(chapter: Chapter): Promise<ChapterWithStats & { stale: number }> {
  const paragraphs = (await paragraphsOf(chapter)).filter((p) => p.kind === "line");
  const stats: ChapterStats = {
    chapter_id: chapter.id,
    paragraphs: paragraphs.length,
    voiced: paragraphs.filter((p) => p.sound_id).length,
    locked: paragraphs.filter((p) => p.locked).length,
    characters: paragraphs.reduce((n, p) => n + p.text.length, 0),
    duration_s:
      Math.round(paragraphs.reduce((n, p) => n + (p.sound_id ? (p.duration_s ?? 0) : 0), 0) * 100) /
      100,
  };
  const status =
    stats.voiced === 0 ? "empty" : stats.voiced >= stats.paragraphs ? "voiced" : "partial";
  return {
    ...chapter,
    stats,
    status,
    open_notes: openNotes(chapter.id),
    stale: paragraphs.filter((p) => p.status === "stale").length,
  };
}

async function detail(bookId: string): Promise<BookDetail> {
  const book = requireBook(bookId);
  const list = await Promise.all(bookChapters(bookId).map(chapterWithStats));
  const stats: BookStats = {
    chapters: list.length,
    paragraphs: 0,
    voiced: 0,
    stale: 0,
    locked: 0,
    characters: 0,
    duration_s: 0,
    open_notes: 0,
  };
  const out: ChapterWithStats[] = [];
  for (const { stale, ...c } of list) {
    stats.paragraphs += c.stats.paragraphs;
    stats.voiced += c.stats.voiced;
    stats.locked += c.stats.locked;
    stats.characters += c.stats.characters;
    stats.duration_s += c.stats.duration_s;
    stats.stale += stale;
    stats.open_notes += c.open_notes;
    out.push(c);
  }
  stats.duration_s = Math.round(stats.duration_s * 100) / 100;
  return {
    ...structuredClone(book),
    chapters: out,
    characters: structuredClone(characters.filter((c) => c.book_id === bookId)),
    stats,
  };
}

function newBook(fields: BookPatch & { title: string }): Book {
  const book: Book = {
    id: id("book"),
    project_id: fields.project_id ?? null,
    title: fields.title,
    subtitle: fields.subtitle ?? null,
    author: fields.author ?? null,
    narrator: fields.narrator ?? null,
    description: fields.description ?? null,
    language: fields.language ?? "en",
    genres: fields.genres ?? [],
    series: fields.series ?? null,
    series_index: fields.series_index ?? null,
    isbn: fields.isbn ?? null,
    publisher: fields.publisher ?? null,
    publication_date: fields.publication_date ?? null,
    cover_path: null,
    settings: {
      ...DEFAULT_SETTINGS,
      ...fields.settings,
      pacing: { ...DEFAULT_SETTINGS.pacing, ...fields.settings?.pacing },
    },
    created_at: now(),
    updated_at: now(),
  };
  books.unshift(book);
  return book;
}

async function addChapter(
  book: Book,
  fields: {
    title: string;
    kind?: ChapterKind;
    included?: boolean;
    position?: number | null;
    paragraphs?: (string | { text: string; character?: string; heading?: boolean; voiced?: boolean })[];
  },
): Promise<Chapter> {
  const story = await mockApi.createStory(fields.title, book.project_id, "script");
  const existing = bookChapters(book.id);
  const position =
    fields.position == null ? existing.length : Math.max(0, Math.min(fields.position, existing.length));
  for (const c of existing) if (c.position >= position) c.position += 1;
  const chapter: Chapter = {
    id: id("chapter"),
    book_id: book.id,
    story_id: story.id,
    position,
    title: fields.title,
    kind: fields.kind ?? "chapter",
    included: fields.included ?? true,
  };
  chapters.push(chapter);
  const lines = (fields.paragraphs ?? []).map((p) => (typeof p === "string" ? { text: p } : p));
  const made = await Promise.all(
    lines.map((line, i) => {
      const character = line.character
        ? characters.find((c) => c.book_id === book.id && c.name === line.character)
        : undefined;
      const voiced = "voiced" in line && line.voiced;
      return mockApi.createSegment(story.id, {
        text: line.text,
        speaker: character?.name ?? "Narrator",
        voice_id: voiceFor(book, character?.id ?? null),
        language: book.language,
        // Stand-in takes from the mock library, so some paragraphs are voiced.
        ...(voiced ? { sound_id: `snd-${String((i % 12) + 1).padStart(3, "0")}` } : {}),
      });
    }),
  );
  made.forEach((segment, i) => {
    segmentChapter.set(segment.id, chapter.id);
    const m = metaOf(segment.id);
    const line = lines[i]!;
    m.is_heading = "heading" in line && line.heading === true;
    m.character_id = line.character
      ? (characters.find((c) => c.book_id === book.id && c.name === line.character)?.id ?? null)
      : null;
  });
  touch(book.id);
  return chapter;
}

/* ------------------------------------------------------------------ seed */

let seeded: Promise<void> | null = null;

function ready(): Promise<void> {
  seeded ??= seed();
  return seeded;
}

async function seed(): Promise<void> {
  const book = newBook({
    title: "The Lantern at Gull Point",
    subtitle: "A coastal mystery",
    author: "E. Marlow",
    narrator: "Narrator",
    description:
      "When the lighthouse at Gull Point goes dark for one night, the keeper's daughter sets out to learn who climbed the stairs before her.",
    genres: ["Mystery", "Coastal"],
    series: "Gull Point",
    series_index: 1,
    publisher: "Sample Press",
    publication_date: "2026",
    settings: { narrator_voice_id: "voice-mock-narrator", cast_mode: "multi" },
  });
  characters.push(
    {
      id: id("char"),
      book_id: book.id,
      name: "Mara",
      aliases: ["Mara Quill", "the keeper's daughter"],
      description: "Seventeen, quick and stubborn. Coastal accent.",
      voice_id: "voice-mock-ada",
      model_id: null,
      request_options: {},
      color: 1,
    },
    {
      id: id("char"),
      book_id: book.id,
      name: "Tomas",
      aliases: ["old Tomas"],
      description: "A fisherman in his sixties. Slow, warm, gravelly.",
      voice_id: null,
      model_id: null,
      request_options: {},
      color: 2,
    },
  );

  await addChapter(book, {
    title: "Copyright",
    kind: "front_matter",
    included: false,
    paragraphs: ["Copyright 2026 E. Marlow. All rights reserved.", "This is a work of fiction."],
  });
  await addChapter(book, {
    title: "Dedication",
    kind: "front_matter",
    paragraphs: [{ text: "For everyone who keeps a light on.", voiced: true }],
  });
  await addChapter(book, {
    title: "Chapter One: The Dark Night",
    paragraphs: [
      { text: "Chapter One. The Dark Night.", heading: true, voiced: true },
      {
        text: "The lamp at Gull Point had turned every night for forty years, and on the forty-first it did not.",
        voiced: true,
      },
      {
        text: "Mara saw it from the kitchen window: a black gap in the sky where the beam should have been.",
        voiced: true,
      },
      { text: "\"Someone's been up the stairs,\" she said, already reaching for her coat.", character: "Mara", voiced: true },
      { text: "The wind took the door out of her hand and slammed it against the wall." },
      { text: "Halfway up the path she met old Tomas coming down, a lantern swinging from his fist." },
      { text: "\"Go home, girl. There's nothing up there but cold.\"", character: "Tomas" },
      { text: "\"Then why were you up there?\"", character: "Mara" },
    ],
  });
  await addChapter(book, {
    title: "Chapter Two: Salt on the Stairs",
    paragraphs: [
      { text: "Chapter Two. Salt on the Stairs.", heading: true },
      { text: "In the morning the stairs were dusted white, as if the sea had climbed them in the night." },
      { text: "Mara knelt and touched it. Salt, dry and fine, in a trail that ended at the lamp room door." },
      { text: "\"Tide doesn't come this high,\" she said to nobody.", character: "Mara" },
      { text: "Below, the harbour bell began to ring, though there was no wind to ring it." },
    ],
  });
  await addChapter(book, {
    title: "Chapter Three: The Keeper's Log",
    paragraphs: [
      { text: "Chapter Three. The Keeper's Log.", heading: true },
      { text: "Her father's log lay open on the desk, the last entry written in a hand that was not his." },
      { text: "\"You'll want to read that slowly,\" said Tomas from the doorway.", character: "Tomas" },
      { text: "She read it twice, then closed the book, and for a long moment neither of them spoke." },
    ],
  });
  await addChapter(book, {
    title: "About the Author",
    kind: "back_matter",
    paragraphs: ["E. Marlow writes about small harbours and the people who stay in them."],
  });

  // One stale paragraph, so every status shows in the sample: voiced, then edited.
  const one = bookChapters(book.id)[2]!;
  const paragraphs = await paragraphsOf(one);
  const edited = paragraphs[2]!;
  await mockApi.updateSegment(one.story_id, edited.id, {
    text: "Mara saw it from the kitchen window: a black gap in the sky where the beam should have swept.",
  });
  metaOf(paragraphs[1]!.id).locked = true;
  const at = now();
  notes.push(
    {
      id: id("note"),
      book_id: book.id,
      segment_id: paragraphs[3]!.id,
      chapter_id: one.id,
      body: "A little breathless here; try a calmer read.",
      at_s: 1.2,
      resolved: false,
      created_at: at,
      updated_at: at,
    },
    {
      id: id("note"),
      book_id: book.id,
      segment_id: paragraphs[1]!.id,
      chapter_id: one.id,
      body: "Check the pronunciation of Gull Point.",
      at_s: null,
      resolved: true,
      created_at: at,
      updated_at: at,
    },
  );

  newBook({
    title: "Field Notes",
    author: "A. Writer",
    genres: ["Nonfiction"],
  });
  await addChapter(books[0]!, { title: "Chapter 1", paragraphs: ["Notes begin here."] });
}

/* ------------------------------------------------------------------- api */

export const mockAudiobookApi: AudiobookApi = {
  async listBooks(): Promise<BookSummary[]> {
    await ready();
    const out: BookSummary[] = [];
    for (const book of [...books].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
      const d = await detail(book.id);
      out.push({ ...structuredClone(book), stats: d.stats });
    }
    return out;
  },

  async getBook(bookId) {
    await ready();
    return detail(bookId);
  },

  async createBook(fields = {}) {
    await ready();
    const book = newBook({ ...fields, title: fields.title?.trim() || "Untitled book" });
    await addChapter(book, { title: "Chapter 1" });
    return detail(book.id);
  },

  async updateBook(bookId, patch) {
    await ready();
    const book = requireBook(bookId);
    const { settings, ...rest } = patch;
    Object.assign(book, rest);
    if (settings) {
      book.settings = {
        ...book.settings,
        ...settings,
        pacing: { ...book.settings.pacing, ...settings.pacing },
      };
    }
    touch(bookId);
    emit(bookId, { type: "book" });
    return detail(bookId);
  },

  async deleteBook(bookId) {
    await ready();
    requireBook(bookId);
    for (const chapter of bookChapters(bookId)) {
      await mockApi.deleteStory(chapter.story_id, true);
      chapters.splice(chapters.indexOf(chapter), 1);
    }
    books.splice(
      books.findIndex((b) => b.id === bookId),
      1,
    );
    emit(bookId, { type: "deleted" });
  },

  async uploadCover(bookId, file) {
    await ready();
    const book = requireBook(bookId);
    const url = URL.createObjectURL(file);
    covers.set(bookId, url);
    book.cover_path = `mock-cover-${++seq}`;
    emit(bookId, { type: "book" });
    return detail(bookId);
  },

  coverUrl: (book) => (book.cover_path ? (covers.get(book.id) ?? null) : null),

  async addChapter(bookId, req = {}) {
    await ready();
    const chapter = await addChapter(requireBook(bookId), {
      title: req.title?.trim() || "New chapter",
      kind: req.kind,
      included: req.included,
      position: req.position,
      paragraphs: req.paragraphs,
    });
    emit(bookId, { type: "chapters" });
    const { stale: _s, ...out } = await chapterWithStats(chapter);
    return out;
  },

  async updateChapter(bookId, chapterId, patch) {
    await ready();
    const chapter = requireChapter(bookId, chapterId);
    if (patch.title?.trim()) {
      chapter.title = patch.title.trim();
      await mockApi.renameStory(chapter.story_id, chapter.title);
    }
    if (patch.kind) chapter.kind = patch.kind;
    if (patch.included !== undefined) chapter.included = patch.included;
    touch(bookId);
    emit(bookId, { type: "chapters" });
    const { stale: _s, ...out } = await chapterWithStats(chapter);
    return out;
  },

  async reorderChapters(bookId, ids) {
    await ready();
    const mine = bookChapters(bookId);
    if (ids.length !== mine.length || !mine.every((c) => ids.includes(c.id))) {
      throw new Error("ids must list every chapter of the book exactly once");
    }
    ids.forEach((cid, i) => {
      chapters.find((c) => c.id === cid)!.position = i;
    });
    emit(bookId, { type: "chapters" });
    return (await detail(bookId)).chapters;
  },

  async deleteChapter(bookId, chapterId) {
    await ready();
    const chapter = requireChapter(bookId, chapterId);
    chapters.splice(chapters.indexOf(chapter), 1);
    for (const c of bookChapters(bookId)) if (c.position > chapter.position) c.position -= 1;
    await mockApi.deleteStory(chapter.story_id, true);
    emit(bookId, { type: "chapters" });
  },

  async listParagraphs(bookId, chapterId) {
    await ready();
    return paragraphsOf(requireChapter(bookId, chapterId));
  },

  async addParagraph(bookId, chapterId, req) {
    await ready();
    const book = requireBook(bookId);
    const chapter = requireChapter(bookId, chapterId);
    const segment = await mockApi.createSegment(
      chapter.story_id,
      req.kind === "pause"
        ? { text: "", position: req.position ?? null, kind: "pause", duration_s: req.duration_s ?? 1 }
        : {
            text: req.text ?? "",
            position: req.position ?? null,
            speaker: "Narrator",
            voice_id: voiceFor(book, null),
            language: book.language,
          },
    );
    segmentChapter.set(segment.id, chapter.id);
    const m = metaOf(segment.id);
    m.is_heading = req.is_heading ?? false;
    if (req.character_id) await this.castParagraphs(bookId, [segment.id], req.character_id);
    emit(bookId, { type: "paragraphs", chapter_id: chapter.id, segment_ids: [segment.id] });
    return (await paragraphsOf(chapter)).find((p) => p.id === segment.id)!;
  },

  async updateParagraph(bookId, segmentId, patch) {
    await ready();
    const chapter = chapterOfSegment(bookId, segmentId);
    const m = metaOf(segmentId);
    if (patch.text !== undefined) {
      const current = (await paragraphsOf(chapter)).find((p) => p.id === segmentId)!;
      if (m.locked && patch.locked !== false && patch.text !== current.text) {
        throw new Error("This paragraph is locked. Unlock it to edit its text.");
      }
      await mockApi.updateSegment(chapter.story_id, segmentId, { text: patch.text });
    }
    if (patch.locked !== undefined) m.locked = patch.locked;
    if (patch.is_heading !== undefined) m.is_heading = patch.is_heading;
    if ("model_id" in patch) m.model_id = patch.model_id ?? null;
    if ("character_id" in patch) await this.castParagraphs(bookId, [segmentId], patch.character_id ?? null);
    emit(bookId, { type: "paragraphs", chapter_id: chapter.id, segment_ids: [segmentId] });
    return (await paragraphsOf(chapter)).find((p) => p.id === segmentId)!;
  },

  async deleteParagraph(bookId, segmentId) {
    await ready();
    const chapter = chapterOfSegment(bookId, segmentId);
    await mockApi.deleteSegment(chapter.story_id, segmentId);
    meta.delete(segmentId);
    segmentChapter.delete(segmentId);
    for (let i = notes.length - 1; i >= 0; i--) if (notes[i]!.segment_id === segmentId) notes.splice(i, 1);
    emit(bookId, { type: "paragraphs", chapter_id: chapter.id, segment_ids: [segmentId] });
  },

  async castParagraphs(bookId, segmentIds, characterId) {
    await ready();
    const book = requireBook(bookId);
    const character = characterId ? characters.find((c) => c.id === characterId) : null;
    if (characterId && (!character || character.book_id !== bookId)) {
      throw new Error("Character not found");
    }
    const touched = new Set<string>();
    for (const sid of segmentIds) {
      const chapter = chapterOfSegment(bookId, sid);
      const m = metaOf(sid);
      m.character_id = characterId;
      const update: SegmentPatch = { speaker: character?.name ?? "Narrator" };
      const voice = voiceFor(book, characterId);
      const segment = (await paragraphsOf(chapter)).find((p) => p.id === sid);
      if (!m.locked) update.voice_id = voice;
      // Same as the server: a new voice makes the existing take stale.
      if (!m.locked && segment?.sound_id && (segment.voice_id ?? null) !== voice) {
        m.stale_sound_id = segment.sound_id;
      }
      await mockApi.updateSegment(chapter.story_id, sid, update);
      touched.add(chapter.id);
    }
    for (const cid of touched) emit(bookId, { type: "paragraphs", chapter_id: cid });
    return { changed: segmentIds.length };
  },

  async splitParagraph(bookId, segmentId, at) {
    await ready();
    const chapter = chapterOfSegment(bookId, segmentId);
    const p = (await paragraphsOf(chapter)).find((x) => x.id === segmentId)!;
    if (p.kind !== "line") throw new Error("Only a spoken paragraph can be split.");
    if (p.locked) throw new Error("This paragraph is locked. Unlock it to split it.");
    const head = p.text.slice(0, at).trimEnd();
    const tail = p.text.slice(at).trimStart();
    if (!head || !tail) throw new Error("Split inside the text, not at its start or end.");
    await mockApi.updateSegment(chapter.story_id, segmentId, { text: head });
    const second = await this.addParagraph(bookId, chapter.id, {
      text: tail,
      position: p.position + 1,
      character_id: p.character_id,
    });
    metaOf(second.id).model_id = p.model_id;
    const list = await paragraphsOf(chapter);
    return { first: list.find((x) => x.id === segmentId)!, second: list.find((x) => x.id === second.id)! };
  },

  async mergeWithNext(bookId, segmentId, joiner = " ") {
    await ready();
    const chapter = chapterOfSegment(bookId, segmentId);
    const list = await paragraphsOf(chapter);
    const i = list.findIndex((x) => x.id === segmentId);
    const p = list[i]!;
    const next = list[i + 1];
    if (!next) throw new Error("There is no paragraph after this one.");
    if (p.kind !== "line" || next.kind !== "line") throw new Error("Only two spoken paragraphs can be merged.");
    if (p.locked || next.locked) throw new Error("Unlock both paragraphs to merge them.");
    const sep = p.text && next.text ? joiner : "";
    await mockApi.updateSegment(chapter.story_id, segmentId, { text: p.text + sep + next.text });
    for (const n of notes) {
      if (n.segment_id === next.id) Object.assign(n, { segment_id: segmentId, at_s: null });
    }
    await this.deleteParagraph(bookId, next.id);
    const paragraph = (await paragraphsOf(chapter)).find((x) => x.id === segmentId)!;
    return { paragraph, removed_id: next.id, split_at: p.text.length + sep.length };
  },

  async reorderParagraphs(bookId, chapterId, ids) {
    await ready();
    const chapter = requireChapter(bookId, chapterId);
    await mockApi.reorderSegments(chapter.story_id, ids);
    emit(bookId, { type: "paragraphs", chapter_id: chapterId });
    return paragraphsOf(chapter);
  },

  async replace(bookId, req): Promise<ReplaceResult> {
    await ready();
    requireBook(bookId);
    let source = req.regex ? req.find : req.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (req.whole_word) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
    const pattern = new RegExp(source, `gu${req.case_sensitive ? "" : "i"}`);
    const result: ReplaceResult = {
      matches: 0,
      paragraphs: 0,
      skipped_locked: 0,
      skipped_matches: 0,
      changed: [],
      dry_run: req.dry_run === true,
    };
    for (const chapter of bookChapters(bookId)) {
      if (req.chapter_ids?.length && !req.chapter_ids.includes(chapter.id)) continue;
      let touched = false;
      for (const p of await paragraphsOf(chapter)) {
        if (p.kind !== "line") continue;
        const count = p.text.match(pattern)?.length ?? 0;
        if (!count) continue;
        if (p.locked) {
          result.skipped_locked++;
          result.skipped_matches += count;
          continue;
        }
        result.matches += count;
        const next = req.regex ? p.text.replace(pattern, req.replace) : p.text.replace(pattern, () => req.replace);
        if (next === p.text) continue;
        result.paragraphs++;
        result.changed.push({ chapter_id: chapter.id, segment_id: p.id });
        if (!result.dry_run) {
          await mockApi.updateSegment(chapter.story_id, p.id, { text: next });
          touched = true;
        }
      }
      if (touched) emit(bookId, { type: "paragraphs", chapter_id: chapter.id });
    }
    return result;
  },

  async listSnapshots(bookId) {
    await ready();
    return snapshots.filter((s) => s.info.book_id === bookId).map((s) => ({ ...s.info })).reverse();
  },

  async saveSnapshot(bookId, label) {
    await ready();
    const book = requireBook(bookId);
    const list = bookChapters(bookId);
    const chapterData = await Promise.all(
      list.map(async (c) => ({
        id: c.id,
        title: c.title,
        kind: c.kind,
        included: c.included,
        paragraphs: structuredClone(await paragraphsOf(c)),
      })),
    );
    const info: SnapshotInfo = {
      id: id("snapshot"),
      book_id: bookId,
      label: label?.trim() || `Version of ${now().slice(0, 16).replace("T", " ")}`,
      chapters: chapterData.length,
      paragraphs: chapterData.reduce((n, c) => n + c.paragraphs.length, 0),
      created_at: now(),
    };
    snapshots.push({
      info,
      book: structuredClone(book),
      characters: structuredClone(characters.filter((c) => c.book_id === bookId)),
      chapters: chapterData,
    });
    emit(bookId, { type: "snapshots" });
    return { ...info };
  },

  async diffSnapshot(bookId, snapshotId) {
    await ready();
    const snap = snapshots.find((s) => s.info.id === snapshotId && s.info.book_id === bookId);
    if (!snap) throw new Error("Version not found");
    const book = requireBook(bookId);
    const diff: SnapshotDiff = {
      snapshot: { ...snap.info },
      book: [],
      chapters: [],
      summary: { added: 0, removed: 0, changed: 0 },
    };
    for (const field of ["title", "subtitle", "author", "narrator", "description", "language", "genres", "series", "series_index", "isbn", "publisher", "publication_date", "settings"] as const) {
      if (JSON.stringify(snap.book[field]) !== JSON.stringify(book[field])) {
        diff.book.push({ field, before: snap.book[field], after: book[field] });
      }
    }
    const was = new Map(snap.chapters.map((c) => [c.id, c]));
    const bump = (s: DiffStatus) => diff.summary[s]++;
    for (const c of bookChapters(bookId)) {
      const old = was.get(c.id);
      const oldParas = new Map((old?.paragraphs ?? []).map((p) => [p.id, p]));
      const current = await paragraphsOf(c);
      const ids = new Set(current.map((p) => p.id));
      const paragraphs: SnapshotDiff["chapters"][number]["paragraphs"] = [];
      for (const p of current) {
        const before = oldParas.get(p.id);
        if (!before) {
          paragraphs.push({ segment_id: p.id, status: "added", before: null, after: p.text });
          bump("added");
        } else if (before.text !== p.text) {
          paragraphs.push({ segment_id: p.id, status: "changed", before: before.text, after: p.text });
          bump("changed");
        }
      }
      for (const p of old?.paragraphs ?? []) {
        if (!ids.has(p.id)) {
          paragraphs.push({ segment_id: p.id, status: "removed", before: p.text, after: null });
          bump("removed");
        }
      }
      const renamed = old && old.title !== c.title;
      diff.chapters.push({
        chapter_id: c.id,
        title: c.title,
        status: !old ? "added" : renamed || paragraphs.length ? "changed" : "same",
        ...(renamed ? { title_before: old.title } : {}),
        paragraphs,
      });
    }
    const nowIds = new Set(bookChapters(bookId).map((c) => c.id));
    for (const old of snap.chapters) {
      if (nowIds.has(old.id)) continue;
      diff.chapters.push({
        chapter_id: old.id,
        title: old.title,
        status: "removed",
        paragraphs: old.paragraphs.map((p) => ({ segment_id: p.id, status: "removed" as const, before: p.text, after: null })),
      });
      diff.summary.removed += old.paragraphs.length;
    }
    return diff;
  },

  async restoreSnapshot(bookId, snapshotId) {
    await ready();
    const snap = snapshots.find((s) => s.info.id === snapshotId && s.info.book_id === bookId);
    if (!snap) throw new Error("Version not found");
    const before = await this.saveSnapshot(bookId, `Before restoring “${snap.info.label}”`);
    const book = requireBook(bookId);
    Object.assign(book, structuredClone(snap.book), { updated_at: now() });
    for (let i = characters.length - 1; i >= 0; i--) {
      if (characters[i]!.book_id === bookId) characters.splice(i, 1);
    }
    characters.push(...structuredClone(snap.characters));
    const keep = new Set(snap.chapters.map((c) => c.id));
    for (const c of bookChapters(bookId)) if (!keep.has(c.id)) await this.deleteChapter(bookId, c.id);
    // The mock cannot reuse ids for recreated rows, so they come back as new ones.
    const order: string[] = [];
    for (const sc of snap.chapters) {
      let chapter = chapters.find((c) => c.id === sc.id);
      if (!chapter) chapter = await addChapter(book, { title: sc.title, kind: sc.kind, included: sc.included });
      Object.assign(chapter, { title: sc.title, kind: sc.kind, included: sc.included });
      order.push(chapter.id);
      const current = await paragraphsOf(chapter);
      const wanted = new Set(sc.paragraphs.map((p) => p.id));
      for (const p of current) if (!wanted.has(p.id)) await this.deleteParagraph(bookId, p.id);
      const ids: string[] = [];
      for (const p of sc.paragraphs) {
        let pid = p.id;
        if (current.some((x) => x.id === p.id)) {
          await mockApi.updateSegment(chapter.story_id, p.id, {
            text: p.text,
            sound_id: p.sound_id ?? null,
            voice_id: p.voice_id ?? null,
            speaker: p.speaker ?? null,
          });
        } else {
          const made = await mockApi.createSegment(chapter.story_id, {
            text: p.text,
            kind: p.kind,
            duration_s: p.kind === "pause" ? p.duration_s : null,
            sound_id: p.sound_id ?? null,
            voice_id: p.voice_id ?? null,
            speaker: p.speaker ?? null,
          });
          pid = made.id;
          segmentChapter.set(pid, chapter.id);
        }
        Object.assign(metaOf(pid), {
          character_id: p.character_id,
          locked: p.locked,
          is_heading: p.is_heading,
          model_id: p.model_id,
          voiced_sound_id: p.sound_id ?? null,
          voiced_text: p.text,
          stale_sound_id: null,
        });
        ids.push(pid);
      }
      await mockApi.reorderSegments(chapter.story_id, ids);
    }
    order.forEach((cid, i) => {
      chapters.find((c) => c.id === cid)!.position = i;
    });
    emit(bookId, { type: "chapters" });
    return { book: await detail(bookId), before };
  },

  async deleteSnapshot(bookId, snapshotId) {
    await ready();
    const i = snapshots.findIndex((s) => s.info.id === snapshotId && s.info.book_id === bookId);
    if (i < 0) throw new Error("Version not found");
    snapshots.splice(i, 1);
    emit(bookId, { type: "snapshots" });
  },

  async listNotes(bookId) {
    await ready();
    requireBook(bookId);
    const order = new Map(bookChapters(bookId).map((c, i) => [c.id, i]));
    return structuredClone(
      notes
        .filter((n) => n.book_id === bookId)
        .sort((a, b) => (order.get(a.chapter_id) ?? 0) - (order.get(b.chapter_id) ?? 0)),
    );
  },

  async addNote(bookId, segmentId, body, atS = null) {
    await ready();
    const chapter = chapterOfSegment(bookId, segmentId);
    if (!body.trim()) throw new Error("A note needs some text.");
    const at = now();
    const note: BookNote = {
      id: id("note"),
      book_id: bookId,
      segment_id: segmentId,
      chapter_id: chapter.id,
      body: body.trim(),
      at_s: atS,
      resolved: false,
      created_at: at,
      updated_at: at,
    };
    notes.push(note);
    emit(bookId, { type: "notes", chapter_id: chapter.id });
    return structuredClone(note);
  },

  async updateNote(bookId, noteId, patch) {
    await ready();
    const note = notes.find((n) => n.id === noteId && n.book_id === bookId);
    if (!note) throw new Error("Note not found");
    Object.assign(note, patch, { updated_at: now() });
    emit(bookId, { type: "notes", chapter_id: note.chapter_id });
    return structuredClone(note);
  },

  async deleteNote(bookId, noteId) {
    await ready();
    const i = notes.findIndex((n) => n.id === noteId && n.book_id === bookId);
    if (i < 0) throw new Error("Note not found");
    const [note] = notes.splice(i, 1);
    emit(bookId, { type: "notes", chapter_id: note!.chapter_id });
  },

  subscribe(bookId, onEvent) {
    let set = listeners.get(bookId);
    if (!set) {
      set = new Set();
      listeners.set(bookId, set);
    }
    set.add(onEvent);
    setTimeout(() => onEvent({ type: "hello" }), 0);
    return () => {
      set.delete(onEvent);
    };
  },
};

/** For other areas' mocks: mark paragraphs stale, as a pronunciation change would. */
export function mockMarkStale(segmentIds: string[]): void {
  for (const sid of segmentIds) {
    const m = metaOf(sid);
    m.stale_sound_id = m.voiced_sound_id;
  }
}

/** For other areas' mocks: the mock's characters, which the cast panel edits in place. */
export function mockCharacters(): Character[] {
  return characters;
}

/** For other areas' mocks: tell an open editor something changed. */
export function mockEmit(bookId: string, event: AudiobookEvent): void {
  emit(bookId, event);
}
