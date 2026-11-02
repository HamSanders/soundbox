/**
 * MCP surface, mounted at /mcp on the same port as the HTTP API.
 *
 * Tools return structured JSON, and every path that returns a sound includes its
 * absolute filesystem path — an agent asked to make a sound needs a path it can
 * hand to ffmpeg, not a URL relative to a server it isn't speaking to.
 *
 * Transport notes that carried over from the Python:
 *  - the endpoint must answer on exactly "/mcp" (no 307 to "/mcp/"), because
 *    clients that don't follow redirects on POST would break;
 *  - DNS-rebinding protection is armed with a localhost allowlist, which
 *    silently breaks `--host 0.0.0.0`, so the allowlist follows how the server
 *    is actually bound via SOUNDBOX_ALLOWED_HOSTS (comma-separated).
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { DEFAULT_HOST, DEFAULT_PORT, VERSION } from "../config.js";
import { allowedHostEntries, isListedHost, isTrustedOrigin } from "../origins.js";
import type { Job, ModelInfo, McpToolInfo, Origin, Sound, StorySegment } from "../schemas.js";
import type { SoundboxService } from "../service.js";
import type { CallRecord, TrackOptions } from "../telemetry.js";
import {
  DEVICE_KINDS,
  DEVICE_TABLE,
  clampParams,
  defaultParams,
  describeDevices,
  newDeviceId,
  type DeviceSpec,
} from "../devices.js";
import { ProgressReporter } from "./progress.js";

export const MCP_INSTRUCTIONS = `Soundbox makes audio locally from open-weight models: sound effects, music, and speech.

Call soundbox.generate with a descriptive prompt — the models respond to
material, action and space ("heavy wooden door slamming in a stone corridor"),
not to abstract labels ("scary sound"). Generation takes seconds to a minute
depending on the model and blocks until the audio is written to disk. If your
prompt is abstract and you'd rather not write the descriptive version
yourself, call soundbox.enhance_prompt first and pass its result to generate —
pass the \`model\` id you intend to generate with so the rewrite follows that
model's own prompting conventions (Stable Audio's tempo/instrumentation
emphasis, ACE-Step's comma-tag style, etc.) rather than generic advice. It
only works when the user has enabled the local prompt assistant, and says so
if not.

Each result carries an absolute \`path\` to a WAV file. Check soundbox.list_models
first if you care about licensing: models differ, and some are non-commercial.

For lyrics-conditioned vocal music (ACE-Step), pass \`lyrics\` — a block like
"[verse]\\nGame over\\nYou have fallen" — and \`prompt\` switches roles to set
genre/instrumentation instead of a sound description. Omit \`lyrics\` for an
instrumental render on the same model. Check \`supports.lyrics\` in
soundbox.list_models before relying on it; other models ignore the field.

To build on a sound that already exists, pass \`source_sound_id\` with
\`edit\`: "extend" makes it longer (set \`duration_s\` to the new total; the
original stays intact at the start), "cover" re-renders it in the style of
\`prompt\` at the same length. Only models with \`supports.extend\` /
\`supports.cover\` can — ACE-Step yes, MiniMax Music 3 no.

Spoken words are a different path: soundbox.generate will not say them. For one
read, call soundbox.speak. For anything you want to keep, arrange or hand back
in pieces, build a story — soundbox.create_story, soundbox.add_lines,
soundbox.speak_story, soundbox.export_story — because a story persists, each
line can be re-read on its own, and the lines carry a place in time. Cast lines
to real voices with soundbox.list_voices first; a line with no voice_id falls
back to the model's default, and some families have none.

Leave \`model\` off soundbox.speak and soundbox.speak_story unless you mean to
override the cast: each line is then read on its own voice's \`model_id\` (a
voice is made on a model, and a clone read on another family does not sound
like it), lines with voices on different models are each read on their own, and
a line with no voice, or a voice with no model, gets a ready one. The result
reports the models used, and \`notes\` says when a voice's model was not
installed and the line was read on something else; pass that on to the user.

How a line is *performed* is a separate lever from what it says, and it lives
in flags rather than in the text: writing "(whispering)" into a line makes the
model say the word "whispering". Pass \`delivery\` instead — on
soundbox.create_story for the whole script, on a line in soundbox.add_lines, or
on soundbox.update_line for one exception. The names are per model family and
soundbox.list_models returns them as \`delivery\`; an unknown name is ignored
silently rather than rejected, so take them from there. A model with no
\`delivery\` list has none: its words and its voice are the only controls.

Each lane of a story has an insert chain, the studio's device rack:
soundbox.add_device puts a compressor, eq, reverb, delay, distortion, gate,
limiter or autotune on a track, soundbox.set_device turns its knobs or
bypasses it, and soundbox.remove_device takes it off. The studio shows each
change as it lands. Devices are heard in the studio's playback only;
soundbox.export_story mixes dry, so say so if the user is about to export.

Speaking is slow: one subprocess per line. soundbox.speak_story blocks until
every silent line has been read, so expect minutes on a long script.

A mixed track can be pulled apart: soundbox.separate splits a library sound
into vocals, drums, bass and other, each saved as its own sound with its own
path. Pass \`stems\` to keep only some — \`rest: "merge"\` sums the ones you
did not name back into a single "rest" sound, so "take the vocal off this" is
one call and both halves still play as the take you started from. It needs a
model with \`task: "sep"\` installed. soundbox.open_in_studio does the same
split but lays the result out on a timeline instead of handing back files, and
reuses stems the sound already has rather than making more.

The story tools answer with a short summary and an \`open_in_studio\` link, not
with every line. Give the user that link — a timeline is a thing to look at,
and reciting its clips back at them is not the same as showing it. Call
soundbox.get_story when you need the lines themselves.
`;

/** A generated sound, with an absolute path the caller can actually open. */
export interface SoundResult {
  id: string;
  name: string;
  /** Absolute path to the WAV file on this machine. */
  path: string;
  /** HTTP URL, relative to the Soundbox server. */
  url: string;
  model: string;
  prompt: string;
  duration_s: number;
  sample_rate: number;
  channels: number;
  seed: number | null;
  tags: string[];
  /** The sound this one was made from — a stem's mix, an edit's original —
   *  or null for a sound generated from a prompt. */
  parent_id: string | null;
  /** Which stem this is ("vocals", "drums", "rest"), when it came out of a
   *  separation. Absent for everything else, including edits, whose names
   *  carry a parenthesised suffix too. */
  stem_name?: string;
}

export interface GenerateResult {
  sounds: SoundResult[];
  model: string;
  elapsed_s: number;
}

export interface ModelSummary {
  id: string;
  name: string;
  /**
   * Which surface the model belongs to: "gen" for soundbox.generate, "tts"
   * for the speech tools, "sep" for soundbox.separate.
   *
   * Carried because it is one list: a separator sitting next to a music model
   * with nothing to tell them apart reads as something soundbox.generate
   * could be called with, and it isn't.
   */
  task: string;
  vendor: string;
  description: string;
  status: string;
  license: string;
  /** 'yes', 'no' or 'conditional' */
  commercial_use: string;
  max_duration_s: number;
  sample_rate: number;
  gated: boolean;
  /**
   * For a text-to-speech model, the knobs it will actually listen to — pass
   * them as `delivery` to soundbox.speak, add_lines or update_line.
   *
   * Only for `tts` models, and only where the family lists any, because those
   * are the only ones Soundbox forwards. An absent list is a real answer: the
   * words and the voice are that model's only controls. Read off audio.cpp's
   * own parameter table, not guessed — see models/params.ts.
   */
  delivery?: DeliveryOption[];
}

/** One knob, flattened for an agent: enough to choose a value without a
 *  second call. */
export interface DeliveryOption {
  name: string;
  /** "delivery" is the group that changes how a line is performed; the rest
   *  ("sampling", "quality", …) change how hard the model works at it. */
  group: string;
  default: string | number | boolean;
  minimum?: number | null;
  maximum?: number | null;
  choices?: string[];
  info?: string | null;
}

/**
 * Model ids that produce stems, so a sound made by one can be labelled with
 * the stem it is.
 *
 * The same rule the service uses to find a sound's existing stems: a stem is
 * told apart from an edit by *which model made it*, not by its name — both
 * end in a parenthesised suffix.
 */
async function separatorIds(svc: SoundboxService): Promise<Set<string>> {
  return new Set((await svc.listModels()).filter((m) => m.task === "sep").map((m) => m.id));
}

/**
 * The separation model to use when the caller named none.
 *
 * The service picks one too, but only where it separates on its way to
 * somewhere else; an agent calling soundbox.separate directly needs the same
 * choice made, and needs "none installed" to say so in words rather than come
 * back as a failed job.
 */
async function defaultSeparator(svc: SoundboxService): Promise<string> {
  const ready = (await svc.listModels()).filter(
    (m) => m.task === "sep" && (m.status === "loaded" || m.status === "installed"),
  );
  if (!ready.length) {
    throw new Error(
      "No stem-separation model is installed. Open the Soundbox app and download " +
        "one from the Models tab, or call soundbox.list_models to see the options.",
    );
  }
  return (ready.find((m) => m.status === "loaded") ?? ready[0]).id;
}

