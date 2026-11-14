/**
 * Voice Lab — where a voice is made, named and kept.
 *
 * The Studio (`/voice`) is about a script; this page is about the cast. They
 * used to be one screen, with the library squeezed into a 20rem aside, which
 * made creating a voice feel like a side-effect of writing a line. Curating a
 * voice deserves the page: you are choosing what something sounds like, and
 * that decision is made by *listening*, not by reading a row in a list.
 *
 * So the two things this page adds over the old aside are room and ears. Room:
 * a responsive grid instead of a narrow column, with the reference clip and the
 * notes visible at a glance. Ears: a test read per voice, so a clone can be
 * judged before it is committed to a script — the whole reason someone opens
 * this page twice.
 *
 * Everything here writes through the same voice endpoints the Studio reads, so
 * a voice added mid-script and a voice added here are the same object; there is
 * no "lab copy" of anything.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  AudioLinesIcon,
  DownloadIcon,
  HistoryIcon,
  ImageIcon,
  Loader2Icon,
  MicIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SquareIcon,
  Trash2Icon,
  UploadIcon,
  UserRoundIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/search-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import {
  AddVoiceDialog,
  ErrorPanel,
  JobResult,
  VoiceCard,
  isReady,
} from "@/components/voice-shared";
import { VoiceAvatar } from "@/components/voice-avatar";
import { WaveformPlayer } from "@/components/waveform-player";
import { VoiceClipsDialog, VoiceHistoryDialog } from "@/components/voice-clips";
import { useJobStream, useJobStreams } from "@/hooks/use-job-stream";
import {
  useCancelJob,
  useConvertVoice,
  useDeleteVoice,
  useExportVoice,
  useImportVoice,
  useModels,
  useSound,
  useSounds,
  useSpeak,
  useUpdateVoice,
  useImageStatus,
  useVoiceArtwork,
  useVoices,
  qk,
} from "@/lib/queries";
import type { Job, Model, Voice } from "@/lib/api";
import { voiceReferenceError } from "@/lib/voice-reference";

/** Below this many voices the search box is pure chrome — you can see them all
 *  at once, so filtering costs a row of UI and saves nothing. */
const SEARCH_THRESHOLD = 6;

type KindFilter = "all" | "clone" | "builtin";

/** Case-insensitive match against the two fields a voice actually carries any
 *  memorable words in. */
function matchesQuery(voice: Voice, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return (
    voice.name.toLowerCase().includes(q) ||
    (voice.notes ?? "").toLowerCase().includes(q)
  );
}

/** Search box + kind tabs. Deliberately a local twin of models.tsx's
 *  `SearchFilterBar` rather than an import: that one is typed to a model's
 *  `category` and lives with the model list's column geometry. Copying the
 *  20 lines keeps the two pages looking identical without coupling them. */
