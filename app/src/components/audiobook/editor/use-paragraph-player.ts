/**
 * Play one paragraph, or play on to the end of the chapter.
 *
 * One `<audio>` element per editor. Claims the app-wide player store so any
 * other player pauses, and stops when something else claims it. Unvoiced
 * paragraphs are skipped when playing on; generating ahead belongs to the
 * render run.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { Paragraph } from "@/lib/audiobook-api";
import { usePlayerStore } from "@/lib/player-store";

const OWNER = "audiobook-editor";

export interface ParagraphPlayer {
  /** The paragraph being played, or null. */
  playingId: string | null;
  /** True while playing on through the chapter. */
  continuous: boolean;
  play: (paragraph: Paragraph) => void;
  playFrom: (paragraphs: Paragraph[], startId: string) => void;
  stop: () => void;
  toggle: (paragraph: Paragraph) => void;
}

export function useParagraphPlayer(onAdvance?: (id: string) => void): ParagraphPlayer {
  const audio = useRef<HTMLAudioElement | null>(null);
  const queue = useRef<Paragraph[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [continuous, setContinuous] = useState(false);
  const claim = usePlayerStore((s) => s.play);
  const release = usePlayerStore((s) => s.stop);
  const owner = usePlayerStore((s) => s.playingId);
  // Another player took over: stop quietly. Our own state reads as stopped
  // from the moment the store changes hands, without a second render.
  const ours = owner === OWNER;
  const advance = useRef(onAdvance);
  useEffect(() => {
    advance.current = onAdvance;
  }, [onAdvance]);

  const stop = useCallback(() => {
    audio.current?.pause();
    queue.current = [];
    setPlayingId(null);
    setContinuous(false);
    release(OWNER);
  }, [release]);

  const start = useCallback(
    function startParagraph(paragraph: Paragraph): boolean {
      const file = paragraph.sound?.file;
      if (!file) return false;
      if (!audio.current) audio.current = new Audio();
      const el = audio.current;
      el.onended = () => {
        const next = queue.current.shift();
        if (next && startParagraph(next)) return;
        setPlayingId(null);
        setContinuous(false);
        release(OWNER);
      };
      el.src = file;
      el.currentTime = paragraph.trim_start_s ?? 0;
      void el.play().catch(() => stop());
      claim(OWNER);
      setPlayingId(paragraph.id);
      advance.current?.(paragraph.id);
      return true;
    },
    [claim, release, stop],
  );

  const play = useCallback(
    (paragraph: Paragraph) => {
      queue.current = [];
      setContinuous(false);
      start(paragraph);
    },
    [start],
  );

  const playFrom = useCallback(
    (paragraphs: Paragraph[], startId: string) => {
      const i = paragraphs.findIndex((p) => p.id === startId);
      const rest = paragraphs.slice(Math.max(0, i)).filter((p) => p.kind === "line" && p.sound?.file);
      const first = rest.shift();
      if (!first) return;
      queue.current = rest;
      setContinuous(true);
      start(first);
    },
    [start],
  );

  const toggle = useCallback(
    (paragraph: Paragraph) => {
      if (ours && playingId === paragraph.id) stop();
      else play(paragraph);
    },
    [ours, play, playingId, stop],
  );

  useEffect(() => {
    if (!ours) {
      audio.current?.pause();
      queue.current = [];
    }
  }, [ours]);

  useEffect(() => () => audio.current?.pause(), []);

  return {
    playingId: ours ? playingId : null,
    continuous: ours && continuous,
    play,
    playFrom,
    stop,
    toggle,
  };
}