/** The parenthesised suffix a separation gives a stem: "Take 3 (vocals)". */
function stemNameOf(sound: Sound): string | undefined {
  return /\(([^()]*)\)\s*$/.exec(sound.name)?.[1];
}

function toResult(
  svc: SoundboxService,
  sound: Sound,
  separators?: Set<string>,
): SoundResult {
  return {
    id: sound.id,
    name: sound.name,
    path: svc.absolutePath(sound.id) ?? "",
    url: sound.file,
    model: sound.model,
    prompt: sound.prompt,
    duration_s: sound.duration_s,
    sample_rate: sound.sample_rate,
    channels: sound.channels,
    seed: sound.seed ?? null,
    tags: sound.tags,
    parent_id: sound.parent_id ?? null,
    stem_name: separators?.has(sound.model) ? stemNameOf(sound) : undefined,
  };
}

function summarise(info: ModelInfo): ModelSummary {
  return {
    id: info.id,
    name: info.name,
    task: info.task,
    vendor: info.vendor,
    description: info.description,
    status: info.status,
    license: info.license.name,
    commercial_use: info.license.commercial,
    max_duration_s: info.max_duration_s,
    sample_rate: info.sample_rate,
    gated: info.gated,
    delivery:
      info.task === "tts" && info.params.length > 0
        ? info.params.map((p) => ({
            name: p.name,
            group: p.group,
            default: p.default,
            minimum: p.minimum ?? undefined,
            maximum: p.maximum ?? undefined,
            choices: p.choices,
            info: p.info ?? undefined,
          }))
        : undefined,
  };
}

/**
 * Tool metadata, exported so `service.mcpStatus()` can list the surface without
 * having to introspect a live MCP server. `calls` is filled in there.
 */
export const MCP_TOOLS: McpToolInfo[] = [
  {
    name: "soundbox.enhance_prompt",
    title: "Rewrite a prompt for a sound model",
    description:
      "Rewrite a short or abstract prompt into a concrete, descriptive one a " +
      "text-to-audio model responds to, optionally returning several " +
      "variations, plus a few suggested library tags (a separate field from " +
      "the prompt — pass these to soundbox.generate's `tags`, not into the " +
      "prompt itself). Prefer writing a descriptive prompt yourself when you " +
      "already know the material/action/space; use this when the prompt is " +
      "vague ('scary sound') or you want options. Only useful when the local " +
      "prompt assistant is enabled — check the reply if it isn't.",
    calls: 0,
  },
  {
    name: "soundbox.generate",
    title: "Generate a sound effect",
    description:
      "Generate one or more sound effects from a text description and save " +
      "them to the Soundbox library. Blocks until the audio is on disk.",
    calls: 0,
  },
  {
    name: "soundbox.separate",
    title: "Split a sound into stems",
    description:
      "Split a library sound into its stems — vocals, drums, bass, other — " +
      "each saved as its own sound with its own file path. Name `stems` to " +
      "keep only some of them; `rest: \"merge\"` sums the ones you didn't " +
      "name into a single \"rest\" sound, which is the original minus what " +
      "you took out. Blocks until the audio is on disk. Needs a separation " +
      "model installed (`task: \"sep\"` in soundbox.list_models).",
    calls: 0,
  },
  {
    name: "soundbox.list_models",
    title: "List sound models",
    description:
      "List every model, generation and otherwise, with its status and " +
      "licence. `task` says which surface a model belongs to — \"gen\" for " +
      "soundbox.generate, \"tts\" for the speech tools, \"sep\" for " +
      "soundbox.separate — and calling one on the wrong surface is refused. " +
      "Check `commercial_use` before using output commercially. For a " +
      "text-to-speech model this is also where the `delivery` knobs it accepts " +
      "come from — the authority on those names, since a wrong one is ignored " +
      "silently rather than rejected.",
    calls: 0,
  },
  {
    name: "soundbox.list_sounds",
    title: "Search the sound library",
    description:
      "Search previously generated sounds. Use this before generating — " +
      "the sound you want may already exist. Pass `voice_id` for what one " +
      "saved voice has already said.",
    calls: 0,
  },
  {
    name: "soundbox.get_sound",
    title: "Get one sound",
    description: "Fetch a single sound by id, including its absolute file path.",
    calls: 0,
  },
  {
    name: "soundbox.delete_sound",
    title: "Delete a sound",
    description: "Permanently delete a sound and its audio file.",
    calls: 0,
  },
  {
    name: "soundbox.list_voices",
    title: "List saved voices",
    description:
      "List the saved voices a script can be read in. Call this before " +
      "writing a story so lines can be cast to real voice ids.",
    calls: 0,
  },
  {
    name: "soundbox.speak",
    title: "Speak a line or a dialogue",
    description:
      "Read text aloud in a saved voice and save it to the library. One line " +
      "or several with different voices, each on its own voice's model " +
      "unless `model` overrides it. Blocks until the audio is on disk. " +
      "`delivery` shapes the performance — never write stage directions into " +
      "the text, they get read aloud. For anything you want to keep and " +
      "arrange, build a story instead.",
    calls: 0,
  },
  {
    name: "soundbox.create_story",
    title: "Start a story",
    description:
      "Create a story — a script that persists, whose lines carry a place in " +
      "time and can be voiced, arranged and mixed down. `delivery` here sets " +
      "how every line is read unless it overrides it.",
    calls: 0,
  },
  {
    name: "soundbox.list_stories",
    title: "List stories",
    description: "List existing stories, most recently worked on first.",
    calls: 0,
  },
  {
    name: "soundbox.get_story",
    title: "Read a story",
    description:
      "Fetch a story with every line: text, voice, timing, and whether it has " +
      "been voiced yet, plus each touched track's mix and device chain. This " +
      "is how you inspect what you have built.",
    calls: 0,
  },
  {
    name: "soundbox.add_lines",
    title: "Add lines to a story",
    description:
      "Append lines to a story's script — spoken lines, pauses, or existing " +
      "library sounds dropped onto the timeline. Adds many at once, each with " +
      "its own `delivery` if one line should be read differently.",
    calls: 0,
  },
  {
    name: "soundbox.update_line",
    title: "Edit or arrange a line",
    description:
      "Change a line's words, voice, delivery, or where it sits in time — " +
      "start, track, gain, mute, and the trim that shortens a clip without " +
      "destroying audio. Changing words or delivery needs the line re-read " +
      "before it is heard.",
    calls: 0,
  },
  {
    name: "soundbox.speak_story",
    title: "Voice a story",
    description:
      "Read every line of a story that has no audio yet, in its assigned " +
      "voice and on that voice's own model unless `model` overrides it. " +
      "Blocks until they are all recorded. This is the slow one.",
    calls: 0,
  },
  {
    name: "soundbox.open_in_studio",
    title: "Open a sound in the studio",
    description:
      "Open a library sound on a timeline, split into its stems on separate " +
      "tracks where that is possible. Name `stems` to lay out only some of " +
      "them. Reuses stems the sound already has rather than making more.",
    calls: 0,
  },
  {
    name: "soundbox.mix_track",
    title: "Mute, solo or set a track's level",
    description:
      "Control one lane of a story: name it, mute it, solo it, or set its " +
      "volume. These belong to the lane, not to the clips on it.",
    calls: 0,
  },
  {
    name: "soundbox.add_device",
    title: "Add an effect to a track",
    description:
      "Put a device (compressor, eq, reverb, delay, distortion, gate, limiter, " +
      "autotune) on one lane of a story, at the end of its chain or at " +
      "`position`. It starts at its defaults; pass `params` to set knobs as it " +
      "goes on. The studio's device rack shows it straight away. Heard in the " +
      "studio's timeline playback; soundbox.export_story still mixes dry.",
    calls: 0,
  },
  {
    name: "soundbox.set_device",
    title: "Turn a device's knobs",
    description:
      "Change the knobs on a device already on a track, or bypass it (it stays " +
      "in the chain with its settings, out of the signal path). Name the device " +
      "by its id, or by kind when the track has only one of that kind. Values " +
      "past a knob's range land at its end, and the result says which did.",
    calls: 0,
  },
  {
    name: "soundbox.remove_device",
    title: "Take an effect off a track",
    description:
      "Remove one device from a track's chain, by id, or by kind when the " +
      "track has only one of that kind. Use `bypassed` on soundbox.set_device " +
      "instead to switch it off and keep its settings.",
    calls: 0,
  },
  {
    name: "soundbox.remove_track",
    title: "Remove a track",
    description:
      "Delete a lane and the clips on it. Lanes above slide down. Use " +
      "soundbox.get_story first if you are not certain what is on it.",
    calls: 0,
  },
  {
    name: "soundbox.delete_line",
    title: "Delete a line",
    description: "Remove one line from a story. Its audio stays in the library.",
    calls: 0,
  },
  {
    name: "soundbox.split_line",
    title: "Split a line in two",
    description:
      "Cut a voiced line at a point in it, as it plays on the timeline, giving " +
      "two clips. The " +
      "words stay with the first half — there is no honest way to know which " +
      "fell either side of the cut.",
    calls: 0,
  },
  {
    name: "soundbox.export_story",
    title: "Mix a story down",
    description:
      "Mix the whole arrangement to one sound, honouring where each clip sits, " +
      "its trim, its gain, and whether it is muted.",
    calls: 0,
  },
];

