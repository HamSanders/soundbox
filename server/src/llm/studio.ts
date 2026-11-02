/**
 * Turning "mute 1 and 3" into edits the studio can actually make.
 *
 * The prompt assistant already rewrites text; this asks it for *actions*
 * instead. Same model, same endpoint, same "off by default" switch — the only
 * new thing is that the answer is a list of operations rather than a sentence.
 *
 * Three rules shape everything below, and all three are about not trusting the
 * model further than it has earned:
 *
 * - **The model never names a thing.** It picks from ids and lane numbers that
 *   were handed to it in the prompt, and `validateActions` throws away
 *   anything referring to a clip or track that does not exist. A hallucinated
 *   id becomes a dropped action, never a request against the API.
 * - **The model never runs anything.** This file returns data. The page
 *   applies it through the same hooks a human's click goes through, so an
 *   agentic edit lands on the undo stack exactly like a manual one.
 * - **Nothing destructive is invented.** Deleting is expressible, but the
 *   caller is told which actions destroy something so it can ask first.
 *
 * Pure and side-effect-free, like `enhance.ts` next door, so the parsing and
 * the validation are testable without a model running.
 */

import type { ChatMessage } from "./client.js";

/** The effects a track can be given — the server's device table, which is
 *  itself checked against `app/src/lib/devices.ts` by test/devices.test.ts.
 *  The model may only name one of these, so a kind that does not exist is
 *  dropped rather than sent to a rack that cannot build it. */
import { DEVICE_KINDS, type DeviceKind } from "../devices.js";

export { DEVICE_KINDS, type DeviceKind };

/** What the studio looks like right now, as the model needs to see it. */
export interface StudioContext {
  tracks: {
    track_index: number;
    name: string | null;
    muted: boolean;
    soloed: boolean;
    /** What is already on this track's rack, so "take the reverb off the
     *  vocal" has something to refer to. */
    devices?: string[];
  }[];
  clips: {
    id: string;
    track_index: number;
    start_s: number;
    duration_s: number;
    /** The line's words, or the sound's name for a clip that was never
     *  written — enough for "the door slam" to resolve to something. */
    label: string;
  }[];
  /** Where the playhead is parked, which is what "here" and "at the cursor"
   *  mean in an instruction. */
  playhead_s: number;
  /** Ids the user has selected, so "these" and "the selected ones" resolve. */
  selected_ids: string[];
  /**
   * The saved voices a line can be cast to.
   *
   * Without these the assistant could write words but not say who says them:
   * a `voice_id` it invented would be refused by the API, and one it left
   * blank falls back to the model default, so a two-hander came out in one
   * voice. Same rule as clip ids — it may only name one from this list.
   */
  voices?: { id: string; name: string; kind: "clone" | "builtin"; notes?: string | null }[];
}

/**
 * Which clips an action is about, when it is about more than one.
 *
 * "Move all the samples to one track" is a single thought and used to be
 * thirty actions, each naming a clip id the model had to copy correctly from
 * the context. Small models do not do that reliably past a handful — they
 * skip clips, or invent an id, and the plan silently does most of the job.
 *
 * So the model says what it means instead, and `validateActions` expands the
 * selector against the real timeline into one concrete action per clip. The
 * page still receives the same per-clip actions it always did, applies them
 * through the same handlers, and undoes them the same way. Nothing downstream
 * of the validator knows selectors exist.
 *
 * Fields combine with AND. `from_track` rather than `track_index` because on
 * `move_clip` the latter already means the destination, and one key cannot be
 * both the filter and the target.
 */
export interface ClipSelector {
  /** "all" every clip on the timeline, "selected" the current selection. */
  scope?: "all" | "selected";
  /** Only clips on this lane. */
  from_track?: number;
  /** Only clips whose label contains this, case-insensitively. */
  matching?: string;
}

