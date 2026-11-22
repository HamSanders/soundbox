import { AArrowDown, AArrowUp, Keyboard, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CallEnded } from "../components/call-ended";
import { LogLabel, ThemeToggle } from "../components/live-shell";
import { PenLine } from "../components/pen-line";
import type { CallState } from "../lib/call-session";
import { clock, pad, prefs } from "../lib/prefs";
import { useCall } from "../lib/use-call";
import { STATE_WORDS, VoicePicker } from "./video-call";

/** The newest words of a reply: a long reply keeps its tail in view. */
export const tailWords = (text: string, keep = 22) => text.trim().split(/\s+/).filter(Boolean).slice(-keep);

/**
 * Voice only: one pen stroke across the screen and the reply in big type that
 * fits its box (ported from the spike's voice.html).
 */
export function VoiceCallPage() {
  const nav = useNavigate();
  const [voice, setVoiceState] = useState(prefs.get("voice") ?? "");
  const [muted, setMuted] = useState(false);
  const [typing, setTyping] = useState(false);
  const [you, setYou] = useState({ text: "", live: false });
  const [reply, setReply] = useState("");
  const [scale, setScale] = useState(() => Number(prefs.get("voice-text") || 1));
  const [, tick] = useState(0);
  const [typed, setTyped] = useState("");

  const call = useCall("voice", {
    voiceId: () => voice || undefined,
    partial: (t) => setYou({ text: t, live: true }),
    final: (t) => { setYou((y) => ({ text: t || y.text, live: false })); setReply(""); },
    replyDelta: (d) => setReply((r) => r + d),
    state: (s: CallState) => {
      if (s === "listening") setReply("");
      if (s === "idle") setYou((y) => (y.text ? y : { text: "Say something.", live: false }));
    },
    note: (t, err) => { if (err) setYou({ text: t, live: false }); },
  });
  const { session, state } = call;
  const liveCall = !!session && state !== "closed" && state !== "error" && !call.ended;
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(i); }, []);

  // Fit the reply: the biggest size that fits the box, times the reader's own scale.
  const box = useRef<HTMLDivElement>(null), said = useRef<HTMLParagraphElement>(null);
  const fit = useCallback(() => {
    const b = box.current, el = said.current;
    if (!b || !el || !el.textContent?.trim()) return;
    const maxH = b.clientHeight - 8, maxW = b.clientWidth;
    let lo = 18, hi = Math.min(220, maxH);
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = mid + "px";
      if (el.scrollHeight <= maxH && el.scrollWidth <= maxW) lo = mid; else hi = mid;
    }
    el.style.fontSize = Math.max(18, lo * scale) + "px";
  }, [scale]);
  useLayoutEffect(fit, [reply, fit]);
  useEffect(() => { addEventListener("resize", fit); return () => removeEventListener("resize", fit); }, [fit]);
  const setTextScale = (v: number) => { const s = Math.min(1, Math.max(0.5, +v.toFixed(2))); setScale(s); prefs.set("voice-text", String(s)); };

  function setVoice(id: string) { setVoiceState(id); prefs.set("voice", id); session?.setVoice(id); }
  const words = tailWords(reply);

  return (
    <div className={cn("relative grid h-svh grid-rows-[auto_1fr_auto] bg-background text-foreground", state === "speaking" && "speaking")} data-state={state}>
      <header className="flex items-center gap-3 px-5 py-4">
        <Link to="/" aria-label="Mirli Live home"><BrandMark className="size-5" /></Link>
        <LogLabel>call No. {pad(call.callNo, 4)} · voice{liveCall ? ` · ${clock(session!.seconds)}` : ""}</LogLabel>
        <span className="ml-auto font-log text-xs text-muted-foreground" data-testid="call-state">{STATE_WORDS[state] ?? state}</span>
        <ThemeToggle />
      </header>

      <main className="grid min-h-0 grid-rows-[auto_1fr_auto] px-5 sm:px-10">
        <p className={cn("min-h-6 text-lg text-muted-foreground", you.live && "italic")} data-testid="you-said">{you.text}</p>
        <div ref={box} className="min-h-0 overflow-hidden py-4">
          {liveCall ? (
            <p ref={said} className="font-display leading-[.95] font-extrabold uppercase tracking-wide break-words" data-testid="reply" aria-live="polite">
              {words.map((w, i) => <span key={`${words.length - i}-${w}`} className="inline-block animate-in fade-in duration-300">{w}&nbsp;</span>)}
            </p>
          ) : (
            <div className="grid h-full content-center justify-items-start gap-6">
              <h1 className="font-display text-[clamp(48px,9vw,120px)] leading-[.88] font-extrabold uppercase tracking-wide">Just talk.</h1>
              <p className="max-w-[46ch] text-lg text-muted-foreground">A voice call with Mirli. No camera, no face: live captions, and you can talk over it any time.</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" className="h-12 px-7 text-base" data-testid="call-button" disabled={state === "starting"} onClick={() => void call.begin(null)}>
                  <Phone /> {state === "starting" ? "Connecting…" : "Start voice call"}
                </Button>
                <VoicePicker value={voice} onChange={setVoice} />
              </div>
              {call.error ? <p className="text-sm text-danger" role="alert">{call.error}</p> : null}
            </div>
          )}
        </div>
        <PenLine session={session} withCaller className="h-28 w-full text-foreground" />
      </main>

      <footer className="flex flex-wrap items-center justify-center gap-2 px-5 pt-2 pb-6">
        <Button variant={muted ? "secondary" : "outline"} size="lg" aria-pressed={muted} disabled={!liveCall} onClick={() => { setMuted(!muted); session?.setMuted(!muted); }}>
          {muted ? <MicOff /> : <Mic />} <span>{muted ? "Muted" : "Mute"}</span>
        </Button>
        <Button variant="outline" size="lg" aria-pressed={typing} disabled={!liveCall} onClick={() => setTyping(!typing)}><Keyboard /> Type</Button>
        <Button variant="outline" size="icon-lg" aria-label="Smaller text" onClick={() => setTextScale(scale - 0.1)}><AArrowDown /></Button>
        <Button variant="outline" size="icon-lg" aria-label="Bigger text" onClick={() => setTextScale(scale + 0.1)}><AArrowUp /></Button>
        {liveCall ? <VoicePicker value={voice} onChange={setVoice} /> : null}
        <Button variant="destructive" size="lg" disabled={!liveCall} onClick={call.hangUp} data-testid="end-button"><PhoneOff /> End</Button>
      </footer>

      {typing && liveCall ? (
        <form
          className="absolute inset-x-5 bottom-24 mx-auto flex max-w-xl gap-2 rounded-xl border border-border bg-card p-2 shadow-lg"
          onSubmit={(e) => {
            e.preventDefault();
            const t = typed.trim();
            if (!t || !session?.sendText(t)) return;
            setYou({ text: t, live: false }); setReply(""); setTyped("");
          }}
        >
          <input autoFocus aria-label="Message" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type instead of talking"
            className="h-9 flex-1 rounded-md border border-input bg-field px-3 text-sm outline-none" />
          <Button type="submit">Send</Button>
        </form>
      ) : null}

      {call.ended ? (
        <CallEnded who="Mirli" info={call.ended}
          onAgain={() => { call.reset(); setReply(""); setYou({ text: "", live: false }); }}
          onHome={() => nav("/")} />
      ) : null}
    </div>
  );
}
