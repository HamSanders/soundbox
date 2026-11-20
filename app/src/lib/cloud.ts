/** Mirli Cloud helpers shared by Settings, the Models page and the composer. */

import type { HealthStatus, Model, RunMode } from "@/lib/api";

/** Below this, the music and speech models people come for won't run well. */
const MIN_USEFUL_VRAM_MB = 6 * 1024;

/** First-run suggestion: this computer if its GPU can run the models, else Mirli Cloud. */
export function suggestedRunMode(health: HealthStatus | undefined): RunMode {
  const vram = health?.vram_total_mb ?? null;
  return vram !== null && vram >= MIN_USEFUL_VRAM_MB ? "local" : "cloud";
}

/**
 * What the pickers offer. On a local setup, everything. In cloud mode (the
 * simple setup for people without a usable GPU), Mirli Cloud models plus
 * whatever is already ready on this machine: a list of downloads someone
 * chose not to do is noise there.
 */
export function pickerModels<T extends Model>(models: readonly T[], runMode: RunMode | undefined): T[] {
  if (runMode !== "cloud") return [...models];
  return models.filter(
    (m) => m.provider === "cloud" || m.provider === "endpoint" || m.status === "installed" || m.status === "loaded",
  );
}

/** "≈ 15 credits", or the per-unit price when there's no length to multiply by. */
export function cloudPriceLabel(
  price: { unit: string; credits_per_unit: number; min_credits: number },
  durationS?: number | null,
): string {
  if (price.unit === "render") return `${price.credits_per_unit} credits`;
  if (durationS && (price.unit === "minute" || price.unit === "10s")) {
    const per = price.unit === "minute" ? 60 : 10;
    const n = Math.max(price.min_credits, Math.ceil(durationS / per) * price.credits_per_unit);
    return `≈ ${n} credits`;
  }
  const unit = { minute: "minute", "10s": "10 s", "1k_chars": "1,000 characters" }[price.unit] ?? price.unit;
  return `${price.credits_per_unit} credits / ${unit}`;
}

/** "1 credit", "1,250 credits". */
export function creditsLabel(n: number): string {
  return `${n.toLocaleString()} credit${n === 1 ? "" : "s"}`;
}
