import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Circle, List, Mic, MicOff, PhoneOff, Square, Users, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CallState, TurnStats } from "@/calls/call-session";
import { CallEnded } from "@/calls/components/call-ended";
import { Compose, LogLabel, STATE_WORDS, TurnTable, useCallLog, VoicePicker } from "@/calls/components/call-bits";
import { CharacterGrid } from "@/calls/components/character-grid";
import { PenLine } from "@/calls/components/pen-line";
import { calls } from "@/calls/live-client";
import { clock, pad, prefs } from "@/calls/prefs";
import { callKeys, useCharacters } from "@/calls/queries";
import { useCall } from "@/calls/use-call";
import { usePosePack } from "@/calls/use-pose-pack";

/**
 * A video call with a character: the live talking face, or, for a character
 * with an avatar pack (Santa), the pose clips with the live face pasted into
 * the talk pose.
 */
export function VideoCallPage() {
  const { characterId = "santa" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: chars } = useCharacters();
  const [charId, setCharId] = useState(characterId);
  const character = chars?.find((c) => c.id === charId);
  const who = character?.name ?? "…";

  const [voice, setVoiceState] = useState("");
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
  const packRef = useRef<ReturnType<typeof usePosePack> | null>(null);

  const call = useCall("video", {
    voiceId: () => voice || character?.voice_id || undefined,
    persona: () => character?.persona,
    partial: (t) => log.partial(t),
    final: (t) => { log.final(t); replyText.current = ""; },
    replyDelta: (raw) => {
      const d = packRef.current?.active ? packRef.current.onDelta(raw) : raw;
      if (!d) return;
      log.delta(d);
      replyText.current += d;
      const r = replyText.current;
      setCaption(r.length > 160 ? "…" + r.slice(-160) : r);
    },
    flush: () => log.cut(),
    state: (s: CallState) => {
      if (s === "idle") { log.start(); log.settle(); packRef.current?.start(); }
      if (s === "listening") { setCaption(""); replyText.current = ""; }
      packRef.current?.onState(s);
    },
    turn: (t) => setTurns((l) => [t, ...l].slice(0, 50)),
    note: (t, err) => log.sys(t, err),
    video: setVideo,
    info: setInfo,
    ended: () => packRef.current?.stop(),
  });
  const { session, state } = call;
  const pack = usePosePack(character, session);
  packRef.current = pack;
  const liveCall = !!session && state !== "closed" && state !== "error" && !call.ended;

  useEffect(() => { if (!pack.active) session?.setCanvas(canvas.current); }, [session, pack.active]);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(i); }, []);
  useEffect(() => { const b = logBox.current; if (b) b.scrollTop = b.scrollHeight; }, [log.entries]);
  useEffect(() => { prefs.set("shape", circle ? "circle" : "square"); }, [circle]);
  useEffect(() => { prefs.set("log", showLog ? "1" : "0"); }, [showLog]);

  const faceModels = useQuery({ queryKey: callKeys.faceModels, queryFn: calls.faceModels, retry: false, refetchInterval: switching ? 1500 : false });
  const installed = (faceModels.data?.available ?? []).filter((m) => m.installed);
  useEffect(() => {
    if (switching && faceModels.data?.current === switching && !faceModels.data.switching) {
      setSwitching(null);
      log.sys(`Face model: ${installed.find((m) => m.id === switching)?.name ?? switching}.`);
    }
  }, [faceModels.data, switching]); // eslint-disable-line react-hooks/exhaustive-deps

  function setVoice(id: string) { setVoiceState(id); session?.setVoice(id); }

  async function pickFace(id: string) {
    setPicking(false);
    if (id === charId) return;
    setCharId(id);
    nav(`/calls/video/${id}`, { replace: true });
    if (!session?.startedAt) return;
    try {
      const r = await calls.setCharacter(session.callId, id);
      session.setPersona(r.persona);
      if (r.voice_id && !voice) session.setVoice(r.voice_id);
      log.sys(`Now talking to ${r.name}. New conversation.`);
    } catch (e) { log.sys("Could not switch: " + (e as Error).message, true); }
  }

  async function switchModel(id: string, name: string) {
    if (switching || id === faceModels.data?.current) return;
    setSwitching(id);
    if (session?.startedAt) log.sys(`Switching the face model to ${name}. Voice keeps going; the face is back in about 20 s.`);
    try { await calls.switchFaceModel(id); } catch (e) { log.sys(String((e as Error).message), true); setSwitching(null); }
  }

  function sendTyped(text: string) {
    if (session?.sendText(text)) { log.typed(text); replyText.current = ""; return true; }
    return false;
  }

  const photo = character ? calls.url(character.portrait_url) : null;
  const elapsed = session?.startedAt ? clock(session.seconds) : "0:00";
  const modelName = installed.find((m) => m.id === faceModels.data?.current)?.name;
  const tall = pack.active; // a pack is 4:5, framed like its clips

  return (
    <div className={cn("grid min-h-0 flex-1", showLog ? "lg:grid-cols-[1fr_380px]" : "grid-cols-1")} data-state={state} data-pack={pack.active ? "1" : "0"}>
      <section className="relative grid min-h-0 grid-rows-[auto_1fr_auto]">
        <header className="flex items-center gap-3 pb-3">
          <Button asChild variant="ghost" size="icon-sm" aria-label="Back to calls"><Link to="/calls"><ArrowLeft /></Link></Button>
          <LogLabel>call No. {pad(call.callNo, 4)} · {liveCall ? `${video ? "video" : "voice"} call · ${elapsed}${modelName ? " · " + modelName : ""}` : "ready"}</LogLabel>
          <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 font-log text-xs" data-testid="call-state">
            <span className={cn("size-2 rounded-full", state === "speaking" ? "bg-signal animate-pulse" : state === "listening" ? "bg-ok" : state === "error" ? "bg-danger" : "bg-border-strong")} />
            {STATE_WORDS[state] ?? state}
          </span>
        </header>

        <div className="grid min-h-0 place-items-center">
          <div className={cn("relative overflow-hidden bg-muted transition-[border-radius] duration-500",
            tall ? "aspect-[4/5] h-[min(70vh,760px)] max-w-[92vw] rounded-2xl" : "aspect-square w-[min(68vh,92vw,640px)]",
            !tall && (circle ? "rounded-full" : "rounded-2xl"))}>
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
                {photo ? <img alt="" src={photo} className={cn("absolute inset-0 size-full object-cover transition-opacity", video && "opacity-0")} /> : null}
                <canvas ref={canvas} width={512} height={512} className={cn("absolute inset-0 size-full", !video && "opacity-0")} data-testid="face-canvas" />
              </>
            )}
            {liveCall && caption && !showLog ? (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-dusk/85 to-transparent px-6 pt-16 pb-5 text-center text-lg leading-snug text-[#f1ece0]" data-testid="caption">{caption}</div>
            ) : null}
            {!liveCall ? (
              <div className="absolute inset-0 grid place-items-center bg-gradient-to-t from-dusk/70 to-transparent">
                <div className="mt-auto grid justify-items-center gap-3 pb-10">
                  <span className="font-display text-4xl font-extrabold uppercase tracking-wide text-[#f1ece0]">{who}</span>
                  <Button size="lg" className="h-12 px-7 text-base" data-testid="call-button" disabled={state === "starting" || !character} onClick={() => void call.begin(charId)}>
                    <Video /> {state === "starting" ? "Connecting…" : `Call ${who}`}
                  </Button>
                  {call.error ? <p className="max-w-[40ch] rounded-md bg-background/90 px-3 py-2 text-center text-sm text-danger" role="alert">{call.error}</p> : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 pt-3">
          <PenLine session={session} className="mx-auto h-12 w-full max-w-[420px] text-foreground" />
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant={muted ? "secondary" : "outline"} size="lg" aria-pressed={muted} disabled={!liveCall} onClick={() => { setMuted(!muted); session?.setMuted(!muted); }}>
              {muted ? <MicOff /> : <Mic />} {muted ? "Muted" : "Mute"}
            </Button>
            <VoicePicker value={voice || character?.voice_id || session?.grant.voice_id || ""} onChange={setVoice} />
            <Button variant="outline" size="lg" aria-pressed={picking} onClick={() => setPicking(!picking)}><Users /> Faces</Button>
            {!tall ? <Button variant="outline" size="icon-lg" aria-label={circle ? "Square tile" : "Circle tile"} onClick={() => setCircle(!circle)}>{circle ? <Square /> : <Circle />}</Button> : null}
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
              <CharacterGrid compact characters={chars ?? []} selected={charId}
                onPick={(c) => void pickFace(c.id)}
                onUploaded={async (id) => { await qc.invalidateQueries({ queryKey: callKeys.characters }); void pickFace(id); }} />
            </div>
          </div>
        ) : null}
      </section>

      {showLog ? (
        <aside className="hidden min-h-0 grid-rows-[auto_1fr_auto_auto] rounded-xl border border-border bg-card lg:ml-4 lg:grid" aria-label="Call log">
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
      {showLog ? null : liveCall ? <div className="fixed right-4 bottom-4 z-20 w-[min(360px,calc(100vw-2rem))]"><Compose disabled={!liveCall} onSend={sendTyped} floating /></div> : null}

      {call.ended ? (
        <CallEnded who={who} photo={photo} info={call.ended}
          onAgain={() => { call.reset(); log.clear(); setTurns([]); log.sys("New call."); }}
          onHome={() => nav("/calls")} />
      ) : null}
    </div>
  );
}
