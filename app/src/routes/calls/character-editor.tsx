import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ImagePlus, Loader2, Phone, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { VoicePicker } from "@/calls/components/call-bits";
import { Portrait } from "@/calls/components/character-grid";
import { MakeCallVoice } from "@/calls/components/make-call-voice";
import { calls, CallApiError, fileToDataUrl } from "@/calls/live-client";
import { callKeys, useCharacter } from "@/calls/queries";

const PERSONA_HINT = `Who they are, how they talk, what they ask about. Everything they say is spoken aloud, so ask for plain spoken sentences: no lists, no emoji, nothing in brackets.`;

type PortraitSource = "none" | "upload" | "draw";

/**
 * Make or edit a character: name, persona, voice and an optional portrait
 * (uploaded, or drawn by Mirli's image engine from a description).
 */
export function CharacterEditorPage() {
  const { characterId } = useParams();
  const editing = !!characterId;
  const existing = useCharacter(characterId ?? "");
  const c = existing.data;
  const nav = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [voice, setVoice] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [source, setSource] = useState<PortraitSource>("none");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (!c || loaded.current) return;
    loaded.current = true;
    setName(c.name); setPersona(c.persona); setVoice(c.voice_id ?? "");
  }, [c]);

  /** The portrait part of a save: an uploaded picture, a description to draw, or nothing. */
  function portraitBody(): { image?: string; prompt?: string } {
    if (source === "upload" && image) return { image };
    if (source === "draw" && prompt.trim()) return { prompt: prompt.trim() };
    return {};
  }

  async function save() {
    setErr(null); setSaved(false);
    if (!name.trim()) return setErr("Give them a name.");
    if (source === "draw" && !prompt.trim()) return setErr("Describe the portrait to draw, or pick No portrait.");
    setBusy(true);
    try {
      if (editing) {
        await calls.updateCharacter(characterId!, { name, persona, voice_id: voice || null, ...portraitBody() });
        setSaved(true);
        setImage(null); setPrompt(""); setSource("none");
        await qc.invalidateQueries({ queryKey: callKeys.characters });
        await existing.refetch();
      } else {
        const made = await calls.createCharacter({ name, persona: persona.trim() || undefined, voice_id: voice || null, ...portraitBody() });
        await qc.invalidateQueries({ queryKey: callKeys.characters });
        nav(`/calls/characters/${made.id}`, { replace: true });
      }
    } catch (e) {
      setErr(e instanceof CallApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!c || !confirm(`Delete ${c.name}? Their persona and portrait go too.`)) return;
    try {
      await calls.deleteCharacter(c.id);
      await qc.invalidateQueries({ queryKey: callKeys.characters });
      nav("/calls");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const current = c?.portrait_url ? `${c.portrait_url}?t=${existing.dataUpdatedAt}` : null;
  const shown = source === "upload" && image ? image : current;
  const drawing = source === "draw" && !!prompt.trim();

  return (
    <div className="grid max-w-4xl gap-8">
      <header className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to calls"><Link to="/calls"><ArrowLeft /></Link></Button>
        <div className="grid">
          <span className="font-log text-xs text-muted-foreground">{editing ? "character" : "new character"}</span>
          <h1 className="font-display text-4xl font-extrabold uppercase tracking-wide">{editing ? c?.name ?? "…" : "New character"}</h1>
        </div>
        {c ? (
          <div className="ml-auto flex gap-2">
            <Button asChild><Link to={`/calls/voice/${c.id}`}><Phone /> Call {c.name}</Link></Button>
          </div>
        ) : null}
      </header>
      {editing && existing.isError ? <p className="text-sm text-danger" role="alert">Couldn't load this character: {(existing.error as Error).message}</p> : null}

      <section className="grid gap-6 md:grid-cols-[240px_1fr]">
        <div className="grid content-start gap-3">
          <div className="aspect-square overflow-hidden rounded-xl border border-border bg-muted">
            {drawing ? (
              <div className="grid size-full place-items-center p-4 text-center text-sm text-muted-foreground">Drawn when you save</div>
            ) : (
              <Portrait name={name || c?.name || "?"} url={shown} className="size-full text-8xl" />
            )}
          </div>
          <span className="text-sm font-medium">Portrait <span className="font-normal text-muted-foreground">(optional)</span></span>
          <div className="inline-flex rounded-full border border-border p-0.5 text-sm" role="radiogroup" aria-label="Portrait">
            {(["none", "upload", "draw"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={source === s} onClick={() => setSource(s)}
                className="flex-1 rounded-full px-3 py-1 aria-checked:bg-foreground aria-checked:text-background">
                {s === "none" ? (current && editing ? "Keep" : "None") : s === "upload" ? "Upload" : "Draw"}
              </button>
            ))}
          </div>
          {source === "upload" ? (
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => file.current?.click()}><ImagePlus /> {image ? "Pick another" : current ? "Replace portrait" : "Upload a portrait"}</Button>
              {image ? <Button variant="ghost" size="icon" aria-label="Clear the upload" onClick={() => setImage(null)}><X /></Button> : null}
            </div>
          ) : source === "draw" ? (
            <Textarea aria-label="Portrait description" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
              placeholder="Photo of a friendly woman in her forties, curly grey hair, green apron, facing the camera, warm light" />
          ) : null}
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden data-testid="portrait-file"
            onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setImage(await fileToDataUrl(f)); }} />
          <p className="text-xs text-muted-foreground">Shown on their card and during the call. Without one, their card shows their initial.</p>
        </div>

        <div className="grid content-start gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ch-name">Name</Label>
            <Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rosa" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ch-persona">Persona</Label>
            <Textarea id="ch-persona" value={persona} onChange={(e) => setPersona(e.target.value)} rows={10}
              placeholder={editing ? "" : "Leave empty for a friendly default"} />
            <p className="text-xs text-muted-foreground">{PERSONA_HINT}</p>
          </div>
          <div className="grid gap-1.5">
            <Label>Voice</Label>
            <VoicePicker value={voice} onChange={setVoice} className="w-fit" />
            <p className="text-xs text-muted-foreground">Calls use your saved voices. With none picked, a saved voice with their name is used if there is one.</p>
            <MakeCallVoice name={name} onMade={setVoice} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={busy} data-testid="save-character">
              {busy ? <Loader2 className="animate-spin" /> : drawing ? <Sparkles /> : null}
              {editing ? (drawing ? "Draw and save" : "Save") : drawing ? "Draw and create" : "Create character"}
            </Button>
            {saved ? <span className="text-sm text-ok">Saved.</span> : null}
            {err ? <span className="text-sm text-danger" role="alert">{err}</span> : null}
            {c && !c.builtin ? <Button variant="ghost" className="ml-auto text-danger" onClick={() => void remove()}><Trash2 /> Delete</Button> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
