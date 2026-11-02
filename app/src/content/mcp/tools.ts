/**
 * Content model for the MCP tool surface: one entry per tool an agent sees
 * once it connects, grouped the way a person meets them.
 *
 * Derived from `server/src/mcp/server.ts` — its exported `MCP_TOOLS` table for
 * names and titles, and the zod `inputSchema` on each `registerTool` call for
 * argument names, types and required-ness. **The server is ground truth.** If
 * this file and that one disagree, this file is wrong.
 *
 * That is not hypothetical. This documentation described five tools long after
 * the server had grown to twenty, and cited `backend/src/soundbox/mcp_server.py`
 * — a Python module that no longer exists. Anyone reading it concluded Soundbox
 * could generate sounds and nothing else: no speech, no stories, no timeline.
 * The whole voice and arrangement half of the product was invisible. Hence the
 * split into a content module: the reference page and the marketing page now
 * read the same list, so a tool can only go missing from both at once.
 *
 * `blurb` is written for a reader deciding whether to reach for a tool, not
 * copied from the server's `description` — that one is written for the model
 * choosing at call time and is longer and more cautionary than a docs page
 * wants. `args` is a chosen subset: the arguments a caller actually has to
 * think about, not every optional field.
 */

export type McpToolGroup = "sounds" | "voices" | "stories" | "arrangement";

export interface McpToolArg {
  name: string;
  type: string;
  required?: boolean;
  note?: string;
}

export interface McpToolDoc {
  /** Wire name, e.g. "soundbox.generate". */
  name: string;
  /** Title from the server's MCP_TOOLS table. */
  title: string;
  /** One sentence: what an agent reaches for it for. Written, not copied. */
  blurb: string;
  group: McpToolGroup;
  args: McpToolArg[];
  /** Blocks for a long time (actually renders audio). */
  slow?: boolean;
  /** Permanently removes something. */
  destructive?: boolean;
}

export const MCP_TOOL_GROUPS: { id: McpToolGroup; title: string; intro: string }[] = [
  {
    id: "sounds",
    title: "Sounds",
    intro:
      "Make a sound effect and find it again. Every sound-shaped result carries an absolute path to a WAV on this machine, so the agent can use its ordinary file tools from there.",
  },
  {
    id: "voices",
    title: "Voices",
    intro:
      "Spoken words take a separate path: soundbox.generate will not say them. speak is the one-off read. Put anything you want to keep and rework in a story.",
  },
  {
    id: "stories",
    title: "Stories",
    intro:
      "A story is a script that persists. Each line has a position in time, can be re-read on its own, and persists after the conversation that made it.",
  },
  {
    id: "arrangement",
    title: "Arrangement",
    intro:
      "The timeline underneath a story: which lane a clip is on, how loud it is, and what the studio shows when you open it.",
  },
];

