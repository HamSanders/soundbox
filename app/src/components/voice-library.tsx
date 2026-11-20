/**
 * The Voice Lab's list, shaped after a music app's voice library: a row of
 * chips, a shelf of compact cards for the voices you use, then a dense table
 * of every voice in the same grid as the Library's track rows.
 *
 * Drawn in the Mirli guide: ink and paper, names in the display face, the
 * model and read count as a log line, the kind as a worded outlined pill. The
 * one yellow `signal` marks the voice whose details are open, the same way a
 * track row marks what is playing.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PauseIcon, PlayIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { VoiceAvatar } from "@/components/voice-avatar";
import { cn } from "@/lib/utils";
import type { Voice } from "@/lib/api";

/* ------------------------------------------------------------------ chips */

export interface VoiceChip {
  value: string;
  label: string;
  count: number;
}

/** All / Cloned / Built-in, then one chip per model family the voices use. */
export function VoiceChips({
  chips,
  value,
  onChange,
}: {
  chips: VoiceChip[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div role="group" aria-label="Filter voices" className="flex flex-wrap gap-1.5">
      {chips.map((c) => {
        const on = c.value === value;
        return (
          <button
            key={c.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(c.value)}
            className={cn(
              "focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-3",
              on
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {c.label}
            <span className={cn("tabular-nums", on ? "opacity-70" : "opacity-60")}>{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------- reference audio */

/** One reference clip playing at a time across the whole list. */
let current: HTMLAudioElement | null = null;

/** Play/pause a clone's reference clip from a card or row, without mounting a
 *  player per voice. Builtins have no clip, so they return null. */
function useReferencePlay(voice: Voice) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  if (voice.kind !== "clone" || !voice.reference_file) return null;
  const src = voice.reference_file;
  return {
    playing,
    toggle: () => {
      if (playing && audio.current) {
        audio.current.pause();
        return;
      }
      if (!audio.current) {
        const a = new Audio(src);
        a.onplay = () => setPlaying(true);
        a.onpause = a.onended = () => setPlaying(false);
        audio.current = a;
      }
      if (current && current !== audio.current) current.pause();
      current = audio.current;
      void audio.current.play().catch(() => setPlaying(false));
    },
  };
}

/** The avatar as a play button: a dimmed tile with a play glyph on hover. A
 *  builtin has no clip, so its avatar opens the details (where Try it is). */
function AvatarButton({
  voice,
  className,
  onOpen,
}: {
  voice: Voice;
  className: string;
  onOpen: () => void;
}) {
  const ref = useReferencePlay(voice);
  return (
    <button
      type="button"
      onClick={ref ? ref.toggle : onOpen}
      aria-label={ref ? `${ref.playing ? "Pause" : "Play"} ${voice.name}'s reference clip` : `Try ${voice.name}`}
      className={cn(
        "group/tile focus-visible:ring-ring/50 ring-border relative shrink-0 overflow-hidden ring-1 ring-inset outline-none focus-visible:ring-3",
        className,
      )}
    >
      <VoiceAvatar voice={voice} className="size-full rounded-none" />
      <span
        aria-hidden="true"
        className={cn(
          "bg-background/70 text-foreground absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-(--duration-fast) group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100",
          ref?.playing && "opacity-100",
        )}
      >
        {ref?.playing ? <PauseIcon className="size-4 fill-current" /> : <PlayIcon className="size-4 fill-current" />}
      </span>
    </button>
  );
}

function KindPill({ voice }: { voice: Voice }) {
  return (
    <Badge variant="outline" className="readout">
      {voice.kind === "clone" ? "Clone" : "Built-in"}
    </Badge>
  );
}

function readsLabel(voice: Voice): string {
  const n = voice.read_count ?? 0;
  return `${n} read${n === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ shelf */

/** A compact card for the "Your voices" shelf: avatar well, name in display
 *  caps, model and reads as a log line. */
export function VoiceShelfCard({
  voice,
  modelName,
  selected,
  onOpen,
}: {
  voice: Voice;
  modelName: string | null;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      data-voice-row
      className={cn(
        "bg-card ring-border relative flex min-w-0 items-center gap-3 rounded-md p-2 ring-1 transition-colors duration-(--duration-fast) hover:bg-muted/60",
        selected &&
          "bg-muted/60 before:bg-signal before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full",
      )}
    >
      <AvatarButton voice={voice} onOpen={onOpen} className="size-12 rounded-md" />
      <button
        type="button"
        onClick={onOpen}
        className="focus-visible:ring-ring/50 min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-3"
      >
        <span className="font-display block truncate text-base leading-tight font-bold tracking-[0.01em] uppercase">
          {voice.name}
        </span>
        <span className="readout text-muted-foreground block truncate">
          {[modelName ?? voice.model_id ?? "any model", readsLabel(voice)].join(" · ")}
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ table */

/** Column template shared by the header and every row. */
const ROW_GRID =
  "grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 @2xl:grid-cols-[2.5rem_minmax(0,1fr)_5.5rem_10rem_4rem_auto]";

export function VoiceTableHeader() {
  return (
    <div className={cn(ROW_GRID, "label-caps text-muted-foreground hidden border-b border-border px-2 pb-2 @2xl:grid")}>
      <span />
      <span>Voice</span>
      <span>Kind</span>
      <span>Model</span>
      <span className="text-right">Reads</span>
      <span className="w-[4.75rem]" />
    </div>
  );
}

/** One voice in the table: avatar (plays the clip), name + notes, kind pill,
 *  model, reads, then actions. Clicking the row opens its details. */
export function VoiceRow({
  voice,
  modelName,
  selected,
  onOpen,
  actions,
}: {
  voice: Voice;
  modelName: string | null;
  selected: boolean;
  onOpen: () => void;
  actions: ReactNode;
}) {
  const sub = voice.notes || (voice.kind === "builtin" ? voice.voice_id : null) || "No notes";
  return (
    <div
      data-voice-row
      onClick={(e) => {
        if ((e.target as Element).closest("button, a, [role=menu], [role=dialog]")) return;
        onOpen();
      }}
      className={cn(
        ROW_GRID,
        "relative cursor-pointer rounded-md px-2 py-1.5 transition-colors duration-(--duration-fast) hover:bg-muted/60",
        selected &&
          "bg-muted/60 before:bg-signal before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full",
      )}
    >
      <AvatarButton voice={voice} onOpen={onOpen} className="size-10 rounded-sm" />
      <div className="min-w-0">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Details for ${voice.name}`}
          className="focus-visible:ring-ring/50 block max-w-full truncate rounded text-left font-display text-base leading-tight font-bold tracking-[0.01em] uppercase outline-none focus-visible:ring-3"
        >
          {voice.name}
        </button>
        <p className="text-muted-foreground truncate text-xs" title={sub}>
          {sub}
          {/* On narrow screens the columns fold into this line. */}
          <span className="readout @2xl:hidden">
            {" · "}
            {voice.kind === "clone" ? "clone" : "built-in"} · {readsLabel(voice)}
          </span>
        </p>
      </div>
      <span className="hidden @2xl:block">
        <KindPill voice={voice} />
      </span>
      <span className="readout text-muted-foreground hidden truncate @2xl:block" title={voice.model_id ?? undefined}>
        {modelName ?? voice.model_id ?? "any model"}
      </span>
      <span className="readout text-muted-foreground hidden text-right tabular-nums @2xl:block">
        {voice.read_count ?? 0}
      </span>
      <div className="flex items-center justify-end">{actions}</div>
    </div>
  );
}
