/**
 * The in-app assistant's agent routes: plan with the MCP toolkit, then run
 * what the person accepts.
 *
 * `POST /api/agent/plan` turns an instruction into tool calls (see
 * `llm/agent.ts`). It builds what the model is shown from the server's own
 * state, given only the ids of what is open, so the plan is written against
 * the book as it is now.
 *
 * `POST /api/agent/run` runs one accepted call through the app's own MCP
 * server (`mcp/local-client.ts`): the same tool an outside agent would call,
 * logged under the "Mirli assistant" client. Where the change has an
 * inverse that MCP can express, the answer carries it as `undo`, worked out
 * from the state just before the call, so the page can offer Undo.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { HttpError } from "./helpers.js";
import type { AgentCall, AgentContext } from "../llm/agent.js";
import { audiobooks } from "../audiobook/service.js";
import { call, getAudiobook } from "../mcp/audiobook.js";
import { callLocalTool, localTools } from "../mcp/local-client.js";
import type { MirliService } from "../service.js";

const planSchema = z.object({
  instruction: z.string().trim().min(1).max(2000),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(60)
    .default([]),
  scope: z.object({
    book_id: z.string().min(1),
    chapter_id: z.string().nullish(),
    selected_ids: z.array(z.string()).max(500).default([]),
  }),
});

const runSchema = z.object({
  tool: z.string().regex(/^soundbox\.[a-z_]+$/, "tool must be a soundbox.* tool name"),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

/** How many of the open chapter's paragraphs the model is shown. Enough to
 *  find "the first paragraph" or "the line about the fog"; a whole novel's
 *  chapter would not fit a small model's context. */
const PARAGRAPHS_SHOWN = 40;

interface BookView {
  book_id: string;
  title: string;
  settings?: { narrator_voice_id?: string | null };
  chapters: {
    chapter_id: string;
    story_id: string;
    title: string;
    paragraphs?: number;
    voiced?: number;
  }[];
  characters: { character_id: string; name: string; voice_id: string | null; model_id?: string | null }[];
  paragraphs?: {
    paragraph_id: string;
    text: string;
    character_id: string | null;
    status: string;
    is_heading?: boolean;
  }[];
}

async function contextFor(
  svc: MirliService,
  scope: z.infer<typeof planSchema>["scope"],
): Promise<AgentContext> {
  let view: BookView;
  try {
    view = (await getAudiobook(svc, {
      book_id: scope.book_id,
      chapter_id: scope.chapter_id ?? undefined,
      limit: PARAGRAPHS_SHOWN,
    })) as unknown as BookView;
  } catch (err) {
    throw new HttpError(404, err instanceof Error ? err.message : "Book not found");
  }
  const chapter = scope.chapter_id ? view.chapters.find((c) => c.chapter_id === scope.chapter_id) : undefined;
  return {
    book: {
      book_id: view.book_id,
      title: view.title,
      narrator_voice_id: view.settings?.narrator_voice_id ?? null,
      chapters: view.chapters.map((c) => ({
        chapter_id: c.chapter_id,
        story_id: c.story_id,
        title: c.title,
        paragraphs: c.paragraphs ?? 0,
        voiced: c.voiced ?? 0,
      })),
      characters: view.characters.map((c) => ({
        character_id: c.character_id,
        name: c.name,
        voice_id: c.voice_id,
      })),
    },
    chapter: chapter
      ? {
          chapter_id: chapter.chapter_id,
          story_id: chapter.story_id,
          title: chapter.title,
          paragraphs: (view.paragraphs ?? []).map((p) => ({
            paragraph_id: p.paragraph_id,
            text: p.text,
            character_id: p.character_id,
            status: p.status,
            is_heading: p.is_heading ?? false,
          })),
        }
      : null,
    selected_ids: scope.selected_ids,
    voices: svc.listVoices().map((v) => ({ voice_id: v.id, name: v.name })),
  };
}

/* ----------------------------------------------------------------- undo */

type Inverse = (result: unknown) => AgentCall[] | null;

const MIX_FIELDS = ["name", "muted", "soloed", "gain_db"] as const;
const LINE_FIELDS = [
  "text",
  "speaker",
  "voice_id",
  "track_index",
  "start_s",
  "muted",
  "gain_db",
  "duration_s",
  "trim_start_s",
] as const;

