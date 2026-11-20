/**
 * Audiobooks: pronunciation rules.
 *
 * A rule says how a term should be read. It is either an alias (plain text
 * the model reads instead: "Hermione" -> "her-MY-oh-nee") or a phoneme string
 * in IPA or CMU Arpabet. Rules are ordered and the first match wins: a span of
 * text claimed by an earlier rule is never touched by a later one.
 *
 * Phonemes only help a model that takes them. Measured against audio.cpp
 * 0.6.1: no family exposes a phoneme input. Kokoro and Kitten phonemise text
 * internally through eSpeak-ng and accept only text (`audiocpp_cli --help`
 * lists `--text` and no phoneme option). So `PHONEME_MARKUP` starts empty and
 * every IPA/CMU rule falls back: a later alias rule for the same term wins if
 * there is one, otherwise the phonemes are turned into a plain-text
 * respelling, and either way the result carries a warning.
 *
 * Everything here is pure, so it is tested without a model.
 */

import type { PronunciationKind, PronunciationRule } from "./types.js";

/* ------------------------------------------------------------ capability */

/**
 * Model families that read inline phonemes, and how to write them inline.
 * Empty today (see the header). A family that gains phoneme input adds an
 * entry here, and IPA/CMU rules then reach it unchanged.
 */
export const PHONEME_MARKUP: Record<
  string,
  { kinds: PronunciationKind[]; wrap: (term: string, phonemes: string, kind: PronunciationKind) => string }
> = {};

/** The family part of a model id: "audiocpp-kokoro" -> "kokoro". */
export function familyOf(modelId: string): string {
  return modelId.replace(/^audiocpp[-:]/, "").replace(/^endpoint:.*$/, "endpoint");
}

export function acceptsPhonemes(
  modelIdOrFamily: string,
  kind: PronunciationKind,
  markup = PHONEME_MARKUP,
): boolean {
  const entry = markup[modelIdOrFamily] ?? markup[familyOf(modelIdOrFamily)];
  return entry !== undefined && entry.kinds.includes(kind);
}

/* --------------------------------------------------------------- matching */

const WORD_CHAR = "[\\p{L}\\p{N}_'’]";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The regex a rule matches with. Null for an empty rule (skipped). */
export function ruleRegExp(rule: Pick<PronunciationRule, "term" | "case_sensitive" | "whole_word">): RegExp | null {
  const term = rule.term.trim();
  if (!term) return null;
  let body = escapeRegExp(term).replace(/\s+/g, "\\s+");
  if (rule.whole_word) body = `(?<!${WORD_CHAR})${body}(?!${WORD_CHAR})`;
  return new RegExp(body, rule.case_sensitive ? "gu" : "giu");
}

/** True if `rule` matches anywhere in `text`. Used to find stale paragraphs. */
export function ruleMatches(text: string, rule: PronunciationRule): boolean {
  const re = ruleRegExp(rule);
  return re !== null && re.test(text);
}

/** Book rules before global ones, each in their own order. */
export function orderRules(rules: PronunciationRule[]): PronunciationRule[] {
  return [...rules].sort((a, b) => {
    const ga = a.book_id === null ? 1 : 0;
    const gb = b.book_id === null ? 1 : 0;
    return ga - gb || a.position - b.position;
  });
}

export interface AppliedRule {
  rule_id: string;
  term: string;
  count: number;
  /** How the rule was applied for this model. */
  as: "alias" | "phonemes" | "respelling";
}

export interface PronounceResult {
  text: string;
  applied: AppliedRule[];
  warnings: string[];
}

/**
 * Apply `rules` to `text` for `modelId`.
 *
 * Rules are taken in order (book first, then global; each by `position`).
 * Each claims every span it matches that no earlier rule claimed. IPA/CMU
 * rules on a model without phoneme input are deferred to the end, so an alias
 * for the same term further down still wins over a respelling.
 */
