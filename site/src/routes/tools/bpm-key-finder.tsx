/**
 * /tools/bpm-key-finder: tempo and key of a song, worked out in the browser.
 *
 * Nothing is uploaded: a dropped file, or a few seconds recorded from the
 * microphone, is decoded with the Web Audio API and analysed by
 * src/tools/analyze.ts on this machine.
 */

import { MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { faqJsonLd, SeoHead } from "@/components/seo-head";
import { type Analysis, analyze, mixDown } from "../../tools/analyze";
import { decodeFile } from "../../tools/free-api";
import { listen, MicError, type MicSession } from "../../tools/mic";
import { Block, DropZone, formatDuration, Funnel } from "../../tools/ui";

type Phase =
  | { kind: "idle" }
  | { kind: "listening"; elapsed: number; level: number }
  | { kind: "working"; name: string }
  | { kind: "done"; name: string; seconds: number; result: Analysis; fromMic: boolean }
  | { kind: "error"; message: string };

const FAQ = [
  {
    question: "Is my song uploaded?",
    answer:
      "No. Your browser decodes and analyses the file, or the microphone recording, on your own computer. Nothing is sent anywhere.",
  },
  {
    question: "Can it listen through my microphone?",
    answer:
      "Yes. Press Listen, allow the microphone, and play the song out loud nearby for about 15 seconds. A file gives a cleaner result than a speaker in a noisy room, so use one if you have it.",
  },
  {
    question: "Why does it show two tempos?",
    answer:
      "Many songs read equally well at half or double time, like drum and bass at 174 or 87. The first number is the likelier one; the second is the half- or double-time reading.",
  },
  {
    question: "What's the Camelot code?",
    answer:
      "DJs use the Camelot wheel to mix in key: tracks with the same number, or one step apart, blend smoothly. 8B is C major, 8A is A minor.",
  },
  {
    question: "How accurate is it?",
    answer:
      "It's right on most pop, rock and electronic music. Songs that change key, have no steady beat, or sit between a major key and its relative minor can fool it, so the page shows how sure it is.",
  },
];

const MAX_ANALYSE_S = 180;
/** How long the microphone listens. Tempo needs a few bars; key settles in about ten seconds. */
const LISTEN_S = 15;
/** Shorter than this and the tempo reading is mostly noise. */
const MIN_LISTEN_S = 6;

export function BpmKeyFinderPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const mic = useRef<MicSession | null>(null);

  // Close the microphone if the page is left mid-recording.
  useEffect(() => () => mic.current?.stop(), []);

  async function analyseBlob(blob: Blob, name: string, fromMic: boolean) {
    setPhase({ kind: "working", name });
    let buffer: AudioBuffer;
    try {
      buffer = await decodeFile(blob);
    } catch {
      // A recording only fails to decode when the input sent no audio at all (a muted or virtual device).
      setPhase({
        kind: "error",
        message: fromMic
          ? "The microphone sent no sound. Check it's the right input and not muted, then try again."
          : "We couldn't read that file. Try an MP3, WAV, FLAC, M4A or OGG.",
      });
      return;
    }
    if (fromMic && buffer.duration < MIN_LISTEN_S - 0.5) {
      setPhase({ kind: "error", message: `That was too short to read. Let it listen for at least ${MIN_LISTEN_S} seconds.` });
      return;
    }
    // Yield so the "Analysing" state paints before the work starts.
    await new Promise((r) => setTimeout(r, 30));
    const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const mono = mixDown(chans);
    if (fromMic && rms(mono) < 0.003) {
      setPhase({ kind: "error", message: "The microphone heard almost nothing. Turn the music up or move closer, then try again." });
      return;
    }
    const len = Math.min(mono.length, buffer.sampleRate * MAX_ANALYSE_S);
    const from = Math.max(0, Math.floor((mono.length - len) / 2));
    const result = analyze(mono.subarray(from, from + len), buffer.sampleRate);
    setPhase({ kind: "done", name, seconds: buffer.duration, result, fromMic });
  }

  async function startListening() {
    setPhase({ kind: "listening", elapsed: 0, level: 0 });
    let session: MicSession;
    try {
      session = await listen(LISTEN_S, (elapsed, level) => setPhase({ kind: "listening", elapsed, level }));
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof MicError ? e.message : "Couldn't start the microphone." });
      return;
    }
    mic.current = session;
    let blob: Blob;
    try {
      blob = await session.done;
    } catch {
      setPhase({ kind: "error", message: "The recording failed. Try again." });
      return;
    } finally {
      mic.current = null;
    }
    await analyseBlob(blob, "Microphone", true);
  }

  const sure = (c: number) => (c > 0.66 ? "sure" : c > 0.33 ? "fairly sure" : "a guess");
  const busy = phase.kind === "working" || phase.kind === "listening";

  return (
    <main id="main">
      <SeoHead
        title="Free BPM and key finder: tempo and key of any song | Mirli"
        description="Find the BPM and musical key of a song in your browser, from a file or through your microphone. Nothing is uploaded. Shows the Camelot code for DJs, plus half- and double-time tempos."
        path="/tools/bpm-key-finder"
        jsonLd={[
          faqJsonLd(FAQ),
          {
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "Mirli BPM and key finder",
            applicationCategory: "MultimediaApplication",
            operatingSystem: "Any (browser)",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          },
        ]}
      />

      <section aria-labelledby="bk-h1" className="px-4">
        <div className="mx-auto w-full max-w-3xl py-14 text-center sm:py-20">
          <p className="label-caps text-muted-foreground">Free tool · BPM and key finder</p>
          <h1 id="bk-h1" className="mt-4 text-4xl text-balance sm:text-6xl">
            Find the tempo and key of any song
          </h1>
          <p className="text-muted-foreground mx-auto mt-5 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
            Drop in a track, or let it listen through your microphone, and get its BPM, key and Camelot code. It runs in your
            browser, so nothing is uploaded.
          </p>

          <div className="mt-10 text-left">
            <DropZone onFile={(f) => void analyseBlob(f, f.name, false)} disabled={busy} hint="MP3, WAV, FLAC, M4A or OGG. Stays on your computer." />

            {phase.kind === "listening" ? (
              <div className="border-border mt-4 rounded-md border p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="relative flex size-2.5" aria-hidden="true">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
                      <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
                    </span>
                    <p className="text-sm font-medium">Listening… play the song out loud near your microphone</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => mic.current?.stop()}
                    disabled={phase.elapsed < MIN_LISTEN_S}
                    className="border-border hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <SquareIcon className="size-3.5" aria-hidden="true" />
                    Stop
                  </button>
                </div>
                <div className="bg-muted mt-4 h-1.5 overflow-hidden rounded-full" role="progressbar" aria-label="Listening" aria-valuemin={0} aria-valuemax={LISTEN_S} aria-valuenow={Math.round(phase.elapsed)}>
                  <div className="bg-foreground h-full" style={{ width: `${(phase.elapsed / LISTEN_S) * 100}%` }} />
                </div>
                <div className="text-muted-foreground mt-2 flex items-center justify-between gap-4 text-xs">
                  <span>
                    {Math.floor(phase.elapsed)} of {LISTEN_S} s
                  </span>
                  <span className="flex items-center gap-2">
                    Level
                    <span className="bg-muted inline-block h-1.5 w-24 overflow-hidden rounded-full" aria-hidden="true">
                      <span className="block h-full bg-emerald-500 transition-[width] duration-75" style={{ width: `${phase.level * 100}%` }} />
                    </span>
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => void startListening()}
                  disabled={busy}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <MicIcon className="size-4" aria-hidden="true" />
                  Or listen through your microphone
                </button>
              </div>
            )}

            <div aria-live="polite" className="mt-6">
              {phase.kind === "working" ? (
                <p className="text-muted-foreground text-sm">Analysing {phase.name === "Microphone" ? "the recording" : phase.name}…</p>
              ) : null}
              {phase.kind === "error" ? (
                <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                  {phase.message}
                </p>
              ) : null}
              {phase.kind === "done" ? (
                <div>
                  <p className="text-muted-foreground mb-3 truncate text-sm">
                    {phase.fromMic ? `Heard through the microphone · ${formatDuration(phase.seconds)}` : `${phase.name} · ${formatDuration(phase.seconds)}`}
                  </p>
                  <dl className="border-border grid grid-cols-1 border-t border-l sm:grid-cols-3">
                    <div className="border-border border-r border-b p-5">
                      <dt className="label-caps text-muted-foreground">Tempo</dt>
                      <dd className="mt-2 text-4xl font-semibold tracking-tight">{Math.round(phase.result.bpm)}</dd>
                      <dd className="text-muted-foreground mt-1 text-xs">
                        BPM, {sure(phase.result.bpmConfidence)}
                        {phase.result.bpmAlt ? ` · or ${Math.round(phase.result.bpmAlt)}` : ""}
                      </dd>
                    </div>
                    <div className="border-border border-r border-b p-5">
                      <dt className="label-caps text-muted-foreground">Key</dt>
                      <dd className="mt-2 text-4xl font-semibold tracking-tight">
                        {phase.result.key}
                        <span className="text-2xl">{phase.result.mode === "minor" ? "m" : ""}</span>
                      </dd>
                      <dd className="text-muted-foreground mt-1 text-xs">
                        {phase.result.key} {phase.result.mode}, {sure(phase.result.keyConfidence)} · relative {phase.result.relative}
                      </dd>
                    </div>
                    <div className="border-border border-r border-b p-5">
                      <dt className="label-caps text-muted-foreground">Camelot</dt>
                      <dd className="mt-2 text-4xl font-semibold tracking-tight">{phase.result.camelot}</dd>
                      <dd className="text-muted-foreground mt-1 text-xs">for mixing in key</dd>
                    </div>
                  </dl>
                  {phase.fromMic ? (
                    <p className="text-muted-foreground mt-4 text-sm">
                      Readings through a speaker are rougher than from a file. If it says “a guess”, listen again closer to the music.
                    </p>
                  ) : (
                    <p className="text-muted-foreground mt-4 text-sm">
                      Want the vocals or the instrumental of this track?{" "}
                      <Link to="/tools/vocal-remover" className="text-foreground underline underline-offset-4">
                        Split it with the free vocal remover
                      </Link>
                      .
                    </p>
                  )}
                  <Funnel
                    source="bpm-key-finder"
                    title="Make the loop to go with it"
                    body="Mirli makes music, sound effects and voices with AI models on your own computer, and splits songs into stems. Free and open source."
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <Block id="questions" label="Questions" title="What people ask first">
        <dl className="space-y-7">
          {FAQ.map((f) => (
            <div key={f.question}>
              <dt className="font-semibold tracking-tight">{f.question}</dt>
              <dd className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{f.answer}</dd>
            </div>
          ))}
        </dl>
      </Block>
    </main>
  );
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}
