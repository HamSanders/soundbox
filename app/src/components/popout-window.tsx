/**
 * A studio panel in a window of its own — see `lib/popout.ts` for why it is a
 * portal into a blank window rather than a second copy of the app.
 *
 * A blank window has none of the app's styling, so this mirrors it in: every
 * stylesheet in the main document's head (kept in step while Vite hot-swaps
 * them in development), and the theme class on `<html>`, so switching to
 * light mode in the main window switches the panel too.
 *
 * Keyboard shortcuts are forwarded the other way. Every shortcut in the studio
 * listens on the main window, and a key pressed in this one would otherwise
 * reach none of them — Space would not play, Ctrl/⌘Z would not undo.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { PanelLeftCloseIcon, XIcon } from "@/lib/icons";
import type { LucideIcon } from "@/lib/icons";

import { Button } from "@/components/ui/button";
import { closePopoutWindow } from "@/lib/popout";
import { PortalContainerContext } from "@/lib/portal-container";

/** How often to check that the window is still there. `pagehide` is the real
 *  signal; this is for the webviews that do not send it to an opener. */
const CLOSED_POLL_MS = 500;

/** Closes scheduled by an unmount, so a remount can call them off. */
const pendingClose = new WeakMap<Window, number>();

/** Copy every stylesheet the main document has into `target`'s head, replacing
 *  whatever an earlier copy put there. */
function mirrorStyles(target: Document): void {
  target.head
    .querySelectorAll("[data-popout-mirror]")
    .forEach((node) => node.remove());
  document.head
    .querySelectorAll("style, link[rel=stylesheet], meta[name=color-scheme]")
    .forEach((node) => {
      let copy: Element;
      if (node instanceof HTMLLinkElement) {
        // Absolute, so it resolves the same from a blank page.
        const link = target.createElement("link");
        link.rel = "stylesheet";
        link.href = node.href;
        copy = link;
      } else {
        copy = target.importNode(node, true);
      }
      copy.setAttribute("data-popout-mirror", "");
      target.head.appendChild(copy);
    });
}

/** The theme lives in `<html class="dark">` and its inline `color-scheme`. */
function mirrorTheme(target: Document): void {
  target.documentElement.className = document.documentElement.className;
  target.documentElement.style.cssText = document.documentElement.style.cssText;
  target.body.className = document.body.className;
}

/** Fields keep their keys: typing a line in the script must not toggle a
 *  panel. Checked by tag rather than `instanceof`, which fails across
 *  windows — this window's `HTMLInputElement` is not the main one's. */
function isTyping(target: EventTarget | null): boolean {
  if (target === null || !("tagName" in target)) return false;
  const el = target as HTMLElement;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export function PopoutWindow({
  win,
  title,
  onClosed,
  children,
}: {
  win: Window;
  title: string;
  /** The window went away on its own — its close button, the OS, a reload. */
  onClosed: () => void;
  children: ReactNode;
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  // Latest, without re-subscribing to the window on every render.
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useLayoutEffect(() => {
    const doc = win.document;
    // Reusing a window that already held this panel: start from a clean body.
    doc.body.replaceChildren();
    doc.documentElement.lang = document.documentElement.lang;
    mirrorStyles(doc);
    mirrorTheme(doc);
    const el = doc.createElement("div");
    el.className = "bg-background text-foreground flex h-screen flex-col overflow-hidden";
    doc.body.appendChild(el);
    setRoot(el);

    const styles = new MutationObserver(() => mirrorStyles(doc));
    styles.observe(document.head, { childList: true, subtree: true, characterData: true });
    const theme = new MutationObserver(() => mirrorTheme(doc));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });

    const forwardKey = (event: KeyboardEvent): void => {
      if (isTyping(event.target)) return;
      const copy = new KeyboardEvent(event.type, {
        key: event.key,
        code: event.code,
        location: event.location,
        repeat: event.repeat,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(copy);
      // A shortcut the studio handled must not also do the browser's thing
      // in this window — Ctrl/⌘P printing the panel, Space scrolling it.
      if (copy.defaultPrevented) event.preventDefault();
    };
    win.addEventListener("keydown", forwardKey);

    return () => {
      styles.disconnect();
      theme.disconnect();
      win.removeEventListener("keydown", forwardKey);
    };
  }, [win]);

  useEffect(() => {
    win.document.title = title;
  }, [win, title]);

  // Closed by the user, or by the main window going away.
  useEffect(() => {
    let done = false;
    const closed = (): void => {
      if (done) return;
      done = true;
      onClosedRef.current();
    };
    // `pagehide` also fires on the first navigation away from the initial
    // about:blank in some engines, so it is confirmed against `closed`.
    const onHide = (): void => {
      window.setTimeout(() => {
        if (win.closed) closed();
      }, 0);
    };
    win.addEventListener("pagehide", onHide);
    const poll = window.setInterval(() => {
      if (win.closed) closed();
    }, CLOSED_POLL_MS);
    // The studio reloading or navigating away takes its panels with it; a
    // window left behind would be a frame with nothing driving it.
    const closeAll = (): void => closePopoutWindow(win);
    window.addEventListener("pagehide", closeAll);
    return () => {
      done = true;
      win.removeEventListener("pagehide", onHide);
      window.clearInterval(poll);
      window.removeEventListener("pagehide", closeAll);
    };
  }, [win]);

  // Unmounting is the studio taking the panel back (docked, closed, or the
  // studio itself going away), so the window goes too. On the next tick, and
  // cancelled by a remount: StrictMode unmounts and remounts every effect
  // once in development, and closing on the first of those would shut every
  // window the moment it opened.
  useEffect(() => {
    const pending = pendingClose.get(win);
    if (pending !== undefined) window.clearTimeout(pending);
    pendingClose.delete(win);
    return () => {
      pendingClose.set(
        win,
        window.setTimeout(() => {
          pendingClose.delete(win);
          closePopoutWindow(win);
        }, 0),
      );
    };
  }, [win]);

  if (root === null) return null;
  return createPortal(
    <PortalContainerContext.Provider value={root}>{children}</PortalContainerContext.Provider>,
    root,
  );
}

/**
 * A panel's frame in its own window: the same header it wears in the studio,
 * with "put it back" where the pop-out button was.
 */
export function PopoutPanelFrame({
  icon: Icon,
  label,
  title,
  trailing,
  body,
  onDock,
  onClose,
}: {
  icon?: LucideIcon;
  label: string;
  title: ReactNode;
  trailing?: ReactNode;
  body: ReactNode;
  onDock: () => void;
  onClose?: () => void;
}) {
  return (
    <section aria-label={label} className="flex min-h-0 flex-1 flex-col">
      <div className="border-border/60 flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        {Icon && <Icon className="text-muted-foreground ml-1 size-3.5 shrink-0" aria-hidden="true" />}
        <div className={trailing ? "min-w-0 shrink-0" : "min-w-0 flex-1"}>{title}</div>
        {trailing != null && <div className="flex min-w-0 flex-1 overflow-x-auto">{trailing}</div>}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Put ${label} back in the studio`}
          title="Put back in the studio"
          onClick={onDock}
        >
          <PanelLeftCloseIcon />
        </Button>
        {onClose && (
          <Button variant="ghost" size="icon-sm" aria-label={`Close ${label}`} onClick={onClose}>
            <XIcon />
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </section>
  );
}
