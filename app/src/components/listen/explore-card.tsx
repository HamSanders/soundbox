/**
 * One card in Explore: cover, title, author, length and where it stands. A
 * book of yours opens its listen page; a classic opens its details. A
 * classic's "+" adds it to the library without leaving Explore.
 */

import { CheckIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";

import { formatShort, listenedPercent } from "@/lib/listen-api";
import type { ExploreItem } from "@/lib/listen-explore";
import { cn } from "@/lib/utils";

import { ListenCover } from "./listen-cover";
import type { AddState } from "./use-add-classic";

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

export function ExploreCard({
  item,
  onPickClassic,
  onAddClassic,
  addState = null,
  className,
}: {
  item: ExploreItem;
  onPickClassic: (it: ExploreItem) => void;
  onAddClassic?: (it: ExploreItem) => void;
  addState?: AddState | null;
  className?: string;
}) {
  const percent = item.book ? listenedPercent(item.book) : null;
  const badge = addState === "added" ? "In library" : BADGE[item.status];
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
    <div className={cn("group relative min-w-0", className)}>
      <button
        type="button"
        onClick={() => onPickClassic(item)}
        aria-label={`${item.title}: details`}
        className="block w-full min-w-0 text-left"
      >
        {body}
      </button>
      {onAddClassic && (
        <Button
          size="icon-sm"
          variant={addState ? "secondary" : "default"}
          aria-label={addState === "added" ? `${item.title} is in your library` : `Add ${item.title} to your library`}
          title={addState === "added" ? "In your library" : "Add to library"}
          disabled={addState !== null}
          onClick={() => onAddClassic(item)}
          className={cn(
            "absolute top-2 right-2 rounded-full shadow-md transition-opacity",
            // Shown on hover or focus where there's a mouse; always on touch.
            !addState &&
              "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100",
          )}
        >
          {addState === "adding" ? <Loader2Icon className="animate-spin" /> : addState === "added" ? <CheckIcon /> : <PlusIcon />}
        </Button>
      )}
    </div>
  );
}
