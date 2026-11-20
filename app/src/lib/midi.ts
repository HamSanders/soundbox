/**
 * Notes, and how they become audio.
 *
 * MIDI in the studio (experimental) answers one question: can a performance
 * played on a keyboard be turned into a violin in a large hall? Nothing in the model
 * catalogue takes notes as input — audio.cpp's models take text, or text plus
 * a source clip — so the answer is a two-stage flow, and this file is the
 * first stage:
 *
 *     notes ──▶ [synth, here] ──▶ neutral WAV ──▶ [ACE-Step cover] ──▶ violin
 *
 * The first arrow is deliberately *not* a model. Pitch and timing have to be
 * exactly right — that is the whole value the MIDI adds — and a generative
 * model asked to invent both is a model that will get one of them wrong. So
 * the notes are rendered by a plain synth, and the model is only ever asked
 * for timbre, over audio whose notes are already correct.
 *
 * Which is also why the presets below are bright and harmonically rich rather
 * than pretty. A cover pass conditions on what it is given: a sine wave hands
 * it almost no spectral detail to work from, a sawtooth through a filter hands
 * it a full harmonic series with an envelope. The dry render is not meant to
 * be listened to — it is meant to be conditioned on.
 *
 * Nothing is bundled. Real samples are an opt-in download: the VSCO 2
 * Community Edition instruments (CC0), played by `sampler.ts`. A sampled
 * source hands the cover pass a real instrument's spectrum and attack, so it
 * can keep the notes at a higher strength without them drifting. The synth
 * presets stay the default, and the fallback when samples are not installed.
 */

import * as Tone from "tone";

import { libraryId, loadInstrument, sampledVoice } from "@/lib/sampler";

/* --------------------------------------------------------------- notes */

