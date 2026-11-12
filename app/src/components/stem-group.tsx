/**
 * Synced multi-stem playback for a sound that was split into stems.
 *
 * Deliberately not an arrangement/timeline editor: stems always share the
 * source clip's duration and always start at 0 — the one thing they never
 * need is repositioning. So this is just N `WaveSurfer` instances (one per
 * stem) driven by one shared transport, not a multitrack editing library.
 * The first stem is the sync master; the others are corrected back onto its
 * clock on a drift beyond a small threshold, and any waveform can be clicked
 * to seek all of them at once.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { useTheme } from "next-themes";
import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { usePlayerStore } from "@/lib/player-store";
import { applySink, useOutputStore } from "@/lib/audio-output";
import { useSounds } from "@/lib/queries";
import { InstrumentBadge } from "@/components/instrument-badge";
import type { Sound } from "@/lib/api";

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return value.trim() || fallback;
}

/** Resync a follower onto the master clock once drift exceeds this — small
 *  enough that stems stay audibly locked, large enough that normal decode
 *  jitter between separately-loaded `<audio>` elements doesn't cause a
 *  constant tug-of-war of corrections. */
const DRIFT_THRESHOLD_S = 0.15;

interface StemRowProps {
  sound: Sound;
  registerWs: (id: string, ws: WaveSurfer | null) => void;
  isMaster: boolean;
  onMasterTime: (t: number) => void;
  onInteract: (t: number) => void;
  muted: boolean;
  onToggleMute: () => void;
}

/** Label just the stem, not the whole "{source name} (vocals)" — the source
 *  name is already stated once by the group header. */
function stemLabel(sound: Sound): string {
  const m = /\(([^()]+)\)\s*$/.exec(sound.name);
  return m ? m[1] : sound.name;
}

