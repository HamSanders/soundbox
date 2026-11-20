/**
 * Audiobooks: casting. Detects speakers (assistant model, else the "said X"
 * heuristic), writes characters and paragraph casting through core's book
 * service, suggests a distinct voice per character, previews a voice on a
 * real line, merges characters and replaces a voice across the book.
 */

import { ModelError } from "../errors.js";
import {
  batchParagraphs,
  buildCharacterMessages,
  heuristicCast,
  mergeCastResults,
  paragraphSpeakers,
  parseCharacterReply,
  quotes,
  splitDialogue,
  suggestVoices,
  type CastParagraph,
  type CastResult,
  type VoiceSuggestion,
} from "../llm/characters.js";
import type { Job } from "../schemas.js";
import { speakRequestSchema } from "../schemas.js";
import type { MirliService } from "../service.js";
import type { BookAccess, BookParagraph } from "./render-access.js";
import type { RenderService } from "./render.js";
import type { Character } from "./types.js";

export interface DetectOptions {
  chapter_ids?: string[];
  /** Move quoted dialogue out of narration paragraphs into its own paragraphs. */
  split_dialogue?: boolean;
  /** Use the heuristic even when the assistant model is on. */
  heuristic_only?: boolean;
}

export interface DetectResult {
  source: "llm" | "heuristic";
  characters: Character[];
  created: number;
  /** Paragraphs cast to a character. */
  cast: number;
  /** Paragraphs added by splitting dialogue out. */
  split: number;
  notes: string[];
}

export class CastService {
  constructor(
    private readonly svc: MirliService,
    private readonly book: BookAccess,
    private readonly render: RenderService,
  ) {}

  private requireBook(bookId: string) {
    const book = this.book.getBook(bookId);
    if (!book) throw new ModelError("Book not found.");
    return book;
  }

  /** Run detection over text, without writing anything. */
  async analyse(paragraphs: CastParagraph[], known: { name: string; aliases: string[] }[], heuristicOnly = false): Promise<{ result: CastResult; notes: string[] }> {
    const notes: string[] = [];
    const withQuotes = paragraphs.filter((p) => quotes(p.text).length > 0);
    if (!withQuotes.length) return { result: { characters: [], lines: [], dropped: 0, source: "heuristic" }, notes };
    if (!heuristicOnly && this.svc.config.settings.llm_mode !== "off") {
      try {
        const results: CastResult[] = [];
        // Narration around quotes gives the model the turn-taking; send
        // every paragraph, batched.
        for (const batch of batchParagraphs(paragraphs)) {
          if (!batch.some((p) => quotes(p.text).length)) continue;
          const reply = await this.svc.llm.chat(buildCharacterMessages(batch, known), { maxTokens: 3000 });
          results.push(parseCharacterReply(reply, batch, known));
        }
        const merged = mergeCastResults(results);
        if (merged.dropped) notes.push(`${merged.dropped} of the assistant's attributions pointed at nothing and were ignored.`);
        return { result: merged, notes };
      } catch (e) {
        notes.push(`The assistant model could not be used (${(e as Error).message}); used the "said X" rules instead.`);
      }
    } else if (!heuristicOnly) {
      notes.push("The prompt assistant is off, so speakers were found from \"said X\" tags only. Turn it on in Settings for better detection.");
    }
    return { result: heuristicCast(paragraphs), notes };
  }

