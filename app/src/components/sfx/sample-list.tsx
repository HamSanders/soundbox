/// <reference path="../../sfx-sample-facts.d.ts" />
/**
 * The samples on a `/sfx/<category>` page, as the app's track rows: No., a
 * tile that plays the sample in the page's dock, the title in display caps,
 * a Courier log line, then licence, model and length.
 *
 * Lengths and sizes come from `virtual:sfx-sample-facts`, bundled at build
 * time, so they are in the prerendered HTML; nothing here needs the manifest
 * (peaks) the old per-row waveform fetched.
 *
 * Placeholder samples are labelled as placeholders, on the page, in the
 * markup. A category is not publishable while any of them remain — see
 * `SampleSource`.
 */

import { useMemo, useState } from "react";
import { DownloadIcon, FlaskConicalIcon, SearchIcon } from "lucide-react";
import sampleFacts from "virtual:sfx-sample-facts";

import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/docs-primitives";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SiteTrackList, SiteTrackRow, WaveTile } from "@/components/site/site-tracks";
import type { SiteAudio, SiteTrack } from "@/components/site/site-tracks";
import { getModelByCatalogId } from "@/content/models/models";
import type { SfxSample } from "@/content/sfx/types";
import { formatBytes, formatDuration } from "@/lib/format";
import { sampleAudioUrl } from "@/lib/sfx-sample";

export function sampleId(categorySlug: string, sampleSlug: string): string {
  return `sfx-${categorySlug}-${sampleSlug}`;
}

/** Length and file size, when the build has them. */
export function sampleFact(categorySlug: string, sampleSlug: string): [number, number] | undefined {
  return sampleFacts[categorySlug]?.[sampleSlug];
}

export function sampleModelName(sample: SfxSample): string {
  return getModelByCatalogId(sample.model)?.name ?? sample.model ?? "Placeholder";
}

/** The dock's queue for a category, in page order. */
export function sampleQueue(categorySlug: string, samples: SfxSample[]): SiteTrack[] {
  return samples.map((s) => ({
    id: sampleId(categorySlug, s.slug),
    title: s.title,
    sub: sampleModelName(s),
    url: sampleAudioUrl(categorySlug, s.slug),
    href: `/sfx/${categorySlug}/${s.slug}`,
    tile: <WaveTile />,
    durationS: sampleFact(categorySlug, s.slug)?.[0],
  }));
}

export function PlaceholderBadge({ note }: { note?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="label-caps text-muted-foreground ring-border inline-flex h-5 items-center gap-1 rounded-sm px-1.5 ring-1 ring-inset">
          <FlaskConicalIcon className="size-3" aria-hidden="true" />
          Placeholder
        </span>
      </TooltipTrigger>
      <TooltipContent>{note ?? "Not a model render."}</TooltipContent>
    </Tooltip>
  );
}

export function SampleRow({
  categorySlug,
  sample,
  index,
  audio,
  showPrompt = true,
}: {
  categorySlug: string;
  sample: SfxSample;
  index: number;
  audio: SiteAudio;
  showPrompt?: boolean;
}) {
  const id = sampleId(categorySlug, sample.slug);
  const fact = sampleFact(categorySlug, sample.slug);
  const model = getModelByCatalogId(sample.model);
  const log = [
    sample.source === "placeholder" ? "placeholder" : null,
    fact ? `MP3 ${formatBytes(fact[1])}` : "MP3",
    model?.license.name,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <SiteTrackRow
      no={String(index + 1).padStart(2, "0")}
      tile={<WaveTile />}
      title={sample.title}
      href={`/sfx/${categorySlug}/${sample.slug}`}
      log={log}
      detail={
        <>
          {sample.source === "placeholder" && (
            <div className="mt-0.5">
              <PlaceholderBadge note={sample.placeholderNote} />
            </div>
          )}
          {showPrompt && (
            <p className="text-muted-foreground/80 line-clamp-2 font-mono text-[11px] leading-relaxed" title={sample.prompt}>
              {sample.prompt}
            </p>
          )}
        </>
      }
      license={model?.license.commercial}
      model={sampleModelName(sample)}
      length={fact ? formatDuration(fact[0]) : "—"}
      isCurrent={audio.current?.id === id}
      playing={audio.playing}
      onPlay={() => audio.toggle(id)}
      actions={
        <>
          <CopyButton value={sample.prompt} label="Copy prompt" className="shrink-0" />
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={sampleAudioUrl(categorySlug, sample.slug)} download aria-label={`Download ${sample.title}`}>
              <DownloadIcon />
            </a>
          </Button>
        </>
      }
    />
  );
}

export function SampleList({
  categorySlug,
  samples,
  audio,
}: {
  categorySlug: string;
  samples: SfxSample[];
  audio: SiteAudio;
}) {
  const [query, setQuery] = useState("");
  // The filter appears when a list is long enough that scanning stops
  // beating searching, and stays out of the way otherwise.
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      samples
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => !needle || `${s.title} ${s.prompt}`.toLowerCase().includes(needle)),
    [samples, needle],
  );

  return (
    <>
      {samples.length > 8 && (
        <div className="relative mb-4">
          <SearchIcon
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${samples.length} samples`}
            aria-label="Filter samples"
            className="pl-9"
          />
        </div>
      )}

      {shown.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No sample in this collection matches that. Every prompt on the page is a starting point — change a
          word and generate the one you actually need.
        </p>
      )}

      <SiteTrackList>
        {shown.map(({ s, i }) => (
          <SampleRow key={s.slug} categorySlug={categorySlug} sample={s} index={i} audio={audio} />
        ))}
      </SiteTrackList>
    </>
  );
}
