import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Circle, List, Mic, MicOff, PhoneOff, Square, Users, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CallEnded } from "../components/call-ended";
import { CharacterGrid } from "../components/character-grid";
import { LogLabel, ThemeToggle } from "../components/live-shell";
import { PenLine } from "../components/pen-line";
import { useCharacters, useLive, useVoices } from "../live-context";
import type { CallState, TurnStats } from "../lib/call-session";
import { clock, pad, prefs } from "../lib/prefs";
import { useCall } from "../lib/use-call";

export const STATE_WORDS: Record<string, string> = {
  off: "ready to call", starting: "connecting", idle: "your turn", listening: "listening", thinking: "thinking",
  speaking: "speaking", error: "error", closed: "call ended",
};

export interface LogEntry { id: number; kind: "you" | "bot" | "sys"; text: string; at: number; live?: boolean; err?: boolean; no?: number }

/** The call log as a small state machine: partial → final for you, deltas for the reply. */
export function useCallLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const seq = useRef(0), no = useRef(0), you = useRef<number | null>(null), bot = useRef<number | null>(null), typed = useRef<string | null>(null);
  const t0 = useRef(0);
  const at = () => (t0.current ? (Date.now() - t0.current) / 1000 : 0);
  const add = (e: Omit<LogEntry, "id" | "at" | "no">) => {
    // Numbers are taken here, not inside the updater: StrictMode runs updaters twice.
    const entry = { ...e, id: ++seq.current, at: at(), no: e.kind === "sys" ? undefined : ++no.current };
    setEntries((l) => [...l, entry]);
    return entry.id;
  };
  const patch = (id: number, f: (e: LogEntry) => LogEntry) => setEntries((l) => l.map((e) => (e.id === id ? f(e) : e)));
  return {
    entries,
    /** The log's clock starts when the call connects (idempotent until clear). */
    start() { if (!t0.current) t0.current = Date.now(); },
    sys: (text: string, err?: boolean) => add({ kind: "sys", text, err }),
    typed(text: string) { add({ kind: "you", text }); typed.current = text; you.current = null; bot.current = null; },
    partial(text: string) {
      if (you.current == null) you.current = add({ kind: "you", text, live: true });
      else patch(you.current, (e) => ({ ...e, text }));
    },
    final(text: string) {
      const id = you.current;
      if (!text) { if (id != null) setEntries((l) => l.filter((e) => e.id !== id)); you.current = null; return; }
      // A typed message is already in the log; only spoken ones are added here.
      if (id != null) patch(id, (e) => ({ ...e, text, live: false }));
      else if (typed.current !== text) add({ kind: "you", text });
      typed.current = null; you.current = null; bot.current = null;
    },
    delta(d: string) {
      if (bot.current == null) bot.current = add({ kind: "bot", text: d, live: true });
      else patch(bot.current, (e) => ({ ...e, text: e.text + d }));
    },
    cut() { const id = bot.current; if (id != null) patch(id, (e) => ({ ...e, text: e.text + " —", live: false })); },
    settle() { const id = bot.current; if (id != null) patch(id, (e) => ({ ...e, live: false })); },
    clear() { setEntries([]); t0.current = 0; seq.current = 0; no.current = 0; you.current = bot.current = null; },
  };
}