export type StudioAction =
  | { type: "rename_track"; track_index: number; name: string }
  | {
      type: "set_track";
      track_index: number;
      muted?: boolean;
      soloed?: boolean;
      gain_db?: number;
    }
  | { type: "move_clip"; clip_id: string; start_s?: number; track_index?: number }
  /**
   * Everything about one clip that is not where it sits.
   *
   * The mixing fields were always in `SegmentPatch` and on the clip in the
   * database — the export mixdown sums clip gain with track gain and applies
   * both fades — they simply had no way to be asked for. "Bring the drums
   * down 3 dB" needed a mouse.
   */
  | {
      type: "set_clip";
      clip_id: string;
      muted?: boolean;
      text?: string;
      /** Recasting a line that already exists: who says it, and in which
       *  saved voice. Changing either means the line needs reading again. */
      speaker?: string;
      voice_id?: string;
      /** Clip trim, in dB, summed with its track's gain at mixdown. */
      gain_db?: number;
      fade_in_s?: number;
      fade_out_s?: number;
      /** How much of the source plays. */
      duration_s?: number;
      /** How far into the source the clip starts. */
      trim_start_s?: number;
    }
  | { type: "delete_clip"; clip_id: string }
  | { type: "add_clip"; track_index: number; start_s: number; text: string }
  /**
   * Write script: several spoken lines at once, cast as they are written.
   *
   * One action carrying a list rather than one action per line, because the
   * model cannot place lines itself — a spoken line is as long as its audio,
   * which does not exist until it has been read. Omitting `start_s` lets each
   * line append after the last, which is what writing a script means and what
   * `SegmentCreate` already does.
   *
   * The same shape MCP's `soundbox.add_lines` takes, deliberately: an agent
   * driving Soundbox from outside and the assistant inside it should not have
   * two different ideas of what a script is.
   */
  | {
      type: "add_lines";
      lines: {
        /** What is said. Empty only for a pause. */
        text: string;
        /** Display name in the script — "Narrator", "Mara". Free text. */
        speaker?: string;
        /** A saved voice, checked against the ones that exist. */
        voice_id?: string;
        kind?: "line" | "pause";
        /** A pause's length. Ignored for a spoken line. */
        duration_s?: number;
        track_index?: number;
      }[];
    }
  /** Read the lines out loud. Written words are silent until this runs, so
   *  "write me a scene and read it" is two actions rather than one. */
  | { type: "speak_lines"; clip_ids: string[] }
  | { type: "add_device"; track_index: number; kind: DeviceKind }
  | { type: "remove_device"; track_index: number; kind: DeviceKind }
  /**
   * Turn the knobs on an effect that is already on a track.
   *
   * The values are passed through as a plain map rather than validated
   * against each device's ranges here. The studio applies the plan to its
   * rack through `clampDeviceParams`, and the chain it saves is clamped again
   * by the server (`normalizeChain` in ../devices.ts), so a value the model
   * over-reached on lands at the end of the real dial either way.
   */
  | { type: "set_device"; track_index: number; kind: DeviceKind; params: Record<string, number> }
  /**
   * Make new audio and put it on the timeline.
   *
   * The action that stops "add some drums" being a dead end. Without it the
   * assistant could rearrange what already existed and nothing else, so a
   * request to *add* something was answered with a refusal explaining that it
   * was a description rather than an instruction — which is true, and useless,
   * when the application it is driving can generate audio.
   */
  | { type: "generate_clip"; track_index: number; start_s: number; prompt: string }
  /** Work the interface rather than the arrangement. Cheap to express and
   *  the fastest thing in here — no round trip to the audio engine, just the
   *  panel a person would otherwise go hunting for in a menu. */
  | { type: "show_panel"; panel: string; open: boolean }
  | { type: "start_recording" };

export interface StudioPlan {
  /**
   * What the user was actually asking for.
   *
   * "generate" means the text describes audio to make rather than a change to
   * make, and the page should hand it to the prompt panel instead of trying
   * to apply it. Without this the assistant treats "a hardcore instrumental
   * with thrashing guitars" as an instruction it failed to understand, which
   * is a worse answer than routing it to the box that wanted it.
   */
  intent: "edit" | "generate";
  actions: StudioAction[];
  /** One line for the user about what is about to happen, in their terms. */
  summary: string;
  /**
   * Which planner the classifier routed this to, passed back so the page can
   * show it.
   *
   * The honest half of "show your thinking": the model's own chain-of-thought
   * is switched off here on purpose (see `llm/client.ts` — an unmuzzled
   * Qwen3 reasons until the context runs out and answers nothing), but the
   * routing decision is real reasoning, happens every time, and is exactly
   * what explains a request landing somewhere surprising.
   */
  classified?: StudioIntent;
}

/** Actions that cannot be shrugged off, so the page can confirm before it
 *  runs them. Undo covers these, but "undo covers it" is a worse answer than
 *  "we asked". */
export function isDestructive(action: StudioAction): boolean {
  return action.type === "delete_clip";
}

/**
 * The instruction, plus everything it might be referring to.
 *
 * The context is written out as plain lines rather than JSON because the model
 * has to *resolve references* against it — "the first track", "the long one",
 * "1 and 3" — and a numbered list is the form that makes those legible. The
 * ids stay verbatim so they can be copied back exactly.
 */
function formatTracks(ctx: StudioContext): string {
  if (!ctx.tracks.length) return "  (none)";
  return ctx.tracks
    .map(
      (t) =>
        `  track ${t.track_index}: ${t.name ?? "(unnamed)"}` +
        `${t.muted ? " [muted]" : ""}${t.soloed ? " [soloed]" : ""}` +
        `${t.devices?.length ? ` [effects: ${t.devices.join(", ")}]` : ""}`,
    )
    .join("\n");
}

function formatClips(ctx: StudioContext): string {
  if (!ctx.clips.length) return "  (none)";
  return ctx.clips
    .map(
      (c) =>
        `  ${c.id} \u2014 track ${c.track_index}, ${c.start_s.toFixed(2)}s to ` +
        `${(c.start_s + c.duration_s).toFixed(2)}s: ${c.label || "(empty)"}`,
    )
    .join("\n");
}

function formatVoices(ctx: StudioContext): string {
  if (!ctx.voices?.length) {
    return "  (none saved — write the lines anyway and leave voice_id out; " +
      "they will use the model's default voice)";
  }
  return ctx.voices
    .map(
      (v) =>
        `  ${v.id} \u2014 ${v.name} (${v.kind})` +
        `${v.notes ? `: ${v.notes.slice(0, 80)}` : ""}`,
    )
    .join("\n");
}