/** Fresh copies so a caller mutating `calls` can't corrupt the module table. */
export function toolInfos(): McpToolInfo[] {
  return MCP_TOOLS.map((t) => ({ ...t }));
}

const GENERATE_INPUT = {
  prompt: z
    .string()
    .describe(
      "What the sound is. Describe material, action and space — " +
        "'glass bottle shattering on tile, small reverberant room'. For a " +
        "lyrics-conditioned model (see `lyrics`), this instead sets the " +
        "genre and instrumentation — 'dark orchestral-hybrid theme, slow " +
        "dirge tempo, mournful choir vocals'.",
    ),
  duration_s: z
    .number()
    .min(0.5)
    .max(300)
    .default(5.0)
    .describe(
      "Clip length in seconds. Clamped to the model's own max_duration_s — " +
        "check soundbox.list_models for per-model limits.",
    ),
  model: z
    .string()
    .optional()
    .describe("Model id. Defaults to whichever model is already loaded."),
  negative_prompt: z
    .string()
    .optional()
    .describe("What to avoid. Ignored by models that lack it."),
  seed: z.number().int().min(0).optional().describe("Seed for reproducibility."),
  variations: z
    .number()
    .int()
    .min(1)
    .max(4)
    .default(1)
    .describe("How many different takes to generate."),
  tags: z.array(z.string()).optional().describe("Library tags."),
  lyrics: z
    .string()
    .max(4000)
    .optional()
    .describe(
      "Words for a lyrics-conditioned vocal music model (ACE-Step) to sing, " +
        "e.g. '[verse]\\nGame over\\nYou have fallen'. Ignored by models that " +
        "don't support lyrics — check `supports.lyrics` via soundbox.list_models. " +
        "Omit for an instrumental render.",
    ),
  track_name: z
    .string()
    .max(200)
    .optional()
    .describe("Optional track title, only used alongside `lyrics`."),
  source_sound_id: z
    .string()
    .optional()
    .describe(
      "Edit an existing library sound instead of rendering from scratch. " +
        "Pair with `edit`. The model must declare `supports.<edit>` in " +
        "soundbox.list_models (ACE-Step does; MiniMax Music 3 does not). " +
        "The result is a new sound whose `parent_id` is this one.",
    ),
  edit: z
    .enum(["extend", "cover", "repaint"])
    .optional()
    .describe(
      "What to do with `source_sound_id`: 'extend' continues it so the " +
        "result is `duration_s` seconds long (must exceed the source) with " +
        "the original kept intact at the start; 'cover' re-renders it in the " +
        "style of `prompt` (and `lyrics`) at the source's length; 'repaint' " +
        "regenerates edit_options.repaint_start_s..repaint_end_s.",
    ),
  edit_options: z
    .object({
      cover_strength: z.number().min(0).max(1).optional().describe("cover: 1 stays close to the source, 0 is loose."),
      repaint_start_s: z.number().min(0).optional(),
      repaint_end_s: z.number().min(0).optional(),
      repaint_mode: z.enum(["balanced", "conservative", "aggressive"]).optional(),
      repaint_strength: z.number().min(0).max(1).optional(),
    })
    .optional(),
};

const ENHANCE_INPUT = {
  prompt: z.string().min(1).max(2000).describe("The prompt to rewrite."),
  n: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(1)
    .describe("How many distinct variations to return."),
  category: z
    .enum(["sfx", "music"])
    .optional()
    .describe("Which kind of model this is for — sfx (default) or music."),
  lyrics: z
    .boolean()
    .optional()
    .describe("True if this sets genre/instrumentation for a lyrics-conditioned model."),
  model: z
    .string()
    .optional()
    .describe(
      "The model id you intend to pass to soundbox.generate. Grounds the " +
        "rewrite in that model's own documented prompting conventions — " +
        "check soundbox.list_models for ids. Omit for generic guidance.",
    ),
};

const LIST_SOUNDS_INPUT = {
  q: z.string().optional().describe("Text to match in prompt or name."),
  tag: z.string().optional().describe("Filter by tag."),
  voice_id: z
    .string()
    .optional()
    .describe(
      "Only sounds read in this saved voice (an id from soundbox.list_voices). " +
        "Multi-voice dialogues are not filed under any one speaker.",
    ),
  limit: z.number().int().min(1).max(100).default(20),
};

/** MCP wants content blocks; JSON text is what every client renders sensibly. */
function json(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function text(value: string): CallToolResult {
  return { content: [{ type: "text", text: value }] };
}

/**
 * `(client_name, client_version, session_id)` for one call.
 *
 * `clientInfo` is what the agent announced at `initialize` — "claude-code",
 * "cursor", "mcp-inspector" — and is the only identity we have; there is no
 * auth. Missing pieces come back as null rather than raising: a client that
 * skipped clientInfo still gets served, it just shows as "unknown".
 */
function clientOf(
  server: McpServer,
  extra: { sessionId?: string; requestInfo?: { headers?: Record<string, unknown> } },
  transport: "http" | "stdio",
): TrackOptions {
  let clientName: string | null = null;
  let clientVersion: string | null = null;
  const info = server.server.getClientVersion();
  if (info) {
    clientName = info.name || null;
    clientVersion = info.version || null;
  }
  // Streamable HTTP carries the session in a header; stdio has no session.
  const header = extra.requestInfo?.headers?.["mcp-session-id"];
  const sessionId =
    extra.sessionId || (typeof header === "string" ? header : null) || null;
  return { clientName, clientVersion, sessionId, transport };
}

/** Poll the in-process job until it settles. Polling rather than subscribing
 *  keeps this independent of the SSE plumbing. `onTick` sees every poll — it
 *  is how a caller's ProgressReporter hears about the job. */
async function awaitJob(
  svc: SoundboxService,
  jobId: string,
  onTick?: (job: Job) => void,
  timeoutS = 900.0,
) {
  let waited = 0.0;
  while (waited < timeoutS) {
    const job = svc.jobs.get(jobId);
    if (job === null) throw new Error(`Job ${jobId} disappeared`);
    onTick?.(job);
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
      return job;
    }
    await new Promise((r) => setTimeout(r, 250));
    waited += 0.25;
  }
  svc.jobs.cancel(jobId);
  throw new Error(`Generation did not finish within ${timeoutS}s`);
}



/**
 * Run some agent work with the story marked as claimed, so the studio can say
 * who is doing what and stop taking edits that would race it.
 *
 * Wrapped rather than left to each tool because the release has to happen on
 * the failure path too — a tool that throws while holding a story would leave
 * the studio disabled with nothing working on it.
 */
async function claiming<T>(
  svc: SoundboxService,
  storyId: string,
  label: string,
  work: () => Promise<T> | T,
): Promise<T> {
  const release = svc.stories.claim(storyId, label);
  try {
    return await work();
  } finally {
    release();
  }
}

/**
 * Where a story lives in the app, so a chat can offer to open it rather than
 * describe it. The studio is the honest representation of a timeline; a
 * transcript of every clip's start time is not.
 *
 * Which of the two builders opens it is the story's own answer — a script
 * dropped into the Music Builder would arrive with its script panel missing.
 */
function studioUrl(svc: SoundboxService, story_id: string): string {
  const builder = svc.getStory(story_id)?.builder ?? "script";
  return `http://${DEFAULT_HOST}:${DEFAULT_PORT}/#/studio/${builder}/${story_id}`;
}

/**
 * What a story looks like when the answer is "I built this", not "inspect
 * this".
 *
 * Returning every line means a chat full of JSON that nobody reads and that
 * pushes the actual result off the screen. The counts are what a person checks
 * — did it get all my lines, is anything still silent — and the link is how
 * they see the rest. `soundbox.get_story` still returns the lines, because
 * that call is explicitly asking for them.
 */
function storySummary(svc: SoundboxService, storyId: string) {
  const story = svc.getStory(storyId);
  if (story === null) throw new Error("No story with id " + storyId);
  const lines = svc.listSegments(storyId);
  const spoken = lines.filter((l) => l.kind === "line");
  const tracks = new Set(lines.map((l) => l.track_index));
  const end = lines.reduce((e, l) => Math.max(e, l.start_s + (l.duration_s ?? 0)), 0);

  return {
    story_id: story.id,
    title: story.title,
    lines: spoken.length,
    pauses: lines.length - spoken.length,
    voiced: lines.filter((l) => l.sound_id).length,
    // Only worth saying when there is more than one; a single-track story is
    // just "a story".
    tracks: tracks.size > 1 ? tracks.size : undefined,
    duration_s: Math.round(end * 10) / 10,
    delivery:
      Object.keys(story.request_options).length > 0 ? story.request_options : undefined,
    open_in_studio: studioUrl(svc, story.id),
  };
}

