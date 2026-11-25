import { describe, expect, it } from "vitest";

import {
  buildAgentMessages,
  parseAgentPlan,
  riskOf,
  signature,
  type AgentContext,
  type AgentTool,
} from "../src/llm/agent.js";

/**
 * The assistant's agent planner, without a model: the prompt it writes, and
 * what survives of what the model answers.
 */

const tools: AgentTool[] = [
  {
    name: "soundbox.set_character_voice",
    description: "Give a character a voice. More words here.",
    inputSchema: {
      properties: { book_id: {}, character: {}, voice_id: {}, model_id: {}, create: {} },
      required: ["book_id", "character", "voice_id"],
    },
  },
  {
    name: "soundbox.render_audiobook",
    description: "Voice a book or chapter.",
    inputSchema: { properties: { book_id: {}, chapter_id: {}, paragraph_ids: {} }, required: ["book_id"] },
  },
  {
    name: "soundbox.get_audiobook",
    description: "Read a book.",
    inputSchema: { properties: { book_id: {}, chapter_id: {} }, required: ["book_id"] },
  },
  {
    name: "soundbox.delete_line",
    description: "Delete a line.",
    inputSchema: { properties: { line_id: {} }, required: ["line_id"] },
  },
];

const ctx: AgentContext = {
  book: {
    book_id: "b1",
    title: "The Raven",
    narrator_voice_id: null,
    chapters: [{ chapter_id: "c1", story_id: "s1", title: "One", paragraphs: 2, voiced: 0 }],
    characters: [{ character_id: "ch1", name: "Raven", voice_id: null }],
  },
  chapter: {
    chapter_id: "c1",
    story_id: "s1",
    title: "One",
    paragraphs: [
      { paragraph_id: "p1", text: "Once upon a midnight dreary", character_id: null, status: "unvoiced" },
      { paragraph_id: "p2", text: "Quoth the Raven", character_id: "ch1", status: "unvoiced" },
    ],
  },
  selected_ids: ["p2"],
  voices: [{ voice_id: "v1", name: "Ada" }],
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

describe("buildAgentMessages", () => {
  it("shows every tool with its arguments, and the book's ids", () => {
    const msgs = buildAgentMessages("give the raven Ada's voice", [], tools, ctx);
    const system = msgs[0]!.content;
    expect(system).toContain("soundbox.set_character_voice(book_id, character, voice_id, model_id?, create?): Give a character a voice.");
    expect(system).not.toContain("More words here");
    const user = msgs.at(-1)!.content;
    expect(user).toContain("book_id=b1");
    expect(user).toContain("chapter_id=c1");
    expect(user).toContain("paragraph_id=p2 [selected]");
    expect(user).toContain("Ada (voice_id=v1)");
    expect(user).toContain("Instruction: give the raven Ada's voice");
  });

  it("carries the last few turns of the conversation", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `turn ${i}` }));
    const msgs = buildAgentMessages("again", history, tools, ctx);
    expect(msgs.map((m) => m.content)).toContain("turn 9");
    expect(msgs.map((m) => m.content)).not.toContain("turn 3");
  });
});

describe("parseAgentPlan", () => {
  it("keeps calls that name real tools and ids, with their risk", () => {
    const plan = parseAgentPlan(
      'Sure! ```json\n{"reply": "Giving the Raven Ada\'s voice, then voicing chapter One.", "calls": [' +
        '{"tool": "soundbox.set_character_voice", "arguments": {"book_id": "b1", "character": "Raven", "voice_id": "v1", "colour": "red"}},' +
        '{"tool": "render_audiobook", "arguments": {"book_id": "b1", "chapter_id": "c1"}}]}\n```',
      tools,
      ctx,
    );
    expect(plan.reply).toMatch(/Ada's voice/);
    expect(plan.calls).toEqual([
      {
        tool: "soundbox.set_character_voice",
        arguments: { book_id: "b1", character: "Raven", voice_id: "v1" },
        risk: "write",
      },
      { tool: "soundbox.render_audiobook", arguments: { book_id: "b1", chapter_id: "c1" }, risk: "costly" },
    ]);
    expect(plan.dropped).toEqual([]);
  });

  it("drops invented tools, invented ids and missing arguments, and says why", () => {
    const plan = parseAgentPlan(
      JSON.stringify({
        reply: "ok",
        calls: [
          { tool: "soundbox.launch_rocket", arguments: {} },
          { tool: "soundbox.set_character_voice", arguments: { book_id: "b9", character: "Raven", voice_id: "v1" } },
          { tool: "soundbox.set_character_voice", arguments: { book_id: "b1", character: "Raven", voice_id: "v404" } },
          { tool: "soundbox.set_character_voice", arguments: { book_id: "b1", character: "Raven" } },
          { tool: "soundbox.render_audiobook", arguments: { book_id: "b1", paragraph_ids: ["p1", "p9"] } },
          { tool: "soundbox.delete_line", arguments: { line_id: "p2" } },
        ],
      }),
      tools,
      ctx,
    );
    expect(plan.calls).toEqual([{ tool: "soundbox.delete_line", arguments: { line_id: "p2" }, risk: "destructive" }]);
    expect(plan.dropped.map((d) => d.reason)).toEqual([
      "no such tool",
      "book_id b9 is not one shown to it",
      "voice_id v404 is not one shown to it",
      "missing voice_id",
      "paragraph_ids names one it was not shown",
    ]);
  });

  it("takes prose as a reply with no calls", () => {
    const plan = parseAgentPlan("<think>hmm</think>Chapter One has two paragraphs.", tools, ctx);
    expect(plan).toEqual({ reply: "Chapter One has two paragraphs.", calls: [], dropped: [] });
  });

  it("writes a signature with optional arguments marked", () => {
    expect(signature(tools[1]!)).toBe("soundbox.render_audiobook(book_id, chapter_id?, paragraph_ids?)");
  });
});