/** One note, in seconds from the start of the take. */
export interface MidiNote {
  /** MIDI note number: 60 is middle C. */
  note: number;
  /** 0-1. What the key was hit at, passed through to the synth. */
  velocity: number;
  start_s: number;
  duration_s: number;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** `60` becomes `"C4"`. The octave numbering is the MIDI convention, where
 *  middle C is C4 — which is what a keyboard's own display will say. */
export function noteLabel(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

/** Whether the note is one of the five raised keys in its octave. */
export function isBlackKey(note: number): boolean {
  return NOTE_NAMES[note % 12]!.length === 2;
}

/** Equal temperament, A4 = 440. Tone can do this conversion itself, but doing
 *  it here keeps the note list a plain data structure that the piano roll and
 *  the file parser can both handle without importing an audio library. */
export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** Where the take ends: the last note's tail, not the last note's start. */
export function notesDuration(notes: MidiNote[]): number {
  return notes.reduce((end, n) => Math.max(end, n.start_s + n.duration_s), 0);
}

/**
 * Snap starts to a grid.
 *
 * Only the starts move; durations are left alone. Quantising both ends turns a
 * held chord into a stack of identical blocks and throws away the one thing a
 * human performance has that a step sequencer does not. Off by default,
 * because a cover pass follows the source's timing and a stiff source makes a
 * stiff violin.
 */
export function quantize(notes: MidiNote[], gridS: number): MidiNote[] {
  if (gridS <= 0) return notes;
  return notes.map((n) => ({ ...n, start_s: Math.round(n.start_s / gridS) * gridS }));
}

/* --------------------------------------------------------- instruments */

export interface InstrumentPreset {
  id: string;
  label: string;
  /** What it is for, in the panel's own words. */
  hint: string;
}

export const INSTRUMENTS: InstrumentPreset[] = [
  { id: "bowed", label: "Bowed", hint: "Slow attack, vibrato — strings and pads" },
  { id: "plucked", label: "Plucked", hint: "Short decay — guitar, harp, pizzicato" },
  { id: "keys", label: "Keys", hint: "Struck and decaying — piano, mallets" },
  { id: "reed", label: "Reed", hint: "Breathy and nasal — winds and brass" },
];

export const DEFAULT_INSTRUMENT = "bowed";

/** A built voice and the handle that tears it down. */
export interface Voice {
  /** Schedule a note. `atS` is on the current context's clock. */
  play: (note: number, durationS: number, atS: number, velocity: number) => void;
  /** Press and hold, for playing live — no scheduled release. */
  press: (note: number, velocity: number) => void;
  release: (note: number) => void;
  dispose: () => void;
}

/**
 * Build a voice on whatever Tone context is current.
 *
 * Called inside `Tone.Offline`'s callback for a render and on the live context
 * for monitoring, and it must not care which — Tone binds new nodes to the
 * context that is current when they are constructed, so the same function
 * serves both as long as it constructs everything and reaches for nothing.
 */
function buildVoice(instrumentId: string): Voice {
  const out = new Tone.Gain(0.5).toDestination();

  let synth: Tone.PolySynth;
  let colour: Tone.Filter;

  switch (instrumentId) {
    case "plucked": {
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.004, decay: 0.7, sustain: 0.04, release: 0.4 },
      });
      colour = new Tone.Filter({ type: "lowpass", frequency: 4200, rolloff: -12, Q: 1.2 });
      break;
    }
    case "keys": {
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.008, decay: 1.1, sustain: 0.18, release: 0.9 },
      });
      colour = new Tone.Filter({ type: "lowpass", frequency: 5200, rolloff: -12, Q: 0.7 });
      break;
    }
    case "reed": {
      synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2.005,
        modulationIndex: 9,
        oscillator: { type: "square" },
        envelope: { attack: 0.06, decay: 0.15, sustain: 0.8, release: 0.3 },
        modulation: { type: "sawtooth" },
        modulationEnvelope: { attack: 0.12, decay: 0.1, sustain: 0.7, release: 0.3 },
      });
      colour = new Tone.Filter({ type: "bandpass", frequency: 1400, rolloff: -12, Q: 0.6 });
      break;
    }
    default: {
      // Bowed. The slow attack is what makes it read as a bow rather than a
      // hammer, and the FM sideband is what gives the cover pass something
      // string-shaped to latch onto instead of a bare sawtooth.
      synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 5,
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.16, decay: 0.25, sustain: 0.85, release: 0.6 },
        modulation: { type: "square" },
        modulationEnvelope: { attack: 0.3, decay: 0.1, sustain: 0.9, release: 0.5 },
      });
      colour = new Tone.Filter({ type: "lowpass", frequency: 3400, rolloff: -12, Q: 1 });
      break;
    }
  }

  // A little vibrato on everything: it costs nothing, and a dead-steady pitch
  // is the single most synthetic thing about a synthesised note.
  const vibrato = new Tone.Vibrato({
    frequency: 5.2,
    depth: instrumentId === "keys" ? 0.02 : 0.1,
  });

  synth.maxPolyphony = 24;
  synth.chain(colour, vibrato, out);

  return {
    play: (note, durationS, atS, velocity) => {
      synth.triggerAttackRelease(midiToFreq(note), Math.max(0.04, durationS), atS, velocity);
    },
    press: (note, velocity) => {
      synth.triggerAttack(midiToFreq(note), undefined, velocity);
    },
    release: (note) => {
      synth.triggerRelease(midiToFreq(note));
    },
    dispose: () => {
      synth.dispose();
      colour.dispose();
      vibrato.dispose();
      out.dispose();
    },
  };
}

/**
 * A voice on the live context, for hearing what you are playing.
 *
 * Recording MIDI you cannot hear is recording blind, so this is not optional
 * garnish. It is separate from the render path only in lifetime: the live one
 * is held open across presses, the render's exists for one offline pass.
 */
export function liveVoice(instrumentId: string): Voice {
  const id = libraryId(instrumentId);
  return id ? liveSampledVoice(id) : buildVoice(instrumentId);
}

/**
 * A sampled voice for playing live, which has to answer the first key at once.
 *
 * The whole instrument is loaded in the background, and until it arrives (or
 * if it never does: not installed, server gone) keys sound on the bowed synth.
 * Each call is routed when it is made, so a preview scheduled before the
 * samples land plays on whichever voice was ready at that moment.
 */
