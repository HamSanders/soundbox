/**
 * The waveform editor on a sound's detail page.
 *
 * Follows the layout every desktop audio editor shares (Audacity, Ocenaudio,
 * Descript): a large waveform you drag across to make a selection, a time
 * ruler under it, and a single toolbar of tools that act on the selection or
 * the whole clip. Parameterised tools (gain, EQ, pitch/time) open a small
 * popover with a slider and an Apply — no tab pages, no separate form.
 *
 * Every tool is non-destructive: Apply creates a new derived sound (see
 * `Sound.parent_id`) and navigates there. The clip on screen is never
 * overwritten.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";
import { useTheme } from "next-themes";
import {
  ArrowLeftRightIcon,
  AudioWaveformIcon,
  GaugeIcon,
  Loader2Icon,
  MusicIcon,
  PaintbrushIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  ScissorsIcon,
  Volume2Icon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_REPAINT,
  RepaintControls,
  type RepaintOptions,
} from "@/components/repaint-controls";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDuration } from "@/lib/format";
import { useEditSound, useModels, useRepaintSound } from "@/lib/queries";
import { useJobStream } from "@/hooks/use-job-stream";
import { usePlayerStore } from "@/lib/player-store";
import { applySink, useOutputStore } from "@/lib/audio-output";
import { cn } from "@/lib/utils";
import type { Sound, SoundEditRequest } from "@/lib/api";

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return value.trim() || fallback;
}

type Selection = { start: number; end: number } | null;

/* --------------------------------------------------------------- toolbar */

