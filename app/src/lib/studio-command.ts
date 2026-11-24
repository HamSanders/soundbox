/**
 * The client half of the studio command bar: ask the server for a plan, and
 * put a plan into words.
 *
 * Deliberately its own module rather than a method on `api.ts`. What comes
 * back is not a resource — it is a list of edits the page is about to perform
 * on itself, and the describing of them belongs next to the asking. Keeping
 * the shape here also means the server's `llm/studio.ts` and this file are the
 * only two places that know the action vocabulary.
 */

import { IS_MOCK } from "./api";

/** A voice the assistant may cast a written line to. Mirrors the subset of
 *  `Voice` the planner needs — it picks an id, it does not play anything. */
export interface StudioVoice {
  id: string;
  name: string;
  kind: "clone" | "builtin";
  notes?: string | null;
}

export interface StudioContext {
  tracks: {
    track_index: number;
    name: string | null;
    muted: boolean;
    soloed: boolean;
    /** Device kinds on the lane's rack, in chain order. */
    devices?: string[];
  }[];
  clips: { id: string; track_index: number; start_s: number; duration_s: number; label: string }[];
  playhead_s: number;
  selected_ids: string[];
  voices: StudioVoice[];
}

export type StudioAction =
  | { type: "rename_track"; track_index: number; name: string }
  | { type: "set_track"; track_index: number; muted?: boolean; soloed?: boolean; gain_db?: number }
  | { type: "move_clip"; clip_id: string; start_s?: number; track_index?: number }
  | {
      type: "set_clip";
      clip_id: string;
      muted?: boolean;
      text?: string;
      /** Recasting a line that already exists. */
      speaker?: string;
      voice_id?: string;
      /** Mixing, all of it already in `SegmentPatch`. The server clamps to
       *  the mixer's ranges; these arrive per clip, a bulk selector having
       *  been expanded there. */
      gain_db?: number;
      fade_in_s?: number;
      fade_out_s?: number;
      duration_s?: number;
      trim_start_s?: number;
    }
  | { type: "delete_clip"; clip_id: string }
  | { type: "add_clip"; track_index: number; start_s: number; text: string }
  | {
      type: "add_lines";
      lines: {
        text: string;
        speaker?: string;
        voice_id?: string;
        kind?: "line" | "pause";
        duration_s?: number;
        track_index?: number;
      }[];
    }
  | { type: "speak_lines"; clip_ids: string[] }
  | { type: "add_device"; track_index: number; kind: string }
  | { type: "remove_device"; track_index: number; kind: string }
  | { type: "set_device"; track_index: number; kind: string; params: Record<string, number> }
  | { type: "generate_clip"; track_index: number; start_s: number; prompt: string }
  | { type: "show_panel"; panel: string; open: boolean }
  | { type: "start_recording" };

export interface StudioPlan {
  /** "generate" means the text described audio to make rather than an edit —
   *  the server's call, see `llm/studio.ts`. Optional so an older server
   *  still parses. */
  intent?: "edit" | "generate";
  actions: StudioAction[];
  summary: string;
  /** How many suggestions were thrown away for naming something that is not
   *  on this timeline — surfaced, not swallowed. */
  dropped: number;
  /**
   * Which planner the request was routed to, from the classifier's own call.
   *
   * The visible half of "show me your thinking". Real chain-of-thought is not
   * available here — `llm/client.ts` disables the model's thinking mode on
   * purpose, because an unmuzzled Qwen3 spends its whole context reasoning
   * and returns nothing — but the routing decision is genuine reasoning, it
   * happens on every request, and it is the thing that explains a surprising
   * answer. Optional so an older server still parses.
   */
  classified?: "edit" | "generate_clip" | "compose" | "script" | "panel";
}

export function isDestructive(action: StudioAction): boolean {
  return action.type === "delete_clip";
}

/**
 * Actions worth asking about before they run.
 *
 * Deleting was the original case, on the grounds that undo covers it but
 * "undo covers it" is a worse answer than "we asked". Making things belongs
 * in the same bucket for a different reason: a script or a render is work the
 * person is about to read or wait for, and having four lines appear because
 * a sentence was read as an instruction is startling in a way that muting a
 * track is not. Moving, muting and mixing stay immediate — they are glanceable
 * and one Ctrl+Z away.
 */
export function needsConfirmation(action: StudioAction): boolean {
  return (
    isDestructive(action) ||
    action.type === "add_lines" ||
    action.type === "add_clip" ||
    action.type === "generate_clip" ||
    action.type === "speak_lines"
  );
}

