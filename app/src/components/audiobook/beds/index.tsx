/**
 * Beds for one chapter: music, ambience and SFX under the narration.
 *
 * Each bed is clips on its own story track, so it also shows in the chapter's
 * timeline. This panel adds one from a prompt or the library, and sets gain,
 * where it plays, fades and ducking. Preview plays a window of the chapter
 * with the bed ducked under the narration.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLinesIcon,
  ChevronDownIcon,
  Loader2Icon,
  MusicIcon,
  PlayIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WavesIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { useBook, useParagraphs } from "@/lib/audiobook-queries";
import { formatDuration } from "@/lib/format";
import { qk, useSounds } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { bedKeys, bedsApi } from "./api";
import { BedPreview } from "./preview";
import { SoundscapeSuggestions } from "./suggestions";
import type { Bed, BedInput, BedKind, BedMode, BedPatch } from "./types";

const KIND_LABEL: Record<BedKind, string> = { music: "Music", ambience: "Ambience", sfx: "SFX" };
const KIND_ICON: Record<BedKind, typeof MusicIcon> = { music: MusicIcon, ambience: WavesIcon, sfx: AudioLinesIcon };
const MODE_LABEL: Record<BedMode, string> = {
  full: "Whole chapter",
  intro: "Intro only",
  outro: "Outro only",
  intro_outro: "Intro and outro",
  scene: "One scene",
};
const PREVIEW_S = 30;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      {children}
    </div>
  );
}

/** A number input that commits on blur or Enter, and resets when the bed changes. */
function NumberField({
  label,
  value,
  min,
  max,
  step = 0.5,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onCommit: (v: number) => void;
}) {
  // A draft only while typing; otherwise the bed's own value shows.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);
  const commit = () => {
    setDraft(null);
    const v = Number(text);
    if (draft === null || !Number.isFinite(v)) return;
    const clamped = Math.min(max, Math.max(min, v));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <Field label={`${label} (${suffix})`}>
      <Input
        type="number"
        inputMode="decimal"
        className="h-8"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    </Field>
  );
}

/** A dB slider that commits on release. Keyed by its value so a refetch resets it. */
function DbSlider({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  const [live, setLive] = useState(value);
  return (
    <Field label={`${label}: ${live} dB`}>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[live]}
        onValueChange={([v]) => setLive(v)}
        onValueCommit={([v]) => v !== value && onCommit(v)}
        aria-label={label}
      />
    </Field>
  );
}

function useStorySegments(storyId: string | null) {
  return useQuery({
    queryKey: qk.segments(storyId ?? ""),
    queryFn: () => api.listSegments(storyId!),
    enabled: !!storyId,
  });
}

function useBedMutations(bookId: string, chapterId: string, storyId: string | null) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: bedKeys.all(bookId) });
    if (storyId) {
      void qc.invalidateQueries({ queryKey: qk.story(storyId) });
      void qc.invalidateQueries({ queryKey: qk.segments(storyId) });
    }
  };
  const fail = (what: string) => (err: unknown) => toast.error(what, { description: errorMessage(err) });
  return {
    create: useMutation({
      mutationKey: ["audiobook", bookId, "beds", "create"],
      mutationFn: (input: BedInput) => bedsApi.create(bookId, chapterId, input),
      onSuccess: refresh,
      onError: fail("Could not add the bed"),
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: BedPatch }) => bedsApi.update(bookId, id, patch),
      onSuccess: refresh,
      onError: fail("Could not update the bed"),
    }),
    remove: useMutation({
      mutationFn: (id: string) => bedsApi.remove(bookId, id),
      onSuccess: refresh,
      onError: fail("Could not remove the bed"),
    }),
    fit: useMutation({
      mutationFn: () => bedsApi.layoutChapter(bookId, chapterId),
      onSuccess: refresh,
      onError: fail("Could not fit the beds"),
    }),
  };
}

