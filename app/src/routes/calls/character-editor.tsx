import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clapperboard, Cloud, FolderInput, ImagePlus, Loader2, Phone, Sparkles, Trash2, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { VoicePicker } from "@/calls/components/call-bits";
import { calls, CallApiError, fileToDataUrl, type Character } from "@/calls/live-client";
import { callKeys, useCharacter } from "@/calls/queries";

const PERSONA_HINT = `Who they are, how they talk, what they ask about. Everything they say is spoken aloud, so ask for plain spoken sentences: no lists, no emoji, nothing in brackets.`;

/**
 * Make or edit a character: portrait (upload, or drawn by Mirli's image
 * engine), persona, voice. An existing one also gets its avatar pack: pose
 * stills and clips rendered through ComfyUI (local now, Mirli Cloud later),
 * or imported from a folder.
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
  const [source, setSource] = useState<"upload" | "draw">("upload");
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

  async function save() {
    setErr(null); setSaved(false);
    if (!name.trim()) return setErr("Give them a name.");
    setBusy(true);
    try {
      if (editing) {
        await calls.updateCharacter(characterId!, { name, persona, voice_id: voice || null, ...(image ? { image } : {}) });
        setSaved(true);
        setImage(null);
      } else {
        if (source === "upload" && !image) throw new Error("Upload a portrait first.");
        if (source === "draw" && !prompt.trim()) throw new Error("Describe the portrait to draw.");
        const made = await calls.createCharacter({
          name, persona: persona.trim() || undefined, voice_id: voice || null,
          ...(source === "upload" ? { image: image! } : { prompt }),
        });
        await qc.invalidateQueries({ queryKey: callKeys.characters });
        nav(`/calls/characters/${made.id}`, { replace: true });
        return;
      }
      await qc.invalidateQueries({ queryKey: callKeys.characters });
      await existing.refetch();
    } catch (e) {
      setErr(e instanceof CallApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!c || !confirm(`Delete ${c.name}? Their portrait and avatar pack go too.`)) return;
    await calls.deleteCharacter(c.id);
    await qc.invalidateQueries({ queryKey: callKeys.characters });
    nav("/calls");
  }

  const portrait = image ?? (c ? `${calls.url(c.portrait_url)}?t=${existing.dataUpdatedAt}` : null);

  return (
    <div className="grid max-w-4xl gap-8">
      <header className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to calls"><Link to="/calls"><ArrowLeft /></Link></Button>
        <div className="grid">
          <span className="font-log text-xs text-muted-foreground">{editing ? "character" : "new character"}</span>
          <h1 className="font-display text-4xl font-extrabold uppercase tracking-wide">{editing ? c?.name ?? "…" : "Create a character"}</h1>
        </div>
        {c ? (
          <div className="ml-auto flex gap-2">
            <Button asChild variant="outline"><Link to={`/calls/voice/${c.id}`}><Phone /> Voice call</Link></Button>
            <Button asChild><Link to={`/calls/video/${c.id}`}><Video /> Video call</Link></Button>
          </div>
        ) : null}
      </header>

      <section className="grid gap-6 md:grid-cols-[240px_1fr]">
        <div className="grid content-start gap-3">
          <div className="aspect-square overflow-hidden rounded-xl border border-border bg-muted">
            {portrait ? <img alt="" src={portrait} className="size-full object-cover" data-testid="portrait-preview" /> : (
              <div className="grid size-full place-items-center p-4 text-center text-sm text-muted-foreground">
                {source === "draw" ? "Drawn when you create the character" : "No portrait yet"}
              </div>
            )}
          </div>
          {!editing ? (
            <div className="inline-flex rounded-full border border-border p-0.5 text-sm" role="radiogroup" aria-label="Portrait">
              {(["upload", "draw"] as const).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={source === s} onClick={() => setSource(s)}
                  className="flex-1 rounded-full px-3 py-1 aria-checked:bg-foreground aria-checked:text-background">{s === "upload" ? "Upload" : "Draw"}</button>
              ))}
            </div>
          ) : null}
          {source === "upload" || editing ? (
            <Button variant="outline" onClick={() => file.current?.click()}><ImagePlus /> {editing ? "Replace portrait" : "Upload a portrait"}</Button>
          ) : (
            <Textarea aria-label="Portrait description" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
              placeholder="Photo of a friendly woman in her forties, curly grey hair, green apron, facing the camera, warm light" />
          )}
          <input ref={file} type="file" accept="image/*" hidden data-testid="portrait-file"
            onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setImage(await fileToDataUrl(f)); }} />
          <p className="text-xs text-muted-foreground">A face looking at the camera works best. It's cropped square for the live face.</p>
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
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={busy} data-testid="save-character">
              {busy ? <Loader2 className="animate-spin" /> : source === "draw" && !editing ? <Sparkles /> : null}
              {editing ? "Save" : source === "draw" ? "Draw and create" : "Create character"}
            </Button>
            {saved ? <span className="text-sm text-ok">Saved.</span> : null}
            {err ? <span className="text-sm text-danger" role="alert">{err}</span> : null}
            {c && !c.builtin ? <Button variant="ghost" className="ml-auto text-danger" onClick={() => void remove()}><Trash2 /> Delete</Button> : null}
          </div>
        </div>
      </section>

      {c ? <PackPanel c={c} onChange={() => void existing.refetch()} /> : null}
    </div>
  );
}

function PackPanel({ c, onChange }: { c: Character; onChange: () => void }) {
  const [comfy, setComfy] = useState("http://127.0.0.1:8188");
  const [dir, setDir] = useState("");
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const qc = useQueryClient();
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ text: ok }); onChange(); await qc.invalidateQueries({ queryKey: callKeys.characters }); }
    catch (e) { setMsg({ text: (e as Error).message, err: true }); }
  };
  const p = c.pack;
  return (
    <section className="grid gap-4 rounded-xl border border-border bg-card p-6" data-testid="pack-panel">
      <div className="flex flex-wrap items-center gap-3">
        <Clapperboard className="size-5" />
        <h2 className="font-medium">Avatar pack</h2>
        <span className={cn("rounded-full px-2 py-0.5 font-log text-xs", p.status === "ready" ? "bg-ok/15 text-ok" : p.status === "failed" ? "bg-danger/15 text-danger" : "bg-muted text-muted-foreground")} data-testid="pack-status">
          {p.status === "ready" ? `ready · ${p.clips} clips` : p.status === "rendering" ? `rendering · ${p.progress ?? "…"}` : p.status === "failed" ? "failed" : "none"}
        </span>
      </div>
      <p className="max-w-[70ch] text-sm text-muted-foreground">
        Without a pack, video calls show the live talking face on its own. A pack adds pose stills and short clips between them (leaning in, looking away, laughing, thinking), played around the live face so the character moves like someone on a call. It's rendered from the portrait by the avatar creator: Qwen-Image-Edit for the poses, Wan 2.2 for the clips.
      </p>
      {p.status === "failed" && p.error ? <p className="font-log text-xs text-danger">{p.error}</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="grid content-start gap-2 rounded-lg border border-border p-4">
          <b className="text-sm font-medium">Render on this machine</b>
          <p className="text-xs text-muted-foreground">Needs ComfyUI running with the avatar creator's models (about 70 GB) and a GPU with room next to the call servers.</p>
          <Input aria-label="ComfyUI address" value={comfy} onChange={(e) => setComfy(e.target.value)} />
          <Button variant="outline" disabled={p.status === "rendering"} onClick={() => void run(() => calls.renderPack(c.id, "local", comfy), "Rendering started. This takes a while; the status updates here.")}>
            {p.status === "rendering" ? <Loader2 className="animate-spin" /> : <Clapperboard />} Render pack
          </Button>
        </div>
        <div className="grid content-start gap-2 rounded-lg border border-border p-4">
          <b className="text-sm font-medium">Render in Mirli Cloud</b>
          <p className="text-xs text-muted-foreground">On our GPUs, no setup. Not available yet.</p>
          <Button variant="outline" onClick={() => void run(() => calls.renderPack(c.id, "cloud"), "")}><Cloud /> Render in the cloud</Button>
        </div>
        <div className="grid content-start gap-2 rounded-lg border border-border p-4">
          <b className="text-sm font-medium">Import a pack</b>
          <p className="text-xs text-muted-foreground">A folder on this machine with a manifest.json, stills/ and clips/ (what the avatar creator writes).</p>
          <Input aria-label="Pack folder" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="C:\\packs\\rosa" />
          <Button variant="outline" disabled={!dir.trim()} onClick={() => void run(() => calls.importPack(c.id, dir.trim()), "Imported.")}><FolderInput /> Import</Button>
        </div>
      </div>
      {msg?.text ? <p className={cn("text-sm", msg.err ? "text-danger" : "text-ok")} role={msg.err ? "alert" : undefined}>{msg.text}</p> : null}
    </section>
  );
}
