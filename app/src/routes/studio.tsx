/**
 * The studio floor — shared by both builders, and by neither exclusively.
 *
 * Soundbox has two tools that make sounds, and this file is the half they
 * have in common: a timeline, a library, a chat, a device rack, and the
 * plumbing that keeps a story's clips and its script in step. What the two
 * builders disagree about is small enough to be a prop.
 *
 *   Script Builder (`builder: "script"`) — you start from words. The script
 *   panel is beside the timeline, lines carry a speaker and a voice, and the
 *   thing you press is Speak.
 *
 *   Music Builder (`builder: "music"`) — you start from a prompt. There is no
 *   script panel at all: a column of "Write the line…" rows with a voice
 *   picker, sitting beside a bass stem, invites putting a spoken read on it.
 *   The Prompt panel takes its slot.
 *
 * This used to be one studio that worked out which it was by inspecting its
 * own clips — `isArrangement`: no words anywhere and audio everywhere meant
 * an arrangement. It was a decent guess and it is gone, because a guess
 * cannot be made at all on an empty story, which is exactly when the answer
 * matters. The choice is made at the "new sound" door instead (see
 * `new-studio-dialog`), stored on the story, and read here.
 *
 * What is *not* different: every panel a builder has, it has all the time.
 * The Script Builder still owns the Prompt panel and the device rack — a
 * scripted piece is exactly the sort of thing you drop a generated bed under
 * — they simply are not what it opens with.
 *
 * The page is two views of one list. On the left the script, in reading
 * order, where you write and voice each line; on the right the same lines in
 * time, where you arrange them. The timeline is the one that decides order —
 * moving a clip re-reads the script to match, see `lib/reading-order` — because the
 * order things happen in is the order they are read in.
 *
 * Generation is per line rather than per story. Regenerating one line is the
 * single most common thing you do to a script (a word was mispronounced, a
 * read was flat), and a page that could only re-speak the whole thing would
 * make that cost minutes instead of seconds.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  AudioWaveformIcon,
  ChartNoAxesGanttIcon,
  Columns3Icon,
  DownloadIcon,
  ExternalLinkIcon,
  Grid3x3Icon,
  HistoryIcon,
  LayoutDashboardIcon,
  LibraryBigIcon,
  Loader2Icon,
  MessageSquareIcon,
  PianoIcon,
  PlayIcon,
  ScrollTextIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquareIcon,
  MoreHorizontalIcon,
  PanelRightOpenIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StoryScript } from "@/components/story-script";
import { LibraryPane } from "@/components/library-pane";
import { PageHeader } from "@/components/header-slot";
import { formatDuration } from "@/lib/format";
import { StoryTimeline, type PendingClip } from "@/components/story-timeline";
import { StoryHistory, useHistoryCount } from "@/components/story-history";
import { useAppendHistory, useAssistantEnabled } from "@/lib/queries";
import { PHASE_LABEL, ordinal } from "@/components/pending-sound-row";
import { DeviceCards, DeviceLanes } from "@/components/device-rack";
import { ArtifactStack, type Artifact } from "@/components/artifact-stack";
import { PanelCanvas, type CanvasColumn } from "@/components/panel-canvas";
import { PopoutPanelFrame, PopoutWindow } from "@/components/popout-window";
import { openPopoutWindow, type PopOutAt } from "@/lib/popout";
import { useUiPrefs } from "@/lib/ui-prefs";
import { CommandPalette } from "@/components/command-palette";
import { AssistantChat } from "@/components/assistant-chat";
import { LogTail } from "@/components/log-tail";
import { studioThread } from "@/lib/assistant-store";
import { cn } from "@/lib/utils";
import type { StudioAction, StudioContext } from "@/lib/studio-command";
import { describeAction, panelForAction } from "@/lib/studio-command";
import { useStudioBridge } from "@/lib/studio-bridge";
import { clampDeviceParams, createDevice } from "@/lib/devices";
import type { DeviceKind } from "@/lib/devices";
import type { Command } from "@/components/command-palette";
import { SoundArtifact } from "@/components/sound-artifact";
import { useTrackDevices } from "@/hooks/use-track-devices";
import { JobResult, isReady } from "@/components/voice-shared";
import { VoiceAvatar, useVoice } from "@/components/voice-avatar";
import { useJobStream } from "@/hooks/use-job-stream";
import { useEditHistory } from "@/hooks/use-edit-history";
import { useStoryEvents } from "@/hooks/use-story-events";
import { useQueryClient } from "@tanstack/react-query";

import {
  qk,
  useCreateSegment,
  useDeleteSegment,
  useDeleteStory,
  useExportStory,
  useGenerateSegment,
  useModels,
  useSetStoryOptions,
  useRenameStory,
  useSegments,
  useRepaintSound,
  useSeparateSound,
  useSplitSegment,
  useStory,
  useTracks,
  useDeleteTrack,
  useUpdateTrack,
  useUpdateSegment,
  useVoices,
} from "@/lib/queries";
import { api } from "@/lib/api";
import { toWav } from "@/lib/audio-file";
import { laneIsFree, lanesFor, nextFreeTrack } from "@/lib/lanes";
import { MidiPanel } from "@/components/midi-panel";
import type { CoverRequest } from "@/components/take-actions";
import { PianoRoll, PianoRollTitle } from "@/components/piano-roll";
import { ttsVoices, useGenerateSession } from "@/hooks/use-generate-session";
import { MusicRequestForm } from "@/components/music-request-form";
import { clampDuration, preferredModel, useSessionStore } from "@/lib/session-store";
import type { ComposerSettings, TurnInsert } from "@/lib/session-store";
import { usePrefillStore } from "@/lib/generate-store";
import { useTransportStore } from "@/lib/transport-store";
import { usePlayerStore } from "@/lib/player-store";
import type {
  Job,
  SegmentCreate,
  SegmentPatch,
  Sound,
  StemSelection,
  StoryBuilder,
  StorySegment,
  TrackPatch,
  Unsubscribe,
} from "@/lib/api";
import { StemPickerDialog } from "@/components/stem-picker";
import {
  DEFAULT_REPAINT,
  RepaintDialog,
  type RepaintOptions,
} from "@/components/repaint-controls";

/** The mixer half of a track patch — what the strip on a lane edits and its
 *  undo history records. The device chain has its own path through
 *  `useTrackDevices`, which paces a dial sweep into a few writes. */
type MixPatch = Omit<TrackPatch, "devices">;

/* --------------------------------------------------------------------- page */

export function StudioPage({ builder }: { builder: StoryBuilder }) {
  const { storyId } = useParams<{ storyId: string }>();
  if (!storyId) return <Navigate to="/studio" replace />;
  // Keyed on both: switching stories is a different document, and a story
  // that changed builder underneath us (a redirect correcting a stale link)
  // is a different set of panels. Neither should inherit the other's state.
  return <StudioEditor key={`${builder}:${storyId}`} storyId={storyId} builder={builder} />;
}


type ClipMove = { id: string; patch: { start_s: number; track_index: number } };

/** Everything needed to put a deleted clip back as it was — not just its
 *  words and place, but its trim, fades, gain and delivery. */
function restorable(seg: StorySegment): SegmentCreate {
  return {
    text: seg.text,
    speaker: seg.speaker,
    voice_id: seg.voice_id,
    language: seg.language,
    kind: seg.kind,
    sound_id: seg.sound_id,
    duration_s: seg.duration_s,
    track_index: seg.track_index,
    position: seg.position,
    start_s: seg.start_s,
    trim_start_s: seg.trim_start_s,
    fade_in_s: seg.fade_in_s,
    fade_out_s: seg.fade_out_s,
    gain_db: seg.gain_db,
    muted: seg.muted,
    request_options: seg.request_options,
  };
}

/* ------------------------------------------------------------------- editor */

/**
 * The panels, their names and their keys, in one table.
 *
 * The Panels menu, the keyboard shortcuts and the command palette are three
 * ways of saying the same eight things, and they were three hand-written
 * lists until this existed. A panel added to one and forgotten in the others
 * is the obvious failure; the quieter one is a shortcut that toggles a panel
 * the menu says is unavailable.
 *
 * `builders` is which tools have the panel at all — not which tool opens with
 * it, which is `OPENS_WITH` below. Only the script panel is missing from one:
 * a music arrangement has no lines to read, so the panel would be an empty
 * column and the shortcut a no-op.
 */
const PANELS: {
  id: string;
  label: string;
  key: string;
  /** The panel's glyph, everywhere the panel is named. See `Artifact.icon`:
   *  the header, the Panels menu and the left column's tabs all read it from
   *  here, so a panel cannot be a picture in one place and bare text in
   *  another. */
  icon: LucideIcon;
  builders?: StoryBuilder[];
}[] = [
  // The conversation, as a panel of the studio rather than a page you left
  // the studio for. Arranging *is* the conversation now: you ask for a
  // sound, it lands on a lane, you say what to change, and the thread is
  // still there beside the thing it changed.
  { id: "chat", label: "Chat", key: "t", icon: MessageSquareIcon },
  { id: "script", label: "Script", key: "r", icon: ScrollTextIcon, builders: ["script"] },
  { id: "insert", label: "Prompt", key: "p", icon: SparklesIcon },
  { id: "library", label: "Library", key: "b", icon: LibraryBigIcon },
  { id: "history", label: "History", key: "i", icon: HistoryIcon },
  { id: "sample", label: "Sample", key: "e", icon: AudioWaveformIcon },
  { id: "devices", label: "Devices", key: "f", icon: SlidersHorizontalIcon },
  // Notes, under the timeline beside the rack: it is a performance surface
  // that produces clips, so it belongs on the side of the studio where the
  // tracks are, not in the column of things that describe them.
  { id: "midi", label: "MIDI", key: "n", icon: PianoIcon },
  // The same take, as something you edit rather than perform. Two panels
  // rather than one because they are two postures — playing a phrase in and
  // fixing the note you fluffed — and a panel that tried to be both would be
  // a keyboard you cannot reach past a grid.
  { id: "roll", label: "Piano roll", key: "o", icon: Grid3x3Icon },
  // What the server was doing while this was made. The History panel beside
  // it says *what* happened — "generated a bassline, 40 seconds" — and this
  // says how it went: the job's own log lines, and the traceback when one of
  // them fails. Sending you to /activity for that meant leaving the studio,
  // which is the one place the answer is worth having.
  { id: "logs", label: "Logs", key: "g", icon: TerminalIcon },
  // The timeline used to be the one panel with no X, on the reasoning that
  // everything else is a view *of* an arrangement and there is nothing to
  // view without it. True, but not a reason to refuse: with the chat in the
  // studio, "hide the timeline and let me write" is a real way to work, and
  // a panel you can reopen from three places is not a panel you can lose.
  { id: "timeline", label: "Timeline", key: "l", icon: ChartNoAxesGanttIcon },
];

/** The glyph for a panel id. One table, so the header, the menu and the tab
 *  agree; `SparklesIcon` is the fallback only so a panel added to an
 *  `ArtifactStack` and forgotten in `PANELS` still draws something. */
const panelIcon = (id: string): LucideIcon =>
  PANELS.find((p) => p.id === id)?.icon ?? SparklesIcon;

/**
 * Keys the timeline has already claimed, which a panel may not take.
 *
 * Both handlers listen on `window` and neither stops the other, so a letter
 * used twice fires twice: Script was on S, History on Y and Devices on D,
 * which meant ctrl+D duplicated the selected clips *and* toggled the device
 * rack, and ctrl+Y redid an edit *and* toggled History. The timeline's
 * bindings are the ones every DAW shares, so the panels moved instead —
 * sc(R)ipt, h(I)story, e(F)fects. Asserted here so the next panel added
 * cannot quietly recreate the clash.
 *
 * `k` is in here for a different reason: the same handler opens the command
 * palette on it and returns before it ever reaches this table, so a panel on
 * `k` is not a double-fire but a shortcut that silently does nothing. MIDI was
 * written on `k` and lost every press to the palette, which is exactly the
 * class of mistake this assertion exists to catch — so it catches it now.
 */
const TIMELINE_KEYS = new Set(["a", "c", "d", "k", "m", "s", "v", "x", "y", "z"]);
const PANEL_KEY_CLASH = PANELS.filter((p) => TIMELINE_KEYS.has(p.key)).map((p) => p.key);
if (PANEL_KEY_CLASH.length > 0) {
  // Loud in development, harmless in production: a shortcut that silently
  // does two things is worse than a console error nobody reads.
  console.error(
    `Panel shortcuts collide with the timeline's: ${PANEL_KEY_CLASH.join(", ")}. ` +
      "Pick a letter outside TIMELINE_KEYS.",
  );
}

/**
 * What each builder opens with.
 *
 * Deterministic, and deliberately so. This used to be four effects reading
 * the story's own contents — is there a script, is every clip already
 * generated, did we arrive with a prefill — which meant the same story could
 * greet you differently on two visits, and a brand-new one greeted you with
 * nothing but a chat box because there was nothing yet to reason about.
 *
 * A builder you chose knows what it is for. The Script Builder opens on the
 * script, the timeline, the library and the chat; the Music Builder swaps the
 * script for the Prompt panel, which is where its work starts. Everything
 * else — History, Sample, Devices — stays a keystroke away, because those
 * describe work that has not happened yet on arrival.
 *
 * The Library is one of those for the Music Builder. Music and effects start
 * from a description, not from something you already have: the first thing
 * you do is say what you want, and a column of past sounds beside it is a
 * shelf you did not ask for taking a quarter of the window. A script is the
 * other way round — you are placing existing takes against words — so it
 * keeps the Library open. Ctrl/⌘B either way.
 */
const OPENS_WITH: Record<StoryBuilder, string[]> = {
  script: ["script", "timeline", "library", "chat"],
  music: ["insert", "timeline", "chat"],
};

/**
 * Whether this looks like a Mac, for naming the modifier only.
 *
 * The handler tests `metaKey || ctrlKey` regardless, so a wrong guess costs a
 * mislabelled hint rather than a shortcut that does not work.
 */
/** The handle a line auditioned from the script holds while it plays. */
const AUDITION_PLAYER_ID = "studio-audition";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** "⌘S" needs no separator and reads as one chord; "CtrlS" does not. */
const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl+";

/** Exported so the chat can mount a studio beside the conversation — see
 *  the studio artifact in `routes/generate.tsx`. Same component, same story. */
