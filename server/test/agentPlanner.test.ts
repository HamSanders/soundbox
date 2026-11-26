import { describe, expect, it } from "vitest";

import {
  buildAgentMessages,
  buildRouteMessages,
  parseAgentPlan,
  parseGroups,
  riskOf,
  signature,
  toolsFor,
  type AgentContext,
  type AgentTool,
} from "../src/llm/agent.js";

/**
 * The assistant's agent planner, without a model: the prompts it writes, and
 * what survives of what the model answers. Several cases are what Qwen3 1.7B
 * actually answered on "Pride and Prejudice" (see the comments in agent.ts).
 */

const tools: AgentTool[] = [
  {
    name: "soundbox.set_character_voice",
    description: "Give a character a voice. More words here.",
    inputSchema: {
      properties: { book_id: {}, character: {}, voice_id: {}, model_id: {}, create: { type: "boolean" } },
      required: ["book_id", "character", "voice_id"],
    },
  },
  {
    name: "soundbox.render_audiobook",
    description: "Voice a book or chapter.",
    inputSchema: { properties: { book_id: {}, chapter_id: {}, paragraph_ids: {}, overwrite: {} }, required: ["book_id"] },
  },
  {
    name: "soundbox.add_bed",
    description: "Put a bed under a chapter.",
    inputSchema: {
      properties: {
        book_id: {},
        chapter_id: {},
        kind: { enum: ["music", "ambience", "sfx"], default: "music" },
        mode: { enum: ["full", "intro"], default: "full" },
        prompt: {},
        paragraph_id: {},
        seed: {},
      },
      required: ["book_id", "chapter_id"],
    },
  },
  {
    name: "soundbox.update_line",
    description: "Change a line.",
    inputSchema: { properties: { line_id: {}, text: {}, muted: { type: "boolean" } }, required: ["line_id"] },
  },
  {
    name: "soundbox.delete_line",
    description: "Delete a line.",
    inputSchema: { properties: { line_id: {} }, required: ["line_id"] },
  },
  {
    name: "soundbox.get_audiobook",
    description: "Read a book.",
    inputSchema: { properties: { book_id: {}, chapter_id: {} }, required: ["book_id"] },
  },  {
    name: "soundbox.cast_paragraphs",
    description: "Have a character read paragraphs.",
    inputSchema: { properties: { book_id: {}, paragraph_ids: {}, character: {} }, required: ["book_id", "paragraph_ids", "character"] },
  },
  {
    name: "soundbox.split_paragraph",
    description: "Split a paragraph.",
    inputSchema: { properties: { book_id: {}, paragraph_id: {}, before: {}, at: {} }, required: ["book_id", "paragraph_id"] },
  },
  {
    name: "soundbox.edit_chapter",
    description: "Change a chapter.",
    inputSchema: { properties: { book_id: {}, chapter_id: {}, title: {}, included: { type: "boolean" } }, required: ["book_id", "chapter_id"] },
  },
  {
    name: "soundbox.add_chapter",
    description: "Add a chapter.",
    inputSchema: { properties: { book_id: {}, title: {}, position: {} }, required: ["book_id", "title"] },
  },
];

const LONG =
  "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.";

const ctx: AgentContext = {
  book: {
    book_id: "book-uuid",
    title: "Pride and Prejudice",
    narrator_voice_id: null,
    chapters: [
      { chapter_id: "ch-1", story_id: "st-1", title: "I", paragraphs: 3, voiced: 0 },
      { chapter_id: "ch-2", story_id: "st-2", title: "II", paragraphs: 9, voiced: 9 },
    ],
    characters: [{ character_id: "k1", name: "Mr. Bennet", voice_id: null }],
  },
  chapter: {
    chapter_id: "ch-1",
    story_id: "st-1",
    title: "I",
    paragraphs: [
      { paragraph_id: "p-1", text: "I", character_id: null, status: "unvoiced", is_heading: true },
      { paragraph_id: "p-2", text: LONG, character_id: null, status: "unvoiced" },
      { paragraph_id: "p-3", text: "Quoth he.", character_id: "k1", status: "unvoiced" },
    ],
  },
  selected_ids: ["p-3"],
  voices: [
    { voice_id: "v-mara", name: "Mara" },
    { voice_id: "v-tobias", name: "Tobias" },
  ],
};

