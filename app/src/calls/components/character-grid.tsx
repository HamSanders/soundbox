import { Loader2, Plus } from "@/lib/icons";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

import { calls, type Character } from "../live-client";
import { pad } from "../prefs";

/** A character's portrait, or their initial on a tile when they have none. */
export function Portrait({ name, url, className, round = false }: { name: string; url: string | null | undefined; className?: string; round?: boolean }) {
  if (url) return <img alt="" loading="lazy" src={calls.url(url)} className={cn("object-cover", round && "rounded-full", className)} />;
  return (
    <span
      aria-hidden
      data-testid="portrait-monogram"
      className={cn("grid place-items-center bg-muted font-display font-extrabold uppercase text-muted-foreground select-none", round && "rounded-full", className)}
    >
      {name.trim().charAt(0) || "?"}
    </span>
  );
}

/**
 * Characters as cards. Used on the Calls hub (pick to call, with edit
 * buttons) and inside a call (switching who you're talking to).
 */
export function CharacterGrid({ characters, selected, busyId, onPick, actions, newTo, compact = false }: {
  characters: Character[];
  selected?: string | null;
  busyId?: string | null;
  onPick: (c: Character) => void;
  /** Extra buttons on each card's name row. */
  actions?: (c: Character) => ReactNode;
  /** Ends the grid with a "New character" card linking here. */
  newTo?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4")}>
      {characters.map((c, i) => (
        <div
          key={c.id}
          data-testid="character-card"
          data-id={c.id}
          className={cn(
            "group overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-border-strong",
            c.id === selected && "border-foreground ring-1 ring-foreground",
          )}
        >
          <button
            type="button"
            aria-pressed={selected !== undefined ? c.id === selected : undefined}
            aria-label={`Call ${c.name}`}
            disabled={!!busyId}
            onClick={() => onPick(c)}
            className="relative block aspect-square w-full overflow-hidden bg-muted"
          >
            <Portrait
              name={c.name}
              url={c.portrait_url}
              className={cn("size-full transition-transform duration-500 group-hover:scale-[1.03]", compact ? "text-4xl" : "text-7xl")}
            />
            {busyId === c.id ? (
              <span className="absolute inset-0 grid place-items-center bg-background/60"><Loader2 className="size-6 animate-spin" /></span>
            ) : null}
          </button>
          <span className="flex items-center gap-1 px-3 py-2">
            <span className="mr-auto flex min-w-0 items-center gap-2 font-log text-xs text-muted-foreground">
              <span className={cn("size-1.5 shrink-0 rounded-full", c.id === selected ? "bg-signal" : "bg-border-strong")} />
              <span className="truncate">No. {pad(i + 1)} · <b className="font-normal text-foreground">{c.name}</b></span>
            </span>
            {actions?.(c)}
          </span>
        </div>
      ))}
      {newTo ? (
        <Link
          to={newTo}
          data-testid="create-character-card"
          className="grid min-h-40 place-items-center rounded-lg border border-dashed border-border-strong/60 text-muted-foreground hover:border-foreground hover:text-foreground"
        >
          <span className="grid justify-items-center gap-2 text-sm"><Plus className="size-6" /> New character</span>
        </Link>
      ) : null}
    </div>
  );
}
