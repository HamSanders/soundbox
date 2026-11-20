/**
 * Player controls shared by the full-screen view and the mini player:
 * transport, the chapter scrubber, speed and the sleep timer.
 */

import { useEffect, useState } from "react";
import {
  BookmarkPlusIcon,
  Loader2Icon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { clock } from "@/lib/listen-api";
import {
  SLEEP_MINUTES,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_STEP,
  currentTime,
  paragraphAt,
  useAudioClock,
  useListenPlayer,
} from "@/lib/listen-player-store";
import { useBookmarkMutations } from "@/lib/listen-queries";
import { cn } from "@/lib/utils";

/** A back/forward skip with the seconds printed inside the arc, like most players. */
function SkipButton({ seconds, size = "md" }: { seconds: number; size?: "sm" | "md" }) {
  const skip = useListenPlayer((s) => s.skip);
  const back = seconds < 0;
  return (
    <Button
      variant="ghost"
      size={size === "sm" ? "icon-sm" : "icon-lg"}
      aria-label={`${back ? "Back" : "Forward"} ${Math.abs(seconds)} seconds`}
      onClick={() => skip(seconds)}
      className="relative"
    >
      <svg viewBox="0 0 24 24" className={size === "sm" ? "size-6" : "size-8"} aria-hidden="true">
        <path
          d={back ? "M4 12a8 8 0 1 0 2.5-5.8" : "M20 12a8 8 0 1 1-2.5-5.8"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path d={back ? "M6.5 2.5v4h4" : "M17.5 2.5v4h-4"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <text x="12" y="15.2" textAnchor="middle" fontSize="7.5" fontWeight="600" fill="currentColor">
          {Math.abs(seconds)}
        </text>
      </svg>
    </Button>
  );
}

export function PlayPauseButton({ size = "lg" }: { size?: "sm" | "lg" }) {
  const playing = useListenPlayer((s) => s.playing);
  const buffering = useListenPlayer((s) => s.buffering && s.playing);
  const toggle = useListenPlayer((s) => s.toggle);
  return (
    <Button
      size={size === "lg" ? "icon-lg" : "icon"}
      className={cn("rounded-full", size === "lg" && "size-14 [&_svg:not([class*='size-'])]:size-6")}
      aria-label={playing ? "Pause" : "Play"}
      onClick={toggle}
    >
      {buffering ? <Loader2Icon className="animate-spin" /> : playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
    </Button>
  );
}

export function Transport({ size = "md" }: { size?: "sm" | "md" }) {
  const prev = useListenPlayer((s) => s.prev);
  const next = useListenPlayer((s) => s.next);
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2">
      <Button variant="ghost" size={size === "sm" ? "icon-sm" : "icon-lg"} aria-label="Previous chapter" onClick={prev}>
        <SkipBackIcon />
      </Button>
      {size === "md" && <SkipButton seconds={-30} />}
      <SkipButton seconds={-15} size={size} />
      <PlayPauseButton size={size === "sm" ? "sm" : "lg"} />
      <SkipButton seconds={15} size={size} />
      {size === "md" && <SkipButton seconds={30} />}
      <Button variant="ghost" size={size === "sm" ? "icon-sm" : "icon-lg"} aria-label="Next chapter" onClick={next}>
        <SkipForwardIcon />
      </Button>
    </div>
  );
}

/** The chapter scrubber, drawn from the audio clock every frame while playing. */
export function Scrubber() {
  const duration = useListenPlayer((s) => s.duration);
  const speed = useListenPlayer((s) => s.speed);
  const seek = useListenPlayer((s) => s.seek);
  const [drag, setDrag] = useState<number | null>(null);
  const t = useAudioClock();
  const shown = drag ?? t;
  const left = Math.max(0, duration - shown);
  return (
    <div className="space-y-1.5">
      <Slider
        aria-label="Position in chapter"
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.1}
        value={[Math.min(shown, duration)]}
        onValueChange={([v]) => setDrag(v)}
        onValueCommit={([v]) => {
          seek(v);
          setDrag(null);
        }}
      />
      <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
        <span>{clock(shown)}</span>
        <span title="Time left in this chapter at the current speed">
          -{clock(left / speed)}
        </span>
      </div>
    </div>
  );
}

export function SpeedControl() {
  const speed = useListenPlayer((s) => s.speed);
  const setSpeed = useListenPlayer((s) => s.setSpeed);
  const presets = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="tabular-nums" aria-label={`Speed ${speed}x`}>
          {speed.toFixed(2).replace(/0$/, "")}x
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Speed</p>
          <p className="text-sm tabular-nums">{speed.toFixed(2)}x</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="icon-xs" variant="outline" aria-label="Slower" onClick={() => setSpeed(speed - SPEED_STEP)}>
            −
          </Button>
          <Slider
            aria-label="Playback speed"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={SPEED_STEP}
            value={[speed]}
            onValueChange={([v]) => setSpeed(v)}
          />
          <Button size="icon-xs" variant="outline" aria-label="Faster" onClick={() => setSpeed(speed + SPEED_STEP)}>
            +
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <Button key={p} size="xs" variant={Math.abs(p - speed) < 0.001 ? "default" : "outline"} onClick={() => setSpeed(p)}>
              {p}x
            </Button>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">Pitch is kept at every speed.</p>
      </PopoverContent>
    </Popover>
  );
}

/** Counts down in the button while a timer runs. */
function useSleepLabel(): string | null {
  const sleep = useListenPlayer((s) => s.sleep);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sleep?.kind !== "minutes") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sleep]);
  if (!sleep) return null;
  if (sleep.kind === "chapter") return "End of chapter";
  return clock(Math.max(0, (sleep.until - now) / 1000));
}

export function SleepTimer() {
  const sleep = useListenPlayer((s) => s.sleep);
  const setSleep = useListenPlayer((s) => s.setSleep);
  const label = useSleepLabel();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={sleep ? "secondary" : "ghost"} size="sm" aria-label="Sleep timer" className="tabular-nums">
          <MoonIcon />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Sleep timer</DropdownMenuLabel>
        {SLEEP_MINUTES.map((m) => (
          <DropdownMenuItem key={m} onSelect={() => setSleep(m)}>
            {m} minutes
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => setSleep("chapter")}>End of chapter</DropdownMenuItem>
        {sleep && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setSleep(null)}>Turn off</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AddBookmarkButton({ withLabel = false }: { withLabel?: boolean }) {
  const manifest = useListenPlayer((s) => s.manifest);
  const chapterIndex = useListenPlayer((s) => s.chapterIndex);
  const { add } = useBookmarkMutations(manifest?.book.id ?? "");
  if (!manifest) return null;
  const mark = () => {
    const chapter = manifest.chapters[chapterIndex];
    const t = currentTime();
    const p = paragraphAt(chapter, t);
    add.mutate({ chapter_id: chapter.id, position_s: t, segment_id: p >= 0 ? chapter.paragraphs[p].segment_id : null });
  };
  return (
    <Button variant="ghost" size={withLabel ? "sm" : "icon-sm"} aria-label="Add bookmark" onClick={mark} disabled={add.isPending}>
      <BookmarkPlusIcon />
      {withLabel && "Bookmark"}
    </Button>
  );
}
