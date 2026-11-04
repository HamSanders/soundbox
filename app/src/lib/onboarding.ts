/**
 * First-run setup: what to recommend, and whether to ask at all.
 *
 * Kept out of the wizard's components on purpose. "Which model should we push
 * on someone who just installed this" is a policy question with four inputs —
 * what they want to make, whether they intend to sell it, what GPU they have,
 * and which models have actually been run by a human — and policy that lives
 * inside JSX is policy nobody can test. Everything here is pure: given the
 * same model list, health and answers, it returns the same picks.
 *
 * Two rules the ranking is built around, both borrowed from the Models page
 * rather than invented here:
 *
 * 1. **Licence is not a footnote.** A model you cannot ship is a different
 *    product from one you can. If someone says they are selling what they
 *    make, a `commercial: "no"` model is not a lesser option — it is not an
 *    option, and it is filtered out rather than ranked down.
 * 2. **Never recommend a model nobody here has run.** The catalog's
 *    `verified` flag exists because some rows' numbers were read off a
 *    sibling model. Those are fine to *choose*; they are not fine to be
 *    handed by default to someone on their first minute.
 */

import type { AudioCppCatalogEntry, HealthStatus, Model } from "@/lib/api";

/** What someone says they came here to make. Deliberately the same three
 *  values as `Model.category`'s generative flavours, so the answer is a
 *  filter rather than a lookup table that has to be maintained alongside the
 *  catalog. "utility" (stem separation) is not an intent: nobody installs
 *  Konchi to split a file they don't have yet. */
export type Intent = "sfx" | "music" | "voice";

export const INTENTS: readonly Intent[] = ["sfx", "music", "voice"];

/** Whether what they make has to be sellable. The whole reason to ask is to
 *  answer the licence question once, up front, instead of at every download. */
export type Usage = "personal" | "commercial";

export interface Recommendation {
  intent: Intent;
  /** The pick, pre-checked in the wizard. */
  model: Model;
  /** Everything else that qualified, best first — what the "Choose a
   *  different one" control offers. Never includes `model`. */
  alternatives: Model[];
  /** One line explaining the pick, in the user's terms, not the ranker's. */
  reason: string;
}

/** Below this, treat the machine as having no usable GPU budget and optimise
 *  for the smallest model instead of the best one that fits. */
const MIN_USEFUL_VRAM_MB = 2000;

/** Leave the model some headroom in VRAM — an estimate that exactly equals
 *  the card's total is an estimate that OOMs. */
const VRAM_HEADROOM = 0.9;

/**
 * The VRAM a recommendation may spend, or null when we cannot tell.
 *
 * Total rather than free: free VRAM is whatever the browser and desktop
 * happen to be holding right now, and a first-run recommendation should not
 * change because a game was open.
 */
export function vramBudgetMb(health: HealthStatus | undefined): number | null {
  const total = health?.vram_total_mb;
  if (typeof total !== "number" || total < MIN_USEFUL_VRAM_MB) return null;
  return Math.floor(total * VRAM_HEADROOM);
}

function isInstalled(model: Model): boolean {
  return model.status === "installed" || model.status === "loaded";
}

/**
 * Whether a model can be the *answer* to an intent.
 *
 * Separate from ranking because these are disqualifications, not preferences:
 * a separator or voice-converter cannot make anything from a
 * prompt, and a non-commercial licence is a wall for someone who told us they
 * are selling.
 */
function qualifies(model: Model, intent: Intent, usage: Usage): boolean {
  if (model.category !== intent) return false;
  if (usage === "commercial" && model.license.commercial === "no") return false;
  // Voice covers two tasks; the other two are prompt-to-audio only.
  if (intent === "voice") return model.task === "tts" || model.task === "vc";
  return model.task === "gen";
}

/**
 * How good a first model this is, higher is better.
 *
 * The weights are spread far enough apart that each tier decides on its own:
 * an already-downloaded model beats every fresh one, a licence that clears
 * the stated intent beats a VRAM fit, and VRAM decides only among models that
 * were otherwise equal. That ordering is the point — someone who said
 * "commercial" should never be handed a conditional licence because it ran
 * marginally better on their card.
 */
function score(
  model: Model,
  usage: Usage,
  budgetMb: number | null,
  verified: (id: string) => boolean,
  hfTokenSet: boolean,
): number {
  let points = 0;

  // Already on disk: nothing to download, nothing to wait for.
  if (isInstalled(model)) points += 10_000;

  // Licence. Only meaningful when they said they are selling — for personal
  // use every surviving licence is equally fine and this tier goes quiet, so
  // a permissive model does not crowd out a better-suited restricted one.
  if (usage === "commercial") {
    if (model.license.commercial === "yes") points += 2_000;
    else if (model.license.commercial === "conditional") points += 800;
  }

  // Confirmed on real hardware by a human here.
  if (verified(model.id)) points += 400;

  // A gated repo needs a Hugging Face token before a byte moves, which is a
  // dead end for someone who has not set one.
  if (model.gated && !hfTokenSet) points -= 600;

  const vram = model.vram_estimate_mb || 0;
  if (budgetMb === null) {
    // No usable GPU: smaller is the only thing that matters.
    points -= vram / 20;
  } else if (vram > budgetMb) {
    points -= 1_500;
  } else {
    // Among the models that fit, the bigger one is the better one — a proxy
    // for quality, and the reason this is not just "pick the smallest".
    points += (vram / budgetMb) * 200;
  }

  // A voice model that cannot speak without a reference clip is a poor first
  // one: there is no clip yet on a fresh install.
  if (model.requires_voice_reference) points -= 300;

  return points;
}