export function applyPronunciations(
  text: string,
  rules: PronunciationRule[],
  modelId: string,
  markup = PHONEME_MARKUP,
): PronounceResult {
  const ordered = orderRules(rules).filter((r) => r.term.trim() && r.replacement.trim());
  const direct: PronunciationRule[] = [];
  const deferred: PronunciationRule[] = [];
  for (const r of ordered) {
    if (r.kind === "alias" || acceptsPhonemes(modelId, r.kind, markup)) direct.push(r);
    else deferred.push(r);
  }

  interface Span { start: number; end: number; out: string; rule: PronunciationRule; as: AppliedRule["as"] }
  const spans: Span[] = [];
  const overlaps = (s: number, e: number) => spans.some((x) => s < x.end && e > x.start);

  const claim = (rule: PronunciationRule, as: AppliedRule["as"]) => {
    const re = ruleRegExp(rule);
    if (!re) return;
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (end === start || overlaps(start, end)) continue;
      let out: string;
      if (as === "alias") out = rule.replacement;
      else if (as === "phonemes") {
        const entry = markup[modelId] ?? markup[familyOf(modelId)];
        out = entry ? entry.wrap(m[0], rule.replacement, rule.kind) : m[0];
      } else out = respell(rule.replacement, rule.kind) || m[0];
      spans.push({ start, end, out, rule, as });
    }
  };

  for (const r of direct) claim(r, r.kind === "alias" ? "alias" : "phonemes");
  const before = new Set(spans);
  for (const r of deferred) claim(r, "respelling");

  const warnings: string[] = [];
  const family = familyOf(modelId);
  for (const r of deferred) {
    const re = ruleRegExp(r);
    if (!re || !re.test(text)) continue;
    const used = spans.some((s) => s.rule === r && !before.has(s));
    const label = r.kind === "ipa" ? "IPA" : "CMU";
    warnings.push(
      used
        ? `${family} reads plain text, so the ${label} rule for "${r.term}" was read as the respelling "${respell(r.replacement, r.kind)}".`
        : `${family} reads plain text, so the ${label} rule for "${r.term}" was skipped and an earlier alias was used.`,
    );
  }

  spans.sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  const counts = new Map<PronunciationRule, AppliedRule>();
  for (const s of spans) {
    out += text.slice(at, s.start) + s.out;
    at = s.end;
    const a = counts.get(s.rule) ?? { rule_id: s.rule.id, term: s.rule.term, count: 0, as: s.as };
    a.count++;
    counts.set(s.rule, a);
  }
  out += text.slice(at);
  return { text: out, applied: [...counts.values()], warnings };
}

/* ------------------------------------------------------------- respelling */

const ARPA_RESPELL: Record<string, string> = {
  AA: "ah", AE: "a", AH: "uh", AO: "aw", AW: "ow", AY: "eye", EH: "eh", ER: "er",
  EY: "ay", IH: "ih", IY: "ee", OW: "oh", OY: "oy", UH: "uu", UW: "oo",
  B: "b", CH: "ch", D: "d", DH: "th", F: "f", G: "g", HH: "h", JH: "j", K: "k",
  L: "l", M: "m", N: "n", NG: "ng", P: "p", R: "r", S: "s", SH: "sh", T: "t",
  TH: "th", V: "v", W: "w", Y: "y", Z: "z", ZH: "zh",
};
const ARPA_VOWELS = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);

/** IPA symbols to Arpabet, longest first. Approximate on purpose: the result
 *  only feeds a plain-text respelling. */
const IPA_TO_ARPA: [string, string][] = [
  ["tʃ", "CH"], ["dʒ", "JH"], ["aɪ", "AY"], ["aʊ", "AW"], ["ɔɪ", "OY"], ["eɪ", "EY"],
  ["oʊ", "OW"], ["əʊ", "OW"], ["ɪə", "IH R"], ["eə", "EH R"], ["ʊə", "UH R"],
  ["ɑ", "AA"], ["ɒ", "AA"], ["æ", "AE"], ["ʌ", "AH"], ["ə", "AH"], ["ɐ", "AH"], ["ɔ", "AO"],
  ["ɛ", "EH"], ["e", "EH"], ["ɜ", "ER"], ["ɝ", "ER"], ["ɚ", "ER"], ["ɪ", "IH"], ["i", "IY"],
  ["ʊ", "UH"], ["u", "UW"], ["o", "OW"], ["a", "AA"], ["θ", "TH"], ["ð", "DH"], ["ʃ", "SH"],
  ["ʒ", "ZH"], ["ŋ", "NG"], ["ɹ", "R"], ["r", "R"], ["ɾ", "T"], ["j", "Y"], ["ɡ", "G"], ["g", "G"],
  ["b", "B"], ["d", "D"], ["f", "F"], ["h", "HH"], ["k", "K"], ["l", "L"], ["m", "M"],
  ["n", "N"], ["p", "P"], ["s", "S"], ["t", "T"], ["v", "V"], ["w", "W"], ["z", "Z"], ["x", "K"],
];

