/**
 * One track, from the prompt to an arrangement — and the fork at the top of
 * that path: whether it sings.
 *
 * `/music` lists thirty-six finished renders and the prompt behind each one.
 * What it never showed is the *shape of the job*: that "make music" is two
 * different model paths with two different inputs, that the sung ones take
 * their words as a separate field rather than as more prompt, and that a
 * finished mix is not the end of it because separation turns it back into
 * parts. Those are the things a list of results cannot teach.
 *
 * **The mode toggle is the argument, so it is a real control.** The division
 * on this page is not a stylistic preference: Stable Audio 3.0 Small Music has
 * no vocal path at all, and ACE-Step is the lyrics-conditioned model — see the
 * docstring in `content/music/tracks.ts`, which is why the page splits its
 * track lists by model in the first place. A reader told that in prose has to
 * take it on faith; a reader who flips the switch and watches the lyrics field
 * appear along with a different model name has seen it. Everything downstream
 * — the model credit, the render, which stem carries a voice — follows from
 * the one toggle, which is the same trick `model-params-demo.tsx` plays with
 * its family tabs.
 *
 * **The two example tracks are real and imported, not written here.** Both
 * prompts (and the lyrics block) come straight out of `content/music/tracks.ts`
 * and are the exact strings sent to the models, so the panel cannot drift away
 * from the rows further down the same page. Rejected: transcribing a prompt
 * into this file, which would have been one copy-edit away from being a lie.
 *
 * Claims and their sources, so a later edit can check them:
 *   - two models, split by lyrics support — `content/music/tracks.ts` docstring
 *   - prompt sets genre and production, lyrics are what is sung — `docs/AUDIOCPP.md`, "Lyrics"
 *   - some models refuse to run without lyrics (MiniMax Music 3), so Konchi
 *     sends an explicit `[instrumental]` marker — same section
 *   - htdemucs emits vocals / drums / bass / other, is its own task mode, and
 *     needs exactly 44.1 kHz so the source is resampled first — `docs/AUDIOCPP.md`,
 *     "Separation"
 *
 * Deliberately *not* claimed: what the vocals stem contains when an
 * instrumental render is separated. htdemucs emits four stems regardless, but
 * nothing in the docs says what lands in the vocal one for a track with no
 * voice, so the panel labels that row and stays quiet about its contents.
 *
 * Prerendered and backend-free like the rest of `/music`: every waveform comes
 * from the seeded, quantized generators in `lib/studio-scene.ts`, so the
 * markup is byte-identical across the SSR/hydration boundary.
 */

import { useState } from "react";
import { Link } from "react-router-dom";

import { ScrollStage, type StageStep } from "@/components/scroll-stage";
import { WindowChrome } from "@/components/window-chrome";
import { MUSIC_MODEL_NAMES } from "@/content/music/types";
import { trackBySlug } from "@/content/music/tracks";
import { laneColor } from "@/lib/lanes";
import { resultPeaksFor, type ClipShape } from "@/lib/studio-scene";
import { cn } from "@/lib/utils";

/** Both example tracks render at twenty seconds; the panel draws them at a
 *  shorter nominal length purely because bar count is a drawing decision. */
const CLIP_S = 3.2;

type Mode = "instrumental" | "vocal";

/**
 * The two worked examples, each a real row in the catalogue.
 *
 * `trackBySlug` can return `undefined` if a slug is ever renamed, and this
 * component is prerendered — a thrown error at build time is a broken page,
 * not a broken test. So every field is read through a fallback and the panel
 * degrades to the shape of the story rather than to a stack trace.
 */
const INSTRUMENTAL_TRACK = trackBySlug("neon-arcade-nights");
const VOCAL_TRACK = trackBySlug("victory-lap");

interface Example {
  slug: string;
  title: string;
  /** Exactly the string sent to the model. */
  prompt: string;
  /** The lyrics block, for the lyrics-conditioned path only. */
  lyrics?: string;
  model: string;
  /** Envelope for the drawn render — a synth cue reads as a bed, an anthem as
   *  a swell into its chorus. Purely presentational. */
  shape: ClipShape;
}

const EXAMPLES: Record<Mode, Example> = {
  instrumental: {
    slug: INSTRUMENTAL_TRACK?.slug ?? "neon-arcade-nights",
    title: INSTRUMENTAL_TRACK?.title ?? "Neon Arcade Nights",
    prompt: INSTRUMENTAL_TRACK?.prompt ?? "",
    model: MUSIC_MODEL_NAMES["audiocpp-stable-audio-3-small-music"],
    shape: "steady",
  },
  vocal: {
    slug: VOCAL_TRACK?.slug ?? "victory-lap",
    title: VOCAL_TRACK?.title ?? "Victory Lap",
    prompt: VOCAL_TRACK?.prompt ?? "",
    lyrics: VOCAL_TRACK?.lyrics,
    model: MUSIC_MODEL_NAMES["audiocpp-ace-step"],
    shape: "swell",
  },
};

