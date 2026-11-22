/**
 * How the bottom player behaves when a sound ends. Both off by default: a
 * sound plays once and stops, because these are sounds you are judging one at
 * a time, not an album. Remembered in this browser.
 *
 * - `autoplay`: go on to the next sound in the list.
 * - `repeat`: play the same sound again (wins over autoplay).
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface PlaybackPrefs {
  autoplay: boolean;
  repeat: boolean;
  setAutoplay: (on: boolean) => void;
  setRepeat: (on: boolean) => void;
}

export const usePlaybackPrefs = create<PlaybackPrefs>()(
  persist(
    (set) => ({
      autoplay: false,
      repeat: false,
      setAutoplay: (autoplay) => set({ autoplay }),
      setRepeat: (repeat) => set({ repeat }),
    }),
    {
      name: "mirli.playback",
      // localStorage can be missing or throw (private windows, blocked storage).
      storage: createJSONStorage(() => {
        try {
          return window.localStorage;
        } catch {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
      }),
      partialize: (s) => ({ autoplay: s.autoplay, repeat: s.repeat }),
    },
  ),
);