/** IPA to Arpabet tokens with stress digits (1 on the vowel after ˈ). */
export function ipaToArpabet(ipa: string): string[] {
  const s = ipa.replace(/[/[\]ː.ˑ̩̯]/g, "").replace(/l̩/g, "l").normalize("NFC");
  const out: string[] = [];
  let stress = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "ˈ") { stress = 1; i++; continue; }
    if (ch === "ˌ") { stress = 2; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    const hit = IPA_TO_ARPA.find(([sym]) => s.startsWith(sym, i));
    if (!hit) { i++; continue; }
    for (const tok of hit[1].split(" ")) {
      if (ARPA_VOWELS.has(tok)) {
        out.push(`${tok}${stress === 1 ? 1 : stress === 2 ? 2 : 0}`);
        stress = 0;
      } else out.push(tok);
    }
    i += hit[0].length;
  }
  return out;
}

/**
 * A readable respelling of phonemes for a model that only reads text:
 * "HH ER0 M AY1 AH0 N IY0" -> "her-MY-uh-nee". Syllables split before the
 * last consonant ahead of each vowel; the primary-stressed one is capitalised.
 */
export function respell(phonemes: string, kind: PronunciationKind): string {
  const tokens = kind === "ipa"
    ? ipaToArpabet(phonemes)
    : phonemes.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (kind === "alias") return phonemes;
  const syllables: { text: string; stressed: boolean }[] = [];
  let pending: string[] = [];
  for (const tok of tokens) {
    const m = /^([A-Z]+)([0-2])?$/.exec(tok);
    if (!m) continue;
    const base = m[1]!;
    if (!ARPA_RESPELL[base]) continue;
    if (ARPA_VOWELS.has(base)) {
      const prev = syllables[syllables.length - 1];
      // Coda: all but the last pending consonant stay with the previous syllable.
      if (prev && pending.length > 1) {
        prev.text += pending.slice(0, -1).map((c) => ARPA_RESPELL[c]).join("");
        pending = pending.slice(-1);
      }
      syllables.push({
        // "eye" alone, but "my", "ty" after a consonant.
        text: pending.map((c) => ARPA_RESPELL[c]).join("") + (base === "AY" && pending.length ? "y" : ARPA_RESPELL[base]),
        stressed: m[2] === "1",
      });
      pending = [];
    } else pending.push(base);
  }
  if (pending.length) {
    if (syllables.length) syllables[syllables.length - 1]!.text += pending.map((c) => ARPA_RESPELL[c]).join("");
    else syllables.push({ text: pending.map((c) => ARPA_RESPELL[c]).join(""), stressed: false });
  }
  const anyStress = syllables.some((s) => s.stressed);
  return syllables
    .map((s) => (s.stressed && anyStress && syllables.length > 1 ? s.text.toUpperCase() : s.text))
    .join("-");
}

/* ---------------------------------------------------------- PLS and TXT */

/** A rule as read from a file, before it has an id or a book. */
export type RuleDraft = Pick<PronunciationRule, "term" | "kind" | "replacement" | "case_sensitive" | "whole_word">;

const PLS_NS = "http://www.w3.org/2005/01/pronunciation-lexicon";

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function xmlUnescape(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .trim();
}

function alphabetKind(alphabet: string | undefined): PronunciationKind | null {
  const a = (alphabet ?? "").toLowerCase();
  if (a === "ipa") return "ipa";
  if (/(^|-)(cmu|arpabet)/.test(a)) return "cmu";
  return null;
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? (m[2] ?? m[3]) : undefined;
}

/**
 * Read a W3C Pronunciation Lexicon (PLS 1.0). Each grapheme of a lexeme
 * becomes one rule; the lexeme's first phoneme or alias is its replacement.
 * The lexicon `alphabet` is "ipa" or a vendor value; "cmu-arpabet" (the value
 * ElevenLabs' examples use) and "x-cmu…" variants read as CMU. PLS matching
 * is case-sensitive, so imported rules are too.
 */
