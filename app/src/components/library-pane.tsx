/**
 * The library, beside the timeline: search it, hear it, drag it onto a lane.
 *
 * This is the other half of the studio's left column. A story made from a
 * script needs the script there; a story made by splitting a track — every
 * clip's text empty, one stem per lane — needs somewhere to get more material
 * from, and until now that was a 320px search box inside a right-click
 * popover. So the pane became two tabs of one column rather than a new place
 * to look.
 *
 * It sits beside the lanes rather than in a drawer over them on purpose: the
 * gesture is dragging a sound onto a track at a moment in time, and a panel
 * that covers the thing you are aiming at is the wrong shape for that.
 *
 * Preview is a plain `<audio>` and claims the same global one-thing-plays
 * handle everything else does, so auditioning a sound here stops the story,
 * and pressing play on the story stops this.
 *
 * The row that is playing grows a `PeakScrubber`, so a take can be heard from
 * the middle. Only that row: twenty scrub strips in a shelf would be twenty
 * things competing with the drag gesture this pane exists for, and the one
 * you are listening to is the only one whose position means anything.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { GripVerticalIcon, PauseIcon, PlayIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PeakScrubber } from "@/components/peak-scrubber";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/format";
import { usePlayerStore } from "@/lib/player-store";
import { useModels, useSounds } from "@/lib/queries";
import { clearSoundDrag, setSoundDrag } from "@/lib/dnd";
import { cn } from "@/lib/utils";
import type { Sound } from "@/lib/api";

const LIBRARY_PLAYER_ID = "library-pane";

type Category = "all" | "sfx" | "music" | "voice";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sfx", label: "SFX" },
  { id: "music", label: "Music" },
  { id: "voice", label: "Speech" },
];

function Row({
  sound,
  playing,
  currentTime,
  onToggle,
  onSeek,
}: {
  sound: Sound;
  playing: boolean;
  /** Playhead within this sound, in seconds. Only meaningful while playing. */
  currentTime: number;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
}) {
  return (
    <div
      // Dragging is the pane's whole point, and a drag that starts on the
      // scrub strip would seek instead of drop. So the row stops being
      // draggable exactly while it is showing one.
      draggable={!playing}
      onDragStart={(e) =>
        setSoundDrag(e, { id: sound.id, name: sound.name, durationS: sound.duration_s })
      }
      onDragEnd={clearSoundDrag}
      className="border-border/60 hover:bg-accent/50 group/row flex cursor-grab items-center gap-1.5 rounded-lg border px-1.5 py-1 active:cursor-grabbing"
    >
      <GripVerticalIcon
        className="text-muted-foreground/40 group-hover/row:text-muted-foreground/80 size-3.5 shrink-0"
        aria-hidden="true"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 shrink-0"
        aria-label={playing ? `Stop ${sound.name}` : `Preview ${sound.name}`}
        onClick={onToggle}
      >
        {playing ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
      </Button>
      <Link
        to={`/sounds/${sound.id}`}
        className="min-w-0 flex-1 truncate text-xs hover:underline"
        title={sound.prompt || sound.name}
      >
        {sound.name}
      </Link>
      {playing && (
        <PeakScrubber
          peaks={sound.peaks}
          durationS={sound.duration_s}
          currentTime={currentTime}
          onSeek={onSeek}
          label={`Seek ${sound.name}`}
          className="h-5 w-24 shrink-0"
        />
      )}
      <span className="text-muted-foreground shrink-0 font-(family-name:--font-log) text-[10px] tabular-nums">
        {playing ? formatDuration(currentTime) : formatDuration(sound.duration_s)}
      </span>
    </div>
  );
}

export function LibraryPane({ className }: { className?: string }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const { data: models } = useModels();

  // Narrowing by model id rather than filtering the page client-side, for the
  // reason the Library pages give: filtering after the fact silently drops
  // matches once a category's sounds fall past the first page.
  const categoryModels = useMemo(
    () =>
      category === "all"
        ? undefined
        : (models ?? []).filter((m) => m.category === category).map((m) => m.id),
    [models, category],
  );

  const sounds = useSounds({
    limit: 60,
    q: q.trim() || undefined,
    ...(categoryModels ? { models: categoryModels } : {}),
  });
  const items = sounds.data?.items ?? [];

  /* ----------------------------------------------------------- preview */

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingId = usePlayerStore((s) => s.playingId);

  const stop = (): void => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPreviewId(null);
    usePlayerStore.getState().stop(LIBRARY_PLAYER_ID);
  };

  const toggle = (sound: Sound): void => {
    if (previewId === sound.id) {
      stop();
      return;
    }
    audioRef.current?.pause();
    usePlayerStore.getState().play(LIBRARY_PLAYER_ID);
    const el = new Audio(sound.file);
    el.addEventListener("ended", stop);
    // Drives the row's scrub strip. `timeupdate` is ~4Hz, which is fine for a
    // 24px strip and much cheaper than an animation frame per row.
    el.addEventListener("timeupdate", () => setPreviewTime(el.currentTime));
    void el.play();
    audioRef.current = el;
    setPreviewTime(0);
    setPreviewId(sound.id);
  };

  /** Move the playing preview, from its row's strip. */
  const seek = (seconds: number): void => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = seconds;
    setPreviewTime(seconds);
    // Clicking the strip on a preview that has ended (or been paused by
    // something else) should start it again from there, matching what a click
    // on any waveform in the app now does.
    if (el.paused) void el.play();
  };

  // Something else took the transport — the story, a clip, a stem group.
  useEffect(() => {
    if (playingId !== LIBRARY_PLAYER_ID && previewId !== null) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingId]);
  useEffect(() => stop, []);

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="relative shrink-0">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your library…"
          aria-label="Search your library"
          className="h-8 pl-8 text-xs"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {CATEGORIES.map((c) => (
          <Button
            key={c.id}
            variant={c.id === category ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-2 text-[11px]"
            aria-pressed={c.id === category}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
          </Button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {sounds.isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-lg" />)
        ) : items.length === 0 ? (
          <p className="text-muted-foreground px-1 py-3 text-xs leading-relaxed">
            {q ? "Nothing matches that." : "Nothing in this part of your library yet."}
          </p>
        ) : (
          items.map((sound) => (
            <Row
              key={sound.id}
              sound={sound}
              playing={previewId === sound.id}
              currentTime={previewTime}
              onToggle={() => toggle(sound)}
              onSeek={seek}
            />
          ))
        )}
      </div>

      <p className="text-muted-foreground/70 shrink-0 px-1 text-[11px] leading-snug">
        Drag a sound onto a track to place it where you drop it.
      </p>
    </div>
  );
}
