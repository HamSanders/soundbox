/** One book on the shelf: cover, title, author and how much of it is voiced. */

import { Link } from "react-router-dom";
import { MoreHorizontalIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BookSummary } from "@/lib/audiobook-api";
import { formatDuration, formatRelative } from "@/lib/format";

import { BookCover } from "./book-cover";

export function bookProgress(book: Pick<BookSummary, "stats">): number {
  const { paragraphs, voiced } = book.stats;
  return paragraphs === 0 ? 0 : Math.round((voiced / paragraphs) * 100);
}

export function BookCard({
  book,
  onDelete,
  index = 0,
}: {
  book: BookSummary;
  onDelete: (book: BookSummary) => void;
  index?: number;
}) {
  const pct = bookProgress(book);
  return (
    <div
      className="group animate-in fade-in-0 slide-in-from-bottom-1 relative flex flex-col gap-2 duration-300 fill-mode-both"
      style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
    >
      <Link
        to={`/audiobooks/${book.id}`}
        className="focus-visible:ring-ring/50 rounded-md transition-transform duration-(--duration-fast) outline-none group-hover:-translate-y-0.5 focus-visible:ring-2"
        aria-label={`Open ${book.title}`}
      >
        <BookCover book={book} />
      </Link>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <Link to={`/audiobooks/${book.id}`} className="hover:underline">
            <p className="truncate text-sm font-medium">{book.title}</p>
          </Link>
          <p className="text-muted-foreground truncate text-xs">
            {book.author || "No author"} · {book.stats.chapters} chapter
            {book.stats.chapters === 1 ? "" : "s"}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`More for ${book.title}`}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(book)}>
              <Trash2Icon />
              Delete book
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="space-y-1">
        <div
          className="bg-muted h-1 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Voiced"
        >
          <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-muted-foreground flex justify-between text-[0.7rem] tabular-nums">
          <span>
            {pct}% voiced
            {book.stats.stale > 0 ? ` · ${book.stats.stale} stale` : ""}
          </span>
          <span>
            {book.stats.duration_s > 0
              ? formatDuration(book.stats.duration_s)
              : formatRelative(book.updated_at)}
          </span>
        </p>
      </div>
    </div>
  );
}
