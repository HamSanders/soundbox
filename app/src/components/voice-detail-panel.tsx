/**
 * A voice's details as a docked artifact panel, the voice twin of
 * `SoundDetailPanel`: a third panel of the shell, in the same row as the
 * sidebar and the page, so the page narrows to make room and the voice list
 * stays live beside it. On a narrow window it covers the page instead.
 *
 * It holds who the voice is, its reference clip, a test read and what it has
 * said lately. Edit, Clips and the ··· menu open the Voice Lab's own dialogs,
 * through the actions the Lab registers in `voice-detail-store`.
 *
 * Closes on ×, on Escape, and when the route changes.
 */

import { usePanelWidth } from "@/hooks/use-panel-width";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { AudioLinesIcon, MicIcon, PencilIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { JobResult, isReady } from "@/components/voice-shared";
import { VoiceAvatar } from "@/components/voice-avatar";
import { clipsSummary } from "@/components/voice-clips";
import { WaveformPlayer } from "@/components/waveform-player";
import { useJobStream } from "@/hooks/use-job-stream";
import { useModels, useSounds, useSpeak, useVoices, qk } from "@/lib/queries";
import { useDetailStore } from "@/lib/detail-store";
import { useVoiceDetailStore } from "@/lib/voice-detail-store";
import { useVoiceLabPrefs } from "@/lib/voice-lab-prefs";
import type { Model, Voice } from "@/lib/api";
import { voiceReferenceError } from "@/lib/voice-reference";

/** The history dialog keeps 50; the panel shows what was said lately. */
const RECENT_READS = 5;

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
  onClose?: () => void;
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
    <div className="bg-muted/25 ring-border space-y-2 rounded-lg p-2.5 ring-1 ring-inset">
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
            {onClose && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label="Close test read"
              >
                <XIcon />
              </Button>
            )}
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


/**
 * A voice's details in the right-hand panel: who it is, its reference clip,
 * a test read, and what it has said lately. Opened by clicking a row or a
 * shelf card, the way a track row opens `SoundDetailPanel`.
 */
function VoiceDetails({
  voice,
  modelName,
  models,
  line,
  onLineChange,
  menu,
  onEdit,
  onClips,
  onClose,
}: {
  voice: Voice;
  modelName: string | null;
  models: Model[];
  line: string;
  onLineChange: (v: string) => void;
  menu: ReactNode;
  onEdit?: () => void;
  onClips?: () => void;
  onClose: () => void;
}) {
  const reads = useSounds({ voice_id: voice.id, limit: RECENT_READS });
  const items = reads.data?.items ?? [];
  const total = reads.data?.total ?? 0;
  const clips = clipsSummary(voice);
  return (
    <>
      <div className="border-border flex items-center gap-3 border-b px-4 pt-4 pb-3">
        <VoiceAvatar voice={voice} className="ring-border size-14 rounded-md ring-1 ring-inset" />
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="font-display truncate text-2xl leading-none font-extrabold tracking-[0.01em] uppercase">
            {voice.name}
          </h2>
          <p className="readout text-muted-foreground truncate">
            {[
              voice.kind === "clone" ? "Clone" : `Built-in ${voice.voice_id ?? ""}`.trim(),
              modelName ?? voice.model_id ?? "any model",
              `${voice.read_count ?? 0} read${voice.read_count === 1 ? "" : "s"}`,
            ].join(" · ")}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" className="ml-auto self-start" aria-label="Close details" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {onEdit && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <PencilIcon />
              Edit
            </Button>
          )}
          {onClips && voice.kind === "clone" && (
            <Button variant="outline" size="sm" onClick={onClips}>
              <AudioLinesIcon />
              Clips
            </Button>
          )}
          <span className="ml-auto">{menu}</span>
        </div>

        {voice.notes && <p className="text-sm">{voice.notes}</p>}

        {voice.kind === "clone" && voice.reference_file && (
          <section className="grid gap-2">
            <h3 className="label-caps text-muted-foreground">Reference{clips ? ` · ${clips}` : ""}</h3>
            <audio controls preload="none" src={voice.reference_file} className="h-8 w-full" />
          </section>
        )}

        <section className="grid gap-2">
          <h3 className="label-caps text-muted-foreground">Try it</h3>
          <TryItPanel voice={voice} models={models} line={line} onLineChange={onLineChange} />
        </section>

        <section className="grid gap-2">
          <h3 className="label-caps text-muted-foreground">
            Recent reads{total > items.length ? ` · ${items.length} of ${total}` : ""}
          </h3>
          {reads.isLoading ? (
            <Skeleton className="h-12 w-full rounded-md" />
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing read in this voice yet.</p>
          ) : (
            items.map((sound) => (
              <div key={sound.id} className="border-border/60 grid gap-1 rounded-md border px-2.5 py-2">
                <p className="readout text-muted-foreground truncate">{sound.name}</p>
                <WaveformPlayer sound={sound} compact />
              </div>
            ))
          )}
        </section>
      </div>
    </>
  );
}


export function VoiceDetailPanel() {
  const panel = usePanelWidth({ id: "voice-detail", initial: 416, min: 320, max: 720, edge: "left" });
  const voiceId = useVoiceDetailStore((s) => s.voiceId);
  const actions = useVoiceDetailStore((s) => s.actions);
  const close = useVoiceDetailStore((s) => s.close);
  const voices = useVoices();
  const models = useModels();
  const line = useVoiceLabPrefs((s) => s.line);
  const setLine = useVoiceLabPrefs((s) => s.setLine);
  const voice = voiceId ? (voices.data?.find((v) => v.id === voiceId) ?? null) : null;

  // A deleted voice takes its panel with it.
  useEffect(() => {
    if (voiceId && voices.data && !voice) close();
  }, [voiceId, voices.data, voice, close]);

  // One docked panel at a time: a sound's details replace a voice's.
  const soundOpen = useDetailStore((s) => s.sound !== null);
  useEffect(() => {
    if (soundOpen) close();
  }, [soundOpen, close]);

  // The panel belongs to the page that opened it; query-string changes keep it.
  const { pathname } = useLocation();
  const openedOn = useRef(pathname);
  useEffect(() => {
    if (voiceId && pathname !== openedOn.current) close();
    openedOn.current = pathname;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a route change should close it
  }, [pathname]);

  useEffect(() => {
    if (!voiceId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog], [role=menu]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [voiceId, close]);

  if (!voice) return null;
  const readyTts = (models.data ?? []).filter((m) => m.task === "tts" && isReady(m));
  const modelName = voice.model_id
    ? ((models.data ?? []).find((m) => m.id === voice.model_id)?.name ?? null)
    : null;

  return (
    <aside
      aria-label={`Details for ${voice.name}`}
      className="bg-background ring-border animate-in fade-in-0 slide-in-from-right-8 fixed inset-x-0 top-(--top-h,0px) bottom-(--dock-h,0px) z-30 flex flex-col duration-(--duration-base) md:static md:z-auto md:my-2 md:mr-2 md:relative md:h-(--panel-h) md:w-(--panel-w) md:shrink-0 md:rounded-xl md:ring-1"
      style={panel.style}
    >
      {panel.handle}
      <VoiceDetails
        key={voice.id}
        voice={voice}
        modelName={modelName}
        models={readyTts}
        line={line}
        onLineChange={setLine}
        menu={actions?.menu(voice) ?? null}
        onEdit={actions ? () => actions.edit(voice) : undefined}
        onClips={actions ? () => actions.clips(voice) : undefined}
        onClose={close}
      />
    </aside>
  );
}
