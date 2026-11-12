/**
 * Konchi Records — the mock label on `/music`, and its twenty-act roster.
 *
 * The rest of the page is strict about invention (every track credits the
 * model that rendered it), so a label of fictional artists only works if it
 * is labelled fictional and earns its place by teaching something real. It
 * does: each act is a **prompt persona** — a house-style string held constant
 * across renders, which is all a band identity is to a generative model —
 * and each act has a real signature track rendered from exactly that string,
 * so the roster is audible, not decorative.
 *
 * The signature-track audio lives beside the covers in
 * `site/public/music/artists/` (`<slug>.mp3` + `manifest.json`), produced by
 * `scripts/gen-artist-tracks.mjs` — whose prompts must stay in sync with the
 * `signaturePrompt` fields here, same contract as tracks.ts has with its
 * render script. Covers are local Stable Diffusion 3.5 renders
 * (scripts/gen_sd35.py + scripts/gen-artist-covers.json): abstract art, no
 * text, no logos, no people, so no card can pass for a real release.
 *
 * Names are invented compounds checked against real acts; if one collides
 * anyway, rename it here — nothing else references them.
 */

export const LABEL = {
  name: "Konchi Records",
  tagline: "A fictional label where every artist is a prompt.",
  /** Catalog prefix — each act's number is SBX- plus its roster position. */
  catalogPrefix: "SBX",
} as const;

export interface MusicArtist {
  /** Stable key; also the basename of the cover AND the signature-track MP3
   *  under `site/public/music/artists/`. */
  slug: string;
  name: string;
  genre: string;
  /** The persona: a prompt fragment that *is* this act's sound. Prepend it to
   *  any brief and the output stays in character across renders. */
  sound: string;
  cover: string;
  /** The exact prompt the signature track was rendered from. */
  signaturePrompt: string;
  /** ACE-Step acts only: the lyrics block their signature track sings. */
  signatureLyrics?: string;
}

