/**
 * The take, as one document two panels share.
 *
 * The MIDI panel is a performance surface — press keys, notes arrive — and the
 * piano roll is an editing surface for the same notes. If each owned its own
 * list, playing a phrase and then fixing the one note you fluffed would mean
 * copying it between panels, which is not a workflow anyone would choose.
 *
 * So the notes, the instrument that renders them, and what to ask a model for
 * afterwards all live here, and both panels are views of it. Neither is
 * required: closing the roll leaves the recorder working, and vice versa.
 *
 * Not persisted itself. A take becomes a clip on the timeline the moment it is
 * worth keeping, and that clip stores the notes along with the WAV (`midi` on
 * the segment). "Edit notes" on such a clip loads them back in here with
 * `loadTake`, and while `source` is set, rendering replaces that take's clips
 * instead of placing new ones.
 */

import { create } from "zustand";

import { DEFAULT_INSTRUMENT, quantize, writeMidiFile } from "@/lib/midi";
import { saveBlob } from "@/lib/format";
import type { MidiNote } from "@/lib/midi";
import type { ClipMidi } from "@/lib/api";

/** The placed take the notes were loaded from, while they are being edited.
 *  Rendering then replaces that take's clips rather than placing new ones. */
export interface TakeSource {
  take_id: string;
  /** The clip "Edit notes" was chosen on — for saying which one, and as the
   *  fallback when the take's other clip has since been deleted. */
  segmentId: string;
  /** Its label on the timeline. */
  name: string;
}

/** A note plus the identity the roll needs to drag it. Notes arrive from a
 *  keyboard, a file and a mouse, and "the third one at 1.2s" stops being a
 *  stable way to refer to one the moment you move it. */
export interface RollNote extends MidiNote {
  id: string;
}

interface MidiState {
  notes: RollNote[];
  instrument: string;
  /** Only the roll's grid uses this — the recorder measures in seconds, since
   *  a take played to no click has no beat to be in. */
  bpm: number;
  /** What to ask a model for once the dry take is placed. */
  prompt: string;
  /** Cover strength: 1 follows the take closely, 0 invents. */
  strength: number;
  /** Which note the roll has selected, for keyboard edits and deletion. */
  selectedId: string | null;
  /** Set while the notes are a placed take being edited. */
  source: TakeSource | null;

  setInstrument: (id: string) => void;
  setBpm: (bpm: number) => void;
  setPrompt: (prompt: string) => void;
  setStrength: (strength: number) => void;
  select: (id: string | null) => void;

  /** Replace everything — an imported file, or a cleared take. Starts a new
   *  take: whatever clip was being edited is let go. */
  setNotes: (notes: MidiNote[]) => void;
  /** Open a placed clip's notes for editing: its notes, tempo, instrument and
   *  cover settings, with `source` pointing back at it. */
  loadTake: (midi: ClipMidi, source: TakeSource) => void;
  /** Stop editing the placed take; the notes stay, and the next render places
   *  a new clip. */
  detach: () => void;
  /** Append, keeping the list sorted. Live playing arrives in release order. */
  addNotes: (notes: MidiNote[]) => RollNote[];
  updateNote: (id: string, patch: Partial<MidiNote>) => void;
  removeNote: (id: string) => void;
  /**
   * Snap every note's start to a grid, in seconds.
   *
   * An edit, not a filter. It used to be a render-time setting on the
   * recorder, which was survivable while the notes were only ever drawn as a
   * strip — but the roll shows the notes themselves, and a roll showing one
   * thing while Place renders another is a roll you cannot trust. Applying it
   * to the take makes the roll the truth.
   */
  quantizeNotes: (gridS: number) => void;
  clear: () => void;
}

let counter = 0;
/** Ids are per-session and never leave the browser, so a counter is enough —
 *  and unlike a random id it stays readable in a React key. */
function withId(note: MidiNote): RollNote {
  counter += 1;
  return { ...note, id: `n${counter}` };
}

function sorted(notes: RollNote[]): RollNote[] {
  return [...notes].sort((a, b) => a.start_s - b.start_s || a.note - b.note);
}

export const useMidiStore = create<MidiState>((set) => ({
  notes: [],
  instrument: DEFAULT_INSTRUMENT,
  bpm: 100,
  // The thing this feature was built to make, and a worked example of the shape
  // that gets a usable cover: an instrument, how it is played, and the room —
  // not an adjective.
  prompt: "solo violin, warm vibrato, sustained bowing, large concert hall",
  strength: 0.8,
  selectedId: null,
  source: null,

  setInstrument: (instrument) => set({ instrument }),
  setBpm: (bpm) => set({ bpm: Math.min(240, Math.max(20, Math.round(bpm) || 100)) }),
  setPrompt: (prompt) => set({ prompt }),
  setStrength: (strength) => set({ strength }),
  select: (selectedId) => set({ selectedId }),

  setNotes: (notes) =>
    set({ notes: sorted(notes.map(withId)), selectedId: null, source: null }),
  loadTake: (midi, source) =>
    set((s) => ({
      notes: sorted(midi.notes.map(withId)),
      selectedId: null,
      instrument: midi.instrument,
      bpm: midi.bpm ?? s.bpm,
      prompt: midi.cover?.prompt || s.prompt,
      strength: midi.cover?.strength ?? s.strength,
      source,
    })),
  detach: () => set({ source: null }),
  addNotes: (notes) => {
    const added = notes.map(withId);
    set((s) => ({ notes: sorted([...s.notes, ...added]) }));
    return added;
  },
  updateNote: (id, patch) =>
    set((s) => ({
      notes: sorted(s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n))),
    })),
  removeNote: (id) =>
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),
  quantizeNotes: (gridS) =>
    set((s) =>
      gridS <= 0
        ? s
        : { notes: sorted(s.notes.map((n) => ({ ...n, ...quantizeOne(n, gridS) }))) },
    ),
  clear: () => set({ notes: [], selectedId: null, source: null }),
}));

/** `quantize` from lib/midi works on plain notes; this keeps the id. */
function quantizeOne(note: RollNote, gridS: number): { start_s: number } {
  return { start_s: quantize([note], gridS)[0]!.start_s };
}

/**
 * Save the take as `take.mid`, at the roll's tempo.
 *
 * Both panels offer this, so it reads the store rather than taking props.
 * The point is a round trip out of the app: render the part on an instrument
 * somewhere else, then drag the WAV back onto a lane. Returns the note count
 * for the caller's toast.
 */
export function exportTake(): number {
  const { notes, bpm } = useMidiStore.getState();
  if (!notes.length) return 0;
  const file = writeMidiFile(notes, bpm);
  saveBlob(new Blob([file as BlobPart], { type: "audio/midi" }), "take.mid");
  return notes.length;
}

/** What a clip keeps of the take as it stands now, minus the parts only the
 *  studio knows (which clip it is, and whether it was covered). Notes lose
 *  their roll ids, which are per-session. */
export function takeNotes(): Pick<ClipMidi, "notes" | "bpm" | "instrument"> {
  const { notes, bpm, instrument } = useMidiStore.getState();
  return {
    notes: notes.map(({ note, velocity, start_s, duration_s }) => ({
      note,
      velocity,
      start_s,
      duration_s,
    })),
    bpm,
    instrument,
  };
}
