/**
 * The Konchi mark: one stroke, a shell spiral whose outer lip runs out as a
 * short wave packet (see docs/konchi-brand.md, "Conch" direction).
 *
 * Two cuts of the same curve. `full` carries the wave tail and is for the
 * header lockup and anywhere the mark is 24px tall or more. `icon` drops the
 * tail and keeps only the spiral, for square slots — the sidebar tile, the
 * favicon — where the tail would shrink to noise.
 *
 * The paths are precomputed (a logarithmic spiral, r = e^(0.2θ), rotated so
 * its exit runs level, then a sine packet under a sin·(1−s)^0.4 envelope) so
 * this costs one <path> and no maths at render time. The spiral is left open
 * and unchambered on purpose, so it does not read as the Nautilus mark.
 *
 * Colour comes from `currentColor`; callers pick `text-shell` (brand) or
 * `text-primary` (live: the mark while something is rendering).
 */

import { cn } from "@/lib/utils";

const FULL = {
  w: 47.45,
  d: "M9.42 5.06L9.17 5.06L8.92 5.09L8.66 5.15L8.41 5.24L8.16 5.36L7.93 5.52L7.71 5.71L7.51 5.93L7.33 6.17L7.18 6.44L7.06 6.74L6.98 7.05L6.93 7.39L6.92 7.73L6.96 8.08L7.04 8.43L7.16 8.77L7.32 9.11L7.54 9.43L7.79 9.74L8.08 10.01L8.42 10.26L8.79 10.47L9.19 10.63L9.62 10.75L10.07 10.82L10.54 10.84L11.01 10.79L11.49 10.69L11.97 10.53L12.43 10.31L12.88 10.03L13.29 9.68L13.68 9.28L14.01 8.83L14.30 8.33L14.54 7.78L14.71 7.20L14.81 6.58L14.84 5.95L14.79 5.29L14.66 4.64L14.44 3.99L14.15 3.35L13.77 2.74L13.30 2.16L12.76 1.64L12.15 1.17L11.47 0.76L10.73 0.44L9.93 0.19L9.09 0.05L8.22 0.00L7.33 0.06L6.43 0.23L5.54 0.51L4.66 0.91L3.82 1.42L3.03 2.04L2.30 2.77L1.65 3.60L1.09 4.53L0.63 5.53L0.29 6.62L0.08 7.76L0.00 8.95L0.07 10.17L0.28 11.40L0.66 12.62L1.19 13.82L1.87 14.98L2.71 16.07L3.69 17.08L4.82 17.98L6.08 18.76L7.45 19.40L8.92 19.88L10.48 20.19L12.10 20.31L12.33 20.31L12.83 20.21L13.33 19.95L13.83 19.68L14.33 19.53L14.83 19.66L15.34 20.09L15.84 20.76L16.34 21.49L16.84 22.06L17.34 22.25L17.84 21.94L18.35 21.13L18.85 19.98L19.35 18.78L19.85 17.83L20.35 17.43L20.86 17.73L21.36 18.71L21.86 20.17L22.36 21.76L22.86 23.07L23.36 23.77L23.87 23.65L24.37 22.70L24.87 21.13L25.37 19.33L25.87 17.72L26.37 16.73L26.88 16.59L27.38 17.35L27.88 18.83L28.38 20.65L28.88 22.38L29.39 23.59L29.89 24.00L30.39 23.52L30.89 22.29L31.39 20.63L31.89 18.96L32.40 17.67L32.90 17.07L33.40 17.27L33.90 18.16L34.40 19.51L34.91 20.96L35.41 22.15L35.91 22.82L36.41 22.85L36.91 22.28L37.41 21.31L37.92 20.22L38.42 19.27L38.92 18.68L39.42 18.54L39.92 18.84L40.42 19.43L40.93 20.13L41.43 20.75L41.93 21.14L42.43 21.26L42.93 21.13L43.44 20.83L43.94 20.50L44.44 20.23L44.94 20.08L45.44 20.06L45.94 20.13L46.45 20.23L46.95 20.30L47.45 20.31",
};

const ICON = {
  w: 17.53,
  d: "M11.13 5.98L10.83 5.98L10.53 6.01L10.23 6.08L9.93 6.19L9.64 6.34L9.37 6.52L9.11 6.74L8.87 7.00L8.66 7.29L8.48 7.61L8.34 7.96L8.24 8.33L8.19 8.73L8.18 9.13L8.22 9.54L8.31 9.95L8.46 10.36L8.65 10.76L8.90 11.14L9.20 11.50L9.55 11.83L9.95 12.12L10.38 12.36L10.86 12.56L11.36 12.70L11.90 12.78L12.45 12.80L13.01 12.75L13.58 12.63L14.14 12.44L14.69 12.18L15.21 11.85L15.70 11.44L16.16 10.97L16.56 10.43L16.90 9.84L17.18 9.20L17.38 8.51L17.50 7.78L17.53 7.03L17.47 6.26L17.32 5.48L17.06 4.71L16.71 3.96L16.26 3.24L15.72 2.56L15.08 1.93L14.35 1.38L13.55 0.90L12.67 0.51L11.73 0.23L10.74 0.06L9.71 0.00L8.66 0.07L7.60 0.27L6.54 0.60L5.51 1.07L4.52 1.67L3.58 2.41L2.72 3.27L1.95 4.25L1.29 5.35L0.75 6.54L0.34 7.82L0.09 9.17L0.00 10.57L0.08 12.01L0.34 13.47L0.78 14.91L1.40 16.33L2.21 17.70L3.20 18.99L4.36 20.17L5.70 21.24L7.18 22.16L8.80 22.92L10.54 23.49L12.38 23.85L14.30 24.00L14.56 24.00",
};

export function KonchiMark({
  variant = "full",
  className,
  strokeWidth,
  title,
}: {
  variant?: "full" | "icon";
  className?: string;
  /** In viewBox units (the mark is 24 tall). Thicker for the small cuts. */
  strokeWidth?: number;
  /** Set when the mark stands alone; leave unset beside a visible wordmark. */
  title?: string;
}) {
  const m = variant === "full" ? FULL : ICON;
  const sw = strokeWidth ?? (variant === "full" ? 2 : 2.4);
  const pad = sw / 2 + 0.5;
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${m.w + pad * 2} ${24 + pad * 2}`}
      className={cn("h-6 w-auto", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path
        d={m.d}
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
