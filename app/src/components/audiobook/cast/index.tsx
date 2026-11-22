/**
 * The cast: narrator and characters, each with a voice. Detect speakers,
 * suggest voices, preview a voice on a real line from the book, merge
 * characters, and replace a voice across the book. Mounted by core's
 * inspector as the Cast tab.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2Icon,
  MergeIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  ScanSearchIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CastDot } from "@/components/audiobook/editor/character-chip";
import { useTts, voiceModelName } from "@/components/audiobook/editor/use-tts";
import { VoiceLabel } from "@/components/audiobook/editor/voice-label";
import { useClipPlayer } from "@/components/audiobook/render/use-clip";
import { voiceApi } from "@/components/audiobook/render/voice-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/api";
import { abk, useBook, useUpdateBook } from "@/lib/audiobook-queries";
import type { Character } from "@/lib/audiobook-types";

const NONE = "__none__";

export function CastPanel({ bookId }: { bookId: string }) {
  const book = useBook(bookId);
  const qc = useQueryClient();
  const { voices, allVoices, allModels } = useTts();
  const player = useClipPlayer();
  const updateBook = useUpdateBook(bookId);
  const [split, setSplit] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [adding, setAdding] = useState("");
  const [replaceFrom, setReplaceFrom] = useState<string>(NONE);
  const [replaceTo, setReplaceTo] = useState<string>(NONE);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: abk.book(bookId) });
    void qc.invalidateQueries({ queryKey: abk.allParagraphs(bookId) });
  };
  const onError = (what: string) => (e: unknown) => toast.error(`${what}: ${errorMessage(e)}`);

  const detect = useMutation({
    mutationFn: () => voiceApi.detect(bookId, { split_dialogue: split }),
    onSuccess: (r) => {
      refresh();
      const parts = [
        `${r.characters.length} character${r.characters.length === 1 ? "" : "s"}`,
        `${r.cast} paragraph${r.cast === 1 ? "" : "s"} cast`,
        r.split ? `${r.split} split out` : null,
        r.voices_applied ? `${r.voices_applied} voice${r.voices_applied === 1 ? "" : "s"} suggested` : null,
      ].filter(Boolean);
      toast.success(`Found ${parts.join(", ")}.`, { description: r.notes.join(" ") || undefined });
    },
    onError: onError("Detection failed"),
  });
  const suggest = useMutation({
    mutationFn: () => voiceApi.suggestVoices(bookId, true),
    onSuccess: (r) => {
      refresh();
      toast.success(r.applied ? `Suggested voices for ${r.applied} character${r.applied === 1 ? "" : "s"}.` : "Every character already has a voice.");
    },
    onError: onError("Could not suggest voices"),
  });
  const update = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: Partial<Character> }) => voiceApi.updateCharacter(bookId, id, fields),
    onSuccess: refresh,
    onError: onError("Could not update the character"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => voiceApi.deleteCharacter(bookId, id),
    onSuccess: refresh,
    onError: onError("Could not delete the character"),
  });
  const create = useMutation({
    mutationFn: (name: string) => voiceApi.createCharacter(bookId, { name }),
    onSuccess: () => {
      setAdding("");
      refresh();
    },
    onError: onError("Could not add the character"),
  });
  const merge = useMutation({
    mutationFn: () => voiceApi.merge(bookId, picked[0]!, picked.slice(1)),
    onSuccess: (c) => {
      setPicked([]);
      refresh();
      toast.success(`Merged into ${c.name}.`);
    },
    onError: onError("Could not merge"),
  });
  const replace = useMutation({
    mutationFn: () => voiceApi.replaceVoice(bookId, replaceFrom, replaceTo),
    onSuccess: (r) => {
      refresh();
      setReplaceFrom(NONE);
      setReplaceTo(NONE);
      const n = r.characters + (r.narrator ? 1 : 0);
      toast.success(n ? `Replaced on ${n} part${n === 1 ? "" : "s"}. Voiced paragraphs are marked stale.` : "No part used that voice.");
    },
    onError: onError("Could not replace the voice"),
  });

  if (!book.data) return null;
  const data = book.data;
  const characters = data.characters;
  const voiceName = (id: string | null) => allVoices.find((v) => v.id === id)?.name ?? null;
  const usedVoices = [...new Set([data.settings.narrator_voice_id, ...characters.map((c) => c.voice_id)].filter((v): v is string => Boolean(v)))];

  const voicePicker = (value: string | null, onChange: (id: string | null) => void, label: string) => (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{label === "Narrator voice" ? "No voice" : "Narrator's voice"}</SelectItem>
        {value && !voices.some((v) => v.id === value) ? (
          <SelectItem value={value}>{voiceName(value) ?? "Voice not installed"}</SelectItem>
        ) : null}
        {voices.map((v) => (
          <SelectItem key={v.id} value={v.id} title={v.notes ?? undefined}>
            <VoiceLabel name={v.name} model={voiceModelName(v, allModels)} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const previewButton = (key: string, characterId: string | null, voiceId: string | null) => (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label="Preview on a line from the book"
      title="Preview on a line from the book"
      disabled={!voiceId && !data.settings.narrator_voice_id}
      onClick={() => player.playJob(key, voiceApi.preview(bookId, characterId, voiceId))}
    >
      {player.active === key ? player.loading ? <Loader2Icon className="animate-spin" /> : <PauseIcon /> : <PlayIcon />}
    </Button>
  );

  return (
    <div className="space-y-4 p-3">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Find speakers</h3>
          <Button size="xs" onClick={() => detect.mutate()} disabled={detect.isPending}>
            {detect.isPending ? <Loader2Icon className="animate-spin" /> : <ScanSearchIcon />}
            Detect
          </Button>
        </div>
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          <Switch size="sm" checked={split} onCheckedChange={setSplit} />
          Split dialogue into its own paragraphs
        </label>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Narrator</h3>
        <div className="flex items-center gap-2">
          <CastDot color={0} />
          {voicePicker(
            data.settings.narrator_voice_id,
            (id) => updateBook.mutate({ settings: { narrator_voice_id: id } }),
            "Narrator voice",
          )}
          {previewButton("narrator", null, data.settings.narrator_voice_id)}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Characters</h3>
          <div className="flex gap-1">
            {picked.length > 1 ? (
              <Button size="xs" variant="outline" onClick={() => merge.mutate()} disabled={merge.isPending} title="Merge the ticked characters into the first one ticked">
                <MergeIcon />
                Merge {picked.length}
              </Button>
            ) : null}
            <Button size="xs" variant="outline" onClick={() => suggest.mutate()} disabled={suggest.isPending || characters.length === 0}>
              {suggest.isPending ? <Loader2Icon className="animate-spin" /> : <WandSparklesIcon />}
              Suggest voices
            </Button>
          </div>
        </div>
        {characters.length === 0 ? (
          <p className="text-muted-foreground text-xs">No characters yet. Detect them from the text, or add one.</p>
        ) : (
          <ul className="space-y-2">
            {characters.map((c) => (
              <li key={c.id} className="border-border/70 space-y-1.5 rounded-lg border p-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-primary size-3.5"
                    aria-label={`Select ${c.name} to merge`}
                    checked={picked.includes(c.id)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                  />
                  <CastDot color={c.color} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" title={c.aliases.length ? `Also: ${c.aliases.join(", ")}` : undefined}>
                    {c.name}
                    {c.aliases.length ? <span className="text-muted-foreground ml-1 text-xs font-normal">({c.aliases.join(", ")})</span> : null}
                  </span>
                  <Button size="icon-xs" variant="ghost" aria-label={`Delete ${c.name}`} title="Delete (their paragraphs go back to the narrator)" onClick={() => remove.mutate(c.id)}>
                    <Trash2Icon />
                  </Button>
                </div>
                <Input
                  className="h-7 text-xs"
                  aria-label={`${c.name} description`}
                  placeholder="Age, gender, accent, temperament"
                  defaultValue={c.description ?? ""}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== c.description) update.mutate({ id: c.id, fields: { description: v } });
                  }}
                />
                <div className="flex items-center gap-2">
                  {voicePicker(c.voice_id, (id) => update.mutate({ id: c.id, fields: { voice_id: id } }), `${c.name} voice`)}
                  {previewButton(c.id, c.id, c.voice_id)}
                </div>
                {data.settings.cast_mode === "single" ? (
                  <p className="text-muted-foreground text-[11px]">Single cast: read in the narrator&apos;s voice.</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (adding.trim()) create.mutate(adding.trim());
          }}
        >
          <Input className="h-7 text-xs" placeholder="Character name" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="New character name" />
          <Button size="xs" variant="outline" type="submit" disabled={!adding.trim()}>
            <PlusIcon />
            Add
          </Button>
        </form>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Replace a voice</h3>
        <div className="grid grid-cols-[auto_1fr] items-center gap-2">
          <Label className="text-xs">From</Label>
          <Select value={replaceFrom} onValueChange={setReplaceFrom}>
            <SelectTrigger size="sm" aria-label="Voice to replace">
              <SelectValue placeholder="A voice in this book" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Choose…</SelectItem>
              {usedVoices.map((id) => (
                <SelectItem key={id} value={id}>{voiceName(id) ?? id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label className="text-xs">To</Label>
          <Select value={replaceTo} onValueChange={setReplaceTo}>
            <SelectTrigger size="sm" aria-label="Replacement voice">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Choose…</SelectItem>
              {voices.map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="xs"
          variant="outline"
          disabled={replaceFrom === NONE || replaceTo === NONE || replaceFrom === replaceTo || replace.isPending}
          onClick={() => replace.mutate()}
        >
          <RepeatIcon />
          Replace and mark audio stale
        </Button>
      </section>
    </div>
  );
}
