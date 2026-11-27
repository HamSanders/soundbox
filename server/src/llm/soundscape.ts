/**
 * "Suggest soundscape": read a chapter and propose beds for it.
 *
 * Two kinds of suggestion:
 *
 * - a music or ambience bed per scene, with the scene's mood and setting and a
 *   prompt for a generation model, spanning the scene's paragraphs;
 * - a sound effect at a paragraph whose text names a sound ("the door slammed",
 *   "thunder rolled"), anchored to that paragraph.
 *
 * The model is asked when the prompt assistant is on (`buildSoundscapeMessages`
 * / `parseSoundscape`); otherwise, or when its answer is unusable, a keyword
 * lexicon does the same job more bluntly (`heuristicSoundscape`).
 *
 * The rules `studio.ts` follows apply here too. The model never names a
 * paragraph: it gets short labels (`p1`, `p2`...) and the parser maps them
 * back, dropping anything that points nowhere. The model never runs anything:
 * this file returns suggestions, and a person accepts them. Pure, so all of it
 * is tested without a model.
 *
 * Suggestions default to subtle (low gain, ducked under the narration): a bed
 * that announces itself is the common failure of audiobook sound design.
 */

import type { ChatMessage } from "./client.js";

export type SuggestionKind = "music" | "ambience" | "sfx";

export interface SoundscapeParagraph {
  id: string;
  text: string;
}

export interface SoundscapeInput {
  chapter_title: string;
  book_title?: string | null;
  genres?: string[];
  paragraphs: SoundscapeParagraph[];
}

export interface SoundscapeSuggestion {
  /** Stable for the same suggestion on the same text, so a list can be diffed. */
  id: string;
  kind: SuggestionKind;
  label: string;
  /** What to generate. */
  prompt: string;
  mood: string | null;
  setting: string | null;
  /** Music and ambience: the scene's first and last paragraph. SFX: both are
   *  the paragraph the sound belongs to. */
  start_paragraph_id: string;
  end_paragraph_id: string;
  /** The words that prompted it, for the reviewer. */
  reason: string;
  gain_db: number;
  /** How far it dips under narration; 0 = no ducking. */
  duck_db: number;
  /** Seconds to generate. */
  duration_s: number;
  source: "llm" | "heuristic";
}

/** Subtle by default. */
export const SUGGESTION_LEVELS: Record<SuggestionKind, { gain_db: number; duck_db: number; duration_s: number }> = {
  music: { gain_db: -24, duck_db: 12, duration_s: 60 },
  ambience: { gain_db: -28, duck_db: 8, duration_s: 30 },
  sfx: { gain_db: -12, duck_db: 0, duration_s: 4 },
};

export const MAX_SCENE_SUGGESTIONS = 8;
export const MAX_SFX_SUGGESTIONS = 16;
const MAX_PROMPT = 300;

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function suggestionId(kind: string, start: string, end: string, prompt: string): string {
  return `${kind}-${hash(`${kind}|${start}|${end}|${prompt.toLowerCase()}`)}`;
}

