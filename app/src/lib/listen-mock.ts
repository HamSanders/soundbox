/**
 * In-memory listening shelf for `VITE_MOCK=1`: a handful of public-domain
 * books with chapters, paragraph timings and synthesised audio, so the shelf,
 * detail page, player and read-along all work with no server and no models.
 *
 * The "narration" is a soft tone shaped like syllables, one burst per word
 * at an average reading pace, so the read-along highlight moves with it. It is
 * rendered to a WAV blob the first time a chapter is opened. Everything
 * resets on reload, like the rest of the mock.
 *
 * Books from the audiobook editor's own mock (`audiobook-mock.ts`) are on the
 * shelf too, read through `audiobookApi`, so a book edited in Audiobooks
 * shows up here with its real chapters and its voiced paragraphs' timings.
 */

import type { ListenApi } from "./listen-api";
import { audiobookApi, type BookDetail } from "./audiobook-api";
import { mockApi } from "./mock";
import type { Book, BookSettings, ChapterKind } from "./audiobook-types";
import type {
  Bookmark,
  ChecklistTarget,
  ListenChapter,
  ListenManifest,
  ListenProgress,
  PublishResult,
  ShelfBook,
} from "./listen-types";

const RATE = 8000;
const WORDS_PER_S = 2.6;
const GAP_S = 0.6;

interface MockChapter {
  title: string;
  kind?: ChapterKind;
  paragraphs: string[];
}

interface MockBook {
  id: string;
  title: string;
  subtitle?: string;
  author: string;
  narrator: string;
  description: string;
  genres: string[];
  tags: string[];
  language?: string;
  series?: string;
  series_index?: number;
  published: string;
  chapters: MockChapter[];
  cast?: { role: string; voice: string }[];
}

