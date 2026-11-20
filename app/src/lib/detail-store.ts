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
  open: (sound: Sound) => void;
  close: () => void;
}

export const useDetailStore = create<DetailState>((set) => ({
  sound: null,
  open: (sound) => set({ sound }),
  close: () => set({ sound: null }),
}));
