/**
 * `/sfx` — the hub every category page links back to.
 *
 * This started as a skeleton whose only job was proving that every category is
 * reachable from one crawlable page. At a couple of dozen collections a flat
 * list of links did that fine. It does not any more: the taxonomy now covers
 * the material, vehicle and trailer-design families as well as the original
 * game and film ones, and a wall of several dozen links is a page you scroll
 * past rather than a page you use.
 *
 * So the hub now has to do two jobs that pull in opposite directions. For a
 * crawler it must render every collection as a real link in the markup, with
 * no interaction required. For a person it must let them find one collection
 * out of many in a couple of seconds. The filter below resolves that by being
 * client-side and additive: the full list is in the HTML, and typing only
 * hides rows that are already there.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketingLink } from "@/components/marketing-link";
import { SeoHead } from "@/components/seo-head";
import { GENERATOR_HREF, WELCOME_HREF } from "@/lib/marketing-links";
import {
  GROUP_ORDER,
  SFX_CATEGORIES,
  groupOf,
  type SfxGroup,
} from "@/content/sfx/categories";
import { coverThumb, isPublished, type SfxCategory } from "@/content/sfx/types";
import { assetUrl } from "@/lib/asset-url";

/**
 * What a row is matched against when someone types.
 *
 * Deliberately wider than the visible title: people search for the sound, not
 * for our name for the family that contains it. Someone after a door slam
 * should find the door collection by typing "slam", which means the sample
 * titles and prompts have to be searchable even though they are not rendered
 * here. It is a few hundred kilobytes of strings already in the bundle, so the
 * index costs nothing beyond the concatenation.
 */
function haystack(category: SfxCategory): string {
  const samples = category.content?.samples ?? [];
  return [
    category.name,
    category.slug,
    category.targetQuery,
    groupOf(category.slug),
    ...samples.map((s) => s.title),
    ...samples.map((s) => s.prompt),
  ]
    .join(" ")
    .toLowerCase();
}

function sampleCount(category: SfxCategory): number {
  return category.content?.samples.length ?? 0;
}

// Counted, not written down, so the title cannot drift from the catalogue.
const PUBLISHED = SFX_CATEGORIES.filter(isPublished);
const TOTAL_SAMPLES = PUBLISHED.reduce((n, c) => n + sampleCount(c), 0);

function CategoryRow({ category }: { category: SfxCategory }) {
  const count = sampleCount(category);
  return (
    <li>
      <Link
        to={`/sfx/${category.slug}`}
        className="hover:border-primary/50 hover:bg-muted/40 border-border/60 group flex items-center gap-3 rounded-xl border p-2 transition-colors"
      >
        {category.coverImage ? (
          <img
            src={assetUrl(coverThumb(category.coverImage))}
            alt=""
            width={96}
            height={96}
            className="size-12 shrink-0 rounded-lg object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div
            className="bg-muted text-muted-foreground/70 flex size-12 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
            aria-hidden="true"
          >
            {category.name.slice(0, 2)}
          </div>
        )}
        <span className="min-w-0 flex-1">
          <span className="group-hover:text-primary block text-sm font-medium underline-offset-4 group-hover:underline">
            {category.name}
          </span>
          <span className="text-muted-foreground block truncate text-xs">
            {count} sample{count === 1 ? "" : "s"}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function SfxHubPage() {
  const [query, setQuery] = useState("");

  // Indexed once. The taxonomy is a module constant, so there is nothing here
  // that can change between renders — recomputing the haystack on every
  // keystroke would be pure waste.
  const indexed = useMemo(
    () =>
      SFX_CATEGORIES.filter(isPublished).map((category) => ({
        category,
        text: haystack(category),
      })),
    [],
  );

  // Unwritten categories are listed but never linked, exactly as before: a link
  // to an empty template is the thin page this whole approach exists to avoid.
  // The taxonomy happens to be fully written right now, so this renders
  // nothing — it stays because the next backlog entry should not silently
  // vanish from the hub.
  const planned = useMemo(() => SFX_CATEGORIES.filter((c) => !isPublished(c)), []);

  const totalSamples = useMemo(
    () => indexed.reduce((n, { category }) => n + sampleCount(category), 0),
    [indexed],
  );

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? indexed.filter((row) => row.text.includes(needle)) : indexed),
    [indexed, needle],
  );

  const byGroup = useMemo(() => {
    const map = new Map<SfxGroup, SfxCategory[]>();
    for (const { category } of matches) {
      const group = groupOf(category.slug);
      map.set(group, [...(map.get(group) ?? []), category]);
    }
    return map;
  }, [matches]);

  return (
    <div className="bg-background text-foreground min-h-svh">
      <SeoHead
        title={`AI sound effects generated locally: ${TOTAL_SAMPLES} samples with prompts | Konchi`}
        description={`${TOTAL_SAMPLES} sound effects across ${PUBLISHED.length} categories, each with the exact prompt that made it. Download the MP3 or generate your own on your machine, with no account.`}
        path="/sfx"
      />


      <div className="mx-auto w-full max-w-3xl px-4">
        <header className="py-12">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Sound effect collections
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed">
            Each collection is a guide to one family of sounds: the prompts that produce
            it, the samples those prompts made, and what goes wrong. Generation runs
            locally on open-weight models, with no account and no per-sound cost.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild>
              <MarketingLink href={GENERATOR_HREF}>Download Konchi</MarketingLink>
            </Button>
            <Button variant="outline" asChild>
              <MarketingLink href={WELCOME_HREF}>What Konchi is</MarketingLink>
            </Button>
          </div>

          <div className="relative mt-8">
            <SearchIcon
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search collections and samples, e.g. “slam”, “riser”, “rain”"
              aria-label="Search sound effect collections"
              className="pr-9 pl-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1"
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>

          <p className="text-muted-foreground mt-3 text-xs" aria-live="polite">
            {needle
              ? `${matches.length} of ${indexed.length} collections match “${query.trim()}”.`
              : `${indexed.length} collections, ${totalSamples} samples, all generated locally.`}
          </p>
        </header>

        {matches.length === 0 && (
          <p className="border-border/60 text-muted-foreground border-t py-12 text-sm">
            Nothing matches. Collections cover families of sounds, so try a broader word,
            or{" "}
            <MarketingLink href={GENERATOR_HREF} className="text-foreground underline">
              generate it directly
            </MarketingLink>
            .
          </p>
        )}

        {GROUP_ORDER.map((group) => {
          const items = byGroup.get(group) ?? [];
          if (items.length === 0) return null;
          return (
            <section
              key={group}
              aria-labelledby={`group-${group}`}
              className="border-border/60 border-t py-8"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2
                  id={`group-${group}`}
                  className="font-heading text-lg font-semibold tracking-tight"
                >
                  {group}
                </h2>
                <span className="text-muted-foreground text-xs">
                  {items.length} collection{items.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {items.map((c) => (
                  <CategoryRow key={c.slug} category={c} />
                ))}
                {!needle &&
                  planned
                    .filter((c) => groupOf(c.slug) === group)
                    .map((c) => (
                      <li
                        key={c.slug}
                        className="text-muted-foreground/60 flex items-center px-2 text-sm"
                      >
                        {c.name}
                        <span className="ml-1.5 text-xs">(planned)</span>
                      </li>
                    ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