  async detect(bookId: string, opts: DetectOptions = {}): Promise<DetectResult> {
    const book = this.requireBook(bookId);
    const chapters = [...book.chapters]
      .sort((a, b) => a.position - b.position)
      .filter((c) => (opts.chapter_ids?.length ? opts.chapter_ids.includes(c.id) : c.included));
    const indexed: { p: BookParagraph; chapterId: string }[] = [];
    for (const c of chapters) {
      for (const p of this.book.getParagraphs(c.id) ?? []) {
        if (p.kind === "line" && p.text.trim() && !p.is_heading) indexed.push({ p, chapterId: c.id });
      }
    }
    const paragraphs: CastParagraph[] = indexed.map((x, i) => ({ index: i, text: x.p.text }));
    const existing = this.book.listCharacters(bookId);
    const { result, notes } = await this.analyse(
      paragraphs,
      existing.map((c) => ({ name: c.name, aliases: c.aliases })),
      opts.heuristic_only,
    );

    // Characters: reuse by name or alias, otherwise create.
    let created = 0;
    const byName = new Map<string, Character>();
    const find = (name: string) =>
      this.book.listCharacters(bookId).find((c) =>
        [c.name, ...c.aliases].some((n) => n.toLowerCase() === name.toLowerCase()));
    for (const d of result.characters) {
      let c = find(d.name) ?? d.aliases.map(find).find(Boolean);
      if (!c) {
        c = this.book.createCharacter(bookId, { name: d.name, aliases: d.aliases, description: d.description });
        created++;
      } else {
        const aliases = [...new Set([...c.aliases, ...d.aliases, ...(c.name !== d.name ? [d.name] : [])])].filter((a) => a !== c!.name);
        c = this.book.updateCharacter(c.id, { aliases, description: c.description ?? d.description }) ?? c;
      }
      byName.set(d.name, c);
    }

    // Paragraph casting.
    let cast = 0;
    let split = 0;
    if (opts.split_dialogue) {
      for (const { p, chapterId } of [...indexed].reverse()) {
        const i = indexed.findIndex((x) => x.p.id === p.id);
        const lines = result.lines.filter((l) => l.index === i);
        if (!lines.length || p.locked) continue;
        const pieces = splitDialogue(p.text);
        const speakerOf = (piece: { text: string; quote: boolean }) => {
          if (!piece.quote) return null;
          const inner = quotes(piece.text)[0]?.inner ?? piece.text;
          const name = lines.find((l) => l.quote === inner)?.speaker;
          return name ? (byName.get(name)?.id ?? null) : null;
        };
        if (pieces.length < 2) {
          const id = speakerOf(pieces[0]!);
          if (id) cast += this.book.setParagraphCharacter([p.id], id);
          continue;
        }
        this.book.updateParagraph(p.id, { text: pieces[0]!.text });
        const first = speakerOf(pieces[0]!);
        if (first) cast += this.book.setParagraphCharacter([p.id], first);
        pieces.slice(1).forEach((piece, k) => {
          const added = this.book.addParagraph(chapterId, {
            text: piece.text,
            position: p.position + 1 + k,
            character_id: speakerOf(piece),
          });
          split++;
          if (added.character_id) cast++;
        });
      }
    } else {
      const speakers = paragraphSpeakers(paragraphs, result.lines);
      const groups = new Map<string, string[]>();
      for (const [i, name] of speakers) {
        const c = byName.get(name);
        if (!c) continue;
        groups.set(c.id, [...(groups.get(c.id) ?? []), indexed[i]!.p.id]);
      }
      for (const [cid, ids] of groups) cast += this.book.setParagraphCharacter(ids, cid);
    }
    return { source: result.source, characters: this.book.listCharacters(bookId), created, cast, split, notes };
  }

  /** Voice suggestions for every character (or one), distinct where possible. */
  suggest(bookId: string, characterId?: string): VoiceSuggestion[] {
    const book = this.requireBook(bookId);
    const characters = this.book.listCharacters(bookId);
    const counts = this.lineCounts(bookId);
    const voices = this.svc.listVoices().map((v) => ({
      id: v.id, name: v.name, notes: v.notes ?? null, voice_id: v.voice_id ?? null, model_id: v.model_id ?? null,
    }));
    const reserved = book.settings.narrator_voice_id ? [book.settings.narrator_voice_id] : [];
    const all = suggestVoices(
      characters.map((c) => ({ name: c.name, description: c.description, lines: counts.get(c.id) ?? 0 })),
      voices,
      reserved,
    );
    return characterId ? all.filter((_, i) => characters[i]!.id === characterId) : all;
  }

  /** Apply suggestions to characters that have no voice yet. */
  applySuggestions(bookId: string): number {
    const characters = this.book.listCharacters(bookId);
    let n = 0;
    this.suggest(bookId).forEach((s, i) => {
      const c = characters[i]!;
      if (!c.voice_id && s.voice_id) {
        this.book.updateCharacter(c.id, { voice_id: s.voice_id });
        n++;
      }
    });
    return n;
  }

