/**
 * What the knobs, pads and pedal do.
 *
 * A 25-key controller is mostly not keys. It is four knobs, eight pads, a
 * couple of wheels, a pedal jack and a transport row, and until now every one
 * of those arrived at the panel and was thrown away — which is what made a
 * connected board feel like a broken one. This module is the layer that turns
 * "CC 74 on channel 1" into "cover strength".
 *
 * Two things make it tolerable to live with:
 *
 * - **Learn beats guessing.** Every target can be bound by wiggling the
 *   control you want, because no table of factory CC numbers survives contact
 *   with a controller whose knobs are re-assignable in its own editor app.
 *   The presets below are a starting point, not a claim.
 * - **The map is the user's, not the take's.** It is about the hardware on the
 *   desk, so it persists in `localStorage` and outlives every story, rather
 *   than living in the store next to the notes.
 *
 * Bindings are matched, not indexed: one control can drive one target, but
 * finding which is a scan over at most a dozen entries per message, and that
 * is cheaper than keeping a reverse index correct through Learn.
 */

import { useCallback, useEffect, useState } from "react";

import type { MidiMessage } from "@/hooks/use-midi-input";

/* --------------------------------------------------------------- targets */

export type MidiTargetId =
  | "sustain"
  | "record"
  | "preview"
  | "clear"
  | "quantise"
  | "placeDry"
  | "generate"
  | "octaveDown"
  | "octaveUp"
  | "strength"
  | "bpm";

/**
 * How a target reads its control.
 *
 * `trigger` fires once when a control crosses into "pressed", which is why
 * the dispatcher has to remember the previous value: a knob swept past the
 * middle would otherwise fire Record for every message on the way up.
 */
export type MidiTargetKind = "trigger" | "range" | "hold";

export interface MidiTarget {
  id: MidiTargetId;
  label: string;
  kind: MidiTargetKind;
  /** What it is for, in the row under the name. */
  hint: string;
}

/** In the order they are shown. Performance controls first: those are the
 *  ones worth reaching for without looking away from the keys. */
export const MIDI_TARGETS: MidiTarget[] = [
  {
    id: "sustain",
    label: "Sustain",
    kind: "hold",
    hint: "Hold notes after the key is released, like a piano pedal",
  },
  { id: "record", label: "Record", kind: "trigger", hint: "Start or stop the take" },
  { id: "preview", label: "Preview", kind: "trigger", hint: "Play the take back" },
  { id: "clear", label: "Clear", kind: "trigger", hint: "Throw the take away" },
  { id: "quantise", label: "Quantise", kind: "trigger", hint: "Snap the take to the grid" },
  { id: "octaveDown", label: "Octave −", kind: "trigger", hint: "Shift the on-screen keyboard down" },
  { id: "octaveUp", label: "Octave +", kind: "trigger", hint: "Shift the on-screen keyboard up" },
  { id: "placeDry", label: "Place dry", kind: "trigger", hint: "Put the take on a lane as it is" },
  {
    id: "generate",
    label: "Generate instrument",
    kind: "trigger",
    hint: "Place the take and cover it with the model",
  },
  {
    id: "strength",
    label: "Cover strength",
    kind: "range",
    hint: "How closely the cover follows the take",
  },
  { id: "bpm", label: "Roll tempo", kind: "range", hint: "The piano roll's grid, 20-240 BPM" },
];

export const MIDI_TARGET_BY_ID: Record<MidiTargetId, MidiTarget> = Object.fromEntries(
  MIDI_TARGETS.map((t) => [t.id, t]),
) as Record<MidiTargetId, MidiTarget>;

/* -------------------------------------------------------------- bindings */

/**
 * `channel: null` means any channel.
 *
 * Which is the default, and deliberately: controllers ship set to channel 1
 * but a board with several zones does not, and a mapping that silently
 * matches nothing because the pads are on channel 10 is the exact failure
 * this whole module exists to stop. Learn records the channel it saw, so it
 * can be narrowed by binding it; it is never narrowed by guessing.
 */
export type MidiBinding =
  | { type: "cc"; control: number; channel: number | null }
  | { type: "note"; note: number; channel: number | null }
  | { type: "bend" };

export type MidiMap = Partial<Record<MidiTargetId, MidiBinding>>;

export function bindingMatches(binding: MidiBinding, message: MidiMessage): boolean {
  switch (binding.type) {
    case "cc":
      return (
        message.kind === "cc" &&
        message.data1 === binding.control &&
        (binding.channel === null || binding.channel === message.channel)
      );
    case "note":
      return (
        (message.kind === "note-on" || message.kind === "note-off") &&
        message.data1 === binding.note &&
        (binding.channel === null || binding.channel === message.channel)
      );
    case "bend":
      return message.kind === "bend";
  }
}

