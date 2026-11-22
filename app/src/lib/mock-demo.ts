/**
 * The demo fixture: what the mock backend holds when the app is started with
 * `VITE_MOCK_FIXTURE=demo`, which is how `scripts/capture-media.mjs` takes the
 * product screenshots.
 *
 * The plain mock (`npm run dev:mock`) is seeded to exercise UI states: a model
 * that is half downloaded, one with its runtime missing, a library of eight
 * effects from one model. That is right for development and wrong for a
 * picture of the product, where every row reading the same model and the same
 * licence badge makes the app look like it does one thing.
 *
 * So this is one small made-up production, a trailer for a game called "Ember
 * Run", seen from every page: its music on the Music page, its effects on the
 * SFX page, a cast with reads behind them, and a Studio project with the
 * narration, the dialogue, the music bed and the effects on lanes of their
 * own. The production is invented. The models are not: every model row is
 * built from the server's own catalogue, so names, makers, sizes and licence
 * verdicts in a screenshot are the ones the real app shows.
 */

import catalog from "../../../server/src/models/audiocpp_models_catalog.json";

import type {
  AudioCppCatalogEntry,
  LicenseInfo,
  McpToolInfo,
  Model,
  ModelStatus,
  Story,
  StorySegment,
  StoryTrack,
  Voice,
} from "./api";
import { createDevice } from "./devices";
import type { SeedSound } from "./mock";

/* ----------------------------------------------------------------- models */

/** The catalogue fields this file reads. The JSON has more. */
interface CatalogRow {
  id: string;
  name: string;
  vendor: string;
  description: string;
  family: string;
  category: Model["category"];
  hf_repo: string;
  license: string | LicenseInfo;
  max_duration_s: number;
  sample_rate: number;
  channels: number;
  vram_estimate_mb: number;
  defaults?: Model["defaults"];
  supports?: Partial<Model["supports"]>;
  max_cfg?: number | null;
  task?: Model["task"];
  voice_ids?: string[];
  requires_voice_reference?: boolean;
  gated?: boolean;
  verified?: boolean;
}

const raw = catalog as unknown as {
  licenses: Record<string, LicenseInfo>;
  models: CatalogRow[];
  catalog_extra: CatalogRow[];
};

const ALWAYS_ON = new Set(raw.models.map((m) => m.id));
const ROWS = new Map([...raw.models, ...raw.catalog_extra].map((m) => [m.id, m]));

/** Which catalogue models the demo machine knows about, and which of them it
 *  has downloaded. Order is the order the Models page lists them in. */
const DEMO_MODELS: [id: string, status: ModelStatus][] = [
  ["audiocpp-stable-audio-3-sfx", "installed"],
  ["audiocpp-midashenglm-gen", "installed"],
  ["audiocpp-ace-step", "loaded"],
  ["audiocpp-stable-audio-3-small-music", "installed"],
  ["audiocpp-kokoro", "installed"],
  ["audiocpp-vibevoice", "installed"],
  ["audiocpp-qwen3-asr-0-6b", "installed"],
  ["audiocpp-htdemucs-6s-sep", "installed"],
  ["audiocpp-minimax-music3", "not_installed"],
  ["audiocpp-ace-step-xl-turbo", "not_installed"],
  ["audiocpp-chatterbox-turbo", "not_installed"],
  ["audiocpp-qwen3-tts-1-7b-base", "not_installed"],
  ["audiocpp-controlfoley", "not_installed"],
];

function row(id: string): CatalogRow {
  const found = ROWS.get(id);
  if (!found) throw new Error(`mock-demo: ${id} is not in the model catalogue any more`);
  return found;
}

function license(of: CatalogRow): LicenseInfo {
  return typeof of.license === "string" ? raw.licenses[of.license] : of.license;
}

/** A catalogue row as the server reports it: the same defaults
 *  `server/src/models/audiocpp.ts` fills in. */
