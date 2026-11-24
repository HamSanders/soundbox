/**
 * The sound whose details are open in the right-hand panel, app-wide.
 *
 * A store rather than route state because the panel sits over whatever page
 * opened it (the Library, the Dashboard) and keeps that page, its scroll and
 * its filters, underneath. `/sounds/:id` remains the full page.
 */

import { create } from "zustand";
import type { Sound } from "@/lib/api";

interface DetailState {
  sound: Sound | null;
  /** The route the panel belongs to; leaving it closes the panel. Null
   *  means "whichever page is showing when the panel renders". */
  path: string | null;
  /** Pass `path` when opening the panel for a page you are navigating to in
   *  the same tick (the sidebar's Recent list does), so the route change
   *  doesn't count as leaving the page that opened it. */
  open: (sound: Sound, path?: string) => void;
  close: () => void;
}

export const useDetailStore = create<DetailState>((set) => ({
  sound: null,
  path: null,
  open: (sound, path) => set({ sound, path: path ?? null }),
  close: () => set({ sound: null, path: null }),
}));
