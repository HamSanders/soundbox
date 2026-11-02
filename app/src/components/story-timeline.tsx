/**
 * The story timeline: every line of a script as a clip you can move.
 *
 * The script beside this answers "what does this say"; the timeline answers
 * "when does it happen". They are the same lines seen two ways, and the
 * timeline is the one that decides order: drop a clip earlier and it moves
 * earlier in the script too, because a script that disagrees with the
 * arrangement is simply wrong.
 *
 * Waveforms are drawn by hand from each sound's `peaks` rather than through
 * WaveSurfer, which the single-clip sound editor uses. WaveSurfer is built
 * around one clip owning one container, with its own scroll, zoom and audio
 * context; a dozen of them sharing one ruler would each be fighting the same
 * pan/zoom state. `peaks` is already on every Sound the segment list returns,
 * so a canvas per clip costs a fill loop and no decoding at all.
 *
 * Playback is Web Audio rather than an <audio> element per clip: overlapping
 * clips on different tracks have to line up to the sample, and keeping several
 * media elements in sync by poking `currentTime` does not survive contact with
 * a real mix. It is the one place this component decodes audio, and it does so
 * lazily — nothing is fetched until you press play.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CopyIcon,
  ExpandIcon,
  MicIcon,
  PaintbrushIcon,
  PlayIcon,
  PlusIcon,
  Redo2Icon,
  RepeatIcon,
  CircleIcon,
  LayersIcon,
  Loader2Icon,
  ScissorsIcon,
  UploadIcon,
  SquareIcon,
  Trash2Icon,
  Undo2Icon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VoiceAvatar, useVoice } from "@/components/voice-avatar";
import { LoadingVerb } from "@/components/loading-verb";
import { usePlayerStore } from "@/lib/player-store";
import { useRecorder } from "@/hooks/use-recorder";
import { toast } from "sonner";

import { AUDIO_ACCEPT, stemOf, toWav } from "@/lib/audio-file";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createLaneChain } from "@/lib/device-chain";
import { currentSoundDrag, getSoundDrag, isSoundDrag } from "@/lib/dnd";
import { laneColor, laneIsFree, lanesFor, nextFreeTrack } from "@/lib/lanes";
import { computeFades, fadeCurve } from "@/lib/fades";
import { chainShapeChanged } from "@/lib/devices";
import type { LaneChain } from "@/lib/device-chain";
import type { DeviceSpec, TrackDevices } from "@/lib/devices";
import type { EditKind, Sound, StorySegment, StoryTrack, TrackPatch } from "@/lib/api";

/** The story transport's handle in the global one-thing-plays-at-a-time
 *  store, so a clip's own player yields to it and vice versa. */
const STORY_PLAYER_ID = "story-timeline";

/** Zoom bounds in pixels per second. The floor keeps a long story legible
 *  end-to-end; the ceiling is where a split becomes a precise gesture. */
const MIN_PPS = 8;
const MAX_PPS = 400;
const DEFAULT_PPS = 40;
const LANE_HEIGHT = 64;
/** One row of ticks. There are two — bars glued to the top of the lanes,
 *  time glued to the bottom — and they share this height. */
const RULER_HEIGHT = 22;
/** The timeline has no tempo of its own yet, and a bar ruler that refused to
 *  draw until someone set one would be empty on every new story. 120 / 4 is
 *  what a DAW opens on. */
const DEFAULT_BPM = 120;
const BEATS_PER_BAR = 4;
/** The track header column: name, mute, solo, volume. Wide enough for the
 *  controls to be pressable rather than fiddly, which is the whole reason it
 *  stopped being a 44px number. */
const GUTTER = 168;
/** How far the pointer has to travel before a press counts as a drag rather
 *  than a click. Without it, the pixel of jitter in a normal trackpad click
 *  commits a move — so selecting a clip would quietly nudge it out of place,
 *  which is both wrong and very hard to notice. */
const DRAG_THRESHOLD_PX = 4;
/** A clip has to keep some length or it becomes impossible to grab again. */
const MIN_CLIP_S = 0.05;
/** How close a dragged edge has to come before it snaps. In pixels rather
 *  than seconds on purpose: it is a hand-eye tolerance, so it has to mean the
 *  same thing zoomed in as zoomed out. */
const SNAP_PX = 8;


/**
 * How loud a lane should be, as a linear multiplier.
 *
 * Solo wins over mute, as it does on any desk: once something is soloed the
 * question stops being "what have I silenced" and becomes "what am I listening
 * to". A lane with no row is at defaults — audible unless something else is
 * soloed. Silence is a gain of zero rather than an unscheduled clip, so
 * unmuting mid-playback brings the track back where it should be rather than
 * from the top.
 */
function laneGain(tracks: StoryTrack[], lane: number): number {
  const soloing = tracks.some((t) => t.soloed);
  const track = tracks.find((t) => t.track_index === lane) ?? null;
  const audible = soloing ? (track?.soloed ?? false) : !(track?.muted ?? false);
  if (!audible) return 0;
  return 10 ** ((track?.gain_db ?? 0) / 20);
}

/** A line that has been written but not yet spoken still needs a width, or the
 *  timeline rearranges itself the moment audio lands. Speech runs about
 *  0.4s/word; close enough to hold a place. */
function estimateDuration(segment: StorySegment): number {
  if (segment.duration_s) return segment.duration_s;
  const words = segment.text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(0.8, words * 0.4);
}

/** Ruler tick spacing that keeps labels ~80px apart at any zoom, chosen from
 *  intervals that read as time rather than as arbitrary numbers. */
/** Timeline order for a set of clips: earliest first, upper track wins a tie.
 *  Bulk actions run in this order so "duplicate" twice gives the same result. */
function byStart(a: StorySegment, b: StorySegment): number {
  return a.start_s - b.start_s || a.track_index - b.track_index;
}

/**
 * Take the pointer, but never let failing to take it end the gesture.
 *
 * `setPointerCapture` throws `NotFoundError` if the pointer is already gone by
 * the time the handler runs — a fast click, an element replaced mid-gesture.
 * Uncaught, that aborts the handler before it records any drag state, and the
 * clip is left neither draggable nor clickable with no sign of why. Capture is
 * an optimisation for tracking the pointer outside the element; the gesture is
 * worth more than the capture.
 */
function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    /* pointer already released — the gesture still works, just unbounded */
  }
}

function tickInterval(pxPerSecond: number): number {
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return candidates.find((t) => t * pxPerSecond >= 80) ?? 600;
}

function secondsPerBeat(bpm = DEFAULT_BPM): number {
  return 60 / bpm;
}

/** How many bars between labelled ticks, so labels never crowd. */
function barTickStride(pxPerSecond: number, barS: number): number {
  let n = 1;
  while (n * barS * pxPerSecond < 56 && n < 64) n *= 2;
  return n;
}

function barMarks(
  durationS: number,
  pxPerSecond: number,
): { t: number; label: string | null; major: boolean }[] {
  const beatS = secondsPerBeat();
  const barS = beatS * BEATS_PER_BAR;
  const stride = barTickStride(pxPerSecond, barS);
  const showBeats = beatS * pxPerSecond >= 24;
  const out: { t: number; label: string | null; major: boolean }[] = [];
  const end = durationS + barS;
  if (showBeats) {
    const n = Math.ceil(end / beatS);
    for (let i = 0; i <= n; i++) {
      const beat = i % BEATS_PER_BAR;
      const bar = Math.floor(i / BEATS_PER_BAR);
      const isBar = beat === 0;
      out.push({
        t: i * beatS,
        label: isBar && bar % stride === 0 ? String(bar + 1) : null,
        major: isBar,
      });
    }
  } else {
    const n = Math.ceil(end / barS);
    for (let bar = 0; bar <= n; bar++) {
      const labeled = bar % stride === 0;
      out.push({ t: bar * barS, label: labeled ? String(bar + 1) : null, major: labeled });
    }
  }
  return out;
}

