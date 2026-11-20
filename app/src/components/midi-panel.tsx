/**
 * The MIDI panel — play notes, keep them, turn them into a clip.
 *
 * This is the front half of a two-stage idea. Nothing in the model catalogue
 * takes notes as input, so "play a line and hear it as a violin in a large
 * hall" is not one call: the notes are performed here and rendered by a plain
 * synth (`lib/midi.ts`), and the *timbre* is asked for afterwards by covering
 * that clip with ACE-Step, which is already what the timeline's right-click
 * Cover does to any clip. This panel therefore stops at "a clip on a lane" and
 * hands over to machinery the studio already had.
 *
 * A note list lives here while you play it and becomes a WAV, which is what
 * the timeline plays and the export mixes — the same path a microphone take
 * takes, for the same reason: the export reads clips off disk, so a take that
 * existed only in the browser could be arranged and then vanish from its own
 * mixdown. The notes ride along on the clip (`midi` on the segment), so
 * "Edit notes" on it brings them back here and into the roll, and rendering
 * again replaces the clip's audio in place.
 *
 * Three ways in, because the first two each fail somewhere:
 *
 * - A **MIDI keyboard**, where the browser allows it — not WKWebView, which is
 *   what the desktop build runs inside on macOS.
 * - The **on-screen keyboard**, which always works, mouse or QWERTY.
 * - A **`.mid` file**, which is how you get a real piece of music in here
 *   without being able to play one.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleIcon,
  DownloadIcon,
  KeyboardIcon,
  MagnetIcon,
  PlayIcon,
  PlugIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMidiInput } from "@/hooks/use-midi-input";
import type { MidiMessage } from "@/hooks/use-midi-input";
import { exportTake, useMidiStore } from "@/lib/midi-store";
import { MidiMappingPanel } from "@/components/midi-mapping-panel";
import { bindingFor, dispatchMidi, useMidiMapping } from "@/lib/midi-mapping";
import type { MidiTargetId } from "@/lib/midi-mapping";
import { TakeActions, useTakePlacement } from "@/components/take-actions";
import type { TakeActionsProps } from "@/components/take-actions";
import {
  isBlackKey,
  liveVoice,
  noteLabel,
  notesDuration,
  nowS,
  parseMidiFile,
  unmuteAudio,
} from "@/lib/midi";
import type { MidiNote, Voice } from "@/lib/midi";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";

/* ------------------------------------------------------------ the keyboard */

/** The home row and the one above it, laid out the way a piano is: the black
 *  keys sit on the top row above the gaps between the white ones. Every DAW
 *  with an on-screen keyboard uses this mapping, so it is already in the
 *  fingers of anyone who would look for it. */
const QWERTY: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16,
};

/** How many white keys the drawn keyboard shows. Two octaves plus a note, so
 *  both ends of a two-octave phrase are reachable without shifting. */
const WHITE_KEYS = 15;
/** Semitone offsets of the white keys within an octave. */
const WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11];

/** Every note the drawn keyboard covers, from a bottom C. */
function keyboardNotes(base: number): { white: number[]; black: (number | null)[] } {
  const white: number[] = [];
  for (let i = 0; i < WHITE_KEYS; i++) {
    white.push(base + Math.floor(i / 7) * 12 + WHITE_STEPS[i % 7]!);
  }
  // A black key is drawn straddling the boundary after each white key that has
  // one — which is every white key except E and B, the two that have none.
  const black = white.map((note) => (isBlackKey(note + 1) ? note + 1 : null));
  return { white, black };
}

/* ------------------------------------------------------------- the strip */

const ROLL_PX_PER_S = 64;
const ROW_PX = 7;

