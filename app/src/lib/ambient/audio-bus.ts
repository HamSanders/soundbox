/**
 * What the ambient background hears: a read-only tap on everything Mirli
 * plays, reduced to three numbers (level, bass, highs).
 *
 * It must never change how audio is routed. The obvious tool,
 * `createMediaElementSource`, moves an `<audio>` element's output into an
 * AudioContext, and that breaks the speaker picker (`audio-output.ts` calls
 * `setSinkId` on the element itself). So:
 *
 *   - `<audio>` / `new Audio()`: we listen through `captureStream()`, which
 *     copies the element's audio out without taking it over. Every element is
 *     picked up by wrapping `HTMLMediaElement.prototype.play` once, so the
 *     player dock, the library preview, voice samples and site samples all
 *     count without each of them knowing about this file.
 *   - The studio timeline plays through its own AudioContext: it asks for an
 *     analyser in that context with `ambientTap(ctx)` and connects its lane
 *     faders to it, beside the destination.
 *
 * Where `captureStream` does not exist (WebKit, so the macOS desktop app),
 * an element that is playing still counts: the background gets a gentle,
 * steady pulse instead of a real reading.
 */

type Levels = readonly [number, number, number];

interface Tap {
  analyser: AnalyserNode;
  ctx: BaseAudioContext;
}

const taps = new Set<Tap>();
const playing = new Set<HTMLMediaElement>();
const captured = new WeakSet<HTMLMediaElement>();
const watched = new WeakSet<HTMLMediaElement>();
let ownCtx: AudioContext | null = null;
let ownAnalyser: AnalyserNode | null = null;
let installed = false;
let spectrum: Float32Array<ArrayBuffer> | null = null;
let wave: Float32Array<ArrayBuffer> | null = null;

function makeAnalyser(ctx: BaseAudioContext): AnalyserNode {
  const a = ctx.createAnalyser();
  a.fftSize = 512;
  a.smoothingTimeConstant = 0.75;
  return a;
}

/** Our own context, for captured media. Made on first play, which is always
 *  inside a user gesture, so it starts running rather than suspended. */
function own(): { ctx: AudioContext; analyser: AnalyserNode } | null {
  if (ownCtx && ownAnalyser) return { ctx: ownCtx, analyser: ownAnalyser };
  try {
    ownCtx = new AudioContext();
    ownAnalyser = makeAnalyser(ownCtx);
    // Unconnected analysers are not pulled by every engine; a silent path to
    // the destination keeps it processing without adding any sound.
    const mute = ownCtx.createGain();
    mute.gain.value = 0;
    ownAnalyser.connect(mute).connect(ownCtx.destination);
    taps.add({ analyser: ownAnalyser, ctx: ownCtx });
    return { ctx: ownCtx, analyser: ownAnalyser };
  } catch {
    return null;
  }
}

function capture(el: HTMLMediaElement) {
  if (captured.has(el)) return;
  const grab = (el as HTMLMediaElement & { captureStream?: () => MediaStream }).captureStream;
  if (typeof grab !== "function") return;
  let stream: MediaStream;
  try {
    stream = grab.call(el);
  } catch {
    return; // cross-origin media without CORS, for one
  }
  captured.add(el);
  const attach = (track: MediaStreamTrack) => {
    const o = own();
    if (!o) return;
    if (o.ctx.state === "suspended") void o.ctx.resume();
    try {
      o.ctx.createMediaStreamSource(new MediaStream([track])).connect(o.analyser);
    } catch {
      /* a track that ended before we got to it */
    }
  };
  // A new `src` replaces the tracks; listening for additions covers that and
  // the first load, when the stream starts out empty.
  stream.getAudioTracks().forEach(attach);
  stream.addEventListener("addtrack", (e) => {
    if (e.track.kind === "audio") attach(e.track);
  });
}

/** Wraps `play()` once so every media element in the app is heard. */
export function installAmbientAudio() {
  if (installed || typeof HTMLMediaElement === "undefined") return;
  installed = true;
  const original = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    watch(this);
    return original.call(this);
  };
}

/** Keeps `playing` current for an element and listens to it once it plays. */
function watch(el: HTMLMediaElement) {
  if (watched.has(el)) return;
  watched.add(el);
  const forget = () => playing.delete(el);
  el.addEventListener("playing", () => {
    playing.add(el);
    capture(el);
  });
  el.addEventListener("pause", forget);
  el.addEventListener("ended", forget);
  el.addEventListener("emptied", forget);
}

/** An analyser in the caller's own context, for Web Audio playback (the
 *  studio timeline). Connect output to it beside the destination. It is
 *  dropped by itself once that context closes. */
