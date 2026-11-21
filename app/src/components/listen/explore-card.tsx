/**
 * One card in Explore: cover, title, author, length and where it stands. A
 * book of yours opens its listen page; a classic opens its details, where it
 * can be added to the library.
 */

import { Link } from "react-router-dom";

import { formatShort, listenedPercent } from "@/lib/listen-api";
import type { ExploreItem } from "@/lib/listen-explore";
import { cn } from "@/lib/utils";

import { ListenCover } from "./listen-cover";

const BADGE: Record<ExploreItem["status"], string | null> = {
  voiced: null,
  unvoiced: "Not voiced yet",
  classic: "Classic",
};

export function lengthLabel(it: ExploreItem): string {
  if (it.length_s <= 0) return "";
  const t = formatShort(it.length_s);
  return it.status === "voiced" ? t : `about ${t}`;
}

export function ExploreCard({ item, onPickClassic, className }: { item: ExploreItem; onPickClassic: (it: ExploreItem) => void; className?: string }) {
  const percent = item.book ? listenedPercent(item.book) : null;
  const badge = BADGE[item.status];
  const body = (
    <>
      <div className="relative">
        <ListenCover
          book={{ title: item.title, author: item.author, cover_url: item.book?.cover_url ?? null }}
          percent={percent}
          className="transition-transform group-hover:-translate-y-0.5"
        />
        {badge && (
          <span
            className={cn(
              "absolute top-2 left-2 rounded-full px-2 py-0.5 text-[0.65rem] font-medium shadow-sm",
              item.status === "classic" ? "bg-background/90 text-foreground" : "bg-muted/90 text-muted-foreground",
            )}
          >
            {badge}
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-snug font-medium">{item.title}</p>
      <p className="text-muted-foreground truncate text-xs">{item.author ?? "Unknown author"}</p>
      <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">{lengthLabel(item)}</p>
    </>
  );
  if (item.book) {
    return (
      <Link to={`/listen/${item.book.id}`} className={cn("group block min-w-0", className)}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onPickClassic(item)}
      aria-label={`${item.title}: details`}
      className={cn("group block min-w-0 text-left", className)}
    >
      {body}
    </button>
  );
}