/**
 * The call that puts things back, worked out before `tool` runs. Null when
 * MCP has no inverse for it (there is no tool to delete a pronunciation or
 * an audiobook, say), and the page then offers no Undo rather than one that
 * would not work.
 */
async function inverseFor(
  svc: MirliService,
  tool: string,
  args: Record<string, unknown>,
): Promise<Inverse> {
  const none: Inverse = () => null;
  switch (tool) {
    case "soundbox.set_character_voice": {
      const bookId = String(args.book_id ?? "");
      const who = String(args.character ?? "").trim();
      let view: BookView;
      try {
        view = (await getAudiobook(svc, { book_id: bookId })) as unknown as BookView;
      } catch {
        return none;
      }
      if (who.toLowerCase() === "narrator") {
        const was = view.settings?.narrator_voice_id ?? null;
        return () => [{ tool, arguments: { book_id: bookId, character: "narrator", voice_id: was } }];
      }
      const match =
        view.characters.find((c) => c.character_id === who) ??
        view.characters.find((c) => c.name.toLowerCase() === who.toLowerCase());
      if (!match) return none; // created by the call; MCP cannot remove a character
      const back: Record<string, unknown> = { book_id: bookId, character: match.character_id, voice_id: match.voice_id };
      if (args.model_id !== undefined) back.model_id = match.model_id ?? null;
      return () => [{ tool, arguments: back }];
    }
    case "soundbox.mix_track": {
      const storyId = String(args.story_id ?? "");
      const index = Number(args.track_index);
      const row = svc.listTracks(storyId).find((t) => t.track_index === index);
      const was = { name: row?.name ?? null, muted: row?.muted ?? false, soloed: row?.soloed ?? false, gain_db: row?.gain_db ?? 0 };
      const back: Record<string, unknown> = { story_id: storyId, track_index: index };
      for (const f of MIX_FIELDS) if (args[f] !== undefined) back[f] = was[f];
      return () => [{ tool, arguments: back }];
    }
    case "soundbox.update_line": {
      const seg = svc.getSegment(String(args.line_id ?? ""));
      if (!seg || args.delivery !== undefined) return none;
      const back: Record<string, unknown> = { line_id: seg.id };
      for (const f of LINE_FIELDS) if (args[f] !== undefined) back[f] = seg[f] ?? null;
      return () => [{ tool, arguments: back }];
    }
    case "soundbox.add_device":
      return (result) => {
        const device = (result as { device?: unknown } | null)?.device;
        return typeof device === "string"
          ? [{
              tool: "soundbox.remove_device",
              arguments: { story_id: args.story_id, track_index: args.track_index, device },
            }]
          : null;
      };
    case "soundbox.set_device": {
      const storyId = String(args.story_id ?? "");
      const index = Number(args.track_index);
      const row = svc.listTracks(storyId).find((t) => t.track_index === index);
      const device = row?.devices.find((d) => d.id === args.device);
      if (!device) return none;
      return () => [{
        tool,
        arguments: { story_id: storyId, track_index: index, device: device.id, params: device.params, bypassed: device.bypassed },
      }];
    }
    case "soundbox.edit_paragraph": {
      const p = audiobooks(svc).getParagraph(String(args.paragraph_id ?? ""));
      if (!p) return none;
      const back: Record<string, unknown> = { book_id: args.book_id, paragraph_id: p.id };
      if (args.text !== undefined) back.text = p.text;
      if (args.character !== undefined) back.character = p.character_id ?? "narrator";
      if (args.locked !== undefined) back.locked = p.locked;
      if (args.is_heading !== undefined) back.is_heading = p.is_heading;
      return () => [{ tool, arguments: back }];
    }
    case "soundbox.cast_paragraphs":
    case "soundbox.lock_paragraphs": {
      // Grouped by what each paragraph was, one call per group.
      const ids = Array.isArray(args.paragraph_ids) ? args.paragraph_ids.map(String) : [];
      const field = tool === "soundbox.cast_paragraphs" ? "character" : "locked";
      const groups = new Map<string, string[]>();
      for (const id of ids) {
        const p = audiobooks(svc).getParagraph(id);
        if (!p) return none;
        const was = field === "character" ? (p.character_id ?? "narrator") : String(p.locked);
        groups.set(was, [...(groups.get(was) ?? []), id]);
      }
      return () =>
        [...groups].map(([was, paragraph_ids]) => ({
          tool,
          arguments: { book_id: args.book_id, paragraph_ids, [field]: field === "locked" ? was === "true" : was },
        }));
    }
    case "soundbox.split_paragraph":
      return (result) => {
        const first = (result as { first?: { paragraph_id?: string } } | null)?.first?.paragraph_id;
        return first ? [{ tool: "soundbox.merge_paragraphs", arguments: { book_id: args.book_id, paragraph_id: first } }] : null;
      };
    case "soundbox.merge_paragraphs":
      return (result) => {
        const at = (result as { split_at?: number } | null)?.split_at;
        return typeof at === "number" && at > 0
          ? [{ tool: "soundbox.split_paragraph", arguments: { book_id: args.book_id, paragraph_id: args.paragraph_id, at } }]
          : null;
      };
    case "soundbox.find_replace": {
      if (args.dry_run) return none;
      // What it would change, and what those paragraphs say now.
      let changed: { segment_id: string }[];
      try {
        const dry = await call<{ changed: { segment_id: string }[] }>(
          svc,
          "POST",
          `/api/audiobooks/${encodeURIComponent(String(args.book_id))}/replace`,
          { ...args, dry_run: true },
        );
        changed = dry.changed;
      } catch {
        return none;
      }
      const before = changed.flatMap((c) => {
        const p = audiobooks(svc).getParagraph(c.segment_id);
        return p ? [{ id: p.id, text: p.text }] : [];
      });
      if (before.length === 0 || before.length > 200) return none;
      return () =>
        before.map((b) => ({
          tool: "soundbox.edit_paragraph",
          arguments: { book_id: args.book_id, paragraph_id: b.id, text: b.text },
        }));
    }
    case "soundbox.add_chapter":
      return (result) => {
        const id = (result as { chapter_id?: string } | null)?.chapter_id;
        return id ? [{ tool: "soundbox.delete_chapter", arguments: { book_id: args.book_id, chapter_id: id } }] : null;
      };
    case "soundbox.edit_chapter": {
      const c = audiobooks(svc).getChapter(String(args.chapter_id ?? ""));
      if (!c) return none;
      const back: Record<string, unknown> = { book_id: args.book_id, chapter_id: c.id };
      if (args.title !== undefined) back.title = c.title;
      if (args.kind !== undefined) back.kind = c.kind;
      if (args.included !== undefined) back.included = c.included;
      return () => [{ tool, arguments: back }];
    }
    case "soundbox.move_chapter": {
      const c = audiobooks(svc).getChapter(String(args.chapter_id ?? ""));
      if (!c) return none;
      return () => [{ tool, arguments: { book_id: args.book_id, chapter_id: c.id, position: c.position } }];
    }
    default:
      return none;
  }
}

/* --------------------------------------------------------------- routes */

export function registerAgent(app: FastifyInstance, svc: MirliService): void {
  app.post("/api/agent/plan", async (request) => {
    const req = planSchema.parse(request.body ?? {});
    const [tools, context] = await Promise.all([localTools(svc), contextFor(svc, req.scope)]);
    return await svc.llm.agentPlan(req.instruction, req.messages, tools, context);
  });

  app.post("/api/agent/run", async (request) => {
    const req = runSchema.parse(request.body ?? {});
    // A book's own text reaches the model, so a manuscript could talk it
    // into proposing a read of some other file. A server that may not touch
    // its own disk (sandboxed, see capabilities.ts) refuses that here.
    if (req.tool === "soundbox.import_manuscript" && req.arguments.path && !svc.capabilities.filesystem) {
      throw new HttpError(403, "This server does not read files from its own disk. Paste the text or give a web address.");
    }
    const inverse = await inverseFor(svc, req.tool, req.arguments);
    const result = await callLocalTool(svc, req.tool, req.arguments);
    if (result.isError) throw new HttpError(422, result.text || `${req.tool} failed`);
    return { result: result.data ?? result.text, undo: inverse(result.data) };
  });
}