/* ----------------------------------------------------------- voice bits */

/**
 * How a line should be read, by the chosen model family's own option names.
 *
 * Deliberately free-form rather than an enum: the names differ per family
 * (Chatterbox's `exaggeration`, IndexTTS2's `emotion_text`) and the authority
 * on them is the `delivery` list soundbox.list_models returns for that model.
 * Values are strings because that is what audio.cpp takes.
 *
 * The trap worth knowing: audio.cpp accepts an unknown key silently. A
 * misspelled name is not an error, it is a setting that does nothing — so read
 * the names off list_models rather than from memory or a model card.
 */
const DELIVERY_INPUT = z
  .record(z.string().max(60), z.string().max(2000))
  .describe(
    "How to read it, using this model's own option names — see the `delivery` " +
      "list from soundbox.list_models (e.g. {\"exaggeration\": \"1.4\"}). " +
      "Unknown names are ignored silently, so take them from there.",
  );

const SPEAK_INPUT = {
  lines: z
    .array(
      z.object({
        text: z.string().min(1).max(20000),
        voice_id: z
          .string()
          .nullish()
          .describe("A saved voice id from soundbox.list_voices. Omit for the model default."),
        speaker: z.string().max(80).nullish().describe("Display name, e.g. 'Narrator'."),
      }),
    )
    .min(1)
    .max(200)
    .describe("The script. Several lines with different voice_ids is a dialogue."),
  model: z
    .string()
    .optional()
    .describe(
      "A text-to-speech model id for every line. Omit it and each line is " +
        "read on its voice's own model (list_voices' `model_id`), or a ready " +
        "one for a line with no voice or a voice with no model.",
    ),
  gap_s: z.number().min(0).max(5).optional().describe("Silence between lines. Default 0.4."),
  name: z.string().max(200).optional(),
  delivery: DELIVERY_INPUT.optional(),
};

const ADD_LINES_INPUT = {
  story_id: z.string(),
  lines: z
    .array(
      z.object({
        text: z.string().max(20000).optional().describe("What is said. Empty for a pause."),
        speaker: z.string().max(80).nullish(),
        voice_id: z.string().nullish().describe("A saved voice id from soundbox.list_voices."),
        kind: z
          .enum(["line", "pause"])
          .optional()
          .describe("'pause' is a beat of silence whose length is duration_s."),
        duration_s: z
          .number()
          .min(0)
          .max(600)
          .nullish()
          .describe("A pause's length. Ignored for a spoken line."),
        sound_id: z
          .string()
          .nullish()
          .describe("Drop an existing library sound in instead of writing a line to speak."),
        track_index: z.number().int().min(-16).max(16).optional().describe("Timeline lane."),
        start_s: z
          .number()
          .min(0)
          .nullish()
          .describe("Where it sits in time. Omit to append after the track's last clip."),
        delivery: DELIVERY_INPUT.optional(),
      }),
    )
    .min(1)
    .max(200),
};

const UPDATE_LINE_INPUT = {
  line_id: z.string(),
  text: z.string().max(20000).optional(),
  speaker: z.string().max(80).nullish(),
  voice_id: z.string().nullish(),
  track_index: z.number().int().min(-16).max(16).optional(),
  start_s: z.number().min(0).optional(),
  muted: z.boolean().optional(),
  gain_db: z.number().min(-40).max(24).optional(),
  duration_s: z
    .number()
    .min(0)
    .max(600)
    .optional()
    .describe("How much of the clip plays — shorten a clip without destroying its audio."),
  trim_start_s: z
    .number()
    .min(0)
    .optional()
    .describe("How far into the source sound the clip begins."),
  delivery: DELIVERY_INPUT.optional().describe(
    "How to read this line, overriding the story's. `{}` puts it back on the " +
      "story's delivery. Re-read the line afterwards for it to be heard.",
  ),
};

/**
 * A line as an agent should see it: what it says, who says it, where it sits,
 * and whether it has actually been recorded yet. The stored row carries more
 * (ids, timestamps, the hydrated Sound) that only the UI needs.
 */
function lineView(seg: StorySegment) {
  return {
    id: seg.id,
    kind: seg.kind,
    position: seg.position,
    text: seg.text,
    speaker: seg.speaker ?? null,
    voice_id: seg.voice_id ?? null,
    track_index: seg.track_index,
    start_s: seg.start_s,
    duration_s: seg.duration_s ?? null,
    trim_start_s: seg.trim_start_s ?? 0,
    muted: seg.muted,
    gain_db: seg.gain_db,
    voiced: Boolean(seg.sound_id),
    sound_id: seg.sound_id ?? null,
    // Omitted when empty rather than shown as {}: a line with no delivery of
    // its own is following the story's, and saying so with an empty object in
    // every line of a forty-line script is noise.
    delivery: Object.keys(seg.request_options).length > 0 ? seg.request_options : undefined,
  };
}

/**
 * Which model reads one line, and why — when the reason is worth saying.
 *
 * `note` is set only when the model is not the one the line's voice asked
 * for, so a caller can tell the user their clone was read on something else
 * rather than leave them wondering why it does not sound like the voice.
 */
interface TtsChoice {
  model: string;
  note?: string;
}

/**
 * Resolve which model reads each line of a script.
 *
 * Speaking needs a "tts" model specifically, and the resident one is usually a
 * sound-effects model — so unlike soundbox.generate this cannot just fall back
 * to whatever is loaded. The order, per line:
 *
 *   1. an explicit `model` — the caller asked, every line uses it;
 *   2. the line's voice's `model_id`, when that model is installed — a voice
 *      is made on a model, and a clone read on another family does not sound
 *      like the voice (Chatterbox's "guy" read on Vevo2 is a stranger);
 *   3. a ready TTS model, preferring the loaded one to save a cold start.
 *
 * Returns a per-line resolver rather than one id because a story is a cast:
 * two characters can be voices on two families, and each is read on its own.
 * The model list is read once, up front; the default is only demanded (and
 * its absence only reported) when a line actually needs it.
 */
async function ttsResolver(
  svc: SoundboxService,
  requested?: string,
): Promise<(voiceId: string | null | undefined) => TtsChoice> {
  const models = await svc.listModels();
  const tts = models.filter((m) => m.task === "tts");
  if (requested) {
    const chosen = tts.find((m) => m.id === requested);
    if (!chosen) {
      throw new Error(
        requested + " is not a text-to-speech model. Ready ones: " +
          (tts.map((m) => m.id).join(", ") || "none installed"),
      );
    }
    return () => ({ model: chosen.id });
  }
  const ready = tts.filter((m) => m.status === "loaded" || m.status === "installed");
  const fallback = (): string => {
    if (!ready.length) {
      throw new Error(
        "No text-to-speech model is installed. Open the Soundbox app and download " +
          "one from the Models tab.",
      );
    }
    return (ready.find((m) => m.status === "loaded") ?? ready[0]!).id;
  };
  return (voiceId) => {
    const voice = voiceId ? svc.getVoice(voiceId) : null;
    const wanted = voice?.model_id ?? null;
    if (wanted === null) return { model: fallback() };
    if (ready.some((m) => m.id === wanted)) return { model: wanted };
    const model = fallback();
    return {
      model,
      note:
        `${voice!.name} was made on ${wanted}, which is not installed, so it ` +
        `was read on ${model} instead and may not sound like the voice.`,
    };
  };
}

/** What a multi-line read used, in a shape worth handing back: a count per
 *  model, and each fallback note once rather than once per line. */
function modelsUsed(choices: TtsChoice[]): {
  models: Record<string, number>;
  notes?: string[];
} {
  const models: Record<string, number> = {};
  for (const c of choices) models[c.model] = (models[c.model] ?? 0) + 1;
  const notes = [...new Set(choices.flatMap((c) => (c.note ? [c.note] : [])))];
  return { models, notes: notes.length ? notes : undefined };
}

/**
 * Construct the MCP server. `getService` is a late-bound accessor so the tools
 * resolve the service at call time, after startup has built it.
 */
