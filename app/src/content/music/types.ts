/**
 * Content model for the `/music` landing page.
 *
 * Same rule as `content/sfx/types.ts`: this is a *content* schema, not a UI
 * schema. Everything here is written once per track and the template decides
 * how to render it, so adding a track never means touching a component.
 *
 * Two things deliberately absent:
 *
 * - **Audio metadata.** Duration, sample rate and the 256 waveform peaks live
 *   beside the MP3s in `site/public/music/manifest.json` (see
 *   `scripts/gen-music-tracks.mjs`). Twelve tracks' worth of peaks is ~20 KB
 *   of numbers; bundling it would dominate the page's JS for data the player
 *   only needs once it renders.
 * - **Any notion of an "album" or an "artist".** The reference layout this
 *   page is modelled on is a streaming dashboard, and it would have been easy
 *   to borrow its vocabulary wholesale. These are single renders from a named
 *   local model, so the subtitle line under each cover is the model that made
 *   it, not a fictional band. A page whose argument is "you can verify every
 *   claim on it" cannot open with an invented discography.
 */

/** The two music models in the lineup, and the only two allowed on this page. */
export type MusicModelId = "audiocpp-stable-audio-3-small-music" | "audiocpp-ace-step";

/** Presentational grouping. Also the sidebar's section list. */
export type MusicCollection = "instrumental" | "vocal";

export interface MusicTrack {
  /** File basename under `site/public/music/`, without extension. */
  slug: string;
  /** Display title. */
  title: string;
  /** Genre line shown under the title and in the hero pill. */
  genre: string;
  /** The exact prompt that produced it — the teaching material, and the only
   *  reason a page like this is worth reading rather than skimming. */
  prompt: string;
  /** ACE-Step only: the lyrics block it sang. `undefined` means instrumental. */
  lyrics?: string;
  model: MusicModelId;
  collection: MusicCollection;
  /** Duration requested from the model, in seconds. The *rendered* duration
   *  comes from the manifest — models overshoot by a fraction of a second. */
  durationS: number;
  /** Cover art under `site/public/music/covers/`. Generated, not stock — see the
   *  note in `tracks.ts`. */
  cover: string;
  /** One sentence on why this prompt lands, shown on the featured cards.
   *  Written per track; this is the part a template cannot fake. */
  why: string;
  /** Marks a track as part of the "Popular now" set — contemporary chart and
   *  club genres, as against the game and film cues the page opened with.
   *
   *  This is deliberately a flag rather than a third `MusicCollection` value.
   *  The collection split is *by model* and is load-bearing: Stable Audio
   *  cannot sing, ACE-Step can, and the two sections exist to teach that. A
   *  trending track is still one or the other, so it appears in its model's
   *  section *and* in the trending section, rather than being pulled out of
   *  the taxonomy the rest of the page depends on. */
  trending?: boolean;
  /** Scene label for the trending rows — "Amapiano", "Melodic drill". Distinct
   *  from `genre` only in that it names the *scene* a listener would search
   *  for, which is not always what the prompt calls the arrangement. */
  scene?: string;
}

/** Human label for a model id. Used wherever a track credits its renderer. */
export const MUSIC_MODEL_NAMES: Record<MusicModelId, string> = {
  "audiocpp-stable-audio-3-small-music": "Stable Audio 3.0 Small Music",
  "audiocpp-ace-step": "ACE-Step 1.5 Turbo",
};

/** Licence surfaced next to each track, matching the model catalogue entry
 *  in `server/src/models/audiocpp_models_catalog.json` and the licence
 *  findings in `content/models/models.ts`. Kept here so the page
 *  can state the terms without a backend call — this build has no backend. */
export const MUSIC_MODEL_LICENSES: Record<MusicModelId, { name: string; note: string }> = {
  "audiocpp-stable-audio-3-small-music": {
    name: "Stability AI Community License",
    note: "Commercial use is free below USD $1M annual revenue; above that Stability requires an Enterprise licence.",
  },
  "audiocpp-ace-step": {
    name: "MIT License",
    note: "The LICENSE file in ace-step/ACE-Step-1.5 is MIT, which permits commercial use with no threshold. MIT has no output clause; the model card says generated music may be used commercially, which is the publisher's stated intent rather than a contractual grant.",
  },
};
