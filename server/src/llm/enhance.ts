/**
 * Prompt-rewriting: the system prompt sent to the assistant model, and
 * parsing whatever comes back into N candidate prompts.
 *
 * Pure and side-effect-free so it's testable without a running model — see
 * `server/test/enhance.test.ts`.
 */

import type { ChatMessage } from "./client.js";

export type EnhanceCategory = "sfx" | "music";

/**
 * What we actually know about the target model, read off its own `ModelSpec`
 * (`family`, `defaults`, `max_cfg`) rather than guessed — see
 * `KonchiService.enhancePrompt`, which resolves this from `ModelManager`
 * before calling down here. `family` is audio.cpp's loader family (the real
 * model architecture — `stable_audio`, `ace_step`, …), not the audio.cpp
 * runtime itself, which is just what executes any of them.
 */
export interface ModelContext {
  family: string | null;
  defaultSteps?: number | null;
  maxCfg?: number | null;
}

export interface EnhanceInput {
  prompt: string;
  n: number;
  category?: EnhanceCategory;
  /** True for a lyrics-conditioned model, where the prompt sets genre and
   *  instrumentation rather than describing the sound. */
  lyrics?: boolean;
  model?: ModelContext | null;
}

/**
 * Every guidance string below ends the same way on purpose: the prompt field
 * itself must stay a natural phrase, never a bare comma-separated list. Small
 * local models default to tag-dump output when the source material (ACE-
 * Step's own docs, genre keywords) is tag-shaped — that instinct is genuinely
 * useful, just not for this field. Konchi has a separate Tags field for
 * exactly that output; see the `tags` half of `EnhanceResult` below.
 */
/**
 * The single most important instruction here, and the one that took two
 * tries to get right.
 *
 * A small local model copies the *shape* of whatever example it's shown far
 * more reliably than it follows an abstract rule. The first version of this
 * file told the model "don't write a comma-separated list" while showing it
 * `'dark orchestral-hybrid theme, slow dirge tempo, mournful choir vocals'`
 * as the example — so it dutifully produced comma lists every time. The rule
 * and the demonstration have to agree: every example below is now a flowing
 * sentence with real connecting words, because that is what we want back.
 */
const WRITE_A_SENTENCE =
  "Write it as one flowing sentence with connecting words (in, with, against, " +
  "over, while), the way you would describe the sound out loud. Do NOT write " +
  "a string of comma-separated fragments — keyword-style descriptors belong " +
  "in the separate tags list, never in the prompt.";

/**
 * The word ceiling, by what is being described.
 *
 * Thirty was one number for both and is only right for one of them. A sound
 * effect is a single event and stays terse. A full song has to name genre,
 * instruments with some character, a vocal, production *and* how the track
 * develops — and once the arc clause is required, thirty words is a budget
 * the instructions themselves cannot meet.
 *
 * Forty-five is not invented either: Stability's own worked music prompt runs
 * to about forty ("A quirky alternative pop ballad instrumental with the vibe
 * of a long car journey with friends…"), so the vendor's idea of a good
 * caption is already longer than the limit we were enforcing against it.
 */
const MAX_SFX_WORDS = 30;
const MAX_MUSIC_WORDS = 45;

function maxWordsFor(input: EnhanceInput): number {
  return input.category === "music" || input.lyrics ? MAX_MUSIC_WORDS : MAX_SFX_WORDS;
}

const SFX_GUIDANCE =
  "Rewrite it into a single concrete, descriptive prompt for a text-to-audio " +
  "model, naming the material, the action, and the acoustic space. For " +
  "example, 'scary sound' becomes 'a heavy wooden door slamming shut in a " +
  `cold stone corridor'. ${WRITE_A_SENTENCE} Under ${MAX_SFX_WORDS} words, no ` +
  "quotation marks, no preamble.";

const MUSIC_GUIDANCE =
  "Rewrite it into a single concrete prompt for a text-to-music model, naming " +
  "the genre, the instruments and how they are played. For example, 'scary " +
  "music' becomes 'a slow orchestral dirge with mournful choir vocals rising " +
  `over low strings'. ${WRITE_A_SENTENCE} Say how the track develops as well ` +
  `as what is in it. Under ${MAX_MUSIC_WORDS} words, no quotation marks, no ` +
  "preamble.";

