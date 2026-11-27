/**
 * The in-app assistant as an agent: an instruction in, MCP tool calls out.
 *
 * The studio planner (`studio.ts`) has a vocabulary of its own, sized for a
 * timeline. This one has none: its vocabulary is the MCP toolkit, read live
 * from the server (`mcp/local-client.ts`), so whatever an outside agent can
 * do over `/mcp` the assistant beside a book can propose, under the same
 * tool names and with the same argument checks.
 *
 * The rules are the studio planner's, for the same reasons:
 *
 * - **The model never runs anything.** This file returns data: a reply and
 *   a list of calls. The page shows the calls as a proposal and runs the ones
 *   the person accepts, one at a time, through `POST /api/agent/run`.
 * - **The model never names a thing.** It is shown short names (B, C3, P2,
 *   V1; see `Aliases`), and anything that doesn't resolve to an id it was
 *   shown is dropped by `validateCalls`, with the reason reported, rather
 *   than sent to a tool to fail.
 * - **Every call carries its risk.** Reading runs without asking; writing,
 *   anything that spends minutes of GPU, and anything that deletes waits for
 *   a click (`riskOf`).
 *
 * Planning is two calls (route, then plan), because all of MCP does not fit
 * the managed model's context; see `TOOL_GROUPS`.
 *
 * Pure and side-effect free, so the prompts, the parsing and the validation
 * are testable without a model running.
 */

import type { ChatMessage } from "./client.js";

/* ---------------------------------------------------------------- shapes */

/** A tool as the planner is shown it. */
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
}

/**
 * What the person is looking at. The page sends ids; the server fills in
 * the rest from the book itself (see `routes/agent.ts`), so what the model is
 * shown is what is on the server, not what a stale page last fetched.
 */
export interface AgentContext {
  book: {
    book_id: string;
    title: string;
    narrator_voice_id: string | null;
    chapters: { chapter_id: string; story_id: string; title: string; paragraphs: number; voiced: number }[];
    characters: { character_id: string; name: string; voice_id: string | null }[];
  } | null;
  /** The chapter open in the editor, with its paragraphs (first ones only). */
  chapter: {
    chapter_id: string;
    story_id: string;
    title: string;
    paragraphs: {
      paragraph_id: string;
      text: string;
      character_id: string | null;
      status: string;
      is_heading?: boolean;
    }[];
  } | null;
  /** Paragraphs the person has selected, so "these" resolves. */
  selected_ids: string[];
  voices: { voice_id: string; name: string }[];
}

export interface AgentCall {
  tool: string;
  arguments: Record<string, unknown>;
}

export type AgentRisk = "read" | "write" | "costly" | "destructive";

export interface AgentPlan {
  reply: string;
  calls: (AgentCall & { risk: AgentRisk })[];
  /** Calls the model wrote that were thrown away, and why, for the page to
   *  say the plan was trimmed rather than quietly doing less. */
  dropped: { tool: string; reason: string }[];
  /** The kinds of tool the router picked. */
  groups?: ToolGroup[];
}

/* ------------------------------------------------------------------ risk */

/** Tools that make audio (minutes of GPU, files on disk) or read a file
 *  from disk: worth a click even though nothing is lost. */
const COSTLY = new Set([
  "soundbox.generate",
  "soundbox.speak",
  "soundbox.speak_story",
  "soundbox.separate",
  "soundbox.open_in_studio",
  "soundbox.render_audiobook",
  "soundbox.master_and_export_audiobook",
  "soundbox.export_story",
  "soundbox.import_manuscript",
]);

const DESTRUCTIVE = new Set([
  "soundbox.delete_audiobook",
  "soundbox.delete_chapter",
  "soundbox.delete_sound",
  "soundbox.delete_line",
  "soundbox.remove_track",
  "soundbox.remove_device",
]);

/** Reading changes nothing; everything else is a proposal. A tool this
 *  table has never heard of counts as a write, so a new tool asks first. */
export function riskOf(tool: string): AgentRisk {
  if (DESTRUCTIVE.has(tool)) return "destructive";
  if (COSTLY.has(tool)) return "costly";
  const verb = tool.replace(/^soundbox\./, "");
  if (/^(list|get)_/.test(verb) || verb === "enhance_prompt") return "read";
  return "write";
}

/* ---------------------------------------------------------------- groups */

/**
 * The toolkit, in groups a request can be routed to.
 *
 * All of MCP in one prompt came to about 9,000 tokens on a real book, and
 * the managed model runs with 4,096 (`runtime.ts`). Measured, not guessed:
 * every request on "Pride and Prejudice" (64 chapters) was refused with
 * `exceed_context_size_error`. So planning is two calls, as in the studio
 * planner: a short one picks the groups, and the plan is written with only
 * those groups' tools. A tool no group names lands in `other`, so a tool
 * added to MCP is still reachable without editing this table.
 */