function clean(s: unknown, max: number): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function capitalise(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/* ------------------------------------------------------------- scenes */

/** A line that only marks a scene break: "* * *", "***", "#", "~", "—". */
const SCENE_BREAK = /^\s*(?:[*#~•·—–-]\s*){1,5}\s*$/;

/** Paragraph index ranges of the chapter's scenes, split at scene breaks. */
export function splitScenes(paragraphs: SoundscapeParagraph[]): { start: number; end: number }[] {
  const scenes: { start: number; end: number }[] = [];
  let start = -1;
  paragraphs.forEach((p, i) => {
    if (SCENE_BREAK.test(p.text)) {
      if (start >= 0) scenes.push({ start, end: i - 1 });
      start = -1;
    } else if (start < 0) {
      start = i;
    }
  });
  if (start >= 0) scenes.push({ start, end: paragraphs.length - 1 });
  return scenes;
}

/* ---------------------------------------------------------- the model */

/** Characters of chapter text the prompt carries; a small local model's
 *  context is the limit, not the chapter. */
export const PROMPT_TEXT_BUDGET = 12000;

/** `p1: text` lines, each trimmed so the whole chapter fits the budget. */
export function labelledText(paragraphs: SoundscapeParagraph[], budget = PROMPT_TEXT_BUDGET): string {
  const per = Math.max(80, Math.floor(budget / Math.max(1, paragraphs.length)));
  return paragraphs
    .map((p, i) => {
      const t = p.text.replace(/\s+/g, " ").trim();
      return `p${i + 1}: ${t.length > per ? `${t.slice(0, per)}…` : t}`;
    })
    .join("\n");
}

export function buildSoundscapeMessages(input: SoundscapeInput): ChatMessage[] {
  const system = [
    "You are a sound designer for audiobooks. You read one chapter and suggest subtle sound under the narration.",
    "Reply with JSON only, in this shape:",
    '{"scenes":[{"start":"p1","end":"p12","kind":"ambience","mood":"tense","setting":"storm at sea","prompt":"..."}],',
    ' "sfx":[{"paragraph":"p4","quote":"the door slammed","prompt":"..."}]}',
    "Rules:",
    "- A scene is a run of consecutive paragraphs in one place and mood. Use the p labels exactly as given.",
    '- kind is "ambience" (the sound of the place: rain, wind, a crowded inn) or "music" (an underscore for the mood). Prefer ambience when the place is clear. Leave out scenes that need nothing.',
    "- sfx only where the text itself names a sound that happens: a door slams, thunder, footsteps, a gunshot, a bell. Quote the words. Not for sounds that are only mentioned or remembered.",
    "- A prompt describes the sound for a generation model: source, material, space and texture, under 25 words. Music prompts name instruments, tempo and mood, and say instrumental. Never include words to be spoken.",
    `- At most ${MAX_SCENE_SUGGESTIONS} scenes and ${MAX_SFX_SUGGESTIONS} sfx. Fewer is better: it should stay in the background.`,
  ].join("\n");
  const head = [
    input.book_title ? `Book: ${input.book_title}` : null,
    input.genres?.length ? `Genres: ${input.genres.join(", ")}` : null,
    `Chapter: ${input.chapter_title}`,
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `${head}\n\n${labelledText(input.paragraphs)}` },
  ];
}

/** The JSON object in a model's reply, fenced or not. Null when there is none. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  const from = body.indexOf("{");
  const to = body.lastIndexOf("}");
  if (from < 0 || to <= from) return null;
  try {
    return JSON.parse(body.slice(from, to + 1));
  } catch {
    return null;
  }
}

/**
 * Turn a model's reply into suggestions, keeping only what refers to real
 * paragraphs. Throws when the reply has no usable JSON at all, so the caller
 * can fall back to the lexicon.
 */
export function parseSoundscape(text: string, input: SoundscapeInput): SoundscapeSuggestion[] {
  const data = extractJson(text) as { scenes?: unknown; sfx?: unknown } | null;
  if (!data || typeof data !== "object") throw new Error("The reply had no JSON object.");
  const ps = input.paragraphs;
  const index = (label: unknown): number | null => {
    const m = /^p(\d+)$/i.exec(clean(label, 10));
    if (!m) return null;
    const i = Number(m[1]) - 1;
    return i >= 0 && i < ps.length ? i : null;
  };
  const out: SoundscapeSuggestion[] = [];
  const seen = new Set<string>();
  const push = (s: Omit<SoundscapeSuggestion, "id" | "source">) => {
    const id = suggestionId(s.kind, s.start_paragraph_id, s.end_paragraph_id, s.prompt);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ ...s, id, source: "llm" });
  };

  const scenes = Array.isArray(data.scenes) ? data.scenes : [];
  for (const raw of scenes.slice(0, MAX_SCENE_SUGGESTIONS * 2)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const kind = r.kind === "music" ? "music" : r.kind === "ambience" ? "ambience" : null;
    const prompt = clean(r.prompt, MAX_PROMPT);
    let a = index(r.start);
    let b = index(r.end ?? r.start);
    if (!kind || !prompt || a === null || b === null) continue;
    if (b < a) [a, b] = [b, a];
    const mood = clean(r.mood, 60) || null;
    const setting = clean(r.setting, 80) || null;
    const levels = SUGGESTION_LEVELS[kind];
    push({
      kind,
      label: capitalise(setting ?? mood ?? (kind === "music" ? "Score" : "Ambience")).slice(0, 60),
      prompt,
      mood,
      setting,
      start_paragraph_id: ps[a]!.id,
      end_paragraph_id: ps[b]!.id,
      reason: `Paragraphs ${a + 1}–${b + 1}${mood ? `, ${mood}` : ""}${setting ? `, ${setting}` : ""}`,
      gain_db: levels.gain_db,
      duck_db: levels.duck_db,
      duration_s: levels.duration_s,
    });
    if (out.filter((s) => s.kind !== "sfx").length >= MAX_SCENE_SUGGESTIONS) break;
  }

  const sfx = Array.isArray(data.sfx) ? data.sfx : [];
  let sfxCount = 0;
  for (const raw of sfx) {
    if (sfxCount >= MAX_SFX_SUGGESTIONS) break;
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const i = index(r.paragraph);
    const prompt = clean(r.prompt, MAX_PROMPT);
    if (i === null || !prompt) continue;
    const quote = clean(r.quote, 120);
    const levels = SUGGESTION_LEVELS.sfx;
    const before = out.length;
    push({
      kind: "sfx",
      label: capitalise(quote || prompt).slice(0, 60),
      prompt,
      mood: null,
      setting: null,
      start_paragraph_id: ps[i]!.id,
      end_paragraph_id: ps[i]!.id,
      reason: quote ? `“${quote}” (paragraph ${i + 1})` : `Paragraph ${i + 1}`,
      gain_db: levels.gain_db,
      duck_db: levels.duck_db,
      duration_s: levels.duration_s,
    });
    if (out.length > before) sfxCount++;
  }
  return out;
}

