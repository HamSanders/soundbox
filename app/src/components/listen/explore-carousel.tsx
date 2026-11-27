/**
 * The featured covers at the top of Explore: one large centred cover with
 * its neighbours turned away on either side, like ElevenReader's "Top picks".
 * Arrows, the arrow keys and clicking a neighbour move it; the centred one
 * shows its title, author, length and what you can do with it.
 */

import { useState } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, Loader2Icon, PlayIcon, PlusIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { listenApi } from "@/lib/listen-api";
import type { ExploreItem } from "@/lib/listen-explore";
import { useListenPlayer } from "@/lib/listen-player-store";
import { cn } from "@/lib/utils";

import { lengthLabel } from "./explore-card";
import { ListenCover } from "./listen-cover";
import type { AddState } from "./use-add-classic";

const SHOWN = 2; // neighbours on each side

export function ExploreCarousel({
  items,
  onPickClassic,
  adder,
}: {
  items: ExploreItem[];
  onPickClassic: (it: ExploreItem) => void;
  adder?: { add: (it: ExploreItem) => void; stateOf: (it: ExploreItem) => AddState | null };
}) {
  const [index, setIndex] = useState(Math.min(1, items.length - 1));
  const open = useListenPlayer((s) => s.open);
  if (items.length === 0) return null;
  const at = Math.min(index, items.length - 1);
  const current = items[at]!;
  const move = (d: number) => setIndex((i) => Math.max(0, Math.min(items.length - 1, i + d)));

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") move(-1);
        if (e.key === "ArrowRight") move(1);
      }}
      className="focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none"
    >
      <div className="relative flex h-60 items-center justify-center overflow-hidden [perspective:1200px] sm:h-72">
        {items.map((it, i) => {
          const off = i - at;
          if (Math.abs(off) > SHOWN) return null;
          const centre = off === 0;
          const style = {
            transform: `translateX(${off * 62}%) rotateY(${centre ? 0 : off < 0 ? 38 : -38}deg) scale(${centre ? 1 : 0.82 - (Math.abs(off) - 1) * 0.1})`,
            zIndex: 10 - Math.abs(off),
            opacity: centre ? 1 : 0.75 - (Math.abs(off) - 1) * 0.3,
          };
          const cls = "absolute w-40 transition-all duration-300 ease-out sm:w-52";
          const cover = (
            // Placeholder covers are a translucent gradient: back them so overlapping covers don't show through.
            <ListenCover
              book={{ title: it.title, author: it.author, cover_url: it.book?.cover_url ?? null }}
              className={cn("bg-background", centre && "shadow-lg")}
            />
          );
          if (centre && it.book) {
            return (
              <Link key={it.key} to={`/listen/${it.book.id}`} aria-label={`Open ${it.title}`} className={cls} style={style}>
                {cover}
              </Link>
            );
          }
          return (
            <button
              key={it.key}
              type="button"
              tabIndex={centre ? 0 : -1}
              aria-label={centre ? `${it.title}: details` : `Show ${it.title}`}
              onClick={() => (centre ? onPickClassic(it) : setIndex(i))}
              className={cls}
              style={style}
            >
              {cover}
            </button>
          );
        })}
        <Button variant="secondary" size="icon" className="absolute left-1 z-20 rounded-full" aria-label="Previous" disabled={at === 0} onClick={() => move(-1)}>
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="absolute right-1 z-20 rounded-full"
          aria-label="Next"
          disabled={at === items.length - 1}
          onClick={() => move(1)}
        >
          <ChevronRightIcon />
        </Button>
      </div>
      <div className="mt-3 flex flex-col items-center gap-1 text-center" aria-live="polite">
        <p className="font-heading font-semibold">{current.title}</p>
        <p className="text-muted-foreground text-xs">
          {current.author ?? "Unknown author"}
          {lengthLabel(current) ? ` · ${lengthLabel(current)}` : ""}
        </p>
        <div className="mt-1">
          {current.status === "voiced" && current.book ? (
            <Button size="sm" onClick={async () => open(await listenApi.manifest(current.book!.id), { autoplay: true })}>
              <PlayIcon className="fill-current" /> Play
            </Button>
          ) : current.status === "classic" ? (
            <div className="flex gap-2">
              {adder && (
                <Button size="sm" disabled={adder.stateOf(current) !== null} onClick={() => adder.add(current)}>
                  {adder.stateOf(current) === "adding" ? (
                    <Loader2Icon className="animate-spin" />
                  ) : adder.stateOf(current) === "added" ? (
                    <CheckIcon />
                  ) : (
                    <PlusIcon />
                  )}
                  {adder.stateOf(current) === "added" ? "In library" : "Add to library"}
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => onPickClassic(current)}>
                Details
              </Button>
            </div>
          ) : current.book ? (
            <Button size="sm" variant="secondary" asChild>
              <Link to={`/audiobooks/${current.book.id}`}>Voice it</Link>
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex justify-center gap-1.5" aria-hidden="true">
        {items.map((it, i) => (
          <span key={it.key} className={cn("size-1.5 rounded-full", i === at ? "bg-foreground" : "bg-muted-foreground/40")} />
        ))}
      </div>
    </section>
  );
}
