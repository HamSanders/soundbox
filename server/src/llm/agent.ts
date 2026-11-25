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
 * - **The model never names a thing.** Ids it was not shown (a book, a
 *   chapter, a paragraph, a voice) are dropped by `validateCalls`, with the
 *   count reported, rather than sent to a tool to fail.
 * - **Every call carries its risk.** Reading runs without asking; writing,
 *   anything that spends minutes of GPU, and anything that deletes waits for
 *   a click (`riskOf`).
 *
 * Pure and side-effect free, so the prompt, the parsing and the validation
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
    paragraphs: { paragraph_id: string; text: string; character_id: string | null; status: string }[];
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

/* ---------------------------------------------------------------- prompt */

/** `name(a, b?, c?)`: every argument, the optional ones marked. */
export function signature(tool: AgentTool): string {
  const props = Object.keys(tool.inputSchema.properties ?? {});
  const required = new Set(tool.inputSchema.required ?? []);
  return `${tool.name}(${props.map((p) => (required.has(p) ? p : `${p}?`)).join(", ")})`;
}

/** The first sentence, which for Mirli's tools is what the tool does. */
function firstSentence(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  const end = one.search(/\.(\s|$)/);
  return end > 0 ? one.slice(0, end + 1) : one;
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

function contextBlock(ctx: AgentContext): string {
  const out: string[] = [];
  if (ctx.book) {
    const b = ctx.book;
    out.push(`Open book: "${b.title}" book_id=${b.book_id} narrator voice_id=${b.narrator_voice_id ?? "none"}`);
    out.push("Chapters:");
    for (const c of b.chapters) {
      out.push(`- chapter_id=${c.chapter_id} story_id=${c.story_id} "${c.title}" (${c.voiced}/${c.paragraphs} voiced)`);
    }
    out.push(
      b.characters.length
        ? `Characters: ${b.characters.map((c) => `${c.name} (voice_id=${c.voice_id ?? "none"})`).join("; ")}`
        : "Characters: none yet",
    );
  }
  if (ctx.chapter) {
    out.push(`Open chapter: "${ctx.chapter.title}" chapter_id=${ctx.chapter.chapter_id}`);
    out.push("Its paragraphs (a paragraph is also a line of the chapter's story, so line_id=paragraph_id):");
    for (const p of ctx.chapter.paragraphs) {
      const selected = ctx.selected_ids.includes(p.paragraph_id) ? " [selected]" : "";
      out.push(`- paragraph_id=${p.paragraph_id}${selected} ${p.status}: ${clip(p.text, 90)}`);
    }
  }
  out.push(
    ctx.voices.length
      ? `Voices: ${ctx.voices.map((v) => `${v.name} (voice_id=${v.voice_id})`).join("; ")}`
      : "Voices: none saved",
  );
  return out.join("\n");
}

export function buildAgentMessages(
  instruction: string,
  history: { role: "user" | "assistant"; content: string }[],
  tools: AgentTool[],
  ctx: AgentContext,
): ChatMessage[] {
  const catalogue = tools.map((t) => `- ${signature(t)}: ${firstSentence(t.description)}`).join("\n");
  const system = [
    "You are Mirli's assistant, working on the audiobook the person has open.",
    "You can do anything these tools do. Answer with ONE JSON object and nothing else:",
    '{"reply": "<one or two plain sentences to the person>", "calls": [{"tool": "<tool name>", "arguments": {...}}]}',
    "Rules:",
    "- Use only ids that appear in the context below. Never invent an id.",
    "- A question gets an answer in reply and no calls. Only add calls when asked to change or make something.",
    "- At most 6 calls, in the order they should run. The person accepts them before anything runs.",
    "- reply says what the calls will do, in the person's words, not tool names.",
    "",
    "Tools:",
    catalogue,
  ].join("\n");
  const recent = history.slice(-6).map((m) => ({ role: m.role, content: clip(m.content, 600) }));
  return [
    { role: "system", content: system },
    ...recent,
    { role: "user", content: `${contextBlock(ctx)}\n\nInstruction: ${instruction}` },
  ];
}

/* ----------------------------------------------------------------- parse */

const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi;

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
 * Dropping rather than repairing, as in `studio.ts`: a call to an unknown
 * tool or naming an unknown chapter is the model having invented something,
 * and the honest response is not to run it. The tool still validates every
 * argument's type and range itself when it runs.
 */
export function validateCalls(
  raw: unknown,
  tools: AgentTool[],
  ctx: AgentContext,
): { calls: (AgentCall & { risk: AgentRisk })[]; dropped: AgentPlan["dropped"] } {
  const byName = new Map(tools.map((t) => [t.name, t]));
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
      dropped.push({ tool: name || "(none)", reason: "no such tool" });
      continue;
    }
    const given = rec.arguments ?? rec.args ?? rec.input ?? {};
    if (!given || typeof given !== "object" || Array.isArray(given)) {
      dropped.push({ tool: name, reason: "arguments were not an object" });
      continue;
    }
    const props = tool.inputSchema.properties ?? {};
    const args: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
      if (key in props && value !== undefined) args[key] = value;
    }
    const missing = (tool.inputSchema.required ?? []).filter((k) => !(k in args));
    if (missing.length) {
      dropped.push({ tool: name, reason: `missing ${missing.join(", ")}` });
      continue;
    }
    const unknown = Object.entries(args).find(
      ([key, value]) => ids[key] !== undefined && typeof value === "string" && !ids[key]!.has(value),
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
    calls.push({ tool: name, arguments: args, risk: riskOf(name) });
  }
  return { calls, dropped };
}

export function parseAgentPlan(text: string, tools: AgentTool[], ctx: AgentContext): AgentPlan {
  const obj = parseJsonObject(text);
  if (!obj) {
    // Not JSON at all: the model answered in prose. That is a reply.
    const plain = text.replace(THINK_BLOCK_RE, "").trim();
    return { reply: plain, calls: [], dropped: [] };
  }
  const reply = typeof obj.reply === "string" ? obj.reply.trim() : typeof obj.summary === "string" ? obj.summary.trim() : "";
  const { calls, dropped } = validateCalls(obj.calls ?? obj.tool_calls ?? obj.actions, tools, ctx);
  return { reply, calls, dropped };
}