/**
 * The panel an action is about, so the studio can show its work.
 *
 * An edit applied to a panel nobody has open is indistinguishable from an
 * edit that did not happen: the reply says four lines were written and the
 * screen shows a timeline. Naming the artifact lets the page open it as the
 * change lands, and lets a card in the thread be clicked to go back to it.
 */
export function panelForAction(action: StudioAction): string | null {
  switch (action.type) {
    case "add_lines":
    case "speak_lines":
      return "script";
    case "set_clip":
      // Words belong to the script; gain and fades belong to the arrangement.
      return action.text !== undefined || action.voice_id !== undefined ? "script" : "timeline";
    case "add_device":
    case "remove_device":
    case "set_device":
      return "devices";
    case "generate_clip":
      return "history";
    case "show_panel":
      // Only an opened panel is "the work" to show. Returning the panel for a
      // hide made the apply path reopen what it had just closed, so "hide the
      // library" never stuck.
      return action.open ? action.panel : null;
    case "move_clip":
    case "delete_clip":
    case "add_clip":
    case "rename_track":
    case "set_track":
      return "timeline";
    default:
      return null;
  }
}

/**
 * The mock's planner: enough grammar to exercise the preview and the apply
 * path without a model — "mute 1 and 3", "rename track 0 to Kick", "delete
 * the selected clips". Anything else is a description, and says so.
 */
function mockStudioPlan(instruction: string, ctx: StudioContext): StudioPlan {
  const text = instruction.toLowerCase();
  const nums = [...text.matchAll(/\b(\d+)\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => ctx.tracks.some((t) => t.track_index === n));
  const actions: StudioAction[] = [];
  const rename = /rename (?:track )?(\d+) (?:to|as) (.+)/.exec(instruction);
  if (rename) {
    actions.push({ type: "rename_track", track_index: Number(rename[1]), name: rename[2]!.trim() });
  } else if (/^(un)?mute\b/.test(text)) {
    for (const n of nums) actions.push({ type: "set_track", track_index: n, muted: !text.startsWith("un") });
  } else if (/^(un)?solo\b/.test(text)) {
    for (const n of nums) actions.push({ type: "set_track", track_index: n, soloed: !text.startsWith("un") });
  } else if (/^delete\b/.test(text)) {
    for (const id of ctx.selected_ids) actions.push({ type: "delete_clip", clip_id: id });
  } else if (/^name (all )?(the )?tracks/.test(text)) {
    for (const t of ctx.tracks) {
      const clip = ctx.clips.find((c) => c.track_index === t.track_index);
      if (clip) actions.push({ type: "rename_track", track_index: t.track_index, name: clip.label.split(" ").slice(0, 2).join(" ") });
    }
  } else if (/^(read|speak|voice) /.test(text)) {
    const ids = ctx.selected_ids.length ? ctx.selected_ids : ctx.clips.map((c) => c.id);
    if (ids.length) actions.push({ type: "speak_lines", clip_ids: ids });
  } else if (/\b(write|script|dialogue|narration|scene)\b/.test(text)) {
    // A canned two-hander with a beat in it: enough to exercise casting,
    // pauses and the append order without a model running.
    const cast = ctx.voices.slice(0, 2);
    const second = cast[1] ?? cast[0];
    actions.push({
      type: "add_lines",
      lines: [
        {
          text: `Mock line one about ${instruction.trim().slice(0, 40)}.`,
          kind: "line",
          speaker: cast[0]?.name ?? "Narrator",
          ...(cast[0] ? { voice_id: cast[0].id } : {}),
        },
        { text: "", kind: "pause", duration_s: 0.6 },
        {
          text: "Mock line two, answering the first.",
          kind: "line",
          speaker: second?.name ?? "Narrator",
          ...(second ? { voice_id: second.id } : {}),
        },
      ],
    });
  }
  return {
    intent: actions.length ? "edit" : "generate",
    classified: actions.some((a) => a.type === "add_lines")
      ? "script"
      : actions.length
        ? "edit"
        : "compose",
    actions,
    summary: actions.length ? `Mock: ${actions.length} edit${actions.length === 1 ? "" : "s"} from “${instruction}”.` : "",
    dropped: 0,
  };
}

export async function runStudioCommand(
  instruction: string,
  context: StudioContext,
): Promise<StudioPlan> {
  if (IS_MOCK) return mockStudioPlan(instruction, context);
  const res = await fetch("/api/studio/command", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ instruction, context }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `The studio assistant returned HTTP ${res.status}.`);
  }
  return (await res.json()) as StudioPlan;
}

