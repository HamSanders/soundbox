import { Clapperboard, Mic, Pencil, Phone, Plus, Video } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { calls, type Character } from "@/calls/live-client";
import { clock } from "@/calls/prefs";
import { useCallHistory, useCallStatus, useCharacters } from "@/calls/queries";

/** The Calls area's landing: who you can call, how, and what you've used. */
export function CallsHomePage() {
  const status = useCallStatus();
  const chars = useCharacters();
  const history = useCallHistory();
  const s = status.data;
  const voiceUp = !!s?.voice, faceUp = !!s?.face;
  const byId = new Map((chars.data ?? []).map((c) => [c.id, c]));

  return (
    <div className="grid gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <span className="font-log text-xs text-muted-foreground">calls</span>
          <h1 className="font-display text-5xl font-extrabold uppercase tracking-wide">Calls</h1>
          <p className="max-w-[60ch] text-muted-foreground">
            Real-time voice and video calls with characters, on your own GPU. Speech in, a voice and a talking face out, in about half a second. Talk over them any time.
          </p>
        </div>
        <ServiceLine loading={status.isLoading} voice={voiceUp} face={faceUp ? s!.face!.engine : null} />
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <Link to="/calls/voice" className="grid gap-2 rounded-xl border border-border bg-card p-5 hover:border-border-strong" data-testid="voice-call-card">
          <span className="flex items-center gap-2 font-log text-xs text-muted-foreground"><Mic className="size-3.5" /> voice</span>
          <b className="font-display text-3xl font-extrabold uppercase tracking-wide">Just talk</b>
          <span className="text-sm text-muted-foreground">A voice call with Mirli: live captions, no camera, a little faster to answer.</span>
        </Link>
        <Link to="/calls/new" className="grid gap-2 rounded-xl border border-dashed border-border-strong/60 bg-card p-5 hover:border-foreground" data-testid="create-character-card">
          <span className="flex items-center gap-2 font-log text-xs text-muted-foreground"><Plus className="size-3.5" /> character</span>
          <b className="font-display text-3xl font-extrabold uppercase tracking-wide">Create your own</b>
          <span className="text-sm text-muted-foreground">Upload or draw a portrait, write who they are, pick a voice. Render an avatar pack for moving poses.</span>
        </Link>
      </section>

      <section className="grid gap-4">
        <h2 className="font-medium">Characters</h2>
        {chars.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : chars.isError ? (
          <p className="text-sm text-danger">Couldn't load characters: {(chars.error as Error).message}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {(chars.data ?? []).map((c) => <CharacterCard key={c.id} c={c} faceUp={faceUp} />)}
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="font-medium">Recent calls</h2>
        <p className="text-sm text-muted-foreground">
          Calls on this machine are free and unlimited{history.data ? ` · ${clock(history.data.used_seconds)} talked since Mirli started` : ""}. Mirli Cloud minutes, for calls without a GPU, are coming.
        </p>
        {history.data?.recent_calls.length ? (
          <table className="w-full text-sm">
            <thead className="font-log text-xs text-muted-foreground"><tr><th className="py-2 text-left font-normal">when</th><th className="text-left font-normal">with</th><th className="text-left font-normal">kind</th><th className="text-right font-normal">length</th></tr></thead>
            <tbody>
              {history.data.recent_calls.map((r) => (
                <tr key={r.call} className="border-t border-border" data-testid="recent-call">
                  <td className="py-2">{new Date(r.started * 1000).toLocaleString()}</td>
                  <td>{r.character ? byId.get(r.character)?.name ?? r.character : "Mirli"}</td>
                  <td>{r.mode}</td>
                  <td className="text-right font-log">{clock(r.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}

function ServiceLine({ loading, voice, face }: { loading: boolean; voice: boolean; face: string | null }) {
  const dot = (on: boolean) => <span className={cn("size-2 rounded-full", loading ? "bg-muted-foreground/40" : on ? "bg-ok" : "bg-danger")} />;
  return (
    <div className="grid gap-1 font-log text-xs text-muted-foreground" data-testid="call-service">
      <span className="flex items-center gap-2">{dot(voice)} voice server {loading ? "…" : voice ? "running" : "not running"}</span>
      <span className="flex items-center gap-2">{dot(!!face)} face server {loading ? "…" : face ? `running (${face})` : "not running"}</span>
    </div>
  );
}

function CharacterCard({ c, faceUp }: { c: Character; faceUp: boolean }) {
  return (
    <div className="group overflow-hidden rounded-xl border border-border bg-card" data-testid="character-card" data-id={c.id}>
      <Link to={`/calls/video/${c.id}`} className="relative block aspect-square overflow-hidden bg-muted" aria-label={`Call ${c.name}`}>
        <img alt="" loading="lazy" src={calls.url(c.portrait_url)} className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        {c.pack.status === "ready" ? (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-dusk/70 px-2 py-0.5 font-log text-2xs text-[#f1ece0]"><Clapperboard className="size-3" /> {c.pack.clips} clips</span>
        ) : c.pack.status === "rendering" ? (
          <span className="absolute top-2 left-2 rounded-full bg-dusk/70 px-2 py-0.5 font-log text-2xs text-[#f1ece0]">rendering…</span>
        ) : null}
      </Link>
      <div className="flex items-center gap-1 px-3 py-2">
        <b className="mr-auto truncate font-medium">{c.name}</b>
        <Button asChild variant="ghost" size="icon-sm" aria-label={`Voice call ${c.name}`}><Link to={`/calls/voice/${c.id}`}><Phone /></Link></Button>
        {faceUp ? <Button asChild variant="ghost" size="icon-sm" aria-label={`Video call ${c.name}`}><Link to={`/calls/video/${c.id}`}><Video /></Link></Button> : null}
        <Button asChild variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`}><Link to={`/calls/characters/${c.id}`}><Pencil /></Link></Button>
      </div>
    </div>
  );
}