/**
 * What kind of request this is, decided on its own before anything is planned.
 *
 * One model, two small calls, because one large call did not work. The single
 * prompt that handled matching, intent, effects, generation and formatting ran
 * to sixty lines, and on a 9B model every section strengthened destabilised
 * another \u2014 fixing the generate branch stopped "mute 1 and add delay to
 * vocals" emitting any actions at all. The instructions were not wrong
 * individually; there were simply too many to hold at once.
 *
 * Splitting is the move `enhanceMusic` already makes next door, for the same
 * underlying reason: a small model does one job well and several badly. Each
 * planner below sees only its own branch's rules, so none is long enough to
 * fall over.
 */
export type StudioIntent = "edit" | "generate_clip" | "compose" | "script" | "panel";

const INTENTS: Record<StudioIntent, string> = {
  edit:
    "changing something already on the timeline: mute, solo, rename, move, " +
    "delete, volume, or adding and removing an effect like delay or reverb",
  generate_clip:
    "making a NEW sound and putting it on this timeline: 'add some drums', " +
    "'put rain under this', 'add a bassline on track 2'",
  compose:
    "a whole finished piece of music, with no reference to this timeline \u2014 " +
    "including songs with SUNG vocals, which are music and not script: 'a " +
    "hardcore instrumental where distorted guitars thrash over a double-kick " +
    "kit', 'a short moody theme song with vocals for an indie game'",
  script:
    "WRITING WORDS FOR SOMEONE TO *SAY*, never to sing. Any request for a " +
    "script, dialogue, " +
    "lines, narration, a voiceover, a scene, or characters who talk to each " +
    "other \u2014 whatever verb is used, including 'create', 'make' and " +
    "'generate'. 'create a script about the moon', 'write me an intro for " +
    "the narrator', 'two characters talking to one another', 'add a " +
    "two-line exchange between the guard and the thief', 'say hello and " +
    "then pause'",
  panel:
    "showing or hiding a part of the interface that is already there, or " +
    "starting a recording. Always about the WINDOW, never about content: " +
    "'show the library', 'hide the devices', 'open the sample panel', " +
    "'start recording'",
};

