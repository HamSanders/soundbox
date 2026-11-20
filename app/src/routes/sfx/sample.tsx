/// <reference path="../../sfx-sample-facts.d.ts" />
/**
 * `/sfx/:slug/:sample` — one sample's own indexable page.
 *
 * Extends the category page rather than replacing it: a search for one exact
 * sound ("heavy wooden door slam sound effect") should land somewhere that
 * plays it back in one glance, with the prompt that made it and a way to
 * make a variation, before it ever asks the reader to read a whole category
 * guide. Same content model as `category.tsx` — no new data source, just a
 * deeper URL into `content.samples`.
 */

import { Link, Navigate, useParams } from "react-router-dom";
import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/docs-primitives";
import { MarketingLink } from "@/components/marketing-link";
import { SeoHead, breadcrumbJsonLd } from "@/components/seo-head";
import { getCategory } from "@/content/sfx/categories";
import { COVER_SIZE, coverCard, isPublished } from "@/content/sfx/types";
import type { PublishedCategory, SfxSample } from "@/content/sfx/types";
import { getModelByCatalogId } from "@/content/models/models";
import { sampleAudioUrl } from "@/lib/sfx-sample";
import { PlaceholderBadge, SampleRow, sampleId, sampleQueue } from "@/components/sfx/sample-list";
import {
  SiteCollectionHeader,
  SiteFactLog,
  SiteInlinePlayer,
  SitePlayButton,
  SiteTrackList,
  WaveTile,
  useSiteAudio,
} from "@/components/site/site-tracks";
import { GENERATOR_HREF } from "@/lib/marketing-links";
import { assetUrl, pageUrl, siteUrl } from "@/lib/asset-url";
import sampleFacts from "virtual:sfx-sample-facts";

