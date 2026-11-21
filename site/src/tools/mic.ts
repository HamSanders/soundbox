/**
 * Record a few seconds from the microphone for the BPM and key finder.
 *
 * The browser's voice-call processing (echo cancellation, noise suppression,
 * auto gain) is switched off: it is tuned for speech and smears drums and
 * chords. The audio never leaves the page; it is recorded with MediaRecorder
 * and decoded back into samples with the Web Audio API.
 */

export interface MicSession {
  /** Stop early. `done` still resolves with what was recorded so far. */
  stop: () => void;
  /** The recording as a compressed audio file (decode it with decodeFile). */
  done: Promise<Blob>;
}

export class MicError extends Error {
  readonly code: "unsupported" | "denied" | "no-device" | "failed";
  constructor(message: string, code: MicError["code"]) {
    super(message);
    this.code = code;
  }
}

/**
 * Start listening. `onTick` gets the seconds elapsed and an input level from
 * 0 to 1 about 60 times a second, for the progress bar and meter.
 */
export async function listen(maxSeconds: number, onTick: (elapsed: number, level: number) => void): Promise<MicSession> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new MicError("This browser can't record from a microphone. Try Chrome, Edge, Firefox or Safari.", "unsupported");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new MicError("Microphone access was blocked. Allow it in your browser's address bar and try again.", "denied");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new MicError("No microphone was found.", "no-device");
    }
    throw new MicError("Couldn't start the microphone.", "failed");
  }

  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const frame = new Float32Array(analyser.fftSize);

  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
    recorder.onerror = () => reject(new MicError("The recording failed.", "failed"));
  });

  const started = performance.now();
  let raf = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    clearTimeout(backstop);
    if (recorder.state !== "inactive") recorder.stop();
    for (const t of stream.getTracks()) t.stop();
    void ctx.close();
  };
  // requestAnimationFrame pauses in a background tab; this makes sure the mic still closes on time.
  const backstop = setTimeout(stop, maxSeconds * 1000 + 250);

  const tick = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(frame);
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const elapsed = (performance.now() - started) / 1000;
    onTick(Math.min(elapsed, maxSeconds), Math.min(1, rms * 4));
    if (elapsed >= maxSeconds) stop();
    else raf = requestAnimationFrame(tick);
  };

  recorder.start();
  raf = requestAnimationFrame(tick);
  return { stop, done };
}