export function buildMcp(
  getService: () => SoundboxService,
  transport: "http" | "stdio" = "http",
): McpServer {
  const mcp = new McpServer(
    { name: "soundbox", version: VERSION },
    { instructions: MCP_INSTRUCTIONS },
  );

  type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

  /** Telemetry wrapper for one call — see telemetry.McpTelemetry.track. */
  function track<T>(
    extra: Extra,
    tool: string,
    args: Record<string, unknown>,
    fn: (rec: CallRecord) => Promise<T> | T,
  ): Promise<T> {
    return getService().telemetry.track(tool, args, clientOf(mcp, extra, transport), fn);
  }

  function originOf(extra: Extra): Origin {
    const who = clientOf(mcp, extra, transport);
    return {
      source: "mcp",
      client_name: who.clientName ?? null,
      client_version: who.clientVersion ?? null,
      mcp_session_id: who.sessionId ?? null,
    };
  }

  const meta = Object.fromEntries(MCP_TOOLS.map((t) => [t.name, t]));

  mcp.registerTool(
    "soundbox.generate",
    {
      title: meta["soundbox.generate"].title ?? undefined,
      description: meta["soundbox.generate"].description,
      inputSchema: GENERATE_INPUT,
    },
    async (args, extra) => {
      const {
        prompt, duration_s, model, negative_prompt, seed, variations, tags, lyrics, track_name,
        source_sound_id, edit, edit_options,
      } = args;
      return await track(
        extra,
        "soundbox.generate",
        {
          prompt, duration_s, model, negative_prompt, seed, variations, tags, lyrics, track_name,
          source_sound_id, edit, edit_options,
        },
        async (rec) => {
          const svc = getService();
          let modelId = model ?? svc.models.resident;
          if (modelId === null || modelId === undefined) {
            const models = await svc.listModels();
            const ready = models.filter(
              (e) => e.status === "installed" || e.status === "loaded",
            );
            if (!ready.length) {
              throw new Error(
                "No local model is installed yet. Open the Soundbox app and download " +
                  "one from the Models tab, or call soundbox.list_models to see options.",
              );
            }
            modelId = ready[0].id;
          }
          rec.setModel(modelId);

          const started = performance.now();
          const job = svc.submitGenerate({
            model: modelId,
            prompt,
            negative_prompt: negative_prompt ?? null,
            duration_s,
            seed: seed ?? null,
            variations,
            tags: tags ?? [],
            lyrics: lyrics ?? null,
            track_name: track_name ?? null,
            source_sound_id: source_sound_id ?? null,
            edit: edit ?? null,
            edit_options: edit_options ?? null,
            origin: originOf(extra),
          });
          rec.setJob(job.id);
          const progress = new ProgressReporter(extra);
          const finished = await awaitJob(svc, job.id, (j) => progress.job(j));
          if (finished.status === "error") throw new Error(finished.error || "Generation failed");
          if (finished.status === "cancelled") throw new Error("Generation was cancelled");

          const ids = ((finished.result ?? {}).sounds as string[] | undefined) ?? [];
          rec.setSounds(ids);
          const sounds = ids.map((i) => svc.getSound(i)).filter((s): s is Sound => s !== null);
          const result: GenerateResult = {
            sounds: sounds.map((s) => toResult(svc, s)),
            model: modelId,
            elapsed_s: Math.round((performance.now() - started) / 10) / 100,
          };
          return json(result);
        },
      );
    },
  );

  mcp.registerTool(
    "soundbox.enhance_prompt",
    {
      title: meta["soundbox.enhance_prompt"].title ?? undefined,
      description: meta["soundbox.enhance_prompt"].description,
      inputSchema: ENHANCE_INPUT,
    },
    async ({ prompt, n, category, lyrics, model }, extra) =>
      await track(extra, "soundbox.enhance_prompt", { prompt, n, category, model }, async () => {
        try {
          const result = await getService().enhancePrompt({ prompt, n, category, lyrics, model });
          return json(result);
        } catch (exc) {
          // Degrade gracefully rather than error the call — "off" is a normal,
          // common state (it defaults off), not something an agent did wrong.
          return text(exc instanceof Error ? exc.message : String(exc));
        }
      }),
  );

  mcp.registerTool(
    "soundbox.list_models",
    {
      title: meta["soundbox.list_models"].title ?? undefined,
      description: meta["soundbox.list_models"].description,
    },
    async (extra) =>
      await track(extra, "soundbox.list_models", {}, async () =>
        json((await getService().listModels()).map(summarise)),
      ),
  );

  mcp.registerTool(
    "soundbox.list_sounds",
    {
      title: meta["soundbox.list_sounds"].title ?? undefined,
      description: meta["soundbox.list_sounds"].description,
      inputSchema: LIST_SOUNDS_INPUT,
    },
    async ({ q, tag, voice_id, limit }, extra) =>
      await track(extra, "soundbox.list_sounds", { q, tag, voice_id, limit }, async (rec) => {
        const svc = getService();
        const page = svc.listSounds({
          limit,
          q: q ?? null,
          tag: tag ?? null,
          voice_id: voice_id ?? null,
        });
        rec.setSounds(page.items.map((s) => s.id));
        const separators = await separatorIds(svc);
        return json(page.items.map((s) => toResult(svc, s, separators)));
      }),
  );

  mcp.registerTool(
    "soundbox.get_sound",
    {
      title: meta["soundbox.get_sound"].title ?? undefined,
      description: meta["soundbox.get_sound"].description,
      inputSchema: { sound_id: z.string() },
    },
    async ({ sound_id }, extra) =>
      await track(extra, "soundbox.get_sound", { sound_id }, async (rec) => {
        const svc = getService();
        const sound = svc.getSound(sound_id);
        if (sound === null) throw new Error(`No sound with id ${sound_id}`);
        rec.setSounds([sound.id]);
        return json(toResult(svc, sound, await separatorIds(svc)));
      }),
  );

  mcp.registerTool(
    "soundbox.delete_sound",
    {
      title: meta["soundbox.delete_sound"].title ?? undefined,
      description: meta["soundbox.delete_sound"].description,
      inputSchema: { sound_id: z.string() },
    },
    async ({ sound_id }, extra) =>
      await track(extra, "soundbox.delete_sound", { sound_id }, async (rec) => {
        if (!(await getService().deleteSound(sound_id))) {
          throw new Error(`No sound with id ${sound_id}`);
        }
        rec.setSounds([sound_id]);
        return text(`Deleted ${sound_id}`);
      }),
  );

  /* ------------------------------------------------------------- voice */

  mcp.registerTool(
    "soundbox.list_voices",
    {
      title: meta["soundbox.list_voices"].title ?? undefined,
      description: meta["soundbox.list_voices"].description,
    },
    async (extra) =>
      await track(extra, "soundbox.list_voices", {}, () =>
        json(
          getService()
            .listVoices()
            .map((v) => ({
              id: v.id,
              name: v.name,
              kind: v.kind,
              // A builtin belongs to one model family and means nothing to
              // another, so the caller has to know which.
              model_id: v.model_id ?? null,
              notes: v.notes ?? null,
            })),
        ),
      ),
  );

  mcp.registerTool(
    "soundbox.speak",
    {
      title: meta["soundbox.speak"].title ?? undefined,
      description: meta["soundbox.speak"].description,
      inputSchema: SPEAK_INPUT,
    },
    async ({ lines, model, gap_s, name, delivery }, extra) =>
      await track(extra, "soundbox.speak", { lines, model, gap_s, name, delivery }, async (rec) => {
        const svc = getService();
        const resolve = await ttsResolver(svc, model);
        const choices = lines.map((l) => resolve(l.voice_id));
        // The job's own model is the first line's: it is what a one-voice read
        // is stamped with, and each line still carries the one it is read on.
        const modelId = choices[0]!.model;
        rec.setModel(modelId);
        const progress = new ProgressReporter(extra);
        const job = await awaitJob(
          svc,
          svc.submitSpeak({
            model: modelId,
            lines: lines.map((l, i) => ({
              text: l.text,
              voice_id: l.voice_id ?? null,
              speaker: l.speaker ?? null,
              model: choices[i]!.model,
            })),
            gap_s: gap_s ?? 0.4,
            load_options: {},
      request_options: delivery ?? {},
            tags: [],
            name: name ?? null,
            origin: { source: "mcp" },
          }).id,
          (j) => progress.job(j),
        );
        if (job.status !== "done") throw new Error(job.error ?? "The read " + job.status);
        const ids = (job.result?.sounds as string[]) ?? [];
        rec.setSounds(ids);
        const { models, notes } = modelsUsed(choices);
        return json(
          ids.map((id) => ({
            ...toResult(svc, svc.getSound(id)!),
            // `model` alone cannot say a dialogue was read on two families.
            models: Object.keys(models).length > 1 ? models : undefined,
            notes,
          })),
        );
      }),
  );

  /* ----------------------------------------------------------- stories */

  mcp.registerTool(
    "soundbox.create_story",
    {
      title: meta["soundbox.create_story"].title ?? undefined,
      description: meta["soundbox.create_story"].description,
      inputSchema: {
        title: z.string().max(200).optional().describe("What this story is."),
        delivery: DELIVERY_INPUT.optional().describe(
          "How every line in this story should be read unless it says otherwise. " +
            "Set it here rather than per line — a script usually wants one " +
            "delivery throughout and an exception on a line or two.",
        ),
      },
    },
    async ({ title, delivery }, extra) =>
      await track(extra, "soundbox.create_story", { title, delivery }, () => {
        const svc = getService();
        const story = svc.createStory(title ?? null);
        if (delivery && Object.keys(delivery).length > 0) {
          svc.setStoryOptions(story.id, delivery);
        }
        return json(storySummary(svc, story.id));
      }),
  );

  mcp.registerTool(
    "soundbox.list_stories",
    {
      title: meta["soundbox.list_stories"].title ?? undefined,
      description: meta["soundbox.list_stories"].description,
      inputSchema: { limit: z.number().int().min(1).max(200).default(20) },
    },
    async ({ limit }, extra) =>
      await track(extra, "soundbox.list_stories", { limit }, () =>
        json(getService().listStories(limit)),
      ),
  );

  mcp.registerTool(
    "soundbox.get_story",
    {
      title: meta["soundbox.get_story"].title ?? undefined,
      description: meta["soundbox.get_story"].description,
      inputSchema: { story_id: z.string() },
    },
    async ({ story_id }, extra) =>
      await track(extra, "soundbox.get_story", { story_id }, () => {
        const svc = getService();
        const story = svc.getStory(story_id);
        if (story === null) throw new Error("No story with id " + story_id);
        return json({
          ...story,
          open_in_studio: studioUrl(svc, story_id),
          lines: svc.listSegments(story_id).map(lineView),
          // Only lanes that have been touched have a row; the rest are at
          // defaults with an empty rack.
          tracks: svc.listTracks(story_id),
        });
      }),
  );

  mcp.registerTool(
    "soundbox.add_lines",
    {
      title: meta["soundbox.add_lines"].title ?? undefined,
      description: meta["soundbox.add_lines"].description,
      inputSchema: ADD_LINES_INPUT,
    },
    async ({ story_id, lines }, extra) =>
      await track(extra, "soundbox.add_lines", { story_id, lines }, () => {
        const svc = getService();
        if (svc.getStory(story_id) === null) throw new Error("No story with id " + story_id);
        return claiming(svc, story_id, "writing lines", () => {
        const added = lines.map((l) =>
            lineView(
              svc.createSegment(story_id, {
                text: l.text ?? "",
                speaker: l.speaker ?? null,
                voice_id: l.voice_id ?? null,
                kind: l.kind ?? "line",
                duration_s: l.duration_s ?? null,
                sound_id: l.sound_id ?? null,
                track_index: l.track_index ?? 0,
                start_s: l.start_s ?? null,
                language: null,
                request_options: l.delivery,
              }),
            ),
        );
        return json({ added: added.length, ...storySummary(svc, story_id) });
        });
      }),
  );

  mcp.registerTool(
    "soundbox.update_line",
    {
      title: meta["soundbox.update_line"].title ?? undefined,
      description: meta["soundbox.update_line"].description,
      inputSchema: UPDATE_LINE_INPUT,
    },
    async (args, extra) =>
      await track(extra, "soundbox.update_line", { ...args }, () => {
        const { line_id, delivery, ...rest } = args;
        // `delivery` is this surface's name for the stored request options —
        // the same rename `line_id` makes for a segment id. Sent-at-all rather
        // than truthy, because `{}` is a real instruction: follow the story.
        const patch = delivery === undefined ? rest : { ...rest, request_options: delivery };
        const updated = getService().updateSegment(line_id, patch);
        if (updated === null) throw new Error("No line with id " + line_id);
        return json(lineView(updated));
      }),
  );

  mcp.registerTool(
    "soundbox.speak_story",
    {
      title: meta["soundbox.speak_story"].title ?? undefined,
      description: meta["soundbox.speak_story"].description,
      inputSchema: {
        story_id: z.string(),
        model: z
          .string()
          .optional()
          .describe(
            "A text-to-speech model id for every line. Omit it and each line " +
              "is read on its voice's own model (list_voices' `model_id`), or " +
              "a ready one for a line with no voice or a voice with no model.",
          ),
        regenerate: z
          .boolean()
          .default(false)
          .describe("Re-read lines that already have audio, not only the silent ones."),
      },
    },
    async ({ story_id, model, regenerate }, extra) =>
      await track(extra, "soundbox.speak_story", { story_id, model, regenerate }, async (rec) => {
        const svc = getService();
        if (svc.getStory(story_id) === null) throw new Error("No story with id " + story_id);
        const resolve = await ttsResolver(svc, model);
        const todo = svc
          .listSegments(story_id)
          .filter((l) => l.kind === "line" && l.text.trim() && (!l.sound_id || regenerate));
        // Resolved before reading anything, so a script with no usable model
        // fails now rather than after the first few lines have been read.
        const choices = todo.map((l) => resolve(l.voice_id));
        if (choices[0]) rec.setModel(choices[0].model);

        return claiming(svc, story_id, "reading the script", async () => {
        // One at a time, not in parallel: each read is an audio.cpp subprocess
        // against one loaded model, so racing them would fight over the same
        // GPU rather than finish sooner. Each line on its own voice's model —
        // a cast can span families, and the manager swaps between them.
        const done: string[] = [];
        // The whole script is one bar: each line's read fills its own share.
        const progress = new ProgressReporter(extra);
        for (const [i, line] of todo.entries()) {
          const job = await awaitJob(
            svc,
            svc.submitSegmentGenerate(line.id, { model: choices[i]!.model, load_options: {} }).id,
            progress.step(i, todo.length, `line ${i + 1} of ${todo.length}`),
          );
          if (job.status !== "done") throw new Error(job.error ?? "A read " + job.status);
          done.push(...((job.result?.sounds as string[]) ?? []));
        }
        rec.setSounds(done);
        return json({ read: done.length, ...modelsUsed(choices), ...storySummary(svc, story_id) });
        });
      }),
  );

  mcp.registerTool(
    "soundbox.export_story",
    {
      title: meta["soundbox.export_story"].title ?? undefined,
      description: meta["soundbox.export_story"].description,
      inputSchema: { story_id: z.string() },
    },
    async ({ story_id }, extra) =>
      await track(extra, "soundbox.export_story", { story_id }, async (rec) => {
        const svc = getService();
        return claiming(svc, story_id, "mixing it down", async () => {
        const progress = new ProgressReporter(extra);
        const job = await awaitJob(svc, svc.submitStoryExport(story_id).id, (j) => progress.job(j));
        if (job.status !== "done") throw new Error(job.error ?? "The export " + job.status);
        const ids = (job.result?.sounds as string[]) ?? [];
        rec.setSounds(ids);
        const sound = ids[0] ? svc.getSound(ids[0]) : null;
        if (sound === null) throw new Error("The export produced no audio.");
        return json({ ...toResult(svc, sound), open_in_studio: studioUrl(svc, story_id) });
        });
      }),
  );

  mcp.registerTool(
    "soundbox.separate",
    {
      title: meta["soundbox.separate"].title ?? undefined,
      description: meta["soundbox.separate"].description,
      inputSchema: {
        sound_id: z.string().describe("Library sound to split."),
        model: z
          .string()
          .optional()
          .describe(
            'Separation model id. Omit for whichever `task: "sep"` model is ' +
              "installed, preferring one already loaded.",
          ),
        stems: z
          .array(z.string().max(40))
          .max(16)
          .optional()
          .describe(
            'Which stems to keep, e.g. ["vocals"]. Omit for all of them. A ' +
              "name nothing answers to is reported back, not silently dropped.",
          ),
        rest: z
          .enum(["discard", "merge"])
          .default("discard")
          .describe(
            "What happens to the stems not named: thrown away, or summed " +
              'into one "rest" sound — the original minus what was taken out. ' +
              "Ignored when `stems` is omitted, since nothing is left over.",
          ),
      },
    },
    async ({ sound_id, model, stems, rest }, extra) =>
      await track(extra, "soundbox.separate", { sound_id, model, stems, rest }, async (rec) => {
        const svc = getService();
        // Blocking like generate and speak: separation is a queued job, but a
        // job id is not an answer to "give me the vocal" — the stems are.
        const modelId = model ?? (await defaultSeparator(svc));
        rec.setModel(modelId);
        const started = performance.now();
        const progress = new ProgressReporter(extra);
        const job = await awaitJob(
          svc,
          svc.submitSeparate({
            model: modelId,
            source_sound_id: sound_id,
            stems: stems?.length ? { keep: stems, rest } : null,
          }).id,
          (j) => progress.job(j),
        );
        if (job.status === "error") throw new Error(job.error || "Separation failed");
        if (job.status === "cancelled") throw new Error("Separation was cancelled");

        const ids = ((job.result ?? {}).sounds as string[] | undefined) ?? [];
        rec.setSounds(ids);
        const separators = await separatorIds(svc);
        const sounds = ids
          .map((i) => svc.getSound(i))
          .filter((x): x is Sound => x !== null)
          .map((x) => toResult(svc, x, separators));
        const result: GenerateResult = {
          sounds,
          model: modelId,
          elapsed_s: Math.round((performance.now() - started) / 10) / 100,
        };
        return json(result);
      }),
  );

  mcp.registerTool(
    "soundbox.open_in_studio",
    {
      title: meta["soundbox.open_in_studio"].title ?? undefined,
      description: meta["soundbox.open_in_studio"].description,
      inputSchema: {
        sound_id: z.string(),
        separate: z
          .boolean()
          .default(true)
          .describe(
            "Split it into stems first, each on its own track. Ignored for a " +
              "sound that is already a stem or an edit.",
          ),
        stems: z
          .array(z.string().max(40))
          .max(16)
          .optional()
          .describe(
            'Which stems get a track, e.g. ["vocals", "drums"]. Omit for all ' +
              "of them.",
          ),
        rest: z
          .enum(["discard", "merge"])
          .default("discard")
          .describe(
            "What happens to the stems not named: thrown away, or summed " +
              'into one "rest" track — the original minus what was taken out.',
          ),
      },
    },
    async ({ sound_id, separate, stems, rest }, extra) =>
      await track(extra, "soundbox.open_in_studio", { sound_id, separate, stems, rest }, async (rec) => {
        const svc = getService();
        // Separation can take a while, and the story only exists once it is
        // done — there is nothing useful to hand back before then.
        const progress = new ProgressReporter(extra);
        const job = await awaitJob(
          svc,
          svc.submitStoryFromSound(sound_id, {
            separate,
            stems: stems?.length ? { keep: stems, rest } : null,
          }).id,
          (j) => progress.job(j),
        );
        if (job.status !== "done") throw new Error(job.error ?? "Opening " + job.status);
        const storyId = job.result?.story_id as string | undefined;
        if (!storyId) throw new Error("Nothing was opened.");
        rec.setSounds((job.result?.sounds as string[]) ?? []);
        return json(storySummary(svc, storyId));
      }),
  );

  mcp.registerTool(
    "soundbox.mix_track",
    {
      title: meta["soundbox.mix_track"].title ?? undefined,
      description: meta["soundbox.mix_track"].description,
      inputSchema: {
        story_id: z.string(),
        track_index: z.number().int().min(-16).max(16).describe("Which lane."),
        name: z.string().max(80).nullish(),
        muted: z.boolean().optional(),
        soloed: z
          .boolean()
          .optional()
          .describe("With any track soloed, only soloed tracks are heard."),
        gain_db: z.number().min(-40).max(24).optional(),
      },
    },
    async ({ story_id, track_index, ...patch }, extra) =>
      await track(
        extra,
        "soundbox.mix_track",
        { story_id, track_index, ...patch },
        () => {
          const svc = getService();
          const updated = svc.updateTrack(story_id, track_index, patch);
          if (updated === null) throw new Error("No story with id " + story_id);
          return json({ ...updated, open_in_studio: studioUrl(svc, story_id) });
        },
      ),
  );

  mcp.registerTool(
    "soundbox.remove_track",
    {
      title: meta["soundbox.remove_track"].title ?? undefined,
      description: meta["soundbox.remove_track"].description,
      inputSchema: {
        story_id: z.string(),
        track_index: z.number().int().min(-16).max(16),
      },
    },
    async ({ story_id, track_index }, extra) =>
      await track(extra, "soundbox.remove_track", { story_id, track_index }, () => {
        const svc = getService();
        const removed = svc.deleteTrack(story_id, track_index);
        if (removed === null) throw new Error("No story with id " + story_id);
        return json({ removed_clips: removed, ...storySummary(svc, story_id) });
      }),
  );

  /* ------------------------------------------------------------ devices */

  /** A lane's chain as stored. A track with no row has no devices. */
  function chainOf(svc: SoundboxService, storyId: string, trackIndex: number): DeviceSpec[] {
    return svc.listTracks(storyId).find((t) => t.track_index === trackIndex)?.devices ?? [];
  }

  /**
   * The device an agent means: an id, or a kind when there is only one.
   *
   * Two EQs on a track is a real chain (a cut early, a lift late), and "the
   * eq" is then ambiguous. Guessing would turn the wrong one, so the error
   * lists the ids instead.
   */
  function findDevice(chain: DeviceSpec[], ref: string, trackIndex: number): number {
    const byId = chain.findIndex((d) => d.id === ref);
    if (byId >= 0) return byId;
    const kind = ref.trim().toLowerCase();
    const matches = chain.flatMap((d, i) => (d.kind === kind ? [i] : []));
    if (matches.length === 1) return matches[0];
    const listing = chain.length
      ? chain.map((d) => `${d.id} (${d.kind})`).join(", ")
      : "nothing";
    if (matches.length > 1) {
      throw new Error(
        `Track ${trackIndex} has ${matches.length} ${kind} devices; pass one id: ${listing}.`,
      );
    }
    throw new Error(`Track ${trackIndex} has no device "${ref}". On it: ${listing}.`);
  }

  /** What every device tool answers with: the whole chain, because the next
   *  call usually needs an id from it, plus anything that did not land as
   *  asked. */
  function chainResult(
    svc: SoundboxService,
    storyId: string,
    trackIndex: number,
    extra: Record<string, unknown>,
  ) {
    return json({
      story_id: storyId,
      track_index: trackIndex,
      ...extra,
      devices: chainOf(svc, storyId, trackIndex),
      note: "Heard in the studio's timeline playback; soundbox.export_story mixes dry.",
      open_in_studio: studioUrl(svc, storyId),
    });
  }

  function saveChain(
    svc: SoundboxService,
    storyId: string,
    trackIndex: number,
    chain: DeviceSpec[],
  ): void {
    if (svc.updateTrack(storyId, trackIndex, { devices: chain }) === null) {
      throw new Error("No story with id " + storyId);
    }
  }

  /** Knob values as the agent sent them, checked against the device. Unknown
   *  keys are an error rather than dropped: a misspelt knob that silently does
   *  nothing is the one failure an agent cannot see. */
  function knobs(kind: DeviceSpec["kind"], params: Record<string, number> | undefined) {
    const result = clampParams(kind, params ?? {});
    if (result.unknown.length) {
      const keys = DEVICE_TABLE[kind].params.map((p) => p.key).join(", ");
      throw new Error(
        `${kind} has no knob ${result.unknown.map((k) => `"${k}"`).join(", ")}. ` +
          `Its knobs: ${keys}.`,
      );
    }
    return result;
  }

  const DEVICE_PARAMS = z
    .record(z.string(), z.number())
    .describe(
      "Knob values in the device's stored units (seconds, not ms; mixes 0-1). " +
        "Ranges and defaults:\n" +
        describeDevices(),
    );

  mcp.registerTool(
    "soundbox.add_device",
    {
      title: meta["soundbox.add_device"].title ?? undefined,
      description: meta["soundbox.add_device"].description,
      inputSchema: {
        story_id: z.string(),
        track_index: z.number().int().min(-16).max(16).describe("Which lane."),
        kind: z.enum(DEVICE_KINDS),
        params: DEVICE_PARAMS.optional(),
        bypassed: z.boolean().optional(),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Where in the chain, from 0. Omit to add it last."),
      },
    },
    async ({ story_id, track_index, kind, params, bypassed, position }, extra) =>
      await track(
        extra,
        "soundbox.add_device",
        { story_id, track_index, kind, params, bypassed, position },
        () => {
          const svc = getService();
          if (svc.getStory(story_id) === null) throw new Error("No story with id " + story_id);
          const set = knobs(kind, params);
          const device: DeviceSpec = {
            id: newDeviceId(kind),
            kind,
            bypassed: bypassed ?? false,
            params: { ...defaultParams(kind), ...set.params },
          };
          const chain = [...chainOf(svc, story_id, track_index)];
          chain.splice(Math.min(position ?? chain.length, chain.length), 0, device);
          saveChain(svc, story_id, track_index, chain);
          return chainResult(svc, story_id, track_index, {
            device: device.id,
            ...(set.clamped.length ? { clamped: set.clamped } : {}),
          });
        },
      ),
  );

  mcp.registerTool(
    "soundbox.set_device",
    {
      title: meta["soundbox.set_device"].title ?? undefined,
      description: meta["soundbox.set_device"].description,
      inputSchema: {
        story_id: z.string(),
        track_index: z.number().int().min(-16).max(16),
        device: z.string().describe("The device's id, or its kind when the track has one."),
        params: DEVICE_PARAMS.optional(),
        bypassed: z
          .boolean()
          .optional()
          .describe("true takes it out of the signal path and keeps its settings."),
      },
    },
    async ({ story_id, track_index, device, params, bypassed }, extra) =>
      await track(
        extra,
        "soundbox.set_device",
        { story_id, track_index, device, params, bypassed },
        () => {
          const svc = getService();
          if (svc.getStory(story_id) === null) throw new Error("No story with id " + story_id);
          if (params === undefined && bypassed === undefined) {
            throw new Error("Nothing to change: pass params, bypassed, or both.");
          }
          const chain = [...chainOf(svc, story_id, track_index)];
          const at = findDevice(chain, device, track_index);
          const current = chain[at];
          const set = knobs(current.kind, params);
          chain[at] = {
            ...current,
            bypassed: bypassed ?? current.bypassed,
            params: { ...current.params, ...set.params },
          };
          saveChain(svc, story_id, track_index, chain);
          return chainResult(svc, story_id, track_index, {
            device: current.id,
            ...(set.clamped.length ? { clamped: set.clamped } : {}),
          });
        },
      ),
  );

  mcp.registerTool(
    "soundbox.remove_device",
    {
      title: meta["soundbox.remove_device"].title ?? undefined,
      description: meta["soundbox.remove_device"].description,
      inputSchema: {
        story_id: z.string(),
        track_index: z.number().int().min(-16).max(16),
        device: z.string().describe("The device's id, or its kind when the track has one."),
      },
    },
    async ({ story_id, track_index, device }, extra) =>
      await track(extra, "soundbox.remove_device", { story_id, track_index, device }, () => {
        const svc = getService();
        if (svc.getStory(story_id) === null) throw new Error("No story with id " + story_id);
        const chain = [...chainOf(svc, story_id, track_index)];
        const at = findDevice(chain, device, track_index);
        const [gone] = chain.splice(at, 1);
        saveChain(svc, story_id, track_index, chain);
        return chainResult(svc, story_id, track_index, { removed: gone.id });
      }),
  );

  mcp.registerTool(
    "soundbox.delete_line",
    {
      title: meta["soundbox.delete_line"].title ?? undefined,
      description: meta["soundbox.delete_line"].description,
      inputSchema: { line_id: z.string() },
    },
    async ({ line_id }, extra) =>
      await track(extra, "soundbox.delete_line", { line_id }, () => {
        const svc = getService();
        // Read the parent before the row goes, so the summary still has a
        // story to describe.
        const storyId = svc.getSegment(line_id)?.story_id ?? null;
        if (!svc.deleteSegment(line_id)) throw new Error("No line with id " + line_id);
        return json(storyId ? storySummary(svc, storyId) : { deleted: line_id });
      }),
  );

  mcp.registerTool(
    "soundbox.split_line",
    {
      title: meta["soundbox.split_line"].title ?? undefined,
      description: meta["soundbox.split_line"].description,
      inputSchema: {
        line_id: z.string(),
        at_s: z
          .number()
          .gt(0)
          .describe("Seconds into the line as it plays on the timeline, after any trim."),
      },
    },
    async ({ line_id, at_s }, extra) =>
      await track(extra, "soundbox.split_line", { line_id, at_s }, () => {
        const svc = getService();
        const halves = svc.splitSegment(line_id, at_s);
        if (halves === null) throw new Error("No line with id " + line_id);
        return json({
          halves: halves.map(lineView),
          ...storySummary(svc, halves[0].story_id),
        });
      }),
  );

  return mcp;
}

