/**
 * What happens between a prompt and a WAV, drawn as the path it takes.
 *
 * An island rather than a diagram file: the stages are the real ones, the
 * labels come from the same vocabulary the server's job phases use
 * (`queued → loading → generating → encoding → done`), and hovering or
 * focusing a stage says what it does. When a stage is "running" the pulse
 * travels the wire, so the picture shows the *order* of things rather than
 * just their names.
 *
 * It animates by itself because this is the first thing on the page and a
 * still diagram of a pipeline does not read as a pipeline. It stops for
 * `prefers-reduced-motion`, keeping the highlight and dropping the travel —
 * the same bargain the app's own "being read" outline makes.
 */

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface Stage {
  id: string;
  label: string;
  detail: string;
}

const STAGES: Stage[] = [
  {
    id: "prompt",
    label: "Prompt",
    detail:
      "Words, a duration and a seed. Nothing has been loaded yet. The request is queued against the model you picked.",
  },
  {
    id: "binary",
    label: "audio.cpp",
    detail:
      "One native binary, chosen for your machine: CUDA, HIP, Vulkan, Metal or CPU. There is no Python environment and nothing to compile.",
  },
  {
    id: "weights",
    label: "Weights",
    detail:
      "A GGUF file on your disk, memory-mapped. It is downloaded once and reused, so the same seed on the same file reproduces a take.",
  },
  {
    id: "samples",
    label: "Samples",
    detail:
      "Float audio out of the model, at the rate it was trained on: 44.1 kHz stereo for Stable Audio, 48 kHz for ACE-Step.",
  },
  {
    id: "wav",
    label: "WAV",
    detail:
      "Peaks are measured, loudness is checked, and the file is written into your library. From there you can drag it onto a timeline.",
  },
];

export function SignalChain() {
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState<number | null>(null);

  // Walks by itself; a pointer or the keyboard takes over while it is on a
  // stage, because a diagram that keeps moving under your finger is one you
  // cannot read.
  useEffect(() => {
    if (pinned !== null) return;
    const timer = setInterval(() => setActive((i) => (i + 1) % STAGES.length), 1800);
    return () => clearInterval(timer);
  }, [pinned]);

  const shown = pinned ?? active;

  return (
    <figure className="border-border/70 bg-card/40 rounded-2xl border p-4 sm:p-6">
      <figcaption className="label-caps text-muted-foreground mb-4">
        A generation, end to end
      </figcaption>

      <ol className="flex flex-wrap items-stretch gap-2 sm:flex-nowrap">
        {STAGES.map((stage, i) => (
          <li key={stage.id} className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              aria-pressed={i === shown}
              aria-describedby="signal-chain-detail"
              onMouseEnter={() => setPinned(i)}
              onMouseLeave={() => setPinned(null)}
              onFocus={() => setPinned(i)}
              onBlur={() => setPinned(null)}
              onClick={() => setPinned(i)}
              className={cn(
                "focus-visible:ring-ring/50 w-full rounded-xl border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-3",
                i === shown
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/60 text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="block text-[11px] tabular-nums opacity-60">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="block truncate text-sm font-medium">{stage.label}</span>
            </button>

            {/* The wire to the next stage. Hidden on the last one, and on a
                narrow screen where the stages wrap into a column. */}
            {i < STAGES.length - 1 && (
              <span
                aria-hidden="true"
                className="bg-border relative hidden h-px w-6 shrink-0 sm:block"
              >
                <span
                  className={cn(
                    "bg-primary absolute inset-y-0 left-0 w-2 rounded-full transition-transform duration-500",
                    i < shown ? "translate-x-4" : "translate-x-0 opacity-0",
                    "motion-reduce:transition-none",
                  )}
                />
              </span>
            )}
          </li>
        ))}
      </ol>

      <p
        id="signal-chain-detail"
        className="text-muted-foreground mt-4 min-h-[3.5rem] text-sm leading-relaxed"
      >
        <span className="text-foreground font-medium">{STAGES[shown].label}. </span>
        {STAGES[shown].detail}
      </p>
    </figure>
  );
}