/* Public-domain texts (published before 1929), lightly abridged. */
const CATALOGUE: MockBook[] = [
  {
    id: "pride-and-prejudice",
    title: "Pride and Prejudice",
    author: "Jane Austen",
    narrator: "Mirli narrator",
    description:
      "Elizabeth Bennet meets the proud Mr Darcy, and first impressions prove hard to shake in this comedy of manners about love, money and family in Regency England.",
    genres: ["Literary Classics", "Romance"],
    tags: ["Enemies to lovers", "Slow burn"],
    published: "1813-01-28",
    cast: [
      { role: "Elizabeth Bennet", voice: "Clara" },
      { role: "Mr Darcy", voice: "Henry" },
    ],
    chapters: [
      {
        title: "Chapter 1",
        paragraphs: [
          "Chapter 1",
          "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
          "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
          "\"My dear Mr. Bennet,\" said his lady to him one day, \"have you heard that Netherfield Park is let at last?\"",
          "Mr. Bennet replied that he had not.",
          "\"But it is,\" returned she; \"for Mrs. Long has just been here, and she told me all about it.\"",
        ],
      },
      {
        title: "Chapter 2",
        paragraphs: [
          "Chapter 2",
          "Mr. Bennet was among the earliest of those who waited on Mr. Bingley. He had always intended to visit him, though to the last always assuring his wife that he should not go.",
          "Till the evening after the visit was paid she had no knowledge of it.",
        ],
      },
      {
        title: "Chapter 3",
        paragraphs: [
          "Chapter 3",
          "Not all that Mrs. Bennet, however, with the assistance of her five daughters, could ask on the subject, was sufficient to draw from her husband any satisfactory description of Mr. Bingley.",
        ],
      },
    ],
  },
  {
    id: "frankenstein",
    title: "Frankenstein",
    subtitle: "or, The Modern Prometheus",
    author: "Mary Shelley",
    narrator: "Mirli narrator",
    description:
      "A young scientist gives life to a creature and then abandons it, setting creator and creation on a path of grief and pursuit across Europe and the Arctic.",
    genres: ["Literary Classics", "Horror"],
    tags: ["Gothic", "Epistolary"],
    published: "1818-01-01",
    chapters: [
      {
        title: "Letter 1",
        paragraphs: [
          "Letter 1",
          "You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings.",
          "I arrived here yesterday, and my first task is to assure my dear sister of my welfare and increasing confidence in the success of my undertaking.",
          "I am already far north of London, and as I walk in the streets of Petersburgh, I feel a cold northern breeze play upon my cheeks, which braces my nerves and fills me with delight.",
        ],
      },
      {
        title: "Letter 2",
        paragraphs: [
          "Letter 2",
          "How slowly the time passes here, encompassed as I am by frost and snow! Yet a second step is taken towards my enterprise.",
        ],
      },
    ],
  },
  {
    id: "study-in-scarlet",
    title: "A Study in Scarlet",
    author: "Arthur Conan Doyle",
    narrator: "Mirli narrator",
    description:
      "Dr John Watson, home from war, takes rooms at 221B Baker Street with an eccentric consulting detective, and is drawn at once into a baffling case.",
    genres: ["Mystery and Thriller", "Literary Classics"],
    tags: ["Detective", "Victorian"],
    series: "Sherlock Holmes",
    series_index: 1,
    published: "1887-11-01",
    chapters: [
      {
        title: "Mr. Sherlock Holmes",
        paragraphs: [
          "Mr. Sherlock Holmes",
          "In the year 1878 I took my degree of Doctor of Medicine of the University of London, and proceeded to Netley to go through the course prescribed for surgeons in the army.",
          "Having completed my studies there, I was duly attached to the Fifth Northumberland Fusiliers as Assistant Surgeon.",
          "\"You have been in Afghanistan, I perceive.\"",
          "\"How on earth did you know that?\" I asked in astonishment.",
        ],
      },
      {
        title: "The Science of Deduction",
        paragraphs: [
          "The Science of Deduction",
          "We met next day as he had arranged, and inspected the rooms at No. 221B, Baker Street, of which he had spoken at our meeting.",
        ],
      },
    ],
  },
  {
    id: "sign-of-the-four",
    title: "The Sign of the Four",
    author: "Arthur Conan Doyle",
    narrator: "Mirli narrator",
    description:
      "A young woman receives a pearl every year from an unknown sender, and Holmes and Watson follow the trail to a stolen treasure and a sworn pact.",
    genres: ["Mystery and Thriller"],
    tags: ["Detective", "Victorian"],
    series: "Sherlock Holmes",
    series_index: 2,
    published: "1890-02-01",
    chapters: [
      {
        title: "The Science of Deduction",
        paragraphs: [
          "The Science of Deduction",
          "Sherlock Holmes took his bottle from the corner of the mantel-piece, and his hypodermic syringe from its neat morocco case.",
          "\"My mind,\" he said, \"rebels at stagnation. Give me problems, give me work.\"",
        ],
      },
    ],
  },
  {
    id: "alice",
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    narrator: "Mirli narrator",
    description:
      "Alice follows a white rabbit down a hole and into a world of talking animals, shrinking potions and a very bad-tempered queen.",
    genres: ["Children's", "Fantasy"],
    tags: ["Portal fantasy", "Whimsical"],
    published: "1865-11-26",
    chapters: [
      {
        title: "Down the Rabbit-Hole",
        paragraphs: [
          "Down the Rabbit-Hole",
          "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do.",
          "Once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, \"and what is the use of a book,\" thought Alice, \"without pictures or conversations?\"",
          "Suddenly a White Rabbit with pink eyes ran close by her.",
        ],
      },
    ],
  },
  {
    id: "time-machine",
    title: "The Time Machine",
    author: "H. G. Wells",
    narrator: "Mirli narrator",
    description:
      "A Victorian inventor travels to the year 802,701 and finds humanity divided into two strange races.",
    genres: ["Science Fiction", "Literary Classics"],
    tags: ["Time travel", "Dystopia"],
    published: "1895-05-07",
    chapters: [
      {
        title: "Chapter 1",
        paragraphs: [
          "Chapter 1",
          "The Time Traveller, for so it will be convenient to speak of him, was expounding a recondite matter to us.",
          "His grey eyes shone and twinkled, and his usually pale face was flushed and animated.",
        ],
      },
      {
        title: "Chapter 2",
        paragraphs: [
          "Chapter 2",
          "I think that at that time none of us quite believed in the Time Machine.",
        ],
      },
    ],
  },
  {
    id: "les-trois-mousquetaires",
    title: "Les Trois Mousquetaires",
    author: "Alexandre Dumas",
    narrator: "Mirli narrator",
    language: "fr",
    description: "D'Artagnan arrive à Paris et se lie d'amitié avec Athos, Porthos et Aramis.",
    genres: ["Action and Adventure", "Literary Classics"],
    tags: ["Swashbuckler"],
    published: "1844-03-14",
    chapters: [
      {
        title: "Les trois présents de M. d'Artagnan père",
        paragraphs: [
          "Les trois présents de M. d'Artagnan père",
          "Le premier lundi du mois d'avril 1625, le bourg de Meung semblait être dans une révolution aussi entière que si les huguenots en fussent venus faire une seconde Rochelle.",
        ],
      },
    ],
  },
];

