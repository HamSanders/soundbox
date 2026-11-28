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
import { Link } from "react-router-dom";

import { type ExampleId } from "@/content/examples";
import { KIND_WORD, useExamplePlayer } from "@/lib/example-player";
import { cn } from "@/lib/utils";

const MODEL_NAMES: Record<string, string> = {
  "audiocpp-stable-audio-3-sfx": "Stable Audio 3.0 SFX",
  "audiocpp-stable-audio-3-small-music": "Stable Audio 3.0 Small Music",
  "audiocpp-ace-step": "ACE-Step 1.5 Turbo",
  "audiocpp-chatterbox": "Chatterbox",
};

export function SamplePlay({
  id,
  className,
  compact,
  clamp,
}: {
  id: ExampleId;
  className?: string;
  /** Drop the prompt and the credit line: just the button and the title. */
  compact?: boolean;
  /** Keep the prompt to two lines and leave the lyrics out, for a grid of
   *  players where every tile should be the same height. */
  clamp?: boolean;
}) {
  const { example, playing, progress, failed, toggle } = useExamplePlayer(id);

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
        {!compact && (example.prompt ?? example.text) ? (
          <p
            className={cn("text-muted-foreground mt-0.5 text-xs leading-relaxed", clamp && "line-clamp-2")}
            title={clamp ? (example.prompt ?? example.text) : undefined}
          >
            &ldquo;{example.prompt ?? example.text}&rdquo;
          </p>
        ) : null}
        {!compact && !clamp && example.lyrics ? (
          <details className="text-muted-foreground mt-1 text-xs">
            <summary className="hover:text-foreground cursor-pointer">Lyrics</summary>
            <p className="mt-1 leading-relaxed whitespace-pre-line">
              {example.lyrics.replace(/^\[[a-z ]+\]$/gim, "").replace(/\n{3,}/g, "\n\n").trim()}
            </p>
          </details>
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
