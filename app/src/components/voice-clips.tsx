/**
 * A clone voice's clips, and what it has already said — the two Voice Lab
 * dialogs that look *into* one voice rather than across the cast.
 *
 * Clips: a voice can be made from up to five clips of the same speaker. The
 * server joins them into the one reference file the model reads, so adding a
 * clip improves a voice in place instead of making a new one — which matters,
 * because every script line cast to the old id would otherwise be orphaned.
 *
 * History: every single-voice read and conversion is stamped with the voice
 * that made it, so "what has Ada said" is a library query, not a search.
 *
 * The two summary helpers live beside the dialogs because the card in
 * voice-shared.tsx and the dialog here say the same thing about a voice's
 * clips; a fourth module for two functions would split one idea in two.
 */

/* eslint-disable react-refresh/only-export-components */
/* oxlint-disable only-export-components */

import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MicIcon, SquareIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { SoundCard } from "@/components/sound-card";
import { useRecorder } from "@/hooks/use-recorder";
import { AUDIO_ACCEPT, toWav } from "@/lib/audio-file";
import { formatDuration } from "@/lib/format";
import { useAddVoiceSample, useDeleteVoiceSample, useSounds } from "@/lib/queries";
import type { Voice } from "@/lib/api";
import { Textarea } from "@/components/ui/textarea";

/** Mirrors the server's MAX_SAMPLES (server/src/audio/reference.ts). Only
 *  used to stop offering "add" — the server is the one that refuses. */
const MAX_CLIPS = 5;

/** Total reference length across clips, or null when any clip predates
 *  lengths being recorded — a partial sum would understate it. */
export function clipsLength(voice: Voice): number | null {
  const samples = voice.samples ?? [];
  if (samples.length === 0 || samples.some((s) => s.duration_s === null)) return null;
  return samples.reduce((n, s) => n + (s.duration_s ?? 0), 0);
}

/** "1 clip", "3 clips · 24s" — the line a clone's card carries. */
export function clipsSummary(voice: Voice): string | null {
  const count = voice.samples?.length ?? 0;
  if (voice.kind !== "clone" || count === 0) return null;
  const total = clipsLength(voice);
  const label = count === 1 ? "1 clip" : `${count} clips`;
  return total === null ? label : `${label} · ${formatDuration(total)}`;
}

/** The tidy switch, shared with the add-voice dialog so both say the same
 *  thing about what it does and does not do. */
export function TidySwitch({
  id,
  checked,
  onCheckedChange,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5" />
      <div className="space-y-0.5">
        <Label htmlFor={id}>Tidy the clip</Label>
        <p className="text-muted-foreground text-xs">
          Cuts silence off both ends and pulls a clipping peak back. It never makes a clip
          louder or changes its tone — that is the voice.
        </p>
      </div>
    </div>
  );
}