/** Kept for callers/tests that want the configured exception list on its own:
 *  SOUNDBOX_ALLOWED_HOSTS, parsed the same way as everywhere else (origins.ts). */
export function allowedHosts(): string[] {
  return allowedHostEntries();
}

/**
 * Is this `Host` header a loopback address (any port), or listed in
 * SOUNDBOX_ALLOWED_HOSTS (a bare `host` on any port, `host:port` on that port)?
 *
 * The SDK's own `allowedHosts` option only does exact-string `.includes()`
 * matching — there is no wildcard port support — so "127.0.0.1:*" silently
 * never matches a real "127.0.0.1:17494" header and every request gets
 * rejected. Loopback-with-any-port is exactly what a local server needs to
 * accept, so that check is done here instead and the SDK's own
 * allowedHosts/allowedOrigins/enableDnsRebindingProtection options are left
 * off (this replaces them, it does not add to them).
 */
function isHostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  if (/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(hostHeader)) return true;
  return isListedHost(hostHeader);
}

/**
 * Same idea for `Origin`, which carries a scheme the Host header doesn't —
 * but stricter than "any loopback port": the same trusted set CORS uses (see
 * `origins.ts`), compared on the parsed host rather than a string suffix, so
 * `http://evil-example.com` no longer passes for an allowed `example.com`.
 */