/* ------------------------------------------------------------ lexicon */

interface SettingRule {
  setting: string;
  words: RegExp;
  prompt: string;
  /** Words that add to this setting's score once its own words appear:
   *  rain counts towards a storm when there is thunder. */
  with?: RegExp;
}

/**
 * Places, by the words that give them away. Ordered: when two tie, the first
 * wins, so weather (which colours any place) comes before generic places.
 */
export const SETTINGS: SettingRule[] = [
  { setting: "storm", words: /\b(storm|thunder\w*|lightning|gale|tempest)\b/gi, with: /\b(rain\w*|downpour|wind)\b/gi, prompt: "steady heavy rain with distant rolling thunder, wind gusts, no music" },
  { setting: "rain", words: /\b(rain\w*|drizzle|downpour|raindrops?)\b/gi, prompt: "gentle steady rain on a window and roof, soft and even, no music" },
  { setting: "sea", words: /\b(sea|ocean|waves?|surf|shore|beach|tide|harbou?r|gulls?)\b/gi, prompt: "calm sea waves washing on a shore, distant gulls, soft wind, no music" },
  { setting: "ship", words: /\b(deck|hull|mast|sails?|cabin|ship|vessel)\b/gi, prompt: "wooden ship creaking at sea, rigging and water against the hull, no music" },
  { setting: "forest", words: /\b(forest|woods?|trees|leaves|branches|birdsong|glade|thicket)\b/gi, prompt: "quiet forest ambience, leaves rustling in a light breeze, distant birds, no music" },
  { setting: "night", words: /\b(crickets?|owls?|moonlight|midnight|night)\b/gi, prompt: "still night ambience outdoors, crickets and a distant owl, no music" },
  { setting: "city", words: /\b(city|streets?|traffic|cars?|sirens?|crowds?|sidewalk|pavement|taxis?)\b/gi, prompt: "distant city street ambience, light traffic and muffled voices, no music" },
  { setting: "tavern", words: /\b(tavern|inn|pub|bar|alehouse|tankards?|barkeep)\b/gi, prompt: "busy tavern ambience, low indistinct chatter, clinking mugs, crackling fire, no music" },
  { setting: "fireside", words: /\b(fire(?:place|side)?|hearth|embers|flames?|logs?)\b/gi, prompt: "crackling fireplace in a quiet room, soft pops of burning wood, no music" },
  { setting: "wind", words: /\b(wind|breeze|gusts?|howl\w*)\b/gi, prompt: "wind blowing across open land, soft gusts, no music" },
  { setting: "cave", words: /\b(caves?|cavern|tunnels?|underground|dripping)\b/gi, prompt: "dark cave ambience, slow water drips echoing, low air movement, no music" },
  { setting: "market", words: /\b(market|stalls?|vendors?|bazaar|merchants?)\b/gi, prompt: "outdoor market ambience, distant indistinct voices and footsteps, no music" },
  { setting: "train", words: /\b(train|carriage|railway|platform|locomotive)\b/gi, prompt: "inside a moving train carriage, steady rhythmic wheels on track, no music" },
  { setting: "church", words: /\b(church|cathedral|chapel|pews?|altar)\b/gi, prompt: "quiet stone church interior, large reverberant room tone, no music" },
  { setting: "office", words: /\b(office|desks?|keyboard|printer|cubicle)\b/gi, prompt: "quiet office room tone, distant keyboard typing and air conditioning, no music" },
];

