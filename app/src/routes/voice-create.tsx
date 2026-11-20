/**
 * Making a voice, as pages rather than a dialog.
 *
 * `/voice/new` is the hub: one card per way Mirli can really make a voice.
 * Each card carries a ring gauge for how much audio that way needs. The
 * figures come from the server's reference checks
 * (`server/src/audio/reference.ts`): a clip must be at least
 * `MIN_REFERENCE_S` (1s) and at most `MAX_REFERENCE_S` (60s), a voice holds
 * at most `MAX_SAMPLES` (5) clips and `MAX_COMBINED_S` (90s) in all. They are
 * mirrored below; there is no "best" length in the code, so none is claimed.
 *
 * `/voice/new/clone` is the clone flow: drop zone and recorder on the left,
 * the filling gauge and the clips gathered so far on the right. Clips stay in
 * the browser until Save, which creates the voice from the first and adds the
 * rest — the same two endpoints the old dialog and the clips dialog used.
 * `?from=<soundId>` puts a library sound in as the first clip.
 *
 * `/voice/new/builtin` saves a voice a model already ships.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  AudioLinesIcon,
  FileJsonIcon,
  LibraryIcon,
  Loader2Icon,
  MicIcon,
  SquareIcon,
  UploadIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TidySwitch } from "@/components/voice-clips";
import { formatClock, isReady } from "@/components/voice-shared";
import { useRecorder } from "@/hooks/use-recorder";
import { AUDIO_ACCEPT, stemOf, toWav } from "@/lib/audio-file";
import { ApiError, api } from "@/lib/api";
import type { Model } from "@/lib/api";
import {
  useAddVoiceSample,
  useCreateVoice,
  useImportVoice,
  useModels,
  useSound,
  useUploadVoice,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Mirrors of server/src/audio/reference.ts — limits, not advice. */
const MIN_CLIP_S = 1;
const MAX_CLIP_S = 60;
const MAX_TOTAL_S = 90;
const MAX_CLIPS = 5;

const SYSTEM_INPUT = "__system__";

function useTtsModels(): Model[] {
  const models = useModels();
  return useMemo(
    () => (models.data ?? []).filter((m) => m.task === "tts"),
    [models.data],
  );
}

/* ------------------------------------------------------------------ gauge */

/**
 * The ring: an ink track, an ink arc for what is there, and the one yellow
 * dot at its head. `value` and the marks are seconds against `max`.
 */
