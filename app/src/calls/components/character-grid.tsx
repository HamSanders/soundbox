import { Loader2, Plus } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { calls, fileToDataUrl, type Character } from "../live-client";
import { pad } from "../prefs";

/**
 * Portraits as cards, with an upload card at the end. Used on the picker
 * screen and inside a call (switching face mid-call).
 */
export function CharacterGrid({ characters, selected, busyId, onPick, onUploaded, compact = false }: {
  characters: Character[];
  selected?: string | null;
  busyId?: string | null;
  onPick: (c: Character) => void;
  onUploaded?: (id: string) => void;
  compact?: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    setErr(null);
    try {
      const name = f.name.replace(/\.[^.]+$/, "").replace(/[^\w ]/g, " ").trim().slice(0, 40) || "My character";
      const c = await calls.createCharacter({ name, image: await fileToDataUrl(f) });
      onUploaded?.(c.id);
    } catch (e) {
      setErr("Upload failed: " + (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div className={cn("grid gap-3", compact ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4")}>
        {characters.map((c, i) => (
          <button
            key={c.id}
            type="button"
            data-testid="character-card"
            aria-pressed={c.id === selected}
            onClick={() => onPick(c)}
            className={cn(
              "group overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-border-strong",
              "aria-pressed:border-foreground aria-pressed:ring-1 aria-pressed:ring-foreground",
            )}
          >
            <span className="relative block aspect-square overflow-hidden bg-muted">
              <img alt="" loading="lazy" src={calls.url(c.portrait_url)} className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
              {busyId === c.id ? (
                <span className="absolute inset-0 grid place-items-center bg-background/60"><Loader2 className="size-6 animate-spin" /></span>
              ) : null}
            </span>
            <span className="flex items-center gap-2 px-3 py-2 font-log text-xs text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", c.id === selected ? "bg-signal" : "bg-border-strong")} />
              No. {pad(i + 1)} · <b className="font-normal text-foreground">{c.name}</b>
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => file.current?.click()}
          disabled={uploading}
          className="grid aspect-square place-items-center rounded-lg border border-dashed border-border-strong/60 text-muted-foreground hover:border-foreground hover:text-foreground"
          title="Upload a photo"
        >
          <span className="grid justify-items-center gap-2 text-sm">
            {uploading ? <Loader2 className="size-6 animate-spin" /> : <Plus className="size-6" />}
            {uploading ? "Uploading…" : "Upload a photo"}
          </span>
        </button>
      </div>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      {err ? <p className="mt-2 text-sm text-danger">{err}</p> : null}
    </div>
  );
}
