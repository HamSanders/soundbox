/**
 * The sidebar on pages that hide it completely.
 *
 * Most pages fold the sidebar to its icon rail at most. A studio is different:
 * the timeline wants every pixel, so there the sidebar is gone entirely, not
 * even a rail. It comes back as a *peek*: it slides in over the page, without
 * pushing the page aside, when you hover the window's left edge or press the
 * sidebar button in the top bar, and it goes away again when you leave it,
 * press Escape, click back on the page, or pick somewhere to go.
 *
 * The sidebar button is the one control for both kinds of page, so the bar
 * never shows two: on an ordinary page it folds and unfolds the sidebar; on a
 * page where the sidebar is fully hidden it peeks it.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { MenuIcon } from "@/lib/icons";
import { create } from "zustand";

import { Button } from "@/components/ui/button";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

/** Pages where the sidebar hides completely instead of folding to a rail. */
export function hidesSidebar(pathname: string): boolean {
  return pathname.startsWith("/studio/");
}

/** Is the sidebar fully out of sight right now? Only then is there anything
 *  to peek. (Someone with "keep the sidebar expanded" on has it open even in
 *  a studio, and phones have their own sheet.) */
export function useSidebarFullyHidden(): boolean {
  const { pathname } = useLocation();
  const { state, isMobile } = useSidebar();
  return !isMobile && hidesSidebar(pathname) && state === "collapsed";
}

export const useSidebarPeek = create<{ peek: boolean; setPeek: (peek: boolean) => void }>((set) => ({
  peek: false,
  setPeek: (peek) => set({ peek }),
}));

/** How long the pointer rests on the edge before the sidebar comes out, so
 *  sweeping past the edge on the way somewhere else does not open it. */
const OPEN_DELAY_MS = 120;
/** How long it waits after the pointer leaves before going away, so a slip off
 *  its edge does not snap it shut. */
const CLOSE_DELAY_MS = 250;

/** The one sidebar button the top bar shows. */
export function SidebarButton() {
  const fullyHidden = useSidebarFullyHidden();
  const peek = useSidebarPeek((s) => s.peek);
  const setPeek = useSidebarPeek((s) => s.setPeek);
  if (!fullyHidden) return <SidebarTrigger />;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={peek ? "Hide sidebar" : "Show sidebar"}
      aria-expanded={peek}
      data-sidebar-peek-toggle=""
      onClick={() => setPeek(!peek)}
    >
      <MenuIcon />
    </Button>
  );
}

/**
 * The hover strip along the window's left edge, and the rules for putting
 * the peek away. Rendered once by the shell; draws nothing unless the sidebar
 * is fully hidden.
 */
export function SidebarPeekEdge() {
  const fullyHidden = useSidebarFullyHidden();
  const peek = useSidebarPeek((s) => s.peek);
  const setPeek = useSidebarPeek((s) => s.setPeek);
  const { pathname } = useLocation();
  const timer = useRef<number | undefined>(undefined);

  // Going somewhere puts it away, and so does the page no longer hiding it.
  useEffect(() => {
    setPeek(false);
  }, [pathname, setPeek]);
  useEffect(() => {
    if (!fullyHidden) setPeek(false);
  }, [fullyHidden, setPeek]);

  // Leaving it, Escape, or a click anywhere outside it.
  useEffect(() => {
    if (!peek) return;
    const container = document.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
    const onLeave = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setPeek(false), CLOSE_DELAY_MS);
    };
    const onEnter = () => window.clearTimeout(timer.current);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPeek(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (container?.contains(target)) return;
      if (target.closest("[data-sidebar-peek-toggle]")) return;
      // Menus and popovers the sidebar opens render outside it, in portals.
      if (target.closest("[data-radix-popper-content-wrapper], [role=dialog], [role=menu]")) return;
      setPeek(false);
    };
    container?.addEventListener("mouseleave", onLeave);
    container?.addEventListener("mouseenter", onEnter);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.clearTimeout(timer.current);
      container?.removeEventListener("mouseleave", onLeave);
      container?.removeEventListener("mouseenter", onEnter);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [peek, setPeek]);

  if (!fullyHidden || peek) return null;
  return (
    <div
      aria-hidden="true"
      className="fixed top-(--top-h,0px) bottom-(--dock-h,0px) left-0 z-40 w-2"
      onMouseEnter={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setPeek(true), OPEN_DELAY_MS);
      }}
      onMouseLeave={() => window.clearTimeout(timer.current)}
    />
  );
}
