/** Step 0, only when Mirli Cloud is on — where should sounds be made?
 *
 * The fork for people without a GPU that can run the models. Picking the
 * cloud skips every question after this one that is about this machine
 * (which models to download, which engines to install) and turns on the
 * simple setup. The suggestion comes from the GPU the server detected; the
 * choice stays theirs, and Settings can switch it later. */

import { CloudIcon, CpuIcon } from "lucide-react";

import { SelectCard } from "@/components/onboarding/select-card";
import type { HealthStatus, RunMode } from "@/lib/api";
import { suggestedRunMode } from "@/lib/cloud";

export function StepWhere({
  value,
  onChange,
  health,
}: {
  value: RunMode;
  onChange: (next: RunMode) => void;
  health: HealthStatus | undefined;
}) {
  const vramGb = health?.vram_total_mb ? Math.round(health.vram_total_mb / 1024) : null;
  const gpu = health?.gpu_name
    ? `We found ${health.gpu_name}${vramGb ? ` with ${vramGb} GB of video memory` : ""}.`
    : "We didn't find a graphics card Mirli can use.";
  const suggestion = suggestedRunMode(health);
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm leading-relaxed">
        Mirli can make sounds on this computer, or on Mirli Cloud if your computer isn't up to it. {gpu}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectCard
          selected={value === "local"}
          onClick={() => onChange("local")}
          icon={CpuIcon}
          label={suggestion === "local" ? "On this computer (suggested)" : "On this computer"}
          hint="Free and private. Downloads models of 1 to 10 GB and needs a capable graphics card."
        />
        <SelectCard
          selected={value === "cloud"}
          onClick={() => onChange("cloud")}
          icon={CloudIcon}
          label={suggestion === "cloud" ? "On Mirli Cloud (suggested)" : "On Mirli Cloud"}
          hint="Nothing to download, works on any computer. Pay as you go with credits; a sound effect is about 3¢."
        />
      </div>
      <p className="text-muted-foreground text-xs">You can change this any time in Settings.</p>
    </div>
  );
}
