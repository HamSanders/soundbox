/**
 * The frame the chapter timeline docks into, along the bottom of the editor:
 * a bar you drag to resize and a button that folds it away. Its height and
 * whether it's open are remembered in this browser.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, GanttChartIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KEY = "mirli.audiobook.timeline";
const MIN = 140;
const DEFAULT = 260;

function load(): { open: boolean; height: number } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as { open?: unknown; height?: unknown } | null;
    return {
      open: typeof v?.open === "boolean" ? v.open : true,
      height: typeof v?.height === "number" ? v.height : DEFAULT,
    };
  } catch {
    return { open: true, height: DEFAULT };
  }
}

function save(state: { open: boolean; height: number }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private windows and blocked storage: it just won't be remembered.
  }
}

export function TimelineDock({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  const [state, setState] = useState(load);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const max = () => Math.max(MIN, Math.round(window.innerHeight * 0.7));

  useEffect(() => save(state), [state]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!drag.current) return;
    const height = Math.min(max(), Math.max(MIN, drag.current.height + (drag.current.y - e.clientY)));
    setState((s) => ({ ...s, height }));
  }, []);
  const onPointerUp = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);
  useEffect(() => onPointerUp, [onPointerUp]);

  const toggle = () => setState((s) => ({ ...s, open: !s.open }));

  return (
    <section
      aria-label="Chapter timeline"
      className={cn("bg-card border-border/70 flex shrink-0 flex-col overflow-hidden rounded-xl border", className)}
      style={state.open ? { height: Math.min(state.height, max()) } : undefined}
    >
      {state.open && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the timeline"
          aria-valuemin={MIN}
          aria-valuemax={max()}
          aria-valuenow={state.height}
          tabIndex={0}
          className="hover:bg-muted focus-visible:bg-muted flex h-2 shrink-0 cursor-row-resize items-center justify-center outline-none"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, height: state.height };
            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", onPointerUp);
          }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            const step = e.key === "ArrowUp" ? 24 : -24;
            setState((s) => ({ ...s, height: Math.min(max(), Math.max(MIN, s.height + step)) }));
          }}
        >
          <span className="bg-border h-1 w-10 rounded-full" />
        </div>
      )}
      <div className="flex shrink-0 items-center gap-2 px-3 py-1">
        <GanttChartIcon className="text-muted-foreground size-4" />
        <span className="text-sm font-medium">Timeline</span>
        <span className="text-muted-foreground truncate text-xs">{title}</span>
        <Button
          size="icon-xs"
          variant="ghost"
          className="ml-auto"
          aria-label={state.open ? "Hide the timeline" : "Show the timeline"}
          aria-expanded={state.open}
          onClick={toggle}
        >
          {state.open ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </Button>
      </div>
      {state.open && <div className="min-h-0 flex-1 overflow-hidden">{children}</div>}
    </section>
  );
}