export const TOOL_GROUPS = [
  {
    id: "voices",
    about: "who reads what: set the narrator's or a character's voice, give paragraphs to a character",
    verbs: ["set_character_voice", "cast_paragraphs", "list_voices"],
  },
  { id: "pronunciation", about: "how a word or name is said", verbs: ["add_pronunciation"] },
  {
    id: "text",
    about: "the words: change, find and replace, split, merge, lock or delete paragraphs",
    verbs: [
      "edit_paragraph",
      "find_replace",
      "split_paragraph",
      "merge_paragraphs",
      "lock_paragraphs",
      "delete_line",
      "get_audiobook",
    ],
  },
  {
    id: "chapters",
    about: "chapters: add, rename, move, include or leave out, delete",
    verbs: ["add_chapter", "edit_chapter", "move_chapter", "delete_chapter"],
  },
  {
    id: "voicing",
    about: "voice (render) the book, a chapter or paragraphs into audio",
    verbs: ["render_audiobook"],
  },
  {
    id: "sound",
    about: "music, ambience, effects and beds; lanes, mixing and effects like reverb",
    verbs: [
      "add_bed",
      "generate",
      "enhance_prompt",
      "mix_track",
      "remove_track",
      "add_device",
      "set_device",
      "remove_device",
      "separate",
      "open_in_studio",
      "update_line",
      "split_line",
      "add_lines",
      "get_story",
      "list_sounds",
      "get_sound",
      "delete_sound",
    ],
  },
  {
    id: "export",
    about: "master and export the book as MP3, M4B, WAV or FLAC",
    verbs: ["master_and_export_audiobook"],
  },
  {
    id: "library",
    about: "other books and stories: create, import, list, delete; the trash; speak or export a story; models",
    verbs: [
      "create_audiobook",
      "delete_audiobook",
      "list_trash",
      "restore_from_trash",
      "import_manuscript",
      "list_audiobooks",
      "create_story",
      "list_stories",
      "speak",
      "speak_story",
      "export_story",
      "list_models",
    ],
  },
] as const;

export type ToolGroup = (typeof TOOL_GROUPS)[number]["id"] | "other" | "answer";

export function groupOf(tool: string): ToolGroup {
  const verb = tool.replace(/^soundbox\./, "");
  return TOOL_GROUPS.find((g) => (g.verbs as readonly string[]).includes(verb))?.id ?? "other";
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi;

export function buildRouteMessages(
  instruction: string,
  history: { role: "user" | "assistant"; content: string }[],
): ChatMessage[] {
  const system = [
    "Sort a request about an audiobook into the kinds of tool it needs.",
    "Kinds:",
    "- answer: a question, or chat; nothing to change",
    ...TOOL_GROUPS.map((g) => `- ${g.id}: ${g.about}`),
    "- other: anything else Mirli can do",
    "Reply with the kinds only, comma separated, most important first. Example: voices, voicing",
  ].join("\n");
  const last = history
    .slice(-2)
    .map((m) => `${m.role}: ${clip(m.content, 200)}`)
    .join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `${last ? `Earlier:\n${last}\n\n` : ""}Request: ${instruction}` },
  ];
}

const GROUP_IDS: ToolGroup[] = [...TOOL_GROUPS.map((g) => g.id), "other", "answer"];

/**
 * Words that settle which kind a request is, whatever the router says.
 *
 * On a real run the router sent "Fix the typo in the first paragraph" to
 * `answer`, and the model, shown no tools, replied that the paragraph "has
 * been corrected". A request that names its work this plainly should never
 * reach the planner without the tools for it.
 */
const KIND_WORDS: [ToolGroup, RegExp][] = [
  ["library", /\b(trash|restore|undelete|bring (?:it |them |\w+ )?back|delete (?:this|the) (?:book|audiobook))\b/i],
  ["chapters", /\b((?:leave|take|keep)\b.{0,40}\bout of|add (?:a |another )?chapter|new chapter|rename (?:the |this )?chapter|chapter title|move (?:the |this )?chapter|delete (?:the |this )?chapter|remove (?:the |this )?chapter|(?:leave|take) (?:it |this |the chapter )?out of the (?:render|export)|exclude|front matter|back matter)\b/i],
  ["text", /\b(typo|fix|rewrite|reword|change the (?:text|words|wording)|edit|split|merge|replace|lock|unlock|delete the \w+ paragraph|remove the \w+ paragraph|paragraph)\b/i],
  ["voicing", /\b(voice (?:this|the|it|chapter|book|paragraph)|render|re-?voice|read .{0,30}\b(?:aloud|out loud))\b/i],
  ["voices", /\b(narrator|voice for|voice to|give \w+(?: \w+)? (?:the )?\w+ voice|cast|(?:read|spoken|said) by|reads (?:the|this|that|paragraph))\b/i],
  ["pronunciation", /\b(pronounc\w*|said like|say \w+ as)\b/i],
  ["sound", /\b(music|ambien\w*|rain|bed|sound effect|sfx|reverb|echo|mix|volume|lane|track)\b/i],
  ["export", /\b(export|m4b|mp3|flac|wav|master|acx)\b/i],
];

/** The kinds a request needs: the router's answer, in its order, plus any
 *  `KIND_WORDS` match, at most three. None at all reads as a question:
 *  answering wrongly costs a sentence, acting wrongly costs a proposal
 *  nobody asked for. */
