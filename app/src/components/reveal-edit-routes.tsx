/**
 * What you can do to a clip once you have one — extend, cover, repaint,
 * separate — drawn as what each one does to the same waveform.
 *
 * These are the audio-to-audio routes and the separation task mode from
 * `docs/AUDIOCPP.md`, and they are the least self-evident thing Konchi
 * does. "Cover" and "repaint" are words a reader either already knows from a
 * DAW or has to be shown, and a bullet list shows nothing. Holding one source
 * clip fixed and changing only what the route does to it is the difference
 * between naming four features and explaining them.
 *
 * The distinction the drawing has to carry is which samples survive. Extend
 * keeps the source bit-for-bit and appends — it is implemented as a repaint
 * whose window starts past the end, which is *why* it survives. Repaint
 * replaces a window and keeps both edges. Cover re-renders everything at the
 * original length. Separation keeps all of it and splits it four ways. Those
 * are four genuinely different answers and the colour split says so.
 */

import { ScrollStage, type StageStep } from "@/components/scroll-stage";
import { WindowChrome } from "@/components/window-chrome";
import { laneColor } from "@/lib/lanes";
import { resultPeaksFor, type ClipShape } from "@/lib/studio-scene";
import { cn } from "@/lib/utils";

const SOURCE_S = 3;

/** The clip every route is applied to. */
const SOURCE = resultPeaksFor("route-source", "impact", SOURCE_S);
/** New material, for the routes that generate some. Different seeds so the
 *  regenerated stretches visibly are not the source. */
const APPENDED = resultPeaksFor("route-extend", "swell", SOURCE_S);
const COVERED = resultPeaksFor("route-cover", "swell", SOURCE_S);
const REPAINTED = resultPeaksFor("route-repaint", "impact", SOURCE_S);

/**
 * htdemucs emits exactly these four.
 *
 * Each gets its own peaks rather than a tinted copy of the source: four
 * identical shapes in four colours would say "the same audio, four times",
 * which is the opposite of what separation does. The shapes are chosen to read
 * as what they are — drums as hits, bass as a sustained floor, vocals as
 * phrases — so the row you look at is recognisably a stem.
 */
const STEMS: { name: string; shape: ClipShape }[] = [
  { name: "vocals", shape: "swell" },
  { name: "drums", shape: "impact" },
  { name: "bass", shape: "steady" },
  { name: "other", shape: "steady" },
];

const STEM_PEAKS = STEMS.map((s) => resultPeaksFor(`stem-${s.name}`, s.shape, SOURCE_S));

/** `id` picks the drawing; `title` is both the pill in the panel and the
 *  heading of the copy beside it. */
interface Route extends StageStep {
  id: string;
}

const ROUTES: Route[] = [
  {
    id: "source",
    title: "The source",
    detail:
      "One clip, three seconds, already in your library. Everything below leaves this file on disk untouched and writes a new one beside it.",
  },
  {
    id: "extend",
    title: "extend",
    detail:
      "The source unchanged, followed by new material up to the target length. Extend is a repaint whose window starts past the end of the clip, so the source survives sample for sample.",
  },
  {
    id: "cover",
    title: "cover",
    detail:
      "The clip re-rendered in the style of a new prompt, locked to the source's length. A strength setting decides how closely it follows the original.",
  },
  {
    id: "repaint",
    title: "repaint",
    detail:
      "Regenerate a window inside the clip and keep both edges. Use it when one moment in an otherwise good take is wrong.",
  },
  {
    id: "separate",
    title: "separation",
    detail:
      "Split a mix into stems. htdemucs gives vocals, drums, bass and other. Separation is a task mode of its own, separate from generation. It needs 44.1 kHz, so Konchi resamples first.",
  },
];

/** Which sixth of the clip `repaint` regenerates. */
const REPAINT_FROM = 0.4;
const REPAINT_TO = 0.65;

