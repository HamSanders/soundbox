/**
 * A play button for one real render from `content/examples.ts`, with the
 * prompt that made it written next to it.
 *
 * Marketing pages describe sounds ("a heavy steel vault door", "an amapiano
 * beat"); this puts one of them within a click. The button claims playback
 * through `player-store`, so starting it pauses any waveform player and the
 * other way round, and only one sound is ever audible. The file is not
 * fetched until the first press. While it plays, a thin beak-yellow line under
 * the text shows how far along it is, the same signal the app's playheads use.
 */

import { PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { EXAMPLES, type Example, type ExampleId } from "@/content/examples";
import { assetUrl } from "@/lib/asset-url";
import { usePlayerStore } from "@/lib/player-store";
import { cn } from "@/lib/utils";

const MODEL_NAMES: Record<string, string> = {
  "audiocpp-stable-audio-3-sfx": "Stable Audio 3.0 SFX",
  "audiocpp-stable-audio-3-small-music": "Stable Audio 3.0 Small Music",
  "audiocpp-ace-step": "ACE-Step 1.5 Turbo",
  "audiocpp-chatterbox": "Chatterbox",
};

const KIND_WORD = { sfx: "Sound effect", music: "Music", voice: "Voice" } as const;

export function SamplePlay({
  id,
  className,
  compact,
}: {
  id: ExampleId;
  className?: string;
  /** Drop the prompt and the credit line: just the button and the title. */
  compact?: boolean;
}) {
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

  const credit = `${KIND_WORD[example.kind]} · ${MODEL_NAMES[example.model] ?? example.model}`;

  return (
    <div className={cn("flex items-start gap-3 text-left", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-label={`${playing ? "Pause" : "Play"}: ${example.title}`}
        aria-pressed={playing}
        className="border-border-strong bg-card text-foreground hover:bg-accent focus-visible:ring-ring mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {playing ? (
          <PauseIcon className="size-4" aria-hidden="true" />
        ) : (
          <PlayIcon className="size-4 translate-x-px" aria-hidden="true" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug font-medium">
          {example.page ? (
            <Link to={example.page} className="hover:underline underline-offset-4">
              {example.title}
            </Link>
          ) : (
            example.title
          )}
        </p>
        {!compact && example.prompt ? (
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            &ldquo;{example.prompt}&rdquo;
          </p>
        ) : null}
        {!compact ? <p className="label-caps text-muted-foreground mt-1">{credit}</p> : null}
        {failed ? (
          <p className="text-danger mt-1 text-xs" role="status">
            The audio did not load.
          </p>
        ) : null}
        <div className="bg-border mt-2 h-px w-full" aria-hidden="true">
          <div
            className="bg-signal h-0.5 -translate-y-px"
            style={{ width: `${Math.round(progress * 100)}%`, opacity: playing || progress > 0 ? 1 : 0 }}
          />
        </div>
      </div>
    </div>
  );
}
