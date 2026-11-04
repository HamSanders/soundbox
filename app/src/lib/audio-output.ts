/**
 * Which speakers Konchi plays through.
 *
 * The browser sends audio to whatever Windows/macOS has set as the system
 * default, and a default that has gone silent is indistinguishable from a
 * broken app: play() resolves, the button flips to Pause, and the clock never
 * advances. That is a genuinely awful thing to debug — a wireless headset that
 * is powered off keeps its endpoint "present" and simply stops consuming
 * samples.
 *
 * So we let the user pick an output explicitly, remember it, and give them a
 * test tone to prove the choice works before blaming the model.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface OutputDevice {
  deviceId: string;
  label: string;
}

interface OutputState {
  /** "" means "follow the system default". */
  sinkId: string;
  devices: OutputDevice[];
  /** Labels are hidden until the user grants permission at least once. */
  labelsHidden: boolean;
  supported: boolean;
  setSinkId: (id: string) => void;
  refresh: () => Promise<void>;
  requestLabels: () => Promise<void>;
}

const canSelectSink =
  typeof window !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

export const useOutputStore = create<OutputState>()(
  persist(
    (set) => ({
      sinkId: "",
      devices: [],
      labelsHidden: false,
      supported: canSelectSink,

      setSinkId: (id) => set({ sinkId: id }),

      refresh: async () => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const all = await navigator.mediaDevices.enumerateDevices();
        const outs = all.filter((d) => d.kind === "audiooutput");
        // Chrome exposes ids but blanks the labels until a media permission
        // has been granted once. An unlabelled list is useless for choosing,
        // so surface that state rather than showing "Device 2f9a…".
        const labelsHidden = outs.length > 0 && outs.every((d) => !d.label);
        set({
          devices: outs.map((d) => ({
            deviceId: d.deviceId,
            label: d.label || "Unnamed output",
          })),
          labelsHidden,
        });
      },

      requestLabels: async () => {
        // Any granted media permission unblocks output labels. We take a mic
        // stream and stop it immediately — nothing is recorded or sent.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        await useOutputStore.getState().refresh();
      },
    }),
    {
      name: "konchi.output",
      partialize: (s) => ({ sinkId: s.sinkId }),
    },
  ),
);

/**
 * Point a media element at the chosen output.
 *
 * A stored id can go stale when a device is unplugged; falling back to the
 * system default is better than throwing inside a play handler.
 */
export async function applySink(media: HTMLMediaElement, sinkId: string): Promise<void> {
  if (!canSelectSink) return;
  const el = media as HTMLMediaElement & { setSinkId(id: string): Promise<void> };
  try {
    await el.setSinkId(sinkId);
  } catch {
    if (sinkId) {
      try {
        await el.setSinkId("");
      } catch {
        /* nothing else to try */
      }
    }
  }
}

/**
 * Play a short tone on a device, to answer "is anything coming out of this?"
 * without generating a sound first. Resolves with how far playback actually
 * advanced — a dead endpoint accepts the buffer and then never moves, so
 * "did it error" is not a useful test on its own.
 */
export async function playTestTone(sinkId: string, seconds = 1): Promise<number> {
  const sr = 48000;
  const n = Math.floor(sr * seconds);
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    // A gentle 440Hz sine with short fades, so a test never sounds like a click.
    const fade = Math.min(1, i / (sr * 0.02), (n - i) / (sr * 0.05));
    view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 440 * i) / sr) * 8000 * fade, true);
  }
  const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  const audio = new Audio(url);
  try {
    await applySink(audio, sinkId);
    await audio.play();
    await new Promise((r) => setTimeout(r, seconds * 1000 + 250));
    return audio.currentTime;
  } finally {
    audio.pause();
    URL.revokeObjectURL(url);
  }
}
