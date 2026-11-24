/**
 * The app's music-app look, rebuilt for the static marketing pages.
 *
 * `/music` and `/sfx` are prerendered (vite-react-ssg) and have no backend, so
 * they cannot use `SoundCard`, `ShelfTile` or `NowPlayingBar`, which read the
 * library's query hooks and the global player store. These are the same
 * shapes with the data passed in: a track row on the same grid as
 * `SoundCard`'s `track` layout, a square shelf tile with the name set on it,
 * a collection header, and a dock whose timeline is one thin line with the
 * yellow playhead and scrubs live while it plays.
 *
 * Yellow (`signal`) appears only where sound is playing: the playing row's
 * edge line, the playhead and the dot on the play button.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AudioLinesIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { LicenseChip } from "@/components/license-badge";
import type { CommercialUse } from "@/content/models/types";
import { cn } from "@/lib/utils";

/** m:ss with a steady width, as the app's dock clock. */
export function clock(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ audio */

export interface SiteTrack {
  id: string;
  title: string;
  /** The readout line under the title in the dock. */
  sub: string;
  url: string;
  /** Square art, 40px and up. */
  tile: ReactNode;
  href?: string;
  /** Known length before the file loads, if any. */
  durationS?: number;
}

export interface SiteAudio {
  current: SiteTrack | undefined;
  playing: boolean;
  time: number;
  duration: number;
  toggle: (id: string) => void;
  step: (dir: 1 | -1) => void;
  seekTo: (seconds: number) => void;
  /** Set while a scrub is held, so the frame loop does not fight the pointer. */
  dragging: React.MutableRefObject<boolean>;
  element: ReactNode;
}

/**
 * One `<audio>` element for a page. Nothing is fetched until something plays;
 * the playhead is read every animation frame while playing (not from the
 * 4 Hz `timeupdate`), which is what lets the scrubber move smoothly.
 */
export function useSiteAudio(queue: SiteTrack[], initialId?: string): SiteAudio {
  const audioRef = useRef<HTMLAudioElement>(null);
  const loaded = useRef<string | null>(null);
  const dragging = useRef(false);
  const [currentId, setCurrentId] = useState(initialId);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [loadedDuration, setLoadedDuration] = useState(0);

  const current = queue.find((q) => q.id === currentId);
  const duration = loadedDuration || current?.durationS || 0;

  const play = useCallback(
    (id: string) => {
      const audio = audioRef.current;
      const item = queue.find((q) => q.id === id);
      if (!audio || !item) return;
      if (loaded.current !== id) {
        audio.src = item.url;
        loaded.current = id;
        setCurrentId(id);
        setTime(0);
        setLoadedDuration(0);
      }
      void audio.play().catch(() => setPlaying(false));
    },
    [queue],
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a && !dragging.current) setTime(a.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const step = (dir: 1 | -1) => {
    const i = queue.findIndex((q) => q.id === currentId);
    const next = queue[(i + dir + queue.length) % queue.length];
    if (next) play(next.id);
  };

  return {
    current,
    playing,
    time,
    duration,
    dragging,
    toggle: (id) => {
      const audio = audioRef.current;
      if (audio && loaded.current === id && !audio.paused) audio.pause();
      else play(id);
    },
    step,
    seekTo: (seconds) => {
      const audio = audioRef.current;
      if (!audio) return;
      // Seeking a track that has not been loaded yet loads it first.
      if (currentId && loaded.current !== currentId) {
        play(currentId);
      }
      const t = Math.max(0, Math.min(duration || audio.duration || 0, seconds));
      audio.currentTime = t;
      setTime(t);
    },
    element: (
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          if (!dragging.current) setTime(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => setLoadedDuration(e.currentTarget.duration || 0)}
        onEnded={() => {
          setPlaying(false);
          if (queue.length > 1) step(1);
        }}
      />
    ),
  };
}

/* --------------------------------------------------------------- scrubber */

/** The dock's timeline: a thin line, the played part in ink, the yellow
 *  playhead. Dragging writes the position on every move while playback
 *  carries on. */
export function SiteScrubber({ audio, className }: { audio: SiteAudio; className?: string }) {
  const { time, duration, seekTo, dragging } = audio;
  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;
  const fromPointer = (el: HTMLElement, clientX: number) => {
    if (!duration) return;
    const r = el.getBoundingClientRect();
    seekTo(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration);
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${clock(time)} of ${clock(duration)}`}
      className={cn(
        "group/scrub focus-visible:ring-ring/50 relative flex h-4 cursor-pointer touch-none items-center rounded outline-none focus-visible:ring-2",
        className,
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        fromPointer(e.currentTarget, e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) fromPointer(e.currentTarget, e.clientX);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onKeyDown={(e) => {
        const by = e.shiftKey ? 15 : 5;
        if (e.key === "ArrowRight") seekTo(time + by);
        else if (e.key === "ArrowLeft") seekTo(time - by);
        else if (e.key === "Home") seekTo(0);
        else return;
        e.preventDefault();
      }}
    >
      <span className="bg-border relative h-1 w-full overflow-hidden rounded-full group-hover/scrub:h-1.5">
        <span className="bg-foreground absolute inset-y-0 left-0" style={{ width: `${pct}%` }} />
      </span>
      <span
        aria-hidden="true"
        className="bg-signal absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 scale-75 rounded-full transition-transform group-hover/scrub:scale-100"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

/** Play/pause in ink, with the yellow dot while sound is playing. */
export function SitePlayButton({
  playing,
  onClick,
  label,
  size = "icon",
  className,
}: {
  playing: boolean;
  onClick: () => void;
  label: string;
  size?: "icon" | "icon-lg";
  className?: string;
}) {
  return (
    <Button
      size={size}
      className={cn("relative rounded-full", className)}
      aria-label={`${playing ? "Pause" : "Play"} ${label}`}
      onClick={onClick}
    >
      {playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
      {playing && (
        <span
          aria-hidden="true"
          className="bg-signal ring-background absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2"
        />
      )}
    </Button>
  );
}

/** Inline transport for a detail page: play, the clock and the timeline. */
export function SiteInlinePlayer({ audio, id, label }: { audio: SiteAudio; id: string; label: string }) {
  const isCurrent = audio.current?.id === id;
  return (
    <div className="bg-sidebar flex items-center gap-3 rounded-md px-3 py-2.5">
      <SitePlayButton playing={isCurrent && audio.playing} onClick={() => audio.toggle(id)} label={label} />
      <span className="readout text-muted-foreground w-9 text-right tabular-nums">{clock(isCurrent ? audio.time : 0)}</span>
      {isCurrent ? (
        <SiteScrubber audio={audio} className="min-w-0 flex-1" />
      ) : (
        <span className="bg-border h-1 min-w-0 flex-1 rounded-full" aria-hidden="true" />
      )}
      <span className="readout text-muted-foreground w-9 tabular-nums">{isCurrent ? clock(audio.duration) : "–:––"}</span>
    </div>
  );
}

/** The bottom dock, as the app's: the sound, transport and timeline, extras,
 *  on the ground under the panels rather than in a box of its own. Frosted,
 *  because here the page scrolls behind it. */
export function SiteDock({ audio, trailing }: { audio: SiteAudio; trailing?: ReactNode }) {
  const { current, playing } = audio;
  if (!current) return null;
  return (
    <div
      role="region"
      aria-label="Now playing"
      className="bg-sidebar/80 supports-[backdrop-filter]:bg-sidebar/60 fixed inset-x-0 bottom-0 z-40 grid h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 backdrop-blur-xl md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]"
    >
      {/* Narrow windows: the timeline runs along the dock's top edge. */}
      <SiteScrubber audio={audio} className="absolute inset-x-0 -top-2 md:hidden" />
      <div className="flex min-w-0 items-center gap-3">
        <span className="ring-border flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-sm ring-1 ring-inset">
          {current.tile}
        </span>
        <div className="min-w-0">
          {current.href ? (
            <Link
              to={current.href}
              className="font-display block truncate text-base leading-tight font-bold tracking-[0.01em] uppercase underline-offset-4 hover:underline"
            >
              {current.title}
            </Link>
          ) : (
            <p className="font-display truncate text-base leading-tight font-bold tracking-[0.01em] uppercase">
              {current.title}
            </p>
          )}
          <p className="readout text-muted-foreground truncate">{current.sub}</p>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2 md:flex-col md:gap-1">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Previous" className="max-md:hidden" onClick={() => audio.step(-1)}>
            <SkipBackIcon />
          </Button>
          <SitePlayButton playing={playing} onClick={() => audio.toggle(current.id)} label={current.title} />
          <Button variant="ghost" size="icon-sm" aria-label="Next" className="max-md:hidden" onClick={() => audio.step(1)}>
            <SkipForwardIcon />
          </Button>
        </div>
        <div className="hidden w-full items-center gap-2 md:flex">
          <span className="readout text-muted-foreground w-9 text-right tabular-nums">{clock(audio.time)}</span>
          <SiteScrubber audio={audio} className="min-w-0 flex-1" />
          <span className="readout text-muted-foreground w-9 tabular-nums">{clock(audio.duration)}</span>
        </div>
      </div>

      <div className="hidden min-w-0 items-center justify-end gap-1 md:flex">{trailing}</div>
    </div>
  );
}

/* ------------------------------------------------------------------- rows */

/** The plain tile a sample gets when it has no art of its own. */
export function WaveTile() {
  return (
    <span className="bg-muted text-foreground/55 flex size-full items-center justify-center">
      <AudioLinesIcon className="size-5" aria-hidden="true" />
    </span>
  );
}

/** Column heads for a list of `SiteTrackRow`s, on the same grid. */
export function SiteTrackList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("@container", className)}>
      <div className="label-caps text-muted-foreground border-border hidden grid-cols-[3.25rem_2.5rem_minmax(0,1fr)_8.5rem_9rem_3.5rem_4.5rem] gap-x-3 border-b px-2 pb-2 @2xl:grid">
        <span className="text-right">No.</span>
        <span />
        <span>Title</span>
        <span>Licence</span>
        <span>Model</span>
        <span className="text-right">Length</span>
        <span />
      </div>
      <ol className="mt-1">{children}</ol>
    </div>
  );
}

/**
 * One row, on `SoundCard`'s track grid: No., a 40px tile that shows play on
 * hover, the title in display caps over a Courier log line, then licence,
 * model and length on a wide container, and the row's own actions.
 */
export function SiteTrackRow({
  id,
  no,
  tile,
  title,
  href,
  log,
  detail,
  license,
  model,
  length,
  isCurrent,
  playing,
  onPlay,
  actions,
}: {
  id?: string;
  no: string;
  tile: ReactNode;
  title: string;
  href: string;
  log: string;
  /** A second readout line (a prompt), clamped. */
  detail?: ReactNode;
  license?: CommercialUse;
  model: string;
  length: string;
  isCurrent: boolean;
  playing: boolean;
  onPlay: () => void;
  actions?: ReactNode;
}) {
  const active = isCurrent && playing;
  return (
    <li
      id={id}
      className={cn(
        "relative grid scroll-mt-24 grid-cols-[2.25rem_2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60",
        "@2xl:grid-cols-[3.25rem_2.5rem_minmax(0,1fr)_8.5rem_9rem_3.5rem_4.5rem]",
        isCurrent && "bg-muted/60",
        active && "before:bg-signal before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full",
      )}
    >
      <span className="readout text-muted-foreground truncate text-right tabular-nums">{no}</span>
      <button
        type="button"
        onClick={onPlay}
        aria-label={`${active ? "Pause" : "Play"} ${title}`}
        className="group/tile focus-visible:ring-ring/50 ring-border relative flex size-10 items-center justify-center overflow-hidden rounded-sm ring-1 ring-inset outline-none focus-visible:ring-3"
      >
        {tile}
        <span
          aria-hidden="true"
          className={cn(
            "bg-background/70 text-foreground absolute inset-0 flex items-center justify-center transition-opacity group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100",
            isCurrent ? "opacity-100" : "opacity-0",
          )}
        >
          {active ? <PauseIcon className="size-4 fill-current" /> : <PlayIcon className="size-4 fill-current" />}
        </span>
      </button>
      <div className="min-w-0">
        <Link
          to={href}
          className="focus-visible:ring-ring/50 font-display block max-w-full truncate rounded text-base leading-tight font-bold tracking-[0.01em] uppercase underline-offset-4 outline-none hover:underline focus-visible:ring-3"
        >
          {title}
        </Link>
        <p className="readout text-muted-foreground truncate" title={log}>
          {log}
        </p>
        {detail}
      </div>
      <span className="hidden min-w-0 @2xl:block">
        {license && license !== "unknown" && <LicenseChip license={{ commercial: license, name: "" }} />}
      </span>
      <span className="readout text-muted-foreground hidden truncate @2xl:block" title={model}>
        {model}
      </span>
      <span className="readout text-muted-foreground hidden text-right tabular-nums @2xl:block">{length}</span>
      <div className="flex items-center justify-end">{actions}</div>
    </li>
  );
}

/* ------------------------------------------------------------------ rail */

export interface SiteRailLink {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
}

export interface SiteRailGroup {
  heading: string;
  links: SiteRailLink[];
}

/**
 * The left rail of the public /music and /sfx pages: grouped jump links, then
 * a "make your own" card pinned to the bottom. A panel of its own beside the
 * page, as the app's Create panel sits beside its page: sticky, above the
 * dock, and only from `lg` up; below that the page is one column and the
 * rail's links would only repeat the headings.
 *
 * Put it as the first child of `SiteRailLayout`, beside the page's `<main>`.
 */
export function SiteRail({ groups, cta }: { groups: SiteRailGroup[]; cta?: ReactNode }) {
  return (
    <nav
      aria-label="On this page"
      className="bg-background ring-border sticky top-2 hidden h-[calc(100svh-1rem-72px)] flex-col gap-7 overflow-y-auto rounded-xl px-3 py-5 ring-1 lg:flex"
    >
      {groups.map((group) => (
        <div key={group.heading}>
          <p className="label-caps text-muted-foreground px-3">{group.heading}</p>
          <ul className="mt-2">
            {group.links.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <a
                  href={href}
                  className="text-muted-foreground hover:text-foreground hover:bg-card focus-visible:ring-ring/50 flex items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-3"
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {cta && <div className="mt-auto">{cta}</div>}
    </nav>
  );
}

/** The "make your own" card at the foot of the rail. */
export function SiteRailCard({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="bg-card rounded-md p-4">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{body}</p>
      <div className="mt-3">{action}</div>
    </div>
  );
}

/**
 * Rail on the left, page on the right, from `lg` up; one column below. Two
 * panels on the ground with the app's 8px gap between them: put `SiteRail`
 * first and the page, in a `SitePanel`, second.
 */
export function SiteRailLayout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full items-start lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-2">{children}</div>
  );
}

/* ---------------------------------------------------------------- shelves */

/**
 * A row of tiles as a carousel: no scrollbar, tiles snap to the left edge, and
 * two arrow buttons page by the visible width. The arrows grey out at either
 * end and hide when everything already fits. Touch, trackpad and Shift+wheel
 * still scroll it directly; the arrows are for a mouse.
 */
export function SiteShelf({
  title,
  id,
  more,
  children,
}: {
  /** Omitted when the shelf sits under a section heading of its own. */
  title?: string;
  id?: string;
  more?: ReactNode;
  children: ReactNode;
}) {
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    // 2px of slack: snapping and subpixel widths stop a pixel short of the end.
    setEdges({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure, children]);

  const page = (dir: -1 | 1) => {
    const el = track.current;
    if (!el) return;
    // Land on a tile's left edge rather than trusting CSS snap, which smooth
    // scrolling skips in some browsers and leaves a half tile in view.
    // Forward: the first tile cut off on the right becomes the first in view.
    // Back: the first tile within one width to the left of here.
    const box = el.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    const tiles = [...el.children] as HTMLElement[];
    const starts = tiles.map((c) => c.getBoundingClientRect().left - box.left + el.scrollLeft - pad);
    const view = el.clientWidth - 2 * pad;
    const target =
      dir > 0
        ? starts.find((s, i) => s + tiles[i].offsetWidth > el.scrollLeft + view + 1)
        : starts.find((s) => s >= el.scrollLeft - view - 1);
    el.scrollTo({ left: Math.max(0, target ?? el.scrollLeft + dir * view), behavior: "smooth" });
  };

  const fits = edges.start && edges.end;
  const arrows = !fits && (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        className="rounded-full"
        onClick={() => page(-1)}
        disabled={edges.start}
        aria-label={title ? `Scroll ${title} back` : "Scroll back"}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        className="rounded-full"
        onClick={() => page(1)}
        disabled={edges.end}
        aria-label={title ? `Scroll ${title} forward` : "Scroll forward"}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );

  return (
    <section aria-labelledby={title ? id : undefined} className="grid min-w-0 gap-2">
      {(title || more || arrows) && (
        <div className="flex min-h-8 items-center justify-between gap-3">
          {title ? (
            <h2 id={id} className="label-caps text-muted-foreground">
              {title}
            </h2>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {more}
            {arrows}
          </div>
        </div>
      )}
      <ul
        ref={track}
        className="-mx-1 grid snap-x snap-mandatory scroll-px-1 auto-cols-[8.5rem] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>li]:snap-start"
      >
        {children}
      </ul>
    </section>
  );
}

/**
 * A square tile with its name set on it, as the app's `ShelfTile`. With art,
 * the name sits on a paper strip so it reads on any image; `overlay` takes a
 * play button.
 */
export function SiteShelfTile({
  name,
  sub,
  to,
  art,
  overlay,
}: {
  name: string;
  sub: string;
  to: string;
  art: ReactNode;
  overlay?: ReactNode;
}) {
  return (
    <li className="group/tile relative grid min-w-0 gap-1">
      <Link
        to={to}
        className="focus-visible:ring-ring/50 grid gap-1 rounded-md text-left outline-none focus-visible:ring-3"
      >
        <span className="ring-border group-hover/tile:ring-border-strong relative block aspect-square overflow-hidden rounded-md ring-1 ring-inset">
          {art}
          <span className="absolute inset-x-1.5 bottom-1.5">
            <span className="bg-background text-foreground font-display line-clamp-2 rounded-sm px-1.5 py-0.5 text-lg leading-none font-extrabold tracking-[0.01em] uppercase [box-decoration-break:clone]">
              {name}
            </span>
          </span>
        </span>
        <span className="readout text-muted-foreground truncate">{sub}</span>
      </Link>
      {overlay && <span className="absolute top-1.5 right-1.5">{overlay}</span>}
    </li>
  );
}

/* ------------------------------------------------------------- collection */

/** A collection's or a sound's head: tile, kicker, display-caps title, a log
 *  line and the actions (Play first). */
export function SiteCollectionHeader({
  tile,
  kicker,
  title,
  log,
  children,
  lede,
}: {
  tile: ReactNode;
  kicker: ReactNode;
  title: string;
  log: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 py-8 sm:flex-row sm:items-end">
      <span className="ring-border block size-32 shrink-0 overflow-hidden rounded-md ring-1 ring-inset sm:size-40">
        {tile}
      </span>
      <div className="grid min-w-0 gap-1.5">
        <span className="label-caps text-muted-foreground">{kicker}</span>
        <h1 className="font-display text-3xl leading-none font-extrabold tracking-[0.01em] text-balance uppercase sm:text-4xl">
          {title}
        </h1>
        <span className="readout text-muted-foreground">{log}</span>
        {lede && <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">{lede}</p>}
        {children && <div className="flex flex-wrap items-center gap-2 pt-1">{children}</div>}
      </div>
    </header>
  );
}

/** Facts as a log: label in caps, value in Courier, one per line. */
export function SiteFactLog({ facts }: { facts: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="border-border divide-border divide-y border-y">
      {facts.map((f) => (
        <div key={f.label} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 py-2">
          <dt className="label-caps text-muted-foreground pt-0.5">{f.label}</dt>
          <dd className="readout text-foreground min-w-0 break-words">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
