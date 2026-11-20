/**
 * Audiobooks: who speaks in a chapter, and which voice suits them.
 *
 * Three pure pieces, tested without a model (as `studio.ts` is):
 *
 * - `buildCharacterMessages` / `parseCharacterReply`: ask the assistant model
 *   for the chapter's speakers, a short description of each, and who says
 *   each quoted line. The model only refers to paragraphs by the numbers it
 *   was shown; anything pointing at a paragraph or quote that does not exist
 *   is dropped.
 * - `heuristicCast`: the no-model fallback. It applies the attribution rules
 *   of `autoCast` in `app/src/lib/script-parse.ts` ("…," said Mara. /
 *   Mara said, "…") to each paragraph's quotes.
 * - `suggestVoices`: match descriptions to saved voices' metadata (name,
 *   notes, and Kokoro-style ids such as `bf_emma`, whose first letters give
 *   accent and gender), giving each character a distinct voice where there
 *   are enough.
 */

import type { ChatMessage } from "./client.js";

export interface CastParagraph {
  /** Index shown to the model; the caller maps it back to a segment id. */
  index: number;
  text: string;
}

export interface CharacterTraits {
  age: string | null;
  gender: string | null;
  accent: string | null;
  temperament: string | null;
}

export interface DetectedCharacter {
  name: string;
  aliases: string[];
  traits: CharacterTraits;
  /** "age, gender, accent, temperament" as one line, for `Character.description`. */
  description: string | null;
  /** Lines attributed to this character in the scanned text. */
  lines: number;
}

export interface LineAttribution {
  index: number;
  speaker: string;
  /** The quoted words, as found in the paragraph. */
  quote: string;
}

export interface CastResult {
  characters: DetectedCharacter[];
  lines: LineAttribution[];
  /** Entries the model returned that referred to nothing real. */
  dropped: number;
  source: "llm" | "heuristic";
}

/* ----------------------------------------------------------------- quotes */

/** Quoted spans in a paragraph: “…”, "…" and ‘…’ (not apostrophes). */
export function quotes(text: string): { start: number; end: number; inner: string }[] {
  const out: { start: number; end: number; inner: string }[] = [];
  const re = /“([^”]+)”|"([^"]+)"|(?<![\p{L}\p{N}])‘([^’]+)’(?![\p{L}\p{N}])/gu;
  for (const m of text.matchAll(re)) {
    out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, inner: m[1] ?? m[2] ?? m[3] ?? "" });
  }
  return out;
}

/** Share of a paragraph's characters inside quotes. */
export function dialogueShare(text: string): number {
  const len = text.trim().length;
  if (!len) return 0;
  return quotes(text).reduce((n, q) => n + (q.end - q.start), 0) / len;
}

/**
 * Split a paragraph into narration and quoted pieces, in order. Attribution
 * glue (", she said,") stays with the narration around it. Pieces are
 * trimmed; empty ones are dropped.
 */
export function splitDialogue(text: string): { text: string; quote: boolean }[] {
  const pieces: { text: string; quote: boolean }[] = [];
  let at = 0;
  for (const q of quotes(text)) {
    const before = text.slice(at, q.start).trim();
    if (before) pieces.push({ text: before, quote: false });
    pieces.push({ text: text.slice(q.start, q.end).trim(), quote: true });
    at = q.end;
  }
  const rest = text.slice(at).trim();
  if (rest) pieces.push({ text: rest, quote: false });
  return pieces;
}

/* -------------------------------------------------------------- heuristic */

const SAID =
  "said|asked|replied|whispered|shouted|muttered|called|answered|cried|added|went on|snapped|murmured|yelled|sighed|laughed|told|began|continued|insisted|demanded";
const NAME = "([A-Z][\\p{L}'’-]+(?:\\s[A-Z][\\p{L}'’-]+)?)";
/** After the quote: "…," said Mara / "…," Mara said. */
const AFTER_SAID_NAME = new RegExp(`^\\s*,?\\s*(?:${SAID})\\s+${NAME}`, "u");
const AFTER_NAME_SAID = new RegExp(`^\\s*,?\\s*${NAME}\\s+(?:${SAID})\\b`, "u");
/** Before the quote: Mara said, "…" */
const BEFORE = new RegExp(`${NAME}\\s+(?:${SAID})\\s*,?\\s*$`, "u");
/** Words that look like names after "said" but are not. */
const NOT_NAMES = new Set(["He", "She", "They", "It", "I", "We", "You", "The", "His", "Her", "Their", "Then", "And", "But"]);

/** Who says each quote, from "said X" attribution. Unattributed quotes in
 *  a paragraph inherit an attributed one from the same paragraph. */
