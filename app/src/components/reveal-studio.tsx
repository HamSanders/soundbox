/**
 * The studio, built up one lane at a time as you scroll.
 *
 * The banner at the top of the page shows a finished arrangement, which
 * answers "what does it look like" but not "how did it get that way". This
 * answers the second one: a bed, then footsteps over it, then the impacts that
 * carry the scene, then the designed layer underneath — which is the actual
 * order a person works in, and the argument for why a generator needs a
 * timeline attached rather than a download button.
 *
 * The last step hands the playhead to the scrollbar: keep scrolling and you
 * scrub it across the finished arrangement, clips lighting as it crosses them.
 * That is the one moment on the page where the motion is unambiguously the
 * reader's own, which is why it is the note to end on.
 *
 * Clip geometry, lane colours and waveform peaks all come from
 * `lib/studio-scene`, the same data the banner draws — so this is literally
 * the same arrangement seen mid-construction, not a second invented one that
 * would drift out of step with it.
 */

import { ScrollStage, type StageStep } from "@/components/scroll-stage";
import { WindowChrome } from "@/components/window-chrome";
import { laneColor } from "@/lib/lanes";
import {
  LOOP_S,
  STUDIO_CLIPS,
  STUDIO_LANES,
  STUDIO_MIN_LABEL_S,
  studioPeaksFor,
  type StudioClip,
} from "@/lib/studio-scene";
import { cn } from "@/lib/utils";

/** What each lane adds to the scene, in the order they arrive. One per step,
 *  plus a final step that plays the result rather than adding to it. */
const BEATS: StageStep[] = [
  {
    title: "Start with the room",
    detail:
      "One long ambience bed. It places every other sound in a space.",
  },
  {
    title: "Put someone in it",
    detail:
      "Footsteps on their own lane, spaced by hand. They are three generations of the same prompt, so no loop can be heard.",
  },
  {
    title: "Give it a moment",
    detail:
      "The impacts the scene is built around. They have their own lane, so moving the door slam a beat later does not disturb anything under it.",
  },
  {
    title: "Design underneath",
    detail:
      "A riser and a hull groan: designed sounds that nobody could go out and record.",
  },
  {
    title: "Play it back",
    detail:
      "Keep scrolling to scrub the playhead. Every clip is a file on your disk with the prompt and seed that made it. Regenerate any one of them without touching the rest.",
  },
];

/** The step at which every lane is present and the playhead takes over. */
const PLAYBACK = BEATS.length - 1;

function RevealClip({ clip, lit }: { clip: StudioClip; lit: boolean }) {
  const peaks = studioPeaksFor(clip);
  return (
    <div
      className={cn(
        "absolute inset-y-1 overflow-hidden rounded-md border",
        "transition-[background-color,border-color] duration-200 motion-reduce:transition-none",
      )}
      style={{
        left: `${(clip.startS / LOOP_S) * 100}%`,
        width: `${(clip.durationS / LOOP_S) * 100}%`,
        borderColor: laneColor(clip.lane, lit ? 0.9 : 0.45),
        backgroundColor: laneColor(clip.lane, lit ? 0.3 : 0.14),
      }}
    >
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
      {clip.durationS >= STUDIO_MIN_LABEL_S && (
        <span className="text-foreground/90 bg-background/55 absolute inset-x-0 top-0 hidden truncate px-1 py-px text-[10px] leading-tight font-medium sm:block">
          {clip.label}
        </span>
      )}
    </div>
  );
}

export function RevealStudio() {
  return (
    <ScrollStage
      id="studio"
      eyebrow="The studio"
      title="Arrange what you generate on a timeline"
      intro="Every generation lands on a timeline you can arrange. Scroll to build one up a lane at a time, then scrub the playhead across it."
      steps={BEATS}
      layout="text-right"
      lane={3}
    >
      {(progress, step, select) => {
        const slice = 1 / BEATS.length;
        // On the last step the remaining scroll drives the playhead. Before
        // it, there is no playhead to place.
        const scrub = Math.min(1, Math.max(0, (progress - PLAYBACK * slice) / slice));
        const playing = step === PLAYBACK;
        const nowS = scrub * LOOP_S;

        return (
          <figure className="border-border/60 bg-card/80 overflow-hidden rounded-xl border shadow-sm">
            <WindowChrome label="Studio: every sound you generate, arranged" />

            <div className="relative flex">
              {/* The lane names are the control here. A reader who wants to
                  know what "Design" contributes should be able to click it and
                  land on the moment it arrives — the gutter already answers
                  "which lane is which", so it is the honest place to put
                  "show me that one" rather than bolting a stepper underneath. */}
              <div className="border-border/60 w-16 shrink-0 border-r sm:w-24">
                <div className="border-border/40 h-5 border-b" />
                {STUDIO_LANES.map((name, lane) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => select(lane)}
                    aria-current={lane === step ? "step" : undefined}
                    className={cn(
                      "border-border/40 focus-visible:ring-ring/50 flex h-11 w-full cursor-pointer items-center gap-1.5 border-b px-2 text-left outline-none last:border-b-0 focus-visible:ring-2 sm:h-12",
                      "transition-opacity duration-500 motion-reduce:transition-none",
                      lane <= step ? "opacity-100" : "opacity-25 hover:opacity-60",
                    )}
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: laneColor(lane, 0.9) }}
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground truncate text-[10px] font-medium sm:text-[11px]">
                      {name}
                    </span>
                  </button>
                ))}
              </div>

              <div className="relative min-w-0 flex-1">
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

                {STUDIO_LANES.map((name, lane) => {
                  // A lane arrives on its own step and stays. Comparing against
                  // `step` rather than tracking state means scrolling back up
                  // takes the arrangement apart again, which is the right
                  // behaviour: the scrollbar is the transport here.
                  const present = lane <= step;
                  return (
                    <div
                      key={name}
                      className="border-border/40 relative h-11 border-b last:border-b-0 sm:h-12"
                    >
                      <div
                        className="pointer-events-none absolute inset-0"
                        style={{ backgroundColor: laneColor(lane, 0.04) }}
                        aria-hidden="true"
                      />
                      <div
                        className={cn(
                          "absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none",
                          present ? "opacity-100" : "opacity-0",
                        )}
                      >
                        {STUDIO_CLIPS.filter((c) => c.lane === lane).map((clip) => (
                          <RevealClip
                            key={clip.id}
                            clip={clip}
                            lit={
                              playing &&
                              nowS >= clip.startS &&
                              nowS < clip.startS + clip.durationS
                            }
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}

                {playing && (
                  <div
                    className="pointer-events-none absolute inset-y-0 z-10 w-0.5"
                    style={{ left: `${scrub * 100}%`, backgroundColor: "var(--signal)" }}
                    aria-hidden="true"
                  >
                    <span
                      className="absolute -top-px -left-[2.5px] size-[7px] rounded-full"
                      style={{ backgroundColor: "var(--signal)" }}
                    />
                  </div>
                )}
              </div>
            </div>

          </figure>
        );
      }}
    </ScrollStage>
  );
}