/** One waveform per mode, so flipping the toggle visibly changes the render
 *  rather than recolouring the same bars. Computed once at module load: these
 *  are pure seeded functions, and running them per render would put the same
 *  numbers in the markup at more cost. */
const RENDER_PEAKS: Record<Mode, number[]> = {
  instrumental: resultPeaksFor("music-flow-instrumental", "steady", CLIP_S),
  vocal: resultPeaksFor("music-flow-vocal", "swell", CLIP_S),
};

/**
 * The four stems htdemucs emits, in the order the docs list them.
 *
 * Each gets its own seeded shape rather than a tinted copy of the mix, for the
 * reason `reveal-edit-routes.tsx` gives about its own stem row: four identical
 * shapes in four colours would say "the same audio, four times", which is the
 * opposite of what separation does.
 *
 * `startS` and `lengthS` are only used by the last step, where the same four
 * stems are laid out as clips on a timeline. Staggering them is what turns a
 * stack of four full-width rows into something that reads as an arrangement
 * somebody built.
 */
const STEMS: { name: string; shape: ClipShape; startPct: number; widthPct: number }[] = [
  { name: "vocals", shape: "swell", startPct: 22, widthPct: 62 },
  { name: "drums", shape: "impact", startPct: 8, widthPct: 88 },
  { name: "bass", shape: "steady", startPct: 0, widthPct: 74 },
  { name: "other", shape: "steady", startPct: 14, widthPct: 70 },
];

const STEM_PEAKS = STEMS.map((s) => resultPeaksFor(`music-flow-stem-${s.name}`, s.shape, CLIP_S));

/** Step 0's copy is the section's own title and intro — see `ScrollStage`. */
const STEPS: StageStep[] = [
  {
    title: "A prompt, and whether it sings",
    detail: "",
  },
  {
    title: "Lyrics are a separate input",
    detail:
      "On a lyrics-conditioned model the prompt sets genre and production, and the lyrics are what gets sung. Some models, MiniMax Music 3 among them, refuse to run without lyrics. When you give none, Konchi sends an explicit [instrumental] marker so the job runs instead of failing.",
  },
  {
    title: "The render",
    detail:
      "One file, credited to the model that made it. Every track on this page carries the exact prompt that produced it, so you can reproduce the render.",
  },
  {
    title: "Split it back into stems",
    detail:
      "Separation is a task mode of its own, separate from generation. htdemucs emits four stems (vocals, drums, bass and other) and requires exactly 44.1 kHz, so the source is resampled before it runs.",
  },
  {
    title: "Or take the stems into the studio",
    detail:
      "The four stems become four clips on four lanes. From there you can move, trim and layer them against anything else in the timeline.",
  },
];

/** Peaks drawn as bars. Same geometry as the other reveal panels, kept local
 *  rather than lifted into a shared module: `reveal-edit-routes.tsx` owns its
 *  copy, and one shared `Bars` would have to grow options for both. */