const LYRICS_GUIDANCE =
  "This prompt is the song's caption/style field, not a scene description — " +
  "it's paired with separate lyrics the vocal will sing. Rewrite it into a " +
  "concrete style description: for example, 'villain theme' becomes 'a brooding " +
  "synth-pop track with a driving bassline under breathy female vocals'. " +
  `${WRITE_A_SENTENCE} Under ${MAX_MUSIC_WORDS} words, no quotation marks, no preamble.`;

/**
 * Real, model-specific prompting conventions, keyed by loader family — not
 * generic advice. Stable Audio and ACE-Step were trained on and document
 * genuinely different prompt shapes; treating them the same produces prompts
 * that "work" but don't get the model's best output.
 *
 * ACE-Step's own tutorial (github.com/ace-step/ACE-Step-1.5,
 * docs/en/Tutorial.md) does say its caption accepts a comma-tag format —
 * that's real. But Konchi already has a dedicated Tags field for exactly
 * that shape of output, so the caption stays a phrase here and the tag-list
 * instinct gets redirected to `tags` instead of overwriting the description.
 * Stability's guide (github.com/Stability-AI/stable-audio-3,
 * docs/guides/prompting.md) writes its own example as prose, so the two
 * families disagree about shape far less than they do about tempo.
 *
 * The BPM split below is the load-bearing difference and both halves are
 * quoted from the vendors: Stability lists BPM as a key element to specify,
 * while ACE-Step's Recommended Practice is "Don't write tempo, BPM, key, and
 * other metadata information in Caption". Popular third-party ACE-Step guides
 * say the opposite ("always include BPM") — they are wrong against the
 * model's own documentation, and `promptViolations` enforces the doc.
 */
const FAMILY_GUIDANCE: Record<string, string> = {
  stable_audio:
    "This is a Stable Audio model, trained on structured audio captions. Its " +
    "own guide asks for genre, instruments and how each of them sounds, mood " +
    "and energy, and an explicit tempo in BPM — Stability's worked example " +
    "reads 'a quirky alternative pop ballad instrumental … the catchy synth " +
    "bass is infectious, the tightly tuned acoustic drums add a classy " +
    "flair'. Name the tempo, and give each instrument a character rather " +
    "than only a name.",
  ace_step:
    "This is ACE-Step, a lyrics-conditioned vocal music model. Be specific " +
    "('sad piano ballad with breathy female vocal' beats 'a sad song') and " +
    "combine a few concrete dimensions (genre, emotion, instruments, vocal " +
    "character, era/production reference) in the phrase, rather than " +
    "stacking styles that conflict with each other. Do not write tempo, " +
    "BPM, or key into the caption — its tutorial's Recommended Practice is " +
    "explicit that they belong in the separate bpm/keyscale parameters. Its " +
    "own worked caption is 'female vocal, piano ballad, emotional, intimate " +
    "atmosphere, strings, building to powerful chorus' — note that it ends " +
    "on how the song develops, which is worth a clause of yours too.",
};

/** The conventions above, for a caller outside this file — `assistant.ts`
 *  grounds its model cards in the same text, so the chat and the one-shot
 *  rewrite cannot disagree about how a family wants to be prompted. */
export function familyGuidance(family: string | null | undefined): string | null {
  return family ? (FAMILY_GUIDANCE[family] ?? null) : null;
}

/**
 * Stable Audio 3's distilled variants default to ~8 sampling steps at a
 * capped guidance scale (see `audiocpp_models_catalog.json`) — real numbers
 * off the model's own defaults, not a guess. A model that samples in that few
 * steps at low CFG has little room to creatively resolve a vague or layered
 * prompt; the literal, unambiguous half of the instruction matters more than
 * it would for a 50-100 step model, and skipping it is how "studio quality"
 * ambitions turn into mushy, unfocused audio.
 */
const FEW_STEP_THRESHOLD = 12;

