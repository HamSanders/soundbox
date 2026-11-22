import { ArrowLeft, BellRing, Mic, MicOff, Phone, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { cn } from "@/lib/utils";

import type { CallState } from "@/calls/call-session";
import { CallEnded } from "@/calls/components/call-ended";
import { useCallLog } from "@/calls/components/call-bits";
import { calls } from "@/calls/live-client";
import { clock } from "@/calls/prefs";
import { useCharacters } from "@/calls/queries";
import { useCall } from "@/calls/use-call";
import { usePosePack } from "@/calls/use-pose-pack";

/**
 * A video call, FaceTime style (after Jingle Line's call screen, ~/santa-call/public/call.html):
 *
 *   ready → ringing (avatar, ring, cancel) → picked up: full-bleed video with a blurred fill,
 *   the name and clock top left, Video/Chat top right, a glass bar with mute and hang up.
 *
 * The character "picks up" once the call connects and the face (or its avatar pack) is ready, and says
 * hello first. A character with a pack (Santa) plays its pose clips and hands over to the live face on
 * the talk pose; without one, the live face fills the frame. No microphone: the call opens in Chat.
 */
export function VideoCallPage() {
  const { characterId = "santa" } = useParams();
  const nav = useNavigate();
  const { data: chars } = useCharacters();
  const character = chars?.find((c) => c.id === characterId);
  const who = character?.name ?? "…";
  const isSanta = characterId === "santa";

  const [phase, setPhase] = useState<"ready" | "ringing" | "live">("ready");
  const [chat, setChat] = useState(false);
  const [userPicked, setUserPicked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [video, setVideo] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [, tick] = useState(0);
  const log = useCallLog();
  const faceCanvas = useRef<HTMLCanvasElement>(null);
  const bg = useRef<HTMLCanvasElement>(null);
  const chatBox = useRef<HTMLDivElement>(null);
  const packRef = useRef<ReturnType<typeof usePosePack> | null>(null);
  const answered = useRef(false);
  const ring = useRef<Ringer | null>(null);

  const call = useCall("video", {
    persona: () => character?.persona,
    voiceId: () => character?.voice_id || undefined,
    partial: (t) => log.partial(t),
    final: (t) => log.final(t),
    replyDelta: (raw) => {
      setThinking(false);
      const d = packRef.current?.active ? packRef.current.onDelta(raw) : raw;
      if (d) log.delta(d);
    },
    flush: () => log.cut(),
    state: (s: CallState) => {
      if (s === "idle") { log.start(); log.settle(); setThinking(false); maybeAnswer(); }
      if (s === "thinking") setThinking(true);
      packRef.current?.onState(s);
    },
    note: (t, err) => log.sys(t, err),
    video: (on) => { setVideo(on); if (on) maybeAnswer(); },
    ended: () => { ring.current?.stop(); packRef.current?.stop(); },
  });
  const { session, state } = call;
  const pack = usePosePack(character, session);
  packRef.current = pack;

  /** "Picking up": leave the ringing screen once the line is open and there is something to show. */
  function maybeAnswer(force = false) {
    const s = call.session ?? sessionRef.current;
    if (answered.current || !s?.startedAt) return;
    if (!force && !s.videoOn && !packRef.current?.active) return;
    answered.current = true;
    ring.current?.stop();
    setPhase("live");
    packRef.current?.start();
    if (s.noMic) { setUserPicked(true); setChat(true); }
    // The character speaks first, like answering the phone.
    s.sendText("Hello?");
    log.typed("Hello?");
  }
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // No face and no pack: pick up after a couple of rings anyway, voice only.
  useEffect(() => {
    if (phase !== "ringing" || !session) return;
    const t = setTimeout(() => maybeAnswer(true), 4500);
    return () => clearTimeout(t);
  }, [phase, session]); // eslint-disable-line react-hooks/exhaustive-deps
  // Without a pack the live face draws straight into the frame.
  useEffect(() => { if (!pack.active) session?.setCanvas(faceCanvas.current); }, [session, pack.active]);
  // No camera on the other end: all the text, in chat (unless the caller chose).
  useEffect(() => { if (phase === "live" && !userPicked) setChat(!video && !pack.active); }, [video, pack.active, phase, userPicked]);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(i); }, []);
  useEffect(() => { const b = chatBox.current; if (b) b.scrollTop = b.scrollHeight; }, [log.entries, thinking]);
  useEffect(() => () => ring.current?.stop(), []);

  // The blurred fill: whatever the frame shows, tiny, a few times a second.
  useEffect(() => {
    if (phase !== "live") return;
    const i = setInterval(() => {
      const g = bg.current?.getContext("2d");
      if (!g) return;
      const live = pack.active ? (pack.live ? pack.refs.canvas.current : [pack.refs.a.current, pack.refs.b.current].find((v) => v?.dataset.front === "1")) : faceCanvas.current;
      try { if (live) g.drawImage(live, 0, 0, 48, 48); } catch { /* a video not ready yet */ }
    }, 120);
    return () => clearInterval(i);
  }, [phase, pack.active, pack.live, pack.refs]);

  function start() {
    if (!character) return;
    answered.current = false;
    log.clear();
    setPhase("ringing");
    // Both made inside the click: Chrome won't start audio after an await.
    ring.current = new Ringer(isSanta ? "bells" : "phone");
    ring.current.start();
    void call.begin(character.id).then((ok) => { if (!ok) { ring.current?.stop(); setPhase("ready"); } });
  }
  function cancel() { ring.current?.stop(); call.hangUp("cancelled"); setPhase("ready"); }
  // A call cancelled while ringing never happened: straight back to the call button.
  useEffect(() => { if (call.ended?.reason === "cancelled") call.reset(); }, [call.ended]); // eslint-disable-line react-hooks/exhaustive-deps
  function hangUp() { ring.current?.stop(); call.hangUp(); }
  function pick(chatMode: boolean) { setUserPicked(true); setChat(chatMode); }

  const photo = character ? calls.url(character.portrait_url) : null;
  const speaking = state === "speaking";
  const elapsed = session?.startedAt ? clock(session.seconds) : "0:00";

  // ---- Ended ----
  if (call.ended && call.ended.reason !== "cancelled") {
    return (
      <CallEnded who={who} photo={photo} info={call.ended}
        onAgain={() => { call.reset(); start(); /* redial, like Jingle Line */ }}
        onHome={() => nav("/calls")} />
    );
  }

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-[#0e0c0b] text-[#f4f1ea]" data-state={state} data-phase={phase} data-pack={pack.active ? "1" : "0"}>
      {/* Santa's line: the night sky and snow, like Jingle Line. */}
      {isSanta && (phase !== "live" || chat) ? (
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_110%,rgba(255,138,61,.18),transparent_60%),linear-gradient(180deg,#0b1324_0%,#142445_100%)]"><Snow /></div>
      ) : null}
      {/* Blurred fill behind everything (in a call), or the portrait (before and while ringing). */}
      {isSanta && (phase !== "live" || chat) ? null : phase === "live" && !chat ? (
        <canvas ref={bg} width={48} height={48} aria-hidden className="absolute -inset-16 h-[calc(100%+8rem)] w-[calc(100%+8rem)] blur-[40px] brightness-[.55] saturate-[1.2]" />
      ) : photo ? (
        <img alt="" src={photo} aria-hidden className="absolute -inset-16 h-[calc(100%+8rem)] w-[calc(100%+8rem)] object-cover blur-[50px] brightness-[.35]" />
      ) : null}

      {/* ---- Ready: who you're calling and the big green button ---- */}
      {phase === "ready" ? (
        <section className="relative grid h-full place-items-center p-6 text-center">
          <Link to="/calls" aria-label="Back to calls" className="absolute top-4 left-4 grid size-11 place-items-center rounded-full bg-white/10 hover:bg-white/20"><ArrowLeft className="size-5" /></Link>
          <div className="grid justify-items-center gap-5">
            {photo ? <img alt="" src={photo} className="size-36 rounded-full object-cover shadow-2xl ring-1 ring-white/15" /> : null}
            <h1 className="font-display text-[clamp(48px,10vw,88px)] leading-[.9] font-extrabold uppercase tracking-wide">{who}</h1>
            <p className="max-w-[36ch] text-[#f4f1ea]/65">{isSanta ? "He's by the fire, cocoa in hand. Tell him your name and what's on your list." : "A live video call. Talk over them any time."}</p>
            <button type="button" data-testid="call-button" disabled={!character} onClick={start}
              className={cn("mt-2 inline-flex items-center gap-3 rounded-full px-9", isSanta ? "bg-[#c8312f]" : "bg-[#34c759]", " py-5 text-xl font-semibold text-white shadow-[0_0_0_0_rgba(52,199,89,.5)] transition hover:brightness-110 active:scale-[.98] disabled:opacity-50")}>
              <Phone className="size-6" /> Call {who}
            </button>
            {call.error ? <p className="max-w-[40ch] text-sm text-[#ff9b8f]" role="alert">{call.error}</p> : null}
          </div>
        </section>
      ) : null}

      {/* ---- Ringing: FaceTime-style outgoing call ---- */}
      {phase === "ringing" ? (
        <section className="relative grid h-full grid-rows-[1fr_auto] justify-items-center px-4 pt-[max(64px,12dvh)] pb-[max(40px,env(safe-area-inset-bottom))] text-center" data-testid="ringing">
          <div>
            {isSanta ? (
              <div className="mx-auto mb-[18px] grid size-28 place-items-center rounded-full bg-[radial-gradient(circle_at_50%_35%,#e0443f,#c8312f)]">
                <BellRing className="size-[54px] origin-[50%_8%] text-[#f5c84b] motion-safe:animate-[ring_1.2s_ease-in-out_infinite]" />
              </div>
            ) : photo ? <img alt="" src={photo} className="mx-auto mb-5 size-28 rounded-full object-cover ring-1 ring-white/15" /> : null}
            <h2 className="mb-1.5 text-[34px] leading-tight font-semibold tracking-tight">{character?.builtin && isSanta ? "Santa Claus" : who}</h2>
            <p className="text-[17px] text-[#f4f1ea]/65 after:inline-block after:w-4 after:text-left after:content-['…'] motion-safe:after:animate-pulse">{isSanta ? "calling the North Pole" : "calling"}</p>
          </div>
          <RoundButton label="Cancel call" hang onClick={cancel}><Phone className="rotate-[135deg]" /></RoundButton>
        </section>
      ) : null}

      {/* ---- In the call ---- */}
      <section className={cn("absolute inset-0", phase !== "live" && "pointer-events-none opacity-0")} aria-hidden={phase !== "live"}>
        {/* The picture: full-bleed on a phone, a cropped 4:5 portrait frame on a desktop. */}
        <div className={cn("absolute inset-0 overflow-hidden md:inset-auto md:top-1/2 md:left-1/2 md:aspect-[4/5] md:h-[min(78dvh,760px)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[28px] md:shadow-[0_30px_80px_rgba(0,0,0,.5)]", chat && "hidden")} data-testid="call-frame">
          {pack.active ? (
            <>
              {pack.still ? <img alt="" src={pack.still} className="absolute inset-0 size-full object-cover" /> : null}
              {[pack.refs.a, pack.refs.b].map((r, i) => (
                <video key={i} ref={r} muted playsInline className="absolute inset-0 size-full object-cover opacity-0 data-[front=1]:opacity-100" data-testid="pose-video" />
              ))}
              <canvas ref={pack.refs.canvas} className={cn("absolute inset-0 size-full object-cover transition-opacity duration-150", pack.live ? "opacity-100" : "opacity-0")} data-testid="face-canvas" data-live={pack.live ? "1" : "0"} />
            </>
          ) : (
            <>
              {photo ? <img alt="" src={photo} className={cn("absolute inset-0 size-full object-cover transition-opacity duration-500", video && "opacity-0")} /> : null}
              <canvas ref={faceCanvas} width={512} height={512} className={cn("absolute inset-0 size-full object-cover transition-opacity duration-500", !video && "opacity-0")} data-testid="face-canvas" />
              {!video ? <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(80%_60%_at_50%_100%,rgba(255,138,61,.3),transparent_70%)] text-center font-semibold text-[#f4f1ea]/70">{who}'s camera is off.<br />You can still talk.</div> : null}
            </>
          )}
        </div>

        {/* Chat: plain bubbles, both sides. */}
        {chat ? (
          <div ref={chatBox} className="absolute inset-x-0 top-[86px] bottom-0 flex flex-col gap-1.5 overflow-y-auto px-[max(16px,calc(50%-300px))] pt-2 pb-52" data-testid="call-chat" aria-live="polite">
            {log.entries.map((e) => e.kind === "sys" ? (
              <p key={e.id} className={cn("self-center text-xs text-[#f4f1ea]/55", e.err && "text-[#ff9b8f]")}>{e.text}</p>
            ) : (
              <div key={e.id} data-kind={e.kind}
                className={cn("max-w-[78%] rounded-[20px] px-3.5 py-2 text-base leading-snug break-words whitespace-pre-wrap",
                  e.kind === "you" ? "self-end rounded-br-md bg-[#0a84ff] text-white" : "self-start rounded-bl-md bg-white/13",
                  e.live && e.kind === "you" && "opacity-60")}>
                {e.text}
              </div>
            ))}
            {thinking ? <div className="inline-flex gap-1 self-start rounded-[20px] rounded-bl-md bg-white/13 px-3.5 py-3.5">{[0, 1, 2].map((i) => <i key={i} className="size-1.5 rounded-full bg-white/60 motion-safe:animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}</div> : null}
          </div>
        ) : null}

        {/* Name, speaking dot, clock. */}
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/45 to-transparent px-5 pt-[max(18px,env(safe-area-inset-top))] pr-40 pb-10 md:bg-none">
          <b className="block text-xl font-semibold">{isSanta ? "Santa Claus" : who}</b>
          <span className="inline-flex items-center gap-1.5 text-sm text-[#f4f1ea]/65 tabular-nums">
            <span className={cn("size-2 rounded-full transition-colors", speaking ? "bg-[#f5c84b]" : "bg-[#f4f1ea]/60")} data-testid="speaking-dot" />
            {elapsed}
          </span>
          <span className="sr-only" data-testid="call-state">{state}</span>
        </div>

        {/* Video / Chat. */}
        <div className="absolute top-[max(14px,env(safe-area-inset-top))] right-3.5 z-10 flex rounded-full bg-[rgba(40,40,44,.55)] p-[3px] backdrop-blur-xl" role="group" aria-label="View">
          {([["Video", false], ["Chat", true]] as const).map(([label, c]) => (
            <button key={label} type="button" aria-pressed={chat === c} onClick={() => pick(c)}
              className="rounded-full px-3 py-2 text-[13px] font-semibold text-[#f4f1ea]/65 aria-pressed:bg-[#f4f1ea] aria-pressed:text-[#111]">{label}</button>
          ))}
        </div>

        {/* Compose (chat) and the glass control bar. */}
        <div className={cn("absolute inset-x-0 bottom-0 grid justify-items-center gap-3.5 px-4 pt-16 pb-[max(24px,env(safe-area-inset-bottom))]", chat ? (isSanta ? "bg-gradient-to-b from-transparent to-[#142445] to-40%" : "bg-gradient-to-b from-transparent to-[#0e0c0b] to-40%") : "bg-gradient-to-b from-transparent to-black/55 md:bg-none")}>
          {chat ? (
            <form className="flex w-[min(600px,100%)] gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget, inp = f.elements.namedItem("msg") as HTMLInputElement, t = inp.value.trim();
                if (t && session?.sendText(t)) { log.typed(t); setThinking(true); inp.value = ""; }
              }}>
              <input name="msg" aria-label="Message" placeholder={`Message ${who}`} autoComplete="off" enterKeyHint="send"
                className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-base outline-none focus:border-white/40" />
              <button type="submit" aria-label="Send" className="grid size-[42px] flex-none place-items-center rounded-full bg-[#0a84ff] text-white"><Send className="size-[18px]" /></button>
            </form>
          ) : null}
          <div className="flex justify-center gap-[18px] rounded-full bg-[rgba(40,40,44,.55)] px-[18px] py-3 backdrop-blur-xl">
            <RoundButton label={muted ? "Unmute microphone" : "Mute microphone"} pressed={muted} disabled={!!session?.noMic}
              onClick={() => { setMuted(!muted); session?.setMuted(!muted); }}>{muted ? <MicOff /> : <Mic />}</RoundButton>
            <RoundButton label="Hang up" hang onClick={hangUp} testId="end-button"><Phone className="rotate-[135deg]" /></RoundButton>
          </div>
        </div>
      </section>
    </div>
  );
}

/** A few slow flakes (Jingle Line's snow). */
function Snow() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const g = c.getContext("2d")!;
    let W = 0, H = 0, raf = 0;
    let flakes: { x: number; y: number; r: number; v: number; p: number }[] = [];
    const size = () => {
      const d = devicePixelRatio || 1;
      W = c.width = c.clientWidth * d; H = c.height = c.clientHeight * d;
      flakes = Array.from({ length: Math.round(c.clientWidth / 14) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: (Math.random() * 1.6 + 0.6) * d, v: (Math.random() * 0.35 + 0.15) * d, p: Math.random() * 6 }));
    };
    size();
    addEventListener("resize", size);
    const f = () => {
      g.clearRect(0, 0, W, H);
      g.fillStyle = "rgba(244,241,234,.8)";
      for (const k of flakes) {
        k.y += k.v; k.p += 0.01; k.x += Math.sin(k.p) * 0.3;
        if (k.y > H) { k.y = -4; k.x = Math.random() * W; }
        g.beginPath(); g.arc(k.x, k.y, k.r, 0, 7); g.fill();
      }
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", size); };
  }, []);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 size-full opacity-70" />;
}

