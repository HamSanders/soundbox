/**
 * Pieces shared by the two voice surfaces — the Lab (`/voice/lab`, where a
 * voice is made and curated) and the Studio (`/voice`, where a script is read).
 *
 * The split exists because those are two different jobs with two different
 * rhythms: making a voice is a one-off act of curation you do rarely and want
 * room for, while writing a script is the thing you come back to every day.
 * What they genuinely share is small — the notion of what a voice *is*, the way
 * a job reports progress, and the one dialog that can create a voice — and it
 * lives here rather than being duplicated or imported page-to-page, so neither
 * page owns the other.
 *
 * The constants and helpers below sit in the same file as the components on
 * purpose — they are the *same* shared vocabulary, and splitting them into a
 * fourth module to satisfy the fast-refresh lint would scatter one idea across
 * two files for a dev-only convenience neither page relies on.
 */

/* eslint-disable react-refresh/only-export-components */
/* oxlint-disable only-export-components */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  MicIcon,
  RotateCcwIcon,
  SquareIcon,
  UploadIcon,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { FailureCard } from "@/components/failure-card";
import { LoadingVerb } from "@/components/loading-verb";
import { TidySwitch, clipsSummary } from "@/components/voice-clips";
import { SoundCard } from "@/components/sound-card";
// Re-exported: the avatar moved to its own leaf module so the composer and
// the script can import it without this file's dialog/recorder chain, and
// `VoiceCard` below is still one of its callers.
import { VoiceAvatar } from "@/components/voice-avatar";
import { useRecorder } from "@/hooks/use-recorder";
import { AUDIO_ACCEPT, stemOf, toWav } from "@/lib/audio-file";
import { isBusyPhase } from "@/lib/loading-verbs";
import { cn } from "@/lib/utils";
import { useCreateVoice, useSound, useUploadVoice } from "@/lib/queries";
import type { Job, Model, Sound, Voice } from "@/lib/api";

export { VoiceAvatar };

/** Same trick for "whatever the OS picked" in the recording input picker. */
const SYSTEM_INPUT = "__system__";

export const PHASE_LABEL: Record<string, string> = {
  queued: "Queued",
  loading: "Loading model",
  generating: "Generating",
  encoding: "Encoding",
  done: "Done",
};

/** A model can only be driven from here once its weights are on disk. */
export function isReady(model: Model): boolean {
  return model.status === "installed" || model.status === "loaded";
}

export function ErrorPanel({ title, error }: { title: string; error: unknown }) {
  return (
    <EmptyState tone="error" title={title}>
      {error instanceof Error ? error.message : "Unknown error"}
    </EmptyState>
  );
}

/** Progress + result for a job started from either voice page. */
export function JobResult({ job }: { job: Job | null }) {
  const soundId = job?.status === "done" ? (job.result?.sounds?.[0] ?? null) : null;
  const sound = useSound(soundId);

  if (!job) return null;

  if (job.status === "error") {
    return <FailureCard compact failure={job.failure} error={job.error ?? "The job failed."} />;
  }
  if (job.status === "cancelled") {
    return <p className="text-muted-foreground text-sm">Cancelled.</p>;
  }
  if (job.status !== "done") {
    const phase = PHASE_LABEL[job.phase] ?? job.phase;
    return (
      <div className="border-border/60 space-y-2.5 rounded-xl border px-3 py-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 font-medium">
            {isBusyPhase(job.phase) ? <LoadingVerb /> : phase}
            {job.message ? (
              <span className="text-muted-foreground font-normal"> · {job.message}</span>
            ) : null}
          </span>
          <span className="text-muted-foreground readout shrink-0">
            {Math.round(job.progress * 100)}%
          </span>
        </div>
        <Progress value={job.progress * 100} className="transition-[width]" />
      </div>
    );
  }

  if (sound.isLoading) return <Skeleton className="h-28 w-full rounded-xl" />;
  if (!sound.data) return null;
  return <SoundCard sound={sound.data} />;
}

/**
 * One saved voice, presentationally.
 *
 * The kind distinction on a Voice is load-bearing rather than cosmetic: a
 * "builtin" is a name out of one model family's own list and means nothing to
 * another family, so the card states which model it belongs to instead of
 * letting that surface later as a 400 from a job that already looked like it
 * started.
 *
 * Actions are slots rather than props-per-button because the two surfaces want
 * opposite things from the same card: the Lab manages voices (rename, notes,
 * delete, test read) and the Studio only needs to show which ones exist.
 */
