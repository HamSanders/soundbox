/**
 * The Generate composer — pinned to the bottom of the session, and the anchor
 * of the whole page.
 *
 * Everything that used to be a labelled field in a right-hand column lives here
 * as a compact pill: a trigger that states the *current value* ("5.0s", "100
 * steps", "seed locked"), opening a popover with the actual control. The value
 * being on the trigger is the point — you can read the whole request off one
 * row without opening anything.
 *
 * Two rules survive from the old form and must keep surviving:
 *   1. A pill for a parameter the selected model does not support is not
 *      rendered at all. Showing an input whose value the backend discards is
 *      worse than showing nothing.
 *   2. The model picker states the licence, in the picker and on the composer,
 *      because "can I ship this?" is the most consequential fact about a model
 *      and it must not be a click away.
 *
 * Rule 1 is also what lets a text-to-speech model live here. On a "tts" model
 * the box stops being a description of a sound and becomes the words to speak,
 * so its placeholder says so; Duration and Variations disappear entirely
 * (/api/speak takes neither — a read is as long as its script), a voice picker
 * appears, and everything else the model genuinely supports stays exactly where
 * it was. Nothing is greyed out and nothing is relabelled to mean two things.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  ClockIcon,
  CpuIcon,
  DicesIcon,
  FolderIcon,
  GaugeIcon,
  LayersIcon,
  ChevronDownIcon,
  LockIcon,
  LockOpenIcon,
  BanIcon,
  MicIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquareIcon,
  TagIcon,
  Undo2Icon,
  UserRoundIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingVerb } from "@/components/loading-verb";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { ModelStatusPill } from "@/components/model-status";
import { LicenseChip } from "@/components/license-badge";
import { VoiceAvatar } from "@/components/voice-avatar";
import { PHASE_LABEL } from "@/components/pending-sound-row";
import { formatDuration } from "@/lib/format";
import type { Job, Model, Project, Voice } from "@/lib/api";
import type { ComposerBlocker } from "@/lib/composer-blocker";
import { NOT_READY } from "@/lib/model-ready";
import { clampDuration, type ComposerSettings } from "@/lib/session-store";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ pills */

/**
 * Spreads `...rest` onto a real <button>, which is what lets it be used as
 * `<PopoverTrigger asChild>` — Radix's Slot clones this element and needs its
 * props (aria-expanded, onClick, ref) to land on something focusable.
 */
function Pill({
  icon: Icon,
  leading,
  label,
  value,
  active,
  ariaLabel,
  className,
  ...rest
}: {
  icon: React.ComponentType<{ className?: string }>;
  /** Rendered in the icon's place when the pill has something more specific
   *  to show than its category glyph — the chosen voice's avatar, where the
   *  generic person icon would say only "this pill is about voices". The icon
   *  stays the fallback, so a pill with nothing picked is unchanged. */
  leading?: React.ReactNode;
  label: string;
  value: string;
  active?: boolean;
  ariaLabel: string;
} & React.ComponentProps<"button">) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={ariaLabel}
      className={cn(
        "text-muted-foreground hover:text-foreground h-7 shrink-0 rounded-full px-2.5 font-normal",
        active && "text-foreground bg-muted",
        className,
      )}
      {...rest}
    >
      {leading ?? <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
      <span className="sr-only">{label}: </span>
      <span className="tabular-nums">{value}</span>
    </Button>
  );
}

/** Popover section heading — a Label without a control to point at. */
function PopHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-foreground mb-2 text-xs font-semibold tracking-tight">{children}</p>
  );
}

/** Fixed display order for the model picker's category tabs. A category
 *  only gets a tab when at least one reported model actually has it —
 *  "Utility" (stem separation etc.) stays hidden unless the backend exposes
 *  one, same as any other category would if the catalog shrank to nothing. */
const CATEGORY_ORDER: Model["category"][] = ["sfx", "music", "voice", "utility"];

const CATEGORY_LABEL: Record<Model["category"], string> = {
  sfx: "SFX",
  music: "Music",
  voice: "Voice",
  utility: "Utility",
};

/* --------------------------------------------------------------- composer */

