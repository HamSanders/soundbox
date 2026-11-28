/** Step 2 — will you sell what you make?
 *
 * Asked once here so it never has to be asked again per download. Roughly a
 * third of the catalog is non-commercial, and the difference between a model
 * you can ship and one you cannot is the single most consequential fact about
 * a pick — see `components/license-badge`. Answering "commercial" removes
 * those models from the recommendations entirely rather than ranking them
 * down: a wall is not a preference.
 *
 * Nothing is locked in by the answer. Every model stays installable from the
 * Models page, behind the same say-it-out-loud confirmation it has always
 * had. */

import { BriefcaseIcon, FlaskConicalIcon } from "@/lib/icons";

import { SelectCard } from "@/components/onboarding/select-card";
import type { Usage } from "@/lib/onboarding";

export function StepUsage({
  value,
  onChange,
}: {
  value: Usage;
  onChange: (next: Usage) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm leading-relaxed">
        Models here come with different licences — some of them forbid selling
        what they produce. Tell us once and we will only recommend models that
        fit.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectCard
          selected={value === "personal"}
          onClick={() => onChange("personal")}
          icon={FlaskConicalIcon}
          label="Personal projects"
          hint="Learning, experiments, things you are not selling. Every model is on the table."
        />
        <SelectCard
          selected={value === "commercial"}
          onClick={() => onChange("commercial")}
          icon={BriefcaseIcon}
          label="Something I'll sell or ship"
          hint="A game, a client's video, anything commercial. We will skip the models that forbid it."
        />
      </div>
      <p className="text-muted-foreground text-xs">
        This only steers what we suggest — you can still install anything from the
        Models page later.
      </p>
    </div>
  );
}