export function VoicePicker({ value, onChange, className }: { value: string; onChange: (id: string) => void; className?: string }) {
  const { data: voices } = useVoices();
  return (
    <select
      aria-label="Voice"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("h-8 rounded-full border border-input bg-card px-3 text-sm", className)}
    >
      <option value="">Default voice</option>
      {(voices ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
    </select>
  );
}

export function VideoCallPage() {
  const { characterId = "" } = useParams();
  const nav = useNavigate();
  const live = useLive();
  const qc = useQueryClient();
  const { data: chars } = useCharacters();
  const [charId, setCharId] = useState(decodeURIComponent(characterId));
  const character = chars?.characters.find((c) => c.id === charId);
  const who = character?.name ?? "Mirli";

  const [voice, setVoiceState] = useState(prefs.get("voice") ?? "");
  const [circle, setCircle] = useState(prefs.get("shape") === "circle");
  const [showLog, setShowLog] = useState(prefs.get("log") === "1");
  const [stats, setStats] = useState(false);
  const [picking, setPicking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [video, setVideo] = useState(false);
  const [caption, setCaption] = useState("");
  const [turns, setTurns] = useState<TurnStats[]>([]);
  const [info, setInfo] = useState("");
  const [switching, setSwitching] = useState<string | null>(null);
  const [, tick] = useState(0);
  const log = useCallLog();
  const canvas = useRef<HTMLCanvasElement>(null);
  const logBox = useRef<HTMLDivElement>(null);
  const replyText = useRef("");

  const call = useCall("video", {
    voiceId: () => voice || undefined,
    persona: () => character?.persona,
    partial: (t) => log.partial(t),
    final: (t) => { log.final(t); replyText.current = ""; },
    replyDelta: (d) => {
      log.delta(d);
      replyText.current += d;
      const r = replyText.current;
      setCaption(r.length > 160 ? "…" + r.slice(-160) : r);
    },
    flush: () => log.cut(),
    state: (s: CallState) => {
      if (s === "idle") { log.start(); log.settle(); }
      if (s === "listening") { setCaption(""); replyText.current = ""; }
    },
    turn: (t) => setTurns((l) => [t, ...l].slice(0, 50)),
    note: (t, err) => log.sys(t, err),
    video: setVideo,
    info: setInfo,
  });
  const { session, state } = call;
  const liveCall = !!session && state !== "closed" && state !== "error" && !call.ended;

  useEffect(() => { session?.setCanvas(canvas.current); }, [session]);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(i); }, []);
  useEffect(() => { const b = logBox.current; if (b) b.scrollTop = b.scrollHeight; }, [log.entries]);
  useEffect(() => { prefs.set("shape", circle ? "circle" : "square"); }, [circle]);
  useEffect(() => { prefs.set("log", showLog ? "1" : "0"); }, [showLog]);

  const faceModels = useQuery({ queryKey: ["live", "face-models"], queryFn: live.faceModels, retry: false, refetchInterval: switching ? 1500 : false });
  const installed = (faceModels.data?.available ?? []).filter((m) => m.installed);
  useEffect(() => {
    if (switching && faceModels.data?.current === switching && !faceModels.data.switching) {
      setSwitching(null);
      log.sys(`Face model: ${installed.find((m) => m.id === switching)?.name ?? switching}.`);
    }
  }, [faceModels.data, switching]); // eslint-disable-line react-hooks/exhaustive-deps

  function setVoice(id: string) { setVoiceState(id); prefs.set("voice", id); session?.setVoice(id); }

  async function pickFace(id: string) {
    setPicking(false);
    if (id === charId) return;
    setCharId(id);
    prefs.set("character", id);
    nav(`/call/${encodeURIComponent(id)}`, { replace: true });
    if (!session?.startedAt) return;
    try {
      const r = await live.setCharacter(session.callId, id);
      session.setPersona(r.persona);
      log.sys(`Now talking to ${r.name}. New conversation.`);
    } catch (e) { log.sys("Could not switch: " + (e as Error).message, true); }
  }

  async function switchModel(id: string, name: string) {
    if (switching || id === faceModels.data?.current) return;
    setSwitching(id);
    if (session?.startedAt) log.sys(`Switching the face model to ${name}. Voice keeps going; the face is back in about 20 s.`);
    try { await live.switchFaceModel(id); } catch (e) { log.sys(String((e as Error).message), true); setSwitching(null); }
  }

  function sendTyped(text: string) {
    if (session?.sendText(text)) { log.typed(text); replyText.current = ""; return true; }
    return false;
  }

  const photo = character ? live.portraitUrl(character.id) : null;
  const elapsed = session?.startedAt ? clock(session.seconds) : "0:00";
  const modelName = installed.find((m) => m.id === faceModels.data?.current)?.name;

  return (
    <div className={cn("grid h-svh bg-background text-foreground", showLog ? "lg:grid-cols-[1fr_380px]" : "grid-cols-1")} data-state={state}>
      <section className="relative grid min-h-0 grid-rows-[auto_1fr_auto]">
        <header className="flex items-center gap-3 px-4 py-3">
          <Link to="/" aria-label="Mirli Live home" className="flex items-center gap-2"><BrandMark className="size-5" /></Link>
          <LogLabel>call No. {pad(call.callNo, 4)} · {liveCall ? `${video ? "video" : "voice"} call · ${elapsed}${modelName ? " · " + modelName : ""}` : "ready"}</LogLabel>
          <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 font-log text-xs" data-testid="call-state">
            <span className={cn("size-2 rounded-full", state === "speaking" ? "bg-signal animate-pulse" : state === "listening" ? "bg-ok" : state === "error" ? "bg-danger" : "bg-border-strong")} />
            {STATE_WORDS[state] ?? state}
          </span>
          <ThemeToggle />
        </header>

        <div className="grid min-h-0 place-items-center px-4">
          <div className={cn("relative aspect-square w-[min(72vh,92vw,640px)] overflow-hidden bg-muted transition-[border-radius] duration-500", circle ? "rounded-full" : "rounded-2xl")}>
            {photo ? <img alt="" src={photo} className={cn("absolute inset-0 size-full object-cover transition-opacity", video && "opacity-0")} /> : null}
            <canvas ref={canvas} width={512} height={512} className={cn("absolute inset-0 size-full", !video && "opacity-0")} data-testid="face-canvas" />
            {liveCall && caption && !showLog ? (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-dusk/85 to-transparent px-6 pt-16 pb-5 text-center text-lg leading-snug text-[#f1ece0]" data-testid="caption">{caption}</div>
            ) : null}
            {!liveCall ? (
              <div className="absolute inset-0 grid place-items-center bg-gradient-to-t from-dusk/70 to-transparent">
                <div className="mt-auto grid justify-items-center gap-3 pb-10">
                  <span className="font-display text-4xl font-extrabold uppercase tracking-wide text-[#f1ece0]">{who}</span>
                  <Button size="lg" className="h-12 px-7 text-base" data-testid="call-button" disabled={state === "starting"} onClick={() => void call.begin(charId || null)}>
                    <Video /> {state === "starting" ? "Connecting…" : `Call ${who}`}
                  </Button>
                  {call.error ? <p className="max-w-[40ch] rounded-md bg-background/90 px-3 py-2 text-center text-sm text-danger" role="alert">{call.error}</p> : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 px-4 pb-5">
          <PenLine session={session} className="mx-auto h-12 w-full max-w-[420px] text-foreground" />
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant={muted ? "secondary" : "outline"} size="lg" aria-pressed={muted} disabled={!liveCall} onClick={() => { setMuted(!muted); session?.setMuted(!muted); }}>
              {muted ? <MicOff /> : <Mic />} {muted ? "Muted" : "Mute"}
            </Button>
            <VoicePicker value={voice} onChange={setVoice} />
            <Button variant="outline" size="lg" aria-pressed={picking} onClick={() => setPicking(!picking)}><Users /> Faces</Button>
            <Button variant="outline" size="icon-lg" aria-label={circle ? "Square tile" : "Circle tile"} onClick={() => setCircle(!circle)}>{circle ? <Square /> : <Circle />}</Button>
            <Button variant="outline" size="lg" aria-pressed={showLog} onClick={() => setShowLog(!showLog)}><List /> Log</Button>
            <Button variant="outline" size="icon-lg" aria-label="Stats" aria-pressed={stats} onClick={() => { setStats(!stats); if (!showLog) setShowLog(true); }}><BarChart3 /></Button>
            <Button variant="destructive" size="lg" disabled={!liveCall} onClick={call.hangUp} data-testid="end-button"><PhoneOff /> End</Button>
          </div>
          {installed.length > 1 ? (
            <div className="flex items-center justify-center gap-2 font-log text-xs text-muted-foreground">
              face model
              <div className="inline-flex rounded-full border border-border p-0.5">
                {installed.map((m) => (
                  <button key={m.id} type="button" disabled={!!switching} aria-pressed={m.id === faceModels.data?.current}
                    className="rounded-full px-2.5 py-1 aria-pressed:bg-foreground aria-pressed:text-background disabled:opacity-60"
                    onClick={() => void switchModel(m.id, m.name)}>{m.name}</button>
                ))}
              </div>
              {switching ? <span>loading, about 20 s…</span> : null}
            </div>
          ) : null}
        </div>

        {picking ? (
          <div className="absolute inset-x-4 bottom-36 z-30 mx-auto max-w-2xl rounded-xl border border-border bg-popover p-4 shadow-xl" role="dialog" aria-label="Pick a face">
            <div className="mb-3 flex items-center justify-between">
              <b className="font-medium">Switch face</b>
              <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setPicking(false)}><X /></Button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              <CharacterGrid compact characters={chars?.characters ?? []} selected={charId}
                onPick={(c) => void pickFace(c.id)}
                onUploaded={async (id) => { await qc.invalidateQueries({ queryKey: ["live", "characters"] }); void pickFace(id); }} />
            </div>
          </div>
        ) : null}
      </section>

      {showLog ? (
        <aside className="hidden min-h-0 grid-rows-[auto_1fr_auto_auto] border-l border-border bg-card lg:grid" aria-label="Call log">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-medium">Log</h2><LogLabel>{elapsed}</LogLabel>
          </div>
          <div ref={logBox} className="min-h-0 overflow-y-auto px-4 py-3" data-testid="call-log">
            {log.entries.length ? log.entries.map((e) => (
              <div key={e.id} className={cn("mb-3", e.kind === "sys" && "text-sm text-muted-foreground", e.err && "text-danger")}>
                <div className="font-log text-2xs text-muted-foreground">
                  {e.no ? `No. ${pad(e.no)} · ` : ""}<b className="font-normal text-foreground">{e.kind === "you" ? "You" : e.kind === "bot" ? who : "note"}</b> · {clock(e.at)}
                </div>
                <div className={cn("whitespace-pre-wrap", e.live && "opacity-70")} data-kind={e.kind}>{e.text}</div>
              </div>
            )) : <p className="text-sm text-muted-foreground">Nothing said yet. Say hello, or type below.</p>}
          </div>
          {stats ? <TurnTable turns={turns} info={info} /> : null}
          <Compose disabled={!liveCall} onSend={sendTyped} />
        </aside>
      ) : null}
      {showLog ? null : liveCall ? <div className="fixed right-4 bottom-4 w-[min(360px,calc(100vw-2rem))]"><Compose disabled={!liveCall} onSend={sendTyped} floating /></div> : null}

      {call.ended ? (
        <CallEnded who={who} photo={photo} info={call.ended}
          onAgain={() => { call.reset(); log.clear(); setTurns([]); log.sys("New call."); }}
          onHome={() => nav("/")} />
      ) : null}
    </div>
  );
}

export function Compose({ disabled, onSend, floating = false }: { disabled: boolean; onSend: (t: string) => boolean; floating?: boolean }) {
  const [text, setText] = useState("");
  return (
    <form
      className={cn("flex items-end gap-2 p-3", floating ? "rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur" : "border-t border-border")}
      onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t && onSend(t)) setText(""); }}
    >
      <textarea
        rows={1}
        value={text}
        disabled={disabled}
        aria-label="Message"
        placeholder="Type a message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
        className="max-h-36 min-h-8 flex-1 resize-none rounded-md border border-input bg-field px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <Button type="submit" disabled={disabled || !text.trim()}>Send</Button>
    </form>
  );
}

