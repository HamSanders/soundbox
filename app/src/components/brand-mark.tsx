/**
 * The Mirli mark: the one-line M, drawn as a stroke (`lib/brand-geometry.ts`,
 * shared with the favicon and press-kit files). One colour, `currentColor`,
 * so it sits on any tile the way a Lucide icon does. `inset` pads the square
 * around the letter; `weight` is the pen width (heavier for small icons).
 */

import { MARK_WEIGHT, M_PATH, markViewBox } from "@/lib/brand-geometry";
import { cn } from "@/lib/utils";

export function BrandMark({
  inset = 0,
  weight = MARK_WEIGHT.small,
  className,
  title,
}: {
  inset?: number;
  weight?: number;
  className?: string;
  /** Omit for a decorative mark next to the wordmark. */
  title?: string;
}) {
  const box = markViewBox(inset, weight);
  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.size} ${box.size}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d={M_PATH} />
    </svg>
  );
}

/** The name, set in the display face, with the beak dot landing after it. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display inline-flex items-baseline tracking-[0.04em] uppercase", className)}>
      Mirli
      <span aria-hidden="true" className="bg-signal ml-[0.08em] size-[0.17em] shrink-0 rounded-full" />
    </span>
  );
}
