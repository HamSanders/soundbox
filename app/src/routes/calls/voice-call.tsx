import { AArrowDown, AArrowUp, ArrowLeft, Keyboard, Mic, MicOff, Phone, PhoneOff, Users } from "@/lib/icons";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CallState } from "@/calls/call-session";
import { CallEnded } from "@/calls/components/call-ended";
import { LogLabel, STATE_WORDS, VoicePicker, WORKER_DOWN } from "@/calls/components/call-bits";
import { CharacterGrid, Portrait } from "@/calls/components/character-grid";
import { PenLine } from "@/calls/components/pen-line";
import { calls } from "@/calls/live-client";
import { clock, pad, prefs } from "@/calls/prefs";
import { useCallStatus, useCharacters } from "@/calls/queries";
import { useCall } from "@/calls/use-call";

/** The newest words of a reply: a long reply keeps its tail in view. */
function tailWords(text: string, keep = 22) { return text.trim().split(/\s+/).filter(Boolean).slice(-keep); }

/**
 * A voice call: one pen stroke across the screen and the reply in big type
 * that fits its box (ported from the spike's voice.html). /calls/voice is
 * Mirli; /calls/voice/:characterId is that character. Another character can
 * be put on mid-call.
 */
export function VoiceCallPage() {
  const nav = useNavigate();
  const { characterId } = useParams();
  const { data: chars } = useCharacters();
  const status = useCallStatus();
  // Who is on the call: the route's character until a mid-call switch.
  const [switchedTo, setSwitchedTo] = useState<string | null>(null);
  const currentId = switchedTo ?? characterId ?? null;
  const character = currentId ? chars?.find((c) => c.id === currentId) : undefined;
  const [voice, setVoiceState] = useState("");
  const [muted, setMuted] = useState(false);
  const [typing, setTyping] = useState(false);
  const [picking, setPicking] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [you, setYou] = useState({ text: "", live: false });
  const [reply, setReply] = useState("");
  const [onCallName, setOnCallName] = useState<string | null>(null);
  const [scale, setScale] = useState(() => Number(prefs.get("voice-text") || 1));
  const [, tick] = useState(0);
  const [typed, setTyped] = useState("");
  const who = character?.name ?? onCallName ?? (currentId ? "…" : "Mirli");

  const call = useCall({
    voiceId: () => voice || character?.voice_id || undefined,
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

  function setVoice(id: string) { setVoiceState(id); session?.setVoice(id); }

  /** Put someone else on: the API records it, then their persona and voice go out on the socket. */
  async function switchTo(id: string) {
    if (id === currentId) return setPicking(false);
    setSwitching(id);
    try {
      const c = await call.switchCharacter(id);
      if (!c) return;
      setSwitchedTo(c.character);
      setOnCallName(c.name);
      setVoiceState(c.voice_id ?? "");
      setReply("");
      setYou({ text: `${c.name} is on the call now.`, live: false });
      setPicking(false);
    } catch (e) {
      setYou({ text: `Couldn't switch: ${(e as Error).message}`, live: false });
    } finally {
      setSwitching(null);
    }
  }

  const words = tailWords(reply);
  const voiceDown = status.data && !status.data.voice;
  const picker = <VoicePicker value={voice || character?.voice_id || session?.grant.voice_id || ""} onChange={setVoice} />;

  return (
    <div className={cn("relative grid min-h-0 flex-1 grid-rows-[auto_1fr_auto]", state === "speaking" && "speaking")} data-state={state}>
      <header className="flex items-center gap-3 pb-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to calls"><Link to="/calls"><ArrowLeft /></Link></Button>
        <LogLabel>call No. {pad(call.callNo, 4)} · {who}{liveCall ? ` · ${clock(session!.seconds)}` : ""}</LogLabel>
        <span className="ml-auto font-log text-xs text-muted-foreground" data-testid="call-state">{STATE_WORDS[state] ?? state}</span>
      </header>

      <main className="grid min-h-0 grid-rows-[auto_1fr_auto] px-5 sm:px-10">
        <p className={cn("min-h-6 text-lg text-muted-foreground", you.live && "italic")} data-testid="you-said">{you.text}</p>
        <div ref={box} className="min-h-0 overflow-hidden py-4">
          {liveCall && picking ? (
            <div className="grid max-h-full gap-3 overflow-y-auto" data-testid="switch-character">
              <LogLabel>put someone else on the call</LogLabel>
              <CharacterGrid compact characters={chars ?? []} selected={currentId} busyId={switching} onPick={(c) => void switchTo(c.id)} />
            </div>
          ) : liveCall ? (
            <p ref={said} className="font-display leading-[.95] font-extrabold uppercase tracking-wide break-words" data-testid="reply" aria-live="polite">
              {words.map((w, i) => <span key={`${words.length - i}-${w}`} className="inline-block animate-in fade-in duration-300">{w}&nbsp;</span>)}
            </p>
          ) : (
            <div className="grid h-full content-center justify-items-start gap-6">
              <h1 className="font-display text-[clamp(48px,9vw,120px)] leading-[.88] font-extrabold uppercase tracking-wide">{currentId ? `Call ${who}.` : "Just talk."}</h1>
              <p className="max-w-[46ch] text-lg text-muted-foreground">
                {currentId ? `A voice call with ${who}: live captions, and you can talk over them any time.` : "A voice call with Mirli: live captions, and you can talk over it any time."}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" className="h-12 px-7 text-base" data-testid="call-button" disabled={state === "starting"} onClick={() => void call.begin(currentId)}>
                  <Phone /> {state === "starting" ? "Connecting…" : "Start voice call"}
                </Button>
                {picker}
                {character ? <Portrait name={character.name} url={character.portrait_url} round className="size-10 border border-border text-lg" /> : null}
              </div>
              {call.error ? <p className="text-sm text-danger" role="alert">{call.error}</p> : voiceDown ? (
                <p className="font-log text-xs text-muted-foreground" data-testid="worker-down">{WORKER_DOWN}</p>
              ) : null}
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
        <Button variant="outline" size="lg" aria-pressed={picking} disabled={!liveCall || !chars?.length} onClick={() => setPicking(!picking)} data-testid="switch-button">
          <Users /> Switch
        </Button>
        <Button variant="outline" size="icon-lg" aria-label="Smaller text" onClick={() => setTextScale(scale - 0.1)}><AArrowDown /></Button>
        <Button variant="outline" size="icon-lg" aria-label="Bigger text" onClick={() => setTextScale(scale + 0.1)}><AArrowUp /></Button>
        {liveCall ? picker : null}
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
        <CallEnded who={who} photo={character?.portrait_url ? calls.url(character.portrait_url) : null} info={call.ended}
          onAgain={() => { call.reset(); setReply(""); setYou({ text: "", live: false }); setPicking(false); }}
          onHome={() => nav("/calls")} />
      ) : null}
    </div>
  );
}