function StemRow({
  sound,
  registerWs,
  isMaster,
  onMasterTime,
  onInteract,
  muted,
  onToggleMute,
}: StemRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 28,
      waveColor: cssVar("--muted-foreground", "#888"),
      progressColor: cssVar("--primary", "#eee"),
      cursorColor: cssVar("--ring", "#aaa"),
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      interact: true,
      peaks: [sound.peaks],
      duration: sound.duration_s,
      url: sound.file,
    });
    wsRef.current = ws;
    registerWs(sound.id, ws);
    ws.setMuted(muted);

    if (isMaster) ws.on("timeupdate", onMasterTime);
    ws.on("interaction", () => onInteract(ws.getCurrentTime()));

    return () => {
      registerWs(sound.id, null);
      wsRef.current = null;
      try {
        ws.destroy();
      } catch {
        /* destroy during an in-flight load */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ws lifecycle is keyed by sound identity only
  }, [sound.id, sound.file, sound.duration_s, sound.peaks]);

  useEffect(() => {
    wsRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const frame = requestAnimationFrame(() => {
      ws.setOptions({
        waveColor: cssVar("--muted-foreground", "#888"),
        progressColor: cssVar("--primary", "#eee"),
        cursorColor: cssVar("--ring", "#aaa"),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  return (
    <div className="flex items-center gap-2.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={muted ? `Unmute ${stemLabel(sound)}` : `Mute ${stemLabel(sound)}`}
        aria-pressed={muted}
        onClick={onToggleMute}
        className={cn("shrink-0", muted && "text-muted-foreground/50")}
      >
        {muted ? <VolumeXIcon className="size-3.5" /> : <Volume2Icon className="size-3.5" />}
      </Button>
      {/* The instrument at a glance. Drawn, not generated — see
          `instrument-icons.tsx` for why a stem list can't depend on an image
          model that most users won't have turned on. */}
      <InstrumentBadge stemName={stemLabel(sound)} className="size-6 rounded" iconClassName="size-3.5" />
      <span className="text-muted-foreground w-14 shrink-0 truncate text-xs font-medium capitalize">
        {stemLabel(sound)}
      </span>
      <div ref={containerRef} className="min-w-0 flex-1" aria-hidden="true" />
    </div>
  );
}

interface StemGroupProps {
  /** The source sound's id — its stem children are fetched by parent_id. */
  sourceId: string;
  className?: string;
}

/** Renders nothing once loaded if the sound has no stems, so a caller can
 *  drop this in unconditionally under any sound card without checking first. */
export function StemGroup({ sourceId, className }: StemGroupProps) {
  const { data, isLoading } = useSounds({ parent_id: sourceId, limit: 12 });
  const stems = data?.items ?? [];

  const groupId = `stem-group:${sourceId}`;
  const playingId = usePlayerStore((s) => s.playingId);
  const claim = usePlayerStore((s) => s.play);
  const release = usePlayerStore((s) => s.stop);
  const sinkId = useOutputStore((s) => s.sinkId);

  const wsMap = useRef(new Map<string, WaveSurfer>());
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());

  const registerWs = useCallback((id: string, ws: WaveSurfer | null) => {
    if (ws) wsMap.current.set(id, ws);
    else wsMap.current.delete(id);
  }, []);

  const seekAll = useCallback((t: number, exceptId?: string) => {
    for (const [id, ws] of wsMap.current) {
      if (id === exceptId) continue;
      if (Math.abs(ws.getCurrentTime() - t) > DRIFT_THRESHOLD_S) ws.setTime(t);
    }
  }, []);

  const onMasterTime = useCallback(
    (t: number) => {
      setCurrentTime(t);
      seekAll(t, stems[0]?.id);
    },
    [seekAll, stems],
  );

  const onInteract = useCallback(
    (t: number) => {
      setCurrentTime(t);
      seekAll(t);
    },
    [seekAll],
  );

  const toggleMute = useCallback((id: string) => {
    setMutedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Somebody else took over playback — stop the whole group.
  useEffect(() => {
    if (playingId !== groupId && isPlaying) {
      for (const ws of wsMap.current.values()) ws.pause();
      setIsPlaying(false);
    }
  }, [playingId, groupId, isPlaying]);

  const toggle = useCallback(() => {
    const instances = [...wsMap.current.values()];
    if (!instances.length) return;
    if (isPlaying) {
      for (const ws of instances) ws.pause();
      setIsPlaying(false);
      release(groupId);
      return;
    }
    claim(groupId);
    setIsPlaying(true);
    void Promise.all(
      instances.map((ws) => {
        const media = ws.getMediaElement();
        const start = () => ws.play().catch(() => {});
        return media ? applySink(media, sinkId).then(start) : start();
      }),
    );
  }, [isPlaying, claim, release, groupId, sinkId]);

  // finish detection: poll the master's paused state via wavesurfer's own
  // "finish" event, wired per-row would double-fire across stems of equal
  // length — cheaper to just watch the first instance here.
  useEffect(() => {
    const master = stems[0] ? wsMap.current.get(stems[0].id) : undefined;
    if (!master) return;
    const onFinish = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      release(groupId);
    };
    master.on("finish", onFinish);
    return () => {
      master.un("finish", onFinish);
    };
  }, [stems, groupId, release]);

  if (isLoading) {
    return (
      <div className={cn("space-y-1.5", className)}>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-full" />
      </div>
    );
  }

  if (!stems.length) return null;

  return (
    <div className={cn("bg-muted/30 rounded-lg p-2.5", className)}>
      <div className="mb-2 flex items-center gap-2">
        <Button
          type="button"
          variant="default"
          size="icon-sm"
          onClick={toggle}
          aria-label={isPlaying ? "Pause stems" : "Play all stems together"}
          className="shrink-0 rounded-full"
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon className="ml-0.5" />}
        </Button>
        <span className="text-muted-foreground text-xs font-medium">
          {stems.length} stems
        </span>
        <span className="text-muted-foreground ml-auto font-(family-name:--font-log) text-xs tabular-nums">
          {formatDuration(currentTime)} / {formatDuration(stems[0]?.duration_s ?? 0)}
        </span>
      </div>
      <div className="space-y-1.5">
        {stems.map((s, i) => (
          <StemRow
            key={s.id}
            sound={s}
            registerWs={registerWs}
            isMaster={i === 0}
            onMasterTime={onMasterTime}
            onInteract={onInteract}
            muted={mutedIds.has(s.id)}
            onToggleMute={() => toggleMute(s.id)}
          />
        ))}
      </div>
    </div>
  );
}