export function heuristicCast(paragraphs: CastParagraph[]): CastResult {
  const lines: LineAttribution[] = [];
  const counts = new Map<string, number>();
  for (const p of paragraphs) {
    const qs = quotes(p.text);
    if (!qs.length) continue;
    const found: (string | null)[] = qs.map((q) => {
      const after = p.text.slice(q.end, q.end + 60);
      const before = p.text.slice(Math.max(0, q.start - 60), q.start);
      const m = AFTER_SAID_NAME.exec(after) ?? AFTER_NAME_SAID.exec(after) ?? BEFORE.exec(before);
      const name = m?.[1] ?? null;
      return name && !NOT_NAMES.has(name) ? name : null;
    });
    const fallback = found.find((f) => f !== null) ?? null;
    qs.forEach((q, i) => {
      const speaker = found[i] ?? fallback;
      if (!speaker) return;
      lines.push({ index: p.index, speaker, quote: q.inner });
      counts.set(speaker, (counts.get(speaker) ?? 0) + 1);
    });
  }
  const characters = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, aliases: [], traits: emptyTraits(), description: null, lines: n }));
  return { characters, lines, dropped: 0, source: "heuristic" };
}

function emptyTraits(): CharacterTraits {
  return { age: null, gender: null, accent: null, temperament: null };
}

/* ------------------------------------------------------------------- LLM */

/** Characters of text sent per request; longer chapters go in batches. */
export const CAST_BATCH_CHARS = 12000;

