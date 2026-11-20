/**
 * A book's cover: the uploaded image, or a typeset placeholder in a hue taken
 * from the title, so a shelf of new books still tells them apart.
 */

import { audiobookApi } from "@/lib/audiobook-api";
import type { Book } from "@/lib/audiobook-types";
import { laneColor } from "@/lib/lanes";
import { cn } from "@/lib/utils";

function hashIndex(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function BookCover({
  book,
  className,
  size = "md",
}: {
  book: Pick<Book, "id" | "title" | "author" | "cover_path">;
  className?: string;
  size?: "sm" | "md";
}) {
  const url = audiobookApi.coverUrl(book);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={cn("aspect-[2/3] w-full rounded-md object-cover shadow-sm", className)}
      />
    );
  }
  const lane = hashIndex(book.title);
  return (
    <div
      aria-hidden="true"
      className={cn(
        "border-border/60 text-foreground relative flex aspect-[2/3] w-full flex-col justify-between overflow-hidden rounded-md border shadow-sm",
        size === "sm" ? "p-1.5" : "p-3",
        className,
      )}
      style={{
        background: `linear-gradient(160deg, ${laneColor(lane, 0.55)}, ${laneColor(lane + 3, 0.25)})`,
      }}
    >
      <div className="bg-foreground/30 h-px w-1/3" />
      <p
        className={cn(
          "font-heading leading-tight font-semibold text-balance",
          size === "sm" ? "line-clamp-3 text-[0.55rem]" : "line-clamp-4 text-sm",
        )}
      >
        {book.title}
      </p>
      {size === "md" && book.author ? (
        <p className="text-foreground/75 truncate text-xs">{book.author}</p>
      ) : (
        <span />
      )}
    </div>
  );
}