export function ambientTap(ctx: BaseAudioContext): AnalyserNode | null {
  try {
    const analyser = makeAnalyser(ctx);
    taps.add({ analyser, ctx });
    return analyser;
  } catch {
    return null;
  }
}

/** dB from the analyser to 0..1: -85 dB is nothing, -25 dB is loud. */
const fromDb = (db: number) => Math.min(1, Math.max(0, (db + 85) / 60));

/** [level, bass, highs], each 0..1, the loudest of every live source. */
export function readAmbientLevels(): Levels | null {
  let level = 0;
  let bass = 0;
  let high = 0;
  let heard = false;
  for (const tap of taps) {
    if (tap.ctx.state === "closed") {
      taps.delete(tap);
      continue;
    }
    if (tap.ctx.state !== "running") continue;
    const a = tap.analyser;
    const n = a.frequencyBinCount;
    if (!spectrum || spectrum.length !== n) spectrum = new Float32Array(new ArrayBuffer(n * 4));
    if (!wave || wave.length !== a.fftSize) wave = new Float32Array(new ArrayBuffer(a.fftSize * 4));
    // Level is the waveform's RMS, which tracks loudness the way you hear
    // it; the bands come from the spectrum.
    a.getFloatTimeDomainData(wave);
    let sq = 0;
    for (let i = 0; i < wave.length; i++) sq += wave[i] * wave[i];
    const rms = Math.sqrt(sq / wave.length);
    if (rms > 0.002) heard = true;
    level = Math.max(level, Math.min(1, rms * 3));
    a.getFloatFrequencyData(spectrum);
    const hz = tap.ctx.sampleRate / 2 / n;
    let lo = 0;
    let loN = 0;
    let hi = 0;
    let hiN = 0;
    for (let i = 1; i < n; i++) {
      const f = i * hz;
      if (f < 250) { lo += fromDb(spectrum[i]); loN++; }
      else if (f > 3500 && f < 12000) { hi += fromDb(spectrum[i]); hiN++; }
    }
    bass = Math.max(bass, loN ? lo / loN : 0);
    high = Math.max(high, hiN ? hi / hiN : 0);
  }
  if (heard) return [level, bass, high];
  // Something is playing that we could not listen to: breathe instead.
  for (const el of playing) {
    if (!el.paused && !el.muted && el.volume > 0) {
      const t = performance.now() / 1000;
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
      return [0.25 + 0.1 * pulse, 0.3 * pulse, 0.08];
    }
  }
  return null;
}

const BAND_COUNT = 16;
const bandsOut = new Float32Array(BAND_COUNT);
/** Band edges, log-spaced from 40 Hz to 14 kHz, the way pitch is heard. */
const BAND_EDGES = Array.from({ length: BAND_COUNT + 1 }, (_, i) => 40 * Math.pow(14000 / 40, i / BAND_COUNT));

/** 16 spectrum bands, low to high, each 0..1, for the pixel background. The
 *  loudest of every live source per band; null when nothing is playing. */
export function readAmbientBands(): Float32Array | null {
  bandsOut.fill(0);
  let heard = false;
  for (const tap of taps) {
    if (tap.ctx.state !== "running") continue;
    const a = tap.analyser;
    const n = a.frequencyBinCount;
    if (!spectrum || spectrum.length !== n) spectrum = new Float32Array(new ArrayBuffer(n * 4));
    a.getFloatFrequencyData(spectrum);
    const hz = tap.ctx.sampleRate / 2 / n;
    for (let b = 0; b < BAND_COUNT; b++) {
      // At least one bin per band, so the low bands (narrower than a bin at
      // this FFT size) still read something.
      const from = Math.max(1, Math.floor(BAND_EDGES[b] / hz));
      const to = Math.max(from + 1, Math.ceil(BAND_EDGES[b + 1] / hz));
      let sum = 0;
      for (let i = from; i < to && i < n; i++) sum += fromDb(spectrum[i]);
      const v = sum / (to - from);
      if (v > 0.05) heard = true;
      bandsOut[b] = Math.max(bandsOut[b], v);
    }
  }
  if (heard) return bandsOut;
  // Playing but unheard (WebKit): a gentle made-up shape that breathes.
  for (const el of playing) {
    if (!el.paused && !el.muted && el.volume > 0) {
      const t = performance.now() / 1000;
      for (let b = 0; b < BAND_COUNT; b++) {
        bandsOut[b] = (0.25 + 0.15 * Math.sin(t * 2.4 + b * 0.7)) * (1 - b / (BAND_COUNT * 1.4));
      }
      return bandsOut;
    }
  }
  return null;
}