export function VoiceCard({
  voice,
  actions,
  footer,
  className,
}: {
  voice: Voice;
  /** Row of controls under the card body. Omitted entirely when absent, so a
   *  read-only card has no empty action strip taking up space. */
  actions?: ReactNode;
  /** Anything that needs to render *below* the actions — the Lab's inline
   *  test-read panel, for instance. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("bg-card border-border flex flex-col gap-2 rounded-xl border p-3", className)}
    >
      <div className="flex items-start justify-between gap-2">
        <VoiceAvatar voice={voice} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{voice.name}</p>
          {voice.notes && (
            <p className="text-muted-foreground mt-0.5 text-xs">{voice.notes}</p>
          )}
        </div>
        <Badge variant={voice.kind === "clone" ? "secondary" : "outline"}>
          {voice.kind === "clone" ? "Clone" : "Built-in"}
        </Badge>
      </div>

      {voice.kind === "builtin" && voice.model_id && (
        <p className="text-muted-foreground text-xs">
          {voice.voice_id} · only with {voice.model_id}
        </p>
      )}

      {/* With several clips the player below is the joined reference, so the
          card says it is more than one recording. */}
      {clipsSummary(voice) && (
        <p className="text-muted-foreground text-xs">{clipsSummary(voice)}</p>
      )}

      {/* A plain <audio> rather than WaveformPlayer: the player takes a
          Sound (peaks, duration, id) and a reference clip is just a
          file on disk, not a library entry. */}
      {voice.kind === "clone" && voice.reference_file && (
        <audio
          controls
          preload="none"
          src={voice.reference_file}
          className="h-8 w-full"
        />
      )}

      {actions && <div className="mt-auto flex flex-wrap gap-1 pt-1">{actions}</div>}
      {footer}
    </div>
  );
}

/** m:ss for a running recording timer. Not `formatDuration`, which switches
 *  units as it climbs ("3.0s" -> "12s" -> "1:05") — fine for a stored clip's
 *  length, twitchy for a clock the user is watching tick. */
export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Add a voice — three genuinely different things behind one affordance.
 *
 * Uploading a clip, recording one, and picking a name out of a model's list
 * share nothing but the word "voice", so they're tabs inside the dialog rather
 * than a single form that changes shape. Upload and record do converge at the
 * end — both produce a clip to clone — so they share the name/notes fields and
 * one save path.
 *
 * Whatever the clip arrives as (m4a from a phone, mp3, the webm the recorder
 * emits) it is decoded to WAV in the browser before upload; see
 * lib/audio-file.ts for why that can't happen on the server.
 */