export function BedsPanel({ bookId, chapterId }: { bookId: string; chapterId: string }) {
  const book = useBook(bookId);
  const chapter = book.data?.chapters.find((c) => c.id === chapterId) ?? null;
  const storyId = chapter?.story_id ?? null;
  const beds = useQuery({
    queryKey: bedKeys.list(bookId, chapterId),
    queryFn: () => bedsApi.list(bookId, chapterId),
    // A generating bed lands on its own; poll until it does.
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === "generating") ? 1500 : false),
  });
  const segments = useStorySegments(storyId);
  const m = useBedMutations(bookId, chapterId, storyId);
  const qc = useQueryClient();

  // When a generating bed turns ready its clips appear; refresh the timeline.
  const generating = beds.data?.filter((b) => b.status === "generating").length ?? 0;
  const prevGenerating = useRef(generating);
  useEffect(() => {
    if (generating < prevGenerating.current && storyId) {
      void qc.invalidateQueries({ queryKey: qk.segments(storyId) });
      void qc.invalidateQueries({ queryKey: qk.story(storyId) });
    }
    prevGenerating.current = generating;
  }, [generating, storyId, qc]);

  const preview = useRef<BedPreview | null>(null);
  // Keyed by chapter, so switching chapters never shows a stale "playing".
  const [playingIn, setPlayingIn] = useState<{ chapterId: string; bedId: string } | null>(null);
  const playing = playingIn?.chapterId === chapterId ? playingIn.bedId : null;
  const setPlaying = (bedId: string | null) => setPlayingIn(bedId ? { chapterId, bedId } : null);
  useEffect(() => () => preview.current?.stop(), [chapterId]);

  const togglePreview = async (bed: Bed) => {
    preview.current ??= new BedPreview();
    if (playing === bed.id) {
      preview.current.stop();
      setPlaying(null);
      return;
    }
    const segs = segments.data ?? (storyId ? await api.listSegments(storyId) : []);
    const mine = segs.filter((s) => bed.segment_ids.includes(s.id));
    let from = mine.length ? Math.min(...mine.map((s) => s.start_s)) : 0;
    // An outro is heard at its end; start the window so it finishes there.
    if (bed.mode === "outro" && mine.length) {
      from = Math.max(0, Math.max(...mine.map((s) => s.start_s + (s.duration_s ?? 0))) - PREVIEW_S);
    }
    if (bed.kind === "sfx") from = Math.max(0, from - 3);
    setPlaying(bed.id);
    try {
      await preview.current.play({ bed, segments: segs, from, length: PREVIEW_S, onEnd: () => setPlaying(null) });
    } catch (err) {
      setPlaying(null);
      toast.error("Could not play the preview", { description: errorMessage(err) });
    }
  };

  const stale = beds.data?.some((b) => b.stale) ?? false;
  const paragraphs = useParagraphs(bookId, chapterId);
  const position = useMemo(() => {
    const map = new Map<string, number>();
    (paragraphs.data ?? []).filter((p) => p.track_index === 0).forEach((p, i) => map.set(p.id, i + 1));
    return map;
  }, [paragraphs.data]);
  const rangeOf = (bed: Bed): string | null => {
    if (bed.kind === "sfx") return bed.anchor_segment_id ? `At paragraph ${position.get(bed.anchor_segment_id) ?? "?"}` : null;
    if (bed.mode !== "scene") return null;
    const a = bed.anchor_segment_id ? position.get(bed.anchor_segment_id) : 1;
    const b = bed.end_segment_id ? position.get(bed.end_segment_id) : position.size;
    return `Paragraphs ${a ?? "?"}–${b ?? "?"}`;
  };
  const isSample = chapter?.kind === "retail_sample";

  return (
    <section className="space-y-3" aria-label="Beds">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Beds</h4>
        {stale && (
          <Button size="sm" variant="outline" className="h-7" disabled={m.fit.isPending} onClick={() => m.fit.mutate()}>
            <RefreshCwIcon className={cn(m.fit.isPending && "animate-spin")} />
            Fit to chapter
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        Music, ambience and effects under the narration. Each bed is its own track in the chapter's timeline.
      </p>
      {isSample && (beds.data?.length ?? 0) > 0 && (
        <p className="text-destructive flex gap-1.5 text-xs" role="alert">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          ACX retail samples must not contain music. Leave beds out when you export this chapter.
        </p>
      )}

      {beds.isLoading ? (
        <p className="text-muted-foreground text-xs">Loading beds…</p>
      ) : (
        <ul className="space-y-2">
          {beds.data?.map((bed) => (
            <BedCard
              key={bed.id}
              bed={bed}
              range={rangeOf(bed)}
              playing={playing === bed.id}
              onPreview={() => void togglePreview(bed)}
              onPatch={(patch) => m.update.mutate({ id: bed.id, patch })}
              onRemove={() => {
                if (playing === bed.id) preview.current?.stop();
                m.remove.mutate(bed.id);
              }}
            />
          ))}
        </ul>
      )}

      <SoundscapeSuggestions bookId={bookId} chapterId={chapterId} onAccept={(input) => m.create.mutateAsync(input)} />

      <AddBed bookId={bookId} chapterId={chapterId} pending={m.create.isPending} onAdd={(input) => m.create.mutate(input)} />
    </section>
  );
}

function BedCard({
  bed,
  range,
  playing,
  onPreview,
  onPatch,
  onRemove,
}: {
  bed: Bed;
  /** Where in the chapter it plays, for scene beds and effects. */
  range: string | null;
  playing: boolean;
  onPreview: () => void;
  onPatch: (patch: BedPatch) => void;
  onRemove: () => void;
}) {
  const Icon = KIND_ICON[bed.kind];
  const [open, setOpen] = useState(false);
  const duck = bed.duck;

  return (
    <li className="bg-muted/40 rounded-md border">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <CollapsibleTrigger asChild>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left text-sm">
              <span className="truncate">{bed.label}</span>
              <ChevronDownIcon className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
          {bed.status === "generating" && (
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <Loader2Icon className="size-3.5 animate-spin" />
              Generating
            </span>
          )}
          {bed.stale && <span className="text-muted-foreground text-xs">Stale</span>}
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={bed.status !== "ready"}
            aria-label={playing ? `Stop preview of ${bed.label}` : `Preview ${bed.label}`}
            onClick={onPreview}
          >
            {playing ? <SquareIcon /> : <PlayIcon />}
          </Button>
          <Button size="icon" variant="ghost" className="size-7" aria-label={`Remove ${bed.label}`} onClick={onRemove}>
            <Trash2Icon />
          </Button>
        </div>
        {range && <p className="text-muted-foreground -mt-1 px-2 pb-1.5 pl-7.5 text-xs">{range}</p>}
        {bed.status === "failed" && <p className="text-destructive px-2 pb-1.5 text-xs">{bed.error}</p>}
        <CollapsibleContent className="space-y-3 border-t px-2 py-2">
          <DbSlider
            key={`gain-${bed.gain_db}`}
            label="Gain"
            value={bed.gain_db}
            min={-40}
            max={0}
            onCommit={(v) => onPatch({ gain_db: v })}
          />

          {bed.kind === "sfx" ? (
            <NumberField label="Offset from paragraph" suffix="s" value={bed.offset_s} min={-600} max={600} onCommit={(v) => onPatch({ offset_s: v })} />
          ) : (
            <>
              <Field label="Plays">
                <Select value={bed.mode} onValueChange={(mode) => onPatch({ mode: mode as BedMode })}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(MODE_LABEL) as BedMode[])
                      // A scene needs its paragraphs; only a suggested bed has them.
                      .filter((k) => k !== "scene" || bed.mode === "scene")
                      .map((k) => (
                      <SelectItem key={k} value={k}>
                        {MODE_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {bed.mode !== "full" && (
                <NumberField
                  label="Intro/outro length"
                  suffix="s"
                  value={bed.intro_s ?? 20}
                  min={0.5}
                  max={600}
                  onCommit={(v) => onPatch({ intro_s: v })}
                />
              )}
              <label className="flex items-center justify-between gap-2 text-sm">
                Loop to fill
                <Switch checked={bed.loop} onCheckedChange={(loop) => onPatch({ loop })} />
              </label>
            </>
          )}

          <div className="grid grid-cols-2 items-end gap-2">
            <NumberField label="Fade in" suffix="s" value={bed.fade_in_s} min={0} max={60} onCommit={(v) => onPatch({ fade_in_s: v })} />
            <NumberField label="Fade out" suffix="s" value={bed.fade_out_s} min={0} max={60} onCommit={(v) => onPatch({ fade_out_s: v })} />
          </div>

          <label className="flex items-center justify-between gap-2 text-sm">
            Duck under narration
            <Switch checked={!!duck} onCheckedChange={(on) => onPatch({ duck: on ? {} : false })} />
          </label>
          {duck && (
            <div className="space-y-2">
              <DbSlider
                key={`depth-${duck.depth_db}`}
                label="Ducking depth"
                value={duck.depth_db}
                min={0}
                max={30}
                onCommit={(v) => onPatch({ duck: { depth_db: v } })}
              />
              <div className="grid grid-cols-3 items-end gap-2">
                <NumberField label="Attack" suffix="ms" step={10} value={duck.attack_ms} min={0} max={5000} onCommit={(v) => onPatch({ duck: { attack_ms: v } })} />
                <NumberField label="Release" suffix="ms" step={10} value={duck.release_ms} min={0} max={10000} onCommit={(v) => onPatch({ duck: { release_ms: v } })} />
                <NumberField label="Lookahead" suffix="ms" step={10} value={duck.lookahead_ms} min={0} max={5000} onCommit={(v) => onPatch({ duck: { lookahead_ms: v } })} />
              </div>
            </div>
          )}
          {bed.prompt && <p className="text-muted-foreground text-xs break-words">Prompt: {bed.prompt}</p>}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function AddBed({
  bookId,
  chapterId,
  pending,
  onAdd,
}: {
  bookId: string;
  chapterId: string;
  pending: boolean;
  onAdd: (input: BedInput) => void;
}) {
  const [kind, setKind] = useState<BedKind>("music");
  const [prompt, setPrompt] = useState("");
  const [q, setQ] = useState("");
  const [anchor, setAnchor] = useState<string>("start");
  const sounds = useSounds({ q: q.trim() || undefined, limit: 6 });
  const paragraphs = useParagraphs(bookId, kind === "sfx" ? chapterId : null);
  const lines = useMemo(
    () => (paragraphs.data ?? []).filter((p) => p.track_index === 0 && p.kind === "line" && p.text.trim()),
    [paragraphs.data],
  );
  const anchorInput = kind === "sfx" && anchor !== "start" ? { anchor_segment_id: anchor } : {};

  return (
    <div className="space-y-2 rounded-md border border-dashed p-2">
      <div className="flex items-center gap-2">
        <Label className="text-muted-foreground shrink-0 text-xs">Add</Label>
        <Select value={kind} onValueChange={(k) => setKind(k as BedKind)}>
          <SelectTrigger size="sm" className="flex-1" aria-label="Bed kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_LABEL) as BedKind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {kind === "sfx" && (
        <Field label="At paragraph">
          <Select value={anchor} onValueChange={setAnchor}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="start">Chapter start</SelectItem>
              {lines.map((p, i) => (
                <SelectItem key={p.id} value={p.id}>
                  {i + 1}. {p.text.slice(0, 40)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Tabs defaultValue="prompt">
        <TabsList className="w-full">
          <TabsTrigger value="prompt">Generate</TabsTrigger>
          <TabsTrigger value="library">Library</TabsTrigger>
        </TabsList>
        <TabsContent value="prompt" className="space-y-2">
          <Textarea
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              kind === "music"
                ? "Slow solo piano, warm and sparse"
                : kind === "ambience"
                  ? "Light rain on a window, distant thunder"
                  : "Heavy wooden door creaking shut"
            }
            aria-label="Bed prompt"
          />
          <Button
            size="sm"
            className="w-full"
            disabled={!prompt.trim() || pending}
            onClick={() => {
              onAdd({ kind, prompt: prompt.trim(), ...anchorInput });
              setPrompt("");
            }}
          >
            {pending && <Loader2Icon className="animate-spin" />}
            Generate {KIND_LABEL[kind].toLowerCase()}
          </Button>
        </TabsContent>
        <TabsContent value="library" className="space-y-2">
          <Input className="h-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sounds" aria-label="Search sounds" />
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {sounds.data?.items.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={pending}
                  className="hover:bg-muted flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm"
                  onClick={() => onAdd({ kind, sound_id: s.id, ...anchorInput })}
                >
                  <span className="truncate">{s.name}</span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{formatDuration(s.duration_s)}</span>
                </button>
              </li>
            ))}
            {sounds.data && sounds.data.items.length === 0 && (
              <li className="text-muted-foreground px-2 text-xs">No sounds match.</li>
            )}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  );
}
