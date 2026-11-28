/**
 * A column of artifact panels: stacked, collapsible, and resizable against
 * each other.
 *
 * The studio's right-hand side used to be one panel — the timeline — with the
 * transport pinned somewhere else on the page. That does not survive contact
 * with a second thing worth looking at while you arrange: the clip you have
 * selected, its waveform, and where it came from. So the column became a
 * stack, and each panel in it is an artifact you open, close, and give as much
 * height as it is currently worth.
 *
 * Three rules make it behave like a panel stack rather than a list of cards:
 *
 * - **Bodies stay mounted when collapsed**, hidden rather than removed. The
 *   timeline owns the story's audio graph; unmounting it to save a few
 *   hundred pixels would stop playback, which is not what closing a panel
 *   means anywhere.
 * - **Height is weight, not pixels.** Panels share what is left after the
 *   collapsed headers, so the split survives the window resizing, the sidebar
 *   opening, and a panel above being closed.
 * - **A handle only exists between two open panels.** There is nothing to
 *   trade height with otherwise, and a drag target that does nothing is worse
 *   than no drag target.
 */

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDownIcon, ExternalLinkIcon, XIcon } from "@/lib/icons";
import type { LucideIcon } from "@/lib/icons";

import { Button } from "@/components/ui/button";
import { useDragOut } from "@/hooks/use-drag-out";
import type { PopOutAt } from "@/lib/popout";
import { cn } from "@/lib/utils";

/** No panel can be dragged smaller than this. Below it the body is a sliver
 *  that shows nothing, and the handle becomes hard to grab back. */
const MIN_PANEL_PX = 96;
/** How much one arrow key moves a handle. Roughly a line of content. */
const KEY_STEP_PX = 24;

export interface Artifact {
  id: string;
  /**
   * The panel's mark, drawn between the chevron and the title.
   *
   * Every panel has one and they come from a single table (`PANELS` in the
   * studio), so the icon in the header, the icon in the Panels menu and the
   * icon on a tab are the same glyph. Half-iconed headers were the previous
   * state and they read as a bug: the panels with a picture looked special
   * rather than merely first.
   */
  icon?: LucideIcon;
  /** The header's left side. A node rather than a string because the sound
   *  artifact's header is the transport itself. */
  title: ReactNode;
  /** The header's right side: actions that belong to this panel. */
  trailing?: ReactNode;
  body: ReactNode;
  /** Used for the toggle's accessible name, which a node title cannot give. */
  label: string;
  defaultOpen?: boolean;
  /**
   * Always open, with no control to close it.
   *
   * For the panel the rest of the stack is a view *of*. Collapsing the
   * timeline leaves a column of headers describing an arrangement you can no
   * longer see, and every one of them — the rack, the sample, the history —
   * acts on it. A chevron that produces that state is a chevron that should
   * not be there.
   */
  pinned?: boolean;
  /** Relative share of the free height when open. */
  defaultWeight?: number;
  /**
   * The least height worth giving this panel while it is open.
   *
   * A share of the column is the wrong tool for a panel whose contents have a
   * fixed size — the device rack's cards are as tall as a row of dials and a
   * mix slider, and a proportional share of a short column crops them halfway
   * through the knobs. Panels above give up the difference.
   */
  minOpenPx?: number;
  /**
   * Take the panel out of the stack entirely. Omitted for a panel the studio
   * cannot do without — the timeline has no X, because a studio with no
   * timeline is not a studio, and closing it would leave a column of headers
   * describing nothing.
   *
   * Collapsing and closing are different acts and both are worth having: one
   * says "not right now", the other "not on this screen".
   */
  onClose?: () => void;
  /**
   * Give the panel a window of its own: the header's pop-out button, or its
   * header dragged past the edge of the page. Omitted where a panel cannot
   * leave — see `lib/popout.ts` for what a popped-out panel is.
   */
  onPopOut?: (at: PopOutAt) => void;
}

