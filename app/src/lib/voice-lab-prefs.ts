/**
 * How the Voice Lab shows the cast, and the line every test read says.
 * Remembered in this browser.
 *
 * - `view`: the grid of tiles, or the dense list. Grid by default: with a
 *   handful of voices, the tiles are the page; the list is for long casts.
 * - `line`: one line shared by the detail panel's test read and the
 *   comparison, so hearing one voice and comparing several use the same words.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type VoiceView = "grid" | "list";

export const DEFAULT_TEST_LINE = "The quick brown fox jumps over the lazy dog.";

interface VoiceLabPrefs {
  view: VoiceView;
  line: string;
  setView: (view: VoiceView) => void;
  setLine: (line: string) => void;
}

export const useVoiceLabPrefs = create<VoiceLabPrefs>()(
  persist(
    (set) => ({
      view: "grid",
      line: DEFAULT_TEST_LINE,
      setView: (view) => set({ view }),
      setLine: (line) => set({ line }),
    }),
    {
      name: "mirli.voice-lab",
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
      partialize: (s) => ({ view: s.view, line: s.line }),
    },
  ),
);