function liveSampledVoice(id: string): Voice {
  const fallback = buildVoice(DEFAULT_INSTRUMENT);
  let sampled: Voice | null = null;
  let disposed = false;
  void loadInstrument(id)
    .then((loaded) => {
      if (!disposed) sampled = sampledVoice(loaded);
    })
    .catch(() => {
      // Stays on the synth. The render says why when it is asked to place.
    });
  const current = (): Voice => sampled ?? fallback;
  return {
    play: (...args) => current().play(...args),
    press: (...args) => current().press(...args),
    // Release on both: a key pressed on the synth and let go after the
    // samples arrived must still stop.
    release: (note) => {
      fallback.release(note);
      sampled?.release(note);
    },
    dispose: () => {
      disposed = true;
      fallback.dispose();
      sampled?.dispose();
    },
  };
}

/** The live context's clock, for scheduling a preview against. Exported so
 *  callers can schedule without importing Tone themselves — the note list is
 *  otherwise the only thing they need to know about. */
export function nowS(): number {
  return Tone.now();
}

/** Resume the shared audio context, which browsers keep suspended until a
 *  gesture. Safe to call on every press. */
export async function unmuteAudio(): Promise<void> {
  if (Tone.getContext().state !== "running") await Tone.start();
}

/**
 * Render notes to audio, offline and faster than real time.
 *
 * `tailS` past the last release, because a release is part of the note and a
 * buffer that ends at the last note-off chops every one of them.
 */
export async function renderNotes(
  notes: MidiNote[],
  instrumentId: string,
  tailS = 1.5,
): Promise<AudioBuffer> {
  if (!notes.length) throw new Error("There are no notes to render.");
  const duration = notesDuration(notes) + tailS;

  // Loaded before the offline pass: Tone.Offline's callback schedules
  // synchronously, so every sample has to be decoded by the time it runs.
  // Throws SamplesUnavailable when the instrument is not installed.
  const id = libraryId(instrumentId);
  const loaded = id ? await loadInstrument(id, notes) : null;

  const rendered = await Tone.Offline(
    () => {
      const voice = loaded ? sampledVoice(loaded) : buildVoice(instrumentId);
      for (const n of notes) voice.play(n.note, n.duration_s, n.start_s, n.velocity);
      // Not disposed: the nodes have to still exist while the offline context
      // renders through them, and the context is discarded wholesale after.
    },
    duration,
    2,
    44100,
  );

  return normalize(rendered.get() as AudioBuffer);
}

/**
 * Bring the render up to a fixed peak.
 *
 * A polyphonic passage sums to several times the level of a single held note,
 * so an un-normalised render's loudness is a function of how many notes happen
 * to overlap — one line lands around -16 dBFS, a chord around -6. That is a
 * problem specifically because of what happens next: a cover pass conditions
 * on the audio it is given, and a quiet source is a source with less of it
 * above the model's noise floor. Normalising makes the hand-off the same
 * every time instead of a property of the take.
 *
 * -3 dBFS, not 0: the clip is going to be summed with others on a lane, and
 * the timeline's own mixdown has nowhere to put a clip that is already at the
 * ceiling.
 */
function normalize(buffer: AudioBuffer, targetPeak = 0.707): AudioBuffer {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const level = Math.abs(data[i]!);
      if (level > peak) peak = level;
    }
  }
  // Silence has no peak to scale, and a take quieter than this is quiet
  // because it was played that way.
  if (peak < 1e-4) return buffer;

  const gain = targetPeak / peak;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] = data[i]! * gain;
  }
  return buffer;
}

/* ------------------------------------------------------ standard MIDI file */

/**
 * Parse a `.mid` into a flat note list.
 *
 * Every track is merged into one: the timeline's own tracks are where
 * separation belongs, and an import that stops to ask "which of these sixteen
 * tracks did you mean" has spent its effort on a dialog.
 *
 * Tempo changes are honoured, because a file exported from notation software
 * routinely has them and ignoring them puts every note after the first change
 * in the wrong place.
 */
