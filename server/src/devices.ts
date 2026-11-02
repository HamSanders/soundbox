/**
 * A track's insert chain, as the server stores it.
 *
 * The rack itself — the dials, the audio graph — lives in the app, and
 * `app/src/lib/devices.ts` is the table it is built from. This is the part of
 * that table the server needs to keep a stored chain honest: which kinds
 * exist, which knobs each one has, and the range each knob can reach. It is a
 * copy, so `test/devices.test.ts` loads the app's table and fails the moment
 * the two disagree on a kind, a key, a range or a default.
 *
 * Why the server holds chains at all: an agent turning a knob over MCP has to
 * land somewhere the studio can read back, and the browser's localStorage is
 * not that place. The chain is stored on the track row, next to name, mute,
 * solo and gain, and travels with the row when lanes are renumbered.
 *
 * What it still is not: part of the export. `export_story` mixes the clips
 * dry, exactly as before — the devices are heard in the studio's timeline
 * playback. Every tool that writes a chain says so.
 */

import { randomBytes } from "node:crypto";

export const DEVICE_KINDS = [
  "compressor",
  "eq",
  "reverb",
  "delay",
  "distortion",
  "gate",
  "limiter",
  "autotune",
] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export interface DeviceSpec {
  /** Stable across edits, so a card keeps its identity while its knobs move
   *  and an agent can name one device when a track has two of a kind. */
  id: string;
  kind: DeviceKind;
  /** Bypassed devices stay in the chain, out of the signal path. */
  bypassed: boolean;
  params: Record<string, number>;
}

export interface DeviceParam {
  key: string;
  min: number;
  max: number;
  /** The unit the value is stored in — seconds for times, never ms. */
  unit: string;
  default: number;
  /** For a knob whose numbers are labels (key, scale): the label per value. */
  labels?: readonly string[];
}

const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const SCALES = ["Chromatic", "Major", "Minor"] as const;

/** What each device is for, in the words the app's add menu uses. */
export const DEVICE_TABLE: Record<
  DeviceKind,
  { name: string; blurb: string; params: DeviceParam[] }
> = {
  compressor: {
    name: "Compressor",
    blurb: "Evens out a take that swings between a whisper and a shout.",
    params: [
      { key: "threshold", min: -60, max: 0, unit: "dB", default: -24 },
      { key: "ratio", min: 1, max: 20, unit: ":1", default: 4 },
      { key: "attack", min: 0.001, max: 0.3, unit: "s", default: 0.006 },
      { key: "release", min: 0.01, max: 1, unit: "s", default: 0.15 },
    ],
  },
  eq: {
    name: "EQ",
    blurb: "Three bands: lift the body, cut the mud, open the top.",
    params: [
      { key: "low", min: -24, max: 12, unit: "dB", default: 0 },
      { key: "mid", min: -24, max: 12, unit: "dB", default: 0 },
      { key: "high", min: -24, max: 12, unit: "dB", default: 0 },
      { key: "lowFrequency", min: 80, max: 1000, unit: "Hz", default: 400 },
      { key: "highFrequency", min: 1000, max: 10000, unit: "Hz", default: 2500 },
    ],
  },
  reverb: {
    name: "Reverb",
    blurb: "Puts the line in a room instead of against a dry wall.",
    params: [
      { key: "decay", min: 0.1, max: 10, unit: "s", default: 1.8 },
      { key: "preDelay", min: 0, max: 0.3, unit: "s", default: 0.02 },
      { key: "wet", min: 0, max: 1, unit: "", default: 0.25 },
    ],
  },
  delay: {
    name: "Delay",
    blurb: "Repeats, fed back on themselves. Depth for free, rhythm if you time it.",
    params: [
      { key: "delayTime", min: 0.01, max: 1, unit: "s", default: 0.25 },
      { key: "feedback", min: 0, max: 0.95, unit: "", default: 0.3 },
      { key: "wet", min: 0, max: 1, unit: "", default: 0.25 },
    ],
  },
  distortion: {
    name: "Distortion",
    blurb: "Grit, from a warm edge to a radio that has given up.",
    params: [
      { key: "distortion", min: 0, max: 1, unit: "", default: 0.3 },
      { key: "wet", min: 0, max: 1, unit: "", default: 0.5 },
    ],
  },
  gate: {
    name: "Gate",
    blurb: "Shuts the track between phrases, so room tone stops piling up.",
    params: [
      { key: "threshold", min: -80, max: 0, unit: "dB", default: -45 },
      { key: "smoothing", min: 0.01, max: 0.5, unit: "s", default: 0.06 },
    ],
  },
  limiter: {
    name: "Limiter",
    blurb: "A ceiling nothing gets over. Last in the chain, or it is decoration.",
    params: [{ key: "threshold", min: -24, max: 0, unit: "dB", default: -1 }],
  },
  autotune: {
    name: "Autotune",
    blurb: "Pulls a sung take onto the nearest note. Fast retune is the famous sound.",
    params: [
      { key: "tuneKey", min: 0, max: 11, unit: "", default: 0, labels: KEYS },
      { key: "scale", min: 0, max: 2, unit: "", default: 0, labels: SCALES },
      { key: "retune", min: 0, max: 0.4, unit: "s", default: 0.08 },
      { key: "amount", min: 0, max: 1, unit: "", default: 1 },
    ],
  },
};