interface ComposerProps {
  settings: ComposerSettings;
  onChange: (patch: Partial<ComposerSettings>) => void;
  models: Model[] | undefined;
  modelsLoading: boolean;
  model: Model | undefined;
  running: boolean;
  /** The last-submitted job while it is in flight, so the button can name
   *  its stage and the card edge can show its progress. Null when idle. */
  job: Job | null;
  /** The one reason a submit would not go through, or null. Rendered as a
   *  sentence with a link above the controls — never as a bare disabled
   *  button, which says that something is wrong and nothing about what. */
  blocker: ComposerBlocker | null;
  onSubmit: () => void;
  onCancel: () => void;
  /** Estimated wall time for this request, or null when we genuinely do not
   *  know. Never guessed — see `estimateDurationS` in the Generate route. */
  estimateS: number | null;
  estimateNote: string | null;
  /** For the project picker — same list `app-sidebar.tsx` shows. */
  projects: Project[] | undefined;
  /** The project the current session is filed in (or will be, once it
   *  exists), or null for "no project". */
  projectId: string | null;
  onChangeProject: (id: string | null) => void;
  /** Saved voices this model can actually be driven with — already filtered
   *  by the session hook, since the builtin/clone rule is a backend constraint
   *  rather than a presentation choice. Empty for a non-tts model. */
  voices: Voice[];
  /** The chosen voice, or null for the model's own default. */
  voiceId: string | null;
  onChangeVoice: (id: string | null) => void;
  /** Local prompt-assistant affordance — a no-op shape (enabled: false) when
   *  the assistant is off, so the composer never has to check anywhere else. */
  enhance: {
    enabled: boolean;
    pending: boolean;
    error: string | null;
    variations: string[];
    canUndo: boolean;
    run: (n?: number) => void;
    apply: (text: string) => void;
    undo: () => void;
  };
  /** Writes a full lyric sheet into the Lyrics box — a different skill from
   *  `enhance` above (structure tags, syllable-balanced lines), not the same
   *  rewrite applied to a different field. */
  lyricsAssist: {
    enabled: boolean;
    pending: boolean;
    error: string | null;
    write: () => void;
  };
}

