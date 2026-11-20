/**
 * A shell panel whose width you can drag, the way the Studio's panes resize.
 *
 * Returns the width to apply (as the `--panel-w` CSS variable, so narrow
 * windows can ignore it) and a handle to render on the panel's inner edge.
 * The width is remembered per panel; double-click the handle to reset it;
 * arrow keys nudge it when the handle has focus.
 */

import { useCallback, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

function read(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function usePanelWidth({
  id,
  initial,
  min,
  max,
  edge,
}: {
  id: string;
  initial: number;
  min: number;
  max: number;
  /** Which edge the handle sits on: the one facing the page. */
  edge: "left" | "right";
}) {
  const key = `mirli.panel.${id}`;
  const [width, setWidth] = useState(() => Math.min(max, Math.max(min, read(key, initial))));
  const start = useRef<{ x: number; w: number } | null>(null);

  const commit = useCallback(
    (w: number) => {
      const c = Math.round(Math.min(max, Math.max(min, w)));
      setWidth(c);
      try {
        localStorage.setItem(key, String(c));
      } catch {
        /* storage blocked: the width still applies for this session */
      }
    },
    [key, min, max],
  );

  const style = { "--panel-w": `${width}px` } as CSSProperties;

  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className={cn(
        "group/handle absolute inset-y-3 z-20 hidden w-2 cursor-col-resize touch-none outline-none md:block",
        edge === "left" ? "-left-[5px]" : "-right-[5px]",
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        commit(start.current.w + (edge === "left" ? -dx : dx));
      }}
      onPointerUp={(e) => {
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onDoubleClick={() => commit(initial)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        const grow = edge === "left" ? "ArrowLeft" : "ArrowRight";
        const shrink = edge === "left" ? "ArrowRight" : "ArrowLeft";
        if (e.key === grow) commit(width + step);
        else if (e.key === shrink) commit(width - step);
        else return;
        e.preventDefault();
      }}
    >
      <span className="bg-border-strong group-hover/handle:bg-foreground group-focus-visible/handle:bg-foreground mx-auto block h-full w-px opacity-0 transition-opacity group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100" />
    </div>
  );

  return { style, handle };
}