function RoundButton({ label, children, onClick, hang = false, pressed, disabled, testId }: {
  label: string; children: React.ReactNode; onClick: () => void; hang?: boolean; pressed?: boolean; disabled?: boolean; testId?: string;
}) {
  return (
    <button type="button" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} data-testid={testId}
      className={cn("grid size-[60px] place-items-center rounded-full transition-colors disabled:opacity-40 [&_svg]:size-[26px]",
        hang ? "bg-[#eb4d3d] text-white hover:bg-[#f2604f]" : "bg-[#f4f1ea]/18 text-[#f4f1ea] hover:bg-[#f4f1ea]/28 aria-pressed:bg-[#f4f1ea] aria-pressed:text-[#111]")}>
      {children}
    </button>
  );
}

/** The ring while connecting, synthesised (no asset): sleigh bells for Santa, a soft two-tone phone ring for anyone else. */
class Ringer {
  #ctx: AudioContext | null = null;
  #timer: number | undefined;
  kind: "bells" | "phone";
  constructor(kind: "bells" | "phone") { this.kind = kind; }
  start() {
    try { this.#ctx = new AudioContext(); void this.#ctx.resume(); } catch { return; }
    const ring = () => {
      const ctx = this.#ctx;
      if (!ctx || ctx.state === "closed") return;
      const t = ctx.currentTime;
      const tone = (f: number, s: number, len: number, vol: number) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(vol, s + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, s + len);
        o.connect(g).connect(ctx.destination);
        o.start(s);
        o.stop(s + len + 0.05);
      };
      if (this.kind === "bells") {
        for (let i = 0; i < 6; i++) for (const f of [2093, 2637, 3136]) tone(f * (1 + (Math.random() - 0.5) * 0.01), t + i * 0.07, 0.35, 0.025);
      } else {
        for (let i = 0; i < 2; i++) { tone(440, t + i * 0.45, 0.4, 0.05); tone(480, t + i * 0.45, 0.4, 0.05); }
      }
    };
    ring();
    this.#timer = window.setInterval(ring, 1800);
  }
  stop() {
    window.clearInterval(this.#timer);
    void this.#ctx?.close().catch(() => {});
    this.#ctx = null;
  }
}
