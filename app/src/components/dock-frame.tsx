/**
 * The docked panel's frame: the aside beside the page, with its resize
 * handle. Each kind of item (see detail-dock.tsx) draws its own header and
 * body inside it.
 */

import { useEffect, useRef, type ReactNode } from "react";

import { usePanelWidth } from "@/hooks/use-panel-width";

export function DockFrame({
  label,
  widthId,
  itemKey,
  children,
}: {
  /** Names the region: "Details for …". */
  label: string;
  /** Keeps each kind's dragged width apart, as when each had its own panel. */
  widthId: string;
  /** Moves focus to the panel when it changes. */
  itemKey: string;
  children: ReactNode;
}) {
  const panel = usePanelWidth({ id: widthId, initial: 416, min: 320, max: 720, edge: "left" });
  const ref = useRef<HTMLElement>(null);

  // Focus moves into the panel when it opens or shows another item, unless
  // something inside already took it (a name opening as a field). Children's
  // effects run first, so that one has had its turn.
  useEffect(() => {
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [itemKey]);

  return (
    <aside
      ref={ref}
      data-detail-dock=""
      tabIndex={-1}
      aria-label={label}
      className="bg-background ring-border animate-in fade-in-0 slide-in-from-right-8 fixed inset-x-0 top-(--top-h,0px) bottom-(--dock-h,0px) z-30 flex flex-col duration-(--duration-base) outline-none md:static md:z-auto md:my-2 md:mr-2 md:relative md:h-(--panel-h) md:w-(--panel-w) md:shrink-0 md:rounded-xl md:ring-1"
      style={panel.style}
    >
      {panel.handle}
      {children}
    </aside>
  );
}
