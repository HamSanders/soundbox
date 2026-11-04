/**
 * The `/sfx` taxonomy — one entry per programmatic landing page.
 *
 * Every entry carries its own metadata and intro copy. Entries with a `content`
 * block are publishable; the rest are the planned backlog and render only as
 * links from the hub (see `isPublished`). Nothing here is generated at runtime:
 * a page exists because someone wrote it, which is the whole difference between
 * this and a doorway-page farm.
 *
 * Ordering is deliberate — the hub renders these in groups, and the groups are
 * how search intent clusters, not how an alphabet sorts.
 */

import type { SfxCategory } from "./types";
import { EXTRA_SAMPLES } from "./expansions";
import { FOLEY_AND_TRANSPORT } from "./new-categories";
import { DESIGN_AND_CREATURE } from "./design-categories";

/** Hub grouping. Purely presentational, but stable enough to link against. */
export type SfxGroup =
  | "Games"
  | "Film & video"
  | "World & nature"
  | "Foley & materials"
  | "Vehicles & transport"
  | "Human & voice"
  | "Interface & motion";

export const GROUP_ORDER: SfxGroup[] = [
  "Games",
  "Film & video",
  "World & nature",
  "Foley & materials",
  "Vehicles & transport",
  "Human & voice",
  "Interface & motion",
];

export const CATEGORY_GROUPS: Record<string, SfxGroup> = {
  "8bit": "Games",
  "8bit-music": "Games",
  "chiptune-music": "Games",
  "retro-game": "Games",
  "video-game": "Games",
  "coin-pickup": "Games",
  "power-up": "Games",
  "game-over": "Games",
  laser: "Games",
  magic: "Games",
  weapon: "Games",

  explosion: "Film & video",
  impact: "Film & video",
  horror: "Film & video",
  "sci-fi": "Film & video",
  cinematic: "Film & video",
  glitch: "Film & video",
  crowd: "Film & video",

  rain: "World & nature",
  thunder: "World & nature",
  wind: "World & nature",
  water: "World & nature",
  fire: "World & nature",
  animal: "World & nature",
  ambience: "World & nature",
  footsteps: "World & nature",
  door: "World & nature",

  whoosh: "Interface & motion",
  ui: "Interface & motion",
  notification: "Interface & motion",
  transition: "Interface & motion",
  machinery: "Interface & motion",

  // Added after auditing the big libraries' own category trees — see the note
  // at the top of new-categories.ts for where each of these came from.
  robot: "Games",
  creature: "Games",

  riser: "Film & video",
  braam: "Film & video",
  drone: "Film & video",
  gunshot: "Film & video",
  alarm: "Film & video",
  electricity: "Film & video",
  cartoon: "Film & video",

  glass: "Foley & materials",
  metal: "Foley & materials",
  wood: "Foley & materials",
  paper: "Foley & materials",
  cloth: "Foley & materials",
  keyboard: "Foley & materials",
  clock: "Foley & materials",
  bell: "Foley & materials",

  car: "Vehicles & transport",
  engine: "Vehicles & transport",
  train: "Vehicles & transport",
  aircraft: "Vehicles & transport",

  applause: "Human & voice",
  scream: "Human & voice",
  heartbeat: "Human & voice",
};

/* ------------------------------------------------------------------------ */
/* The fully authored prototype page.                                        */
/* ------------------------------------------------------------------------ */

const EIGHT_BIT: SfxCategory = {
  slug: "8bit",
  name: "8-bit",
  coverImage: "/sfx/covers/8bit-cover.webp",
  targetQuery: "8bit sound effects",
  intent:
    "Solo/indie game devs building a retro-styled game who need coins, jumps, " +
    "lasers and death jingles, and would rather generate a set that matches " +
    "than dig through a pack where every clip came from a different game.",
  metaTitle: "8-Bit Sound Effects, Generated Locally | Konchi",
  metaDescription:
    "Make 8-bit and chiptune sound effects on your own machine: coins, jumps, lasers, power-ups. Real prompts, open-weight models, no cloud and no per-sound billing.",
  h1: "8-bit sound effects you generate yourself",
  intro:
    "Retro game audio uses a small vocabulary: a coin blip, an ascending jump, a descending " +
    "death jingle. Finding one clip is easy. Finding twenty that sound like the same machine " +
    "is harder. Konchi runs open-weight audio models on your own GPU, so you can generate " +
    "a whole set from one prompt family in one sitting, and regenerate any clip with a " +
    "different seed when it comes out wrong.",
  content: {
    samples: [
      {
        slug: "dungeon-loop-16bit",
        title: "Dungeon crawl loop",
        prompt:
          "16-bit chiptune dungeon crawl loop, driving square wave lead synth melody, triangle wave bass synth, punchy 8-bit drum machine percussion, dark minor key, 120 BPM, seamless loop",
        source: "model",
        model: "audiocpp-stable-audio-3-sfx",
      },
      {
        slug: "boss-battle-sting",
        title: "Boss battle stinger",
        prompt:
          "8-bit boss battle intro stinger, square wave brass stab synth hits, fast triangle wave bass synth run, escalating rhythmic intensity, three phrases building tension, chiptune",
        source: "model",
        model: "audiocpp-stable-audio-3-sfx",
      },
      {
        slug: "level-complete-fanfare-full",
        title: "Level-complete fanfare (full)",
        prompt:
          "chiptune level-complete fanfare, square wave lead synth melody, triangle wave harmony synth, 8-bit noise-channel drum hits, four ascending musical phrases resolving to a bright major chord",
        source: "model",
        model: "audiocpp-stable-audio-3-sfx",
      },
      {
        slug: "8bit-boss-theme-loop",
        title: "Boss theme loop",
        prompt:
          "8-bit boss battle theme, driving square wave bass synth, fast arpeggiated pulse wave lead synth, noise-channel drum machine on the offbeat, tense minor key, 140 BPM, seamless loop",
        source: "model",
        model: "audiocpp-stable-audio-3-sfx",
      },
    ],
    recipes: [
      {
        label: "Coin / pickup",
        prompt:
          "short two-note chiptune coin pickup, bright square wave, B5 up to E6, no reverb",
        why: "Name the two pitches and the interval, or the model returns a generic ping. A coin sound rises.",
      },
      {
        label: "Jump",
        prompt:
          "8-bit jump blip, square wave rising from low to high over 300 ms, tight and dry",
        why: "Give the duration in milliseconds. Past half a second, a jump starts to sound like a siren.",
      },
      {
        label: "Laser",
        prompt:
          "retro arcade laser shot, thin pulse wave sweeping downward fast, narrow duty cycle",
        why: "\"Narrow duty cycle\" is the timbre term for the reedy NES lead. It is more precise than \"sci-fi\".",
      },
      {
        label: "Game over",
        prompt:
          "chiptune game over jingle, six-note descending minor line, square wave, slow and final",
        why: "State the direction and the mode. Ascending major reads as a win and descending minor as a loss.",
      },
      {
        label: "Menu blip",
        prompt:
          "single 8-bit menu select blip, one short square wave note, 60 ms, completely dry",
        why: "UI sounds usually come out too long. State the length and trim the tail in your editor afterwards.",
      },
    ],
    craft: [
      {
        heading: "Describe the waveform",
        body: "These models respond to physical and technical description better than to mood words. \"Retro sound\" gives you mush. \"Square wave, narrow duty cycle, no reverb, 200 ms\" gives you something you can drop into a game. Name three things every time: the waveform (square, pulse, triangle, filtered noise), the pitch movement (rising, falling, a named interval) and the space (dry or no reverb; chiptune SFX are almost always fully dry).",
      },
      {
        heading: "Generate short, layer later",
        body: "A three-second clip is easier to place precisely than a twenty-second one. Most 8-bit effects should be under half a second. Generate them short, then layer and pitch them in your DAW or game engine. A coin and a power-up built from the same square-wave prompt family sit together better than clips from six different sample packs.",
      },
      {
        heading: "Use seeds to get a matching set",
        body: "Konchi records the prompt, seed, steps and CFG for every sound it makes and lets you regenerate from any of them. To build a coherent set, find a seed whose character you like, then vary only the pitch and length words in the prompt across the family. If one clip comes out wrong, re-roll that clip and keep the rest.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer:
          "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer:
          "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer:
          "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short 8-bit blips and slow for anything longer.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer:
          "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent building your level can make the door sound in the same pass and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer:
          "A pack gives you someone else's twelve coin sounds. Generating gives you a coin at the pitch of your menu music and the length your animation needs, in a set that matches. It costs time and a GPU.",
      },
    ],
    related: ["retro-game", "video-game", "coin-pickup", "power-up", "game-over", "laser"],
  },
};

const CHIPTUNE_MUSIC: SfxCategory = {
  slug: "chiptune-music",
  name: "Chiptune Music",
  targetQuery: "chiptune music generator",
  intent:
    "Game devs and musicians who want authentic chip-music — SID, FM synth, tracker — " +
    "named by the actual hardware it imitates, not a vague \"retro\" preset, and who need " +
    "a full loop rather than a one-shot blip.",
  metaTitle: "Chiptune Music Generator: SID, FM Synth & Tracker Loops | Konchi",
  metaDescription:
    "Generate chiptune music locally: SID chip, Sega Genesis FM synth, NES 2A03, OPL2 AdLib and Amiga tracker loops. Real prompts, open-weight models, no cloud.",
  h1: "Chiptune music, named by the chip it imitates",
  intro:
    "A Commodore 64 SID chip, a Sega Genesis YM2612 FM synth and a Yamaha OPL2 AdLib card " +
    "are three different pieces of hardware with three different timbres. A prompt that " +
    "says only \"chiptune\" leaves the model to guess which one you mean. Name the chip and " +
    "the voice it is known for (filtered square wave, FM bell, tracker sample) and Stable " +
    "Audio renders a loop in that machine's sound.",
  content: {
    samples: [
      {
        slug: "sid-chiptune-loop",
        title: "SID chip loop (C64)",
        prompt:
          "Commodore 64 SID chip chiptune loop, MOS 6581 filtered square wave lead synth arpeggio, pulse-width modulation bass synth, gritty analog filter sweep, upbeat major key, 130 BPM, seamless loop",
        source: "model",
        model: "audiocpp-stable-audio-3-sfx",
      },
      {
        slug: "genesis-fm-synth-theme",
        title: "Genesis FM synth theme",
        prompt:
          "Sega Genesis YM2612 FM synth action theme, punchy FM bell lead synth melody, driving FM bass synth, crisp PSG noise-channel hi-hats, energetic 16-bit action game score, 140 BPM, seamless loop",
        source: "model",
        model: "audiocpp-stable-audio-3-sfx",
      },
      {
        slug: "nes-2a03-dungeon-theme",
        title: "NES 2A03 dungeon theme",
        prompt:
          "NES 2A03 chiptune dungeon theme, triangle wave bass synth ostinato, pulse wave lead synth melody with duty-cycle changes, noise-channel percussion, moody minor key, seamless loop",
        source: "model",
        model: "audiocpp-stable-audio-3-sfx",
      },
      {
        slug: "opl2-adlib-boss-theme",
        title: "OPL2 AdLib boss theme",
        prompt:
          "Yamaha OPL2 AdLib FM synthesis boss battle theme, aggressive FM brass stab synth hits, driving FM bass synth line, retro PC soundcard timbre, tense minor key, 145 BPM, seamless loop",
        source: "model",
        model: "audiocpp-stable-audio-3-sfx",
      },
      {
        slug: "amiga-modtracker-overworld",
        title: "Amiga tracker overworld theme",
        prompt:
          "Amiga ProTracker module overworld theme, sampled square wave lead synth melody, plucked chiptune bass synth, tracker-style drum breaks, bright cheerful major key, seamless loop",
        source: "model",
        model: "audiocpp-stable-audio-3-sfx",
      },
      // ACE-Step, not Stable Audio — the other four loops above are instrumental
      // because Stable Audio has no vocal path at all. ACE-Step is a
      // lyrics-conditioned vocal music model: `prompt` still sets genre and
      // instrumentation, but a separate `lyrics` block gives it words to sing,
      // which is the one thing no other model on this page can do.
      {
        slug: "hero-anthem-vocal-chant",
        title: "8-bit hero anthem (vocal)",
        prompt:
          "8-bit chiptune hero anthem, bright square wave lead synth melody, driving triangle wave bass synth, punchy noise-channel drums, energetic major key, gang-vocal chant",
        source: "model",
        model: "audiocpp-ace-step",
      },
    ],
    recipes: [
      {
        label: "SID (Commodore 64)",
        prompt:
          "Commodore 64 SID chip loop, MOS 6581 filtered square wave lead synth, pulse-width modulation bass synth, analog filter sweep",
        why: "\"Filtered\" and \"pulse-width modulation\" separate a SID from a generic square wave. The SID's analog filter and PWM bass are its signature.",
      },
      {
        label: "Sega Genesis FM synth",
        prompt:
          "Sega Genesis YM2612 FM synth theme, FM bell lead synth, FM bass synth, PSG noise-channel hi-hats",
        why: "Use \"FM\" plus an instrument word (bell, bass). FM synthesis has a metallic, bell-like character that square-wave chiptune lacks, and naming the synthesis method gets it.",
      },
      {
        label: "NES 2A03",
        prompt:
          "NES 2A03 chiptune theme, triangle wave bass synth, pulse wave lead synth with duty-cycle changes, noise-channel percussion",
        why: "The 2A03 has four voices: two pulse, one triangle, one noise. Name each by its role (bass, lead, percussion) to keep the arrangement authentic. Otherwise you get a wall of square waves.",
      },
      {
        label: "OPL2 / AdLib",
        prompt:
          "Yamaha OPL2 AdLib FM synthesis theme, FM brass stab synth hits, FM bass synth line, retro PC soundcard timbre",
        why: "OPL2 is a different FM chip from the Genesis's YM2612. \"AdLib\" and \"soundcard\" push the model toward its thinner, brassier late-80s PC voice.",
      },
      {
        label: "Amiga / tracker",
        prompt:
          "Amiga ProTracker module theme, sampled square wave lead synth melody, plucked bass synth, tracker-style drum breaks",
        why: "The Amiga played back samples instead of synthesising its voices. \"Tracker\" and \"sampled\" push the output toward that grittier, sample-based texture.",
      },
      {
        label: "Hero anthem (vocal)",
        prompt:
          "8-bit chiptune hero anthem, bright square wave lead synth melody, driving triangle wave bass synth, punchy noise-channel drums, energetic major key, gang-vocal chant",
        why: "ACE-Step's `prompt` sets genre and instrumentation, as on the instrumental loops above. A separate `lyrics` field (\"[verse]\\nRise up, hero\\nThe quest begins\") gives it words to sing over the beat.",
      },
    ],
    craft: [
      {
        heading: "Name the chip",
        body: "\"Retro\" and \"old-school\" describe an era. \"SID\", \"YM2612\", \"2A03\" and \"OPL2\" describe a sound. Each chip has a well-documented timbre: the SID's analog filter, the YM2612's FM bell tones, the 2A03's four fixed voices, the OPL2's thinner AdLib character. Naming the chip tells the model which of these you want.",
      },
      {
        heading: "Use a music model for loops",
        body: "Stable Audio 3 SFX is tuned for one-shot sound design: a door, a footstep, a laser. A 15-second chiptune loop needs a lead melody, a bass line and percussion that stay in time and in key for the whole length. That is a composition task, and a music model (Stable Audio 3 Small Music or ACE-Step) holds it together better. Use one whenever the result should sound like an instrument performance.",
      },
      {
        heading: "Ask for a seamless loop",
        body: "These models can render a loop where the last beat lines up with the first. Ask for it explicitly and write the prompt as a fixed-tempo phrase (\"130 BPM\", \"seamless loop\"). If the loop point still clicks, trim a few milliseconds off the tail or add a short crossfade in an editor.",
      },
      {
        heading: "Stable Audio plays instruments; ACE-Step sings",
        body: "The Stable Audio loops above have no voice, because Stable Audio 3 Small SFX has no vocal path. It renders instruments only. ACE-Step is a separate model family built for lyrics-conditioned vocal music: give it a `lyrics` block and it sings those words over the arrangement described in `prompt`. Use it when you need a hook, a chant or a sung line, such as a hero anthem or a victory chorus.",
      },
    ],
    faqs: [
      {
        question: "What's the difference between chiptune and 8-bit music?",
        answer:
          "8-bit usually means the sound of 8-bit game consoles: the NES's 2A03 or the Game Boy's APU, both limited to four simple voices. Chiptune is the broader family. It includes those consoles plus 16-bit-era FM synth chips (the Sega Genesis's YM2612), PC soundcards (the OPL2/OPL3 behind AdLib and Sound Blaster) and sample-based tracker music (the Commodore Amiga). For the 8-bit console sound, see the 8-bit music collection. This page covers the wider family.",
      },
      {
        question: "Can I use AI-generated chiptune music commercially?",
        answer:
          "It depends on the model that made it. Konchi shows each model's licence before you download its weights. Most samples on this page were made with Stable Audio 3 Small SFX, under the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. The vocal track was made with ACE-Step 1.5, which is MIT. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Can these loops have vocals?",
        answer:
          "One can. ACE-Step is a lyrics-conditioned vocal music model, and the hero anthem sample above gives it a short chant to sing. Stable Audio 3 Small SFX, which made the other loops, is instrumental only and cannot produce words. For a sung hook over a chiptune backing, use ACE-Step and its `lyrics` field.",
      },
      {
        question: "Does this sound like a real SID or YM2612 chip?",
        answer:
          "It is a diffusion model's impression of the timbre. No SID or YM2612 emulation runs underneath. For sample-accurate chip sound, use an emulator (VICE for the SID, a Genesis sound driver for the YM2612). Generation gives you a quick starting loop in that style, which you can rebuild in a chiptune tracker or emulator if you need bit-exact output.",
      },
      {
        question: "Does this run offline?",
        answer:
          "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "Can my coding agent generate a chiptune soundtrack for my game?",
        answer:
          "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent building your game's audio can generate a set of chip-specific loops in one pass and gets back absolute file paths to use in your project.",
      },
    ],
    related: ["8bit-music", "8bit", "retro-game", "cinematic"],
  },
};