interface MoodRule {
  mood: string;
  words: RegExp;
  prompt: string;
}

export const MOODS: MoodRule[] = [
  { mood: "tense", words: /\b(fear\w*|dread|terror|panic\w*|afraid|danger\w*|shadows?|scream\w*|trembl\w*|heart pounding)\b/gi, prompt: "sparse tense underscore, low sustained strings and soft pulse, slow, instrumental" },
  { mood: "sad", words: /\b(tears?|wept|weep\w*|grief|griev\w*|mourn\w*|sorrow|alone|lonely|funeral)\b/gi, prompt: "slow melancholy solo piano, sparse and soft, instrumental" },
  { mood: "warm", words: /\b(smil\w*|laugh\w*|warm\w*|home|embrac\w*|kiss\w*|gentle|joy\w*)\b/gi, prompt: "gentle warm acoustic guitar and soft piano, slow, instrumental" },
  { mood: "mysterious", words: /\b(myster\w*|strange|secret\w*|whisper\w*|unknown|eerie|curious)\b/gi, prompt: "mysterious ambient pads with soft bell tones, slow, instrumental" },
  { mood: "triumphant", words: /\b(victor\w*|triumph\w*|cheer\w*|won|glory|celebrat\w*)\b/gi, prompt: "uplifting soft orchestral swell, warm brass and strings, moderate tempo, instrumental" },
];

interface SfxRule {
  name: string;
  /** Matches a sound happening, not merely the thing that makes it. */
  pattern: RegExp;
  prompt: string;
}

export const SFX_RULES: SfxRule[] = [
  { name: "door slam", pattern: /\bdoors?\b[^.!?]{0,30}\bslamm?\w*|\bslamm?\w*\b[^.!?]{0,20}\bdoors?\b/i, prompt: "heavy wooden door slamming shut in a room" },
  { name: "door creak", pattern: /\bdoors?\b[^.!?]{0,30}\bcreak\w*|\bcreak\w*\b[^.!?]{0,20}\bdoors?\b/i, prompt: "old wooden door creaking slowly open" },
  { name: "knock", pattern: /\bknock(?:ed|ing|s)?\b[^.!?]{0,20}\b(?:door|on)\b|\ba knock\b/i, prompt: "three firm knocks on a wooden door" },
  { name: "thunder", pattern: /\bthunder\w*\b/i, prompt: "loud rolling thunder clap in the distance" },
  { name: "footsteps", pattern: /\bfootsteps?\b|\bfootfalls?\b/i, prompt: "slow footsteps on a wooden floor" },
  { name: "gunshot", pattern: /\bgun ?shots?\b|\b(?:a |the )?shot rang out\b|\bfired (?:a |the |his |her )?(?:gun|pistol|rifle|shot)/i, prompt: "single distant gunshot with outdoor echo" },
  { name: "glass", pattern: /\bglass\b[^.!?]{0,25}\b(?:shatter\w*|smash\w*|broke|crash\w*)|\b(?:shatter\w*|smash\w*)\b[^.!?]{0,20}\bglass\b/i, prompt: "glass shattering on a hard floor" },
  { name: "bell", pattern: /\bbells?\b[^.!?]{0,25}\b(?:rang|ring\w*|toll\w*|chim\w*)|\b(?:rang|toll\w*|chim\w*)\b[^.!?]{0,15}\bbells?\b/i, prompt: "church bell tolling once, long decay" },
  { name: "phone", pattern: /\bphone\b[^.!?]{0,20}\b(?:rang|ring\w*|buzz\w*)/i, prompt: "telephone ringing in a quiet room" },
  { name: "dog", pattern: /\bdogs?\b[^.!?]{0,20}\b(?:bark\w*|howl\w*|growl\w*)|\bbark(?:ed|ing)\b/i, prompt: "dog barking a few times in the distance" },
  { name: "horse", pattern: /\bhooves\b|\bhoofbeats?\b|\bgallop\w*/i, prompt: "horse hooves galloping on a dirt road" },
  { name: "explosion", pattern: /\bexplo(?:sion|ded)\b|\bblast\b/i, prompt: "large distant explosion with rumbling debris" },
  { name: "clock", pattern: /\bclock\b[^.!?]{0,25}\b(?:struck|strik\w*|chim\w*|tick\w*)/i, prompt: "old clock chiming the hour" },
  { name: "engine", pattern: /\bengine\b[^.!?]{0,20}\b(?:roar\w*|start\w*|rumbl\w*|revv?\w*)/i, prompt: "car engine starting and idling" },
  { name: "splash", pattern: /\bsplash\w*\b/i, prompt: "splash of something falling into water" },
  { name: "scream", pattern: /\b(?:a|the) scream\b|\bscreamed\b/i, prompt: "distant short scream echoing" },
];

