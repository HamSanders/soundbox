/**
 * Record a clip from the user's microphone.
 *
 * Wraps MediaRecorder rather than exposing it, because the teardown has an
 * ordering constraint that is easy to get wrong and fails silently when you
 * do: `MediaRecorder.stop()` is asynchronous — it queues the final
 * `dataavailable` and only then `stop` — so the microphone track must not be
 * stopped until `onstop` has run. Killing the track in the same tick as
 * `stop()` ends the stream before the encoder flushes, and the take comes back
 * truncated or empty with no error anywhere. `stop()` therefore only stops the
 * recorder; `release()` (the hard teardown, for unmount) is the only thing that
 * touches tracks directly.
 *
 * The output container is whatever the browser chose — webm/opus on Chrome and
 * Firefox, mp4/aac on Safari. Callers are not expected to care: `toWav()` in
 * lib/audio-file.ts decodes all of them.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "recorded";

export interface Recorder {
  state: RecorderState;
  /** The finished recording, once there is one. */
  blob: Blob | null;
  /** Playable URL for `blob`, revoked automatically when it is replaced. */
  url: string | null;
  /** Whole seconds elapsed while recording. */
  seconds: number;
  /** Current input loudness, 0-1, while recording. Drives the level meter —
   *  the only way to see the mic is live *before* committing to a take. */
  level: number;
  /** Permission denied, no microphone, or an unsupported browser. */
  error: string | null;
  /** Available audio inputs. Labels are blank until the user has granted
   *  microphone access once — the browser will not name devices before that. */
  devices: MediaDeviceInfo[];
  /** Which input to record from; null means the system default. */
  deviceId: string | null;
  setDeviceId: (id: string | null) => void;
  start: () => Promise<void>;
  stop: () => void;
  /** Throw the take away and go back to idle. */
  reset: () => void;
}

