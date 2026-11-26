/**
 * A voice's details in the docked panel (see detail-dock.tsx): who it is, a
 * test read, the model a clone reads on, its clips and their transcripts,
 * and what it has said.
 *
 * Everything that used to open a dialog on top of the panel (Edit, Clips,
 * History) is a section of it now: a modal over an inspector hides the
 * thing being edited. The name, notes and transcripts are edited where
 * they're shown; the model saves as soon as it's picked.
 *
 * A menu item that names a part ("Clips", "Rename") opens the panel there,
 * through the dock's intent.
 */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MicIcon, XIcon } from "lucide-react";

import { DockFrame } from "@/components/dock-frame";
import { Button } from "@/components/ui/button";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { JobResult, isReady } from "@/components/voice-shared";
import { VoiceAvatar } from "@/components/voice-avatar";
import { VoiceClipsSection, clipsSummary } from "@/components/voice-clips";
import { VoiceMenu } from "@/components/voice-menu";
import { WaveformPlayer } from "@/components/waveform-player";
import { useJobStream } from "@/hooks/use-job-stream";
import { useModels, useSounds, useSpeak, useUpdateVoice, useVoices, qk } from "@/lib/queries";
import { useDock } from "@/lib/dock";
import { useVoiceLabPrefs } from "@/lib/voice-lab-prefs";
import type { Model, Voice } from "@/lib/api";
import { voiceReferenceError } from "@/lib/voice-reference";

/** What the panel shows of a voice's reads, and what "Show all" raises it to.
 *  A page of 50 rather than paging: the Library has the rest. */
const RECENT_READS = 5;
const ALL_READS = 50;

/** The Select's value for a clone with no model pinned. */
const UNPINNED = "__unpinned__";

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


