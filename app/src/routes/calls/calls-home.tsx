import { Mic, Pencil, Phone, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { WORKER_DOWN } from "@/calls/components/call-bits";
import { CharacterGrid } from "@/calls/components/character-grid";
import { clock } from "@/calls/prefs";
import { useCallHistory, useCallStatus, useCharacters } from "@/calls/queries";

/** The Calls area's landing: who you can call, the voice worker's state, and what you've talked. */
export function CallsHomePage() {
  const status = useCallStatus();
  const chars = useCharacters();
  const history = useCallHistory();
  const nav = useNavigate();
  const voiceUp = !!status.data?.voice;
  const byId = new Map((chars.data ?? []).map((c) => [c.id, c]));

  return (
    <div className="grid gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <span className="font-log text-xs text-muted-foreground">calls</span>
          <h1 className="font-display text-5xl font-extrabold uppercase tracking-wide">Calls</h1>
          <p className="max-w-[60ch] text-muted-foreground">
            Real-time voice calls with characters, on your own GPU. You talk, they answer out loud in about half a second, and you can talk over them any time.
          </p>
        </div>
        <ServiceLine loading={status.isLoading} unreachable={status.isError} voice={voiceUp} />
      </header>

      {!status.isLoading && !voiceUp ? (
        <p className="rounded-lg border border-border bg-card px-4 py-3 font-log text-sm text-muted-foreground" role="status" data-testid="worker-down">
          {status.isError ? `Can't reach the Mirli server: ${(status.error as Error).message}` : WORKER_DOWN}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2">
        <Link to="/calls/voice" className="grid gap-2 rounded-xl border border-border bg-card p-5 hover:border-border-strong" data-testid="voice-call-card">
          <span className="flex items-center gap-2 font-log text-xs text-muted-foreground"><Mic className="size-3.5" /> voice</span>
          <b className="font-display text-3xl font-extrabold uppercase tracking-wide">Talk to Mirli</b>
          <span className="text-sm text-muted-foreground">A voice call with Mirli herself, with live captions.</span>
        </Link>
        <Link to="/calls/new" className="grid gap-2 rounded-xl border border-dashed border-border-strong/60 bg-card p-5 hover:border-foreground" data-testid="new-character-card">
          <span className="flex items-center gap-2 font-log text-xs text-muted-foreground"><Plus className="size-3.5" /> character</span>
          <b className="font-display text-3xl font-extrabold uppercase tracking-wide">New character</b>
          <span className="text-sm text-muted-foreground">Write who they are and pick a voice. A portrait is optional: upload one or have Mirli draw it.</span>
        </Link>
      </section>

      <section className="grid gap-4">
        <h2 className="font-medium">Characters</h2>
        {chars.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : chars.isError ? (
          <p className="text-sm text-danger">Couldn't load characters: {(chars.error as Error).message}</p>
        ) : (
          <CharacterGrid
            characters={chars.data ?? []}
            onPick={(c) => nav(`/calls/voice/${c.id}`)}
            newTo="/calls/new"
            actions={(c) => (
              <>
                <Button asChild variant="ghost" size="icon-sm" aria-label={`Voice call ${c.name}`}><Link to={`/calls/voice/${c.id}`}><Phone /></Link></Button>
                <Button asChild variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`}><Link to={`/calls/characters/${c.id}`}><Pencil /></Link></Button>
              </>
            )}
          />
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="font-medium">Recent calls</h2>
        <p className="text-sm text-muted-foreground">
          Calls on this machine are free and unlimited.{history.data ? ` ${clock(history.data.used_seconds)} talked since Mirli started.` : ""}
        </p>
        {history.data?.recent_calls.length ? (
          <table className="w-full text-sm">
            <thead className="font-log text-xs text-muted-foreground"><tr><th className="py-2 text-left font-normal">when</th><th className="text-left font-normal">with</th><th className="text-right font-normal">length</th></tr></thead>
            <tbody>
              {history.data.recent_calls.map((r) => (
                <tr key={r.call} className="border-t border-border" data-testid="recent-call">
                  <td className="py-2">{new Date(r.started * 1000).toLocaleString()}</td>
                  <td>{r.character ? byId.get(r.character)?.name ?? r.character : "Mirli"}</td>
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

function ServiceLine({ loading, unreachable, voice }: { loading: boolean; unreachable: boolean; voice: boolean }) {
  return (
    <div className="flex items-center gap-2 font-log text-xs text-muted-foreground" data-testid="call-service">
      <span className={cn("size-2 rounded-full", loading ? "bg-muted-foreground/40" : voice ? "bg-ok" : "bg-danger")} />
      voice worker {loading ? "…" : unreachable ? "unknown" : voice ? "running" : "not running"}
    </div>
  );
}