function fewStepGuidance(model: ModelContext): string | null {
  if (model.defaultSteps == null || model.defaultSteps > FEW_STEP_THRESHOLD) return null;
  const cfgNote = model.maxCfg != null ? ` (guidance scale capped at ${model.maxCfg})` : "";
  return (
    `This model samples in only ${model.defaultSteps} steps${cfgNote} — it has ` +
    `little room to creatively fill in vague language. Favor one concrete, ` +
    `unambiguous idea over several layered ones for a clean result.`
  );
}

function guidanceFor(input: EnhanceInput): string {
  const base = input.lyrics
    ? LYRICS_GUIDANCE
    : input.category === "music"
      ? MUSIC_GUIDANCE
      : SFX_GUIDANCE;
  if (!input.model) return base;
  const parts = [base];
  const family = input.model.family ? FAMILY_GUIDANCE[input.model.family] : null;
  if (family) parts.push(family);
  const fewStep = fewStepGuidance(input.model);
  if (fewStep) parts.push(fewStep);
  return parts.join(" ");
}

export function buildEnhanceMessages(input: EnhanceInput): ChatMessage[] {
  const guidance = guidanceFor(input);
  const jsonShape =
    input.n > 1
      ? `{"variations": [${Array(input.n).fill('"..."').join(", ")}], "tags": ["...", "..."]}`
      : `{"variations": ["..."], "tags": ["...", "..."]}`;
  const system =
    (input.n > 1
      ? `You help sound designers write prompts for local audio-generation models. ` +
        `${guidance} Produce ${input.n} distinct variations, not paraphrases of each ` +
        `other — vary the specific material/action/space (or genre/instrumentation) each time. `
      : `You help sound designers write prompts for local audio-generation models. ${guidance} `) +
    `Also suggest up to 6 short library tags for Konchi's own tag field — this one, unlike ` +
    `the prompt, is meant to be a plain keyword list. Each tag must be a concrete word drawn ` +
    `from the sound itself (e.g. "wood", "slam", "reverb", "orchestral", "melancholy"), never ` +
    `the name of a category — do not return words like "mood", "genre", "instrument", ` +
    `"material", or "texture". Respond with JSON only: ${jsonShape}.`;

  return [
    { role: "system", content: system },
    { role: "user", content: input.prompt.trim() },
  ];
}

/* ------------------------------------------------------- the agentic path */

/**
 * The musical decisions behind a prompt, made explicitly before any prose is
 * written.
 *
 * This exists because of *how* a one-shot rewrite fails. Asked to turn "sad
 * song" into a caption in a single pass, a small model reaches for more mood
 * words — "a melancholy, sorrowful, emotional track" — because mood is what
 * the input gave it and nothing forced it to commit to anything else. It is
 * not being lazy; it was never asked the questions whose answers make a
 * caption concrete.
 *
 * So ask them first. Naming a genre, a decade, three instruments and a vocal
 * character in a structured field is a much easier task than writing a good
 * sentence, and once those are on the table the sentence almost writes
 * itself — the second pass is transcription rather than invention.
 *
 * Every field is a string the model chooses; nothing here is an enum. A fixed
 * genre list would cap the output at whatever we thought of, and the whole
 * point is that the model knows more genres than this file should.
 */
export interface MusicBrief {
  genre: string;
  era: string;
  instrumentation: string[];
  vocal: string;
  rhythm: string;
  production: string;
  mood: string;
  /**
   * How the track develops — "sparse verses opening out into a full chorus".
   *
   * The one field here that is not a static property, and the one both
   * vendors put in their own worked examples: ACE-Step's tutorial caption
   * ends "building to powerful chorus", and Stability's guide describes
   * "gliding emotional synth leads that build sections to their climax".
   * A caption that only lists what a track is made of describes a loop; a
   * full song is the thing that changes across three minutes, and saying so
   * is what separates the two.
   */
  arc: string;
}

export function briefResponseFormat(): Record<string, unknown> {
  const str = { type: "string" };
  return {
    type: "json_schema",
    json_schema: {
      name: "music_brief",
      schema: {
        type: "object",
        properties: {
          genre: str,
          era: str,
          instrumentation: { type: "array", items: str, minItems: 2, maxItems: 5 },
          vocal: str,
          rhythm: str,
          production: str,
          mood: str,
          arc: str,
        },
        required: ["genre", "instrumentation", "mood"],
      },
    },
  };
}

