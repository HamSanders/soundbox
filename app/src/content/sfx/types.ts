/**
 * Content model for the programmatic SEO sound-effect pages (`/sfx/*`).
 *
 * These types are deliberately a *content* schema, not a UI schema: every field
 * is something a human (or a scripted pass reviewed by a human) writes once per
 * category, and the page template decides how to render it. Adding a category
 * must never mean touching a component.
 *
 * The audio itself is not in here. Waveform peaks are ~10 KB of numbers per
 * category and would dominate the JS bundle; they live beside the MP3s in
 * `site/public/sfx/<slug>/manifest.json` and are fetched by the sample grid. See
 * scripts/gen-sfx-samples.ts for the render script that produces both.
 */

/**
 * Where a sample's audio actually came from.
 *
 * This exists so the page can never quietly imply a model made something it
 * did not. `"model"` samples are real renders from a named Konchi model and
 * carry that model's id and licence consequences. `"placeholder"` samples are
 * stand-ins used while a category is being built out — the template labels them
 * as such, and a category with any placeholder left in it is not publishable.
 */
export type SampleSource = "model" | "placeholder";

export interface SfxSample {
  /** File basename under `site/public/sfx/<category>/`, without extension. */
  slug: string;
  /** Short human title shown in the sample row. */
  title: string;
  /** The exact prompt that produced it — the teaching material, and the thing
   *  that makes these pages worth reading rather than worth skimming. */
  prompt: string;
  source: SampleSource;
  /** Model id (matches `/api/models`) when `source` is `"model"`. */
  model?: string;
  /** How the placeholder was made, when `source` is `"placeholder"`. Rendered
   *  verbatim so the claim on the page is always the true one. */
  placeholderNote?: string;
  /** Clip length to render, in seconds. Read by scripts/gen-sfx-samples.ts,
   *  which treats this file as the single source of truth for what gets
   *  generated — the prompt shown on the page is by construction the prompt
   *  that made the clip. Defaults to 4 s when omitted. */
  durationS?: number;
}

export interface SfxFaq {
  question: string;
  answer: string;
}

/** A prompt recipe: the material/action/space breakdown the README argues for. */
export interface SfxRecipe {
  label: string;
  prompt: string;
  /** Why this prompt works — one sentence, specific to the sound. */
  why: string;
}

export interface SfxCategory {
  /** URL slug: `/sfx/<slug>`. */
  slug: string;
  /** Display name, title-cased, no "sound effects" suffix. */
  name: string;
  /** The search phrase this page is built to answer. */
  targetQuery: string;
  /** What the searcher is actually trying to do. Used in the plan and in
   *  review; not rendered. */
  intent: string;
  /** `<title>`. Kept under ~60 chars. */
  metaTitle: string;
  /** `<meta name="description">`. Kept under ~155 chars. */
  metaDescription: string;
  /** Page H1. */
  h1: string;
  /** Two or three sentences under the H1. Written per category — this is the
   *  section that separates a real page from a doorway page. */
  intro: string;
  /** Fully authored categories carry these. Stubs in the taxonomy do not, and
   *  the router refuses to render a page without them. */
  content?: SfxCategoryContent;
  /** Abstract cover art for the detail-page hero, under
   *  `site/public/sfx/covers/`: a 1024x576 WebP written by
   *  `scripts/compress-sfx-covers.py`, which also writes the hub thumbnail and
   *  the share card next to it (see `coverThumb` / `coverCard`). Optional —
   *  categories without one just render without an image rather than a broken
   *  thumbnail. */
  coverImage?: string;
}

/** Pixel size of every `coverImage`, for the hero's width/height attributes. */
export const COVER_SIZE = { width: 1024, height: 576 } as const;

/** The 96x96 hub thumbnail written beside a cover: `x-cover.webp` -> `x-cover-thumb.webp`. */
export function coverThumb(cover: string): string {
  return cover.replace(/\.webp$/, "-thumb.webp");
}

/** The 1200x630 share card for a cover: `/sfx/covers/x-cover.webp` -> `/sfx/og/x-cover.jpg`. */
export function coverCard(cover: string): string {
  return cover.replace("/sfx/covers/", "/sfx/og/").replace(/\.webp$/, ".jpg");
}

export interface SfxCategoryContent {
  samples: SfxSample[];
  recipes: SfxRecipe[];
  /** Craft guidance specific to this family of sounds. Paragraphs. */
  craft: { heading: string; body: string }[];
  faqs: SfxFaq[];
  /** Slugs of sibling categories. Must exist in the taxonomy. */
  related: string[];
}

/** A category is renderable only once someone has written its content. */
export type PublishedCategory = SfxCategory & { content: SfxCategoryContent };

export function isPublished(c: SfxCategory): c is PublishedCategory {
  return c.content !== undefined;
}