function RingGauge({
  value,
  max,
  min,
  size = 128,
  children,
}: {
  value: number;
  max: number;
  min?: number;
  size?: number;
  children?: ReactNode;
}) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, value / max));
  const angle = frac * 2 * Math.PI - Math.PI / 2;
  const minAngle = min ? (min / max) * 2 * Math.PI - Math.PI / 2 : null;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          className="stroke-border"
          strokeWidth="2"
        />
        {frac > 0 && (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            className="stroke-foreground transition-[stroke-dasharray] duration-300"
            strokeWidth="2"
            strokeDasharray={`${frac * c} ${c}`}
            transform="rotate(-90 50 50)"
          />
        )}
        {minAngle !== null && (
          <line
            x1={50 + (r - 4) * Math.cos(minAngle)}
            y1={50 + (r - 4) * Math.sin(minAngle)}
            x2={50 + (r + 4) * Math.cos(minAngle)}
            y2={50 + (r + 4) * Math.sin(minAngle)}
            className="stroke-muted-foreground"
            strokeWidth="1.5"
          />
        )}
        {frac > 0 && (
          <circle
            cx={50 + r * Math.cos(angle)}
            cy={50 + r * Math.sin(angle)}
            r="3.5"
            className="fill-signal"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- hub */

function MethodCard({
  title,
  description,
  gauge,
  marks,
  action,
}: {
  title: string;
  description: string;
  gauge: ReactNode;
  marks: string;
  action: ReactNode;
}) {
  return (
    <div className="bg-card border-border flex flex-col items-center gap-4 rounded-xl border p-5 text-center">
      {gauge}
      <p className="readout text-muted-foreground text-xs">{marks}</p>
      <div className="space-y-1">
        <h2 className="font-display text-xl font-extrabold uppercase tracking-wide">
          {title}
        </h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <div className="mt-auto">{action}</div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/voice/new"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeftIcon className="size-4" />
      Voice creation
    </Link>
  );
}

export function VoiceCreatePage() {
  const importer = useImportVoice();
  const importInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const iconCls = "text-foreground size-7";
  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/voice/lab"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-4" />
          Voice Lab
        </Link>
        <h1 className="font-heading mt-2 text-3xl">Voice creation</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Every voice here is made on your machine. Pick how this one starts.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MethodCard
          title="Clone"
          description="Copy a speaker from clips you upload or record — up to five of the same person."
          gauge={
            <RingGauge
              value={MAX_TOTAL_S * 0.35}
              max={MAX_TOTAL_S}
              min={MIN_CLIP_S}
            >
              <MicIcon className={iconCls} />
            </RingGauge>
          }
          marks={`Min ${MIN_CLIP_S} sec · Max ${MAX_TOTAL_S} sec`}
          action={
            <Button asChild>
              <Link to="/voice/new/clone">Create</Link>
            </Button>
          }
        />
        <MethodCard
          title="Built-in"
          description="Save a named voice a text-to-speech model already ships. Tied to that model."
          gauge={
            <RingGauge value={0} max={1}>
              <AudioLinesIcon className={iconCls} />
            </RingGauge>
          }
          marks="No audio needed"
          action={
            <Button asChild>
              <Link to="/voice/new/builtin">Create</Link>
            </Button>
          }
        />
        <MethodCard
          title="Import"
          description="Bring in a .soundbox-voice.json exported from Mirli on another machine, or a backup."
          gauge={
            <RingGauge value={0} max={1}>
              <FileJsonIcon className={iconCls} />
            </RingGauge>
          }
          marks="One voice file"
          action={
            <>
              <input
                ref={importInput}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  e.target.value = "";
                  if (picked)
                    importer.mutate(picked, {
                      onSuccess: () => navigate("/voice/lab"),
                    });
                }}
              />
              <Button
                disabled={importer.isPending}
                onClick={() => importInput.current?.click()}
              >
                {importer.isPending ? "Importing…" : "Choose file"}
              </Button>
            </>
          }
        />
      </div>

      <p className="text-muted-foreground text-sm">
        Have a sound in your Library already?{" "}
        <Link
          to="/library/speech"
          className="text-foreground underline underline-offset-4"
        >
          Open it
        </Link>{" "}
        and choose <em>Make a voice from this</em> — it lands in Clone as the
        first clip.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ clone */

interface Clip {
  key: string;
  name: string;
  seconds: number;
  transcript: string;
  /** A transcription request is in flight for this clip. */
  transcribing: boolean;
  /** Auto-transcribe has already had its one go at this clip, so clearing
   *  the field does not bring the words back. */
  autoTried: boolean;
  /** A WAV gathered here, or a library sound by id. */
  source: { wav: Blob; url: string } | { soundId: string; url: string };
}

/** Length of a PCM WAV from its header; null if it isn't one we can read. */
async function wavSeconds(wav: Blob): Promise<number | null> {
  const buf = new DataView(await wav.arrayBuffer());
  if (buf.byteLength < 44) return null;
  const tag = (o: number) =>
    String.fromCharCode(
      buf.getUint8(o),
      buf.getUint8(o + 1),
      buf.getUint8(o + 2),
      buf.getUint8(o + 3),
    );
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let byteRate = 0;
  for (let o = 12; o + 8 <= buf.byteLength;) {
    const id = tag(o);
    const size = buf.getUint32(o + 4, true);
    if (id === "fmt ") byteRate = buf.getUint32(o + 16, true);
    if (id === "data") return byteRate ? size / byteRate : null;
    o += 8 + size + (size % 2);
  }
  return null;
}

let clipSeq = 0;

export function VoiceCloneCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromId = searchParams.get("from");
  const fromSound = useSound(fromId);
  const ttsModels = useTtsModels();
  const allModels = useModels();
  const asrReady = (allModels.data ?? []).some(
    (m) => m.task === "asr" && isReady(m),
  );
  const cloneModels = ttsModels.filter(
    (m) => isReady(m) && m.supports.voice_reference,
  );

  const upload = useUploadVoice();
  const create = useCreateVoice();
  const addSample = useAddVoiceSample();
  const recorder = useRecorder();
  const fileInput = useRef<HTMLInputElement>(null);

  const [clips, setClips] = useState<Clip[]>([]);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [modelId, setModelId] = useState("");
  const [tidy, setTidy] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  // The library sound goes in first, once.
  const seeded = useRef(false);
  useEffect(() => {
    const s = fromSound.data;
    if (!s || seeded.current) return;
    seeded.current = true;
    setClips((c) => [
      {
        key: `c${++clipSeq}`,
        name: s.name,
        seconds: s.duration_s,
        transcript: "",
        transcribing: false,
        autoTried: false,
        source: { soundId: s.id, url: s.file },
      },
      ...c,
    ]);
    setName((n) => n || s.name);
  }, [fromSound.data]);

  // Object URLs go with the page.
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  useEffect(
    () => () => {
      for (const c of clipsRef.current)
        if ("wav" in c.source) URL.revokeObjectURL(c.source.url);
    },
    [],
  );

  const patchClip = (key: string, patch: Partial<Clip>) =>
    setClips((all) => all.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  /**
   * Fill a clip's transcript from the recogniser. Automatic runs never
   * overwrite words the user has typed meanwhile and stay quiet on failure;
   * the Transcribe button replaces the field and says what went wrong.
   */
  const transcribeClip = async (clip: Clip, auto: boolean) => {
    patchClip(clip.key, { transcribing: true, autoTried: true });
    try {
      const out = await api.transcribe(
        "wav" in clip.source
          ? { file: clip.source.wav }
          : { soundId: clip.source.soundId },
      );
      setClips((all) =>
        all.map((x) =>
          x.key !== clip.key
            ? x
            : {
                ...x,
                transcribing: false,
                transcript: auto && x.transcript.trim() ? x.transcript : out.text,
              },
        ),
      );
      if (!auto && !out.text.trim()) toast.message("No speech found in that clip.");
    } catch (exc) {
      patchClip(clip.key, { transcribing: false });
      if (!auto) {
        const msg = exc instanceof Error ? exc.message : "Transcription failed.";
        toast.error(
          exc instanceof ApiError && exc.status === 409
            ? "No transcription model is installed. Download Qwen3-ASR from the Models page."
            : msg,
        );
      }
    }
  };

  // Auto-transcribe each clip once, as it arrives, when a model is ready.
  useEffect(() => {
    if (!asrReady) return;
    for (const c of clips) {
      if (!c.autoTried && !c.transcribing && !c.transcript.trim()) {
        void transcribeClip(c, true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, asrReady]);

  const total = clips.reduce((t, c) => t + c.seconds, 0);
  const full = clips.length >= MAX_CLIPS;

  const addBlob = async (blob: Blob, label: string, filename?: string) => {
    if (clipsRef.current.length >= MAX_CLIPS) {
      toast.error(`A voice holds at most ${MAX_CLIPS} clips.`);
      return;
    }
    setAdding(true);
    try {
      const wav = await toWav(blob, filename);
      const seconds = (await wavSeconds(wav)) ?? 0;
      setClips((c) => [
        ...c,
        {
          key: `c${++clipSeq}`,
          name: label,
          seconds,
          transcript: "",
          transcribing: false,
          autoTried: false,
          source: { wav, url: URL.createObjectURL(wav) },
        },
      ]);
      setName((n) => n || label);
    } catch (exc) {
      toast.error(
        exc instanceof Error ? exc.message : "Could not read that audio.",
      );
    } finally {
      setAdding(false);
    }
  };

  const addFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) await addBlob(f, stemOf(f.name), f.name);
  };

  // A finished take joins the list straight away; the recorder resets for the next.
  useEffect(() => {
    if (recorder.state === "recorded" && recorder.blob) {
      const blob = recorder.blob;
      recorder.reset();
      void addBlob(blob, `Recording ${clipsRef.current.length + 1}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.state, recorder.blob]);

  const removeClip = (key: string) =>
    setClips((c) => {
      const gone = c.find((x) => x.key === key);
      if (gone && "wav" in gone.source) URL.revokeObjectURL(gone.source.url);
      return c.filter((x) => x.key !== key);
    });

  const problems: string[] = [];
  for (const [i, c] of clips.entries()) {
    if (c.seconds && c.seconds < MIN_CLIP_S)
      problems.push(`Clip ${i + 1} is under ${MIN_CLIP_S}s.`);
    if (c.seconds > MAX_CLIP_S)
      problems.push(`Clip ${i + 1} is over ${MAX_CLIP_S}s.`);
  }
  if (total > MAX_TOTAL_S)
    problems.push(`All clips together must stay under ${MAX_TOTAL_S}s.`);

  const canSave =
    clips.length > 0 &&
    name.trim() &&
    modelId &&
    problems.length === 0 &&
    !saving &&
    !adding &&
    !clips.some((c) => c.transcribing);

  const save = async () => {
    const [first, ...rest] = clips;
    if (!first) return;
    setSaving(true);
    let createdId: string | null = null;
    try {
      const text = (c: Clip) => c.transcript.trim() || null;
      const voice =
        "wav" in first.source
          ? await upload.mutateAsync({
              name: name.trim(),
              file: first.source.wav,
              notes: notes.trim() || null,
              modelId,
              referenceText: text(first),
              tidy,
            })
          : await create.mutateAsync({
              name: name.trim(),
              kind: "clone",
              model_id: modelId,
              notes: notes.trim() || null,
              source_sound_id: first.source.soundId,
              reference_text: text(first),
              tidy,
            });
      createdId = voice.id;
      for (const c of rest) {
        await addSample.mutateAsync({
          voiceId: voice.id,
          source:
            "wav" in c.source
              ? { file: c.source.wav }
              : { sourceSoundId: c.source.soundId },
          tidy,
          referenceText: text(c),
        });
      }
      navigate("/voice/lab");
    } catch {
      // Each mutation toasts its own failure. If the voice itself was made,
      // a clip that failed to join is added later from the Lab's Clips
      // dialog — saving again here would make a second voice.
      if (createdId) navigate("/voice/lab");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <BackLink />
        <h1 className="font-heading mt-2 text-3xl">Clone a voice</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Clean, single-speaker speech clones best. Music and room noise end up
          in the clone.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        {/* Left: where audio comes in. */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!full) void addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex min-h-72 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-6 text-center",
            dragging ? "border-foreground bg-muted" : "border-border",
          )}
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={AUDIO_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files) void addFiles(files);
              e.target.value = "";
            }}
          />
          {recorder.state === "recording" ? (
            <div className="w-full max-w-sm space-y-3">
              <p className="readout flex items-center justify-center gap-2 text-sm">
                <span aria-hidden className="bg-signal size-2 rounded-full" />
                {formatClock(recorder.seconds)}
              </p>
              <span
                className="bg-muted block h-0.5 w-full overflow-hidden"
                role="meter"
                aria-label="Input level"
              >
                <span
                  className="bg-signal block h-full transition-[width] duration-75"
                  style={{ width: `${Math.round(recorder.level * 100)}%` }}
                />
              </span>
              <Button variant="outline" onClick={recorder.stop}>
                <SquareIcon />
                Stop
              </Button>
            </div>
          ) : (
            <>
              <UploadIcon className="text-muted-foreground size-8" />
              <div>
                <p className="font-medium">
                  Upload audio files or record audio
                </p>
                <p className="label-caps text-muted-foreground mt-1">
                  {full
                    ? `${MAX_CLIPS} of ${MAX_CLIPS} clips — remove one to add another`
                    : `Each clip ${MIN_CLIP_S}–${MAX_CLIP_S} sec · up to ${MAX_CLIPS} clips`}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="outline"
                  disabled={full || adding}
                  onClick={() => fileInput.current?.click()}
                >
                  <UploadIcon />
                  Upload files
                </Button>
                <Button
                  variant="outline"
                  disabled={full || adding}
                  onClick={() => void recorder.start()}
                >
                  <MicIcon />
                  Record audio
                </Button>
              </div>
            </>
          )}
          {recorder.error && (
            <p className="text-destructive text-xs">{recorder.error}</p>
          )}
          {recorder.devices.length > 0 && (
            <div className="w-full max-w-xs space-y-1 text-left">
              <Label htmlFor="clone-device" className="label-caps">
                Input
              </Label>
              <Select
                value={recorder.deviceId ?? SYSTEM_INPUT}
                onValueChange={(v) =>
                  recorder.setDeviceId(v === SYSTEM_INPUT ? null : v)
                }
                disabled={recorder.state === "recording"}
              >
                <SelectTrigger id="clone-device" className="w-full">
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
        </div>

        {/* Right: what has been gathered. */}
        <div className="bg-card border-border space-y-4 rounded-xl border p-5">
          <div className="flex items-center gap-4">
            <RingGauge
              value={total}
              max={MAX_TOTAL_S}
              min={MIN_CLIP_S}
              size={112}
            >
              <span className="readout text-sm">
                {formatClock(Math.round(total))}
              </span>
            </RingGauge>
            <div className="space-y-1">
              <p className="readout text-muted-foreground text-xs">
                Min {MIN_CLIP_S} sec · Max {MAX_TOTAL_S} sec
              </p>
              <p className="text-muted-foreground text-sm">
                A few seconds of clear speech is enough to start. More clips of
                the same speaker give the model more to go on, up to{" "}
                {MAX_TOTAL_S} seconds in all.
              </p>
            </div>
          </div>

          {clips.length === 0 ? (
            <p className="text-muted-foreground border-border rounded-lg border border-dashed px-3 py-4 text-center text-sm">
              {fromId && fromSound.isLoading
                ? "Loading the library sound…"
                : "No clips yet."}
            </p>
          ) : (
            <ul className="space-y-3">
              {clips.map((c, i) => (
                <li
                  key={c.key}
                  className="border-border space-y-2 rounded-lg border p-3"
                >
                  <div className="flex items-center gap-2">
                    {"soundId" in c.source && (
                      <LibraryIcon className="text-muted-foreground size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {c.name}
                    </span>
                    <span className="readout text-muted-foreground text-xs">
                      {c.seconds ? `${c.seconds.toFixed(1)}s` : "—"}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      aria-label={`Transcribe clip ${i + 1}`}
                      disabled={c.transcribing}
                      onClick={() => void transcribeClip(c, false)}
                    >
                      {c.transcribing ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : (
                        <WandSparklesIcon className="size-3.5" />
                      )}
                      Transcribe
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Remove clip ${i + 1}`}
                      onClick={() => removeClip(c.key)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                  <audio
                    src={c.source.url}
                    controls
                    preload="metadata"
                    className="h-8 w-full"
                  />
                  <Textarea
                    value={c.transcript}
                    maxLength={20000}
                    rows={2}
                    aria-label={`Transcript for clip ${i + 1}`}
                    aria-busy={c.transcribing}
                    disabled={c.transcribing}
                    placeholder={
                      c.transcribing
                        ? "Transcribing…"
                        : "Transcript — the exact words spoken (optional; Fish Audio needs it)"
                    }
                    onChange={(e) =>
                      setClips((all) =>
                        all.map((x) =>
                          x.key === c.key
                            ? { ...x, transcript: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          {problems.map((p) => (
            <p key={p} className="text-destructive text-xs">
              {p}
            </p>
          ))}
        </div>
      </div>

      <div className="bg-card border-border grid gap-4 rounded-xl border p-5 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="clone-name">Name</Label>
          <Input
            id="clone-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Narrator"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clone-model">Model</Label>
          {cloneModels.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              None of your installed text-to-speech models can read from a
              reference clip.{" "}
              <Link
                to="/models"
                className="text-foreground underline underline-offset-4"
              >
                Browse models
              </Link>
              .
            </p>
          ) : (
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger id="clone-model" className="w-full">
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
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="clone-notes">Notes</Label>
          <Input
            id="clone-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="optional — accent, tone, where it came from"
          />
        </div>
        <div className="md:col-span-2">
          <TidySwitch
            id="clone-tidy"
            checked={tidy}
            onCheckedChange={setTidy}
          />
        </div>
        <p className="text-muted-foreground text-xs md:col-span-2">
          Clone your own voice, or someone who has said yes. Most of these
          models&apos; licences do not ask for consent, so getting it is on you.
        </p>
        <div className="flex justify-end gap-2 md:col-span-2">
          <Button variant="ghost" asChild>
            <Link to="/voice/lab">Cancel</Link>
          </Button>
          <Button disabled={!canSave} onClick={() => void save()}>
            {saving ? "Saving…" : adding ? "Converting…" : "Save voice"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- builtin */

export function VoiceBuiltinCreatePage() {
  const navigate = useNavigate();
  const ttsModels = useTtsModels();
  const create = useCreateVoice();
  const builtins = ttsModels.flatMap((m) =>
    m.voice_ids.map((voiceId) => ({
      key: `${m.id}::${voiceId}`,
      voiceId,
      model: m,
    })),
  );
  const [key, setKey] = useState("");
  const chosen = builtins.find((b) => b.key === key);

  return (
    <div className="space-y-5">
      <div>
        <BackLink />
        <h1 className="font-heading mt-2 text-3xl">Save a built-in voice</h1>
      </div>
      <div className="bg-card border-border max-w-xl space-y-4 rounded-xl border p-5">
        {builtins.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            None of your installed text-to-speech models ship named voices.{" "}
            <Link
              to="/models"
              className="text-foreground underline underline-offset-4"
            >
              Browse models
            </Link>
            , or{" "}
            <Link
              to="/voice/new/clone"
              className="text-foreground underline underline-offset-4"
            >
              clone one
            </Link>{" "}
            instead.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="builtin-voice">Voice</Label>
              <Select value={key} onValueChange={setKey}>
                <SelectTrigger id="builtin-voice" className="w-full">
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
              {chosen
                ? `Saved built-ins stay tied to ${chosen.model.name} and can't be used with another model, or as a conversion target.`
                : "Built-ins stay tied to the model that ships them, and can't be used with another one, or as a conversion target."}
            </p>
            <div className="flex justify-end">
              <Button
                disabled={!chosen || create.isPending}
                onClick={() =>
                  chosen &&
                  create.mutate(
                    {
                      name: chosen.voiceId,
                      kind: "builtin",
                      voice_id: chosen.voiceId,
                      model_id: chosen.model.id,
                      notes: null,
                    },
                    { onSuccess: () => navigate("/voice/lab") },
                  )
                }
              >
                {create.isPending ? "Saving…" : "Save voice"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
