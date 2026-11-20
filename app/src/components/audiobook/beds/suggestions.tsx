/**
 * "Suggest soundscape": the chapter's text read for places, moods and sounds,
 * shown as a list to review. Nothing is added until a suggestion is accepted;
 * accepting generates the sound from its (editable) prompt and places it over
 * its scene, or at its paragraph for an effect. Suggestions start subtle: low
 * gain, ducked under the narration.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AudioLinesIcon,
  CheckIcon,
  Loader2Icon,
  MusicIcon,
  PencilIcon,
  SparklesIcon,
  WavesIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";

import { bedsApi } from "./api";
import type { BedInput, BedKind, SoundscapeResult, SoundscapeSuggestion } from "./types";

const KIND_ICON: Record<BedKind, typeof MusicIcon> = { music: MusicIcon, ambience: WavesIcon, sfx: AudioLinesIcon };
const KIND_LABEL: Record<BedKind, string> = { music: "Music", ambience: "Ambience", sfx: "SFX" };

/** The bed a suggestion becomes when it is accepted. */
function suggestionToBed(s: SoundscapeSuggestion, prompt: string): BedInput {
  const common = {
    kind: s.kind,
    label: `${KIND_LABEL[s.kind]}: ${s.label}`.slice(0, 80),
    prompt,
    duration_s: s.duration_s,
    gain_db: s.gain_db,
    duck: s.duck_db > 0 ? { depth_db: s.duck_db } : (false as const),
  };
  if (s.kind === "sfx") return { ...common, anchor_segment_id: s.start_paragraph_id };
  return {
    ...common,
    mode: "scene",
    anchor_segment_id: s.start_paragraph_id,
    end_segment_id: s.end_paragraph_id,
  };
}

export function SoundscapeSuggestions({
  bookId,
  chapterId,
  onAccept,
}: {
  bookId: string;
  chapterId: string;
  /** Creates the bed; resolves once it is added (generation carries on). */
  onAccept: (input: BedInput) => Promise<unknown>;
}) {
  // Keyed by chapter, so another chapter never shows this one's list.
  const [state, setState] = useState<{ chapterId: string; result: SoundscapeResult } | null>(null);
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const result = state?.chapterId === chapterId ? state.result : null;

  const suggest = useMutation({
    mutationFn: () => bedsApi.suggest(bookId, chapterId),
    onSuccess: (r) => {
      setState({ chapterId, result: r });
      setPrompts({});
      setEditing(null);
      if (!r.suggestions.length) toast.info("Nothing to suggest", { description: r.note ?? undefined });
    },
    onError: (err) => toast.error("Could not suggest a soundscape", { description: errorMessage(err) }),
  });

  const drop = (id: string) =>
    setState((cur) =>
      cur && cur.chapterId === chapterId
        ? { ...cur, result: { ...cur.result, suggestions: cur.result.suggestions.filter((s) => s.id !== id) } }
        : cur,
    );

  const accept = async (s: SoundscapeSuggestion) => {
    const prompt = (prompts[s.id] ?? s.prompt).trim();
    if (!prompt) return;
    setBusy((b) => new Set(b).add(s.id));
    try {
      await onAccept(suggestionToBed(s, prompt));
      drop(s.id);
    } catch {
      // The caller's mutation already said why.
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(s.id);
        return next;
      });
    }
  };

  const list = result?.suggestions ?? [];

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled={suggest.isPending}
        onClick={() => suggest.mutate()}
      >
        {suggest.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
        {result ? "Suggest again" : "Suggest soundscape"}
      </Button>

      {result && (
        <div className="space-y-2" aria-label="Soundscape suggestions">
          {result.note && <p className="text-muted-foreground text-xs">{result.note}</p>}
          {list.length > 1 && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 flex-1"
                disabled={busy.size > 0}
                onClick={() => {
                  for (const s of list) void accept(s);
                }}
              >
                Accept all ({list.length})
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setState(null)}>
                Dismiss
              </Button>
            </div>
          )}
          <ul className="space-y-1.5">
            {list.map((s) => {
              const Icon = KIND_ICON[s.kind];
              const prompt = prompts[s.id] ?? s.prompt;
              const working = busy.has(s.id);
              return (
                <li key={s.id} className="rounded-md border border-dashed p-2">
                  <div className="flex items-start gap-1.5">
                    <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className="text-muted-foreground">{KIND_LABEL[s.kind]}:</span> {s.label}
                      </p>
                      <p className="text-muted-foreground text-xs break-words">{s.reason}</p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Edit the prompt for ${s.label}`}
                      onClick={() => setEditing(editing === s.id ? null : s.id)}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      disabled={working || !prompt.trim()}
                      aria-label={`Accept ${s.label}`}
                      onClick={() => void accept(s)}
                    >
                      {working ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      disabled={working}
                      aria-label={`Reject ${s.label}`}
                      onClick={() => drop(s.id)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                  {editing === s.id ? (
                    <Textarea
                      rows={2}
                      className="mt-1.5 text-xs"
                      value={prompt}
                      onChange={(e) => setPrompts((p) => ({ ...p, [s.id]: e.target.value }))}
                      aria-label={`Prompt for ${s.label}`}
                    />
                  ) : (
                    <p className="text-muted-foreground mt-1 text-xs break-words italic">{prompt}</p>
                  )}
                  <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                    {s.gain_db} dB{s.duck_db > 0 ? `, ducked ${s.duck_db} dB` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