const EIGHT_BIT_MUSIC: SfxCategory = {
  slug: "8bit-music",
  name: "8-Bit Music",
  targetQuery: "8 bit music generator",
  intent:
    "Indie devs who need drop-in background music for a retro-styled game — a title screen, " +
    "an overworld, a shop, a final boss — built from the specific NES/Game Boy voices " +
    "(square, pulse, triangle, noise-channel) rather than a generic chiptune preset.",
  metaTitle: "8-Bit Music Generator for Game Loops | Konchi",
  metaDescription:
    "Generate 8-bit background music locally: Game Boy and NES-style title, overworld, shop and boss loops. The prompts name each synth voice. No cloud, no per-track fees.",
  h1: "8-bit background music for your game",
  intro:
    "An 8-bit console has four voices to write with: two pulse/square waves, one triangle " +
    "and one noise channel. Every NES or Game Boy soundtrack was built from that set. Name " +
    "the four voices by role (lead, harmony, bass, percussion) and the model returns a loop " +
    "that can sit under a title screen or an overworld map. Asking for \"8-bit music\" alone " +
    "tends to return a generic run of blips.",
  content: {
    samples: [
      {
        slug: "gameboy-overworld-loop",
        title: "Game Boy overworld loop",
        prompt:
          "Game Boy APU chiptune overworld theme, cheerful square wave lead synth melody, pulse wave harmony synth, triangle wave bass synth, simple noise-channel percussion, bright major key, 125 BPM, seamless loop",
        source: "model",
        model: "audiocpp-stable-audio-3-sfx",
      },
      {
        slug: "nes-title-screen-theme",
        title: "NES title screen theme",
        prompt:
          "NES-style 8-bit title screen theme, bold square wave lead synth fanfare opening into a looping pulse wave melody, triangle wave bass synth, noise-channel snare hits, heroic major key, seamless loop",
        source: "model",
        model: "audiocpp-stable-audio-3-sfx",
      },
      {
        slug: "8bit-shop-menu-loop",
        title: "Shop / menu loop",
        prompt:
          "8-bit shop menu background loop, gentle square wave lead synth melody, soft triangle wave bass synth, sparse noise-channel percussion, relaxed mid-tempo major key, seamless loop",
        source: "model",
        model: "audiocpp-stable-audio-3-sfx",
      },
      {
        slug: "8bit-final-boss-theme",
        title: "Final boss theme",
        prompt:
          "8-bit final boss battle theme, fast arpeggiated pulse wave lead synth, driving triangle wave bass synth, aggressive noise-channel drum pattern, dark minor key, 150 BPM, seamless loop",
        source: "model",
        model: "audiocpp-stable-audio-3-sfx",
      },
      // Same instrumental loop territory as the four above, rendered by
      // ACE-Step instead of Stable Audio — no lyrics on this one, since the
      // point here is comparing two different models' takes on an
      // instrumental chiptune loop, not showing off the vocal path (see the
      // chiptune-music collection for that).
      {
        slug: "ace-victory-loop",
        title: "Victory loop (ACE-Step)",
        prompt:
          "Game Boy APU chiptune victory loop, cheerful square wave lead synth melody, pulse wave harmony synth, triangle wave bass synth, bright major key, seamless loop",
        source: "model",
        model: "audiocpp-ace-step",
      },
    ],
    recipes: [
      {
        label: "Overworld / exploration",
        prompt:
          "Game Boy APU overworld theme, cheerful square wave lead synth, pulse wave harmony synth, triangle wave bass synth, simple noise-channel percussion, bright major key",
        why: "Name all four voices by their job (lead, harmony, bass, percussion). Otherwise the arrangement collapses into one melody line with no supporting parts.",
      },
      {
        label: "Title screen",
        prompt:
          "NES-style title screen theme, bold square wave lead synth fanfare opening into a looping pulse wave melody, triangle wave bass synth, noise-channel snare hits",
        why: "A title theme opens with a fanfare and then loops. Say so in the prompt to get that intro-into-loop structure.",
      },
      {
        label: "Menu / shop",
        prompt:
          "8-bit shop menu loop, gentle square wave lead synth, soft triangle wave bass synth, sparse noise-channel percussion, relaxed mid-tempo",
        why: "Menu music has to sit quietly under UI sounds. The model fills every voice unless told to hold back, so say \"sparse\" and \"relaxed\".",
      },
      {
        label: "Boss battle",
        prompt:
          "8-bit final boss theme, fast arpeggiated pulse wave lead synth, driving triangle wave bass synth, aggressive noise-channel drum pattern, dark minor key, 150 BPM",
        why: "Each square-wave channel plays one note at a time, so NES composers used fast arpeggios to imply chords. \"Arpeggiated\" asks for that.",
      },
    ],
    craft: [
      {
        heading: "Write for four voices",
        body: "8-bit hardware had a limit of four simultaneous voices, and that limit is what makes the genre recognisable. Ask for a lead melody, a harmony or counter-melody, a bass line and percussion by name, and the model renders something that reads as a composition. Ask for \"8-bit music\" alone and you tend to get one busy lead line with little underneath.",
      },
      {
        heading: "Use a music model for background loops",
        body: "Stable Audio 3 SFX is built for one-shot sound design: coins, jumps, hits. A 15-second background loop needs melody, harmony, bass and drums that stay in key and in time for the full length. That is a composition task, and a music model (Stable Audio 3 Small Music or ACE-Step) holds it together better. Use the SFX model for the coin blip and a music model for the music under it.",
      },
      {
        heading: "Match the tempo to the scene",
        body: "State a BPM. Overworld and shop themes sound calmer around 100 to 125 BPM; boss and combat themes want 140 to 160. The model follows a stated tempo more reliably than a mood word like \"energetic\". A consistent BPM across a set also helps several tracks sound like the same game.",
      },
      {
        heading: "The same brief on two models",
        body: "The victory loop above uses nearly the same instrumental brief as the overworld loop (same voices, same major key, same \"seamless loop\" instruction) but renders it on ACE-Step instead of Stable Audio 3 Small SFX. ACE-Step is mainly a lyrics-conditioned vocal model (the chiptune-music collection has a sung example). With `lyrics` left empty it renders a usable instrumental, which makes it a second option for loops like these.",
      },
    ],
    faqs: [
      {
        question: "Can I use this as background music in a commercial game?",
        answer:
          "It depends on the model that made it. Konchi shows each model's licence before you download its weights. Most samples on this page were made with Stable Audio 3 Small SFX, under the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. The victory loop was made with ACE-Step 1.5, which is MIT. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "How long a loop can I generate?",
        answer:
          "Stable Audio 3.0 SFX renders 10 seconds by default and up to 120; the samples here run 13 to 18 seconds. For a loop, generate the phrase you want repeated and loop it in your game engine or DAW. That gives a cleaner loop point than one long render.",
      },
      {
        question: "What's the difference between this and the chiptune music collection?",
        answer:
          "This page covers the 8-bit console sound (NES and Game Boy-style square, pulse, triangle and noise-channel voices), organised by game scene: title, overworld, shop, boss. The chiptune music collection covers the wider family, including 16-bit FM synth chips (Sega Genesis), PC soundcards (OPL2/AdLib) and Amiga tracker music.",
      },
      {
        question: "Can my coding agent generate a full soundtrack for my game?",
        answer:
          "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent building your game can generate the title, overworld, shop and boss themes in one pass and gets back absolute file paths to use in your project.",
      },
      {
        question: "Does this run offline?",
        answer:
          "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
    ],
    related: ["chiptune-music", "8bit", "retro-game", "video-game"],
  },
};

const WHOOSH: SfxCategory = {
  slug: "whoosh",
  name: "Whoosh",
  coverImage: "/sfx/covers/whoosh-cover.webp",
  targetQuery: "whoosh sound effect",
  intent:
    "Video editors and motion designers who need a swipe, swing or transition sound that " +
    "matches the exact speed and size of the object moving on screen, rather than a whoosh " +
    "that was clearly recorded for someone else's cut.",
  metaTitle: "Whoosh Sound Effects, Generated Locally | Konchi",
  metaDescription:
    "Make whoosh, swipe and transition sounds on your own machine: fast or slow, small or huge, dry or roomy. Real prompts, open-weight models, no cloud.",
  h1: "Whoosh sound effects you generate yourself",
  intro:
    "A whoosh is an object moving through air, so the prompt is mostly physics: how fast it " +
    "moved and how heavy it was. Konchi runs open-weight audio models on your own GPU. You " +
    "generate a whoosh at the length and weight your cut needs, and regenerate it when the " +
    "edit changes, without searching a library for a clip that happens to fit.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Fast swipe",
        prompt:
          "fast thin whoosh, small light object passing close to the microphone, 200 ms, sharp attack, dry",
        why: "\"Close to the microphone\" makes it read as fast. Proximity conveys speed better than a tempo word.",
      },
      {
        label: "Heavy sweep",
        prompt:
          "slow heavy whoosh, large object moving through open air, 1.5 seconds, low-frequency weight, subtle room tone",
        why: "Name the frequency range (\"low-frequency weight\") to make the object sound heavy. Speed and mass need separate words in the prompt.",
      },
      {
        label: "Doppler pass-by",
        prompt:
          "realistic cinematic whoosh, deep object passing overhead, doppler pitch shift down as it passes, 2 seconds, roomy",
        why: "\"Doppler pitch shift down as it passes\" names what a real pass-by does acoustically. Without it the whoosh swells and fades without moving.",
      },
      {
        label: "UI transition",
        prompt:
          "short UI swipe whoosh for screen transition, thin and clean, left-to-right pan implied, 250 ms, completely dry",
        why: "Room tone on an interface whoosh clutters the mix. \"Completely dry\" keeps the sound out of the way of whatever plays under it.",
      },
      {
        label: "Cartoon swish",
        prompt:
          "cartoon whoosh swish, exaggerated pitch rise then fall, bright and airy, 400 ms, no low end",
        why: "\"No low end\" stops a comedic swish from sounding cinematic. Cartoon sounds sit in the upper register.",
      },
    ],
    craft: [
      {
        heading: "Set speed and mass separately",
        body: "A whoosh is displaced air, and it changes with how fast the object moved and how big it was. Set both: speed as a duration (\"200 ms\" reads fast, \"1.5 seconds\" reads slow) and mass as a frequency description (\"thin\" and \"light\" for something small, \"low-frequency weight\" or \"heavy\" for something large). A prompt that sets only one drifts toward a generic mid-sized swoosh.",
      },
      {
        heading: "Use doppler for realism",
        body: "A whoosh that only fades in and out sounds synthetic. When a real object passes a stationary listener, the pitch drops slightly as it passes and recedes. Writing \"doppler pitch shift down as it passes\" is the most reliable way to move a generation from cartoon swish to realistic pass-by.",
      },
      {
        heading: "Dry for cuts, roomy for reveals",
        body: "A whoosh under a hard cut needs to be dry and short so it doesn't smear into the next shot. Say \"dry\" or \"no reverb\" and keep it under half a second. A whoosh for a slow reveal or a title card can have room tone and a longer tail. Decide which job the sound is doing before you write the prompt.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer:
          "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer:
          "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer:
          "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few transition whooshes and slow for a whole edit's worth.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer:
          "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent wiring up your UI transitions can generate the swipe sound in the same pass and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer:
          "A pack gives you someone else's whoosh, timed for someone else's edit. Generating gives you one at the duration your cut needs, with speed and weight matched to what moves on screen. It costs time and a GPU.",
      },
    ],
    related: ["transition", "cinematic", "ui", "glitch", "impact", "explosion"],
  },
};

const FOOTSTEPS: SfxCategory = {
  slug: "footsteps",
  name: "Footsteps",
  coverImage: "/sfx/covers/footsteps-cover.webp",
  targetQuery: "footsteps sound effect",
  intent:
    "Game devs and sound designers who need a set of footstep variations per surface — " +
    "gravel, wood, concrete, snow — that all sound like the same pair of boots, rather than " +
    "eight clips pulled from eight different recording sessions.",
  metaTitle: "Footstep Sound Effects, Generated Locally | Konchi",
  metaDescription:
    "Make footstep sound effects on your own machine: gravel, wood, concrete, snow, water, grass. Real prompts, open-weight models, no cloud, no billing.",
  h1: "Footstep sound effects you generate yourself",
  intro:
    "A footstep is a foot's weight meeting a surface for a few dozen milliseconds. Games need " +
    "many of them, matched per surface and per pace. Konchi runs open-weight audio models " +
    "on your own GPU, so you can generate a whole surface set from one prompt family and " +
    "regenerate any single step that comes out wrong.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Gravel",
        prompt:
          "single footstep on loose gravel, walking pace, boot sole, close mic, crunchy grain, dry",
        why: "\"Crunchy grain\" describes small stones shifting under weight. \"Gravel\" alone tends to come back as generic crunch.",
      },
      {
        label: "Wood floor",
        prompt:
          "single footstep on old wooden floorboard, walking pace, boot heel, slight creak, small room reflection",
        why: "\"Small room reflection\" separates an indoor wood step from an outdoor deck. Footsteps carry more of the room than most sounds.",
      },
      {
        label: "Concrete run",
        prompt:
          "single footstep on bare concrete, running pace, hard sneaker sole, sharp slap, tight and dry",
        why: "\"Running\" changes the impact shape. Running steps are shorter and harder-edged than walking steps on the same surface.",
      },
      {
        label: "Snow",
        prompt:
          "single footstep in fresh snow, walking pace, boot sinking in, soft compressing crunch, muffled and close",
        why: "\"Sinking in\" and \"compressing\" describe what snow does underfoot. Without them it comes back as generic soft crunch.",
      },
      {
        label: "Water",
        prompt:
          "single footstep in shallow water, walking pace, bare foot, splash with a wet slap, small puddle depth",
        why: "State the depth (\"small puddle\"). Depth decides how much water moves; without it the model reaches for a full splash or a swimming sound.",
      },
    ],
    craft: [
      {
        heading: "Describe what the surface does",
        body: "\"Gravel\" gives the model a category; \"loose gravel, crunchy grain\" gives it a mechanism. Surfaces sound most convincing when you describe what the material does under weight: compresses, shifts, creaks, splashes. Pair the material with the footwear (boot, bare foot, sneaker), since the sole changes the sound as much as the surface does.",
      },
      {
        heading: "Generate one step, build the walk cycle after",
        body: "Ask for a single footstep. One clean impact is easier to place in an animation than a pre-timed sequence that never lines up with your character's stride. Generate four to eight single-step variations per surface from the same prompt family, changing only small wording, then alternate them in your footstep system so no two consecutive steps sound identical.",
      },
      {
        heading: "Pace changes the impact",
        body: "A running step is a different sound from a walking step on the same surface. It lands harder and shorter, with less roll-off, because more weight arrives faster. Write \"walking pace\", \"running pace\" or \"jogging\" in the prompt instead of relying on duration, and keep the mic distance close and consistent across a surface set so the set matches.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer:
          "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer:
          "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer:
          "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few single steps and slow for a full surface set of eight variations.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer:
          "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent wiring up a character's surface detection can generate a matching step set in the same pass and gets back absolute file paths to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer:
          "Pack footsteps on different surfaces are often recorded at different distances with different boots, so they don't match. Generating gives you a whole surface set from one prompt family, so the gravel and the wood sound like the same character walked on both. It costs time and a GPU.",
      },
    ],
    related: ["door", "impact", "ambience", "horror", "animal", "water"],
  },
};

/* ------------------------------------------------------------------------ */
/* The rest of the taxonomy. All fully authored.                             */
/* ------------------------------------------------------------------------ */