function countMatches(re: RegExp, text: string): number {
  re.lastIndex = 0;
  return text.match(re)?.length ?? 0;
}

/** Suggestions from keywords alone, for when no model is available. */
export function heuristicSoundscape(input: SoundscapeInput): SoundscapeSuggestion[] {
  const ps = input.paragraphs;
  const out: SoundscapeSuggestion[] = [];
  const make = (s: Omit<SoundscapeSuggestion, "id" | "source">): SoundscapeSuggestion => ({
    ...s,
    id: suggestionId(s.kind, s.start_paragraph_id, s.end_paragraph_id, s.prompt),
    source: "heuristic",
  });

  for (const scene of splitScenes(ps).slice(0, MAX_SCENE_SUGGESTIONS)) {
    const text = ps
      .slice(scene.start, scene.end + 1)
      .map((p) => p.text)
      .join("\n");
    const words = Math.max(1, text.split(/\s+/).length);
    // A place counts when it is named at least twice, or once in a short scene.
    const need = words > 150 ? 2 : 1;
    let best: { rule: SettingRule; n: number } | null = null;
    for (const rule of SETTINGS) {
      const own = countMatches(rule.words, text);
      const n = own > 0 && rule.with ? own + countMatches(rule.with, text) : own;
      if (n >= need && (!best || n > best.n)) best = { rule, n };
    }
    let mood: { rule: MoodRule; n: number } | null = null;
    for (const rule of MOODS) {
      const n = countMatches(rule.words, text);
      if (n >= need + 1 && (!mood || n > mood.n)) mood = { rule, n };
    }
    const start = ps[scene.start]!.id;
    const end = ps[scene.end]!.id;
    const range = `paragraphs ${scene.start + 1}–${scene.end + 1}`;
    if (best) {
      const l = SUGGESTION_LEVELS.ambience;
      out.push(
        make({
          kind: "ambience",
          label: capitalise(best.rule.setting),
          prompt: best.rule.prompt,
          mood: mood?.rule.mood ?? null,
          setting: best.rule.setting,
          start_paragraph_id: start,
          end_paragraph_id: end,
          reason: `“${best.rule.setting}” words ${best.n}× in ${range}`,
          gain_db: l.gain_db,
          duck_db: l.duck_db,
          duration_s: l.duration_s,
        }),
      );
    } else if (mood) {
      const l = SUGGESTION_LEVELS.music;
      out.push(
        make({
          kind: "music",
          label: `${capitalise(mood.rule.mood)} score`,
          prompt: mood.rule.prompt,
          mood: mood.rule.mood,
          setting: null,
          start_paragraph_id: start,
          end_paragraph_id: end,
          reason: `“${mood.rule.mood}” words ${mood.n}× in ${range}`,
          gain_db: l.gain_db,
          duck_db: l.duck_db,
          duration_s: l.duration_s,
        }),
      );
    }
  }

  let sfx = 0;
  ps.forEach((p, i) => {
    if (sfx >= MAX_SFX_SUGGESTIONS) return;
    for (const rule of SFX_RULES) {
      const m = rule.pattern.exec(p.text);
      if (!m) continue;
      const l = SUGGESTION_LEVELS.sfx;
      out.push(
        make({
          kind: "sfx",
          label: capitalise(rule.name),
          prompt: rule.prompt,
          mood: null,
          setting: null,
          start_paragraph_id: p.id,
          end_paragraph_id: p.id,
          reason: `“${m[0].trim()}” (paragraph ${i + 1})`,
          gain_db: l.gain_db,
          duck_db: l.duck_db,
          duration_s: l.duration_s,
        }),
      );
      sfx++;
      return; // one effect per paragraph
    }
  });
  return out;
}
