/**
 * The faint animated texture behind a section, instead of flat black.
 *
 * Purely decoration, and it has to stay that way: the reveals in front of it
 * are the content, and a background that competes with them is worse than no
 * background at all. Hence the very low opacity, the mask that fades it out
 * top and bottom, and the slow speeds — a minute or more per pass for anything
 * that travels, which reads as drift rather than as something moving.
 *
 * **One layer, not two.** The first version stacked two waves at different
 * speeds for parallax. Two layers of the same motif is depth you have to look
 * for, and looking is exactly what a background should not ask for; the cost
 * was double the nodes and double the composited area on a page that already
 * runs scroll maths. What replaced it is variety *between* sections rather
 * than within one — see `BackdropVariant`. The page now reads as one texture
 * system in four registers rather than the same wave five times.
 *
 * The drifting variants (`waveform`, `halftone`) are built from generators in
 * `lib/studio-scene` that tile seamlessly, so the element holds two copies of
 * the pattern side by side and slides exactly half its own width forever. That
 * is what makes the loop invisible; see the keyframes in `index.css` for why
 * it is `translate3d`. The in-place variants (`eq`, `rings`) have no tiling to
 * preserve — their loop is per element, in CSS.
 */

import { laneColor } from "@/lib/lanes";
import { ambientPeaks, eqColumns, halftoneField } from "@/lib/studio-scene";
import { cn } from "@/lib/utils";

/**
 * Which texture a section gets.
 *
 * Named after what they look like rather than numbered, so a page can say what
 * it wants and a reordering of the sections does not silently reshuffle the
 * backgrounds.
 */
export type BackdropVariant = "waveform" | "eq" | "halftone" | "rings";

/** The cycle a caller gets if it does not name a variant. Waveform first
 *  because it is the one the product's own UI actually shows. */
const VARIANT_CYCLE: BackdropVariant[] = ["waveform", "eq", "halftone", "rings"];

/** Pick a variant from a seed, so sections that never opt in still differ from
 *  their neighbours. Sum of char codes rather than the PRNG: it is stable, and
 *  two adjacent sections with names as similar as `studio` / `stories` still
 *  land on different variants, which a hash would not guarantee. */
function variantFor(seed: string): BackdropVariant {
  let n = 0;
  for (let i = 0; i < seed.length; i++) n += seed.charCodeAt(i);
  return VARIANT_CYCLE[n % VARIANT_CYCLE.length];
}

/**
 * How visible each texture is, before the edge mask takes another bite.
 *
 * Down from 0.075 + 0.045 on two stacked layers. At those values the bars were
 * legible enough to streak behind the surfaces in front of them and pull the
 * eye off body copy; this is the level where you notice the section is not
 * flat but cannot resolve the pattern without deciding to.
 *
 * Per variant rather than one number, because "as visible as the waveform"
 * is not the same alpha for every shape: the bar variants cover a large
 * fraction of their band, while `rings` is five hairlines over a huge area and
 * disappears entirely at the same value. Matched by eye, not by coverage
 * maths — the goal is that no section looks louder than its neighbours.
 */
const OPACITY: Record<BackdropVariant, number> = {
  waveform: 0.045,
  eq: 0.05,
  halftone: 0.055,
  rings: 0.13,
};

/** Bars per waveform tile. Enough to read as a waveform at full width. */
const BARS = 120;
/** Halftone grid per tile. 30 × 8 doubled is ~480 nodes, in the same order as
 *  the waveform's 240 rects — the whole page stays near the node budget the
 *  two-layer version set. */
const DOT_COLS = 30;
const DOT_ROWS = 8;
/** Spectrum columns. Fewer than the waveform's bars on purpose: each one is a
 *  separately animated DOM node, and a meter reads as a meter at this density
 *  while 120 of them would read as a waveform again. */
const EQ_COLS = 56;

/** Two copies end to end. The element is 200% wide and slides -50%, so the
 *  second copy is exactly where the first was when the animation restarts. */
function Drift({
  durationS,
  reverse,
  top,
  height,
  children,
}: {
  durationS: number;
  reverse?: boolean;
  /** Fractions of the container, 0 = top, 1 = bottom. */
  top: number;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="konchi-wave-drift absolute flex w-[200%]"
      style={{
        top: `${top * 100}%`,
        height: `${height * 100}%`,
        // Consumed by the keyframes in index.css.
        ["--wave-duration" as string]: `${durationS}s`,
        animationDirection: reverse ? "reverse" : undefined,
      }}
    >
      {children}
      {children}
    </div>
  );
}

