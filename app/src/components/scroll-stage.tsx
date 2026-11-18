/**
 * A sticky product shot that stays put while the page scrolls past a tall
 * spacer behind it, with the copy beside it changing as you go. The mechanism
 * the three `reveal-*` sections are built on.
 *
 * Two things it deliberately owns rather than leaving to each reveal:
 *
 * **The copy lives here, not inside the product.** The first version of this
 * put the step description in a `<figcaption>` inside the mockup's own frame,
 * which made the explanation look like part of the application's UI — a
 * caption bar no screen in Soundbox actually has. Out here it is plainly the
 * page talking about the product rather than the product talking about
 * itself, and it can cross-fade between steps instead of hard-swapping.
 *
 * **Layout is a parameter.** Three sections in a row with the panel centred
 * under a heading reads as one component repeated three times. Alternating
 * text-left / centred / text-right is what makes them read as a sequence.
 *
 * The spacer is `steps * vhPerStep` tall — scroll distance is how this trades
 * against feeling either rushed (too little) or like the page has stopped
 * responding (too much). Keep it low: three of these on one page multiply,
 * and everything below them is pushed down by the total.
 */

import { useCallback, type ReactNode } from "react";

import { useScrollProgress } from "@/hooks/use-scroll-progress";
import { WaveBackdrop, type BackdropVariant } from "@/components/wave-backdrop";
import { cn } from "@/lib/utils";

export interface StageStep {
  title: string;
  detail: string;
}

/** Where the words sit relative to the product shot. */
export type StageLayout = "text-left" | "centered" | "text-right";