describe("riskOf", () => {
  it("reads without asking, and asks for everything else", () => {
    expect(riskOf("soundbox.get_audiobook")).toBe("read");
    expect(riskOf("soundbox.list_voices")).toBe("read");
    expect(riskOf("soundbox.set_character_voice")).toBe("write");
    expect(riskOf("soundbox.render_audiobook")).toBe("costly");
    expect(riskOf("soundbox.delete_line")).toBe("destructive");
    // A tool added later asks first until someone classes it.
    expect(riskOf("soundbox.something_new")).toBe("write");
  });
});

describe("routing", () => {
  it("lists every kind for the router", () => {
    const system = buildRouteMessages("voice this chapter", [])[0]!.content;
    for (const kind of ["answer", "voices", "pronunciation", "text", "voicing", "sound", "export", "library", "other"]) {
      expect(system).toContain(`- ${kind}:`);
    }
  });

  it("sends a question to answer whatever the router says", () => {
    expect(parseGroups("text, voices, voicing", "Which chapters are the longest?")).toEqual(["answer"]);
    expect(parseGroups("voices", "What voices do I have?")).toEqual(["answer"]);
  });

  it("lets the request's own words win over the router's extras", () => {
    // Routed to export and sound, the model wrote a music bed.
    expect(parseGroups("export, sound", "Export the book as an M4B")).toEqual(["export"]);
    // Routed to answer, the model said a typo was fixed.
    expect(parseGroups("answer", "Fix the typo in the first paragraph")).toEqual(["text"]);
    expect(parseGroups("", "Can you read chapter III aloud?")).toEqual(["voicing"]);
  });

  it("takes the router's kinds when the words say nothing, and reads silence as a question", () => {
    expect(parseGroups("<think></think>library, other", "Start a new book called Emma")).toEqual(["library", "other"]);
    expect(parseGroups("hmm", "Hello there")).toEqual(["answer"]);
  });

  it("offers only casting when the request is about who reads paragraphs", () => {
    expect(toolsFor(tools, ["text", "voices"], "Mrs. Bennet reads the third paragraph").map((t) => t.name)).toEqual([
      "soundbox.cast_paragraphs",
    ]);
    expect(parseGroups("export", "Leave the Imprint chapter out of the export")).toEqual(["chapters"]);
  });

  it("offers only the routed tools", () => {
    expect(toolsFor(tools, ["voicing"]).map((t) => t.name)).toEqual(["soundbox.render_audiobook"]);
    expect(toolsFor(tools, ["answer"])).toEqual([]);
  });
});

describe("buildAgentMessages", () => {
  it("shows short names, headings, the routed tools and their key arguments only", () => {
    const msgs = buildAgentMessages("put rain under this chapter", [], tools, ctx, ["sound", "text"]);
    const system = msgs[0]!.content;
    expect(system).toContain("soundbox.add_bed(book_id, chapter_id, kind?: music|ambience|sfx, prompt?): Put a bed under a chapter.");
    expect(system).not.toContain("mode?");
    expect(system).not.toContain("seed?");
    expect(system).not.toContain("set_character_voice");
    expect(system).toContain("Music, ambience or an effect under a chapter: add_bed");
    const user = msgs.at(-1)!.content;
    expect(user).toContain('Book B: "Pride and Prejudice". 2 chapters, 9 of 12 paragraphs voiced.');
    expect(user).toContain('C1 "I" 0/3; C2 "II" 9/9');
    expect(user).toContain("P1 (heading, unvoiced): I");
    expect(user).toContain(`P2 (unvoiced): ${LONG}`);
    expect(user).toContain("P3 [selected]");
    expect(user).toContain("V1 Mara; V2 Tobias");
    expect(user).not.toContain("book-uuid");
    expect(user).not.toContain("ch-1");
  });

  it("answers a question from facts with the sums done and no codes", () => {
    const msgs = buildAgentMessages("how many chapters?", [], tools, ctx, ["answer"]);
    expect(msgs[0]!.content).toContain("Plain text only");
    const user = msgs.at(-1)!.content;
    expect(user).toContain("Number of chapters: 2.");
    expect(user).toContain("Chapters fully voiced: 1.");
    expect(user).toContain('Longest chapters: "II" (9 paragraphs), "I" (3 paragraphs)');
    expect(user).toContain("Voices you have saved (2): Mara, Tobias.");
    expect(user).not.toMatch(/\bV1\b|\bC1\b/);
  });

  it("carries the last few turns of the conversation", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      content: `turn ${i}`,
    }));
    const msgs = buildAgentMessages("again", history, tools, ctx, ["voices"]);
    expect(msgs.map((m) => m.content)).toContain("turn 9");
    expect(msgs.map((m) => m.content)).not.toContain("turn 3");
  });
});

