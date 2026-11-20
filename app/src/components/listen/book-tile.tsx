/**
 * A book on the listening shelf: cover, title, author, length and how far in
 * you are. Opens the book page; the play button on hover resumes it in place.
 */

import { CheckIcon, PlayIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { formatShort, listenApi, listenedPercent } from "@/lib/listen-api";
import { useListenPlayer } from "@/lib/listen-player-store";
import type { ShelfBook } from "@/lib/listen-types";
import { cn } from "@/lib/utils";

import { ListenCover } from "./listen-cover";

export function BookTile({ book, className }: { book: ShelfBook; className?: string }) {
  const percent = listenedPercent(book);
  const open = useListenPlayer((s) => s.open);
  const playable = book.playable_chapters > 0;
  const remaining = book.progress && !book.progress.finished_at ? Math.max(0, book.duration_s - book.progress.book_position_s) : null;

  const resume = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    open(await listenApi.manifest(book.id), { autoplay: true });
  };

  return (
    <Link to={`/listen/${book.id}`} className={cn("group block min-w-0", className)}>
      <div className="relative">
        <ListenCover book={book} percent={percent} className="transition-transform group-hover:-translate-y-0.5" />
        {playable && (
          <button
            type="button"
            onClick={resume}
            aria-label={percent ? `Resume ${book.title}` : `Play ${book.title}`}
            className="bg-primary text-primary-foreground absolute right-2 bottom-3 flex size-9 items-center justify-center rounded-full opacity-0 shadow-md transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <PlayIcon className="size-4 fill-current" />
          </button>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-snug font-medium">{book.title}</p>
      <p className="text-muted-foreground truncate text-xs">{book.author ?? "Unknown author"}</p>
      <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs tabular-nums">
        {percent === 100 ? (
          <>
            <CheckIcon className="size-3" /> Finished
          </>
        ) : !playable ? (
          "Not voiced yet"
        ) : remaining !== null && percent !== null && percent > 0 ? (
          `${formatShort(remaining)} left · ${percent}%`
        ) : (
          formatShort(book.duration_s)
        )}
      </p>
    </Link>
  );
}