export function AddVoiceDialog({
  open,
  onOpenChange,
  ttsModels,
  sourceSound = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ttsModels: Model[];
  /** A library sound to clone from, in place of a clip to upload or record:
   *  "Make a voice from this" on a sound's menu lands here. */
  sourceSound?: Sound | null;
}) {
  const upload = useUploadVoice();
  const create = useCreateVoice();

  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [notes, setNotes] = useState("");
  const [referenceText, setReferenceText] = useState("");
  /** The model a cloned voice is tied to. Chosen here, once, because that is
   *  what lets every surface that speaks offer a voice picker and nothing
   *  else: the model is not a second decision made at read time, it is part
   *  of what the voice *is*. Only families that can read from a reference
   *  clip are offered — the rest have nothing to do with one. */
  const cloneModels = ttsModels.filter(
    (m) => isReady(m) && m.supports.voice_reference,
  );
  const [cloneModelId, setCloneModelId] = useState("");
  /** On by default in the app, off by default in the API: someone clicking
   *  through a dialog wants the phone memo's two seconds of fumbling cut, and
   *  a script posting bytes wants them kept. */
  const [tidy, setTidy] = useState(true);
  const cloneModel = cloneModels.find((m) => m.id === cloneModelId) ?? null;

  // A sound arriving from the library names the voice after itself until
  // something better is typed.
  useEffect(() => {
    if (open && sourceSound) setUploadName((n) => n || sourceSound.name);
  }, [open, sourceSound]);

  /** Every built-in across every installed TTS model, as one flat list.
   *
   *  A voice belongs to exactly one model, so making the user pick the model
   *  first was asking them to answer a question they already had the answer
   *  to — the model falls out of the voice, not the other way round. The
   *  model name rides along as a subtitle because two families can ship the
   *  same first name, and because which model a voice is tied to still
   *  matters later (a built-in only works with its own). */
  const builtins = ttsModels.flatMap((m) =>
    m.voice_ids.map((voiceId) => ({
      /** Model id and voice name together: voice names are only unique within
       *  a family, and Radix needs one unambiguous value per item. */
      key: `${m.id}::${voiceId}`,
      voiceId,
      model: m,
    })),
  );
  const [builtinKey, setBuiltinKey] = useState("");
  const chosenBuiltin = builtins.find((b) => b.key === builtinKey);

  const recorder = useRecorder();
  /** Decoding is separate from `upload.isPending`: on a long clip it is the
   *  part the user waits on, and a button that still says "Save voice" for
   *  two seconds reads as a dead click. */
  const [preparing, setPreparing] = useState(false);

  const close = () => {
    setFile(null);
    setUploadName("");
    setNotes("");
    setReferenceText("");
    setCloneModelId("");
    setTidy(true);
    setBuiltinKey("");
    recorder.reset();
    onOpenChange(false);
  };

  /** Both clip tabs end here: decode to WAV, then upload. */
  const saveClip = async (clip: Blob, filename?: string) => {
    setPreparing(true);
    try {
      const wav = await toWav(clip, filename);
      upload.mutate(
        {
          name: uploadName.trim(),
          file: wav,
          notes: notes.trim() || null,
          modelId: cloneModelId || null,
          referenceText: referenceText.trim() || null,
          tidy,
        },
        { onSuccess: close },
      );
    } catch (exc) {
      toast.error(exc instanceof Error ? exc.message : "Could not read that audio.");
    } finally {
      setPreparing(false);
    }
  };

  const busy = preparing || upload.isPending;
  const saveLabel = preparing ? "Converting…" : upload.isPending ? "Uploading…" : "Save voice";

  /** Name, model and notes, shared by the upload and record tabs. */
  const clipFields = (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="voice-upload-name">Name</Label>
        <Input
          id="voice-upload-name"
          value={uploadName}
          onChange={(e) => setUploadName(e.target.value)}
          placeholder="Narrator"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="voice-clone-model">Model</Label>
        {cloneModels.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            None of your installed text-to-speech models can read from a
            reference clip.{" "}
            <Link to="/models" className="text-foreground underline underline-offset-4">
              Browse models
            </Link>
            .
          </p>
        ) : (
          <Select value={cloneModelId} onValueChange={setCloneModelId}>
            <SelectTrigger id="voice-clone-model" className="w-full">
              <SelectValue placeholder="Pick a model" />
            </SelectTrigger>
            <SelectContent>
              {cloneModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-muted-foreground text-xs">
          The voice speaks through this model wherever it is used, so nothing
          else has to ask which one.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="voice-upload-notes">Notes</Label>
        <Input
          id="voice-upload-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="optional — accent, tone, where it came from"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="voice-reference-text">Reference Transcript</Label>
        <Textarea
          id="voice-reference-text"
          value={referenceText}
          maxLength={20000}
          onChange={(e) => setReferenceText(e.target.value)}
          placeholder="The exact words spoken in this reference clip"
        />
        <p className="text-muted-foreground text-xs">
          Required to generate with Fish Audio. Transcribe this audio exactly;
          this is separate from the new text you want the voice to say.
        </p>
      </div>
      <TidySwitch id="voice-upload-tidy" checked={tidy} onCheckedChange={setTidy} />
      <p className="text-muted-foreground text-xs">
        A few seconds of clean, single-speaker speech clones best. Music and
        room noise end up in the clone. You can add more clips of the same
        speaker once it is saved.
      </p>
      <p className="text-muted-foreground text-xs">
        Clone your own voice, or someone who has said yes. Most of these
        models&apos; licences do not ask for consent, so getting it is on you.
      </p>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{sourceSound ? "Make a voice from this sound" : "Add a voice"}</DialogTitle>
          <DialogDescription>
            {sourceSound
              ? `“${sourceSound.name}” becomes the reference clip. The sound itself is kept as it is.`
              : "Clone one from a clip you upload or record, or save a voice a model already ships."}
          </DialogDescription>
        </DialogHeader>

        {sourceSound ? (
          <div className="space-y-3">
            {clipFields}
            <DialogFooter>
              <Button
                disabled={!uploadName.trim() || !cloneModel || create.isPending}
                onClick={() =>
                  create.mutate(
                    {
                      name: uploadName.trim(),
                      kind: "clone",
                      model_id: cloneModelId,
                      notes: notes.trim() || null,
                      source_sound_id: sourceSound.id,
                      reference_text: referenceText.trim() || null,
                      tidy,
                    },
                    { onSuccess: close },
                  )
                }
              >
                {create.isPending ? "Saving…" : "Save voice"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
        <Tabs defaultValue="upload">
          <TabsList>
            <TabsTrigger value="upload">Upload clip</TabsTrigger>
            <TabsTrigger value="record">Record</TabsTrigger>
            <TabsTrigger value="builtin">Built-in</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-4 space-y-3">
            {/* Hidden input + Button so the trigger matches every other control
                on the page; a bare file input can't be styled to. */}
            <input
              ref={fileInput}
              type="file"
              accept={AUDIO_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null;
                setFile(picked);
                if (picked && !uploadName.trim()) setUploadName(stemOf(picked.name));
              }}
            />
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              <UploadIcon />
              {file ? "Choose a different file" : "Choose an audio file"}
            </Button>
            {file && (
              <p className="text-muted-foreground truncate text-xs">{file.name}</p>
            )}

            {clipFields}

            <DialogFooter>
              <Button
                disabled={!file || !uploadName.trim() || !cloneModel || busy}
                onClick={() => {
                  if (file) void saveClip(file, file.name);
                }}
              >
                {saveLabel}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="record" className="mt-4 space-y-3">
            {/* The take itself is the control: one button that starts, stops,
                and then gets out of the way in favour of a player. */}
            <div className="flex items-center gap-3">
              {recorder.state === "recording" ? (
                <Button variant="destructive" onClick={recorder.stop}>
                  <SquareIcon />
                  Stop
                </Button>
              ) : (
                <Button variant="outline" onClick={() => void recorder.start()}>
                  <MicIcon />
                  {recorder.state === "recorded" ? "Record again" : "Start recording"}
                </Button>
              )}
              {recorder.state === "recording" && (
                <span className="text-muted-foreground flex flex-1 items-center gap-2 text-sm">
                  <span
                    aria-hidden
                    className="bg-destructive size-2 animate-pulse rounded-full"
                  />
                  <span className="font-mono tabular-nums">
                    {formatClock(recorder.seconds)}
                  </span>
                  {/* A meter that never moves is the difference between "this
                      is recording nothing" and finding that out after the
                      take. */}
                  <span
                    className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full"
                    role="meter"
                    aria-label="Input level"
                  >
                    <span
                      className="bg-primary block h-full rounded-full transition-[width] duration-75"
                      style={{ width: `${Math.round(recorder.level * 100)}%` }}
                    />
                  </span>
                </span>
              )}
              {recorder.state === "recorded" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={recorder.reset}
                  aria-label="Discard this take"
                >
                  <RotateCcwIcon />
                  Discard
                </Button>
              )}
            </div>

            {recorder.error && (
              <p className="text-destructive text-xs">{recorder.error}</p>
            )}

            {/* Shown even with a single input: when a recording comes back
                silent, "which device is this using?" is the first question,
                and a picker that hides itself cannot answer it. Blank labels
                mean access has never been granted — the browser withholds
                device names until then, and recording once fills them in. */}
            {recorder.devices.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="voice-record-device">Input</Label>
                <Select
                  value={recorder.deviceId ?? SYSTEM_INPUT}
                  onValueChange={(v) =>
                    recorder.setDeviceId(v === SYSTEM_INPUT ? null : v)
                  }
                  disabled={recorder.state === "recording"}
                >
                  <SelectTrigger id="voice-record-device" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SYSTEM_INPUT}>System default</SelectItem>
                    {recorder.devices.map((d, i) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${i + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Listening back before saving is the whole point of keeping the
                take client-side instead of uploading the moment it stops. */}
            {recorder.url && (
              <audio src={recorder.url} controls className="w-full" />
            )}

            {clipFields}

            <DialogFooter>
              <Button
                disabled={!recorder.blob || !uploadName.trim() || !cloneModel || busy}
                onClick={() => {
                  if (recorder.blob) void saveClip(recorder.blob);
                }}
              >
                {saveLabel}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="builtin" className="mt-4 space-y-3">
            {builtins.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                None of your installed text-to-speech models ship named voices.{" "}
                <Link to="/models" className="text-foreground underline underline-offset-4">
                  Browse models
                </Link>
                , or upload a clip instead.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="voice-builtin-voice">Voice</Label>
                  <Select value={builtinKey} onValueChange={setBuiltinKey}>
                    <SelectTrigger id="voice-builtin-voice" className="w-full">
                      <SelectValue placeholder="Pick a voice" />
                    </SelectTrigger>
                    <SelectContent>
                      {builtins.map((b) => (
                        <SelectItem key={b.key} value={b.key}>
                          <span>{b.voiceId}</span>
                          <span className="text-muted-foreground ml-2 text-xs">
                            {b.model.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <p className="text-muted-foreground text-xs">
                  {chosenBuiltin
                    ? `Saved built-ins stay tied to ${chosenBuiltin.model.name} and can't be used with another model, or as a conversion target.`
                    : "Built-ins stay tied to the model that ships them, and can't be used with another one, or as a conversion target."}
                </p>

                <DialogFooter>
                  <Button
                    disabled={!chosenBuiltin || create.isPending}
                    onClick={() => {
                      if (!chosenBuiltin) return;
                      create.mutate(
                        {
                          name: chosenBuiltin.voiceId,
                          kind: "builtin",
                          voice_id: chosenBuiltin.voiceId,
                          model_id: chosenBuiltin.model.id,
                          notes: null,
                        },
                        { onSuccess: close },
                      );
                    }}
                  >
                    {create.isPending ? "Saving…" : "Save voice"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </TabsContent>
        </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
