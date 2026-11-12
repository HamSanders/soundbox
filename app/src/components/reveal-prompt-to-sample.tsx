/**
 * Prompt → sample, revealed a phase at a time as you scroll.
 *
 * The claim this section has to land is that a sentence becomes a file on
 * your disk, locally, with nothing hidden in between. A paragraph asserting
 * that reads like every other generative-audio pitch. Watching the phases go
 * past — and watching the waveform actually draw itself during `generating`
 * rather than appearing finished — is the version of the claim that shows its
 * working.
 *
 * The phase names are the server's own (`JobPhase` in `server/src/schemas.ts`:
 * queued → installing → loading → downloading → generating → encoding →
 * done). `installing` and `downloading` are dropped here because they only
 * happen on a first run, and a sequence that shows them every time would be
 * describing an unusual case as if it were the normal one.
 *
 * Nothing is generated and nothing is played. It is a drawing of a job, built
 * from the same `lib/studio-scene` peak generator the timeline banner uses so
 * the waveform that lands here is the same kind of shape as the ones on the
 * timeline further down the page.
 */

import { CheckIcon, Loader2Icon } from "lucide-react";

import { ScrollStage, type StageStep } from "@/components/scroll-stage";
import { WindowChrome } from "@/components/window-chrome";
import { laneColor } from "@/lib/lanes";
import { resultPeaksFor } from "@/lib/studio-scene";
import { cn } from "@/lib/utils";

/** The prompt being made. The README's own example, in the material / action /
 *  space shape the prompting section teaches. */
const PROMPT = "heavy wooden door slamming in a stone corridor";
const DURATION_S = 3;
const MODEL = "audiocpp-stable-audio-3-sfx";
const SEED = 47_218;
const STEPS_TAKEN = 8;

/** One entry per scroll step. `title` doubles as the pill on the phase rail,
 *  so the words beside the panel and the words inside it cannot drift apart.
 *  Step 0 is writing the prompt — not a job phase at all, which is the point:
 *  the job does not exist until you have said what you want. */
const PHASES: StageStep[] = [
  {
    title: "Write it",
    detail:
      "Name a material, an action and a space. These models were trained on captions of recordings and respond to that shape. A prompt like “scary sound” gives you noise.",
  },
  {
    title: "loading",
    detail:
      "The GGUF weights are memory-mapped off your disk. They download once and are reused on every run after, which is why the same seed reproduces the same take.",
  },
  {
    title: "generating",
    detail:
      "audio.cpp runs the diffusion steps on whichever backend it picked for your machine: CUDA, HIP, Metal, Vulkan or CPU. No Python in the inference path.",
  },
  {
    title: "encoding",
    detail:
      "Float samples out of the model become a WAV. Peaks are measured now so the library can draw this clip without decoding it again.",
  },
  {
    title: "done",
    detail:
      "A file in your library, with the prompt, the seed and the settings kept beside it. Nothing was uploaded, and nothing is billed per second.",
  },
];

const PEAKS = resultPeaksFor("door-slam-reveal", "impact", DURATION_S);

/** Which phase index the waveform starts drawing at. */
const GENERATING = 2;