export function GenerateComposer({
  settings,
  onChange,
  models,
  modelsLoading,
  model,
  running,
  job,
  blocker,
  onSubmit,
  onCancel,
  estimateS,
  estimateNote,
  projects,
  projectId,
  onChangeProject,
  voices,
  voiceId,
  onChangeVoice,
  enhance,
  lyricsAssist,
}: ComposerProps) {
  const [modelsOpen, setModelsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [voicesOpen, setVoicesOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [variationsOpen, setVariationsOpen] = useState(false);

  /** A read, not a generation. Drives the wording and which pills exist. */
  const isTts = model?.task === "tts";

  /** Categories with at least one model, in the fixed display order. */
  const availableCategories = useMemo(() => {
    const present = new Set((models ?? []).map((m) => m.category));
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, [models]);

  const [activeCategory, setActiveCategory] = useState<Model["category"]>(
    model?.category ?? "sfx",
  );

  // Resyncs the tab to the selected model's category when the selection
  // changes from elsewhere (a replayed turn, a deep link) — but only then,
  // as an effect keyed on the model's id rather than every render. Folding
  // this into effectiveCategory below instead made model.category win on
  // every render, which made the tabs themselves unclickable: a click set
  // activeCategory, but the controlled Tabs' value snapped right back to
  // model.category before the next paint.
  useEffect(() => {
    if (model) setActiveCategory(model.category);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the model's identity should retrigger this, not every field on it
  }, [model?.id]);

  const effectiveCategory = useMemo<Model["category"]>(() => {
    if (availableCategories.includes(activeCategory)) return activeCategory;
    return availableCategories[0] ?? "sfx";
  }, [activeCategory, availableCategories]);

  const modelsInCategory = useMemo(
    () => (models ?? []).filter((m) => m.category === effectiveCategory),
    [models, effectiveCategory],
  );

  const tagLabel = settings.tags.length ? `${settings.tags.length}` : "None";

  const commitTags = (raw: string) =>
    onChange({
      tags: raw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });

  const durationMax = model?.max_duration_s ?? 30;

  /** Model id → name, for the voice rows' subtitles. */
  const modelNames = useMemo(
    () => new Map((models ?? []).map((m) => [m.id, m.name])),
    [models],
  );

  const modelLabel = useMemo(() => {
    if (model) return model.name;
    if (modelsLoading) return "Loading…";
    return "No model";
  }, [model, modelsLoading]);

  /* --------------------------------------------------------- button */

  /** What the Generate button says. Idle: the verb. Running: the stage of
   *  the last-submitted job, with its percentage once the model is actually
   *  rendering — the same words `PendingSoundRow` uses for the same job, so
   *  the button and the row above it never disagree about what is going on.
   *  The button keeps a fixed width so none of these changes shifts the
   *  pills beside it. */
  const verb = isTts ? "Speak" : "Generate";
  const stageLabel = (() => {
    if (!running) return verb;
    if (!job) return "Queued";
    const base = PHASE_LABEL[job.phase] ?? job.phase;
    if (job.phase === "generating" && job.progress > 0) {
      return `${base} ${Math.round(job.progress * 100)}%`;
    }
    return base;
  })();

  /** 0–100 for the strip along the card's bottom edge; null while the job is
   *  queued or has reported nothing yet, which renders an indeterminate pulse
   *  rather than an empty bar pretending to be at zero. */
  const stripPercent =
    running && job && job.status === "running" && job.progress > 0
      ? Math.min(100, Math.round(job.progress * 100))
      : null;

  /** The button's click when blocked: focus the box when the box is the fix,
   *  otherwise nothing — the sentence above already says where to go. */
  const handleSubmit = () => {
    if (blocker) {
      if (blocker.focusPrompt) document.getElementById("prompt")?.focus();
      return;
    }
    onSubmit();
  };

  /* ------------------------------------------------------------- voices */

  /** Resolved once: the trigger's label, its aria-label and its avatar are
   *  three views of the same lookup. */
  const chosenVoice = voices.find((v) => v.id === voiceId) ?? null;

  /** The voice list, as the popover body the top-left trigger opens on a
   *  text-to-speech model. Each row names the model the voice speaks
   *  through, because picking the voice is what picks it — the subtitle is
   *  the only place that consequence is visible now the model has no control
   *  of its own here. */
  const voicePicker = (
    <PopoverContent className="w-72 p-1.5">
      <PopHeading>
        <span className="px-1.5">Voice</span>
      </PopHeading>
      <ul className="max-h-72 space-y-0.5 overflow-y-auto">
        {/* A cloning-only family (Chatterbox, Fish Audio, IndexTTS2, …) has
            no default voice behind this option — offering it just forwards a
            request audio.cpp is guaranteed to reject. */}
        {!model?.requires_voice_reference && (
          <li>
            <button
              type="button"
              aria-current={voiceId === null}
              onClick={() => {
                onChangeVoice(null);
                setVoicesOpen(false);
              }}
              className={cn(
                "hover:bg-muted focus-visible:ring-ring/50 w-full rounded-lg px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3",
                voiceId === null && "bg-muted font-medium",
              )}
            >
              <span className="block">Model default</span>
              {model && (
                <span className="text-muted-foreground block truncate text-xs">
                  {model.name}
                </span>
              )}
            </button>
          </li>
        )}
        {voices.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              aria-current={v.id === voiceId}
              onClick={() => {
                onChangeVoice(v.id);
                setVoicesOpen(false);
              }}
              className={cn(
                "hover:bg-muted focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3",
                v.id === voiceId && "bg-muted font-medium",
              )}
            >
              <VoiceAvatar voice={v} className="size-6 shrink-0 rounded-full" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{v.name}</span>
                <span className="text-muted-foreground block truncate text-xs font-normal">
                  {modelNames.get(v.model_id ?? "") ?? "Any model"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-1.5 px-1.5 text-xs leading-relaxed">
        {voices.length === 0
          ? model?.requires_voice_reference
            ? "This model has no default voice — clone one from a reference clip in the Voice Lab first."
            : "No saved voices yet — it will read in the model's own default voice."
          : "A voice carries its model with it. Make more in the Voice Lab."}
      </p>
    </PopoverContent>
  );

  return (
    <div
      className={cn(
        "bg-card ring-foreground/10 relative rounded-2xl p-2 shadow-lg ring-1",
        "focus-within:ring-ring/40 transition-shadow",
      )}
    >
      {/* One textarea for both tasks, relabelled — not two. It carries the
          autofocus, the Ctrl/Cmd+Enter hint and the id that "reuse these
          settings" focuses, and a second copy would have to keep all of that
          in sync for no gain. */}
      <Label htmlFor="prompt" className="sr-only">
        {isTts ? "Script" : "Prompt"}
      </Label>
      <div className="relative">
        <Textarea
          id="prompt"
          value={settings.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder={
            isTts
              ? "What should this voice say?"
              : "heavy wooden door slam, dry room, close mic"
          }
          rows={2}
          autoFocus
          aria-describedby="composer-hint"
          className={cn(
            "max-h-44 min-h-[3.25rem] resize-none overflow-y-auto border-transparent bg-transparent px-2.5 pt-10 pb-2 text-base leading-relaxed shadow-none placeholder:text-muted-foreground/70 focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent",
            enhance.enabled && !isTts && "pr-16",
          )}
        />

        {/* --------------------------------------------- model / voice */}
        {/* Pinned to the textarea's own top-left corner — whatever this slot
            holds is the first thing you set, so it reads first, opposite the
            enhance control.

            On a text-to-speech model the thing you set is the *voice*, not
            the model: every voice names the model it speaks through (see
            `AddVoiceDialog`), so picking "Ada" picks her family too and a
            second control for it would only let you put the two out of
            step. The model picker takes this slot everywhere else. */}
        <div className="absolute top-1.5 left-1.5">
        {isTts ? (
          <Popover open={voicesOpen} onOpenChange={setVoicesOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={
                  chosenVoice
                    ? `Voice: ${chosenVoice.name}. Change voice.`
                    : "Voice: the model's default. Change voice."
                }
                className="text-foreground hover:bg-muted h-7 max-w-[14rem] shrink-0 rounded-full px-2.5 font-medium"
              >
                {chosenVoice ? (
                  <VoiceAvatar voice={chosenVoice} className="size-4 shrink-0 rounded-full" />
                ) : (
                  <UserRoundIcon className="size-3.5 shrink-0" aria-hidden="true" />
                )}
                <span className="truncate">{chosenVoice?.name ?? "Default voice"}</span>
              </Button>
            </PopoverTrigger>
            {voicePicker}
          </Popover>
        ) : modelsLoading && !model ? (
          <Skeleton className="h-7 w-40 shrink-0 rounded-full" />
        ) : (
          <Popover open={modelsOpen} onOpenChange={setModelsOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Model: ${modelLabel}. Change model.`}
                className="text-foreground hover:bg-muted h-7 max-w-[12rem] shrink-0 rounded-full px-2.5 font-medium"
              >
                <CpuIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{modelLabel}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(24rem,calc(100vw-1.5rem))] p-1.5">
              <PopHeading>
                <span className="px-1.5">Model</span>
              </PopHeading>
              {!models?.length ? (
                <p className="text-muted-foreground px-1.5 pb-1.5 text-sm">
                  No models reported by the backend.
                </p>
              ) : (
                <>
                  {availableCategories.length > 1 && (
                    <Tabs
                      value={effectiveCategory}
                      onValueChange={(v) => setActiveCategory(v as Model["category"])}
                      className="mb-1.5 px-1.5"
                    >
                      <TabsList className="w-full">
                        {availableCategories.map((c) => (
                          <TabsTrigger key={c} value={c}>
                            {CATEGORY_LABEL[c]}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  )}
                  {modelsInCategory.length === 0 ? (
                    <p className="text-muted-foreground px-1.5 pb-1.5 text-sm">
                      No {CATEGORY_LABEL[effectiveCategory].toLowerCase()} models available.
                    </p>
                  ) : (
                <ul className="max-h-80 space-y-0.5 overflow-y-auto">
                  {modelsInCategory.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        aria-current={e.id === settings.modelId}
                        onClick={() => {
                          onChange({ modelId: e.id });
                          setModelsOpen(false);
                        }}
                        className={cn(
                          "hover:bg-muted focus-visible:ring-ring/50 w-full rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-3",
                          e.id === settings.modelId && "bg-muted",
                          NOT_READY.has(e.status) && "opacity-60",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">{e.name}</span>
                          <ModelStatusPill status={e.status} className="ml-auto shrink-0" />
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <LicenseChip license={e.license} />
                          <span className="text-muted-foreground text-xs tabular-nums">
                            max {e.max_duration_s}s
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                  )}
                </>
              )}
            </PopoverContent>
          </Popover>
        )}
        </div>

        {/* ---------------------------------------------------- enhance */}
        {/* A script to speak isn't a description to rewrite, so this is
            hidden entirely for a tts model — same rule Duration/Variations
            follow. Pinned to the textarea's own top-right corner so it reads
            as acting on the text right under it, not as another composer
            control. */}
        {enhance.enabled && !isTts && (
          <div className="absolute top-1.5 right-1.5 flex shrink-0 items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Rewrite this prompt"
                  disabled={!settings.prompt.trim() || enhance.pending}
                  onClick={() => enhance.run(1)}
                  className="text-muted-foreground hover:text-foreground h-7 shrink-0 rounded-full px-2 font-normal"
                >
                  <SparklesIcon
                    className={cn("size-3.5", enhance.pending && "animate-pulse")}
                    aria-hidden="true"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Rewrite this prompt</TooltipContent>
            </Tooltip>
            <Popover
              open={variationsOpen}
              onOpenChange={(open) => {
                setVariationsOpen(open);
                if (open) enhance.run(3);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Show prompt variations"
                  disabled={!settings.prompt.trim()}
                  className="text-muted-foreground hover:text-foreground h-7 w-6 shrink-0 rounded-full px-0 font-normal"
                >
                  <ChevronDownIcon className="size-3.5" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(24rem,calc(100vw-1.5rem))] p-1.5">
                <PopHeading>
                  <span className="px-1.5">Variations</span>
                </PopHeading>
                {enhance.pending ? (
                  <p className="text-muted-foreground px-1.5 pb-1.5 text-sm">
                    <LoadingVerb />
                  </p>
                ) : enhance.error ? (
                  <p className="text-muted-foreground px-1.5 pb-1.5 text-sm">{enhance.error}</p>
                ) : enhance.variations.length === 0 ? (
                  <p className="text-muted-foreground px-1.5 pb-1.5 text-sm">No variations yet.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {enhance.variations.map((v, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => {
                            enhance.apply(v);
                            setVariationsOpen(false);
                          }}
                          className="hover:bg-muted w-full rounded-md px-2 py-1.5 text-left text-sm"
                        >
                          {v}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
            {enhance.canUndo && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Restore the previous prompt"
                    onClick={enhance.undo}
                    className="text-muted-foreground hover:text-foreground h-7 shrink-0 rounded-full px-2 font-normal"
                  >
                    <Undo2Icon className="size-3.5" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Restore the previous prompt</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------- blocker */}
      {/* One reason, one sentence, one link — above the controls so it reads
          before the button it explains. Never a bare disabled button: that
          says something is wrong and nothing about what. Hidden while a job
          runs, when the stage label already has the floor. */}
      {blocker && !running && (
        <p
          role="status"
          className="text-muted-foreground mx-1 mt-0.5 mb-1 flex flex-wrap items-center gap-x-1.5 text-xs leading-relaxed"
        >
          <span>{blocker.sentence}</span>
          {blocker.link && (
            <Link
              to={blocker.link.to}
              className="text-foreground inline-flex items-center gap-0.5 font-medium underline underline-offset-4"
            >
              {blocker.link.label}
              <ArrowUpRightIcon className="size-3" aria-hidden="true" />
            </Link>
          )}
        </p>
      )}

      {/* ---------------------------------------------------------- controls */}
      <div className="mt-1 flex items-center gap-2 px-0.5">
        {/* At 375px seven pills wrap into five rows and the composer swallows a
            third of the screen, so below `sm` they scroll sideways instead —
            the same move the reference makes with its category strip. The
            submit control is a sibling, never inside the scroller. */}
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5 sm:flex-wrap sm:gap-y-1.5 sm:overflow-visible">
        {/* ------------------------------------------------------ project */}
        {(() => {
          const project = projects?.find((p) => p.id === projectId);
          const label = project ? project.name : "No project";
          return (
            <Popover open={projectsOpen} onOpenChange={setProjectsOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={
                    project
                      ? `Project: ${project.name}. Change project.`
                      : "Project: none. Add one."
                  }
                  className={cn(
                    "text-muted-foreground hover:text-foreground h-7 max-w-[10rem] shrink-0 rounded-full px-2.5 font-normal",
                    project && "text-foreground bg-muted",
                  )}
                >
                  <FolderIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-1.5">
                <PopHeading>
                  <span className="px-1.5">Project</span>
                </PopHeading>
                <ul className="max-h-72 space-y-0.5 overflow-y-auto">
                  <li>
                    <button
                      type="button"
                      aria-current={projectId === null}
                      onClick={() => {
                        onChangeProject(null);
                        setProjectsOpen(false);
                      }}
                      className={cn(
                        "hover:bg-muted focus-visible:ring-ring/50 w-full rounded-lg px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3",
                        projectId === null && "bg-muted font-medium",
                      )}
                    >
                      No project
                    </button>
                  </li>
                  {(projects ?? []).map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-current={p.id === projectId}
                        onClick={() => {
                          onChangeProject(p.id);
                          setProjectsOpen(false);
                        }}
                        className={cn(
                          "hover:bg-muted focus-visible:ring-ring/50 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3",
                          p.id === projectId && "bg-muted font-medium",
                        )}
                      >
                        <span className="truncate">{p.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground mt-1.5 px-1.5 text-xs leading-relaxed">
                  Everything generated in this thread files into the project
                  automatically.
                </p>
              </PopoverContent>
            </Popover>
          );
        })()}

        {/* Duration and Variations exist for generation only: a read is as long
            as its script, and /api/speak renders one take. A pill whose value
            the backend discards is worse than no pill (rule 1). */}
        {!isTts && (
          <>
        {/* ----------------------------------------------------- duration */}
        <Popover>
          <PopoverTrigger asChild>
              <Pill
                icon={ClockIcon}
                label="Duration"
                value={`${settings.duration.toFixed(1)}s`}
                ariaLabel={`Duration: ${settings.duration.toFixed(1)} seconds. Change duration.`}
              />
            </PopoverTrigger>
          <PopoverContent>
            <PopHeading>Duration</PopHeading>
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground text-xs">
                max {durationMax}s on this model
              </span>
              <span className="font-(family-name:--font-log) text-xs tabular-nums">
                {settings.duration.toFixed(1)}s
              </span>
            </div>
            <Slider
              className="mt-2.5"
              min={0.5}
              max={durationMax}
              step={0.5}
              value={[settings.duration]}
              onValueChange={([v]) => onChange({ duration: clampDuration(v, model) })}
              aria-label="Duration in seconds"
            />
          </PopoverContent>
        </Popover>

        {/* --------------------------------------------------- variations */}
        <Popover>
          <PopoverTrigger asChild>
              <Pill
                icon={LayersIcon}
                label="Variations"
                value={`${settings.variations}×`}
                active={settings.variations > 1}
                ariaLabel={`Variations: ${settings.variations}. Change how many are generated.`}
              />
            </PopoverTrigger>
          <PopoverContent className="w-56">
            <PopHeading>Variations</PopHeading>
            <div className="flex gap-1.5" role="group" aria-label="Variations">
              {[1, 2, 3, 4].map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant={settings.variations === n ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={settings.variations === n}
                  onClick={() => onChange({ variations: n })}
                  className="w-10"
                >
                  {n}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              Same prompt, different seeds — and the wait multiplies with it.
            </p>
          </PopoverContent>
        </Popover>
          </>
        )}

        {/* --------------------------------------------------------- seed */}
        {model?.supports.seed && (
          <Popover>
            <PopoverTrigger asChild>
              <Pill
                  icon={settings.seedLocked ? LockIcon : DicesIcon}
                  label="Seed"
                  value={
                    settings.seedLocked && settings.seed !== null
                      ? String(settings.seed)
                      : "Random"
                  }
                  active={settings.seedLocked}
                  ariaLabel={
                    settings.seedLocked && settings.seed !== null
                      ? `Seed locked to ${settings.seed}. Change seed.`
                      : "Seed: random each run. Change seed."
                  }
                />
            </PopoverTrigger>
            <PopoverContent>
              <PopHeading>Seed</PopHeading>
              <div className="flex items-center gap-1.5">
                <Input
                  id="seed"
                  inputMode="numeric"
                  value={
                    settings.seedLocked && settings.seed !== null ? String(settings.seed) : ""
                  }
                  placeholder="random each run"
                  aria-label="Seed"
                  disabled={!settings.seedLocked}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/\D/g, ""));
                    onChange({ seed: Number.isFinite(n) ? n : null });
                  }}
                  className="font-mono"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Randomise seed"
                      onClick={() =>
                        onChange({
                          seed: Math.floor(Math.random() * 1_000_000),
                          seedLocked: true,
                        })
                      }
                    >
                      <DicesIcon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Randomise seed</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={settings.seedLocked ? "secondary" : "outline"}
                      size="icon"
                      aria-label={
                        settings.seedLocked ? "Unlock seed" : "Lock seed to reuse it"
                      }
                      aria-pressed={settings.seedLocked}
                      onClick={() =>
                        onChange({
                          seedLocked: !settings.seedLocked,
                          seed:
                            !settings.seedLocked && settings.seed === null
                              ? Math.floor(Math.random() * 1_000_000)
                              : settings.seed,
                        })
                      }
                    >
                      {settings.seedLocked ? <LockIcon /> : <LockOpenIcon />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {settings.seedLocked ? "Seed is locked — reused every run" : "Lock to reuse"}
                  </TooltipContent>
                </Tooltip>
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* -------------------------------------------------------- steps */}
        {model?.supports.steps && (
          <Popover>
            <PopoverTrigger asChild>
              <Pill
                  icon={SlidersHorizontalIcon}
                  label="Steps"
                  value={`${settings.steps ?? model.defaults.steps ?? 8} steps`}
                  ariaLabel={`Sampling steps: ${settings.steps ?? model.defaults.steps ?? 8}. Change steps.`}
                />
            </PopoverTrigger>
            <PopoverContent>
              <PopHeading>Sampling steps</PopHeading>
              <Input
                inputMode="numeric"
                aria-label="Sampling steps"
                value={settings.steps ?? ""}
                placeholder={String(model.defaults.steps ?? 8)}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "");
                  onChange({ steps: raw === "" ? null : Number(raw) });
                }}
                className="font-mono"
              />
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                More steps, more detail, longer wait. Blank uses this model&rsquo;s
                default ({model.defaults.steps ?? 8}).
              </p>
            </PopoverContent>
          </Popover>
        )}

        {/* ---------------------------------------------------------- cfg */}
        {model?.supports.cfg && (
          <Popover>
            <PopoverTrigger asChild>
              <Pill
                  icon={GaugeIcon}
                  label="CFG scale"
                  value={`CFG ${settings.cfg ?? model.defaults.cfg ?? 3}`}
                  ariaLabel={`CFG scale: ${settings.cfg ?? model.defaults.cfg ?? 3}. Change guidance.`}
                />
            </PopoverTrigger>
            <PopoverContent>
              <PopHeading>CFG scale</PopHeading>
              <Input
                inputMode="decimal"
                aria-label="CFG scale"
                value={settings.cfg ?? ""}
                placeholder={String(model.defaults.cfg ?? 3)}
                max={model.max_cfg ?? undefined}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d.]/g, "");
                  onChange({ cfg: raw === "" ? null : Number(raw) });
                }}
                // Clamped on blur rather than per keystroke: typing "3.5" with a
                // ceiling of 3 would otherwise be rewritten to "3" the instant
                // "3" is typed, and the trailing ".5" would land on a clamped
                // value. Waiting for blur keeps typing predictable while still
                // guaranteeing the request never leaves with a value the model
                // will refuse.
                onBlur={() => {
                  const max = model.max_cfg;
                  if (max != null && settings.cfg != null && settings.cfg > max) {
                    onChange({ cfg: max });
                  }
                }}
                className="font-mono"
              />
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                How tightly the model follows the prompt. Too high and it gets brittle.
              </p>
              {model.max_cfg != null && (
                <p
                  className={cn(
                    "mt-1.5 text-xs leading-relaxed",
                    (settings.cfg ?? model.defaults.cfg ?? 0) > model.max_cfg
                      ? "text-warn"
                      : "text-muted-foreground",
                  )}
                >
                  {model.name} is a distilled model tuned for CFG{" "}
                  {model.defaults.cfg ?? 1}. Above {model.max_cfg} the output
                  degrades into noise, so Soundbox won&rsquo;t render past it.
                </p>
              )}
            </PopoverContent>
          </Popover>
        )}

        {/* ---------------------------------------------- negative prompt */}
        {model?.supports.negative_prompt && (
          <Popover>
            <PopoverTrigger asChild>
              <Pill
                  icon={BanIcon}
                  label="Negative prompt"
                  value={settings.negativePrompt.trim() ? "Avoiding" : "None"}
                  active={Boolean(settings.negativePrompt.trim())}
                  ariaLabel={
                    settings.negativePrompt.trim()
                      ? `Negative prompt: ${settings.negativePrompt}. Edit it.`
                      : "Negative prompt: none. Add one."
                  }
                />
            </PopoverTrigger>
            <PopoverContent>
              <PopHeading>Negative prompt</PopHeading>
              <Input
                aria-label="Negative prompt"
                value={settings.negativePrompt}
                placeholder="music, voice, reverb"
                onChange={(e) => onChange({ negativePrompt: e.target.value })}
              />
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                What to steer away from.
              </p>
            </PopoverContent>
          </Popover>
        )}

        {/* ---------------------------------------------------- lyrics */}
        {model?.supports.lyrics && (
          <Popover>
            <PopoverTrigger asChild>
              <Pill
                  icon={MicIcon}
                  label="Lyrics"
                  value={settings.lyrics.trim() ? "Vocal" : "Instrumental"}
                  active={Boolean(settings.lyrics.trim())}
                  ariaLabel={
                    settings.lyrics.trim()
                      ? `Lyrics: ${settings.lyrics}. Edit them.`
                      : "Lyrics: none — generates instrumental. Add lyrics to sing."
                  }
                />
            </PopoverTrigger>
            <PopoverContent>
              <div className="mb-2 flex items-center justify-between gap-2">
                <PopHeading>Lyrics</PopHeading>
                {lyricsAssist.enabled && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="Write a full lyric sheet"
                        disabled={
                          (!settings.lyrics.trim() && !settings.prompt.trim()) ||
                          lyricsAssist.pending
                        }
                        onClick={lyricsAssist.write}
                        className="text-muted-foreground hover:text-foreground h-6 shrink-0 gap-1 rounded-full px-2 text-xs font-normal"
                      >
                        <SparklesIcon
                          className={cn("size-3", lyricsAssist.pending && "animate-pulse")}
                          aria-hidden="true"
                        />
                        {lyricsAssist.pending ? <LoadingVerb /> : "Write lyrics"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Expands the theme above into a full lyric sheet with structure tags
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <Textarea
                aria-label="Lyrics"
                value={settings.lyrics}
                placeholder={"[verse]\nWords the vocal should sing..."}
                rows={5}
                onChange={(e) => onChange({ lyrics: e.target.value })}
              />
              {lyricsAssist.error && (
                <p className="text-muted-foreground mt-1.5 text-xs">{lyricsAssist.error}</p>
              )}
              <Label className="mt-3 block text-xs">Track name (optional)</Label>
              <Input
                aria-label="Track name"
                value={settings.trackName}
                placeholder="Song title"
                className="mt-1"
                onChange={(e) => onChange({ trackName: e.target.value })}
              />
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                Leave blank for instrumental. With lyrics, {model.name} sings
                them over the generated music.
              </p>
            </PopoverContent>
          </Popover>
        )}

        </div>

        {/* -------------------------------------------- estimate + submit */}
        <div className="flex shrink-0 items-center gap-2 pl-1">
          {!running && estimateS !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground cursor-default font-(family-name:--font-log) text-xs tabular-nums">
                  ~{formatDuration(estimateS)}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                {estimateNote ?? "Estimated time to generate."}
              </TooltipContent>
            </Tooltip>
          )}
          {/* Cancel affords stopping the last-submitted job, but no longer
              replaces Submit — several turns can be in flight together now,
              so hiding Submit behind "running" is exactly what used to make
              a second Generate click silently do nothing. Its square is
              always reserved and merely invisible when idle, so the row does
              not jump by 36px every time a job starts or ends. */}
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={onCancel}
            aria-label="Cancel the running job"
            aria-hidden={!running}
            tabIndex={running ? 0 : -1}
            disabled={!running}
            className={cn("rounded-full", !running && "invisible")}
          >
            <SquareIcon />
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            aria-disabled={Boolean(blocker)}
            aria-busy={running}
            aria-label={
              running
                ? `${stageLabel}. ${verb} again to queue another.`
                : blocker
                  ? `${verb} is unavailable: ${blocker.sentence}`
                  : verb
            }
            className={cn(
              "h-8 w-36 justify-start gap-1.5 overflow-hidden rounded-full pr-3 pl-2.5 text-xs shadow-sm transition-[transform,opacity]",
              blocker
                ? "cursor-default opacity-50 hover:bg-primary active:scale-100"
                : "hover:scale-[1.03] active:scale-95",
            )}
          >
            {running ? (
              <span
                className="bg-primary-foreground/80 size-2 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <ArrowUpIcon className="size-4 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate text-left tabular-nums">{stageLabel}</span>
          </Button>
        </div>
      </div>

      {/* -------------------------------------------------------- tags */}
      {/* Under the entire card — prompt, model, and the rest of the controls
          all sit above it — as its own inline row rather than tucked
          anywhere inside the composer's active area. */}
      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border/60 px-1 pt-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {settings.tags.map((t) => (
            <span
              key={t}
              className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs"
            >
              {t}
            </span>
          ))}
        </div>
        <Popover
          onOpenChange={(open) => {
            if (open) setTagDraft(settings.tags.join(", "));
            else commitTags(tagDraft);
          }}
        >
          <PopoverTrigger asChild>
            <Pill
              icon={TagIcon}
              label="Tags"
              value={tagLabel}
              active={settings.tags.length > 0}
              ariaLabel={
                settings.tags.length
                  ? `Tags: ${settings.tags.join(", ")}. Edit tags.`
                  : "Tags: none. Add tags."
              }
              className="shrink-0"
            />
          </PopoverTrigger>
          <PopoverContent>
            <PopHeading>Tags</PopHeading>
            <Input
              aria-label="Tags, comma separated"
              value={tagDraft}
              placeholder="impact, wood, ui"
              onChange={(e) => setTagDraft(e.target.value)}
              onBlur={() => commitTags(tagDraft)}
            />
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              Comma separated. Applied to everything this run produces, and
              searchable in the Library.
            </p>
          </PopoverContent>
        </Popover>
      </div>

      {/* ------------------------------------------------------ progress */}
      {/* A 2px strip along the card's bottom edge while a job runs. Known
          progress fills it; an unknown stage (queued, loading) pulses the
          whole strip rather than parking a bar at zero. */}
      {running && (
        <div
          className="bg-muted absolute inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-b-2xl"
          role="progressbar"
          aria-label="Job progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={stripPercent ?? undefined}
          aria-valuetext={stripPercent === null ? stageLabel : `${stripPercent}%`}
        >
          <div
            className={cn(
              "bg-primary h-full",
              stripPercent === null
                ? "w-full animate-pulse motion-reduce:animate-none"
                : "transition-[width] duration-300",
            )}
            style={stripPercent === null ? undefined : { width: `${stripPercent}%` }}
          />
        </div>
      )}

      <p id="composer-hint" className="sr-only">
        {isTts
          ? "Type the words to be spoken. Press Control or Command plus Enter to read them aloud."
          : "Press Control or Command plus Enter to generate."}
      </p>
    </div>
  );
}