function TurnTable({ turns, info }: { turns: TurnStats[]; info: string }) {
  const cell = (v: number | null | undefined) => (v == null ? "–" : String(v));
  return (
    <div className="max-h-56 overflow-y-auto border-t border-border px-4 py-3 font-log text-2xs" data-testid="turn-stats">
      <div className="mb-1 text-muted-foreground">{info}</div>
      <table className="w-full">
        <thead className="text-muted-foreground"><tr><th className="text-left font-normal">No.</th><th className="font-normal">wait</th><th className="font-normal">→ text</th><th className="font-normal">→ LLM</th><th className="font-normal">→ audio</th><th className="font-normal">heard</th><th className="font-normal">VRAM</th></tr></thead>
        <tbody>
          {turns.map((t) => (
            <tr key={t.turn} className="text-center">
              <td className="text-left">{pad(t.turn)}{t.barged_in ? " ✕" : ""}{t.discarded ? " –" : ""}</td>
              <td>{cell(t.endpoint_wait_ms)}</td><td>{cell(t.eos_to_transcript_ms)}</td><td>{cell(t.eos_to_first_token_ms)}</td>
              <td className={cn(t.eos_to_first_audio_ms != null && t.target_ms != null && t.eos_to_first_audio_ms > t.target_ms && "text-danger")}>{cell(t.eos_to_first_audio_ms)}</td>
              <td>{cell(t.heard_ms)}</td><td>{cell(t.vram_peak_mib)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 text-muted-foreground">ms from the end of your speech. Target → audio: 500.</div>
    </div>
  );
}
