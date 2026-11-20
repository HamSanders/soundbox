/**
 * One global "who is playing" store. Every waveform player watches `playingId`
 * and pauses itself the moment another sound takes over, so only one sound is
 * ever audible.
 *
 * `sound` is a second, coarser piece of state: the sound bound to the fixed
 * player at the bottom of the app (`NowPlayingBar`). Setting it is how a
 * Library row says "play this and keep it visible while I scroll away" — the
 * bar is a distinct player instance from whatever inline waveform triggered
 * it, so it needs the whole `Sound`, not just an id, to render on its own.
 */

import { create } from "zustand";
import type { Sound } from "@/lib/api";

interface PlayerState {
  playingId: string | null;
  /** The sound the fixed bottom player is showing, or null when it's closed. */
  sound: Sound | null;
  /** Claim playback for `id`. Every other player pauses. */
  play: (id: string) => void;
  /** Release playback if `id` currently owns it (omit to always release). */
  stop: (id?: string) => void;
  /** Open (or close, with null) the fixed bottom player on this sound. */
  setSound: (sound: Sound | null) => void;
  /** The list the bottom player steps through with previous / next: the
   *  Library sets it to whatever it is showing. */
  queue: Sound[];
  setQueue: (queue: Sound[]) => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  playingId: null,
  sound: null,
  play: (id) => set({ playingId: id }),
  stop: (id) =>
    set((s) => (id === undefined || s.playingId === id ? { playingId: null } : s)),
  setSound: (sound) => set({ sound }),
  queue: [],
  setQueue: (queue) => set({ queue }),
}));
