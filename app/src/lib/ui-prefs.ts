/**
 * Small per-browser interface preferences that are not server settings:
 * nothing here changes what the server does or what a sound sounds like,
 * so they live in localStorage rather than in `Settings`. Each is a tiny
 * zustand store so a toggle in Settings and the component that obeys it
 * stay in step without a refetch.
 */

import { create } from "zustand";

const KEY = "konchi.ui-prefs";

interface UiPrefs {
  /** Keep the sidebar open on studio and Voice Lab pages, where it folds to
   *  a rail by default so the timeline gets the width. */
  sidebarKeepExpanded: boolean;
  /** How the studio lays its panels out: the three columns, or a canvas of
   *  cards you place yourself (see `panel-canvas`). One choice for every
   *  story, because it is how you work rather than what you are working on. */
  studioLayout: "columns" | "canvas";
  /** How the timeline draws a clip. `bars` is the mirrored bar chart every
   *  waveform view uses; `waterline` draws the sound above a visible zero line
   *  with its reflection below, and puts a buoy on the playhead. Off by
   *  default while it is new: the reflection is quieter than the bars, which
   *  can hide detail in lopsided material (kicks, DC offset). */
  waveStyle: "bars" | "waterline";
  set: (patch: Partial<Omit<UiPrefs, "set">>) => void;
}

function load(): Omit<UiPrefs, "set"> {
  const defaults: Omit<UiPrefs, "set"> = {
    sidebarKeepExpanded: false,
    studioLayout: "columns",
    waveStyle: "bars",
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<typeof defaults>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export const useUiPrefs = create<UiPrefs>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    try {
      const { set: _set, ...rest } = get();
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch {
      /* private window, or storage blocked: the choice lasts the session */
    }
  },
}));

/** Pages that want the width more than they want the nav: the studios with a
 *  timeline, and the Voice Lab with its clip rows. The sidebar folds to its
 *  rail on these unless the "keep expanded" preference says otherwise. */
export function wantsRail(pathname: string): boolean {
  return (
    pathname.startsWith("/studio/") ||
    pathname === "/voice/lab" ||
    pathname.startsWith("/voice/lab/") ||
    pathname === "/library/music"
  );
}
