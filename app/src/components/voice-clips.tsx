/**
 * A clone voice's clips, as a section of its docked panel.
 *
 * Clips: a voice can be made from up to five clips of the same speaker. The
 * server joins them into the one reference file the model reads, so adding a
 * clip improves a voice in place instead of making a new one — which matters,
 * because every script line cast to the old id would otherwise be orphaned.
 *
 * Each clip carries its transcript, edited where it's shown: Fish Audio
 * needs the exact words for every clip.
 *
 * The two summary helpers live beside the section because the card in
 * voice-shared.tsx and the panel say the same thing about a voice's clips;
 * a fourth module for two functions would split one idea in two.
 */

/* eslint-disable react-refresh/only-export-components */
/* oxlint-disable only-export-components */

import { useRef, useState } from "react";
import { MicIcon, SquareIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useRecorder } from "@/hooks/use-recorder";
import { AUDIO_ACCEPT, toWav } from "@/lib/audio-file";
import { formatDuration } from "@/lib/format";
import { useAddVoiceSample, useDeleteVoiceSample, useUpdateVoice } from "@/lib/queries";
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

/**
 * The clips list, each with its transcript, then adding one by file or by
 * recording. Several clips of the same speaker clone better than one; the
 * server joins them, level-matched, into the one reference the model reads.
 */
export function VoiceClipsSection({ voice }: { voice: Voice }) {
  const add = useAddVoiceSample();
  const remove = useDeleteVoiceSample();
  const update = useUpdateVoice();
  const recorder = useRecorder();
  const fileInput = useRef<HTMLInputElement>(null);
  const [tidy, setTidy] = useState(true);
  const [referenceText, setReferenceText] = useState("");
  const [preparing, setPreparing] = useState(false);

  const samples = voice.samples ?? [];
  const full = samples.length >= MAX_CLIPS;
  const busy = preparing || add.isPending;

  const addClip = async (clip: Blob, filename?: string) => {
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
    <div className="grid min-w-0 grid-cols-1 gap-3">
      <ol className="grid grid-cols-1 gap-2">
        {samples.map((sample, i) => (
          <li key={sample.id} className="border-border/70 grid grid-cols-1 gap-1.5 rounded-lg border px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground readout w-4 shrink-0">{i + 1}</span>
              <audio controls preload="none" src={sample.file} className="h-8 min-w-0 flex-1" />
              <span className="text-muted-foreground readout w-10 shrink-0 text-right">
                {sample.duration_s === null ? "" : formatDuration(sample.duration_s)}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove clip ${i + 1}`}
                // The last clip cannot go: with none it is not a voice. The
                // server refuses too; disabling says so before the click.
                disabled={samples.length <= 1 || remove.isPending}
                title={samples.length <= 1 ? "A voice needs at least one clip" : undefined}
                onClick={() => remove.mutate({ voiceId: voice.id, sampleId: sample.id })}
              >
                <Trash2Icon />
              </Button>
            </div>
            <InlineEdit
              as="div"
              multiline
              allowEmpty
              value={sample.reference_text ?? ""}
              label={`Transcript of clip ${i + 1}`}
              placeholder="Add the exact words spoken in this clip"
              onCommit={(text) =>
                update.mutateAsync({
                  id: voice.id,
                  patch: { samples: [{ id: sample.id, reference_text: text.trim() || null }] },
                })
              }
              className="text-muted-foreground pl-6 text-xs"
            />
          </li>
        ))}
      </ol>

      {samples.length > 1 && voice.reference_file && (
        <div className="grid gap-1">
          <p className="text-muted-foreground text-xs">What the model hears, joined:</p>
          <audio controls preload="none" src={voice.reference_file} className="h-8 w-full" />
        </div>
      )}

      {full ? (
        <p className="text-muted-foreground text-sm">
          That is {MAX_CLIPS} clips, the most a voice holds. Remove one to add another.
        </p>
      ) : (
        <div className="bg-muted/25 ring-border grid gap-3 rounded-lg p-3 ring-1 ring-inset">
          <p className="text-muted-foreground text-xs">
            Several clips of the same speaker clone better than one. Three to five short
            clips is plenty.
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor={`new-clip-transcript-${voice.id}`}>Transcript of the new clip</Label>
            <Textarea
              id={`new-clip-transcript-${voice.id}`}
              value={referenceText}
              maxLength={20000}
              onChange={(e) => setReferenceText(e.target.value)}
              placeholder="The exact words spoken in the clip you are adding"
              className="min-h-14 text-sm"
            />
            <p className="text-muted-foreground text-xs">Required for Fish Audio.</p>
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
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void recorder.start()}>
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
              <Button size="sm" disabled={busy} onClick={() => recorder.blob && void addClip(recorder.blob)}>
                Add this take
              </Button>
            </div>
          )}
          <TidySwitch id={`voice-clip-tidy-${voice.id}`} checked={tidy} onCheckedChange={setTidy} />
        </div>
      )}
    </div>
  );
}