export function StudioEditor({
  storyId,
  builder,
}: {
  storyId: string;
  builder: StoryBuilder;
}) {
  const navigate = useNavigate();
  /** The panels this builder has at all — the menu, the shortcuts and the
   *  palette all read this rather than `PANELS`, so a tool cannot offer a
   *  panel it does not have. */
  /**
   * Whether there is an assistant to talk to at all.
   *
   * Both things the chat panel does — answering a question, and planning an
   * edit from "mute 1 and 3" — go through the local model, and with the
   * prompt assistant off the server refuses before it reads either. So the
   * panel is not offered: no menu item, no Ctrl/⌘T, no palette entry, and
   * nothing in the column. The Chat page still exists and explains where the
   * switch is (see `assistant-chat`); a studio is not the place for that.
   */
  const assistantEnabled = useAssistantEnabled();
  const panels = useMemo(
    () =>
      PANELS.filter(
        (p) =>
          (p.builders === undefined || p.builders.includes(builder)) &&
          (p.id !== "chat" || assistantEnabled),
      ),
    [builder, assistantEnabled],
  );
  /** Where this builder's shelf is, for the crumb and for "the story is
   *  gone, go back". */
  const shelfHref = `/studio?builder=${builder}`;
  const story = useStory(storyId);
  const setStoryOptions = useSetStoryOptions();
  const segments = useSegments(storyId);
  const tracks = useTracks(storyId);
  // Live view of this story: an agent writing lines over MCP shows up here as
  // it happens, rather than on the next refresh.
  const agent = useStoryEvents(storyId);
  const history = useEditHistory();
  const clearHistory = history.clear;

  /**
   * Follow a job to its end, once.
   *
   * Every render the studio starts — a line read, a repaint, a stem split —
   * used to open its own subscription with no error path and no teardown, so
   * a dropped stream left the row "reading" forever and a result arriving
   * after you left wrote into a studio that no longer existed. This latches
   * the first terminal event (SSE and the polling fallback can both deliver
   * one), reports a lost connection as a failure, and closes everything still
   * open when the page goes.
   */
  const followed = useRef(new Set<Unsubscribe>());
  useEffect(() => {
    const open = followed.current;
    return () => {
      open.forEach((close) => close());
      open.clear();
    };
  }, []);
  const followJob = useCallback(
    (
      jobId: string,
      on: { done: (job: Job) => void; failed: (message: string | null, job: Job | null) => void; progress?: (job: Job) => void },
    ): void => {
      let settled = false;
      let stop: Unsubscribe | null = null;
      const close = (): void => {
        stop?.();
        followed.current.delete(close);
      };
      followed.current.add(close);
      stop = api.subscribeJob(
        jobId,
        (job) => {
          if (settled) return;
          if (job.status === "done") {
            settled = true;
            close();
            on.done(job);
          } else if (job.status === "error" || job.status === "cancelled") {
            settled = true;
            close();
            on.failed(job.status === "error" ? job.error || null : null, job);
          } else {
            on.progress?.(job);
          }
        },
        (err) => {
          if (settled) return;
          settled = true;
          close();
          on.failed(err.message || "Lost track of the job", null);
        },
      );
      // A subscription that settled synchronously has already closed itself
      // before `stop` existed; close it now that it does.
      if (settled) stop();
    },
    [],
  );

  // An agent rewriting the story invalidates our inverses — they describe
  // clips that may no longer be where, or what, we recorded. Drop them rather
  // than offer an undo that would do something surprising.
  useEffect(() => {
    if (agent.active) clearHistory();
  }, [agent.active, clearHistory]);
  const models = useModels();
  const voices = useVoices();

  const renameStory = useRenameStory();
  const deleteStory = useDeleteStory();
  const createSegment = useCreateSegment(storyId);
  const updateSegment = useUpdateSegment(storyId);
  const deleteSegment = useDeleteSegment(storyId);
  const updateTrack = useUpdateTrack(storyId);
  const deleteTrack = useDeleteTrack(storyId);
  const [pendingTrackRemoval, setPendingTrackRemoval] = useState<{
    trackIndex: number;
    clips: number;
  } | null>(null);
  const splitSegment = useSplitSegment(storyId);
  const separateSound = useSeparateSound();
  const repaintSound = useRepaintSound();
  /** The clip whose stems are being chosen, and whether the split is running.
   *  One at a time: separation is slow and a second one would race the lanes
   *  the first is laying out. */
  const [stemTarget, setStemTarget] = useState<StorySegment | null>(null);
  /** The clip and window a repaint is being set up for, and the answers so
   *  far. Held here rather than started on the click: a menu item that spends
   *  minutes rendering without asking what you wanted is the wrong shape for
   *  the gesture. */
  const [repaintTarget, setRepaintTarget] = useState<{
    segment: StorySegment;
    window: { start_s: number; end_s: number };
  } | null>(null);
  const [repaintOptions, setRepaintOptions] = useState<RepaintOptions>(DEFAULT_REPAINT);
  const [separating, setSeparating] = useState(false);
  const exportStory = useExportStory(storyId);

  /** The device rack under the timeline: which lanes it can offer, which one
   *  it is showing, and the chains themselves. Stored on the server with each
   *  track, so an agent's change shows up here — see `use-track-devices`. The
   *  chains move with their lanes when one is removed; the server renumbers
   *  the track rows itself. */
  const { devices, setLane, getLane } = useTrackDevices(storyId);
  const removeTrack = (trackIndex: number): void => {
    // The mutation's own toast says what went wrong.
    deleteTrack.mutateAsync(trackIndex).catch(() => undefined);
  };
  const lanes = useMemo(
    () => lanesFor(segments.data ?? [], tracks.data ?? []),
    [segments.data, tracks.data],
  );
  const [rackLane, setRackLane] = useState(0);
  /**
   * Panels taken off the screen, by id.
   *
   * Closed, not collapsed: a collapsed panel is still a header in the column
   * saying "not right now", and after three of those the stack is a list of
   * things you are not looking at.
   *
   * Which ones start open is `OPENS_WITH`, read once — a builder you picked
   * already said what you came here to do, so nothing here inspects the story
   * to second-guess it. The one exception is the prefill: "Reuse" on a
   * library sound drops one and opens a builder, and hiding the panel that
   * receives it would land you somewhere with the reuse silently applied out
   * of sight.
   */
  const [closedPanels, setClosedPanels] = useState<Set<string>>(() => {
    const open = new Set(OPENS_WITH[builder]);
    if (usePrefillStore.getState().prefill !== null) open.add("insert");
    return new Set(panels.map((p) => p.id).filter((id) => !open.has(id)));
  });

  /**
   * Which render the Logs panel is showing, if it has been pointed at one.
   *
   * Lives here rather than in the panel because the History beside it is what
   * usually sets it: "why did that one fail" is a question you ask of a row in
   * the history, and the answer is that job's lines with everything else
   * filtered out.
   */
  const [logsJob, setLogsJob] = useState<string | null>(null);

  /**
   * Which of the left column's two panels is in front.
   *
   * The Chat and the Prompt are tabs of one panel rather than two panels
   * stacked, because they are two ways of saying the same thing and you are
   * only ever doing one of them. Stacked, each got half of a fifth of the
   * window: a conversation four messages tall above a form you scrolled to
   * fill. See the column itself for the rest of the reasoning.
   */
  const [leftTab, setLeftTab] = useState<"chat" | "insert">(() =>
    // A "Reuse" from the library opened this studio to receive a prefill, so
    // the Prompt is the tab in front. Behind the chat it would be the same
    // silent-application bug `closedPanels` guards against, one layer in.
    usePrefillStore.getState().prefill !== null ? "insert" : "chat",
  );

  /**
   * Panels living in a window of their own, and the window.
   *
   * Still open — a popped-out panel is in `closedPanels` no more than a docked
   * one — but drawn by `PopoutWindow` instead of the columns or the canvas.
   * Closing the panel closes its window; closing the window puts the panel
   * back where it was.
   */
  const [popped, setPopped] = useState<ReadonlyMap<string, Window>>(() => new Map());
  const popOut = (id: string, at: PopOutAt): void => {
    const win = openPopoutWindow(id, at);
    if (win === null) {
      toast.error("The browser blocked the new window. Allow pop-ups for Soundbox and try again.");
      return;
    }
    win.focus();
    setPopped((prev) => new Map(prev).set(id, win));
  };
  const dock = useCallback((id: string): void => {
    setPopped((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);
  /** On this page, in the columns or on the canvas: open and not popped out. */
  const inPage = (id: string): boolean => !closedPanels.has(id) && !popped.has(id);
  const layoutMode = useUiPrefs((s) => s.studioLayout);
  const setUiPrefs = useUiPrefs((s) => s.set);
  /** Bumped by "Tidy the canvas"; see `PanelCanvas`. */
  const [tidyRequest, setTidyRequest] = useState(0);

  const showPanel = (id: string, show: boolean): void => {
    // Opening one of the tabs brings it to the front. Otherwise Ctrl/⌘P on a
    // studio with the chat in front un-hides a panel behind another one and
    // looks like the shortcut did nothing.
    if (show && (id === "chat" || id === "insert")) setLeftTab(id);
    // A panel closed from anywhere takes its window with it, and opens docked
    // next time: a window that reappears on its own is one you did not ask for.
    if (!show) dock(id);
    setClosedPanels((prev) => {
      const next = new Set(prev);
      if (show) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** Every clip selected on the timeline, so the command bar can resolve
   *  "these". The timeline owns the gesture; this is only its report. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** Bumped to ask the timeline to start recording. A counter rather than a
   *  boolean because the request is an event, and two in a row must both be
   *  heard rather than the second looking like the first still being true. */
  const [recordRequest, setRecordRequest] = useState(0);
  /** The line the timeline's playhead is inside, so the script can read along
   *  with playback and with a scrub. Deliberately not merged into
   *  `selectedId`: playback must not move the edit cursor. */
  const [playingId, setPlayingId] = useState<string | null>(null);
  /** The timeline's play/stop, published upward so the dock owns the main
   *  transport — see StoryTimeline's `onTransport`. */
  const [transport, setTransport] = useState<{ play: () => void; stop: () => void } | null>(
    null,
  );
  const [playing, setPlaying] = useState(false);
  /** The Timeline card's header slot for play/rec/tools. The timeline owns
   *  that row's state, so the page only holds the element the tools portal
   *  into — `null` until the header mounts. */
  const [timelineToolbarHost, setTimelineToolbarHost] = useState<HTMLDivElement | null>(null);

  /**
   * Auditioning one line, from its own row in the script.
   *
   * A plain <audio> rather than the timeline's Web Audio graph: this is one
   * sound with no arrangement to honour. It claims the same global
   * one-thing-plays handle the story transport does, so pressing play on a
   * line stops the story and vice versa.
   */
  const [auditionId, setAuditionId] = useState<string | null>(null);
  const [auditionTime, setAuditionTime] = useState(0);
  const auditionRef = useRef<HTMLAudioElement | null>(null);
  const stopAudition = (): void => {
    auditionRef.current?.pause();
    auditionRef.current = null;
    setAuditionId(null);
    usePlayerStore.getState().stop(AUDITION_PLAYER_ID);
  };
  const audition = (id: string): void => {
    if (auditionId === id) {
      stopAudition();
      return;
    }
    stopAudition();
    const sound = (segments.data ?? []).find((x) => x.id === id)?.sound;
    if (!sound) return;
    transport?.stop();
    // Claim the app's one-thing-plays handle, as the comment above promises:
    // without it a line could play over the Library pane's player.
    usePlayerStore.getState().play(AUDITION_PLAYER_ID);
    const el = new Audio(sound.file);
    el.addEventListener("ended", stopAudition);
    // Feeds the row's scrub strip so a long line can be heard from the middle.
    el.addEventListener("timeupdate", () => setAuditionTime(el.currentTime));
    void el.play();
    auditionRef.current = el;
    setAuditionTime(0);
    setAuditionId(id);
  };
  /** Move the auditioned line, from its row's strip. Starts it again if the
   *  audition had already finished — the same thing a click on any other
   *  waveform in the app does. */
  const seekAudition = (seconds: number): void => {
    const el = auditionRef.current;
    if (!el) return;
    el.currentTime = seconds;
    setAuditionTime(seconds);
    if (el.paused) void el.play();
  };

  // The story taking over is the audition's cue to get out of the way.
  useEffect(() => {
    if (playing) stopAudition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
  useEffect(() => stopAudition, []);
  // And get out of the way when anything else takes the handle.
  const claimedBy = usePlayerStore((s) => s.playingId);
  useEffect(() => {
    if (auditionRef.current && claimedBy !== AUDITION_PLAYER_ID) stopAudition();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the handle changing hands only
  }, [claimedBy]);
  /**
   * The two outer columns, as percentages of the row; the timeline takes what
   * is left. A fifth each by default, so the arrangement gets the three fifths
   * in the middle where the work is.
   *
   * Local state, not persisted: it is a "give me room for this bit right now"
   * gesture, and a remembered width is one more thing to be wrong on the next
   * story.
   */
  const [leftPct, setLeftPct] = useState(20);
  const [rightPct, setRightPct] = useState(20);
  const rowRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ pointerId: number; side: "left" | "right" } | null>(null);

  const onResizeDown = (
    event: React.PointerEvent<HTMLDivElement>,
    side: "left" | "right",
  ): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = { pointerId: event.pointerId, side };
  };
  const onResizeMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = resizeRef.current;
    if (state === null || state.pointerId !== event.pointerId || rowRef.current === null) return;
    const rect = rowRef.current.getBoundingClientRect();
    // Measured from the row's own edge on each side, so the right-hand handle
    // grows the panel as it moves left — which is the direction it looks like
    // it should go. Clamped so neither column can be dragged away entirely: a
    // pane you cannot see is a pane you cannot drag back.
    const pct =
      state.side === "left"
        ? ((event.clientX - rect.left) / rect.width) * 100
        : ((rect.right - event.clientX) / rect.width) * 100;
    const clamped = Math.min(45, Math.max(12, pct));
    if (state.side === "left") setLeftPct(clamped);
    else setRightPct(clamped);
  };
  const onResizeUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null;
  };
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const exportJob = useJobStream(exportJobId);

  const ttsModels = useMemo(
    () => (models.data ?? []).filter((m) => m.task === "tts" && isReady(m)),
    [models.data],
  );
  /* Voices this story can be read with. Every voice names the model it
     speaks through (see `AddVoiceDialog`), and one whose model is not
     installed is left out — casting it could only produce a read that
     fails. */
  const usableVoices = useMemo(
    () => ttsVoices(voices.data ?? [], ttsModels),
    [voices.data, ttsModels],
  );

  /**
   * The model one line is read on — its own voice's, because that is where a
   * voice is cast. There is no model control on this page and no story-wide
   * voice either: a script is a cast, two characters can be two families, and
   * a single picker in the bar could only be wrong for one of them.
   *
   * The fallback is for a line with no voice yet, and for a clone saved
   * before voices carried a model: both mean "no family was named", and the
   * first installed one reads them.
   */
  const modelForVoice = (voiceId: string | null | undefined): string => {
    const voice = voiceId ? usableVoices.find((v) => v.id === voiceId) : undefined;
    return voice?.model_id ?? ttsModels[0]?.id ?? "";
  };
  const modelLabel = (id: string): string =>
    models.data?.find((m) => m.id === id)?.name ?? id;
  /** A take's caption: its name, and for a spoken one the model that read it,
   *  since which family a voice came out of is the first thing to check when a
   *  clone does not sound like itself. */
  const readOn = (sound: Sound): string =>
    models.data?.find((m) => m.id === sound.model)?.task === "tts"
      ? `${sound.name} · ${modelLabel(sound.model)}`
      : sound.name;



  /**
   * The prompt panel drives the exact same shared session as /app, /console
   * and the Music studio — same model catalogue, same job stream, same
   * prompt assistant (enhance, write lyrics) — via `useGenerateSession`,
   * rather than a stripped-down composer of this page's own. `MusicRequestForm`
   * (see `components/music-request-form.tsx`) is the form the Music studio
   * itself uses; only what happens with a finished turn differs here.
   */
  // No page-wide Cmd/Ctrl+Enter here: in the studio those keys belong to the
  // script and the chat, and a global one quietly started a generation from
  // whatever prompt the composer last held, which never landed anywhere.
  const musicSession = useGenerateSession({ hotkey: false });
  const soundModels = useMemo(
    () => (musicSession.models ?? []).filter((m) => m.category !== "voice" && isReady(m)),
    [musicSession.models],
  );
  // Same gate as the Library's SoundCard: only offer an edit the loaded
  // catalogue can actually run (ACE-Step; MiniMax Music 3 cannot).
  const canExtendSound = useMemo(
    () => soundModels.some((m) => m.task === "gen" && m.supports.extend),
    [soundModels],
  );
  const canCoverSound = useMemo(
    () => soundModels.some((m) => m.task === "gen" && m.supports.cover),
    [soundModels],
  );
  /** The model a cover would actually run on, picked the same way `startEdit`
   *  picks one — loaded first, then merely installed. Named here because the
   *  MIDI panel submits a cover without going through the composer, and a
   *  submission has to name a model that can run the edit it asks for. */
  const coverModel = useMemo(
    () =>
      soundModels.find((m) => m.task === "gen" && m.supports.cover && m.status === "loaded") ??
      soundModels.find((m) => m.task === "gen" && m.supports.cover) ??
      null,
    [soundModels],
  );
  const canRepaintSound = useMemo(
    () => soundModels.some((m) => m.task === "gen" && m.supports.repaint),
    [soundModels],
  );
  // The session can arrive here holding a voice model (left over from the
  // script side, or from /app) — jump it to a sound model the moment there is
  // one, same reasoning as the Music studio's own effect.
  useEffect(() => {
    if (!soundModels.length) return;
    if (musicSession.model && musicSession.model.category !== "voice") return;
    const preferred = preferredModel(soundModels)!;
    musicSession.patch({
      modelId: preferred.id,
      duration: clampDuration(preferred.defaults.duration_s, preferred),
      steps: preferred.defaults.steps ?? null,
      cfg: preferred.defaults.cfg ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the model list or the selected model should retrigger this, not every settings patch
  }, [soundModels, musicSession.model]);

  /**
   * Submit, and drop the result straight onto the timeline once it resolves
   * — at the playhead if the story is playing, at the selected clip's own
   * position if one is selected and the transport is stopped, otherwise at
   * the very start. Landing on whichever lane is already in focus
   * (`rackLane`) means the prompt never has to ask "which track" on top of
   * "what sound" — it goes where you were already looking.
   */
  const insertSubmit = (): void => {
    if (!musicSession.canSubmit) return;
    musicSession.submitWith(undefined, { insert: insertTarget() });
  };

  /** Where a submission from this studio should land, captured now because
   *  the playhead and the selection move while the job runs. It rides on the
   *  turn itself (see `TurnInsert`), so a second submission cannot overwrite
   *  the first's, and a studio that remounts mid-job still places it.
   *
   *  `target` is for a submission that already knows where it belongs — the
   *  MIDI panel's cover has to land beside the dry take it was rendered from,
   *  not wherever the selection happens to be by the time it resolves.
   *
   *  A cover's `durationS` follows its *source*, and has a floor. Measured
   *  against ACE-Step 1.5 turbo: a 2.5s source came back at 5.12s whether
   *  `--duration-seconds` asked for 2.5, 4, 6 or 10, while sources above it
   *  track closely (7.70s gave 7.68s). So a phrase drawn in the roll comes
   *  back longer than the take; the extra is silence at the tail, and
   *  trimming the clip to the take's length keeps the lanes lined up. The
   *  audio past the trim stays on disk — drag the clip's edge to get it. */
  const insertTarget = (target?: {
    startS: number;
    trackIndex: number;
    durationS?: number;
  }): TurnInsert => ({
    storyId,
    startS:
      target?.startS ??
      (playing ? useTransportStore.getState().at : (selected?.start_s ?? 0)),
    trackIndex: target?.trackIndex ?? rackLane,
    durationS: target?.durationS,
  });

  /**
   * The same insert, driven by something other than the form — the chat's
   * "Generate" button, or a `generate_clip` action. Goes through `submitWith`
   * rather than patch-then-submit, which would silently render the *previous*
   * prompt (see the hook).
   */
  const insertGenerate = (
    overrides: Partial<ComposerSettings>,
    target?: { startS: number; trackIndex: number; durationS?: number },
  ): void => {
    musicSession.submitWith(overrides, { insert: insertTarget(target) });
  };

  /**
   * A rendered take, onto the timeline.
   *
   * Shared by the MIDI panel and the piano roll, because both of them can
   * finish a take and neither should be a dead end. It is the microphone's
   * path — upload, then a clip — because the export reads clips off disk, so
   * a take that existed only in the browser could be arranged and then vanish
   * from its own mixdown.
   */
  const placeTake = async (
    wav: Blob,
    name: string,
    cover: CoverRequest | null,
  ): Promise<void> => {
    try {
      // Both clips land at the same start, on two adjacent lanes: the dry take
      // and what the model made of it are the same performance, and stacking
      // them is what lets you solo between the two.
      const startS = Math.round(useTransportStore.getState().at * 1000) / 1000;
      const lane = nextFreeTrack(lines);
      const sound = await api.uploadSound(name, wav, "midi");
      addClip("place take", {
        sound_id: sound.id,
        speaker: sound.name,
        start_s: startS,
        track_index: lane,
      });
      void qc.invalidateQueries({ queryKey: ["sounds"] });

      if (cover === null || coverModel === null) {
        toast.success("Placed on a new track — right-click it to Cover.");
        return;
      }
      // The composer's own cover, submitted without it: same request, same
      // insert path, so the turn shows up in History and the result lands on a
      // lane exactly as a prompted generation does.
      insertGenerate(
        {
          modelId: coverModel.id,
          prompt: cover.prompt,
          edit: "cover",
          sourceSound: sound,
          editOptions: { cover_strength: cover.strength },
          duration: sound.duration_s,
          variations: 1,
        },
        { startS, trackIndex: lane + 1, durationS: sound.duration_s },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That take could not be saved");
    }
  };

  // Clips this studio has asked the server for but not yet seen come back,
  // so two results settling close together don't both pick the same "free"
  // spot from a segment list that has neither of them yet.
  const landingRef = useRef<{ track_index: number; start_s: number; duration_s: number }[]>([]);

  // Place every turn aimed at this story once it settles. Claimed in the
  // store before anything else happens, so a re-render (or a second studio
  // for the same story) cannot place it twice.
  useEffect(() => {
    for (const turn of musicSession.turns) {
      const insert = turn.insert;
      if (!insert || insert.placed || insert.storyId !== storyId) continue;
      if (turn.status === "pending") continue;
      useSessionStore.getState().patchTurn(turn.id, { insert: { ...insert, placed: true } });

      if (turn.status === "done" || turn.status === "error") {
        // Recorded once it has settled, and from both sides: the prompt is
        // what was asked for, the sounds are what came of it, and the job id
        // is the thread across to the logs if it went wrong.
        recordRef.current.mutate([
          { role: "user", content: turn.request.prompt },
          {
            role: "assistant",
            content: turn.status === "error" ? (turn.error ?? "Generation failed.") : "",
            sound_ids: turn.sounds.map((s) => s.id),
            job_id: turn.jobId,
          },
        ]);
      }
      if (turn.status !== "done" || turn.sounds.length === 0) continue;

      // A prompt that asked to be split comes back as the parts of one take,
      // and each part wants a lane of its own — that is the whole point of
      // asking. Variations are alternatives rather than parts, so those still
      // insert one and leave the others in the shelf to be dragged in.
      const parts = turn.request.separate ? turn.sounds : turn.sounds.slice(0, 1);
      const occupied = [
        ...(segments.data ?? []).map((seg) => ({
          track_index: seg.track_index,
          start_s: seg.start_s,
          duration_s: seg.duration_s ?? 0,
        })),
        ...landingRef.current,
      ];
      parts.forEach((sound, i) => {
        // Only the first part is trimmed to the asked-for length: the others
        // are stems or variations of it, not the same span of time. Clamped
        // to what the render actually contains, because a long take comes
        // back a hair *short* — 7.70s covers to 7.68s — and a clip asking
        // for 20ms that is not there is a clip with a gap at the end.
        const length =
          insert.durationS !== undefined && i === 0
            ? Math.min(insert.durationS, sound.duration_s)
            : sound.duration_s;
        // The lane you were looking at, if the take fits there; otherwise
        // a lane of its own. New audio never lands on top of old audio —
        // see `nextFreeTrack` — and two quick generations at the same
        // playhead would otherwise crossfade into each other.
        const wanted = i === 0 ? insert.trackIndex : nextFreeTrack(occupied);
        const lane = Math.min(
          16,
          laneIsFree(occupied, wanted, insert.startS, length) ? wanted : nextFreeTrack(occupied),
        );
        const landing = { track_index: lane, start_s: insert.startS, duration_s: length };
        occupied.push(landing);
        landingRef.current.push(landing);
        createSegment
          .mutateAsync({
            sound_id: sound.id,
            // Its name, so the clip says what it is rather than "Empty line".
            speaker: sound.name,
            start_s: insert.startS,
            track_index: lane,
            ...(length !== sound.duration_s ? { duration_s: length } : {}),
          })
          .catch(() => undefined) // the mutation's own toast says what went wrong
          .finally(() => {
            landingRef.current = landingRef.current.filter((l) => l !== landing);
          });
      });
    }
  }, [musicSession.turns, storyId, createSegment, segments.data]);

  /**
   * The clips being generated for this story, drawn on the lanes they will
   * land on while their jobs run — see `PendingClip`. One per turn, labelled
   * with what that turn actually asked for rather than whatever the composer
   * holds now.
   */
  const pendingClips: PendingClip[] = musicSession.turns.flatMap((turn) => {
    const insert = turn.insert;
    if (!insert || insert.storyId !== storyId || turn.status !== "pending") return [];
    const job = turn.jobId ? musicSession.jobs[turn.jobId] : undefined;
    return [
      {
        id: `pending-${turn.id}`,
        track_index: insert.trackIndex,
        start_s: insert.startS,
        duration_s: insert.durationS ?? turn.request.duration_s ?? musicSession.settings.duration,
        label: turn.request.prompt,
        progress: job?.progress ?? 0,
        phase: job ? (PHASE_LABEL[job.phase] ?? job.phase) : null,
      },
    ];
  });

  const lines = segments.data ?? [];
  // The newest arrangement, for undo/redo steps that run long after the
  // render that recorded them — `lines` in their closure is that render's.
  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  /* Only for the delivery knobs and the labels beside them, which are a
     model's own vocabulary: the selected line's family, or the first one
     cast, so an untouched script still has knobs to show. */
  const scriptModel = useMemo(() => {
    const cast =
      (segments.data ?? []).find((l) => l.id === selectedId)?.voice_id ??
      (segments.data ?? []).find((l) => l.voice_id)?.voice_id ??
      null;
    const id = cast
      ? (usableVoices.find((v) => v.id === cast)?.model_id ?? ttsModels[0]?.id)
      : ttsModels[0]?.id;
    return ttsModels.find((m) => m.id === id);
  }, [segments.data, selectedId, usableVoices, ttsModels]);
  const selected = lines.find((s) => s.id === selectedId) ?? null;

  /**
   * Which of the three columns have anything in them.
   *
   * A column with nothing left in it is not rendered, rather than rendered
   * empty: close the script and the timeline simply moves left into the space,
   * which is what closing a panel is *for*.
   *
   * Devices are not in here: they live under the timeline in the middle
   * column, because they belong to a track and tracks are a thing the timeline
   * has. Closing them changes the middle column's contents, never the page's
   * shape.
   *
   * Script and Prompt share the left column rather than taking turns in it.
   * They were once mutually exclusive — a story with words got the script, a
   * story of bare clips got the prompt, and neither could reach the other.
   * But the two are not alternatives: a scripted piece is exactly the sort of
   * thing you drop a generated bed under. In the Script Builder both are
   * here, and only one of them opens; in the Music Builder there is no script
   * to open, so `scriptOpen` is false forever and the column is the Prompt
   * panel and the chat.
   */
  const scriptAvailable = builder === "script";
  const historyCount = useHistoryCount(storyId);
  /** Everything that happens in this studio, recorded in order. Lazy — the
   *  conversation is created by the first thing written to it. */
  const recordHistory = useAppendHistory(storyId);
  /** The mutation object is a new value every render, so an effect that
   *  depended on it would re-run constantly. Held by ref, like the session's
   *  own `submitRef`, so effects can call the latest without watching it. */
  const recordRef = useRef(recordHistory);
  recordRef.current = recordHistory;
  // "Open" below means open *on this page*: a panel in a window of its own
  // leaves its column just as a closed one does.
  const chatOpen = assistantEnabled && inPage("chat");
  const timelineOpen = inPage("timeline");
  const scriptOpen = scriptAvailable && inPage("script");
  const insertOpen = inPage("insert");
  /** The column you ask in: the conversation and the request form. */
  const leftOpen = chatOpen || insertOpen;
  /**
   * The left column's tabs, and which one is in front.
   *
   * Derived rather than stored, so the two cannot disagree. `leftTab` is
   * where the *intent* lives — the tab you last picked — and this is what
   * that means given what is actually open: close the Prompt while it is in
   * front and the chat comes forward on its own, without a second piece of
   * state to keep in step.
   */
  const leftTabs = (["chat", "insert"] as const)
    .filter((id) => (id === "chat" ? chatOpen : insertOpen))
    .map((id) => ({
      id,
      label: id === "chat" ? "Chat" : "Prompt",
      icon: panelIcon(id),
    }));
  const activeLeftTab: "chat" | "insert" =
    leftTabs.some((t) => t.id === leftTab) ? leftTab : insertOpen ? "insert" : "chat";
  /**
   * The column the work is in.
   *
   * Any one of the three keeps it, which is the fix for the studio's worst
   * layout bug: this used to be `timelineOpen` alone, so closing the timeline
   * took the script and the device rack off the screen with it — the script
   * because it was not in this column yet, the rack because it is. Shutting
   * the timeline to make room for the script did the opposite.
   */
  const centreOpen =
    scriptOpen || timelineOpen || ["devices", "midi", "roll"].some((id) => inPage(id));
  const panelsOpen = ["library", "sample", "history", "logs"].some((id) => inPage(id));
  /**
   * Nothing open but the conversation.
   *
   * Drawn as a centred column rather than a lone panel in a three-column
   * frame: a card with a header and a close button, floating in an otherwise
   * empty studio, reads as the last survivor of a layout rather than the
   * thing you came here to do. Open anything else and it goes back to being
   * a panel among panels.
   */
  const soloChat = chatOpen && !insertOpen && !centreOpen && !panelsOpen;

  /**
   * The timeline as the command bar needs to see it.
   *
   * Built on demand rather than held in state: the playhead and the selection
   * move constantly, and a snapshot taken any earlier would describe an
   * arrangement the user has since changed out from under it.
   *
   * `label` is what makes "the vocal" resolvable — the line's words if it has
   * any, otherwise the sound's name, which for a generated clip is the prompt
   * that made it.
   */
  const studioContext = (): StudioContext => ({
    tracks: lanes.map((lane) => {
      const track = tracks.data?.find((t) => t.track_index === lane);
      return {
        track_index: lane,
        name: track?.name ?? null,
        muted: track?.muted ?? false,
        soloed: track?.soloed ?? false,
      };
    }),
    clips: lines.map((line) => ({
      id: line.id,
      track_index: line.track_index,
      start_s: line.start_s,
      duration_s: line.duration_s ?? 0,
      label: line.text.trim() || line.sound?.name || "",
    })),
    playhead_s: useTransportStore.getState().at,
    selected_ids: selectedIds,
    // What the assistant may cast a written line to. Sent every time rather
    // than once, because a voice cloned mid-conversation should be castable
    // in the next sentence.
    voices: (voices.data ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      kind: v.kind,
      notes: v.notes ?? null,
    })),
  });

  /**
   * Run a plan the user approved.
   *
   * Every action goes through the handler a click would have used, which is
   * the point: those mutations are already optimistic, already invalidate the
   * right queries, and already push onto the undo stack. An agentic edit is
   * therefore undoable exactly like a manual one, and there is no second code
   * path to drift from the first.
   */
  const applyStudioActions = (actions: StudioAction[], summary: string): void => {
    for (const action of actions) {
      switch (action.type) {
        case "rename_track":
          editTrack(action.track_index, { name: action.name });
          break;
        case "set_track":
          editTrack(action.track_index, {
            ...(action.muted !== undefined ? { muted: action.muted } : {}),
            ...(action.soloed !== undefined ? { soloed: action.soloed } : {}),
            ...(action.gain_db !== undefined ? { gain_db: action.gain_db } : {}),
          });
          break;
        case "move_clip": {
          const clip = lines.find((l) => l.id === action.clip_id);
          if (!clip) break;
          // Through `move` so it lands on the undo stack as one edit,
          // exactly as dragging the clip would have.
          move([
            {
              id: action.clip_id,
              patch: {
                start_s: action.start_s ?? clip.start_s,
                track_index: action.track_index ?? clip.track_index,
              },
            },
          ]);
          break;
        }
        case "add_lines": {
          // Written in order and appended, with no `start_s`: a spoken line
          // is as long as its audio, which does not exist yet, so the server
          // places each one after the last exactly as it does for a line
          // typed into the script.
          void addClips(
            "add",
            action.lines.map((line) => ({
              text: line.text,
              kind: line.kind ?? "line",
              ...(line.speaker ? { speaker: line.speaker } : {}),
              ...(line.voice_id ? { voice_id: line.voice_id } : {}),
              ...(line.duration_s !== undefined ? { duration_s: line.duration_s } : {}),
              ...(line.track_index !== undefined ? { track_index: line.track_index } : {}),
            })),
          );
          break;
        }
        case "speak_lines":
          // Through the same per-line read a click on the script's play
          // button uses, so each line gets the generating outline and lands
          // in the same place.
          //
          // Pauses are skipped here rather than in the planner: a beat of
          // silence has no words to read, and the server does not know which
          // clips are pauses — `StudioContext` carries labels and times, not
          // kinds. "Read the scene" spans both, so the filter has to live
          // where the segments do.
          for (const id of action.clip_ids) {
            const line = lines.find((l) => l.id === id);
            if (!line || line.kind === "pause" || !line.text.trim()) continue;
            speakLine(id);
          }
          break;
        case "set_clip":
          // Every field here is one `SegmentPatch` already accepts, and the
          // export mixdown already honours — clip gain is summed with the
          // track's, both fades are applied. Asking for them is the only
          // part that was missing.
          editClip("edit clip", action.clip_id, {
            ...(action.muted !== undefined ? { muted: action.muted } : {}),
            ...(action.text !== undefined ? { text: action.text } : {}),
            ...(action.speaker !== undefined ? { speaker: action.speaker } : {}),
            ...(action.voice_id !== undefined ? { voice_id: action.voice_id } : {}),
            ...(action.gain_db !== undefined ? { gain_db: action.gain_db } : {}),
            ...(action.fade_in_s !== undefined ? { fade_in_s: action.fade_in_s } : {}),
            ...(action.fade_out_s !== undefined ? { fade_out_s: action.fade_out_s } : {}),
            ...(action.duration_s !== undefined ? { duration_s: action.duration_s } : {}),
            ...(action.trim_start_s !== undefined ? { trim_start_s: action.trim_start_s } : {}),
          });
          break;
        case "delete_clip":
          removeLine(action.clip_id);
          break;
        case "add_clip":
          addClip("add clip", {
            start_s: action.start_s,
            track_index: action.track_index,
            text: action.text,
          });
          break;
        case "add_device":
        case "remove_device": {
          // Straight onto the same per-lane rack the cards write to, so an
          // effect added by asking is indistinguishable from one added by
          // clicking — including where it sits in the chain. `getLane`, not
          // the render's `devices`: a plan that adds an EQ and then sets it
          // has to see the EQ it added a line ago.
          const rack = getLane(action.track_index);
          setLane(
            action.track_index,
            action.type === "add_device"
              ? [...rack, createDevice(action.kind as DeviceKind)]
              : rack.filter((d) => d.kind !== action.kind),
          );
          break;
        }
        case "set_device": {
          // Clamped here rather than on the server: `devices.ts` owns each
          // knob's range and is what builds the rack, so a value the model
          // over-reached on lands at the end of the real slider instead of
          // being dropped.
          const rack = getLane(action.track_index);
          setLane(
            action.track_index,
            rack.map((d) =>
              d.kind === action.kind
                ? { ...d, params: clampDeviceParams(d.kind, { ...d.params, ...action.params }) }
                : d,
            ),
          );
          break;
        }
        case "generate_clip":
          // Through the prompt panel's own submit path, so the take lands on
          // the timeline by the same route a typed prompt would take and
          // shows up in the history beside it. `submitWith` rather than
          // patch-then-submit: the latter renders the previous prompt.
          insertGenerate(
            { prompt: action.prompt },
            { startS: action.start_s, trackIndex: action.track_index },
          );
          break;
        case "show_panel":
          showPanel(action.panel, action.open);
          break;
        case "start_recording":
          setRecordRequest((n) => n + 1);
          break;
      }
    }
    // Show the work. An edit applied to a panel nobody has open is
    // indistinguishable from one that did not happen — the reply says four
    // lines were written and the screen shows a timeline. The first action
    // decides, since a plan is nearly always about one thing.
    const target = actions.map(panelForAction).find((id): id is string => id !== null);
    if (target) showPanel(target, true);
    // Into the history, in the same words the preview used. `describeAction`
    // resolves ids against the timeline as it was *then*, which is the whole
    // reason the record stores sentences rather than the actions themselves:
    // "Rename track 0 to Kick" stays true after the clip it named is gone.
    const ctx = studioContext();
    recordHistory.mutate([
      {
        role: "assistant",
        content: summary || "",
        actions: actions.map((a) => describeAction(a, ctx)),
      },
    ]);
    toast.success(summary || `Applied ${actions.length} edits`);
  };

  /**
   * Lend the command bar's two halves to the chat for as long as this studio
   * is mounted beside it (see `lib/studio-bridge.ts`). Both closures are
   * rebuilt every render, so the loan goes through a ref and is made once:
   * re-lending on each render would churn the store for nothing.
   */
  const bridgeRef = useRef({
    context: studioContext,
    apply: applyStudioActions,
    showPanel,
  });
  bridgeRef.current = { context: studioContext, apply: applyStudioActions, showPanel };
  const lendStudio = useStudioBridge((s) => s.lend);
  const reclaimStudio = useStudioBridge((s) => s.reclaim);
  useEffect(() => {
    lendStudio({
      storyId,
      context: () => bridgeRef.current.context(),
      apply: (actions, summary) => bridgeRef.current.apply(actions, summary),
      showPanel: (id) => bridgeRef.current.showPanel(id, true),
    });
    return () => reclaimStudio(storyId);
  }, [storyId, lendStudio, reclaimStudio]);

  /**
   * A panel to open and put the cursor in, once React has drawn it.
   *
   * Held as the panel's label rather than a ref because the field being
   * focused belongs to a shared component — the prompt form and the library
   * pane are both used on other pages — and threading an `autoFocus` prop
   * through either would make every other caller think about a concern only
   * this one has. `ArtifactStack` already labels each panel's `<section>`,
   * so that label is a stable handle to the panel from out here.
   */
  const [focusPanel, setFocusPanel] = useState<string | null>(null);
  useEffect(() => {
    if (focusPanel === null) return;
    // One frame, so the panel that was just un-hidden exists to be found.
    // In whichever window the panel is in.
    const id = panels.find((p) => p.label === focusPanel)?.id;
    const doc = (id !== undefined ? popped.get(id)?.document : undefined) ?? document;
    const frame = requestAnimationFrame(() => {
      doc
        .querySelector<HTMLElement>(
          `section[aria-label="${focusPanel}"] textarea, section[aria-label="${focusPanel}"] input`,
        )
        ?.focus();
      setFocusPanel(null);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per request
  }, [focusPanel]);

  /** Open a panel and land the cursor in whatever it is you type into. */
  const openPanelFocused = (id: string): void => {
    showPanel(id, true);
    setFocusPanel(panels.find((p) => p.id === id)?.label ?? null);
  };

  const panelCommands: Command[] = panels.map((panel) => ({
    id: panel.id,
    label: panel.label,
    hint: ["mod", panel.key.toUpperCase()],
    // An unavailable panel is not "on", whatever `closedPanels` happens to
    // say about it — a tick beside a row you cannot choose is just confusing.
    active: !closedPanels.has(panel.id),
    run: () => showPanel(panel.id, closedPanels.has(panel.id)),
  }));

  /**
   * The panel shortcuts, and the palette's own.
   *
   * Bound on `window` rather than on the studio's root because the thing you
   * want when reaching for a panel is usually not focused — you are in the
   * timeline, or the script, or nothing at all. The exception is typing: a
   * shortcut that fires while you are writing a line would toggle a panel
   * instead of producing the letter, so text fields are left alone.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      const panel = panels.find((p) => p.key === key);
      if (!panel) return;
      event.preventDefault();
      showPanel(panel.id, closedPanels.has(panel.id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The rack shows the track you are working on. Selecting a clip is already
  // how you say "this one" here, so it does not need a second gesture — and
  // the lane buttons are still there when you want a track with no clip on it.
  useEffect(() => {
    if (selected) setRackLane(selected.track_index);
  }, [selected]);

  /**
   * Reads in flight, by line id.
   *
   * Each card used to own its own job stream; a row is too small to hold one,
   * and several lines can be read at once, so the page keeps the set and the
   * rows just ask whether they are in it.
   */
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const generateSegment = useGenerateSegment(storyId);
  const speakLine = (id: string): void => {
    const voiceId = lines.find((l) => l.id === id)?.voice_id;
    const model = modelForVoice(voiceId);
    if (!model) {
      toast.error("No text-to-speech model is installed.");
      return;
    }
    // A voice is read on the model it was made on; when that model is gone the
    // line still gets read, on another, and the clone may not sound like
    // itself. Say so rather than let the take be quietly wrong.
    const cast = voiceId ? voices.data?.find((v) => v.id === voiceId) : undefined;
    if (cast?.model_id && cast.model_id !== model) {
      toast.warning(
        `${cast.name} was made on ${modelLabel(cast.model_id)}, which is not installed — ` +
          `reading on ${modelLabel(model)} instead.`,
      );
    }
    setGeneratingIds((prev) => new Set(prev).add(id));
    const done = (): void =>
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

    // `mutateAsync`, not `mutate` with callbacks: react-query keeps only the
    // latest call's callbacks per hook, so when the chat reads a whole scene
    // in one loop every line but the last was left "reading" forever.
    // The mutation settles when the job is *queued*, not when the line has
    // been read; following the job is what makes "this line is being read"
    // last as long as the reading does.
    generateSegment.mutateAsync({ id, req: { model } }).then(
      ({ job_id }) =>
        followJob(job_id, {
          done: () => {
            done();
            void qc.invalidateQueries({ queryKey: qk.segments(storyId) });
            void qc.invalidateQueries({ queryKey: ["sounds"] });
          },
          failed: (message, job) => {
            done();
            if (job?.status !== "cancelled") toast.error(message || "The read failed");
          },
        }),
      done,
    );
  };
  const generated = lines.filter((s) => s.sound_id).length;

  /* --------------------------------------------------------------- actions */

  // Every edit below records its undo step only once the server has taken the
  // write (see `EditHistory.push`), and acts on ids through `history.resolve`
  // when it runs, because an undone delete or add brings a clip back under a
  // new id.

  /**
   * Put clips on the timeline, as one edit.
   *
   * One at a time and in order rather than all at once: the server appends
   * each to the script as it arrives, and a batch fired together would be
   * read in whatever order the requests happened to land. Undo deletes them;
   * redo puts the same clips back — same sound, trim and place — under new
   * ids, which every older step is told about.
   */
  const addClips = async (label: string, reqs: SegmentCreate[]): Promise<StorySegment[]> => {
    const created: StorySegment[] = [];
    for (const req of reqs) {
      try {
        created.push(await createSegment.mutateAsync(req));
      } catch {
        // the mutation's own toast says what went wrong
      }
    }
    if (created.length > 0) {
      history.push({
        label: created.length > 1 ? `${label} ${created.length} clips` : label,
        undo: () => created.forEach((clip) => deleteSegment.mutate(history.resolve(clip.id))),
        redo: () => {
          void (async () => {
            for (const clip of created) {
              try {
                const again = await createSegment.mutateAsync(restorable(clip));
                history.remap(history.resolve(clip.id), again.id);
              } catch {
                // the mutation's own toast says what went wrong
              }
            }
          })();
        },
      });
    }
    return created;
  };
  const addClip = (label: string, req: SegmentCreate): void => void addClips(label, [req]);

  /**
   * Change some of a clip's fields — a fade, its gain, a trim, mute — as one
   * edit. What they were is read off the clip as it stands, so the inverse is
   * exactly the fields this touched and nothing an edit since has changed.
   */
  const editClip = (label: string, id: string, patch: SegmentPatch): void => {
    const before = lines.find((l) => l.id === id);
    updateSegment.mutateAsync({ id, patch }).then(
      () => {
        if (!before) return;
        const fields = Object.keys(patch) as (keyof SegmentPatch)[];
        // A cleared length reads back as null, which a patch cannot send;
        // leaving it out keeps whatever the clip has instead.
        const previous = Object.fromEntries(
          fields.map((field) => [field, before[field] ?? undefined]),
        ) as SegmentPatch;
        if (fields.every((field) => previous[field] === patch[field])) return;
        const write = (to: SegmentPatch) => () =>
          updateSegment.mutate({ id: history.resolve(id), patch: to });
        history.push({ label, undo: write(previous), redo: write(patch) });
      },
      () => undefined, // the mutation's own toast says what went wrong
    );
  };

  /**
   * A track's name, mute, solo or volume, as one edit. Lanes are numbers
   * rather than rows the server hands out, so nothing here needs resolving.
   * A volume drag is one step however many writes it took — see `merge`.
   */
  const editTrack = (trackIndex: number, patch: MixPatch): void => {
    const row = tracks.data?.find((t) => t.track_index === trackIndex);
    // A lane with no row is at its defaults.
    const was: Required<MixPatch> = {
      name: row?.name ?? null,
      muted: row?.muted ?? false,
      soloed: row?.soloed ?? false,
      gain_db: row?.gain_db ?? 0,
    };
    const fields = Object.keys(patch) as (keyof MixPatch)[];
    const previous = Object.fromEntries(fields.map((field) => [field, was[field]])) as MixPatch;
    const label =
      patch.name !== undefined
        ? "rename track"
        : patch.muted !== undefined
          ? patch.muted
            ? "mute track"
            : "unmute track"
          : patch.soloed !== undefined
            ? patch.soloed
              ? "solo track"
              : "unsolo track"
            : "track volume";
    updateTrack.mutateAsync({ trackIndex, patch }).then(
      () => {
        if (fields.every((field) => previous[field] === patch[field])) return;
        const write = (to: MixPatch) => () => updateTrack.mutate({ trackIndex, patch: to });
        history.push({
          label,
          undo: write(previous),
          redo: write(patch),
          ...(fields.length === 1 && patch.gain_db !== undefined
            ? { merge: `track-gain-${trackIndex}` }
            : {}),
        });
      },
      () => undefined, // the mutation's own toast says what went wrong
    );
  };

  /**
   * Commit a drag — one clip or a whole selection, as a single edit.
   *
   * Taking the list rather than being called once per clip is what makes a
   * group drag one thing rather than several: a call per clip is an undo
   * entry per clip, so undoing a five-clip drag put them back one at a time,
   * four of them still moved and the arrangement in a state nobody had ever
   * chosen.
   *
   * The script follows on its own. The order things happen in *is* the order
   * they are read in, so the server re-slots a line whenever its clip moves —
   * and the segment cache does the same in the frame the clip lands — which
   * is also what puts the line back when the move is undone.
   */
  const move = (moves: ClipMove[]): void => {
    if (moves.length === 0) return;

    const previous = moves.flatMap(({ id }) => {
      const before = lines.find((l) => l.id === id);
      return before
        ? [{ id, patch: { start_s: before.start_s, track_index: before.track_index } }]
        : [];
    });
    void applyMoves(moves).then((landed) => {
      // Only the clips the server actually moved: undoing one that bounced
      // would put it somewhere it already is.
      const undoable = previous.filter((m) => landed.has(m.id));
      if (undoable.length === 0) return;
      const redoable = moves.filter((m) => landed.has(m.id));
      const resolved = (list: ClipMove[]) => list.map((m) => ({ ...m, id: history.resolve(m.id) }));
      history.push({
        label: undoable.length > 1 ? `move ${undoable.length} clips` : "move",
        undo: () => void applyMoves(resolved(undoable)),
        redo: () => void applyMoves(resolved(redoable)),
      });
    });
  };

  /** The ids the server took. */
  const applyMoves = async (moves: ClipMove[]): Promise<Set<string>> => {
    const results = await Promise.allSettled(moves.map((m) => updateSegment.mutateAsync(m)));
    return new Set(moves.filter((_, i) => results[i]?.status === "fulfilled").map((m) => m.id));
  };

  /**
   * Delete a line, remembering enough to put it back.
   *
   * Restoring creates a new row rather than resurrecting the old one — ids are
   * the server's to hand out — so undo restores the *content* and its place,
   * which is what anyone means by it. The recreated id is captured so a
   * subsequent redo knows what to delete.
   */
  const removeLines = (ids: string[]): void => {
    // In reading order, so putting them back one by one at their old
    // positions rebuilds the order they were in.
    const doomed = ids
      .map((id) => lines.find((l) => l.id === id))
      .filter((l): l is StorySegment => l !== undefined)
      .sort((a, b) => a.position - b.position);
    void Promise.allSettled(ids.map((id) => deleteSegment.mutateAsync(id))).then((results) => {
      const deleted = new Set(ids.filter((_, i) => results[i]?.status === "fulfilled"));
      const gone = doomed.filter((segment) => deleted.has(segment.id));
      if (gone.length === 0) return;

      // One step for the whole selection: deleting five clips and having to
      // press undo five times to get them back is five chances to stop half way.
      history.push({
        label: gone.length > 1 ? `delete ${gone.length} clips` : "delete",
        undo: () => {
          void (async () => {
            for (const segment of gone) {
              try {
                const created = await createSegment.mutateAsync(restorable(segment));
                history.remap(history.resolve(segment.id), created.id);
              } catch {
                // the mutation's own toast says what went wrong
              }
            }
          })();
        },
        redo: () => gone.forEach((segment) => deleteSegment.mutate(history.resolve(segment.id))),
      });
    });
  };
  const removeLine = (id: string): void => removeLines([id]);

  const duplicate = (originals: StorySegment[]): void => {
    // Land each copy right after its original in both views, which is where
    // you meant to put it if you are duplicating at all.
    // The whole clip, audio and all: a duplicate that dropped the sound gave
    // you an empty "line" where a copy of the music should have been.
    void addClips(
      "duplicate",
      originals.map((segment) => ({
        ...restorable(segment),
        position: segment.position + 1,
        start_s: segment.start_s + (segment.duration_s ?? 0),
      })),
    );
  };

  /**
   * Cut clips in two at a point inside each, as one edit.
   *
   * The server renders both halves as new sounds and keeps the first half on
   * the original clip. Undo is the reverse without re-rendering anything: the
   * tail goes and the head is pointed back at the whole take, trimmed and
   * faded as it was. Redo reuses the
   * halves the first cut made rather than cutting again, which would leave
   * another pair of derived sounds in the library every time.
   */
  const split = (cuts: { id: string; atS: number }[]): void => {
    if (cuts.length === 0) return;
    void Promise.allSettled(
      cuts.map(async ({ id, atS }) => {
        const before = lines.find((l) => l.id === id);
        const [head, tail] = await splitSegment.mutateAsync({ id, atS });
        return before && head && tail ? { before, head, tail } : null;
      }),
    ).then((results) => {
      const done = results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
      if (done.length === 0) return;
      // Which take the clip plays, how much of it, and from where. The split
      // moves the trim and the fade out too: the head's new take starts at
      // the old in-point, and the fade out went to the tail.
      const point = (id: string, at: StorySegment): void =>
        updateSegment.mutate({
          id: history.resolve(id),
          patch: {
            sound_id: at.sound_id ?? null,
            duration_s: at.duration_s ?? undefined,
            trim_start_s: at.trim_start_s,
            fade_out_s: at.fade_out_s,
          },
        });
      history.push({
        label: done.length > 1 ? `split ${done.length} clips` : "split",
        undo: () =>
          done.forEach(({ before, tail }) => {
            deleteSegment.mutate(history.resolve(tail.id));
            point(before.id, before);
          }),
        redo: () =>
          done.forEach(({ before, head, tail }) => {
            point(before.id, head);
            createSegment.mutateAsync(restorable(tail)).then(
              (again) => history.remap(history.resolve(tail.id), again.id),
              () => undefined, // the mutation's own toast says what went wrong
            );
          }),
      });
    });
  };

  /**
   * Split a clip into its stems, in place.
   *
   * The clip is replaced by what it is made of: a lane per stem, all starting
   * where it started, and the clip itself removed — the parts *are* the take,
   * so leaving both would play everything twice. What happens to the stems
   * that were not picked is the dialog's other question, and the answer that
   * keeps them ("merge") comes back as one more lane rather than as silence.
   *
   * The whole thing is one entry on the undo stack, which is the only way it
   * can be undone honestly: putting the clip back without taking the lanes
   * away would double the audio, exactly the state this avoids on the way in.
   */
  /**
   * Repaint part of a clip, in place.
   *
   * The clip does not move and is not replaced: the render comes back the
   * same length as the sound it was made from, so the arrangement only has to
   * be pointed at the new take. That is the whole reason this is worth having
   * on the timeline — a repaint you have to re-place and re-trim is not
   * meaningfully different from generating something new.
   *
   * Undo puts the old sound back rather than deleting the new one. The take
   * that was replaced is still a sound in the library either way, and losing
   * a render because you wanted to hear the old one again would be the worse
   * surprise.
   */
  const repaintClip = (
    segment: StorySegment,
    window: { start_s: number; end_s: number },
    options: RepaintOptions,
  ): void => {
    const previousSoundId = segment.sound_id;
    if (!previousSoundId || generatingIds.has(segment.id)) return;

    // Two kinds of "this is happening", because one is not enough: the clip
    // itself wears the same generating outline a line being read wears, and a
    // toast carries the phase — a cold ACE-Step spends its first minutes
    // loading weights, and a timeline that only animates would be claiming to
    // render something it has not started.
    const notice = `repaint-${segment.id}`;
    const span = `${formatDuration(window.start_s)}–${formatDuration(window.end_s)}`;
    setGeneratingIds((live) => new Set(live).add(segment.id));
    const done = (): void =>
      setGeneratingIds((live) => {
        const next = new Set(live);
        next.delete(segment.id);
        return next;
      });
    toast.loading(`Repainting ${span}`, { id: notice, description: "Queued" });

    repaintSound
      .mutateAsync({
        source_sound_id: previousSoundId,
        start_s: window.start_s,
        end_s: window.end_s,
        // Empty means "the same description again", which the server reads
        // off the source — the reroll case, and the common one.
        prompt: options.prompt.trim() || null,
        strength: options.strength,
        mode: options.mode,
      })
      .then(
        ({ job_id }) =>
          followJob(job_id, {
            done: (job) => {
              done();
              void qc.invalidateQueries({ queryKey: ["sounds"] });
              const painted = (job.result?.sounds as string[] | undefined)?.[0];
              toast.dismiss(notice);
              if (!painted) {
                toast.error("The repaint produced nothing");
                return;
              }
              const swap = (soundId: string) => () =>
                updateSegment.mutate({ id: history.resolve(segment.id), patch: { sound_id: soundId } });
              swap(painted)();
              history.push({
                label: "repaint",
                undo: swap(previousSoundId),
                redo: swap(painted),
              });
              toast.success(`Repainted ${span}`);
            },
            failed: (message, job) => {
              done();
              // A cancel is not news — the person who cancelled it knows.
              toast.dismiss(notice);
              if (job?.status !== "cancelled") toast.error(message || "Repaint failed");
            },
            progress: (job) => {
              // Still going: say which of the slow parts it is in, and offer
              // the way out. A render nobody can stop is the reason a long one
              // feels stuck.
              const phase = PHASE_LABEL[job.phase] ?? job.phase;
              const percent = Math.round((job.progress ?? 0) * 100);
              toast.loading(`Repainting ${span}`, {
                id: notice,
                description:
                  job.status === "queued"
                    ? `Queued${job.queue_position ? ` — ${ordinal(job.queue_position)} in line` : ""}`
                    : `${phase}${percent > 0 ? ` · ${percent}%` : ""}`,
                action: { label: "Cancel", onClick: () => void api.cancelJob(job.id) },
              });
            },
          }),
        () => {
          done();
          // The mutation's own toast says what went wrong; this one only has
          // to stop claiming the render is under way.
          toast.dismiss(notice);
        },
      );
  };

  const separateClip = (segment: StorySegment, stems: StemSelection): void => {
    const sepModel = models.data?.find((m) => m.task === "sep");
    if (!sepModel || !segment.sound_id) return;
    setSeparating(true);
    separateSound.mutateAsync({ modelId: sepModel.id, sourceSoundId: segment.sound_id, stems }).then(
      ({ job_id }) =>
        followJob(job_id, {
          done: (job) => {
            setSeparating(false);
            setStemTarget(null);
            void qc.invalidateQueries({ queryKey: ["sounds"] });
            const ids = (job.result?.sounds as string[] | undefined) ?? [];
            if (ids.length === 0) {
              toast.error("The split produced nothing");
              return;
            }

            // Below everything, not on top of it: a stem dropped onto a
            // lane that already has audio would be an arrangement decision
            // nobody made.
            const used = linesRef.current.map((l) => l.track_index);
            const base = Math.max(0, ...used, ...lanes) + 1;
            let originalId = segment.id;
            let stemClipIds: string[] = [];

            // Every stem's id, not just the last one's: with per-call
            // callbacks only the final create reported back, so undo removed
            // one stem and left the rest playing on top of the restored
            // original.
            const layOut = async (): Promise<void> => {
              deleteSegment.mutate(history.resolve(originalId));
              const created = await Promise.allSettled(
                ids.map((soundId, i) =>
                  createSegment.mutateAsync({
                    sound_id: soundId,
                    start_s: segment.start_s,
                    track_index: Math.min(16, base + i),
                  }),
                ),
              );
              stemClipIds = created.flatMap((r) => (r.status === "fulfilled" ? [r.value.id] : []));
            };

            const putBack = async (): Promise<void> => {
              stemClipIds.splice(0).forEach((id) => deleteSegment.mutate(history.resolve(id)));
              try {
                const restored = await createSegment.mutateAsync(restorable(segment));
                history.remap(originalId, restored.id);
                originalId = restored.id;
              } catch {
                // the mutation's own toast says what went wrong
              }
            };

            void layOut();
            history.push({
              label: "split into stems",
              undo: () => void putBack(),
              redo: () => void layOut(),
            });
            toast.success(`Split into ${ids.length} track${ids.length === 1 ? "" : "s"}`);
          },
          failed: (message, job) => {
            setSeparating(false);
            if (job?.status !== "cancelled") toast.error(message || "Stem separation failed");
          },
        }),
      () => setSeparating(false),
    );
  };

  const runExport = (): void => {
    exportStory.mutate(undefined, { onSuccess: (ref) => setExportJobId(ref.job_id) });
  };

  const qc = useQueryClient();
  const exportStatus = exportJob.job?.status;
  useEffect(() => {
    if (exportStatus !== "done") return;
    toast.success("Story exported to the library");
    void qc.invalidateQueries({ queryKey: ["sounds"] });
  }, [exportStatus, qc]);

  if (story.isLoading) {
    return <div className="flex-1 p-4"><Skeleton className="h-full rounded-xl" /></div>;
  }
  if (story.data === undefined) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        That story no longer exists.
      </div>
    );
  }

  /** The Prompt panel's form. One element, drawn as the left column's tab,
   *  as a card on the canvas, or in a window of its own. */
  const insertForm = (
                <MusicRequestForm
                  settings={musicSession.settings}
                  patch={musicSession.patch}
                  model={musicSession.model}
                  models={soundModels}
                  modelsLoading={musicSession.modelsLoading}
                  llmEnabled={musicSession.llmEnabled}
                  enhance={musicSession.enhance}
                  enhancing={musicSession.enhancing}
                  enhanceError={musicSession.enhanceError}
                  writeLyrics={musicSession.writeLyrics}
                  writingLyrics={musicSession.writingLyrics}
                  lyricsError={musicSession.lyricsError}
                  running={musicSession.running}
                  canSubmit={musicSession.canSubmit}
                  submit={insertSubmit}
                  cancelCurrent={musicSession.cancelCurrent}
                  estimateS={musicSession.estimateS}
                  estimateNote={musicSession.estimateNote}
                  submitLabel="Generate & insert"
                  canSeparate={Boolean(models.data?.some((m) => m.task === "sep"))}
                />
  );

  /**
   * Every panel, as data, in the three groups the column layout draws them
   * in. The canvas and the pop-out windows read the same definitions, so a
   * panel is the same panel — same header, same tools, same body — wherever
   * you have put it.
   */
  const centreArtifacts: Artifact[] = [
              // The script shares the middle with the timeline, above it:
              // they are the two views of the same story — what it says and
              // where it sits — and reading a line while looking at the clip
              // it becomes is the whole job. The conversation keeps the left,
              // the shelves keep the right.
              //
              // Gated on the builder rather than on `closedPanels`, which
              // cannot express it: a panel a tool never had is never one that
              // tool closed, so the Music Builder would render a script here.
              ...(scriptAvailable
                ? [
              {
                id: "script",
                icon: panelIcon("script"),
                label: "Script",
                defaultWeight: 2,
                title: (
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="text-xs font-medium">Script</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {lines.length} line{lines.length === 1 ? "" : "s"}
                      {generated < lines.length ? `, ${generated} voiced` : ""}
                    </span>
                  </div>
                ),
                body: (
                  <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {segments.isLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="h-8 rounded-md" />
                        ))}
                      </div>
                    ) : (
                      <StoryScript
                        storyOptions={story.data.request_options}
                        onStoryOptions={(options) =>
                          setStoryOptions.mutate({ id: storyId, options })
                        }
                        readOnly={agent.active}
                        segments={lines}
                        voices={usableVoices}
                        model={scriptModel}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        onPatch={(id, patch) => updateSegment.mutate({ id, patch })}
                        onCreate={(values) => createSegment.mutate(values)}
                        onCreateMany={async (values) => {
                          // One at a time, awaited: the server appends each
                          // after the last, so firing them together would
                          // leave the order to the network.
                          // Stops at the first line the server refuses and
                          // says how far it got: the rest would only land
                          // out of order, and the paste panel has closed.
                          // useCreateSegment already toasts the error itself.
                          let added = 0;
                          try {
                            for (const v of values) {
                              await createSegment.mutateAsync(v);
                              added++;
                            }
                          } catch {
                            toast.error(
                              `Added ${added} of ${values.length} lines. The rest were not added; paste them again to continue.`,
                            );
                          }
                        }}
                        onDelete={removeLine}
                        onGenerate={speakLine}
                        generating={generatingIds}
                        auditionId={auditionId}
                        auditionTime={auditionTime}
                        onAudition={audition}
                        onAuditionSeek={seekAudition}
                        activeId={playingId}
                      />
                    )}
                  </div>
                ),
                onClose: () => showPanel("script", false),
              },
                  ]
                : []),
              {
                id: "timeline",
                icon: panelIcon("timeline"),
                label: "Timeline",
                onClose: () => showPanel("timeline", false),
                title: (
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="text-xs font-medium">Timeline</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {lines.length} line{lines.length === 1 ? "" : "s"}
                      {generated < lines.length ? `, ${generated} voiced` : ""}
                    </span>
                  </div>
                ),
                trailing: (
                  <div
                    ref={setTimelineToolbarHost}
                    className="flex min-w-0 flex-1 items-center overflow-x-auto"
                  />
                ),
                defaultWeight: 2,
                body: (
          <StoryTimeline
            readOnly={agent.active}
            toolbarHost={timelineToolbarHost}
            segments={lines}
            selectedId={selectedId}
            onSelect={setSelectedId}
            // Double-click means "show me this one" — so it both selects the
            // clip and brings the panel that describes it back onto the stack.
            onOpenSample={(id) => {
              setSelectedId(id);
              showPanel("sample", true);
            }}
            // Same road a recording takes: into the library first, then onto
            // the lane. An imported file is a sound like any other once it is
            // in, so it can be reused, renamed and found by search rather than
            // living only inside this one story.
            onImported={async (wav, name, at) => {
              try {
                const sound = await api.uploadSound(name || "Imported sound", wav, "import");
                addClip("import", {
                  sound_id: sound.id,
                  speaker: sound.name,
                  start_s: at.start_s,
                  track_index: at.track_index,
                });
                void qc.invalidateQueries({ queryKey: ["sounds"] });
                toast.success(`Imported ${sound.name}`);
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "That file could not be imported",
                );
              }
            }}
            onOpenPanel={openPanelFocused}
            onSelectionChange={setSelectedIds}
            recordRequest={recordRequest}
            onMove={move}
            onToggleMute={(s) => editClip(s.muted ? "unmute" : "mute", s.id, { muted: !s.muted })}
            onDelete={removeLines}
            onDuplicate={duplicate}
            onSplit={split}
            onAddAt={({ start_s, track_index, text }) =>
              addClip("add clip", { start_s, track_index, text })
            }
            // `speaker` is the clip's label on the timeline, and a dropped
            // sound has one: its name. Without it the clip reads "Empty line",
            // which looks like a drop that failed rather than one that worked.
            onInsertSound={(soundId, { start_s, track_index, name }) =>
              addClip("insert sound", {
                sound_id: soundId,
                start_s,
                track_index,
                ...(name ? { speaker: name } : {}),
              })
            }
            onRegenerate={speakLine}
            onPaste={(segment, at) =>
              addClip("paste", {
                text: segment.text,
                speaker: segment.speaker,
                voice_id: segment.voice_id,
                kind: segment.kind,
                sound_id: segment.sound_id,
                duration_s: segment.duration_s,
                ...at,
              })
            }
            undo={history.undo}
            redo={history.redo}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            undoLabel={history.undoLabel}
            generating={generatingIds}
            pending={pendingClips}
            tracks={tracks.data ?? []}
            devices={devices}
            onTrack={editTrack}
            // Creating the row *is* creating the track: a lane with defaults
            // and no clips is exactly an empty track.
            onAddTrack={(trackIndex) => updateTrack.mutate({ trackIndex, patch: {} })}
            onRemoveTrack={(trackIndex, clips) => {
              // Only worth a confirm when there is something to lose. An empty
              // lane you just made should not demand a dialog to unmake.
              if (clips > 0) setPendingTrackRemoval({ trackIndex, clips });
              else removeTrack(trackIndex);
            }}
            onEditSound={(kind, sound) => musicSession.startEdit(kind, sound)}
            canExtend={canExtendSound}
            canCover={canCoverSound}
            onSeparateClip={setStemTarget}
            canSeparate={Boolean(models.data?.some((m) => m.task === "sep"))}
            onRepaintClip={(segment, window) => {
              // Fresh answers per clip: a strength left over from the last
              // one is a setting nobody chose for this one.
              setRepaintOptions(DEFAULT_REPAINT);
              setRepaintTarget({ segment, window });
            }}
            canRepaint={canRepaintSound}
            onResize={(id, patch) => editClip("trim", id, patch)}
            // A take from the microphone: converted to the WAV the server can
            // read, stored as a library sound so the export can find it on
            // disk, then placed as a clip. A recording that lived only in the
            // browser could be arranged and then vanish from its own mixdown.
            onRecorded={async (blob, at) => {
              try {
                const wav = await toWav(blob);
                const stamp = new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                const sound = await api.uploadSound(`Take ${stamp}`, wav, "recording");
                addClip("record", {
                  sound_id: sound.id,
                  speaker: sound.name,
                  start_s: at.start_s,
                  track_index: at.track_index,
                });
                void qc.invalidateQueries({ queryKey: ["sounds"] });
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "That take could not be saved",
                );
              }
            }}
            onFade={(id, patch) =>
              editClip(patch.fade_in_s !== undefined ? "fade in" : "fade out", id, patch)
            }
            onTransport={setTransport}
            onPlayingChange={setPlaying}
            onProgress={useTransportStore.getState().setProgress}
            onActiveSegmentChange={setPlayingId}
          />
                ),
              },
              // The mixer's inserts for one track, under the timeline that
              // owns the tracks. Shut by default: visible enough to see that a
              // lane is being compressed, small enough not to compete with the
              // arrangement for the column.
              {
                id: "devices",
                icon: panelIcon("devices"),
                label: "Devices",
                // A row of dials and a mix slider is a fixed height; a share
                // of a short column would crop it mid-knob.
                minOpenPx: 244,
                // Present but shut: the rack has to be visible enough that you
                // can see a track is being compressed, and small enough that
                // it is not competing with the timeline for the column.
                defaultOpen: false,
                title: (
                  <DeviceLanes
                    lanes={lanes}
                    tracks={tracks.data ?? []}
                    devices={devices}
                    lane={rackLane}
                    onLane={setRackLane}
                  />
                ),
                body: (
                  <DeviceCards
                    tracks={tracks.data ?? []}
                    devices={devices}
                    lane={rackLane}
                    onChange={setLane}
                    readOnly={agent.active}
                  />
                ),
                onClose: () => showPanel("devices", false),
              },
              // Notes, and the clip they become.
              //
              // The panel renders a take to a WAV and hands it here; placing
              // it is the microphone's path exactly — upload, then a clip on
              // a new lane — because the export reads clips off disk and a
              // take that existed only in the browser could be arranged and
              // then vanish from its own mixdown.
              //
              // Nothing here knows about instruments. The panel's render is
              // deliberately dry, and asking for a violin is the clip's own
              // Cover, one right-click away on the lane it just landed on.
              {
                id: "midi",
                icon: panelIcon("midi"),
                label: "MIDI",
                // A keyboard, a roll and a row of controls do not usefully
                // compress: below this the keys are too thin to hit.
                minOpenPx: 300,
                title: <span className="text-sm font-semibold">MIDI</span>,
                body: (
                  <WithPlayhead
                    render={(at) => (
                      <MidiPanel
                        playheadS={at}
                        readOnly={agent.active}
                        canCover={coverModel !== null}
                        onPlace={placeTake}
                      />
                    )}
                  />
                ),
                onClose: () => showPanel("midi", false),
              },
              // The roll edits the take the MIDI panel captured — one document,
              // two views, so there is nothing to move between them.
              {
                id: "roll",
                icon: panelIcon("roll"),
                label: "Piano roll",
                // Five octaves of keyboard beside a grid: shorter than this and
                // you are scrolling to find the note you just played.
                minOpenPx: 320,
                title: <PianoRollTitle />,
                body: (
                  <WithPlayhead
                    render={(at) => (
                      <PianoRoll
                        playheadS={at}
                        readOnly={agent.active}
                        canCover={coverModel !== null}
                        onPlace={placeTake}
                      />
                    )}
                  />
                ),
                onClose: () => showPanel("roll", false),
              },
  ];
  const rightArtifacts: Artifact[] = [
              // Where the next thing on this timeline comes from. On the
              // right with everything else you drag onto a lane, rather than
              // in a tab on the far side of the script: a sound you are
              // dragging should not have to cross the page to land.
              {
                id: "library",
                icon: panelIcon("library"),
                label: "Library",
                defaultWeight: 1.5,
                title: <span className="text-xs font-medium">Library</span>,
                body: <LibraryPane className="min-h-0 flex-1 p-2" />,
                onClose: () => showPanel("library", false),
              },
              // The transport is this panel's header, and the panel's body is
              // the clip behind it: the same waveform, stems and provenance
              // the detail page shows, without leaving the arrangement to see
              // them. Off the stack entirely until a clip is double-clicked
              // (see `closedPanels`) — and open when it does arrive, because
              // the gesture that reveals it already said which clip it is for.
              {
                id: "sample",
                icon: panelIcon("sample"),
                label: "Sample",
                title: (
                  <NowPlaying
                    // While the story is playing it *is* what's playing,
                    // whatever happens to be selected — a header captioned
                    // with a clip you are not hearing is worse than none.
                    sound={playing ? null : (selected?.sound ?? null)}
                    label={
                      playing
                        ? story.data.title
                        : selected?.speaker || selected?.text || "The whole story"
                    }
                    subtitle={
                      playing
                        ? <TransportClock />
                        : selected?.sound
                          ? readOn(selected.sound)
                          : "Play the whole arrangement"
                    }
                    playing={playing || (selected !== null && auditionId === selected.id)}
                    // Play means "play what this header is showing". With a
                    // clip selected that is the clip; with nothing selected it
                    // is the whole story. Pressing play and hearing something
                    // other than what is captioned in front of you is the
                    // confusing version.
                    onToggle={() => {
                      if (playing) {
                        transport?.stop();
                        return;
                      }
                      if (selected?.sound) {
                        audition(selected.id);
                        return;
                      }
                      transport?.play();
                    }}
                    canPlay={Boolean(selected?.sound) || (transport !== null && generated > 0)}
                    playsClip={!playing && Boolean(selected?.sound)}
                  />
                ),
                body: <SoundArtifact sound={selected?.sound ?? null} />,
                onClose: () => showPanel("sample", false),
              },
              // Hidden if you closed it; the column itself is not rendered
              // at all once the last of them is gone.
              // History last, under the sources it drew from. Not beside the
              // Prompt: what you are about to ask for and what you already
              // asked for are different questions, and stacking them made the
              // panel you write in shorter every time you generated.
              // History, first in the left column: it is a log you read down,
              // so it starts where reading starts. Everything else here acts on
              // the arrangement; this one only tells you what happened.
              {
                id: "history",
                icon: panelIcon("history"),
                label: "History",
                defaultWeight: 1.5,
                title: (
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="text-xs font-medium">History</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {historyCount ? `${historyCount} recorded` : "Nothing yet"}
                    </span>
                  </div>
                ),
                body: (
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {/* Everything that happened here, not just what the Prompt
                        panel rendered — see `story-history.tsx`. */}
                    <StoryHistory
                      storyId={storyId}
                      // The log for that render, in the panel under this one,
                      // rather than the Activity page — which would mean
                      // leaving the studio to read about the studio.
                      onOpenLogs={(jobId) => {
                        setLogsJob(jobId);
                        showPanel("logs", true);
                      }}
                    />
                  </div>
                ),
                onClose: () => showPanel("history", false),
              },
              // What the server made of it. Last, because it is the panel you
              // open when something in one of the panels above went wrong —
              // and closed until then: a tail that polls every two seconds is
              // not something to leave running behind an arrangement that is
              // working.
              {
                id: "logs",
                icon: panelIcon("logs"),
                label: "Logs",
                defaultWeight: 1.5,
                minOpenPx: 180,
                title: (
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="text-xs font-medium">Logs</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {logsJob ? `one job · ${logsJob.slice(0, 8)}` : "the server’s own"}
                    </span>
                  </div>
                ),
                body: (
                  <div className="flex min-h-0 flex-1 flex-col p-2">
                    <LogTail compact jobFilter={logsJob} onJobFilter={setLogsJob} />
                  </div>
                ),
                onClose: () => showPanel("logs", false),
              },
  ];
  /** The two the left column draws as tabs, as panels in their own right for
   *  the canvas and for windows. */
  const leftArtifacts: Artifact[] = [
    ...(assistantEnabled
      ? [
          {
            id: "chat",
            icon: panelIcon("chat"),
            label: "Chat",
            title: <span className="text-xs font-medium">Chat</span>,
            body: (
              <AssistantChat threadKey={studioThread(storyId)} className="min-h-0 flex-1" inset />
            ),
            onClose: () => showPanel("chat", false),
          },
        ]
      : []),
    {
      id: "insert",
      icon: panelIcon("insert"),
      label: "Prompt",
      title: <span className="text-xs font-medium">Prompt</span>,
      body: <div className="min-h-0 flex-1 overflow-y-auto p-3">{insertForm}</div>,
      onClose: () => showPanel("insert", false),
    },
  ];
  // Every panel can leave the page for a window of its own.
  const withPopOut = (list: Artifact[]): Artifact[] =>
    list.map((a) => ({ ...a, onPopOut: (at: PopOutAt) => popOut(a.id, at) }));
  const allArtifacts = [...leftArtifacts, ...centreArtifacts, ...rightArtifacts];
  const columnOf = (id: string): CanvasColumn =>
    leftArtifacts.some((a) => a.id === id) ? 0 : rightArtifacts.some((a) => a.id === id) ? 2 : 1;

  return (
    // Container queries rather than viewport ones: this page sits inside the
    // shell's padded column, so what decides whether the timeline can sit
    // beside the script is how much room *this* element got, not how wide the
    // window happens to be. The @container and the flex row have to be two
    // elements — an element cannot query its own size, so a `@3xl:` class on
    // the container itself would never match.
    // Height from the layout rather than from a viewport calculation: the
    // studio is a fixed frame whose panels scroll inside it, and a magic
    // `100vh - 4.5rem` was 24px out — enough to give the whole document a
    // scrollbar and let the page drift under the header. `flex-1` inside the
    // shell's own column is exactly the space that is left, whatever the
    // header and the padding turn out to be.
    <div className="@container flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      {/* The story's own controls, in the app's top bar beside the
          breadcrumbs — see `header-slot`. There is no back button: the crumb
          that names this builder is one, and it is where you would look for
          it. The title sits first because it names what the tools act on, and
          the tools are pushed right, away from it. */}
      <PageHeader>
        <Input
          // Keyed on the server's title so a rename from elsewhere — an agent,
          // another tab — actually appears. The field is uncontrolled so that
          // typing does not fight a refetch, and this is what stops that
          // costing us external changes. Safe while typing: the title is only
          // written on blur, so the key cannot change mid-edit.
          key={story.data.title}
          className="focus-visible:border-input focus-visible:bg-background @3xl:w-72 @5xl:w-96 h-7 w-40 min-w-0 border-transparent bg-transparent px-1.5 text-sm font-medium shadow-none"
          defaultValue={story.data.title}
          aria-label="Story title"
          onBlur={(e) => {
            const title = e.target.value.trim();
            if (title && title !== story.data!.title) {
              renameStory.mutate({ id: storyId, title });
            }
          }}
        />

        <div className="ml-auto flex items-center gap-2">
          {/* The voice every line is read with, in the bar because it applies
              to the whole script. The Music Builder has no script to read, and
              its model — the one that renders a take — is picked in the Prompt
              panel beside the prompt it renders, so a TTS picker here would be
              a control with nothing to act on. */}
          {/* No voice or model picker here: a voice is cast per line, in the
              script, and the model comes with it. */}
          <Button
            size="sm"
            disabled={
              agent.active || generated === 0 || exportStory.isPending || exportJob.active
            }
            onClick={runExport}
          >
            <DownloadIcon />
            Export
          </Button>
          {/* Columns or canvas, one press away: the Panels menu has the same
              choice, but switching is something you do while looking at the
              layout, not something to go looking for. */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={layoutMode === "canvas" ? "Use the column layout" : "Use the canvas layout"}
            title={layoutMode === "canvas" ? "Columns" : "Canvas: place panels anywhere"}
            onClick={() =>
              setUiPrefs({ studioLayout: layoutMode === "canvas" ? "columns" : "canvas" })
            }
          >
            {layoutMode === "canvas" ? <Columns3Icon /> : <LayoutDashboardIcon />}
          </Button>
          {/* Everything the studio can show, in one menu — which is also the
              only way back for a panel you have X'd out of. The timeline is
              not in here: it is the one panel with no X, and closing every
              panel that has one already gives it the whole page. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <PanelRightOpenIcon />
                Panels
              </Button>
            </DropdownMenuTrigger>
            {/* Drawn from `panels`, the same list the shortcuts and the
                palette read — a panel cannot appear in one and be missing
                from another, and its key is printed here so the menu is
                where you learn the shortcut. */}
            <DropdownMenuContent align="end" className="w-52">
              {panels.map((panel) => (
                <DropdownMenuCheckboxItem
                  key={panel.id}
                  checked={!closedPanels.has(panel.id)}
                  onCheckedChange={(on) => showPanel(panel.id, Boolean(on))}
                >
                  {/* The same glyph the panel's own header wears, so the menu
                      row and the thing it opens are recognisably one panel. */}
                  <panel.icon className="text-muted-foreground" aria-hidden="true" />
                  <span className="flex-1">{panel.label}</span>
                  {popped.has(panel.id) && !closedPanels.has(panel.id) && (
                    <ExternalLinkIcon
                      className="text-muted-foreground size-3"
                      aria-label="In its own window"
                    />
                  )}
                  <kbd className="text-muted-foreground ml-2 font-mono text-[10px]">
                    {MOD_LABEL}
                    {panel.key.toUpperCase()}
                  </kbd>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                Layout
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={layoutMode}
                onValueChange={(mode) => setUiPrefs({ studioLayout: mode as "columns" | "canvas" })}
              >
                <DropdownMenuRadioItem value="columns">
                  <Columns3Icon className="text-muted-foreground" aria-hidden="true" />
                  Columns
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="canvas">
                  <LayoutDashboardIcon className="text-muted-foreground" aria-hidden="true" />
                  Canvas
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              {layoutMode === "canvas" && (
                <DropdownMenuItem onSelect={() => setTidyRequest((n) => n + 1)}>
                  Tidy the canvas
                </DropdownMenuItem>
              )}
              {popped.size > 0 && (
                <DropdownMenuItem onSelect={() => setPopped(new Map())}>
                  Put every window back
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <StoryMenu
            onDelete={(deleteSounds) =>
              deleteStory.mutate(
                { id: storyId, deleteSounds },
                { onSuccess: () => navigate(shelfHref, { replace: true }) },
              )
            }
          />
        </div>
      </PageHeader>

      {agent.active && (
        /* Shown, not hidden: you can still read the script and hear it while an
           agent works. What is withheld is editing, because two writers on one
           line is a race nobody wins — and the work is usually seconds, not
           minutes. */
        <div className="border-primary/30 bg-primary/5 mb-3 flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2">
          <Loader2Icon className="text-primary size-4 shrink-0 animate-spin" />
          <p className="text-sm">
            An agent is {agent.label ?? "working on this story"}
            {agent.count > 1 ? ` (${agent.count} in flight)` : ""}. Editing is paused until
            it finishes.
          </p>
        </div>
      )}

      {exportJobId && (
        <div className="shrink-0 pb-3">
          <JobResult job={exportJob.job} />
        </div>
      )}
      {layoutMode === "canvas" ? (
        /* The same panels as cards you place yourself. `soloChat` does not
           apply: on a canvas a lone chat is a card like any other, where you
           put it. */
        allArtifacts.some((a) => inPage(a.id)) ? (
          <PanelCanvas
            layoutKey={builder}
            artifacts={withPopOut(allArtifacts.filter((a) => inPage(a.id)))}
            columnOf={columnOf}
            onPopOut={popOut}
            tidyRequest={tidyRequest}
          />
        ) : (
          <AllPanelsAway
            popped={popped.size}
            onOpenTimeline={() => showPanel("timeline", true)}
          />
        )
      ) : soloChat ? (
        /* A new studio, before it has anything in it: the conversation, on
           its own, in the middle. Same component and same store as the
           panel — opening the timeline or the script simply puts it back in
           the column beside them. */
        <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col">
          <AssistantChat threadKey={studioThread(storyId)} />
        </div>
      ) : (
      <div ref={rowRef} className="flex min-h-0 flex-1 flex-col gap-4 @3xl:flex-row">
      {/* Three columns: what the story says, what it is, and what you are
          working on it with. The timeline takes the middle and the larger
          share, because it is the one you are always looking at; the script
          and the panels are quarters either side of it, each draggable.

          Below @3xl they stack — script, timeline, panels — rather than any of
          them disappearing. Arranging is half the job on a narrow window too.

          A column with nothing in it is not rendered at all: close the script
          and the timeline simply moves left. */}

      {/* Every panel closed. Reachable before this state was drawn, and more
          reachable now that the chat is not always there to be the last one
          standing — the studio was simply blank, with the way back hidden in
          a menu. */}
      {!leftOpen && !centreOpen && !panelsOpen && (
        <AllPanelsAway popped={popped.size} onOpenTimeline={() => showPanel("timeline", true)} />
      )}

      {/* -------------------------------------------- left: chat and prompt */}
      {/* The column you *ask* in — the two places you describe something that
          does not exist yet, as tabs of one panel rather than a stack of two.

          They were stacked, and the stack was the problem: a fifth of the
          window split three-to-two gave you a conversation four messages tall
          above a form you had to scroll to fill, and both were the *same
          request* at two levels of precision. You are never writing in one
          while reading the other; you pick how you want to say it. So one
          frame, one body, and a tab strip that says which.

          The chat used to be deliberately un-framed — everything else in the
          studio is a bordered artifact because everything else is a view *of
          the story*, and the chat is the thing you are talking to. That still
          holds for `soloChat`, which is bare. But a tab is a frame by
          definition, and a frame the Prompt shares is not a label saying
          "this box contains a chat" — it is the seam between two ways of
          asking. The close button belongs to the strip for the same reason,
          so the chat no longer needs its own ghost X floating over the
          thread.

          The script is not here: it is a view of the story, like the
          timeline, so it lives in the middle with it. */}
      {leftOpen && (
        <div
          className="flex h-[18rem] min-h-0 w-full min-w-0 flex-col @3xl:h-auto @3xl:flex-none"
          // `flexBasis` alone loses to the panels' own content width — the
          // column cannot shrink past what its header needs — so the cap is
          // what actually makes a fifth a fifth.
          style={{ flexBasis: `${leftPct}%`, maxWidth: `${leftPct}%` }}
        >
          <div
            data-left-column
            className="border-border bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border"
          >
            {/* One tab per panel that is *open*, not one per panel that
                exists: closing the Prompt should leave the chat filling the
                column, not a dead tab beside it. With one open the strip is a
                single tab — still worth drawing, because it is where the icon
                and the close control live, and a header that appears only
                sometimes is a layout that jumps. */}
            <div
              role="tablist"
              aria-label="Chat and prompt"
              className="border-border/60 flex shrink-0 items-center gap-0.5 border-b px-1.5 py-1"
            >
              {leftTabs.map((tab) => (
                <Button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeLeftTab === tab.id}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 gap-1.5 rounded-md px-2 text-xs",
                    activeLeftTab === tab.id
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground",
                  )}
                  onClick={() => setLeftTab(tab.id)}
                >
                  <tab.icon aria-hidden="true" />
                  {tab.label}
                </Button>
              ))}
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Open ${activeLeftTab === "chat" ? "Chat" : "Prompt"} in a new window`}
                title="Open in a new window"
                className="text-muted-foreground"
                onClick={(e) => {
                  const rect = e.currentTarget.closest("[data-left-column]")?.getBoundingClientRect();
                  popOut(activeLeftTab, {
                    left: rect ? window.screenX + rect.left : undefined,
                    top: rect ? window.screenY + rect.top : undefined,
                    width: rect?.width ?? 420,
                    height: rect?.height ?? 640,
                  });
                }}
              >
                <ExternalLinkIcon />
              </Button>
              {/* Closes the tab you are looking at, which is the one the X is
                  beside. Ctrl/⌘T and Ctrl/⌘P bring it back, as does the
                  Panels menu. */}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Close ${activeLeftTab === "chat" ? "Chat" : "Prompt"}`}
                className="text-muted-foreground"
                onClick={() => showPanel(activeLeftTab, false)}
              >
                <XIcon />
              </Button>
            </div>

            {/* Both bodies stay mounted, hidden rather than removed — the
                same rule the artifact stack keeps for a collapsed panel.
                Switching to the Prompt and back must not lose where you were
                in the thread, and switching away from a half-written prompt
                must not empty the field. */}
            {chatOpen && (
              <section
                aria-label="Chat"
                className={cn(
                  "min-h-0 flex-1 flex-col",
                  activeLeftTab === "chat" ? "flex" : "hidden",
                )}
              >
                {/* No scroller here: the chat scrolls its own thread and keeps
                    its composer at the bottom of the column (see
                    `assistant-chat`). Wrapping it in one put the box you type
                    in at the bottom of the *conversation* instead, which is
                    somewhere off-screen after a few turns. */}
                <AssistantChat
                  threadKey={studioThread(storyId)}
                  className="min-h-0 flex-1"
                  inset
                />
              </section>
            )}
            {insertOpen && (
              <section
                aria-label="Prompt"
                className={cn(
                  "min-h-0 flex-1 overflow-y-auto p-3",
                  activeLeftTab === "insert" ? "block" : "hidden",
                )}
              >
                {insertForm}
              </section>
            )}
          </div>
        </div>
      )}

      {leftOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          // Not "the script" any more: this edge is the left column's, and
          // that column is the chat and the prompt.
          aria-label="Resize the left panels"
          className="hover:bg-primary/40 active:bg-primary/60 hidden w-1 shrink-0 cursor-col-resize touch-none rounded-full transition-colors @3xl:block"
          onPointerDown={(e) => onResizeDown(e, "left")}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
        />
      )}

      {/* ------------------------------ centre: the script and the timeline */}
      {/* The two views of the same list, in the column that gets the space.
          The script reads down and the timeline reads across, and both are
          about clips that already exist — which is what separates them from
          the chat and the prompt box on the left.

          The script used to sit in the left column, which had two costs. It
          was capped at that column's fifth of the page, so writing happened
          in a strip; and this column only existed while the timeline was
          open, so shutting the timeline to get room for the script did the
          exact opposite of what it looked like it would do. Here it takes
          the free width by default and keeps it when the timeline goes.

          Every panel in here has an X, this column included. It goes when
          the last of them does: an empty frame where the arrangement used to
          be is worse than the space going to the panels still open. */}
      {centreOpen && (
      <div className="flex h-[26rem] min-h-0 w-full min-w-0 flex-col @3xl:h-auto @3xl:flex-1">
        <ArtifactStack
          className="flex-1"
          artifacts={withPopOut(centreArtifacts.filter((a) => inPage(a.id)))}
        />
      </div>
      )}

      {panelsOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the panels"
          className="hover:bg-primary/40 active:bg-primary/60 hidden w-1 shrink-0 cursor-col-resize touch-none rounded-full transition-colors @3xl:block"
          onPointerDown={(e) => onResizeDown(e, "right")}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
        />
      )}

      {/* ----------------------------------------------- right: the panels */}
      {panelsOpen && (
        <div
          className="flex h-[22rem] min-h-0 w-full min-w-0 flex-col @3xl:h-auto @3xl:flex-none"
          style={{ flexBasis: `${rightPct}%`, maxWidth: `${rightPct}%` }}
        >
          <ArtifactStack
            className="flex-1"
            artifacts={withPopOut(rightArtifacts.filter((a) => inPage(a.id)))}
          />
        </div>
      )}

      </div>
      )}

      {/* Panels in windows of their own. Rendered here, in the studio's own
          tree, so they share its state — see `lib/popout.ts`. */}
      {[...popped].map(([id, win]) => {
        const artifact = allArtifacts.find((a) => a.id === id);
        if (!artifact || closedPanels.has(id)) return null;
        return (
          <PopoutWindow
            key={id}
            win={win}
            title={`${artifact.label} · ${story.data.title} · Soundbox`}
            onClosed={() => dock(id)}
          >
            <PopoutPanelFrame
              icon={artifact.icon}
              label={artifact.label}
              title={artifact.title}
              trailing={artifact.trailing}
              body={artifact.body}
              onDock={() => dock(id)}
              onClose={artifact.onClose}
            />
          </PopoutWindow>
        );
      })}

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={panelCommands}
      />

      {/* Removing a lane takes its clips with it — Audacity's rule, and the
          honest one: a lane is where those clips live, not a folder you empty
          first. Worth a confirm precisely because undo does not cover it. */}
      <Dialog
        open={pendingTrackRemoval !== null}
        onOpenChange={(open) => !open && setPendingTrackRemoval(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this track?</DialogTitle>
            <DialogDescription>
              {pendingTrackRemoval && (
                <>
                  Track {pendingTrackRemoval.trackIndex} and the{" "}
                  {pendingTrackRemoval.clips} clip
                  {pendingTrackRemoval.clips === 1 ? "" : "s"} on it will be removed from
                  this story. The audio stays in your library. This cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingTrackRemoval(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!pendingTrackRemoval) return;
                removeTrack(pendingTrackRemoval.trackIndex);
                setPendingTrackRemoval(null);
              }}
            >
              Remove track
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StemPickerDialog
        open={stemTarget !== null}
        onOpenChange={(open) => !open && setStemTarget(null)}
        busy={separating}
        confirmLabel="Split into tracks"
        description={
          stemTarget
            ? `“${stemTarget.sound?.name ?? stemTarget.speaker ?? "This clip"}” is replaced by ` +
              "one lane per stem you keep, all starting where it starts."
            : ""
        }
        onConfirm={(stems) => stemTarget && separateClip(stemTarget, stems)}
      />

      <RepaintDialog
        open={repaintTarget !== null}
        onOpenChange={(open) => !open && setRepaintTarget(null)}
        description={
          repaintTarget
            ? `${formatDuration(repaintTarget.window.start_s)}–${formatDuration(repaintTarget.window.end_s)} of ` +
              `“${repaintTarget.segment.sound?.name ?? "this clip"}” is rendered again. ` +
              "The rest of it, and where the clip sits, are untouched."
            : ""
        }
        placeholder={repaintTarget?.segment.sound?.prompt}
        value={repaintOptions}
        onChange={setRepaintOptions}
        onConfirm={() => {
          if (!repaintTarget) return;
          repaintClip(repaintTarget.segment, repaintTarget.window, repaintOptions);
          setRepaintTarget(null);
        }}
      />

    </div>
  );
}

