/**
 * The studio timeline, as a banner — what the product looks like, above the fold.
 *
 * This is deliberately *not* `story-timeline.tsx`. That component is three
 * thousand lines wired to a live backend: a player store, a recorder, Web Audio
 * decoding, drag-and-drop, device chains and server-backed segment mutations.
 * None of that can exist on a prerendered marketing page with no server behind
 * it, and none of it is what a first-time visitor needs to see. What they need
 * is the *shape* of the thing — clips on lanes, arranged in time, a playhead
 * moving through them — which is a picture, not an application.
 *
 * So this borrows the real vocabulary and none of the machinery: the same lane
 * hues from `lib/lanes` (so the colours here are the colours you get), the same
 * clip-on-a-ruler layout, the same idea that a lane is an instrument and a clip
 * is a sound. It plays no audio and accepts no input.
 *
 * It animates because a still timeline reads as a screenshot, and a screenshot
 * of a timeline is indistinguishable from every other DAW screenshot. Movement
 * is what says "these are separate sounds at separate moments". It stops for
 * `prefers-reduced-motion`, parking the playhead mid-arrangement with the clips
 * under it lit — the same bargain `docs/islands/signal-chain.tsx` makes.
 */

import { useEffect, useRef } from "react";

import { laneColor } from "@/lib/lanes";
import { cn } from "@/lib/utils";
import { WindowChrome } from "@/components/window-chrome";
import {
  LOOP_S,
  STUDIO_CLIPS as CLIPS,
  STUDIO_LANES as LANES,
  STUDIO_MIN_LABEL_S as MIN_LABEL_S,
  studioPeaksFor as peaksFor,
  type StudioClip as Clip,
} from "@/lib/studio-scene";

/** Where the playhead parks when motion is suppressed. Chosen to sit inside
 *  several clips at once, so a still frame still shows the thing lighting up
 *  rather than an empty ruler with a line on it. */
const STILL_T = 0.46;