function WaveformTexture({ seed, lane }: { seed: string; lane: number }) {
  const peaks = ambientPeaks(seed, BARS);
  return (
    <Drift durationS={140} top={0.14} height={0.55}>
      <svg
        className="h-full w-1/2 shrink-0"
        viewBox={`0 0 ${BARS} 100`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {peaks.map((peak, i) => (
          <rect
            key={i}
            x={i + 0.2}
            y={50 - peak * 48}
            width={0.6}
            height={peak * 96}
            fill={laneColor(lane, 1)}
          />
        ))}
      </svg>
    </Drift>
  );
}

function HalftoneTexture({ seed, lane }: { seed: string; lane: number }) {
  const field = halftoneField(seed, DOT_COLS, DOT_ROWS);
  // Reversed and slower than the waveform so two adjacent sections that happen
  // to be halftone and waveform do not appear to be sliding in convoy.
  return (
    <Drift durationS={210} top={0.1} height={0.8} reverse>
      <svg
        className="h-full w-1/2 shrink-0"
        viewBox={`0 0 ${DOT_COLS} ${DOT_ROWS}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {field.map((row, r) =>
          row.map((radius, c) => (
            <circle
              key={`${r}-${c}`}
              cx={c + 0.5}
              cy={r + 0.5}
              // Capped below 0.5 so the densest dots still have air around
              // them; a halftone whose dark end merges into a solid field is
              // just a gradient, and the dot grid is the whole point.
              r={radius * 0.42}
              fill={laneColor(lane, 1)}
            />
          )),
        )}
      </svg>
    </Drift>
  );
}

function EqTexture({ seed, lane }: { seed: string; lane: number }) {
  const columns = eqColumns(seed, EQ_COLS);
  return (
    <div className="absolute inset-x-0 top-[22%] flex h-[56%] items-center gap-[0.35%]">
      {columns.map((col, i) => (
        <div key={i} className="h-full flex-1" style={{ height: `${col.level * 100}%` }}>
          {/* The scaling element is a child of the one that sets the height:
              the parent owns the seeded resting level, the child owns only the
              transform, so the animation never has to know about layout. */}
          <div
            className="konchi-eq-pulse h-full w-full rounded-[1px]"
            style={{
              background: `linear-gradient(to top, ${laneColor(lane, 1)}, ${laneColor(lane + 2, 0.15)})`,
              ["--eq-duration" as string]: `${col.duration}s`,
              // Shorter columns swing proportionally further, which is what a
              // real meter does — the quiet bands are where the movement is.
              ["--eq-low" as string]: `${0.3 + col.level * 0.35}`,
              animationDelay: `${col.delay}s`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Concentric rings opening out of the middle of the section — the quietest of
 *  the four, and five DOM nodes rather than hundreds. Deliberately kept as the
 *  variant that lands under the densest reveals. */
function RingsTexture({ lane }: { lane: number }) {
  const RINGS = 5;
  const period = 26;
  return (
    <div className="absolute top-1/2 left-1/2 size-[52rem] -translate-x-1/2 -translate-y-1/2">
      {Array.from({ length: RINGS }, (_, i) => (
        <div
          key={i}
          className="konchi-ring-pulse absolute inset-0 rounded-full border"
          style={{
            borderColor: laneColor(lane + (i % 2) * 2, 1),
            ["--ring-duration" as string]: `${period}s`,
            // Evenly spaced negative delays: the ring that is halfway out
            // started half a period ago, so the sequence is already running at
            // first paint rather than all five expanding out of nothing.
            animationDelay: `${(-period / RINGS) * i}s`,
          }}
        />
      ))}
    </div>
  );
}

export function WaveBackdrop({
  seed,
  lane = 0,
  variant,
  className,
}: {
  /** Makes each section's texture its own pattern rather than the same one
   *  repeated down the page. */
  seed: string;
  /** Base hue, so the texture is in the same palette as everything else. */
  lane?: number;
  /** Which texture to draw. Left off, it is derived from the seed — a page
   *  that has not been art-directed still gets variety rather than a column of
   *  identical waves. */
  variant?: BackdropVariant;
  className?: string;
}) {
  const kind = variant ?? variantFor(seed);

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden="true"
    >
      {/* Fades the texture out at the top and bottom edges so it belongs to
          the page rather than stopping at a hard line against the next
          section's border. Opacity lives here too, on the one element, so the
          variants only ever describe shape. */}
      <div
        className="absolute inset-0"
        style={{
          opacity: OPACITY[kind],
          maskImage:
            "linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)",
        }}
      >
        {kind === "waveform" && <WaveformTexture seed={seed} lane={lane} />}
        {kind === "halftone" && <HalftoneTexture seed={seed} lane={lane} />}
        {kind === "eq" && <EqTexture seed={seed} lane={lane} />}
        {kind === "rings" && <RingsTexture lane={lane} />}
      </div>

      {/* A soft wash so the section is not flat black behind the texture
          either — the same trick the hero already uses for its headline. */}
      <div className="bg-primary/[0.035] absolute top-1/2 left-1/2 size-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl" />
    </div>
  );
}
