/**
 * /tools/bpm-key-finder: tempo and key of a song, worked out in the browser.
 *
 * Nothing is uploaded: the file is decoded with the Web Audio API and
 * analysed by src/tools/analyze.ts on this machine.
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import { faqJsonLd, SeoHead } from "@/components/seo-head";
import { type Analysis, analyze, mixDown } from "../../tools/analyze";
import { decodeFile } from "../../tools/free-api";
import { Block, DropZone, formatDuration, Funnel } from "../../tools/ui";

type Phase =
  | { kind: "idle" }
  | { kind: "working"; name: string }
  | { kind: "done"; name: string; seconds: number; result: Analysis }
  | { kind: "error"; message: string };

const FAQ = [
  {
    question: "Is my song uploaded?",
    answer: "No. Your browser decodes and analyses the file on your own computer. Nothing is sent anywhere.",
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

export function BpmKeyFinderPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  async function onFile(file: File) {
    setPhase({ kind: "working", name: file.name });
    let buffer: AudioBuffer;
    try {
      buffer = await decodeFile(file);
    } catch {
      setPhase({ kind: "error", message: "We couldn't read that file. Try an MP3, WAV, FLAC, M4A or OGG." });
      return;
    }
    // Yield so the "Analysing" state paints before the work starts.
    await new Promise((r) => setTimeout(r, 30));
    const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const mono = mixDown(chans);
    const len = Math.min(mono.length, buffer.sampleRate * MAX_ANALYSE_S);
    const from = Math.max(0, Math.floor((mono.length - len) / 2));
    const result = analyze(mono.subarray(from, from + len), buffer.sampleRate);
    setPhase({ kind: "done", name: file.name, seconds: buffer.duration, result });
  }

  const sure = (c: number) => (c > 0.66 ? "sure" : c > 0.33 ? "fairly sure" : "a guess");

  return (
    <main id="main">
      <SeoHead
        title="Free BPM and key finder: tempo and key of any song | Mirli"
        description="Find the BPM and musical key of a song in your browser. Nothing is uploaded. Shows the Camelot code for DJs, plus half- and double-time tempos."
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
            Drop in a track and get its BPM, key and Camelot code. It runs in your browser, so nothing is uploaded.
          </p>

          <div className="mt-10 text-left">
            <DropZone onFile={onFile} disabled={phase.kind === "working"} hint="MP3, WAV, FLAC, M4A or OGG. Stays on your computer." />
            <div aria-live="polite" className="mt-6">
              {phase.kind === "working" ? <p className="text-muted-foreground text-sm">Analysing {phase.name}…</p> : null}
              {phase.kind === "error" ? (
                <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                  {phase.message}
                </p>
              ) : null}
              {phase.kind === "done" ? (
                <div>
                  <p className="text-muted-foreground mb-3 truncate text-sm">
                    {phase.name} · {formatDuration(phase.seconds)}
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
                  <p className="text-muted-foreground mt-4 text-sm">
                    Want the vocals or the instrumental of this track?{" "}
                    <Link to="/tools/vocal-remover" className="text-foreground underline underline-offset-4">
                      Split it with the free vocal remover
                    </Link>
                    .
                  </p>
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