/** The one line under the pick. Says the thing that actually decided it,
 *  which is why it is derived here rather than written into the catalog. */
function reasonFor(
  model: Model,
  usage: Usage,
  budgetMb: number | null,
  gpuName: string | null | undefined,
): string {
  if (isInstalled(model)) return "Already on your machine — nothing to download.";
  if (usage === "commercial" && model.license.commercial === "yes") {
    return `${model.license.name} — you can sell what you make with it.`;
  }
  if (budgetMb === null) {
    return "The lightest option here, so it runs without a GPU.";
  }
  const gpu = gpuName ? `your ${gpuName}` : "your GPU";
  return `About ${Math.round(model.vram_estimate_mb / 1000)} GB of VRAM — comfortable on ${gpu}.`;
}

/**
 * One recommendation per intent, best first, with the runners-up attached.
 *
 * An intent with nothing that qualifies is dropped rather than filled with a
 * bad answer — the wizard says so where the row would have been, which is a
 * far better outcome than quietly recommending a model the person cannot use.
 */
export function recommendModels(
  models: Model[] | undefined,
  health: HealthStatus | undefined,
  intents: Intent[],
  usage: Usage,
  options: { catalog?: AudioCppCatalogEntry[]; hfTokenSet?: boolean } = {},
): Recommendation[] {
  if (!models?.length) return [];
  const budgetMb = vramBudgetMb(health);
  const hfTokenSet = options.hfTokenSet ?? false;

  // A model absent from the catalog is one the catalog does not describe (a
  // non-audio.cpp model, or an older server that does not serve the list at
  // all). Treating that as unverified would zero out the tier for everyone on
  // such a server, so an unknown id keeps its benefit of the doubt.
  const verifiedIds = options.catalog
    ? new Set(options.catalog.filter((e) => e.verified).map((e) => e.id))
    : null;
  const verified = (id: string) => (verifiedIds ? verifiedIds.has(id) : true);

  const out: Recommendation[] = [];
  for (const intent of INTENTS) {
    if (!intents.includes(intent)) continue;
    const ranked = models
      .filter((m) => qualifies(m, intent, usage))
      .map((m) => ({ model: m, points: score(m, usage, budgetMb, verified, hfTokenSet) }))
      .sort((a, b) => b.points - a.points || a.model.name.localeCompare(b.model.name))
      .map((r) => r.model);
    if (!ranked.length) continue;
    const [best, ...alternatives] = ranked;
    out.push({
      intent,
      model: best,
      alternatives,
      reason: reasonFor(best, usage, budgetMb, health?.gpu_name),
    });
  }
  return out;
}

/**
 * Whether first-run setup should open.
 *
 * Two conditions, and both are load-bearing:
 *
 * - `onboarded_at` unset. This is the flag, and it is server-side per profile
 *   rather than in localStorage so it survives a reinstall of the frontend
 *   and does not re-fire in a second browser.
 * - No generation model on disk. Without this, a profile created before the
 *   wizard existed — a full install, models and all — would be interrupted by
 *   a setup flow with nothing left to set up.
 *
 * Undefined queries return false: the wizard appearing a beat after the
 * dashboard has painted is worse than it appearing on the next navigation.
 */
export function shouldOnboard(
  settings: { onboarded_at: string | null } | undefined,
  models: Model[] | undefined,
): boolean {
  if (!settings || !models) return false;
  if (settings.onboarded_at) return false;
  return !models.some((m) => m.category !== "utility" && isInstalled(m));
}

/**
 * True when setup is behind us and there is still nothing to generate with —
 * what the dashboard's "no models yet" banner keys off.
 *
 * A model with a download in flight counts as handled. Without that, finishing
 * the wizard with three picks would drop you on a dashboard complaining that
 * you have no models, over the top of the three downloads it just started.
 */
export function needsModelsBanner(
  settings: { onboarded_at: string | null } | undefined,
  models: Model[] | undefined,
): boolean {
  if (!settings || !models) return false;
  if (!settings.onboarded_at) return false;
  return !models.some(
    (m) => m.category !== "utility" && (isInstalled(m) || Boolean(m.active_job_id)),
  );
}

export const INTENT_LABEL: Record<Intent, string> = {
  sfx: "Sound effects",
  music: "Music",
  voice: "Speech & voices",
};

export const INTENT_HINT: Record<Intent, string> = {
  sfx: "Foley, impacts, UI clicks, ambience",
  music: "Instrumental tracks, loops, songs with vocals",
  voice: "Narration, character lines, cloned voices",
};
