/**
 * Shared waveform player — used by both Generate results and the Library.
 *
 * wavesurfer is fed the precomputed `peaks` array plus the known duration, so
 * it draws instantly and never decodes the whole file just to render a picture.
 * Playback ownership is arbitrated by the global player store: starting one
 * sound pauses every other.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { useTheme } from "next-themes";
import { PauseIcon, PlayIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { usePlayerStore } from "@/lib/player-store";
import { applySink, useOutputStore } from "@/lib/audio-output";
import type { Sound } from "@/lib/api";

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    name,
  );
  return value.trim() || fallback;
}

/** Only nag once per page load — one toast is a diagnosis, five is noise. */
let silentOutputReported = false;

/**
 * Catch the failure mode where playback starts and then goes nowhere.
 *
 * A disconnected output (a powered-off wireless headset is the classic) keeps
 * its endpoint present and simply stops consuming samples. `play()` resolves,
 * `paused` is false, no error fires anywhere — and the clock never moves. With
 * nothing said, that reads as "this app is broken", so check the clock shortly
 * after starting and name the real cause.
 */
async function warnIfOutputIsSilent(ws: WaveSurfer): Promise<void> {
  if (silentOutputReported) return;
  const before = ws.getCurrentTime();
  await new Promise((r) => setTimeout(r, 700));
  if (!ws.isPlaying()) return; // paused or finished legitimately
  if (ws.getCurrentTime() > before + 0.05) return; // audio is flowing
  silentOutputReported = true;
  const { toast } = await import("sonner");
  toast.error("Your audio output isn't playing", {
    description:
      "Playback started but the position never advanced, so the selected output is " +
      "accepting audio and producing nothing — usually a headset that is off or " +
      "disconnected. Pick a different device in Settings.",
    duration: 12000,
    action: {
      label: "Settings",
      onClick: () => {
        window.location.hash = "#/settings";
      },
    },
  });
}

interface WaveformPlayerProps {
  sound: Sound;
  /** Shorter waveform for dense list rows. */
  compact?: boolean;
  className?: string;
  /**
   * Called with the playhead position, in seconds, whenever it moves — while
   * playing and while the user drags the waveform, because wavesurfer emits
   * `timeupdate` for a seek too. Added for the `/music` page, whose lyrics
   * panel has to follow the playhead rather than only the clock.
   *
   * Fires often. Anything expensive belongs behind a change check in the
   * consumer, not in here.
   */
  onTime?: (seconds: number) => void;
  /**
   * Start playing as soon as the audio is ready.
   *
   * Only pass this in response to a user gesture — a click that swapped which
   * track is loaded, say. Autoplay without one is blocked by the browser and
   * would leave the button showing the wrong state.
   */
  autoPlay?: boolean;
}

