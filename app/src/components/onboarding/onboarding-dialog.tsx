/**
 * First-run setup.
 *
 * A fresh install has none of the 46 models on disk, and until this existed
 * the app said "Welcome back" over three empty shelves and let you discover
 * that by clicking something that could not work. Four questions fix that:
 * what you want to make, whether you are selling it, which models we should
 * fetch, and whether you want the two optional engines.
 *
 * Three decisions worth keeping:
 *
 * 1. **It closes before the downloads finish.** A music checkpoint is
 *    minutes. Holding someone on a progress bar for their first minutes with
 *    the app is the worst use of those minutes; the installs continue in the
 *    background and the Models page is where progress lives, because it
 *    already has per-row progress that survives a reload.
 * 2. **Skip is a real answer.** It writes `onboarded_at` like Finish does, so
 *    the wizard never ambushes anyone twice. What carries a skipped setup
 *    forward is the dashboard's banner, not a second modal.
 * 3. **No folder questions.** The defaults are resolved and valid, and asking
 *    someone to choose two directories before they have made a sound is how
 *    you lose them. Storage lives on Settings, where it can be changed by
 *    someone who has a reason to.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StepExtras } from "@/components/onboarding/step-extras";
import { StepIntent } from "@/components/onboarding/step-intent";
import { StepModels } from "@/components/onboarding/step-models";
import { StepUsage } from "@/components/onboarding/step-usage";
import {
  useAudioCppCatalog,
  useHealth,
  useImageEngineInstall,
  useImageModelDownload,
  useImageStatus,
  useLlmEngineInstall,
  useLlmModelDownload,
  useLlmStatus,
  useModelAction,
  useModels,
  useSettings,
  useUpdateSettings,
} from "@/lib/queries";
import {
  INTENTS,
  recommendModels,
  shouldOnboard,
  type Intent,
  type Usage,
} from "@/lib/onboarding";
import { api, type JobRef } from "@/lib/api";
import { cn } from "@/lib/utils";

const STEPS = ["What you make", "Licence", "Models", "Extras"] as const;

/** Resolve when a job reaches a terminal status, so the engine install can be
 *  sequenced ahead of the model download that needs it. Never rejects: a
 *  failed install is reported by the job itself, and the caller's fallback —
 *  try the download anyway — is the same either way. */
function awaitJob(jobId: string): Promise<void> {
  return new Promise((resolve) => {
    const stop = api.subscribeJob(
      jobId,
      (job) => {
        if (["done", "error", "cancelled"].includes(job.status)) {
          stop();
          resolve();
        }
      },
      () => {
        stop();
        resolve();
      },
    );
  });
}

