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
 * A sample rendered on more than one model (`compare`) gets a switch under
 * its prompt; the row then plays, downloads and labels whichever take is
 * selected. A "By model" filter appears when a page uses more than one model.
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
import { sampleTakes } from "@/content/sfx/types";
import type { SampleTakeRef, SfxSample } from "@/content/sfx/types";
import { formatBytes, formatDuration } from "@/lib/format";
import { sampleAudioUrl } from "@/lib/sfx-sample";
import { cn } from "@/lib/utils";

export function sampleId(categorySlug: string, sampleSlug: string): string {
  return `sfx-${categorySlug}-${sampleSlug}`;
}

/** Length and file size, when the build has them. */
export function sampleFact(categorySlug: string, sampleSlug: string): [number, number] | undefined {
  return sampleFacts[categorySlug]?.[sampleSlug];
}

/** A few-word label for the take switch, which sits in the narrow title
 *  column; the full name goes in its tooltip and the Model column. */
function shortModelName(model: string): string {
  return modelName(model)
    .replace(/^Stable Audio 3\.0 (Small )?/, "SA3 ")
    .replace(/^ACE-Step 1\.5 /, "ACE-Step ")
    .replace(/ Turbo$/, "");
}

export function modelName(model: string | undefined): string {
  return getModelByCatalogId(model)?.name ?? model ?? "Placeholder";
}

export function sampleModelName(sample: SfxSample): string {
  return sample.source === "placeholder" ? "Placeholder" : modelName(sample.model);
}

/** Every model a set of samples was rendered on, comparison takes included,
 *  in first-seen order. */
export function samplesModels(samples: SfxSample[]): string[] {
  return [...new Set(samples.flatMap((s) => sampleTakes(s).map((t) => t.model)))];
}

/** The dock's queue for a category, in page order: each sample, then its
 *  takes on other models, so next/previous walk a comparison in turn. */
export function sampleQueue(categorySlug: string, samples: SfxSample[]): SiteTrack[] {
  return samples.flatMap((s) =>
    sampleTakes(s).map((t) => ({
      id: sampleId(categorySlug, t.slug),
      title: s.title,
      sub: modelName(t.model),
      url: sampleAudioUrl(categorySlug, t.slug),
      href: `/sfx/${categorySlug}/${s.slug}`,
      tile: <WaveTile />,
      durationS: sampleFact(categorySlug, t.slug)?.[0],
    })),
  );
}

/** Segmented switch between a sample's takes, one button per model. */
function TakeSwitch({
  takes,
  selected,
  onSelect,
  title,
}: {
  takes: SampleTakeRef[];
  selected: SampleTakeRef;
  onSelect: (take: SampleTakeRef) => void;
  title: string;
}) {
  return (
    <div role="group" aria-label={`Hear ${title} on another model`} className="mt-1 flex flex-wrap gap-1">
      {takes.map((t) => {
        const on = t.slug === selected.slug;
        return (
          <button
            key={t.slug}
            type="button"
            aria-pressed={on}
            title={modelName(t.model)}
            onClick={() => onSelect(t)}
            className={cn(
              "label-caps h-5 rounded-sm px-1.5 whitespace-nowrap ring-1 ring-inset transition-colors outline-none focus-visible:ring-2",
              on
                ? "bg-foreground text-background ring-foreground"
                : "text-muted-foreground ring-border hover:text-foreground hover:ring-foreground/40",
            )}
          >
            {shortModelName(t.model)}
          </button>
        );
      })}
    </div>
  );
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
  preferModel,
}: {
  categorySlug: string;
  sample: SfxSample;
  index: number;
  audio: SiteAudio;
  showPrompt?: boolean;
  /** Show this model's take first, when the sample has one (the list's model filter). */
  preferModel?: string;
}) {
  const takes = sampleTakes(sample);
  const [picked, setPicked] = useState<string | null>(null);
  // Whatever the dock is playing wins, so next/previous through a comparison
  // moves the switch with it; then the reader's pick, then the filter's.
  const playingTake = takes.find((t) => audio.current?.id === sampleId(categorySlug, t.slug));
  const take =
    playingTake ??
    takes.find((t) => t.slug === picked) ??
    takes.find((t) => t.model === preferModel) ??
    takes[0];
  const id = sampleId(categorySlug, take.slug);
  const fact = sampleFact(categorySlug, take.slug);
  const model = getModelByCatalogId(take.model);
  const log = [
    sample.source === "placeholder" ? "placeholder" : null,
    fact ? `MP3 ${formatBytes(fact[1])}` : "MP3",
    model?.license.name,
  ]
    .filter(Boolean)
    .join(" · ");

  const select = (t: SampleTakeRef) => {
    setPicked(t.slug);
    // Switching while this row plays carries on with the other model, which
    // is the point of hearing them side by side.
    if (playingTake && audio.playing) audio.toggle(sampleId(categorySlug, t.slug));
  };

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
          {takes.length > 1 && <TakeSwitch takes={takes} selected={take} onSelect={select} title={sample.title} />}
        </>
      }
      license={model?.license.commercial}
      model={sample.source === "placeholder" ? "Placeholder" : modelName(take.model)}
      length={fact ? formatDuration(fact[0]) : "—"}
      isCurrent={audio.current?.id === id}
      playing={audio.playing}
      onPlay={() => audio.toggle(id)}
      actions={
        <>
          <CopyButton value={sample.prompt} label="Copy prompt" className="shrink-0" />
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={sampleAudioUrl(categorySlug, take.slug)} download aria-label={`Download ${sample.title}`}>
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
  const [model, setModel] = useState<string | null>(null);
  const models = useMemo(() => samplesModels(samples), [samples]);
  const compared = samples.filter((s) => (s.compare?.length ?? 0) > 0).length;
  // The search box appears when a list is long enough that scanning stops
  // beating searching, and stays out of the way otherwise.
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      samples
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => !needle || `${s.title} ${s.prompt}`.toLowerCase().includes(needle))
        .filter(({ s }) => !model || sampleTakes(s).some((t) => t.model === model)),
    [samples, needle, model],
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

      {models.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="label-caps text-muted-foreground mr-1">By model</span>
          {[null, ...models].map((m) => (
            <Button
              key={m ?? "all"}
              size="sm"
              variant={model === m ? "default" : "outline"}
              className="h-7 rounded-full px-3 text-xs"
              aria-pressed={model === m}
              onClick={() => setModel(m)}
            >
              {m ? modelName(m) : "All models"}
            </Button>
          ))}
          {compared > 0 && (
            <span className="text-muted-foreground basis-full text-xs">
              {compared === 1 ? "One prompt here is" : `${compared} prompts here are`} rendered on more than one
              model. Switch under the prompt to hear the same words on another model.
            </span>
          )}
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
          <SampleRow
            // Remount on a filter change so an earlier pick gives way to the
            // model just filtered by.
            key={`${s.slug}:${model ?? ""}`}
            categorySlug={categorySlug}
            sample={s}
            index={i}
            audio={audio}
            preferModel={model ?? undefined}
          />
        ))}
      </SiteTrackList>
    </>
  );
}
