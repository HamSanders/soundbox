/**
 * The short list of real renders the marketing pages let you play: one next to
 * each place a page talks about a kind of sound.
 *
 * Every entry is copied from the catalogue it points at (`content/sfx/` or
 * `content/music/`), with the prompt that produced the file, and the file is
 * the one already served from `site/public/`. Nothing here is a placeholder.
 * `scripts/check-examples.ts` fails if an entry drifts from its catalogue.
 * The voice clip is the first two sentences of the narrated blog post "What
 * audio.cpp replaced", cut with ffmpeg.
 */

export interface Example {
  kind: "sfx" | "music" | "voice";
  title: string;
  /** What was typed to make it. Omitted for the voice clip, which is read text. */
  prompt?: string;
  /** Model id, as in the models catalogue. */
  model: string;
  /** Path under `site/public/`. */
  file: string;
  /** The page on this site with the full sample, when there is one. */
  page?: string;
}

export const EXAMPLES = {
  "impact-wood-crate-smash": {
    kind: "sfx",
    title: "Crate smash",
    prompt: "wooden crate smashing apart on stone, splintering wood with debris scattering, warehouse reverb",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/sfx/impact/impact-wood-crate-smash.mp3",
    page: "/sfx/impact/impact-wood-crate-smash",
  },
  "footsteps-mud-squelch": {
    kind: "sfx",
    title: "Mud",
    prompt: "boots trudging through thick mud, heavy wet squelching suction with each step, outdoor, close mic",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/sfx/footsteps/footsteps-mud-squelch.mp3",
    page: "/sfx/footsteps/footsteps-mud-squelch",
  },
  "machinery-drill-press": {
    kind: "sfx",
    title: "Drill press",
    prompt: "drill press boring into steel, rising motor load with metal shavings and a coolant hiss, workshop",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/sfx/machinery/machinery-drill-press.mp3",
    page: "/sfx/machinery/machinery-drill-press",
  },
  "rain-thunderstorm-full": {
    kind: "sfx",
    title: "Full thunderstorm",
    prompt: "heavy thunderstorm, driving rain with rolling thunder and wind gusting through trees, outdoor, seamless loop",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/sfx/rain/rain-thunderstorm-full.mp3",
    page: "/sfx/rain/rain-thunderstorm-full",
  },
  "ui-keyboard-tap": {
    kind: "sfx",
    title: "Keyboard tap",
    prompt: "single soft mechanical keyboard key tap, muted thock, close mic, completely dry",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/sfx/ui/ui-keyboard-tap.mp3",
    page: "/sfx/ui/ui-keyboard-tap",
  },
  "whoosh-heavy-door-air": {
    kind: "sfx",
    title: "Heavy air movement",
    prompt: "large heavy object displacing air as it swings past, thick low rush with a soft turbulent tail",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/sfx/whoosh/whoosh-heavy-door-air.mp3",
    page: "/sfx/whoosh/whoosh-heavy-door-air",
  },
  "door-heavy-vault": {
    kind: "sfx",
    title: "Vault door",
    prompt: "heavy steel vault door, mechanism unlocking with deep bolts retracting and a slow massive swing",
    model: "audiocpp-stable-audio-3-sfx",
    file: "/sfx/door/door-heavy-vault.mp3",
    page: "/sfx/door/door-heavy-vault",
  },
  "neon-arcade-nights": {
    kind: "music",
    title: "Neon Arcade Nights",
    prompt: "1980s synthwave arcade title theme, wide analog saw lead synth melody, gated reverb drum machine, pulsing sidechained bass synth, bright neon major key, 110 BPM, seamless loop",
    model: "audiocpp-stable-audio-3-small-music",
    file: "/music/neon-arcade-nights.mp3",
    page: "/music/neon-arcade-nights",
  },
  "victory-lap": {
    kind: "music",
    title: "Victory Lap",
    prompt: "triumphant power pop victory anthem, bright electric guitars, punchy live drums, gang vocal chorus, major key, 140 BPM",
    model: "audiocpp-ace-step",
    file: "/music/victory-lap.mp3",
    page: "/music/victory-lap",
  },
  "narration-intro": {
    kind: "voice",
    title: "A post read aloud",
    model: "audiocpp-chatterbox",
    file: "/voices/narration-intro.mp3",
    page: "/blog/what-audio-cpp-replaced",
  },
} as const satisfies Record<string, Example>;

export type ExampleId = keyof typeof EXAMPLES;

/** The render shown on each model's card and page. Models with no render in the
 *  catalogues (MiniMax, the stem splitters) have no entry, and show no player. */
const BY_MODEL: Record<string, ExampleId> = {
  "audiocpp-stable-audio-3-sfx": "door-heavy-vault",
  "audiocpp-stable-audio-3-small-music": "neon-arcade-nights",
  "audiocpp-ace-step": "victory-lap",
  "audiocpp-chatterbox": "narration-intro",
};

export function exampleForModel(catalogId: string): ExampleId | undefined {
  return BY_MODEL[catalogId];
}