function Tool({
  label,
  icon: Icon,
  onClick,
  disabled,
  active,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(active && "bg-muted")}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** An icon tool that opens a popover with one or two sliders and an Apply. */
function ParamTool({
  label,
  icon: Icon,
  disabled,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled}>
              <Icon />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-72 space-y-4 p-4">
        <p className="text-sm font-semibold tracking-tight">{label}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}

function Param({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Label className="text-muted-foreground text-xs font-normal">{label}</Label>
        <span className="text-xs font-medium tabular-nums">{value}</span>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- editor */

export function SoundEditor({ sound }: { sound: Sound }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const activeRegionRef = useRef<Region | null>(null);
  const loopRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [loop, setLoop] = useState(false);
  const [failed, setFailed] = useState(false);
  const { resolvedTheme } = useTheme();

  const navigate = useNavigate();
  const edit = useEditSound();
  const repaint = useRepaintSound();
  const { data: models } = useModels();
  const playingId = usePlayerStore((s) => s.playingId);
  const claim = usePlayerStore((s) => s.play);
  const release = usePlayerStore((s) => s.stop);
  const sinkId = useOutputStore((s) => s.sinkId);

  // Parameter state for the popover tools.
  const [gainDb, setGainDb] = useState(0);
  const [targetLufs, setTargetLufs] = useState(-16);
  const [highCutoff, setHighCutoff] = useState(80);
  const [lowCutoff, setLowCutoff] = useState(12000);
  const [semitones, setSemitones] = useState(0);
  const [rate, setRate] = useState(1);

  /* ------------------------------------------------------------- repaint */
  /**
   * Repaint is the one tool here that is not DSP: it hands the highlighted
   * range back to the model that made the clip and asks for that stretch
   * again, keeping everything outside it sample-for-sample. So it is a render
   * — a queued job with a progress bar — rather than a synchronous edit, and
   * the result lands as a new derived sound like every other tool's does.
   */
  const [repaint0, setRepaint0] = useState<RepaintOptions>(DEFAULT_REPAINT);
  const [repaintJobId, setRepaintJobId] = useState<string | null>(null);
  const { job: repaintJob } = useJobStream(repaintJobId);

  /** Whether anything installed can repaint at all. The source's own model is
   *  what the server will reach for, but a clip made by a model that cannot
   *  repaint is still repaintable by one that can, so the question is about
   *  the catalogue rather than about this sound. */
  const canRepaint = Boolean(models?.some((m) => m.task === "gen" && m.supports.repaint));

  // Land on the repainted clip the moment it exists, exactly as the DSP tools
  // navigate to what they produced.
  useEffect(() => {
    if (!repaintJob || repaintJobId === null) return;
    if (repaintJob.status === "done") {
      const created = repaintJob.result?.sounds?.[0];
      setRepaintJobId(null);
      if (created) navigate(`/sounds/${created}`);
    } else if (repaintJob.status === "error" || repaintJob.status === "cancelled") {
      setRepaintJobId(null);
      if (repaintJob.error) toast.error("Repaint failed", { description: repaintJob.error });
    }
  }, [repaintJob, repaintJobId, navigate]);

  loopRef.current = loop;

  const colors = () => ({
    waveColor: cssVar("--muted-foreground", "#888"),
    progressColor: cssVar("--primary", "#eee"),
    cursorColor: cssVar("--ring", "#aaa"),
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 120,
      ...colors(),
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      peaks: [sound.peaks],
      duration: sound.duration_s,
      url: sound.file,
      plugins: [
        regions,
        TimelinePlugin.create({
          height: 16,
          style: { fontSize: "10px", color: cssVar("--muted-foreground", "#888") },
        }),
      ],
    });
    wsRef.current = ws;
    regionsRef.current = regions;

    // Drag on empty waveform = new selection. Only one selection at a time,
    // like every editor: a new drag replaces the previous region.
    regions.enableDragSelection({
      color: "color-mix(in oklch, var(--primary) 22%, transparent)",
    });
    regions.on("region-created", (region) => {
      activeRegionRef.current?.remove();
      activeRegionRef.current = region;
      setSelection({ start: region.start, end: region.end });
    });
    regions.on("region-updated", (region) => {
      if (region === activeRegionRef.current) {
        setSelection({ start: region.start, end: region.end });
      }
    });
    // Reaching the end of the selection: loop it or stop, but never run on
    // into the rest of the clip — that's what "preview the selection" means.
    regions.on("region-out", (region) => {
      if (region !== activeRegionRef.current || !ws.isPlaying()) return;
      if (loopRef.current) region.play();
      else ws.pause();
    });

    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => {
      setIsPlaying(false);
      release(sound.id);
    });
    ws.on("timeupdate", (t: number) => setCurrentTime(t));
    ws.on("error", () => setFailed(true));

    return () => {
      wsRef.current = null;
      regionsRef.current = null;
      activeRegionRef.current = null;
      try {
        ws.destroy();
      } catch {
        /* destroy during an in-flight load */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sound.id, sound.file, sound.duration_s, sound.peaks, release]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const frame = requestAnimationFrame(() => ws.setOptions(colors()));
    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  useEffect(() => {
    if (playingId !== sound.id && wsRef.current?.isPlaying()) wsRef.current.pause();
  }, [playingId, sound.id]);

  const toggle = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || failed) return;
    if (ws.isPlaying()) {
      ws.pause();
      release(sound.id);
      return;
    }
    claim(sound.id);
    const region = activeRegionRef.current;
    const start = () => {
      // With a selection, play *it* (from its start), like an editor.
      const p = region ? region.play() : ws.play();
      void Promise.resolve(p).catch(() => setFailed(true));
    };
    const media = ws.getMediaElement();
    if (media) void applySink(media, sinkId).then(start);
    else start();
  }, [claim, release, sound.id, failed, sinkId]);

  const clearSelection = () => {
    activeRegionRef.current?.remove();
    activeRegionRef.current = null;
    setSelection(null);
  };

  const selectAll = () => {
    if (!regionsRef.current) return;
    activeRegionRef.current?.remove();
    activeRegionRef.current = regionsRef.current.addRegion({
      start: 0,
      end: sound.duration_s,
      color: "color-mix(in oklch, var(--primary) 22%, transparent)",
    });
    setSelection({ start: 0, end: sound.duration_s });
  };

  const apply = (req: SoundEditRequest) => {
    wsRef.current?.pause();
    edit.mutate(
      { id: sound.id, req },
      { onSuccess: (created) => navigate(`/sounds/${created.id}`) },
    );
  };

  /** Send the highlighted range off to be repainted. */
  const startRepaint = () => {
    if (!selection) return;
    wsRef.current?.pause();
    repaint.mutate(
      {
        source_sound_id: sound.id,
        start_s: selection.start,
        end_s: selection.end,
        prompt: repaint0.prompt.trim() || null,
        strength: repaint0.strength,
        mode: repaint0.mode,
      },
      { onSuccess: (ref) => setRepaintJobId(ref.job_id) },
    );
  };

  const repainting = repaintJobId !== null || repaint.isPending;
  const busy = edit.isPending || repainting;
  const hasSelection = selection !== null && selection.end - selection.start > 0.005;

  return (
    <div
      className="focus-visible:ring-ring/50 rounded-lg outline-none focus-visible:ring-3"
      tabIndex={0}
      role="group"
      aria-label={`${sound.name} editor — space to play, Escape to clear selection`}
      onKeyDown={(e) => {
        if (e.key === " " || e.code === "Space") {
          e.preventDefault();
          toggle();
        } else if (e.key === "Escape") {
          clearSelection();
        } else if ((e.key === "a" || e.key === "A") && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          selectAll();
        }
      }}
    >
      {/* Waveform + ruler */}
      <div
        ref={containerRef}
        className={cn("w-full cursor-text transition-opacity", failed && "opacity-40")}
        aria-hidden="true"
      />
      {failed && <p className="text-muted-foreground mt-1 text-xs">Audio unavailable</p>}

      {/* Transport + readout */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="icon"
          onClick={toggle}
          disabled={failed}
          aria-label={isPlaying ? "Pause" : hasSelection ? "Play selection" : "Play"}
          className={cn("rounded-full", isPlaying && "ring-4 ring-primary/15")}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon className="ml-0.5" />}
        </Button>
        <Tool
          label={loop ? "Loop selection: on" : "Loop selection"}
          icon={RepeatIcon}
          active={loop}
          onClick={() => setLoop((v) => !v)}
        />
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {formatDuration(currentTime)} / {formatDuration(sound.duration_s)}
        </span>

        <div className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
          {hasSelection && selection ? (
            <>
              <span className="tabular-nums">
                Selection {formatDuration(selection.start)} – {formatDuration(selection.end)}
                <span className="text-foreground ml-1.5 font-medium">
                  ({formatDuration(selection.end - selection.start)})
                </span>
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={clearSelection}>
                <XIcon />
              </Button>
            </>
          ) : (
            <span>Drag on the waveform to select · ⌘A selects all</span>
          )}
        </div>
      </div>

      <Separator className="my-3" />

      {/* Tools */}
      <div className="flex flex-wrap items-center gap-1">
        <Tool
          label={hasSelection ? "Trim to selection" : "Trim — select a range first"}
          icon={ScissorsIcon}
          disabled={busy || !hasSelection}
          onClick={() =>
            selection && apply({ op: "trim", start_s: selection.start, end_s: selection.end })
          }
        />
        <Tool label="Reverse" icon={ArrowLeftRightIcon} disabled={busy} onClick={() => apply({ op: "reverse" })} />

        <Separator orientation="vertical" className="mx-1 !h-5" />

        {/* Repaint sits with the destructive-looking tools rather than in the
            parameter group because it is the one that replaces audio: the
            highlighted range comes back different, and everything either side
            of it comes back untouched. */}
        {canRepaint && (
          <ParamTool
            label={hasSelection ? "Repaint selection" : "Repaint — select a range first"}
            icon={PaintbrushIcon}
            disabled={busy || !hasSelection}
          >
            <p className="text-muted-foreground text-xs leading-relaxed">
              {selection
                ? `Regenerates ${formatDuration(selection.start)}–${formatDuration(selection.end)} and keeps the rest of the clip untouched.`
                : "Regenerates the highlighted range and keeps the rest of the clip untouched."}
            </p>
            <RepaintControls
              value={repaint0}
              onChange={setRepaint0}
              placeholder={sound.prompt}
              idPrefix="repaint-editor"
            />
            <Button size="sm" className="w-full" disabled={busy || !hasSelection} onClick={startRepaint}>
              Repaint selection
            </Button>
          </ParamTool>
        )}

        <Separator orientation="vertical" className="mx-1 !h-5" />

        <ParamTool label="Gain" icon={Volume2Icon} disabled={busy}>
          <Param label="Gain" value={`${gainDb > 0 ? "+" : ""}${gainDb} dB`}>
            <Slider min={-24} max={24} step={0.5} value={[gainDb]} onValueChange={(v) => setGainDb(v[0])} />
          </Param>
          <Button size="sm" className="w-full" disabled={busy || gainDb === 0} onClick={() => apply({ op: "gain", gain_db: gainDb })}>
            Apply
          </Button>
        </ParamTool>

        <ParamTool label="Normalize loudness" icon={GaugeIcon} disabled={busy}>
          <Param label="Target" value={`${targetLufs} LUFS`}>
            <Slider min={-40} max={-6} step={1} value={[targetLufs]} onValueChange={(v) => setTargetLufs(v[0])} />
          </Param>
          <p className="text-muted-foreground text-xs leading-relaxed">
            -16 LUFS is what generation normalises to. Closer to 0 is louder and may clip.
          </p>
          <Button size="sm" className="w-full" disabled={busy} onClick={() => apply({ op: "normalize", target_lufs: targetLufs })}>
            Apply
          </Button>
        </ParamTool>

        <ParamTool label="EQ" icon={AudioWaveformIcon} disabled={busy}>
          <Param label="High-pass (cut rumble below)" value={`${highCutoff} Hz`}>
            <Slider min={20} max={2000} step={10} value={[highCutoff]} onValueChange={(v) => setHighCutoff(v[0])} />
          </Param>
          <Button size="sm" variant="outline" className="w-full" disabled={busy} onClick={() => apply({ op: "highpass", cutoff_hz: highCutoff })}>
            Apply high-pass
          </Button>
          <Param label="Low-pass (cut hiss above)" value={`${lowCutoff} Hz`}>
            <Slider min={1000} max={20000} step={100} value={[lowCutoff]} onValueChange={(v) => setLowCutoff(v[0])} />
          </Param>
          <Button size="sm" variant="outline" className="w-full" disabled={busy} onClick={() => apply({ op: "lowpass", cutoff_hz: lowCutoff })}>
            Apply low-pass
          </Button>
        </ParamTool>

        <ParamTool label="Pitch & time" icon={MusicIcon} disabled={busy}>
          <Param label="Pitch shift" value={`${semitones > 0 ? "+" : ""}${semitones} st`}>
            <Slider min={-12} max={12} step={1} value={[semitones]} onValueChange={(v) => setSemitones(v[0])} />
          </Param>
          <Button size="sm" variant="outline" className="w-full" disabled={busy || semitones === 0} onClick={() => apply({ op: "pitch", semitones })}>
            Apply pitch shift
          </Button>
          <Param label="Time-stretch" value={`${rate.toFixed(2)}×`}>
            <Slider min={0.5} max={2} step={0.05} value={[rate]} onValueChange={(v) => setRate(v[0])} />
          </Param>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Above 1× is faster and shorter; below 1× slower and longer. Pitch is preserved.
          </p>
          <Button size="sm" variant="outline" className="w-full" disabled={busy || rate === 1} onClick={() => apply({ op: "stretch", rate })}>
            Apply time-stretch
          </Button>
        </ParamTool>

        {busy && (
          <span className="text-muted-foreground ml-auto inline-flex items-center gap-1.5 text-xs">
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
            {repainting
              ? // The model render is the slow one, so it says how far along it
                // is rather than only that it is happening.
                `Repainting…${repaintJob ? ` ${Math.round(repaintJob.progress * 100)}%` : ""}`
              : "Rendering…"}
          </span>
        )}
      </div>
    </div>
  );
}
