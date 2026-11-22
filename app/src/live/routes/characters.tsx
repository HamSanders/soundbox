import { useQueryClient } from "@tanstack/react-query";
import { Mic, Video } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";

import { CharacterGrid } from "../components/character-grid";
import { LiveShell, LogLabel } from "../components/live-shell";
import { useCharacters, useLive } from "../live-context";
import { prefs } from "../lib/prefs";

/** Pick who to call. The choice is remembered for next time. */
export function CharactersPage() {
  const live = useLive();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data, isLoading, isError } = useCharacters();
  const list = data?.characters ?? [];
  const [picked, setSel] = useState<string | null>(prefs.get("character"));
  // The remembered pick if it is still on file, else the first character.
  const sel = list.some((c) => c.id === picked) ? picked : (list[0]?.id ?? null);
  const chosen = list.find((c) => c.id === sel);

  return (
    <LiveShell wide>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <LogLabel>{list.length ? `${list.length} on file` : " "}</LogLabel>
          <h1 className="font-display text-5xl font-extrabold uppercase tracking-wide">Who do you want to call?</h1>
          <p className="mt-1 text-muted-foreground">Any portrait works. Upload a photo and it becomes someone you can call.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="lg"><Link to="/voice"><Mic /> Voice only</Link></Button>
          <Button size="lg" disabled={!chosen} data-testid="start-video" onClick={() => chosen && nav(`/call/${encodeURIComponent(chosen.id)}`)}>
            <Video /> {chosen ? `Call ${chosen.name}` : "Start call"}
          </Button>
        </div>
      </div>

      <div className="mt-8">
        {isLoading ? <p className="text-muted-foreground">Loading characters…</p>
          : isError || !data?.face ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
              The face server isn't running, so there are no faces to call. <Link to="/voice" className="underline">Try a voice call</Link>.
            </div>
          ) : (
            <CharacterGrid
              characters={list}
              selected={sel}
              onPick={(c) => { setSel(c.id); prefs.set("character", c.id); }}
              onUploaded={async (id) => { await qc.invalidateQueries({ queryKey: ["live", "characters"] }); setSel(id); prefs.set("character", id); }}
            />
          )}
      </div>
      <p className="mt-6 font-log text-xs text-muted-foreground">portraits are served by {live.baseUrl}</p>
    </LiveShell>
  );
}
