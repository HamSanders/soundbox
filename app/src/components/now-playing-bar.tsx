/**
 * The app's bottom player, laid out like a music app's: the sound on the
 * left, transport and a timeline in the middle, close on the right. It sits
 * on the shell's ground under the floating panels (see `App.tsx`).
 *
 * It drives a plain `<audio>` element rather than a WaveSurfer instance. The
 * dock is one thin line, not a waveform, and owning the element directly is
 * what makes scrubbing seamless: the drag writes `currentTime` on every
 * pointer move while playback carries on, and the bar is redrawn each frame
 * from the element, not from the 4 Hz `timeupdate`.
 *
 * Opened by a Library row's title or tile (`sound-card.tsx`). The shared
 * `playingId` keeps it and any inline waveform from both being audible:
 * claiming playback here pauses them, and another player claiming it pauses
 * this one.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SoundTileArt } from "@/components/sound-card";
import { formatDuration } from "@/lib/format";
import { usePlayerStore } from "@/lib/player-store";
import { applySink, useOutputStore } from "@/lib/audio-output";
import { cn } from "@/lib/utils";

/** m:ss for the dock's clock, which needs a steady width while it counts. */
function clock(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function NowPlayingBar() {
  const sound = usePlayerStore((s) => s.sound);
  const setSound = usePlayerStore((s) => s.setSound);
  const queue = usePlayerStore((s) => s.queue);
  const playingId = usePlayerStore((s) => s.playingId);
  const claim = usePlayerStore((s) => s.play);
  const release = usePlayerStore((s) => s.stop);
  const sinkId = useOutputStore((s) => s.sinkId);
  const setPosition = usePlayerStore((s) => s.setPosition);
  const seekRequest = usePlayerStore((s) => s.seekRequest);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const dragging = useRef(false);

  const index = sound ? queue.findIndex((s) => s.id === sound.id) : -1;
  const prev = index > 0 ? queue[index - 1] : null;
  const next = index >= 0 && index < queue.length - 1 ? queue[index + 1] : null;

  const open = useCallback(
    (s: typeof sound) => {
      if (!s) return;
      claim(s.id);
      setSound(s);
    },
    [claim, setSound],
  );

  // A new sound: load it and start. The element is kept across sounds.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !sound) return;
    setTime(0);
    setDuration(sound.duration_s || 0);
    a.src = sound.file;
    claim(sound.id);
    void applySink(a, sinkId).then(() => a.play().catch(() => setPlaying(false)));
    // sinkId is applied by its own effect below; it must not reload the sound.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sound?.id]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) void applySink(a, sinkId);
  }, [sinkId]);

  // A row's waveform asked to play from a point: jump there and play. Runs
  // after the load effect above, so a new sound is already on the element;
  // before its metadata arrives, the jump waits for it.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !sound || !seekRequest || seekRequest.id !== sound.id) return;
    const go = () => {
      a.currentTime = seekRequest.t;
      setTime(seekRequest.t);
      setPosition(seekRequest.t);
      claim(sound.id);
      void a.play().catch(() => setPlaying(false));
    };
    if (a.readyState >= 1) go();
    else a.addEventListener("loadedmetadata", go, { once: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new request is the trigger
  }, [seekRequest]);

  // Another player took over: pause, keep the position.
  useEffect(() => {
    if (sound && playingId !== sound.id) audioRef.current?.pause();
  }, [playingId, sound]);

  // Redraw the clock and bar every frame while playing, so the bar moves
  // smoothly instead of in timeupdate's quarter-second steps.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a && !dragging.current) {
        setTime(a.currentTime);
        setPosition(a.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a || !sound) return;
    if (a.paused) {
      claim(sound.id);
      void a.play().catch(() => setPlaying(false));
    } else a.pause();
  };

  /* ------------------------------------------------------------ scrubbing */
  const seekFromPointer = (el: HTMLElement, clientX: number) => {
    const a = audioRef.current;
    if (!el || !a || !duration) return;
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
    setTime(t);
    // Written live: playback carries on from wherever the pointer is.
    a.currentTime = t;
    setPosition(t);
  };

  if (!sound) return null;
  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;
  const scrubber = (cls: string) => (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${clock(time)} of ${clock(duration)}`}
      className={cn("group/scrub focus-visible:ring-ring/50 flex cursor-pointer touch-none items-center rounded outline-none focus-visible:ring-2", cls)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        seekFromPointer(e.currentTarget, e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) seekFromPointer(e.currentTarget, e.clientX);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onKeyDown={(e) => {
        const a = audioRef.current;
        if (!a) return;
        const step = e.shiftKey ? 15 : 5;
        if (e.key === "ArrowRight") a.currentTime = Math.min(duration, a.currentTime + step);
        else if (e.key === "ArrowLeft") a.currentTime = Math.max(0, a.currentTime - step);
        else if (e.key === "Home") a.currentTime = 0;
        else return;
        e.preventDefault();
        setTime(a.currentTime);
      }}
    >
      <span className="bg-border relative h-1 w-full overflow-hidden rounded-full group-hover/scrub:h-1.5">
        <span className="bg-foreground absolute inset-y-0 left-0" style={{ width: `${pct}%` }} />
      </span>
      {/* The playhead: the beak, the one yellow on screen. */}
      <span
        aria-hidden="true"
        className={cn(
          "bg-signal absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform",
          "scale-75 group-hover/scrub:scale-100",
        )}
        style={{ left: `${pct}%` }}
      />
    </div>
  );

  return (
    <div
      role="region"
      aria-label="Now playing"
      className="bg-sidebar fixed inset-x-0 bottom-0 z-40 grid h-(--dock-h,80px) grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]"
    >
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || sound.duration_s || 0)}
        onEnded={() => {
          setPlaying(false);
          release(sound.id);
          if (next) open(next);
        }}
      />

      {/* Narrow windows have no room for the centre column; the timeline runs
          along the dock's top edge instead, with a taller hit area than it
          looks. */}
      {scrubber("absolute inset-x-0 -top-2 h-4 md:hidden")}

      {/* The sound */}
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="bg-muted text-foreground/55 ring-border flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-sm ring-1 ring-inset"
        >
          <SoundTileArt sound={sound} />
        </span>
        <div className="min-w-0">
          <p className="font-display truncate text-base leading-tight font-bold tracking-[0.01em] uppercase">
            {sound.name}
          </p>
          <p className="readout text-muted-foreground truncate">
            {sound.seed != null ? `No. ${sound.seed} · ` : ""}
            {formatDuration(sound.duration_s)}
          </p>
        </div>
      </div>

      {/* Transport and timeline */}
      <div className="flex min-w-0 flex-col items-center gap-1.5 max-md:order-last max-md:hidden">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Previous" disabled={!prev} onClick={() => open(prev)}>
            <SkipBackIcon />
          </Button>
          <Button
            size="icon"
            className="relative rounded-full"
            aria-label={playing ? "Pause" : "Play"}
            onClick={toggle}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
            {playing && (
              <span aria-hidden="true" className="bg-signal ring-sidebar absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2" />
            )}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next" disabled={!next} onClick={() => open(next)}>
            <SkipForwardIcon />
          </Button>
        </div>
        <div className="flex w-full items-center gap-2">
          <span className="readout text-muted-foreground w-10 text-right tabular-nums">{clock(time)}</span>
          {scrubber("relative h-4 flex-1")}
          <span className="readout text-muted-foreground w-10 tabular-nums">{clock(duration)}</span>
        </div>
      </div>

      {/* Close; on narrow windows the play button lives here instead. */}
      <div className="flex items-center justify-end gap-1">
        <Button size="icon-sm" className="rounded-full md:hidden" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close player"
          onClick={() => {
            audioRef.current?.pause();
            release(sound.id);
            setSound(null);
          }}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  );
}