function SearchFilterBar({
  query,
  onQueryChange,
  kind,
  onKindChange,
  showKinds,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  kind: KindFilter;
  onKindChange: (k: KindFilter) => void;
  showKinds: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 @sm:flex-row @sm:items-center">
      <SearchInput value={query} onChange={onQueryChange} placeholder="Search voices…" />
      {showKinds && (
        <Tabs value={kind} onValueChange={(v) => onKindChange(v as KindFilter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="clone">Cloned</TabsTrigger>
            <TabsTrigger value="builtin">Built-in</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
    </div>
  );
}

/**
 * The test read, inline under whichever card is being auditioned.
 *
 * One panel with a single open target rather than one panel per card: the model
 * choice and the test line are the same for every voice you try (that is the
 * point — you are comparing voices, not scripts), and N mounted job streams for
 * N cards would each hold their own socket. Keeping the state here and
 * rendering into the selected card's footer means the controls sit next to the
 * voice they belong to while only one read is ever in flight.
 */
function TryItPanel({
  voice,
  models,
  line,
  onLineChange,
  onClose,
}: {
  voice: Voice;
  models: Model[];
  line: string;
  onLineChange: (v: string) => void;
  onClose: () => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const speak = useSpeak();
  const { job } = useJobStream(jobId);
  const qc = useQueryClient();

  // A finished read is one more thing this voice has said: refresh the
  // card's History count and any open history list.
  useEffect(() => {
    if (job?.status !== "done") return;
    void qc.invalidateQueries({ queryKey: qk.voices });
    void qc.invalidateQueries({ queryKey: ["sounds"] });
  }, [job?.status, qc]);

  // No model picker: a voice names the model it speaks through, so the read
  // has nothing left to choose. The only voice that still falls back is a
  // clone saved before voices carried a model — its clip works anywhere, so
  // the first ready model reads it.
  const pinned = voice.model_id ?? null;
  const model = pinned ? models.find((m) => m.id === pinned) : models[0];
  const referenceError = voiceReferenceError(voice, model);

  const submit = () => {
    if (!model || !line.trim() || referenceError) return;
    speak.mutate(
      { model: model.id, lines: [{ text: line.trim(), voice_id: voice.id }] },
      { onSuccess: (ref) => setJobId(ref.job_id) },
    );
  };

  return (
    <div className="bg-muted/25 ring-border mt-2 space-y-2 rounded-lg p-2.5 ring-1 ring-inset">
      {!model ? (
        <p className="text-muted-foreground text-xs">
          {pinned
            ? `${pinned} isn't installed, so this voice can't be previewed.`
            : "No text-to-speech model is ready."}{" "}
          <Link to="/models" className="text-foreground underline underline-offset-4">
            Go to Models
          </Link>
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            {/* The model is stated, not offered — it came with the voice. */}
            <p className="text-muted-foreground flex-1 truncate text-xs">
              Reads through {model.name}
            </p>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close test read"
            >
              <XIcon />
            </Button>
          </div>

          <Textarea
            className="min-h-14 text-sm"
            value={line}
            placeholder="A short line to hear this voice say…"
            onChange={(e) => onLineChange(e.target.value)}
          />

          <Button
            size="sm"
            className="w-full"
            disabled={!line.trim() || speak.isPending || Boolean(referenceError)}
            onClick={submit}
          >
            <MicIcon />
            {speak.isPending ? "Starting…" : "Read it"}
          </Button>

          {referenceError && <p role="alert" className="text-destructive text-xs">{referenceError}</p>}
          <JobResult job={job} />
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- compare */

/** Two is the least a comparison can be; past four the columns get too narrow
 *  to hold a player each, and nobody keeps five takes in their head anyway. */
const COMPARE_MIN = 2;
const COMPARE_MAX = 4;
const TAKE_LABELS = ["A", "B", "C", "D"] as const;
const TERMINAL = new Set(["done", "error", "cancelled"]);

/** Static class strings per column count — Tailwind only ships classes it can
 *  see written out, so `@4xl:grid-cols-${n}` would never reach the page. */
const COMPARE_GRID: Record<number, string> = {
  2: "@xl:grid-cols-2",
  3: "@xl:grid-cols-2 @4xl:grid-cols-3",
  4: "@xl:grid-cols-2 @5xl:grid-cols-4",
};

/** One voice's turn in a comparison. `jobId` is null until its read has been
 *  started; `skipped` holds why it never will be. */
interface Take {
  voice: Voice;
  model: Model;
  jobId: string | null;
  skipped: string | null;
}

/** The model a voice reads through, or null when it isn't installed. Same rule
 *  as the test read: a pinned model or nothing, and only a clone saved before
 *  voices carried a model falls back to the first ready one. */
function modelFor(voice: Voice, models: Model[]): Model | null {
  if (voice.model_id) return models.find((m) => m.id === voice.model_id) ?? null;
  return models[0] ?? null;
}

/**
 * A finished take: its waveform and nothing else.
 *
 * Not `JobResult`'s `SoundCard`, which lays its row out on viewport breakpoints
 * and spills out of a column a quarter of the page wide. The card's rename,
 * project and stems actions are Library work anyway — here the only question
 * is how it sounds, and the take is in the Library to do the rest with.
 */
function CompareTake({ job }: { job: Job }) {
  const sound = useSound(job.result?.sounds?.[0] ?? null);
  if (sound.isLoading) return <Skeleton className="h-12 w-full rounded-xl" />;
  if (!sound.data) return null;
  return (
    <div className="border-border/60 rounded-xl border px-2.5 py-2">
      <WaveformPlayer sound={sound.data} compact />
    </div>
  );
}

/**
 * One line, read in two to four voices, laid out side by side.
 *
 * "Try it" answers "what does this voice sound like?"; this answers "which of
 * these is the one?" — a question you can only settle by hearing them back to
 * back on the same words. Each voice still reads through its own model, so a
 * comparison can span families: a Chatterbox clone against a PocketTTS built-in
 * is a fair fight, because that is the choice the script will actually make.
 *
 * The reads run one after another, not together. Each is its own audio.cpp
 * subprocess loading its own weights, and four of those started at once fight
 * over VRAM until one falls over — a queue that finishes beats a burst that
 * doesn't. The columns fill left to right as each take lands, so the first is
 * playable while the last is still loading.
 *
 * Every take shares one seed. It changes nothing across families, but two
 * voices on the same model then differ only in the voice, which is the thing
 * being compared.
 */
function ComparePanel({
  voices,
  models,
  line,
  onLineChange,
}: {
  voices: Voice[];
  models: Model[];
  line: string;
  onLineChange: (v: string) => void;
}) {
  /** Picked voice ids, in the order they were picked — that order is A, B, C. */
  const [picked, setPicked] = useState<string[]>([]);
  const [takes, setTakes] = useState<Take[]>([]);
  /** What this run says and with which seed, fixed when Read is pressed:
   *  editing the box mid-run must not change what the remaining voices say. */
  const [script, setScript] = useState<{ text: string; seed: number } | null>(null);
  const [stopped, setStopped] = useState(false);

  const speak = useSpeak();
  const cancel = useCancelJob();
  const qc = useQueryClient();

  const jobIds = useMemo(
    () => takes.flatMap((t) => (t.jobId ? [t.jobId] : [])),
    [takes],
  );
  const { jobs, errors } = useJobStreams(jobIds);

  /** Guards the gap between asking for a job and getting its id back, when no
   *  take shows as in flight yet and the effect would happily start the next.
   *  State, not a ref: its clearing has to wake the queue, or a run started
   *  inside that gap would sit waiting forever. */
  const [starting, setStarting] = useState(false);
  /** Bumped by every Read and every Stop. A request that comes back under an
   *  older number belongs to a run that has since been stopped or replaced, so
   *  its job is cancelled rather than shown. */
  const runId = useRef(0);

  const inFlight = takes.find(
    (t) => t.jobId && !errors[t.jobId] && !TERMINAL.has(jobs[t.jobId]?.status ?? ""),
  );
  const waiting = takes.some((t) => !t.jobId && !t.skipped);
  const running = Boolean(inFlight) || (waiting && !stopped);

  // The queue: whenever nothing is in flight, start the next take that hasn't
  // been. A take whose read fails to start is skipped rather than retried, so
  // one missing model doesn't hold up the voices behind it.
  useEffect(() => {
    if (stopped || starting || inFlight || !script) return;
    const next = takes.findIndex((t) => !t.jobId && !t.skipped);
    if (next < 0) return;
    const take = takes[next];
    const run = runId.current;
    setStarting(true);
    speak
      .mutateAsync({
        model: take.model.id,
        lines: [{ text: script.text, voice_id: take.voice.id }],
        seed: script.seed,
      })
      .then((ref) => {
        if (run !== runId.current) {
          cancel.mutate(ref.job_id);
          return;
        }
        setTakes((all) => all.map((t, i) => (i === next ? { ...t, jobId: ref.job_id } : t)));
      })
      .catch((err: unknown) => {
        if (run !== runId.current) return;
        setTakes((all) =>
          all.map((t, i) =>
            i === next
              ? { ...t, skipped: err instanceof Error ? err.message : "Could not start." }
              : t,
          ),
        );
      })
      .finally(() => setStarting(false));
    // `speak` and `cancel` are new objects every render; the queue only moves
    // on its own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takes, inFlight, stopped, script, starting]);

  // Each finished take is one more read in that voice's History.
  const doneCount = takes.filter((t) => t.jobId && jobs[t.jobId]?.status === "done").length;
  useEffect(() => {
    if (doneCount === 0) return;
    void qc.invalidateQueries({ queryKey: qk.voices });
    void qc.invalidateQueries({ queryKey: ["sounds"] });
  }, [doneCount, qc]);

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id)
        ? current.filter((v) => v !== id)
        : current.length < COMPARE_MAX
          ? [...current, id]
          : current,
    );

  // A voice deleted mid-session simply drops out of the selection.
  const chosen = picked.flatMap((id) => {
    const voice = voices.find((v) => v.id === id);
    return voice ? [voice] : [];
  });

  const start = () => {
    if (!line.trim() || chosen.length < COMPARE_MIN) return;
    runId.current += 1;
    setTakes(
      chosen.flatMap((voice) => {
        const model = modelFor(voice, models);
        return model ? [{ voice, model, jobId: null, skipped: voiceReferenceError(voice, model) }] : [];
      }),
    );
    setScript({ text: line.trim(), seed: Math.floor(Math.random() * 2 ** 31) });
    setStopped(false);
  };

  const stop = () => {
    runId.current += 1;
    setStopped(true);
    if (inFlight?.jobId) cancel.mutate(inFlight.jobId);
    setTakes((all) =>
      all.map((t) => (!t.jobId && !t.skipped ? { ...t, skipped: "Stopped before its turn." } : t)),
    );
  };

  return (
    <div className="border-border space-y-4 rounded-xl border p-4">
      <div>
        <h2 className="font-heading text-sm font-semibold tracking-tight">Compare voices</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Pick two to four voices and one line — each reads it through its own model, one
          after another, and the takes land side by side. Hearing them back to back on the
          same words is the quickest way to choose.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Voices to compare">
        {voices.map((voice) => {
          const at = picked.indexOf(voice.id);
          const model = modelFor(voice, models);
          const full = at < 0 && picked.length >= COMPARE_MAX;
          return (
            <Button
              key={voice.id}
              variant={at >= 0 ? "secondary" : "outline"}
              size="sm"
              aria-pressed={at >= 0}
              disabled={!model || full || running}
              title={
                !model
                  ? voice.model_id
                    ? `${voice.model_id} isn't installed`
                    : "No text-to-speech model is ready"
                  : full
                    ? `Four at most — drop one to add ${voice.name}`
                    : undefined
              }
              onClick={() => toggle(voice.id)}
            >
              {at >= 0 ? (
                <span className="bg-foreground text-background flex size-4 items-center justify-center rounded-full font-mono text-[10px] font-semibold">
                  {TAKE_LABELS[at]}
                </span>
              ) : (
                <VoiceAvatar voice={voice} className="size-4 rounded-full" />
              )}
              {voice.name}
            </Button>
          );
        })}
      </div>

      <Textarea
        className="min-h-14 text-sm"
        value={line}
        placeholder="One line for every voice to say…"
        onChange={(e) => onLineChange(e.target.value)}
      />

      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button variant="outline" onClick={stop}>
            <SquareIcon />
            Stop
          </Button>
        ) : (
          <Button disabled={!line.trim() || chosen.length < COMPARE_MIN} onClick={start}>
            <MicIcon />
            {chosen.length < COMPARE_MIN
              ? `Pick ${COMPARE_MIN - chosen.length} more`
              : `Read it in ${chosen.length} voices`}
          </Button>
        )}
        {picked.length > 0 && !running && (
          <Button variant="ghost" onClick={() => setPicked([])}>
            Clear
          </Button>
        )}
      </div>

      {takes.length > 0 && (
        <div className={`grid items-start gap-3 ${COMPARE_GRID[takes.length] ?? ""}`}>
          {takes.map((take, i) => {
            const job = take.jobId ? (jobs[take.jobId] ?? null) : null;
            const error = take.jobId ? errors[take.jobId] : undefined;
            return (
              <div key={take.voice.id} className="min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="bg-muted flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold">
                    {TAKE_LABELS[i]}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{take.voice.name}</p>
                    <p className="text-muted-foreground truncate text-xs">{take.model.name}</p>
                  </div>
                </div>
                {take.skipped ? (
                  <p className="text-muted-foreground bg-muted/25 ring-border rounded-xl px-3 py-2.5 text-sm ring-1 ring-inset">
                    {take.skipped}
                  </p>
                ) : error ? (
                  <p className="bg-danger/5 text-danger ring-danger/30 rounded-xl px-3 py-2.5 text-sm ring-1 ring-inset">
                    {error}
                  </p>
                ) : job?.status === "done" ? (
                  <CompareTake job={job} />
                ) : take.jobId ? (
                  <JobResult job={job} />
                ) : (
                  <p className="text-muted-foreground bg-muted/25 ring-border rounded-xl px-3 py-2.5 text-sm ring-1 ring-inset">
                    {i === 0 ? "Starting…" : `Queued — reads after ${TAKE_LABELS[i - 1]}.`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- convert */

/**
 * Re-voice an existing sound: keep the performance, change the speaker.
 *
 * Moved here from the old Voice Studio when that page became a script editor,
 * and left alone when that editor became the Script Builder.
 * It never really belonged beside a script — a conversion has no script, it
 * has a clip — and it depends on exactly what this page is for, which is
 * cloned voices with reference audio behind them.
 */
function VoiceConvertPanel({ models, voices }: { models: Model[]; voices: Voice[] }) {
  const ready = models.filter(isReady);
  const [modelId, setModelId] = useState<string>("");
  const [soundId, setSoundId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  const sounds = useSounds({ limit: 100, offset: 0 });
  const convert = useConvertVoice();
  const { job } = useJobStream(jobId);

  // No conversion model installed is not an error state worth a panel — the
  // section simply isn't applicable, so it stays out of the way.
  if (ready.length === 0) return null;

  const model = ready.find((m) => m.id === modelId) ?? ready[0];
  // Conversion works by matching reference audio, which a builtin doesn't
  // have — the backend rejects them outright, so they never reach the picker.
  const clones = voices.filter((v) => v.kind === "clone");
  const items = sounds.data?.items ?? [];

  const submit = () => {
    if (!soundId || !voiceId) return;
    convert.mutate(
      { model: model.id, source_sound_id: soundId, voice_id: voiceId },
      { onSuccess: (ref) => setJobId(ref.job_id) },
    );
  };

  return (
    <div className="border-border space-y-4 rounded-xl border p-4">
      <div>
        <h2 className="font-heading text-sm font-semibold tracking-tight">Convert a voice</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Keep the performance, change the speaker: a sound from your Library is re-sung in
          one of your cloned voices.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56 space-y-1.5">
          <Label htmlFor="voice-vc-model">Model</Label>
          <Select value={model.id} onValueChange={setModelId}>
            <SelectTrigger id="voice-vc-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ready.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="voice-vc-source">Source sound</Label>
          <Select value={soundId} onValueChange={setSoundId}>
            <SelectTrigger id="voice-vc-source" className="w-full">
              <SelectValue placeholder={sounds.isLoading ? "Loading…" : "Pick a sound"} />
            </SelectTrigger>
            <SelectContent>
              {items.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-48 space-y-1.5">
          <Label htmlFor="voice-vc-target">Target voice</Label>
          <Select value={voiceId} onValueChange={setVoiceId} disabled={!clones.length}>
            <SelectTrigger id="voice-vc-target" className="w-full">
              <SelectValue placeholder={clones.length ? "Pick a voice" : "No clones"} />
            </SelectTrigger>
            <SelectContent>
              {clones.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {/* Radix renders the chosen item's own children inside
                      `SelectValue`, so putting the avatar here puts it in the
                      closed trigger too — one change, both states. */}
                  <span className="flex items-center gap-2">
                    <VoiceAvatar voice={v} className="size-5 rounded-full" />
                    {v.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        Only cloned voices can be a conversion target — the model needs the reference clip to
        match against, which a built-in voice has no equivalent of.
      </p>

      <Button disabled={!soundId || !voiceId || convert.isPending} onClick={submit}>
        <UserRoundIcon />
        {convert.isPending ? "Starting…" : "Convert"}
      </Button>

      <JobResult job={job} />
    </div>
  );
}

export function VoiceLabPage() {
  const voices = useVoices();
  const models = useModels();

  const update = useUpdateVoice();
  const remove = useDeleteVoice();
  const drawing = useVoiceArtwork();
  // `ready` already folds in mode, engine and model — the card asks one
  // question rather than re-deriving the rule the server settled.
  const imageReady = useImageStatus().data?.ready ?? false;

  const [addOpen, setAddOpen] = useState(false);
  // "Make a voice from this" on a library sound arrives as ?from=<id>: the
  // add dialog opens on that sound and the parameter goes once it closes.
  const [searchParams, setSearchParams] = useSearchParams();
  const fromId = searchParams.get("from");
  const fromSound = useSound(fromId);
  useEffect(() => {
    if (fromId && fromSound.data) setAddOpen(true);
  }, [fromId, fromSound.data]);
  const [editing, setEditing] = useState<Voice | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [transcriptDrafts, setTranscriptDrafts] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<Voice | null>(null);
  /** By id rather than by object, so the dialog follows the voice as its
   *  clip list refetches after an add or remove. */
  const [clipsFor, setClipsFor] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<Voice | null>(null);

  const exporter = useExportVoice();
  const importer = useImportVoice();
  const importInput = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");

  /** Which card's test read is open, plus the line shared across every
   *  audition. No model here any more: it comes with the voice. */
  const [trying, setTrying] = useState<string | null>(null);
  const [tryLine, setTryLine] = useState("The quick brown fox jumps over the lazy dog.");

  const ttsModels = useMemo(
    () => (models.data ?? []).filter((m) => m.task === "tts"),
    [models.data],
  );
  const readyTts = useMemo(() => ttsModels.filter(isReady), [ttsModels]);
  const vcModels = useMemo(
    () => (models.data ?? []).filter((m) => m.task === "vc"),
    [models.data],
  );

  const all = voices.data ?? [];
  const filtered = all.filter(
    (v) => (kind === "all" || v.kind === kind) && matchesQuery(v, query),
  );
  const showFilters = all.length >= SEARCH_THRESHOLD;

  const openEdit = (voice: Voice) => {
    setNameDraft(voice.name);
    setNotesDraft(voice.notes ?? "");
    setTranscriptDrafts(Object.fromEntries(
      (voice.samples ?? []).map((s) => [s.id, s.reference_text ?? ""]),
    ));
    setEditing(voice);
  };

  return (
    <div className="@container space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Voice Lab</h1>
          <p className="text-muted-foreground text-sm">
            A voice is a speaker you can point a script at — either cloned from a
            clip of someone talking, or one of the named voices a model already
            ships. Make them here, hear them here, then use them in the{" "}
            <Link
              to="/studio?builder=script"
              className="text-foreground underline underline-offset-4"
            >
              Script Builder
            </Link>
            .
          </p>
        </div>
        <div className="flex gap-2">
          {/* A voice file from another machine, or a backup — see
              `voiceExportSchema` on the server for what one holds. */}
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = "";
              if (picked) importer.mutate(picked);
            }}
          />
          <Button
            variant="outline"
            disabled={importer.isPending}
            onClick={() => importInput.current?.click()}
          >
            <UploadIcon />
            {importer.isPending ? "Importing…" : "Import"}
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon />
            Add voice
          </Button>
        </div>
      </div>

      {models.isError && (
        <ErrorPanel title="Could not load the model catalog" error={models.error} />
      )}

      {/* Voices can still be created and curated with no TTS model on disk —
          only the test read needs one — so this is a note, not a blocking empty
          state like the Studio's. */}
      {!models.isLoading && !models.isError && readyTts.length === 0 && (
        <p className="bg-warn/5 ring-warn/30 text-muted-foreground rounded-xl px-4 py-3 text-sm ring-1 ring-inset">
          No text-to-speech model is installed, so voices can be saved but not
          previewed here.{" "}
          <Link to="/models" className="text-foreground underline underline-offset-4">
            Go to Models
          </Link>
          .
        </p>
      )}

      {showFilters && (
        <SearchFilterBar
          query={query}
          onQueryChange={setQuery}
          kind={kind}
          onKindChange={setKind}
          showKinds
        />
      )}

      {voices.isLoading ? (
        <div className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : voices.isError ? (
        <ErrorPanel title="Could not load voices" error={voices.error} />
      ) : all.length === 0 ? (
        <EmptyState
          icon={UsersRoundIcon}
          title="No voices yet"
          action={
            <Button onClick={() => setAddOpen(true)}>
              <PlusIcon />
              Add your first voice
            </Button>
          }
        >
          <p>
            There are three ways to get one: <strong>upload</strong> a few seconds
            of clean, single-speaker audio to clone; <strong>record</strong> a clip
            straight from your microphone; or save one of the{" "}
            <strong>built-in</strong> voices a text-to-speech model already ships.
          </p>
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>
          No voices match.{" "}
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setKind("all");
            }}
            className="text-foreground underline underline-offset-4"
          >
            Clear the filters
          </button>
          .
        </EmptyState>
      ) : (
        <div className="grid items-start gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
          {filtered.map((voice) => (
            <VoiceCard
              key={voice.id}
              voice={voice}
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={trying === voice.id}
                    onClick={() =>
                      setTrying((current) => (current === voice.id ? null : voice.id))
                    }
                  >
                    <MicIcon />
                    Try it
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(voice)}>
                    Edit
                  </Button>
                  {voice.kind === "clone" && (
                    <Button variant="ghost" size="sm" onClick={() => setClipsFor(voice.id)}>
                      <AudioLinesIcon />
                      Clips
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setHistoryFor(voice)}>
                    <HistoryIcon />
                    {/* The count is the reason to click — "History (0)" saves
                        a trip to an empty dialog. */}
                    History{voice.read_count ? ` (${voice.read_count})` : ""}
                  </Button>
                  {/* Only offered when artwork is actually configured — a
                      button that always fails is worse than no button. The
                      avatar is drawn from the voice's notes, which is also why
                      the empty-notes case falls back to the name. */}
                  {imageReady && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={drawing.isPending}
                      onClick={() => drawing.mutate(voice.id)}
                    >
                      {drawing.isPending && drawing.variables === voice.id ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <ImageIcon />
                      )}
                      {voice.artwork ? "Redraw" : "Avatar"}
                    </Button>
                  )}
                  {/* Export and delete are the rare, deliberate ones, so they
                      share a menu rather than a row the card has run out of. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto"
                        aria-label={`More for ${voice.name}`}
                      >
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => exporter.mutate(voice)}>
                        <DownloadIcon />
                        Export voice file
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDeleting(voice)}
                      >
                        <Trash2Icon />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              }
              footer={
                trying === voice.id ? (
                  <TryItPanel
                    voice={voice}
                    models={readyTts}
                    line={tryLine}
                    onLineChange={setTryLine}
                    onClose={() => setTrying(null)}
                  />
                ) : null
              }
            />
          ))}
        </div>
      )}

      {/* Conversion lives here rather than in the Studio because it is a
          voice operation, not a writing one: it takes a performance that
          already exists and puts a different speaker behind it, which is the
          same kind of work as cloning one — and it needs the clone voices this
          page is about. */}
      {/* Under the grid rather than above it: the cards are where a voice is
          met, and a comparison only makes sense once there are two to pick. */}
      {all.length >= COMPARE_MIN && (
        <ComparePanel
          voices={all}
          models={readyTts}
          line={tryLine}
          onLineChange={setTryLine}
        />
      )}

      <VoiceConvertPanel models={vcModels} voices={all} />

      <AddVoiceDialog
        open={addOpen}
        onOpenChange={(next) => {
          setAddOpen(next);
          if (!next && fromId) setSearchParams({}, { replace: true });
        }}
        ttsModels={ttsModels}
        sourceSound={fromId ? (fromSound.data ?? null) : null}
      />

      <VoiceClipsDialog
        voice={all.find((v) => v.id === clipsFor) ?? null}
        onOpenChange={(open) => !open && setClipsFor(null)}
      />
      <VoiceHistoryDialog
        voice={historyFor}
        onOpenChange={(open) => !open && setHistoryFor(null)}
      />

      {/* ------------------------------------------- voice details */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit voice</DialogTitle>
            <DialogDescription>
              The name is how this voice appears in the script editor. Notes are
              for you — accent, tone, where the clip came from.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="voice-lab-name">Name</Label>
              <Input
                id="voice-lab-name"
                value={nameDraft}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="voice-lab-notes">Notes</Label>
              <Input
                id="voice-lab-notes"
                value={notesDraft}
                placeholder="optional"
                onChange={(e) => setNotesDraft(e.target.value)}
              />
            </div>
            {editing?.kind === "clone" && (editing.samples ?? []).map((sample, i) => (
              <div key={sample.id} className="space-y-1.5">
                <Label htmlFor={`transcript-${sample.id}`}>
                  Reference Transcript{(editing.samples?.length ?? 0) > 1 ? ` — clip ${i + 1}` : ""}
                </Label>
                <audio controls preload="none" src={sample.file} className="h-8 w-full" />
                <Textarea
                  id={`transcript-${sample.id}`}
                  value={transcriptDrafts[sample.id] ?? ""}
                  maxLength={20000}
                  placeholder="The exact words spoken in this clip"
                  onChange={(e) => setTranscriptDrafts((drafts) => ({
                    ...drafts, [sample.id]: e.target.value,
                  }))}
                />
                <p className="text-muted-foreground text-xs">
                  Required for Fish Audio. Clips are read in the order shown here.
                </p>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={!nameDraft.trim() || update.isPending}
              onClick={() => {
                if (!editing) return;
                update.mutate(
                  {
                    id: editing.id,
                    patch: {
                      name: nameDraft.trim(),
                      notes: notesDraft.trim() || null,
                      samples: editing.kind === "clone" ? (editing.samples ?? []).map((s) => ({
                        id: s.id, reference_text: transcriptDrafts[s.id]?.trim() || null,
                      })) : undefined,
                    },
                  },
                  { onSuccess: () => setEditing(null) },
                );
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------------- delete */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              {deleting?.kind === "clone"
                ? "The reference clip is removed too. Sounds already read in this voice are unaffected."
                : "Removes the saved entry. The model keeps the built-in voice itself."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
              }}
            >
              <Trash2Icon />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
