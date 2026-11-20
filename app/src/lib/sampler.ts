/**
 * Sampled instruments for the dry render: VSCO 2 Community Edition, played
 * from its SFZ regions.
 *
 * The server downloads an instrument on request and parses its .sfz (see
 * server/src/instruments/sfz.ts for which opcodes, and why only those). This
 * file does the rest in the browser: pick the region a note falls in, fetch
 * and decode that sample, and play it at the note's pitch on whatever Tone
 * context is current, so the same voice serves an offline render and live
 * monitoring, as the synth's does.
 *
 * How a region becomes a note, per the SFZ spec's defaults (the files set
 * nothing else):
 *
 *  - pitch: `playbackRate = 2^(((key - pitch_keycenter) * 100 + tune) / 1200)`.
 *    VSCO samples every two to four semitones, so no note is shifted far.
 *  - level: `volume` dB times the default velocity curve (`amp_veltrack=100`:
 *    gain = (vel/127)²). VSCO's quiet layers carry `volume=20` or so to undo
 *    exactly that curve at the top of their range, which is how the library is
 *    meant to be played.
 *  - envelope: `ampeg_attack` in, `ampeg_release` out after note-off. There is
 *    no sustain loop in VSCO 2 CE, so a note held longer than its recording
 *    ends when the recording does.
 */

import * as Tone from "tone";

import { api, type InstrumentRegions, type SfzRegion } from "@/lib/api";

/** Instrument ids in the MIDI store: synth presets are bare (`bowed`),
 *  sampled ones carry this prefix (`vsco:violin`). */
export const SAMPLED_PREFIX = "vsco:";

export function isSampled(instrumentId: string): boolean {
  return instrumentId.startsWith(SAMPLED_PREFIX);
}

export function sampledId(libraryId: string): string {
  return `${SAMPLED_PREFIX}${libraryId}`;
}

/** The server's id for a sampled instrument, or null for a synth preset. */
export function libraryId(instrumentId: string): string | null {
  return isSampled(instrumentId) ? instrumentId.slice(SAMPLED_PREFIX.length) : null;
}

/** MIDI velocity, 1-127, from the note list's 0-1. */
export function velocity127(velocity: number): number {
  return Math.max(1, Math.min(127, Math.round(velocity * 127)));
}

/**
 * The region a note plays, or null when the instrument has none there.
 *
 * VSCO's zones do not overlap, so the first match is the only match. A
 * velocity outside every layer on the key falls back to the nearest layer
 * rather than to silence.
 */
export function pickRegion(regions: SfzRegion[], key: number, velocity: number): SfzRegion | null {
  const onKey = regions.filter((r) => key >= r.lokey && key <= r.hikey);
  if (!onKey.length) return null;
  const hit = onKey.find((r) => velocity >= r.lovel && velocity <= r.hivel);
  if (hit) return hit;
  const gap = (r: SfzRegion): number =>
    velocity < r.lovel ? r.lovel - velocity : velocity - r.hivel;
  return onKey.reduce((best, r) => (gap(r) < gap(best) ? r : best));
}

export function playbackRate(region: SfzRegion, key: number): number {
  return Math.pow(2, ((key - region.pitchKeycenter) * 100 + region.tune) / 1200);
}

export function regionGain(region: SfzRegion, velocity: number): number {
  const v = velocity127(velocity) / 127;
  return Math.pow(10, region.volume / 20) * v * v;
}

/* ------------------------------------------------------------- loading */

/** Thrown when an instrument cannot be played: not installed, or a sample
 *  would not load. The take is then rendered on the synth instead. */
export class SamplesUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SamplesUnavailable";
  }
}

const regionCache = new Map<string, Promise<InstrumentRegions>>();
const bufferCache = new Map<string, Promise<AudioBuffer>>();

/** Decoding needs a context but not a running one, and this one never asks
 *  the browser for an audio device. 44.1 kHz is what VSCO records at, so
 *  nothing is resampled on the way in. */
let decoder: OfflineAudioContext | null = null;

function regionsFor(id: string): Promise<InstrumentRegions> {
  let cached = regionCache.get(id);
  if (!cached) {
    cached = api.getInstrument(id).catch((error: unknown) => {
      regionCache.delete(id);
      throw new SamplesUnavailable(
        error instanceof Error ? error.message : `The ${id} samples are not installed`,
      );
    });
    regionCache.set(id, cached);
  }
  return cached;
}