export function ArtifactStack({
  artifacts,
  className,
}: {
  artifacts: Artifact[];
  className?: string;
}) {
  const [closed, setClosed] = useState<Set<string>>(
    () => new Set(artifacts.filter((a) => a.defaultOpen === false).map((a) => a.id)),
  );
  const [weights, setWeights] = useState<Record<string, number>>(() =>
    Object.fromEntries(artifacts.map((a) => [a.id, a.defaultWeight ?? 1])),
  );
  // A panel that joins the stack later — opened from the Panels menu, or by
  // the assistant — gets its own share rather than the fallback of 1. It
  // arrives open whatever its `defaultOpen` says: whoever revealed it asked
  // to see it.
  const unweighted = artifacts.filter((a) => !(a.id in weights));
  if (unweighted.length > 0) {
    setWeights((prev) => ({
      ...prev,
      ...Object.fromEntries(
        unweighted.filter((a) => !(a.id in prev)).map((a) => [a.id, a.defaultWeight ?? 1]),
      ),
    }));
  }

  const panels = useRef(new Map<string, HTMLElement>());
  const drag = useRef<{
    pointerId: number;
    above: string;
    below: string;
    startY: number;
    aboveH: number;
    belowH: number;
  } | null>(null);

  const isOpen = (id: string): boolean => !closed.has(id);

  const toggle = (id: string): void =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Move `px` of height from the lower panel to the upper one. Weights are
   *  rescaled against the pair's current pixel heights, so the drag tracks the
   *  pointer exactly however the rest of the column is laid out. */
  const resize = (above: string, below: string, aboveH: number, belowH: number, px: number): void => {
    const pair = aboveH + belowH;
    const nextAbove = Math.min(pair - MIN_PANEL_PX, Math.max(MIN_PANEL_PX, aboveH + px));
    setWeights((prev) => {
      const total = (prev[above] ?? 1) + (prev[below] ?? 1);
      const share = (total * nextAbove) / pair;
      return { ...prev, [above]: share, [below]: total - share };
    });
  };

  const onHandleDown = (
    event: React.PointerEvent<HTMLDivElement>,
    above: string,
    below: string,
  ): void => {
    if (event.button !== 0) return;
    const a = panels.current.get(above);
    const b = panels.current.get(below);
    if (!a || !b) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      above,
      below,
      startY: event.clientY,
      aboveH: a.getBoundingClientRect().height,
      belowH: b.getBoundingClientRect().height,
    };
  };

  const onHandleMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    resize(
      state.above,
      state.below,
      state.aboveH,
      state.belowH,
      event.clientY - state.startY,
    );
  };

  const onHandleUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const onHandleKey = (
    event: React.KeyboardEvent<HTMLDivElement>,
    above: string,
    below: string,
  ): void => {
    const by = event.key === "ArrowUp" ? -KEY_STEP_PX : event.key === "ArrowDown" ? KEY_STEP_PX : 0;
    if (by === 0) return;
    event.preventDefault();
    const a = panels.current.get(above);
    const b = panels.current.get(below);
    if (!a || !b) return;
    resize(
      above,
      below,
      a.getBoundingClientRect().height,
      b.getBoundingClientRect().height,
      by,
    );
  };

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {artifacts.map((artifact, i) => {
        const open = artifact.pinned === true || isOpen(artifact.id);
        // The nearest open panel above, which is the one this panel would
        // trade height with. Collapsed panels in between are headers with no
        // height to give.
        const above = artifacts
          .slice(0, i)
          .reverse()
          .find((a) => isOpen(a.id));

        return (
          // The weight lives on this wrapper rather than on the panel itself:
          // it is the wrapper that is a child of the stack's flex column, and
          // a flex-grow set one level too deep grows nothing.
          <div
            key={artifact.id}
            ref={(node) => {
              if (node) panels.current.set(artifact.id, node);
              else panels.current.delete(artifact.id);
            }}
            className={cn("flex min-h-0 flex-col gap-2", !open && "shrink-0")}
            style={
              open
                ? {
                    flexGrow: weights[artifact.id] ?? 1,
                    flexBasis: 0,
                    minHeight: artifact.minOpenPx,
                  }
                : undefined
            }
          >
            {open && above && (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={`Resize ${above.label} and ${artifact.label}`}
                tabIndex={0}
                className="hover:bg-primary/40 active:bg-primary/60 focus-visible:bg-primary/60 -my-1 h-2 shrink-0 cursor-row-resize touch-none rounded-full transition-colors"
                onPointerDown={(e) => onHandleDown(e, above.id, artifact.id)}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
                onKeyDown={(e) => onHandleKey(e, above.id, artifact.id)}
              />
            )}

            <section
              aria-label={artifact.label}
              className={cn(
                "border-border bg-card flex min-h-0 flex-col overflow-hidden rounded-xl border",
                open && "flex-1",
              )}
            >
              <StackHeader onPopOut={artifact.onPopOut}>
                {artifact.pinned ? (
                  // No control at all rather than a disabled one: a greyed-out
                  // chevron invites a click that will never do anything.
                  <span className="w-1.5" aria-hidden="true" />
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={open ? `Collapse ${artifact.label}` : `Expand ${artifact.label}`}
                    aria-expanded={open}
                    onClick={() => toggle(artifact.id)}
                  >
                    <ChevronDownIcon
                      className={cn("transition-transform", !open && "-rotate-90")}
                    />
                  </Button>
                )}
                {artifact.icon && (
                  <artifact.icon
                    className="text-muted-foreground size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                )}
                {/* Tools in `trailing` need the leftover width; without them
                    the title still fills the row so Prompt/Script/Library
                    headers do not collapse to their text. */}
                <div className={cn("min-w-0", artifact.trailing ? "shrink-0" : "flex-1")}>
                  {artifact.title}
                </div>
                {artifact.trailing != null && (
                  <div className="flex min-w-0 flex-1 overflow-x-auto">{artifact.trailing}</div>
                )}
                {artifact.onPopOut && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Open ${artifact.label} in a new window`}
                    title="Open in a new window"
                    onClick={(e) => {
                      const rect = e.currentTarget.closest("section")?.getBoundingClientRect();
                      artifact.onPopOut?.({
                        left: rect ? window.screenX + rect.left : undefined,
                        top: rect ? window.screenY + rect.top : undefined,
                        width: rect?.width ?? 640,
                        height: rect?.height ?? 480,
                      });
                    }}
                  >
                    <ExternalLinkIcon />
                  </Button>
                )}
                {artifact.onClose && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Close ${artifact.label}`}
                    onClick={artifact.onClose}
                  >
                    <XIcon />
                  </Button>
                )}
              </StackHeader>

              {/* Hidden, not unmounted — see the note at the top of the file. */}
              <div
                className={cn(
                  "border-border/60 min-h-0 flex-1 flex-col border-t",
                  open ? "flex" : "hidden",
                )}
              >
                {artifact.body}
              </div>
            </section>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A panel's header row, which is also where you pick the panel up to drag it
 * out of the window. A header with nowhere to go is just a row.
 */
function StackHeader({
  onPopOut,
  children,
}: {
  onPopOut?: (at: PopOutAt) => void;
  children: ReactNode;
}) {
  const { outside, handlers } = useDragOut(onPopOut);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 px-2 py-1.5",
        onPopOut && "touch-none select-none",
        outside && "bg-primary/10 ring-primary ring-2 ring-inset",
      )}
      {...handlers}
    >
      {children}
    </div>
  );
}
