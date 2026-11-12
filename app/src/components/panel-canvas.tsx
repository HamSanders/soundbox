/**
 * The studio's panels as windows on a canvas, rather than a column layout.
 *
 * The columns decide for you: the chat on the left, the timeline in the
 * middle, the shelves on the right, each a share of the width. That is a good
 * start and a poor fit for some work — a mixer you want beside the timeline
 * rather than under it, a library as tall as the window, the piano roll big
 * while the script is small. Here every panel is a card you put where you
 * want it and make the size you want it.
 *
 * Positions snap to a grid so cards line up without effort; hold Alt while
 * dragging to place one freely. Drag a card's header past the edge of the
 * window and it becomes a window of its own (see `lib/popout.ts`).
 *
 * The arrangement is remembered per builder in this browser, like the device
 * chains: it is how you like to work, not part of the story.
 *
 * Bodies follow the stack's rule: a card that moves is the same mounted panel
 * in a new place, so dragging the timeline does not stop playback.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ExternalLinkIcon, GripVerticalIcon, XIcon } from "lucide-react";

import type { Artifact } from "@/components/artifact-stack";
import { Button } from "@/components/ui/button";
import { NOT_A_GRIP, isOutsideWindow, type PopOutAt } from "@/lib/popout";
import { cn } from "@/lib/utils";

/** The grid every edge snaps to, in pixels. Also the gap tidying leaves. */
const GRID = 16;
const MIN_W = GRID * 15;
const MIN_H = GRID * 8;
/** Room past the furthest card, so there is always somewhere to drag to. */
const SLACK = GRID * 8;

export interface CanvasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a panel sits when the canvas lays itself out: the column it has in
 *  the column layout, so the first canvas you see is the studio you know. */
export type CanvasColumn = 0 | 1 | 2;

interface Layout {
  rects: Record<string, CanvasRect>;
  /** Back to front. */
  order: string[];
}

const snap = (n: number, free: boolean): number => (free ? Math.round(n) : Math.round(n / GRID) * GRID);

function storageKey(key: string): string {
  return `konchi.studio-canvas.${key}`;
}

function loadLayout(key: string): Layout {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Layout>;
      return { rects: parsed.rects ?? {}, order: parsed.order ?? [] };
    }
  } catch {
    /* unreadable or blocked: start from a tidy canvas */
  }
  return { rects: {}, order: [] };
}

/**
 * The column layout, as rectangles: a quarter, a half, a quarter, each column
 * shared top to bottom by the panels' weights. What "Tidy" puts back.
 */
function tileLayout(
  artifacts: Artifact[],
  columnOf: (id: string) => CanvasColumn,
  width: number,
  height: number,
): Record<string, CanvasRect> {
  // Only the columns that have something in them: with no chat the left
  // quarter goes to the middle, as it does in the column layout.
  const used = ([0, 1, 2] as const).filter((c) => artifacts.some((a) => columnOf(a.id) === c));
  const gaps = GRID * (used.length + 1);
  const usable = Math.max(width, MIN_W * used.length + gaps);
  const quarter = snap(Math.max(MIN_W, (usable - gaps) / 4), false);
  const sides = used.filter((c) => c !== 1).length;
  const ws: number[] = [quarter, snap(usable - gaps - quarter * sides, false), quarter];
  if (!used.includes(1)) {
    // No middle: the sides share the width.
    ws[0] = ws[2] = snap((usable - gaps) / Math.max(1, sides), false);
  }
  const xs: number[] = [];
  let x = GRID;
  for (const c of used) {
    xs[c] = x;
    x += ws[c] + GRID;
  }
  const rects: Record<string, CanvasRect> = {};
  for (const column of used) {
    const items = artifacts.filter((a) => columnOf(a.id) === column);
    if (items.length === 0) continue;
    const free = Math.max(height - GRID * (items.length + 1), items.length * MIN_H);
    const total = items.reduce((sum, a) => sum + (a.defaultWeight ?? 1), 0);
    let y = GRID;
    for (const a of items) {
      const share = (free * (a.defaultWeight ?? 1)) / total;
      const h = snap(Math.max(share, a.minOpenPx ?? 0, MIN_H), false);
      rects[a.id] = { x: xs[column], y, w: ws[column], h };
      y += h + GRID;
    }
  }
  return rects;
}

