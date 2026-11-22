import { ArrowRight, Mic, Video } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";

import { LiveShell, LogLabel, ServiceStatus } from "../components/live-shell";
import { useCharacters, useHealth, useLive } from "../live-context";

const TICKER = ["say hi", "talk over it and it stops", "type if you'd rather", "upload any photo", "switch faces mid-call",
  "pick any Mirli voice", "≈ 0.5 s to the first word", "headphones help"];

const STEPS = [
  ["Listen", "Your mic, in 32 ms frames"],
  ["Detect", "Voice activity; a reply starts after 160 ms of quiet"],
  ["Transcribe", "Speech to text in about 20 ms"],
  ["Think", "A language model with a persona per character"],
  ["Speak", "A cloned voice, streamed in 160 ms chunks"],
  ["Show", "A talking face from one photo, sound and picture on one clock"],
];

export function LandingPage() {
  const live = useLive();
  const { data: health } = useHealth();
  const { data: chars } = useCharacters();
  const strip = (chars?.characters ?? []).filter((c) => c.kind === "character").slice(0, 6);
  const local = health?.mode !== "cloud";

  return (
    <LiveShell wide>
      <section className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-center">
        <div className="grid gap-6">
          <ServiceStatus />
          <h1 className="font-display text-[clamp(44px,7vw,88px)] leading-[.9] font-extrabold uppercase tracking-wide">
            Real-time calls with AI characters.
          </h1>
          <p className="max-w-[52ch] text-lg text-muted-foreground">
            Speech in, a cloned voice and a talking face out, in about half a second. Interrupt any time.
            {local ? " Running on your own GPU: nothing leaves this machine." : ""}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-12 px-6 text-base">
              <Link to="/characters"><Video /> Start a video call</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-12 px-6 text-base">
              <Link to="/voice"><Mic /> Voice only</Link>
            </Button>
          </div>
          <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_10%,#000_90%,transparent)]">
            <div className="flex w-max animate-[live-ticker_40s_linear_infinite] gap-8 font-log text-xs text-muted-foreground">
              {[...TICKER, ...TICKER].map((t, i) => <span key={i}>{t}</span>)}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {strip.length ? strip.map((c) => (
            <Link key={c.id} to={`/call/${encodeURIComponent(c.id)}`} title={`Call ${c.name}`} aria-label={`Call ${c.name}`} className="group overflow-hidden rounded-lg border border-border bg-card">
              <img alt="" loading="lazy" src={live.portraitUrl(c.id)} className="aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
              <span className="block px-2 py-1.5 font-log text-xs text-muted-foreground">{c.name}</span>
            </Link>
          )) : (
            <div className="col-span-3 grid aspect-[3/2] place-items-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              {health?.face ? "No characters yet. Upload a photo to make one." : "Start the face server to see the characters."}
            </div>
          )}
        </div>
      </section>

      <section className="mt-20 grid gap-4 sm:grid-cols-2">
        {[
          { to: "/characters", tag: "video", title: "Face to face", body: "Pick a character or upload any photo. It talks, blinks and lip-syncs to the voice. Switch faces mid-call.", cta: "Start a video call" },
          { to: "/voice", tag: "voice", title: "Just talk", body: "No camera, no face. A full-screen call with live captions, lighter on the GPU and a little faster to answer.", cta: "Start a voice call" },
        ].map((m) => (
          <Link key={m.to} to={m.to} className="group grid gap-3 rounded-xl border border-border bg-card p-6 hover:border-border-strong">
            <LogLabel>{m.tag}</LogLabel>
            <h2 className="font-display text-3xl font-extrabold uppercase tracking-wide">{m.title}</h2>
            <p className="text-muted-foreground">{m.body}</p>
            <span className="inline-flex items-center gap-1 text-sm font-medium">{m.cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></span>
          </Link>
        ))}
      </section>

      <section className="mt-20">
        <h2 className="font-display text-3xl font-extrabold uppercase tracking-wide">How a turn works</h2>
        <p className="mt-1 text-muted-foreground">Each stage streams into the next, so the reply starts before the sentence is finished.</p>
        <ol className="mt-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
          {STEPS.map(([b, s], i) => (
            <li key={b} className="grid gap-1 bg-card p-5">
              <LogLabel>{String(i + 1).padStart(2, "0")}</LogLabel>
              <b className="font-medium">{b}</b>
              <span className="text-sm text-muted-foreground">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-20 flex flex-wrap gap-4 border-t border-border pt-6 font-log text-xs text-muted-foreground">
        <span>Mirli Live</span>
        <span>{local ? "runs on 127.0.0.1" : "Mirli Cloud"}</span>
        <Link to="/account" className="hover:text-foreground">minutes</Link>
      </footer>
    </LiveShell>
  );
}
