/**
 * A square audiobook cover (retail audiobook art is 1:1). The uploaded image,
 * or a typeset placeholder in a hue taken from the title.
 */

import { laneColor } from "@/lib/lanes";
import { cn } from "@/lib/utils";

function hashIndex(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function ListenCover({
  book,
  className,
  size = "md",
  percent = null,
}: {
  book: { title: string; author: string | null; cover_url: string | null };
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
  /** Listening progress, drawn as a bar along the bottom edge. */
  percent?: number | null;
}) {
  const lane = hashIndex(book.title);
  return (
    <div
      className={cn(
        "border-border/60 relative aspect-square w-full shrink-0 overflow-hidden rounded-md border shadow-sm",
        className,
      )}
    >
      {book.cover_url ? (
        <img src={book.cover_url} alt="" className="size-full object-cover" />
      ) : (
        <div
          aria-hidden="true"
          className={cn(
            "text-foreground flex size-full flex-col justify-between",
            size === "xs" ? "p-1" : size === "sm" ? "p-2" : "p-3",
          )}
          style={{
            background: `linear-gradient(150deg, ${laneColor(lane, 0.6)}, ${laneColor(lane + 3, 0.22)})`,
          }}
        >
          <div className="bg-foreground/30 h-px w-1/3" />
          {size !== "xs" && (
            <p
              className={cn(
                "font-heading leading-tight font-semibold text-balance",
                size === "sm" ? "line-clamp-3 text-[0.65rem]" : size === "lg" ? "line-clamp-4 text-2xl" : "line-clamp-4 text-sm",
              )}
            >
              {book.title}
            </p>
          )}
          {(size === "md" || size === "lg") && book.author ? (
            <p className={cn("text-foreground/75 truncate", size === "lg" ? "text-sm" : "text-xs")}>{book.author}</p>
          ) : (
            <span />
          )}
        </div>
      )}
      {percent !== null && percent > 0 && percent < 100 && (
        <div className="bg-background/70 absolute inset-x-0 bottom-0 h-1">
          <div className="bg-primary h-full" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}