export function ScrollStage({
  id,
  eyebrow,
  title,
  intro,
  steps,
  layout = "text-left",
  vhPerStep = 34,
  lane = 0,
  backdrop,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  intro: ReactNode;
  /** Hue for the drifting waveform texture behind this section, so the page
   *  does not run the same colour of background down its whole length. */
  lane?: number;
  /** Which of the backdrop textures this section gets. Left off, the backdrop
   *  picks one from `id`, so a page that has not been art-directed still gets
   *  variety; set it when the order down the page matters. */
  backdrop?: BackdropVariant;
  /** One entry per revealed moment. Drives the spacer height, the `step`
   *  index handed to `children`, and the copy that fades in beside it. */
  steps: StageStep[];
  layout?: StageLayout;
  vhPerStep?: number;
  /** `select` lets the panel's own controls jump the reader to a step — see
   *  the note on `selectStep` below for why it scrolls rather than overriding. */
  children: (progress: number, step: number, select: (index: number) => void) => ReactNode;
}) {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  // Clamped below `steps.length` so the very last frame of scrolling still
  // reads as "step count minus one" rather than rolling over into a step that
  // has no content — `progress` reaching exactly 1 would otherwise floor past
  // the end.
  const step = Math.min(steps.length - 1, Math.floor(progress * steps.length));
  const centered = layout === "centered";

  /**
   * Jump to a step, for the clickable controls inside the panels.
   *
   * This *scrolls the page* rather than pinning an override on top of the
   * scroll position, and that is the whole design. An override has to decide
   * when to hand control back, and every answer is wrong: release on the next
   * scroll event and the panel snaps away the instant you touch the wheel;
   * hold it and the scrollbar is lying about where you are. Scrolling instead
   * means there is only ever one source of truth, so a click and a drag cannot
   * disagree.
   *
   * The side effect is that jumping several steps plays through the ones in
   * between rather than cutting. That reads as fast-forward, which is fine —
   * arguably better, since these sections are sequences.
   */
  const selectStep = useCallback(
    (index: number) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const range = rect.height - window.innerHeight;
      if (range <= 0) return;
      // Aim at the middle of the step's slice, so a click lands somewhere the
      // step is unambiguously current rather than on its boundary.
      const target = top + range * ((index + 0.5) / steps.length);
      const smooth = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
      window.scrollTo({ top: target, behavior: smooth ? "smooth" : "auto" });
    },
    [ref, steps.length],
  );

  /**
   * One slot, not a stack. The first version kept the section's title and
   * intro on screen and faded the step copy in *underneath* them, which meant
   * two competing blocks of prose the whole way down. Now the step copy takes
   * the title's place: step 0 shows the section's own title and intro, and
   * every later step replaces them with its own heading-sized title and
   * detail, cross-fading through the same box.
   *
   * The box is a CSS grid with every block in the same cell — the cell sizes
   * itself to the tallest block, so nothing jumps as they swap and there is
   * no hand-reserved height to fall out of date when copy changes.
   *
   * The real `<h2>` stays in the DOM whichever block is showing (opacity-0,
   * never display:none), because the section's `aria-labelledby` points at it.
   * Step titles are styled like the heading but are `<p>`s — one heading per
   * section, and it is the section's.
   */
  const words = (
    <div className={cn(centered && "mx-auto max-w-2xl text-center")}>
      <p className="label-caps text-primary">{eyebrow}</p>

      <div className="mt-2 grid">
        <div
          className={cn(
            "col-start-1 row-start-1",
            "transition-[opacity,transform] duration-500 motion-reduce:transition-none",
            step === 0
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-2 opacity-0",
          )}
          aria-hidden={step === 0 ? undefined : "true"}
        >
          <h2
            id={`${id}-heading`}
            className="font-heading text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
          >
            {title}
          </h2>
          <p className="text-muted-foreground mt-3 leading-relaxed">{intro}</p>
        </div>

        {/* Step 0 has no block of its own: the section title and intro are
            what step 0 says. Its entry still exists in `steps` so the panels'
            pills and rails can select it. */}
        {steps.map((s, i) =>
          i === 0 ? null : (
            <div
              key={s.title}
              className={cn(
                "col-start-1 row-start-1",
                "transition-[opacity,transform] duration-500 motion-reduce:transition-none",
                i === step
                  ? "translate-y-0 opacity-100"
                  : "pointer-events-none translate-y-2 opacity-0",
              )}
              aria-hidden={i === step ? undefined : "true"}
            >
              <p className="font-heading text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                {s.title}
              </p>
              <p className="text-muted-foreground mt-3 leading-relaxed">{s.detail}</p>
            </div>
          ),
        )}
      </div>
    </div>
  );

  /**
   * `key={step}` so the panel settles in fresh on every step boundary — see
   * the `soundbox-panel-settle` keyframes in index.css for why the panel
   * needs its own motion rather than riding on the text's cross-fade. This is
   * a genuine remount, not a class toggle, and that is deliberate: every
   * `reveal-*` panel derives everything it draws from the `step` argument it
   * is handed, so a fresh mount at the new step's values is indistinguishable
   * from the old instance updating to them — except that mounting is what
   * lets an entrance animation play at all. It only remounts at step
   * boundaries; scrubbing *within* a step (the studio reveal's playhead, the
   * prompt reveal's waveform draw) changes `progress` but not `step`, so nothing
   * here interrupts a scroll-driven animation already in flight.
   */
  const panel = (
    <div key={step} className="soundbox-panel-settle">
      {children(progress, step, selectStep)}
    </div>
  );

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="border-border/60 relative border-t"
    >
      <div ref={ref} style={{ height: `${vhPerStep * steps.length}vh` }} className="relative">
        {/* Full-height so the panel can sit centred in the viewport rather
            than pinned to the top with dead space under it. `top-14` clears
            the site's sticky header — see site/src/components/site-header. */}
        <div className="sticky top-14 flex min-h-[calc(100svh-3.5rem)] items-center overflow-hidden">
          {/* Inside the sticky box, not the spacer: pinned to the viewport it
              drifts steadily behind the panel the whole time the section is
              on screen. Behind the spacer it would scroll away with the page
              and be gone for most of the section. */}
          <WaveBackdrop seed={id} lane={lane} variant={backdrop} />
          <div className="relative mx-auto w-full max-w-5xl px-4">
            {centered ? (
              <div className="space-y-8">
                {words}
                <div className="mx-auto max-w-3xl">{panel}</div>
              </div>
            ) : (
              <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-10">
                <div className={cn(layout === "text-right" && "lg:order-2")}>{words}</div>
                <div className={cn("min-w-0", layout === "text-right" && "lg:order-1")}>
                  {panel}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