const SETTINGS: BookSettings = {
  model_id: null,
  narrator_voice_id: "voice-narrator",
  request_options: {},
  pacing: { paragraph_gap_s: GAP_S, heading_gap_s: 1, head_room_tone_s: 0.5, tail_room_tone_s: 1 },
  mastering: "acx",
  cast_mode: "multi",
};

const progress = new Map<string, ListenProgress>();
const bookmarks = new Map<string, Bookmark[]>();
const tags = new Map<string, string[]>(CATALOGUE.map((b) => [b.id, b.tags]));
const audioUrls = new Map<string, string>();
let seq = 0;
const now = () => new Date().toISOString();

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const round = (s: number) => Math.round(s * 1000) / 1000;

/** Chapters with timings laid out at reading pace. */
function chaptersOf(book: MockBook): ListenChapter[] {
  return book.chapters.map((c, ci) => {
    let t = 0.5;
    const paragraphs = c.paragraphs.map((text, pi) => {
      const length = Math.max(0.8, words(text) / WORDS_PER_S);
      const p = {
        segment_id: `${book.id}-c${ci}-p${pi}`,
        text,
        start_s: round(t),
        end_s: round(t + length),
        character_id: null,
        is_heading: pi === 0,
      };
      t += length + (pi === 0 ? 1 : GAP_S);
      return p;
    });
    const duration = round(t + 0.5);
    return {
      id: `${book.id}-c${ci}`,
      title: c.title,
      kind: c.kind ?? "chapter",
      position: ci,
      duration_s: duration,
      audio_url: null,
      source: "live" as const,
      paragraphs,
    };
  });
}

/** A WAV blob of syllable-shaped tone bursts, one per word, at the timings. */
function synthesise(chapter: ListenChapter, seed: number): string {
  const cached = audioUrls.get(chapter.id);
  if (cached) return cached;
  const n = Math.ceil(chapter.duration_s * RATE);
  const pcm = new Int16Array(n);
  chapter.paragraphs.forEach((p, pi) => {
    if (p.start_s == null || p.end_s == null) return;
    const count = Math.max(1, words(p.text));
    const per = (p.end_s - p.start_s) / count;
    const base = 150 + ((seed * 37 + pi * 23) % 80);
    for (let w = 0; w < count; w++) {
      const ws = p.start_s + w * per;
      const len = per * 0.8;
      const from = Math.floor(ws * RATE);
      const to = Math.min(n, Math.floor((ws + len) * RATE));
      const f = base * (1 + 0.08 * Math.sin(w * 1.7));
      for (let i = from; i < to; i++) {
        const x = (i - from) / (to - from);
        const env = Math.sin(Math.PI * x) ** 2;
        const t = i / RATE;
        const v = Math.sin(2 * Math.PI * f * t) * 0.6 + Math.sin(4 * Math.PI * f * t) * 0.25 + Math.sin(6 * Math.PI * f * t) * 0.1;
        pcm[i] = Math.round(v * env * 0.22 * 32767);
      }
    }
  });
  const buf = new ArrayBuffer(44 + pcm.byteLength);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  new Int16Array(buf, 44).set(pcm);
  const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  audioUrls.set(chapter.id, url);
  return url;
}

function bookOf(m: MockBook): Book & { cover_url: string | null; tags: string[] } {
  return {
    id: m.id,
    project_id: null,
    title: m.title,
    subtitle: m.subtitle ?? null,
    author: m.author,
    narrator: m.narrator,
    description: m.description,
    language: m.language ?? "en",
    genres: m.genres,
    series: m.series ?? null,
    series_index: m.series_index ?? null,
    isbn: null,
    publisher: null,
    publication_date: m.published,
    cover_path: null,
    settings: SETTINGS,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    cover_url: null,
    tags: tags.get(m.id) ?? [],
  };
}

