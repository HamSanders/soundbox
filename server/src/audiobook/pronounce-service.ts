/**
 * Audiobooks: pronunciation rules as the API sees them. Every change marks
 * the paragraphs it affects stale (those containing the old or new term), so
 * a re-render picks them up; a global rule's change reaches every book.
 */

import { ModelError } from "../errors.js";
import type { Job } from "../schemas.js";
import { speakRequestSchema } from "../schemas.js";
import type { MirliService } from "../service.js";
import {
  affectedParagraphs,
  applyPronunciations,
  parsePls,
  parseTxt,
  ruleRegExp,
  suggestTerms,
  toPls,
  toTxt,
  type RuleDraft,
  type TermSuggestion,
} from "./pronounce.js";
import type { RuleFields } from "./pronounce-store.js";
import type { BookAccess } from "./render-access.js";
import { voiceStores } from "./render-access.js";
import type { RenderService } from "./render.js";
import type { PronunciationRule } from "./types.js";

export class PronounceService {
  constructor(
    private readonly svc: MirliService,
    private readonly book: BookAccess & { allBookIds(): string[] },
    private readonly render: RenderService,
  ) {}

  private get store() {
    return voiceStores(this.svc.db).pronunciations;
  }

  list(bookId: string | null): PronunciationRule[] {
    return this.store.list(bookId);
  }

  private paragraphs(bookIds: string[]): { id: string; text: string; bookId: string }[] {
    return bookIds.flatMap((bookId) => {
      const book = this.book.getBook(bookId);
      return (book?.chapters ?? []).flatMap((c) =>
        (this.book.getParagraphs(c.id) ?? [])
          .filter((p) => p.kind === "line" && p.sound_id && !p.locked)
          .map((p) => ({ id: p.id, text: p.text, bookId })),
      );
    });
  }

  /** Mark paragraphs matching any of `rules` stale. Returns how many. */
  markStale(bookId: string | null, rules: PronunciationRule[]): number {
    // Trashed books too: restored, they should read with the rule.
    const books = bookId ? [bookId] : this.book.allBookIds();
    const ids = affectedParagraphs(this.paragraphs(books), rules);
    return ids.length ? this.book.markStale(ids) : 0;
  }

  create(bookId: string | null, fields: RuleFields & { term: string; replacement: string }): { rule: PronunciationRule; stale: number } {
    this.validate(fields);
    const rule = this.store.create(bookId, fields);
    return { rule, stale: this.markStale(bookId, [rule]) };
  }

  update(ruleId: string, fields: RuleFields): { rule: PronunciationRule; stale: number } | null {
    const before = this.store.get(ruleId);
    if (!before) return null;
    this.validate({ ...before, ...fields });
    const rule = this.store.update(ruleId, fields)!;
    return { rule, stale: this.markStale(rule.book_id, [before, rule]) };
  }

  delete(ruleId: string): { stale: number } | null {
    const rule = this.store.get(ruleId);
    if (!rule) return null;
    this.store.delete(ruleId);
    return { stale: this.markStale(rule.book_id, [rule]) };
  }

  reorder(bookId: string | null, ids: string[]): PronunciationRule[] {
    const own = new Set(this.store.list(bookId).map((r) => r.id));
    if (ids.some((id) => !own.has(id))) throw new ModelError("Those rules are not all in this dictionary.");
    this.store.reorder(ids);
    const rules = this.store.list(bookId);
    this.markStale(bookId, rules);
    return rules;
  }

  /** Add rules from a .pls or .txt file. Terms already present are updated. */
  import(bookId: string | null, body: string, filename: string): { added: number; updated: number; warnings: string[]; stale: number } {
    const isPls = /\.pls$|\.xml$/i.test(filename) || /^\s*(<\?xml|<lexicon)/.test(body);
    const { rules, warnings } = isPls ? parsePls(body) : parseTxt(body);
    let added = 0;
    let updated = 0;
    const touched: PronunciationRule[] = [];
    const existing = this.store.list(bookId);
    for (const r of rules) {
      const same = existing.find((e) => e.term === r.term && e.kind === r.kind);
      if (same) {
        touched.push(same, this.store.update(same.id, { replacement: r.replacement })!);
        updated++;
      } else {
        touched.push(this.store.create(bookId, r));
        added++;
      }
    }
    return { added, updated, warnings, stale: this.markStale(bookId, touched) };
  }

