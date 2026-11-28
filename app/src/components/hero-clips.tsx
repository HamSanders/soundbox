/**
 * The cards around the homepage headline: six real renders, each one a play
 * button the size of a card, drawn as that file's own waveform.
 *
 * On a wide window they are scattered at three sizes around the copy, with
 * the corner ones running off the edge of the section. Below that they are
 * one row that scrolls sideways under the buttons, because a scatter needs
 * room either side of the headline that a tablet or a phone does not have.
 *
 * Playback is `useExamplePlayer`, the same player `SamplePlay` uses, so only
 * one sound is ever audible and no file is fetched before its first press.
 * The bars come from `content/example-peaks.ts`; the ones already played turn
 * beak-yellow, which is the playhead.
 */

import { PauseIcon, PlayIcon } from "lucide-react";

import { EXAMPLE_PEAKS } from "@/content/example-peaks";
import { type Example, type ExampleId } from "@/content/examples";
import { KIND_WORD, useExamplePlayer } from "@/lib/example-player";
import { cn } from "@/lib/utils";

/**
 * The scatter starts at `xl` (1280px): narrower than that and the cards would sit on
 * the headline, so they line up in a row instead. The breakpoint is written
 * out in every class below because Tailwind only finds whole class names.
 *
 * One slot per card, in the order the ids are passed. `place` is the slot's
 * corner and width inside the hero (which is 780px tall at this size);
 * `detail` says how much of the text a card that size has room for.
 */
const SLOTS: { place: string; detail: 0 | 1 | 2 }[] = [
  { place: "xl:top-11 xl:left-[22%] xl:w-[16.5%]", detail: 0 },
  { place: "xl:-top-2.5 xl:left-[71.5%] xl:w-[27%]", detail: 2 },
  { place: "xl:top-[286px] xl:left-[7%] xl:w-[17%]", detail: 0 },
  { place: "xl:top-[390px] xl:left-[76%] xl:w-[19%]", detail: 1 },
  { place: "xl:-bottom-2.5 xl:left-[9%] xl:w-[27%]", detail: 2 },
  { place: "xl:top-[640px] xl:left-[62%] xl:w-[16%]", detail: 0 },
];

/** The words under the title: what was read, the opening of the lyric sheet,
 *  or the prompt. */
function lineFor(example: Example): string | undefined {
  if (example.text) return `“${example.text}”`;
  if (example.lyrics) {
    const lines = example.lyrics
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^\[[a-z ]+\]$/i.test(l));
    return lines.slice(0, 2).join(" / ");
  }
  return example.prompt;
}

function Clip({ id, place, detail }: { id: ExampleId; place: string; detail: 0 | 1 | 2 }) {
  const { example, playing, progress, failed, toggle } = useExamplePlayer(id);
  const peaks = EXAMPLE_PEAKS[id] ?? [];
  const line = lineFor(example);
  const started = playing || progress > 0;
  const Icon = playing ? PauseIcon : PlayIcon;

  return (
    <li className={cn("w-64 shrink-0 snap-start xl:absolute", place)}>
      <button
        type="button"
        onClick={toggle}
        aria-label={`${playing ? "Pause" : "Play"}: ${example.title}`}
        aria-pressed={playing}
        title={example.prompt ?? example.text}
        className="group bg-card border-border hover:border-border-strong focus-visible:ring-ring flex aspect-video w-full cursor-pointer flex-col gap-2 rounded-2xl border p-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {failed ? (
          <span className="label-caps text-danger" role="status">
            The audio did not load.
          </span>
        ) : (
          <span className="label-caps text-muted-foreground">{KIND_WORD[example.kind]}</span>
        )}

        <span className="relative block min-h-0 flex-1">
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-0 flex items-center gap-0.5 transition-opacity group-hover:opacity-100",
              started ? "opacity-100" : "opacity-50",
            )}
          >
            {peaks.map((p, i) => (
              <span
                key={i}
                className={cn(
                  "min-w-0 flex-1 rounded-[1px]",
                  started && i / peaks.length < progress ? "bg-signal" : "bg-wave",
                )}
                // A floor, so a silent stretch still draws a dot.
                style={{ height: `${Math.max(6, p)}%` }}
              />
            ))}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-1/2 left-1/2 flex size-9 -translate-1/2 items-center justify-center rounded-lg border transition-colors",
              playing
                ? "bg-foreground text-background border-transparent"
                : "bg-background text-foreground border-input",
            )}
          >
            <Icon className={cn("size-4", !playing && "translate-x-px")} />
          </span>
        </span>

        <span className="truncate text-sm leading-tight font-semibold">{example.title}</span>
        {detail > 0 && line ? (
          <span
            className={cn(
              "readout text-muted-foreground hidden leading-snug",
              detail === 2 ? "xl:line-clamp-2" : "xl:line-clamp-1",
            )}
          >
            {line}
          </span>
        ) : null}
      </button>
    </li>
  );
}

export function HeroClips({ ids, className }: { ids: readonly ExampleId[]; className?: string }) {
  return (
    <ul
      aria-label="Sounds made with Mirli"
      className={cn(
        "flex snap-x gap-3 overflow-x-auto px-4 pb-10",
        "xl:absolute xl:inset-0 xl:block xl:overflow-visible xl:p-0",
        className,
      )}
    >
      {ids.slice(0, SLOTS.length).map((id, i) => (
        <Clip key={id} id={id} place={SLOTS[i].place} detail={SLOTS[i].detail} />
      ))}
    </ul>
  );
}
