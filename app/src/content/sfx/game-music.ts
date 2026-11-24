/**
 * The music on the /sfx pages, gathered for `/music`.
 *
 * Several /sfx categories carry full themes and loops rather than effects
 * (the 8-bit and chiptune pages, the choir stings on cinematic, horror, magic).
 * They are rendered on a music model and belong in a playlist as much as in a
 * sample grid, so /music lists them in its own table. This file only points at
 * them: the prompt, model and audio stay with the sample in `categories.ts`,
 * so the two pages can never disagree about what made a clip.
 */
import { SFX_CATEGORIES } from "./categories";
import { isPublished } from "./types";
import type { PublishedCategory, SfxSample } from "./types";

/** `category/sample`, in the order /music plays them. */
const GAME_MUSIC_KEYS = [
  "8bit-music/nes-title-screen-theme",
  "8bit-music/gameboy-overworld-loop",
  "chiptune-music/nes-2a03-dungeon-theme",
  "chiptune-music/sid-chiptune-loop",
  "chiptune-music/genesis-fm-synth-theme",
  "chiptune-music/amiga-modtracker-overworld",
  "8bit-music/8bit-shop-menu-loop",
  "8bit/dungeon-loop-16bit",
  "chiptune-music/opl2-adlib-boss-theme",
  "8bit/8bit-boss-theme-loop",
  "8bit-music/8bit-final-boss-theme",
  "8bit/level-complete-fanfare-full",
  "8bit-music/ace-victory-loop",
  "chiptune-music/hero-anthem-vocal-chant",
  "power-up/triumphant-power-chant",
  "cinematic/trailer-choir-chant",
  "magic/arcane-ritual-chant",
  "horror/whispered-dread-chant",
  "game-over/sung-defeat-chant",
  "sci-fi/ace-spaceship-ambient-loop",
  "ambience/ace-tavern-folk-loop",
] as const;

export interface GameMusicEntry {
  category: PublishedCategory;
  sample: SfxSample;
}

/** Every listed piece that exists and is published. A key that stops
 *  resolving drops out of the table rather than breaking the page. */
export function gameMusic(): GameMusicEntry[] {
  const published = new Map(SFX_CATEGORIES.filter(isPublished).map((c) => [c.slug, c]));
  return GAME_MUSIC_KEYS.flatMap((key) => {
    const [cat, slug] = key.split("/");
    const category = published.get(cat);
    const sample = category?.content.samples.find((s) => s.slug === slug);
    return category && sample ? [{ category, sample }] : [];
  });
}
