/**
 * The full-screen player: cover and transport on one side, the read-along
 * text on the other, and a drawer for chapters and bookmarks. Collapses to
 * the mini player without stopping.
 *
 * Keys: Space play/pause, ←/→ 15 s, Shift+←/→ 30 s, [ / ] chapter, B
 * bookmark, Esc collapse.
 */

import { useEffect, useState } from "react";
import { ChevronDownIcon, ListIcon, XIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clock } from "@/lib/listen-api";
import { currentTime, paragraphAt, useListenPlayer } from "@/lib/listen-player-store";
import { useBookmarkMutations } from "@/lib/listen-queries";
import { cn } from "@/lib/utils";

import { BookmarkList } from "./bookmark-list";
import { ListenCover } from "./listen-cover";
import { AddBookmarkButton, Scrubber, SleepTimer, SpeedControl, Transport } from "./player-controls";
import { ReadAlong } from "./read-along";

function ChaptersAndMarks({ onDone }: { onDone: () => void }) {
  const manifest = useListenPlayer((s) => s.manifest)!;
  const chapterIndex = useListenPlayer((s) => s.chapterIndex);
  const setChapter = useListenPlayer((s) => s.setChapter);
  const open = useListenPlayer((s) => s.open);
  return (
    <Tabs defaultValue="chapters" className="min-h-0 flex-1">
      <TabsList className="mx-4">
        <TabsTrigger value="chapters">Chapters</TabsTrigger>
        <TabsTrigger value="bookmarks">Bookmarks ({manifest.bookmarks.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="chapters" className="min-h-0 overflow-y-auto px-2 pb-4">
        <ol>
          {manifest.chapters.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={!c.audio_url}
                onClick={() => {
                  setChapter(i, 0, true);
                  onDone();
                }}
                className={cn(
                  "hover:bg-accent flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm disabled:opacity-50",
                  i === chapterIndex && "bg-accent font-medium",
                )}
              >
                <span className="text-muted-foreground w-5 text-right tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="text-muted-foreground tabular-nums">{c.audio_url ? clock(c.duration_s) : "—"}</span>
              </button>
            </li>
          ))}
        </ol>
      </TabsContent>
      <TabsContent value="bookmarks" className="min-h-0 overflow-y-auto px-4 pb-4">
        <BookmarkList
          manifest={manifest}
          compact
          onJump={(b) => {
            open(manifest, { chapterId: b.chapter_id, position: b.position_s, autoplay: true });
            onDone();
          }}
        />
      </TabsContent>
    </Tabs>
  );
}

export function FullPlayer() {
  const manifest = useListenPlayer((s) => s.manifest);
  const expanded = useListenPlayer((s) => s.expanded);
  const chapterIndex = useListenPlayer((s) => s.chapterIndex);
  const previewEnd = useListenPlayer((s) => s.previewEnd);
  const error = useListenPlayer((s) => s.error);
  const setExpanded = useListenPlayer((s) => s.setExpanded);
  const close = useListenPlayer((s) => s.close);
  const [drawer, setDrawer] = useState(false);
  const { add } = useBookmarkMutations(manifest?.book.id ?? "");

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true], [role=slider], [role=menu], [role=dialog]")) return;
      const s = useListenPlayer.getState();
      if (e.key === " ") {
        e.preventDefault();
        s.toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        s.skip(e.shiftKey ? -30 : -15);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        s.skip(e.shiftKey ? 30 : 15);
      } else if (e.key === "[") s.prev();
      else if (e.key === "]") s.next();
      else if (e.key === "Escape") s.setExpanded(false);
      else if (e.key.toLowerCase() === "b" && s.manifest) {
        const c = s.manifest.chapters[s.chapterIndex];
        const t = currentTime();
        const p = paragraphAt(c, t);
        add.mutate({ chapter_id: c.id, position_s: t, segment_id: p >= 0 ? c.paragraphs[p].segment_id : null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, add]);

  if (!manifest || !expanded) return null;
  const chapter = manifest.chapters[chapterIndex];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Now playing: ${manifest.book.title}`}
      className="bg-background text-foreground fixed inset-0 z-50 flex flex-col"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon" aria-label="Collapse player" onClick={() => setExpanded(false)}>
          <ChevronDownIcon />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-medium">{manifest.book.title}</p>
          <p className="text-muted-foreground truncate text-xs">
            {previewEnd !== null ? "Preview · " : ""}
            {chapter?.title}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Chapters and bookmarks" onClick={() => setDrawer(true)}>
          <ListIcon />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Stop and close" onClick={close}>
          <XIcon />
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(18rem,26rem)_1fr]">
        <div className="flex flex-col justify-center gap-5 border-b p-5 md:border-r md:border-b-0 md:p-8">
          <ListenCover book={manifest.book} size="lg" className="mx-auto hidden w-full max-w-72 md:block" />
          <div className="hidden text-center md:block">
            <Link
              to={`/listen/${manifest.book.id}`}
              onClick={() => setExpanded(false)}
              className="font-heading text-lg font-semibold hover:underline"
            >
              {manifest.book.title}
            </Link>
            {manifest.book.author && <p className="text-muted-foreground text-sm">{manifest.book.author}</p>}
          </div>
          <Scrubber />
          <Transport />
          <div className="flex flex-wrap items-center justify-center gap-1">
            <SpeedControl />
            <SleepTimer />
            <AddBookmarkButton withLabel />
          </div>
          {error && <p className="text-destructive text-center text-sm">{error}</p>}
        </div>
        <ReadAlong className="order-first h-full md:order-none" />
      </div>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="right" className="flex flex-col gap-3 p-0">
          <SheetHeader>
            <SheetTitle>{manifest.book.title}</SheetTitle>
            <SheetDescription>{manifest.chapters.length} chapters</SheetDescription>
          </SheetHeader>
          <ChaptersAndMarks onDone={() => setDrawer(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