export function parsePls(xml: string): { rules: RuleDraft[]; warnings: string[] } {
  const warnings: string[] = [];
  const lexicon = /<lexicon\b[^>]*>/i.exec(xml);
  if (!lexicon) throw new Error("Not a pronunciation lexicon: no <lexicon> element.");
  const lexiconKind = alphabetKind(attr(lexicon[0], "alphabet"));
  const rules: RuleDraft[] = [];
  for (const lm of xml.matchAll(/<lexeme\b[^>]*>([\s\S]*?)<\/lexeme>/gi)) {
    const body = lm[1]!;
    const graphemes = [...body.matchAll(/<grapheme\b[^>]*>([\s\S]*?)<\/grapheme>/gi)].map((g) => xmlUnescape(g[1]!));
    const pron = /<(phoneme|alias)\b([^>]*)>([\s\S]*?)<\/\1>/i.exec(body);
    if (!graphemes.length || !pron) continue;
    let kind: PronunciationKind;
    if (pron[1]!.toLowerCase() === "alias") kind = "alias";
    else {
      const k = alphabetKind(attr(pron[2]!, "alphabet")) ?? lexiconKind;
      if (!k) {
        warnings.push(`Skipped "${graphemes[0]}": unknown phoneme alphabet.`);
        continue;
      }
      kind = k;
    }
    const replacement = xmlUnescape(pron[3]!);
    for (const term of graphemes) {
      if (term) rules.push({ term, kind, replacement, case_sensitive: true, whole_word: true });
    }
  }
  return { rules, warnings };
}

/**
 * Write rules as PLS 1.0. The lexicon alphabet is "cmu-arpabet" when every
 * phoneme rule is CMU (what ElevenLabs reads), otherwise "ipa", with CMU
 * phonemes then marked per element.
 */