  export(bookId: string | null, format: "pls" | "txt", lang = "en"): string {
    const rules = this.store.list(bookId);
    return format === "pls" ? toPls(rules, lang) : toTxt(rules);
  }

  suggest(bookId: string): TermSuggestion[] {
    const book = this.book.getBook(bookId);
    if (!book) throw new ModelError("Book not found.");
    const texts = book.chapters
      .filter((c) => c.included)
      .flatMap((c) => (this.book.getParagraphs(c.id) ?? []).filter((p) => p.kind === "line").map((p) => p.text));
    const known = this.store.rulesFor(bookId).map((r) => r.term);
    return suggestTerms(texts, known);
  }

  /**
   * Read a term in its sentence, with the book's rules applied: a rule's own
   * term (`ruleId`), or any term or draft rule (`draft`) before it is saved.
   */
  async play(bookId: string, opts: { ruleId?: string; draft?: RuleDraft; text?: string }): Promise<{ job: Job; text: string; spoken: string; warnings: string[] }> {
    const book = this.book.getBook(bookId);
    if (!book) throw new ModelError("Book not found.");
    const rule = opts.ruleId ? this.store.get(opts.ruleId) : null;
    const term = rule?.term ?? opts.draft?.term ?? null;
    let text = opts.text ?? null;
    let segment: { id: string; voice_id?: string | null; character_id: string | null } | null = null;
    if (!text && term) {
      const re = ruleRegExp({ term, case_sensitive: rule?.case_sensitive ?? opts.draft?.case_sensitive ?? true, whole_word: rule?.whole_word ?? opts.draft?.whole_word ?? true });
      for (const c of book.chapters) {
        for (const p of this.book.getParagraphs(c.id) ?? []) {
          const m = re ? new RegExp(re.source, re.flags.replace("g", "")).exec(p.text) : null;
          if (!m) continue;
          const sentences = p.text.match(/[^.!?…]+[.!?…]*["”’]?/g) ?? [p.text];
          let at = 0;
          text = sentences.find((s) => {
            const hit = m.index >= at && m.index < at + s.length;
            at += s.length;
            return hit;
          })?.trim() ?? p.text;
          segment = p;
          break;
        }
        if (text) break;
      }
    }
    text ??= term;
    if (!text) throw new ModelError("Nothing to read.");
    const probe = { id: segment?.id ?? "", text, kind: "line", voice_id: segment?.voice_id ?? null, character_id: segment?.character_id ?? null, model_id: null, locked: false };
    const choice = await this.render.chooseVoice(probe as never, bookId);
    const rules = this.store.rulesFor(bookId);
    const withDraft = opts.draft
      ? [{ id: "draft", book_id: bookId, position: -1, ...opts.draft }, ...rules.map((r) => ({ ...r }))]
      : rules;
    const pr = applyPronunciations(text, withDraft as PronunciationRule[], choice.model);
    const req = speakRequestSchema.parse({ model: choice.model, lines: [{ voice_id: choice.voice_id, text: pr.text }], name: `Pronunciation: ${term ?? "preview"}` });
    return { job: this.svc.submitSpeak(req), text, spoken: pr.text, warnings: pr.warnings };
  }

  private validate(r: { term?: string; replacement?: string; kind?: string }): void {
    if (!r.term?.trim()) throw new ModelError("A rule needs a term.");
    if (!r.replacement?.trim()) throw new ModelError("A rule needs a replacement.");
    if (r.kind && !["alias", "ipa", "cmu"].includes(r.kind)) throw new ModelError("Kind must be alias, ipa or cmu.");
  }
}