function toModel(id: string, status: ModelStatus): Model {
  const r = row(id);
  return {
    id: r.id,
    name: r.name,
    vendor: r.vendor,
    description: r.description,
    license: license(r),
    hf_repo: r.hf_repo,
    gated: r.gated ?? false,
    family: r.family,
    params: [],
    task: r.task ?? "gen",
    voice_ids: [...(r.voice_ids ?? [])],
    requires_voice_reference: r.requires_voice_reference ?? false,
    category: r.category,
    max_duration_s: r.max_duration_s,
    sample_rate: r.sample_rate,
    channels: r.channels,
    supports: {
      negative_prompt: false, seed: false, steps: false, cfg: false, lyrics: false,
      text: false, voice_reference: false, extend: false, cover: false, repaint: false,
      ...r.supports,
    },
    defaults: { ...r.defaults } as Model["defaults"],
    vram_estimate_mb: r.vram_estimate_mb,
    max_cfg: r.max_cfg ?? null,
    extras: ["audio-cpp"],
    status,
    installed_deps: true,
    auto_installable: false,
    error: null,
  };
}

export const demoModels: Model[] = DEMO_MODELS.map(([id, status]) => toModel(id, status));

export const demoCatalog: AudioCppCatalogEntry[] = DEMO_MODELS.map(([id, status]) => {
  const r = row(id);
  return {
    id: r.id,
    name: r.name,
    vendor: r.vendor,
    description: r.description,
    license: license(r),
    verified: r.verified ?? false,
    always_on: ALWAYS_ON.has(id),
    enabled: true,
    on_disk: status !== "not_installed",
    category: r.category,
  };
});

/* ----------------------------------------------------------------- voices */

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const KOKORO = "audiocpp-kokoro";
const VIBEVOICE = "audiocpp-vibevoice";

export const demoVoices: Voice[] = [
  {
    id: "voice-demo-narrator",
    name: "Narrator",
    kind: "builtin",
    created_at: hoursAgo(24 * 9),
    reference_file: null,
    voice_id: "bm_george",
    model_id: KOKORO,
    notes: "Low, unhurried trailer read.",
  },
  {
    id: "voice-demo-mara",
    name: "Mara",
    kind: "clone",
    created_at: hoursAgo(24 * 6),
    reference_file: null,
    voice_id: null,
    model_id: VIBEVOICE,
    notes: "The lead. Cloned from a 20 second studio read.",
  },
  {
    id: "voice-demo-reyes",
    name: "Captain Reyes",
    kind: "clone",
    created_at: hoursAgo(24 * 6 - 2),
    reference_file: null,
    voice_id: null,
    model_id: VIBEVOICE,
    notes: "Gravel and patience. Two clips, joined.",
  },
  {
    id: "voice-demo-juno",
    name: "Juno",
    kind: "builtin",
    created_at: hoursAgo(24 * 4),
    reference_file: null,
    voice_id: "af_heart",
    model_id: KOKORO,
    notes: "The ship's computer. Bright, a little too calm.",
  },
  {
    id: "voice-demo-archivist",
    name: "The Archivist",
    kind: "clone",
    created_at: hoursAgo(30),
    reference_file: null,
    voice_id: null,
    model_id: VIBEVOICE,
    notes: "Old tapes, read slowly.",
  },
];

/* ----------------------------------------------------------------- sounds */

const STORY = "story-demo-trailer";

const SFX = "audiocpp-stable-audio-3-sfx";
const SFX_OPEN = "audiocpp-midashenglm-gen";
const ACE = "audiocpp-ace-step";
const SA_MUSIC = "audiocpp-stable-audio-3-small-music";

/** Sample rate and channel count come from the model that made the sound,
 *  as they would on disk. */
function made(model: string): Pick<SeedSound, "model" | "sample_rate" | "channels"> {
  const r = row(model);
  return { model, sample_rate: r.sample_rate, channels: r.channels };
}

