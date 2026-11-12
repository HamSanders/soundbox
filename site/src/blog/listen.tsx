/**
 * Listening to a post: the card under the header, the mini player that docks
 * to the bottom once it is playing, and the paragraph highlight that follows
 * the voice.
 *
 * One `<audio>` element behind all of it. Not the app's `WaveformPlayer`: that
 * is an editing surface that decodes the whole file to draw it, and a nine
 * minute narration is 4 MB a reader may never play. The scrubber here draws
 * from peaks computed when the recording was made, so it is on the page
 * before a byte of audio is, and `preload="none"` stays honest.
 */

import { Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { assetUrl } from "@/lib/asset-url";
import { cn } from "@/lib/utils";

import { blockAt, blogReadableBlocks, clock, spokenTime, type Narration } from "./narration";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const SKIP_S = 15;
const RATE_KEY = "konchi.blog.rate";
/** How long after a reader scrolls on their own before the page follows the
 *  voice again. Long enough to read a paragraph they scrolled back to. */
const FOLLOW_PAUSE_MS = 6000;

function readRate(): number {
  try {
    const v = Number(localStorage.getItem(RATE_KEY));
    return (SPEEDS as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function PostListen({
  narration,
  title,
  contentRef,
}: {
  narration: Narration;
  title: string;
  /** The rendered prose, whose paragraphs the highlight follows. */
  contentRef: RefObject<HTMLElement | null>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  /** The dock appears on first play and stays until closed. */
  const [docked, setDocked] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(narration.duration);
  const [rate, setRate] = useState(1);
  const blocksRef = useRef<HTMLElement[] | null>(null);
  const lastUserScroll = useRef(0);
  const src = assetUrl(narration.audio);

  useEffect(() => setRate(readRate()), []);

  /* ------------------------------------------------------------ transport */

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = rate;
    setDocked(true);
    void audio.play().catch(() => setPlaying(false));
  }, [rate]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) play();
    else audio.pause();
  }, [play]);

  const seek = useCallback(
    (to: number, { start = false } = {}) => {
      const audio = audioRef.current;
      if (!audio) return;
      const clamped = Math.min(Math.max(0, to), duration - 0.05);
      audio.currentTime = clamped;
      setTime(clamped);
      if (start && audio.paused) play();
    },
    [duration, play],
  );

  const skip = useCallback((by: number) => seek((audioRef.current?.currentTime ?? 0) + by), [seek]);

  const changeRate = useCallback(() => {
    setRate((r) => {
      const next = SPEEDS[(SPEEDS.indexOf(r as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]!;
      if (audioRef.current) audioRef.current.playbackRate = next;
      try {
        localStorage.setItem(RATE_KEY, String(next));
      } catch {
        // A private window: the speed lasts as long as the page, which is fine.
      }
      return next;
    });
  }, []);

  const close = useCallback(() => {
    audioRef.current?.pause();
    setDocked(false);
  }, []);

  // `timeupdate` fires four times a second, which is a jerky scrubber. A frame
  // loop while playing, and the event alone while paused.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (audioRef.current) setTime(audioRef.current.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  /* ------------------------------------------------------------ paragraphs */

  // Number the readable blocks once the prose is in the DOM. A count that
  // disagrees with the recording means the post changed after it was read:
  // say so, and highlight nothing rather than the wrong paragraph.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const blocks = blogReadableBlocks(root);
    if (blocks.length !== narration.blocks.length) {
      console.warn(
        `[narration] the page has ${blocks.length} readable blocks and the recording has ` +
          `${narration.blocks.length}; re-run scripts/blog-narration.mjs for this post.`,
      );
      blocksRef.current = null;
      return;
    }
    blocks.forEach((el, i) => el.setAttribute("data-narration-block", String(i)));
    blocksRef.current = blocks;
    return () => {
      blocks.forEach((el) => {
        el.removeAttribute("data-narration-block");
        el.removeAttribute("data-narration-active");
      });
      blocksRef.current = null;
    };
  }, [contentRef, narration.blocks.length]);

  // Click a paragraph to hear it — only once the reader has started
  // listening, so selecting text on a page nobody is playing stays inert.
  useEffect(() => {
    const root = contentRef.current;
    if (!root || !docked) return;
    root.setAttribute("data-narration-on", "");
    const onClick = (e: MouseEvent) => {
      if (!blocksRef.current) return;
      const target = e.target as HTMLElement;
      if (target.closest("a, button, video, img, input, summary")) return;
      if (window.getSelection()?.toString()) return;
      const block = target.closest<HTMLElement>("[data-narration-block]");
      if (!block) return;
      seek(narration.blocks[Number(block.dataset.narrationBlock)]!, { start: true });
    };
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("click", onClick);
      root.removeAttribute("data-narration-on");
    };
  }, [contentRef, docked, narration.blocks, seek]);

  const active = docked ? blockAt(narration.blocks, time) : -1;

  // Light the paragraph being read, and keep it on screen unless the reader
  // has scrolled away on purpose in the last few seconds.
  useEffect(() => {
    const blocks = blocksRef.current;
    if (!blocks) return;
    const el = active >= 0 ? blocks[active] : null;
    blocks.forEach((b) => b.toggleAttribute("data-narration-active", b === el));
    if (!el || !playing || Date.now() - lastUserScroll.current < FOLLOW_PAUSE_MS) return;
    const rect = el.getBoundingClientRect();
    const dock = document.querySelector<HTMLElement>("[data-narration-dock]")?.offsetHeight ?? 0;
    if (rect.top < 72 || rect.bottom > window.innerHeight - dock - 16) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    }
  }, [active, playing]);

  useEffect(() => {
    const mark = () => (lastUserScroll.current = Date.now());
    const onKey = (e: KeyboardEvent) => {
      if (/^(PageUp|PageDown|Home|End|ArrowUp|ArrowDown)$/.test(e.key)) mark();
    };
    window.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("touchmove", mark, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", mark);
      window.removeEventListener("touchmove", mark);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  /* ------------------------------------------------------------- keyboard */

  // Space and the arrows work anywhere on the page while the dock is up,
  // except where they already mean something: a text field, or a control
  // that handles its own (the scrubber, a focused button's Space).
  useEffect(() => {
    if (!docked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      const target = e.target as HTMLElement;
      if (target.closest?.("[role=slider]")) return;
      if (e.key === " " && !target.closest?.("button, a, summary, video")) {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        skip(-SKIP_S);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        skip(SKIP_S);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [docked, toggle, skip]);

  /* -------------------------------------------------------- media session */

  // Lock-screen and headset controls, which is how a lot of people listen to
  // anything longer than a minute.
  useEffect(() => {
    if (!docked || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title, artist: `Read by ${narration.narrator}`, album: "Konchi blog" });
    ms.setActionHandler("play", play);
    ms.setActionHandler("pause", () => audioRef.current?.pause());
    ms.setActionHandler("seekbackward", () => skip(-SKIP_S));
    ms.setActionHandler("seekforward", () => skip(SKIP_S));
    ms.setActionHandler("seekto", (d) => d.seekTime !== undefined && seek(d.seekTime));
    return () => {
      for (const action of ["play", "pause", "seekbackward", "seekforward", "seekto"] as const) {
        ms.setActionHandler(action, null);
      }
    };
  }, [docked, title, narration.narrator, play, skip, seek]);

  // Room at the bottom of the page for the dock, so it never sits on top of
  // the last paragraph or the footer links.
  useEffect(() => {
    if (!docked) return;
    const dock = document.querySelector<HTMLElement>("[data-narration-dock]");
    if (!dock) return;
    const prev = document.body.style.paddingBottom;
    const fit = () => (document.body.style.paddingBottom = `${dock.offsetHeight}px`);
    const observer = new ResizeObserver(fit);
    observer.observe(dock);
    fit();
    return () => {
      observer.disconnect();
      document.body.style.paddingBottom = prev;
    };
  }, [docked]);

  /* --------------------------------------------------------------- render */

  const progress = duration > 0 ? Math.min(1, time / duration) : 0;
  const minutes = Math.max(1, Math.round(narration.duration / 60));

  return (
    <>
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => !playing && setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
      />

      <section
        aria-label="Listen to this post"
        className="border-border/70 bg-card mb-8 rounded-2xl border p-4 sm:p-5"
      >
        <div className="flex items-center gap-4">
          <Button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause the narration" : time > 0 ? "Resume the narration" : "Play the narration"}
            className="size-14 shrink-0 rounded-full [&_svg:not([class*='size-'])]:size-6"
          >
            {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="translate-x-px" />}
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
              Listen · {minutes} min
            </p>
            <p className="mt-1 leading-snug font-medium">
              Read by {narration.narrator}
              <span className="text-muted-foreground font-normal"> · {clock(narration.duration)}</span>
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              {narration.voice}, generated by Konchi on the machine that wrote it.
            </p>
          </div>
        </div>
        <Scrubber
          className="mt-4 h-9"
          peaks={narration.peaks}
          progress={progress}
          time={time}
          duration={duration}
          onSeek={(t) => seek(t, { start: true })}
          onSkip={skip}
          label="Narration position"
        />
        <noscript>
          <a href={src} className="text-primary text-sm underline-offset-4 hover:underline">
            Download the recording (MP3)
          </a>
        </noscript>
      </section>

      {docked && (
        <div
          data-narration-dock
          role="region"
          aria-label="Narration player"
          className="border-border bg-background/92 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] backdrop-blur-md"
        >
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5 sm:flex-nowrap sm:gap-x-3">
            {/* Scrubber row: full width on a phone, the middle of one row above it. */}
            <div className="order-1 flex w-full min-w-0 items-center gap-2 sm:order-2 sm:w-auto sm:flex-1">
              <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums" aria-hidden>
                {clock(time)}
              </span>
              <Scrubber
                className="h-8 min-w-0 flex-1"
                peaks={narration.peaks}
                progress={progress}
                time={time}
                duration={duration}
                onSeek={(t) => seek(t)}
                onSkip={skip}
                label="Seek"
              />
              <span className="text-muted-foreground w-10 shrink-0 text-xs tabular-nums" aria-hidden>
                {clock(duration)}
              </span>
            </div>

            <div className="order-2 flex items-center gap-1 sm:order-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => skip(-SKIP_S)}
                aria-label={`Back ${SKIP_S} seconds`}
                className="relative"
              >
                <RotateCcw />
                <SkipLabel />
              </Button>
              <Button
                type="button"
                size="icon-lg"
                onClick={toggle}
                aria-label={playing ? "Pause" : "Play"}
                className="rounded-full"
              >
                {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="translate-x-px" />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => skip(SKIP_S)}
                aria-label={`Forward ${SKIP_S} seconds`}
                className="relative"
              >
                <RotateCw />
                <SkipLabel />
              </Button>
            </div>

            <p className="text-muted-foreground order-3 hidden max-w-48 min-w-0 truncate text-xs lg:block">
              <span className="text-foreground font-medium">{narration.narrator}</span> · {title}
            </p>

            <div className="order-4 ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={changeRate}
                aria-label={`Playback speed ${rate} times. Change speed`}
                className="w-14 tabular-nums"
              >
                {rate}×
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={close} aria-label="Close the player">
                <X />
              </Button>
            </div>
          </div>
          {/* Announces what the controls change, once, rather than every frame. */}
          <p className="sr-only" aria-live="polite">
            {playing ? "Playing" : "Paused"}, {rate} times speed
          </p>
        </div>
      )}
    </>
  );
}

function SkipLabel() {
  return (
    <span aria-hidden className="absolute inset-0 grid place-items-center pt-px text-[8px] leading-none font-semibold">
      {SKIP_S}
    </span>
  );
}

/**
 * The waveform, which is also the seek bar.
 *
 * A real slider for assistive tech and the keyboard: arrows step five
 * seconds, Page Up/Down fifteen, Home and End the ends.
 */
function Scrubber({
  peaks,
  progress,
  time,
  duration,
  onSeek,
  onSkip,
  label,
  className,
}: {
  peaks: number[];
  progress: number;
  time: number;
  duration: number;
  onSeek: (t: number) => void;
  onSkip: (by: number) => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const at = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const bars = peaks.length;
  const w = bars * 3;

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${spokenTime(time)} of ${spokenTime(duration)}`}
      className={cn(
        "group/scrub focus-visible:ring-ring/50 relative cursor-pointer touch-none rounded-md outline-none select-none focus-visible:ring-2",
        className,
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onSeek(at(e.clientX) * duration);
      }}
      onPointerMove={(e) => {
        const p = at(e.clientX);
        setHover(p);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(p * duration);
      }}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => {
        const step = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -15, PageUp: 15 }[
          e.key
        ];
        if (step !== undefined) onSkip(step);
        else if (e.key === "Home") onSeek(0);
        else if (e.key === "End") onSeek(duration);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Bars peaks={peaks} width={w} className="fill-muted-foreground/30" />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }}>
        <Bars peaks={peaks} width={w} className="fill-primary" />
      </div>
      {hover !== null && (
        <div
          aria-hidden
          className="bg-foreground/40 pointer-events-none absolute inset-y-0 w-px"
          style={{ left: `${hover * 100}%` }}
        />
      )}
      <div
        aria-hidden
        className="bg-primary pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full opacity-0 transition-opacity group-hover/scrub:opacity-100 group-focus-visible/scrub:opacity-100"
        style={{ left: `${progress * 100}%` }}
      />
    </div>
  );
}

function Bars({ peaks, width, className }: { peaks: number[]; width: number; className: string }) {
  return (
    <svg
      viewBox={`0 0 ${width} 40`}
      preserveAspectRatio="none"
      className={cn("absolute inset-0 size-full", className)}
      aria-hidden
    >
      {peaks.map((p, i) => {
        // A floor so silence still reads as part of the track, and a square
        // root so quiet speech is not drawn as nothing next to a loud word.
        const h = Math.max(3, Math.sqrt(p) * 38);
        return <rect key={i} x={i * 3} y={(40 - h) / 2} width={2} height={h} rx={1} />;
      })}
    </svg>
  );
}
