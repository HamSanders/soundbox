/**
 * The piano roll — the take as something you can edit, not just watch.
 *
 * The MIDI panel plays notes in; this is where they get fixed. It is the
 * layout every roll has had since Cubase: a keyboard down the left edge, pitch
 * on the vertical, time across the horizontal, and notes as bars you grab. The
 * shape is not a style choice — it is the one that makes "that note is a
 * semitone flat and an eighth late" a thing you can see and then drag.
 *
 * Both halves read `midi-store`, so the notes here are the notes the recorder
 * captured and the notes Place will render. There is no import/export between
 * the two panels because there are not two documents; the header's export
 * button saves the take as a `.mid` for use outside the app.
 *
 * Gestures, deliberately the timeline's rather than a second vocabulary:
 *
 * | Gesture                  | What it does                              |
 * | ------------------------ | ----------------------------------------- |
 * | Drag on empty grid       | Draw a note; keep dragging to set length  |
 * | Drag a note              | Move it in time and pitch                 |
 * | Drag its right edge      | Change its length                         |
 * | `Delete` / `Backspace`   | Remove the selected note                  |
 * | Right-click a note       | Remove it where your hand already is      |
 * | Hold `Alt`               | Defeat snapping                           |
 *
 * Unlike the timeline, the grid here is in bars and beats, because a roll is
 * where you would go to make a phrase line up — which needs a tempo to line up
 * *to*. The recorder stays in seconds; a take played to no click has no beat.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DownloadIcon, Trash2Icon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { toast } from "sonner";
import { exportTake, useMidiStore } from "@/lib/midi-store";
import type { RollNote } from "@/lib/midi-store";
import { isBlackKey, liveVoice, noteLabel, unmuteAudio } from "@/lib/midi";
import type { Voice } from "@/lib/midi";
import { cn } from "@/lib/utils";
import { TakeActions } from "@/components/take-actions";
import type { TakeActionsProps } from "@/components/take-actions";

/** The drawn pitch range, C2 to C7. Five octaves covers anything played on a
 *  two-octave on-screen keyboard shifted around, without making the scroller
 *  ten thousand pixels tall. */
const LOW = 36;
const HIGH = 96;
const ROW_H = 14;
/** Width of the keyboard gutter. Wide enough for "C#4" at this size. */
const GUTTER = 52;
/** Height of the bar ruler across the top of the grid. */
const RULER_H = 16;
/** How close to a note's right edge counts as reaching for the length rather
 *  than for the note. */
const EDGE_PX = 7;

const ZOOMS = [24, 36, 52, 76, 110, 160];

interface Drag {
  kind: "move" | "resize" | "create";
  id: string;
  pointerId: number;
  /** Where the pointer went down, in grid pixels. */
  originX: number;
  originY: number;
  /** The note as it was when the drag started. */
  fromStart: number;
  fromDuration: number;
  fromNote: number;
  /** The last pitch previewed, so a move only makes a sound when it changes. */
  heard: number;
}

/* --------------------------------------------------------------- the header */

/** The roll's controls. Split out because the artifact stack owns the header
 *  this sits in — same division as the device rack's lane picker. */
export function PianoRollTitle() {
  const bpm = useMidiStore((s) => s.bpm);
  const setBpm = useMidiStore((s) => s.setBpm);
  const noteCount = useMidiStore((s) => s.notes.length);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="text-sm font-semibold">Piano roll</span>
      <div className="flex items-center gap-1.5">
        <Label htmlFor="roll-bpm" className="text-muted-foreground text-[0.7rem]">
          BPM
        </Label>
        <Input
          id="roll-bpm"
          type="number"
          min={20}
          max={240}
          value={bpm}
          onChange={(event) => setBpm(Number(event.target.value))}
          className="h-6 w-16 px-1.5 text-xs"
        />
      </div>
      <span className="text-muted-foreground truncate text-xs">
        {noteCount === 0 ? "empty" : `${noteCount} ${noteCount === 1 ? "note" : "notes"}`}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Export take as .mid"
        title="Export take as .mid"
        disabled={noteCount === 0}
        onClick={() => {
          const count = exportTake();
          if (count) toast.success(`Saved take.mid — ${count} ${count === 1 ? "note" : "notes"}`);
        }}
      >
        <DownloadIcon />
      </Button>
    </div>
  );
}