/** A titled part of the panel that a menu item can open at. */
function Part({
  title,
  sectionRef,
  children,
}: {
  title: string;
  sectionRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <section ref={sectionRef} tabIndex={sectionRef ? -1 : undefined} className="grid min-w-0 scroll-mt-4 grid-cols-1 gap-2 outline-none">
      <h3 className="label-caps text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** The model a clone reads on, everywhere. Saves when picked. */
function ModelPicker({ voice, models }: { voice: Voice; models: Model[] }) {
  const update = useUpdateVoice();
  // Only models that clone from a clip can read it.
  const cloning = models.filter((m) => m.supports.voice_reference);
  const pinned = voice.model_id ?? null;
  const id = `voice-model-${voice.id}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="sr-only">
        Reads on
      </Label>
      <Select
        value={pinned ?? UNPINNED}
        disabled={update.isPending}
        onValueChange={(v) => update.mutate({ id: voice.id, patch: { model_id: v === UNPINNED ? null : v } })}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNPINNED}>Not set: the first ready model</SelectItem>
          {pinned && !cloning.some((m) => m.id === pinned) && (
            <SelectItem value={pinned}>{pinned} (not installed)</SelectItem>
          )}
          {cloning.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">
        Reads this voice everywhere: scripts, stories and audiobooks. Only models that clone
        from a clip are listed.
      </p>
    </div>
  );
}

function VoiceDetails({
  voice,
  modelName,
  models,
  line,
  onLineChange,
}: {
  voice: Voice;
  modelName: string | null;
  models: Model[];
  line: string;
  onLineChange: (v: string) => void;
}) {
  const close = useDock((s) => s.close);
  const intent = useDock((s) => s.intent);
  const setIntent = useDock((s) => s.setIntent);
  const [showAll, setShowAll] = useState(false);
  const reads = useSounds({ voice_id: voice.id, limit: showAll ? ALL_READS : RECENT_READS });
  const items = reads.data?.items ?? [];
  const total = reads.data?.total ?? 0;
  const update = useUpdateVoice();
  const clone = voice.kind === "clone";

  const modelRef = useRef<HTMLElement>(null);
  const clipsRef = useRef<HTMLElement>(null);
  const historyRef = useRef<HTMLElement>(null);

  // Opened at a part ("Clips" in a menu): scroll to it and put focus there,
  // once. Rename is the name field's own business, below.
  useEffect(() => {
    if (!intent || intent === "rename") return;
    if (intent === "history") setShowAll(true);
    const el = { model: modelRef, clips: clipsRef, history: historyRef }[intent].current;
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    setIntent(null);
  }, [intent, setIntent]);

  return (
    <>
      <div className="border-border flex items-center gap-3 border-b px-4 pt-4 pb-3">
        <VoiceAvatar voice={voice} className="ring-border size-14 rounded-md ring-1 ring-inset" />
        <div className="grid min-w-0 flex-1 gap-1">
          {/* The name is how the voice appears in the script editor. */}
          <InlineEdit
            as="h2"
            value={voice.name}
            label="Voice name"
            editing={intent === "rename"}
            onEditingChange={(editing) => setIntent(editing ? "rename" : null)}
            onCommit={(name) => update.mutateAsync({ id: voice.id, patch: { name } })}
            className="font-display min-w-0 truncate text-2xl leading-none font-extrabold tracking-[0.01em] uppercase"
          />
          <p className="readout text-muted-foreground truncate">
            {[
              clone ? "Clone" : `Built-in ${voice.voice_id ?? ""}`.trim(),
              modelName ?? voice.model_id ?? "any model",
              `${voice.read_count ?? 0} read${voice.read_count === 1 ? "" : "s"}`,
            ].join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-0.5 self-start">
          <VoiceMenu voice={voice} inPanel />
          <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={close}>
            <XIcon />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {/* Notes are for you: accent, tone, where the clip came from. The
            avatar is drawn from them too. */}
        <InlineEdit
          as="div"
          multiline
          allowEmpty
          value={voice.notes ?? ""}
          label="Notes"
          placeholder="Add notes: accent, tone, where the clip came from"
          onCommit={(notes) => update.mutateAsync({ id: voice.id, patch: { notes: notes || null } })}
          className="text-sm"
        />

        <Part title="Try it">
          <TryItPanel voice={voice} models={models} line={line} onLineChange={onLineChange} />
        </Part>

        {clone && (
          <Part title="Model" sectionRef={modelRef}>
            <ModelPicker voice={voice} models={models} />
          </Part>
        )}

        {clone && (
          <Part title={`Clips${clipsSummary(voice) ? ` · ${clipsSummary(voice)}` : ""}`} sectionRef={clipsRef}>
            <VoiceClipsSection voice={voice} />
          </Part>
        )}

        <Part
          title={`Reads${total > items.length ? ` · latest ${items.length} of ${total}` : total ? ` · ${total}` : ""}`}
          sectionRef={historyRef}
        >
          {reads.isLoading ? (
            <Skeleton className="h-12 w-full rounded-md" />
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing read in this voice yet. Try it above, or cast it in a script.
            </p>
          ) : (
            <>
              {items.map((sound) => (
                <div key={sound.id} className="border-border/60 grid gap-1 rounded-md border px-2.5 py-2">
                  <p className="readout text-muted-foreground truncate">{sound.name}</p>
                  <WaveformPlayer sound={sound} compact />
                </div>
              ))}
              {!showAll && total > items.length ? (
                <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setShowAll(true)}>
                  Show more
                </Button>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Single-voice reads and conversions. A dialogue with several speakers is in the{" "}
                  <Link to="/library" className="text-foreground underline underline-offset-4">
                    Library
                  </Link>
                  .
                </p>
              )}
            </>
          )}
        </Part>
      </div>
    </>
  );
}

export function VoiceDetailPanel({ id }: { id: string }) {
  const close = useDock((s) => s.close);
  const voices = useVoices();
  const models = useModels();
  // The line to try a voice on is remembered across voices and visits.
  const line = useVoiceLabPrefs((s) => s.line);
  const setLine = useVoiceLabPrefs((s) => s.setLine);
  const voice = voices.data?.find((v) => v.id === id) ?? null;

  // A deleted voice takes its panel with it.
  useEffect(() => {
    if (voices.data && !voice) close();
  }, [voices.data, voice, close]);

  if (!voice) {
    return (
      <DockFrame label="Voice details" widthId="voice-detail" itemKey={`voice:${id}`}>
        <div className="flex items-center gap-3 border-b px-4 pt-4 pb-3">
          <Skeleton className="size-14 rounded-md" />
          <Skeleton className="h-6 flex-1" />
        </div>
      </DockFrame>
    );
  }
  const readyTts = (models.data ?? []).filter((m) => m.task === "tts" && isReady(m));
  const modelName = voice.model_id
    ? ((models.data ?? []).find((m) => m.id === voice.model_id)?.name ?? null)
    : null;

  return (
    <DockFrame label={`Details for ${voice.name}`} widthId="voice-detail" itemKey={`voice:${id}`}>
      <VoiceDetails
        key={voice.id}
        voice={voice}
        modelName={modelName}
        models={readyTts}
        line={line}
        onLineChange={setLine}
      />
    </DockFrame>
  );
}