export function VoiceClipsDialog({
  voice,
  onOpenChange,
}: {
  voice: Voice | null;
  onOpenChange: (open: boolean) => void;
}) {
  const add = useAddVoiceSample();
  const remove = useDeleteVoiceSample();
  const recorder = useRecorder();
  const fileInput = useRef<HTMLInputElement>(null);
  const [tidy, setTidy] = useState(true);
  const [referenceText, setReferenceText] = useState("");
  const [preparing, setPreparing] = useState(false);

  const samples = voice?.samples ?? [];
  const full = samples.length >= MAX_CLIPS;
  const busy = preparing || add.isPending;

  const close = () => {
    recorder.reset();
    setReferenceText("");
    onOpenChange(false);
  };

  const addClip = async (clip: Blob, filename?: string) => {
    if (!voice) return;
    setPreparing(true);
    try {
      const wav = await toWav(clip, filename);
      add.mutate(
        { voiceId: voice.id, source: { file: wav }, tidy,
          referenceText: referenceText.trim() || null },
        { onSuccess: () => { recorder.reset(); setReferenceText(""); } },
      );
    } catch (exc) {
      toast.error(exc instanceof Error ? exc.message : "Could not read that audio.");
    } finally {
      setPreparing(false);
    }
  };

  return (
    <Dialog open={voice !== null} onOpenChange={(open) => (open ? null : close())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Clips for “{voice?.name}”</DialogTitle>
          <DialogDescription>
            Several clips of the same speaker clone better than one — more of their
            sounds, more of their range. They are joined, level-matched, into the one
            reference the model reads. Three to five short clips is plenty.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-2">
          {samples.map((sample, i) => (
            <li
              key={sample.id}
              className="border-border/70 flex items-center gap-2 rounded-lg border px-2.5 py-2"
            >
              <span className="text-muted-foreground readout w-5 shrink-0">
                {i + 1}
              </span>
              <audio controls preload="none" src={sample.file} className="h-8 min-w-0 flex-1" />
              <span className="text-muted-foreground readout w-12 shrink-0 text-right">
                {sample.duration_s === null ? "" : formatDuration(sample.duration_s)}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove clip ${i + 1}`}
                // The last clip cannot go — with none it is not a voice. The
                // server refuses too; disabling says so before the click.
                disabled={samples.length <= 1 || remove.isPending}
                title={samples.length <= 1 ? "A voice needs at least one clip" : undefined}
                onClick={() =>
                  voice && remove.mutate({ voiceId: voice.id, sampleId: sample.id })
                }
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ol>

        {samples.length > 1 && voice?.reference_file && (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">What the model hears, joined:</p>
            <audio controls preload="none" src={voice.reference_file} className="h-8 w-full" />
          </div>
        )}

        {full ? (
          <p className="text-muted-foreground text-sm">
            That is {MAX_CLIPS} clips, the most a voice holds. Remove one to add another.
          </p>
        ) : (
          <div className="bg-muted/25 ring-border space-y-3 rounded-lg p-3 ring-1 ring-inset">
            <div className="space-y-1.5">
              <Label htmlFor="new-clip-transcript">Reference Transcript</Label>
              <Textarea
                id="new-clip-transcript"
                value={referenceText}
                maxLength={20000}
                onChange={(e) => setReferenceText(e.target.value)}
                placeholder="The exact words spoken in the clip you are adding"
              />
              <p className="text-muted-foreground text-xs">
                Required for Fish Audio. To change existing transcripts, use Edit voice.
              </p>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept={AUDIO_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                e.target.value = "";
                if (picked) void addClip(picked, picked.name);
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || recorder.state === "recording"}
                onClick={() => fileInput.current?.click()}
              >
                <UploadIcon />
                Add a file
              </Button>
              {recorder.state === "recording" ? (
                <Button variant="destructive" size="sm" onClick={recorder.stop}>
                  <SquareIcon />
                  Stop · {recorder.seconds}s
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void recorder.start()}
                >
                  <MicIcon />
                  {recorder.state === "recorded" ? "Record again" : "Record"}
                </Button>
              )}
              {busy && <span className="text-muted-foreground text-xs">Adding…</span>}
            </div>
            {recorder.error && <p className="text-destructive text-xs">{recorder.error}</p>}
            {recorder.url && recorder.blob && (
              <div className="flex items-center gap-2">
                <audio src={recorder.url} controls className="h-8 min-w-0 flex-1" />
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => recorder.blob && void addClip(recorder.blob)}
                >
                  Add this take
                </Button>
              </div>
            )}
            <TidySwitch id="voice-clip-tidy" checked={tidy} onCheckedChange={setTidy} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Everything read in one voice, newest first. A page of 50 rather than
 *  paging: this is "what has it said lately", and the Library has the rest. */
export function VoiceHistoryDialog({
  voice,
  onOpenChange,
}: {
  voice: Voice | null;
  onOpenChange: (open: boolean) => void;
}) {
  const sounds = useSounds({ voice_id: voice?.id, limit: 50 }, voice !== null);
  const items = sounds.data?.items ?? [];
  const total = sounds.data?.total ?? 0;

  return (
    <Dialog open={voice !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Read in “{voice?.name}”</DialogTitle>
          <DialogDescription>
            Single-voice reads and conversions. A dialogue with several speakers is not
            filed under any one of them — find it in the{" "}
            <Link to="/library" className="text-foreground underline underline-offset-4">
              Library
            </Link>
            .
          </DialogDescription>
        </DialogHeader>
        {sounds.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Nothing yet. Use “Try it” on the card, or cast the voice in a script.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((sound) => (
              <SoundCard key={sound.id} sound={sound} />
            ))}
            {total > items.length && (
              <p className="text-muted-foreground text-center text-xs">
                Showing the latest {items.length} of {total}.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