const music: SeedSound[] = [
  {
    id: "snd-demo-theme",
    name: "Ember Run (main theme)",
    prompt: "cinematic orchestral trailer theme, low brass ostinato, taiko hits, rising string line, 96 BPM, D minor",
    tags: ["trailer", "orchestral", "theme"],
    ...made(ACE),
    duration_s: 128,
    shape: "swell",
    favorite: true,
    hours_ago: 0.4,
  },
  {
    id: "snd-demo-neon",
    name: "Neon Arcade",
    prompt: "synthwave, gated drums, analog bass arpeggio, bright lead, 118 BPM",
    tags: ["synthwave", "level-2"],
    ...made(ACE),
    duration_s: 165,
    shape: "tonal",
    favorite: false,
    hours_ago: 3,
    lyrics: "[verse]\nStreetlights hum in a minor key\nEvery window is a screen to me",
  },
  {
    id: "snd-demo-lowtide",
    name: "Low Tide",
    prompt: "lo-fi hip hop, dusty Rhodes chords, upright bass, vinyl crackle, 82 BPM",
    tags: ["lo-fi", "menu"],
    ...made(SA_MUSIC),
    duration_s: 90,
    shape: "tonal",
    favorite: true,
    hours_ago: 1.6,
  },
  {
    id: "snd-demo-boss",
    name: "Boss Fight, Phase Two",
    prompt: "aggressive hybrid orchestral, distorted cello, double-time drums, choir stabs, 150 BPM",
    tags: ["combat", "orchestral"],
    ...made(ACE),
    duration_s: 112,
    shape: "burst",
    favorite: false,
    hours_ago: 26,
    source: "mcp",
    client: "claude-code 2.1.0",
  },
  {
    id: "snd-demo-campfire",
    name: "Campfire Waltz",
    prompt: "fingerpicked acoustic guitar waltz, soft fiddle, room tone, 3/4, warm",
    tags: ["acoustic", "safe-room"],
    ...made(SA_MUSIC),
    duration_s: 48,
    shape: "swell",
    favorite: false,
    hours_ago: 31,
  },
  {
    id: "snd-demo-title",
    name: "Title Screen Loop",
    prompt: "slow ambient pad loop, glassy bells, distant choir, seamless",
    tags: ["ambient", "loop", "menu"],
    ...made(SA_MUSIC),
    duration_s: 32,
    shape: "tonal",
    favorite: false,
    hours_ago: 50,
  },
  {
    id: "snd-demo-credits",
    name: "Credits (piano)",
    prompt: "solo felt piano, slow, hopeful, close mic, pedal noise",
    tags: ["piano", "credits"],
    ...made(ACE),
    duration_s: 141,
    shape: "swell",
    favorite: false,
    hours_ago: 74,
  },
];

