/** Mirli Cloud helpers shared by Settings, the Models page and the composer. */

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