/* ----------------------------------------------------------------- the roll */

export function PianoRoll({
  playheadS,
  readOnly = false,
  canCover = false,
  onPlace,
}: TakeActionsProps) {
  const notes = useMidiStore((s) => s.notes);
  const bpm = useMidiStore((s) => s.bpm);
  const instrument = useMidiStore((s) => s.instrument);
  const selectedId = useMidiStore((s) => s.selectedId);
  const select = useMidiStore((s) => s.select);
  const addNotes = useMidiStore((s) => s.addNotes);
  const updateNote = useMidiStore((s) => s.updateNote);
  const removeNote = useMidiStore((s) => s.removeNote);

  const [pxPerBeat, setPxPerBeat] = useState(52);
  const [snap, setSnap] = useState("0.25");

  const secPerBeat = 60 / bpm;
  const pxPerSecond = pxPerBeat / secPerBeat;

  /** How wide the grid has to be: past the last note, and never less than the
   *  panel — an empty roll you cannot draw into is not a roll. */
  const beatsWide = useMemo(() => {
    const lastBeat = notes.reduce(
      (end, n) => Math.max(end, (n.start_s + n.duration_s) / secPerBeat),
      0,
    );
    return Math.max(32, Math.ceil(lastBeat / 4) * 4 + 8);
  }, [notes, secPerBeat]);

  const width = beatsWide * pxPerBeat;
  const height = (HIGH - LOW + 1) * ROW_H;

  /* -------------------------------------------------------------- previewing */

  /** A voice for hearing an edit. Built on the first gesture rather than on
   *  mount, because a panel that opens an AudioContext just by existing is a
   *  panel the browser warns about. */
  const voice = useRef<Voice | null>(null);
  const hear = useCallback(
    (note: number, durationS: number) => {
      void unmuteAudio();
      voice.current ??= liveVoice(instrument);
      voice.current.play(note, Math.min(0.4, durationS), 0, 0.8);
    },
    [instrument],
  );
  // The voice belongs to the instrument it was built for; changing it has to
  // throw the old one away or the roll keeps auditioning the previous sound.
  useEffect(() => {
    voice.current?.dispose();
    voice.current = null;
  }, [instrument]);
  useEffect(
    () => () => {
      voice.current?.dispose();
      voice.current = null;
    },
    [],
  );

  /* ---------------------------------------------------------------- geometry */

  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const snapS = Number(snap) * secPerBeat;
  const quantise = (seconds: number, defeat: boolean): number =>
    defeat || snapS <= 0 ? Math.max(0, seconds) : Math.max(0, Math.round(seconds / snapS) * snapS);

  /** Pointer position in grid coordinates, which is what every gesture is
   *  measured in — the scroller's own offset is already inside `getBoundingClientRect`. */
  const pointAt = (event: React.PointerEvent): { x: number; y: number } => {
    const box = grid.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const noteAtY = (y: number): number =>
    Math.min(HIGH, Math.max(LOW, HIGH - Math.floor(y / ROW_H)));

  /* ---------------------------------------------------------------- gestures */

  const onGridPointerDown = (event: React.PointerEvent): void => {
    if (readOnly || event.button !== 0) return;
    const { x, y } = pointAt(event);
    const start = quantise(x / pxPerSecond, event.altKey);
    const note = noteAtY(y);
    // A new note is one grid step long, and stays under the pointer as a
    // resize — so click-and-release draws a step, and click-and-drag draws
    // exactly as long as you dragged, without them being two gestures.
    const [created] = addNotes([
      { note, velocity: 0.8, start_s: start, duration_s: snapS > 0 ? snapS : 0.25 },
    ]);
    if (!created) return;
    select(created.id);
    hear(note, 0.3);
    drag.current = {
      kind: "create",
      id: created.id,
      pointerId: event.pointerId,
      originX: x,
      originY: y,
      fromStart: start,
      fromDuration: created.duration_s,
      fromNote: note,
      heard: note,
    };
    capture(event);
  };

  const onNotePointerDown = (event: React.PointerEvent, note: RollNote): void => {
    if (readOnly || event.button !== 0) return;
    // The note handles its own gesture; without this the grid underneath also
    // starts drawing a new one.
    event.stopPropagation();
    const { x, y } = pointAt(event);
    const right = (note.start_s + note.duration_s) * pxPerSecond;
    select(note.id);
    drag.current = {
      kind: right - x <= EDGE_PX ? "resize" : "move",
      id: note.id,
      pointerId: event.pointerId,
      originX: x,
      originY: y,
      fromStart: note.start_s,
      fromDuration: note.duration_s,
      fromNote: note.note,
      heard: note.note,
    };
    capture(event);
  };

  const capture = (event: React.PointerEvent): void => {
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* no capture available; the move handlers still fire on the grid */
    }
  };

  const onPointerMove = (event: React.PointerEvent): void => {
    const active = drag.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    const { x, y } = pointAt(event);

    if (active.kind === "move") {
      const moved = (x - active.originX) / pxPerSecond;
      const note = Math.min(
        HIGH,
        Math.max(LOW, active.fromNote - Math.round((y - active.originY) / ROW_H)),
      );
      updateNote(active.id, {
        start_s: quantise(active.fromStart + moved, event.altKey),
        note,
      });
      // Only on a change of pitch: a horizontal drag that retriggered on every
      // frame would be a machine gun.
      if (note !== active.heard) {
        active.heard = note;
        hear(note, 0.3);
      }
      return;
    }

    // Both "resize" and "create" pull the right edge; they differ only in what
    // happened on the way in.
    const end = quantise(x / pxPerSecond, event.altKey);
    const minimum = snapS > 0 ? snapS : 0.05;
    updateNote(active.id, {
      duration_s: Math.max(minimum, end - active.fromStart),
    });
  };

  const onPointerUp = (event: React.PointerEvent): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (readOnly || selectedId === null) return;
    const note = notes.find((n) => n.id === selectedId);
    if (!note) return;

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      removeNote(selectedId);
      return;
    }
    // Arrows nudge, because a note that is one semitone out should not need a
    // steady hand. Shift is the coarse version, as it is everywhere else.
    const semitones = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    const steps = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (semitones === 0 && steps === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (semitones !== 0) {
      const next = Math.min(HIGH, Math.max(LOW, note.note + semitones * (event.shiftKey ? 12 : 1)));
      updateNote(selectedId, { note: next });
      hear(next, 0.3);
    } else {
      const step = (snapS > 0 ? snapS : 0.25) * (event.shiftKey ? 4 : 1);
      updateNote(selectedId, { start_s: Math.max(0, note.start_s + steps * step) });
    }
  };

  /* ------------------------------------------------------------------ render */

  const rows = [];
  for (let note = HIGH; note >= LOW; note--) rows.push(note);

  const bars = Math.ceil(beatsWide / 4);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
      {/* ------------------------------------------------------ grid controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="roll-snap" className="text-muted-foreground text-[0.7rem]">
            Snap
          </Label>
          <Select value={snap} onValueChange={setSnap}>
            <SelectTrigger id="roll-snap" size="sm" className="h-7 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Off</SelectItem>
              <SelectItem value="1">1/4</SelectItem>
              <SelectItem value="0.5">1/8</SelectItem>
              <SelectItem value="0.25">1/16</SelectItem>
              <SelectItem value="0.125">1/32</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon-xs"
            variant="outline"
            aria-label="Zoom out"
            disabled={pxPerBeat <= ZOOMS[0]!}
            onClick={() =>
              setPxPerBeat((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)] ?? z)
            }
          >
            <ZoomOutIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="outline"
            aria-label="Zoom in"
            disabled={pxPerBeat >= ZOOMS[ZOOMS.length - 1]!}
            onClick={() =>
              setPxPerBeat((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)] ?? z)
            }
          >
            <ZoomInIcon />
          </Button>
          {/* Right-click and Delete remove a note; a touch screen has
              neither, so the selected note gets a button there. */}
          <Button
            size="icon-xs"
            variant="outline"
            className="hidden pointer-coarse:inline-flex"
            aria-label="Delete note"
            disabled={readOnly || selectedId === null}
            onClick={() => selectedId !== null && removeNote(selectedId)}
          >
            <Trash2Icon />
          </Button>
        </div>
        <span className="text-muted-foreground text-xs">
          Drag to draw · drag a note&apos;s right edge to lengthen ·{" "}
          <kbd className="text-foreground">Alt</kbd> defeats snapping
        </span>
      </div>

      {/* --------------------------------------------------- keyboard and grid */}
      <div
        ref={scroller}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="border-border/70 focus-visible:ring-ring/50 relative min-h-0 flex-1 overflow-auto rounded-lg border outline-none focus-visible:ring-2"
      >
        <div className="relative flex" style={{ width: GUTTER + width }}>
          {/* The keyboard. Sticky rather than fixed, so it stays put while the
              grid scrolls under it and still scrolls away vertically with the
              rows it names. */}
          <div
            className="bg-background sticky left-0 z-20 shrink-0"
            style={{ width: GUTTER, height: height + RULER_H, paddingTop: RULER_H }}
          >
            {rows.map((note) => (
              <div
                key={note}
                onPointerDown={() => hear(note, 0.4)}
                className={cn(
                  "border-border/40 flex cursor-pointer items-center justify-end border-b pr-1 text-[0.6rem] select-none",
                  isBlackKey(note)
                    ? "bg-foreground text-background hover:bg-foreground/80"
                    : "bg-background text-muted-foreground hover:bg-muted",
                )}
                style={{ height: ROW_H }}
              >
                {note % 12 === 0 ? noteLabel(note) : ""}
              </div>
            ))}
          </div>

          <div className="relative" style={{ width }}>
            {/* The ruler, sticky to the top of the scroller. */}
            <div
              className="bg-background border-border/70 sticky top-0 z-10 border-b"
              style={{ height: RULER_H }}
            >
              {Array.from({ length: bars }, (_, bar) => (
                <div
                  key={bar}
                  className="text-muted-foreground absolute top-0 pl-1 text-[0.6rem] tabular-nums"
                  style={{ left: bar * 4 * pxPerBeat }}
                >
                  {bar + 1}
                </div>
              ))}
            </div>

            <div
              ref={grid}
              onPointerDown={onGridPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="relative touch-none"
              style={{
                height,
                // The rows and the bar lines are painted rather than made of
                // elements: five octaves by thirty-two beats is two thousand
                // divs that do nothing but have a background.
                backgroundImage: [
                  `repeating-linear-gradient(to bottom, var(--muted) 0 ${ROW_H}px, transparent ${ROW_H}px ${ROW_H * 2}px)`,
                  `repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px ${pxPerBeat}px)`,
                  `repeating-linear-gradient(to right, var(--muted-foreground) 0 1px, transparent 1px ${pxPerBeat * 4}px)`,
                ].join(","),
                backgroundSize: `100% ${ROW_H * 2}px, 100% 100%, 100% 100%`,
              }}
            >
              {notes.map((note) => {
                const selected = note.id === selectedId;
                return (
                  <div
                    key={note.id}
                    role="button"
                    tabIndex={-1}
                    aria-label={`${noteLabel(note.note)}, ${note.duration_s.toFixed(2)} seconds`}
                    onPointerDown={(event) => onNotePointerDown(event, note)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (!readOnly) removeNote(note.id);
                    }}
                    className={cn(
                      "absolute rounded-[3px] border",
                      // The right edge is the length handle, so it says so.
                      "cursor-grab active:cursor-grabbing",
                      selected
                        ? "border-foreground bg-primary"
                        : "border-primary/60 bg-primary/70 hover:bg-primary",
                    )}
                    style={{
                      left: note.start_s * pxPerSecond,
                      width: Math.max(3, note.duration_s * pxPerSecond),
                      top: (HIGH - note.note) * ROW_H + 1,
                      height: ROW_H - 2,
                      opacity: 0.5 + note.velocity * 0.5,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <TakeActions
        playheadS={playheadS}
        readOnly={readOnly}
        canCover={canCover}
        onPlace={onPlace}
      />
    </div>
  );
}
