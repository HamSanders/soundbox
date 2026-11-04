/**
 * Content model for the `/models` pages — the public write-up of every model
 * Konchi can run.
 *
 * ## Why this file was rewritten
 *
 * The previous version described five models (MOSS-SoundEffect, AudioLDM 2,
 * Stable Audio Open, TangoFlux, AudioGen) sourced, per its own docstring,
 * from `backend/src/soundbox/models/*.py` — a Python backend that no longer
 * exists in this repo. None of those five are in the shipped catalog. Its
 * `install.command` field held `uv sync --extra ...` lines for virtualenvs
 * and torch pins that apply to nothing any more.
 *
 * The source of truth today is `server/src/models/audiocpp_models_catalog.json`
 * plus `docs/AUDIOCPP.md`. Every model runs through one native binary,
 * audio.cpp, so there is no per-model install command to document — which is
 * why `install` is gone from this schema entirely and replaced by `weights`.
 *
 * ## The rule this schema exists to enforce
 *
 * Every licence claim carries a source link, and "we could not confirm this"
 * is a first-class value rather than something to paper over with a
 * permissive default. That is why `commercial` has an `"unknown"` member that
 * the app's own `LicenseInfo` (see `@/lib/api`) does not, and why
 * `LicenseFinding.sources` is required and non-empty by convention.
 * `docs/AUDIOCPP.md` takes the same line for custom entries: omitting
 * `license` shows the model as "Unspecified / not commercial", because "a
 * wrong permissive default is worse than an honest unknown".
 *
 * These pages are prerendered by vite-react-ssg with no server behind them.
 * Everything here is static data, written once per model; the templates in
 * `routes/models-hub.tsx` and `routes/models-detail.tsx` decide how to show
 * it.
 */

export interface ModelLink {
  label: string;
  href: string;
}

/**
 * Whether the *weights* may be used commercially.
 *
 * `"unknown"` is not a synonym for `"no"` and not a hedge — it means nobody
 * here has read a licence for these weights, and the page says exactly that.
 */
export type CommercialUse = "yes" | "conditional" | "no" | "unknown";

/** Tri-state, for the same reason `CommercialUse` has four: a repo we never
 *  opened is not a repo we confirmed was ungated. */
export type Tristate = "yes" | "no" | "unknown";

/**
 * What we found when we went and read a model's licence — deliberately shaped
 * as a *finding* rather than as a fact.
 *
 * The catalog's own `license` object is the app's runtime answer; this is the
 * research behind it, with the citations, and the two can disagree. Where they
 * do, `correction` says so out loud instead of quietly overwriting the older
 * claim — ACE-Step is the case that forced this field: the catalog says
 * "Apache-2.0 (unverified)" and the LICENSE file says MIT.
 */
export interface LicenseFinding {
  /** The licence's actual name, as it appears in the licence text or the HF
   *  tag. `"Unknown"` when we could not identify one. */
  name: string;
  commercial: CommercialUse;
  /** Plain language, one or two sentences: what the terms actually permit,
   *  including any revenue cap or attribution duty. If unverified, this must
   *  say so in as many words. */
  summary: string;
  /** Any condition a reader must meet, one per line — revenue thresholds,
   *  attribution, territory exclusions. Empty for unconditional licences. */
  conditions: string[];
  /**
   * What the licence says about **generated output**, which is a separate
   * question from what it says about the weights. Conflating the two is the
   * common error, so the schema forces an answer. Say "could not confirm"
   * when that is the truth.
   */
  output: string;
  /** Whether the weights Konchi downloads require accepting terms on a
   *  Hugging Face account. Every audio model downloads audio.cpp's ungated
   *  GGUF conversion, so "no" even where the original upstream repo is gated. */
  gated: Tristate;
  /** Where each claim above came from. Never empty: an unsourced licence
   *  assertion is the thing this whole file is designed to prevent. */
  sources: ModelLink[];
  /** True only when someone here opened the licence text and read it. False
   *  means the page shows this as unconfirmed. */
  readByUs: boolean;
  /** Set when our research contradicts the shipped catalog entry. Rendered
   *  verbatim so the discrepancy is visible rather than silently resolved. */
  correction?: string;
}

/** Mirrors the catalog's own categories, which are what the app groups by. */
export type ModelCategory = "sfx" | "music" | "voice" | "utility";

/** The things a family can do, from the capability table in docs/AUDIOCPP.md.
 *  Only what the catalog entry declares — the app offers nothing else. */
export type ModelCapability =
  | "generation"
  | "lyrics"
  | "separation"
  | "extend"
  | "cover"
  | "repaint"
  | "tts"
  | "voice-conversion";

export interface ModelSpecTable {
  vendor: string;
  /** audio.cpp's loader family (`audiocpp_cli --list-loaders`). What a model
   *  will accept is a property of the family, not of the file. */
  family: string;
  hfRepo: string;
  /** The catalog's `weights_glob`, flattened for display. A list means a
   *  package model — several components, not one GGUF. */
  weightsGlob: string[];
  maxDurationS: number;
  sampleRate: number;
  channels: 1 | 2;
  vramEstimateMb: number;
}

export interface ModelContent {
  /** URL slug: `/models/<slug>`. The catalog id minus its `audiocpp-`
   *  prefix — the prefix is an implementation detail of the adapter, and a
   *  URL should not carry it. */
  slug: string;
  /** The catalog id, which is what the CLI and API want. Shown on the page so
   *  a reader can copy it straight into `konchi pull`. */
  catalogId: string;
  name: string;
  vendor: string;
  category: ModelCategory;
  /** `"listed"` models appear in the app's picker by default; `"extra"` ones
   *  are catalogued but hidden until you opt in. See docs/AUDIOCPP.md. */
  tier: "listed" | "extra";
  /** Whether *we* have run this model end-to-end through this adapter. Not a
   *  quality claim and not a licence claim — see the page's own wording. */
  verified: boolean;
  capabilities: ModelCapability[];
  /** `<title>`, kept under ~60 chars. */
  metaTitle: string;
  /** `<meta name="description">`, kept under ~155 chars. */
  metaDescription: string;
  /** One-line pitch for list rows — under ~110 chars. */
  tagline: string;
  /** A paragraph on the real tradeoff: speed, footprint, licence, what it is
   *  actually for. Not marketing language. */
  distinctiveness: string;
  spec: ModelSpecTable;
  license: LicenseFinding;
  /** Approximate on-disk download, e.g. "~2 GB". `null` when we do not know —
   *  most extras have never been pulled here. */
  downloadSize: string | null;
  /** Gotchas worth knowing before you run it. Short and specific. */
  quirks: string[];
  /** Upstream project, HF repo, paper. Primary sources only, never invented;
   *  an entry with no findable upstream gets an empty list and the page says
   *  we could not find one. */
  sources: ModelLink[];
}