export function parseMidiFile(bytes: ArrayBuffer): MidiNote[] {
  const view = new DataView(bytes);
  let pos = 0;

  const ascii = (n: number): string => {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(pos + i));
    pos += n;
    return s;
  };
  const u32 = (): number => {
    const v = view.getUint32(pos);
    pos += 4;
    return v;
  };
  const u16 = (): number => {
    const v = view.getUint16(pos);
    pos += 2;
    return v;
  };
  /** A variable-length quantity: seven bits per byte, high bit continues. */
  const vlq = (): number => {
    let value = 0;
    for (;;) {
      const b = view.getUint8(pos++);
      value = (value << 7) | (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
  };

  if (ascii(4) !== "MThd") throw new Error("That does not look like a MIDI file.");
  const headerLength = u32();
  u16(); // format — 0, 1 and 2 all merge to the same flat list here
  const trackCount = u16();
  const division = u16();
  pos += headerLength - 6;

  if (division & 0x8000) {
    // SMPTE timing, frames per second in the high byte. Vanishingly rare
    // outside film scoring, and guessing at it would put every note in the
    // wrong place silently — worse than saying so.
    throw new Error(
      "SMPTE-timed MIDI files aren't supported. Export with ticks-per-beat timing.",
    );
  }
  const ticksPerBeat = division;

  /** Every note and tempo change from every track, in absolute ticks. */
  interface MidiEvent {
    tick: number;
    kind: "on" | "off" | "tempo";
    note: number;
    velocity: number;
    /** Microseconds per beat, for a tempo event. */
    tempo: number;
  }
  const events: MidiEvent[] = [];

  for (let t = 0; t < trackCount && pos < view.byteLength; t++) {
    if (ascii(4) !== "MTrk") break;
    const trackBytes = u32();
    const end = pos + trackBytes;
    let tick = 0;
    let status = 0;

    while (pos < end) {
      tick += vlq();

      const peek = view.getUint8(pos);
      // A byte with the high bit clear is not a status byte: the previous one
      // is still in force. Running status is the normal encoding, not an edge
      // case, so a parser that ignores it fails on most real files.
      if (peek & 0x80) {
        status = peek;
        pos++;
      }
      const type = status & 0xf0;

      if (status === 0xff) {
        const meta = view.getUint8(pos++);
        const length = vlq();
        if (meta === 0x51 && length === 3) {
          const tempo =
            (view.getUint8(pos) << 16) | (view.getUint8(pos + 1) << 8) | view.getUint8(pos + 2);
          events.push({ tick, kind: "tempo", note: 0, velocity: 0, tempo });
        }
        pos += length;
      } else if (status === 0xf0 || status === 0xf7) {
        pos += vlq();
      } else if (type === 0x90 || type === 0x80) {
        const note = view.getUint8(pos++);
        const velocity = view.getUint8(pos++);
        // A note-on at velocity zero is a note-off. Plenty of hardware sends
        // only this form, so a parser that does not fold it leaves every note
        // held open forever.
        const on = type === 0x90 && velocity > 0;
        events.push({ tick, kind: on ? "on" : "off", note, velocity, tempo: 0 });
      } else if (type === 0xc0 || type === 0xd0) {
        pos += 1;
      } else {
        pos += 2;
      }
    }
    pos = end;
  }

  // Merge and walk, converting ticks to seconds as the tempo map goes by.
  // Note-offs sort ahead of note-ons at the same tick, so a repeated note
  // closes before it reopens instead of swallowing its own repeat.
  events.sort((a, b) => a.tick - b.tick || rank(a.kind) - rank(b.kind));

  const notes: MidiNote[] = [];
  const held = new Map<number, { start_s: number; velocity: number }>();
  let usPerBeat = 500_000; // 120bpm, the value assumed when a file says nothing
  let lastTick = 0;
  let seconds = 0;

  for (const event of events) {
    seconds += ((event.tick - lastTick) / ticksPerBeat) * (usPerBeat / 1e6);
    lastTick = event.tick;

    if (event.kind === "tempo") {
      usPerBeat = event.tempo;
    } else if (event.kind === "on") {
      held.set(event.note, { start_s: seconds, velocity: event.velocity / 127 });
    } else {
      const start = held.get(event.note);
      if (start) {
        held.delete(event.note);
        notes.push({
          note: event.note,
          velocity: start.velocity,
          start_s: start.start_s,
          duration_s: Math.max(0.04, seconds - start.start_s),
        });
      }
    }
  }

  if (!notes.length) throw new Error("That MIDI file has no notes in it.");
  notes.sort((a, b) => a.start_s - b.start_s);

  // Zero the take: a file whose first note is eight bars in would otherwise
  // land as eight bars of silence on the timeline.
  const offset = notes[0]!.start_s;
  return offset > 0 ? notes.map((n) => ({ ...n, start_s: n.start_s - offset })) : notes;
}

function rank(kind: "on" | "off" | "tempo"): number {
  return kind === "tempo" ? 0 : kind === "off" ? 1 : 2;
}

/**
 * Write a take as a Standard MIDI File, format 0: one track, channel 1.
 *
 * The other half of `parseMidiFile`, so a part played or drawn here can be
 * rendered by any instrument that reads `.mid` — a DAW, a sampler, a cloud
 * tool — and the WAV dragged back onto a lane.
 *
 * The take is stored in seconds, so the tempo is only a choice of grid: the
 * roll's BPM goes in as the file's tempo meta event, and every note lands at
 * the same time in seconds whatever the number is. Picking the roll's BPM
 * means the bars a DAW draws are the bars the roll drew.
 *
 * No CC 64. The recorder folds the sustain pedal into note lengths as it
 * records (a pedalled note is held until the pedal lifts), so the take has no
 * pedal events to write — the lengths already are the pedal.
 */
export function writeMidiFile(notes: MidiNote[], bpm: number, ppq = 480): Uint8Array {
  const ticksPerSecond = (bpm / 60) * ppq;
  const toTick = (s: number): number => Math.max(0, Math.round(s * ticksPerSecond));

  interface Out {
    tick: number;
    on: boolean;
    note: number;
    velocity: number;
  }
  const out: Out[] = [];

  // Same-pitch notes that overlap cannot both be open in a MIDI file: the
  // second note-on would be closed by the first note-off. Cut the earlier
  // one short where the later one starts, which is what a keyboard does too.
  const byPitch = new Map<number, MidiNote[]>();
  for (const n of notes) {
    const list = byPitch.get(n.note) ?? [];
    list.push(n);
    byPitch.set(n.note, list);
  }
  for (const [note, list] of byPitch) {
    list.sort((a, b) => a.start_s - b.start_s);
    list.forEach((n, i) => {
      const start = toTick(n.start_s);
      let end = Math.max(start + 1, toTick(n.start_s + n.duration_s));
      const next = list[i + 1];
      if (next) end = Math.max(start + 1, Math.min(end, toTick(next.start_s)));
      // Velocity 0 would read as a note-off, so the floor is 1.
      const velocity = Math.min(127, Math.max(1, Math.round(n.velocity * 127)));
      out.push({ tick: start, on: true, note, velocity });
      out.push({ tick: end, on: false, note, velocity: 64 });
    });
  }
  // Offs ahead of ons at the same tick, matching the parser's ordering.
  out.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on) || a.note - b.note);

  const track: number[] = [];
  const vlq = (value: number): void => {
    const bytes = [value & 0x7f];
    while ((value >>>= 7) > 0) bytes.unshift((value & 0x7f) | 0x80);
    track.push(...bytes);
  };

  const usPerBeat = Math.round(60_000_000 / bpm);
  vlq(0);
  track.push(0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff);
  // 4/4, which is what the roll's bar lines assume.
  vlq(0);
  track.push(0xff, 0x58, 0x04, 4, 2, 24, 8);

  let last = 0;
  for (const e of out) {
    vlq(e.tick - last);
    last = e.tick;
    track.push(e.on ? 0x90 : 0x80, e.note & 0x7f, e.velocity);
  }
  vlq(0);
  track.push(0xff, 0x2f, 0x00);

  const file = new Uint8Array(14 + 8 + track.length);
  const view = new DataView(file.buffer);
  const ascii = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) file[at + i] = s.charCodeAt(i);
  };
  ascii(0, "MThd");
  view.setUint32(4, 6);
  view.setUint16(8, 0); // format 0
  view.setUint16(10, 1); // one track
  view.setUint16(12, ppq);
  ascii(14, "MTrk");
  view.setUint32(18, track.length);
  file.set(track, 22);
  return file;
}