export function toPls(rules: Pick<PronunciationRule, "term" | "kind" | "replacement">[], lang = "en"): string {
  const phonemeKinds = new Set(rules.filter((r) => r.kind !== "alias").map((r) => r.kind));
  const lexAlphabet = phonemeKinds.size === 1 && phonemeKinds.has("cmu") ? "cmu-arpabet" : "ipa";
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<lexicon version="1.0" xmlns="${PLS_NS}" alphabet="${lexAlphabet}" xml:lang="${xmlEscape(lang)}">`,
  ];
  for (const r of rules) {
    const pron = r.kind === "alias"
      ? `<alias>${xmlEscape(r.replacement)}</alias>`
      : r.kind === "cmu" && lexAlphabet !== "cmu-arpabet"
        ? `<phoneme alphabet="cmu-arpabet">${xmlEscape(r.replacement)}</phoneme>`
        : `<phoneme>${xmlEscape(r.replacement)}</phoneme>`;
    lines.push(`  <lexeme><grapheme>${xmlEscape(r.term)}</grapheme>${pron}</lexeme>`);
  }
  lines.push("</lexicon>", "");
  return lines.join("\n");
}

/**
 * Mirli's plain-text dictionary, one rule per line (no published TXT format
 * exists to follow):
 *
 *   # comment
 *   Hermione = her-MY-oh-nee        alias
 *   Hermione = /hɝˈmaɪəni/          IPA between slashes
 *   Hermione = {HH ER0 M AY1 AH0 N IY0}   CMU between braces
 *
 * A tab works in place of " = ".
 */
export function parseTxt(text: string): { rules: RuleDraft[]; warnings: string[] } {
  const rules: RuleDraft[] = [];
  const warnings: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = /^(.+?)(?:\s*=\s*|\t+)(.+)$/.exec(line);
    if (!m) {
      warnings.push(`Line ${i + 1}: expected "term = replacement".`);
      return;
    }
    const term = m[1]!.trim();
    const rhs = m[2]!.trim();
    let kind: PronunciationKind = "alias";
    let replacement = rhs;
    const ipa = /^\/(.+)\/$/.exec(rhs);
    const cmu = /^\{(.+)\}$/.exec(rhs);
    if (ipa) { kind = "ipa"; replacement = ipa[1]!.trim(); }
    else if (cmu) { kind = "cmu"; replacement = cmu[1]!.trim(); }
    rules.push({ term, kind, replacement, case_sensitive: true, whole_word: true });
  });
  return { rules, warnings };
}

export function toTxt(rules: Pick<PronunciationRule, "term" | "kind" | "replacement">[]): string {
  const lines = ["# Mirli pronunciation dictionary: term = alias, /ipa/ or {CMU}"];
  for (const r of rules) {
    const rhs = r.kind === "ipa" ? `/${r.replacement}/` : r.kind === "cmu" ? `{${r.replacement}}` : r.replacement;
    lines.push(`${r.term} = ${rhs}`);
  }
  return lines.join("\n") + "\n";
}

/* ------------------------------------------------------------ suggestions */

export interface TermSuggestion {
  term: string;
  count: number;
  /** "name": a capitalised word used mid-sentence more than once.
   *  "invented": spelling unlike ordinary English. */
  reason: "name" | "invented";
  /** The first sentence it appears in, for "play in context". */
  example: string;
}

/** Capitalised words that are ordinary English, not names. Short on
 *  purpose: a name only needs to be capitalised mid-sentence to qualify,
 *  so this only has to cover words that are capitalised anyway. */
const COMMON_CAPS = new Set(
  ("I I'm I'd I'll I've Mr Mrs Ms Dr Sir Madam Lord Lady King Queen Prince Princess Captain " +
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May " +
    "June July August September October November December God OK English French German Spanish " +
    "Chapter Part Book The A An And But Or So Then When Where What Who Why How It He She They We You")
    .split(" ").map((w) => w.toLowerCase()),
);

/** Letter patterns rare in English words: a hint that a word is invented. */
const ODD_SPELLING = [
  /q(?!u)/i, /[^aeiouy\s'’-]{4,}/i, /([aeiou])\1\1/i, /aa|ii|uu|yy/i, /(^|[^s])zh|kh|gw|xh|tl$/i,
  /[À-ɏ]/, /'[a-z]{2,}'?[a-z]/i, /^[^aeiouy]+$/i,
];

function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(".", index), text.lastIndexOf("!", index), text.lastIndexOf("?", index), text.lastIndexOf("\n", index)) + 1;
  const ends = [".", "!", "?", "\n"].map((c) => text.indexOf(c, index)).filter((i) => i !== -1);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  return text.slice(start, end).trim().slice(0, 300);
}

/**
 * Terms worth a rule: names (capitalised mid-sentence, used at least twice)
 * and invented-looking words, most frequent first. `known` filters out
 * terms that already have a rule.
 */
export function suggestTerms(paragraphs: string[], known: string[] = [], limit = 50): TermSuggestion[] {
  const skip = new Set(known.map((k) => k.toLowerCase()));
  const found = new Map<string, TermSuggestion & { midSentence: number }>();
  for (const text of paragraphs) {
    for (const m of text.matchAll(/[\p{L}][\p{L}'’-]*[\p{L}]|[\p{L}]/gu)) {
      const word = m[0].replace(/[’']s$/, "");
      const lower = word.toLowerCase();
      if (word.length < 3 || skip.has(lower)) continue;
      const idx = m.index ?? 0;
      const before = text.slice(0, idx).trimEnd();
      const sentenceStart = before === "" || /[.!?:"“”‘'—–-]$/.test(before);
      const capitalised = /^\p{Lu}/u.test(word) && word !== word.toUpperCase();
      const invented = ODD_SPELLING.some((re) => re.test(word));
      const name = capitalised && !COMMON_CAPS.has(lower);
      if (!name && !invented) continue;
      const key = capitalised ? word : lower;
      const prev = found.get(key);
      if (prev) {
        prev.count++;
        if (!sentenceStart) prev.midSentence++;
      } else {
        found.set(key, {
          term: word,
          count: 1,
          midSentence: sentenceStart ? 0 : 1,
          reason: invented ? "invented" : "name",
          example: sentenceAround(text, idx),
        });
      }
    }
  }
  return [...found.values()]
    .filter((s) => s.reason === "invented" || (s.count >= 2 && s.midSentence >= 1))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, limit)
    .map(({ midSentence: _m, ...s }) => s);
}

/** Paragraphs whose text a rule's change affects (match old or new term). */
export function affectedParagraphs(
  paragraphs: { id: string; text: string }[],
  rules: PronunciationRule[],
): string[] {
  return paragraphs.filter((p) => rules.some((r) => ruleMatches(p.text, r))).map((p) => p.id);
}