function PhaseRail({ step, select }: { step: number; select: (i: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {PHASES.map((phase, i) => {
        const state = i < step ? "past" : i === step ? "current" : "future";
        return (
          <li key={phase.title} className="flex items-center gap-1.5">
            {/* The rail is the control, not a decoration with buttons added
                beside it: a reader who wants to see the waveform draw should
                be able to click `generating` and go there, the same way they
                would click a phase in the app's own job view. */}
            <button
              type="button"
              onClick={() => select(i)}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "focus-visible:ring-ring/50 inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] outline-none focus-visible:ring-2",
                "transition-colors duration-300 motion-reduce:transition-none",
                state === "current" && "border-primary/60 bg-primary/10 text-foreground",
                state === "past" && "border-border/60 text-muted-foreground hover:text-foreground",
                state === "future" &&
                  "border-border/40 text-muted-foreground/40 hover:text-muted-foreground",
              )}
            >
              {state === "past" ? (
                <CheckIcon className="size-3 shrink-0" aria-hidden="true" />
              ) : state === "current" && i > 0 && i < PHASES.length - 1 ? (
                <Loader2Icon className="size-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : null}
              {phase.title}
            </button>
            {i < PHASES.length - 1 && (
              <span className="bg-border/60 hidden h-px w-3 shrink-0 sm:block" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function RevealPromptToSample() {
  return (
    <ScrollStage
      id="make"
      eyebrow="Prompt to sample"
      title="A sentence, and then a file on your disk"
      intro="Nothing is uploaded and nothing is billed per second. Scroll to follow one generation through the phases the server reports."
      steps={PHASES}
      layout="text-left"
      lane={0}
    >
      {(progress, step, select) => {
        // How far through the `generating` step we are, 0..1 — what the
        // waveform draws against. Each step occupies `1 / PHASES.length` of
        // the whole stage, so this rescales that slice back to a full range.
        const slice = 1 / PHASES.length;
        const genProgress = Math.min(1, Math.max(0, (progress - GENERATING * slice) / slice));
        // Past `generating` the clip is simply finished — the bars must not
        // fall back to a partial draw once the phase rail has moved on.
        const drawn = step > GENERATING ? PEAKS.length : Math.round(PEAKS.length * genProgress);
        const done = step === PHASES.length - 1;

        return (
          <figure className="border-border/60 bg-card/80 overflow-hidden rounded-xl border shadow-sm">
            <WindowChrome label="Generate: one prompt, one file" />

            <div className="p-4 sm:p-5">
              {/* The prompt. Present from the first step, because it is the
                  thing everything else is downstream of. */}
              <div className="bg-background/60 ring-border/60 rounded-lg px-3 py-2.5 ring-1">
                <p className="label-caps text-muted-foreground">
                  Prompt
                </p>
                <p className="mt-1 font-mono text-sm leading-relaxed">
                  {PROMPT}
                  {step === 0 && (
                    <span
                      className="bg-primary ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  )}
                </p>
                <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
                  <span>duration_s: {DURATION_S}</span>
                  <span>steps: {STEPS_TAKEN}</span>
                  <span
                    className={cn(
                      "transition-opacity duration-300 motion-reduce:transition-none",
                      step >= 1 ? "opacity-100" : "opacity-0",
                    )}
                  >
                    seed: {SEED}
                  </span>
                </div>
              </div>

              <div className="mt-4">
                <PhaseRail step={step} select={select} />
              </div>

              {/* The result. An empty, ruled box until `generating` starts
                  filling it — the waiting is part of what is being shown. */}
              <div className="border-border/50 bg-background/40 relative mt-4 h-24 overflow-hidden rounded-lg border">
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox={`0 0 ${PEAKS.length} 100`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {PEAKS.slice(0, drawn).map((peak, i) => (
                    <rect
                      key={i}
                      x={i + 0.15}
                      y={50 - peak * 44}
                      width={0.7}
                      height={peak * 88}
                      rx={0.3}
                      fill={laneColor(2, done ? 0.9 : 0.7)}
                    />
                  ))}
                </svg>

                {step < GENERATING && (
                  <p className="text-muted-foreground/50 absolute inset-0 flex items-center justify-center text-xs">
                    {step === 0 ? "nothing generated yet" : "weights loaded, ready"}
                  </p>
                )}

                {/* The write head, riding the leading edge of the draw. */}
                {step === GENERATING && drawn > 0 && drawn < PEAKS.length && (
                  <span
                    className="bg-primary pointer-events-none absolute inset-y-0 w-px"
                    style={{ left: `${(drawn / PEAKS.length) * 100}%` }}
                    aria-hidden="true"
                  />
                )}
              </div>

              {/* What you end up with. Appears only once there is something to
                  describe. */}
              <div
                className={cn(
                  "mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] transition-opacity duration-500",
                  "motion-reduce:transition-none",
                  done ? "text-muted-foreground opacity-100" : "opacity-0",
                )}
              >
                <span className="text-foreground">door-slam-stone-corridor.wav</span>
                <span>{MODEL}</span>
                <span>44.1 kHz · stereo</span>
                <span>{DURATION_S}.0s</span>
              </div>

            </div>
          </figure>
        );
      }}
    </ScrollStage>
  );
}
