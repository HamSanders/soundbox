/**
 * `/models` — every model Konchi can run, in one list.
 *
 * This page used to advertise "five open-weight sound effect models" from a
 * Python backend that no longer exists. The real catalog is 46 models across
 * sound effects, music, voice and separation, all driven by one native
 * binary. See the docstring in `content/models/models.ts` for the rebuild.
 *
 * Constraints worth knowing before editing:
 *
 * - **No backend, no QueryClientProvider.** This page is prerendered by
 *   vite-react-ssg into static HTML. A react-query hook (`useModels`,
 *   `useHealth`) does not degrade here, it throws at render. Everything on
 *   the page comes from the static content module.
 * - **No render-time clocks or randomness**, for the same reason: whatever
 *   the prerender produced has to match what hydration produces.
 * - Counts in the copy come from `MODEL_STATS`, derived from the array. A
 *   hand-written "46 models" would be stale by the next catalog commit.
 */

import { Button } from "@/components/ui/button";
import { MarketingLink } from "@/components/marketing-link";
import { SeoHead } from "@/components/seo-head";
import { ModelsEngineNote, ModelsLicenceNote } from "@/components/models-disclaimer";
import { CATEGORY_LABEL, ModelCategorySection } from "@/components/models-list";
import { GENERATOR_HREF, WELCOME_HREF } from "@/lib/marketing-links";
import { MODEL_CATEGORY_ORDER, MODEL_STATS, MODELS } from "@/content/models/models";

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-card/80 ring-border/60 rounded-xl px-4 py-3 ring-1">
      <div className="font-heading text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-muted-foreground mt-0.5 text-xs leading-snug">{label}</div>
    </div>
  );
}

export function ModelsHubPage() {
  return (
    <div className="bg-background text-foreground min-h-svh">
      <SeoHead
        title="Open-weight audio models: specs and licences | Konchi"
        description={`${MODEL_STATS.total} open-weight audio models for sound effects, music, speech and stem separation, run locally through audio.cpp with no Python. Licence findings for each, with sources.`}
        path="/models"
      />

      <div className="mx-auto w-full max-w-3xl px-4">
        <header className="py-12">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Every model Konchi can run
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed">
            Konchi does not train models. It runs {MODEL_STATS.total} open-weight models made
            by other people (sound effects, music, speech and stem separation) on your own
            machine through audio.cpp. This page records what a reading of each one's licence
            found, with a link to every source consulted.
          </p>

          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat value={MODEL_STATS.total} label="models in the catalog" />
            <Stat value={MODEL_STATS.listed} label="on by default; the rest are opt-in" />
            <Stat value={MODEL_STATS.nonCommercial} label="non-commercial: you may not sell what they make" />
            <Stat value={MODEL_STATS.unconfirmedLicence} label="with unconfirmed licences" />
          </dl>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild>
              <MarketingLink href={GENERATOR_HREF}>Install Konchi</MarketingLink>
            </Button>
            <Button variant="outline" asChild>
              <MarketingLink href={WELCOME_HREF}>What Konchi is</MarketingLink>
            </Button>
          </div>
        </header>

        <div className="space-y-4">
          <ModelsEngineNote />
          <ModelsLicenceNote />
        </div>

        {/* One section per category, in a fixed order. The utility section is
            last on purpose: separators are not generators, and someone
            scanning for "what can I make" should not hit them first. */}
        <div className="pb-16">
          {MODEL_CATEGORY_ORDER.map((category) => (
            <ModelCategorySection
              key={category}
              category={category}
              models={MODELS.filter((model) => model.category === category)}
            />
          ))}
        </div>

        <footer className="border-border/60 text-muted-foreground border-t py-8 text-sm leading-relaxed">
          <p>
            Categories: {MODEL_CATEGORY_ORDER.map((c) => CATEGORY_LABEL[c]).join(" · ")}. Every
            entry links to the model's own repository and licence. Check those primary sources
            before you rely on a summary here.
          </p>
        </footer>
      </div>
    </div>
  );
}
