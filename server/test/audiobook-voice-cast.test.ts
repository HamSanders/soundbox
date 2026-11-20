/**
 * Audiobook casting: the character prompt/parser and heuristic (pure), voice
 * matching, and the cast service against the fake book.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CastService } from "../src/audiobook/cast.js";
import { RenderService } from "../src/audiobook/render.js";
import {
  buildCharacterMessages,
  heuristicCast,
  mergeCastResults,
  paragraphSpeakers,
  parseCharacterReply,
  splitDialogue,
  suggestVoices,
  voiceTraits,
  type CastParagraph,
} from "../src/llm/characters.js";
import type { Voice } from "../src/schemas.js";
import { harness, TTS, type Harness } from "./audiobook-voice-helpers.js";

const PARAS: CastParagraph[] = [
  { index: 0, text: "The rain had not stopped for three days." },
  { index: 1, text: "“Where were you?” asked Mara." },
  { index: 2, text: "Tom shrugged. “Out,” he said, and hung up his coat." },
  { index: 3, text: "“Out where?” Mara said." },
  { index: 4, text: "He said, “That's my business.”" },
];

describe("heuristicCast", () => {
  it("attributes quotes from said-tags in either order", () => {
    const r = heuristicCast(PARAS);
    expect(r.lines).toEqual([
      { index: 1, speaker: "Mara", quote: "Where were you?" },
      { index: 3, speaker: "Mara", quote: "Out where?" },
    ]);
    expect(r.characters.map((c) => c.name)).toEqual(["Mara"]);
    expect(r.source).toBe("heuristic");
  });

  it("does not take pronouns as names", () => {
    expect(heuristicCast([{ index: 0, text: "“No,” said He." }]).lines).toEqual([]);
  });
});

describe("prompt and parser", () => {
  it("numbers paragraphs and lists known characters", () => {
    const m = buildCharacterMessages(PARAS, [{ name: "Mara", aliases: ["Miss Lane"] }]);
    expect(m[0]!.role).toBe("system");
    expect(m[1]!.content).toContain("[2] Tom shrugged.");
    expect(m[1]!.content).toContain("Mara / Miss Lane");
  });

  it("parses a fenced reply, maps aliases and drops what does not exist", () => {
    const reply = "```json\n" + JSON.stringify({
      characters: [
        { name: "Mara", aliases: ["Miss Lane"], age: "adult", gender: "female", accent: "Scottish", temperament: "sharp, worried" },
        { name: "Tom", aliases: [], age: "null", gender: "male", accent: null, temperament: "evasive" },
      ],
      lines: [
        { p: 1, speaker: "Mara", quote: "Where were" },
        { p: 2, speaker: "Tom", quote: "Out" },
        { p: 4, speaker: "Tom", quote: "That's my business" },
        { p: 3, speaker: "Miss Lane", quote: "Out where?" },
        { p: 9, speaker: "Tom", quote: "x" },
        { p: 0, speaker: "Tom", quote: "rain" },
        { p: 1, speaker: "Ghost", quote: "Where" },
      ],
    }) + "\n```";
    const r = parseCharacterReply(reply, PARAS);
    expect(r.lines.map((l) => [l.index, l.speaker])).toEqual([[1, "Mara"], [2, "Tom"], [4, "Tom"], [3, "Mara"]]);
    expect(r.dropped).toBe(3);
    const mara = r.characters.find((c) => c.name === "Mara")!;
    expect(mara.description).toBe("adult, female, Scottish accent, sharp, worried");
    expect(r.characters.find((c) => c.name === "Tom")!.traits.age).toBeNull();
  });

  it("survives a reply that is not JSON", () => {
    expect(parseCharacterReply("I could not find anyone.", PARAS).lines).toEqual([]);
  });

  it("merges batches by name and alias", () => {
    const a = parseCharacterReply(JSON.stringify({ characters: [{ name: "Mara", aliases: ["Miss Lane"] }], lines: [{ p: 1, speaker: "Mara", quote: "Where" }] }), PARAS);
    const b = parseCharacterReply(JSON.stringify({ characters: [{ name: "Miss Lane", gender: "female" }], lines: [{ p: 3, speaker: "Miss Lane", quote: "Out where" }] }), PARAS);
    const m = mergeCastResults([a, b]);
    expect(m.characters).toHaveLength(1);
    expect(m.characters[0]!.lines).toBe(2);
    expect(m.characters[0]!.traits.gender).toBe("female");
    expect(m.lines.every((l) => l.speaker === "Mara")).toBe(true);
  });

  it("casts a paragraph only when its dialogue dominates", () => {
    const lines = [
      { index: 1, speaker: "Mara", quote: "Where were you?" },
      { index: 2, speaker: "Tom", quote: "Out," },
    ];
    expect([...paragraphSpeakers(PARAS, lines)]).toEqual([[1, "Mara"]]);
  });

  it("splits dialogue from narration", () => {
    expect(splitDialogue(PARAS[2]!.text)).toEqual([
      { text: "Tom shrugged.", quote: false },
      { text: "“Out,”", quote: true },
      { text: "he said, and hung up his coat.", quote: false },
    ]);
  });
});

describe("suggestVoices", () => {
  const voices = [
    { id: "v1", name: "Emma", notes: null, voice_id: "bf_emma", model_id: TTS },
    { id: "v2", name: "George", notes: null, voice_id: "bm_george", model_id: TTS },
    { id: "v3", name: "Heart", notes: null, voice_id: "af_heart", model_id: TTS },
    { id: "v4", name: "Gravel", notes: "old man, gruff and slow", voice_id: null, model_id: TTS },
  ];

  it("reads Kokoro ids and notes", () => {
    expect(voiceTraits(voices[0]!)).toMatchObject({ gender: "female", accent: "british" });
    expect(voiceTraits(voices[3]!)).toMatchObject({ gender: "male", age: "old" });
  });

  it("matches descriptions and keeps voices distinct", () => {
    const s = suggestVoices(
      [
        { name: "Mara", description: "adult, female, British accent, sharp", lines: 9 },
        { name: "Grandad", description: "elderly, male, gruff", lines: 3 },
        { name: "Ann", description: "young adult, female, American accent", lines: 5 },
        { name: "Tom", description: "adult, male", lines: 4 },
      ],
      voices,
    );
    expect(s.map((x) => x.voice_id)).toEqual(["v1", "v4", "v3", "v2"]);
    expect(s.some((x) => x.shared)).toBe(false);
  });

  it("shares a voice only when none are left, and avoids the narrator's", () => {
    const s = suggestVoices(
      [{ name: "A", description: "female" }, { name: "B", description: "female" }],
      voices.slice(0, 1),
    );
    expect(s[1]!.shared).toBe(true);
    const r = suggestVoices([{ name: "A", description: "female, British" }], voices, ["v1"]);
    expect(r[0]!.voice_id).not.toBe("v1");
  });
});

describe("CastService", { timeout: 30_000 }, () => {
  let h: Harness;
  let cast: CastService;
  let chapterId: string;

  beforeEach(async () => {
    h = await harness();
    cast = new CastService(h.svc, h.book, new RenderService(h.svc, h.book));
    chapterId = h.book.addChapter("One", PARAS.map((p) => p.text)).id;
    const db = (h.svc as unknown as { db: { createVoice(v: Voice, f: null): Voice } }).db;
    for (const [id, vid] of [["v1", "bf_emma"], ["v2", "bm_george"], ["v3", "af_heart"]] as const) {
      db.createVoice({ id, name: vid, kind: "builtin", created_at: "", voice_id: vid, model_id: TTS }, null);
    }
  });
  afterEach(async () => h.close());

  it("detects with the heuristic when the assistant is off and casts paragraphs", async () => {
    const r = await cast.detect("book1");
    expect(r.source).toBe("heuristic");
    expect(r.notes[0]).toMatch(/assistant is off/);
    expect(r.characters.map((c) => c.name)).toEqual(["Mara"]);
    const ps = h.book.getParagraphs(chapterId)!;
    expect(ps[1]!.character_id).toBe(r.characters[0]!.id);
    expect(ps[3]!.character_id).toBe(r.characters[0]!.id);
    expect(ps[2]!.character_id).toBeNull();
    // Running again reuses the character.
    expect((await cast.detect("book1")).created).toBe(0);
  });

  it("splits dialogue into its own paragraphs when asked", async () => {
    const r = await cast.detect("book1", { split_dialogue: true });
    expect(r.split).toBeGreaterThan(0);
    const texts = h.book.getParagraphs(chapterId)!.map((p) => p.text);
    expect(texts).toContain("“Out where?”");
    expect(texts).toContain("Mara said.");
  });

  it("suggests and applies distinct voices, avoiding the narrator's", async () => {
    h.book.book.settings.narrator_voice_id = "v1";
    const a = h.book.createCharacter("book1", { name: "Mara", description: "female, British" });
    const b = h.book.createCharacter("book1", { name: "Tom", description: "male" });
    const s = cast.suggest("book1");
    expect(s.map((x) => x.voice_id)).toEqual(["v3", "v2"]);
    expect(cast.applySuggestions("book1")).toBe(2);
    expect(h.book.getCharacter(a.id)!.voice_id).toBe("v3");
    expect(h.book.getCharacter(b.id)!.voice_id).toBe("v2");
  });

  it("finds a real line to preview and queues a read in the chosen voice", async () => {
    const mara = h.book.createCharacter("book1", { name: "Mara" });
    expect(cast.sampleLine("book1", mara.id)!.text).toBe("Where were you?");
    const { job, text } = await cast.preview("book1", mara.id, "v1");
    expect(job.kind).toBe("speak");
    expect(text).toBe("Where were you?");
  });

  it("merges characters and replaces a voice across the book", async () => {
    const a = h.book.createCharacter("book1", { name: "Mara", voice_id: "v1" });
    const b = h.book.createCharacter("book1", { name: "Miss Lane", voice_id: "v2" });
    const seg = h.book.getParagraphs(chapterId)![3]!.id;
    h.book.setParagraphCharacter([seg], b.id);
    const merged = cast.merge("book1", a.id, [b.id]);
    expect(merged.aliases).toEqual(["Miss Lane"]);
    expect(h.book.getParagraph(seg)!.character_id).toBe(a.id);
    expect(h.book.getCharacter(b.id)).toBeNull();

    h.book.book.settings.narrator_voice_id = "v1";
    expect(cast.replaceVoice("book1", "v1", "v3")).toEqual({ characters: 1, narrator: true });
    expect(h.book.getCharacter(a.id)!.voice_id).toBe("v3");
    expect(h.book.book.settings.narrator_voice_id).toBe("v3");
  });
});