export function isOriginAllowed(
  originHeader: string | undefined,
  hostHeader?: string,
): boolean {
  if (!originHeader) return true; // no Origin header: not a browser request
  return isTrustedOrigin(originHeader, hostHeader);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function rejectInsecureRequest(
  res: ServerResponse,
  kind: "Host" | "Origin",
  value: string | undefined,
): void {
  res.writeHead(403, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: `Invalid ${kind} header: ${value}` },
      id: null,
    }),
  );
}

/** A session with no request in flight for this long is closed. */
export const MCP_SESSION_IDLE_MS = 30 * 60 * 1000;
const MCP_SWEEP_INTERVAL_MS = 60 * 1000;

interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  /** When a request for this session last started or finished. */
  lastSeen: number;
  /** Requests still open, including a long-lived GET event stream. */
  inFlight: number;
}

/**
 * One streamable-HTTP endpoint: a session map plus the three verbs the spec
 * uses. Each MCP session gets its own `McpServer` because the SDK binds a
 * server to exactly one transport.
 *
 * Sessions end with a DELETE when the client is polite. Plenty aren't — an
 * agent that crashes, a window closed mid-task — and each abandoned session
 * holds a server, a transport and its listeners for the life of the process.
 * So a periodic sweep closes any session that has had nothing in flight for
 * `MCP_SESSION_IDLE_MS`. A client that comes back after that gets the
 * spec's "no valid session" answer and re-initializes, which every client
 * already handles for a server restart.
 */
