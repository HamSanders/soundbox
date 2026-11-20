/**
 * The audiobook player: one `<audio>` element for the whole app, so a book
 * keeps playing while you browse, and the mini player and the full-screen
 * view are two faces of the same playback.
 *
 * Not the library's `usePlayerStore`: that one is built around a single
 * `Sound`, and a book is chapters, positions, a sleep timer and progress that
 * has to reach the server. It does share `playingId` with it, so starting a
 * book pauses any other player and starting another player pauses the book.
 *
 * Position is chapter + seconds into that chapter's audio. Progress is saved
 * every few seconds while playing, and on pause, chapter change and close.
 */

import { useEffect, useState } from "react";
import { create } from "zustand";

import { listenApi } from "./listen-api";
import type { Bookmark, ListenChapter, ListenManifest } from "./listen-types";
import { usePlayerStore } from "./player-store";

export const PLAYER_ID = "listen";
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
export const SPEED_STEP = 0.05;
export const SLEEP_MINUTES = [5, 15, 30, 45, 60] as const;
const SAVE_EVERY_MS = 5000;

export type SleepTimer = { kind: "minutes"; minutes: number; until: number } | { kind: "chapter" } | null;

interface OpenOptions {
  chapterId?: string | null;
  position?: number;
  autoplay?: boolean;
  /** Play only the sample range, then stop. Nothing is saved. */
  preview?: { chapter_id: string; start_s: number; end_s: number };
  /** Open straight into the full-screen view. */
  expand?: boolean;
}

interface ListenPlayerState {
  manifest: ListenManifest | null;
  chapterIndex: number;
  position: number;
  duration: number;
  playing: boolean;
  buffering: boolean;
  speed: number;
  expanded: boolean;
  sleep: SleepTimer;
  /** When set, playback stops here and progress is not saved. */
  previewEnd: number | null;
  error: string | null;

  open: (manifest: ListenManifest, options?: OpenOptions) => void;
  close: () => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  skip: (delta: number) => void;
  setChapter: (index: number, position?: number, autoplay?: boolean) => void;
  next: () => void;
  prev: () => void;
  setSpeed: (speed: number) => void;
  setSleep: (sleep: "chapter" | number | null) => void;
  setExpanded: (expanded: boolean) => void;
  setBookmarks: (bookmarks: Bookmark[]) => void;
}

let audio: HTMLAudioElement | null = null;
let lastSave = 0;

/** Clamp to the speed range and snap to the 0.05 grid. */
export function snapSpeed(speed: number): number {
  const snapped = Math.round(speed / SPEED_STEP) * SPEED_STEP;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(snapped * 100) / 100));
}

/** Seconds into the book: earlier chapters plus the position in this one. */
export function bookPosition(chapters: ListenChapter[], index: number, position: number): number {
  return chapters.slice(0, index).reduce((s, c) => s + c.duration_s, 0) + position;
}

