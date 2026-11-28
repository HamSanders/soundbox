/** Step 3 — the picks.
 *
 * One row per intent, pre-checked, each swappable for any other model that
 * qualified. The ranking behind the pick lives in `lib/onboarding`; this file
 * only shows the result and the facts that produced it — licence, VRAM, and
 * the one-line reason — because a recommendation someone cannot audit is one
 * they have no reason to trust.
 *
 * An intent with no qualifying model is shown as an empty row rather than
 * silently dropped. It is a real answer ("nothing here can be sold, at your
 * VRAM"), and hiding it would look like the wizard forgot the question. */

import { InfoIcon } from "@/lib/icons";

import { LicenseChip } from "@/components/license-badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INTENT_LABEL, type Intent, type Recommendation } from "@/lib/onboarding";
import type { HealthStatus } from "@/lib/api";

/** What the machine is, in one line, so the VRAM talk below has a subject.
 *  Phrased as a fact rather than a warning — a CPU-only machine still runs
 *  everything here, just slower, and opening someone's first screen with a
 *  complaint about their hardware is a bad trade for the information. */
function HardwareLine({ health }: { health: HealthStatus | undefined }) {
  if (!health) return null;
  const vram = health.vram_total_mb;
  const gpu = health.gpu_name;
  const text =
    gpu && vram
      ? `${gpu} · ${Math.round(vram / 1024)} GB VRAM — picks are sized to fit it.`
      : `Running on ${health.device.toUpperCase()} — picks are sized for the lightest option.`;
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <InfoIcon className="size-3.5 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

export function StepModels({
  recommendations,
  missing,
  chosen,
  onToggle,
  onSwap,
  health,
}: {
  recommendations: Recommendation[];
  /** Intents that produced no qualifying model at all. */
  missing: Intent[];
  /** Model id per intent, or null for a row switched off. */
  chosen: Record<string, string | null>;
  onToggle: (intent: Intent, on: boolean) => void;
  onSwap: (intent: Intent, modelId: string) => void;
  health: HealthStatus | undefined;
}) {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm leading-relaxed">
        One model each, chosen for your licence answer and your hardware. They
        download in the background — you can close this and start looking around.
      </p>
      <HardwareLine health={health} />

      <div className="space-y-3">
        {recommendations.map((rec) => {
          const options = [rec.model, ...rec.alternatives];
          const selectedId = chosen[rec.intent];
          const on = selectedId !== null && selectedId !== undefined;
          const current = options.find((m) => m.id === selectedId) ?? rec.model;
          return (
            <div key={rec.intent} className="border-border rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-muted-foreground label-caps">
                    {INTENT_LABEL[rec.intent]}
                  </p>
                  <p className="truncate text-sm font-medium">{current.name}</p>
                  <p className="text-muted-foreground text-xs leading-snug">
                    {selectedId === rec.model.id
                      ? rec.reason
                      : current.description}
                  </p>
                </div>
                <Switch
                  checked={on}
                  onCheckedChange={(next) => onToggle(rec.intent, next)}
                  aria-label={`Install a ${INTENT_LABEL[rec.intent].toLowerCase()} model`}
                />
              </div>

              {on && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <LicenseChip license={current.license} />
                  <span className="text-muted-foreground text-xs">
                    {current.vendor}
                    {current.vram_estimate_mb
                      ? ` · ~${Math.round(current.vram_estimate_mb / 1000)} GB VRAM`
                      : ""}
                  </span>
                  {options.length > 1 && (
                    <Select
                      value={current.id}
                      onValueChange={(id) => onSwap(rec.intent, id)}
                    >
                      <SelectTrigger className="ml-auto h-8 w-48 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((m) => (
                          <SelectItem key={m.id} value={m.id} className="text-xs">
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {missing.map((intent) => (
          <div
            key={intent}
            className="border-border text-muted-foreground rounded-xl border border-dashed p-4 text-xs leading-relaxed"
          >
            <span className="text-foreground text-sm font-medium">
              {INTENT_LABEL[intent]}
            </span>
            <br />
            Nothing in the catalog fits that answer right now. The Models page
            lists everything, with its licence.
          </div>
        ))}
      </div>
    </div>
  );
}