/* ------------------------------------------------- editor (core) mock books */

const LISTENABLE = (kind: ChapterKind, included: boolean) => included && kind !== "retail_sample";

/** An editor book's chapters as the listen manifest has them: narration
 *  (track 0) paragraphs, with timings where a paragraph is voiced. */
async function editorChapters(detail: BookDetail): Promise<ListenChapter[]> {
  const out: ListenChapter[] = [];
  for (const c of detail.chapters.filter((ch) => LISTENABLE(ch.kind, ch.included))) {
    const paragraphs = (await audiobookApi.listParagraphs(detail.id, c.id)).filter(
      (p) => p.kind === "line" && p.track_index === 0 && p.text.trim() !== "",
    );
    let end = 0;
    const listen = paragraphs.map((p) => {
      const length = p.sound_id ? (p.duration_s ?? p.sound?.duration_s ?? Math.max(0.8, words(p.text) / WORDS_PER_S)) : 0;
      const voiced = Boolean(p.sound_id) && length > 0;
      if (voiced) end = Math.max(end, p.start_s + length);
      return {
        segment_id: p.id,
        text: p.text,
        start_s: voiced ? round(p.start_s) : null,
        end_s: voiced ? round(p.start_s + length) : null,
        character_id: p.character_id,
        is_heading: p.is_heading,
      };
    });
    out.push({
      id: c.id,
      title: c.title,
      kind: c.kind,
      position: c.position,
      duration_s: round(end),
      audio_url: null,
      source: end > 0 ? "live" : null,
      paragraphs: listen,
    });
  }
  return out;
}

async function editorBooks(): Promise<BookDetail[]> {
  const summaries = await audiobookApi.listBooks();
  return Promise.all(summaries.map((b) => audiobookApi.getBook(b.id)));
}

/** A catalogue book, or an editor book in the same shape (for the checklist). */
async function anyBook(id: string): Promise<MockBook> {
  const known = CATALOGUE.find((b) => b.id === id);
  if (known) return known;
  const d = await audiobookApi.getBook(id);
  return {
    id: d.id,
    title: d.title,
    author: d.author ?? "",
    narrator: d.narrator ?? "",
    description: d.description ?? "",
    genres: d.genres,
    tags: [],
    published: d.publication_date ?? "",
    chapters: d.chapters.map((c) => ({ title: c.title, kind: c.kind, paragraphs: [] })),
  };
}

function find(id: string): MockBook {
  const book = CATALOGUE.find((b) => b.id === id);
  if (!book) throw new Error("Book not found");
  return book;
}

function seed(): void {
  if (progress.size > 0) return;
  const at = (id: string, chapter: number, position: number, finished = false, ago = 0) => {
    const book = find(id);
    const chapters = chaptersOf(book);
    const before = chapters.slice(0, chapter).reduce((s, c) => s + c.duration_s, 0);
    const stamp = new Date(Date.now() - ago * 3600_000).toISOString();
    progress.set(id, {
      book_id: id,
      chapter_id: chapters[chapter].id,
      position_s: position,
      speed: 1,
      book_position_s: before + position,
      finished_at: finished ? stamp : null,
      started_at: stamp,
      updated_at: stamp,
    });
  };
  at("pride-and-prejudice", 0, 14, false, 1);
  at("study-in-scarlet", 1, 3, false, 20);
  at("alice", 0, 0, true, 72);
}