export class McpEndpoint {
  private readonly sessions = new Map<string, McpSession>();
  private readonly getService: () => SoundboxService;
  private readonly idleMs: number;
  private readonly sweeper: NodeJS.Timeout;

  constructor(getService: () => SoundboxService, idleMs: number = MCP_SESSION_IDLE_MS) {
    this.getService = getService;
    this.idleMs = idleMs;
    this.sweeper = setInterval(
      () => void this.sweep(),
      Math.min(MCP_SWEEP_INTERVAL_MS, idleMs),
    );
    this.sweeper.unref();
  }

  /** Close every session idle past the TTL. Public for tests. */
  async sweep(now: number = Date.now()): Promise<number> {
    const stale = [...this.sessions.entries()].filter(
      ([, s]) => s.inFlight === 0 && now - s.lastSeen >= this.idleMs,
    );
    for (const [id, session] of stale) {
      this.sessions.delete(id);
      await session.transport.close().catch(() => undefined);
    }
    return stale.length;
  }

  /** Number of open sessions, for tests and diagnostics. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Count a request against its session until the response closes, so a
   *  session streaming a long generation is never swept mid-call. */
  private touch(session: McpSession, res: ServerResponse): void {
    session.lastSeen = Date.now();
    session.inFlight += 1;
    res.once("close", () => {
      session.inFlight = Math.max(0, session.inFlight - 1);
      session.lastSeen = Date.now();
    });
  }

  /** Handle POST/GET/DELETE on /mcp with Node's raw req/res. */
  async handle(req: IncomingMessage, res: ServerResponse, body?: unknown): Promise<void> {
    // Applies to every request, session or not — an established session is
    // exactly what DNS rebinding targets, so re-checking only on init would
    // defeat the point.
    const hostHeader = firstHeader(req.headers.host);
    if (!isHostAllowed(hostHeader)) {
      rejectInsecureRequest(res, "Host", hostHeader);
      return;
    }
    const originHeader = firstHeader(req.headers.origin);
    if (!isOriginAllowed(originHeader, hostHeader)) {
      rejectInsecureRequest(res, "Origin", originHeader);
      return;
    }

    const header = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(header) ? header[0] : header;
    const existing = sessionId ? this.sessions.get(sessionId) : undefined;

    if (existing) {
      this.touch(existing, res);
      await existing.transport.handleRequest(req, res, body);
      return;
    }
    if (req.method !== "POST" || !isInitializeRequest(body)) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: no valid session ID provided" },
          id: null,
        }),
      );
      return;
    }

    // Host/Origin are already validated above, so the SDK's own (broken —
    // see isHostAllowed's doc comment) allowedHosts/allowedOrigins/
    // enableDnsRebindingProtection options are deliberately left unset here.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id: string) => {
        const session: McpSession = { server, transport, lastSeen: Date.now(), inFlight: 0 };
        this.sessions.set(id, session);
        this.touch(session, res);
      },
    });
    const server = buildMcp(this.getService);
    transport.onclose = () => {
      if (transport.sessionId) this.sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async close(): Promise<void> {
    clearInterval(this.sweeper);
    for (const { transport } of this.sessions.values()) {
      await transport.close().catch(() => undefined);
    }
    this.sessions.clear();
  }
}

/**
 * Mount the MCP endpoint at exactly "/mcp".
 *
 * Registered on both "/mcp" and "/mcp/" so neither form redirects: a 307 on a
 * POST is exactly the case some clients get wrong. `reply.hijack()` hands the
 * raw socket to the transport, which streams SSE itself.
 */
export function mountMcp(
  app: {
    route(opts: {
      method: string[];
      url: string;
      handler: (req: FastifyLikeRequest, reply: FastifyLikeReply) => Promise<void>;
    }): unknown;
  },
  getService: () => SoundboxService,
): McpEndpoint {
  const endpoint = new McpEndpoint(getService);
  for (const url of ["/mcp", "/mcp/"]) {
    app.route({
      method: ["POST", "GET", "DELETE"],
      url,
      handler: async (req, reply) => {
        reply.hijack();
        await endpoint.handle(req.raw, reply.raw, req.body);
      },
    });
  }
  return endpoint;
}

/** The slice of Fastify's request/reply this module uses, kept structural so
 *  the HTTP layer isn't forced to hand over a full FastifyInstance type. */
interface FastifyLikeRequest {
  raw: IncomingMessage;
  body?: unknown;
}
interface FastifyLikeReply {
  hijack(): void;
  raw: ServerResponse;
}