export function bindingLabel(binding: MidiBinding): string {
  const channel = "channel" in binding && binding.channel !== null ? ` ch${binding.channel}` : "";
  switch (binding.type) {
    case "cc":
      return `CC ${binding.control}${channel}`;
    case "note":
      return `Note ${binding.note}${channel}`;
    case "bend":
      return "Pitch bend";
  }
}

/**
 * The binding a message would make, or null if it cannot make one.
 *
 * Note-*off* is refused rather than bound: releasing a pad would otherwise
 * bind the release, and the target would then fire on the wrong edge for the
 * rest of the session. Same for a CC arriving at zero — that is a knob at the
 * bottom of its travel or a button coming back up, and binding on it makes
 * Learn look like it missed.
 */
export function bindingFor(message: MidiMessage): MidiBinding | null {
  switch (message.kind) {
    case "cc":
      return message.data2 === 0
        ? null
        : { type: "cc", control: message.data1, channel: message.channel };
    case "note-on":
      return { type: "note", note: message.data1, channel: message.channel };
    case "bend":
      // Only when actually moved: a wheel resting at centre emits on release
      // and would bind whatever target was listening.
      return Math.abs(message.value) < 0.1 ? null : { type: "bend" };
    default:
      return null;
  }
}

/* --------------------------------------------------------------- layouts */

export interface MidiLayout {
  id: string;
  name: string;
  /** Shown under the picker. Says which half of the preset is a real
   *  standard and which half is a default worth checking. */
  note: string;
  map: MidiMap;
}

/**
 * The presets.
 *
 * Only three numbers in here are guaranteed by the MIDI spec itself — CC 1 is
 * the modulation wheel, CC 64 the damper pedal, CC 7 channel volume — and
 * those are the ones the "General MIDI" layout sticks to. Everything else is
 * convention, and convention is exactly what Learn is for. A preset that
 * claimed to know a re-assignable knob's CC number would be wrong for anyone
 * who had ever opened their controller's editor app.
 */
export const MIDI_LAYOUTS: MidiLayout[] = [
  {
    id: "general",
    name: "General MIDI",
    note: "Only the three controllers the MIDI spec actually fixes: mod wheel, volume and the damper pedal. Works on any board; leaves the pads and the rest of the knobs for Learn.",
    map: {
      sustain: { type: "cc", control: 64, channel: null },
      strength: { type: "cc", control: 1, channel: null },
      bpm: { type: "cc", control: 7, channel: null },
    },
  },
  {
    id: "mvave25",
    name: "M-Vave SMK-25 / 25 II",
    note: "Pedal and mod wheel are spec. The pads assume the usual 8-pad default of notes 36-43 from the bottom left, and the knobs assume the common CC 21-24 bank — both are re-assignable in M-Vave's own editor, so check the monitor below and hit Learn on anything that does not light up.",
    map: {
      sustain: { type: "cc", control: 64, channel: null },
      strength: { type: "cc", control: 21, channel: null },
      bpm: { type: "cc", control: 22, channel: null },
      // The eight pads, bottom row left to right then the top row.
      record: { type: "note", note: 36, channel: null },
      preview: { type: "note", note: 37, channel: null },
      clear: { type: "note", note: 38, channel: null },
      quantise: { type: "note", note: 39, channel: null },
      octaveDown: { type: "note", note: 40, channel: null },
      octaveUp: { type: "note", note: 41, channel: null },
      placeDry: { type: "note", note: 42, channel: null },
      generate: { type: "note", note: 43, channel: null },
    },
  },
  {
    id: "pedal",
    name: "Sustain pedal only",
    note: "Nothing but the damper pedal, for a board whose knobs you would rather leave alone.",
    map: { sustain: { type: "cc", control: 64, channel: null } },
  },
  {
    id: "none",
    name: "Nothing mapped",
    note: "Keys and wheels only. Start here and Learn what you want.",
    map: {},
  },
];

export const DEFAULT_LAYOUT_ID = "general";

/* ----------------------------------------------------------- persistence */

const STORAGE_KEY = "konchi.midi-map.v1";

interface StoredMap {
  layoutId: string;
  map: MidiMap;
}

function read(): StoredMap | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { layoutId, map } = parsed as StoredMap;
    if (typeof layoutId !== "string" || typeof map !== "object" || map === null) return null;
    return { layoutId, map };
  } catch {
    // A corrupt or unreadable entry is not worth a broken panel: the preset
    // below is a fine thing to fall back to, and saving over it fixes it.
    return null;
  }
}