export function useRecorder(): Recorder {
  const [state, setState] = useState<RecorderState>("idle");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const meter = useRef<{ ctx: AudioContext; frame: number } | null>(null);

  /** Stop metering. Separate from the recorder teardown because the meter is
   *  pure observation — nothing about the take depends on it. */
  const stopMeter = useCallback(() => {
    const active = meter.current;
    meter.current = null;
    if (active) {
      cancelAnimationFrame(active.frame);
      void active.ctx.close();
    }
    setLevel(0);
  }, []);

  /** Hard teardown: drop the recorder and release the microphone. Used on
   *  unmount and reset, where there is no take to preserve. */
  const release = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
    stopMeter();
    const active = recorder.current;
    recorder.current = null;
    if (active) {
      if (active.state !== "inactive") active.stop();
      for (const track of active.stream.getTracks()) track.stop();
    }
  }, [stopMeter]);

  /** Re-read the input list. Called on mount, after permission is granted
   *  (which is when labels appear), and whenever hardware is plugged in. */
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      // Before access has ever been granted, Chrome returns one placeholder
      // input with an empty deviceId. It cannot be selected (an empty value
      // is "unset" to a Select, and `deviceId: {exact: ""}` matches nothing),
      // so it is dropped rather than offered as a dead entry.
      setDevices(all.filter((d) => d.kind === "audioinput" && d.deviceId !== ""));
    } catch {
      // Enumeration failing is not worth an error banner: the default device
      // still records, and the picker simply has nothing to offer.
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const media = navigator.mediaDevices;
    if (!media?.addEventListener) return;
    media.addEventListener("devicechange", refreshDevices);
    return () => media.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  // Unmount while recording — closing the dialog mid-take — must not leave the
  // mic live. The URL goes with it: nothing can play a revoked take anyway.
  useEffect(() => {
    return () => {
      release();
      setUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
    };
  }, [release]);

  const start = useCallback(async () => {
    setError(null);
    // On anything but localhost or https, `navigator.mediaDevices` is not
    // defined at all — visiting the dev server by LAN IP is the usual way to
    // land here, and "this browser can't record" would be a lie.
    if (!window.isSecureContext) {
      setError(
        "Recording needs a secure page. Open Konchi on localhost (or over https) and try again.",
      );
      return;
    }
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices) {
      setError("This browser can't record audio.");
      return;
    }
    // The browser's own processing is left on: a voice reference is cleaner
    // with echo cancellation and noise suppression than without, and the
    // cloning model hears whatever the room did.
    const audio: MediaTrackConstraints | true = deviceId
      ? { deviceId: { exact: deviceId } }
      : true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (exc) {
      const name = exc instanceof DOMException ? exc.name : "";
      // A device that has been unplugged since the list was built fails as
      // OverconstrainedError. Falling back to the default beats making the
      // user work out which entry went stale.
      if (name === "OverconstrainedError" && deviceId) {
        setDeviceId(null);
        setError("That input is no longer available — switched back to the default.");
        void refreshDevices();
        return;
      }
      setError(
        name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser's site settings, then try again."
          : name === "NotFoundError"
            ? "No microphone was found."
            : name === "NotReadableError"
              ? "The microphone is in use by another app."
              // The DOMException name is the only clue left worth having, and
              // hiding it behind "something went wrong" helps nobody.
              : `Could not start recording${name ? ` (${name})` : ""}.`,
      );
      return;
    }
    // Labels are blank until access has been granted at least once, so this is
    // the first moment the picker can show real device names.
    void refreshDevices();

    setUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setBlob(null);
    setSeconds(0);
    chunks.current = [];

    const mr = new MediaRecorder(stream);
    recorder.current = mr;
    mr.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    mr.onstop = () => {
      // Only now is it safe to release the hardware: the encoder has flushed
      // its last `dataavailable` by the time this fires.
      for (const track of stream.getTracks()) track.stop();
      if (timer.current !== null) {
        clearInterval(timer.current);
        timer.current = null;
      }
      stopMeter();
      recorder.current = null;
      // `mr.mimeType` rather than a guess: Safari hands back mp4, everyone
      // else webm, and mislabelling it breaks the decode downstream.
      const take = new Blob(chunks.current, { type: mr.mimeType || "audio/webm" });
      chunks.current = [];
      if (take.size === 0) {
        // Nothing to save and nothing to explain otherwise — silence here is
        // what "the recorder did nothing" feels like from the outside.
        setError("That take came back empty. Check the input device and try again.");
        setState("idle");
        return;
      }
      setBlob(take);
      setUrl(URL.createObjectURL(take));
      setState("recorded");
    };
    // A timeslice means chunks accumulate as they are encoded instead of all
    // arriving at stop, so a take survives even if the final flush is cut off.
    mr.start(1000);
    setState("recording");
    timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);

    // Level metering runs off the same stream, on its own context so closing
    // it can never disturb the recording.
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      // RMS, scaled so ordinary speech lands mid-meter rather than pinned to
      // the bottom of a linear 0-1 scale.
      const rms = Math.sqrt(sum / samples.length);
      setLevel(Math.min(1, rms * 4));
      if (meter.current) meter.current.frame = requestAnimationFrame(tick);
    };
    meter.current = { ctx, frame: requestAnimationFrame(tick) };
  }, [deviceId, refreshDevices, stopMeter]);

  const stop = useCallback(() => {
    const active = recorder.current;
    // Deliberately not `release()`: onstop does the teardown, in the order the
    // encoder needs. See the note at the top of this file.
    if (active && active.state !== "inactive") active.stop();
  }, []);

  const reset = useCallback(() => {
    release();
    chunks.current = [];
    setBlob(null);
    setUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setSeconds(0);
    setError(null);
    setState("idle");
  }, [release]);

  return {
    state,
    blob,
    url,
    seconds,
    level,
    error,
    devices,
    deviceId,
    setDeviceId,
    start,
    stop,
    reset,
  };
}