/** What the studio shows when nothing is left on the page: every panel
 *  closed, or every open one out in a window of its own. */
function AllPanelsAway({ popped, onOpenTimeline }: { popped: number; onOpenTimeline: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="text-muted-foreground text-sm">
        {popped > 0
          ? `Every open panel is in a window of its own. Close a window to bring its panel back here.`
          : `Every panel is closed. ${MOD_LABEL}L brings the timeline back.`}
      </p>
      {popped === 0 && (
        <Button variant="outline" size="sm" onClick={onOpenTimeline}>
          <PanelRightOpenIcon /> Open the timeline
        </Button>
      )}
    </div>
  );
}

/** A static waveform for the docked clip — the peaks the server already
 *  computed, drawn small. No transport: see NowPlaying. */
function ClipPeaks({ peaks }: { peaks: number[] }) {
  return (
    <div className="flex h-8 w-40 items-center gap-px" aria-hidden="true">
      {peaks
        // 40-odd bars out of 256 buckets is all this width can show.
        .filter((_, i) => i % 6 === 0)
        .map((p, i) => (
          <div
            key={i}
            className="bg-primary/50 w-0.5 shrink-0 rounded-full"
            style={{ height: `${Math.max(8, p * 100)}%` }}
          />
        ))}
    </div>
  );
}

