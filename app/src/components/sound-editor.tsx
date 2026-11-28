/**
 * The waveform editor on a sound's detail page.
 *
 * Follows the layout every desktop audio editor shares (Audacity, Ocenaudio,
 * Descript): a large waveform you drag across to make a selection, a time
 * ruler under it, a transport, and one toolbar of tools that act on the
 * selection or the whole clip. Parameterised tools (volume, EQ, pitch and
 * speed) open a small popover with a slider and an Apply — no tab pages, no
 * separate form.
 *
 * The timeline is the waveform and its ruler together. The ruler is drawn here
 * rather than by wavesurfer's plugin so it can label in clock time at a step
 * that suits the clip's length, follow the theme, show the selection as a band
 * and be clicked to seek. Hovering either shows the time under the pointer.
 *
 * Every tool is non-destructive: Apply creates a new derived sound (see
 * `Sound.parent_id`) and navigates there. The clip on screen is never
 * overwritten.
 */

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import { useTheme } from "next-themes";
import {
  ArrowLeftRightIcon,
  AudioWaveformIcon,
  Loader2Icon,
  MusicIcon,
  PaintbrushIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  ScissorsIcon,
  SkipBackIcon,
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
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatClock } from "@/lib/format";
import { rulerTicks } from "@/lib/ruler";
import { MOD } from "@/lib/platform";
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

const REGION_COLOR = "color-mix(in oklch, var(--signal) 22%, transparent)";

/** What a page around the editor can ask of it: the hero's play button drives
 *  this transport instead of starting a second player for the same sound. */
export interface SoundEditorHandle {
  toggle: () => void;
}

/* --------------------------------------------------------------- toolbar */

/** A tool that acts at once: an icon and its name, so nothing has to be
 *  hovered to find out what it does. */
function Tool({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <Button variant="outline" size="sm" disabled={disabled} onClick={onClick}>
      <Icon />
      {label}
    </Button>
  );
}

/** A tool that opens a popover with one or two sliders and an Apply. */
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
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Icon />
          {label}
        </Button>
      </PopoverTrigger>
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

/** One named set of tools. The name says what they act on, which is the only
 *  thing that differs between the two sets. */
function ToolGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="min-w-0">
      <p className="label-caps text-muted-foreground mb-1.5">
        {label}
        {hint && <span className="text-muted-foreground/70"> · {hint}</span>}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- ruler */

/**
 * The time ruler under the waveform: clock labels, the selection as a band,
 * and a click or drag anywhere along it to move the playhead.
 */