/** More than any rack anyone builds by hand, few enough that a runaway agent
 *  loop cannot grow a track's row without bound. */
export const MAX_DEVICES_PER_TRACK = 16;

export function isDeviceKind(kind: string): kind is DeviceKind {
  return (DEVICE_KINDS as readonly string[]).includes(kind);
}

/** One knob pushed past its end, and where it landed instead. */
export interface Clamped {
  key: string;
  asked: number;
  set: number;
}

/**
 * Keep a parameter bag inside the ranges the rack's dials can reach.
 *
 * Same rule as the app's `clampDeviceParams`: a value past the end lands at
 * the end (the intent, "as wet as it goes", survives), keys the device does
 * not have are dropped, and non-finite numbers are ignored. Returns what was
 * clamped and dropped as well, so a tool can tell the agent rather than
 * silently storing something other than what it asked for.
 */
export function clampParams(
  kind: DeviceKind,
  params: Record<string, number>,
): { params: Record<string, number>; clamped: Clamped[]; unknown: string[] } {
  const table = DEVICE_TABLE[kind].params;
  const out: Record<string, number> = {};
  const clamped: Clamped[] = [];
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const spec = table.find((p) => p.key === key);
    if (!spec) {
      unknown.push(key);
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    let set = Math.min(Math.max(value, spec.min), spec.max);
    // A label knob is an index; 4.6 is not a key anyone means.
    if (spec.labels) set = Math.round(set);
    if (set !== value) clamped.push({ key, asked: value, set });
    out[key] = set;
  }
  return { params: out, clamped, unknown };
}

/** Every knob the device has, at its default. */
export function defaultParams(kind: DeviceKind): Record<string, number> {
  return Object.fromEntries(DEVICE_TABLE[kind].params.map((p) => [p.key, p.default]));
}

export function newDeviceId(kind: DeviceKind): string {
  return `${kind}-${randomBytes(4).toString("hex")}`;
}

/**
 * A chain as it may be stored: known kinds only, every knob present and in
 * range, ids unique.
 *
 * Applied to every chain on the way in — from the studio's PATCH as much as
 * from an agent — so a chain read back is always one the rack can build.
 * Missing knobs take their defaults rather than failing, which is what lets a
 * chain saved before a device grew a new knob keep loading.
 */
export function normalizeChain(chain: readonly unknown[]): DeviceSpec[] {
  const seen = new Set<string>();
  const out: DeviceSpec[] = [];
  for (const raw of chain.slice(0, MAX_DEVICES_PER_TRACK)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<DeviceSpec>;
    if (typeof r.kind !== "string" || !isDeviceKind(r.kind)) continue;
    const kind = r.kind;
    let id = typeof r.id === "string" && r.id.trim() ? r.id.trim().slice(0, 64) : newDeviceId(kind);
    if (seen.has(id)) id = newDeviceId(kind);
    seen.add(id);
    const given =
      r.params && typeof r.params === "object" && !Array.isArray(r.params)
        ? clampParams(kind, r.params as Record<string, number>).params
        : {};
    out.push({
      id,
      kind,
      bypassed: r.bypassed === true,
      params: { ...defaultParams(kind), ...given },
    });
  }
  return out;
}

/** The table as an agent reads it: one line per knob, ranges in stored units. */
export function describeDevices(): string {
  return DEVICE_KINDS.map((kind) => {
    const knobs = DEVICE_TABLE[kind].params
      .map((p) => {
        const range = p.labels
          ? `0–${p.max} (${p.labels.join(", ")})`
          : `${p.min}–${p.max}${p.unit ? " " + p.unit : ""}`;
        return `${p.key} ${range}, default ${p.default}`;
      })
      .join("; ");
    return `${kind}: ${knobs}`;
  }).join("\n");
}
