/**
 * Search landing pages: one per thing a person types into a search box before
 * they know the product exists ("elevenlabs alternative", "ai sound effect
 * generator"). They are real pages with real content, reachable from each
 * other and from the footer, and deliberately not in the top navigation.
 *
 * Every factual line here is lifted from the README (the model table, the
 * hardware table, "Compared with a hosted service") or from copy already on
 * the site. The comparison table is the README's, verbatim, and says
 * "hosted services" in general: nothing here states what a named competitor
 * charges or allows, because nobody has checked that. Where the product falls
 * short (quality varies by model, no Mac confirmation yet) the page says so.
 */

import type { ExampleId } from "@/content/examples";
import { COMMERCIAL, FREE, GPU, MAC, OFFLINE, type Faq } from "@/content/faq";

export interface Trick {
  title: string;
  body: string;
  /** A real render that shows this off. */
  sample?: ExampleId;
}

export interface Lander {
  slug: string;
  /** Under `/alternatives/` or `/make/`, no leading slash. */
  path: string;
  /** `<title>`, under about 60 characters. */
  seoTitle: string;
  seoDescription: string;
  eyebrow: string;
  headline: string;
  lede: string;
  /** Played in the hero. */
  hero: ExampleId;
  tricksTitle: string;
  tricks: Trick[];
  /** A real screenshot under the tricks. */
  shot: { src: string; alt: string };
  /** Show the README's comparison table, headed by this sentence. */
  compare?: string;
  faq: Faq[];
  related: string[];
}