function Ruler({
  durationS,
  widthPx,
  selection,
  onSeek,
}: {
  durationS: number;
  widthPx: number;
  selection: Selection;
  onSeek: (seconds: number) => void;
}) {
  const { ticks, step } = useMemo(() => rulerTicks(durationS, widthPx), [durationS, widthPx]);
  const dragging = useRef(false);
  const seekFrom = (el: HTMLElement, clientX: number) => {
    const box = el.getBoundingClientRect();
    if (box.width <= 0) return;
    onSeek(Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * durationS);
  };
  return (
    <div
      aria-hidden="true"
      className="border-border text-muted-foreground relative h-6 cursor-pointer touch-none border-t select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        seekFrom(e.currentTarget, e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) seekFrom(e.currentTarget, e.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      {selection && selection.end > selection.start && (
        <span
          className="bg-signal/25 border-signal absolute inset-y-0 border-x"
          style={{
            left: `${(selection.start / durationS) * 100}%`,
            width: `${((selection.end - selection.start) / durationS) * 100}%`,
          }}
        />
      )}
      {ticks.map((tick) => {
        const left = (tick.t / durationS) * 100;
        // The last label would run off the right edge; the total is already in
        // the transport's clock.
        const room = widthPx - (tick.t / durationS) * widthPx >= 40;
        return (
          <span key={tick.t} className="absolute top-0 h-full" style={{ left: `${left}%` }}>
            <span
              className={cn(
                "absolute top-0 w-px",
                tick.major ? "bg-border-strong h-2" : "bg-border h-1",
              )}
            />
            {tick.major && room && (
              <span className="readout absolute top-2 left-1 text-[10px] leading-4 whitespace-nowrap tabular-nums">
                {formatClock(tick.t, step < 1)}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- editor */

export function SoundEditor({
  sound,
  ref,
  onPlayingChange,
  waveHeight = 128,
}: {
  sound: Sound;
  ref?: React.Ref<SoundEditorHandle>;
  /** Told whenever this transport starts or stops, so a play button outside
   *  the editor can show the same state. */
  onPlayingChange?: (playing: boolean) => void;
  waveHeight?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const hoverLabelRef = useRef<HTMLSpanElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const activeRegionRef = useRef<Region | null>(null);
  const loopRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [loop, setLoop] = useState(false);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
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
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;

  const colors = () => ({
    waveColor: cssVar("--wave", "#888"),
    progressColor: cssVar("--primary", "#eee"),
    // The playhead is the beak: the one yellow on screen, as in the dock.
    cursorColor: cssVar("--signal", "#f2a40c"),
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: waveHeight,
      ...colors(),
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      peaks: [sound.peaks],
      duration: sound.duration_s,
      url: sound.file,
      plugins: [regions],
    });
    wsRef.current = ws;
    regionsRef.current = regions;

    // Drag on empty waveform = new selection. Only one selection at a time,
    // like every editor: a new drag replaces the previous region.
    regions.enableDragSelection({ color: REGION_COLOR });
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

    const playing = (on: boolean) => {
      setIsPlaying(on);
      onPlayingChangeRef.current?.(on);
    };
    ws.on("play", () => playing(true));
    ws.on("pause", () => playing(false));
    ws.on("finish", () => {
      // With nothing selected, Loop repeats the whole clip.
      if (loopRef.current && !activeRegionRef.current) {
        void ws.play();
        return;
      }
      playing(false);
      release(sound.id);
    });
    ws.on("timeupdate", (t: number) => setCurrentTime(t));
    ws.on("error", () => setFailed(true));

    return () => {
      wsRef.current = null;
      regionsRef.current = null;
      activeRegionRef.current = null;
      onPlayingChangeRef.current?.(false);
      try {
        ws.destroy();
      } catch {
        /* destroy during an in-flight load */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sound.id, sound.file, sound.duration_s, sound.peaks, waveHeight, release]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const frame = requestAnimationFrame(() => ws.setOptions(colors()));
    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  useEffect(() => {
    if (playingId !== sound.id && wsRef.current?.isPlaying()) wsRef.current.pause();
  }, [playingId, sound.id]);

  // The ruler lays its ticks out in pixels, so it has to know the width.
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  useImperativeHandle(ref, () => ({ toggle }), [toggle]);

  const seek = useCallback(
    (t: number) => {
      const ws = wsRef.current;
      if (!ws) return;
      const clamped = Math.min(sound.duration_s, Math.max(0, t));
      ws.setTime(clamped);
      setCurrentTime(clamped);
    },
    [sound.duration_s],
  );

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
      color: REGION_COLOR,
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

  /** The time under the pointer, written straight to the DOM: it moves on
   *  every pointer event, and nothing else in the editor depends on it. */
  const showHover = (e: React.PointerEvent<HTMLDivElement>) => {
    const line = hoverRef.current;
    const label = hoverLabelRef.current;
    if (!line || !label || e.pointerType === "touch") return;
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    line.style.left = `${ratio * 100}%`;
    line.style.opacity = "1";
    label.textContent = formatClock(ratio * sound.duration_s, true);
    // Flipped near the right edge so the label never leaves the timeline.
    label.style.transform = ratio > 0.9 ? "translateX(calc(-100% - 6px))" : "translateX(6px)";
  };
  const hideHover = () => {
    if (hoverRef.current) hoverRef.current.style.opacity = "0";
  };

  const repainting = repaintJobId !== null || repaint.isPending;
  const busy = edit.isPending || repainting;
  const hasSelection = selection !== null && selection.end - selection.start > 0.005;

  return (
    <div
      className="focus-visible:ring-ring/50 rounded-lg outline-none focus-visible:ring-3"
      tabIndex={0}
      role="group"
      aria-label={`${sound.name} editor. Space plays, the arrow keys seek, Escape clears the selection.`}
      onKeyDown={(e) => {
        // Sliders and buttons inside the popovers keep their own keys.
        if (e.target !== e.currentTarget) return;
        const step = e.shiftKey ? 1 : 5;
        if (e.key === " " || e.code === "Space") {
          e.preventDefault();
          toggle();
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          seek((wsRef.current?.getCurrentTime() ?? 0) + step);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          seek((wsRef.current?.getCurrentTime() ?? 0) - step);
        } else if (e.key === "Home") {
          e.preventDefault();
          seek(0);
        } else if (e.key === "Escape") {
          clearSelection();
        } else if ((e.key === "a" || e.key === "A") && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          selectAll();
        }
      }}
    >
      {/* The timeline: waveform over ruler, one hover line through both. */}
      <div
        ref={timelineRef}
        className="relative"
        onPointerMove={showHover}
        onPointerLeave={hideHover}
      >
        <div
          ref={containerRef}
          className={cn("sb-wave w-full cursor-text transition-opacity", failed && "opacity-40")}
          aria-hidden="true"
        />
        <Ruler durationS={sound.duration_s} widthPx={width} selection={selection} onSeek={seek} />
        <div
          ref={hoverRef}
          aria-hidden="true"
          className="bg-foreground/40 pointer-events-none absolute inset-y-0 z-10 w-px opacity-0 transition-opacity duration-(--duration-fast)"
        >
          <span
            ref={hoverLabelRef}
            className="readout bg-popover text-popover-foreground ring-border absolute top-1 rounded-sm px-1.5 py-0.5 text-[11px] whitespace-nowrap tabular-nums shadow-sm ring-1"
          />
        </div>
      </div>
      {failed && <p className="text-muted-foreground mt-1 text-xs">Audio unavailable</p>}

      {/* Transport + readout */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back to the start"
              onClick={() => seek(activeRegionRef.current?.start ?? 0)}
            >
              <SkipBackIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{hasSelection ? "Back to the selection's start" : "Back to the start"}</TooltipContent>
        </Tooltip>
        <Button
          size="icon"
          onClick={toggle}
          disabled={failed}
          aria-label={isPlaying ? "Pause" : hasSelection ? "Play selection" : "Play"}
          className="rounded-full"
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon className="ml-0.5" />}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Loop"
              aria-pressed={loop}
              onClick={() => setLoop((v) => !v)}
              className={cn(loop ? "bg-accent text-foreground" : "text-muted-foreground")}
            >
              <RepeatIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {loop ? "Loop is on" : hasSelection ? "Loop the selection" : "Loop the clip"}
          </TooltipContent>
        </Tooltip>
        <span className="readout ml-1 tabular-nums">
          <span className="text-foreground">{formatClock(currentTime, true)}</span>
          <span className="text-muted-foreground"> / {formatClock(sound.duration_s, true)}</span>
        </span>

        <div className="text-muted-foreground ml-auto flex min-w-0 items-center gap-1 text-xs">
          {hasSelection && selection ? (
            <>
              <span className="readout bg-signal/15 text-foreground rounded-sm px-1.5 py-0.5 tabular-nums">
                {formatClock(selection.start, true)} – {formatClock(selection.end, true)}
                <span className="text-muted-foreground">
                  {" "}
                  · {(selection.end - selection.start).toFixed(1)}s
                </span>
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={clearSelection}>
                <XIcon />
              </Button>
            </>
          ) : (
            <span className="truncate">
              Drag across the waveform to select
              <span className="max-sm:hidden"> · {MOD}+A selects all</span>
            </span>
          )}
        </div>
      </div>

      {/* Tools, grouped by what they act on. */}
      <div className="border-border mt-3 flex flex-wrap gap-x-6 gap-y-3 border-t pt-3">
        <ToolGroup label="Selection" hint={hasSelection ? undefined : "select a range first"}>
          <Tool
            label="Trim"
            icon={ScissorsIcon}
            disabled={busy || !hasSelection}
            onClick={() =>
              selection && apply({ op: "trim", start_s: selection.start, end_s: selection.end })
            }
          />
          {/* Repaint is the one that replaces audio: the highlighted range
              comes back different, and everything either side of it comes
              back untouched. */}
          {canRepaint && (
            <ParamTool label="Repaint" icon={PaintbrushIcon} disabled={busy || !hasSelection}>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {selection
                  ? `Regenerates ${formatClock(selection.start, true)}–${formatClock(selection.end, true)} and keeps the rest of the clip untouched.`
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
        </ToolGroup>

        <ToolGroup label="Whole clip">
          <Tool label="Reverse" icon={ArrowLeftRightIcon} disabled={busy} onClick={() => apply({ op: "reverse" })} />

          {/* Gain and loudness are the same question asked two ways (by how
              much, or to what level), so they share one tool. */}
          <ParamTool label="Volume" icon={Volume2Icon} disabled={busy}>
            <Param label="Gain" value={`${gainDb > 0 ? "+" : ""}${gainDb} dB`}>
              <Slider min={-24} max={24} step={0.5} value={[gainDb]} onValueChange={(v) => setGainDb(v[0])} />
            </Param>
            <Button size="sm" variant="outline" className="w-full" disabled={busy || gainDb === 0} onClick={() => apply({ op: "gain", gain_db: gainDb })}>
              Apply gain
            </Button>
            <Param label="Normalize loudness to" value={`${targetLufs} LUFS`}>
              <Slider min={-40} max={-6} step={1} value={[targetLufs]} onValueChange={(v) => setTargetLufs(v[0])} />
            </Param>
            <p className="text-muted-foreground text-xs leading-relaxed">
              -16 LUFS is what generation normalises to. Closer to 0 is louder and may clip.
            </p>
            <Button size="sm" variant="outline" className="w-full" disabled={busy} onClick={() => apply({ op: "normalize", target_lufs: targetLufs })}>
              Normalize
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

          <ParamTool label="Pitch & speed" icon={MusicIcon} disabled={busy}>
            <Param label="Pitch shift" value={`${semitones > 0 ? "+" : ""}${semitones} st`}>
              <Slider min={-12} max={12} step={1} value={[semitones]} onValueChange={(v) => setSemitones(v[0])} />
            </Param>
            <Button size="sm" variant="outline" className="w-full" disabled={busy || semitones === 0} onClick={() => apply({ op: "pitch", semitones })}>
              Apply pitch shift
            </Button>
            <Param label="Speed" value={`${rate.toFixed(2)}×`}>
              <Slider min={0.5} max={2} step={0.05} value={[rate]} onValueChange={(v) => setRate(v[0])} />
            </Param>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Above 1× is faster and shorter; below 1× slower and longer. Pitch is preserved.
            </p>
            <Button size="sm" variant="outline" className="w-full" disabled={busy || rate === 1} onClick={() => apply({ op: "stretch", rate })}>
              Apply speed
            </Button>
          </ParamTool>
        </ToolGroup>

        {busy && (
          <span className="text-muted-foreground ml-auto inline-flex items-center gap-1.5 self-end text-xs">
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
            {repainting
              ? // The model render is the slow one, so it says how far along it
                // is rather than only that it is happening.
                `Repainting…${repaintJob ? ` ${Math.round(repaintJob.progress * 100)}%` : ""}`
              : "Rendering…"}
          </span>
        )}
      </div>
      <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
        Every tool saves a new version. This clip is never overwritten.
      </p>
    </div>
  );
}