/** Split paragraphs into batches of about `maxChars`. */
export function batchParagraphs(paragraphs: CastParagraph[], maxChars = CAST_BATCH_CHARS): CastParagraph[][] {
  const out: CastParagraph[][] = [];
  let cur: CastParagraph[] = [];
  let size = 0;
  for (const p of paragraphs) {
    if (cur.length && size + p.text.length > maxChars) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(p);
    size += p.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function buildCharacterMessages(
  paragraphs: CastParagraph[],
  known: { name: string; aliases: string[] }[] = [],
): ChatMessage[] {
  const system = [
    "You read fiction and work out who is speaking. You answer with JSON only.",
    "",
    "Given numbered paragraphs, find every character who speaks a quoted line.",
    "For each character give: name (as the text names them), aliases (other names the text uses for the same person),",
    "and what the text says or strongly implies about them: age (child, teen, young adult, adult, middle-aged, elderly),",
    "gender (female, male, or null if unknown), accent (e.g. British, American, Scottish, or null), and temperament",
    "(two or three words, e.g. \"gruff, impatient\"). Use null when the text gives no clue; do not invent.",
    "",
    "Then attribute each quoted line: the paragraph number, the speaker's name, and the first few words of the quote",
    "copied exactly. Use the conversation's turn-taking when a line has no tag. Skip lines you cannot attribute.",
    "Thoughts, signs and letters are not speech.",
    "",
    'Answer exactly: {"characters":[{"name":"","aliases":[],"age":null,"gender":null,"accent":null,"temperament":null}],',
    '"lines":[{"p":0,"speaker":"","quote":""}]}',
  ].join("\n");
  const knownLine = known.length
    ? `Characters already known (reuse these names): ${known.map((k) => [k.name, ...k.aliases].join(" / ")).join("; ")}\n\n`
    : "";
  const body = paragraphs.map((p) => `[${p.index}] ${p.text}`).join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `${knownLine}${body}` },
  ];
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(cleaned);
  const candidate = fenced ? fenced[1]!.trim() : cleaned;
  try {
    return JSON.parse(candidate);
  } catch {
    const a = candidate.indexOf("{");
    const b = candidate.lastIndexOf("}");
    if (a !== -1 && b > a) {
      try {
        return JSON.parse(candidate.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null);

/** Normalise for matching quotes: lower case, letters and digits only. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function describeTraits(t: CharacterTraits): string | null {
  const parts = [t.age, t.gender, t.accent ? `${t.accent} accent` : null, t.temperament].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Parse the model's answer. Speakers must be a returned character (or an
 * alias of one, or a known name); paragraph numbers must exist; a quote must
 * match one of that paragraph's quoted spans, by its opening words.
 */
export function parseCharacterReply(
  text: string,
  paragraphs: CastParagraph[],
  known: { name: string; aliases: string[] }[] = [],
): CastResult {
  const data = extractJson(text) as { characters?: unknown; lines?: unknown } | null;
  let dropped = 0;
  const characters: DetectedCharacter[] = [];
  const nameOf = new Map<string, string>();
  const register = (name: string, aliases: string[]) => {
    for (const n of [name, ...aliases]) nameOf.set(n.toLowerCase(), name);
  };
  for (const k of known) register(k.name, k.aliases);

  for (const raw of Array.isArray(data?.characters) ? data!.characters : []) {
    const c = raw as Record<string, unknown>;
    const name = str(c.name);
    if (!name) {
      dropped++;
      continue;
    }
    const existing = nameOf.get(name.toLowerCase());
    const aliases = (Array.isArray(c.aliases) ? c.aliases : []).map(str).filter((a): a is string => a !== null && a !== name);
    const traits: CharacterTraits = {
      age: str(c.age),
      gender: str(c.gender)?.toLowerCase() ?? null,
      accent: str(c.accent),
      temperament: str(c.temperament),
    };
    const canonical = existing ?? name;
    const prev = characters.find((x) => x.name === canonical);
    if (prev) {
      prev.aliases = [...new Set([...prev.aliases, ...aliases])];
      continue;
    }
    characters.push({ name: canonical, aliases, traits, description: describeTraits(traits), lines: 0 });
    register(canonical, aliases);
  }

  const byIndex = new Map(paragraphs.map((p) => [p.index, p]));
  const lines: LineAttribution[] = [];
  for (const raw of Array.isArray(data?.lines) ? data!.lines : []) {
    const l = raw as Record<string, unknown>;
    const p = byIndex.get(typeof l.p === "number" ? l.p : Number(l.p));
    const speakerRaw = str(l.speaker);
    const speaker = speakerRaw ? nameOf.get(speakerRaw.toLowerCase()) : undefined;
    if (!p || !speaker) {
      dropped++;
      continue;
    }
    const qs = quotes(p.text);
    const want = norm(str(l.quote) ?? "");
    const match = want
      ? qs.find((q) => norm(q.inner).startsWith(want.slice(0, 40)) || want.startsWith(norm(q.inner).slice(0, 40)))
      : qs.length === 1 ? qs[0] : undefined;
    if (!match) {
      dropped++;
      continue;
    }
    if (lines.some((x) => x.index === p.index && x.quote === match.inner)) continue;
    lines.push({ index: p.index, speaker, quote: match.inner });
    const c = characters.find((x) => x.name === speaker);
    if (c) c.lines++;
    else {
      const k = known.find((x) => x.name === speaker);
      characters.push({ name: speaker, aliases: k?.aliases ?? [], traits: emptyTraits(), description: null, lines: 1 });
    }
  }
  return { characters: characters.filter((c) => c.lines > 0), lines, dropped, source: "llm" };
}

/** Merge per-batch results: characters by name (aliases unioned, first
 *  non-null traits kept), lines concatenated. */
export function mergeCastResults(results: CastResult[]): CastResult {
  const characters: DetectedCharacter[] = [];
  for (const r of results) {
    for (const c of r.characters) {
      const prev = characters.find((x) => x.name.toLowerCase() === c.name.toLowerCase() || x.aliases.some((a) => a.toLowerCase() === c.name.toLowerCase()));
      if (!prev) {
        characters.push({ ...c, aliases: [...c.aliases], traits: { ...c.traits } });
        continue;
      }
      prev.lines += c.lines;
      prev.aliases = [...new Set([...prev.aliases, ...c.aliases])].filter((a) => a !== prev.name);
      for (const k of Object.keys(prev.traits) as (keyof CharacterTraits)[]) prev.traits[k] ??= c.traits[k];
      prev.description = describeTraits(prev.traits);
    }
  }
  const canonical = (n: string) =>
    characters.find((x) => x.name === n || x.aliases.includes(n))?.name ?? n;
  return {
    characters: characters.sort((a, b) => b.lines - a.lines),
    lines: results.flatMap((r) => r.lines.map((l) => ({ ...l, speaker: canonical(l.speaker) }))),
    dropped: results.reduce((n, r) => n + r.dropped, 0),
    source: results.every((r) => r.source === "heuristic") ? "heuristic" : "llm",
  };
}

/**
 * Who reads each paragraph when dialogue is not split out: the speaker of
 * its quotes when quotes make up at least `minShare` of it and they all
 * share one speaker; otherwise the narrator (absent from the map).
 */
export function paragraphSpeakers(paragraphs: CastParagraph[], lines: LineAttribution[], minShare = 0.5): Map<number, string> {
  const out = new Map<number, string>();
  for (const p of paragraphs) {
    const speakers = new Set(lines.filter((l) => l.index === p.index).map((l) => l.speaker));
    if (speakers.size === 1 && dialogueShare(p.text) >= minShare) out.set(p.index, [...speakers][0]!);
  }
  return out;
}

/* ---------------------------------------------------------- voice matching */

export interface VoiceCandidate {
  id: string;
  name: string;
  notes: string | null;
  /** Model-side id such as Kokoro's `bf_emma`. */
  voice_id: string | null;
  model_id: string | null;
}

export interface VoiceTraits {
  gender: "female" | "male" | null;
  age: "child" | "young" | "adult" | "old" | null;
  accent: string | null;
  words: Set<string>;
}

/** Kokoro voice id prefixes (hexgrad/Kokoro-82M VOICES.md): first letter is
 *  the language/accent, second the gender. */
const KOKORO_ACCENT: Record<string, string> = {
  a: "american", b: "british", e: "spanish", f: "french", h: "hindi", i: "italian", j: "japanese", p: "portuguese", z: "chinese",
};

const ACCENTS = ["american", "british", "english", "scottish", "irish", "welsh", "australian", "canadian", "indian", "southern", "french", "german", "spanish", "italian", "russian", "japanese", "chinese", "portuguese", "hindi", "african", "new york", "texan"];

function genderOf(text: string): "female" | "male" | null {
  if (/\b(female|woman|women|girl|lady|she|her|mother|grandmother|queen|feminine)\b/i.test(text)) return "female";
  if (/\b(male|man|men|boy|gentleman|he|his|father|grandfather|king|masculine)\b/i.test(text)) return "male";
  return null;
}

function ageOf(text: string): VoiceTraits["age"] {
  if (/\b(child|kid|boy|girl|little)\b/i.test(text)) return "child";
  if (/\b(teen|teenage|young|youthful|adolescent)\b/i.test(text)) return "young";
  if (/\b(old|elderly|aged|grandmother|grandfather|ancient|senior)\b/i.test(text)) return "old";
  if (/\b(adult|middle-aged|mature|grown)\b/i.test(text)) return "adult";
  return null;
}

function accentOf(text: string): string | null {
  const t = text.toLowerCase();
  const a = ACCENTS.find((x) => t.includes(x));
  return a === "english" ? "british" : (a ?? null);
}

const STOP = new Set(["a", "an", "the", "and", "or", "of", "with", "accent", "voice", "null"]);
function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

export function voiceTraits(v: VoiceCandidate): VoiceTraits {
  const text = `${v.name} ${v.notes ?? ""}`;
  const code = /^([a-z])([fm])_/.exec(v.voice_id ?? "");
  return {
    gender: code ? (code[2] === "f" ? "female" : "male") : genderOf(text),
    age: ageOf(text),
    accent: accentOf(text) ?? (code ? (KOKORO_ACCENT[code[1]!] ?? null) : null),
    words: wordSet(text),
  };
}

export function characterTraits(description: string | null): VoiceTraits {
  const text = description ?? "";
  return { gender: genderOf(text), age: ageOf(text), accent: accentOf(text), words: wordSet(text) };
}

/** How well a voice fits a character. Gender dominates; a mismatch is
 *  worse than not knowing. */
export function scoreVoice(c: VoiceTraits, v: VoiceTraits): number {
  let s = 0;
  if (c.gender && v.gender) s += c.gender === v.gender ? 4 : -6;
  if (c.age && v.age) s += c.age === v.age ? 1.5 : (c.age === "child") !== (v.age === "child") ? -1.5 : -0.5;
  if (c.accent && v.accent) s += c.accent === v.accent ? 2 : -0.5;
  for (const w of c.words) if (v.words.has(w)) s += 0.5;
  return s;
}

export interface VoiceSuggestion {
  character: string;
  voice_id: string | null;
  score: number;
  /** True when every voice was already taken and this one is shared. */
  shared: boolean;
  /** The next best voices, for the picker. */
  alternatives: { voice_id: string; score: number }[];
}

/**
 * One voice per character, most prominent character first, each taking its
 * best unused voice. `reserved` (the narrator's) is used only when nothing
 * else is left. Ties keep catalogue order, so results are stable.
 */
export function suggestVoices(
  characters: { name: string; description: string | null; lines?: number }[],
  voices: VoiceCandidate[],
  reserved: string[] = [],
): VoiceSuggestion[] {
  const vt = voices.map((v) => ({ v, t: voiceTraits(v) }));
  const used = new Set(reserved);
  const order = characters
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (b.c.lines ?? 0) - (a.c.lines ?? 0) || a.i - b.i);
  const out: VoiceSuggestion[] = new Array(characters.length);
  for (const { c, i } of order) {
    const ct = characterTraits(c.description);
    const ranked = vt
      .map(({ v, t }, k) => ({ id: v.id, score: scoreVoice(ct, t), k }))
      .sort((a, b) => b.score - a.score || a.k - b.k);
    const free = ranked.find((r) => !used.has(r.id));
    const pick = free ?? ranked[0];
    if (pick) used.add(pick.id);
    out[i] = {
      character: c.name,
      voice_id: pick?.id ?? null,
      score: pick?.score ?? 0,
      shared: !free && Boolean(pick),
      alternatives: ranked.filter((r) => r.id !== pick?.id).slice(0, 4).map((r) => ({ voice_id: r.id, score: r.score })),
    };
  }
  return out;
}