/**
 * Pass one: decide what the song *is* before describing it.
 *
 * "Keep what the user said" is the load-bearing instruction. A brief that
 * quietly replaces a stated genre with a more common one produces a caption
 * for a song nobody asked for, and that reads as the assistant ignoring you
 * rather than helping — far worse than a vague caption.
 */
export function buildBriefMessages(input: EnhanceInput): ChatMessage[] {
  const system =
    "You are a music producer breaking a request down before writing a prompt " +
    "for a text-to-music model. Decide the concrete musical facts of the track.\n" +
    "- Keep every detail the user actually stated, exactly as they meant it. " +
    "Only decide the ones they left open.\n" +
    "- Choose specifics, not categories: 'Rhodes electric piano' not " +
    "'keyboard', 'brushed kit' not 'drums', 'breathy female alto' not 'vocals'.\n" +
    "- The choices must sit together in one believable track. A genre, an era " +
    "and a production style that fight each other produce a muddled result.\n" +
    "- `vocal` is 'instrumental' if the track has no singing.\n" +
    "Respond with JSON only.";
  return [
    { role: "system", content: system },
    { role: "user", content: input.prompt.trim() },
  ];
}

export function parseBrief(text: string): MusicBrief | null {
  const obj = parseJsonObject(stripThink(text));
  if (!obj) return null;
  const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const brief: MusicBrief = {
    genre: str(obj.genre),
    era: str(obj.era),
    instrumentation: stringArray(obj.instrumentation).map((s) => s.trim()).filter(Boolean),
    vocal: str(obj.vocal),
    rhythm: str(obj.rhythm),
    production: str(obj.production),
    mood: str(obj.mood),
    arc: str(obj.arc),
  };
  // A brief with no genre and no instruments decided nothing, and drafting
  // from it would be the one-shot rewrite with extra latency. Caller falls
  // back to exactly that.
  if (!brief.genre && brief.instrumentation.length === 0) return null;
  return brief;
}

/** The brief as a line the drafting pass can read. Empty fields are dropped
 *  rather than sent as "unknown", which a model will happily write into the
 *  caption. */
export function briefSummary(brief: MusicBrief): string {
  const parts: [string, string][] = [
    ["Genre", brief.genre],
    ["Era/production reference", brief.era],
    ["Instruments", brief.instrumentation.join(", ")],
    ["Vocal", brief.vocal],
    ["Rhythm/feel", brief.rhythm],
    ["Production", brief.production],
    ["Mood", brief.mood],
    ["How it develops", brief.arc],
  ];
  return parts
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

/**
 * Pass two: the caption, written from the brief rather than from the request.
 *
 * The variations differ by *which* facts each one leads with — the same track
 * described from its rhythm, or its vocal, or its room. That is what makes
 * them alternatives worth choosing between, where a one-shot "give me three"
 * returns the same sentence with its adjectives shuffled.
 */
export function buildDraftMessages(input: EnhanceInput, brief: MusicBrief): ChatMessage[] {
  const jsonShape =
    input.n > 1
      ? `{"variations": [${Array(input.n).fill('"..."').join(", ")}], "tags": ["...", "..."]}`
      : `{"variations": ["..."], "tags": ["...", "..."]}`;
  const system =
    `You help sound designers write prompts for local audio-generation models. ` +
    `${guidanceFor(input)} ` +
    (input.n > 1
      ? `Produce ${input.n} distinct variations of the SAME track described in the ` +
        `brief — do not invent a different song for each. Vary which details each ` +
        `one leads with and which it leaves out, so they are genuinely different ` +
        `descriptions to choose between rather than reworded copies. `
      : "") +
    `Use the brief's own specifics; do not fall back to generic mood words. ` +
    `If the brief says how the track develops, end on that — both ACE-Step's ` +
    `and Stability's own worked examples close on the song's arc ("building ` +
    `to powerful chorus"), because a full song is what changes over its ` +
    `length rather than a loop of its ingredients. ` +
    `Also suggest up to 6 short library tags for Konchi's own tag field — this ` +
    `one, unlike the prompt, is meant to be a plain keyword list. Each tag must be ` +
    `a concrete word drawn from the music itself (e.g. "rhodes", "shuffle", ` +
    `"tape", "melancholy"), never the name of a category — do not return words ` +
    `like "mood", "genre", "instrument", or "texture". ` +
    `Respond with JSON only: ${jsonShape}.`;
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `Original request:\n${input.prompt.trim()}\n\nThe brief:\n${briefSummary(brief)}`,
    },
  ];
}

