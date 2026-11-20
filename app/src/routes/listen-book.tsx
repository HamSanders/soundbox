/**
 * A book's page on the listening side: cover, credits, blurb, a details
 * block, the table of contents, Listen/Resume and Preview, bookmarks, more in
 * the series, and publishing (store checklist and exports).
 */

import { useMemo, useState } from "react";
import { BookmarkIcon, ChevronRightIcon, HeadphonesIcon, MoreHorizontalIcon, PencilIcon, PlayIcon } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { BookTile } from "@/components/listen/book-tile";
import { BookmarkList } from "@/components/listen/bookmark-list";
import { ListenCover } from "@/components/listen/listen-cover";
import { PublishPanel } from "@/components/listen/publish-panel";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { clock, formatLength } from "@/lib/listen-api";
import { useListenPlayer } from "@/lib/listen-player-store";
import { useListenManifest, useMarkFinished, useShelf } from "@/lib/listen-queries";
import type { ListenManifest } from "@/lib/listen-types";
import { cn } from "@/lib/utils";

const TOC_COLLAPSED = 8;

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function formatDate(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** "Narrated by X" plus the cast's voices, the detail page's credit line. */
function narratedBy(m: ListenManifest): { narrator: string; voices: string[] } {
  const narrator = m.book.narrator ?? m.cast[0]?.voice_name ?? "Narrator";
  const voices = [...new Set(m.cast.slice(1).map((c) => c.voice_name).filter((v): v is string => Boolean(v)))];
  return { narrator, voices };
}

export function ListenBookPage() {
  const { id = "" } = useParams();
  const manifest = useListenManifest(id);
  const shelf = useShelf();
  const finish = useMarkFinished(id);
  const open = useListenPlayer((s) => s.open);
  const current = useListenPlayer((s) => (s.manifest?.book.id === id ? s : null));
  const [showAll, setShowAll] = useState(false);

  const m = manifest.data;
  const seriesBooks = useMemo(
    () =>
      m?.book.series
        ? (shelf.data ?? [])
            .filter((b) => b.series === m.book.series)
            .sort((a, b) => (a.series_index ?? 0) - (b.series_index ?? 0))
        : [],
    [m, shelf.data],
  );
  const byAuthor = useMemo(
    () =>
      m?.book.author
        ? (shelf.data ?? []).filter((b) => b.author === m.book.author && b.id !== m.book.id && b.series !== m.book.series)
        : [],
    [m, shelf.data],
  );

  if (manifest.isLoading) {
    return (
      <div className="flex gap-6">
        <Skeleton className="aspect-square w-56 rounded-md" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
    );
  }
  if (manifest.isError || !m) {
    return (
      <EmptyState tone="error" title="Could not open this book">
        {manifest.error?.message ?? "Not found"}
      </EmptyState>
    );
  }

  const playable = m.chapters.some((c) => c.audio_url);
  const progress = m.progress;
  const resumeAt = progress && !progress.finished_at ? progress.book_position_s : 0;
  const started = resumeAt > 1;
  const remaining = Math.max(0, m.duration_s - resumeAt);
  const { narrator, voices } = narratedBy(m);
  const chapters = showAll ? m.chapters : m.chapters.slice(0, TOC_COLLAPSED);
  const playingChapter = current?.manifest?.chapters[current.chapterIndex]?.id ?? null;

  const listen = () => open(m, { autoplay: true, expand: true });
  const preview = () => m.sample && open(m, { preview: m.sample, autoplay: true });
  const playChapter = (chapterId: string) => open(m, { chapterId, position: 0, autoplay: true });

  const details: [string, React.ReactNode][] = [
    ["Length", playable ? formatLength(m.duration_s) : "Not voiced yet"],
    ["Narrated by", voices.length ? `${narrator}, with ${voices.join(", ")}` : narrator],
    ["Genre", m.book.genres.join(", ") || null],
    ["Language", languageName(m.book.language)],
    ["Published", formatDate(m.book.publication_date)],
    ["Publisher", m.book.publisher],
    ["Format", "Audiobook with read-along text"],
    ["Series", m.book.series ? `${m.book.series}${m.book.series_index != null ? `, book ${m.book.series_index}` : ""}` : null],
    ["ISBN", m.book.isbn],
  ];

  return (
    <div className="space-y-10">
      <nav aria-label="Breadcrumb" className="text-muted-foreground flex items-center gap-1 text-sm">
        <Link to="/listen" className="hover:text-foreground">
          Listen
        </Link>
        {m.book.genres[0] && (
          <>
            <ChevronRightIcon className="size-3.5" />
            <span>{m.book.genres[0]}</span>
          </>
        )}
      </nav>

      <div className="flex flex-col gap-6 sm:flex-row">
        <ListenCover book={{ ...m.book }} size="lg" className="w-48 sm:w-56" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance">{m.book.title}</h1>
            {m.book.subtitle && <p className="text-muted-foreground mt-1 text-lg">{m.book.subtitle}</p>}
            {m.book.author && <p className="mt-2 text-sm">By {m.book.author}</p>}
            <p className="text-muted-foreground text-sm">
              Narrated by {narrator}
              {voices.length > 0 && ` and ${voices.length} more ${voices.length === 1 ? "voice" : "voices"}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" onClick={listen} disabled={!playable}>
              <PlayIcon className="fill-current" />
              {started ? `Resume · ${formatLength(remaining)} left` : "Listen"}
            </Button>
            {m.sample && (
              <Button size="lg" variant="outline" onClick={preview}>
                <HeadphonesIcon />
                Preview
              </Button>
            )}
            <Button size="lg" variant="ghost" asChild>
              <Link to={`/audiobooks/${m.book.id}`}>
                <PencilIcon />
                Edit book
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-lg" variant="ghost" aria-label="More">
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {progress?.finished_at ? (
                  <DropdownMenuItem onSelect={() => finish.mutate(false)}>Mark as not started</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => finish.mutate(true)}>Mark as finished</DropdownMenuItem>
                )}
                {progress && !progress.finished_at && (
                  <DropdownMenuItem onSelect={() => finish.mutate(false)}>Reset progress</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {progress && !progress.finished_at && m.duration_s > 0 && (
            <div className="max-w-sm space-y-1">
              <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                <div className="bg-primary h-full" style={{ width: `${Math.min(100, (resumeAt / m.duration_s) * 100)}%` }} />
              </div>
              <p className="text-muted-foreground text-xs tabular-nums">
                {clock(resumeAt)} of {clock(m.duration_s)}
              </p>
            </div>
          )}
          {!playable && (
            <p className="text-muted-foreground text-sm">
              No chapter has audio yet. Voice it in the editor, and it plays here.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-10">
          {m.book.description && (
            <section className="space-y-3">
              <h2 className="font-heading text-lg font-semibold">About this audiobook</h2>
              <p className="text-sm leading-relaxed whitespace-pre-line">{m.book.description}</p>
              {m.book.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.book.tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="space-y-3">
            <h2 className="font-heading text-lg font-semibold">Table of contents</h2>
            <ol className="divide-border border-border divide-y rounded-md border">
              {chapters.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={!c.audio_url}
                    onClick={() => playChapter(c.id)}
                    className={cn(
                      "hover:bg-accent flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent",
                      playingChapter === c.id && "bg-accent",
                    )}
                  >
                    <span className="text-muted-foreground w-6 text-right tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {progress?.chapter_id === c.id && !progress.finished_at && (
                      <BookmarkIcon className="text-primary size-3.5" aria-label="You are here" />
                    )}
                    <span className="text-muted-foreground tabular-nums">{c.audio_url ? clock(c.duration_s) : "—"}</span>
                  </button>
                </li>
              ))}
            </ol>
            {m.chapters.length > TOC_COLLAPSED && (
              <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${m.chapters.length} chapters`}
              </Button>
            )}
          </section>

          {m.bookmarks.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-heading text-lg font-semibold">Bookmarks and notes</h2>
              <BookmarkList
                manifest={m}
                onJump={(b) => open(m, { chapterId: b.chapter_id, position: b.position_s, autoplay: true })}
              />
            </section>
          )}

          {seriesBooks.length > 1 && (
            <section className="space-y-3">
              <h2 className="font-heading text-lg font-semibold">More in {m.book.series}</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
                {seriesBooks.map((b) => (
                  <div key={b.id} className={cn(b.id === m.book.id && "opacity-60")}>
                    <p className="text-muted-foreground mb-1 text-xs">Book {b.series_index ?? "?"}</p>
                    <BookTile book={b} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {byAuthor.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-heading text-lg font-semibold">More from {m.book.author}</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
                {byAuthor.map((b) => (
                  <BookTile key={b.id} book={b} />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-8">
          <section className="space-y-3">
            <h2 className="font-heading text-lg font-semibold">Audiobook details</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {details
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="min-w-0 break-words">{v}</dd>
                  </div>
                ))}
            </dl>
          </section>
          {m.cast.length > 1 && (
            <section className="space-y-3">
              <h2 className="font-heading text-lg font-semibold">Cast</h2>
              <ul className="space-y-1.5 text-sm">
                {m.cast.map((c) => (
                  <li key={c.character_id ?? "narrator"} className="flex justify-between gap-3">
                    <span>{c.role}</span>
                    <span className="text-muted-foreground truncate">{c.voice_name ?? "Default voice"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <PublishPanel bookId={m.book.id} />
        </aside>
      </div>
    </div>
  );
}