function Bars({
  peaks,
  fill,
  className,
  offsetPct = 0,
  widthPct = 100,
}: {
  peaks: number[];
  fill: string;
  className?: string;
  offsetPct?: number;
  widthPct?: number;
}) {
  return (
    <svg
      // `h-full` rather than `inset-y-0`: an <svg> with a viewBox is a
      // replaced element with an intrinsic aspect ratio, so with `height:auto`
      // the browser sizes it from its width and ignores `bottom` entirely —
      // which silently made every one of these bars several hundred pixels
      // tall inside a 25px row.
      className={cn("absolute top-0 h-full", className)}
      style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
      viewBox={`0 0 ${peaks.length} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {peaks.map((peak, i) => (
        <rect
          key={i}
          x={i + 0.15}
          y={50 - peak * 44}
          width={0.7}
          height={peak * 88}
          rx={0.3}
          fill={fill}
        />
      ))}
    </svg>
  );
}

/** Source-coloured; the samples that came out of the original generation. */
const KEPT = laneColor(2, 0.85);
/** Accent-coloured; samples this route produced. */
const NEW = "var(--primary)";

export function RevealEditRoutes() {
  return (
    <ScrollStage
      id="routes"
      eyebrow="Covering, extending, repainting"
      title="Change a clip you already have"
      intro="Generation is one route of several. The others take a clip you already have, change part of it and keep the rest."
      steps={ROUTES}
      layout="centered"
      lane={2}
    >
      {(_progress, step, select) => {
        const route = ROUTES[step];
        const repaintFrom = Math.round(SOURCE.length * REPAINT_FROM);
        const repaintTo = Math.round(SOURCE.length * REPAINT_TO);

        return (
          <figure className="border-border/60 bg-card/80 overflow-hidden rounded-xl border shadow-sm">
            <WindowChrome label="Sound: edit a clip you already have" />

            <div className="p-4 sm:p-5">
              {/* The rail is the control. Four routes with genuinely different
                  answers is exactly the case where a reader wants to flick
                  between two of them and compare, which scrolling back and
                  forth makes tedious and a click makes trivial. */}
              <ol className="flex flex-wrap items-center gap-1.5">
                {ROUTES.map((r, i) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => select(i)}
                      aria-current={i === step ? "step" : undefined}
                      className={cn(
                        "focus-visible:ring-ring/50 cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[11px] outline-none focus-visible:ring-2",
                        "transition-colors duration-300 motion-reduce:transition-none",
                        i === step
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-border/40 text-muted-foreground/50 hover:border-border hover:text-muted-foreground",
                      )}
                    >
                      {r.title}
                    </button>
                  </li>
                ))}
              </ol>

              {/* The waveform area. Fixed height across every route so the
                  panel does not resize under the reader when separation
                  splits one row into four. */}
              <div className="mt-4 h-28">
                {route.id === "separate" ? (
                  <div className="flex h-full flex-col gap-1">
                    {STEMS.map((stem, i) => (
                      <div
                        key={stem.name}
                        className="border-border/50 bg-background/40 relative flex min-h-0 flex-1 overflow-hidden rounded border"
                      >
                        {/* A gutter, the way the timeline names its lanes —
                            rather than laying the label over the waveform,
                            where 10px type on top of dense bars is not
                            readable at any contrast. */}
                        <span className="text-muted-foreground border-border/50 flex w-14 shrink-0 items-center border-r px-1.5 font-mono text-[10px]">
                          {stem.name}
                        </span>
                        <span className="relative min-w-0 flex-1">
                          <Bars peaks={STEM_PEAKS[i]} fill={laneColor(i, 0.85)} className="w-full" />
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="border-border/50 bg-background/40 relative h-full overflow-hidden rounded-lg border">
                    {route.id === "extend" ? (
                      <>
                        {/* Half the width each: the source, then what was
                            appended past its end. */}
                        <Bars peaks={SOURCE} fill={KEPT} offsetPct={0} widthPct={50} />
                        <Bars peaks={APPENDED} fill={NEW} offsetPct={50} widthPct={50} />
                        <span
                          className="bg-border absolute inset-y-0 w-px"
                          style={{ left: "50%" }}
                          aria-hidden="true"
                        />
                      </>
                    ) : route.id === "cover" ? (
                      <Bars peaks={COVERED} fill={NEW} className="w-full" />
                    ) : route.id === "repaint" ? (
                      <>
                        <Bars
                          peaks={SOURCE.slice(0, repaintFrom)}
                          fill={KEPT}
                          offsetPct={0}
                          widthPct={REPAINT_FROM * 100}
                        />
                        <Bars
                          peaks={REPAINTED.slice(repaintFrom, repaintTo)}
                          fill={NEW}
                          offsetPct={REPAINT_FROM * 100}
                          widthPct={(REPAINT_TO - REPAINT_FROM) * 100}
                        />
                        <Bars
                          peaks={SOURCE.slice(repaintTo)}
                          fill={KEPT}
                          offsetPct={REPAINT_TO * 100}
                          widthPct={(1 - REPAINT_TO) * 100}
                        />
                        {/* The window, marked — the edges are the point. */}
                        <span
                          className="border-primary/50 pointer-events-none absolute inset-y-0 border-x border-dashed"
                          style={{
                            left: `${REPAINT_FROM * 100}%`,
                            width: `${(REPAINT_TO - REPAINT_FROM) * 100}%`,
                          }}
                          aria-hidden="true"
                        />
                      </>
                    ) : (
                      <Bars peaks={SOURCE} fill={KEPT} className="w-full" />
                    )}
                  </div>
                )}
              </div>

              {/* Legend, only where two kinds of sample are on screen at once. */}
              <div
                className={cn(
                  "text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] transition-opacity duration-300",
                  "motion-reduce:transition-none",
                  route.id === "extend" || route.id === "repaint" ? "opacity-100" : "opacity-0",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ backgroundColor: KEPT }} />
                  original samples, untouched
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ backgroundColor: NEW }} />
                  newly generated
                </span>
              </div>

            </div>
          </figure>
        );
      }}
    </ScrollStage>
  );
}