function write(value: StoredMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private mode, or a full quota. The map still works for this session.
  }
}

export interface MidiMappingHook {
  layoutId: string;
  map: MidiMap;
  /** True once a binding differs from the chosen layout's own. */
  customised: boolean;
  chooseLayout: (id: string) => void;
  bind: (target: MidiTargetId, binding: MidiBinding) => void;
  unbind: (target: MidiTargetId) => void;
  /** Back to the chosen layout, dropping anything learned on top of it. */
  reset: () => void;
}

/** The map, persisted. One per browser, because it describes the desk. */
export function useMidiMapping(): MidiMappingHook {
  const [stored, setStored] = useState<StoredMap>(() => {
    const saved = read();
    if (saved !== null) return saved;
    const layout = MIDI_LAYOUTS.find((l) => l.id === DEFAULT_LAYOUT_ID)!;
    return { layoutId: layout.id, map: layout.map };
  });

  useEffect(() => write(stored), [stored]);

  const chooseLayout = useCallback((id: string) => {
    const layout = MIDI_LAYOUTS.find((l) => l.id === id);
    if (layout === undefined) return;
    setStored({ layoutId: layout.id, map: { ...layout.map } });
  }, []);

  const bind = useCallback((target: MidiTargetId, binding: MidiBinding) => {
    setStored((prev) => {
      // One control, one job. Binding a knob that already drives something
      // else takes it, rather than leaving two targets fighting over the
      // same message — which reads as "Learn did not work".
      const map: MidiMap = {};
      for (const [id, existing] of Object.entries(prev.map) as [MidiTargetId, MidiBinding][]) {
        if (id !== target && bindingKey(existing) !== bindingKey(binding)) map[id] = existing;
      }
      map[target] = binding;
      return { ...prev, map };
    });
  }, []);

  const unbind = useCallback((target: MidiTargetId) => {
    setStored((prev) => {
      const map = { ...prev.map };
      delete map[target];
      return { ...prev, map };
    });
  }, []);

  const reset = useCallback(() => {
    setStored((prev) => {
      const layout = MIDI_LAYOUTS.find((l) => l.id === prev.layoutId);
      return { layoutId: prev.layoutId, map: layout ? { ...layout.map } : {} };
    });
  }, []);

  const layout = MIDI_LAYOUTS.find((l) => l.id === stored.layoutId);
  const customised =
    layout === undefined || JSON.stringify(layout.map) !== JSON.stringify(stored.map);

  return {
    layoutId: stored.layoutId,
    map: stored.map,
    customised,
    chooseLayout,
    bind,
    unbind,
    reset,
  };
}

/** Identity of a binding, for "is this control already taken". */
function bindingKey(binding: MidiBinding): string {
  return binding.type === "bend"
    ? "bend"
    : `${binding.type}:${binding.type === "cc" ? binding.control : binding.note}:${binding.channel ?? "*"}`;
}

/* ------------------------------------------------------------ dispatching */

export interface MidiActions {
  /** A held control: sustain. */
  onHold?: (target: MidiTargetId, down: boolean) => void;
  /** A momentary control, on the press edge only. */
  onTrigger?: (target: MidiTargetId) => void;
  /** A continuous control, 0-1. */
  onRange?: (target: MidiTargetId, value: number) => void;
}

/**
 * Turn one message into at most one action.
 *
 * `previous` is the caller's memory of where each target's control last was,
 * and it is why this is a function taking state rather than a pure match: a
 * trigger has to fire on the *edge*, and a knob swept from 0 to 127 crosses
 * the threshold once but sends sixty messages doing it.
 */
export function dispatchMidi(
  map: MidiMap,
  message: MidiMessage,
  previous: Map<MidiTargetId, number>,
  actions: MidiActions,
): boolean {
  for (const [id, binding] of Object.entries(map) as [MidiTargetId, MidiBinding][]) {
    if (!bindingMatches(binding, message)) continue;
    const target = MIDI_TARGET_BY_ID[id];
    if (target === undefined) continue;

    // A note-off is a zero however it arrived; a bend is bipolar and its
    // "pressed" half is the top of the throw.
    const value =
      message.kind === "note-off" ? 0 : binding.type === "bend" ? (message.value + 1) / 2 : message.value;
    const was = previous.get(id) ?? 0;
    previous.set(id, value);

    switch (target.kind) {
      case "hold":
        if (was >= 0.5 !== value >= 0.5) actions.onHold?.(id, value >= 0.5);
        break;
      case "trigger":
        if (was < 0.5 && value >= 0.5) actions.onTrigger?.(id);
        break;
      case "range":
        actions.onRange?.(id, value);
        break;
    }
    return true;
  }
  return false;
}