function Bars({ peaks, fill }: { peaks: number[]; fill: string }) {
  return (
    <svg
      // `h-full` rather than `inset-y-0`: an <svg> with a viewBox has an
      // intrinsic aspect ratio, so with `height:auto` the browser sizes it
      // from its width and ignores `bottom` — which makes bars hundreds of
      // pixels tall inside a 24px row.
      className="absolute top-0 left-0 h-full w-full"
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

/** A labelled field in the composer, drawn the way the real composer stacks a
 *  caption over its input rather than as a form control — nothing here is
 *  typeable, and an editable-looking box that ignores the caret is worse than
 *  a plain one. */
function Field({
  label,
  value,
  mono = true,
  muted = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-[10px] font-medium tracking-[0.12em] uppercase">
        {label}
      </p>
      <p
        className={cn(
          "border-border/50 bg-background/40 mt-1 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-line",
          mono && "font-mono",
          muted ? "text-muted-foreground/70 italic" : "text-foreground/85",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function RevealMusicFlow() {
  // The one piece of state in the section. Held here rather than inside the
  // render prop so it survives every step change: a reader who picks "sung" at
  // the top stays on the sung path all the way down to the stems.
  const [mode, setMode] = useState<Mode>("vocal");
  const example = EXAMPLES[mode];

  return (
    <ScrollStage
      id="music-flow"
      eyebrow="Prompt, lyrics, render, stems"
      title="How a track on this page gets made"
      intro={
        <>
          Two models, split by one capability: Stable Audio 3.0 Small Music has no vocal path,
          so it makes the instrumentals; ACE-Step takes lyrics, so it makes the sung tracks.
          Pick a path in the panel and the rest of it follows. Both models are listed on{" "}
          <Link to="/models" className="text-foreground underline underline-offset-4">
            the model page
          </Link>
          .
        </>
      }
      steps={STEPS}
      layout="text-right"
      lane={4}
      backdrop="eq"
    >
      {(_progress, step) => (
        <figure className="border-border/60 bg-card/80 overflow-hidden rounded-xl border shadow-sm">
          <WindowChrome label="Sound: music, from a prompt to an arrangement" />

          <div className="p-4 sm:p-5">
            {/* The toggle stays on screen for every step, because what it
                changes is not confined to one of them: the model credit on the
                render and the words in the vocals lane both come from it. */}
            <div
              className="border-border/50 bg-background/40 inline-flex rounded-full border p-0.5"
              role="group"
              aria-label="Instrumental or sung"
            >
              {(["instrumental", "vocal"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={cn(
                    "focus-visible:ring-ring/50 cursor-pointer rounded-full px-3 py-1 text-[11px] font-medium outline-none focus-visible:ring-2",
                    "transition-colors duration-300 motion-reduce:transition-none",
                    mode === m
                      ? "bg-primary/12 text-foreground"
                      : "text-muted-foreground/60 hover:text-muted-foreground",
                  )}
                >
                  {m === "instrumental" ? "Instrumental" : "Sung"}
                </button>
              ))}
            </div>

            <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
              {mode === "instrumental"
                ? "Stable Audio 3.0 Small Music: no lyrics field, because the model has no vocal path."
                : "ACE-Step 1.5 Turbo: lyrics-conditioned, so the words are their own input."}
            </p>

            {/* One fixed-height stage for every step. Four stem rows are taller
                than two text fields, and letting the panel resize under the
                reader mid-scroll moves the thing they are reading. */}
            <div className="mt-4 h-[13.5rem]">
              {step <= 1 ? (
                <div className="space-y-2.5">
                  <Field label="Prompt" value={example.prompt} />
                  {mode === "vocal" ? (
                    <Field label="Lyrics" value={example.lyrics ?? ""} />
                  ) : (
                    <Field
                      label="Lyrics"
                      value="No lyrics input on this model. Models that require one are sent [instrumental]."
                      mono={false}
                      muted
                    />
                  )}
                </div>
              ) : step === 2 ? (
                <div className="flex h-full flex-col justify-center gap-3">
                  <div className="border-border/50 bg-background/40 relative h-24 overflow-hidden rounded-lg border">
                    {/* Keyed by mode so switching paths remounts the bars and
                        they fade in again — the render is the thing the toggle
                        is claiming to change. */}
                    <div
                      key={mode}
                      className="motion-safe:animate-in motion-safe:fade-in absolute inset-0 motion-safe:duration-500"
                    >
                      <Bars peaks={RENDER_PEAKS[mode]} fill="var(--primary)" />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <Link
                      to={`/music/${example.slug}`}
                      className="text-foreground text-xs font-medium underline underline-offset-4"
                    >
                      {example.title}
                    </Link>
                    <span className="text-muted-foreground font-mono text-[11px]">
                      {example.model}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col gap-1.5">
                  {STEMS.map((stem, i) => (
                    <div
                      key={stem.name}
                      className="border-border/50 bg-background/40 relative flex min-h-0 flex-1 overflow-hidden rounded border"
                    >
                      {/* A gutter, the way the timeline names its lanes —
                          rather than laying 10px type over dense bars, which
                          is not readable at any contrast. */}
                      <span className="text-muted-foreground border-border/50 flex w-14 shrink-0 items-center border-r px-1.5 font-mono text-[10px]">
                        {stem.name}
                      </span>
                      <span className="relative min-w-0 flex-1">
                        {/* Step 3 shows the stems still aligned with the mix
                            they came out of; step 4 slides them to their own
                            start times, which is the whole difference between
                            "separated" and "arranged". The transition is what
                            carries that, so it animates rather than cutting. */}
                        <span
                          className={cn(
                            "absolute top-0 h-full",
                            "transition-[left,width] duration-700 motion-reduce:transition-none",
                          )}
                          style={{
                            left: step >= 4 ? `${stem.startPct}%` : "0%",
                            width: step >= 4 ? `${stem.widthPct}%` : "100%",
                          }}
                        >
                          <Bars peaks={STEM_PEAKS[i]} fill={laneColor(i, 0.85)} />
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* A footer line that only says something on the last step, kept
                in the layout at all times so its arrival does not shift the
                panel. */}
            <p
              className={cn(
                "text-muted-foreground mt-3 text-[11px] leading-relaxed",
                "transition-opacity duration-300 motion-reduce:transition-none",
                step >= 4 ? "opacity-100" : "opacity-0",
              )}
              aria-hidden={step >= 4 ? undefined : "true"}
            >
              Arranging happens in{" "}
              <Link to="/studio" className="text-foreground underline underline-offset-4">
                the studio
              </Link>
              , where every clip keeps the prompt that made it.
            </p>
          </div>
        </figure>
      )}
    </ScrollStage>
  );
}