export const LANDERS: Lander[] = [
  {
    slug: "elevenlabs",
    path: "alternatives/elevenlabs",
    seoTitle: "A free, local ElevenLabs alternative | Mirli",
    seoDescription:
      "Sound effects, speech and voice cloning from open-weight models on your own machine. No account, no credits, works offline. MIT licensed.",
    eyebrow: "Alternatives · ElevenLabs",
    headline: "A free, local alternative to ElevenLabs",
    lede: "Describe a sound and get a WAV. Read a script in a cloned voice. Everything runs on your own GPU, so your scripts and voice clips are never uploaded.",
    hero: "chip-ambience",
    shot: {
      src: "/product/app-studio.webp",
      alt: 'The Mirli studio: a script cast across three voices above a timeline with narration, dialogue, a music bed, ambience and sound effects on five lanes.',
    },
    tricksTitle: "What you can do with it",
    tricks: [
      {
        title: "Sound effects from a description",
        body: "Name the material, the action and the space. The prompt shown next to each sound on this site is the exact text that made it.",
        sample: "door-heavy-vault",
      },
      {
        title: "Speech and voice cloning",
        body: "Read a script aloud, clone a voice from a short clip, and save voices to cast onto the lines of a script. Only clone a voice you have permission to use.",
        sample: "voice-intro",
      },
      {
        title: "Music, instrumental or with lyrics",
        body: "A style prompt gives an instrumental. Add a lyric sheet and a model that supports it sings.",
        sample: "song-own-machine",
      },
      {
        title: "One timeline for all of it",
        body: "Arrange sounds, music and spoken lines on a multi-track timeline, then export a mixdown.",
      },
      {
        title: "Your agent can drive it",
        body: "An MCP server with 24 tools lets Claude Code, Cursor or any MCP client make and place the audio for you.",
      },
    ],
    compare: "Mirli next to a hosted service",
    faq: [
      FREE,
      {
        question: "Is the quality the same as ElevenLabs?",
        answer:
          "No, and this page does not claim it. Open-weight models are not tuned into one consistent product, and quality varies by model. Every sample on this site shows its prompt and model so you can judge the output before you install anything.",
      },
      GPU,
      OFFLINE,
      COMMERCIAL,
      MAC,
    ],
    related: ["alternatives/suno", "make/voiceovers", "make/sound-effects"],
  },
  {
    slug: "suno",
    path: "alternatives/suno",
    seoTitle: "A free, local Suno alternative | Mirli",
    seoDescription:
      "Make instrumentals and songs with lyrics from open-weight music models on your own GPU. No account, no credits, works offline. MIT licensed.",
    eyebrow: "Alternatives · Suno",
    headline: "A free, local alternative to Suno",
    lede: "Write a style prompt for an instrumental, or add a lyric sheet for a song. The models run on your own machine, so you never wait in a queue or watch a credit balance.",
    hero: "song-own-machine",
    shot: {
      src: "/product/app-music.webp",
      alt: 'The Music page: a request form with model, licence, lyrics switch, styles and tempo beside seven generated tracks, each with its licence, model and length.',
    },
    tricksTitle: "How the music side works",
    tricks: [
      {
        title: "Instrumentals from a style prompt",
        body: "Stable Audio 3.0 Small Music turns a description of genre, instruments and tempo into a track. It has no vocal path.",
        sample: "inst-lofi",
      },
      {
        title: "Songs from a lyric sheet",
        body: "ACE-Step 1.5 is the lyrics-conditioned model: give it a style prompt and a [verse] / [chorus] lyric block and it sings.",
        sample: "song-own-machine",
      },
      {
        title: "Same prompt, three models",
        body: "Run one prompt and seed through Stable Audio 3.0 Small Music, MiniMax Music 3 and ACE-Step 1.5 Turbo, and compare the takes and their render times.",
      },
      {
        title: "Extend, cover and split into stems",
        body: "Make a take longer, re-render it in another style, or pull a mixed track apart into vocals, drums, bass and other. Extend and cover work on models that support them, ACE-Step among them.",
      },
      {
        title: "Arrange it with the rest",
        body: "Drop the music onto the timeline beside sound effects and voices, or let an agent do it over MCP.",
      },
    ],
    compare: "Mirli next to a hosted service",
    faq: [
      FREE,
      {
        question: "Can it make songs with vocals?",
        answer:
          "Yes, through ACE-Step 1.5, which takes a lyric sheet. Stable Audio 3.0 Small Music makes instrumentals only. Vocal quality depends on the model, so listen to the real renders on the music page, each with its prompt, before you decide.",
      },
      {
        question: "How long are the tracks?",
        answer:
          "The renders on this site are short clips. Models that support extending can make a take longer, and each model's page lists its maximum clip length.",
      },
      GPU,
      COMMERCIAL,
    ],
    related: ["alternatives/elevenlabs", "make/game-audio", "make/sound-effects"],
  },
  {
    slug: "sound-effects",
    path: "make/sound-effects",
    seoTitle: "Free AI sound effects generator, offline | Mirli",
    seoDescription:
      "Describe a sound and get a WAV, generated on your own machine. Hundreds of real examples with the exact prompts. No account, no credits. MIT licensed.",
    eyebrow: "Make · Sound effects",
    headline: "Generate sound effects on your own machine",
    lede: "Describe the sound and get a WAV file, made on your own machine. Every example on this site shows the exact prompt that made it, so you can learn what works before you install.",
    hero: "chip-impact",
    shot: {
      src: "/product/app-sfx.webp",
      alt: 'The SFX page: a prompt box with duration, variations, seed, steps and CFG beside a list of ten generated sounds, each with its licence badge, model and duration.',
    },
    tricksTitle: "What a good prompt names",
    tricks: [
      {
        title: "A material",
        body: "Not “a crash”: a wooden crate, a steel door, a glass bottle. Materials decide the whole character of a sound.",
        sample: "chip-impact",
      },
      {
        title: "An action",
        body: "Smashing apart, dragging, trudging, boring, swinging past the microphone. The verb sets the shape over time.",
        sample: "chip-footsteps",
      },
      {
        title: "A space",
        body: "Warehouse reverb, a close mic, a dry room, a stone corridor. The space is half of what you hear.",
        sample: "chip-machinery",
      },
      {
        title: "Loops and ambience",
        body: "Ask for a seamless loop and get a bed: rain, a factory floor, a subway platform.",
        sample: "chip-ambience",
      },
      {
        title: "Browse hundreds more",
        body: "The sound effects section has hundreds of real renders across dozens of categories, each with its prompt and model.",
      },
    ],
    faq: [
      {
        question: "How long can a sound effect be?",
        answer:
          "Each model lists its maximum clip length on its page. You choose a duration when you generate, up to that limit.",
      },
      {
        question: "What file do I get?",
        answer:
          "A WAV file on your disk, with the prompt, model and seed kept alongside it in the library so you can reproduce it.",
      },
      FREE,
      GPU,
      OFFLINE,
      COMMERCIAL,
    ],
    related: ["make/game-audio", "alternatives/elevenlabs", "make/voiceovers"],
  },
  {
    slug: "game-audio",
    path: "make/game-audio",
    seoTitle: "AI game audio generator for developers | Mirli",
    seoDescription:
      "Generate game sound effects and music locally, then let Claude Code or Cursor add them to your project over MCP. A library per game. MIT licensed.",
    eyebrow: "Make · Game audio",
    headline: "Game audio that your agent can add for you",
    lede: "Generate sound effects, loops and music on your own machine, one library per game. Or point Claude Code, Cursor or any MCP client at it and ask for “a door slam and a coin pickup”.",
    hero: "laser-plasma-bolt",
    shot: {
      src: "/product/app-agents.webp",
      alt: 'The Agents page: call counts for the day, the MCP address and the Claude Code command to copy, and the three agents that have connected.',
    },
    tricksTitle: "Built for a project with a lot of small sounds",
    tricks: [
      {
        title: "The sounds a game is made of",
        body: "Weapons, pickups, UI, ambience, impacts and stings, from a one-line description each.",
        sample: "laser-plasma-bolt",
      },
      {
        title: "The small gestures",
        body: "A jump, a power-up, a defeat. Short, dry sounds are what the SFX model is good at.",
        sample: "coin-chime",
      },
      {
        title: "Tone, including the silly",
        body: "Describe the mood. Not every game over wants a dirge.",
        sample: "gameover-sad-trombone",
      },
      {
        title: "Music for the level, too",
        body: "A trailer build, a boss theme, a loop for a menu. Instrumentals come from Stable Audio 3.0 Small Music, from a description of genre, instruments and tempo.",
        sample: "inst-trailer",
      },
      {
        title: "A sound pass, by an agent",
        body: "A bundled skill reads your project, works out which events need a sound, generates each one and wires the files in. You review what it did.",
      },
      {
        title: "A library per game",
        body: "Profiles keep one library per game or client in a single install, switched from the header without a restart. The models are shared.",
      },
    ],
    faq: [
      {
        question: "How does the agent connect?",
        answer:
          "Start Mirli, then add it to your client with one command: claude mcp add --transport http soundbox http://127.0.0.1:17494/mcp. Cursor and other MCP clients take the same URL. The agent gets 24 tools for sounds, speech and multi-track stories.",
      },
      {
        question: "Can I ship these sounds in a commercial game?",
        answer:
          "It depends on the licence of the model that made each sound. The Models page shows every licence before you download, and some models forbid commercial use. This is not legal advice: read the licence first.",
      },
      FREE,
      GPU,
      OFFLINE,
    ],
    related: ["make/sound-effects", "alternatives/suno", "alternatives/elevenlabs"],
  },
  {
    slug: "voiceovers",
    path: "make/voiceovers",
    seoTitle: "Local text to speech and voice cloning | Mirli",
    seoDescription:
      "Read a script aloud, clone a voice from a short clip and cast voices onto script lines, all on your own machine. No account, no credits. MIT licensed.",
    eyebrow: "Make · Voiceovers",
    headline: "Text to speech and voice cloning, on your machine",
    lede: "Read text aloud, clone a voice from a short clip, and cast saved voices onto the lines of a script. It runs locally, so your script and voice samples stay on your computer while you generate.",
    hero: "voice-intro",
    shot: {
      src: "/product/app-voice-lab.webp",
      alt: 'The Voice Lab: five saved voices as cards and in a table, three cloned from clips and two built into a model, each with its number of reads and a Try it button.',
    },
    tricksTitle: "From one read to a whole script",
    tricks: [
      {
        title: "One read, or a whole script",
        body: "Speak a single line, or write a script with several speakers and voice it line by line.",
        sample: "voice-intro",
      },
      {
        title: "Clone from a short clip",
        body: "Save a cloned voice in the Voice Lab and reuse it. Only clone a voice you have permission to use, and check the model's licence.",
      },
      {
        title: "Fix one line, keep the rest",
        body: "Generation is per line. When a read is wrong, regenerate that line and leave the rest of the script alone.",
      },
      {
        title: "On a timeline",
        body: "Each line is a clip on its speaker's lane. Move clips, split them, mute a lane, then export one mixed WAV.",
      },
      {
        title: "Under music and effects",
        body: "Put the dialogue on the same timeline as a music bed and sound effects.",
        sample: "door-heavy-vault",
      },
    ],
    faq: [
      {
        question: "Which models read the text?",
        answer:
          "Several open-weight speech models run through audio.cpp, Chatterbox among them. The Models page lists each with its licence, size and what it can do.",
      },
      {
        question: "Can I clone any voice?",
        answer:
          "Cloning is built in, but you are responsible for having permission to use a voice, and each model's licence sets its own limits. The licence is shown before you download a model.",
      },
      FREE,
      GPU,
      OFFLINE,
    ],
    related: ["alternatives/elevenlabs", "make/game-audio", "make/sound-effects"],
  },
];

export function getLander(path: string): Lander | undefined {
  return LANDERS.find((l) => l.path === path);
}