function bufferFor(filesUrl: string, sample: string): Promise<AudioBuffer> {
  const key = `${filesUrl}/${sample}`;
  let cached = bufferCache.get(key);
  if (!cached) {
    cached = (async () => {
      const bytes = await api.fetchInstrumentFile(filesUrl, sample);
      decoder ??= new OfflineAudioContext(2, 1, 44100);
      return await decoder.decodeAudioData(bytes);
    })().catch((error: unknown) => {
      bufferCache.delete(key);
      throw new SamplesUnavailable(
        error instanceof Error ? error.message : `Could not load ${sample}`,
      );
    });
    bufferCache.set(key, cached);
  }
  return cached;
}

/** Forget an instrument's samples, e.g. after deleting them. */
export function forgetInstrument(id: string): void {
  const regions = regionCache.get(id);
  regionCache.delete(id);
  void regions?.then((r) => {
    for (const key of [...bufferCache.keys()]) {
      if (key.startsWith(`${r.files_url}/`)) bufferCache.delete(key);
    }
  });
}

/** An instrument with the samples it needs already decoded. */
export interface LoadedInstrument {
  regions: SfzRegion[];
  buffers: Map<string, AudioBuffer>;
}

/**
 * Load what a set of notes will play, or the whole instrument.
 *
 * A take only decodes the regions its notes land in: the solo violin is 74 MB
 * of 24-bit WAV, roughly twice that once decoded, and a phrase in one octave
 * touches a handful of its thirty samples.
 */
export async function loadInstrument(
  id: string,
  notes?: { note: number; velocity: number }[],
): Promise<LoadedInstrument> {
  const { files_url, regions } = await regionsFor(id);
  const wanted = new Set<string>();
  if (notes) {
    for (const n of notes) {
      const region = pickRegion(regions, n.note, velocity127(n.velocity));
      if (region) wanted.add(region.sample);
    }
  } else {
    for (const r of regions) wanted.add(r.sample);
  }
  const buffers = new Map<string, AudioBuffer>();
  await Promise.all(
    [...wanted].map(async (sample) => buffers.set(sample, await bufferFor(files_url, sample))),
  );
  return { regions, buffers };
}

/* --------------------------------------------------------------- voice */

/** The same shape as the synth's voice in midi.ts. */
export interface SampledVoice {
  play: (note: number, durationS: number, atS: number, velocity: number) => void;
  press: (note: number, velocity: number) => void;
  release: (note: number) => void;
  dispose: () => void;
}

/**
 * A voice that plays the instrument's samples on the current Tone context.
 *
 * A note outside the instrument's range is skipped, the way a real violin
 * cannot play a low C. The notes that do sound are rendered exactly.
 */
export function sampledVoice(instrument: LoadedInstrument): SampledVoice {
  const out = new Tone.Gain(0.5).toDestination();
  const sounding = new Set<Tone.ToneBufferSource>();
  const held = new Map<number, Tone.ToneBufferSource[]>();

  const start = (note: number, atS: number, velocity: number): Tone.ToneBufferSource | null => {
    const region = pickRegion(instrument.regions, note, velocity127(velocity));
    const buffer = region && instrument.buffers.get(region.sample);
    if (!region || !buffer) return null;
    const source = new Tone.ToneBufferSource({
      url: new Tone.ToneAudioBuffer(buffer),
      playbackRate: playbackRate(region, note),
      fadeIn: region.ampegAttack,
      fadeOut: Math.max(0.01, region.ampegRelease),
      curve: "linear",
    }).connect(out);
    // Not disposed here. Tone disposes an ended one-shot source itself on a
    // live context, and on an offline one `onended` can run before the render
    // does, so disposing in it renders the take as silence.
    source.onended = () => {
      sounding.delete(source);
    };
    sounding.add(source);
    source.start(atS, 0, undefined, regionGain(region, velocity));
    return source;
  };

  return {
    play: (note, durationS, atS, velocity) => {
      const at = atS || Tone.now();
      start(note, at, velocity)?.stop(at + Math.max(0.04, durationS));
    },
    press: (note, velocity) => {
      const source = start(note, Tone.now(), velocity);
      if (source) held.set(note, [...(held.get(note) ?? []), source]);
    },
    release: (note) => {
      for (const source of held.get(note) ?? []) {
        // A sample that ran out before the key came up has already gone.
        if (sounding.has(source)) source.stop(Tone.now());
      }
      held.delete(note);
    },
    dispose: () => {
      for (const source of sounding) source.dispose();
      sounding.clear();
      held.clear();
      out.dispose();
    },
  };
}