export function OnboardingDialog() {
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const { data: models } = useModels();
  const { data: health } = useHealth();
  const { data: catalog } = useAudioCppCatalog();
  const { data: llm } = useLlmStatus();
  const { data: image } = useImageStatus();

  const update = useUpdateSettings();
  const { download } = useModelAction();
  const installLlmEngine = useLlmEngineInstall();
  const downloadLlmModel = useLlmModelDownload();
  const installImageEngine = useImageEngineInstall();
  const downloadImageModel = useImageModelDownload();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [usage, setUsage] = useState<Usage>("personal");
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const [assistant, setAssistant] = useState(false);
  const [artwork, setArtwork] = useState(false);
  const [busy, setBusy] = useState(false);

  // Opened from the queries rather than held open by them: once it is up, a
  // refetch that flips `shouldOnboard` (the first download landing, say) must
  // not yank the dialog out from under whoever is halfway through it.
  useEffect(() => {
    if (shouldOnboard(settings, models)) setOpen(true);
  }, [settings, models]);

  const recommendations = useMemo(
    () =>
      recommendModels(models, health, intents, usage, {
        catalog,
        hfTokenSet: settings?.hf_token_set,
      }),
    [models, health, intents, usage, catalog, settings?.hf_token_set],
  );

  const missing = INTENTS.filter(
    (i) => intents.includes(i) && !recommendations.some((r) => r.intent === i),
  );

  // Every recommendation starts checked, and re-deriving on each change is
  // what keeps the picks in step with an answer changed by going Back — a
  // choice made under "personal" must not survive a switch to "commercial".
  useEffect(() => {
    setChosen(Object.fromEntries(recommendations.map((r) => [r.intent, r.model.id])));
  }, [recommendations]);

  const selectedIds = Object.values(chosen).filter((id): id is string => Boolean(id));

  /** Queue everything the answers asked for. Deliberately not awaited by the
   *  UI — see the note at the top about closing first. */
  async function runInstalls(): Promise<void> {
    for (const id of selectedIds) {
      download.mutate(id);
    }

    if (assistant && llm) {
      const pick = llm.catalog.find((m) => m.recommended) ?? llm.catalog[0];
      if (pick) {
        update.mutate({ llm_mode: "managed", llm_model: pick.id });
        if (!llm.engine.installed) {
          const job = await installLlmEngine
            .mutateAsync()
            .catch(() => null as JobRef | null);
          if (job) await awaitJob(job.job_id);
        }
        if (!pick.installed) downloadLlmModel.mutate(pick.id);
      }
    }

    if (artwork && image) {
      const pick = image.catalog.find((m) => m.id === "sd-turbo") ?? image.catalog[0];
      if (pick) {
        update.mutate({ image_mode: "managed", image_model: pick.id });
        if (!image.engine.installed) {
          const job = await installImageEngine
            .mutateAsync()
            .catch(() => null as JobRef | null);
          if (job) await awaitJob(job.job_id);
        }
        if (pick.size_bytes > 0) downloadImageModel.mutate(pick.id);
      }
    }
  }

  /** Both exits write the flag; only Finish queues anything. */
  async function close(finish: boolean) {
    setBusy(true);
    try {
      await update.mutateAsync({ onboarded_at: new Date().toISOString() });
    } catch {
      // The flag failing to save is not a reason to trap someone in the
      // wizard — the worst case is that it opens once more.
    }
    setBusy(false);
    setOpen(false);
    if (!finish) return;
    void runInstalls();
    if (selectedIds.length || assistant || artwork) {
      toast.success("Downloading in the background", {
        description: "Track progress on the Models page.",
        action: { label: "Models", onClick: () => navigate("/models") },
      });
    }
  }

  // Only the first step can block: every later one has a valid default, and
  // a disabled Next with nothing saying why is worse than a step someone
  // clicks straight through.
  const canAdvance = step > 0 || intents.length > 0;

  return (
    <Dialog
      open={open}
      // No dismissal by escape or backdrop: the two ways out are Skip and
      // Finish, and both have to write the flag or this reopens on the next
      // navigation looking like a bug.
      onOpenChange={(next) => {
        if (!next) void close(false);
      }}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Set up Konchi</DialogTitle>
          <DialogDescription>
            Four questions, then it downloads in the background.
          </DialogDescription>
        </DialogHeader>

        {/* Step rail. A count ("2 of 4") would say the same thing in less
            space, but the labels are what make Back a safe-looking click. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STEPS.map((label, i) => (
            <span
              key={label}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs",
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          ))}
        </div>

        <div className="min-h-64 py-1">
          {step === 0 && <StepIntent value={intents} onChange={setIntents} />}
          {step === 1 && <StepUsage value={usage} onChange={setUsage} />}
          {step === 2 && (
            <StepModels
              recommendations={recommendations}
              missing={missing}
              chosen={chosen}
              health={health}
              onToggle={(intent, on) =>
                setChosen((prev) => ({
                  ...prev,
                  [intent]: on
                    ? (recommendations.find((r) => r.intent === intent)?.model.id ?? null)
                    : null,
                }))
              }
              onSwap={(intent, id) => setChosen((prev) => ({ ...prev, [intent]: id }))}
            />
          )}
          {step === 3 && (
            <StepExtras
              llm={llm}
              image={image}
              assistant={assistant}
              artwork={artwork}
              onAssistant={setAssistant}
              onArtwork={setArtwork}
            />
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" disabled={busy} onClick={() => void close(false)}>
            Skip setup
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" disabled={busy} onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button disabled={!canAdvance || busy} onClick={() => setStep(step + 1)}>
                Next
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void close(true)}>
                {selectedIds.length || assistant || artwork
                  ? "Install and start"
                  : "Start with nothing"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