/**
 * One line of plain English per action, for the preview.
 *
 * Written against the same context the model was given so a clip is named the
 * way the user would name it. An id in a confirmation prompt tells the reader
 * nothing about whether the assistant understood them, which is the entire
 * question the preview exists to answer.
 */
export function describeAction(action: StudioAction, ctx: StudioContext): string {
  const clip = (id: string): string => {
    const found = ctx.clips.find((c) => c.id === id);
    if (!found) return id;
    const label = found.label.trim();
    return `${label ? `“${label.slice(0, 40)}”` : "clip"} on track ${found.track_index}`;
  };
  const track = (index: number): string => {
    const found = ctx.tracks.find((t) => t.track_index === index);
    return found?.name ? `track ${index} (${found.name})` : `track ${index}`;
  };
  const seconds = (value: number): string => `${value.toFixed(2)}s`;

  switch (action.type) {
    case "rename_track":
      return `Rename ${track(action.track_index)} to “${action.name}”`;
    case "set_track": {
      const parts: string[] = [];
      if (action.muted !== undefined) parts.push(action.muted ? "mute" : "unmute");
      if (action.soloed !== undefined) parts.push(action.soloed ? "solo" : "unsolo");
      if (action.gain_db !== undefined) parts.push(`set gain to ${action.gain_db} dB`);
      return `${parts.join(", ")} ${track(action.track_index)}`;
    }
    case "move_clip": {
      const where = [
        action.start_s !== undefined ? `to ${seconds(action.start_s)}` : null,
        action.track_index !== undefined ? `onto track ${action.track_index}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      return `Move ${clip(action.clip_id)} ${where}`;
    }
    case "set_clip": {
      if (action.text !== undefined) return `Rewrite ${clip(action.clip_id)} as “${action.text}”`;
      // A mixing change can carry several fields at once ("quieter and fade
      // it in"), so they are listed rather than the first one winning.
      const parts: string[] = [];
      if (action.muted !== undefined) parts.push(action.muted ? "mute" : "unmute");
      if (action.gain_db !== undefined) {
        const sign = action.gain_db > 0 ? "+" : "";
        parts.push(`set gain to ${sign}${action.gain_db} dB`);
      }
      if (action.fade_in_s !== undefined) parts.push(`fade in over ${seconds(action.fade_in_s)}`);
      if (action.fade_out_s !== undefined)
        parts.push(`fade out over ${seconds(action.fade_out_s)}`);
      if (action.duration_s !== undefined) parts.push(`play ${seconds(action.duration_s)} of it`);
      if (action.trim_start_s !== undefined)
        parts.push(`start ${seconds(action.trim_start_s)} in`);
      const what = parts.length ? parts.join(", ") : "change";
      return `${what.charAt(0).toUpperCase()}${what.slice(1)} — ${clip(action.clip_id)}`;
    }
    case "delete_clip":
      return `Delete ${clip(action.clip_id)}`;
    case "add_clip":
      return `Add “${action.text}” to track ${action.track_index} at ${seconds(action.start_s)}`;
    case "add_lines": {
      const spoken = action.lines.filter((l) => l.kind !== "pause");
      const cast = [...new Set(spoken.map((l) => l.speaker).filter(Boolean))];
      const who = cast.length ? ` for ${cast.join(", ")}` : "";
      const pauses = action.lines.length - spoken.length;
      const beats = pauses ? ` and ${pauses} pause${pauses === 1 ? "" : "s"}` : "";
      return `Write ${spoken.length} line${spoken.length === 1 ? "" : "s"}${who}${beats}`;
    }
    case "speak_lines":
      return `Read ${action.clip_ids.length} line${action.clip_ids.length === 1 ? "" : "s"} aloud`;
    case "add_device":
      return `Add ${action.kind} to ${track(action.track_index)}`;
    case "remove_device":
      return `Remove ${action.kind} from ${track(action.track_index)}`;
    case "set_device": {
      const knobs = Object.entries(action.params)
        .map(([key, value]) => `${key} ${value}`)
        .join(", ");
      return `Set ${action.kind} on ${track(action.track_index)}: ${knobs}`;
    }
    case "generate_clip":
      return (
        `Generate “${action.prompt}” onto track ${action.track_index} ` +
        `at ${seconds(action.start_s)}`
      );
    case "show_panel": {
      // The panel is called Prompt on screen and `insert` in the code; the
      // preview is for the person reading it, so it uses their word.
      const label = action.panel === "insert" ? "Prompt" : action.panel;
      return `${action.open ? "Show" : "Hide"} the ${label} panel`;
    }
    case "start_recording":
      return "Start recording onto a new track";
  }
}