function TakeStrip({ notes, recording }: { notes: MidiNote[]; recording: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const duration = notesDuration(notes);

  // While recording, keep the growing end of the take in view. A roll that
  // scrolls only when you drag it is a roll you stop watching, and watching it
  // is how you notice a stuck note before you place the clip.
  useEffect(() => {
    if (!recording || scroller.current === null) return;
    scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [recording, notes.length]);

  if (!notes.length) {
    return (
      <div className="border-border/70 text-muted-foreground flex h-28 items-center justify-center rounded-lg border border-dashed text-xs">
        {recording ? "Listening — play something" : "No notes yet"}
      </div>
    );
  }

  // The drawn pitch range is the take's own, padded by a tone either side, so
  // a two-note phrase is not two slivers at opposite ends of 128 rows.
  const lowest = Math.min(...notes.map((n) => n.note)) - 2;
  const highest = Math.max(...notes.map((n) => n.note)) + 2;
  const rows = highest - lowest + 1;

  return (
    <div
      ref={scroller}
      className="border-border/70 bg-muted/30 relative overflow-x-auto rounded-lg border"
      style={{ height: Math.min(160, Math.max(112, rows * ROW_PX + 8)) }}
    >
      <div
        className="relative"
        style={{
          width: Math.max(duration * ROLL_PX_PER_S + 16, 100),
          height: rows * ROW_PX + 8,
        }}
      >
        {notes.map((n, i) => (
          <div
            key={`${n.note}-${n.start_s}-${i}`}
            title={`${noteLabel(n.note)} · ${n.duration_s.toFixed(2)}s`}
            className="bg-primary/80 absolute rounded-[2px]"
            style={{
              left: n.start_s * ROLL_PX_PER_S + 4,
              width: Math.max(2, n.duration_s * ROLL_PX_PER_S),
              top: (highest - n.note) * ROW_PX + 4,
              height: ROW_PX - 1,
              // Velocity is the one dimension a roll can show for free, and
              // "why is that note so quiet" is otherwise invisible until the
              // render comes back.
              opacity: 0.45 + n.velocity * 0.55,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ panel */

/** Exactly what the roll takes, because both panels end the same way — see
 *  `take-actions.tsx`. */
export type MidiPanelProps = TakeActionsProps;

export function MidiPanel({
  playheadS,
  readOnly = false,
  canCover = false,
  onPlace,
}: MidiPanelProps) {
  // The take, the instrument and what to ask a model for all live in the
  // store, because the piano roll is a second view of exactly those — see
  // `midi-store.ts`. Only this panel's own furniture is local state.
  const notes = useMidiStore((s) => s.notes);
  const setNotes = useMidiStore((s) => s.setNotes);
  const addNotes = useMidiStore((s) => s.addNotes);
  const clearNotes = useMidiStore((s) => s.clear);
  const instrument = useMidiStore((s) => s.instrument);

  const quantizeNotes = useMidiStore((s) => s.quantizeNotes);
  // Read here rather than only inside TakeActions because the mapping can now
  // fire Generate from a pad, and a pad has no form to read the prompt from.
  const prompt = useMidiStore((s) => s.prompt);
  const strength = useMidiStore((s) => s.strength);
  const setStrength = useMidiStore((s) => s.setStrength);
  const setBpm = useMidiStore((s) => s.setBpm);

  const [grid, setGrid] = useState("0.125");
  const [octave, setOctave] = useState(4);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  /** The controller map, and which target is waiting to be taught a control. */
  const mapping = useMidiMapping();
  const [learning, setLearning] = useState<MidiTargetId | null>(null);
  const [showMapping, setShowMapping] = useState(false);
  /** The same render-and-place the buttons do, for the pads that trigger it. */
  const { place } = useTakePlacement(onPlace);
  /** Notes currently down, for lighting the keys. Held separately from the
   *  recorder's own map so the keyboard stays lit when not recording. */
  const [down, setDown] = useState<Set<number>>(new Set());

  const fileInput = useRef<HTMLInputElement>(null);

  /* ------------------------------------------------------------- the voice */

  /** One live voice, rebuilt when the instrument changes. Kept in a ref rather
   *  than state because every press reads it and none of them should re-render
   *  the panel to do so. */
  const voice = useRef<Voice | null>(null);
  useEffect(() => {
    voice.current = liveVoice(instrument);
    return () => {
      voice.current?.dispose();
      voice.current = null;
    };
  }, [instrument]);

  /* -------------------------------------------------------------- recording */

  /** Notes held down, by pitch, with when they started. */
  const held = useRef(new Map<number, { start_s: number; velocity: number }>());
  /** The clock the take is measured against: `performance.now()` at the moment
   *  Record was pressed. Null when not recording. */
  const startedAt = useRef<number | null>(null);

  const at = (): number =>
    startedAt.current === null ? 0 : (performance.now() - startedAt.current) / 1000;

  /* --------------------------------------------------------------- sustain */

  /** The pedal, and the notes it is holding up.
   *
   *  A sustained note is one whose key is already back up, so it cannot live
   *  in `down` or in `held` alone: the recorder has to keep timing it until
   *  the pedal lifts, or every pedalled phrase records as staccato. */
  const sustaining = useRef(false);
  const sustained = useRef(new Set<number>());

  /** The real release — what a key-up does when no pedal is holding it. */
  const releaseNote = useCallback(
    (note: number) => {
      voice.current?.release(note);
      setDown((prev) => {
        const next = new Set(prev);
        next.delete(note);
        return next;
      });
      const start = held.current.get(note);
      if (start === undefined) return;
      held.current.delete(note);
      addNotes([
        {
          note,
          velocity: start.velocity,
          start_s: start.start_s,
          duration_s: Math.max(0.04, at() - start.start_s),
        },
      ]);
    },
    [addNotes],
  );

  const noteOn = useCallback(
    (note: number, velocity: number) => {
      void unmuteAudio();
      // Re-pressing a key the pedal is still holding starts a new note rather
      // than merging into the old one — which is what a piano does, and what
      // a repeated pedalled note has to do to be two notes in the take.
      if (sustained.current.delete(note)) releaseNote(note);
      voice.current?.press(note, velocity);
      setDown((prev) => new Set(prev).add(note));
      if (startedAt.current !== null && !held.current.has(note)) {
        held.current.set(note, { start_s: at(), velocity });
      }
    },
    [releaseNote],
  );

  const noteOff = useCallback(
    (note: number) => {
      if (sustaining.current) {
        sustained.current.add(note);
        return;
      }
      releaseNote(note);
    },
    [releaseNote],
  );

  const setSustain = useCallback(
    (down: boolean) => {
      sustaining.current = down;
      if (down) return;
      const pending = [...sustained.current];
      sustained.current.clear();
      for (const note of pending) releaseNote(note);
    },
    [releaseNote],
  );

  const startRecording = (): void => {
    void unmuteAudio();
    // A second take appends to the first rather than replacing it: overdubbing
    // a bass line under a melody is the obvious next thing to want, and Clear
    // is right there for the other case.
    held.current.clear();
    startedAt.current = performance.now();
    setElapsed(0);
    setRecording(true);
  };

  const stopRecording = useCallback(() => {
    const end = at();
    startedAt.current = null;
    setRecording(false);
    // Anything still down when the take ends is a real note that happens to be
    // held — closing them at `end` keeps it, where dropping them would lose
    // the last chord of every take that ends on one.
    const stuck = [...held.current.entries()];
    held.current.clear();
    if (stuck.length) {
      addNotes(
        stuck.map(([note, start]) => ({
          note,
          velocity: start.velocity,
          start_s: start.start_s,
          duration_s: Math.max(0.04, end - start.start_s),
        })),
      );
    }
  }, [addNotes]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed(at()), 100);
    return () => clearInterval(timer);
  }, [recording]);

  /* ------------------------------------------------------- what we have got */

  /** The take is the store's notes, full stop. It used to be a quantised view
   *  of them, which meant Preview and Place could differ from what the roll
   *  was drawing — see `quantizeNotes` for why that had to stop. */
  const take = notes;
  const duration = notesDuration(take);

  /* --------------------------------------------------------------- preview */

  const previewTimer = useRef<{ done: ReturnType<typeof setTimeout>; player: Voice } | null>(null);

  const preview = (): void => {
    if (!take.length) return;
    void unmuteAudio();
    // Its own voice, disposed when the preview ends: sharing the live one
    // would mean a key pressed mid-preview releases a scheduled note.
    const player = liveVoice(instrument);
    // A lead of a beat or so, because a note scheduled for a time that has
    // already passed is dropped rather than played late.
    const from = nowS() + 0.1;
    for (const n of take) player.play(n.note, n.duration_s, from + n.start_s, n.velocity);
    setPreviewing(true);
    previewTimer.current = {
      player,
      done: setTimeout(
        () => {
          previewTimer.current = null;
          player.dispose();
          setPreviewing(false);
        },
        (duration + 1.5) * 1000,
      ),
    };
  };

  const stopPreview = useCallback(() => {
    const running = previewTimer.current;
    previewTimer.current = null;
    if (running === null) return;
    clearTimeout(running.done);
    running.player.dispose();
    setPreviewing(false);
  }, []);
  useEffect(() => stopPreview, [stopPreview]);

  /* ---------------------------------------------------------------- import */

  const importFile = async (file: File): Promise<void> => {
    try {
      const parsed = parseMidiFile(await file.arrayBuffer());
      setNotes(parsed);
      toast.success(
        `${parsed.length} ${parsed.length === 1 ? "note" : "notes"}, ${formatDuration(notesDuration(parsed))} — ${file.name}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That file could not be read");
    }
  };

  /* --------------------------------------------------------------- mapping */

  /** Where each bound control last sat, so a trigger fires on the edge rather
   *  than on every message of a knob sweep. See `dispatchMidi`. */
  const controlState = useRef(new Map<MidiTargetId, number>());

  const runTarget = (target: MidiTargetId): void => {
    if (readOnly) return;
    void unmuteAudio();
    switch (target) {
      case "record":
        if (recording) stopRecording();
        else startRecording();
        return;
      case "preview":
        if (previewing) stopPreview();
        else preview();
        return;
      case "clear":
        // Guarded the same way the buttons are: a pad that wipes a take
        // mid-performance is a pad nobody wants under their left hand.
        if (!recording && notes.length) {
          clearNotes();
          held.current.clear();
        }
        return;
      case "quantise":
        if (!recording && notes.length) quantizeNotes(Number(grid));
        return;
      case "octaveDown":
        setOctave((o) => Math.max(0, o - 1));
        return;
      case "octaveUp":
        setOctave((o) => Math.min(7, o + 1));
        return;
      case "placeDry":
        if (!recording) void place(null);
        return;
      case "generate":
        if (!recording && canCover && prompt.trim()) {
          void place({ prompt: prompt.trim(), strength });
        }
        return;
      default:
        return;
    }
  };

  /**
   * Every MIDI message, before the keyboard sees it.
   *
   * Learn comes first and swallows the message whole — a pad being bound must
   * not also sound, or setting up a mapping leaves stray notes in the take.
   * After that the dispatcher gets a look, and anything it does not claim
   * falls through to the notes, which is what keeps an unmapped board
   * behaving exactly as it did before any of this existed.
   */
  const onAnyMidi = (message: MidiMessage): boolean => {
    if (learning !== null) {
      const binding = bindingFor(message);
      // Not every message can be bound — a note-off, a knob at zero. Consume
      // it anyway and keep waiting, rather than letting a release through as
      // a note while Learn is armed.
      if (binding !== null) {
        mapping.bind(learning, binding);
        setLearning(null);
      }
      return true;
    }
    return dispatchMidi(mapping.map, message, controlState.current, {
      onHold: (target, down) => {
        if (target === "sustain") setSustain(down);
      },
      onTrigger: runTarget,
      onRange: (target, value) => {
        if (readOnly) return;
        // The slider's own range, not 0-1: the take's strength floor is 0.2,
        // and a knob that spent a fifth of its travel doing nothing would
        // read as a dead knob.
        if (target === "strength") setStrength(0.2 + value * 0.8);
        else if (target === "bpm") setBpm(Math.round(20 + value * 220));
      },
    });
  };

  const midi = useMidiInput({ onNoteOn: noteOn, onNoteOff: noteOff, onAny: onAnyMidi });

  // A pedal held when the panel closes, or when MIDI drops, would leave every
  // note under it ringing with nothing left to release them.
  useEffect(() => () => setSustain(false), [setSustain]);

  /* -------------------------------------------------------------- keyboard */

  const { white, black } = keyboardNotes(12 * (octave + 1));

  /** QWERTY, scoped to the keyboard region rather than the window.
   *
   *  The timeline owns bare letters — S splits, M mutes — and a window
   *  listener here would fire alongside them, so playing a note would also
   *  cut a clip in half. Focus is the scope: the region has to be clicked
   *  into, and while it holds focus its keys are notes and nothing else. */
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const step = QWERTY[event.key.toLowerCase()];
    if (step === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    noteOn(12 * (octave + 1) + step, 0.8);
  };
  const onKeyUp = (event: React.KeyboardEvent): void => {
    const step = QWERTY[event.key.toLowerCase()];
    if (step === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    noteOff(12 * (octave + 1) + step);
  };

  const keyProps = (note: number) => ({
    onPointerDown: (event: React.PointerEvent) => {
      event.preventDefault();
      // Capture keeps the release on this key when the pointer slides off it,
      // which on a row of narrow keys it will. An optimisation, not the
      // gesture — a browser that refuses it still gets a playable keyboard
      // via onPointerLeave, so a refusal must not take the note with it.
      try {
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        /* no capture available */
      }
      noteOn(note, 0.8);
    },
    onPointerUp: () => noteOff(note),
    onPointerCancel: () => noteOff(note),
    // Sliding off a key has to release it, or a dragged finger leaves a note
    // hanging until the panel unmounts.
    onPointerLeave: () => {
      if (down.has(note)) noteOff(note);
    },
  });

  const disabled = readOnly;

  return (
    <div className="flex min-h-0 flex-col gap-3 px-3 pb-3">
      {/* ------------------------------------------------------- the controls */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label className="text-muted-foreground text-[0.7rem]">Quantise to</Label>
          <Select value={grid} onValueChange={setGrid} disabled={disabled}>
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Seconds, not note values: there is no tempo here to divide.
                  A take played to no click has no bar line to snap to, and
                  offering "1/8" without one would be a lie about what the
                  grid is. */}
              <SelectItem value="0.25">0.25s</SelectItem>
              <SelectItem value="0.125">0.125s</SelectItem>
              <SelectItem value="0.0625">0.0625s</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !notes.length || recording}
          onClick={() => quantizeNotes(Number(grid))}
        >
          <MagnetIcon />
          Quantise
        </Button>

        <Button
          size="sm"
          variant={recording ? "destructive" : "outline"}
          disabled={disabled}
          onClick={() => (recording ? stopRecording() : startRecording())}
        >
          {recording ? <SquareIcon /> : <CircleIcon />}
          {recording ? `Stop · ${elapsed.toFixed(1)}s` : "Record"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !take.length}
          onClick={() => (previewing ? stopPreview() : preview())}
        >
          {previewing ? <SquareIcon /> : <PlayIcon />}
          {previewing ? "Stop" : "Preview"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !notes.length || recording}
          onClick={() => {
            clearNotes();
            held.current.clear();
          }}
        >
          <Trash2Icon />
          Clear
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
        >
          <UploadIcon />
          Import
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".mid,.midi,audio/midi"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so picking the same file twice in a row still fires.
            event.target.value = "";
            if (file) void importFile(file);
          }}
        />

        <Button
          size="sm"
          variant="outline"
          // Not gated on readOnly: saving a copy changes nothing here.
          disabled={!notes.length || recording}
          onClick={() => {
            const count = exportTake();
            if (count) toast.success(`Saved take.mid — ${count} ${count === 1 ? "note" : "notes"}`);
          }}
        >
          <DownloadIcon />
          Export
        </Button>

      </div>

      {/* ---------------------------------------------------------- the roll */}
      <TakeStrip notes={take} recording={recording} />

      <TakeActions
        playheadS={playheadS}
        readOnly={readOnly}
        canCover={canCover}
        onPlace={onPlace}
        // A take is only half played while the recorder is running, and
        // rendering half a performance is not a thing anyone means to do.
        busy={recording}
      />

      {/* ------------------------------------------------------ the keyboard */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            size="icon-xs"
            variant="outline"
            aria-label="Octave down"
            disabled={octave <= 0}
            onClick={() => setOctave((o) => Math.max(0, o - 1))}
          >
            −
          </Button>
          <span className="text-muted-foreground w-8 text-center text-xs tabular-nums">
            C{octave}
          </span>
          <Button
            size="icon-xs"
            variant="outline"
            aria-label="Octave up"
            disabled={octave >= 7}
            onClick={() => setOctave((o) => Math.min(7, o + 1))}
          >
            +
          </Button>
        </div>

        {/* The MIDI device, or an honest account of why there isn't one. */}
        {midi.state === "unsupported" ? (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <KeyboardIcon className="size-3" aria-hidden="true" />
            No Web MIDI here — play on screen
          </span>
        ) : midi.state === "granted" ? (
          midi.inputs.length ? (
            <Select
              value={midi.inputId ?? "all"}
              onValueChange={(v) => midi.setInputId(v === "all" ? null : v)}
            >
              <SelectTrigger size="sm" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All MIDI inputs</SelectItem>
                {midi.inputs.map((port) => (
                  <SelectItem key={port.id} value={port.id}>
                    {port.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-muted-foreground text-xs">
              Connected — no MIDI devices found
            </span>
          )
        ) : midi.blocked ? (
          // No button. Chrome rejects `requestMIDIAccess` for a blocked origin
          // without prompting, so "Retry" was a control that could not
          // possibly work — the only way back is the site setting, and saying
          // so is more use than offering the click again.
          <span className="text-muted-foreground text-xs">
            Blocked for this site — allow MIDI devices in the padlock menu in
            the address bar, then reload.
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={midi.state === "connecting"}
            onClick={() => void midi.connect()}
          >
            <PlugIcon />
            {midi.state === "connecting"
              ? "Connecting…"
              : midi.state === "denied"
                ? "Retry MIDI"
                : "Connect MIDI"}
          </Button>
        )}
        {midi.error && !midi.blocked && (
          <span className="text-destructive text-xs">{midi.error}</span>
        )}

        <Button
          size="sm"
          variant={showMapping ? "secondary" : "ghost"}
          className="ml-auto"
          aria-expanded={showMapping}
          onClick={() => {
            setShowMapping((open) => !open);
            setLearning(null);
          }}
        >
          <SlidersHorizontalIcon />
          Mapping
        </Button>
      </div>

      {showMapping && (
        <MidiMappingPanel
          mapping={mapping}
          learning={learning}
          onLearn={setLearning}
          connected={midi.state === "granted"}
        />
      )}

      <div
        tabIndex={0}
        role="application"
        aria-label="On-screen keyboard — click a key, or focus this and use your computer keyboard"
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        className="focus-visible:ring-ring/50 relative h-24 touch-none rounded-lg outline-none focus-visible:ring-2"
      >
        <div className="flex h-full gap-px">
          {white.map((note) => (
            <button
              key={note}
              type="button"
              tabIndex={-1}
              aria-label={noteLabel(note)}
              className={cn(
                "border-border/70 flex flex-1 items-end justify-center rounded-b-md border pb-1 text-[0.6rem] transition-colors",
                down.has(note)
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted text-muted-foreground",
              )}
              {...keyProps(note)}
            >
              {note % 12 === 0 ? noteLabel(note) : ""}
            </button>
          ))}
        </div>

        {/* The black keys, drawn over the seams. Positioned as a percentage of
            the row so they stay on their seam at any panel width. */}
        <div className="pointer-events-none absolute inset-0 flex gap-px">
          {black.map((note, i) => (
            <div key={i} className="relative flex-1">
              {note !== null && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={noteLabel(note)}
                  className={cn(
                    "pointer-events-auto absolute top-0 -right-[18%] h-[62%] w-[36%] rounded-b-md border",
                    down.has(note)
                      ? "bg-primary border-primary"
                      : "bg-foreground border-foreground/60 hover:bg-foreground/80",
                  )}
                  {...keyProps(note)}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        The take is rendered dry and then covered, so the model is only ever
        asked for the timbre — the notes are already right.{" "}
        <span className="text-foreground">Generate instrument</span> places both
        the dry take and the cover of it, on two lanes, so you can solo between
        them. For the room, reach for the Reverb device rather than the prompt.
      </p>
    </div>
  );
}
