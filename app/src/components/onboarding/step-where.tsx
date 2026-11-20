/** Step 0 — where should sounds be made?
 *
 * The fork between the two setups. "On this computer" is the full app: the
 * questions after this one pick models to download. "Elsewhere" is the simple
 * setup: nothing to download, renders go to a server you run, a hosted API
 * with your own key, or any other source a feature registered (see
 * lib/setup-options.ts). "On this computer" is preselected: GPU details come
 * only from nvidia-smi, so an Apple Silicon, AMD or Intel machine reports none
 * and that says nothing about whether it can run models. Each card says
 * "suggested" only on a positive sign; the choice stays the person's, and
 * Settings can switch it. */

import { CloudIcon, CpuIcon } from "lucide-react";

import { SelectCard } from "@/components/onboarding/select-card";
import type { HealthStatus, SetupMode } from "@/lib/api";
import { setupOptions } from "@/lib/setup-options";

/** Below this, the music and speech models people come for won't run well. */
const MIN_USEFUL_VRAM_MB = 6 * 1024;

/**
 * Mark "On this computer" as suggested when the server found an NVIDIA GPU with
 * enough memory, else suggest nothing. No GPU details is not a sign either
 * way: the server learns them only from nvidia-smi, so Apple, AMD and Intel
 * graphics report nothing (and a `device` of "cpu" means only "no nvidia-smi").
 */
export function suggestedSetup(health: HealthStatus | undefined): SetupMode | null {
  const vram = health?.vram_total_mb ?? null;
  return vram !== null && vram >= MIN_USEFUL_VRAM_MB ? "full" : null;
}

export function StepWhere({
  value,
  onChange,
  health,
}: {
  value: SetupMode;
  onChange: (next: SetupMode) => void;
  health: HealthStatus | undefined;
}) {
  const vramGb = health?.vram_total_mb ? Math.round(health.vram_total_mb / 1024) : null;
  const gpu = health?.gpu_name
    ? `We found ${health.gpu_name}${vramGb ? ` with ${vramGb} GB of video memory` : ""}.`
    : "";
  const suggestion = suggestedSetup(health);
  const extra = setupOptions().map((o) => o.label);
  const elsewhere = ["a server you run", "a hosted API with your own key", ...extra];
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm leading-relaxed">
        Mirli can run models on this computer, or send each render to models that run somewhere else.{" "}
        {gpu}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectCard
          selected={value === "full"}
          onClick={() => onChange("full")}
          icon={CpuIcon}
          label={suggestion === "full" ? "On this computer (suggested)" : "On this computer"}
          hint="Free and private. Downloads models of 1 to 10 GB and needs a capable graphics card."
        />
        <SelectCard
          selected={value === "simple"}
          onClick={() => onChange("simple")}
          icon={CloudIcon}
          label={suggestion === "simple" ? "Elsewhere (suggested)" : "Elsewhere"}
          hint={`Nothing to download, works on any computer. Use ${listJoin(elsewhere)}.`}
        />
      </div>
      <p className="text-muted-foreground text-xs">You can change this any time in Settings → Setup.</p>
    </div>
  );
}

/** "a, b or c". */
function listJoin(items: string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