export const MCP_TOOLS: McpToolDoc[] = [
  /* ------------------------------------------------------------- sounds */
  {
    name: "soundbox.generate",
    title: "Generate a sound effect",
    blurb:
      "Renders one or more sounds from a text description and saves them to the library. Blocks until the audio is on disk.",
    group: "sounds",
    slow: true,
    args: [
      {
        name: "prompt",
        type: "string",
        required: true,
        note: "Material, action and space, e.g. “glass bottle shattering on tile, small reverberant room”. For a lyrics-conditioned model this sets genre and instrumentation instead.",
      },
      { name: "duration_s", type: "number", note: "0.5–300, default 5. Clamped to the model's own maximum." },
      { name: "model", type: "string", note: "Defaults to whichever model is already loaded." },
      { name: "negative_prompt", type: "string", note: "Ignored by models that lack it." },
      { name: "seed", type: "integer", note: "For reproducibility." },
      { name: "variations", type: "integer", note: "1–4 takes of the same idea, default 1." },
      { name: "tags", type: "string[]", note: "Library tags." },
      {
        name: "lyrics",
        type: "string",
        note: "Words for a lyrics-conditioned music model to sing. Ignored elsewhere; check supports.lyrics first.",
      },
      {
        name: "source_sound_id",
        type: "string",
        note: "Edit an existing sound instead of rendering from scratch. Pair with edit.",
      },
      {
        name: "edit",
        type: '"extend" | "cover" | "repaint"',
        note: "What to do with source_sound_id. The model must declare supports.<edit>.",
      },
    ],
  },
  {
    name: "soundbox.enhance_prompt",
    title: "Rewrite a prompt for a sound model",
    blurb:
      "Turns a vague prompt (“scary sound”) into a concrete one, optionally several. Requires the local prompt assistant to be enabled; if it is off, the tool says so.",
    group: "sounds",
    args: [
      { name: "prompt", type: "string", required: true, note: "The prompt to rewrite." },
      { name: "n", type: "integer", note: "1–5 distinct variations, default 1." },
      { name: "category", type: '"sfx" | "music"', note: "Which kind of model this is for. Defaults to sfx." },
      {
        name: "lyrics",
        type: "boolean",
        note: "True if the prompt sets genre and instrumentation for a lyrics-conditioned model.",
      },
      {
        name: "model",
        type: "string",
        note: "The id you intend to generate with, so the rewrite follows that model's own prompting conventions.",
      },
    ],
  },
  {
    name: "soundbox.list_models",
    title: "List sound models",
    blurb:
      "Available models with status and licence. Also lists each speech model's delivery options. A misspelled option is ignored silently, with no error.",
    group: "sounds",
    args: [],
  },
  {
    name: "soundbox.list_sounds",
    title: "Search the sound library",
    blurb: "Search what has already been made. Call it before generating; the sound may already exist.",
    group: "sounds",
    args: [
      { name: "q", type: "string", note: "Text to match in prompt or name." },
      { name: "tag", type: "string" },
      { name: "limit", type: "integer", note: "1–100, default 20." },
    ],
  },
  {
    name: "soundbox.get_sound",
    title: "Get one sound",
    blurb: "Fetch a single sound by id, including its absolute file path.",
    group: "sounds",
    args: [{ name: "sound_id", type: "string", required: true }],
  },
  {
    name: "soundbox.separate",
    title: "Split a sound into stems",
    blurb:
      "Splits a sound into vocals, drums, bass and other, each saved as its own sound with its own path. You can keep some and merge the rest back into one sound: the original minus the stems you kept.",
    group: "sounds",
    slow: true,
    args: [
      { name: "sound_id", type: "string", required: true },
      { name: "model", type: "string", note: 'Separation model id. Omit for whichever `task: "sep"` model is installed.' },
      { name: "stems", type: "string[]", note: 'Which stems to keep, e.g. ["vocals"]. Omit for all.' },
      {
        name: "rest",
        type: '"discard" | "merge"',
        note: 'What happens to the stems not named: thrown away, or summed into one "rest" sound.',
      },
    ],
  },
  {
    name: "soundbox.delete_sound",
    title: "Delete a sound",
    blurb: "Permanently deletes a sound and its audio file.",
    group: "sounds",
    destructive: true,
    args: [{ name: "sound_id", type: "string", required: true }],
  },

  /* ------------------------------------------------------------- voices */
  {
    name: "soundbox.list_voices",
    title: "List saved voices",
    blurb:
      "The voices a script can be read in. Call it before writing one, so lines can be cast to real voice ids.",
    group: "voices",
    args: [],
  },
  {
    name: "soundbox.speak",
    title: "Speak a line or a dialogue",
    blurb:
      "Reads text aloud in a saved voice and saves it to the library. Pass one line, or several with different voices. Blocks until the audio is on disk.",
    group: "voices",
    slow: true,
    args: [
      {
        name: "lines",
        type: "{ text, voice_id?, speaker? }[]",
        required: true,
        note: "1–200. Several lines with different voice_ids is a dialogue.",
      },
      {
        name: "model",
        type: "string",
        note: "A text-to-speech model id for every line. Omit it and each line is read on its voice's own model, or a ready one when the voice has none.",
      },
      { name: "gap_s", type: "number", note: "Silence between lines, 0–5. Default 0.4." },
      { name: "name", type: "string", note: "What the resulting sound is called in the library." },
      {
        name: "delivery",
        type: "Record<string, string>",
        note: "How to read it, by this model's own option names. Never write stage directions into the text; they get read aloud.",
      },
    ],
  },

  /* ------------------------------------------------------------ stories */
  {
    name: "soundbox.create_story",
    title: "Start a story",
    blurb: "Creates the empty script everything else in this group operates on.",
    group: "stories",
    args: [
      { name: "title", type: "string", note: "What this story is." },
      {
        name: "delivery",
        type: "Record<string, string>",
        note: "How every line is read unless it overrides it. Set delivery here in most cases.",
      },
    ],
  },
  {
    name: "soundbox.list_stories",
    title: "List stories",
    blurb: "Existing stories, most recently worked on first.",
    group: "stories",
    args: [{ name: "limit", type: "integer", note: "1–200, default 20." }],
  },
  {
    name: "soundbox.get_story",
    title: "Read a story",
    blurb:
      "Returns the whole script line by line: text, voice, timing, and whether each line has been voiced yet. Use it to inspect what the agent built.",
    group: "stories",
    args: [{ name: "story_id", type: "string", required: true }],
  },
  {
    name: "soundbox.add_lines",
    title: "Add lines to a story",
    blurb:
      "Appends spoken lines, pauses, or existing library sounds to the script. Add many at once; give a line its own delivery if it should be read differently.",
    group: "stories",
    args: [
      { name: "story_id", type: "string", required: true },
      {
        name: "lines",
        type: "{ text?, speaker?, voice_id?, kind?, duration_s?, sound_id?, track_index?, start_s?, delivery? }[]",
        required: true,
        note: "1–200. kind “pause” is a beat of silence lasting duration_s; sound_id drops a library sound onto the timeline instead of writing words.",
      },
    ],
  },
  {
    name: "soundbox.update_line",
    title: "Edit or arrange a line",
    blurb:
      "Changes a line's words, voice, delivery, or where it sits in time. Changing words or delivery means the line has to be re-read before it is heard.",
    group: "stories",
    args: [
      { name: "line_id", type: "string", required: true },
      { name: "text", type: "string" },
      { name: "speaker", type: "string | null" },
      { name: "voice_id", type: "string | null" },
      { name: "track_index", type: "integer", note: "−16 to 16." },
      { name: "start_s", type: "number", note: "Where it sits in time." },
      { name: "muted", type: "boolean" },
      { name: "gain_db", type: "number", note: "−40 to 24." },
      {
        name: "duration_s",
        type: "number",
        note: "How much of the clip plays. Shortens the clip without deleting its audio.",
      },
      { name: "trim_start_s", type: "number", note: "How far into the source sound the clip begins." },
      {
        name: "delivery",
        type: "Record<string, string>",
        note: "Overrides the story's. {} puts the line back on the story's.",
      },
    ],
  },
  {
    name: "soundbox.speak_story",
    title: "Voice a story",
    blurb:
      "Reads every line that has no audio yet, in its assigned voice and on that voice's model, one at a time. This is the slowest tool.",
    group: "stories",
    slow: true,
    args: [
      { name: "story_id", type: "string", required: true },
      {
        name: "model",
        type: "string",
        note: "A text-to-speech model id for every line. Omit it and each line is read on its voice's own model, or a ready one when the voice has none.",
      },
      {
        name: "regenerate",
        type: "boolean",
        note: "Also re-read lines that already have audio. Default false.",
      },
    ],
  },
  {
    name: "soundbox.delete_line",
    title: "Delete a line",
    blurb: "Removes one line from a story. Its audio stays in the library.",
    group: "stories",
    destructive: true,
    args: [{ name: "line_id", type: "string", required: true }],
  },
  {
    name: "soundbox.split_line",
    title: "Split a line in two",
    blurb:
      "Cuts a voiced line at a point in its own audio, giving two clips. The words stay with the first half, because Soundbox cannot tell which words fell on either side of the cut.",
    group: "stories",
    args: [
      { name: "line_id", type: "string", required: true },
      { name: "at_s", type: "number", required: true, note: "Seconds into the line's own audio. Must be > 0." },
    ],
  },
  {
    name: "soundbox.export_story",
    title: "Mix a story down",
    blurb:
      "Mixes the whole arrangement to one sound, honouring where each clip sits, its trim, its gain, and whether it is muted.",
    group: "stories",
    slow: true,
    args: [{ name: "story_id", type: "string", required: true }],
  },

  /* -------------------------------------------------------- arrangement */
  {
    name: "soundbox.open_in_studio",
    title: "Open a sound in the studio",
    blurb:
      "Lays a library sound out on a timeline, split into stems on separate tracks where that is possible. If the sound already has stems, it reuses them.",
    group: "arrangement",
    args: [
      { name: "sound_id", type: "string", required: true },
      {
        name: "separate",
        type: "boolean",
        note: "Split into stems first, default true. Ignored for a sound that is already a stem or an edit.",
      },
      { name: "stems", type: "string[]", note: 'Which stems get a track, e.g. ["vocals", "drums"]. Omit for all.' },
      {
        name: "rest",
        type: '"discard" | "merge"',
        note: 'What happens to the stems not named: thrown away, or summed into one "rest" track. Default discard.',
      },
    ],
  },
  {
    name: "soundbox.mix_track",
    title: "Mute, solo or set a track's level",
    blurb: "Controls one lane of a story. These settings belong to the lane; the clips on it keep their own.",
    group: "arrangement",
    args: [
      { name: "story_id", type: "string", required: true },
      { name: "track_index", type: "integer", required: true, note: "Which lane, −16 to 16." },
      { name: "name", type: "string | null" },
      { name: "muted", type: "boolean" },
      { name: "soloed", type: "boolean", note: "With any track soloed, only soloed tracks are heard." },
      { name: "gain_db", type: "number", note: "−40 to 24." },
    ],
  },
  {
    name: "soundbox.add_device",
    title: "Add an effect to a track",
    blurb:
      "Puts a compressor, EQ, reverb, delay, distortion, gate, limiter or autotune on one lane's rack. The studio shows it as it lands; the export still mixes dry.",
    group: "arrangement",
    args: [
      { name: "story_id", type: "string", required: true },
      { name: "track_index", type: "integer", required: true, note: "Which lane, −16 to 16." },
      { name: "kind", type: "string", required: true, note: "compressor, eq, reverb, delay, distortion, gate, limiter or autotune." },
      { name: "params", type: "object", note: "Knobs to set as it goes on, in stored units (seconds, dB, 0–1 mixes). The rest take defaults." },
      { name: "bypassed", type: "boolean" },
      { name: "position", type: "integer", note: "Where in the chain, from 0. Omit to add it last." },
    ],
  },
  {
    name: "soundbox.set_device",
    title: "Turn a device's knobs",
    blurb:
      "Changes a device already on a lane, or bypasses it and keeps its settings. Values past a knob's range land at its end, and the result says which did.",
    group: "arrangement",
    args: [
      { name: "story_id", type: "string", required: true },
      { name: "track_index", type: "integer", required: true },
      { name: "device", type: "string", required: true, note: "Its id, or its kind when the lane has one." },
      { name: "params", type: "object" },
      { name: "bypassed", type: "boolean" },
    ],
  },
  {
    name: "soundbox.remove_device",
    title: "Take an effect off a track",
    blurb: "Removes one device from a lane's chain. Bypass it with soundbox.set_device to keep its settings instead.",
    group: "arrangement",
    args: [
      { name: "story_id", type: "string", required: true },
      { name: "track_index", type: "integer", required: true },
      { name: "device", type: "string", required: true, note: "Its id, or its kind when the lane has one." },
    ],
  },
  {
    name: "soundbox.remove_track",
    title: "Remove a track",
    blurb:
      "Deletes a lane and the clips on it; lanes above slide down. Call soundbox.get_story first if you are not certain what is on it.",
    group: "arrangement",
    destructive: true,
    args: [
      { name: "story_id", type: "string", required: true },
      { name: "track_index", type: "integer", required: true, note: "−16 to 16." },
    ],
  },
];
