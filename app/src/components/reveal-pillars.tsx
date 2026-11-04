/**
 * The whole product as one pipeline, a step at a time.
 *
 * The landing page had a shape problem rather than a content problem. It could
 * show one generation end to end (`reveal-prompt-to-sample`) and it could point
 * at the studio, but the four pillar pages — /sfx, /music, /voices, /studio —
 * were only reachable from the header, so a first-time reader could finish the
 * page believing Konchi is a sound-effect box that happens to have a timeline
 * bolted on. The parts are not four features. They are one prompt box with
 * three kinds of output and one workspace they all land in.
 *
 * So this section is deliberately *one* window that keeps its frame the whole
 * way down while its contents change. The alternative considered and rejected
 * was four side-by-side cards, one per pillar: a grid says "here are four
 * things", and four things is exactly the wrong reading. A single window whose
 * output area swaps while the prompt row above it stays put says "same box,
 * different answer", which is the claim.
 *
 * Two smaller decisions worth naming:
 *
 * **The rail scrubs, the footer links.** The pills across the top select a step
 * (via `ScrollStage`'s `select`, which scrolls rather than overriding — see its
 * docstring), so a reader can jump straight to the beat they care about. The
 * real `<Link>` per step lives in the footer and every one of them stays in the
 * DOM, cross-faded rather than swapped, because this page is prerendered and a
 * pillar page only gets crawled if there is an href pointing at it. Making the
 * rail itself the links was tried first and cannot work: a click would navigate
 * away instead of scrubbing, which loses the only interaction the section has.
 *
 * **Nothing here invents a second scene.** The waveforms come from
 * `lib/studio-scene`'s seeded, quantized generators — the same ones the
 * timeline banner and the prompt-to-sample reveal draw from — so the clips a
 * reader sees here are the same kind of shape as the clips everywhere else,
 * and the markup is byte-identical between Node and the browser.
 */

import { Link } from "react-router-dom";
import { MusicIcon, AudioLinesIcon, MicIcon, LayersIcon, CpuIcon } from "lucide-react";

import { ScrollStage, type StageStep } from "@/components/scroll-stage";
import { WindowChrome } from "@/components/window-chrome";
import { laneColor } from "@/lib/lanes";
import { resultPeaksFor } from "@/lib/studio-scene";
import { MODELS_HUB_HREF, STUDIO_HREF } from "@/lib/marketing-links";
import { cn } from "@/lib/utils";

/**
 * A lane index per pillar, so a kind of audio is the same colour in its own
 * step and again as a row on the timeline two steps later. That continuity is
 * the entire reason the timeline step reads as "the three things you just
 * watched being made" rather than as a fresh unrelated arrangement.
 */
const SFX_LANE = 2;
const MUSIC_LANE = 1;
const VOICE_LANE = 3;

/** Seconds across the mini timeline. Not `LOOP_S`: this arrangement is three
 *  clips of this section's own making, not the shared banner scene, and it
 *  wants to be short enough that three clips fill it. */
const TIMELINE_S = 12;

interface Beat extends StageStep {
  /** The pill on the rail. Lowercase and route-shaped on purpose — these are
   *  the URLs, and naming them that way makes the rail legible as a map of the
   *  site rather than as five invented category words. */
  pill: string;
  href: string;
  cta: string;
}

/**
 * The beats.
 *
 * Order is the order the product actually happens in: you type something, you
 * get one of three kinds of audio back, the audio accumulates on a timeline,
 * and underneath all of it is a set of local weights with licences attached.
 * Models comes last rather than first because it is the answer to "what did I
 * just agree to", and that question only lands once there is something to have
 * agreed to.
 *
 * Step 0's copy is the section's own title and intro — see `ScrollStage`.
 */