export const useListenPlayer = create<ListenPlayerState>((set, get) => {
  const el = (): HTMLAudioElement => {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = "auto";
    audio.preservesPitch = true;
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", () => set({ duration: Number.isFinite(audio!.duration) ? audio!.duration : 0 }));
    audio.addEventListener("play", () => {
      usePlayerStore.getState().play(PLAYER_ID);
      set({ playing: true, error: null });
      updateMediaState();
    });
    audio.addEventListener("pause", () => {
      set({ playing: false });
      save();
      updateMediaState();
    });
    audio.addEventListener("waiting", () => set({ buffering: true }));
    audio.addEventListener("playing", () => set({ buffering: false }));
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", () => set({ playing: false, buffering: false, error: "This chapter's audio could not be played." }));
    // Another player claiming playback pauses the book.
    usePlayerStore.subscribe((s) => {
      if (s.playingId !== PLAYER_ID && audio && !audio.paused) audio.pause();
    });
    installMediaSession();
    return audio;
  };

  const chapter = (): ListenChapter | null => get().manifest?.chapters[get().chapterIndex] ?? null;

  function onTime(): void {
    const a = audio!;
    const s = get();
    const t = a.currentTime;
    set({ position: t });
    if (s.previewEnd !== null && t >= s.previewEnd) {
      a.pause();
      set({ previewEnd: null });
      return;
    }
    if (s.sleep?.kind === "minutes" && Date.now() >= s.sleep.until) {
      a.pause();
      set({ sleep: null });
      return;
    }
    if (Date.now() - lastSave > SAVE_EVERY_MS) save();
  }

  function onEnded(): void {
    const s = get();
    if (s.previewEnd !== null) {
      set({ previewEnd: null, playing: false });
      return;
    }
    if (s.sleep?.kind === "chapter") {
      set({ sleep: null, playing: false });
      // Resume at the start of the next chapter rather than the end of this one.
      if (s.manifest && s.chapterIndex < s.manifest.chapters.length - 1) {
        get().setChapter(s.chapterIndex + 1, 0, false);
      } else save();
      return;
    }
    const nextIndex = nextPlayable(s.chapterIndex);
    if (nextIndex !== null) get().setChapter(nextIndex, 0, true);
    else save(true);
  }

  function nextPlayable(from: number): number | null {
    const chapters = get().manifest?.chapters ?? [];
    for (let i = from + 1; i < chapters.length; i++) if (chapters[i].audio_url) return i;
    return null;
  }

  function prevPlayable(from: number): number | null {
    const chapters = get().manifest?.chapters ?? [];
    for (let i = from - 1; i >= 0; i--) if (chapters[i].audio_url) return i;
    return null;
  }

  function save(finished?: boolean): void {
    const s = get();
    const c = chapter();
    if (!s.manifest || !c || s.previewEnd !== null) return;
    lastSave = Date.now();
    const position = audio?.currentTime ?? s.position;
    void listenApi
      .saveProgress(s.manifest.book.id, {
        chapter_id: c.id,
        position_s: position,
        speed: s.speed,
        book_position_s: bookPosition(s.manifest.chapters, s.chapterIndex, position),
        ...(finished ? { finished: true } : {}),
      })
      .catch(() => {
        /* offline or server gone: the next save will try again */
      });
  }

  function load(index: number, position: number, autoplay: boolean): void {
    const m = get().manifest;
    const c = m?.chapters[index];
    if (!m || !c?.audio_url) return;
    const a = el();
    const sameSrc = a.dataset.chapter === c.id;
    set({ chapterIndex: index, position, duration: c.duration_s, buffering: !sameSrc });
    if (!sameSrc) {
      a.dataset.chapter = c.id;
      a.src = c.audio_url;
    }
    a.playbackRate = a.defaultPlaybackRate = get().speed;
    a.preservesPitch = true;
    const start = () => {
      a.currentTime = Math.min(position, c.duration_s || position);
      if (autoplay) void a.play().catch(() => set({ playing: false }));
    };
    if (sameSrc && a.readyState >= 1) start();
    else a.addEventListener("loadedmetadata", start, { once: true });
    setMediaMetadata(m, c);
  }

  function updateMediaState(): void {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = get().playing ? "playing" : "paused";
  }

  function setMediaMetadata(m: ListenManifest, c: ListenChapter): void {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: c.title,
      artist: m.book.author ?? "",
      album: m.book.title,
      artwork: m.book.cover_url ? [{ src: m.book.cover_url }] : [],
    });
  }

  function installMediaSession(): void {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const handle = (action: MediaSessionAction, fn: (d: MediaSessionActionDetails) => void) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* action not supported by this browser */
      }
    };
    handle("play", () => get().play());
    handle("pause", () => get().pause());
    handle("seekbackward", (d) => get().skip(-(d.seekOffset ?? 15)));
    handle("seekforward", (d) => get().skip(d.seekOffset ?? 15));
    handle("seekto", (d) => d.seekTime != null && get().seek(d.seekTime));
    handle("previoustrack", () => get().prev());
    handle("nexttrack", () => get().next());
  }

  return {
    manifest: null,
    chapterIndex: 0,
    position: 0,
    duration: 0,
    playing: false,
    buffering: false,
    speed: 1,
    expanded: false,
    sleep: null,
    previewEnd: null,
    error: null,

    open(manifest, options = {}) {
      const prev = get();
      if (prev.manifest && prev.manifest.book.id !== manifest.book.id) save();
      const chapters = manifest.chapters;
      let index: number;
      let position: number;
      let previewEnd: number | null = null;
      if (options.preview) {
        index = Math.max(0, chapters.findIndex((c) => c.id === options.preview!.chapter_id));
        position = options.preview.start_s;
        previewEnd = options.preview.end_s;
      } else {
        const wanted = options.chapterId ?? manifest.progress?.chapter_id ?? null;
        const found = wanted ? chapters.findIndex((c) => c.id === wanted) : -1;
        index = found >= 0 ? found : Math.max(0, chapters.findIndex((c) => c.audio_url));
        position =
          options.position ??
          (manifest.progress && manifest.progress.chapter_id === chapters[index]?.id && !manifest.progress.finished_at
            ? manifest.progress.position_s
            : 0);
      }
      const speed = snapSpeed(manifest.progress?.speed ?? prev.speed);
      set({
        manifest,
        speed,
        previewEnd,
        error: null,
        expanded: options.expand ?? prev.expanded,
      });
      load(index, position, options.autoplay ?? true);
    },

    close() {
      save();
      audio?.pause();
      if (audio) {
        audio.removeAttribute("src");
        delete audio.dataset.chapter;
        audio.load();
      }
      set({ manifest: null, playing: false, expanded: false, sleep: null, previewEnd: null, position: 0 });
      usePlayerStore.getState().stop(PLAYER_ID);
    },

    play() {
      if (!get().manifest) return;
      void el().play().catch(() => set({ playing: false }));
    },
    pause() {
      audio?.pause();
    },
    toggle() {
      if (get().playing) get().pause();
      else get().play();
    },
    seek(t) {
      const a = el();
      a.currentTime = Math.max(0, Math.min(t, get().duration || t));
      set({ position: a.currentTime });
    },
    skip(delta) {
      const s = get();
      const t = (audio?.currentTime ?? s.position) + delta;
      if (t < 0 && delta < 0) {
        const p = prevPlayable(s.chapterIndex);
        if (p !== null && (audio?.currentTime ?? 0) < 1) {
          const c = s.manifest!.chapters[p];
          get().setChapter(p, Math.max(0, c.duration_s + t), s.playing);
          return;
        }
      }
      if (t > s.duration && delta > 0) {
        const n = nextPlayable(s.chapterIndex);
        if (n !== null) {
          get().setChapter(n, 0, s.playing);
          return;
        }
      }
      get().seek(t);
    },
    setChapter(index, position = 0, autoplay = true) {
      save();
      set({ previewEnd: null });
      load(index, position, autoplay);
    },
    next() {
      const n = nextPlayable(get().chapterIndex);
      if (n !== null) get().setChapter(n, 0, true);
    },
    prev() {
      const s = get();
      // Like a CD player: back to the chapter's start first, then the one before.
      if ((audio?.currentTime ?? 0) > 3) {
        get().seek(0);
        return;
      }
      const p = prevPlayable(s.chapterIndex);
      if (p !== null) get().setChapter(p, 0, true);
      else get().seek(0);
    },
    setSpeed(speed) {
      const v = snapSpeed(speed);
      if (audio) {
        audio.playbackRate = audio.defaultPlaybackRate = v;
        audio.preservesPitch = true;
      }
      set({ speed: v });
      save();
    },
    setSleep(sleep) {
      if (sleep === null) set({ sleep: null });
      else if (sleep === "chapter") set({ sleep: { kind: "chapter" } });
      else set({ sleep: { kind: "minutes", minutes: sleep, until: Date.now() + sleep * 60_000 } });
    },
    setExpanded(expanded) {
      set({ expanded });
    },
    setBookmarks(list) {
      const m = get().manifest;
      if (m) set({ manifest: { ...m, bookmarks: list } });
    },
  };
});

/** The paragraph playing at `t` in a chapter: the last one started by then. */
export function paragraphAt(chapter: ListenChapter | null, t: number): number {
  if (!chapter) return -1;
  let found = -1;
  chapter.paragraphs.forEach((p, i) => {
    if (p.start_s !== null && p.start_s <= t + 0.05) found = i;
  });
  return found;
}

/** The audio clock right now, for animation frames between `timeupdate`s. */
export function currentTime(): number {
  return audio?.currentTime ?? useListenPlayer.getState().position;
}

/** The playback position, redrawn every animation frame while playing (the
 *  store's own `position` only moves on `timeupdate`, about 4 times a second). */
export function useAudioClock(): number {
  const playing = useListenPlayer((s) => s.playing);
  const position = useListenPlayer((s) => s.position);
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      setT(currentTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return playing ? t : position;
}
