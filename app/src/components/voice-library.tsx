/**
 * The Voice Lab's cast: every voice as a square tile, drawn like the Library's
 * shelf tiles (the name's tint, the name in the title face, a log line under
 * it), or as a dense table in the same grid as the Library's track rows. The
 * page holds a switch between the two and remembers it in this browser.
 *
 * Drawn in the Mirli guide: ink and paper, names in the display face, the
 * model as a log line, the kind as a worded outlined pill. The one yellow
 * `signal` marks the voice whose details are open, the same way a track row
 * marks what is playing.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LayoutGridIcon, ListIcon, PauseIcon, PlayIcon } from "@/lib/icons";

import { Badge } from "@/components/ui/badge";
import { ProjectThumb } from "@/components/project-thumb";
import { VoiceAvatar } from "@/components/voice-avatar";
import type { VoiceView } from "@/lib/voice-lab-prefs";
import { cn } from "@/lib/utils";
import type { Voice } from "@/lib/api";

/* ------------------------------------------------------------- kind tabs */

export interface VoiceKindTab {
  value: string;
  label: string;
  count: number;
}

/** All / Cloned / Built-in as underlined tabs, the way the Library splits
 *  All / Music / SFX / Speech. */
export function VoiceKindTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: VoiceKindTab[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div role="tablist" aria-label="Kind" className="border-border flex gap-5 border-b">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "focus-visible:ring-ring/50 -mb-px inline-flex items-baseline gap-1.5 border-b-2 pb-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2",
            value === t.value
              ? "border-foreground text-foreground"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          {t.label}
          <span className="readout opacity-60 tabular-nums">{t.count}</span>
        </button>
      ))}
    </div>
  );
}

/** Grid or list, as two icon buttons in one pill. */
export function VoiceViewSwitch({
  value,
  onChange,
}: {
  value: VoiceView;
  onChange: (v: VoiceView) => void;
}) {
  const option = (v: VoiceView, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-pressed={value === v}
      aria-label={label}
      title={label}
      onClick={() => onChange(v)}
      className={cn(
        "focus-visible:ring-ring/50 flex h-7 w-8 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 [&_svg]:size-3.5",
        value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
    </button>
  );
  return (
    <div role="group" aria-label="View" className="border-border flex h-8 items-center rounded-full border p-0.5">
      {option("grid", "Cast grid", <LayoutGridIcon />)}
      {option("list", "List", <ListIcon />)}
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

/* ------------------------------------------------------------------- grid */

/** One voice as a square tile: its picture or its name's tint, the kind in
 *  the corner, the name set on the tile, a play button for a clone's clip,
 *  and the model and notes underneath. The tile itself opens the details. */
export function VoiceTile({
  voice,
  modelName,
  selected,
  onOpen,
  menu,
}: {
  voice: Voice;
  modelName: string | null;
  selected: boolean;
  onOpen: () => void;
  menu: ReactNode;
}) {
  const ref = useReferencePlay(voice);
  const art = Boolean(voice.artwork);
  return (
    <div data-voice-row className="grid min-w-0 gap-1.5">
      <div
        className={cn(
          "relative aspect-square overflow-hidden rounded-md ring-1 ring-inset transition-shadow duration-(--duration-fast)",
          selected ? "ring-signal ring-2" : "ring-border hover:ring-border-strong",
        )}
      >
        {art ? (
          <VoiceAvatar voice={voice} className="size-full rounded-none" />
        ) : (
          <ProjectThumb name={voice.name} className="size-full [&>span]:hidden" />
        )}
        {/* A picture needs the dusk scrim under the name to stay legible. */}
        {art && <span aria-hidden="true" className="from-dusk/80 absolute inset-0 bg-gradient-to-t to-transparent to-60%" />}
        {/* The whole tile opens the details; the controls on it sit above. */}
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Details for ${voice.name}`}
          className="focus-visible:ring-ring/50 absolute inset-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-inset"
        />
        <span className={cn("pointer-events-none absolute top-2 left-2 rounded-md", art && "bg-background/85")}>
          <KindPill voice={voice} />
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "font-display pointer-events-none absolute bottom-2 left-2.5 line-clamp-2 text-xl leading-none font-extrabold tracking-[0.01em] text-balance uppercase",
            ref ? "right-14" : "right-2.5",
            art && "text-white",
          )}
        >
          {voice.name}
        </span>
        {ref && (
          <button
            type="button"
            onClick={ref.toggle}
            aria-label={`${ref.playing ? "Pause" : "Play"} ${voice.name}'s reference clip`}
            className={cn(
              "focus-visible:ring-ring/50 absolute right-2 bottom-2 flex size-10 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-3 [&_svg]:size-4 [&_svg]:fill-current",
              ref.playing ? "bg-primary text-primary-foreground" : "bg-background/80 text-foreground hover:bg-background",
            )}
          >
            {ref.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
        )}
      </div>
      <div className="flex min-w-0 items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="readout truncate" title={voice.model_id ?? undefined}>
            {modelName ?? voice.model_id ?? "any model"}
          </p>
          <p className="text-muted-foreground truncate text-xs" title={voice.notes ?? undefined}>
            {voice.notes || (voice.kind === "builtin" ? voice.voice_id : null) || readsLabel(voice)}
          </p>
        </div>
        {menu}
      </div>
    </div>
  );
}

/** The tiles: two across on a phone, as many as fit from there up. */
export function VoiceGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4 @lg:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
      {children}
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
      <AvatarButton voice={voice} onOpen={onOpen} className="z-10 size-10 rounded-sm" />
      <div className="min-w-0">
        {/* Stretched over the row, so the whole row is one target rather than
            the name's 20px line; the avatar and the actions sit above it. */}
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Details for ${voice.name}`}
          className="focus-visible:ring-ring/50 block max-w-full truncate rounded text-left font-display text-base leading-tight font-bold tracking-[0.01em] uppercase outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
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
      <div className="relative z-10 flex items-center justify-end">{actions}</div>
    </div>
  );
}