/** The prompt cut at a word boundary, for a meta description. */
function excerpt(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:]+$/, "")}…`;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * `AudioObject` for the clip. Only what the page can back: the file, its
 * length and size, the prompt it came from and the model that made it. No
 * licence: what a model's terms say about generated output is a separate
 * question from the weights (see the model page), and a structured-data
 * `license` would answer it more firmly than we can.
 */
function audioJsonLd(
  category: PublishedCategory,
  sample: SfxSample,
  facts: [number, number] | undefined,
  modelName: string | undefined,
): object {
  const page = pageUrl(`/sfx/${category.slug}/${sample.slug}`);
  const file = siteUrl(`/sfx/${category.slug}/${sample.slug}.mp3`);
  return {
    "@context": "https://schema.org",
    "@type": "AudioObject",
    name: `${sample.title} sound effect`,
    description: sample.prompt,
    encodingFormat: "audio/mpeg",
    isAccessibleForFree: true,
    ...(file ? { contentUrl: file } : {}),
    ...(page ? { url: page } : {}),
    ...(facts
      ? { duration: `PT${facts[0].toFixed(2)}S`, contentSize: formatSize(facts[1]) }
      : {}),
    ...(modelName ? { creditText: `Generated with ${modelName} in Mirli` } : {}),
  };
}

function SampleBody({
  category,
  sample,
}: {
  category: PublishedCategory;
  sample: SfxSample;
}) {
  const others = category.content.samples.filter((s) => s.slug !== sample.slug);
  const shownOthers = others.slice(0, 8);
  const id = sampleId(category.slug, sample.slug);
  // This sample first, then the ones listed under "More", so those play here too.
  const queue = sampleQueue(category.slug, [sample, ...shownOthers]);
  const audio = useSiteAudio(queue, id);
  const isPlaying = audio.current?.id === id && audio.playing;
  // Bundled at build time, so these are in the prerendered HTML too; `meta`
  // (with the waveform peaks) only arrives after the fetch.
  const facts = sampleFacts[category.slug]?.[sample.slug];
  const model = getModelByCatalogId(sample.model);
  // The write-up's name where there is one; the raw catalog id otherwise.
  const modelName = model?.name ?? sample.model;
  const modelLink = model ? (
    <Link
      to={`/models/${model.slug}`}
      className="text-foreground underline underline-offset-4 hover:no-underline"
    >
      {model.name}
    </Link>
  ) : (
    sample.model
  );

  return (
    <>
      <SeoHead
        title={`${sample.title} sound effect | Mirli`}
        description={`${sample.title} sound effect: "${excerpt(sample.prompt, 90)}"${modelName ? `. Generated with ${modelName}` : ""}. Download the MP3 or make a variation on your own machine.`}
        path={`/sfx/${category.slug}/${sample.slug}`}
        {...(category.coverImage
          ? {
              image: coverCard(category.coverImage),
              imageAlt: `Cover art for Mirli's ${category.name.toLowerCase()} sound effects`,
            }
          : {})}
        jsonLd={[
          audioJsonLd(category, sample, facts, modelName),
          breadcrumbJsonLd([
            { name: "Sound effects", path: "/sfx" },
            { name: category.name, path: `/sfx/${category.slug}` },
            { name: sample.title, path: `/sfx/${category.slug}/${sample.slug}` },
          ]),
        ]}
      />

      <nav aria-label="Breadcrumb" className="text-muted-foreground pt-8 text-sm">
        <Link to="/sfx" className="hover:text-foreground underline-offset-4 hover:underline">
          Sound effects
        </Link>
        <span aria-hidden="true"> / </span>
        <Link
          to={`/sfx/${category.slug}`}
          className="hover:text-foreground underline-offset-4 hover:underline"
        >
          {category.name}
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">{sample.title}</span>
      </nav>

      <SiteCollectionHeader
        tile={
          category.coverImage ? (
            <img
              src={assetUrl(category.coverImage)}
              alt=""
              width={COVER_SIZE.width}
              height={COVER_SIZE.height}
              fetchPriority="high"
              decoding="async"
              className="size-full object-cover"
            />
          ) : (
            <WaveTile />
          )
        }
        kicker={`Sound effect · ${category.name}`}
        title={sample.title}
        log={[
          facts ? `${facts[0].toFixed(1)} s` : null,
          facts ? `MP3 ${formatSize(facts[1])}` : null,
          modelName,
        ]
          .filter(Boolean)
          .join(" · ")}
        lede={
          <>
            A {category.name.toLowerCase()} sound effect
            {modelName ? <>, generated with {modelLink}</> : ""} from the prompt below. Copy the prompt,
            change a word and generate your own version.
          </>
        }
      >
        <SitePlayButton playing={isPlaying} onClick={() => audio.toggle(id)} label={sample.title} size="icon-lg" />
        <Button variant="outline" size="sm" asChild>
          <a href={sampleAudioUrl(category.slug, sample.slug)} download>
            <DownloadIcon />
            Download MP3
          </a>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <MarketingLink href={GENERATOR_HREF}>Generate a variation</MarketingLink>
        </Button>
        {sample.source === "placeholder" && <PlaceholderBadge note={sample.placeholderNote} />}
      </SiteCollectionHeader>

      <SiteInlinePlayer audio={audio} id={id} label={sample.title} />

      <div className="mt-8">
        <SiteFactLog
          facts={[
            ...(facts
              ? [
                  { label: "Length", value: `${facts[0].toFixed(1)} s` },
                  { label: "File", value: `MP3, ${formatSize(facts[1])}` },
                ]
              : []),
            ...(modelName ? [{ label: "Model", value: modelLink }] : []),
            ...(model ? [{ label: "Licence", value: model.license.name }] : []),
            { label: "Collection", value: <Link to={`/sfx/${category.slug}`} className="underline underline-offset-4 hover:no-underline">{category.name}</Link> },
          ]}
        />
      </div>

      <section aria-labelledby="prompt" className="border-border/60 mt-10 border-t py-10">
        <h2 id="prompt" className="font-display text-2xl leading-none font-extrabold uppercase">
          The prompt
        </h2>
        <div className="bg-muted/50 ring-border mt-4 min-w-0 overflow-hidden rounded-xl ring-1 ring-inset">
          <div className="flex items-start justify-between gap-2 px-3 py-3">
            <p className="min-w-0 font-mono text-xs leading-relaxed">{sample.prompt}</p>
            <CopyButton value={sample.prompt} label="Copy prompt" className="shrink-0" />
          </div>
        </div>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          Generated{modelName ? <> with {modelLink}</> : ""}. These models respond to
          material, action and space, so the most useful edit is usually swapping one concrete
          noun for another.
        </p>
      </section>

      {others.length > 0 && (
        <section aria-labelledby="more" className="border-border/60 border-t py-10">
          <h2 id="more" className="font-display text-2xl leading-none font-extrabold uppercase">
            More {category.name.toLowerCase()} sounds
          </h2>
          <SiteTrackList className="mt-4">
            {shownOthers.map((s, i) => (
              <SampleRow key={s.slug} categorySlug={category.slug} sample={s} index={i} audio={audio} showPrompt={false} />
            ))}
          </SiteTrackList>
          <Link
            to={`/sfx/${category.slug}`}
            className="text-muted-foreground hover:text-foreground mt-4 inline-block text-sm underline-offset-4 hover:underline"
          >
            See the whole {category.name.toLowerCase()} collection
          </Link>
        </section>
      )}
      {audio.element}
    </>
  );
}

export function SfxSamplePage() {
  const { slug, sample: sampleSlug } = useParams();
  const category = getCategory(slug);
  const sample =
    category && isPublished(category)
      ? category.content.samples.find((s) => s.slug === sampleSlug)
      : undefined;

  // No thin pages: an unknown category, an unpublished one, or a sample slug
  // that doesn't exist in it all fall back to the nearest real page instead
  // of rendering an empty template.
  if (!category || !isPublished(category)) {
    return <Navigate to="/sfx" replace />;
  }
  if (!sample) {
    return <Navigate to={`/sfx/${category.slug}`} replace />;
  }

  return (
    <div className="bg-background text-foreground min-h-svh">
      <div className="mx-auto w-full max-w-3xl px-4 pb-12">
        <SampleBody key={`${category.slug}/${sample.slug}`} category={category} sample={sample} />
      </div>
    </div>
  );
}