export const mockListenApi: ListenApi = {
  async shelf(): Promise<ShelfBook[]> {
    seed();
    const editor: ShelfBook[] = [];
    for (const d of await editorBooks()) {
      const chapters = await editorChapters(d);
      editor.push({
        id: d.id,
        title: d.title,
        subtitle: d.subtitle,
        author: d.author,
        narrator: d.narrator,
        description: d.description,
        language: d.language,
        genres: d.genres,
        tags: tags.get(d.id) ?? [],
        series: d.series,
        series_index: d.series_index,
        publication_date: d.publication_date,
        cover_url: audiobookApi.coverUrl(d),
        duration_s: round(chapters.reduce((s, c) => s + c.duration_s, 0)),
        chapters: chapters.length,
        playable_chapters: chapters.filter((c) => c.duration_s > 0).length,
        progress: progress.get(d.id) ?? null,
        created_at: d.created_at,
        updated_at: d.updated_at,
      });
    }
    return [...editor, ...CATALOGUE.map((m) => {
      const chapters = chaptersOf(m);
      const b = bookOf(m);
      return {
        id: b.id,
        title: b.title,
        subtitle: b.subtitle,
        author: b.author,
        narrator: b.narrator,
        description: b.description,
        language: b.language,
        genres: b.genres,
        tags: b.tags,
        series: b.series,
        series_index: b.series_index,
        publication_date: b.publication_date,
        cover_url: null,
        duration_s: round(chapters.reduce((s, c) => s + c.duration_s, 0)),
        chapters: chapters.length,
        playable_chapters: chapters.length,
        progress: progress.get(m.id) ?? null,
        created_at: b.created_at,
        updated_at: b.updated_at,
      };
    })];
  },

  async manifest(id): Promise<ListenManifest> {
    seed();
    if (!CATALOGUE.some((b) => b.id === id)) return editorManifest(id);
    const m = find(id);
    const seedN = CATALOGUE.indexOf(m) + 1;
    const chapters = chaptersOf(m).map((c) => ({ ...c, audio_url: synthesise(c, seedN) }));
    const duration = round(chapters.reduce((s, c) => s + c.duration_s, 0));
    return {
      book: bookOf(m),
      cast: [
        { character_id: null, role: "Narrator", voice_id: "voice-narrator", voice_name: m.narrator },
        ...(m.cast ?? []).map((c, i) => ({ character_id: `ch-${i}`, role: c.role, voice_id: `voice-${i}`, voice_name: c.voice })),
      ],
      characters: (m.cast ?? []).map((c, i) => ({ id: `ch-${i}`, name: c.role, color: i })),
      chapters,
      duration_s: duration,
      sample: { chapter_id: chapters[0].id, start_s: 0, end_s: Math.min(300, chapters[0].duration_s), from: "first_chapter" },
      progress: progress.get(id) ?? null,
      bookmarks: bookmarks.get(id) ?? [],
      word_timings: false,
    };
  },

  async saveProgress(id, patch) {
    const prev = progress.get(id);
    const stamp = now();
    const next: ListenProgress = {
      book_id: id,
      chapter_id: patch.chapter_id,
      position_s: patch.position_s,
      speed: patch.speed ?? prev?.speed ?? 1,
      book_position_s: patch.book_position_s ?? prev?.book_position_s ?? 0,
      finished_at: patch.finished === true ? (prev?.finished_at ?? stamp) : patch.finished === false ? null : (prev?.finished_at ?? null),
      started_at: prev?.started_at ?? stamp,
      updated_at: stamp,
    };
    progress.set(id, next);
    return next;
  },

  async clearProgress(id) {
    progress.delete(id);
  },

  async addBookmark(id, req) {
    const stamp = now();
    const mark: Bookmark = {
      id: `bm-${++seq}`,
      book_id: id,
      chapter_id: req.chapter_id,
      position_s: req.position_s,
      segment_id: req.segment_id ?? null,
      note: req.note ?? "",
      created_at: stamp,
      updated_at: stamp,
    };
    bookmarks.set(id, [...(bookmarks.get(id) ?? []), mark]);
    return mark;
  },

  async updateBookmark(id, bid, patch) {
    const list = bookmarks.get(id) ?? [];
    const mark = list.find((b) => b.id === bid);
    if (!mark) throw new Error("Bookmark not found");
    Object.assign(mark, patch, { updated_at: now() });
    return { ...mark };
  },

  async deleteBookmark(id, bid) {
    bookmarks.set(id, (bookmarks.get(id) ?? []).filter((b) => b.id !== bid));
  },

  async setTags(id, next) {
    const clean = [...new Set(next.map((t) => t.trim()).filter(Boolean))].sort();
    tags.set(id, clean);
    return { tags: clean };
  },

  async checklist(id): Promise<ChecklistTarget[]> {
    const m = await anyBook(id);
    const item = (iid: string, label: string, pass: boolean, detail: string, level: "required" | "recommended" = "required") => ({
      id: iid,
      label,
      level,
      pass,
      detail,
    });
    const meta = [
      item("title", "Title", true, m.title),
      item("author", "Author", true, m.author),
      item("narrator", "Narrator credit", true, m.narrator),
      item("description", "Description", true, `${m.description.length} characters`),
      item("genres", "At least one genre", true, m.genres.join(", ")),
      item("cover", "Cover image", false, "No cover yet"),
      item("cover_size", "Cover is at least 3000×3000", false, "unknown size", "recommended"),
      item("chapters_voiced", "Every chapter has audio", true, `${m.chapters.length} of ${m.chapters.length} chapters`),
      item("sample", "Sample (5 minutes or less)", false, "No retail sample chapter; the first 5 minutes of chapter one will be used"),
    ];
    const target = (tid: ChecklistTarget["id"], name: string, source: string | null, items = meta): ChecklistTarget => ({
      id: tid,
      name,
      source_url: source,
      items,
      ready: items.every((i) => i.level !== "required" || i.pass),
    });
    return [
      target("spotify", "Spotify for Authors", "https://support.spotify.com/us/authors/article/uploading-audiobooks/"),
      target("apple_books", "Apple Books", "https://help.apple.com/itc/audiobooksspec/en.lproj/static.html"),
      target("read_along", "Read-along apps (text with audio)", null),
      target("podcast_rss", "Podcast feed (RSS)", "https://podcasters.apple.com/support/823-podcast-requirements"),
      target("web_player", "Web player", null, meta.filter((i) => i.id === "title" || i.id === "chapters_voiced")),
    ];
  },

  async publishWebPlayer(id) {
    return fakePublish(await anyBook(id), "webplayer", ["index.html", "readalong.json", "book.jsonld"]);
  },

  async publishRss(id) {
    return fakePublish(await anyBook(id), "rss", ["feed.xml"]);
  },
};

