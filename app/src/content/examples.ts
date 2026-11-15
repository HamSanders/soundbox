/**
 * The short list of real renders the marketing pages let you play: one next to
 * each place a page talks about a kind of sound.
 *
 * Two origins. `catalogue` entries are copied from the SFX catalogue and link
 * to their page there. `render` entries were made for these pages, and
 * `site/public/examples/renders.json` records how: the model, the exact
 * prompt (and lyrics, or the text read), the seed, which take of how many was
 * kept, and its loudness. Every file under `site/public/examples/` is
 * level-matched to -18 LUFS with a -1.5 dBTP ceiling, so no player is
 * suddenly louder than the last. `scripts/check-examples.ts` fails if an entry
 * drifts from its catalogue or its manifest record.
 */

export interface Example {
  origin: "catalogue" | "render";
  kind: "sfx" | "music" | "voice";
  title: string;
  /** What was typed to make it. Absent for a voice clip, which has `text`. */
  prompt?: string;
  /** The lyric sheet a song was sung from. */
  lyrics?: string;
  /** The words a voice clip reads. */
  text?: string;
  /** Model id, as in the models catalogue. */
  model: string;
  /** Path under `site/public/`. */
  file: string;
  /** The page on this site with the full sample, when there is one. */
  page?: string;
}

export const EXAMPLES = {
  "door-heavy-vault": {
    origin: "catalogue",
    kind: "sfx",
    title: "Vault door",
    prompt: "heavy steel vault door, mechanism unlocking with deep bolts retracting and a slow massive swing",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/examples/door-heavy-vault.mp3",
    page: "/sfx/door/door-heavy-vault",
  },
  "laser-plasma-bolt": {
    origin: "catalogue",
    kind: "sfx",
    title: "Plasma bolt",
    prompt: "plasma bolt firing, thick electric discharge with a downward pitch sweep and a crackling tail, medium space",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/examples/laser-plasma-bolt.mp3",
    page: "/sfx/laser/laser-plasma-bolt",
  },
  "gameover-sad-trombone": {
    origin: "catalogue",
    kind: "sfx",
    title: "Sad trombone",
    prompt: "comedic sad trombone wah wah wah, four descending muted brass notes, dry",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/examples/gameover-sad-trombone.mp3",
    page: "/sfx/game-over/gameover-sad-trombone",
  },
  "chip-impact": {
    origin: "render",
    kind: "sfx",
    title: "Crate drop",
    prompt: "heavy wooden crate dropping onto a concrete floor, close mic, dry room",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/examples/chip-impact.mp3",
  },
  "chip-footsteps": {
    origin: "render",
    kind: "sfx",
    title: "Boots on gravel",
    prompt: "boots on wet gravel, slow steady pace, outdoors at night",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/examples/chip-footsteps.mp3",
  },
  "chip-machinery": {
    origin: "render",
    kind: "sfx",
    title: "Freight lift",
    prompt: "old freight lift motor starting under load, metal cable strain, echoing shaft",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/examples/chip-machinery.mp3",
  },
  "chip-ambience": {
    origin: "render",
    kind: "sfx",
    title: "Rain on a tin roof",
    prompt: "rain on a tin roof, distant thunder, steady wind through trees",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/examples/chip-ambience.mp3",
  },
  "chip-ui": {
    origin: "render",
    kind: "sfx",
    title: "Button clicks",
    prompt: "three small plastic button clicks in a row, tight and dry, no reverb",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/examples/chip-ui.mp3",
  },
  "chip-whoosh": {
    origin: "render",
    kind: "sfx",
    title: "Blade swing",
    prompt: "heavy steel blade swinging fast past the microphone, turbulent air",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/examples/chip-whoosh.mp3",
  },
  "coin-chime": {
    origin: "render",
    kind: "sfx",
    title: "Coin pickup",
    prompt: "bright two-note rising coin pickup chime with a short metallic sparkle tail, clean and dry",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/examples/coin-chime.mp3",
  },
  "song-own-machine": {
    origin: "render",
    kind: "music",
    title: "Own Machine",
    prompt: "upbeat indie pop, jangly electric guitars, tight live drums, warm bass, bright female lead vocal, catchy singalong chorus, major key, 118 BPM",
    lyrics: "[verse]\nTyped a little sentence, then I hit the key\nOut came a thunderstorm, just for me\nNo meter ticking, no cloud in the sky\nIt's all running here on my own machine tonight\n\n[chorus]\nPlay it again, play it loud\nNobody's watching, nobody's around\nEvery sound I dreamed up\nCame right out of the speakers now",
    model: "audiocpp-ace-step",
    file: "/examples/song-own-machine.mp3",
  },
  "inst-lofi": {
    origin: "render",
    kind: "music",
    title: "Lo-fi beat",
    prompt: "warm lo-fi hip hop beat, dusty vinyl crackle, mellow Rhodes chords, soft boom-bap drums, round upright bass, laid-back 82 BPM",
    model: "audiocpp-stable-audio-3-small-music",
    file: "/examples/inst-lofi.mp3",
  },
  "inst-trailer": {
    origin: "render",
    kind: "music",
    title: "Trailer build",
    prompt: "cinematic hybrid trailer build, low string ostinato, big taiko drums, brass swells rising to a hit, tense and heroic, 100 BPM",
    model: "audiocpp-stable-audio-3-small-music",
    file: "/examples/inst-trailer.mp3",
  },
  "voice-intro": {
    origin: "render",
    kind: "voice",
    title: "A voice, read aloud",
    text: "Describe a sound, and get a file on your disk. Write some lyrics and get a song. Clone a voice from a short clip. It all runs on your own machine, with no account and no credits.",
    model: "audiocpp-chatterbox",
    file: "/examples/voice-intro.mp3",
  },
} as const satisfies Record<string, Example>;

export type ExampleId = keyof typeof EXAMPLES;

/** The render shown on each model's card and page. Models with no render in
 *  the catalogues (MiniMax, the stem splitters) have no entry, and show no
 *  player. */
const BY_MODEL: Record<string, ExampleId> = {
  "audiocpp-stable-audio-3-sfx": "door-heavy-vault",
  "audiocpp-stable-audio-3-small-music": "inst-lofi",
  "audiocpp-ace-step": "song-own-machine",
  "audiocpp-chatterbox": "voice-intro",
};

export function exampleForModel(catalogId: string): ExampleId | undefined {
  return BY_MODEL[catalogId];
}
