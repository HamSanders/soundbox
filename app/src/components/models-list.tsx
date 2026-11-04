/**
 * The list view for `/models`.
 *
 * A grid of marketing cards worked when there were five models. The real
 * catalog has 46, across four categories and 30-odd loader families, and the
 * question a reader arrives with is comparative — *which of these may I use,
 * and for what* — so this is a dense scannable list rather than cards: one row
 * per model, licence status in a fixed column position, so the eye can run
 * down that column alone.
 *
 * Rows are `<Link>`s with real hrefs, not click handlers, because the site is
 * prerendered for crawlers (see `site/src/routes.tsx`).
 */

import { Link } from "react-router-dom";

import { ModelsLicenseChip } from "@/components/models-license";
import type { ModelCategory, ModelContent } from "@/content/models/types";
import { MODELS_HUB_HREF } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";

export const CATEGORY_LABEL: Record<ModelCategory, string> = {
  sfx: "Sound effects",
  music: "Music",
  voice: "Voice",
  utility: "Utility",
};

export const CATEGORY_BLURB: Record<ModelCategory, string> = {
  sfx: "Text-to-audio for foley, impacts, ambience — the thing Konchi was built for.",
  music: "Text-to-music, some of it lyrics-conditioned, some able to extend or re-render a clip you already have.",
  voice: "Text-to-speech and voice conversion. The licences here are the most restrictive in the catalog, and the consent questions are the sharpest.",
  utility: "Not generators. These take audio you already have and pull it apart into stems.",
};

/**
 * Two letters from the model's name, as the tile.
 *
 * Not a logo. See the note at the top of `models-disclaimer.tsx` for why we
 * do not put vendor marks on these pages. This is the same fallback tile
 * `routes/sfx/hub.tsx` uses for a category with no artwork.
 *
 * Purely derived from the name, so it is stable across the SSR/hydration
 * boundary — nothing random, nothing time-dependent.
 */
export function ModelMonogram({ name, className }: { name: string; className?: string }) {
  // Drop the "(audio.cpp)" suffix every catalog name carries: initialising it
  // would give half the catalog the same tile.
  const words = name
    .replace(/\s*\(audio\.cpp\)\s*/i, "")
    .split(/[\s—-]+/)
    .filter(Boolean);
  const initials =
    words.length >= 2
      ? `${words[0]![0]}${words[1]![0]}`
      : (words[0] ?? name).slice(0, 2);

  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground/70 flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold",
        className,
      )}
      aria-hidden="true"
    >
      {initials.toUpperCase()}
    </span>
  );
}

/** "Listed" vs "opt-in", and whether anyone here has actually run it. Both are
 *  claims about *us*, not about the model, and the tooltips say so. */
function StatusTags({ model }: { model: ModelContent }) {
  return (
    <>
      {model.tier === "extra" && (
        <span
          className="text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 text-[11px] font-medium"
          title="Catalogued but hidden until you switch it on in Settings."
        >
          Opt-in
        </span>
      )}
      {model.verified ? (
        <span
          className="text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 text-[11px] font-medium"
          title="Someone here has run this model end-to-end through Konchi. Not a quality or licence claim."
        >
          Run here
        </span>
      ) : (
        <span
          className="text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 text-[11px] font-medium"
          title="Catalogued from the model card and the loader, but never run end-to-end here."
        >
          Untested here
        </span>
      )}
    </>
  );
}

export function ModelRow({ model }: { model: ModelContent }) {
  return (
    <li>
      <Link
        to={`${MODELS_HUB_HREF}/${model.slug}`}
        className="border-border/60 hover:bg-card/80 hover:border-border focus-visible:ring-ring group flex gap-4 border-b p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <ModelMonogram name={model.name} />

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-heading group-hover:text-primary text-sm font-semibold tracking-tight underline-offset-4 group-hover:underline">
              {model.name}
            </span>
            <span className="text-muted-foreground text-xs">{model.vendor}</span>
          </span>

          <span className="text-muted-foreground mt-1 block text-sm leading-relaxed">
            {model.tagline}
          </span>

          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <ModelsLicenseChip license={model.license} short />
            <span className="text-muted-foreground text-xs">{model.license.name}</span>
            <StatusTags model={model} />
          </span>
        </span>
      </Link>
    </li>
  );
}

/** One section per category. The count is in the heading because "how many
 *  voice models are there" is a question people actually ask of this page. */
export function ModelCategorySection({
  category,
  models,
}: {
  category: ModelCategory;
  models: ModelContent[];
}) {
  if (models.length === 0) return null;
  return (
    <section aria-labelledby={`category-${category}`} className="pt-10">
      <h2
        id={`category-${category}`}
        className="font-heading text-xl font-semibold tracking-tight"
      >
        {CATEGORY_LABEL[category]}{" "}
        <span className="text-muted-foreground text-sm font-normal">({models.length})</span>
      </h2>
      <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
        {CATEGORY_BLURB[category]}
      </p>
      <ul className="border-border/60 mt-4 border-t">
        {models.map((model) => (
          <ModelRow key={model.slug} model={model} />
        ))}
      </ul>
    </section>
  );
}