const RETRO_GAME: SfxCategory = {
  slug: "retro-game",
  name: "Retro game",
  coverImage: "/sfx/covers/retro-game-cover.webp",
  targetQuery: "retro game sound effects",
  intent:
    "Broader than 8-bit: 16-bit, arcade and early-CD-era game audio.",
  metaTitle: "Retro Game Sound Effects, Generated Locally | Konchi",
  metaDescription:
    "Generate retro and arcade game sound effects on your own machine. Konchi saves the prompt, seed and settings for every sound.",
  h1: "Retro game sound effects, made on your machine",
  intro:
    "Arcade and early-console audio has a specific grain. This page shows how to describe it to a model.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Menu blip",
        prompt: "8-bit menu navigation blip, single square wave note, 80 ms, mid pitch, completely dry",
        why: "\"Mid pitch\" keeps the blip from reading as a coin (high) or an error (low). Cursor sounds sit in the middle of the register.",
      },
      {
        label: "Confirm chime",
        prompt: "retro menu confirm chime, two-note square wave rise, low to high fifth, 150 ms, dry",
        why: "Name the interval as a fifth. A fifth gives the open, resolved quality a confirm sound needs, distinct from the tighter climb of a coin pickup.",
      },
      {
        label: "Level-start fanfare",
        prompt: "chiptune level-start fanfare, four-note ascending square wave arpeggio, bright and punchy, 700 ms",
        why: "\"Punchy\" keeps each note's attack sharp so the arpeggio doesn't blur into a pad. The sharp attack is what makes a fanfare sound energetic.",
      },
      {
        label: "Error buzz",
        prompt: "retro error buzz, low pulse wave held flat for 200 ms, slight detune, harsh and dry",
        why: "\"Held flat\" matters most. A static pitch reads as a rejection; any pitch movement starts to sound like a musical note.",
      },
      {
        label: "Boss alert",
        prompt: "8-bit boss-appears alert, descending pulse wave siren over 600 ms, wide duty cycle, ominous but dry",
        why: "\"Wide duty cycle\" gives the pulse wave a thicker, more aggressive timbre than the thin lead used for lasers. That timbre signals threat.",
      },
    ],
    craft: [
      {
        heading: "Prompt for the sound's function",
        body: "Most retro-game sounds are functional signals: confirm, deny, advance, warn. Prompt for the function. Say whether the sound should read as a success or a rejection, and let pitch direction carry that meaning (rising for good, static or falling for bad). Keep melodic detail for the few sounds that are musical, like fanfares and jingles.",
      },
      {
        heading: "Keep the waveform palette consistent across a set",
        body: "In a convincing retro game, every sound comes from the same two or three oscillators. Use square wave for melodic UI cues, pulse wave with a stated duty cycle for lasers and alerts, and filtered noise for hits and errors. Keep that palette across every prompt in the set so the game sounds like it has one sound chip.",
      },
      {
        heading: "State duration to control how much a sound interrupts",
        body: "UI feedback that runs too long feels like it is blocking the player. Menu blips and confirms want 80 to 200 ms. Fanfares and boss alerts can run to 600 to 800 ms because they mark a real event. Put the number in the prompt. The model reads a word like \"short\" differently depending on the rest of the prompt.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A retro asset pack gives you one designer's whole UI set: their confirm, their error, their fanfare. It rarely matches your game's coin or laser sounds, which came from somewhere else. Generating lets you build every UI cue from the same prompt family as your gameplay sounds, so a menu confirm and a coin pickup share a waveform and a register.",
      },
    ],
    related: ["8bit", "video-game", "coin-pickup", "power-up", "game-over", "ui"],
  },
};
const VIDEO_GAME: SfxCategory = {
  slug: "video-game",
  name: "Video game",
  coverImage: "/sfx/covers/video-game-cover.webp",
  targetQuery: "video game sound effects",
  intent:
    "Highest-volume head term; searcher wants a starting point and a tool.",
  metaTitle: "Video Game Sound Effects Generator | Konchi",
  metaDescription:
    "Generate video game sound effects locally from a text prompt. Open-weight models, your GPU, no per-sound billing.",
  h1: "Video game sound effects from a text prompt",
  intro:
    "A game needs a hundred small sounds. Konchi generates them locally from text prompts and saves the settings, so you can make any of them again.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Footstep",
        prompt: "single game footstep impact, boot on generic hard surface, walking pace, close mic, tight and dry, 150 ms",
        why: "\"Generic hard surface\" keeps a base footstep neutral, so it layers with any surface-swap system.",
      },
      {
        label: "Melee swing",
        prompt: "melee weapon swing whoosh, fast blade cutting air, sharp doppler snap, 300 ms, dry",
        why: "\"Doppler snap\" is the sound of a blade passing close and fast. Naming it gets the crack of a real swing.",
      },
      {
        label: "Hit marker",
        prompt: "hit marker confirmation tick, short high synth click, 60 ms, no tail, completely dry",
        why: "\"No tail\" matters most here. A hit marker has to repeat rapidly without smearing, and any reverb or decay prevents that.",
      },
      {
        label: "Quest complete",
        prompt: "quest complete stinger, bright orchestral-hybrid rising chord over 900 ms, triumphant, light room reverb",
        why: "Unlike most UI sounds, a reward stinger can have \"light room reverb\". It should feel bigger than a click.",
      },
      {
        label: "Low health warning",
        prompt: "low health warning pulse, low sine wave thump repeating twice over 500 ms, tense, dry",
        why: "\"Repeating twice\" gives the model a rhythm to generate. The repeat makes the warning read as ongoing.",
      },
    ],
    craft: [
      {
        heading: "Separate diegetic sounds from UI sounds in the prompt",
        body: "A footstep or a sword swing exists in the game world and should carry some acoustic space: mic distance, a hint of environment. A hit marker or an inventory chime is a UI sound and should stay flat and dry so it doesn't compete with the mix. Decide which kind a sound is before writing the prompt, and use reverb or room words only on the in-world ones.",
      },
      {
        heading: "Use generic materials for reusable sounds",
        body: "If a sound has to work in many in-game contexts (a base footstep before surface detection, a generic impact before you know what is being hit), describe it in neutral terms such as \"generic hard surface\" or \"solid object\" so it doesn't clash later. Name specific materials (gravel, metal, wood) only for sounds that will play in one context.",
      },
      {
        heading: "Reward sounds can be longer and roomier",
        body: "Most gameplay UI should be short and dry so it stays out of the player's way. The few sounds that mark an achievement (level up, quest complete, boss defeated) can be longer and roomier, because for that moment the sound should fill the space. Prompt those with duration and reverb words you avoid elsewhere.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A general video-game SFX pack covers every genre at once, so nothing in it is tuned to your UI style or your weapons. Generating lets you build a footstep, a hit marker and a quest stinger from prompts that share a register and an acoustic treatment, so the set sounds consistent.",
      },
    ],
    related: ["retro-game", "8bit", "coin-pickup", "power-up", "ui", "weapon"],
  },
};
const COIN_PICKUP: SfxCategory = {
  slug: "coin-pickup",
  name: "Coin pickup",
  coverImage: "/sfx/covers/coin-pickup-cover.webp",
  targetQuery: "coin pickup sound effect",
  intent:
    "Very specific single-asset search; wants one good clip immediately.",
  metaTitle: "Coin Pickup Sound Effect Generator | Konchi",
  metaDescription:
    "Make a coin pickup sound that matches your game's key and length. Konchi saves the prompt and seed so you can regenerate it, all locally.",
  h1: "Coin pickup sound effects",
  intro:
    "A coin sound is two notes and a rising interval. The work is getting it to sit with your menu music.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Classic coin",
        prompt: "short two-note chiptune coin pickup, bright square wave, B5 up to E6, no reverb, 150 ms",
        why: "Name the two pitches and the interval between them. A coin sound is defined by that specific rising leap, and \"rising\" alone is too vague.",
      },
      {
        label: "Coin combo",
        prompt: "rapid three-note ascending chiptune coin run, square wave, each note higher and shorter, 300 ms total, dry",
        why: "\"Each note higher and shorter\" makes the notes accelerate, so it sounds like a combo counter climbing.",
      },
      {
        label: "Gem pickup",
        prompt: "sparkling gem pickup chime, bright bell-like synth tone with fast shimmer, 400 ms, light reverb tail",
        why: "\"Bell-like\" and \"shimmer\" push the timbre toward metallic harmonics. That separates a premium gem from an ordinary coin.",
      },
      {
        label: "Physical coin drop",
        prompt: "coin dropping and tumbling on a hard surface, metallic clinking, three to four small bounces, 800 ms, close mic",
        why: "Count the bounces (\"three to four\"). A real tumble is a quick rhythm of small hits.",
      },
      {
        label: "Soft modern pickup",
        prompt: "soft modern pickup chime, single sine wave note with quick pitch bend up, 200 ms, subtle reverb, no harshness",
        why: "A sine wave and \"no harshness\" move the sound away from chiptune toward the rounder pickup tones that mobile and casual games use.",
      },
    ],
    craft: [
      {
        heading: "Keep the pitch rising",
        body: "Almost every pickup sound, in any style, says \"you gained something\" with upward pitch movement. Retro coins use a two-note square wave leap, modern pickups a smoother pitch bend, jackpot bursts a cascading run of many notes. Keep the direction rising. A falling pickup sound reads as a loss whatever else the prompt says.",
      },
      {
        heading: "Waveform sets the era",
        body: "Square wave with no reverb reads as retro or arcade. A sine wave with a pitch bend and a little reverb reads as a contemporary mobile or indie game. Bell-like or shimmering synth tones read as premium currency (gems, tokens); plainer tones read as base currency (coins). Decide the era and tier before writing the prompt and let the waveform word carry it. An adjective like \"modern\" or \"premium\" alone does little.",
      },
      {
        heading: "Make combos accelerate",
        body: "For a run of pickups in a combo or multiplier, ask for notes that get higher and shorter as the sequence continues. \"Three coin sounds\" gives you the same pickup three times. The acceleration makes the combo feel like it is building.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A pack gives you one fixed coin sound. If it doesn't match your game's key or your combo pacing, you have to edit someone else's file. Generating lets you set the pitches, the note count and the acceleration your combo system needs, and regenerate any variant when the design changes.",
      },
    ],
    related: ["8bit", "power-up", "retro-game", "video-game", "game-over", "notification"],
  },
};
const POWER_UP: SfxCategory = {
  slug: "power-up",
  name: "Power-up",
  coverImage: "/sfx/covers/power-up-cover.webp",
  targetQuery: "power up sound effect",
  intent:
    "Single-asset search, usually alongside coin and jump.",
  metaTitle: "Power-Up Sound Effect Generator | Konchi",
  metaDescription:
    "Generate power-up jingles locally: ascending arpeggios, sweeps and risers, with the prompt and seed saved for each one.",
  h1: "Power-up sound effects",
  intro:
    "A power-up sound has to be ascending and in a major key to read as a reward. The prompt words for that are few and easy to learn.",
  content: {
    samples: [
        // A rare-buff moment big enough to earn an actual sung line — ACE-Step
        // instead of the SFX model, prompt sets the arrangement and lyrics
        // gives it a hook to chant.
        {
          slug: "triumphant-power-chant",
          title: "Triumphant power chant (vocal)",
          prompt: "triumphant orchestral-hybrid power-up theme, uplifting choir vocals, bright brass and strings, ascending major key",
          source: "model",
          model: "audiocpp-ace-step",
        },
    ],
    recipes: [
      {
        label: "Classic power-up",
        prompt: "chiptune power-up jingle, five-note ascending major arpeggio, square wave, no decay tail, 500 ms",
        why: "\"No decay tail\" keeps each note punchy and equal in volume, so the five-note arpeggio reads as one event and doesn't trail off.",
      },
      {
        label: "Shield activate",
        prompt: "shield activation sound, rising synth pad with a soft shimmer, 600 ms, warm low-mid body, subtle reverb",
        why: "\"Warm low-mid body\" signals protection. A shield sound needs weight and coverage; a thin bright lead sounds like speed.",
      },
      {
        label: "Speed boost",
        prompt: "speed boost whoosh-synth hybrid, fast rising pitch sweep with a bright tail, 400 ms, energetic, dry",
        why: "\"Whoosh\" with \"synth\" blends an air-movement sound with a musical rise. The blend reads as velocity, which a plain arpeggio does not.",
      },
      {
        label: "Invincibility",
        prompt: "invincibility power-up fanfare, rapid ascending square wave run across two octaves, sparkly, 700 ms, dry",
        why: "Spanning \"two octaves\" makes this sound bigger and rarer than an ordinary five-note power-up. A wider range signals a bigger effect.",
      },
      {
        label: "Health restore",
        prompt: "health restore chime, warm rising sine wave with a gentle bell overtone, 500 ms, soft reverb tail",
        why: "A sine wave with only a \"gentle\" bell overtone keeps the sound soothing, which separates a healing effect from an attack or speed buff.",
      },
    ],
    craft: [
      {
        heading: "Match the timbre to what the power-up does",
        body: "All power-ups move upward in pitch, but the timbre should describe what the buff does. Speed wants brightness and a fast sweep. Shields and armor want low-mid warmth and weight. Healing wants a soft sine-based tone with no harsh overtones. Offensive buffs (invincibility, damage boosts) can be the brightest and loudest of the set. Write the effect into the prompt as well as the word \"power-up\".",
      },
      {
        heading: "Scale duration and range to rarity",
        body: "A common pickup should be quick (three to five notes, under 500 ms) so it doesn't interrupt gameplay when it happens often. A rare buff like invincibility can run longer and span a wider pitch range, because the player hears it less often and the extra half second marks it as special.",
      },
      {
        heading: "Keep the whole power-up family on one waveform",
        body: "If your game has five different buffs, generate all of them from the same base waveform (square wave for a retro game, synth pad for a modern one) and vary only the pitch range, speed and overtone description between prompts. The player then hears \"something good happened\" before working out which buff it was.",
      },
      {
        heading: "Save the sung chant for the rarest buff",
        body: "The triumphant chant above is the odd one out: ACE-Step's `lyrics` field gives it a sung line. Use that for the one power-up in your game that should feel like an event (a legendary drop, an ultimate unlock), and avoid it for anything the player hears often. A sung hook that repeats every few minutes gets tiresome.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A sample pack's power-up sounds were tuned for someone else's buff system, and often only the filename tells a shield from a speed boost. Generating lets you write the effect into the prompt (warmth for a shield, a bright sweep for speed), so each power-up is distinguishable by ear and the family shares a waveform.",
      },
    ],
    related: ["coin-pickup", "8bit", "retro-game", "video-game", "magic", "game-over"],
  },
};
const GAME_OVER: SfxCategory = {
  slug: "game-over",
  name: "Game over",
  coverImage: "/sfx/covers/game-over-cover.webp",
  targetQuery: "game over sound effect",
  intent:
    "Single-asset search; often needs a matching win jingle too.",
  metaTitle: "Game Over Sound Effect Generator | Konchi",
  metaDescription:
    "Generate game over jingles and failure stingers locally, and regenerate any of them from the saved prompt and seed.",
  h1: "Game over sound effects",
  intro:
    "A game over sound is the reverse of a power-up: descending, in a minor key, and slower than you might expect.",
  content: {
    samples: [
        // ACE-Step is a lyrics-conditioned vocal music model, not a sound-effect
        // model — its `prompt` sets the genre/instrumentation and a separate
        // `lyrics` field carries the words a synthetic choir actually sings.
        // A game over moment is one of the few SFX categories where an actual
        // sung line ("game over") reads as an intentional payoff rather than
        // uncanny — see the craft note below.
        {
          slug: "sung-defeat-chant",
          title: "Sung defeat chant",
          prompt: "dark orchestral-hybrid game over theme, slow dirge tempo, mournful choir vocals, deep strings and low brass, minor key, cinematic",
          source: "model",
          model: "audiocpp-ace-step",
        },
    ],
    recipes: [
      {
        label: "Classic game over",
        prompt: "chiptune game over jingle, six-note descending minor line, square wave, slow and final, 1.2 seconds",
        why: "\"Slow\" and \"final\" together stretch the note spacing near the end. A game over jingle has to sound like it is stopping as well as falling in pitch.",
      },
      {
        label: "Death stinger",
        prompt: "player death stinger, short descending synth sweep with a low thud landing, 700 ms, dry and abrupt",
        why: "\"Landing\" on a low thud gives the sweep a definite endpoint.",
      },
      {
        label: "Defeat fanfare",
        prompt: "orchestral-hybrid defeat fanfare, descending minor brass-synth line with a dissonant final chord, 1.5 seconds, light reverb",
        why: "\"Dissonant final chord\" separates a defeat fanfare from a merely sad one. Unresolved dissonance reads as loss.",
      },
      {
        label: "Flatline",
        prompt: "flatline defeat tone, single sustained low sine wave note fading out over 1 second, no vibrato, dry",
        why: "\"No vibrato\" matters because any pitch wobble on a sustained tone sounds alive. A flatline has to stay flat.",
      },
      {
        label: "Boss defeated",
        prompt: "boss defeated fanfare, dramatic descending-then-resolving synth line, 2 seconds, triumphant despite descent, moderate reverb",
        why: "\"Resolving\" after the descent is the key word. The enemy went down but the player won, so this one should end on a stable chord.",
      },
      {
        label: "Sung defeat chant",
        prompt: "dark orchestral-hybrid game over theme, slow dirge tempo, mournful choir vocals, deep strings and low brass, minor key, cinematic",
        why: "This one uses ACE-Step, a music model. The prompt sets the genre and instrumentation, and a separate lyrics field (\"[verse]\\nGame over\\nYou have fallen\") carries the words a synthetic choir sings. A game over screen is one of the few places where a sung line sounds deliberate.",
      },
    ],
    craft: [
      {
        heading: "Direction tells the model who lost",
        body: "Descending pitch is the usual signal for game over, defeat and death. Ascending motion, even inside an otherwise falling line, reads as a win. For the player's loss (their own death, a timer running out), prompt for a clean descent that ends low. For an enemy's defeat, prompt for a descent that resolves upward or lands on a stable major chord.",
      },
      {
        heading: "Use pacing words for finality",
        body: "Words like \"slow\", \"final\" and \"landing\" widen the spacing between the last notes and give the sound a definite stopping point, so it doesn't trail off. A game over sound that doesn't clearly end feels unresolved.",
      },
      {
        heading: "Decide if the moment is punitive or dramatic",
        body: "A time's-up buzzer should be blunt and harsh: a flat, static pulse with no melodic content. A story-beat death wants a melodic descent and maybe dissonance, because it should land emotionally. Use different prompt shapes for the two, and decide which one the moment is first.",
      },
      {
        heading: "When to use a sung line",
        body: "Every sample above except one comes from a sound-effect model: synthesized tones and swept pitches, no voice. ACE-Step is a lyrics-conditioned music model. It takes a genre and instrumentation prompt plus a separate block of lyrics, and sings them. On a game over screen, a jingle implies the loss and a choir states it. Use the choir for a story beat such as a final boss run or a permadeath. For the twentieth retry on a platformer level, a half-second stinger is the right size.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Why does one sample have a sung vocal instead of a jingle?",
        answer: "That one comes from ACE-Step, Konchi's lyrics-conditioned vocal music model. The other samples on this page come from a sound-effect model. ACE-Step takes a genre and instrumentation prompt plus a separate lyrics block, and sings the words. Use it for a story-beat death or a permadeath, and keep short jingles for sounds the player hears fifty times a session.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A pack's game over sound is tuned to someone else's story beat, and in your ending it may clash with your music or feel too small. Generating lets you set the descent, the duration and whether it resolves, so a player death and a boss defeat in the same game can belong to one family and still sound different.",
      },
    ],
    related: ["8bit", "power-up", "coin-pickup", "retro-game", "video-game", "horror"],
  },
};
const LASER: SfxCategory = {
  slug: "laser",
  name: "Laser",
  coverImage: "/sfx/covers/laser-cover.webp",
  targetQuery: "laser sound effect",
  intent:
    "Spans retro arcade zaps and modern sci-fi weapon fire; two sub-intents.",
  metaTitle: "Laser Sound Effects Generator | Konchi",
  metaDescription:
    "Generate laser zaps and beam weapons locally, from thin arcade shots to wide cinematic beams.",
  h1: "Laser sound effects",
  intro:
    "Two different sounds share one word: the thin arcade zap and the wide cinematic beam. Prompt for one or the other.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Classic zap",
        prompt: "retro arcade laser shot, thin pulse wave sweeping downward fast, narrow duty cycle, 200 ms, dry",
        why: "\"Narrow duty cycle\" is the synthesis term for the thin, reedy timbre of a classic laser. It is more precise than adjectives like \"sharp\" or \"electronic\".",
      },
      {
        label: "Sci-fi blaster",
        prompt: "sci-fi energy blaster shot, thick sawtooth wave with a fast downward pitch sweep, gritty edge, 250 ms, dry",
        why: "Sawtooth instead of pulse wave, plus \"gritty edge\", moves a laser from clean arcade to a heavier, more modern weapon sound.",
      },
      {
        label: "Charging beam",
        prompt: "charging energy beam, rising pitch synth whine building over 800 ms, then a sharp release burst at the end",
        why: "Writing the prompt as build, then release, gives the model two phases to generate. That separates a charge-up weapon from a one-shot zap.",
      },
      {
        label: "Rapid fire",
        prompt: "rapid-fire laser burst, four short thin pulse wave zaps in quick succession, 300 ms total, tight and dry",
        why: "Count the shots (\"four\") and give a total duration. That keeps the burst tight and evenly spaced; without it the model tends to return one long stuttering sweep.",
      },
      {
        label: "Heavy cannon",
        prompt: "heavy laser cannon blast, deep low-frequency pulse with a bright high crack layered on top, 350 ms, powerful and dry",
        why: "Describe a low element and a high element in the same prompt to get weight and clarity together. A heavy weapon needs both.",
      },
    ],
    craft: [
      {
        heading: "Waveform choice sets the weapon's tech level",
        body: "Pulse wave with a narrow duty cycle is the classic thin arcade laser. Sawtooth wave sounds grittier and more modern, which suits sci-fi blasters and energy weapons. A low sine or pulse element under a bright zap adds the physical power a hand weapon or vehicle cannon needs. Choose the waveform first. It decides more of the character than any other word in the prompt.",
      },
      {
        heading: "Pitch direction reads as impact",
        body: "A downward pitch sweep is the default laser shape. It sounds like a shot losing energy as it travels. An upward sweep or a bend near the end sounds like a ricochet or a deflection. For a set with both a fired shot and a bounced shot, keep the rest of the prompt identical and change only the direction word.",
      },
      {
        heading: "Structure multi-phase weapons explicitly",
        body: "A charge-up weapon, a rapid-fire burst and a single shot are three different event shapes. Describe the shape: \"building then a release burst\" for a charge weapon, \"four short zaps in quick succession\" for a burst, a single clean sweep for a standard shot. The model follows structural language like this more reliably than it infers structure from adjectives.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A weapons pack gives you a fixed set of laser types that rarely match your game's tech level or firing pattern. Generating lets you set the waveform, sweep direction and shot structure your weapon design calls for, and produce a whole range of weapons, from light blaster to heavy cannon, from one prompt family.",
      },
    ],
    related: ["8bit", "weapon", "sci-fi", "explosion", "retro-game", "video-game"],
  },
};
const MAGIC: SfxCategory = {
  slug: "magic",
  name: "Magic",
  coverImage: "/sfx/covers/magic-cover.webp",
  targetQuery: "magic sound effect",
  intent:
    "RPG and fantasy game devs; spells, casts, shimmer.",
  metaTitle: "Magic Sound Effects Generator | Konchi",
  metaDescription:
    "Generate spell casts, shimmers and magical impacts locally from text prompts, with every setting saved.",
  h1: "Magic sound effects",
  intro:
    "Magic has no physical source, which makes it hard to prompt for. Describe a real material that can stand in for it.",
  content: {
    samples: [
        // Sound design above imitates a material; this instead gives the
        // ritual actual words to chant, via ACE-Step's lyrics field.
        {
          slug: "arcane-ritual-chant",
          title: "Arcane ritual chant",
          prompt: "mystical fantasy ritual theme, ethereal chanting vocals, ancient choir, deep drone, arcane atmosphere",
          source: "model",
          model: "audiocpp-ace-step",
        },
    ],
    recipes: [
      {
        label: "Spell cast",
        prompt: "magical spell cast, bright metallic shimmer, glass and bell overtones, rising pitch, sparkling texture, 1 second, close and dry",
        why: "\"Glass and bell overtones\" gives the model two real resonant materials to imitate. The word \"magical\" has no acoustic signature of its own.",
      },
      {
        label: "Charge-up",
        prompt: "magical energy charging, low rumble building to a crackling hiss, fire and static layered, rising intensity over 1.5 seconds, close mic",
        why: "Stack two source materials (\"fire and static\") to get a layered buildup. Either one alone sounds thin.",
      },
      {
        label: "Ice burst",
        prompt: "magical ice burst, glass shattering into fine crystalline shards, cold high-frequency sparkle, sharp attack, 800 ms, dry",
        why: "\"Glass shattering into fine crystalline shards\" borrows a real physical event to suggest ice, which has no sound of its own.",
      },
      {
        label: "Heal chime",
        prompt: "magical healing chime, soft bell and glass resonance, warm sustained tone with gentle shimmer decay, 1.2 seconds, roomy",
        why: "\"Warm\" and \"gentle decay\" set the mood. A healing spell needs a soft release envelope to sound benevolent; a hard cutoff sounds harsh.",
      },
      {
        label: "Curse drone",
        prompt: "malevolent magic drone, low detuned metal groan under a thin dissonant whine, no percussive attack, 2 seconds, roomy and unsettling",
        why: "\"No percussive attack\" stops a dread drone from arriving as a hit. Dark magic should creep in.",
      },
    ],
    craft: [
      {
        heading: "Describe the material magic is imitating",
        body: "Magic has no acoustic signature of its own. Every convincing magic sound is a real material standing in for the effect: glass and bells for anything shimmering, fire and static for anything charging, metal groaning under strain for anything cursed. Pick the real material first, then describe what it is doing (shattering, resonating, straining). The word \"magical\" adds little.",
      },
      {
        heading: "Pitch direction tells the story",
        body: "A rising pitch reads as gathering power, a falling pitch as release or dissipation, and a sudden cutoff as a spell being interrupted or landing. Say which one you want, such as \"rising pitch\" for a charge or \"pitch cutting off sharply\" for a teleport vanish. Otherwise the model cannot tell whether the spell is starting or ending.",
      },
      {
        heading: "Attach sparkle to a material",
        body: "\"Sparkling\" and \"shimmering\" work as prompt words only when attached to a real high-frequency source: glass, bells, chimes, static. Used alone they tend to produce a generic bright hiss. Pair the texture word with its material every time, and apply it to one moment (the cast, the impact) instead of the whole sound.",
      },
      {
        heading: "Use ACE-Step for a chanted ritual",
        body: "The sound-design samples above imitate a material standing in for magic: glass, fire, metal. A summoning ritual or an ancient incantation needs a chant with words. ACE-Step's `lyrics` field provides that (\"[verse]\\nAncient words\\nAwaken now\"). Use it when the spell is a ritual with words, and the SFX model for impact effects.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A magic sample pack gives you someone else's idea of a fireball or a heal spell, usually tuned to a different game's art style. Generating lets you pick the real materials (glass, bells, fire, static) that match your spell's visual design, and regenerate when the art team changes the effect. It costs time and a GPU.",
      },
    ],
    related: ["cinematic", "sci-fi", "whoosh", "video-game", "power-up", "glitch"],
  },
};
const WEAPON: SfxCategory = {
  slug: "weapon",
  name: "Weapon",
  coverImage: "/sfx/covers/weapon-cover.webp",
  targetQuery: "weapon sound effects",
  intent:
    "Game audio; melee and ranged, needs impact plus tail.",
  metaTitle: "Weapon Sound Effects Generator | Konchi",
  metaDescription:
    "Generate melee and ranged weapon sounds locally: swings, impacts, reloads. Edit the prompt and regenerate until it fits.",
  h1: "Weapon sound effects",
  intro:
    "A weapon sound is nearly always two sounds: the action and the impact. Generate them separately and layer.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Sword swing",
        prompt: "metal sword slash through air, thin blade whoosh, sharp doppler snap, close mic, dry, 300 ms",
        why: "\"Doppler snap\" separates a blade cutting air from a generic whoosh. A thin edge moving fast produces a distinct pitch snap that plain \"whoosh\" does not.",
      },
      {
        label: "Gunshot",
        prompt: "single pistol gunshot, sharp crack, tight muzzle report, short natural decay, close mic, minimal room tone",
        why: "\"Minimal room tone\" keeps the shot dry so you can add a separate tail or echo yourself. Reverb baked in here cannot be removed later.",
      },
      {
        label: "Reload",
        prompt: "rifle magazine reload, metal clicks and a solid mechanical slide, close mic, dry, sequential mechanical sounds, 1 second",
        why: "\"Sequential mechanical sounds\" tells the model this is several separate actions in order. A reload that collapses into one blended clank sounds wrong.",
      },
      {
        label: "Arrow release",
        prompt: "bow string release, taut string snap followed by a thin fast whoosh, close mic, dry, 400 ms",
        why: "\"Snap followed by whoosh\" follows the two stages of a real bow: the string releases, then the arrow moves. The model needs that order spelled out.",
      },
      {
        label: "Shield block",
        prompt: "metal weapon striking a shield, hard clang, bright metallic ring with short sustain, close mic, small room reflection",
        why: "\"Short sustain\" limits the ring so it sounds like a solid parry. A long ring makes a block sound like a struck bell.",
      },
    ],
    craft: [
      {
        heading: "A weapon sound is two sounds layered",
        body: "Almost no weapon effect is a single event. A sword swing is a whoosh plus, sometimes, a clash on contact. A gunshot is a crack plus a mechanical action plus an optional impact. Generate the action (swing, trigger pull, string release) and the result (clash, shot, impact) separately and layer them in your editor or engine. One prompt asked to do both tends to blend the two events into one mushy sound.",
      },
      {
        heading: "Name the mechanism",
        body: "\"Gun sound\" is a category with hundreds of correct answers. \"Sharp crack, tight muzzle report, short natural decay\" describes the mechanism of a shot and narrows the model to one family of results. Do the same for melee and mechanical sounds: \"metal clicks and a solid mechanical slide\" works better than \"reload sound\" because it names the parts that move.",
      },
      {
        heading: "Match the impact surface to the target",
        body: "The same swing sounds different on metal, flesh or wood. A strike on a shield rings; a strike on a body thuds and dies fast. State the target material (\"soft target, no metallic ring\" or \"metal shield, bright ring\"), since it changes the whole spectral shape of the impact.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A weapon pack bundles a swing and an impact recorded on someone else's foley stage at someone else's mic distance, and they rarely layer cleanly with your other assets. Generating gives you the action and the impact as separate, matched clips for your game's materials (metal, flesh, shield), so a whole weapon kit sounds consistent. It costs time and a GPU.",
      },
    ],
    related: ["laser", "impact", "explosion", "video-game", "whoosh", "cinematic"],
  },
};
const EXPLOSION: SfxCategory = {
  slug: "explosion",
  name: "Explosion",
  coverImage: "/sfx/covers/explosion-cover.webp",
  targetQuery: "explosion sound effect",
  intent:
    "Film, trailer and game use; wants weight and a long tail.",
  metaTitle: "Explosion Sound Effects Generator | Konchi",
  metaDescription:
    "Generate explosions locally, from small pops to long cinematic booms. Prompts and seeds are saved in a searchable library.",
  h1: "Explosion sound effects",
  intro:
    "An explosion's weight comes from its tail. Most weak generated explosions are too short.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Small pop",
        prompt: "small explosion pop, sharp initial crack, short debris scatter, brief low-end thump, close mic, 500 ms",
        why: "A short duration and the word \"pop\" instead of \"blast\" make the model skip the long tail. The tail is what separates small from large.",
      },
      {
        label: "Grenade",
        prompt: "grenade explosion, sharp crack followed by a full-bodied low rumble tail, debris and dust settling, 2 seconds, close and slightly roomy",
        why: "\"Debris and dust settling\" extends the sound past the blast and gives it an aftermath. Most short generations leave that out.",
      },
      {
        label: "Cinematic boom",
        prompt: "large cinematic explosion, deep sub-bass impact, long rolling low-frequency tail, distant debris rain, 4 seconds, wide and roomy",
        why: "\"Long rolling low-frequency tail\" is the key phrase. The weight is in the tail, and a short duration setting cuts it off however big the attack sounds.",
      },
      {
        label: "Fuel fireball",
        prompt: "fuel explosion fireball, whooshing ignition followed by a crackling roar, sustained burning tail, 3 seconds, roomy",
        why: "\"Sustained burning tail\" separates a fuel explosion from a solid blast. Fuel keeps burning after the bang; naming that stops the model cutting it off early.",
      },
      {
        label: "Distant artillery",
        prompt: "distant explosion, muffled low thud, high frequencies absorbed by distance, long faint rumble tail, 3 seconds, wide and open space",
        why: "\"High frequencies absorbed by distance\" describes real acoustic behavior. It moves a blast from close and sharp to convincingly far away.",
      },
    ],
    craft: [
      {
        heading: "Describe the tail",
        body: "Most weak generated explosions are too short. The crack of ignition lasts a fraction of a second however big the explosion is. The size comes from what follows: a rolling low-frequency tail, settling debris, distant rumble. Set a generous duration (3 to 5 seconds for anything cinematic) and describe the tail, or the model will often deliver a good crack and then nothing.",
      },
      {
        heading: "Treat distance as a filter",
        body: "High frequencies fall off with distance while low frequencies carry, so a distant blast is a muffled thud with the crack and debris detail gone. Say \"high frequencies absorbed by distance\" or \"muffled\". The word \"distant\" alone may come back as a smaller explosion instead of a farther one.",
      },
      {
        heading: "Match the fuel to the aftermath",
        body: "A grenade blast ends abruptly with settling debris. A fuel or gas explosion keeps burning after the bang and needs a crackling roar in the tail. A structural collapse continues as tumbling rubble for several seconds after the blast. Decide what is detonating before you write the prompt, since each one changes the second half of the sound.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A pack gives you a handful of fixed-length explosions and you cut your scene to fit them. Generating lets you set the duration and tail length your shot needs (a 500 ms pop for a prop gag, a 5-second collapse for a finale) from one prompt family, and regenerate if the edit changes. It costs time and a GPU.",
      },
    ],
    related: ["impact", "weapon", "cinematic", "video-game", "machinery", "thunder"],
  },
};
const IMPACT: SfxCategory = {
  slug: "impact",
  name: "Impact",
  coverImage: "/sfx/covers/impact-cover.webp",
  targetQuery: "impact sound effect",
  intent:
    "Editors and game devs; the generic hit/thud family.",
  metaTitle: "Impact Sound Effects Generator | Konchi",
  metaDescription:
    "Generate impacts, thuds and hits locally by naming the material, the action and the room.",
  h1: "Impact sound effects",
  intro:
    "Name the material and the room to get a usable impact. The word \"impact\" alone gives you noise.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Wood thud",
        prompt: "heavy object hitting a wooden plank, dull thud, short resonant creak, close mic, dry, 300 ms",
        why: "\"Short resonant creak\" adds the secondary vibration wood makes after a hit. Without it the model tends to return a generic thud with no material identity.",
      },
      {
        label: "Metal clang",
        prompt: "solid object striking a metal pipe, bright hard clang, short metallic ring, close mic, small room reflection",
        why: "Name the object (\"metal pipe\") as well as the material. A pipe rings differently from a sheet or a plate.",
      },
      {
        label: "Concrete drop",
        prompt: "heavy concrete block dropped on concrete floor, deep flat thud, no ring, tight low-end, close mic, dry",
        why: "Concrete absorbs vibration instead of resonating. Without \"no ring\" the model may add a metallic tail.",
      },
      {
        label: "Punch",
        prompt: "fist punch impact on flesh, wet dull thump, short decay, no ring, close mic, dry",
        why: "\"Wet\" stops a body hit from sounding like it landed on a bag of sand.",
      },
      {
        label: "Glass break",
        prompt: "object striking glass pane, sharp crack followed by shattering fragments scattering, close mic, dry, 700 ms",
        why: "\"Crack followed by fragments scattering\" follows the two stages of breaking glass. A single word like \"shatter\" tends to come back as one indistinct hit.",
      },
    ],
    craft: [
      {
        heading: "Name the material and the room, in that order",
        body: "\"Impact\" alone gives you noise: the model has no material to reference and no space to place it in. A good impact prompt states what struck what (\"heavy object hitting a wooden plank\") and where (\"close mic, dry\" or \"small room reflection\"). The material sets the timbre. The room makes it sound like it happened in your scene.",
      },
      {
        heading: "Resonance is the material's fingerprint",
        body: "Materials behave differently after the hit. Wood creaks briefly, metal rings and sustains, and concrete and sand absorb the energy and produce almost no tail. State whether you want a ring, a creak or \"no ring\". That instruction identifies the material better than any adjective describing the hit.",
      },
      {
        heading: "Two materials means two prompt clauses",
        body: "Most real impacts involve two surfaces meeting (metal on metal, wood on stone, fist on flesh), and each contributes its own texture. Name both materials. That gives the model two acoustic references to blend instead of one ambiguous \"hit\".",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A generic hit and thud pack gives you dozens of impacts recorded at different distances, so they don't sound like the same room. Generating lets you specify the material pairing and space your scene needs and keep the mic distance consistent across every impact. It costs time and a GPU.",
      },
    ],
    related: ["explosion", "weapon", "footsteps", "door", "machinery", "horror"],
  },
};
const HORROR: SfxCategory = {
  slug: "horror",
  name: "Horror",
  coverImage: "/sfx/covers/horror-cover.webp",
  targetQuery: "horror sound effects",
  intent:
    "Film, game and short-form video; wants dread, not jump scares alone.",
  metaTitle: "Horror Sound Effects Generator | Konchi",
  metaDescription:
    "Generate horror atmospheres, stingers and drones locally, and revise the prompt until the scene works.",
  h1: "Horror sound effects",
  intro:
    "Models ignore mood labels like \"scary\". Describe the physical event: metal under strain, a room too large for its sound.",
  content: {
    samples: [
        // A genuinely different tool from the rest of this page: ACE-Step
        // sings actual words instead of rendering sound design. A whispered
        // chant reads as a presence in a way a wordless drone can't.
        {
          slug: "whispered-dread-chant",
          title: "Whispered dread chant",
          prompt: "dark ambient horror theme, whispered ghostly vocals, dissonant strings, unsettling drone, slow tempo",
          source: "model",
          model: "audiocpp-ace-step",
        },
    ],
    recipes: [
      {
        label: "Metal groan",
        prompt: "metal under extreme strain, slow deep groaning creak, low frequency, no percussive attack, 3 seconds, roomy and unsettling",
        why: "\"Metal under extreme strain\" describes a physical event. The model can render strain; it can do nothing with \"scary\".",
      },
      {
        label: "Room too large",
        prompt: "sustained low drone in a room too large for its own sound, faint resonant hum, no melody, 4 seconds, distant and cold",
        why: "The model renders \"a room too large for its own sound\" as thin, distant resonance, which sounds uneasy.",
      },
      {
        label: "Jump stinger",
        prompt: "sharp horror stinger, sudden dissonant metallic hit, high-frequency shriek, instant attack, hard cutoff, 500 ms",
        why: "\"Instant attack\" and \"hard cutoff\" make a stinger hit as a shock. A slow fade-in ruins a jump scare.",
      },
      {
        label: "Scratching behind a wall",
        prompt: "faint scratching sound behind a wall, irregular rhythm, dry scraping texture, low volume, distant and muffled, 2 seconds",
        why: "\"Irregular rhythm\" keeps this from sounding mechanical. A perfectly even scratch sounds like a machine.",
      },
      {
        label: "Close breathing",
        prompt: "slow uneven breathing close to the microphone, wet and ragged texture, irregular rhythm, no words, 3 seconds, intimate and dry",
        why: "\"Close to the microphone\" plus \"dry\" removes the room around the sound, so the breathing seems to be right next to the listener.",
      },
    ],
    craft: [
      {
        heading: "Describe the physical event",
        body: "Models ignore mood labels like \"scary\", because training data is tagged with things like metal, strain, a room or breathing. Translate the feeling into a physical event: dread becomes \"metal under strain\" or \"a room too large for its sound\", tension becomes \"irregular rhythm\", a jump becomes \"instant attack, hard cutoff\". The mood follows from the physics.",
      },
      {
        heading: "Set the space",
        body: "Horror sound design depends on room and distance more than most categories. The same groan is unremarkable close and dry, and unsettling when it is \"distant and muffled\" behind a wall or in \"a room too large for its own sound\". Decide where the listener is relative to the source before you write the prompt. Proximity and space often matter more than the source itself.",
      },
      {
        heading: "Make living things irregular",
        body: "A perfectly even scratch, drip or breath pattern sounds like a machine or a loop, and is less frightening than something unpredictable. Write \"irregular rhythm\" or \"uneven\" for anything meant to suggest a presence. That instruction separates background ambience from something that seems alive.",
      },
      {
        heading: "Use a whispered line sparingly",
        body: "Every other sample on this page is texture: a groan, a drone, a scratch, with no voice. ACE-Step can render a whispered line (\"[verse]\\nThey are near\\nDo not look\"), and a barely intelligible chant suggests a presence that knows the listener is there. Use it once per scene at most, and keep it out of background beds.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A horror pack gives you someone else's stingers and drones, made to fit any scene. Generating lets you tune the physical event (which metal, how large the room, how ragged the breathing) to your scene, and regenerate the stinger until the timing works. It costs time and a GPU.",
      },
    ],
    related: ["ambience", "footsteps", "door", "cinematic", "thunder", "wind"],
  },
};
const SCI_FI: SfxCategory = {
  slug: "sci-fi",
  name: "Sci-fi",
  coverImage: "/sfx/covers/sci-fi-cover.webp",
  targetQuery: "sci fi sound effects",
  intent:
    "Film and game; UI bleeps, engines, energy.",
  metaTitle: "Sci-Fi Sound Effects Generator | Konchi",
  metaDescription:
    "Generate sci-fi interface, engine and energy sounds locally from text, with every prompt and seed saved.",
  h1: "Sci-fi sound effects",
  intro:
    "Science fiction audio is usually a real material processed past recognition. Prompt for the material first.",
  content: {
    samples: [
        {
          slug: "spaceship-engine-hum",
          title: "Spaceship engine hum",
          prompt: "spaceship engine drone, sustained low mechanical hum with a metallic edge, subtle pulsing rhythm, 3 seconds, roomy",
          source: "model",
          model: "audiocpp-stable-audio-3-sfx",
          durationS: 3,
        },
        // A background bed rather than an event — deliberately instrumental,
        // no lyrics, to show ACE-Step also renders a plain ambient loop when
        // there's nothing for it to sing.
        {
          slug: "ace-spaceship-ambient-loop",
          title: "Spaceship interior ambience (loop)",
          prompt: "ambient sci-fi spaceship interior theme, slow synth pads, subtle mechanical hum, minimal melodic movement, seamless loop",
          source: "model",
          model: "audiocpp-ace-step",
        },
    ],
    recipes: [
      {
        label: "UI bleep",
        prompt: "sci-fi interface bleep, short clean synth tone, quick pitch confirmation blip, digital and dry, 200 ms",
        why: "\"Digital and dry\" keeps this out of any physical space. Room reflections on an interface sound break the illusion of a real console.",
      },
      {
        label: "Engine hum",
        prompt: "spaceship engine drone, sustained low mechanical hum with a metallic edge, subtle pulsing rhythm, 3 seconds, roomy",
        why: "\"Metallic edge\" ties the drone to a real, imaginable machine. A pure synth tone alone tends to sound like music.",
      },
      {
        label: "Shield hit",
        prompt: "energy shield impact, metallic ring processed into a resonant electronic tone, quick decay, close mic, dry, 500 ms",
        why: "\"Metallic ring processed into an electronic tone\" is the basic sci-fi method: start from a real material, then say how it has been altered.",
      },
      {
        label: "Airlock",
        prompt: "airlock door opening, pressurized air hiss followed by a heavy mechanical slide, close mic, dry, 1.5 seconds",
        why: "\"Hiss followed by slide\" follows the two mechanical stages of a pressurized door, which separates it from a plain door sound.",
      },
      {
        label: "Weapon charge",
        prompt: "energy weapon charging, rising electronic whine over a low mechanical hum, building intensity over 1.5 seconds, close mic",
        why: "An electronic whine \"over\" a mechanical hum keeps the sound between synthetic and mechanical, which is where sci-fi weapons sit.",
      },
    ],
    craft: [
      {
        heading: "Start from a real material, then process it",
        body: "Science fiction audio is usually a real material processed past recognition. A shield hit is metal run through an electronic filter; an alien voice is a human vocal warble pushed to an unnatural pitch. Prompt for the material first (\"metallic ring\", \"vocal warble\") and the processing second (\"electronic tone\", \"unnatural pitch modulation\"). \"Sci-fi sound\" alone tends to produce something synthetic with no physical source.",
      },
      {
        heading: "Layer mechanical and electronic sounds",
        body: "The most convincing sci-fi machines (engines, doors, weapons) combine a mechanical layer (a real hum, hiss or slide with physical mass) with an electronic layer (a synth whine, a modulated tone). Write \"mechanical hum\" and \"electronic whine\" as separate clauses in the same prompt so the model blends two textures. Otherwise it tends to return pure synth or pure machine noise.",
      },
      {
        heading: "Dry UI, roomy hardware",
        body: "Interface sounds (bleeps, confirmations, alerts) should stay completely dry so they don't compete with what plays under them or imply a physical space. Physical sci-fi hardware (engines, airlocks, weapons) benefits from some room tone, because it is meant to be inside a ship or a station. Decide which kind a sound is before setting its space.",
      },
      {
        heading: "ACE-Step without vocals",
        body: "ACE-Step is built for lyrics-conditioned singing, but with the `lyrics` field empty it renders an instrumental. The spaceship ambience loop above has no vocal. This is useful if you already generate vocal tracks with ACE-Step in a project and want a background bed with the same tonal character.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A sci-fi pack gives you generic beeps and drones built for no particular ship or interface, and you end up processing them to fit your art direction. Generating lets you specify the material and processing your world uses (an engine's mechanical character, an interface's tone) from one prompt family across your whole UI or ship. It costs time and a GPU.",
      },
    ],
    related: ["laser", "cinematic", "ui", "glitch", "machinery", "magic"],
  },
};
const CINEMATIC: SfxCategory = {
  slug: "cinematic",
  name: "Cinematic",
  coverImage: "/sfx/covers/cinematic-cover.webp",
  targetQuery: "cinematic sound effects",
  intent:
    "Trailer editors; risers, braams, whooshes, hits.",
  metaTitle: "Cinematic Sound Effects Generator | Konchi",
  metaDescription:
    "Generate risers, hits and trailer transitions locally, with saved settings and no per-render cost.",
  h1: "Cinematic sound effects",
  intro:
    "Trailer audio is built from a few basic shapes: risers, hits, drones and swells. Learn to prompt each one and you can score a whole cut.",
  content: {
    samples: [
        {
          slug: "full-trailer-buildup",
          title: "Full trailer buildup",
          prompt: "cinematic trailer buildup, rising sub-bass synth drone, tense string section ostinato, sparse brass ensemble braam hits accenting the climb, orchestral hybrid, one final deep orchestral hit at the end",
          source: "model",
          model: "audiocpp-stable-audio-3-sfx",
        },
        // Everything above is sound design — one-shot hits and drones from
        // Stable Audio 3 SFX. ACE-Step adds
        // the one thing it cannot do: an actual sung line. `prompt` sets the
        // orchestral arrangement, `lyrics` gives the choir words.
        {
          slug: "trailer-choir-chant",
          title: "Epic trailer choir chant",
          prompt: "epic orchestral trailer theme, dramatic choir vocals, deep strings and brass, rising tension, cinematic",
          source: "model",
          model: "audiocpp-ace-step",
        },
    ],
    recipes: [
      {
        label: "Trailer braam",
        prompt: "single cinematic braam hit, deep brass-like impact with sub-bass underneath, hard attack, short decay, no reverb tail",
        why: "\"Short decay, no reverb tail\" keeps the hit from smearing into the next shot. Trailer hits are edited on the frame, and a long tail fights the cut.",
      },
      {
        label: "Slow build tension",
        prompt: "cinematic tension riser, thin string-like texture climbing in pitch and volume over 2.5 seconds, no percussive hit at the end",
        why: "\"No percussive hit at the end\" stops the model from returning a riser plus a braam when you only need the climb.",
      },
      {
        label: "Sub-bass drone",
        prompt: "cinematic low drone riser, sustained sub-bass tone with slow pitch climb, dark and tense, 3 seconds, subtle grit on the top end",
        why: "\"Subtle grit on the top end\" adds enough high-frequency content to keep a sub tone audible on small speakers without turning it into a lead sound.",
      },
      {
        label: "Reverse swell",
        prompt: "reverse cymbal swell building into a sharp cutoff, bright metallic wash growing in volume over 1.5 seconds, ends abruptly with no tail",
        why: "\"Ends abruptly with no tail\" makes it sound reversed. A real reverse swell has no natural decay; it stops.",
      },
      {
        label: "Trailer boom",
        prompt: "trailer hit boom, single deep sub-bass punch with a short metallic clang layered on top, tight low end, dry",
        why: "Naming two layers (sub-bass punch and metallic clang) combines a felt low end with an audible transient, which a boom needs on small monitors.",
      },
    ],
    craft: [
      {
        heading: "Separate the riser from the hit",
        body: "A cinematic sting is usually two events edited together: a build and a hit. Prompt them separately, a riser that only climbs and a hit that only lands. \"A cinematic sting\" comes back as the model's own fixed version of both joined together. Separate clips let you time the hit to the frame you are cutting on.",
      },
      {
        heading: "Sub-bass needs a partner frequency",
        body: "Sub-bass below roughly 60 Hz is felt more than heard, and on a laptop speaker or phone it disappears. When you want low-end weight, pair it with a word that puts something in the audible range too (\"grit\", \"metallic clang\", \"brass-like\") so the sound still works on small speakers.",
      },
      {
        heading: "Say what to leave out",
        body: "Cinematic prompts often return a generic combo when you wanted one piece of it. If you want a riser with no hit at the end, or a swell with no tail, say so (\"no percussive hit\", \"no reverb tail\"). The model tends to bundle these events together, and a negation separates them.",
      },
      {
        heading: "Use ACE-Step for a sung choir",
        body: "Stable Audio can render a wash that sounds vaguely choral, but it has no vocal path: no voice sings real syllables. ACE-Step is built for that. Give it a short lyrics block and its choir sings it. Use it when a trailer moment needs an intelligible chant or hook; use Stable Audio for a generic \"epic choir\" pad.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A trailer sting pack gives you someone else's braam, in someone else's key and edit length. Generating gives you a riser or a hit at the duration your cut needs, with the low-end weight and grit set to match the rest of your mix. It costs time and a GPU.",
      },
    ],
    related: ["horror", "sci-fi", "explosion", "impact", "glitch", "whoosh"],
  },
};
const GLITCH: SfxCategory = {
  slug: "glitch",
  name: "Glitch",
  coverImage: "/sfx/covers/glitch-cover.webp",
  targetQuery: "glitch sound effect",
  intent:
    "Motion designers and editors; digital artefacts and stutters.",
  metaTitle: "Glitch Sound Effects Generator | Konchi",
  metaDescription:
    "Generate digital glitches, stutters and data artefacts locally from prompts you can edit and rerun.",
  h1: "Glitch sound effects",
  intro:
    "A glitch is a texture with a rhythm. Name both in the prompt.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Buffer stutter",
        prompt: "digital glitch stutter, short audio buffer repeating rapidly then cutting out, harsh and metallic, 400 ms, no reverb",
        why: "\"Buffer repeating rapidly then cutting out\" describes how a real audio glitch happens: a stuck loop that stops. It is more specific than a vague digital sound.",
      },
      {
        label: "Bit-crushed zap",
        prompt: "bit-crushed digital zap, heavily quantized square wave with aliasing artifacts, sharp downward pitch bend, 300 ms, dry",
        why: "\"Aliasing artifacts\" pushes the model toward the harsh texture of low bit-depth quantization.",
      },
      {
        label: "Signal dropout",
        prompt: "signal dropout glitch, brief silence gaps punched into a static-laden tone, choppy and irregular, 500 ms",
        why: "\"Silence gaps punched into\" a continuous tone make a dropout sound broken. The silence is what carries it.",
      },
      {
        label: "Corruption burst",
        prompt: "data corruption burst, rapid granular clicks and digital noise fragments overlapping, no tonal center, 350 ms, harsh",
        why: "\"No tonal center\" stops the model from resolving the clicks into a rhythm or a pitch. Real corruption noise has no underlying structure.",
      },
      {
        label: "Static flicker",
        prompt: "screen static flicker, short bursts of white noise interrupted by silence, uneven rhythm, 600 ms, thin and brittle",
        why: "\"Uneven rhythm\" is the key phrase. A metronomic flicker sounds designed; an uneven one sounds like a failing signal.",
      },
    ],
    craft: [
      {
        heading: "Prompt for the interruption",
        body: "Describing a glitch as a sound quality (\"digital\", \"harsh\", \"electronic\") is not enough. What sounds broken is interruption: silence gaps, sudden cutoffs, repeats that stop mid-loop. Prompt the event structure (\"repeating rapidly then cutting out\", \"silence gaps punched into a tone\") and treat the texture as secondary. A harsh tone with no interruption sounds like a synth pad.",
      },
      {
        heading: "Name the failure mode",
        body: "Real digital artifacts come from a few specific mechanisms (buffer underrun, bit-crushing, dropped packets, corrupted data), and each has a distinct sound. \"Aliasing\", \"quantization\", \"dropout\" and \"corruption\" produce different results in a prompt. Name the failure you want to get a matching texture.",
      },
      {
        heading: "Keep it dry and short",
        body: "Glitch effects usually sit on top of other audio or video, and reverb or long tails smear the interruption into something smoother. Say \"dry\" or \"no reverb\" and keep the duration under a second unless you need a longer breakdown sequence. Sharper edges sound more broken.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A glitch pack gives you a fixed set of failure modes someone else chose, none of them timed to your footage. Generating lets you pick the mechanism (bit-crush, dropout, buffer stutter) and the duration your cut needs, then regenerate with different wording if the first pass sounds too clean or too musical. It costs time and a GPU.",
      },
    ],
    related: ["sci-fi", "cinematic", "whoosh", "transition", "ui", "notification"],
  },
};
const CROWD: SfxCategory = {
  slug: "crowd",
  name: "Crowd",
  coverImage: "/sfx/covers/crowd-cover.webp",
  targetQuery: "crowd sound effects",
  intent:
    "Film and game ambience; reaction beds and walla.",
  metaTitle: "Crowd Sound Effects Generator | Konchi",
  metaDescription:
    "Generate crowd beds, applause and reaction walla locally, with the room and the size of the crowd under your control.",
  h1: "Crowd sound effects",
  intro:
    "Crowd sounds depend on the room. Say how big the crowd is and how far away the listener is.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Small murmur",
        prompt: "small crowd murmur, 10 to 15 people talking indoors at low volume, indistinct overlapping speech, no individual words audible, room tone",
        why: "A headcount (\"10 to 15 people\") keeps the murmur small. Without a number the model defaults to an ambiguous mid-sized crowd.",
      },
      {
        label: "Stadium cheer",
        prompt: "large stadium crowd cheering, hundreds of voices layered, sudden rise in energy, outdoor open space, 3 seconds",
        why: "\"Sudden rise in energy\" is the moment a crowd reacts to a play. It separates a cheer from a steady ambient roar.",
      },
      {
        label: "Restaurant bed",
        prompt: "restaurant background chatter, dozens of overlapping conversations at moderate volume, occasional cutlery clink, indoor room tone, steady and even",
        why: "A small detail like \"occasional cutlery clink\" places the scene better than \"restaurant\" alone, which tends to come back as generic chatter.",
      },
      {
        label: "Angry mob",
        prompt: "angry crowd shouting, dozens of voices layered with aggressive tone, outdoor open space, rising intensity, no distinct words",
        why: "\"Aggressive tone\" changes the vocal texture, separating it from a cheering or murmuring crowd of the same size.",
      },
      {
        label: "Applause",
        prompt: "sudden crowd applause burst, indoor auditorium, dozens of hands clapping at once, sharp onset, 2 seconds, natural decay",
        why: "\"Sharp onset\" plus \"natural decay\" give the shape of a real applause burst: instant start, gradual settle.",
      },
    ],
    craft: [
      {
        heading: "Size the crowd with a number",
        body: "\"Big crowd\" and \"small crowd\" are relative, and the model has no fixed scale for them. Give a headcount or venue size (\"10 to 15 people\", \"hundreds of voices\", \"stadium\"). That sets the density of overlapping voices more reliably than an adjective.",
      },
      {
        heading: "Say what the crowd is doing",
        body: "A crowd's activity changes its texture as much as its size does. Talking, cheering, shouting, applauding and murmuring are different acoustic events. Name the activity. If it is a reaction (a cheer, a burst of applause), describe the shape of the reaction (\"sudden rise\", \"sharp onset\").",
      },
      {
        heading: "Keep individual voices out of it",
        body: "A crowd becomes a group of speaking characters once words are intelligible. For background crowd tone, say \"no individual words audible\" or \"indistinct\". Otherwise the model may render a few voices clearly enough to sound like dialogue, which pulls focus in a mix.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A crowd pack gives you a fixed size and mood recorded at someone else's venue, and joining two different crowd clips usually exposes the seam. Generating lets you set the headcount, the indoor or outdoor space and the mood your scene needs, so a cheer and the murmur before it share the same voice character. It costs time and a GPU.",
      },
    ],
    related: ["horror", "cinematic", "ambience", "animal", "notification", "door"],
  },
};
const RAIN: SfxCategory = {
  slug: "rain",
  name: "Rain",
  coverImage: "/sfx/covers/rain-cover.webp",
  targetQuery: "rain sound effect",
  intent:
    "Ambience for film, games and video; also sleep/focus audio.",
  metaTitle: "Rain Sound Effects Generator | Konchi",
  metaDescription:
    "Generate rain on glass, tin or leaves locally, at the length and intensity you need.",
  h1: "Rain sound effects",
  intro:
    "Rain always falls on something, and the surface decides most of the sound. Name it in the prompt.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Window rain",
        prompt: "light rain falling on a glass window, steady soft patter, close mic, indoor perspective, no wind or thunder",
        why: "\"Indoor perspective\" filters the sound the way a pane of glass would. It sounds very different from the same rain heard outdoors.",
      },
      {
        label: "Downpour",
        prompt: "heavy rain downpour, dense continuous patter on hard ground, outdoor open space, loud and full, no thunder",
        why: "\"Dense continuous patter\" describes density as well as volume. A downpour is defined by how little space there is between drops.",
      },
      {
        label: "Tin roof",
        prompt: "rain falling on a corrugated tin roof, sharp metallic patter, steady rhythm, close mic, resonant metal surface",
        why: "\"Resonant metal surface\" gets the ping of rain on metal. A generic \"rain on roof\" prompt gives a soft patter.",
      },
      {
        label: "Umbrella rain",
        prompt: "rain drumming on a nylon umbrella, close mic just below the canopy, tight rhythmic patter, muffled outdoor ambience behind it",
        why: "Placing the mic \"just below the canopy\" sets the listening position, so the umbrella surface dominates the rain around it.",
      },
      {
        label: "Puddle detail",
        prompt: "rain falling into shallow puddles on pavement, individual droplet splashes audible over a steady patter bed, close mic",
        why: "\"Individual droplet splashes audible over\" the bed separates foreground detail from background wash. A flat \"rain on pavement\" prompt does not.",
      },
    ],
    craft: [
      {
        heading: "Name the surface",
        body: "Rain is the sound of water hitting a particular material, and the material changes the texture more than the intensity does. Glass gives a soft patter, tin a sharp metallic ping, pavement a dense wash with occasional splashes. Always name the surface. \"Rain\" alone gives the model no material to render.",
      },
      {
        heading: "Set the listening position",
        body: "The same rain sounds different from three positions: outdoors in the open, indoors behind glass, or under a shelter like an umbrella or eave. Say \"indoor perspective\", \"through a closed window\" or \"close mic just below the canopy\" to set the filtering and proximity. This changes the result more than intensity words do.",
      },
      {
        heading: "Keep thunder and wind out unless you want them",
        body: "Rain, wind and thunder often appear together in training data, so a plain \"rain\" prompt can drift toward a full storm. For clean rain on its own, say \"no wind or thunder\". You can then layer a separate thunder clip in your edit and control its timing.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A rain pack gives you a fixed surface and intensity recorded on someone else's roof or window, and looping it often reveals the seam. Generating lets you match the surface and perspective your scene needs (a window for an interior shot, a tin roof for a cabin) and adjust the intensity without searching a library. It costs time and a GPU.",
      },
    ],
    related: ["thunder", "wind", "water", "ambience", "animal", "fire"],
  },
};
const THUNDER: SfxCategory = {
  slug: "thunder",
  name: "Thunder",
  coverImage: "/sfx/covers/thunder-cover.webp",
  targetQuery: "thunder sound effect",
  intent:
    "Storm ambience and single-strike stingers; two intents.",
  metaTitle: "Thunder Sound Effects Generator | Konchi",
  metaDescription:
    "Generate thunder cracks and distant rolls locally, and control the distance with the prompt.",
  h1: "Thunder sound effects",
  intro:
    "Distance decides how thunder sounds. Close thunder is a crack and distant thunder is a roll. Pick one in the prompt.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Distant rumble",
        prompt: "distant thunder rumble, low continuous rolling boom, no sharp crack, far away and muffled, 3 seconds",
        why: "\"No sharp crack\" keeps distant thunder distant. Without it the model tends to add a transient that sounds close.",
      },
      {
        label: "Close strike",
        prompt: "close lightning strike crack, sudden sharp high-frequency snap immediately followed by a deep rolling boom, loud and dry",
        why: "\"Snap immediately followed by\" the boom matches how a close strike sounds, with almost no gap. That gap is what tells the ear the distance.",
      },
      {
        label: "Long roll",
        prompt: "long thunder roll, sustained low rumble that swells and fades unevenly over 4 seconds, no distinct crack, outdoor space",
        why: "\"Swells and fades unevenly\" avoids a smooth, synthetic rumble. Real thunder has irregular peaks as the sound bounces off distant terrain.",
      },
      {
        label: "Double crack",
        prompt: "double thunder crack, two sharp cracking impacts close together followed by a long low rumble tail, dramatic and loud",
        why: "Give the count (\"two sharp cracking impacts\") so the number of cracks is not left to chance.",
      },
      {
        label: "Thunder over rain",
        prompt: "thunder crack over a steady rain bed, sharp crack rolling into a low rumble, rain continues underneath at moderate volume",
        why: "\"Continues underneath\" keeps the rain at a constant level through the crack, as in a single continuous recording.",
      },
    ],
    craft: [
      {
        heading: "Set distance with the crack-to-rumble ratio",
        body: "Close thunder is dominated by a sharp high-frequency crack. Distant thunder has lost the crack and arrives as low rumble, because high frequencies fade over distance faster than low ones. Set the distance by describing this ratio: \"no sharp crack, far away\" for distant, \"sharp snap immediately followed by\" a boom for close. \"Loud\" and \"quiet\" do not set distance.",
      },
      {
        heading: "Real rumbles are uneven",
        body: "A peal of thunder rolls, because the sound reflects off clouds, hills and buildings at different delays and the loudness rises and falls irregularly. Ask for it to \"swell and fade unevenly\". A clean rise and fall sounds synthetic.",
      },
      {
        heading: "Decide if rain is part of the take",
        body: "Real recordings of thunder almost always include rain. To control the layers in your edit, generate thunder alone and add rain separately in your mix. For a single continuous ambience clip, prompt them together and say the rain \"continues underneath at moderate volume\" through the crack so the bed doesn't duck or disappear.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A thunder pack gives you a fixed distance and crack-to-rumble ratio chosen for someone else's storm, and it won't line up with your rain bed. Generating lets you set the distance, sharpness and duration your scene needs, and layer it against a matching rain track. It costs time and a GPU.",
      },
    ],
    related: ["rain", "wind", "horror", "cinematic", "explosion", "ambience"],
  },
};
const WIND: SfxCategory = {
  slug: "wind",
  name: "Wind",
  coverImage: "/sfx/covers/wind-cover.webp",
  targetQuery: "wind sound effect",
  intent:
    "Ambience; also motion/whoosh adjacency.",
  metaTitle: "Wind Sound Effects Generator | Konchi",
  metaDescription:
    "Generate wind beds and gusts locally: through trees, around structures, across open ground.",
  h1: "Wind sound effects",
  intro:
    "Wind makes little sound until it hits something. Name what it hits.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Wind through trees",
        prompt: "strong wind gust through leafy trees, rustling and creaking branches, 3 seconds, outdoor open space",
        why: "\"Rustling and creaking branches\" names the two things the wind is hitting, leaves and wood. Those are what make it audible.",
      },
      {
        label: "Howl around a corner",
        prompt: "wind howling around a building corner, hollow whistling tone, gusty, close mic, 3 seconds",
        why: "\"Hollow whistling tone\" is the resonance a corner or gap produces. Without an obstruction the model defaults to a flat, featureless hiss.",
      },
      {
        label: "Flag in wind",
        prompt: "steady wind flapping a loose fabric flag, sharp snapping cracks, outdoor, 3 seconds",
        why: "\"Sharp snapping cracks\" describes the fabric's own percussive sound, which is separate from the wind and needs its own words.",
      },
      {
        label: "Window rattle",
        prompt: "wind gust rattling a loose window pane, brief low rumble then a rattle, indoor perspective, 2 seconds",
        why: "\"Indoor perspective\" renders the gust as heard through a barrier, which turns open-air wind into a rattle.",
      },
      {
        label: "Gentle breeze",
        prompt: "gentle wind breeze moving through tall grass, soft continuous hiss, no gusts, 3 seconds",
        why: "Without \"no gusts\" the model tends to add swells even when you asked for something calm and steady.",
      },
    ],
    craft: [
      {
        heading: "Wind needs something to hit",
        body: "Moving air by itself is a flat broadband hiss. A wind sound becomes recognizable from what it disturbs: leaves, a flag, a gap in a window frame, a wire, a cave mouth. Always name the obstruction. \"Wind\" alone gives you generic room tone. \"Wind through leafy trees\" or \"wind whistling through a gap in a window\" gives the model a specific interaction to render, and the character comes from that interaction.",
      },
      {
        heading: "Ask for a gust or a bed",
        body: "A gust is an event: it rises, peaks and falls within a few seconds, and words like \"gust\" or \"sudden strong wind\" ask for that arc. A bed is flat and sustained, meant to loop or sit under a scene. Ask for \"steady\" or \"continuous\" and leave out gust words. Mixing the two in one prompt tends to produce an unpredictable swell in the middle.",
      },
      {
        heading: "Altitude and enclosure change the tone",
        body: "High-altitude or open-plain wind sounds thin and whistling, because nothing nearby adds low-frequency turbulence. Say \"thin\" and \"no low end\" to get that. Wind moving through a confined space (a hallway, a canyon, a chimney) picks up resonance from the space. Say \"hollow\" or name the space. A gust in open air and a gust in a corridor need different prompt words.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A pack gives you a wind bed at a fixed intensity and length, and you cut it to fit or loop it awkwardly. Generating gives you a gust or a bed at the length, obstruction and intensity your scene needs, and you change the intensity by regenerating with different words. It costs time and a GPU.",
      },
    ],
    related: ["ambience", "rain", "thunder", "water", "whoosh", "cinematic"],
  },
};
const WATER: SfxCategory = {
  slug: "water",
  name: "Water",
  coverImage: "/sfx/covers/water-cover.webp",
  targetQuery: "water sound effects",
  intent:
    "Broad ambience and foley; streams, splashes, pours.",
  metaTitle: "Water Sound Effects Generator | Konchi",
  metaDescription:
    "Generate splashes, streams, drips and pours locally from prompts that name the vessel and the volume.",
  h1: "Water sound effects",
  intro:
    "Name the container and the amount of water. A drip in a cave and a drip in a sink are different sounds.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Cave drip",
        prompt: "single water drip falling into a shallow cave pool, sharp plink, long reverberant tail, close mic",
        why: "\"Long reverberant tail\" is what the cave adds to the drip. Without it the model renders a drip in a neutral space.",
      },
      {
        label: "Tap drip",
        prompt: "single water drip from a kitchen tap into a metal sink, tight dry plink, no reverb",
        why: "\"Metal sink\" and \"no reverb\" put the same drip on a small, hard, close surface. The vessel is what separates it from the cave version.",
      },
      {
        label: "Pouring",
        prompt: "water poured from a bottle into a small glass, steady stream, rising pitch as glass fills, 2 seconds, dry",
        why: "\"Rising pitch as glass fills\" names a real effect: the air cavity shrinks as the liquid rises. It separates a convincing pour from a static stream loop.",
      },
      {
        label: "Big splash",
        prompt: "large splash of a person jumping into a pool, heavy impact then bubbling settle, 2 seconds, outdoor",
        why: "\"Heavy impact then bubbling settle\" names the two phases of a splash. The single word \"splash\" tends to give a shorter, less physical sound.",
      },
      {
        label: "Stream",
        prompt: "small rocky stream flowing over stones, continuous bubbling trickle, 3 seconds, outdoor close mic",
        why: "\"Over stones\" turns flat flowing water into a bubbling trickle. As with wind, water needs something to disturb it.",
      },
    ],
    craft: [
      {
        heading: "Name the vessel",
        body: "A drip in a stone cave, a drip in a metal sink and a drip in a plastic bucket have different pitches, decay times and reverb, from the same physical event. Always tell the model what the water is in or falling into: cave pool, sink, glass, puddle, pool, bucket. The container matters more than any adjective about the water.",
      },
      {
        heading: "Pick the event",
        body: "A drip, a stream, a pour and a splash are different physical events with different durations and shapes. A drip is a single sharp transient; a stream is continuous and textured; a splash has an impact phase and then a settling phase. Name the event you need instead of a \"big\" or \"small\" \"water sound\".",
      },
      {
        heading: "Give impacts a settle phase",
        body: "Anything landing in water (a jump, a dropped object, a thrown bucket) has a loud impact followed by several hundred milliseconds of bubbling and dripping as the water settles. Name both phases (\"heavy impact then bubbling settle\"). Otherwise the model often cuts the sound off right after the transient and the splash sounds clipped.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A pack gives you a fixed drip, pour or splash recorded in someone else's kitchen or pool, and you adjust your scene to fit the clip. Generating lets you specify the vessel, the amount of water and the phases you need (a drip in a cave or a sink, a small pour or a bucket dump), and regenerate if the first take doesn't match. It costs time and a GPU.",
      },
    ],
    related: ["rain", "ambience", "footsteps", "wind", "fire", "impact"],
  },
};
const FIRE: SfxCategory = {
  slug: "fire",
  name: "Fire",
  coverImage: "/sfx/covers/fire-cover.webp",
  targetQuery: "fire sound effect",
  intent:
    "Ambience and game loops; campfires through infernos.",
  metaTitle: "Fire Sound Effects Generator | Konchi",
  metaDescription:
    "Generate crackle, roar and ignition locally, from a campfire bed to a full blaze.",
  h1: "Fire sound effects",
  intro:
    "Fire is a mix of crackle and roar. The prompt sets the ratio between them.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Campfire bed",
        prompt: "small campfire burning, steady wood crackle and pop, low warm hiss, outdoor, 4 seconds, loopable",
        why: "\"Steady\" and \"loopable\" push the ratio toward mostly crackle with a low, near-constant hiss underneath, like a fire burning at a steady rate.",
      },
      {
        label: "Ignition",
        prompt: "torch bursting into flame, sudden whoosh ignition then settling into a steady flicker, 2 seconds",
        why: "Naming two phases (the ignition whoosh, then the settle) gives one generation a believable start.",
      },
      {
        label: "Match strike",
        prompt: "single wooden match struck and igniting, sharp scrape then a quick flare hiss, close mic, dry",
        why: "\"Sharp scrape\" is the friction before there is any fire. Without it the flame appears from nowhere.",
      },
      {
        label: "Big blaze",
        prompt: "large structure fire, dominant roaring flame body, occasional sharp pops from burning debris, 3 seconds",
        why: "\"Dominant roaring flame body\" tips the crackle-to-roar ratio toward roar. That ratio is the difference between a campfire and an inferno.",
      },
      {
        label: "Flare-up",
        prompt: "sudden fire flare-up from a fuel splash, sharp whoosh burst, brief roar, then fading crackle, 2 seconds",
        why: "Naming the cause (\"fuel splash\") gets the sharp whoosh burst of a real flare-up.",
      },
    ],
    craft: [
      {
        heading: "Set the crackle-to-roar ratio",
        body: "Every fire sound mixes two components: crackle, the discrete pops of wood or debris burning, and roar, the continuous rush of the flame pulling in air. A campfire is mostly crackle with a thin hiss underneath. A large structure fire is mostly roar with occasional sharp pops from things collapsing. Decide the ratio before you write the prompt, for example \"steady wood crackle and pop\" or \"dominant roaring flame body\". The ratio defines the fire.",
      },
      {
        heading: "Prompt ignition as its own event",
        body: "A fire starting has its own shape: a scrape or whoosh, then a flare, then a settle into steady burning. For a fire coming to life, describe that arc (\"bursting into flame... then settling\"). \"Fire starting\" alone tends to render as a generic crackle with no attack.",
      },
      {
        heading: "Scale changes texture",
        body: "Larger fires shift the balance toward low-frequency roar and add irregular debris pops that small fires lack, so a match, a torch, a campfire and a structure fire are different sounds. Name the fuel and scale (\"single wooden match\", \"large structure fire\") instead of using volume words. The model uses different textures at different scales.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A pack gives you one fixed crackle-to-roar ratio at one scale, and you accept it or layer clips to fake the size you need. Generating lets you set the ratio and the fuel (a match, a campfire, a blaze) and generate the ignition separately from the sustained burn. It costs time and a GPU.",
      },
    ],
    related: ["explosion", "ambience", "horror", "impact", "cinematic", "machinery"],
  },
};
const ANIMAL: SfxCategory = {
  slug: "animal",
  name: "Animal",
  coverImage: "/sfx/covers/animal-cover.webp",
  targetQuery: "animal sound effects",
  intent:
    "Games and video; specific creatures and generic beasts.",
  metaTitle: "Animal Sound Effects Generator | Konchi",
  metaDescription:
    "Generate animal calls and creature sounds locally, including things that do not exist.",
  h1: "Animal sound effects",
  intro:
    "Real animals can be recorded. Imaginary ones can't, so generation is most useful for creatures that don't exist.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Dog bark",
        prompt: "single large dog bark, deep and aggressive, close mic, dry, no room tone",
        why: "\"Large\" sets the pitch register. Dog barks span two octaves by breed size, and size is the word that controls pitch.",
      },
      {
        label: "Crow",
        prompt: "single crow caw, harsh and raspy, outdoor open space, slight distance",
        why: "\"Harsh and raspy\" separates a crow from a generic bird call. Most bird prompts default to something like a songbird unless you name the roughness.",
      },
      {
        label: "Cat hiss",
        prompt: "angry cat hiss followed by a low growl, close mic, sharp and defensive, dry",
        why: "Two sounds in sequence (hiss, then growl) give the model an arc to render.",
      },
      {
        label: "Wolf howl",
        prompt: "single wolf howl, rising then sustained pitch, heard from a distance, faint echo, outdoor night",
        why: "\"Heard from a distance\" adds the faint echo and softened high end that distance produces, as well as lowering the volume.",
      },
      {
        label: "Invented creature",
        prompt: "large imaginary creature growl, low guttural rumble with a wet throat texture, threatening, close mic, 2 seconds",
        why: "\"Wet throat texture\" borrows a detail from real animal anatomy, so a creature that doesn't exist still sounds like it has a body.",
      },
    ],
    craft: [
      {
        heading: "Size sets pitch",
        body: "In almost every animal vocalization, body size maps to pitch and resonance. A large dog barks an octave lower than a small one; a big cat growls where a house cat hisses. Naming the size (\"large\", \"small\", \"massive\") often works better than adding species-specific adjectives, because size sets the register for any animal, real or invented.",
      },
      {
        heading: "Include distance and space",
        body: "A wolf howl heard across a valley has echo and softer high frequencies than one heard close, and often implies an outdoor night setting. If the sound should feel far away, say so (\"heard from a distance\", \"faint echo\"). The model will not infer it from context.",
      },
      {
        heading: "Invented creatures still need real anatomy",
        body: "A monster growl that doesn't map to any real physiology tends to come out as a generic low rumble. Borrow anatomical detail from real animals (\"wet throat texture\", \"guttural\", \"chest resonance\") and combine it with an impossible scale (\"massive\", \"cavernous\") to get something that sounds like it has a body. No sample library has a recording of an imaginary creature, so this is where generation helps most.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A pack can give you a real dog bark or crow caw, but it has no recording of a creature that doesn't exist. Generating covers both: real animals at the size and distance your scene needs, and invented creatures built from real anatomical detail. It costs time and a GPU.",
      },
    ],
    related: ["horror", "footsteps", "ambience", "sci-fi", "water", "cinematic"],
  },
};
const AMBIENCE: SfxCategory = {
  slug: "ambience",
  name: "Ambience",
  coverImage: "/sfx/covers/ambience-cover.webp",
  targetQuery: "ambience sound effects",
  intent:
    "Long background beds for games and film; the loop question dominates.",
  metaTitle: "Ambience Sound Effects Generator | Konchi",
  metaDescription:
    "Generate room tone and background beds locally, at the length your game engine or edit loops.",
  h1: "Ambience and background sound effects",
  intro:
    "For a background bed, settle the length first and the content second. Check the loop length your engine or edit needs.",
  content: {
    samples: [
        // A musical bed rather than a room-tone bed — instrumental, no
        // lyrics, on ACE-Step instead of the SFX model, since a folk
        // instrument performance is a music-composition problem the SFX
        // model isn't trained for.
        {
          slug: "ace-tavern-folk-loop",
          title: "Tavern folk music (loop)",
          prompt: "cozy medieval tavern folk music loop, acoustic strummed instrument, warm mellow tone, relaxed tempo, seamless loop",
          source: "model",
          model: "audiocpp-ace-step",
        },
    ],
    recipes: [
      {
        label: "Office room tone",
        prompt: "quiet office room tone, faint hum of fluorescent lights and distant HVAC, no voices, static and dry",
        why: "Open-ended ambience prompts tend to include indistinct speech, which you rarely want under dialogue. Say \"no voices\".",
      },
      {
        label: "Cafe bed",
        prompt: "busy cafe ambience, overlapping indistinct chatter, occasional cup clinks, steady bed, 3 seconds",
        why: "\"Overlapping indistinct chatter\" avoids intelligible words, so the crowd bed doesn't produce distracting speech.",
      },
      {
        label: "Night forest",
        prompt: "quiet forest at night, steady cricket chorus, faint distant owl, outdoor, 3 seconds",
        why: "One steady element (crickets) plus one occasional element (a faint owl) gives the bed texture without turning it into a sequence of foreground events.",
      },
      {
        label: "Sci-fi interior",
        prompt: "sci-fi spaceship interior ambience, low mechanical hum, faint electronic beeps, sealed pressurized feel, 3 seconds",
        why: "\"Sealed pressurized feel\" describes the space. The model shapes the whole bed as if heard inside an enclosed hull.",
      },
      {
        label: "Loopable dungeon bed",
        prompt: "dark stone dungeon ambience loop, distant dripping water, low reverberant drone, no voices, 8 seconds, seamless loop",
        why: "\"Seamless loop\" makes the model avoid a strong attack or decay at the start and end, so the bed loops without clicking at the seam.",
      },
    ],
    craft: [
      {
        heading: "Set the duration first",
        body: "Before writing what a bed contains, check the length your engine or edit needs. A two-second sting behind a menu screen and an eight-second seamless loop behind a level are different prompts. State the target length and, if it needs to loop, say \"seamless loop\" so the model avoids a hard attack or a fading tail that would click at the seam. A bed at the wrong length is unusable however good it sounds.",
      },
      {
        heading: "Layer one steady element with one occasional one",
        body: "Convincing ambience beds have a steady floor (hum, hiss, a chorus of crickets) plus one or two occasional events that break it up (a distant owl, a car passing, a cup clink). Name both in the same prompt and mark the occasional element as \"faint\" or \"distant\". The bed then sounds neither flat nor too busy to sit under dialogue.",
      },
      {
        heading: "Exclude speech unless you want it",
        body: "Crowd and cafe ambiences often drift toward intelligible or semi-intelligible speech unless you tell the model otherwise. Say \"indistinct chatter\" for crowd texture that doesn't pull focus, or \"no voices\" for anything that has to sit under dialogue.",
      },
      {
        heading: "Use a music model for a music bed",
        body: "Every other sample on this page is environmental sound (hums, chatter, wind, dripping water), and Stable Audio 3 SFX handles all of it. A tavern with background music playing is a composition task: an instrument performing a melody that holds together for the whole loop. Use ACE-Step for that, with `lyrics` left empty for an instrumental render, as on the chiptune-music pages.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A pack gives you a bed at a fixed length that you have to crossfade-loop or trim, with whatever content the pack included. Generating lets you set the duration your engine loops at and the mix of steady floor and occasional events your scene needs, including whether there is speech. It costs time and a GPU.",
      },
    ],
    related: ["rain", "thunder", "wind", "water", "crowd", "machinery"],
  },
};
const DOOR: SfxCategory = {
  slug: "door",
  name: "Door",
  coverImage: "/sfx/covers/door-cover.webp",
  targetQuery: "door sound effect",
  intent:
    "Foley staple; open, close, slam, creak, in a named space.",
  metaTitle: "Door Sound Effects Generator | Konchi",
  metaDescription:
    "Generate door opens, closes, slams and creaks locally by naming the material, the action and the room.",
  h1: "Door sound effects",
  intro:
    "Name the material, the action and the space. Door sounds show clearly how much each one changes the result.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Wooden door open",
        prompt: "interior wooden door opening, single slow hinge creak rising in pitch, close mic, small room reflection",
        why: "\"Rising in pitch\" describes what a hinge does under increasing torque. Without it the model defaults to a flat creak that sounds looped.",
      },
      {
        label: "Wooden door close",
        prompt: "interior wooden door closing, firm push, solid low thud on latch, short room decay, dry",
        why: "Name the latch as the sound source to get a percussive thud. Naming only the door gives a vague wood-on-wood knock.",
      },
      {
        label: "Metal slam",
        prompt: "heavy metal door slamming shut, sharp clang with a low boom, hard reverb tail, industrial space",
        why: "\"Clang\" with \"low boom\" covers both the thin metal surface and the heavy mass behind it. Either word alone sounds like a cymbal or a drum.",
      },
      {
        label: "Horror hinge",
        prompt: "long rusty hinge creak, slow uneven pitch wobble, dry attic-sized room, unsettling",
        why: "\"Uneven pitch wobble\" separates a worn hinge from a clean synthetic creak. Horror editors listen for it.",
      },
      {
        label: "Latch click",
        prompt: "small door latch click, single metallic snap, close mic, no reverb, under 200 ms",
        why: "A duration cap stops the model adding a decay tail. A latch click is a single instant.",
      },
    ],
    craft: [
      {
        heading: "Separate the hinge from the impact",
        body: "A door sound is usually two separate events: a continuous hinge creak while it moves, and an impact (a latch click, a slam, a thud) when it stops. Decide which one your prompt needs. \"Opening\" prompts should describe the creak's pitch behaviour (rising, wobbling, steady). \"Closing\" prompts should describe the impact's material and force (firm push or slam, wood thud or metal clang). Asking for both in one short generation tends to blur into a single unconvincing scrape.",
      },
      {
        heading: "Name the room",
        body: "Doors are almost never heard dry in real life. The reflections from the space tell the listener whether they are in a hallway, an attic or outdoors. Name the room (\"small room reflection\", \"industrial space\", \"outdoor open space\"). Without one, the model returns an ambiguous mid-sized reflection. If you need it dry for later processing, say \"dry\".",
      },
      {
        heading: "Lead with the material",
        body: "Wood, metal and glass doors differ in timbre and also in what they suggest about a scene. A metal door slam sounds institutional or dangerous; a wooden door closing sounds domestic; a car door thunk suggests arrival or departure. Put the material first in the prompt and the action after it.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A pack gives you someone else's front door, recorded in someone else's hallway, and its room tone may not match your scene. Generating gives you a door for your space, with the room size, material and force you specify. The open and the close come from one prompt family, so they sound like the same door. It costs time and a GPU.",
      },
    ],
    related: ["footsteps", "horror", "ambience", "impact", "cinematic", "machinery"],
  },
};
const UI: SfxCategory = {
  slug: "ui",
  name: "UI",
  coverImage: "/sfx/covers/ui-cover.webp",
  targetQuery: "ui sound effects",
  intent:
    "App and game UI designers; clicks, toggles, confirms.",
  metaTitle: "UI Sound Effects Generator | Konchi",
  metaDescription:
    "Generate clicks, toggles and confirmations locally: dry, short and consistent across a whole interface.",
  h1: "UI sound effects",
  intro:
    "Interface sounds usually come out too long or with too much reverb. Fix both in the prompt with a duration and the word \"dry\".",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Button click",
        prompt: "single UI button click, short clean tick, high frequency, no reverb, under 80 ms",
        why: "The millisecond cap matters most. If the model renders a note instead of a tick, the tap will feel sluggish.",
      },
      {
        label: "Toggle",
        prompt: "UI toggle switch sound, two-stage click with a slight pitch shift between on and off states, dry, 150 ms",
        why: "\"Two-stage\" asks for two separate events. A toggle needs a distinct on-click and off-click, even in one short file.",
      },
      {
        label: "Error",
        prompt: "UI error sound, short low buzzy tone, mildly dissonant two-note interval, dry, 250 ms",
        why: "\"Mildly dissonant\" sets the tone. Too dissonant sounds alarming and too consonant sounds like a success chime; \"mildly\" keeps it in the range that reads as an error.",
      },
      {
        label: "Confirm",
        prompt: "UI confirmation chime, two ascending clean sine notes, bright and simple, no reverb, under 300 ms",
        why: "Ascending pitch means success in interface audio. The same timbre descending sounds like a dismissal.",
      },
      {
        label: "Hover",
        prompt: "UI hover tick, extremely short single sine blip, subtle, under 40 ms, completely dry",
        why: "\"Subtle\" matters as much as the duration. A hover sound fires constantly as the cursor moves, so it has to be quiet enough not to annoy.",
      },
    ],
    craft: [
      {
        heading: "State the duration cap, always",
        body: "The most common problem with interface sounds is length. A click that rings for half a second feels laggy however sharp its attack, because it is still sounding at the next interaction. Put a millisecond number in every UI prompt (under 80 ms for clicks, under 40 ms for hover states, under 300 ms for anything melodic) and trim in your editor if the model overshoots.",
      },
      {
        heading: "Direction encodes meaning",
        body: "UI sound is a small vocabulary built mostly from pitch direction and interval size. Rising pitch reads as opening, enabling or succeeding. Falling pitch reads as closing, disabling or failing. A small clean interval is neutral; a wider or slightly dissonant one draws attention. Decide what the sound needs to communicate, then pick the direction and interval. The waveform matters less.",
      },
      {
        heading: "Dry by default, reverb only for full-screen events",
        body: "Most interface sounds should be completely dry, because they play constantly and room tone builds up into mud over a session. Keep reverb or air for infrequent, larger events such as a full menu opening or a level transition, where some space makes the sound feel like an event. If unsure, say \"no reverb\". It is the safer choice for anything that fires more than once a minute.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A pack gives you a generic click tuned for someone else's app. Generating gives you a click, a toggle and a confirm chime from the same prompt family, with the same duration cap and pitch language, so the whole interface sounds consistent. It costs time and a GPU.",
      },
    ],
    related: ["notification", "whoosh", "transition", "glitch", "8bit", "machinery"],
  },
};
const NOTIFICATION: SfxCategory = {
  slug: "notification",
  name: "Notification",
  coverImage: "/sfx/covers/notification-cover.webp",
  targetQuery: "notification sound effect",
  intent:
    "Product and app designers; a short branded alert.",
  metaTitle: "Notification Sound Effects Generator | Konchi",
  metaDescription:
    "Generate notification tones and alerts locally, and regenerate until one fits your product.",
  h1: "Notification sound effects",
  intro:
    "A notification has to be noticed each time it plays without becoming annoying over months of use. Few sounds manage both.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Soft ping",
        prompt: "gentle notification ping, single clean sine tone, short natural decay, no reverb, under 500 ms",
        why: "\"Natural decay\" keeps a single tone from sounding like a UI click. A notification can have a small tail; an interface tick should not.",
      },
      {
        label: "Urgent alert",
        prompt: "urgent notification alert, three fast repeated tones, sharp attack, slightly harsh, no reverb",
        why: "The repeat count sets urgency. One tone is informational; three fast repeats signal that something needs attention now.",
      },
      {
        label: "Email chime",
        prompt: "email received chime, single warm bell-like tone, medium decay, subtle room air, under 700 ms",
        why: "\"Warm\" and \"bell-like\" move the timbre from the thin sine of a generic ping toward a typical mail client chime, without naming a real app.",
      },
      {
        label: "Achievement",
        prompt: "achievement unlock notification, short ascending three-note major arpeggio, bright and rewarding, no reverb",
        why: "\"Major arpeggio\" and \"rewarding\" separate a celebratory sound from a neutral confirm chime. The note count and the mode both matter.",
      },
      {
        label: "Low battery",
        prompt: "low battery warning tone, two low descending notes, flat and cautionary, dry, no reverb",
        why: "Descending pitch in a low register reads as caution, so a battery warning doesn't sound like an error.",
      },
    ],
    craft: [
      {
        heading: "Set urgency with repetition and register",
        body: "A single soft tone reads as informational. The same timbre repeated three times fast reads as urgent, and an octave lower it reads as a warning. Decide where the notification sits (information, gentle nudge, or something the user must act on) and set it with the repeat count and pitch register. The model interprets words like \"urgent\" less consistently than these musical parameters.",
      },
      {
        heading: "Give it a small amount of tail",
        body: "UI clicks should be as short as possible, but notification sounds benefit from a short natural decay of 300 to 700 ms. The tail makes a tone sound like a chime instead of an accidental blip, and gives it enough presence to be noticed over background noise without becoming music.",
      },
      {
        heading: "Keep the whole set in one register family",
        body: "An app with five unrelated notification sounds sounds like five different apps. Generate your success, warning and alert tones from the same base timbre description (same waveform character, same rough pitch center) and vary only direction, note count and dissonance between them. A consistent set matters more than any single sound.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A pack gives you unrelated pings, dings and buzzes that were not designed to sit together. Generating gives you a success chime, a warning tone and an urgent alert from one prompt family with a consistent timbre and register, so they sound like one notification system. It costs time and a GPU.",
      },
    ],
    related: ["ui", "whoosh", "transition", "coin-pickup", "power-up", "8bit"],
  },
};
const TRANSITION: SfxCategory = {
  slug: "transition",
  name: "Transition",
  coverImage: "/sfx/covers/transition-cover.webp",
  targetQuery: "transition sound effects",
  intent:
    "Video editors; short-form content and cuts.",
  metaTitle: "Transition Sound Effects Generator | Konchi",
  metaDescription:
    "Generate transitions, swells and cut accents locally, at the length of your edit.",
  h1: "Transition sound effects",
  intro:
    "A transition sound should be as long as the transition. Generation lets you set that length.",
  content: {
    samples: [
    ],
    recipes: [
      {
        label: "Scene swoosh",
        prompt: "cinematic scene transition swoosh, smooth rising sweep into a soft impact, 1 second, subtle room air",
        why: "\"Rising sweep into a soft impact\" gives the model a two-part shape, build then land, so the transition resolves.",
      },
      {
        label: "Riser into hit",
        prompt: "tension riser building into a sharp cinematic hit, 2 seconds, low rumble underneath, dry hit at the end",
        why: "\"Low rumble underneath\" gives the riser cinematic weight. Without low end it sounds like a cheap synth sweep.",
      },
      {
        label: "Glitch cut",
        prompt: "short digital glitch transition, stuttering bitcrushed texture, fast and choppy, under 500 ms, dry",
        why: "\"Stuttering\" and \"choppy\" describe rhythm as well as texture. A glitch transition needs irregular timing to sound broken.",
      },
      {
        label: "UI slide",
        prompt: "UI slide panel transition, thin whoosh with a soft landing thud, 300 ms, completely dry",
        why: "Most prompts leave out the landing thud. Without an endpoint the sound fades, and a panel sliding into place needs an audible stop.",
      },
      {
        label: "Downlifter",
        prompt: "cinematic downlifter, falling pitch sweep with fading tail, 1.5 seconds, roomy, ends in silence",
        why: "\"Ends in silence\" stops the sweep resolving into a hit, which makes the downlifter suitable for a somber or quiet cut.",
      },
    ],
    craft: [
      {
        heading: "Describe the transition's shape",
        body: "Most transition sounds take one of three shapes: build and land (riser into a hit), sweep and fade (a downlifter or a soft whoosh that recedes), or a single sharp cut (a glitch stutter or a page turn). Decide which shape your edit needs and describe it as a sequence, such as \"rising sweep into a soft impact\" or \"falling pitch sweep with fading tail\". The model follows a described arc more reliably than a mood word.",
      },
      {
        heading: "Match the transition's weight to the cut's weight",
        body: "A cut between two casual UI screens wants something thin and quick: under half a second, dry, no low end. A cut between two trailer scenes wants low-frequency weight and a couple of seconds to build. A heavy cinematic riser on a UI panel slide sounds oversized, and a thin UI whoosh under a trailer cut disappears. Name the duration and the frequency weight together so they stay proportional.",
      },
      {
        heading: "Silence is a valid ending",
        body: "Not every transition needs to land on a hit. Downlifters and fades that end in silence let the next shot establish itself without a stinger over it. For that, say so (\"ends in silence\", \"fading tail\", \"no hit\"). The model tends to add an impact at the end, especially for cinematic prompts.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A pack gives you a trailer riser built for someone else's two-second build, which you then stretch or cut to fit your edit. Generating gives you one at your duration, with the weight and shape matched to the cut it covers, whether that is a UI panel sliding or a scene change in a trailer. It costs time and a GPU.",
      },
    ],
    related: ["whoosh", "cinematic", "glitch", "ui", "notification", "sci-fi"],
  },
};
const MACHINERY: SfxCategory = {
  slug: "machinery",
  name: "Machinery",
  coverImage: "/sfx/covers/machinery-cover.webp",
  targetQuery: "machinery sound effects",
  intent:
    "Industrial ambience and mechanical foley for games and film.",
  metaTitle: "Machinery Sound Effects Generator | Konchi",
  metaDescription:
    "Generate motors, servos, lifts and industrial beds locally by describing load, metal and space.",
  h1: "Machinery sound effects",
  intro:
    "A machine's sound depends on the load it is under. Describe the strain and the space as well as the machine.",
  content: {
    samples: [
        {
          slug: "engine-startup",
          title: "Engine startup",
          prompt: "small combustion engine starting up, initial crank then catching and idling, 2 seconds, outdoor space",
          source: "model",
          model: "audiocpp-stable-audio-3-sfx",
          durationS: 2,
        },
    ],
    recipes: [
      {
        label: "Engine startup",
        prompt: "small combustion engine starting up, initial crank then catching and idling, 2 seconds, outdoor space",
        why: "\"Crank then catching\" names the two phases of a real start. Without them the model tends to jump straight to a steady idle and skip the mechanical struggle.",
      },
      {
        label: "Gear grind",
        prompt: "metal gears grinding under load, harsh irregular scraping, mid frequency, close mic, dry",
        why: "\"Irregular\" is the key word. Real gear grind is uneven scraping as the teeth catch inconsistently; a steady version sounds synthetic.",
      },
      {
        label: "Hydraulic release",
        prompt: "hydraulic press releasing pressure, sharp air hiss with a mechanical thunk at the end, close mic, dry",
        why: "The hiss comes before the thunk, as in a real pressure release ending in mechanical contact. In the reverse order it no longer sounds hydraulic.",
      },
      {
        label: "Conveyor hum",
        prompt: "conveyor belt motor running, steady low mechanical hum with a faint rattle, factory room tone, 3 seconds",
        why: "A \"faint rattle\" on a steady hum keeps a looped machine sound from sounding like a pure synth tone. Real machinery is never perfectly clean.",
      },
      {
        label: "Power-down",
        prompt: "industrial machine powering down, motor winding down in pitch, mechanical clunk at the end, factory room tone",
        why: "\"Winding down in pitch\" describes a motor losing RPM. The direction of the pitch change is what separates power-down from power-up.",
      },
    ],
    craft: [
      {
        heading: "Generate one phase at a time",
        body: "Machines have a start, a running state and a stop. A single generation captures one phase well; all three in one short clip tend to blur together. Startup prompts should describe the mechanical struggle before it catches (\"crank then catching\"). A running-state prompt should describe a steady character plus one imperfection (a rattle, a faint irregularity) so it doesn't sound like a pure tone. A power-down prompt should describe pitch or speed falling away. Generate the phase you need instead of a generic \"machine sound\".",
      },
      {
        heading: "Add an imperfection",
        body: "Real mechanical sound has small irregularities: a belt with a faint rattle, gears that grind unevenly, a motor with a slight flutter in its pitch. Asked for a plain mechanical hum, the model tends to produce something too clean and tonal to pass as a real machine. Naming one imperfection (\"faint rattle\", \"irregular scraping\", \"slight flutter\") is usually enough to make the whole sound mechanical.",
      },
      {
        heading: "Room tone tells you the machine's scale",
        body: "A servo motor whirring dry and close sounds small, like part of a robot arm or a printer. The same whir with factory room tone and more low end sounds industrial. Machinery prompts range from a wristwatch mechanism to a hydraulic press, and naming the room (\"close mic\" and dry for small devices, \"factory room tone\" for large equipment) often sets the scale better than a size adjective.",
      },
    ],
    faqs: [
      {
        question: "Can I use these sounds in a commercial video or game?",
        answer: "It depends on the model that made them. Konchi shows each model's licence before you download its weights. The Stable Audio 3 models use the Stability AI Community License: commercial use is free below USD $1M annual revenue, and above that Stability requires an enterprise licence. ACE-Step 1.5 is MIT. MiniMax's models allow commercial use under a revenue cap and require an attribution notice. Some voice and stem-separation models are non-commercial only. Konchi itself is MIT, but the audio is governed by the licence of the model that made it. Read that licence before you ship; this summary is not legal advice.",
      },
      {
        question: "Does this run offline?",
        answer: "Yes, once the weights are downloaded. Konchi runs the models locally and stores everything in one SQLite file and one folder of WAVs under ~/.konchi. There is no account, API key or upload step. Only the initial model download needs the network.",
      },
      {
        question: "What hardware do I need?",
        answer: "An NVIDIA GPU with 8 GB or more. CPU-only is supported, but each generation then takes minutes. That is fine for a few short clips and slow for a large batch.",
      },
      {
        question: "Can my coding agent generate these for me?",
        answer: "Yes. While Konchi is running it serves MCP at http://127.0.0.1:17494/mcp, with tools for generating and listing sounds. An agent can generate a sound as part of the task it is already doing and gets back an absolute file path to use in your project.",
      },
      {
        question: "How is this different from downloading a sample pack?",
        answer: "A pack gives you one factory's conveyor belt, recorded at whatever distance and load the recordist captured. Generating gives you a machine sound at the scale and room your scene needs, and a matched startup, run and power-down from the same prompt family. It costs time and a GPU.",
      },
    ],
    related: ["door", "sci-fi", "glitch", "impact", "ambience", "cinematic"],
  },
};