/* ------------------------------------------------------------ verification */

/** Connectives `WRITE_A_SENTENCE` asks for. Their absence, in something full
 *  of commas, is what a tag dump looks like from here. */
const CONNECTIVES =
  /\b(in|with|against|over|while|under|through|as|and|beneath|behind|across|into|from)\b/i;

const BPM_RE = /\b\d{2,3}\s*(bpm|beats per minute)\b/i;
/**
 * A named key — and deliberately case-sensitive on the note letter.
 *
 * Written case-insensitively this matches the article: "a minor chord piano
 * loop" reads as the key of A minor, and the caption gets sent back for a
 * repair it did not need. Real key names are capitalised ("in A minor", "C#
 * major"), so requiring that costs nothing and removes the whole class. The
 * "key of" phrasing stays case-insensitive because it is unambiguous.
 */
const KEY_RE = /\bin the key of\b|\b[A-G](#|♯|b)?\s+(major|minor)\b/;
const PREAMBLE_RE = /^\s*(sure|here('s| is| are)|okay|ok|prompt|output|result|certainly)\b[:,]?/i;


/**
 * The rules the system prompt already states, checked rather than hoped for.
 *
 * Every one of these is something `guidanceFor` asks the model to do in
 * prose. Asking is not the same as getting: a small model will drop the
 * no-comma-list rule the moment the subject matter is tag-shaped, and
 * ACE-Step's "no BPM in the caption" is exactly the instruction a model
 * trained on Stable-Audio-style captions is most likely to ignore.
 *
 * Deterministic on purpose. A second model call asking "is this good?" costs
 * a round trip to get an opinion, where these are the actual documented
 * constraints and can be tested without a model running at all.
 */
/**
 * How badly a prompt breaks its rules, as one comparable number.
 *
 * Counting violations is not enough to judge a repair. A 50-word caption cut
 * to 35 is plainly better and still over the limit, so the count stays at one
 * and a naive "did the count drop?" test throws the improvement away and
 * keeps the 50-word original. Overshoot is the tie-breaker: same violations,
 * fewer words over, better prompt.
 *
 * Weighted so no amount of overshoot can outrank fixing an actual rule —
 * a caption that stops naming a key is better than one that is merely shorter.
 */
export function promptSeverity(text: string, input: EnhanceInput): number {
  const violations = promptViolations(text, input);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return violations.length * 1000 + Math.max(0, words - maxWordsFor(input));
}

export function promptViolations(text: string, input: EnhanceInput): string[] {
  const out: string[] = [];
  const value = text.trim();
  if (!value) return ["it is empty"];

  const words = value.split(/\s+/).filter(Boolean);
  const limit = maxWordsFor(input);
  if (words.length > limit) out.push(`it is ${words.length} words; keep it under ${limit}`);
  if ((value.match(/,/g) ?? []).length >= 3 && !CONNECTIVES.test(value)) {
    out.push(
      "it is a comma-separated keyword list; rewrite as one flowing sentence " +
        "with connecting words",
    );
  }
  if (/^["'].*["']$/s.test(value)) out.push("it is wrapped in quotation marks");
  if (PREAMBLE_RE.test(value)) out.push("it starts with a preamble instead of the prompt itself");
  // ACE-Step reads tempo and key as separate parameters, so spending caption
  // words on them is worse than useless — see FAMILY_GUIDANCE.
  if (input.model?.family === "ace_step") {
    if (BPM_RE.test(value)) out.push("it names a BPM, which this model takes as a separate setting");
    if (KEY_RE.test(value)) out.push("it names a key, which this model takes as a separate setting");
  }
  return out;
}

/**
 * Pass three, and only when pass two actually broke something.
 *
 * Sent as a repair rather than a regeneration: the draft is usually right in
 * substance and wrong in form, and asking for a fresh attempt throws away
 * good musical choices to fix a punctuation habit.
 */
export function buildRepairMessages(
  input: EnhanceInput,
  faults: { text: string; problems: string[] }[],
): ChatMessage[] {
  // The model's own constraints come along for the ride. Without them the
  // repair pass knows "remove the BPM" but not *why*, and a model that thinks
  // tempo belongs in a caption will put it back in a different form while
  // fixing the comma list it was actually sent for.
  const family = input.model?.family ? FAMILY_GUIDANCE[input.model.family] : null;
  const system =
    "You are fixing prompts for a text-to-music model. Each one below has a " +
    "specific problem. Rewrite ONLY what is wrong and keep every musical " +
    "detail — the genre, instruments, vocal and mood must survive the fix. " +
    (family ? `${family} ` : "") +
    `${WRITE_A_SENTENCE} Under ${maxWordsFor(input)} words, no quotation marks, ` +
    "no preamble. Respond with JSON only: " +
    `{"variations": [${Array(faults.length).fill('"..."').join(", ")}]}, in the same order.`;
  const listing = faults
    .map((f, i) => `${i + 1}. "${f.text}"\n   Problems: ${f.problems.join("; ")}`)
    .join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: listing },
  ];
}

export interface EnhanceResult {
  variations: string[];
  /** Short suggested keywords for Konchi's own Tags field, not the prompt
   *  itself — see `NOT_A_TAG_LIST` above for why the two are kept separate. */
  tags: string[];
}

/** Response-format payload for `chatCompletion` — a JSON-schema llama-server
 *  compiles into a grammar. External endpoints that ignore it fall back to
 *  `parseEnhanceResponse`'s text parsing below. */
export function enhanceResponseFormat(n: number): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: {
      name: "enhanced_prompts",
      schema: {
        type: "object",
        properties: {
          variations: {
            type: "array",
            items: { type: "string" },
            minItems: n,
            maxItems: n,
          },
          tags: {
            type: "array",
            items: { type: "string" },
            maxItems: 6,
          },
        },
        required: ["variations"],
      },
    },
  };
}

const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi;

/** Strip a leaked reasoning block — Qwen3 with thinking mode left on, or any
 *  other model that narrates before answering. Shared by every parser below. */
export function stripThink(text: string): string {
  return text.replace(THINK_BLOCK_RE, "").trim();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Category *names* a weak model sometimes echoes back instead of filling in —
 * a real observed failure: asking for "genre, mood, instrument or material
 * keywords" got back exactly `["metal", "mood", "instrument", "material"]`.
 * The system prompt already forbids these; this is the belt-and-braces pass,
 * since one junk tag in the Tags field is more annoying than a missing one.
 */
const META_TAGS = new Set([
  "mood",
  "genre",
  "instrument",
  "instruments",
  "instrumentation",
  "material",
  "texture",
  "tag",
  "tags",
  "keyword",
  "keywords",
  "style",
  "category",
  "action",
  "space",
]);

function cleanTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const tag = value.trim().replace(/^["']|["']$/g, "");
    const key = tag.toLowerCase();
    if (!tag || META_TAGS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** The model may still wrap JSON in a code fence despite instructions, or (a
 *  bare array) skip the `{"variations": ...}` wrapper entirely. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1]!.trim() : text;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (Array.isArray(parsed)) return { variations: parsed };
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

/** Strip a leaked reasoning block, then try JSON (pulling both `variations`
 *  and `tags` from the one parse), then fall back to treating the whole
 *  response as a plain variations list with no tags — covers llama-server's
 *  grammar-constrained output, a Qwen3 response with thinking mode left on,
 *  and an external endpoint that ignored `response_format` and wrote prose. */
export function parseEnhanceResponse(text: string, n: number): EnhanceResult {
  const cleaned = stripThink(text);

  const obj = parseJsonObject(cleaned);
  if (obj) {
    const variations = stringArray(obj.variations).slice(0, n);
    if (variations.length) return { variations, tags: cleanTags(stringArray(obj.tags)).slice(0, 6) };
  }

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    .map((line) => line.replace(/^["'](.*)["']$/, "$1").trim())
    .filter(Boolean);
  if (lines.length) return { variations: lines.slice(0, n), tags: [] };

  return { variations: cleaned ? [cleaned] : [], tags: [] };
}

/** Thin wrapper kept for callers that only want the prompt text. */
export function parseVariations(text: string, n: number): string[] {
  return parseEnhanceResponse(text, n).variations;
}

export function temperatureFor(n: number): number {
  return n > 1 ? 0.9 : 0.4;
}

export function maxTokensFor(n: number): number {
  return 120 * n;
}

/* --------------------------------------------------------------- lyrics */

/**
 * Writing the actual song, not just the caption — a genuinely separate skill
 * from `buildEnhanceMessages` above, with its own rules. Sourced from
 * ACE-Step's own tutorial (github.com/ace-step/ACE-Step-1.5,
 * docs/en/Tutorial.md): structure tags, syllable-count control, and
 * caption/lyrics consistency are the model's own documented advice, not
 * generic songwriting tips.
 */
export interface LyricsInput {
  /** A theme, a rough draft, or existing lyrics to expand/restructure. */
  theme: string;
  /** The song's current caption/style prompt, if any — used to keep
   *  instrumental and vocal-character tags consistent with it. */
  style?: string | null;
}

const LYRICS_SYSTEM_BASE =
  "You write song lyrics with structure tags for a lyrics-conditioned music " +
  "model (ACE-Step), following its own documented conventions:\n" +
  "- Mark every section on its own line: [Intro], [Verse], [Pre-Chorus], " +
  "[Chorus], [Bridge], [Outro], plus [Build]/[Drop]/[Breakdown] for energy " +
  "shifts and [Instrumental]/[Guitar Solo]/[Piano Interlude] for non-vocal " +
  "sections where they fit.\n" +
  "- At most one performance descriptor per tag, joined with a hyphen — " +
  '"[Chorus - anthemic]" or "[Bridge - whispered]". Never stack several ' +
  '("[Chorus - anthemic - powerful - epic]"): the model may start singing ' +
  "the tag text itself, and too many instructions makes the effect worse.\n" +
  "- Keep each lyric line to roughly 6-10 syllables, consistent line to " +
  "line (±1-2) — the model aligns syllables to the beat, so uneven lengths " +
  "break the rhythm.\n" +
  "- Separate every section with a blank line.\n" +
  "- UPPERCASE a line for high vocal intensity, normal case otherwise. " +
  'Parentheses mark backing vocals/harmonies, e.g. "We rise together ' +
  '(together)".\n' +
  "- Pick one concrete central image and explore it, rather than stacking " +
  'unrelated abstract imagery ("neon skies, electric hearts, endless ' +
  'dreams") — that reads as generic, machine-written filler.\n' +
  "Respond with the lyric sheet only — no explanation, no preamble, no code fence.";

export function buildLyricsMessages(input: LyricsInput): ChatMessage[] {
  const consistency = input.style?.trim()
    ? `\nThe song's caption/style is "${input.style.trim()}" — keep any instrumental ` +
      "or vocal-character tags consistent with it (e.g. a caption naming piano and a " +
      "breathy vocal shouldn't end up with a [Guitar Solo] or [powerful belting] tag)."
    : "";
  return [
    { role: "system", content: LYRICS_SYSTEM_BASE + consistency },
    { role: "user", content: input.theme.trim() },
  ];
}

/** Lyrics are one multi-line sheet, not a short phrase — freeform text reads
 *  better than forcing newline-heavy content through a JSON-schema grammar,
 *  so this only strips a leaked reasoning block and a stray code fence. */
export function parseLyrics(text: string): string {
  const cleaned = stripThink(text);
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(cleaned.trim());
  return (fenced ? fenced[1]! : cleaned).trim();
}

export function lyricsMaxTokens(): number {
  return 900;
}