describe("parseAgentPlan", () => {
  const plan = (calls: unknown[], instruction = "", reply = "I'll do it.") =>
    parseAgentPlan(JSON.stringify({ reply, calls }), tools, ctx, instruction);

  it("turns short names, bare numbers and voice names back into ids", () => {
    const p = plan([
      { tool: "soundbox.set_character_voice", arguments: { book_id: "B", character: "narrator", voice_id: "V2" } },
      { tool: "render_audiobook", arguments: { chapter_id: "c2" } },
      { tool: "soundbox.update_line", arguments: { line_id: "3", text: "Quoth she." } },
      { tool: "soundbox.set_character_voice", arguments: { book_id: "B", character: "Mr. Bennet", voice_id: "Mara" } },
    ]);
    expect(p.dropped).toEqual([]);
    expect(p.calls.map((c) => c.arguments)).toEqual([
      { book_id: "book-uuid", character: "narrator", voice_id: "v-tobias" },
      // The open book is filled in when the model leaves it out.
      { chapter_id: "ch-2", book_id: "book-uuid" },
      { line_id: "p-3", text: "Quoth she." },
      { book_id: "book-uuid", character: "Mr. Bennet", voice_id: "v-mara" },
    ]);
  });

  it("drops placeholder optional arguments and coerces quoted booleans", () => {
    const p = plan([
      {
        tool: "soundbox.add_bed",
        arguments: { book_id: "B", chapter_id: "C1", kind: "ambience", prompt: "quiet rain", seed: "none", mode: "", paragraph_id: null },
      },
      { tool: "soundbox.update_line", arguments: { line_id: "P3", muted: "true" } },
    ]);
    expect(p.calls[0]!.arguments).toEqual({ book_id: "book-uuid", chapter_id: "ch-1", kind: "ambience", prompt: "quiet rain" });
    expect(p.calls[1]!.arguments).toEqual({ line_id: "p-3", muted: true });
  });

  it("adds a character the book lacks, and reads a voice given as the narrator as the narrator", () => {
    const p = plan(
      [
        { tool: "soundbox.set_character_voice", arguments: { book_id: "B", character: "Lydia", voice_id: "V1" } },
        { tool: "soundbox.set_character_voice", arguments: { book_id: "B", character: "Tobias", voice_id: "V2" } },
      ],
      "Lydia gets Mara, and I want Tobias to narrate",
    );
    expect(p.calls.map((c) => [c.arguments.character, c.arguments.create])).toEqual([
      ["Lydia", true],
      ["narrator", undefined],
    ]);
  });

  it("refuses rewrites that would cut a paragraph short", () => {
    const p = plan(
      [
        // The excerpt as shown, cut with "…".
        { tool: "soundbox.update_line", arguments: { line_id: "P2", text: "It is a truth universally acknowledged, that a…" } },
        // Four words in place of the whole paragraph.
        { tool: "soundbox.update_line", arguments: { line_id: "P2", text: "It is a truth" } },
      ],
      "Fix the typo in the second paragraph: make it start with 'It is a truth'",
    );
    expect(p.calls).toEqual([]);
    expect(p.dropped.map((d) => d.reason)).toEqual([
      "its new text was cut short",
      "its new text would cut most of the paragraph",
    ]);
    // Asked for new wording outright, a short replacement is fine.
    const ok = plan(
      [{ tool: "soundbox.update_line", arguments: { line_id: "P2", text: "Mr. Bennet said nothing." } }],
      "Change the second paragraph to say: Mr. Bennet said nothing.",
    );
    expect(ok.calls).toHaveLength(1);
  });

  it("drops tools it wasn't offered, ids it wasn't shown, and missing arguments", () => {
    const p = plan([
      { tool: "soundbox.launch_rocket", arguments: {} },
      { tool: "soundbox.set_character_voice", arguments: { book_id: "other-book", character: "x", voice_id: "V1" } },
      { tool: "soundbox.set_character_voice", arguments: { book_id: "B", character: "x", voice_id: "V9" } },
      { tool: "soundbox.set_character_voice", arguments: { book_id: "B", character: "x" } },
      { tool: "soundbox.render_audiobook", arguments: { paragraph_ids: ["P1", "P9"] } },
      { tool: "soundbox.delete_line", arguments: { line_id: "P2" } },
    ]);
    expect(p.calls).toEqual([{ tool: "soundbox.delete_line", arguments: { line_id: "p-2" }, risk: "destructive" }]);
    expect(p.dropped.map((d) => d.reason)).toEqual([
      "not a tool offered for this request",
      "book_id other-book is not one shown to it",
      "voice_id V9 is not one shown to it",
      "missing voice_id",
      "paragraph_ids names one it was not shown",
    ]);
  });

  it("finds the chapter a request names by title, over the model's C number", () => {
    // In a book titled "I", "II", the model took "chapter II" for C2.
    const p = plan([{ tool: "soundbox.edit_chapter", arguments: { book_id: "B", chapter_id: "C1", title: "The Second" } }], "Rename chapter II to The Second");
    expect(p.calls[0]!.arguments.chapter_id).toBe("ch-2");
    const v = plan([{ tool: "soundbox.edit_chapter", arguments: { book_id: "B", chapter_id: "II", title: "x" } }], "rename it");
    expect(v.calls[0]!.arguments.chapter_id).toBe("ch-2");
  });

  it("takes a paragraph from the request's ordinal when the model's isn't one, and resolves numbers", () => {
    const p = plan([{ tool: "soundbox.cast_paragraphs", arguments: { book_id: "B", paragraph_ids: ["C2"], character: "Mr. Bennet" } }], "Mr. Bennet reads the third paragraph");
    expect(p.calls[0]!.arguments.paragraph_ids).toEqual(["p-3"]);
    const n = plan([{ tool: "soundbox.delete_line", arguments: { line_id: 2 } }]);
    expect(n.calls[0]!.arguments.line_id).toBe("p-2");
  });

  it("moves a split to the paragraph holding its words", () => {
    const p = plan([{ tool: "soundbox.split_paragraph", arguments: { book_id: "B", paragraph_id: "P1", before: "that a single man" } }]);
    expect(p.calls[0]!.arguments.paragraph_id).toBe("p-2");
  });

  it("drops an unasked included and a position past the end", () => {
    const e = plan([{ tool: "soundbox.edit_chapter", arguments: { book_id: "B", chapter_id: "C1", title: "One", included: false } }], "rename the first chapter to One");
    expect(e.calls[0]!.arguments).not.toHaveProperty("included");
    const left = plan([{ tool: "soundbox.edit_chapter", arguments: { book_id: "B", chapter_id: "C1", included: false } }], "leave chapter I out of the export");
    expect(left.calls[0]!.arguments.included).toBe(false);
    const add = plan([{ tool: "soundbox.add_chapter", arguments: { book_id: "B", title: "Epilogue", position: 2252 } }]);
    expect(add.calls[0]!.arguments).not.toHaveProperty("position");
  });

  it("gives a voice's name, in a request about narrating, to the narrator when casting too", () => {
    const p = plan([{ tool: "soundbox.cast_paragraphs", arguments: { book_id: "B", paragraph_ids: ["P3"], character: "Mara" } }], "The narrator reads the third paragraph");
    expect(p.calls[0]!.arguments.character).toBe("narrator");
  });

  it("never shows a reply that says the work is done over a card that waits", () => {
    const p = plan([{ tool: "soundbox.delete_line", arguments: { line_id: "P1" } }], "", "The first paragraph has been deleted.");
    expect(p.reply).toBe("Here's what I'd do. Nothing changes until you accept.");
  });

  it("takes prose as a reply with no calls", () => {
    const p = parseAgentPlan("<think>hmm</think>Chapter One has two paragraphs.", tools, ctx);
    expect(p).toEqual({ reply: "Chapter One has two paragraphs.", calls: [], dropped: [] });
  });

  it("writes a signature with the arguments worth showing", () => {
    expect(signature(tools[1]!)).toBe("soundbox.render_audiobook(book_id, chapter_id?)");
  });
});
