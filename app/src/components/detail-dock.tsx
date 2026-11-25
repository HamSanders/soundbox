/**
 * The docked details panel: one inspector for sounds, voices, models and
 * classics, rendered once by the shell beside the page.
 *
 * Like an artifact pane beside a chat, it is a third panel of the shell
 * rather than an overlay: it sits in the same row as the sidebar and the
 * page, with the same margins and gutter, and the page narrows to make room.
 * The list beside it stays live, so another row swaps what it shows and the
 * player keeps working. On a narrow window there is no room beside the page,
 * so it covers it instead.
 *
 * NN/g recommends a nonmodal side panel over a modal for working on one
 * record from a list: "a nonmodal side panel allows for the full display
 * (and editing) of a single record"
 * (https://www.nngroup.com/articles/data-tables/). So it never blocks the
 * page: no overlay, focus moves to the panel when it opens and back to what
 * opened it when it closes, and Escape closes it.
 *
 * What is open lives in `lib/dock.ts` and in the URL (`?detail=kind:id`).
 * Opening from a closed dock adds a history entry, so Back closes the panel;
 * swapping one item for another replaces it. Leaving the page drops the
 * parameter, which closes the panel too.
 */

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ClassicDetailPanel } from "@/components/listen/classic-detail-panel";
import { ModelDetailPanel } from "@/components/model-detail-panel";
import { SoundDetailPanel } from "@/components/sound-detail-panel";
import { VoiceDetailPanel } from "@/components/voice-detail-panel";
import { DETAIL_PARAM, dockKey, parseDock, useDock, type DockItem } from "@/lib/dock";

/** Pushed with the entry that opened the dock, so closing can go Back to
 *  the page as it was instead of stacking another entry. */
interface DockHistoryState {
  dockOpened?: boolean;
}

/** Keeps the store and `?detail=` in step, both ways. */
function useDockUrl() {
  const location = useLocation();
  const navigate = useNavigate();
  const urlKey = new URLSearchParams(location.search).get(DETAIL_PARAM);
  const item = useDock((s) => s.item);
  const key = item ? dockKey(item) : null;
  /** The URL's value as last seen or written, to tell its own changes from ours. */
  const seen = useRef<string | null>(null);

  // The URL moved (Back, Forward, a link, leaving the page): follow it. A
  // value that doesn't parse closes the panel.
  useLayoutEffect(() => {
    if (urlKey === seen.current) return;
    seen.current = urlKey;
    const next = parseDock(urlKey);
    const current = useDock.getState().item;
    if ((next ? dockKey(next) : null) !== (current ? dockKey(current) : null)) useDock.getState().follow(next);
  }, [urlKey]);

  // The store moved (a row was clicked, × was pressed): write the URL.
  useEffect(() => {
    // The store as it is now, not as this render saw it: on a load with
    // `?detail=` the effect above has just followed the URL, and the stale
    // "closed" from before it would read as × being pressed.
    const now = useDock.getState().item;
    const key = now ? dockKey(now) : null;
    if (key === urlKey || seen.current !== urlKey) return;
    seen.current = key;
    const params = new URLSearchParams(location.search);
    if (key) params.set(DETAIL_PARAM, key);
    else params.delete(DETAIL_PARAM);
    const search = params.toString();
    const state = location.state as DockHistoryState | null;
    if (key && !urlKey) {
      navigate({ search }, { state: { dockOpened: true } satisfies DockHistoryState });
    } else if (!key && state?.dockOpened) {
      navigate(-1);
    } else {
      navigate({ search }, { replace: true, state: location.state });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a store change writes the URL
  }, [key]);
}

/** Escape closes the dock, unless a menu or dialog above it takes it first. */
function useEscapeCloses(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role=dialog], [role=menu], [role=listbox]")) return;
      useDock.getState().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

function panelFor(item: DockItem): ReactNode {
  switch (item.kind) {
    case "sound":
      return <SoundDetailPanel id={item.id} />;
    case "voice":
      return <VoiceDetailPanel id={item.id} />;
    case "model":
      return <ModelDetailPanel id={item.id} />;
    case "classic":
      return <ClassicDetailPanel id={item.id} />;
  }
}

export function DetailDock() {
  useDockUrl();
  const item = useDock((s) => s.item);
  useEscapeCloses(item !== null);

  // Closing hands focus back to what opened the panel, when focus was in
  // the panel (or fell to the page as it went). A click elsewhere keeps its
  // own focus.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (item) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const opener = useDock.getState().opener;
    const active = document.activeElement;
    if (opener?.isConnected && (!active || active === document.body)) opener.focus();
  }, [item]);

  return item ? panelFor(item) : null;
}