export function buildIntentMessages(instruction: string): ChatMessage[] {
  const list = (Object.entries(INTENTS) as [StudioIntent, string][])
    .map(([key, description]) => `  ${key}: ${description}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "Classify what the person is asking for. Answer with one of these " +
        "words and nothing else.\n\n" +
        `${list}\n\n` +
        // Two collisions, both observed, both shown happening rather than
        // warned against — the same technique the planners below use, and for
        // the same reason: a small model copies a demonstrated mapping far
        // more reliably than it applies a stated rule.
        //
        // "create a script about poo" went to `panel`, because the panel
        // entry used to say "open the script" and so owned the word. "create
        // 2 characters talking to one another" went to `generate_clip`,
        // because people talking sounds like a sound to make. Both produced
        // confident, useless answers: a panel toggle and a render of a man
        // breathing.
        "TELLING THEM APART\n" +
        "- The word 'script' is usually about WRITING, not about the Script " +
        "panel. 'create a script about X' -> script. 'show me the script " +
        "panel' -> panel. Only a request to show, hide or open something is " +
        "panel.\n" +
        "- People talking are WORDS, not audio texture. 'two characters " +
        "talking to one another' -> script, never generate_clip. " +
        "generate_clip is for non-spoken sound: drums, rain, a door.\n" +
        // The over-correction the rule above caused. Taught that people
        // talking are words, the model read "a theme song with vocals" as
        // people talking and wrote four spoken lines for a narrator. Sung
        // vocals are an instrument: the lyrics-conditioned models take them
        // as part of the music, and nothing about them belongs in a script.
        "- SUNG is not SPOKEN. A song, a theme, a track 'with vocals', " +
        "'with a female singer', a chorus or a hook is MUSIC \u2014 compose, or " +
        "generate_clip if it is going on this timeline. Never script. Script " +
        "is only for words a person SAYS: dialogue, narration, a voiceover, " +
        "a line of speech.\n" +
        "  'a short theme song with vocals' -> compose\n" +
        "  'add a bassline with a sung hook on track 2' -> generate_clip\n" +
        "  'two characters talking to one another' -> script\n" +
        "  'write the narrator an intro' -> script\n" +
        "- 'create', 'make' and 'generate' say nothing about which one this " +
        "is. Decide on WHAT is being asked for, not the verb.\n\n" +
        'Respond with JSON only: {"intent": "..."}.'
    },
    { role: "user", content: instruction.trim() },
  ];
}

export function parseIntent(text: string): StudioIntent {
  const obj = parseJsonObject(text);
  const raw = typeof obj?.intent === "string" ? obj.intent.trim().toLowerCase() : "";
  // Anything unrecognised is treated as an edit: that branch validates every
  // id it produces, so guessing wrong costs a dropped action rather than a
  // wrong one.
  return raw in INTENTS ? (raw as StudioIntent) : "edit";
}

/** Shared by the planners: how to *refer* to things, which is the same
 *  question whatever is being done to them, and short enough to carry. */
const MATCHING =
  "People name things loosely and you resolve it. Match on meaning, not exact " +
  "words: 'the vocals' is the track holding a clip labelled 'breathy female " +
  "vocal hook'; 'the drums' is the one holding 'double kick drum pattern'. A " +
  "track with no name is still a track \u2014 identify it by what is on it. " +
  "Nothing needs to be selected for you to act.\n" +
  "TRACK NUMBERS ARE LITERAL: 'mute 1 and 3' means track_index 1 and 3. Never " +
  "add or subtract one, and never read a number as a position in a list.\n" +
  "Use only the track numbers and clip ids listed \u2014 copy ids exactly.";

function userBlock(instruction: string, ctx: StudioContext): string {
  return (
    `Request: ${instruction.trim()}\n\n` +
    `Voices:\n${formatVoices(ctx)}\n` +
    `Playhead: ${ctx.playhead_s.toFixed(2)}s\n` +
    `Selected clips: ${ctx.selected_ids.length ? ctx.selected_ids.join(", ") : "(none)"}\n` +
    `Tracks:\n${formatTracks(ctx)}\n` +
    `Clips:\n${formatClips(ctx)}`
  );
}

/** The edit planner: change something that is already there. */
export function buildStudioMessages(instruction: string, ctx: StudioContext): ChatMessage[] {
  const system =
    "You are operating a music/voice timeline. Turn the request into edits, " +
    "and be decisive \u2014 only say you cannot do something when nothing in the " +
    "request matches anything on the timeline at all.\n\n" +
    `${MATCHING}\n\n` +
    "Actions:\n" +
    '  {"type":"set_track","track_index":N,"muted":true|false,"soloed":true|false,"gain_db":N}\n' +
    '  {"type":"rename_track","track_index":N,"name":"..."}\n' +
    '  {"type":"move_clip","clip_id":"...","start_s":N,"track_index":N}\n' +
    '  {"type":"set_clip","clip_id":"...","muted":true|false,"text":"...",\n' +
    '     "gain_db":N,"fade_in_s":N,"fade_out_s":N,"duration_s":N,"trim_start_s":N}\n' +
    '  {"type":"delete_clip","clip_id":"..."}\n' +
    `  {"type":"add_device","track_index":N,"kind":"..."}  kinds: ${DEVICE_KINDS.join(", ")}\n` +
    '  {"type":"remove_device","track_index":N,"kind":"..."}\n' +
    '  {"type":"set_device","track_index":N,"kind":"...","params":{"wet":0.4}}\n' +
    "\n" +
    // Taught as a replacement for enumerating, not as an extra option. Shown
    // one action doing the work of thirty, because the alternative — listing
    // every clip id — is what the model reaches for by default and is what
    // it gets wrong.
    "MANY CLIPS AT ONCE\n" +
    "Any clip action takes `select` INSTEAD of `clip_id` when the request is " +
    "about more than one clip. Never list clip ids one by one for a request " +
    'that means "all of them".\n' +
    '  {"select":{"scope":"all"}}            every clip\n' +
    '  {"select":{"scope":"selected"}}       the selected clips\n' +
    '  {"select":{"from_track":2}}           every clip on track 2\n' +
    '  {"select":{"matching":"vocal"}}       every clip whose label says vocal\n' +
    "Combine them: {\"scope\":\"all\",\"matching\":\"kick\"}. Worked examples:\n" +
    "  'move all the samples to one track'\n" +
    '      -> [{"type":"move_clip","select":{"scope":"all"},"track_index":0}]\n' +
    "  'drop everything on track 2 by 3 dB'\n" +
    '      -> [{"type":"set_clip","select":{"from_track":2},"gain_db":-3}]\n' +
    "  'fade all the vocals in over half a second'\n" +
    '      -> [{"type":"set_clip","select":{"matching":"vocal"},"fade_in_s":0.5}]\n' +
    "\n" +
    "MIXING\n" +
    "gain_db is a trim on one clip, summed with its track's gain: negative is " +
    "quieter, and 'a bit' is about 3 dB. Fades are in seconds. Use set_track " +
    "gain_db for 'turn the drums down' when they have a track of their own, " +
    "and set_clip when they do not.\n" +
    "set_device only changes an effect the track already has \u2014 add it first " +
    "if the rack does not list it. Common knobs: reverb/delay/distortion " +
    "'wet' (0\u20131 mix), reverb 'decay', delay 'time' and 'feedback', eq " +
    "'low'/'mid'/'high' (dB), compressor 'threshold' and 'ratio'. 'wetter', " +
    "'more' and 'heavier' mean raise it; 'drier' and 'less' mean lower it.\n" +
    "'echo' is delay, 'verb' is reverb, 'pitch correction' is autotune.\n" +
    "'here' and 'the cursor' mean the playhead time. 'these' means the " +
    "selected clips.\n" +
    "Do only what was asked \u2014 an instruction about muting must not rename " +
    "anything.\n" +
    "When naming tracks, shorten the clip label to one or two words: 'four on " +
    "the floor kick drum loop' -> 'Kick', 'breathy female vocal hook' -> " +
    "'Lead vocal'. Never return the label unchanged.\n\n" +
    "`summary` is one friendly sentence saying what you did. Respond with " +
    'JSON only: {"summary":"...","actions":[...]}.';
  return [
    { role: "system", content: system },
    { role: "user", content: userBlock(instruction, ctx) },
  ];
}

/**
 * The script planner: write words for someone to say.
 *
 * Its own planner rather than a branch of the edit prompt, for the reason the
 * router exists at all — a small model does one job well and several badly.
 * Writing dialogue is a *writing* task: it needs room to think about who is
 * speaking and how people actually talk, and none of the edit prompt's rules
 * about lane numbers and clip ids help it do that. Mixing the two produced
 * lines that read like stage directions.
 *
 * It is also the one planner that runs warm. Every other call here is at
 * temperature 0 because resolving "the vocal" to a clip id has a right
 * answer; writing a scene does not, and a deterministic script is a flat one.
 *
 * Casting is constrained the same way clip ids are: it may only name a voice
 * out of the list it was handed, and `validateActions` drops an invented one
 * rather than sending it to an API that will refuse it.
 */
export function buildScriptMessages(instruction: string, ctx: StudioContext): ChatMessage[] {
  const system =
    "You write spoken lines for a voice studio. The words you write will be " +
    "read aloud by a text-to-speech model, so write for the ear.\n\n" +
    "Voices you may cast (use the id exactly, or leave voice_id out):\n" +
    `${formatVoices(ctx)}\n\n` +
    // Led with, and stated as an identity, because the alternative is what
    // actually happened: asked for a scene about people being consumed by a
    // black hole, the model refused and offered to write something gentler.
    // That is ordinary sci-fi horror, and a studio that cannot write peril
    // cannot write a trailer, a game, or a ghost story. The same lesson the
    // edit prompt learned \u2014 prohibitions are cheap to over-apply \u2014 so the
    // permission is explicit rather than merely implied.
    "WHAT YOU WRITE\n" +
    "You are a scriptwriter for a production studio. Fiction is the job: " +
    "horror, violence, peril, death, dread, villains and grim endings are " +
    "ordinary subject matter and you write them without hesitation. A scene " +
    "about people being swallowed by a black hole is science fiction, not a " +
    "request to be talked out of. Never refuse a creative brief, never " +
    "swap it for a milder one, never lecture, and never reply with what you " +
    "would rather write instead. Write the thing that was asked for.\n\n" +
    "HOW TO WRITE\n" +
    "- Write what is actually said. No stage directions, no 'Narrator:' " +
    "prefix inside the text, no asterisks, no bracketed actions \u2014 the " +
    "speaker goes in its own field.\n" +
    "- One sentence or two per line. A line is a breath; long paragraphs read " +
    "badly and cannot be re-recorded a piece at a time.\n" +
    "- Give each character the same `speaker` name every time, and the same " +
    "`voice_id`, so a conversation stays in the same two voices.\n" +
    "- Write the number of lines you were asked for. If no number was given, " +
    "keep it short \u2014 two to six lines.\n" +
    '- A beat of silence is its own line: {"kind":"pause","duration_s":0.8}, ' +
    "no text.\n" +
    "- Do not set start_s or position. Lines are appended in the order you " +
    "write them.\n\n" +
    "Reply with JSON only:\n" +
    '{"summary":"...","actions":[{"type":"add_lines","lines":[\n' +
    '  {"text":"...","speaker":"Narrator","voice_id":"..."},\n' +
    '  {"kind":"pause","duration_s":0.6},\n' +
    '  {"text":"...","speaker":"Mara","voice_id":"..."}\n' +
    "]}]}";
  return [
    { role: "system", content: system },
    { role: "user", content: userBlock(instruction, ctx) },
  ];
}

/** The generate planner: make a new sound and put it somewhere. */
export function buildGenerateMessages(instruction: string, ctx: StudioContext): ChatMessage[] {
  const free = ctx.tracks.length ? Math.max(...ctx.tracks.map((t) => t.track_index)) + 1 : 0;
  const system =
    "Someone wants a new sound on their timeline. Write the prompt that will " +
    "make it, and say where it goes.\n\n" +
    `${MATCHING}\n\n` +
    "Describe the audio concretely \u2014 instruments, how they are played, the " +
    "space \u2014 rather than repeating the request back:\n" +
    "  'add some drum sounds' -> 'a tight acoustic drum loop with a dry kick " +
    "and crisp snare'\n" +
    "  'put some rain under this' -> 'steady rainfall on a window with " +
    "distant thunder'\n" +
    `Put it on the track they named, or on track ${free} if they did not. ` +
    "Use the playhead time unless they said otherwise.\n\n" +
    "Respond with JSON only: " +
    '{"summary":"...","actions":[{"type":"generate_clip","track_index":N,' +
    '"start_s":N,"prompt":"..."}]}. Exactly one action.';
  return [
    { role: "system", content: system },
    { role: "user", content: userBlock(instruction, ctx) },
  ];
}

/**
 * The panel planner: work the interface rather than the arrangement.
 *
 * Its own branch because it shares nothing with the others \u2014 there is no
 * clip to resolve and no audio to describe, just a fixed set of names.
 * Folding it into the edit prompt would have added rules every other request
 * then had to read past.
 */
export const PANEL_IDS = ["script", "insert", "library", "history", "sample", "devices"] as const;

export function buildPanelMessages(instruction: string): ChatMessage[] {
  const system =
    "Someone is asking to show or hide part of a music studio, or to start " +
    "recording. Say which.\n\n" +
    "Panels: script (the words), insert (the prompt box, also called " +
    '"prompt"), library (saved sounds), history (what has been generated), ' +
    "sample (the selected clip), devices (the effects rack).\n\n" +
    "Actions:\n" +
    '  {"type":"show_panel","panel":"...","open":true|false}\n' +
    '  {"type":"start_recording"}\n\n' +
    "`summary` is one friendly sentence. Respond with JSON only: " +
    '{"summary":"...","actions":[...]}.';
  return [
    { role: "system", content: system },
    { role: "user", content: instruction.trim() },
  ];
}


const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi;

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(THINK_BLOCK_RE, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  try {
    const parsed = JSON.parse(fenced ? fenced[1]!.trim() : cleaned) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Keep only the actions that refer to something real and say something.
 *
 * Dropping rather than repairing: an action naming a clip that does not exist
 * is not a typo to be fixed, it is the model having invented a reference, and
 * the honest response to that is to not perform it. The count of what was
 * dropped goes back to the caller so the user is told the plan was trimmed
 * instead of quietly getting less than they asked for.
 */
/**
 * Rewrite the model's own words into the vocabulary this file validates.
 *
 * Left unconstrained the model answers correctly and spells everything its own
 * way — `{"type":"mute","target":"track_1"}` for a set_track, `effect` for a
 * kind, `target` for a track index. Constrained by a flat JSON schema it does
 * the opposite: obeys the spelling and invents the content, filling optional
 * properties with whatever fits the grammar (an `add_clip` carrying a
 * hallucinated clip id was how that showed up).
 *
 * Given those two failure modes, translating is the better trade. It is a
 * table of synonyms rather than a second parser, and it costs nothing in
 * safety: `validateActions` still checks every id and index that comes out of
 * here against the real timeline, so a normalized action is exactly as
 * distrusted as a literal one.
 */
function normalizeAction(raw: Record<string, unknown>): Record<string, unknown> {
  const type = typeof raw.type === "string" ? raw.type.toLowerCase().trim() : "";
  const out: Record<string, unknown> = { ...raw };

  /** `target: "track_1"`, `"track 1"`, `"1"` and `1` all mean lane 1. */
  const laneFrom = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return undefined;
    const match = /(-?\d+)\s*$/.exec(value.trim());
    return match ? Number(match[1]) : undefined;
  };

  if (out.track_index === undefined) {
    const lane = laneFrom(raw.target ?? raw.track ?? raw.lane);
    if (lane !== undefined) out.track_index = lane;
  }
  // `target` doubles as a clip reference when it is not a lane.
  if (out.clip_id === undefined) {
    const candidate = raw.clip ?? raw.segment_id ?? raw.id ?? raw.target;
    if (typeof candidate === "string" && laneFrom(candidate) === undefined) out.clip_id = candidate;
  }
  out.kind = raw.kind ?? raw.effect_type ?? raw.effect ?? raw.device ?? raw.device_kind;
  out.name = raw.name ?? raw.title ?? raw.track_name;
  out.prompt = raw.prompt ?? raw.description ?? raw.sound ?? raw.text;
  out.panel = raw.panel ?? raw.target ?? raw.name ?? raw.view;

  switch (type) {
    case "mute":
    case "unmute":
      return { ...out, type: "set_track", muted: type === "mute" };
    case "solo":
    case "unsolo":
      return { ...out, type: "set_track", soloed: type === "solo" };
    case "mute_track":
    case "set_volume":
    case "set_gain":
      return { ...out, type: "set_track" };
    case "rename":
    case "name_track":
      return { ...out, type: "rename_track" };
    case "add_effect":
    case "add_device_to_track":
      return { ...out, type: "add_device" };
    case "remove_effect":
    case "delete_effect":
      return { ...out, type: "remove_device" };
    case "move":
    case "move_segment":
      return { ...out, type: "move_clip" };
    case "delete":
    case "remove_clip":
    case "delete_segment":
      return { ...out, type: "delete_clip" };
    case "generate":
    case "generate_audio":
    case "add_sound":
      return { ...out, type: "generate_clip" };
    case "show":
    case "open_panel":
    case "open":
      return { ...out, type: "show_panel", open: true };
    case "hide":
    case "hide_panel":
    case "close_panel":
    case "close":
      return { ...out, type: "show_panel", open: false };
    case "record":
    case "begin_recording":
      return { ...out, type: "start_recording" };
    default:
      return { ...out, type };
  }
}

/**
 * The clips one action is about: an explicit id, or a selector expanded
 * against the real timeline.
 *
 * Order matters. An explicit `clip_id` wins, because a model that named one
 * clip meant that clip even if it also emitted a stray selector. A selector
 * that matches nothing returns nothing, and the caller drops the action — the
 * honest outcome for "mute the vocals" on a timeline with no vocals, and
 * better than guessing at the nearest clip.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveClipIds(
  a: Record<string, unknown>,
  ctx: StudioContext,
): string[] {
  const clipIds = new Set(ctx.clips.map((c) => c.id));
  const one = typeof a.clip_id === "string" ? a.clip_id.trim() : "";
  if (one && clipIds.has(one)) return [one];

  // Some models answer with the plural even when told to use `select`.
  // Honouring it costs nothing and is exactly what they meant.
  if (Array.isArray(a.clip_ids)) {
    const listed = a.clip_ids.filter(
      (id): id is string => typeof id === "string" && clipIds.has(id),
    );
    if (listed.length) return listed;
  }

  const sel = a.select;
  if (!sel || typeof sel !== "object") return [];
  const s = sel as Record<string, unknown>;
  const scope = typeof s.scope === "string" ? s.scope : undefined;
  const fromTrack =
    typeof s.from_track === "number" && Number.isFinite(s.from_track) ? s.from_track : undefined;
  const matching =
    typeof s.matching === "string" && s.matching.trim()
      ? s.matching.trim().toLowerCase()
      : undefined;
  // An empty object would otherwise mean "everything", which is not something
  // to infer from a model that simply emitted a blank field.
  if (!scope && fromTrack === undefined && !matching) return [];

  const selected = new Set(ctx.selected_ids);
  return ctx.clips
    .filter((c) => {
      if (scope === "selected" && !selected.has(c.id)) return false;
      if (fromTrack !== undefined && c.track_index !== fromTrack) return false;
      if (matching && !c.label.toLowerCase().includes(matching)) return false;
      return true;
    })
    .map((c) => c.id);
}

export function validateActions(
  raw: unknown,
  ctx: StudioContext,
): { actions: StudioAction[]; dropped: number } {
  if (!Array.isArray(raw)) return { actions: [], dropped: 0 };
  const trackIndexes = new Set(ctx.tracks.map((t) => t.track_index));
  const actions: StudioAction[] = [];
  let dropped = 0;

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      dropped += 1;
      continue;
    }
    const a = normalizeAction(entry as Record<string, unknown>);
    const type = a.type;
    const kindish = a.kind;
    const num = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;
    const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
    const str = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;

    const track = num(a.track_index);
    // A track index the timeline does not have is as unusable as a made-up
    // clip id — `add_clip` is the one case that may name a new lane, and even
    // then only the next one down. Clips get the same treatment inside
    // `resolveClipIds`, which is where every clip action now goes.
    const knownTrack = track !== undefined && trackIndexes.has(track);

    switch (type) {
      case "rename_track": {
        const name = str(a.name);
        if (!knownTrack || !name) break;
        actions.push({ type: "rename_track", track_index: track!, name });
        continue;
      }
      case "set_track": {
        const muted = bool(a.muted);
        const soloed = bool(a.soloed);
        const gain = num(a.gain_db);
        if (!knownTrack || (muted === undefined && soloed === undefined && gain === undefined)) break;
        actions.push({
          type: "set_track",
          track_index: track!,
          ...(muted !== undefined ? { muted } : {}),
          ...(soloed !== undefined ? { soloed } : {}),
          ...(gain !== undefined ? { gain_db: gain } : {}),
        });
        continue;
      }
      case "move_clip": {
        const startS = num(a.start_s);
        const targets = resolveClipIds(a, ctx);
        if (!targets.length || (startS === undefined && !knownTrack)) break;
        for (const id of targets) {
          actions.push({
            type: "move_clip",
            clip_id: id,
            ...(startS !== undefined ? { start_s: Math.max(0, startS) } : {}),
            ...(knownTrack ? { track_index: track! } : {}),
          });
        }
        continue;
      }
      case "set_clip": {
        const muted = bool(a.muted);
        const text = str(a.text);
        // Ranges are the mixer's, not the model's. Gain past +24 dB is
        // clipping rather than loudness, and a negative fade is not a thing.
        const gain = num(a.gain_db);
        const fadeIn = num(a.fade_in_s);
        const fadeOut = num(a.fade_out_s);
        const durationS = num(a.duration_s);
        const trimStart = num(a.trim_start_s);
        const voiceId = str(a.voice_id);
        const speaker = str(a.speaker);
        const knownVoice = voiceId && (ctx.voices ?? []).some((v) => v.id === voiceId);
        const patch = {
          ...(muted !== undefined ? { muted } : {}),
          ...(text !== undefined ? { text } : {}),
          ...(knownVoice ? { voice_id: voiceId! } : {}),
          ...(speaker !== undefined ? { speaker: speaker.slice(0, 80) } : {}),
          ...(gain !== undefined ? { gain_db: clamp(gain, -60, 24) } : {}),
          ...(fadeIn !== undefined ? { fade_in_s: Math.max(0, fadeIn) } : {}),
          ...(fadeOut !== undefined ? { fade_out_s: Math.max(0, fadeOut) } : {}),
          ...(durationS !== undefined && durationS > 0 ? { duration_s: durationS } : {}),
          ...(trimStart !== undefined ? { trim_start_s: Math.max(0, trimStart) } : {}),
        };
        const targets = resolveClipIds(a, ctx);
        // A text rewrite is about one clip's words; applying it across a
        // selection would overwrite every line with the same sentence. A
        // recast is the opposite — "put the whole scene in Mara's voice" is
        // exactly a bulk operation — so only the words are scoped down.
        const scoped = text !== undefined ? targets.slice(0, 1) : targets;
        if (!scoped.length || Object.keys(patch).length === 0) break;
        for (const id of scoped) actions.push({ type: "set_clip", clip_id: id, ...patch });
        continue;
      }
      case "delete_clip": {
        const targets = resolveClipIds(a, ctx);
        if (!targets.length) break;
        for (const id of targets) actions.push({ type: "delete_clip", clip_id: id });
        continue;
      }
      case "add_clip": {
        const text = str(a.text);
        const startS = num(a.start_s) ?? ctx.playhead_s;
        if (!text) break;
        // The one action allowed to name a lane that does not exist yet, and
        // only the next one: "put it on a new track" is a real instruction,
        // "put it on track 40" is not.
        const nextLane = ctx.tracks.length ? Math.max(...trackIndexes) + 1 : 0;
        const lane = knownTrack ? track! : track === nextLane ? nextLane : undefined;
        if (lane === undefined) break;
        actions.push({ type: "add_clip", track_index: lane, start_s: Math.max(0, startS), text });
        continue;
      }
      case "show_panel": {
        const panel = str(a.panel)?.toLowerCase();
        // "prompt" is what the panel is called on screen; "insert" is what it
        // is called in the code, and the model has only ever seen the former.
        const resolved = panel === "prompt" ? "insert" : panel;
        if (!resolved || !(PANEL_IDS as readonly string[]).includes(resolved)) break;
        actions.push({
          type: "show_panel",
          panel: resolved,
          open: bool(a.open) ?? true,
        });
        continue;
      }
      case "start_recording": {
        actions.push({ type: "start_recording" });
        continue;
      }
      case "generate_clip": {
        const prompt = str(a.prompt) ?? str(a.text) ?? str(a.description);
        const startS = num(a.start_s) ?? ctx.playhead_s;
        const nextLane = ctx.tracks.length ? Math.max(...trackIndexes) + 1 : 0;
        const lane = knownTrack ? track! : nextLane;
        if (!prompt) break;
        actions.push({
          type: "generate_clip",
          track_index: lane,
          start_s: Math.max(0, startS),
          prompt,
        });
        continue;
      }
      case "add_lines": {
        const raw = a.lines;
        if (!Array.isArray(raw)) break;
        const known = new Set((ctx.voices ?? []).map((v) => v.id));
        const lines: Extract<StudioAction, { type: "add_lines" }>["lines"] = [];
        for (const entry of raw.slice(0, 100)) {
          if (!entry || typeof entry !== "object") continue;
          const l = entry as Record<string, unknown>;
          const isPause = l.kind === "pause";
          const text = typeof l.text === "string" ? l.text.trim() : "";
          const seconds =
            typeof l.duration_s === "number" && Number.isFinite(l.duration_s)
              ? Math.min(Math.max(l.duration_s, 0), 600)
              : undefined;
          // A pause is a length; a line is words. Neither survives without
          // the one thing that makes it what it is.
          if (isPause) {
            lines.push({ text: "", kind: "pause", duration_s: seconds ?? 0.5 });
            continue;
          }
          if (!text) continue;
          const voiceId = typeof l.voice_id === "string" ? l.voice_id.trim() : "";
          const speaker = typeof l.speaker === "string" ? l.speaker.trim() : "";
          const lane = num(l.track_index);
          lines.push({
            text,
            kind: "line",
            // An invented voice costs the line its casting, not its
            // existence: without the field it reads in the model's default
            // voice, which is recoverable. With a bad id the API refuses it.
            ...(voiceId && known.has(voiceId) ? { voice_id: voiceId } : {}),
            ...(speaker ? { speaker: speaker.slice(0, 80) } : {}),
            ...(lane !== undefined && trackIndexes.has(lane) ? { track_index: lane } : {}),
          });
        }
        if (!lines.length) break;
        actions.push({ type: "add_lines", lines });
        continue;
      }
      case "speak_lines": {
        const targets = resolveClipIds(a, ctx);
        if (!targets.length) break;
        actions.push({ type: "speak_lines", clip_ids: targets });
        continue;
      }
      case "add_device":
      case "remove_device": {
        const kind = str(kindish)?.toLowerCase();
        if (!knownTrack || !kind || !(DEVICE_KINDS as readonly string[]).includes(kind)) break;
        actions.push({
          type: type === "add_device" ? "add_device" : "remove_device",
          track_index: track!,
          kind: kind as DeviceKind,
        });
        continue;
      }
      case "set_device": {
        const kind = str(kindish)?.toLowerCase();
        if (!knownTrack || !kind || !(DEVICE_KINDS as readonly string[]).includes(kind)) break;
        const raw = a.params;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) break;
        // Finite numbers only. The ranges belong to `devices.ts`, which
        // clamps them into the rack — see the action's own doc comment.
        const params: Record<string, number> = {};
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof value === "number" && Number.isFinite(value)) params[key] = value;
        }
        if (Object.keys(params).length === 0) break;
        actions.push({
          type: "set_device",
          track_index: track!,
          kind: kind as DeviceKind,
          params,
        });
        continue;
      }
      default:
        break;
    }
    dropped += 1;
  }
  return { actions, dropped };
}

export function parseStudioPlan(text: string, ctx: StudioContext): StudioPlan & { dropped: number } {
  const obj = parseJsonObject(text);
  if (!obj) return { intent: "edit", actions: [], summary: "", dropped: 0 };
  const { actions, dropped } = validateActions(obj.actions, ctx);
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  // Trust "generate" only when nothing survived validation. A reply carrying
  // real edits is an edit whatever it called itself, and routing those away
  // to the prompt box would throw away work the model actually did.
  const intent = obj.intent === "generate" && actions.length === 0 ? "generate" : "edit";
  return { intent, actions, summary, dropped };
}