/**
 * Appends `expansions.ts` onto the sample grid a category already declares.
 *
 * The extra clips live in their own file so a pass that only widens the grids
 * doesn't bury itself in four thousand lines of prose, but they have to arrive
 * here to be real: the render script, the page template and the hub all read
 * this list and nothing else.
 */
function withExtras(category: SfxCategory): SfxCategory {
  const extra = EXTRA_SAMPLES[category.slug];
  if (!extra || !category.content) return category;
  const seen = new Set(category.content.samples.map((x) => x.slug));
  const added = extra.filter((x) => !seen.has(x.slug));
  if (added.length === 0) return category;
  return { ...category, content: { ...category.content, samples: [...category.content.samples, ...added] } };
}

export const SFX_CATEGORIES: SfxCategory[] = [
  EIGHT_BIT,
  CHIPTUNE_MUSIC,
  EIGHT_BIT_MUSIC,
  WHOOSH,
  FOOTSTEPS,
  RETRO_GAME,
  VIDEO_GAME,
  COIN_PICKUP,
  POWER_UP,
  GAME_OVER,
  LASER,
  MAGIC,
  WEAPON,
  EXPLOSION,
  IMPACT,
  HORROR,
  SCI_FI,
  CINEMATIC,
  GLITCH,
  CROWD,
  RAIN,
  THUNDER,
  WIND,
  WATER,
  FIRE,
  ANIMAL,
  AMBIENCE,
  DOOR,
  UI,
  NOTIFICATION,
  TRANSITION,
  MACHINERY,
  ...FOLEY_AND_TRANSPORT,
  ...DESIGN_AND_CREATURE,
].map(withExtras);

const BY_SLUG = new Map(SFX_CATEGORIES.map((c) => [c.slug, c]));

export function getCategory(slug: string | undefined): SfxCategory | undefined {
  return slug ? BY_SLUG.get(slug) : undefined;
}

export function groupOf(slug: string): SfxGroup {
  return CATEGORY_GROUPS[slug] ?? "Games";
}