export const MUSIC_ARTISTS: MusicArtist[] = [
  {
    slug: "chrome-sunset-division",
    name: "Chrome Sunset Division",
    genre: "Synthwave",
    sound:
      "wide analog saw leads, gated reverb drums, sidechained bass, neon 1984 palette, 108 BPM",
    cover: "/music/artists/chrome-sunset-division.webp",
    signaturePrompt:
      "1980s synthwave anthem, wide analog saw leads, gated reverb drums, sidechained bass, neon night-drive mood, 108 BPM, seamless loop",
  },
  {
    slug: "pixelheart-parade",
    name: "Pixelheart Parade",
    genre: "Chiptune pop",
    sound:
      "bright square wave leads, pulse wave harmony, noise-channel drums, relentlessly major key",
    cover: "/music/artists/pixelheart-parade.webp",
    signaturePrompt:
      "cheerful chiptune pop anthem, bright square wave leads, pulse wave harmony, noise-channel drums, relentlessly major key, 128 BPM, seamless loop",
  },
  {
    slug: "the-slow-cavern",
    name: "The Slow Cavern",
    genre: "Ambient",
    sound:
      "glassy bell arpeggios, long dripping-water reverb tails, sparse hand percussion, minor and unhurried",
    cover: "/music/artists/the-slow-cavern.webp",
    signaturePrompt:
      "slow ambient piece, glassy bell arpeggios, long dripping-water reverb tails, sparse hand percussion, unhurried minor key",
  },
  {
    slug: "foundry-choir",
    name: "Foundry Choir",
    genre: "Industrial",
    sound:
      "scrap-steel percussion locked to the grid, distorted bass ostinato, machine-room air, 128 BPM",
    cover: "/music/artists/foundry-choir.webp",
    signaturePrompt:
      "industrial track, scrap-steel percussion locked to the grid, distorted bass ostinato, machine-room atmosphere, 128 BPM, seamless loop",
  },
  {
    slug: "battalion-of-strings",
    name: "Battalion of Strings",
    genre: "Orchestral hybrid",
    sound:
      "staccato low string ostinato, brass stabs, taiko on the downbeat, sustained choir pad underneath",
    cover: "/music/artists/battalion-of-strings.webp",
    signaturePrompt:
      "orchestral hybrid battle theme, staccato low string ostinato, brass stabs, taiko drums on the downbeat, sustained choir pad, dark minor key, 150 BPM",
  },
  {
    slug: "dust-and-circuit",
    name: "Dust & Circuit",
    genre: "Lo-fi",
    sound:
      "dusty vinyl crackle, mellow square wave melody, warm sub bass, laid-back swung drums, 82 BPM",
    cover: "/music/artists/dust-and-circuit.webp",
    signaturePrompt:
      "lo-fi beat, dusty vinyl crackle, mellow square wave melody, warm sub bass, laid-back swung drums, 82 BPM, seamless loop",
  },
  {
    slug: "lanternwood",
    name: "Lanternwood",
    genre: "Fantasy folk",
    sound:
      "plucked lute, wooden flute counter-melody, hand drum and tambourine, warm firelit major key",
    cover: "/music/artists/lanternwood.webp",
    signaturePrompt:
      "fantasy folk tune, plucked lute, wooden flute counter-melody, hand drum and tambourine, warm firelit major key, seamless loop",
  },
  {
    slug: "low-lamp-trio",
    name: "Low Lamp Trio",
    genre: "Blues",
    sound:
      "weeping guitar bends, brushed drums, warm upright bass, smoky late-set minor key, 68 BPM",
    cover: "/music/artists/low-lamp-trio.webp",
    signaturePrompt:
      "slow blues instrumental, weeping guitar bends, brushed drums, warm upright bass, smoky late-set minor key, 68 BPM",
  },
  {
    slug: "gravity-well-ensemble",
    name: "Gravity Well Ensemble",
    genre: "Space ambient",
    sound:
      "evolving analog pads, distant reverb-drenched piano, soft granular texture, no percussion",
    cover: "/music/artists/gravity-well-ensemble.webp",
    signaturePrompt:
      "space ambient piece, evolving analog pads, distant reverb-drenched piano, soft granular texture, weightless and spacious, no percussion",
  },
  {
    slug: "redline-prophets",
    name: "Redline Prophets",
    genre: "Racing rock",
    sound:
      "distorted guitar riffs, four-on-the-floor kit, aggressive bass synth, rising tension, 165 BPM",
    cover: "/music/artists/redline-prophets.webp",
    signaturePrompt:
      "racing rock theme, distorted guitar riffs, four-on-the-floor drum kit, aggressive bass synth, rising tension, 165 BPM, seamless loop",
  },
  {
    slug: "the-glass-arcade",
    name: "The Glass Arcade",
    genre: "Dream pop",
    sound:
      "washed-out shimmer guitars, soft airy female vocal, slow chorus pedal sway, reverb over everything",
    cover: "/music/artists/the-glass-arcade.webp",
    signaturePrompt:
      "dream pop, washed-out shimmer guitars, soft airy female vocal, slow chorus-pedal sway, heavy reverb, 92 BPM",
    signatureLyrics: "[verse]\nUnder glass we glow\nSlow light, slow light\n[chorus]\nDon't wake me now",
  },
  {
    slug: "copper-kettle-club",
    name: "Copper Kettle Club",
    genre: "Ragtime jazz",
    sound:
      "upright piano stride, muted trumpet, brushed snare shuffle, tea-room cheerfulness, 96 BPM",
    cover: "/music/artists/copper-kettle-club.webp",
    signaturePrompt:
      "ragtime jazz, upright piano stride, muted trumpet, brushed snare shuffle, cheerful tea-room swing, 96 BPM",
  },
  {
    slug: "static-bloom",
    name: "Static Bloom",
    genre: "Shoegaze",
    sound:
      "wall of fuzzed guitars, buried melody, slow crashing drums, everything blooming into feedback",
    cover: "/music/artists/static-bloom.webp",
    signaturePrompt:
      "shoegaze instrumental, wall of fuzzed guitars, buried melody, slow crashing drums, everything blooming into feedback, 100 BPM",
  },
  {
    slug: "moth-orchestra",
    name: "Moth Orchestra",
    genre: "Chamber",
    sound:
      "close-mic string quartet, fluttering pizzicato, hushed dynamics, candlelit minor key",
    cover: "/music/artists/moth-orchestra.webp",
    signaturePrompt:
      "chamber piece, close-mic string quartet, fluttering pizzicato, hushed dynamics, candlelit minor key",
  },
  {
    slug: "bitrate-bandits",
    name: "Bitrate Bandits",
    genre: "Breakcore chiptune",
    sound:
      "chopped noise-channel breaks, detuned pulse stabs, frantic tempo shifts, gleeful 8-bit chaos",
    cover: "/music/artists/bitrate-bandits.webp",
    signaturePrompt:
      "breakcore chiptune, chopped noise-channel breaks, detuned pulse stabs, frantic tempo shifts, gleeful 8-bit chaos, 180 BPM",
  },
  {
    slug: "velvet-modem",
    name: "Velvet Modem",
    genre: "Synth funk",
    sound:
      "slap bass synth, clavinet stabs, tight drum machine groove, talkbox-adjacent lead, 104 BPM",
    cover: "/music/artists/velvet-modem.webp",
    signaturePrompt:
      "synth funk groove, slap bass synth, clavinet stabs, tight drum machine groove, talkbox-style lead, 104 BPM, seamless loop",
  },
  {
    slug: "iron-lullaby",
    name: "Iron Lullaby",
    genre: "Doom folk",
    sound:
      "down-tuned acoustic drones, funeral-pace percussion, low male hum, heavy and strangely tender",
    cover: "/music/artists/iron-lullaby.webp",
    signaturePrompt:
      "doom folk lullaby, down-tuned acoustic guitar drones, funeral-pace percussion, deep low male vocal, heavy and strangely tender, 60 BPM",
    signatureLyrics: "[verse]\nRest beneath the iron sky\nThe forge burns low\n[chorus]\nSleep now, sleep now",
  },
  {
    slug: "paper-satellites",
    name: "Paper Satellites",
    genre: "Indie pop",
    sound:
      "jangly electric guitars, handclaps, warm synth pads, cheerful duet vocals trading lines, 124 BPM",
    cover: "/music/artists/paper-satellites.webp",
    signaturePrompt:
      "upbeat indie pop, jangly electric guitars, handclaps, warm synth pads, cheerful male and female duet vocals trading lines, 124 BPM",
    signatureLyrics: "[verse]\nFold me a wing, throw me high\n[chorus]\nPaper satellites across the sky",
  },
  {
    slug: "the-hologram-choir",
    name: "The Hologram Choir",
    genre: "Synth choral",
    sound:
      "stacked vocoder harmonies, cathedral reverb, slow chord swells, sacred music from no century",
    cover: "/music/artists/the-hologram-choir.webp",
    signaturePrompt:
      "synth choral piece, stacked vocoder vocal harmonies, cathedral reverb, slow chord swells, sacred and synthetic, 70 BPM",
    signatureLyrics: "[chorus]\nLight in the wires\nWe sing, we sing\nLight in the wires",
  },
  {
    slug: "ember-fields",
    name: "Ember Fields",
    genre: "Post-rock",
    sound:
      "clean tremolo guitars building to a distorted crest, cymbal swells, ten-minute patience in twenty seconds",
    cover: "/music/artists/ember-fields.webp",
    signaturePrompt:
      "post-rock crescendo, clean tremolo guitars building into a distorted crest, cymbal swells, patient build, 130 BPM",
  },
];

/** Catalog number for an act, from its roster position: SBX-001 upward. */
export function catalogNumber(index: number): string {
  return `${LABEL.catalogPrefix}-${String(index + 1).padStart(3, "0")}`;
}