function ClipBlock({ clip }: { clip: Clip }) {
  const peaks = peaksFor(clip);
  const left = (clip.startS / LOOP_S) * 100;
  const width = (clip.durationS / LOOP_S) * 100;

  return (
    <div
      data-clip={clip.id}
      className={cn(
        "group/clip absolute inset-y-1 overflow-hidden rounded-md border",
        // The lit state is driven by `data-active`, which the rAF loop below
        // toggles as the playhead crosses. Transitions rather than a hard
        // switch: a clip that snaps on reads as a rendering glitch, one that
        // rises reads as it being played.
        "transition-[background-color,border-color,box-shadow] duration-150",
      )}
      style={{
        left: `${left}%`,
        width: `${width}%`,
        borderColor: laneColor(clip.lane, 0.45),
        backgroundColor: laneColor(clip.lane, 0.14),
      }}
    >
      {/* The waveform. `preserveAspectRatio="none"` lets one path stretch to
          whatever width the clip ends up at, so the bars stay put relative to
          the audio rather than to the pixel grid. */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${peaks.length} 100`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {peaks.map((peak, i) => (
          <rect
            key={i}
            x={i + 0.15}
            y={50 - peak * 46}
            width={0.7}
            height={peak * 92}
            rx={0.3}
            fill={laneColor(clip.lane, 0.85)}
          />
        ))}
      </svg>

      {/* The prompt that made it — but only where the clip is wide enough to
          hold one. A short clip truncates to "boo…", and three of those in a
          row read as broken placeholder text rather than as three footsteps.
          Hidden on the narrowest screens for the same reason: below `sm` even
          the long clips are too short to hold a word. */}
      {clip.durationS >= MIN_LABEL_S && (
        <span
          className={cn(
            "text-foreground/90 absolute inset-x-0 top-0 hidden truncate px-1 py-px",
            "text-[10px] leading-tight font-medium sm:block",
            // A title strip rather than text floating on the waveform, which
            // is how a clip is named on any real desk — and the only way a
            // 10px label stays readable over its own peaks.
            "bg-background/55",
          )}
        >
          {clip.label}
        </span>
      )}
    </div>
  );
}

export function TimelineBanner({ className }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const clipEls = new Map<string, HTMLElement>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-clip]")) {
      clipEls.set(el.dataset.clip!, el);
    }

    /** Paint one moment: the playhead's position, and which clips it is over. */
    const paint = (t: number) => {
      root.style.setProperty("--t", `${(t * 100).toFixed(3)}%`);
      const now = t * LOOP_S;
      for (const clip of CLIPS) {
        const el = clipEls.get(clip.id);
        if (!el) continue;
        const active = now >= clip.startS && now < clip.startS + clip.durationS;
        // Only touch the DOM on a change. Nine clips at 60fps is not a
        // performance problem, but an attribute write per clip per frame
        // invalidates style on all of them for no reason.
        if ((el.dataset.active === "true") !== active) {
          el.dataset.active = String(active);
          el.style.backgroundColor = laneColor(clip.lane, active ? 0.3 : 0.14);
          el.style.borderColor = laneColor(clip.lane, active ? 0.9 : 0.45);
          el.style.boxShadow = active ? `0 0 0 1px ${laneColor(clip.lane, 0.5)}` : "none";
        }
      }
    };

    const motionOk = window.matchMedia("(prefers-reduced-motion: no-preference)");

    let frame = 0;
    let startedAt = 0;

    const tick = (now: number) => {
      if (!startedAt) startedAt = now;
      paint((((now - startedAt) / 1000) % LOOP_S) / LOOP_S);
      frame = requestAnimationFrame(tick);
    };

    const run = () => {
      cancelAnimationFrame(frame);
      if (motionOk.matches) {
        startedAt = 0;
        frame = requestAnimationFrame(tick);
      } else {
        // Not a frozen animation — a composed still. The playhead sits where
        // the arrangement is busiest and the clips under it are lit, so the
        // picture still explains itself.
        paint(STILL_T);
      }
    };

    run();
    motionOk.addEventListener("change", run);
    return () => {
      cancelAnimationFrame(frame);
      motionOk.removeEventListener("change", run);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={cn(
        "border-border/60 bg-card/40 relative overflow-hidden rounded-xl border shadow-sm",
        // The playhead's position lives in a custom property so the rAF loop
        // writes one string per frame instead of re-rendering React.
        "[--t:0%]",
        className,
      )}
      // Decorative in the accessibility tree, but not *meaningless* — one
      // sentence is worth more here than nine clip labels read in sequence.
      role="img"
      aria-label="A Konchi studio timeline: four lanes of generated sound effects — an ambience bed, footsteps, door and glass impacts, and two designed risers — arranged in time as a playhead moves across them."
    >
      <WindowChrome label="Studio — every sound you generate, arranged" />

      <div className="relative flex">
        {/* The gutter. Narrower than the app's 168px: these lanes carry a name
            and nothing else, because there is nothing here to mute or solo. */}
        <div className="border-border/60 w-16 shrink-0 border-r sm:w-24" aria-hidden="true">
          <div className="border-border/40 h-5 border-b" />
          {LANES.map((name, lane) => (
            <div
              key={name}
              className="border-border/40 flex h-11 items-center gap-1.5 border-b px-2 last:border-b-0 sm:h-12"
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: laneColor(lane, 0.9) }}
              />
              <span className="text-muted-foreground truncate text-[10px] font-medium sm:text-[11px]">
                {name}
              </span>
            </div>
          ))}
        </div>

        {/* The tracks. */}
        <div className="relative min-w-0 flex-1">
          {/* Ruler: one tick a second, labelled every other one. */}
          <div className="border-border/40 relative h-5 border-b" aria-hidden="true">
            {Array.from({ length: LOOP_S + 1 }, (_, s) => (
              <div
                key={s}
                className="absolute top-0 bottom-0"
                style={{ left: `${(s / LOOP_S) * 100}%` }}
              >
                <span className="bg-border/70 absolute top-0 bottom-0 w-px" />
                {s % 2 === 0 && s < LOOP_S && (
                  <span className="text-muted-foreground/70 absolute top-0.5 left-1 text-[9px] tabular-nums">
                    {s}s
                  </span>
                )}
              </div>
            ))}
          </div>

          {LANES.map((name, lane) => (
            <div
              key={name}
              className="border-border/40 relative h-11 border-b last:border-b-0 sm:h-12"
            >
              {/* Lane tint, so an empty stretch still reads as belonging to
                  this instrument rather than as background. */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{ backgroundColor: laneColor(lane, 0.04) }}
                aria-hidden="true"
              />
              {CLIPS.filter((c) => c.lane === lane).map((clip) => (
                <ClipBlock key={clip.id} clip={clip} />
              ))}
            </div>
          ))}

          {/* The playhead, spanning the ruler and every lane. */}
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-px"
            style={{ left: "var(--t)", backgroundColor: "var(--primary)" }}
            aria-hidden="true"
          >
            <span
              className="absolute -top-px -left-[3px] size-[7px] rounded-full"
              style={{ backgroundColor: "var(--primary)" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