export function WaveformPlayer({
  sound,
  compact,
  className,
  onTime,
  autoPlay,
}: WaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [failed, setFailed] = useState(false);
  const { resolvedTheme } = useTheme();

  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  const playingId = usePlayerStore((s) => s.playingId);
  const claim = usePlayerStore((s) => s.play);
  const release = usePlayerStore((s) => s.stop);
  const sinkId = useOutputStore((s) => s.sinkId);

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: compact ? 32 : 56,
      waveColor: cssVar("--wave", "#888"),
      progressColor: cssVar("--primary", "#eee"),
      cursorColor: cssVar("--signal", "#f2a40c"),
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      peaks: [sound.peaks],
      duration: sound.duration_s,
      url: sound.file,
    });
    wsRef.current = ws;

    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => {
      setIsPlaying(false);
      setCurrentTime(0);
      onTimeRef.current?.(0);
      release(sound.id);
    });
    ws.on("timeupdate", (t: number) => {
      setCurrentTime(t);
      onTimeRef.current?.(t);
    });
    ws.on("error", () => setFailed(true));

    return () => {
      wsRef.current = null;
      try {
        ws.destroy();
      } catch {
        /* destroy during an in-flight load */
      }
    };
  }, [sound.id, sound.file, sound.duration_s, sound.peaks, compact, release]);

  /**
   * Repaint on a theme flip. This waits a frame on purpose: next-themes writes
   * the `class` on <html> in an ancestor effect, which React runs *after* this
   * component's effects, so reading the CSS variables synchronously here would
   * pick up the outgoing palette.
   */
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const frame = requestAnimationFrame(() => {
      ws.setOptions({
        waveColor: cssVar("--wave", "#888"),
        progressColor: cssVar("--primary", "#eee"),
        cursorColor: cssVar("--signal", "#f2a40c"),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  // Somebody else took over playback — stop.
  useEffect(() => {
    if (playingId !== sound.id && wsRef.current?.isPlaying()) {
      wsRef.current.pause();
    }
  }, [playingId, sound.id]);

  /**
   * Start playback, and only call it a failure when the audio is genuinely
   * unusable.
   *
   * `play()` rejects for two very different reasons: the media element could
   * not load this file, and the media element has not loaded it *yet*. The
   * second is routine wherever a player mounts with `autoPlay` — the dock
   * does, the moment a row is clicked — because wavesurfer is handed
   * pre-computed peaks and announces `ready` off those, before the element
   * has any decoded audio to play. Reporting "Audio unavailable" for that was
   * wrong, and it stuck: nothing ever cleared the flag. So wait for the
   * element to say it can play, try once more, and only then give up.
   */
  const startPlayback = useCallback(
    (ws: WaveSurfer, onPlaying?: () => void) => {
      const played = () => onPlaying?.();
      const giveUp = () => setFailed(true);
      ws.play()
        .then(played)
        .catch(() => {
          const media = ws.getMediaElement();
          if (!media || media.error) {
            giveUp();
            return;
          }
          media.addEventListener("error", giveUp, { once: true });
          media.addEventListener(
            "canplay",
            () => {
              ws.play().then(played).catch(giveUp);
            },
            { once: true },
          );
        });
    },
    [],
  );

  // Route to the chosen output. Re-applied on every play rather than once at
  // creation, because the user can change device while a card is on screen.
  /**
   * Play from wherever the playhead currently is.
   *
   * Split out of `toggle` because the play button is no longer the only thing
   * that starts playback — clicking the waveform does too, and both have to
   * claim the transport and route to the chosen output identically. Two copies
   * of this is how one of them ends up playing to the wrong device.
   */
  const begin = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || failed) return;
    claim(sound.id);
    const media = ws.getMediaElement();
    const start = () => startPlayback(ws, () => warnIfOutputIsSilent(ws));
    if (media) void applySink(media, sinkId).then(start);
    else void start();
  }, [claim, sound.id, failed, sinkId, startPlayback]);

  const toggle = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || failed) return;
    if (ws.isPlaying()) {
      ws.pause();
      release(sound.id);
    } else {
      begin();
    }
  }, [begin, release, sound.id, failed]);

  /**
   * Clicking the waveform starts playing from that point.
   *
   * wavesurfer's own click handling moves the playhead and stops there, which
   * meant a click on a paused track looked like it had done nothing — the
   * cursor moved, no sound came out, and the next thing anyone tried was the
   * play button. Scrubbing a track that is already playing is left alone:
   * `interaction` fires for a drag too, and re-entering playback mid-drag
   * would stutter.
   *
   * The handler is held in a ref so that changing the output device, or the
   * failed flag, does not tear down and rebuild the subscription.
   */
  const beginRef = useRef(begin);
  beginRef.current = begin;
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    return ws.on("interaction", () => {
      if (!ws.isPlaying()) beginRef.current();
    });
  }, [sound.id, sound.file]);

  /**
   * Start on mount when the caller asked for it.
   *
   * Waits for `ready` unless the media element already has a source: the load
   * path sets `src` asynchronously (it resolves peaks first), so calling
   * `play()` too early rejects and would flip the player into its failed
   * state for no reason.
   */
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !autoPlay) return;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      claim(sound.id);
      const media = ws.getMediaElement();
      const go = () => startPlayback(ws);
      if (media) void applySink(media, sinkId).then(go);
      else void go();
    };
    if (ws.getMediaElement()?.currentSrc) {
      start();
      return () => {
        cancelled = true;
      };
    }
    const off = ws.on("ready", start);
    return () => {
      cancelled = true;
      off();
    };
    // sinkId is read at call time on purpose — changing the output device
    // mid-track should not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, sound.id, claim, startPlayback]);

  return (
    <div
      className={cn(
        "group/player focus-visible:ring-ring/50 flex items-center gap-3 rounded-lg outline-none focus-visible:ring-3",
        className,
      )}
      data-sound-id={sound.id}
      tabIndex={0}
      role="group"
      aria-label={`${sound.name} — press space to ${isPlaying ? "pause" : "play"}`}
      onKeyDown={(e) => {
        if (e.key === " " || e.code === "Space") {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }
      }}
    >
      <Button
        type="button"
        // Graphite at rest, teal while it sounds: across a page of rows the
        // one lit button is the one you are hearing, which a page of teal
        // buttons could never say.
        variant={isPlaying ? "default" : "outline"}
        size={compact ? "icon-sm" : "icon"}
        onClick={toggle}
        disabled={failed}
        aria-label={isPlaying ? `Pause ${sound.name}` : `Play ${sound.name}`}
        className={cn(
          "rounded-full",
          isPlaying && "ring-4 ring-primary/15",
        )}
      >
        {isPlaying ? (
          <PauseIcon />
        ) : (
          <PlayIcon className={compact ? "" : "ml-0.5"} />
        )}
      </Button>

      <div className="min-w-0 flex-1">
        <div
          ref={containerRef}
          data-wave
          className={cn("w-full transition-opacity", failed && "opacity-40")}
          aria-hidden="true"
        />
        {failed && (
          <p className="text-muted-foreground mt-1 text-xs">
            Audio unavailable
          </p>
        )}
      </div>

      <span className="text-muted-foreground readout w-20 shrink-0 text-right">
        {formatDuration(currentTime)} / {formatDuration(sound.duration_s)}
      </span>
    </div>
  );
}