const effects: SeedSound[] = [
  {
    id: "snd-demo-vault",
    name: "Vault door slam",
    prompt: "massive steel vault door slamming shut in a stone corridor, long low tail",
    tags: ["door", "impact", "metal"],
    ...made(SFX),
    duration_s: 2.4,
    shape: "impact",
    favorite: true,
    hours_ago: 1,
  },
  {
    id: "snd-demo-whoosh",
    name: "Whoosh pass-by",
    prompt: "fast airy whoosh passing left to right, no tonal content",
    tags: ["whoosh", "transition"],
    ...made(SFX_OPEN),
    duration_s: 1.4,
    shape: "swell",
    favorite: false,
    hours_ago: 2.6,
  },
  {
    id: "snd-demo-explosion",
    name: "Distant explosion",
    prompt: "large explosion heard from far away, low rumble tail, debris settling",
    tags: ["explosion", "impact"],
    ...made(SFX),
    duration_s: 6,
    shape: "impact",
    favorite: true,
    hours_ago: 4,
  },
  {
    id: "snd-demo-rain",
    name: "Rain on tin roof",
    prompt: "steady rain hitting a corrugated tin roof, distant thunder",
    tags: ["ambience", "rain", "weather"],
    ...made(SFX_OPEN),
    duration_s: 9.5,
    shape: "swell",
    favorite: false,
    hours_ago: 4.6,
  },
  {
    id: "snd-demo-gravel",
    name: "Gravel footsteps, running",
    prompt: "boots running on loose gravel, outdoor, no reverb, six steps",
    tags: ["footsteps", "foley"],
    ...made(SFX),
    duration_s: 3.1,
    shape: "burst",
    favorite: false,
    hours_ago: 6,
    source: "mcp",
    client: "claude-code 2.1.0",
  },
  {
    id: "snd-demo-glass",
    name: "Glass shatter",
    prompt: "pane of glass shattering on concrete, shards skittering",
    tags: ["glass", "impact", "debris"],
    ...made(SFX_OPEN),
    duration_s: 3.2,
    shape: "burst",
    favorite: false,
    hours_ago: 7,
    source: "mcp",
    client: "claude-code 2.1.0",
  },
  {
    id: "snd-demo-engine",
    name: "Engine room hum",
    prompt: "constant engine room hum with a slow mechanical pulse, tight metal space",
    tags: ["ambience", "machine"],
    ...made(SFX),
    duration_s: 12,
    shape: "tonal",
    favorite: false,
    hours_ago: 20,
  },
  {
    id: "snd-demo-ui",
    name: "UI confirm blip",
    prompt: "short synthetic UI confirmation blip, clean, bright, two notes",
    tags: ["ui", "synth"],
    ...made(SFX_OPEN),
    duration_s: 0.8,
    shape: "tonal",
    favorite: true,
    hours_ago: 28,
    source: "mcp",
    client: "cursor 1.4.2",
  },
  {
    id: "snd-demo-sword",
    name: "Sword unsheath",
    prompt: "metal sword drawn from a leather scabbard, sharp ring-out",
    tags: ["weapon", "metal", "foley"],
    ...made(SFX),
    duration_s: 1.8,
    shape: "burst",
    favorite: false,
    hours_ago: 29,
    source: "mcp",
    client: "cursor 1.4.2",
  },
  {
    id: "snd-demo-coin",
    name: "Coin pickup",
    prompt: "bright arcade coin pickup, short rising chime",
    tags: ["ui", "pickup"],
    ...made(SFX_OPEN),
    duration_s: 0.6,
    shape: "tonal",
    favorite: false,
    hours_ago: 52,
    source: "api",
  },
];

/**
 * Every spoken line in the demo, in the order they were read. The first
 * column decides which voice's history it lands in; `at` puts a line on the
 * trailer's timeline, and lines without one are only reads in the library.
 */
interface Read {
  voice: string;
  text: string;
  /** [lane, start in seconds] on the trailer timeline. */
  at?: [track: number, start_s: number];
}

const NARRATOR = "voice-demo-narrator";
const MARA = "voice-demo-mara";
const REYES = "voice-demo-reyes";
const JUNO = "voice-demo-juno";
const ARCHIVIST = "voice-demo-archivist";

const LANE = { narration: 0, dialogue: 1, music: 2, ambience: 3, effects: 4 } as const;

