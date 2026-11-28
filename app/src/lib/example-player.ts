/**
 * The player behind every real render on the marketing pages: the file,
 * whether it is sounding, and how far along it is. `SamplePlay` draws it as a
 * round button beside the prompt; the hero's cards (`hero-clips.tsx`) draw it
 * as a waveform that fills.
 */

import { useEffect, useId, useRef, useState } from "react";

import { EXAMPLES, type Example, type ExampleId } from "@/content/examples";
import { assetUrl } from "@/lib/asset-url";
import { usePlayerStore } from "@/lib/player-store";

export const KIND_WORD = { sfx: "Sound effect", music: "Music", voice: "Voice" } as const;

export function useExamplePlayer(id: ExampleId) {
  const example: Example = EXAMPLES[id];
  // One owner per player, not per sound: the same render can sit twice on a page.
  const storeId = `example-${useId()}`;
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const playingId = usePlayerStore((s) => s.playingId);

  // Another player took over: stop and put the line back at the start.
  useEffect(() => {
    if (playingId !== storeId && audio.current && !audio.current.paused) {
      audio.current.pause();
    }
  }, [playingId, storeId]);

  // Leaving the page must not leave a sound running.
  useEffect(() => {
    return () => {
      audio.current?.pause();
      usePlayerStore.getState().stop(storeId);
    };
  }, [storeId]);

  const toggle = () => {
    let el = audio.current;
    if (!el) {
      el = new Audio(assetUrl(example.file));
      el.preload = "auto";
      el.addEventListener("play", () => setPlaying(true));
      el.addEventListener("pause", () => setPlaying(false));
      el.addEventListener("ended", () => {
        setPlaying(false);
        setProgress(0);
        usePlayerStore.getState().stop(storeId);
      });
      el.addEventListener("timeupdate", () => {
        if (el && el.duration > 0) setProgress(el.currentTime / el.duration);
      });
      el.addEventListener("error", () => setFailed(true));
      audio.current = el;
    }
    if (el.paused) {
      usePlayerStore.getState().play(storeId);
      void el.play().catch(() => setFailed(true));
    } else {
      el.pause();
      usePlayerStore.getState().stop(storeId);
    }
  };

  return { example, playing, progress, failed, toggle };
}