function fakePublish(m: MockBook, kind: PublishResult["kind"], extra: string[]): PublishResult {
  const name = `${m.id}-${kind}-mock`;
  return {
    kind,
    name,
    dir: `~/.mirli/publish/${name}`,
    zip_path: `~/.mirli/publish/${name}.zip`,
    download_url: null,
    files: [...extra, ...m.chapters.map((c, i) => `audio/${String(i + 1).padStart(2, "0")}-${c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp3`)],
    chapters: m.chapters.length,
    warnings: ["Mock mode: nothing was written to disk."],
    created_at: now(),
  };
}

async function editorManifest(id: string): Promise<ListenManifest> {
  const d = await audiobookApi.getBook(id);
  const chapters = (await editorChapters(d)).map((c, i) => ({
    ...c,
    audio_url: c.duration_s > 0 ? synthesise(c, i + 11) : null,
  }));
  const first = chapters.find((c) => c.kind === "chapter" && c.duration_s > 0) ?? chapters.find((c) => c.duration_s > 0);
  const voices = new Map((await mockApi.listVoices().catch(() => [])).map((v) => [v.id, v.name]));
  const voiceName = (vid: string | null) => (vid ? (voices.get(vid) ?? null) : null);
  const { chapters: _c, characters, stats: _s, ...book } = d;
  return {
    book: { ...book, cover_url: audiobookApi.coverUrl(d), tags: tags.get(id) ?? [] },
    cast: [
      { character_id: null, role: "Narrator", voice_id: d.settings.narrator_voice_id, voice_name: d.narrator ?? voiceName(d.settings.narrator_voice_id) },
      ...(d.settings.cast_mode === "multi"
        ? characters.filter((c) => c.voice_id).map((c) => ({ character_id: c.id, role: c.name, voice_id: c.voice_id, voice_name: voiceName(c.voice_id) }))
        : []),
    ],
    characters: characters.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    chapters,
    duration_s: round(chapters.reduce((s, c) => s + c.duration_s, 0)),
    sample: first ? { chapter_id: first.id, start_s: 0, end_s: Math.min(300, first.duration_s), from: "first_chapter" } : null,
    progress: progress.get(id) ?? null,
    bookmarks: bookmarks.get(id) ?? [],
    word_timings: false,
  };
}