const reads: Read[] = [
  { voice: NARRATOR, text: "They sealed the vault a hundred years ago.", at: [LANE.narration, 0.6] },
  { voice: MARA, text: "Reyes, the door is moving on its own.", at: [LANE.dialogue, 4.4] },
  { voice: REYES, text: "Then we stop being here.", at: [LANE.dialogue, 7.6] },
  { voice: NARRATOR, text: "Nobody asked what it was keeping in.", at: [LANE.narration, 10.2] },
  { voice: MARA, text: "Run. Don't look at it, just run!", at: [LANE.dialogue, 14.6] },
  { voice: REYES, text: "Mara! The bridge!", at: [LANE.dialogue, 21.2] },
  { voice: NARRATOR, text: "Ember Run. Out this winter.", at: [LANE.narration, 28.4] },
  // Takes that did not make the cut, and lines from elsewhere in the game.
  { voice: NARRATOR, text: "They locked the vault a century ago." },
  { voice: NARRATOR, text: "Nobody thought to ask what it was holding." },
  { voice: NARRATOR, text: "Chapter one. The long way down." },
  { voice: NARRATOR, text: "Chapter two. What the water kept." },
  { voice: NARRATOR, text: "Previously, on Ember Run." },
  { voice: NARRATOR, text: "Some doors are closed for a reason." },
  { voice: NARRATOR, text: "Ember Run. Wishlist it today." },
  { voice: NARRATOR, text: "This winter, the mountain wakes up." },
  { voice: MARA, text: "I've got the key. I don't have a plan." },
  { voice: MARA, text: "That's not a door. That's a mouth." },
  { voice: MARA, text: "Juno, tell me that reading is wrong." },
  { voice: MARA, text: "Okay. Okay. We go on three." },
  { voice: MARA, text: "You said it was sealed!" },
  { voice: MARA, text: "Left. No, your other left." },
  { voice: MARA, text: "I'm not leaving without him." },
  { voice: REYES, text: "Twenty years I've walked past this door." },
  { voice: REYES, text: "Keep your light low and your voice lower." },
  { voice: REYES, text: "That's the wrong kind of quiet." },
  { voice: REYES, text: "Go. I'll hold the bridge." },
  { voice: JUNO, text: "Pressure is rising on deck four." },
  { voice: JUNO, text: "I would not recommend opening that." },
  { voice: JUNO, text: "Good morning. You have been asleep for nine days." },
  { voice: ARCHIVIST, text: "Entry forty one. We have stopped counting the knocks." },
  { voice: ARCHIVIST, text: "If you are hearing this, the seal has failed." },
];

/** When each line of the trailer was read, in hours before now. */
const TRAILER_READ_HOURS = [2, 3.5, 5.5, 8, 10, 13, 15];

/** About 150 words a minute with a breath either side: close enough that a
 *  clip is the width its words would take. */
function readLength(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.round((0.5 + words / 2.6) * 10) / 10;
}

const voiceById = new Map(demoVoices.map((v) => [v.id, v]));

const speech: SeedSound[] = reads.map((r, i) => {
  const voice = voiceById.get(r.voice)!;
  return {
    id: `snd-demo-read-${String(i + 1).padStart(2, "0")}`,
    name: r.text.length > 44 ? `${r.text.slice(0, 43)}…` : r.text,
    prompt: `${voice.name}: ${r.text}`,
    tags: r.at ? ["trailer"] : [],
    ...made(voice.model_id!),
    duration_s: readLength(r.text),
    shape: "tonal",
    favorite: false,
    // The trailer was voiced today, between the effects; the rest is older.
    hours_ago: r.at ? (TRAILER_READ_HOURS[i] ?? 16) : 34 + i * 3,
    voice_id: voice.id,
    steps: null,
    cfg: null,
  };
});

/** Newest first across kinds, the order the library lists them in. */
export const demoSounds: SeedSound[] = [...music, ...effects, ...speech].sort(
  (a, b) => (a.hours_ago ?? 0) - (b.hours_ago ?? 0),
);

/* ------------------------------------------------------------- the studio */

const soundById = new Map(demoSounds.map((s) => [s.id, s]));

function clip(
  position: number,
  track: number,
  start_s: number,
  soundId: string,
  more: Partial<StorySegment> = {},
): Omit<StorySegment, "sound"> {
  const sound = soundById.get(soundId)!;
  const stamp = hoursAgo(1);
  return {
    id: `seg-demo-${String(position + 1).padStart(2, "0")}`,
    story_id: STORY,
    position,
    track_index: track,
    // A placed sound is labelled by its name, as dropping one from the library
    // labels it.
    speaker: sound.name,
    voice_id: null,
    text: "",
    language: null,
    sound_id: soundId,
    kind: "line",
    trim_start_s: 0,
    start_s,
    duration_s: sound.duration_s,
    fade_in_s: 0,
    fade_out_s: 0,
    request_options: {},
    midi: null,
    muted: false,
    gain_db: 0,
    created_at: stamp,
    updated_at: stamp,
    ...more,
  };
}

