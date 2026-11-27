/**
 * Screen-reader announcements for the book editor. `announce(text)` is
 * callable from anywhere (ops, keyboard handlers, data changes); the
 * `LiveRegion` in announcer.tsx reads it out.
 */

import { create } from "zustand";

interface AnnouncerState {
  message: string;
  seq: number;
  say: (text: string) => void;
}

export const useAnnouncer = create<AnnouncerState>((set) => ({
  message: "",
  seq: 0,
  say: (text) => set((s) => ({ message: text, seq: s.seq + 1 })),
}));

/** Read `text` to screen-reader users, politely. */
export function announce(text: string): void {
  useAnnouncer.getState().say(text);
}
