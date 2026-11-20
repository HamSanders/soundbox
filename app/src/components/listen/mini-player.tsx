/**
 * The mini player: a small card in the corner that keeps the book playing
 * while you browse. Click the cover or title to open the full-screen view.
 * Mounted once in the app shell, alongside the full-screen player.
 */

import { Maximize2Icon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useListenPlayer } from "@/lib/listen-player-store";

import { FullPlayer } from "./full-player";
import { ListenCover } from "./listen-cover";
import { PlayPauseButton, SleepTimer } from "./player-controls";

function MiniPlayer() {
  const manifest = useListenPlayer((s) => s.manifest);
  const expanded = useListenPlayer((s) => s.expanded);
  const chapterIndex = useListenPlayer((s) => s.chapterIndex);
  const position = useListenPlayer((s) => s.position);
  const duration = useListenPlayer((s) => s.duration);
  const previewEnd = useListenPlayer((s) => s.previewEnd);
  const setExpanded = useListenPlayer((s) => s.setExpanded);
  const skip = useListenPlayer((s) => s.skip);
  const close = useListenPlayer((s) => s.close);
  if (!manifest || expanded) return null;
  const chapter = manifest.chapters[chapterIndex];
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <div
      role="region"
      aria-label="Audiobook player"
      className="bg-card text-card-foreground border-border fixed right-4 bottom-[calc(var(--dock-h,0px)+1rem)] z-40 w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-xl border shadow-lg"
    >
      <div className="flex items-center gap-3 p-2.5">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-label="Open the full player"
        >
          <ListenCover book={manifest.book} size="xs" className="w-11" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{manifest.book.title}</span>
            <span className="text-muted-foreground block truncate text-xs">
              {previewEnd !== null ? "Preview · " : ""}
              {chapter?.title}
            </span>
          </span>
        </button>
        <Button variant="ghost" size="icon-sm" aria-label="Back 15 seconds" onClick={() => skip(-15)} className="text-xs tabular-nums">
          -15
        </Button>
        <PlayPauseButton size="sm" />
        <Button variant="ghost" size="icon-sm" aria-label="Forward 30 seconds" onClick={() => skip(30)} className="text-xs tabular-nums">
          +30
        </Button>
        <div className="hidden sm:block">
          <SleepTimer />
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Open the full player" onClick={() => setExpanded(true)}>
          <Maximize2Icon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Stop and close" onClick={close}>
          <XIcon />
        </Button>
      </div>
      <div className="bg-muted h-0.5">
        <div className="bg-primary h-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Both faces of the book player; mount once in the app shell. */
export function ListenPlayerHost() {
  return (
    <>
      <MiniPlayer />
      <FullPlayer />
    </>
  );
}