const placed: { track: number; start_s: number; sound: string; more?: Partial<StorySegment> }[] = [
  // The bed: the first half minute of the theme, faded at both ends.
  { track: LANE.music, start_s: 0, sound: "snd-demo-theme", more: { duration_s: 32, fade_in_s: 1.5, fade_out_s: 3 } },
  { track: LANE.ambience, start_s: 0, sound: "snd-demo-rain", more: { fade_in_s: 0.8, fade_out_s: 1.2 } },
  { track: LANE.ambience, start_s: 11.4, sound: "snd-demo-engine", more: { fade_in_s: 1, fade_out_s: 2 } },
  { track: LANE.effects, start_s: 12.3, sound: "snd-demo-vault" },
  { track: LANE.effects, start_s: 16.2, sound: "snd-demo-whoosh" },
  { track: LANE.effects, start_s: 17.4, sound: "snd-demo-gravel" },
  { track: LANE.effects, start_s: 22.6, sound: "snd-demo-explosion", more: { fade_out_s: 1.5 } },
  ...reads.flatMap((r, i) =>
    r.at
      ? [{
          track: r.at[0],
          start_s: r.at[1],
          sound: speech[i].id!,
          more: { speaker: voiceById.get(r.voice)!.name, voice_id: r.voice, text: r.text },
        }]
      : [],
  ),
];

/** Reading order is the order things happen in. */
export const demoSegments: Omit<StorySegment, "sound">[] = [...placed]
  .sort((a, b) => a.start_s - b.start_s || a.track - b.track)
  .map((p, i) => clip(i, p.track, p.start_s, p.sound, p.more));

export const demoStories: Story[] = [
  {
    id: STORY,
    title: "Ember Run trailer",
    created_at: hoursAgo(26),
    updated_at: hoursAgo(1),
    request_options: {},
    segment_count: demoSegments.length,
    builder: "script",
  },
];

const lane = (track_index: number, name: string, more: Partial<StoryTrack> = {}): StoryTrack => ({
  story_id: STORY,
  track_index,
  name,
  muted: false,
  soloed: false,
  gain_db: 0,
  devices: [],
  ...more,
});

export const demoTracks: StoryTrack[] = [
  lane(LANE.narration, "Narration", { devices: [createDevice("compressor"), createDevice("eq")] }),
  lane(LANE.dialogue, "Dialogue", { devices: [createDevice("compressor")] }),
  lane(LANE.music, "Music bed", { gain_db: -8 }),
  lane(LANE.ambience, "Ambience", { gain_db: -4, devices: [createDevice("reverb")] }),
  lane(LANE.effects, "Effects"),
];

/* ----------------------------------------------------------------- agents */

/** The server's tool table by name and title (`MCP_TOOLS` in
 *  `server/src/mcp/server.ts`), so the Agents page counts the same tools
 *  the real one does. */
export const demoMcpTools: Omit<McpToolInfo, "calls">[] = (
  [
    ["enhance_prompt", "Rewrite a prompt for a sound model"],
    ["generate", "Generate a sound effect"],
    ["separate", "Split a sound into stems"],
    ["list_models", "List sound models"],
    ["list_sounds", "Search the sound library"],
    ["get_sound", "Get one sound"],
    ["delete_sound", "Delete a sound"],
    ["list_voices", "List saved voices"],
    ["speak", "Speak a line or a dialogue"],
    ["create_story", "Start a story"],
    ["list_stories", "List stories"],
    ["get_story", "Read a story"],
    ["add_lines", "Add lines to a story"],
    ["update_line", "Edit or arrange a line"],
    ["speak_story", "Voice a story"],
    ["open_in_studio", "Open a sound in the studio"],
    ["mix_track", "Mute, solo or set a track's level"],
    ["add_device", "Add an effect to a track"],
    ["set_device", "Turn a device's knobs"],
    ["remove_device", "Take an effect off a track"],
    ["remove_track", "Remove a track"],
    ["delete_line", "Delete a line"],
    ["split_line", "Split a line in two"],
    ["export_story", "Mix a story down"],
  ] as const
).map(([name, title]) => ({ name: `soundbox.${name}`, title, description: title }));

