/**
 * The Mirli mark: a blackbird in flight whose raised wing ends in waveform
 * bars, so the trailing feathers read as a meter. One colour,
 * `currentColor`, so it sits on any tile the way a Lucide icon does. The
 * drawing itself lives in `lib/brand-geometry.ts`, shared with the favicon
 * and press-kit files.
 *
 * `detail="small"` swaps six thin bars for four thick ones, the cut that
 * survives 16-32px (the sidebar tile, the favicon). The eye is a hole in the
 * body, not a second colour, so the mark stays single-ink.
 */

import { BEAK, BODY, VIEWBOX, WING, bars, type BrandCut } from "@/lib/brand-geometry";
import { cn } from "@/lib/utils";

export function BrandMark({
  detail = "full",
  className,
  title,
}: {
  detail?: BrandCut;
  className?: string;
  /** Omit for a decorative mark next to the wordmark. */
  title?: string;
}) {
  return (
    <svg
      viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.size} ${VIEWBOX.size}`}
      fill="currentColor"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d={BODY} fillRule="evenodd" />
      <path d={BEAK} />
      <path d={WING} />
      {bars(detail).map((b) => (
        <rect key={b.x} x={b.x} y={b.y} width={b.width} height={b.height} rx={b.rx} />
      ))}
    </svg>
  );
}

/** The name, set in the blackletter display face. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("font-display tracking-wide", className)}>Mirli</span>;
}