export function parseGroups(text: string, instruction = ""): ToolGroup[] {
  const plain = text.replace(THINK_BLOCK_RE, "").toLowerCase();
  const found = GROUP_IDS.map((id) => ({ id, at: plain.search(new RegExp(`\\b${id}\\b`)) }))
    .filter((g) => g.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((g) => g.id)
    .filter((g) => g !== "answer");
  const hinted = KIND_WORDS.filter(([, re]) => re.test(instruction)).map(([g]) => g);
  // A question ("which chapters are the longest?") is answered from what
  // the model is shown. Offered tools, it reached for one instead of
  // answering. "Can you…" and "could you…" are requests, not questions.
  if (/^\s*(what|which|how|who|why|when|where|is|are|does|do)\b/i.test(instruction)) return ["answer"];
  // When the words say what the work is, they win over the router's extras:
  // "export the book as an M4B" routed to export *and* sound came back as a
  // music bed, the planner lost among a dozen sound tools.
  let work = hinted.length ? hinted : found;
  // "Leave the Imprint chapter out of the export" is about the chapter; with
  // the export tools beside it, the model exported the book instead.
  if (work.includes("chapters") && /\bout of\b/i.test(instruction)) work = work.filter((g) => g !== "export");
  return work.length ? work.slice(0, 3) : ["answer"];
}

/* --------------------------------------------------------------- aliases */

type IdKind = "book" | "chapter" | "story" | "paragraph" | "voice";

const ARG_KIND: Record<string, IdKind> = {
  book_id: "book",
  chapter_id: "chapter",
  chapter_ids: "chapter",
  story_id: "story",
  paragraph_id: "paragraph",
  paragraph_ids: "paragraph",
  line_id: "paragraph",
  voice_id: "voice",
  narrator_voice_id: "voice",
};

/**
 * Short names for the ids the model is shown: B for the book, C1… for
 * chapters (and their stories), P1… for the open chapter's paragraphs, V1…
 * for voices. A 1.7B model copies "C12" reliably and a UUID not at all, and
 * sixty-four chapters of UUIDs were most of that 9,000-token prompt.
 * `resolve` turns them back into ids before anything is checked.
 */
export class Aliases {
  private readonly byKind: Record<IdKind, Map<string, string>> = {
    book: new Map(),
    chapter: new Map(),
    story: new Map(),
    paragraph: new Map(),
    voice: new Map(),
  };
  private readonly voiceNames = new Map<string, string>();
  private readonly chapterTitles = new Map<string, string>();
  private readonly storyTitles = new Map<string, string>();
  /** Real id to alias, for writing the prompt. */
  readonly of = new Map<string, string>();

  constructor(ctx: AgentContext) {
    if (ctx.book) {
      this.byKind.book.set("B", ctx.book.book_id);
      ctx.book.chapters.forEach((c, i) => {
        const a = `C${i + 1}`;
        this.byKind.chapter.set(a, c.chapter_id);
        this.byKind.story.set(a, c.story_id);
        this.of.set(c.chapter_id, a);
        // The first chapter with a title wins: titles can repeat.
        const title = c.title.trim().toLowerCase();
        if (!this.chapterTitles.has(title)) {
          this.chapterTitles.set(title, c.chapter_id);
          this.storyTitles.set(title, c.story_id);
        }
      });
    }
    ctx.chapter?.paragraphs.forEach((p, i) => {
      const a = `P${i + 1}`;
      this.byKind.paragraph.set(a, p.paragraph_id);
      this.of.set(p.paragraph_id, a);
    });
    ctx.voices.forEach((v, i) => {
      const a = `V${i + 1}`;
      this.byKind.voice.set(a, v.voice_id);
      this.of.set(v.voice_id, a);
      this.voiceNames.set(v.name.toLowerCase(), v.voice_id);
    });
  }

  /** The id an argument names: an alias, the id itself, or (for a voice)
   *  the voice's name. Unchanged when it is none of those. */
  /** The chapter a request names by its title ("chapter II", "the Imprint
   *  chapter"), when exactly one title fits. */
  chapterNamedIn(instruction: string): string | null {
    // Two passes: in one alternation "Rename chapter II" matched "Rename
    // chapter" and never saw "chapter II".
    const named = [
      ...[...instruction.matchAll(/\bchapter\s+([^\s,.;:!?]+)/gi)].map((m) => m[1]!),
      ...[...instruction.matchAll(/\b([^\s,.;:!?]+)\s+chapter\b/gi)].map((m) => m[1]!),
    ]
      .map((w) => w.toLowerCase())
      .filter((w) => w && !["this", "the", "a", "an", "that", "next", "last", "first", "each", "every", "new"].includes(w));
    const hits = [...new Set(named.map((w) => this.chapterTitles.get(w)).filter((id): id is string => Boolean(id)))];
    return hits.length === 1 ? hits[0]! : null;
  }

  /** "the third paragraph", "paragraph 3": its P number's id. */
  paragraphNamedIn(instruction: string): string | null {
    const ORD = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
    const word = new RegExp(`\\b(${ORD.join("|")})\\s+(?:and\\s+\\w+\\s+)?paragraphs?\\b`, "i").exec(instruction);
    const num = /\bparagraph\s+(\d+)\b/i.exec(instruction);
    const n = word ? ORD.indexOf(word[1]!.toLowerCase()) + 1 : num ? Number(num[1]) : 0;
    return n ? (this.byKind.paragraph.get(`P${n}`) ?? null) : null;
  }

  resolve(key: string, value: unknown): unknown {
    const kind = ARG_KIND[key];
    if (!kind) return value;
    const one = (v: unknown) => {
      // "line_id": 1 came back once, a number where an id goes.
      if (typeof v === "number" && Number.isInteger(v)) v = String(v);
      if (typeof v !== "string") return v;
      const t = v.trim();
      const prefix = kind === "chapter" || kind === "story" ? "C" : kind === "paragraph" ? "P" : kind === "voice" ? "V" : "";
      return (
        this.byKind[kind].get(t.toUpperCase()) ??
        (prefix && /^\d+$/.test(t) ? this.byKind[kind].get(`${prefix}${t}`) : undefined) ??
        (kind === "voice" ? this.voiceNames.get(t.toLowerCase()) : undefined) ??
        (kind === "chapter" ? this.chapterTitles.get(t.replace(/^chapter\s+/i, "").toLowerCase()) : undefined) ??
        (kind === "story" ? this.storyTitles.get(t.replace(/^chapter\s+/i, "").toLowerCase()) : undefined) ??
        t
      );
    };
    return Array.isArray(value) ? value.map(one) : one(value);
  }
}

/* ---------------------------------------------------------------- prompt */

/**
 * `name(a, b?, kind?: x|y)`: the required arguments, plus the optional ones
 * that are ids or a fixed choice.
 *
 * A small model shown every optional argument fills every one: on a real
 * run "quiet rain ambience" came back with a seed, lyrics, a made-up model
 * and an empty edit. Optional free-form arguments are left out of the
 * prompt (the tool's default is nearly always right) and are still taken
 * when the model writes one anyway.
 */
export function signature(tool: AgentTool): string {
  const props = tool.inputSchema.properties ?? {};
  const required = new Set(tool.inputSchema.required ?? []);
  // Shown every optional id and choice, the model put a bed at the first
  // paragraph as an intro, voiced paragraphs it made up instead of the
  // chapter, and exported only the open chapter. Shown none, a rain bed lost
  // its prompt and an M4B its format. So: the required ones, a single
  // chapter or voice, and the few optional ones `OPTIONAL_SHOWN` names.
  const extra = new Set([...(OPTIONAL_SHOWN["*"] ?? []), ...(OPTIONAL_SHOWN[tool.name] ?? [])]);
  const shown = Object.entries(props).filter(
    ([name]) =>
      required.has(name) ||
      extra.has(name) ||
      name === "chapter_id" ||
      name === "voice_id" ||
      name === "story_id",
  );
  const arg = ([name, schema]: [string, Record<string, unknown>]) => {
    const choice = Array.isArray(schema.enum) ? `: ${(schema.enum as unknown[]).join("|")}` : "";
    return `${name}${required.has(name) ? "" : "?"}${choice}`;
  };
  return `${tool.name}(${shown.map(arg).join(", ")})`;
}

/** Optional arguments worth showing, for every tool ("*") and per tool. */
const OPTIONAL_SHOWN: Record<string, string[]> = {
  "*": ["prompt", "text"],
  "soundbox.add_bed": ["kind"],
  "soundbox.master_and_export_audiobook": ["format"],
  "soundbox.edit_paragraph": ["character", "locked"],
  "soundbox.lock_paragraphs": ["locked"],
  "soundbox.split_paragraph": ["before"],
  "soundbox.add_chapter": ["position"],
  "soundbox.edit_chapter": ["title", "included"],
};

/** What a small model writes when it means "nothing". */
function isPlaceholder(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return /^(|none|null|default|n\/a|auto)$/i.test(value.trim());
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

/** "true"/"false" and numbers in quotes, as the schema wants them. */
function coerce(value: unknown, schema: Record<string, unknown> | undefined): unknown {
  if (typeof value !== "string" || !schema) return value;
  const t = value.trim();
  if (schema.type === "boolean" && /^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  if ((schema.type === "number" || schema.type === "integer") && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return value;
}

/** The first sentence, which for Mirli's tools is what the tool does. */
function firstSentence(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  const end = one.search(/\.(\s|$)/);
  return end > 0 ? one.slice(0, end + 1) : one;
}

/** Paragraphs shown when the request is about the text or its sound. */
const PARAGRAPHS_IN_PROMPT = 12;
/** Of those, how many are shown whole. */
const FULL_PARAGRAPHS = 3;

function contextBlock(ctx: AgentContext, aliases: Aliases, groups: ToolGroup[]): string {
  const out: string[] = [];
  const voiceName = (id: string | null) =>
    id ? (ctx.voices.find((v) => v.voice_id === id)?.name ?? "a voice not saved here") : "none";
  if (ctx.book) {
    const b = ctx.book;
    const paras = b.chapters.reduce((n, c) => n + c.paragraphs, 0);
    const voiced = b.chapters.reduce((n, c) => n + c.voiced, 0);
    out.push(
      `Book B: "${b.title}". ${b.chapters.length} chapters, ${voiced} of ${paras} paragraphs voiced. ` +
        `Narrator voice: ${voiceName(b.narrator_voice_id)}.`,
    );
    out.push(
      `Chapters (voiced/paragraphs): ${b.chapters
        .map((c, i) => `C${i + 1} "${clip(c.title, 30)}" ${c.voiced}/${c.paragraphs}`)
        .join("; ")}`,
    );
    out.push(
      b.characters.length
        ? `Characters: ${b.characters.map((c) => `${c.name} (voice: ${voiceName(c.voice_id)})`).join("; ")}`
        : "Characters: none yet",
    );
  }
  if (ctx.chapter) {
    out.push(`Open chapter: ${aliases.of.get(ctx.chapter.chapter_id) ?? "?"} "${ctx.chapter.title}"`);
    if (groups.some((g) => g === "text" || g === "voicing" || g === "sound" || g === "other")) {
      const shown = ctx.chapter.paragraphs.filter(
        (p, i) => i < PARAGRAPHS_IN_PROMPT || ctx.selected_ids.includes(p.paragraph_id),
      );
      out.push("Its paragraphs (use P numbers for paragraph_id and line_id; … means cut short here):");
      shown.forEach((p, i) => {
        const selected = ctx.selected_ids.includes(p.paragraph_id);
        // The first few and the selected ones in full, so "fix the typo in
        // the first paragraph" has the whole paragraph to rewrite.
        const text = i < FULL_PARAGRAPHS || selected ? clip(p.text, 600) : clip(p.text, 70);
        const kind = p.is_heading ? "heading, " : "";
        out.push(`${aliases.of.get(p.paragraph_id)}${selected ? " [selected]" : ""} (${kind}${p.status}): ${text}`);
      });
    }
  }
  out.push(
    ctx.voices.length
      ? `Voices (use V numbers for voice_id): ${ctx.voices.map((v, i) => `V${i + 1} ${v.name}`).join("; ")}`
      : "Voices: none saved",
  );
  return out.join("\n");
}

/** Which tool does what in a book, for the tools a plan is shown. The real
 *  model reached for `generate` to put rain under a chapter and for
 *  `speak_story` to voice one; these say which is meant. */
const BOOK_HINTS: [string, string][] = [
  ["soundbox.set_character_voice", 'Choose the voice a character speaks with: set_character_voice. The narrator is character "narrator".'],
  ["soundbox.render_audiobook", "Voice a chapter or the book with render_audiobook (chapter_id for one chapter)."],
  ["soundbox.add_bed", "Music, ambience or an effect under a chapter: add_bed with a prompt."],
  ["soundbox.edit_paragraph", "Change a paragraph's words: edit_paragraph with paragraph_id and the whole new text."],
  ["soundbox.find_replace", "The same change in many places: find_replace."],
  ["soundbox.split_paragraph", "Split a paragraph: split_paragraph with before = the exact words that start the second part."],
  ["soundbox.cast_paragraphs", "\"X reads paragraph N\": cast_paragraphs with those paragraph_ids and character X. Not set_character_voice."],
  ["soundbox.lock_paragraphs", "Keep paragraphs as they are: lock_paragraphs."],
  ["soundbox.add_chapter", "A new chapter: add_chapter with a title (and its text, if given)."],
  ["soundbox.edit_chapter", "Rename a chapter, or leave it out with included false: edit_chapter."],
  ["soundbox.add_pronunciation", "Pronunciation: term and how to say it as replacement; leave kind out."],
  ["soundbox.master_and_export_audiobook", "Export the book: master_and_export_audiobook with format."],
];

/**
 * The facts a question is answered from, by name and with the sums done.
 *
 * Shown the planning context, the model answered "how many chapters?" with
 * the paragraph total (2,252 for a 64-chapter book) and wrote "V1 (Mara)"
 * back to the person. A question needs no codes, and a small model should
 * not be adding up sixty-four numbers.
 */
function factsBlock(ctx: AgentContext): string {
  const out: string[] = [];
  const voiceName = (id: string | null) =>
    id ? (ctx.voices.find((v) => v.voice_id === id)?.name ?? "a voice not saved here") : "not chosen yet";
  if (ctx.book) {
    const b = ctx.book;
    const paras = b.chapters.reduce((n, c) => n + c.paragraphs, 0);
    const voiced = b.chapters.reduce((n, c) => n + c.voiced, 0);
    const full = b.chapters.filter((c) => c.paragraphs > 0 && c.voiced >= c.paragraphs).length;
    const started = b.chapters.filter((c) => c.voiced > 0 && c.voiced < c.paragraphs).length;
    const longest = [...b.chapters].sort((a, c) => c.paragraphs - a.paragraphs).slice(0, 3);
    out.push(
      ctx.voices.length
        ? `Voices you have saved (${ctx.voices.length}): ${ctx.voices.map((v) => v.name).join(", ")}.`
        : "You have no saved voices yet.",
    );
    out.push(`Book: "${b.title}".`);
    out.push(`Number of chapters: ${b.chapters.length}.`);
    out.push(`Chapters fully voiced: ${full}. Chapters partly voiced: ${started}. Not started: ${b.chapters.length - full - started}.`);
    out.push(`Paragraphs in the whole book: ${paras}, of which ${voiced} voiced.`);
    out.push(`Longest chapters: ${longest.map((c) => `"${c.title}" (${c.paragraphs} paragraphs)`).join(", ")}.`);
    out.push(`Narrator's voice: ${voiceName(b.narrator_voice_id)}.`);
    out.push(
      b.characters.length
        ? `Characters: ${b.characters.map((c) => `${c.name} (voice: ${voiceName(c.voice_id)})`).join(", ")}.`
        : "Characters: none set up yet.",
    );
    out.push(`Chapter titles in order: ${b.chapters.map((c) => `"${clip(c.title, 30)}"`).join(", ")}.`);
  }
  if (ctx.chapter) {
    const c = ctx.book?.chapters.find((x) => x.chapter_id === ctx.chapter!.chapter_id);
    out.push(`Open chapter: "${ctx.chapter.title}"${c ? `, ${c.paragraphs} paragraphs, ${c.voiced} voiced` : ""}.`);
  }
  return out.join("\n");
}

export function buildAgentMessages(
  instruction: string,
  history: { role: "user" | "assistant"; content: string }[],
  tools: AgentTool[],
  ctx: AgentContext,
  groups: ToolGroup[] = ["other"],
): ChatMessage[] {
  const recentTurns = history.slice(-4).map((m) => ({ role: m.role, content: clip(m.content, 300) }));
  if (groups.includes("answer")) {
    return [
      {
        role: "system",
        content: [
          "You are Mirli's assistant. Answer the person's question about their audiobook in one to three plain sentences, using only the facts given. \"I\" in their question is them; \"you\" in the facts is them too.",
          "If the facts don't say, say you can't tell from here. Never claim to have changed anything.",
          "Plain text only: no JSON, no lists of codes.",
        ].join("\n"),
      },
      ...recentTurns,
      { role: "user", content: `${factsBlock(ctx)}\n\nQuestion: ${instruction}` },
    ];
  }
  const aliases = new Aliases(ctx);
  const chosen = toolsFor(tools, groups, instruction);
  const catalogue = chosen.map((t) => `- ${signature(t)}: ${clip(firstSentence(t.description), 160)}`).join("\n");
  const system = [
    "You are Mirli's assistant, working on the audiobook the person has open.",
    "Answer with ONE JSON object and nothing else:",
    '{"reply": "<one or two plain sentences to the person>", "calls": [{"tool": "<tool name>", "arguments": {...}}]}',
    "Rules:",
    "- Refer to things only by the short names in the context: B, C1, P1, V1, or a character's name.",
    "- For story_id use the chapter's C number.",
    "- Only add calls when asked to change or make something; a question gets a reply and no calls.",
    "- At most 6 calls, in order. Nothing runs until the person accepts.",
    "- reply says what you will do once they accept (I'll…), never that it is done, in plain words: names, not short names or tool names.",
    "- Leave out arguments you don't need; the defaults are right.",
    "",
    "In a book:",
    ...BOOK_HINTS.filter((h) => chosen.some((t) => t.name === h[0])).map((h) => `- ${h[1]}`),
    "",
    "Tools:",
    catalogue,
  ].join("\n");
  return [
    { role: "system", content: system },
    ...recentTurns,
    { role: "user", content: `${contextBlock(ctx, aliases, groups)}\n\nInstruction: ${instruction}` },
  ];
}

/* ----------------------------------------------------------------- parse */

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(THINK_BLOCK_RE, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  const body = fenced ? fenced[1]!.trim() : cleaned;
  // A small model often says a sentence before the object; take the object.
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Argument names whose values must be an id the model was shown. */
function knownIds(ctx: AgentContext): Record<string, Set<string>> {
  const books = new Set(ctx.book ? [ctx.book.book_id] : []);
  const chapters = new Set(ctx.book?.chapters.map((c) => c.chapter_id) ?? []);
  const stories = new Set(ctx.book?.chapters.map((c) => c.story_id) ?? []);
  const paragraphs = new Set(ctx.chapter?.paragraphs.map((p) => p.paragraph_id) ?? []);
  const voices = new Set(ctx.voices.map((v) => v.voice_id));
  return {
    book_id: books,
    chapter_id: chapters,
    story_id: stories,
    paragraph_id: paragraphs,
    line_id: paragraphs,
    voice_id: voices,
    narrator_voice_id: voices,
  };
}

/**
 * Keep the calls that name a real tool, carry its required arguments, use
 * only its own argument names, and refer to ids the model was shown.
 *
 * Short names are turned back into ids first (`Aliases`). Then dropping
 * rather than repairing, as in `studio.ts`: a call to an unknown tool or
 * naming an unknown chapter is the model having invented something, and the
 * honest response is not to run it. The tool still validates every
 * argument's type and range itself when it runs.
 */
export function validateCalls(
  raw: unknown,
  tools: AgentTool[],
  ctx: AgentContext,
  instruction = "",
): { calls: (AgentCall & { risk: AgentRisk })[]; dropped: AgentPlan["dropped"] } {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const aliases = new Aliases(ctx);
  const ids = knownIds(ctx);
  const calls: (AgentCall & { risk: AgentRisk })[] = [];
  const dropped: AgentPlan["dropped"] = [];
  for (const item of Array.isArray(raw) ? raw.slice(0, 6) : []) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    let name = String(rec.tool ?? rec.name ?? "");
    if (name && !name.startsWith("soundbox.") && byName.has(`soundbox.${name}`)) name = `soundbox.${name}`;
    const tool = byName.get(name);
    if (!tool) {
      // Not offered for this request, or not a tool at all. A worked example
      // in the prompt once came back as the plan for four unrelated
      // requests, using a tool none of them were shown.
      dropped.push({ tool: name || "(none)", reason: "not a tool offered for this request" });
      continue;
    }
    const given = rec.arguments ?? rec.args ?? rec.input ?? {};
    if (!given || typeof given !== "object" || Array.isArray(given)) {
      dropped.push({ tool: name, reason: "arguments were not an object" });
      continue;
    }
    const props = tool.inputSchema.properties ?? {};
    const args: Record<string, unknown> = {};
    const required = new Set(tool.inputSchema.required ?? []);
    for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
      if (!(key in props)) continue;
      // `voice_id: null` clears a voice, so null stays where it is required.
      if (!required.has(key) && isPlaceholder(value)) continue;
      args[key] = coerce(aliases.resolve(key, value), props[key]);
    }
    // "I want Tobias to narrate" came back once as a new character called
    // Tobias, and "the narrator reads the third paragraph" as a paragraph
    // given to "Mara". A voice's name given as the character, in a request
    // about narrating, means the narrator.
    if (
      (name === "soundbox.set_character_voice" || name === "soundbox.cast_paragraphs" || name === "soundbox.edit_paragraph") &&
      typeof args.character === "string" &&
      /narrat/i.test(instruction) &&
      ctx.voices.some((v) => v.name.toLowerCase() === String(args.character).toLowerCase()) &&
      !ctx.book?.characters.some((c) => c.name.toLowerCase() === String(args.character).toLowerCase())
    ) {
      args.character = "narrator";
    }
    // A character the book doesn't have yet is added by the same call, which
    // the person sees on the card before anything runs.
    if (
      name === "soundbox.set_character_voice" &&
      typeof args.character === "string" &&
      args.character.toLowerCase() !== "narrator" &&
      !ctx.book?.characters.some((c) => c.name.toLowerCase() === String(args.character).toLowerCase())
    ) {
      args.create = true;
    }
    const knownParagraph = new Set(ctx.chapter?.paragraphs.map((p) => p.paragraph_id) ?? []);
    // A paragraph argument that isn't one: on a real run "the second
    // paragraph" came back as C2, a chapter's short name. The request's own
    // ordinal says which.
    for (const key of ["paragraph_id", "line_id"]) {
      if (typeof args[key] === "string" && !knownParagraph.has(args[key] as string)) {
        const named = aliases.paragraphNamedIn(instruction);
        if (named) args[key] = named;
      }
    }
    if (Array.isArray(args.paragraph_ids) && args.paragraph_ids.some((v) => typeof v !== "string" || !knownParagraph.has(v))) {
      const named = aliases.paragraphNamedIn(instruction);
      if (named) args.paragraph_ids = [named];
    }
    // Split before words that are in another paragraph: the one with them.
    if (name === "soundbox.split_paragraph" && typeof args.before === "string" && ctx.chapter) {
      const before = args.before;
      const current = ctx.chapter.paragraphs.find((p) => p.paragraph_id === args.paragraph_id);
      if (!current || current.text.indexOf(before) <= 0) {
        const holders = ctx.chapter.paragraphs.filter((p) => p.text.indexOf(before) > 0);
        if (holders.length === 1) args.paragraph_id = holders[0]!.paragraph_id;
      }
    }
    // "Rename chapter II" came back as C2, the chapter titled "I": in a book
    // whose chapters are numbered in their titles, the C numbers and the
    // titles disagree. A title the request names wins.
    if (typeof args.chapter_id === "string" && ctx.book) {
      const named = aliases.chapterNamedIn(instruction);
      if (named && named !== args.chapter_id) args.chapter_id = named;
    }
    // Shown `included`, the model set it false on a plain rename.
    if (name === "soundbox.edit_chapter" && args.included !== undefined && !/\b(include|exclude|leave|out of|back in)\b/i.test(instruction)) {
      delete args.included;
    }
    // "At the end" came back as position 2252 (the paragraph count).
    if (name === "soundbox.add_chapter" && typeof args.position === "number" && ctx.book && args.position >= ctx.book.chapters.length) {
      delete args.position;
    }
    // The open book, when the tool takes one and the model left it out.
    if ("book_id" in props && args.book_id === undefined && ctx.book) args.book_id = ctx.book.book_id;
    const missing = (tool.inputSchema.required ?? []).filter((k) => !(k in args));
    if (missing.length) {
      dropped.push({ tool: name, reason: `missing ${missing.join(", ")}` });
      continue;
    }
    const unknown = Object.entries(args).find(
      ([key, value]) => ids[key] !== undefined && value !== null && (typeof value !== "string" || !ids[key]!.has(value)),
    );
    if (unknown) {
      dropped.push({ tool: name, reason: `${unknown[0]} ${String(unknown[1])} is not one shown to it` });
      continue;
    }
    const listed = ["paragraph_ids", "chapter_ids"].find((key) => {
      const value = args[key];
      const known = key === "paragraph_ids" ? ids.paragraph_id! : ids.chapter_id!;
      return Array.isArray(value) && value.some((v) => typeof v !== "string" || !known.has(v));
    });
    if (listed) {
      dropped.push({ tool: name, reason: `${listed} names one it was not shown` });
      continue;
    }
    // On a real run, "fix the typo" came back as the paragraph as the prompt
    // showed it, cut at 70 characters with "…". Accepted, that would have cut
    // the paragraph short. New text that ends where an excerpt was cut is
    // refused rather than written.
    const target = args.line_id ?? args.paragraph_id;
    if (typeof args.text === "string" && /(…|\.\.\.)\s*$/.test(args.text)) {
      const was = ctx.chapter?.paragraphs.find((p) => p.paragraph_id === target)?.text ?? "";
      const stem = args.text.replace(/(…|\.\.\.)\s*$/, "");
      if (was.length > stem.length && !/(…|\.\.\.)\s*$/.test(was)) {
        dropped.push({ tool: name, reason: "its new text was cut short" });
        continue;
      }
    }
    // "Make it start with 'It is a truth'" came back once as just those four
    // words, which would have replaced the whole paragraph. Unless the
    // request gives the new wording ("…to say: …"), new text much shorter
    // than the paragraph it replaces is refused.
    if ((name === "soundbox.update_line" || name === "soundbox.edit_paragraph") && typeof args.text === "string") {
      const was = ctx.chapter?.paragraphs.find((p) => p.paragraph_id === target)?.text ?? "";
      const givesWording = /\b(to say|to read|say:|read:|replace (?:it|the \w+) with|with the text)\b/i.test(instruction);
      if (was.length > 60 && args.text.trim().length < was.length * 0.5 && !givesWording) {
        dropped.push({ tool: name, reason: "its new text would cut most of the paragraph" });
        continue;
      }
    }
    calls.push({ tool: name, arguments: args, risk: riskOf(name) });
  }
  return { calls, dropped };
}

/** "Mrs. Bennet reads the third paragraph": casting, not a voice change. */
const READS_PARAGRAPHS = /\breads?\b.{0,40}\bparagraphs?\b|\bparagraphs?\b.{0,40}\b(?:read|spoken) by\b/i;

/**
 * The tools a plan for these groups is shown, and may use.
 *
 * A request about who reads paragraphs gets only `cast_paragraphs`: offered
 * the voice and text tools too, the real model gave Mrs. Bennet a voice and
 * copied the paragraph into an edit, three times running.
 */
export function toolsFor(tools: AgentTool[], groups: ToolGroup[], instruction = ""): AgentTool[] {
  if (groups.includes("answer")) return [];
  if (READS_PARAGRAPHS.test(instruction) && tools.some((t) => t.name === "soundbox.cast_paragraphs")) {
    return tools.filter((t) => t.name === "soundbox.cast_paragraphs");
  }
  return tools.filter((t) => groups.includes(groupOf(t.name)));
}

export function parseAgentPlan(text: string, tools: AgentTool[], ctx: AgentContext, instruction = ""): AgentPlan {
  const obj = parseJsonObject(text);
  if (!obj) {
    // Not JSON at all: the model answered in prose. That is a reply.
    const plain = text.replace(THINK_BLOCK_RE, "").trim();
    return { reply: plain, calls: [], dropped: [] };
  }
  const reply =
    typeof obj.reply === "string" ? obj.reply.trim() : typeof obj.summary === "string" ? obj.summary.trim() : "";
  const { calls, dropped } = validateCalls(obj.calls ?? obj.tool_calls ?? obj.actions, tools, ctx, instruction);
  // A proposal's reply must not say it is done: nothing has run yet. The
  // model still says "has been deleted" now and then, so that reply is
  // replaced rather than shown over a card that says "Waiting for you".
  const claims = /\b(has|have) been\b|\b(is|are) now\b|\bdone\b/i.test(reply);
  return { reply: calls.length && claims ? "Here's what I'd do. Nothing changes until you accept." : reply, calls, dropped };
}