/** One call an agent made, `min` minutes ago. */
export interface DemoMcpCall {
  min: number;
  tool: string;
  client: "claude-code" | "cursor" | "codex";
  args?: Record<string, unknown>;
  ms: number;
  sounds?: string[];
  error?: string;
}

const CC = "claude-code" as const;

export const demoMcpCalls: DemoMcpCall[] = [
  // This morning: Claude Code builds the trailer.
  { min: 1, tool: "export_story", client: CC, args: { story_id: STORY }, ms: 2140 },
  { min: 3, tool: "set_device", client: CC, args: { story_id: STORY, track: 0, device: "compressor", ratio: 3 }, ms: 22 },
  { min: 3.5, tool: "add_device", client: CC, args: { story_id: STORY, track: 3, kind: "reverb" }, ms: 31 },
  { min: 4, tool: "mix_track", client: CC, args: { story_id: STORY, track: 2, gain_db: -8 }, ms: 19 },
  { min: 6, tool: "speak_story", client: CC, args: { story_id: STORY }, ms: 48200, sounds: speech.filter((s) => s.tags.length > 0).map((s) => s.id!) },
  { min: 8, tool: "add_lines", client: CC, args: { story_id: STORY, lines: 7 }, ms: 64 },
  { min: 8.4, tool: "list_voices", client: CC, ms: 15 },
  { min: 9, tool: "create_story", client: CC, args: { title: "Ember Run trailer" }, ms: 28 },
  { min: 12, tool: "generate", client: CC, args: { prompt: effects[5].prompt, duration_s: 3.2 }, ms: 4120, sounds: ["snd-demo-glass"] },
  { min: 14, tool: "generate", client: CC, args: { prompt: effects[4].prompt, duration_s: 3.1 }, ms: 3980, sounds: ["snd-demo-gravel"] },
  { min: 15, tool: "generate", client: CC, args: { prompt: "boots running on gravel", duration_s: 3 }, ms: 3710, error: "Cancelled by the client" },
  { min: 17, tool: "enhance_prompt", client: CC, args: { prompt: "running footsteps", model: SFX }, ms: 910 },
  { min: 18, tool: "list_sounds", client: CC, args: { q: "footsteps", limit: 5 }, ms: 18 },
  { min: 18.5, tool: "list_models", client: CC, ms: 41 },
  // Yesterday: the same agent scores a boss fight; Cursor does UI sounds.
  { min: 60 * 26, tool: "generate", client: CC, args: { prompt: music[3].prompt, duration_s: 112 }, ms: 38400, sounds: ["snd-demo-boss"] },
  { min: 60 * 26 + 2, tool: "list_models", client: CC, ms: 38 },
  { min: 60 * 28, tool: "generate", client: "cursor", args: { prompt: effects[7].prompt, duration_s: 0.8 }, ms: 2950, sounds: ["snd-demo-ui"] },
  { min: 60 * 29, tool: "generate", client: "cursor", args: { prompt: effects[8].prompt, duration_s: 1.8 }, ms: 3310, sounds: ["snd-demo-sword"] },
  { min: 60 * 29 + 1, tool: "list_sounds", client: "cursor", args: { q: "sword" }, ms: 16 },
  // Last week: Codex pulls a track apart.
  { min: 60 * 24 * 6, tool: "separate", client: "codex", args: { sound_id: "snd-demo-credits" }, ms: 21800 },
  { min: 60 * 24 * 6 + 1, tool: "get_sound", client: "codex", args: { sound_id: "snd-demo-credits" }, ms: 9 },
];