/**
 * The transport — the header of the sample artifact.
 *
 * It was a full-width dock along the foot of the page, matching the music
 * pages; then a pill in the top right. Both were the same mistake in different
 * corners: a caption and a play button floating somewhere, detached from the
 * thing they describe. As a panel header it *is* the handle for the clip, and
 * opening the panel under it shows that clip's waveform and provenance.
 *
 * So it draws no border and no background of its own: the panel provides both,
 * and a card inside a card is a seam nobody asked for.
 */
/** The playhead, for the few things that draw it. Re-renders on its own at
 *  frame rate while the story plays, so the studio around it does not. */
function WithPlayhead({ render }: { render: (at: number) => ReactNode }) {
  const at = useTransportStore((s) => s.at);
  return <>{render(at)}</>;
}

function TransportClock() {
  const at = useTransportStore((s) => s.at);
  const total = useTransportStore((s) => s.total);
  return <>{`${formatDuration(at)} / ${formatDuration(total)}`}</>;
}

function NowPlaying({
  sound,
  label,
  subtitle,
  playing,
  onToggle,
  canPlay,
  playsClip,
}: {
  sound: Sound | null;
  label: string;
  subtitle: ReactNode;
  playing: boolean;
  onToggle: () => void;
  canPlay: boolean;
  /** Whether pressing play plays the docked clip rather than the story. */
  playsClip: boolean;
}) {
  // A spoken clip is a clip *someone* read, so the header shows them. Off the
  // sound rather than the segment because this header also captions a dropped
  // library sound, which has no line behind it — and null for anything that
  // was generated rather than read.
  const voice = useVoice(sound?.voice_id ?? null);

  return (
    <div className="flex min-w-0 items-center gap-2">
      {voice && <VoiceAvatar voice={voice} className="size-7 rounded-full" />}
      {/* The caption takes the slack and truncates into the controls, so a
          long clip name cannot push the play button somewhere new. */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="text-muted-foreground truncate font-mono text-xs tabular-nums">
          {subtitle}
        </p>
      </div>

      {sound && (
        <>
          {/* A picture of the selected clip, not a second player: there is one
              transport and it drives the story. Auditioning a single line
              belongs on that line, in the script. */}
          <div className="hidden items-center lg:flex">
            <ClipPeaks peaks={sound.peaks} />
          </div>
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={sound.file} download aria-label={`Download ${sound.name}`}>
              <DownloadIcon />
            </a>
          </Button>
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to={`/sounds/${sound.id}`} aria-label={`Open ${sound.name}`}>
              <ExternalLinkIcon />
            </Link>
          </Button>
        </>
      )}

      <Button
        size="icon"
        className="size-9 shrink-0 rounded-full"
        aria-label={playing ? "Stop" : playsClip ? "Play this line" : "Play the story"}
        disabled={!canPlay}
        onClick={onToggle}
      >
        {playing ? <SquareIcon className="size-4" /> : <PlayIcon className="size-4" />}
      </Button>
    </div>
  );
}

function StoryMenu({ onDelete }: { onDelete: (deleteSounds: boolean) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Story options">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Two deletes rather than one with a checkbox: which you want depends
            on whether the takes are worth keeping, and that is a decision, not
            a modifier. */}
        <DropdownMenuItem onSelect={() => onDelete(false)}>
          Delete story, keep audio
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(true)}>
          Delete story and its audio
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
