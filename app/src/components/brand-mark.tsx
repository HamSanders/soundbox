/**
 * The Mirli mark: a single capital M in the display face, drawn as a path
 * (`lib/brand-geometry.ts`, shared with the favicon and press-kit files).
 * One colour, `currentColor`, so it sits on any tile the way a Lucide icon
 * does. `inset` pads the square around the letter.
 */

import { M_PATH, markViewBox } from "@/lib/brand-geometry";
import { cn } from "@/lib/utils";

export function BrandMark({
  inset = 0,
  className,
  title,
}: {
  inset?: number;
  className?: string;
  /** Omit for a decorative mark next to the wordmark. */
  title?: string;
}) {
  const box = markViewBox(inset);
  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.size} ${box.size}`}
      fill="currentColor"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d={M_PATH} />
    </svg>
  );
}

/** The name, set in the display face. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("font-display uppercase tracking-[0.04em]", className)}>Mirli</span>;
}