  /** A real line from the book for a character (or the narrator): the
   *  first paragraph cast to them, else the first quote naming them. */
  sampleLine(bookId: string, characterId: string | null): { segment_id: string | null; text: string } | null {
    const book = this.requireBook(bookId);
    const all = book.chapters.flatMap((c) => this.book.getParagraphs(c.id) ?? []).filter((p) => p.kind === "line" && p.text.trim());
    const own = all.find((p) => p.character_id === characterId && !p.is_heading && p.text.length > 20);
    if (own) return { segment_id: own.id, text: own.text.slice(0, 400) };
    if (characterId) {
      const c = this.book.getCharacter(characterId);
      const names = c ? [c.name, ...c.aliases] : [];
      for (const p of all) {
        if (!names.some((n) => p.text.includes(n))) continue;
        const q = quotes(p.text)[0];
        if (q) return { segment_id: p.id, text: q.inner };
      }
    }
    const any = all.find((p) => !p.is_heading);
    return any ? { segment_id: any.id, text: any.text.slice(0, 400) } : null;
  }

  /** Read a sample line in `voiceId` (or the character's voice) without
   *  touching the paragraph. Returns the queued speak job. */
  async preview(bookId: string, characterId: string | null, voiceId?: string | null, text?: string): Promise<{ job: Job; text: string }> {
    const line = text ? { segment_id: null, text } : this.sampleLine(bookId, characterId);
    if (!line) throw new ModelError("This book has no text to preview yet.");
    const voice = voiceId ?? (characterId ? this.book.getCharacter(characterId)?.voice_id : null) ?? this.book.voiceFor(bookId, characterId);
    const book = this.requireBook(bookId);
    const probe = {
      id: line.segment_id ?? "", text: line.text, kind: "line", voice_id: voice, character_id: characterId,
      model_id: null, locked: false,
    } as unknown as BookParagraph;
    const choice = await this.render.chooseVoice(probe, bookId);
    const spoken = this.render.pronounced(bookId, line.text, choice.model).text;
    const req = speakRequestSchema.parse({
      model: choice.model,
      lines: [{ voice_id: voice ?? null, text: spoken }],
      name: `Preview: ${book.title}`,
    });
    return { job: this.svc.submitSpeak(req), text: line.text };
  }

  /** Swap one voice for another everywhere in a book: characters and the
   *  narrator. Core rewrites the paragraphs and marks voiced ones stale. */
  replaceVoice(bookId: string, from: string, to: string): { characters: number; narrator: boolean } {
    const book = this.requireBook(bookId);
    if (!this.svc.getVoice(to)) throw new ModelError("That voice does not exist.");
    let characters = 0;
    for (const c of this.book.listCharacters(bookId)) {
      if (c.voice_id === from) {
        this.book.updateCharacter(c.id, { voice_id: to });
        characters++;
      }
    }
    const narrator = book.settings.narrator_voice_id === from;
    if (narrator) this.book.updateBook(bookId, { settings: { narrator_voice_id: to } });
    return { characters, narrator };
  }

  /** Fold `mergeIds` into `keepId`: their paragraphs move over and their
   *  names become aliases. */
  merge(bookId: string, keepId: string, mergeIds: string[]): Character {
    const keep = this.book.getCharacter(keepId);
    if (!keep || keep.book_id !== bookId) throw new ModelError("Character not found.");
    const book = this.requireBook(bookId);
    const aliases = new Set(keep.aliases);
    for (const id of mergeIds) {
      if (id === keepId) continue;
      const c = this.book.getCharacter(id);
      if (!c || c.book_id !== bookId) continue;
      const ids = book.chapters
        .flatMap((ch) => this.book.getParagraphs(ch.id) ?? [])
        .filter((p) => p.character_id === id)
        .map((p) => p.id);
      if (ids.length) this.book.setParagraphCharacter(ids, keepId);
      aliases.add(c.name);
      c.aliases.forEach((a) => aliases.add(a));
      this.book.deleteCharacter(id);
    }
    aliases.delete(keep.name);
    return this.book.updateCharacter(keepId, { aliases: [...aliases] }) ?? keep;
  }

  private lineCounts(bookId: string): Map<string, number> {
    const book = this.requireBook(bookId);
    const out = new Map<string, number>();
    for (const ch of book.chapters) {
      for (const p of this.book.getParagraphs(ch.id) ?? []) {
        if (p.character_id) out.set(p.character_id, (out.get(p.character_id) ?? 0) + 1);
      }
    }
    return out;
  }
}