function TimelineRuler({
  stick,
  ariaLabel,
  ticks,
  loop,
  looping,
  pxPerSecond,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  stick: "top" | "bottom";
  ariaLabel: string;
  ticks: { t: number; label: string | null; major: boolean }[];
  loop: { start: number; end: number } | null;
  looping: boolean;
  pxPerSecond: number;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={cn(
        "bg-card border-border sticky z-20 flex shrink-0",
        stick === "top" ? "top-0 border-b" : "bottom-0 border-t",
      )}
      style={{ height: RULER_HEIGHT }}
    >
      <div
        className="bg-card border-border sticky left-0 z-30 shrink-0 border-r"
        style={{ width: GUTTER }}
        aria-hidden="true"
      />
      <div
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={0}
        className="text-muted-foreground relative min-w-0 flex-1 cursor-ew-resize touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {loop !== null && loop.end > loop.start && (
          <div
            className={cn(
              "pointer-events-none absolute inset-y-0 rounded-sm border",
              looping
                ? "border-primary bg-primary/30"
                : "border-muted-foreground/40 bg-muted-foreground/10 border-dashed",
            )}
            style={{
              left: loop.start * pxPerSecond,
              width: Math.max(1, (loop.end - loop.start) * pxPerSecond),
            }}
            aria-hidden="true"
          />
        )}
        {ticks.map((tick) => (
          <div
            key={tick.t}
            className="absolute top-0 flex h-full items-center"
            style={{ left: tick.t * pxPerSecond }}
          >
            <div
              className={cn("bg-border absolute top-0 w-px", tick.major ? "h-2" : "h-1.5 opacity-60")}
            />
            {tick.label !== null && (
              <span className="ml-1 font-mono text-[10px] tabular-nums">{tick.label}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A clip that does not exist yet.
 *
 * Generating straight onto the timeline — from the Prompt panel, or from an
 * instruction in the chat — takes seconds to a minute, and for all of it the
 * lane used to stay empty: the request had been made and nothing on screen
 * said so. This is the promise of the clip, drawn where it will land and as
 * long as it was asked to be, carrying the job's progress, until the real
 * segment arrives and takes its place.
 */
export interface PendingClip {
  id: string;
  track_index: number;
  start_s: number;
  duration_s: number;
  label: string;
  /** 0–1 from the job stream; 0 while queued. */
  progress: number;
  /** The job's current phase, already turned into words. */
  phase: string | null;
}

export interface StoryTimelineProps {
  segments: StorySegment[];
  /** Clips still being generated — see `PendingClip`. */
  pending?: PendingClip[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /**
   * Open this clip properly — double-clicking it.
   *
   * Selecting a clip and asking to *look* at one are different questions, and
   * the timeline already spends single-click on the first. Double-click is the
   * spare gesture, and "open the thing under the pointer" is what it means
   * almost everywhere else, so the Sample panel can stay off the stack until
   * someone actually asks for it rather than sitting there captioned with
   * whatever was last clicked.
   */
  onOpenSample: (id: string) => void;
  /** Commit a drag. Called on drop, not during — the clip follows the pointer
   *  locally so the timeline never waits on a round trip to move. */
  /**
   * Commit a move — every clip that shifted, in one call.
   *
   * A list rather than one clip because a drag can carry a selection, and the
   * page has to treat that as a single edit: one entry on the undo stack, and
   * one reorder computed from all the new positions at once. Called on drop,
   * not during — the clips follow the pointer locally so the timeline never
   * waits on a round trip to move.
   */
  onMove: (moves: { id: string; patch: { start_s: number; track_index: number } }[]) => void;
  onToggleMute: (segment: StorySegment) => void;
  /** Every clip in one call, so a multi-clip delete is one undo step. */
  onDelete: (ids: string[]) => void;
  /** Every copy in one call, for the same reason as `onDelete`. */
  onDuplicate: (segments: StorySegment[]) => void;
  /** Every cut in one call — splitting all lanes at the playhead is one edit,
   *  and one undo. `atS` is seconds into the clip. */
  onSplit: (cuts: { id: string; atS: number }[]) => void;
  /** Add a line at a point in time — from clicking empty track, or from the
   *  toolbar's Add, which uses wherever the playhead is parked. */
  onAddAt: (at: { start_s: number; track_index: number; text: string }) => void;
  /** Re-read a line, replacing its take. */
  onRegenerate: (id: string) => void;
  /** True while an agent holds this story. The timeline stays visible and
   *  playable; only the edits that would race the agent are withheld. */
  readOnly?: boolean;
  /** Put a copied clip down at a point in time, words and all. */
  onPaste: (segment: StorySegment, at: { start_s: number; track_index: number }) => void;
  /** Undo/redo live with the mutations, in the page — see use-edit-history. */
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** What the next undo would reverse, for the tooltip. */
  undoLabel: string | null;
  /** Lines with a read in flight, so their clips can show it. */
  generating: Set<string>;
  /** Per-track state. Absent means the track is at its defaults. */
  tracks: StoryTrack[];
  onTrack: (trackIndex: number, patch: TrackPatch) => void;
  /** Make a new empty lane below the last one. */
  onAddTrack: (trackIndex: number) => void;
  /** Remove a lane and the clips on it. */
  onRemoveTrack: (trackIndex: number, clips: number) => void;
  /** Insert chains per lane, from the rack below. Applied to playback only —
   *  the export mixdown on the server knows nothing about them. */
  devices: TrackDevices;
  /**
   * A take from the microphone, on its way to its own track.
   *
   * The timeline owns the gesture (where the playhead is, which lane is free)
   * and the page owns the upload, because the page is where mutations live.
   */
  onRecorded: (blob: Blob, at: { start_s: number; track_index: number }) => Promise<void>;
  /**
   * A file from the user's own machine, already converted to WAV.
   *
   * Converted here rather than on the server because the server decodes WAV
   * and nothing else, and Soundbox does not ship ffmpeg — but the browser
   * already has a decoder for every format it can play. `lib/audio-file`
   * exists for exactly this and the voice uploader uses it too, so an mp3 or
   * an m4a drops onto a lane without anything new being installed.
   */
  onImported: (
    wav: Blob,
    name: string,
    at: { start_s: number; track_index: number },
  ) => Promise<void>;
  /**
   * Bring one of the studio's panels forward, focused and ready to type in.
   *
   * The lane menu offers "new prompt" and "insert sample", and both of those
   * already exist as panels beside the timeline. Rather than reimplement a
   * prompt box and a library search inside a context menu, the timeline asks
   * the page to open the real one — which is also the only version that
   * remembers your model, your history and your filters.
   */
  onOpenPanel: (panel: "insert" | "library") => void;
  /** Fade a clip in or out, by dragging the handle in its top corner. */
  onFade: (id: string, patch: { fade_in_s?: number; fade_out_s?: number }) => void;
  /** Trim or lengthen a clip by dragging an edge. `trim_start_s` moves the
   *  in-point into the source, `duration_s` how much of it plays. */
  onResize: (
    id: string,
    patch: { start_s: number; duration_s: number; trim_start_s: number },
  ) => void;
  /** Drop an existing library sound in at a point in time. */
  onInsertSound: (
    soundId: string,
    at: { start_s: number; track_index: number; name?: string },
  ) => void;
  /**
   * The clip the playhead is currently inside, whenever that changes — while
   * playing and while scrubbing.
   *
   * This is what lets the script highlight the line being spoken: the script
   * is in reading order and the timeline is in time, and the playhead is the
   * only thing that knows which line those two views have in common. Fires on
   * change only, not on every frame.
   */
  onActiveSegmentChange?: (id: string | null) => void;
  /**
   * Hand the page this timeline's transport, so the main play control can live
   * somewhere else — the dock, in practice.
   *
   * The scheduling stays here (it owns the AudioContext, the decoded buffers
   * and the playhead), so what gets lifted is the two verbs, not the state.
   * Called with null on unmount so nothing holds a stale handle.
   */
  onTransport?: (transport: { play: () => void; stop: () => void } | null) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** Where the story transport is, so the dock can show it playing rather
   *  than showing whichever clip happens to be selected. */
  onProgress?: (at: number, total: number) => void;
  /** Everything selected, whenever it changes. The parent already learns the
   *  primary through `onSelect`; this is what tells it about the rest, so a
   *  bar outside the timeline can act on "these clips". */
  onSelectionChange?: (ids: string[]) => void;
  /** Incremented by the page to ask for a recording — the studio assistant
   *  saying "start recording". The transport lives here, so the request has
   *  to come in rather than the button going out. */
  recordRequest?: number;
  /**
   * Extend or cover a clip's underlying sound from the right-click menu —
   * the timeline's own version of the Library's "Extend this track" /
   * "Cover in a new style" (see `SoundCard`). Omitted (or a clip with no
   * rendered `sound` yet) hides both rows; the same gate `MusicRequestForm`
   * uses decides which is offered, via `canExtend`/`canCover`.
   */
  onEditSound?: (kind: EditKind, sound: Sound) => void;
  canExtend?: boolean;
  canCover?: boolean;
  /**
   * Split the clip's sound into stems, each onto a lane of its own.
   *
   * The Library can already do this to a sound, but by then you are no longer
   * where the arrangement is — and taking the drums out of a bed you have
   * already placed is a timeline gesture, not a library one. The page owns
   * the choosing (which stems, what happens to the rest) and the job, for the
   * same reason it owns every other mutation. Omitted, or a clip with no
   * rendered sound, hides the row.
   */
  onSeparateClip?: (segment: StorySegment) => void;
  /** False when no separation model is installed, which is a real state on a
   *  fresh install rather than a bug. */
  canSeparate?: boolean;
  /**
   * Repaint part of a clip's sound and put the result back in the same place.
   *
   * The window is the span marked on the ruler, cut down to the clip that was
   * right-clicked — which is why this is a timeline gesture and not a library
   * one: "this bit, here" is a thing you can only say with the arrangement in
   * front of you. With nothing marked it is the whole clip. Given in *source*
   * seconds, since that is what the model is being asked about; the caller
   * never has to know the clip's trim.
   */
  onRepaintClip?: (segment: StorySegment, window: { start_s: number; end_s: number }) => void;
  /** False when nothing installed can repaint — only ACE-Step can today. */
  canRepaint?: boolean;
  /**
   * Where the play/rec/tools row should live.
   *
   * The timeline owns playing, recording, zoom and the selection those
   * buttons act on, so the tools cannot move to the page. The artifact
   * header is the right place for them visually, and a portal is how they
   * get there without lifting the state. Pass the host (including `null`
   * while the ref attaches) to portal; omit the prop to keep the in-body
   * bar.
   */
  toolbarHost?: HTMLElement | null;
}

export function StoryTimeline({
  segments,
  pending = [],
  selectedId,
  onSelect,
  onOpenSample,
  onMove,
  onToggleMute,
  onDelete,
  onDuplicate,
  onSplit,
  onAddAt,
  onRegenerate,
  onPaste,
  undo,
  redo,
  canUndo,
  canRedo,
  undoLabel,
  readOnly = false,
  generating,
  tracks,
  onTrack,
  onAddTrack,
  onRemoveTrack,
  devices,
  onRecorded,
  onImported,
  onOpenPanel,
  onFade,
  onResize,
  onInsertSound,
  onEditSound,
  canExtend = false,
  canCover = false,
  onSeparateClip,
  canSeparate = false,
  onRepaintClip,
  canRepaint = false,
  onActiveSegmentChange,
  onTransport,
  onPlayingChange,
  onProgress,
  onSelectionChange,
  recordRequest,
  toolbarHost,
}: StoryTimelineProps) {
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PPS);
  const [playhead, setPlayhead] = useState(0);
  // For play(), which starts from wherever the playhead is parked but must
  // not be rebuilt every frame it moves — a new `play` re-publishes the
  // transport upward, and that re-rendered the whole studio at frame rate.
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const [playing, setPlaying] = useState(false);
  /** Armed by the scissors button: the next click on a clip cuts it there,
   *  rather than the tool being a mode you can forget you are in. */
  const [splitArmed, setSplitArmed] = useState(false);
  /** Where the dragged clip currently is, before the drop commits it. */
  /** Where each clip in the gesture is being drawn right now, by id. A map
   *  rather than one id because a drag can carry a whole selection. */
  const [drag, setDrag] = useState<Record<string, { startS: number; track: number }> | null>(null);
  /** The lane a library sound is hovering over, so it is obvious where a drop
   *  would land before letting go of it. */
  const [dropLane, setDropLane] = useState<number | null>(null);

  /**
   * Recording, straight onto the timeline.
   *
   * The take lands on a new track at the playhead — new audio never lands on
   * top of old audio, and a lane of its own is the only placement that cannot
   * be wrong. Where the playhead was when you pressed record is remembered on
   * the way in, because moving it while you talk is exactly the sort of thing
   * that happens and should not move the take.
   */
  const recorder = useRecorder();
  const [saving, setSaving] = useState(false);
  /** Where a picked file should land, remembered across the file dialog —
   *  which is modal and takes as long as the user takes. */
  const importAtRef = useRef<{ start_s: number; track_index: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  /**
   * Bring a file in, wherever it came from — the lane menu's picker or a drop
   * straight onto a track.
   *
   * Decoding is the slow part on a long file, so the lane shows it as busy
   * rather than appearing to have ignored the drop.
   */
  const importFile = async (
    file: File,
    at: { start_s: number; track_index: number },
  ): Promise<void> => {
    setImporting(true);
    try {
      const wav = await toWav(file, file.name);
      await onImported(wav, stemOf(file.name), at);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `${file.name} could not be imported`,
      );
    } finally {
      setImporting(false);
    }
  };
  const recordAtRef = useRef<{ start_s: number; track_index: number } | null>(null);

  const startRecording = (): void => {
    recordAtRef.current = {
      start_s: round3(playhead),
      track_index: nextFreeTrack(segments),
    };
    void recorder.start();
  };

  // The blob arrives a beat after `stop()` — MediaRecorder flushes
  // asynchronously — so the upload hangs off the recorder's state rather than
  // off the click that ended it.
  useEffect(() => {
    if (recorder.state !== "recorded" || recorder.blob === null) return;
    const at = recordAtRef.current;
    if (at === null) return;
    recordAtRef.current = null;
    const blob = recorder.blob;
    setSaving(true);
    void onRecorded(blob, at)
      .catch(() => {
        /* the page surfaces the failure; the take is already gone from here */
      })
      .finally(() => {
        setSaving(false);
        recorder.reset();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on the take, not on the recorder's identity
  }, [recorder.state, recorder.blob]);
  /** The spot an insert popover is anchored to, in timeline terms. Null when
   *  closed — clicking empty track opens it exactly where you clicked. */
  /**
   * The clips selected *besides* the primary one.
   *
   * Selection is "the one the rest of the app is looking at, plus any others
   * you added". `selectedId` stays the parent's — it drives the Sample panel
   * and which track the device rack shows, and both of those want exactly one
   * answer. Holding the extras here rather than lifting the whole set means
   * nothing outside the timeline has to learn about multi-select to keep
   * working, and the primary never has to be guessed from a set's iteration
   * order.
   */
  const [extraIds, setExtraIds] = useState<Set<string>>(() => new Set());

  /** Everything currently selected: the primary and the extras, as one set. */
  const selectedIds = useMemo(() => {
    const all = new Set(extraIds);
    if (selectedId) all.add(selectedId);
    return all;
  }, [extraIds, selectedId]);

  /** The selected segments, in timeline order — what the bulk actions run
   *  over, so "duplicate" and "delete" behave the same way twice. */
  const selectedSegments = useMemo(
    () => segments.filter((s) => selectedIds.has(s.id)).sort(byStart),
    [segments, selectedIds],
  );

  /** Replace the whole selection with one clip. */
  const selectOnly = (id: string | null): void => {
    setExtraIds(new Set());
    onSelect(id);
  };

  /**
   * Add or remove one clip, keeping the rest — shift- or ctrl-click.
   *
   * Deselecting the primary promotes another clip rather than emptying the
   * selection, because the panels that read `selectedId` would otherwise go
   * blank while three clips are still visibly ringed on the timeline.
   */
  const toggleSelected = (id: string): void => {
    if (id === selectedId) {
      const next = new Set(extraIds);
      const promoted = next.values().next().value ?? null;
      if (promoted) next.delete(promoted);
      setExtraIds(next);
      onSelect(promoted);
      return;
    }
    setExtraIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!selectedId) onSelect(id);
  };

  /**
   * The rubber band, in the scroll content's own coordinates.
   *
   * Drawn from `contentRef` rather than the viewport so it stays pinned to the
   * clips underneath it while the timeline scrolls, which is the whole reason
   * it is measured against the content box and not the pointer's screen
   * position.
   */
  const contentRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef<{
    pointerId: number;
    x0: number;
    y0: number;
    /** Selection to restore around — shift-drag adds to what was already
     *  chosen rather than replacing it. */
    base: Set<string>;
    /** A press is a scrub until it travels far enough to be a drag; see
     *  `MARQUEE_SLOP`. */
    active: boolean;
  } | null>(null);
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  /** Right-click on a clip: what you can do to *this* clip, where you asked. */
  const [clipMenu, setClipMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  /**
   * Right-click on empty track: what you can *put* there.
   *
   * This used to open the write-a-line box directly, which quietly decided
   * that the only thing you could want on an empty lane was a written line —
   * so recording, generating and reaching for a sound you already have all had
   * to be found somewhere else. The box is still here, one item down.
   */
  const [laneMenu, setLaneMenu] = useState<{
    startS: number;
    track: number;
    x: number;
    y: number;
  } | null>(null);
  const [insertAt, setInsertAt] = useState<{
    startS: number;
    track: number;
    x: number;
    y: number;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = segments.find((s) => s.id === selectedId) ?? null;

  /** Which lanes exist — see `lanesFor`. */
  const lanes = useMemo(() => lanesFor(segments, tracks), [segments, tracks]);

  const totalDuration = useMemo(
    () => Math.max(10, ...segments.map((s) => s.start_s + estimateDuration(s))),
    [segments],
  );
  /** A screen's worth of empty room past the end, so the last clip isn't
   *  pinned against the right edge with nowhere to drag it. */
  const width = Math.ceil((totalDuration + 5) * pxPerSecond);

  /* ------------------------------------------------------------- dragging */

  /**
   * An edge drag in progress.
   *
   * Kept apart from the move drag because the two mean different things and
   * clamp differently: moving is unbounded in time, trimming is bounded by how
   * much source audio there actually is.
   */
  const edgeRef = useRef<{
    id: string;
    pointerId: number;
    edge: "start" | "end";
    originX: number;
    startS: number;
    durationS: number;
    trimStartS: number;
    sourceS: number;
    /** Where the drag has reached. On the ref as well as in state because
     *  pointerup has to read it, and the state it closes over is from the
     *  last render — which has not happened when the moves and the release
     *  land in one batch. */
    currentStartS: number;
    currentDurationS: number;
    /** The other clips' edges, the playhead and zero — captured once, when
     *  the drag starts, because they cannot move while it runs. */
    targets: number[];
  } | null>(null);
  const [edgeDrag, setEdgeDrag] = useState<{
    id: string;
    startS: number;
    durationS: number;
  } | null>(null);

  /**
   * Dragging a fade handle.
   *
   * Live in state as well as on the ref so the clip can draw the fade as it is
   * dragged: a fade you cannot see the length of until you let go is one you
   * have to try twice.
   */
  const fadeRef = useRef<{
    id: string;
    pointerId: number;
    edge: "in" | "out";
    originX: number;
    startS: number;
    lengthS: number;
    current: number;
  } | null>(null);
  const [fadeDrag, setFadeDrag] = useState<{ id: string; edge: "in" | "out"; span: number } | null>(
    null,
  );

  const onFadeDown = (
    event: React.PointerEvent,
    segment: StorySegment,
    edge: "in" | "out",
  ): void => {
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation(); // never also starts a move or a trim
    onSelect(segment.id);
    capturePointer(event.currentTarget as HTMLElement, event.pointerId);
    const length = segment.duration_s ?? estimateDuration(segment);
    fadeRef.current = {
      id: segment.id,
      pointerId: event.pointerId,
      edge,
      originX: event.clientX,
      startS: segment.start_s,
      lengthS: length,
      current: (edge === "in" ? segment.fade_in_s : segment.fade_out_s) ?? 0,
    };
  };

  const onFadeMove = (event: React.PointerEvent): void => {
    const st = fadeRef.current;
    if (st === null || st.pointerId !== event.pointerId) return;
    const dt = (event.clientX - st.originX) / pxPerSecond;
    // Dragging inward lengthens either fade, so the out-handle reads the
    // pointer backwards. Half the clip each, so the two can never cross.
    const raw = st.edge === "in" ? st.current + dt : st.current - dt;
    const span = Math.max(0, Math.min(st.lengthS / 2, raw));
    st.current = span;
    st.originX = event.clientX;
    setFadeDrag({ id: st.id, edge: st.edge, span });
  };

  const onFadeUp = (event: React.PointerEvent): void => {
    const st = fadeRef.current;
    if (st === null || st.pointerId !== event.pointerId) return;
    fadeRef.current = null;
    setFadeDrag(null);
    onFade(st.id, st.edge === "in" ? { fade_in_s: round3(st.current) } : { fade_out_s: round3(st.current) });
  };

  /** The ruler's own spacing, and so what "on the grid" means at this zoom:
   *  snapping to a grid you cannot see would feel like a magnet with no
   *  cause. */
  const gridS = tickInterval(pxPerSecond);

  /** What each clip is *drawing* as its fades: its own, plus any crossfade an
   *  overlap has earned it. Same rule the transport and the export use, so an
   *  overlap looks like what it will sound like. */
  const laneFades = useMemo(
    () => computeFades(segments, (clip) => clip.duration_s ?? estimateDuration(clip as StorySegment)),
    [segments],
  );

  /**
   * The loop: a span on the ruler, and whether the transport is honouring it.
   *
   * Two pieces of state rather than one nullable span, because "stop looping
   * but keep the region I marked" is the thing you do between takes — losing
   * the span every time you want to hear the rest of the story would make
   * marking it a chore.
   *
   * Shift-drag on the ruler marks it; the toolbar's toggle turns it on and
   * off. It is a working region, not a property of the story, so it is not
   * persisted and does not appear in the export.
   */
  const [loop, setLoop] = useState<{ start: number; end: number } | null>(null);
  const [looping, setLooping] = useState(false);
  const loopRef = useRef<{ start: number; end: number } | null>(null);
  loopRef.current = looping ? loop : null;

  /**
   * Everything a dragged clip can line up against, except itself.
   *
   * Recomputed per drag rather than per frame — the clip being dragged is
   * excluded, and which clip that is only changes when a new drag starts.
   */
  const snapTargets = useCallback(
    (except: ReadonlySet<string> | string): number[] => {
      // A group snapping to its own members would pin the drag to wherever it
      // started, so every clip travelling with the gesture is excluded.
      const skip = typeof except === "string" ? new Set([except]) : except;
      const times = [0, playhead];
      for (const segment of segments) {
        if (skip.has(segment.id)) continue;
        times.push(segment.start_s);
        times.push(segment.start_s + (segment.duration_s ?? estimateDuration(segment)));
      }
      return times;
    },
    [segments, playhead],
  );

  const onEdgeDown = (
    event: React.PointerEvent,
    segment: StorySegment,
    edge: "start" | "end",
  ): void => {
    if (event.button !== 0 || readOnly) return;
    event.stopPropagation(); // never also starts a move
    onSelect(segment.id);
    capturePointer(event.currentTarget as HTMLElement, event.pointerId);
    edgeRef.current = {
      id: segment.id,
      pointerId: event.pointerId,
      edge,
      originX: event.clientX,
      startS: segment.start_s,
      durationS: segment.duration_s ?? estimateDuration(segment),
      trimStartS: segment.trim_start_s ?? 0,
      // A pause has no source to run out of, so it stretches freely.
      sourceS: segment.sound?.duration_s ?? Infinity,
      currentStartS: segment.start_s,
      currentDurationS: segment.duration_s ?? estimateDuration(segment),
      targets: snapTargets(segment.id),
    };
  };

  const onEdgeMove = (event: React.PointerEvent): void => {
    const st = edgeRef.current;
    if (st === null || st.pointerId !== event.pointerId) return;
    const dt = (event.clientX - st.originX) / pxPerSecond;

    if (st.edge === "end") {
      // Bounded by what is left of the source after the in-point. The snap is
      // applied to the *out-point* — the edge under the pointer — and the
      // duration follows from it.
      const max = st.sourceS === Infinity ? Infinity : st.sourceS - st.trimStartS;
      const wanted = event.altKey
        ? st.startS + st.durationS + dt
        : snapTime(st.startS + st.durationS + dt, st.targets, pxPerSecond, gridS);
      const duration = Math.min(max, Math.max(MIN_CLIP_S, wanted - st.startS));
      st.currentStartS = st.startS;
      st.currentDurationS = duration;
      setEdgeDrag({ id: st.id, startS: st.startS, durationS: duration });
      return;
    }
    // Dragging the in-point moves where the clip starts in time *and* how far
    // into the source it begins, by the same amount — so the audio you can
    // still hear does not slide around underneath you.
    const wantedStart = event.altKey
      ? st.startS + dt
      : snapTime(st.startS + dt, st.targets, pxPerSecond, gridS);
    const shift = Math.max(
      -st.trimStartS,
      Math.min(st.durationS - MIN_CLIP_S, wantedStart - st.startS),
    );
    st.currentStartS = Math.max(0, st.startS + shift);
    st.currentDurationS = st.durationS - shift;
    setEdgeDrag({ id: st.id, startS: st.currentStartS, durationS: st.currentDurationS });
  };

  const onEdgeUp = (event: React.PointerEvent): void => {
    const st = edgeRef.current;
    if (st === null || st.pointerId !== event.pointerId) return;
    edgeRef.current = null;
    setEdgeDrag(null);
    if (st.currentDurationS === st.durationS && st.currentStartS === st.startS) return;
    onResize(st.id, {
      start_s: round3(st.currentStartS),
      duration_s: round3(st.currentDurationS),
      trim_start_s: round3(st.trimStartS + (st.currentStartS - st.startS)),
    });
  };

  const dragStateRef = useRef<{
    id: string;
    pointerId: number;
    originX: number;
    originY: number;
    startS: number;
    track: number;
    /** Set once the pointer clears DRAG_THRESHOLD_PX. */
    dragging: boolean;
    /** Where the drag has reached. Kept on the ref as well as in state
     *  because pointerup has to read it: the state value it closes over is
     *  from the last render, which has not happened yet when the moves and
     *  the release land in one batch. */
    currentStartS: number;
    currentTrack: number;
    /** As on an edge drag: fixed for the gesture. */
    targets: number[];
    /** The clip's own length, so its *end* can snap to things too — lining a
     *  clip up against what follows it is as common as against what precedes
     *  it, and only one of those is its start. */
    lengthS: number;
    /**
     * Everything travelling with the pointer, including the clip under it,
     * at the positions it held when the gesture began.
     *
     * Recorded up front rather than read back each move because the whole
     * point of a group drag is that the shape of the group does not change:
     * the clips keep their spacing and their lane offsets, and the only thing
     * the pointer decides is one delta applied to all of them. Re-reading
     * live positions mid-gesture would let rounding walk them apart.
     */
    group: { id: string; startS: number; track: number; lengthS: number }[];
  } | null>(null);

  const onClipPointerDown = (event: React.PointerEvent, segment: StorySegment): void => {
    if (event.button !== 0) return;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (readOnly) {
      // Selecting is reading, not writing — including selecting several.
      if (additive) toggleSelected(segment.id);
      else selectOnly(segment.id);
      return;
    }
    if (splitArmed) return; // the scissors own this click
    if (additive) {
      // No drag from an additive click: the gesture was "also this one", and
      // starting a move from it would shove a clip the moment you added it.
      toggleSelected(segment.id);
      return;
    }
    // Clicking a clip that is already part of a multi-selection keeps that
    // selection, so a group can be picked up and dragged as a group. Clicking
    // anything else means "just this one".
    if (!selectedIds.has(segment.id)) selectOnly(segment.id);
    else onSelect(segment.id);
    capturePointer(event.currentTarget as HTMLElement, event.pointerId);

    // Read the group from the selection as it stands *now*, not from the state
    // this click may have just changed: `selectOnly` above has not re-rendered
    // yet, so a clip that was outside the selection drags alone, which is
    // exactly what clicking it meant.
    const travelling = selectedIds.has(segment.id) ? selectedIds : new Set([segment.id]);
    const group = segments
      .filter((s) => travelling.has(s.id))
      .map((s) => ({
        id: s.id,
        startS: s.start_s,
        track: s.track_index,
        lengthS: s.duration_s ?? estimateDuration(s),
      }));

    dragStateRef.current = {
      id: segment.id,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startS: segment.start_s,
      track: segment.track_index,
      dragging: false,
      currentStartS: segment.start_s,
      currentTrack: segment.track_index,
      targets: snapTargets(travelling),
      lengthS: segment.duration_s ?? estimateDuration(segment),
      group,
    };
  };

  const onClipPointerMove = (event: React.PointerEvent): void => {
    const state = dragStateRef.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.originX;
    const dy = event.clientY - state.originY;
    // Below the threshold this is still a click. Once crossed it stays a drag
    // for the rest of the gesture — otherwise dragging back towards the origin
    // would flip it into a click mid-move.
    if (!state.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      state.dragging = true;
    }
    // Never before zero: a clip dragged off the left edge would otherwise sit
    // at a negative time the export has no way to represent.
    const free = Math.max(0, state.startS + dx / pxPerSecond);
    // Both ends are offered to the snap and the closer pull wins, so butting a
    // clip up against the one before it and against the one after it are the
    // same gesture.
    const snappedStart = event.altKey
      ? free
      : snapTime(free, state.targets, pxPerSecond, gridS);
    const snappedEnd = event.altKey
      ? free
      : snapTime(free + state.lengthS, state.targets, pxPerSecond, gridS) - state.lengthS;
    const startS = Math.max(
      0,
      Math.abs(snappedStart - free) <= Math.abs(snappedEnd - free) ? snappedStart : snappedEnd,
    );
    const laneShift = Math.round(dy / LANE_HEIGHT);
    const track = Math.max(lanes[0], Math.min(lanes[lanes.length - 1], state.track + laneShift));

    // The pointer moves the clip under it; everything else in the group moves
    // by the same amount. Clamping the *delta* rather than each clip is what
    // keeps the group rigid — clamp them one by one and the clips that hit
    // zero pile up on top of each other while the rest carry on, so the
    // arrangement quietly loses its spacing at the edges.
    let deltaS = startS - state.startS;
    let deltaTrack = track - state.track;
    if (state.group.length > 1) {
      const earliest = Math.min(...state.group.map((g) => g.startS));
      const topLane = Math.min(...state.group.map((g) => g.track));
      const bottomLane = Math.max(...state.group.map((g) => g.track));
      deltaS = Math.max(deltaS, -earliest);
      deltaTrack = Math.max(
        lanes[0]! - topLane,
        Math.min(lanes[lanes.length - 1]! - bottomLane, deltaTrack),
      );
    }

    const positions: Record<string, { startS: number; track: number }> = {};
    for (const member of state.group) {
      positions[member.id] =
        member.id === state.id
          ? { startS: state.group.length > 1 ? state.startS + deltaS : startS, track: state.track + deltaTrack }
          : { startS: Math.max(0, member.startS + deltaS), track: member.track + deltaTrack };
    }
    state.currentStartS = positions[state.id]!.startS;
    state.currentTrack = positions[state.id]!.track;
    setDrag(positions);
  };

  const onClipPointerUp = (event: React.PointerEvent): void => {
    const state = dragStateRef.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setDrag(null);
    if (!state.dragging) {
      // A click, not a move — so now it is safe to answer the question
      // pointerdown deliberately left open. Pressing on a clip that was part
      // of a multi-selection had to keep that selection, because the press
      // might have been the start of dragging the group; releasing without
      // having moved says it was not, and the click meant "just this one".
      if (selectedIds.size > 1 && selectedIds.has(state.id)) selectOnly(state.id);
      return;
    }
    const deltaS = state.currentStartS - state.startS;
    const deltaTrack = state.currentTrack - state.track;
    if (deltaS === 0 && deltaTrack === 0) return;
    // Only the clips that actually shifted. A member that would land exactly
    // where it already is is left out rather than written back — it would be
    // a no-op write and a row in the undo entry that explains nothing.
    const moves = state.group.flatMap((member) => {
      const startS = Math.max(0, member.startS + deltaS);
      const track = member.track + deltaTrack;
      if (startS === member.startS && track === member.track) return [];
      // Sub-millisecond placement is noise, and the round number is kinder to
      // anyone reading the value back.
      return [{ id: member.id, patch: { start_s: round3(startS), track_index: track } }];
    });
    if (moves.length > 0) onMove(moves);
  };

  /* --------------------------------------------------------- active clip */

  /** The clip under the playhead. Several can overlap — a line over a bed —
   *  so the topmost track wins, which is the one the eye reads as the line
   *  being spoken rather than the thing playing underneath it. */
  const activeSegmentId = useMemo(() => {
    const under = segments.filter(
      (s) => playhead >= s.start_s && playhead < s.start_s + estimateDuration(s),
    );
    if (under.length === 0) return null;
    return under.reduce((top, s) => (s.track_index < top.track_index ? s : top)).id;
  }, [segments, playhead]);

  const activeChangeRef = useRef(onActiveSegmentChange);
  activeChangeRef.current = onActiveSegmentChange;
  useEffect(() => {
    activeChangeRef.current?.(activeSegmentId);
  }, [activeSegmentId]);

  /* ------------------------------------------------------------- playback */

  const audioRef = useRef<{
    ctx: AudioContext;
    sources: AudioBufferSourceNode[];
    /** One gain per lane, so mute, solo and volume can move while it plays
     *  instead of only taking effect on the next press of play. */
    trackGains: Map<number, GainNode>;
    /** The insert chain feeding each lane's fader, and what the clips on that
     *  lane are actually connected to. */
    chains: Map<number, LaneChain>;
    /** The chain each lane was built from, so a dial move can be told apart
     *  from a device being added — one ramps, the other rewires. */
    built: Map<number, DeviceSpec[]>;
  } | null>(null);
  const rafRef = useRef<number | null>(null);
  const buffersRef = useRef(new Map<string, AudioBuffer>());

  const stop = useCallback((): void => {
    const audio = audioRef.current;
    if (audio) {
      for (const chain of audio.chains.values()) chain.dispose();
      for (const source of audio.sources) {
        try {
          source.stop();
        } catch {
          // Already ended — stopping twice is not an error worth surfacing.
        }
      }
      void audio.ctx.close();
      audioRef.current = null;
      usePlayerStore.getState().stop(STORY_PLAYER_ID);
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(async (fromOverride?: number): Promise<void> => {
    stop();
    const audible = segments.filter((s) => !s.muted && s.sound?.file);
    if (audible.length === 0) return;

    // The story and a clip's own player would otherwise talk over each other:
    // claiming the global "now playing" id stops whatever single sound was
    // going, the same way two SoundCards cannot both play.
    usePlayerStore.getState().play(STORY_PLAYER_ID);

    const ctx = new AudioContext();
    const sources: AudioBufferSourceNode[] = [];
    const trackGains = new Map<number, GainNode>();
    const chains = new Map<number, LaneChain>();
    const built = new Map<number, DeviceSpec[]>();
    audioRef.current = { ctx, sources, trackGains, chains, built };

    /**
     * One fader and one insert chain per lane, created on first use and
     * reused by every clip on it — that shared pair is what makes a live mute,
     * and a live device, possible.
     *
     * Clips connect to the chain's input, never to the fader, so the devices
     * between them can be rebuilt mid-playback without touching a single
     * scheduled source. Inserts run before the fader, as inserts do: a gate
     * should hear the take, not your monitoring level.
     */
    const laneNode = (lane: number): GainNode => {
      let chain = chains.get(lane);
      if (!chain) {
        const fader = ctx.createGain();
        fader.gain.value = laneGain(tracksRef.current, lane);
        fader.connect(ctx.destination);
        trackGains.set(lane, fader);
        const specs = devicesRef.current[lane] ?? [];
        chain = createLaneChain(ctx, fader, specs);
        chains.set(lane, chain);
        built.set(lane, specs);
      }
      return chain.input;
    };

    // Decode once per sound and keep it: scrubbing back and forth over the
    // same clips is the normal way to work, and re-fetching each time would
    // make the second play worse than the first.
    //
    // One clip that cannot load — its file deleted, or not audio the browser
    // can decode — is skipped and named, rather than failing the whole play
    // with nothing but silence to say so.
    const unplayable: string[] = [];
    await Promise.all(
      audible.map(async (segment) => {
        const key = segment.sound!.id;
        if (buffersRef.current.has(key)) return;
        try {
          const response = await fetch(segment.sound!.file);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          buffersRef.current.set(key, await ctx.decodeAudioData(await response.arrayBuffer()));
        } catch {
          unplayable.push(segment.sound!.name || segment.speaker || "a clip");
        }
      }),
    );
    if (unplayable.length > 0) {
      toast.error(
        unplayable.length === 1
          ? `Couldn't load ${unplayable[0]} — playing without it`
          : `Couldn't load ${unplayable.length} clips — playing without them`,
      );
    }
    // Stopped (or the segments changed) while we were decoding.
    if (audioRef.current?.ctx !== ctx) return;

    // Build the lanes before anything is scheduled, so a reverb has its
    // impulse response by the time the first clip reaches it — otherwise the
    // opening line of a story plays dry and the rest does not.
    for (const segment of audible) laneNode(segment.track_index);
    await Promise.all([...chains.values()].map((c) => c.ready));
    if (audioRef.current?.ctx !== ctx) return;

    // A loop restart passes where to start; everything else plays from
    // wherever the playhead is parked.
    const from = fromOverride ?? playheadRef.current;
    // Explicit fades, plus a crossfade over any overlap on a lane. The export
    // computes the same thing from the same rule — see `lib/fades`.
    const fades = computeFades(segments, (clip) =>
      clip.duration_s ?? estimateDuration(clip as StorySegment),
    );
    const base = ctx.currentTime + 0.05; // a beat of headroom to schedule into
    for (const segment of audible) {
      const buffer = buffersRef.current.get(segment.sound!.id);
      if (!buffer) continue;
      const end =
        segment.start_s +
        Math.min(
          segment.duration_s ?? buffer.duration,
          buffer.duration - (segment.trim_start_s ?? 0),
        );
      if (end <= from) continue; // already finished by the time we start

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      const peak = 10 ** (segment.gain_db / 20);
      gain.gain.value = peak;
      source.connect(gain).connect(laneNode(segment.track_index));

      // Trim, then playhead. `trim_start_s` is where the clip begins inside
      // its source and `duration_s` how much of it plays, so a shortened clip
      // has to stop early here too — otherwise it would sound right on the
      // timeline and wrong on export.
      const trim = segment.trim_start_s ?? 0;
      const plays = Math.min(
        segment.duration_s ?? buffer.duration - trim,
        buffer.duration - trim,
      );
      if (plays <= 0) continue;

      // A clip the playhead is already inside starts mid-buffer rather than
      // being skipped, so pressing play halfway through a line works.
      let startAt: number;
      let into = 0;
      if (segment.start_s >= from) {
        startAt = base + (segment.start_s - from);
        source.start(startAt, trim, plays);
      } else {
        into = from - segment.start_s;
        if (into >= plays) continue; // already finished
        startAt = base;
        source.start(base, trim + into, plays - into);
      }
      sources.push(source);

      /**
       * The fades, as automation on this clip's own gain.
       *
       * Equal-power curves, matching `dsp.applyFades` on the server sample for
       * sample — the export is the same arrangement rendered by different
       * code, and this is the seam where the two are most likely to drift.
       *
       * `into` is how far the playhead already is inside the clip: pressing
       * play in the middle of a fade-in should start part way up it, not
       * replay it from silence.
       */
      const span = fades.get(segment.id);
      if (span) {
        const remainingIn = span.in - into;
        const heard = plays - into; // how much of the clip is still to play
        // Never let the two curves meet: `setValueCurveAtTime` throws if a
        // second curve starts before the first has finished.
        const fadeIn = Math.max(0, Math.min(remainingIn, heard));
        const fadeOut = Math.max(0, Math.min(span.out, heard - fadeIn));
        if (fadeIn > 0) {
          // Starting mid-fade means starting part way along the curve, so the
          // shape is the tail of it rather than the whole thing.
          const from0 = Math.max(0, into) / Math.max(span.in, 1e-6);
          const points = fadeCurve(peak, true);
          const tail = points.slice(Math.floor(from0 * (points.length - 1)));
          gain.gain.setValueCurveAtTime(tail.length > 1 ? tail : points, startAt, fadeIn);
        }
        if (fadeOut > 0) {
          gain.gain.setValueCurveAtTime(
            fadeCurve(peak, false),
            startAt + (heard - fadeOut),
            fadeOut,
          );
        }
      }
    }

    void ctx.resume();
    setPlaying(true);
    const tick = (): void => {
      if (audioRef.current?.ctx !== ctx) return;
      const at = from + (ctx.currentTime - base);
      setPlayhead(Math.max(0, at));
      // Round the loop before the end of the story, and before anything else:
      // a region that runs past the last clip should still repeat.
      const region = loopRef.current;
      if (region !== null && at >= region.end) {
        setPlayhead(region.start);
        void playRef.current?.(region.start);
        return;
      }
      if (at >= totalDuration) {
        stop();
        setPlayhead(0);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [segments, totalDuration, stop]);

  /** The tick restarts playback at the top of a loop, and it is a plain
   *  function scheduled by rAF rather than a hook — so it reaches the current
   *  `play` through a ref rather than closing over the one that scheduled it. */
  const playRef = useRef<((from?: number) => Promise<void>) | null>(null);
  playRef.current = play;

  // Any edit to the clips invalidates a schedule already running: the graph was
  // built from positions that have since changed. Rebuild it from where the
  // playhead is, so an edit (yours, or an agent's) is heard straight away
  // rather than silently ending playback. Track state is deliberately not in
  // here — mute, solo and volume apply live, which is the point of them.
  useEffect(() => {
    if (audioRef.current) void playRef.current?.(playheadRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reschedules on a clip change, nothing else
  }, [segments]);

  // Unmounting (the Timeline panel closed mid-play) tears the graph down, and
  // has to say so: the state update inside stop() is lost on an unmounted
  // component, so without this the studio went on showing "playing".
  const playingChangeRef = useRef(onPlayingChange);
  playingChangeRef.current = onPlayingChange;
  useEffect(
    () => () => {
      const wasPlaying = audioRef.current !== null;
      stop();
      if (wasPlaying) playingChangeRef.current?.(false);
    },
    [stop],
  );

  // Publish the transport upward whenever either verb is rebuilt, and retract
  // it on unmount so the dock's button cannot outlive the audio graph.
  useEffect(() => {
    onTransport?.({ play: () => void play(), stop });
    return () => onTransport?.(null);
  }, [play, stop, onTransport]);

  useEffect(() => onPlayingChange?.(playing), [playing, onPlayingChange]);

  // Read through a ref inside play(), which is a callback that must not be
  // rebuilt (and so restart the graph) every time a fader moves.
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const devicesRef = useRef(devices);
  devicesRef.current = devices;


  /**
   * Devices, onto a graph that is already running.
   *
   * A dial move is ramped onto the live device — that is the entire point of
   * turning a knob while listening. Adding, removing, reordering or bypassing
   * one changes the shape of the graph, so that lane is rewired instead; the
   * clips stay connected to the chain's input throughout, which is why this
   * does not have to stop and re-schedule the way a clip edit does.
   */
  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null) return;
    for (const [lane, chain] of audio.chains) {
      const next = devices[lane] ?? [];
      const previous = audio.built.get(lane) ?? [];
      if (chainShapeChanged(previous, next)) chain.rebuild(next);
      else chain.update(next);
      audio.built.set(lane, next);
    }
  }, [devices]);

  // Move the faders under a graph that is already running. A short ramp rather
  // than a jump: setting gain instantly on live audio clicks.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null) return;
    for (const [lane, node] of audio.trackGains) {
      node.gain.setTargetAtTime(laneGain(tracks, lane), audio.ctx.currentTime, 0.01);
    }
  }, [tracks]);
  // Through a ref, like onActiveSegmentChange above: callers pass an inline
  // arrow, so depending on the prop's identity would re-fire this every render
  // — and since it sets state upstream, that is an infinite loop rather than
  // merely wasteful.
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;
  // Reported through a ref for the same reason as progress: the callback's
  // identity changes on every parent render, and depending on it directly
  // would fire this effect forever.
  const selectionRef = useRef(onSelectionChange);
  selectionRef.current = onSelectionChange;
  useEffect(() => {
    selectionRef.current?.([...selectedIds]);
  }, [selectedIds]);

  // Skips the first value so merely mounting never starts recording; only a
  // change after that is a request.
  const seenRecordRequest = useRef(recordRequest);
  useEffect(() => {
    if (recordRequest === undefined || recordRequest === seenRecordRequest.current) return;
    seenRecordRequest.current = recordRequest;
    if (!readOnly && recorder.state !== "recording") startRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on the request, not the recorder
  }, [recordRequest]);
  useEffect(() => {
    progressRef.current?.(playhead, totalDuration);
  }, [playhead, totalDuration]);


  /* ------------------------------------------------------------- hotkeys */

  /**
   * The shortcuts every editor has, on the clip you have selected.
   *
   * Bound to the window rather than to the timeline, because the thing you
   * just clicked is a clip and the focus is wherever the pointer left it —
   * requiring the lane container to be focused would make the shortcuts work
   * only by accident. The guard below is what keeps that honest: while you are
   * typing in the script, ⌘Z has to mean "undo my typing", so anything with a
   * text field focused is left alone entirely.
   */
  const clipboardRef = useRef<StorySegment | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (typing) return;

      const mod = e.metaKey || e.ctrlKey;
      const current = segments.find((x) => x.id === selectedId) ?? null;

      // Space is play/stop everywhere audio is the subject, and it has to beat
      // the browser's "scroll the page" default.
      if (e.code === "Space" && !mod) {
        e.preventDefault();
        if (playing) stop();
        else void play();
        return;
      }

      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }

      if (readOnly) return; // an agent holds the story; reading still works

      if (mod && e.key.toLowerCase() === "a") {
        // Select all — the one shortcut whose absence is most obvious once
        // selecting several is possible at all.
        e.preventDefault();
        const all = [...segments].sort(byStart);
        if (all.length === 0) return;
        const [first, ...rest] = all;
        onSelect(first!.id);
        setExtraIds(new Set(rest.map((x) => x.id)));
        return;
      }

      if (mod && e.key.toLowerCase() === "c" && current) {
        e.preventDefault();
        clipboardRef.current = current;
        return;
      }
      if (mod && e.key.toLowerCase() === "x" && current) {
        e.preventDefault();
        clipboardRef.current = current;
        // The clipboard still holds one clip — paste has one playhead to land
        // on — but the cut takes everything that was selected, because that is
        // what was on screen ringed in blue when the key went down.
        onDelete(selectedSegments.map((segment) => segment.id));
        return;
      }
      if (mod && e.key.toLowerCase() === "v" && clipboardRef.current) {
        e.preventDefault();
        // Lands at the playhead on the copied clip's own track, which is what
        // "put it here" means on a timeline. Goes through onPaste rather than
        // onInsertSound because a copied line may be written but not yet
        // voiced, and its words are the part worth keeping.
        onPaste(clipboardRef.current, {
          start_s: round3(playhead),
          track_index: clipboardRef.current.track_index,
        });
        return;
      }
      if (mod && e.key.toLowerCase() === "d" && current) {
        e.preventDefault();
        onDuplicate(selectedSegments);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && current) {
        e.preventDefault();
        onDelete(selectedSegments.map((segment) => segment.id));
        return;
      }
      if (e.key.toLowerCase() === "m" && current && !mod) {
        e.preventDefault();
        onToggleMute(current);
        return;
      }
      if (e.key.toLowerCase() === "s" && current && !mod) {
        e.preventDefault();
        // Split at the playhead when it is inside the clip; the scissors have
        // the same rule, so the shortcut is not a second, different tool.
        const length = current.duration_s ?? estimateDuration(current);
        if (playhead > current.start_s && playhead < current.start_s + length) {
          onSplit([{ id: current.id, atS: playhead - current.start_s }]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    segments,
    selectedId,
    playing,
    playhead,
    readOnly,
    play,
    stop,
    undo,
    redo,
    onDelete,
    onDuplicate,
    onToggleMute,
    onSplit,
    onPaste,
  ]);

  /* ---------------------------------------------------------------- render */

  /**
   * Scrubbing: the playhead follows the pointer for as long as it is held.
   *
   * A click-to-seek ruler is the minimum, but finding a moment in a take means
   * dragging back and forth over it, so the press has to keep tracking rather
   * than firing once. Pointer capture is what lets the drag continue when the
   * pointer leaves the thin ruler strip — otherwise the playhead would stick
   * the moment your hand drifted a few pixels down into the lanes.
   */
  const scrubRef = useRef<{ pointerId: number; left: number } | null>(null);

  const scrubTo = (clientX: number, left: number): void =>
    setPlayhead(Math.max(0, (clientX - left) / pxPerSecond));

  /** Shift-drag on the ruler marks a loop instead of moving the playhead —
   *  the same gesture, told apart by the modifier every editor uses for
   *  "select a range" rather than "go here". */
  const loopDragRef = useRef<{ pointerId: number; left: number; anchor: number } | null>(null);

  /**
   * How far the pointer has to travel on empty track before the press stops
   * being a click.
   *
   * Both gestures start identically — press on empty track — so one of them
   * has to wait to find out which it is. Scrubbing is the one that can wait:
   * it commits on release, and four pixels is under what a click wobbles by,
   * so moving the playhead still feels immediate while a deliberate drag
   * becomes a selection instead.
   */
  const MARQUEE_SLOP = 4;

  /** Every clip the rubber band touches. Overlap, not containment: a band
   *  drawn across the middle of a row is asking for the clips it crosses, and
   *  requiring full enclosure means a long clip can never be caught. */
  const clipsWithin = (box: {
    left: number;
    top: number;
    width: number;
    height: number;
  }): Set<string> => {
    const startS = (box.left - GUTTER) / pxPerSecond;
    const endS = (box.left + box.width - GUTTER) / pxPerSecond;
    const firstRow = Math.floor((box.top - RULER_HEIGHT) / LANE_HEIGHT);
    const lastRow = Math.floor((box.top + box.height - RULER_HEIGHT) / LANE_HEIGHT);
    const hit = new Set<string>();
    for (const segment of segments) {
      const row = lanes.indexOf(segment.track_index);
      if (row < firstRow || row > lastRow) continue;
      const from = segment.start_s;
      const to = from + (segment.duration_s ?? estimateDuration(segment));
      if (to >= startS && from <= endS) hit.add(segment.id);
    }
    return hit;
  };

  const onLanePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const content = contentRef.current;
    if (!content) return;
    const box = content.getBoundingClientRect();
    marqueeRef.current = {
      pointerId: event.pointerId,
      x0: event.clientX - box.left,
      y0: event.clientY - box.top,
      // Shift and ctrl mean "as well as", the way they do for a click.
      base: event.shiftKey || event.metaKey || event.ctrlKey ? new Set(selectedIds) : new Set(),
      active: false,
    };
    // Still a scrub until it proves otherwise — see MARQUEE_SLOP.
    onScrubDown(event);
  };

  const onLanePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = marqueeRef.current;
    const content = contentRef.current;
    if (state === null || state.pointerId !== event.pointerId || !content) {
      onScrubMove(event);
      return;
    }
    const box = content.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    if (!state.active) {
      if (Math.abs(x - state.x0) < MARQUEE_SLOP && Math.abs(y - state.y0) < MARQUEE_SLOP) {
        onScrubMove(event);
        return;
      }
      state.active = true;
      // Hand the gesture over: whatever the press started as, it is a
      // selection now, and a playhead that keeps following would be moving
      // for a reason the user has stopped expressing.
      onScrubUp(event);
    }
    const rect = {
      left: Math.min(x, state.x0),
      top: Math.min(y, state.y0),
      width: Math.abs(x - state.x0),
      height: Math.abs(y - state.y0),
    };
    setMarquee(rect);
    const hit = clipsWithin(rect);
    for (const id of state.base) hit.add(id);
    // The primary stays whatever it was if it is still in the band, so the
    // Sample panel does not flicker between clips as the band grows.
    const primary = selectedId && hit.has(selectedId) ? selectedId : (hit.values().next().value ?? null);
    const extras = new Set(hit);
    if (primary) extras.delete(primary);
    setExtraIds(extras);
    if (primary !== selectedId) onSelect(primary);
  };

  const onLanePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = marqueeRef.current;
    marqueeRef.current = null;
    setMarquee(null);
    if (state?.active) return; // the selection is already committed
    onScrubUp(event);
  };

  const onScrubDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const left = event.currentTarget.getBoundingClientRect().left;
    capturePointer(event.currentTarget, event.pointerId);
    if (event.shiftKey) {
      const at = Math.max(0, (event.clientX - left) / pxPerSecond);
      loopDragRef.current = { pointerId: event.pointerId, left, anchor: at };
      setLoop({ start: at, end: at });
      setLooping(true);
      return;
    }
    scrubRef.current = { pointerId: event.pointerId, left };
    scrubTo(event.clientX, left);
  };

  const onScrubMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const marking = loopDragRef.current;
    if (marking !== null && marking.pointerId === event.pointerId) {
      const at = Math.max(0, (event.clientX - marking.left) / pxPerSecond);
      // Snapped like everything else that is dragged in time, so a loop lands
      // on a clip boundary rather than three milliseconds past it.
      const snapped = event.altKey ? at : snapTime(at, snapTargets(""), pxPerSecond, gridS);
      setLoop({
        start: Math.min(marking.anchor, snapped),
        end: Math.max(marking.anchor, snapped),
      });
      return;
    }
    const state = scrubRef.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    scrubTo(event.clientX, state.left);
  };

  const onScrubUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (loopDragRef.current?.pointerId === event.pointerId) {
      loopDragRef.current = null;
      // A shift-click with no drag is not a loop, it is a mis-click. Clearing
      // it beats leaving a zero-length region the transport would spin on.
      setLoop((current) =>
        current && current.end - current.start < MIN_CLIP_S ? null : current,
      );
      return;
    }
    if (scrubRef.current?.pointerId !== event.pointerId) return;
    scrubRef.current = null;
  };

  /**
   * The wheel zooms, about the pointer — but only for an actual zoom gesture.
   *
   * Zooming about the *centre* is what a plain multiply does, and it is wrong
   * every time: you point at the bar you care about, zoom, and it has moved
   * somewhere else. Holding the time under the cursor still means the gesture
   * behaves like a magnifying glass rather than a slider.
   *
   * Registered by hand rather than as `onWheel`, because React attaches wheel
   * listeners passively and a passive listener cannot call `preventDefault()`
   * — without which the page (or the lane list) scrolls at the same time as
   * the zoom.
   *
   * A Mac trackpad's pinch gesture is reported to the browser as a wheel
   * event with `ctrlKey` set, regardless of whether Control is actually
   * held — that is the only reliable signal that the user means to zoom.
   * A plain two-finger scroll (no ctrlKey) is left alone entirely, so it
   * pans the timeline horizontally or vertically exactly like any other
   * scrollable element: deltaX pans left/right, deltaY scrolls the lanes
   * up/down. Shift+wheel is also left alone, for a mouse wheel's
   * shift-to-scroll-horizontally convention.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;

    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey || event.shiftKey) return;
      event.preventDefault();

      // Where the pointer is, in seconds, before the zoom.
      const rect = el.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const contentX = pointerX + el.scrollLeft - GUTTER;

      setPxPerSecond((current) => {
        const at = contentX / current;
        // Exponential so every notch is the same proportional step, and a
        // trackpad's small deltas are not swallowed by rounding.
        const next = Math.min(MAX_PPS, Math.max(MIN_PPS, current * Math.exp(-event.deltaY * 0.0015)));
        if (next === current) return current;
        // Put that same second back under the pointer once the lanes have been
        // re-laid out at the new scale.
        requestAnimationFrame(() => {
          el.scrollLeft = Math.max(0, at * next + GUTTER - pointerX);
        });
        return next;
      });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoom = (factor: number): void =>
    setPxPerSecond((p) => Math.min(MAX_PPS, Math.max(MIN_PPS, p * factor)));

  const timeTicks = Array.from(
    { length: Math.ceil(width / pxPerSecond / gridS) + 1 },
    (_, i) => {
      const t = i * gridS;
      return { t, label: formatDuration(t), major: true };
    },
  );

  const portaled = toolbarHost !== undefined;
  const toolbar = (
      <div className={cn("flex items-center gap-1", portaled ? "min-w-0" : "px-3 py-2")}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={playing ? "Stop" : "Play"}
          onClick={() => (playing ? stop() : void play())}
        >
          {playing ? <SquareIcon /> : <PlayIcon />}
        </Button>
        <span className="text-muted-foreground ml-1 font-mono text-xs tabular-nums">
          {formatDuration(playhead)} / {formatDuration(totalDuration)}
        </span>

        <Separator orientation="vertical" className="mx-2 h-5" />

        {/* Add lands wherever the playhead is parked, on the selected clip's
            track (or track 0). Parking the playhead is already how you say
            "here" on a timeline, so Add doesn't need its own target. */}
        {/* Record. Its own track, at the playhead, and a level readout while it
            runs — a recording with no visible level is one you find out was
            silent afterwards. */}
        <ToolButton
          label={
            recorder.error
              ? recorder.error
              : recorder.state === "recording"
                ? `Stop recording (${formatDuration(recorder.seconds)})`
                : saving
                  ? "Saving the take…"
                  : "Record onto a new track at the playhead"
          }
          icon={
            saving ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <CircleIcon
                className={recorder.state === "recording" ? "fill-current" : undefined}
              />
            )
          }
          active={recorder.state === "recording"}
          disabled={readOnly || saving}
          onClick={() => (recorder.state === "recording" ? recorder.stop() : startRecording())}
        />
        {/* Decoding a long file takes a moment, and a drop that shows nothing
            reads as a drop that was ignored. */}
        {importing && (
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Loader2Icon className="size-3 animate-spin" />
            Importing…
          </span>
        )}

        {recorder.state === "recording" && (
          <span className="flex items-center gap-1.5">
            <span className="text-destructive font-mono text-xs tabular-nums">
              {formatDuration(recorder.seconds)}
            </span>
            {/* The input level, so you can see the microphone is live before
                finding out it was not. */}
            <span className="bg-muted h-1 w-10 overflow-hidden rounded-full">
              <span
                className="bg-destructive block h-full rounded-full transition-[width] duration-75"
                style={{ width: `${Math.round(Math.min(1, recorder.level) * 100)}%` }}
              />
            </span>
          </span>
        )}

        <ToolButton
          label="Add a clip at the playhead"
          icon={<PlusIcon />}
          active={insertAt !== null}
          onClick={() =>
            setInsertAt((open) =>
              open
                ? null
                : {
                    startS: playhead,
                    track: selected?.track_index ?? 0,
                    x: GUTTER + playhead * pxPerSecond,
                    y: RULER_HEIGHT + LANE_HEIGHT,
                  },
            )
          }
        />

        <ToolButton
          label={
            selected?.sound_id
              ? "Split the selected clip at the playhead"
              : "Select a generated clip to split it"
          }
          icon={<ScissorsIcon />}
          active={splitArmed}
          disabled={!selected?.sound_id}
          onClick={() => {
            if (!selected?.sound_id) return;
            // Splitting at the playhead is the precise gesture; arming for a
            // click on the clip is the quick one. Offer whichever the
            // playhead's position makes sensible.
            const inside =
              playhead > selected.start_s &&
              playhead < selected.start_s + estimateDuration(selected);
            if (inside) onSplit([{ id: selected.id, atS: playhead - selected.start_s }]);
            else setSplitArmed((a) => !a);
          }}
        />
        <ToolButton
          label="Duplicate the selected clip"
          icon={<CopyIcon />}
          disabled={!selected}
          onClick={() => selected && onDuplicate([selected])}
        />
        <ToolButton
          label={selected?.muted ? "Unmute the selected clip" : "Mute the selected clip"}
          icon={selected?.muted ? <VolumeXIcon /> : <Volume2Icon />}
          active={Boolean(selected?.muted)}
          disabled={!selected}
          onClick={() => selected && onToggleMute(selected)}
        />
        {/* One button, three situations. With a region marked it is a plain
            on/off. With none, the selected clip is the region you almost
            certainly meant — looping the thing you are working on is the whole
            reason to loop — and shift-dragging the ruler is still there for
            any other span. */}
        <ToolButton
          label={
            loop !== null
              ? looping
                ? "Stop looping"
                : "Loop the marked region"
              : selected
                ? "Loop the selected clip. Shift-drag the ruler for any other span."
                : "Select a clip to loop it, or shift-drag the ruler to mark a span"
          }
          icon={<RepeatIcon />}
          active={looping && loop !== null}
          disabled={loop === null && !selected}
          onClick={() => {
            if (loop !== null) {
              setLooping((on) => !on);
              return;
            }
            if (!selected) return;
            const length = selected.duration_s ?? estimateDuration(selected);
            setLoop({ start: selected.start_s, end: selected.start_s + length });
            setLooping(true);
          }}
        />
        <ToolButton
          label={canUndo ? `Undo ${undoLabel ?? "the last edit"}` : "Nothing to undo"}
          icon={<Undo2Icon />}
          disabled={!canUndo}
          onClick={undo}
        />
        <ToolButton
          label={canRedo ? "Redo" : "Nothing to redo"}
          icon={<Redo2Icon />}
          disabled={!canRedo}
          onClick={redo}
        />

        <ToolButton
          label="Delete the selected clip"
          icon={<Trash2Icon />}
          disabled={!selected}
          onClick={() => selected && onDelete([selected.id])}
        />

        <div className="ml-auto flex items-center gap-1">
          <span className="text-muted-foreground mr-1 text-xs">Zoom</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={pxPerSecond <= MIN_PPS}
            onClick={() => zoom(1 / 1.5)}
          >
            <ZoomOutIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={pxPerSecond >= MAX_PPS}
            onClick={() => zoom(1.5)}
          >
            <ZoomInIcon />
          </Button>
        </div>
      </div>
  );

  return (
    // `relative` so the insert popover can be placed against this panel, in
    // the same coordinate space the click was measured in.
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
      {/* Play/rec/tools. Portaled into the artifact header when the page
          gave us a host, so they sit on the same row as the title instead
          of as a second bar. Padding is dropped in that case so the header
          does not grow. */}
      {portaled ? (toolbarHost ? createPortal(toolbar, toolbarHost) : null) : toolbar}

      {splitArmed && (
        <p className="text-muted-foreground border-border border-t px-3 py-1.5 text-xs">
          Click a generated clip where you want it cut. Press Escape to cancel.
        </p>
      )}

      {/* ---------------------------------------------------------- lanes */}
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setSplitArmed(false);
            // Clear the extras as well, or Escape leaves a timeline still
            // covered in rings with nothing reported as selected.
            selectOnly(null);
          }
        }}
      >
        <div
          ref={contentRef}
          className="relative flex h-full min-h-full flex-col"
          style={{ width: width + GUTTER }}
        >
          {/* Bars on top, time on the bottom — both sticky, so scrolling the
              lanes never hides where you are. Clicking either moves the
              playhead; shift-drag marks a loop. */}
          <TimelineRuler
            stick="top"
            ariaLabel="Bar ruler"
            ticks={barMarks(width / pxPerSecond, pxPerSecond)}
            loop={loop}
            looping={looping}
            pxPerSecond={pxPerSecond}
            onPointerDown={onScrubDown}
            onPointerMove={onScrubMove}
            onPointerUp={onScrubUp}
          />

          <div className="relative min-h-0 flex-1">
          {/* And down the lanes, faintly: what repeats is a span of the whole
              arrangement, not of the ruler. */}
          {looping && loop !== null && loop.end > loop.start && (
            <div
              className="bg-primary/5 border-primary/30 pointer-events-none absolute inset-y-0 border-x"
              style={{
                left: GUTTER + loop.start * pxPerSecond,
                width: Math.max(1, (loop.end - loop.start) * pxPerSecond),
              }}
              aria-hidden="true"
            />
          )}

          {lanes.map((lane) => (
            <div
              key={lane}
              className="border-border/60 relative border-b"
              style={{ height: LANE_HEIGHT }}
            >
              <TrackHead
                lane={lane}
                track={tracks.find((t) => t.track_index === lane) ?? null}
                soloing={tracks.some((t) => t.soloed)}
                clips={segments.filter((s) => s.track_index === lane).length}
                readOnly={readOnly}
                onTrack={onTrack}
                onRemove={onRemoveTrack}
              />
              <div
                className={cn(
                  "absolute inset-y-0",
                  dropLane === lane && "bg-primary/10 ring-primary/50 ring-1 ring-inset",
                )}
                style={{ left: GUTTER, right: 0 }}
                // Dropping a sound from the library pane. The lane refuses
                // anything that is not one of ours before the pointer ever
                // suggests it would land — see `lib/dnd`.
                // Dropping a sound from the library pane. `dragenter` is
                // prevented as well as `dragover`: without it a drop released
                // over a clip — which is most of a busy lane — is refused by
                // the browser before any of this runs, which reads as the
                // timeline simply not accepting the sound.
                onDragEnter={(e) => {
                  if (readOnly || !isSoundDrag(e)) return;
                  e.preventDefault();
                  if (dropLane !== lane) setDropLane(lane);
                }}
                onDragOver={(e) => {
                  if (readOnly || !isSoundDrag(e)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  if (dropLane !== lane) setDropLane(lane);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setDropLane((current) => (current === lane ? null : current));
                }}
                onDrop={(e) => {
                  // A file from the desktop, not a sound from the library
                  // pane. Checked first: the browser puts both on the same
                  // event, and only one of them is already in the library.
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    e.preventDefault();
                    e.stopPropagation();
                    setDropLane(null);
                    const rect = e.currentTarget.getBoundingClientRect();
                    void importFile(file, {
                      start_s: round3(Math.max(0, (e.clientX - rect.left) / pxPerSecond)),
                      track_index: lane,
                    });
                    return;
                  }
                  setDropLane(null);
                  if (readOnly) return;
                  const soundId = getSoundDrag(e);
                  if (!soundId) return;
                  e.preventDefault();
                  // Where you let go is where it starts, the same rule a drag
                  // of an existing clip follows.
                  const rect = e.currentTarget.getBoundingClientRect();
                  const startS = round3(Math.max(0, (e.clientX - rect.left) / pxPerSecond));
                  // The lane you aimed at, unless something is already there:
                  // new audio does not land on top of old audio. See
                  // `nextFreeTrack` for why that is a rule rather than a
                  // preference.
                  const length = currentSoundDrag()?.durationS ?? 0;
                  const free = laneIsFree(segments, lane, startS, Math.max(length, 0.05));
                  onInsertSound(soundId, {
                    start_s: startS,
                    track_index: free ? lane : nextFreeTrack(segments),
                    // The drag carries the sound's name for exactly this: a
                    // dropped clip labelled "Empty line" looks like a failed
                    // drop rather than a placed sound.
                    name: e.dataTransfer.getData("text/plain") || undefined,
                  });
                }}
                onContextMenu={(e) => {
                  if (e.target !== e.currentTarget || readOnly) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const host = rootRef.current!.getBoundingClientRect();
                  setClipMenu(null);
                  setInsertAt(null);
                  setLaneMenu({
                    startS: Math.max(0, (e.clientX - rect.left) / pxPerSecond),
                    track: lane,
                    x: e.clientX - host.left,
                    y: e.clientY - host.top,
                  });
                }}
                // Press on empty track is still a scrub — the playhead is the
                // thing you move most and finding a 22px ruler strip was the
                // wrong tax — but a press that *travels* is a rubber band
                // instead, which is what dragging empty space means in every
                // timeline. `MARQUEE_SLOP` is what tells the two apart.
                onPointerDown={onLanePointerDown}
                onPointerMove={onLanePointerMove}
                onPointerUp={onLanePointerUp}
                onPointerCancel={onLanePointerUp}
              >
                {segments
                  .filter((s) => (drag?.[s.id] ? drag[s.id]!.track : s.track_index) === lane)
                  .map((segment) => (
                    <Clip
                      key={segment.id}
                      segment={segment}
                      lane={lane}
                      pxPerSecond={pxPerSecond}
                      startS={
                        edgeDrag?.id === segment.id
                          ? edgeDrag.startS
                          : drag?.[segment.id]
                            ? drag[segment.id]!.startS
                            : segment.start_s
                      }
                      durationS={
                        edgeDrag?.id === segment.id ? edgeDrag.durationS : undefined
                      }
                      fadeInS={
                        fadeDrag?.id === segment.id && fadeDrag.edge === "in"
                          ? fadeDrag.span
                          : (laneFades.get(segment.id)?.in ?? 0)
                      }
                      fadeOutS={
                        fadeDrag?.id === segment.id && fadeDrag.edge === "out"
                          ? fadeDrag.span
                          : (laneFades.get(segment.id)?.out ?? 0)
                      }
                      onFadeDown={(e, edge) => onFadeDown(e, segment, edge)}
                      onFadeMove={onFadeMove}
                      onFadeUp={onFadeUp}
                      onEdgeDown={(e, edge) => onEdgeDown(e, segment, edge)}
                      onEdgeMove={onEdgeMove}
                      onEdgeUp={onEdgeUp}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (readOnly) return;
                        onSelect(segment.id);
                        const host = rootRef.current!.getBoundingClientRect();
                        setClipMenu({
                          id: segment.id,
                          x: e.clientX - host.left,
                          y: e.clientY - host.top,
                        });
                      }}
                      dragging={Boolean(drag?.[segment.id])}
                      generating={generating.has(segment.id)}
                      selected={selectedIds.has(segment.id)}
                      splitArmed={splitArmed}
                      onPointerDown={(e) => onClipPointerDown(e, segment)}
                      onPointerMove={onClipPointerMove}
                      onPointerUp={onClipPointerUp}
                      onDoubleClick={() => onOpenSample(segment.id)}
                      onSplitAt={(atS) => {
                        setSplitArmed(false);
                        onSplit([{ id: segment.id, atS }]);
                      }}
                    />
                  ))}
                {pending
                  .filter((p) => p.track_index === lane)
                  .map((p) => (
                    <PendingClipView key={p.id} clip={p} lane={lane} pxPerSecond={pxPerSecond} />
                  ))}
              </div>
            </div>
          ))}

          {marquee && marquee.width > 0 && (
            <div
              className="border-primary bg-primary/15 pointer-events-none absolute z-30 rounded-sm border"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.width,
                height: marquee.height,
              }}
              aria-hidden="true"
            />
          )}

          {/* Audacity keeps "add track" at the bottom of the stack, where the
              next one would appear. Same here — it reads as growing the
              arrangement rather than as a command you have to find. */}
          <button
            type="button"
            disabled={readOnly}
            // The spare lane at the bottom is already on screen; adding a track
            // claims it rather than skipping past it, which would add two lanes
            // at once — the new one and a fresh spare beneath it.
            onClick={() => onAddTrack(Math.max(0, ...lanes))}
            className="text-muted-foreground hover:bg-accent/40 hover:text-foreground sticky left-0 z-20 flex items-center gap-1.5 px-3 py-2 text-xs disabled:opacity-50"
            style={{ width: GUTTER }}
          >
            <PlusIcon className="size-3.5" />
            Add track
          </button>

          </div>

          <TimelineRuler
            stick="bottom"
            ariaLabel="Time ruler"
            ticks={timeTicks}
            loop={loop}
            looping={looping}
            pxPerSecond={pxPerSecond}
            onPointerDown={onScrubDown}
            onPointerMove={onScrubMove}
            onPointerUp={onScrubUp}
          />

          {/* Playhead, over everything and ignoring the pointer so it never
              swallows a click meant for a clip. */}
          <div
            className="bg-primary pointer-events-none absolute top-0 bottom-0 z-30 w-px"
            style={{ left: GUTTER + playhead * pxPerSecond }}
          />
        </div>
      </div>

      {clipMenu && (
        <ClipMenu
          segment={segments.find((s) => s.id === clipMenu.id) ?? null}
          at={clipMenu}
          playhead={playhead}
          onClose={() => setClipMenu(null)}
          onSplit={(atS) => onSplit([{ id: clipMenu.id, atS }])}
          onSeparate={onSeparateClip}
          canSeparate={canSeparate}
          onRegenerate={() => onRegenerate(clipMenu.id)}
          onDuplicate={(segment) => onDuplicate([segment])}
          onToggleMute={onToggleMute}
          onDelete={() => onDelete([clipMenu.id])}
          onEditSound={onEditSound}
          canExtend={canExtend}
          canCover={canCover}
          onRepaint={onRepaintClip}
          canRepaint={canRepaint}
          // The highlighted span, as this clip sees it. Worked out here
          // rather than in the menu because the span is the timeline's own
          // state and the menu is only being told what it may offer.
          repaintWindow={repaintWindowFor(
            segments.find((s) => s.id === clipMenu.id) ?? null,
            loop,
          )}
        />
      )}

      {/* One input for the whole timeline rather than one per lane: the
          destination rides on `importAtRef`, set by whatever opened it. */}
      <input
        ref={fileInputRef}
        type="file"
        accept={AUDIO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const at = importAtRef.current;
          // Cleared immediately so picking the same file twice in a row still
          // fires a change event the second time.
          e.target.value = "";
          importAtRef.current = null;
          if (file && at) void importFile(file, at);
        }}
      />

      {laneMenu && (
        <LaneMenu
          at={laneMenu}
          onClose={() => setLaneMenu(null)}
          recording={recorder.state === "recording"}
          canPaste={clipboardRef.current !== null}
          // Every clip the playhead is currently over, which is what "all"
          // means here — splitting clips it is nowhere near would be a
          // surprise, not a convenience.
          splittableCount={
            segments.filter(
              (s) =>
                s.sound_id &&
                playhead > s.start_s &&
                playhead < s.start_s + (s.duration_s ?? estimateDuration(s)),
            ).length
          }
          onVoiceLine={() =>
            setInsertAt({
              startS: laneMenu.startS,
              track: laneMenu.track,
              x: laneMenu.x,
              y: laneMenu.y,
            })
          }
          onRecord={startRecording}
          onNewPrompt={() => onOpenPanel("insert")}
          onInsertSample={() => onOpenPanel("library")}
          onImport={() => {
            importAtRef.current = {
              start_s: round3(laneMenu.startS),
              track_index: laneMenu.track,
            };
            fileInputRef.current?.click();
          }}
          onSplitAll={() => {
            onSplit(
              segments.flatMap((s) => {
                if (!s.sound_id) return [];
                const length = s.duration_s ?? estimateDuration(s);
                return playhead > s.start_s && playhead < s.start_s + length
                  ? [{ id: s.id, atS: playhead - s.start_s }]
                  : [];
              }),
            );
          }}
          onPasteHere={() => {
            const clip = clipboardRef.current;
            if (clip) {
              onPaste(clip, {
                start_s: round3(laneMenu.startS),
                track_index: laneMenu.track,
              });
            }
          }}
          onAddTrack={() => onAddTrack(Math.max(0, ...lanes))}
        />
      )}

      {insertAt && (
        <InsertPopover
          at={insertAt}
          onClose={() => setInsertAt(null)}
          onAdd={(text) => {
            onAddAt({
              start_s: round3(insertAt.startS),
              track_index: insertAt.track,
              text,
            });
            setInsertAt(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * The stretch of a clip's source audio that a repaint should redo.
 *
 * The span marked on the ruler is in story time and says nothing about which
 * clip it crosses; the model is asked about seconds into one sound. So this
 * clips the span to the segment, then shifts it by the segment's own trim.
 * With no span marked, or one that misses this clip entirely, the answer is
 * the whole clip — right-clicking a sample and asking to repaint it is a
 * complete request on its own.
 */
function repaintWindowFor(
  segment: StorySegment | null,
  span: { start: number; end: number } | null,
): { start_s: number; end_s: number; fromStory: number; toStory: number } | null {
  if (!segment?.sound) return null;
  const length = segment.duration_s ?? estimateDuration(segment);
  const clipEnd = segment.start_s + length;
  const overlaps = span !== null && span.end > segment.start_s && span.start < clipEnd;
  const fromStory = overlaps ? Math.max(span.start, segment.start_s) : segment.start_s;
  const toStory = overlaps ? Math.min(span.end, clipEnd) : clipEnd;
  const offset = segment.trim_start_s - segment.start_s;
  const start = Math.max(0, fromStory + offset);
  const end = Math.min(segment.sound.duration_s, toStory + offset);
  if (end - start < 0.05) return null;
  return { start_s: start, end_s: end, fromStory, toStory };
}

/**
 * The tools that apply to one clip, at the point you right-clicked.
 *
 * The toolbar already has these, but the toolbar acts on "the selection",
 * which means finding the button, and trusting that the thing you think is
 * selected is. A right-click says which clip *and* which action in one
 * gesture, and does it where your hand already is.
 */
function ClipMenu({
  segment,
  at,
  playhead,
  onClose,
  onSplit,
  onRegenerate,
  onDuplicate,
  onToggleMute,
  onDelete,
  onEditSound,
  canExtend,
  canCover,
  onSeparate,
  canSeparate,
  onRepaint,
  canRepaint,
  repaintWindow,
}: {
  segment: StorySegment | null;
  at: { x: number; y: number };
  playhead: number;
  onClose: () => void;
  onSplit: (atS: number) => void;
  onRegenerate: () => void;
  onDuplicate: (segment: StorySegment) => void;
  onToggleMute: (segment: StorySegment) => void;
  onDelete: () => void;
  onEditSound?: (kind: EditKind, sound: Sound) => void;
  canExtend?: boolean;
  canCover?: boolean;
  onSeparate?: (segment: StorySegment) => void;
  canSeparate?: boolean;
  onRepaint?: (segment: StorySegment, window: { start_s: number; end_s: number }) => void;
  canRepaint?: boolean;
  repaintWindow?: {
    start_s: number;
    end_s: number;
    fromStory: number;
    toStory: number;
  } | null;
}) {
  if (segment === null) return null;
  const length = segment.duration_s ?? estimateDuration(segment);
  const inside = playhead > segment.start_s && playhead < segment.start_s + length;

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        className="bg-popover border-border absolute z-50 w-52 rounded-lg border p-1 shadow-lg"
        style={{ left: Math.max(8, at.x), top: Math.max(8, at.y) }}
      >
        <MenuRow
          // Only a written line can be read; a pause has no words and an
          // inserted library sound was never generated from any.
          disabled={segment.kind !== "line" || !segment.text.trim()}
          onClick={run(onRegenerate)}
        >
          <MicIcon className="size-3.5" />
          {segment.sound_id ? "Regenerate" : "Read this line"}
        </MenuRow>
        <MenuRow
          disabled={!inside || !segment.sound_id}
          onClick={run(() => onSplit(playhead - segment.start_s))}
        >
          <ScissorsIcon className="size-3.5" />
          Split at playhead
        </MenuRow>
        {/* The other cut. "Split at playhead" divides the clip in time; this
            divides it into what it is made of, and both belong on the gesture
            that is already about this clip. */}
        {onSeparate && canSeparate && (
          <MenuRow disabled={!segment.sound_id} onClick={run(() => onSeparate(segment))}>
            <LayersIcon className="size-3.5" />
            Split into stems…
          </MenuRow>
        )}
        <MenuRow onClick={run(() => onDuplicate(segment))}>
          <CopyIcon className="size-3.5" />
          Duplicate
        </MenuRow>
        {onEditSound && segment.sound && (canExtend || canCover) && (
          <>
            <div className="bg-border my-1 h-px" />
            {canExtend && (
              <MenuRow onClick={run(() => onEditSound("extend", segment.sound!))}>
                <ExpandIcon className="size-3.5" />
                Extend this track
              </MenuRow>
            )}
            {canCover && (
              <MenuRow onClick={run(() => onEditSound("cover", segment.sound!))}>
                <RepeatIcon className="size-3.5" />
                Cover in a new style
              </MenuRow>
            )}
          </>
        )}
        {/* Repaint reads the span marked on the ruler, so the row says which
            seconds it is about — "Repaint" alone would be a gamble on
            whichever part of the clip the last shift-drag happened to
            cover. */}
        {onRepaint && canRepaint && segment.sound && (
          <MenuRow
            disabled={!repaintWindow}
            onClick={run(() => repaintWindow && onRepaint(segment, repaintWindow))}
          >
            <PaintbrushIcon className="size-3.5" />
            {repaintWindow && repaintWindow.toStory - repaintWindow.fromStory < (segment.duration_s ?? estimateDuration(segment)) - 0.05
              ? `Repaint ${formatDuration(repaintWindow.fromStory)}–${formatDuration(repaintWindow.toStory)}`
              : "Repaint this clip"}
          </MenuRow>
        )}
        <MenuRow onClick={run(() => onToggleMute(segment))}>
          {segment.muted ? <Volume2Icon className="size-3.5" /> : <VolumeXIcon className="size-3.5" />}
          {segment.muted ? "Unmute" : "Mute"}
        </MenuRow>
        <div className="bg-border my-1 h-px" />
        <MenuRow destructive onClick={run(onDelete)}>
          <Trash2Icon className="size-3.5" />
          Delete
        </MenuRow>
      </div>
    </>
  );
}

function MenuRow({
  children,
  onClick,
  disabled,
  destructive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm disabled:pointer-events-none disabled:opacity-40",
        destructive && "text-destructive",
      )}
    >
      {children}
    </button>
  );
}

/** Sub-millisecond placement is noise, and a round number reads better if
 *  anyone ever looks at the value. */
/**
 * Where a dragged time wants to land: the nearest interesting moment, if one
 * is within reach.
 *
 * The candidates are the things you are actually trying to line up with —
 * every other clip's start and end, the playhead, the start of the story, and
 * the ruler's own grid. Alt turns it off for the rest of the gesture, which is
 * the escape hatch every editor has and the reason snapping is safe to have on
 * by default.
 *
 * Returns the input unchanged when nothing is close, so a caller can hand it
 * any candidate time without asking first.
 */
function snapTime(
  time: number,
  candidates: number[],
  pxPerSecond: number,
  gridS: number,
): number {
  const tolerance = SNAP_PX / pxPerSecond;
  let best = time;
  let bestDistance = tolerance;
  // The grid is a candidate like any other, generated rather than listed:
  // whichever tick this time falls between is the only one that can win.
  const ticks = [Math.floor(time / gridS) * gridS, Math.ceil(time / gridS) * gridS];
  for (const candidate of [...candidates, ...ticks]) {
    const distance = Math.abs(candidate - time);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function round3(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * The things you can put on an empty stretch of timeline, at the point you
 * right-clicked.
 *
 * Four ways to fill a lane, and they are genuinely different jobs rather than
 * four spellings of one: write words for a voice to read, record yourself,
 * describe something for a model to make, or reach for audio that already
 * exists. Only the first was ever on this gesture, which made the other three
 * feel like they lived somewhere else in the app.
 *
 * The last two hand off to the panels rather than growing their own popover
 * form. A prompt box that is not *the* prompt box would keep its own history
 * and its own model choice, and the library is already open next to the lanes
 * with search and filters that a 320px popover could only do worse.
 */
function LaneMenu({
  at,
  onClose,
  recording,
  canPaste,
  splittableCount,
  onVoiceLine,
  onRecord,
  onImport,
  onNewPrompt,
  onInsertSample,
  onSplitAll,
  onPasteHere,
  onAddTrack,
}: {
  at: { startS: number; track: number; x: number; y: number };
  onClose: () => void;
  recording: boolean;
  canPaste: boolean;
  splittableCount: number;
  onVoiceLine: () => void;
  onRecord: () => void;
  onImport: () => void;
  onNewPrompt: () => void;
  onInsertSample: () => void;
  onSplitAll: () => void;
  onPasteHere: () => void;
  onAddTrack: () => void;
}) {
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        className="bg-popover border-border absolute z-50 w-56 rounded-lg border p-1 shadow-lg"
        style={{ left: Math.max(8, at.x), top: Math.max(8, at.y) }}
      >
        <p className="text-muted-foreground px-2 py-1 font-mono text-[11px] tabular-nums">
          {formatDuration(at.startS)} · track {at.track}
        </p>
        <div className="bg-border my-1 h-px" />

        <MenuRow onClick={run(onVoiceLine)}>
          <MicIcon className="size-3.5" />
          Create voice line
        </MenuRow>
        {/* Recording does not land here: a take goes onto a lane of its own at
            the playhead, because new audio on top of old audio is never what
            was meant. Named for what it does rather than for where you asked
            for it. */}
        <MenuRow disabled={recording} onClick={run(onRecord)}>
          <CircleIcon className="size-3.5" />
          {recording ? "Recording…" : "New recording"}
        </MenuRow>
        <MenuRow onClick={run(onNewPrompt)}>
          <PlusIcon className="size-3.5" />
          New prompt
        </MenuRow>
        <MenuRow onClick={run(onInsertSample)}>
          <CopyIcon className="size-3.5" />
          Insert sample
        </MenuRow>
        <MenuRow onClick={run(onImport)}>
          <UploadIcon className="size-3.5" />
          Import from computer…
        </MenuRow>

        <div className="bg-border my-1 h-px" />

        <MenuRow disabled={splittableCount === 0} onClick={run(onSplitAll)}>
          <ScissorsIcon className="size-3.5" />
          {splittableCount > 0
            ? `Split all at playhead (${splittableCount})`
            : "Split all at playhead"}
        </MenuRow>
        <MenuRow disabled={!canPaste} onClick={run(onPasteHere)}>
          <CopyIcon className="size-3.5" />
          Paste here
        </MenuRow>
        <MenuRow onClick={run(onAddTrack)}>
          <PlusIcon className="size-3.5" />
          Add track
        </MenuRow>
      </div>
    </>
  );
}

/**
 * A line, written straight onto a point on the timeline.
 *
 * It used to carry a second tab that searched the library, back when there was
 * nowhere else to reach one from. There is now — the library pane sits beside
 * the lanes and its sounds are dragged onto them — and a search box in a 320px
 * popover was always the lesser version of that. So this is one field again:
 * where you right-clicked, what it says.
 */
function InsertPopover({
  at,
  onClose,
  onAdd,
}: {
  at: { startS: number; track: number; x: number; y: number };
  onClose: () => void;
  onAdd: (text: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <>
      {/* A click anywhere else dismisses, the way a popover should — without
          this, an accidental click on empty track leaves a panel stuck open. */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="bg-popover border-border absolute z-50 w-80 rounded-xl border p-3 shadow-lg"
        style={{
          // Nudged off the cursor so the pointer isn't sitting on the panel it
          // just opened, and clamped so a click near an edge still lands
          // somewhere readable.
          left: Math.max(8, at.x + 8),
          top: Math.max(8, at.y + 8),
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
            {formatDuration(at.startS)} · track {at.track}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <XIcon />
          </Button>
        </div>

        <Textarea
          autoFocus
          className="min-h-20"
          value={text}
          placeholder="What does this line say?"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter commits, shift+Enter is a newline — this is a one-field
            // form, not a document.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onAdd(text);
            }
          }}
        />
        <Button size="sm" className="mt-2 w-full" onClick={() => onAdd(text)}>
          <PlusIcon />
          Add line here
        </Button>
        <p className="text-muted-foreground/70 mt-2 text-[11px] leading-snug">
          For something you already have, drag it here from the library.
        </p>
      </div>
    </>
  );
}

/**
 * One track's controls: what it is, whether you are listening to it, how loud.
 *
 * Mute and solo are separate buttons rather than one three-state control
 * because they are separate questions, and because muting several tracks and
 * soloing one are things you do at different moments. A track that has never
 * been touched has no row at all — the first press creates one, which is why
 * everything here reads from a possibly-null track and falls back to defaults.
 */
function TrackHead({
  lane,
  track,
  soloing,
  clips,
  readOnly,
  onTrack,
  onRemove,
}: {
  lane: number;
  track: StoryTrack | null;
  /** True when *any* track is soloed, which dims everything not soloed. */
  soloing: boolean;
  clips: number;
  readOnly: boolean;
  onTrack: (trackIndex: number, patch: TrackPatch) => void;
  onRemove: (trackIndex: number, clips: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const muted = track?.muted ?? false;
  const soloed = track?.soloed ?? false;
  const gain = track?.gain_db ?? 0;
  // What you will actually hear, which is not the same as what is muted.
  const audible = soloing ? soloed : !muted;

  return (
    <div
      className={cn(
        // Sticky rather than absolute: the lane is as wide as the arrangement,
        // so a head positioned against *it* slides off the left edge the moment
        // you scroll into the piece — right when you most need to know which
        // track you are looking at. Sticky pins it to the scrollport instead,
        // the way a spreadsheet keeps its row headers. In flow for the same
        // reason (sticky and absolute are the same property); nothing else in
        // the lane is, so it displaces nothing.
        "bg-card border-border group/track sticky left-0 z-20 flex h-full shrink-0 flex-col justify-center gap-1 border-r px-2 py-1",
        !audible && "opacity-50",
      )}
      style={{ width: GUTTER }}
    >
      <div className="flex items-center gap-1">
        {/* The lane's colour, on the one thing that is always in the gutter.
            Same hue the clips on it are drawn in, which is the whole point. */}
        <span
          className="text-background flex size-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold tabular-nums"
          style={{ background: laneColor(lane, 0.85) }}
        >
          {lane}
        </span>
        {editing ? (
          <Input
            autoFocus
            defaultValue={track?.name ?? ""}
            placeholder={`Track ${lane}`}
            className="h-5 px-1 text-xs"
            onBlur={(e) => {
              const name = e.target.value.trim();
              onTrack(lane, { name: name || null });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="hover:text-foreground min-w-0 flex-1 truncate text-left text-xs"
            title="Rename this track"
          >
            {track?.name ?? (
              <span className="text-muted-foreground">
                {clips ? `Track ${lane}` : "empty"}
              </span>
            )}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant={muted ? "secondary" : "ghost"}
          size="icon-sm"
          className="size-5 text-[10px] font-semibold"
          aria-label={muted ? `Unmute track ${lane}` : `Mute track ${lane}`}
          aria-pressed={muted}
          onClick={() => onTrack(lane, { muted: !muted })}
        >
          M
        </Button>
        <Button
          variant={soloed ? "secondary" : "ghost"}
          size="icon-sm"
          className={cn("size-5 text-[10px] font-semibold", soloed && "text-primary")}
          aria-label={soloed ? `Unsolo track ${lane}` : `Solo track ${lane}`}
          aria-pressed={soloed}
          onClick={() => onTrack(lane, { soloed: !soloed })}
        >
          S
        </Button>
        {/* Native range: a 90px slider needs no more than this, and it stays
            keyboard-operable for free. */}
        <input
          type="range"
          min={-30}
          max={6}
          step={1}
          value={gain}
          aria-label={`Volume for track ${lane}`}
          className="accent-primary h-1 min-w-0 flex-1 cursor-pointer"
          onChange={(e) => onTrack(lane, { gain_db: Number(e.target.value) })}
        />
        {/* The trailing lane exists only as somewhere to drag a clip down to;
            it has no row and nothing on it, so offering to remove it would be
            a button that does nothing. */}
        {(track !== null || clips > 0) && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-5 opacity-0 group-hover/track:opacity-100 focus-visible:opacity-100"
            aria-label={`Remove track ${lane}`}
            disabled={readOnly}
            onClick={() => onRemove(lane, clips)}
          >
            <Trash2Icon className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

function ToolButton({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The span keeps the tooltip reachable while the button is disabled —
            "why can't I click this" is exactly when the label matters most. */}
        <span>
          <Button
            variant={active ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {icon}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------- clip */

function Clip({
  segment,
  lane,
  pxPerSecond,
  startS,
  durationS,
  fadeInS,
  fadeOutS,
  onFadeDown,
  onFadeMove,
  onFadeUp,
  dragging,
  generating,
  selected,
  splitArmed,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDoubleClick,
  onSplitAt,
  onEdgeDown,
  onEdgeMove,
  onEdgeUp,
  onContextMenu,
}: {
  segment: StorySegment;
  /** The lane it is drawn on — which is where it is being dragged to, not
   *  necessarily where it is stored, so the colour follows the pointer. */
  lane: number;
  pxPerSecond: number;
  startS: number;
  /** Overrides the stored duration while an edge is being dragged. */
  durationS?: number;
  /** What to draw at each end — the clip's own fade, or the crossfade an
   *  overlap has earned it, or the length being dragged right now. */
  fadeInS: number;
  fadeOutS: number;
  onFadeDown: (e: React.PointerEvent, edge: "in" | "out") => void;
  onFadeMove: (e: React.PointerEvent) => void;
  onFadeUp: (e: React.PointerEvent) => void;
  dragging: boolean;
  generating: boolean;
  selected: boolean;
  splitArmed: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
  onSplitAt: (atS: number) => void;
  onEdgeDown: (e: React.PointerEvent, edge: "start" | "end") => void;
  onEdgeMove: (e: React.PointerEvent) => void;
  onEdgeUp: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const duration = durationS ?? estimateDuration(segment);
  const width = Math.max(8, duration * pxPerSecond);
  const generated = Boolean(segment.sound_id);
  const canSplit = splitArmed && generated;
  // Who reads this clip, drawn rather than spelled: at clip width the label is
  // the first thing to truncate, and a 12px face survives a narrow clip where
  // "Nar…" does not. One shared voices query behind `useVoice`, so a hundred
  // clips cost one fetch.
  const voice = useVoice(segment.voice_id);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${segment.speaker ?? "Line"}: ${segment.text.slice(0, 40) || "empty"}`}
      className={cn(
        "absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border select-none",
        // A clip with audio wears its lane's colour; one with nothing in it
        // yet stays dashed and grey, so a placeholder never reads as audio
        // that is simply very quiet.
        !generated && "border-muted-foreground/40 bg-muted/40 border-dashed",
        selected && "ring-primary ring-2",
        generating && "border-transparent",
        segment.muted && "opacity-40",
        canSplit ? "cursor-crosshair" : dragging ? "cursor-grabbing" : "cursor-grab",
        dragging && "z-10 shadow-lg",
      )}
      style={{
        left: startS * pxPerSecond,
        width,
        ...(generated
          ? { background: laneColor(lane, 0.2), borderColor: laneColor(lane, 0.6) }
          : {}),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onClick={(e) => {
        if (!canSplit) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onSplitAt((e.clientX - rect.left) / pxPerSecond);
      }}
    >
      {/* The fades, drawn over the waveform: the audio darkens into silence
          across exactly the span that is being faded. A shape rather than a
          number, because the question you are asking is "does this reach far
          enough into the clip", and that is a length you look at. */}
      {fadeInS > 0 && (
        <div
          className="from-card pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r to-transparent"
          style={{ width: Math.min(width, fadeInS * pxPerSecond) }}
          aria-hidden="true"
        />
      )}
      {fadeOutS > 0 && (
        <div
          className="from-card pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l to-transparent"
          style={{ width: Math.min(width, fadeOutS * pxPerSecond) }}
          aria-hidden="true"
        />
      )}

      {/* Their handles, in the top corners and inset past the trim strips so
          the two gestures never fight over the same pixel. */}
      {width > 36 && (
        <>
          {(["in", "out"] as const).map((edge) => (
            <div
              key={edge}
              role="slider"
              tabIndex={-1}
              aria-label={edge === "in" ? "Fade in" : "Fade out"}
              aria-valuemin={0}
              aria-valuenow={edge === "in" ? fadeInS : fadeOutS}
              aria-valuetext={`${(edge === "in" ? fadeInS : fadeOutS).toFixed(2)} s`}
              className={cn(
                "border-foreground/50 bg-background/70 hover:bg-primary hover:border-primary absolute top-1 z-20 size-2 cursor-ew-resize touch-none rounded-[2px] border transition-colors",
                edge === "in" ? "left-2" : "right-2",
              )}
              onPointerDown={(e) => onFadeDown(e, edge)}
              onPointerMove={onFadeMove}
              onPointerUp={onFadeUp}
              onPointerCancel={onFadeUp}
            />
          ))}
        </>
      )}

      {/* Grab handles. Only on a clip wide enough to still have a middle to
          drag by — otherwise the handles would eat the whole clip and it
          could never be moved again. */}
      {width > 24 && (
        <>
          {(["start", "end"] as const).map((edge) => (
            <div
              key={edge}
              role="separator"
              aria-label={edge === "start" ? "Trim the start" : "Trim the end"}
              className={cn(
                "hover:bg-primary/60 absolute inset-y-0 z-10 w-1.5 cursor-ew-resize touch-none",
                edge === "start" ? "left-0" : "right-0",
              )}
              onPointerDown={(e) => onEdgeDown(e, edge)}
              onPointerMove={onEdgeMove}
              onPointerUp={onEdgeUp}
              onPointerCancel={onEdgeUp}
            />
          ))}
        </>
      )}

      {generating && <GeneratingOutline />}

      {segment.sound?.peaks?.length ? (
        <Waveform peaks={segment.sound.peaks} width={width} color={laneColor(lane, 0.85)} />
      ) : null}
      <div className="absolute inset-x-0 top-0 flex items-center gap-1 px-1.5 py-0.5">
        {voice && width > 36 && (
          <VoiceAvatar voice={voice} className="size-3 rounded-full" />
        )}
        <span className="truncate text-[10px] font-medium">
          {segment.speaker || segment.text.slice(0, 24) || "Empty line"}
        </span>
        {segment.muted && <VolumeXIcon className="size-2.5 shrink-0" aria-hidden="true" />}
      </div>
    </div>
  );
}

/**
 * The "this is being read" state: a wobbling outline that crawls.
 *
 * Turbulence rather than a dashed rectangle because a straight dashed border
 * is what half the UI already uses for "empty" and "placeholder" — a clip the
 * machine is actively working on should not look like a clip nobody has
 * touched. The wobble is a static displacement filter; the motion is the dash
 * marching around it, which is one animated property rather than a filter
 * being recomputed every frame.
 */
/**
 * The clip-to-be: the lane's colour at a whisper, the same crawling outline a
 * regenerating clip wears, the prompt as its label, and a progress bar along
 * the bottom. Inert on purpose — there is nothing to drag, split or play yet,
 * and `pointer-events-none` keeps it from shadowing the lane's own drop and
 * marquee handling underneath.
 */
function PendingClipView({
  clip,
  lane,
  pxPerSecond,
}: {
  clip: PendingClip;
  lane: number;
  pxPerSecond: number;
}) {
  const width = Math.max(8, clip.duration_s * pxPerSecond);
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={`Generating: ${clip.label.slice(0, 60) || "sound"}`}
      className="pointer-events-none absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border border-transparent select-none"
      style={{ left: clip.start_s * pxPerSecond, width, background: laneColor(lane, 0.12) }}
    >
      <GeneratingOutline />
      <div className="flex h-full min-w-0 flex-col justify-between px-2 py-1">
        <p className="text-foreground/80 truncate text-[11px] leading-tight">{clip.label}</p>
        <p className="text-muted-foreground truncate text-[10px] tabular-nums">
          {clip.phase && clip.phase !== "Queued" ? <LoadingVerb /> : (clip.phase ?? "Queued")}
          {clip.progress > 0 ? ` · ${Math.round(clip.progress * 100)}%` : ""}
        </p>
      </div>
      <div className="bg-muted/60 absolute inset-x-0 bottom-0 h-0.5">
        <div
          className="bg-primary h-full transition-[width] duration-300"
          style={{ width: `${Math.max(2, clip.progress * 100)}%` }}
        />
      </div>
    </div>
  );
}

function GeneratingOutline() {
  // The filter has to be unique per instance or every clip shares the first
  // one's displacement and they all wobble identically.
  const id = useId();
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves={2} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" />
        </filter>
      </defs>
      <rect
        x="1"
        y="1"
        width="calc(100% - 2px)"
        height="calc(100% - 2px)"
        rx="5"
        fill="none"
        className="stroke-primary soundbox-crawl"
        strokeWidth="1.5"
        strokeDasharray="8 4"
        filter={`url(#${id})`}
      />
    </svg>
  );
}

/**
 * The clip's waveform, painted from the peaks the server already computed.
 *
 * Peaks are a fixed number of buckets regardless of the clip's length, so a
 * wide clip stretches them and a narrow one samples across them — the shape
 * stays honest at any zoom without ever touching the audio.
 */
function Waveform({
  peaks,
  width,
  color,
}: {
  peaks: number[];
  width: number;
  color: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    // Draw at device resolution; a 1x canvas scaled up is visibly soft against
    // crisp text on the same clip.
    const dpr = window.devicePixelRatio || 1;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // `currentColor` through the canvas: the clip sets the colour in CSS, so
    // the waveform follows the theme without this component knowing about it.
    ctx.fillStyle = getComputedStyle(canvas).color;
    const bars = Math.max(1, Math.floor(width / 3));
    const mid = height / 2;
    for (let i = 0; i < bars; i++) {
      const peak = peaks[Math.floor((i / bars) * peaks.length)] ?? 0;
      const h = Math.max(1, peak * (height - 6));
      ctx.fillRect(i * 3, mid - h / 2, 2, h);
    }
  }, [peaks, width, color]);

  // The colour arrives as an inline `color` and is read back through
  // `currentColor`, so the canvas still does not know what a lane is.
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" style={{ color }} />;
}
