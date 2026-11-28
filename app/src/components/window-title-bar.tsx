/**
 * The desktop app's title bar: one strip across the top of the window that
 * is both the window's frame and the app's header.
 *
 * The window has no native frame on Windows and Linux (see `decorations` in
 * src-tauri/src/lib.rs), so this bar is what you drag, double-click to
 * maximize, and minimize, maximize and close from. On macOS the native traffic
 * lights stay, laid over the left end of this bar, which leaves them room.
 *
 * Left to right: the sidebar button, back and forward, then
 * where you are (the breadcrumb) and whatever the open page puts in the bar,
 * then the queue, search, and the window buttons. Everything that is not a
 * control is drag space. There is no logo: whoever is looking at this window
 * already installed the app. The way home is the sidebar's Home entry.
 *
 * Only rendered in the desktop app (`isDesktop()`); a browser keeps
 * `AppHeader` inside the page panel.
 */

import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { CopyIcon, MinusIcon, SearchIcon, SquareIcon, XIcon } from "@/lib/icons";

import { Breadcrumb, HistoryButtons } from "@/components/app-header";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/components/app-command-palette";
import { HeaderSlot } from "@/components/header-slot";
import { QueueIndicator } from "@/components/queue-indicator";
import { SidebarButton } from "@/components/sidebar-peek";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { appWindow, desktopPlatform } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/** Height of the bar. Windows' own standard title bar is 32px and its "tall"
 *  one, for bars that hold controls, is 48px
 *  (learn.microsoft.com/windows/apps/design/basics/titlebar-design); this bar
 *  holds icon buttons, so it sits between the two. */
export const WINDOW_TITLE_BAR_HEIGHT_PX = 40;

/** Room left for macOS's traffic lights at the bar's left end. */
const MAC_TRAFFIC_LIGHTS_PX = 76;

/** Whatever you can click, type in or select: a press there is not a drag. */
const INTERACTIVE =
  'button, a, input, textarea, select, [role="button"], [role="menuitem"], [role="tab"], [contenteditable="true"], [data-no-drag]';

export function WindowTitleBar() {
  const mac = desktopPlatform() === "macos";
  const open = useSidebar().state === "expanded";

  // Moving the window, by hand rather than with `data-tauri-drag-region`:
  // that attribute only counts on the exact element that carries it, so every
  // wrapper and the breadcrumb's spans would each need it. Here any press that
  // lands on the bar and not on a control starts a drag, and a double press
  // maximizes, the way a native title bar does. `detail` counts the clicks;
  // waiting for `dblclick` does not work, because the drag the first press
  // starts swallows the second.
  const onMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if ((event.target as Element).closest(INTERACTIVE)) return;
    event.preventDefault();
    void appWindow().then((w) => (event.detail === 2 ? w.toggleMaximize() : w.startDragging()));
  };

  return (
    <header
      data-slot="window-title-bar"
      onMouseDown={onMouseDown}
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex h-(--top-h) items-center gap-1 select-none",
        // The sidebar button's icon sits straight above the sidebar's own
        // icons. The button is 28px with a 16px icon, so the icon starts 6px
        // in: 18px of padding puts it at 24px, where the rail's icons are
        // (8px sidebar padding, 8px group padding, 8px inside each button),
        // and 20px at 26px, where they move to when the sidebar is open.
        mac ? "pr-2" : open ? "pl-5" : "pl-4.5",
      )}
      style={mac ? { paddingLeft: MAC_TRAFFIC_LIGHTS_PX } : undefined}
    >
      {/* gap-3: with the sidebar folded to its rail, the page panel's left
          edge is at 64px, and 12px after the sidebar button (which ends at
          46px) puts the back button's icon exactly there. */}
      <div className="flex shrink-0 items-center gap-3">
        <SidebarButton />
        <HistoryButtons />
      </div>

      <Breadcrumb className="ml-1 shrink-0" />

      {/* What the open page wants up here. Its empty space is drag space too:
          the press lands on the slot's own div, which is not a control. */}
      <HeaderSlot />

      <div className="flex shrink-0 items-center gap-1">
        <QueueIndicator />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Search"
          title="Search (Ctrl K)"
          onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
        >
          <SearchIcon />
        </Button>
      </div>

      {!mac && <WindowButtons />}
    </header>
  );
}

/**
 * Minimize, maximize or restore, close, drawn the way Windows 11 draws its
 * own: full-height, 46px-wide backplates flush with the window's top right
 * corner, Segoe Fluent's caption glyphs, and red only for close.
 *
 * Hovering maximize does not open Snap Layouts: WebView2 covers the spot
 * Windows would ask (tauri-apps/tauri#4531). Dragging to a screen edge still
 * snaps.
 */
function WindowButtons() {
  const maximized = useMaximized();
  // Segoe Fluent Icons ships with Windows 11 and Segoe MDL2 Assets with 10;
  // the same code points draw the caption glyphs in both. Linux has neither,
  // so it gets Lucide's nearest shapes.
  const windows = desktopPlatform() === "windows";
  const call = (fn: "minimize" | "toggleMaximize" | "close") => () =>
    void appWindow().then((w) => w[fn]());
  return (
    <div className="ml-1 flex h-full shrink-0 self-start">
      <CaptionButton label="Minimize" onClick={call("minimize")}>
        {windows ? "" : <MinusIcon className="size-4" />}
      </CaptionButton>
      <CaptionButton label={maximized ? "Restore" : "Maximize"} onClick={call("toggleMaximize")}>
        {windows ? (
          maximized ? "" : ""
        ) : maximized ? (
          <CopyIcon className="size-3.5" />
        ) : (
          <SquareIcon className="size-3.5" />
        )}
      </CaptionButton>
      <CaptionButton label="Close" onClick={call("close")} close>
        {windows ? "" : <XIcon className="size-4" />}
      </CaptionButton>
    </div>
  );
}

function CaptionButton({
  label,
  onClick,
  close = false,
  children,
}: {
  label: string;
  onClick: () => void;
  close?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "text-foreground/80 flex h-full w-[46px] items-center justify-center text-[10px] transition-colors duration-100",
        "font-['Segoe_Fluent_Icons','Segoe_MDL2_Assets']",
        close
          ? "hover:bg-[#c42b1c] hover:text-white active:bg-[#c42b1c]/90"
          : "hover:bg-foreground/10 active:bg-foreground/15",
      )}
    >
      <span aria-hidden="true" className="flex items-center">
        {children}
      </span>
    </button>
  );
}

/** Is the window maximized? Read once, then again on every resize, which is
 *  when it can change (the bar's own button, a double-click, Win+Up, a snap). */
function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void appWindow().then(async (w) => {
      const read = () => void w.isMaximized().then((m) => !cancelled && setMaximized(m));
      read();
      const off = await w.onResized(read);
      if (cancelled) off();
      else unlisten = off;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  return maximized;
}