export function PanelCanvas({
  artifacts,
  layoutKey,
  columnOf,
  onPopOut,
  tidyRequest,
  className,
}: {
  artifacts: Artifact[];
  /** Which remembered arrangement this is — one per builder. */
  layoutKey: string;
  columnOf: (id: string) => CanvasColumn;
  /** A card dragged out of the window, or its pop-out button pressed. */
  onPopOut?: (id: string, at: PopOutAt) => void;
  /** Bumped to ask for the column layout back. A counter, like the
   *  timeline's record request: two in a row must both be heard. */
  tidyRequest?: number;
  className?: string;
}) {
  const [layout, setLayout] = useState<Layout>(() => loadLayout(layoutKey));
  const viewport = useRef<HTMLDivElement>(null);
  /** How many cards have been placed without a home, so each new one lands a
   *  step down and right of the last instead of exactly on top of it. */
  const cascade = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(layoutKey), JSON.stringify(layout));
    } catch {
      /* the arrangement lasts the session */
    }
  }, [layoutKey, layout]);

  const tile = (only?: Artifact[]): Record<string, CanvasRect> => {
    const el = viewport.current;
    return tileLayout(only ?? artifacts, columnOf, el?.clientWidth ?? 1200, el?.clientHeight ?? 800);
  };

  // Give every card that has never been placed somewhere to be. An empty
  // canvas is laid out like the columns; a panel opened onto an arranged
  // canvas appears where you are looking, on top.
  const homeless = artifacts.filter((a) => !(a.id in layout.rects));
  useLayoutEffect(() => {
    if (homeless.length === 0) return;
    // "Placed" means a card on screen already has a spot, not that some
    // panel once did: positions of closed panels are kept for when they
    // come back, and should not stop an otherwise empty canvas tiling.
    const placed = artifacts.some((a) => a.id in layout.rects);
    const el = viewport.current;
    const fresh: Record<string, CanvasRect> = placed
      ? Object.fromEntries(
          homeless.map((a) => {
            const step = (cascade.current++ % 8) * GRID * 2;
            const w = snap(Math.min(GRID * 36, (el?.clientWidth ?? 800) - GRID * 4), false);
            const h = snap(Math.max(GRID * 22, a.minOpenPx ?? 0), false);
            return [
              a.id,
              {
                x: snap((el?.scrollLeft ?? 0) + GRID * 3 + step, false),
                y: snap((el?.scrollTop ?? 0) + GRID * 3 + step, false),
                w: Math.max(MIN_W, w),
                h,
              },
            ];
          }),
        )
      : tile();
    setLayout((prev) => ({
      rects: { ...fresh, ...prev.rects },
      order: [...prev.order.filter((id) => !(id in fresh)), ...Object.keys(fresh)],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the set of unplaced cards only
  }, [homeless.map((a) => a.id).join(",")]);

  const lastTidy = useRef(tidyRequest ?? 0);
  useEffect(() => {
    if (tidyRequest === undefined || tidyRequest === lastTidy.current) return;
    lastTidy.current = tidyRequest;
    viewport.current?.scrollTo({ left: 0, top: 0 });
    setLayout((prev) => ({ ...prev, rects: { ...prev.rects, ...tile() } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- an event, not a dependency
  }, [tidyRequest]);

  const raise = (id: string): void =>
    setLayout((prev) =>
      prev.order[prev.order.length - 1] === id
        ? prev
        : { ...prev, order: [...prev.order.filter((o) => o !== id), id] },
    );

  const setRect = (id: string, rect: CanvasRect): void =>
    setLayout((prev) => ({ ...prev, rects: { ...prev.rects, [id]: rect } }));

  /* ---------------------------------------------------------------- moving */

  const gesture = useRef<{
    id: string;
    pointerId: number;
    kind: "move" | "resize";
    startX: number;
    startY: number;
    start: CanvasRect;
    edges: { right: boolean; bottom: boolean };
  } | null>(null);
  /** The card being dragged is past the window's edge: letting go pops it out. */
  const [outside, setOutside] = useState<string | null>(null);

  const begin = (
    event: React.PointerEvent<HTMLElement>,
    id: string,
    kind: "move" | "resize",
    edges = { right: true, bottom: true },
  ): void => {
    if (event.button !== 0) return;
    if (kind === "move" && (event.target as Element).closest(NOT_A_GRIP)) return;
    const start = layout.rects[id];
    if (!start) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    raise(id);
    gesture.current = {
      id,
      pointerId: event.pointerId,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      start,
      edges,
    };
  };

  const track = (event: React.PointerEvent<HTMLElement>): void => {
    const g = gesture.current;
    if (g === null || g.pointerId !== event.pointerId) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    const free = event.altKey;
    const minH = Math.max(MIN_H, artifacts.find((a) => a.id === g.id)?.minOpenPx ?? 0);
    if (g.kind === "move") {
      const leaving = Boolean(onPopOut) && isOutsideWindow(event);
      setOutside(leaving ? g.id : null);
      // Past the edge the card stays where it last was, inside the window,
      // saying what letting go will do — rather than sliding off the canvas
      // where you cannot see it.
      if (leaving) return;
      setRect(g.id, {
        ...g.start,
        x: Math.max(0, snap(g.start.x + dx, free)),
        y: Math.max(0, snap(g.start.y + dy, free)),
      });
    } else {
      setRect(g.id, {
        ...g.start,
        w: g.edges.right ? Math.max(MIN_W, snap(g.start.w + dx, free)) : g.start.w,
        h: g.edges.bottom ? Math.max(minH, snap(g.start.h + dy, free)) : g.start.h,
      });
    }
  };

  const end = (event: React.PointerEvent<HTMLElement>): void => {
    const g = gesture.current;
    if (g === null || g.pointerId !== event.pointerId) return;
    gesture.current = null;
    setOutside(null);
    if (g.kind === "move" && onPopOut && event.type === "pointerup" && isOutsideWindow(event)) {
      // The card goes back where it was picked up from, so putting the
      // window back returns it to its place rather than to the edge it was
      // dragged across.
      setRect(g.id, g.start);
      onPopOut(g.id, {
        left: event.screenX - (g.startX - cardLeft(g.id)),
        top: event.screenY - (g.startY - cardTop(g.id)),
        width: g.start.w,
        height: g.start.h,
      });
    }
  };

  /** Where a card's top-left corner was on screen when the drag started, in
   *  client pixels, so the window opens with the same grip under the pointer. */
  const cards = useRef(new Map<string, HTMLElement>());
  const origin = useRef(new Map<string, { left: number; top: number }>());
  const cardLeft = (id: string): number => origin.current.get(id)?.left ?? 0;
  const cardTop = (id: string): number => origin.current.get(id)?.top ?? 0;
  const remember = (id: string): void => {
    const rect = cards.current.get(id)?.getBoundingClientRect();
    if (rect) origin.current.set(id, { left: rect.left, top: rect.top });
  };

  /** Arrow keys on a focused header move the card a grid step; with Shift
   *  they resize it. The canvas is not a pointer-only surface. */
  const onHeaderKey = (event: React.KeyboardEvent<HTMLElement>, id: string): void => {
    if ((event.target as Element).closest(NOT_A_GRIP)) return;
    const dx = event.key === "ArrowLeft" ? -GRID : event.key === "ArrowRight" ? GRID : 0;
    const dy = event.key === "ArrowUp" ? -GRID : event.key === "ArrowDown" ? GRID : 0;
    if (dx === 0 && dy === 0) return;
    const rect = layout.rects[id];
    if (!rect) return;
    event.preventDefault();
    raise(id);
    const minH = Math.max(MIN_H, artifacts.find((a) => a.id === id)?.minOpenPx ?? 0);
    setRect(
      id,
      event.shiftKey
        ? { ...rect, w: Math.max(MIN_W, rect.w + dx), h: Math.max(minH, rect.h + dy) }
        : { ...rect, x: Math.max(0, rect.x + dx), y: Math.max(0, rect.y + dy) },
    );
  };

  const visible = artifacts.filter((a) => a.id in layout.rects);
  const extentW = Math.max(0, ...visible.map((a) => layout.rects[a.id].x + layout.rects[a.id].w)) + SLACK;
  const extentH = Math.max(0, ...visible.map((a) => layout.rects[a.id].y + layout.rects[a.id].h)) + SLACK;
  const z = (id: string): number => Math.max(0, layout.order.indexOf(id)) + 1;

  return (
    <div
      ref={viewport}
      className={cn(
        "border-border/60 relative min-h-0 flex-1 overflow-auto rounded-xl border",
        className,
      )}
      style={{
        backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
        backgroundSize: `${GRID}px ${GRID}px`,
        backgroundPosition: `-${GRID / 2}px -${GRID / 2}px`,
        backgroundAttachment: "local",
      }}
    >
      {/* Sizes the scroll area to the furthest card, so a card dragged off
          to the right or the bottom can be scrolled to and dragged back. */}
      <div aria-hidden="true" style={{ width: extentW, height: extentH }} />

      {visible.map((artifact) => {
        const rect = layout.rects[artifact.id];
        const front = layout.order[layout.order.length - 1] === artifact.id;
        return (
          // The frame and its resize handles are siblings inside an unclipped
          // box: inside the card's own `overflow-hidden` the rounded corner
          // clipped the corner handle out of reach.
          <div
            key={artifact.id}
            ref={(node) => {
              if (node) cards.current.set(artifact.id, node);
              else cards.current.delete(artifact.id);
            }}
            className="absolute"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: z(artifact.id) }}
            onPointerDownCapture={() => raise(artifact.id)}
          >
          <section
            aria-label={artifact.label}
            className={cn(
              "border-border bg-card flex h-full flex-col overflow-hidden rounded-xl border transition-shadow",
              front ? "shadow-lg" : "shadow-sm",
              outside === artifact.id && "ring-primary opacity-70 ring-2",
            )}
          >
            <div
              // The header is the grip. Focusable so the arrow keys can move
              // the card; its own buttons are excluded by `NOT_A_GRIP`.
              tabIndex={0}
              aria-roledescription="movable panel header"
              aria-label={`${artifact.label}. Arrow keys move it, Shift and arrow keys resize it.`}
              className="focus-visible:ring-ring/60 flex shrink-0 cursor-grab touch-none items-center gap-2 px-2 py-1.5 outline-none select-none focus-visible:ring-2 focus-visible:ring-inset active:cursor-grabbing"
              onPointerDown={(e) => {
                remember(artifact.id);
                begin(e, artifact.id, "move");
              }}
              onPointerMove={track}
              onPointerUp={end}
              onPointerCancel={end}
              onKeyDown={(e) => onHeaderKey(e, artifact.id)}
            >
              <GripVerticalIcon className="text-muted-foreground/60 size-3.5 shrink-0" aria-hidden="true" />
              {artifact.icon && (
                <artifact.icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
              )}
              <div className={cn("min-w-0", artifact.trailing ? "shrink-0" : "flex-1")}>
                {outside === artifact.id ? (
                  <span className="text-primary text-xs font-medium">Release to open in a new window</span>
                ) : (
                  artifact.title
                )}
              </div>
              {artifact.trailing != null && (
                <div className="flex min-w-0 flex-1 cursor-auto overflow-x-auto" data-no-grip>
                  {artifact.trailing}
                </div>
              )}
              {onPopOut && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Open ${artifact.label} in a new window`}
                  title="Open in a new window"
                  onClick={(e) => {
                    const card = e.currentTarget.closest("section")?.getBoundingClientRect();
                    onPopOut(artifact.id, {
                      left: card ? window.screenX + card.left : undefined,
                      top: card ? window.screenY + card.top : undefined,
                      width: rect.w,
                      height: rect.h,
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
            </div>
            <div className="border-border/60 flex min-h-0 flex-1 flex-col border-t">{artifact.body}</div>
          </section>

            {/* Resize from the right edge, the bottom edge, or the corner. */}
            <div
              aria-hidden="true"
              className="absolute top-3 -right-1 bottom-3 w-2 cursor-ew-resize touch-none"
              onPointerDown={(e) => begin(e, artifact.id, "resize", { right: true, bottom: false })}
              onPointerMove={track}
              onPointerUp={end}
              onPointerCancel={end}
            />
            <div
              aria-hidden="true"
              className="absolute right-3 -bottom-1 left-3 h-2 cursor-ns-resize touch-none"
              onPointerDown={(e) => begin(e, artifact.id, "resize", { right: false, bottom: true })}
              onPointerMove={track}
              onPointerUp={end}
              onPointerCancel={end}
            />
            <div
              aria-hidden="true"
              className="hover:bg-primary/40 absolute -right-1 -bottom-1 size-4 cursor-nwse-resize touch-none rounded-full"
              onPointerDown={(e) => begin(e, artifact.id, "resize")}
              onPointerMove={track}
              onPointerUp={end}
              onPointerCancel={end}
            />
          </div>
        );
      })}
    </div>
  );
}
