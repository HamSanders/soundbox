/**
 * Asking the open studio, from an agent.
 *
 * The MCP story tools edit the saved story: a line, a track, a rack. That
 * covers a lot, but not the studio as a person is looking at it — where the
 * playhead is, what is selected, which panels are open — and not the
 * command bar's vocabulary, which says "every clip whose label says vocal" in
 * one action and can generate a take straight onto a lane.
 *
 * Those live in the browser, so this asks the browser. A mounted studio holds
 * its story's event stream open with `?answer=1`; `StoryHub.ask` sends a
 * request down it and the page posts its answer back. Edits go through the
 * studio's own handlers (`applyStudioActions` in `routes/studio.tsx`), so an
 * agent's edit lands on the undo stack exactly like a click — the property
 * the in-app planner was built around, now available to any MCP client.
 *
 * Every action is still checked here first, by the same `validateActions`
 * the in-app planner uses, against a context fetched from the studio a moment
 * before. An id the agent invented is dropped, never sent.
 */

import { type StudioAction, type StudioContext, validateActions } from "./llm/studio.js";
import { studioContextSchema } from "./schemas.js";
import { StudioNotOpenError } from "./story-hub.js";
import type { MirliService } from "./service.js";

/**
 * Which story an agent means.
 *
 * Named, it must have a studio open. Unnamed, there must be exactly one open,
 * which is the common case — a person with one studio in front of them
 * saying "tidy this up" — and anything else is answered with the list so the
 * agent can ask rather than guess.
 */
export function resolveStudio(svc: MirliService, storyId?: string | null): string {
  const open = svc.stories.openStudios();
  if (storyId) {
    if (svc.getStory(storyId) === null) throw new Error("No story with id " + storyId);
    if (!open.includes(storyId)) {
      throw new StudioNotOpenError(
        `Story ${storyId} is not open in a studio. Ask the user to open it ` +
          "(soundbox.open_in_studio or the story tools return a link), or use " +
          "the story tools, which work on the saved story without a studio.",
      );
    }
    return storyId;
  }
  if (open.length === 1) return open[0]!;
  if (open.length === 0) {
    throw new StudioNotOpenError(
      "No studio is open in Mirli. Ask the user to open one, or work on a saved " +
        "story with the story tools (soundbox.list_stories, soundbox.get_story).",
    );
  }
  const titles = open
    .map((id) => `${id} (${svc.getStory(id)?.title ?? "untitled"})`)
    .join(", ");
  throw new StudioNotOpenError(
    `${open.length} studios are open: ${titles}. Pass story_id to say which.`,
  );
}

/** The open studio's live state, checked against the same schema the command
 *  bar's requests are, so a page that sent something odd fails loudly here. */
export async function liveContext(svc: MirliService, storyId: string): Promise<StudioContext> {
  const raw = await svc.stories.ask(storyId, "context");
  const parsed = studioContextSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The studio answered with a context this server cannot read.");
  }
  return parsed.data;
}

export interface ApplyOutcome {
  /** What was sent to the studio, one concrete action per clip (selectors
   *  expanded). */
  applied: StudioAction[];
  /** Actions that referred to nothing real, or were malformed. */
  dropped: number;
  /** Deletes held back because `allow_delete` was not set. */
  held_deletes: number;
}

/**
 * Validate a plan against the live studio and, if anything survives, have the
 * studio apply it.
 *
 * Deletes are held unless asked for in so many words. Undo covers them, but
 * an agent should have had to mean it — the same reason the in-app chat
 * waits for a click before deleting.
 */
export async function applyToStudio(
  svc: MirliService,
  storyId: string,
  rawActions: unknown[],
  options: { summary?: string | null; allowDelete?: boolean } = {},
): Promise<ApplyOutcome> {
  const ctx = await liveContext(svc, storyId);
  const { actions, dropped } = validateActions(rawActions, ctx);
  const allowed = options.allowDelete
    ? actions
    : actions.filter((a) => a.type !== "delete_clip");
  const held = actions.length - allowed.length;
  if (allowed.length > 0) {
    await svc.stories.ask(storyId, "apply", {
      actions: allowed,
      summary: options.summary?.trim() || "",
    });
  }
  return { applied: allowed, dropped, held_deletes: held };
}

/**
 * The action vocabulary, as an agent reads it in the tool description. Kept
 * beside the code that validates it so the two are edited together.
 */
export const STUDIO_ACTIONS_HELP = [
  "Each action is an object with a `type`:",
  '  {"type":"set_track","track_index":N,"muted":bool,"soloed":bool,"gain_db":N}',
  '  {"type":"rename_track","track_index":N,"name":"..."}',
  '  {"type":"move_clip","clip_id":"...","start_s":N,"track_index":N}',
  '  {"type":"set_clip","clip_id":"...","muted":bool,"text":"...","speaker":"...","voice_id":"...",',
  '     "gain_db":N,"fade_in_s":N,"fade_out_s":N,"duration_s":N,"trim_start_s":N}',
  '  {"type":"delete_clip","clip_id":"..."}   (held unless allow_delete is true)',
  '  {"type":"add_clip","track_index":N,"start_s":N,"text":"..."}',
  '  {"type":"add_lines","lines":[{"text":"...","speaker":"...","voice_id":"..."},{"kind":"pause","duration_s":0.6}]}',
  '  {"type":"speak_lines","clip_ids":["..."]}',
  '  {"type":"add_device"|"remove_device","track_index":N,"kind":"reverb"}',
  '  {"type":"set_device","track_index":N,"kind":"reverb","params":{"wet":0.4}}',
  '  {"type":"generate_clip","track_index":N,"start_s":N,"prompt":"..."}',
  '  {"type":"show_panel","panel":"script|insert|library|history|sample|devices","open":bool}',
  '  {"type":"start_recording"}',
  "Any clip action takes `select` instead of `clip_id` to mean many clips: " +
    '{"scope":"all"|"selected"}, {"from_track":N}, {"matching":"vocal"} (label ' +
    "contains), combined with AND.",
  "Use only track numbers, clip ids and voice ids from soundbox.studio_context; " +
    "anything else is dropped. add_clip may name the next free lane; " +
    "generate_clip with an unknown lane goes on the next free one.",
].join("\n");