const BEATS: Beat[] = [
  {
    pill: "sfx",
    title: "One prompt box, three kinds of audio",
    detail: "",
    href: "/sfx",
    cta: "Browse the sound library",
  },
  {
    pill: "music",
    title: "The same box writes music",
    detail:
      "Give it lyrics and a style and ACE-Step sings them; leave the lyrics out and it stays instrumental. It uses the same window and prompt field, with a different model behind it.",
    href: "/music",
    cta: "Hear the music models",
  },
  {
    pill: "voices",
    title: "And speech, in a voice you supply",
    detail:
      "Text to speech from a short reference recording, so a line can be read by the same character twice. The voice stays on your disk, and cloning runs on your machine.",
    href: "/voices",
    cta: "See how voices work",
  },
  {
    pill: "studio",
    title: "All three land on one timeline",
    detail:
      "Every clip arrives on a lane of its own, where it can be moved, split, regenerated or extended against the others. Generating and arranging happen in one application, with no export step between them.",
    href: STUDIO_HREF,
    cta: "See the studio",
  },
  {
    pill: "models",
    title: "Every model runs on your machine",
    detail:
      "Weights are memory-mapped off your disk through audio.cpp. Each one carries its licence in the catalog, including the ones whose terms restrict commercial use. Nothing is uploaded and nothing is billed per second.",
    href: MODELS_HUB_HREF,
    cta: "Read the model write-ups",
  },
];

/** The section's own title and intro live on step 0, which means the copy for
 *  the sfx beat is these two strings rather than an entry in `BEATS`. */
const INTRO =
  "Sound effects, music and speech come out of the same prompt box and land in the same workspace. Scroll to follow one of each from a sentence to a clip on a lane.";

const SFX_INDEX = 0;
const MUSIC_INDEX = 1;
const VOICE_INDEX = 2;
const STUDIO_INDEX = 3;

/**
 * What gets typed at each of the three generating steps.
 *
 * Written in the shape the docs teach for each kind: material / action / space
 * for an effect, style tags plus a lyric for music, and for speech a plain line
 * with the voice named beside it rather than embedded in the text.
 */
const INPUTS = [
  {
    label: "Prompt",
    lines: ["heavy wooden door slamming in a stone corridor"],
    meta: ["duration_s: 3", "model: stable-audio-3-sfx"],
  },
  {
    label: "Lyrics + style",
    lines: ["slow post-rock, brushed drums, tape hiss", "“we left the lights on in the hallway”"],
    meta: ["duration_s: 8", "model: ace-step-1.5-turbo"],
  },
  {
    label: "Line + voice",
    lines: ["“Something moved at the end of the corridor.”"],
    meta: ["voice: narrator-01.wav", "model: vibevoice-1.5b"],
  },
];

/** One waveform per generating step, seeded so SSR and hydration agree. The
 *  envelopes differ because the sounds do: an impact decays, a music bed rises
 *  and holds, a spoken line is closer to flat. */
const CLIP_PEAKS = [
  resultPeaksFor("pillars-sfx", "impact", 3),
  resultPeaksFor("pillars-music", "swell", 8),
  resultPeaksFor("pillars-voice", "steady", 5),
];

/** The arrangement for the studio step: the three clips above, placed by hand
 *  so they overlap the way a scene actually does — the music bed running under
 *  everything, the line landing over it, the door on the end. */
const ARRANGEMENT = [
  { name: "Music", lane: MUSIC_LANE, peaks: CLIP_PEAKS[MUSIC_INDEX], startS: 0, durationS: 8 },
  { name: "Voices", lane: VOICE_LANE, peaks: CLIP_PEAKS[VOICE_INDEX], startS: 2.5, durationS: 5 },
  { name: "SFX", lane: SFX_LANE, peaks: CLIP_PEAKS[SFX_INDEX], startS: 8.4, durationS: 3 },
];

/** The catalog rows for the models step. Names, vendors and licence labels are
 *  transcribed from `content/models/models.ts` rather than paraphrased — a
 *  landing page that softens a licence name is the specific failure this
 *  section exists to avoid. */
