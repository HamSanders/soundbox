/**
 * The fixed, full-width bottom dock — one player idiom shared by every page
 * that needs "the thing playing stays on screen while you do something else".
 *
 * Originally written for `/music/:slug` (the marketing track page) and lifted
 * out here so the app's own `NowPlayingBar` (opened from a Library row, see
 * `sound-card.tsx`) uses the exact same component rather than a re-styled
 * copy of it. The two callers differ only in what goes on the left (a cover
 * vs nothing), what plays in the middle (`/music` swaps in a failed/loading
 * state before its manifest resolves) and what trails the waveform (download
 * vs close) — all three are props; the position, blur, border and layout are
 * one definition.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** The dock's rendered height in px — `py-3` (24px) either side of a 56px
 *  waveform. Exported so a page with its own bottom-pinned UI (the Generate
 *  composer, the Library's inline composer) can offset itself by exactly
 *  this much when the dock is showing, instead of guessing a number that
 *  drifts out of sync with the real thing. */
export const PLAYER_DOCK_HEIGHT_PX = 80;

interface PlayerDockProps {
  /** Cover art or a placeholder tile — omitted entirely if not given. */
  cover?: ReactNode;
  /** Hidden below `sm`, same as the title/subtitle block always has been. */
  title?: string;
  subtitle?: string;
  /** The `WaveformPlayer` (or a loading/failed stand-in) — the caller's, not
   *  built in here, so each can keep its own readiness logic. */
  player: ReactNode;
  /** Download link, close button, whatever trails the waveform. */
  trailing?: ReactNode;
  /**
   * `"fixed"` (default) spans the full viewport width — right for
   * `/music/:slug`, which renders outside the app shell and has no sidebar to
   * clear. `"sticky"` stays inside its parent's box instead, which is what
   * the app shell needs: a `fixed` dock would draw across the sidebar rather
   * than stopping at its edge. Pass `"sticky"` from inside `SidebarInset` —
   * its column already excludes the sidebar's width, so a sticky child never
   * overlaps it.
   */
  position?: "fixed" | "sticky";
  /** Sit on the app shell's ground, under the floating panels, instead of
   *  as a frosted strip over the page. The app-wide player uses it. */
  ground?: boolean;
}

export function PlayerDock({
  cover,
  title,
  subtitle,
  player,
  trailing,
  position = "fixed",
  ground = false,
}: PlayerDockProps) {
  return (
    <div
      role="region"
      aria-label="Now playing"
      className={cn(
        "bottom-0 z-40",
        ground
          ? "bg-sidebar h-(--dock-h,80px)"
          : "border-border/60 bg-background/90 supports-[backdrop-filter]:bg-background/75 border-t backdrop-blur",
        position === "fixed" ? "fixed inset-x-0" : "sticky",
      )}
    >
      <div className={cn("mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3", ground && "h-full max-w-none px-5")}>
        {cover}
        {(title || subtitle) && (
          <div className="hidden w-44 min-w-0 shrink-0 sm:block">
            {title && <p className="truncate text-sm font-medium">{title}</p>}
            {subtitle && <p className="text-muted-foreground truncate text-xs">{subtitle}</p>}
          </div>
        )}
        <div className="min-w-0 flex-1">{player}</div>
        {trailing}
      </div>
    </div>
  );
}