const CATALOG = [
  { name: "Stable Audio 3.0 SFX", kind: "sfx", license: "Stability AI Community" },
  { name: "ACE-Step 1.5 Turbo", kind: "music", license: "MIT" },
  { name: "Stable Audio 3.0 Small Music", kind: "music", license: "Stability AI Community" },
  { name: "VibeVoice 1.5B", kind: "voices", license: "MIT" },
];

const PILL_ICON = [AudioLinesIcon, MusicIcon, MicIcon, LayersIcon, CpuIcon];

/** Bars for one clip, drawn to fill whatever box they are given. Shared by the
 *  three single-clip steps and the timeline, so a clip does not change shape
 *  when it moves from the output box onto a lane. */
function Peaks({ peaks, lane, alpha = 0.85 }: { peaks: number[]; lane: number; alpha?: number }) {
  return (
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
          y={50 - peak * 44}
          width={0.7}
          height={peak * 88}
          rx={0.3}
          fill={laneColor(lane, alpha)}
        />
      ))}
    </svg>
  );
}

function PillRail({ step, select }: { step: number; select: (i: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {BEATS.map((beat, i) => {
        const Icon = PILL_ICON[i];
        const current = i === step;
        return (
          <li key={beat.pill}>
            <button
              type="button"
              onClick={() => select(i)}
              aria-current={current ? "step" : undefined}
              className={cn(
                "focus-visible:ring-ring/50 inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] outline-none focus-visible:ring-2",
                "transition-colors duration-300 motion-reduce:transition-none",
                current
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/50 text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3 shrink-0" aria-hidden="true" />
              {beat.pill}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** One of the three generating steps: what was typed, and what came back. */
function GenerateView({ index }: { index: number }) {
  const input = INPUTS[index];
  const lane = [SFX_LANE, MUSIC_LANE, VOICE_LANE][index];
  return (
    <div className="flex h-full flex-col">
      <div className="bg-background/60 ring-border/60 rounded-lg px-3 py-2.5 ring-1">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
          {input.label}
        </p>
        {input.lines.map((line) => (
          <p key={line} className="mt-1 font-mono text-sm leading-relaxed">
            {line}
          </p>
        ))}
        <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
          {input.meta.map((entry) => (
            <span key={entry}>{entry}</span>
          ))}
        </div>
      </div>

      <div className="border-border/50 bg-background/40 relative mt-3 flex-1 overflow-hidden rounded-lg border">
        <Peaks peaks={CLIP_PEAKS[index]} lane={lane} />
      </div>
    </div>
  );
}

/** The studio step: the three clips from the steps before it, on three lanes,
 *  with a playhead riding this step's own slice of the scroll. */
function TimelineView({ playhead }: { playhead: number }) {
  return (
    <div className="border-border/50 bg-background/40 relative flex h-full flex-col overflow-hidden rounded-lg border">
      {ARRANGEMENT.map((clip) => (
        <div key={clip.name} className="border-border/40 relative flex-1 border-b last:border-b-0">
          <div
            className="pointer-events-none absolute inset-0"
            style={{ backgroundColor: laneColor(clip.lane, 0.05) }}
            aria-hidden="true"
          />
          <span className="text-muted-foreground absolute top-1 left-2 z-10 font-mono text-[10px]">
            {clip.name}
          </span>
          <div
            className="absolute inset-y-1.5 overflow-hidden rounded border"
            style={{
              left: `${(clip.startS / TIMELINE_S) * 100}%`,
              width: `${(clip.durationS / TIMELINE_S) * 100}%`,
              borderColor: laneColor(clip.lane, 0.5),
              backgroundColor: laneColor(clip.lane, 0.16),
            }}
          >
            <Peaks peaks={clip.peaks} lane={clip.lane} />
          </div>
        </div>
      ))}

      {/* Driven by scroll rather than by a timer: there is no audio to be in
          sync with, and a playhead that moves on its own would be claiming
          something is playing. Scrolling it means the reader is the transport. */}
      <span
        className="bg-primary pointer-events-none absolute inset-y-0 w-px"
        style={{ left: `${playhead * 100}%` }}
        aria-hidden="true"
      />
    </div>
  );
}

/** The models step: the catalog rows, each with its licence spelled out. */
function CatalogView() {
  return (
    <div className="border-border/50 bg-background/40 h-full overflow-hidden rounded-lg border">
      {CATALOG.map((model) => (
        <div
          key={model.name}
          className="border-border/40 flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
        >
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{model.name}</p>
            <p className="text-muted-foreground font-mono text-[10px]">{model.kind}</p>
          </div>
          <span className="text-muted-foreground border-border/60 shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px]">
            {model.license}
          </span>
        </div>
      ))}
      <p className="text-muted-foreground/70 px-3 py-2 text-[11px]">
        Local weights, run through audio.cpp. No Python in the inference path.
      </p>
    </div>
  );
}

export function RevealPillars() {
  return (
    <ScrollStage
      id="pillars"
      eyebrow="One pipeline"
      title={BEATS[0].title}
      intro={INTRO}
      steps={BEATS}
      layout="text-right"
      lane={6}
      backdrop="eq"
      // Five steps at the default 34vh is a third of the page height spent on
      // one section. Lower, because this sits directly under another stage and
      // the two spacers add up before anything below them is reachable.
      vhPerStep={28}
    >
      {(progress, step, select) => {
        // Where the playhead sits within the studio step's own slice, 0..1.
        const slice = 1 / BEATS.length;
        const playhead = Math.min(
          1,
          Math.max(0, (progress - STUDIO_INDEX * slice) / slice),
        );

        return (
          <figure className="border-border/60 bg-card/80 overflow-hidden rounded-xl border shadow-sm">
            <WindowChrome label="Konchi: one prompt box, one workspace" />

            <div className="p-4 sm:p-5">
              <PillRail step={step} select={select} />

              {/* One grid cell holding every view, so the frame keeps its size
                  as they cross-fade. A fixed height rather than an auto one:
                  the views are genuinely different heights, and a window that
                  grew and shrank on every step would read as the layout
                  breaking rather than as the contents changing. */}
              <div className="mt-4 grid h-[15rem]">
                {BEATS.map((beat, i) => (
                  <div
                    key={beat.pill}
                    className={cn(
                      "col-start-1 row-start-1 min-w-0",
                      "transition-opacity duration-500 motion-reduce:transition-none",
                      i === step ? "opacity-100" : "pointer-events-none opacity-0",
                    )}
                    aria-hidden={i === step ? undefined : "true"}
                  >
                    {i === STUDIO_INDEX ? (
                      <TimelineView playhead={playhead} />
                    ) : i === BEATS.length - 1 ? (
                      <CatalogView />
                    ) : (
                      <GenerateView index={i} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Every pillar link stays in the DOM — see the file docstring. The
                grid keeps them stacked so the footer is one line tall no matter
                which is showing. */}
            <div className="border-border/60 grid border-t">
              {BEATS.map((beat, i) => (
                <p
                  key={beat.pill}
                  className={cn(
                    "col-start-1 row-start-1 px-4 py-2.5 text-sm sm:px-5",
                    "transition-opacity duration-500 motion-reduce:transition-none",
                    i === step ? "opacity-100" : "pointer-events-none opacity-0",
                  )}
                  aria-hidden={i === step ? undefined : "true"}
                >
                  <Link
                    to={beat.href}
                    className="text-primary font-medium underline-offset-4 hover:underline"
                  >
                    {beat.cta}
                    <span aria-hidden="true"> →</span>
                  </Link>
                </p>
              ))}
            </div>
          </figure>
        );
      }}
    </ScrollStage>
  );
}
